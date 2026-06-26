'use client';

// /admin/reloading — Phase D Sprint 1 admin surface.
//
// Operator drops PDF manuals into RELOADING_MANUALS_INBOX_DIR on
// prod (default ~/app/manual-inbox/) via SCP, then clicks "Scan
// inbox" to ingest them. The pipeline hashes each file (SHA-256
// dedup so re-scans are no-ops), copies new ones to permanent
// storage with a random hex filename, runs pdf-parse for per-page
// text, and inserts ReloadingManualPage rows. A Postgres tsvector +
// GIN index on the page text makes Sprint 2's search instant.
//
// Status flow per manual:
//   PROCESSING → ACTIVE  (extraction succeeded; queryable by Ask GG)
//   PROCESSING → FAILED  (pdf-parse threw; admin can retry / delete)
//   ACTIVE     → ARCHIVED (hidden from Ask GG; reversible)
//   ARCHIVED   → ACTIVE  (un-hidden)

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';

type ManualStatus = 'PROCESSING' | 'ACTIVE' | 'ARCHIVED' | 'FAILED';

interface Manual {
  id: string;
  manufacturer: string;
  title: string;
  edition: string | null;
  status: ManualStatus;
  pageCount: number;
  fileSizeBytes: number;
  errorMessage: string | null;
  storedPath: string;
  createdAt: string;
  updatedAt: string;
  uploadedByAdmin: { id: string; email: string };
}

interface ScanSummary {
  inboxDir: string;
  scanned: number;
  ingested: number;
  skipped: number;
  failed: number;
  items: Array<{
    file: string;
    status: 'INGESTED' | 'SKIPPED' | 'FAILED';
    manualId?: string;
    pages?: number;
    error?: string;
  }>;
}

export default function ReloadingManualsPage() {
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Recommended-loads extraction (populates the ManualLoad table).
  const [extractInput, setExtractInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<{
    totalRows: number;
    results: Array<{
      cartridge: string;
      pagesProcessed: number;
      rowsUpserted: number;
      manuals: string[];
    }>;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch('/admin/reloading/manuals');
      if (res.ok) {
        setManuals((await res.json()) as Manual[]);
      }
    } catch {
      // empty list will render
    }
  }, []);

  useEffect(() => {
    if (!requireAdminToken()) return;
    void (async () => {
      await refresh();
      setLoaded(true);
    })();
  }, [refresh]);

  async function handleScan() {
    setScanning(true);
    setError(null);
    setLastScan(null);
    try {
      const res = await adminFetch('/admin/reloading/scan', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(body?.message ?? `Scan failed (${res.status}).`);
        return;
      }
      const summary = (await res.json()) as ScanSummary;
      setLastScan(summary);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setScanning(false);
    }
  }

  async function handleExtract() {
    const cartridges = extractInput
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cartridges.length === 0) {
      setError('Enter at least one cartridge (comma-separated).');
      return;
    }
    setExtracting(true);
    setError(null);
    setExtractResult(null);
    try {
      const res = await adminFetch('/admin/reloading/extract-loads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartridges }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(body?.message ?? `Extract failed (${res.status}).`);
        return;
      }
      setExtractResult(
        (await res.json()) as {
          totalRows: number;
          results: Array<{
            cartridge: string;
            pagesProcessed: number;
            rowsUpserted: number;
            manuals: string[];
          }>;
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setExtracting(false);
    }
  }

  async function handleAction(
    manualId: string,
    action: 'retry' | 'archive' | 'activate' | 'delete',
  ) {
    if (action === 'delete') {
      const ok = window.confirm(
        'Hard-delete this manual + the on-disk PDF? This cannot be undone.',
      );
      if (!ok) return;
    }
    setError(null);
    try {
      const method = action === 'delete' ? 'DELETE' : 'POST';
      const path =
        action === 'delete'
          ? `/admin/reloading/manuals/${manualId}`
          : `/admin/reloading/manuals/${manualId}/${action}`;
      const res = await adminFetch(path, { method });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(body?.message ?? `${action} failed (${res.status}).`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  async function handleUpdateMetadata(
    manualId: string,
    patch: { manufacturer: string; title: string; edition: string },
  ): Promise<boolean> {
    setError(null);
    try {
      const res = await adminFetch(`/admin/reloading/manuals/${manualId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manufacturer: patch.manufacturer,
          title: patch.title,
          edition: patch.edition || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(body?.message ?? `Save failed (${res.status}).`);
        return false;
      }
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      return false;
    }
  }

  /** Fetch the PDF as a blob (with admin auth header) and open it in
   *  a new tab. Direct <a href> wouldn't include the Bearer token. */
  async function handleViewPdf(manualId: string) {
    setError(null);
    try {
      const res = await adminFetch(
        `/admin/reloading/manuals/${manualId}/download`,
      );
      if (!res.ok) {
        setError(`Download failed (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // Browser revokes when the tab closes; cleanup is best-effort.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  const totals = manuals.reduce(
    (acc, m) => {
      acc[m.status] = (acc[m.status] ?? 0) + 1;
      acc.pages += m.pageCount;
      acc.bytes += m.fileSizeBytes;
      return acc;
    },
    {
      ACTIVE: 0,
      PROCESSING: 0,
      ARCHIVED: 0,
      FAILED: 0,
      pages: 0,
      bytes: 0,
    } as Record<string, number>,
  );

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1
          className="text-lg font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          Reloading manuals
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {totals.ACTIVE} active · {totals.PROCESSING} processing ·{' '}
          {totals.ARCHIVED} archived · {totals.FAILED} failed ·{' '}
          {totals.pages} pages indexed
        </p>
      </div>

      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
        Source-of-truth library for Ask GG&rsquo;s load-data + reloading-theory
        answers. Manuals are stored on the server filesystem (not Cloudinary)
        so access is admin-authenticated and there&rsquo;s no external
        dependency. The Postgres FTS index makes lookups instant across the
        full corpus.
      </p>

      {/* Operator workflow card */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2
          className="text-sm font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          How to add manuals
        </h2>
        <ol
          style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
          }}
        >
          <li>
            From your machine, SCP PDFs into{' '}
            <code style={codeStyle}>~/app/manual-inbox/</code> on the prod
            server. From PowerShell:
            <pre style={preStyle}>
              {`scp C:\\dev\\gun-galore\\Manuals\\*.pdf gungalore:~/app/manual-inbox/`}
            </pre>
          </li>
          <li>
            (Optional) Rename PDFs to{' '}
            <code style={codeStyle}>Manufacturer__Title__Edition.pdf</code> for
            clean metadata. Without separators, the filename becomes the title
            and the first word becomes the manufacturer — you can fix either
            via the &ldquo;Edit&rdquo; button below.
          </li>
          <li>Click &ldquo;Scan inbox&rdquo;. New PDFs get ingested + indexed; duplicates are skipped via SHA-256 hash.</li>
          <li>
            EPUB files (&ldquo;Handbook of Reloading Basics&rdquo;) need to be
            converted to PDF first — open in Calibre and Save to disk → PDF.
          </li>
        </ol>
      </div>

      {/* Scan controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => void handleScan()}
          disabled={scanning}
          style={{
            padding: '10px 22px',
            background: scanning ? 'var(--bg-inset)' : 'var(--red)',
            color: scanning ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: scanning ? 'wait' : 'pointer',
          }}
        >
          {scanning ? 'Scanning + indexing… (may take minutes for large PDFs)' : 'Scan inbox'}
        </button>
        {lastScan && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
            }}
          >
            Last scan: {lastScan.scanned} files found ·{' '}
            {lastScan.ingested} ingested ·{' '}
            {lastScan.skipped} already indexed ·{' '}
            {lastScan.failed} failed
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--red)',
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            padding: '10px 12px',
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          {error}
        </p>
      )}

      {/* Per-file scan log */}
      {lastScan && lastScan.items.length > 0 && (
        <div
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 18,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              marginBottom: 6,
            }}
          >
            Scan log
          </p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            {lastScan.items.map((it, i) => (
              <li key={i} style={{ padding: '3px 0' }}>
                <span
                  style={{
                    display: 'inline-block',
                    minWidth: 80,
                    color:
                      it.status === 'INGESTED'
                        ? '#7eb45c'
                        : it.status === 'SKIPPED'
                          ? 'var(--text-tertiary)'
                          : 'var(--red)',
                    fontWeight: 600,
                  }}
                >
                  {it.status}
                </span>
                <span style={{ fontFamily: 'monospace' }}>{it.file}</span>
                {it.pages !== undefined && it.pages > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>
                    ({it.pages} pages)
                  </span>
                )}
                {it.error && (
                  <span style={{ marginLeft: 8, color: 'var(--red)' }}>
                    — {it.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommended-loads extraction */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: 16,
          marginBottom: 18,
        }}
      >
        <h2
          className="text-sm font-medium mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          Recommended loads — extract from manuals
        </h2>
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Pulls published start→max charges per powder into the structured table
          that powers the Load Lab &ldquo;Recommended loads&rdquo; panel. Enter
          cartridges (comma-separated, exactly as they should display, e.g.{' '}
          <code style={codeStyle}>6.5 Creedmoor, .308 Winchester, .223 Remington</code>
          ). Re-running is safe (idempotent). Reads every active manual + runs
          Claude per page, so it takes a minute or two per cartridge.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={extractInput}
            onChange={(e) => setExtractInput(e.target.value)}
            placeholder="6.5 Creedmoor, .308 Winchester"
            style={{ ...inlineInput, flex: '1 1 320px', fontSize: 13 }}
          />
          <button
            type="button"
            onClick={() => void handleExtract()}
            disabled={extracting}
            style={{
              padding: '10px 22px',
              background: extracting ? 'var(--bg-inset)' : 'var(--red)',
              color: extracting ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: extracting ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {extracting ? 'Extracting…' : 'Extract loads'}
          </button>
        </div>
        {extractResult && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
            <strong>{extractResult.totalRows}</strong> loads extracted.
            {extractResult.results.map((r) => (
              <div key={r.cartridge} style={{ color: 'var(--text-tertiary)' }}>
                {r.cartridge}: {r.rowsUpserted} rows · {r.pagesProcessed} pages ·{' '}
                {r.manuals.length} manuals
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manuals list */}
      {loaded && manuals.length === 0 && (
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-tertiary)',
            textAlign: 'center',
            padding: 40,
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
            borderRadius: 8,
          }}
        >
          No manuals indexed yet. Drop PDFs into the inbox + click Scan above.
        </p>
      )}

      {manuals.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {manuals.map((m) => (
            <ManualRow
              key={m.id}
              manual={m}
              onAction={(action) => void handleAction(m.id, action)}
              onView={() => void handleViewPdf(m.id)}
              onSave={(patch) => handleUpdateMetadata(m.id, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function ManualRow({
  manual,
  onAction,
  onView,
  onSave,
}: {
  manual: Manual;
  onAction: (action: 'retry' | 'archive' | 'activate' | 'delete') => void;
  onView: () => void;
  onSave: (patch: {
    manufacturer: string;
    title: string;
    edition: string;
  }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftMfg, setDraftMfg] = useState(manual.manufacturer);
  const [draftTitle, setDraftTitle] = useState(manual.title);
  const [draftEdition, setDraftEdition] = useState(manual.edition ?? '');
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraftMfg(manual.manufacturer);
    setDraftTitle(manual.title);
    setDraftEdition(manual.edition ?? '');
    setEditing(true);
  }
  async function saveEdit() {
    setSaving(true);
    const ok = await onSave({
      manufacturer: draftMfg.trim(),
      title: draftTitle.trim(),
      edition: draftEdition.trim(),
    });
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        {editing ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 8,
            }}
          >
            <input
              type="text"
              value={draftMfg}
              onChange={(e) => setDraftMfg(e.target.value)}
              placeholder="Manufacturer"
              style={inlineInput}
            />
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title"
              style={inlineInput}
            />
            <input
              type="text"
              value={draftEdition}
              onChange={(e) => setDraftEdition(e.target.value)}
              placeholder="Edition (optional)"
              style={inlineInput}
            />
          </div>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            {manual.manufacturer} — {manual.title}
            {manual.edition ? (
              <span style={{ color: 'var(--text-tertiary)' }}>
                {' '}
                ({manual.edition})
              </span>
            ) : null}
          </p>
        )}
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 11,
            color: 'var(--text-tertiary)',
          }}
        >
          {manual.pageCount} pages · {formatBytes(manual.fileSizeBytes)} ·
          uploaded by {manual.uploadedByAdmin.email} ·{' '}
          {new Date(manual.createdAt).toLocaleString('en-ZA')}
        </p>
        {manual.errorMessage && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 11,
              color: 'var(--red)',
              fontFamily: 'monospace',
            }}
          >
            {manual.errorMessage}
          </p>
        )}
      </div>
      <StatusBadge status={manual.status} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving}
              style={{
                ...btnSecondary,
                background: 'var(--red)',
                color: '#fff',
                borderColor: 'var(--red)',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={btnSecondary}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={startEdit} style={btnSecondary}>
              Edit
            </button>
            {manual.status === 'FAILED' && (
              <button
                type="button"
                onClick={() => onAction('retry')}
                style={btnSecondary}
              >
                Retry
              </button>
            )}
            {manual.status === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => onAction('archive')}
                style={btnSecondary}
              >
                Archive
              </button>
            )}
            {manual.status === 'ARCHIVED' && (
              <button
                type="button"
                onClick={() => onAction('activate')}
                style={btnSecondary}
              >
                Activate
              </button>
            )}
            <button type="button" onClick={onView} style={btnSecondary}>
              View PDF
            </button>
            <button
              type="button"
              onClick={() => onAction('delete')}
              style={{ ...btnSecondary, color: 'var(--red)' }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ManualStatus }) {
  const styles: Record<
    ManualStatus,
    { bg: string; border: string; color: string; label: string }
  > = {
    PROCESSING: {
      bg: 'rgba(200,160,80,0.12)',
      border: 'rgba(200,160,80,0.40)',
      color: '#c9a050',
      label: 'Processing',
    },
    ACTIVE: {
      bg: 'rgba(120,180,90,0.12)',
      border: 'rgba(120,180,90,0.40)',
      color: '#7eb45c',
      label: 'Active',
    },
    ARCHIVED: {
      bg: 'var(--bg-inset)',
      border: 'var(--border)',
      color: 'var(--text-tertiary)',
      label: 'Archived',
    },
    FAILED: {
      bg: 'rgba(200,16,46,0.10)',
      border: 'rgba(200,16,46,0.40)',
      color: 'var(--red)',
      label: 'Failed',
    },
  };
  const s = styles[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 9px',
        borderRadius: 999,
        background: s.bg,
        border: `0.5px solid ${s.border}`,
        color: s.color,
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      {s.label}
    </span>
  );
}

const codeStyle: React.CSSProperties = {
  padding: '1px 6px',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  borderRadius: 4,
  fontFamily: 'monospace',
  fontSize: 12,
  color: 'var(--text-primary)',
};

const preStyle: React.CSSProperties = {
  margin: '6px 0 0',
  padding: '10px 12px',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'monospace',
  fontSize: 12,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

const inlineInput: React.CSSProperties = {
  padding: '7px 10px',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'inherit',
};

const btnSecondary: React.CSSProperties = {
  padding: '6px 12px',
  background: 'var(--bg-inset)',
  color: 'var(--text-secondary)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
