'use client';

// Admin-side dealer-verification panel — appears on the transaction
// dossier for firearm DEALER_TRANSFER orders. Shows the 3 photos
// + Claude's per-criterion scores + override buttons.
//
// Used when:
//   - Status is PENDING_ADMIN_REVIEW (Claude returned 50-79% — needs human eyes)
//   - Admin wants to override an APPROVED or REJECTED verdict

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function getToken() {
  return document.cookie.match(/gg_admin_sess=([^;]+)/)?.[1] ?? '';
}

interface Findings {
  saps534: {
    all_fields_filled: number;
    dealer_stamp_or_signature: number;
    block_letters: number;
    dealer_licence_visible: number;
    extracted_dealer_licence: string | null;
    issues: string[];
  };
  stockRegister: {
    last_line_only: number;
    extracted_serial: string | null;
    serial_matches_listing: number;
    extracted_entry_number: string | null;
    issues: string[];
  };
  firearm: {
    serial_legible: number;
    extracted_serial: string | null;
    serial_matches_listing: number;
    order_reference_visible: number;
    issues: string[];
  };
  serial_consistency_across_photos: number;
  overall_confidence: number;
  recommendation: 'APPROVE' | 'ADMIN_REVIEW' | 'REJECT';
  recommendation_reason: string;
}

interface Props {
  txId: string;
  status: string;
  score: number | null;
  findings: Findings | null;
  saps534Url: string | null;
  stockRegisterUrl: string | null;
  firearmSerialUrl: string | null;
  stockRegisterRef: string | null;
  verifiedAt: string | null;
}

export default function DealerVerificationPanel({
  txId,
  status,
  score,
  findings,
  saps534Url,
  stockRegisterUrl,
  firearmSerialUrl,
  stockRegisterRef,
  verifiedAt,
}: Props) {
  const router = useRouter();
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function execute() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/admin/transactions/${txId}/dealer-verification/override`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ decision: action, reason: reason.trim() }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? `Error ${res.status}`);
      setAction(null);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Override failed');
    } finally {
      setBusy(false);
    }
  }

  const colour =
    status === 'APPROVED'
      ? '#22c55e'
      : status === 'REJECTED'
        ? 'var(--red)'
        : '#f59e0b';

  return (
    <>
      <div
        className="rounded-[8px] p-5"
        style={{
          background: 'var(--bg-card)',
          border: `0.5px solid ${colour}`,
        }}
      >
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Dealer stock-in verification
          </p>
          <div className="flex gap-2 items-center">
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: `${colour}18`, color: colour, fontWeight: 500 }}
            >
              {status.replace(/_/g, ' ')}
            </span>
            {score !== null && (
              <span
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {score}% confidence
              </span>
            )}
          </div>
        </div>

        {/* Three photo thumbnails */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <PhotoSlot label="SAPS 534" url={saps534Url} />
          <PhotoSlot label="Stock register (last line)" url={stockRegisterUrl} />
          <PhotoSlot label="Firearm + reference" url={firearmSerialUrl} />
        </div>

        {/* Claude's per-criterion scores */}
        {findings && <FindingsBreakdown findings={findings} />}

        {stockRegisterRef && (
          <p
            className="text-xs mt-3"
            style={{ color: 'var(--text-secondary)' }}
          >
            Stock register entry: <code style={{ fontFamily: 'monospace' }}>{stockRegisterRef}</code>
          </p>
        )}

        {verifiedAt && (
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Approved at {new Date(verifiedAt).toLocaleString('en-ZA')}
          </p>
        )}

        {/* Override buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setAction('APPROVE')}
            disabled={status === 'APPROVED'}
            className="flex-1 py-2 rounded text-xs font-medium"
            style={{
              background: status === 'APPROVED' ? 'var(--bg-inset)' : '#22c55e18',
              color: status === 'APPROVED' ? 'var(--text-tertiary)' : '#22c55e',
              border: '0.5px solid #22c55e40',
              cursor: status === 'APPROVED' ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'APPROVED' ? '✓ Already approved' : 'Approve verification'}
          </button>
          <button
            onClick={() => setAction('REJECT')}
            disabled={status === 'REJECTED'}
            className="flex-1 py-2 rounded text-xs font-medium"
            style={{
              background: status === 'REJECTED' ? 'var(--bg-inset)' : 'var(--red)18',
              color: status === 'REJECTED' ? 'var(--text-tertiary)' : 'var(--red)',
              border: '0.5px solid var(--red)40',
              cursor: status === 'REJECTED' ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'REJECTED' ? '✕ Already rejected' : 'Reject + request reshoot'}
          </button>
        </div>
      </div>

      {/* Override confirm modal */}
      {action && (
        <div
          onClick={() => !busy && setAction(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 480,
              width: '100%',
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: `0.5px solid ${action === 'APPROVE' ? '#22c55e' : 'var(--red)'}`,
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {action === 'APPROVE'
                ? 'Approve dealer verification?'
                : 'Reject dealer verification?'}
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              {action === 'APPROVE'
                ? "Marks the dealer stock-in as confirmed. Payout will release once the buyer confirms delivery (or, for already-PENDING_ADMIN_VERIFICATION, becomes eligible for the next release pass)."
                : 'The seller will be asked to reshoot the photos. The reason below will be recorded against the transaction (visible in the audit log).'}
            </p>
            <div className="mb-4">
              <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
                Reason (≥5 chars, audit log)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={
                  action === 'APPROVE'
                    ? 'e.g. Dealer confirmed by phone; photos clear despite Claude flagging stamp'
                    : 'e.g. Stock register photo shows other entries — privacy fail; reshoot needed'
                }
                style={{
                  width: '100%',
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 13,
                  outline: 'none',
                  resize: 'vertical',
                }}
                autoFocus
              />
            </div>
            {error && (
              <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAction(null)}
                disabled={busy}
                className="flex-1 py-2 rounded text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={execute}
                disabled={busy || reason.trim().length < 5}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background:
                    busy || reason.trim().length < 5
                      ? 'var(--bg-inset)'
                      : action === 'APPROVE'
                        ? '#22c55e'
                        : 'var(--red)',
                  color: busy || reason.trim().length < 5 ? 'var(--text-tertiary)' : '#fff',
                  border: 'none',
                  cursor: busy || reason.trim().length < 5 ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Working…' : action === 'APPROVE' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PhotoSlot({ label, url }: { label: string; url: string | null }) {
  return (
    <div>
      <p
        className="text-xs uppercase tracking-wider mb-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </p>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            style={{
              width: '100%',
              aspectRatio: '4/3',
              objectFit: 'cover',
              borderRadius: 6,
              border: '0.5px solid var(--border)',
              cursor: 'zoom-in',
            }}
          />
        </a>
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: '4/3',
            background: 'var(--bg-inset)',
            border: '0.5px dashed var(--border)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 12,
          }}
        >
          Not uploaded
        </div>
      )}
    </div>
  );
}

function FindingsBreakdown({ findings }: { findings: Findings }) {
  const groups: { title: string; rows: { label: string; score: number; extra?: string }[] }[] = [
    {
      title: 'SAPS 534',
      rows: [
        { label: 'All fields filled', score: findings.saps534.all_fields_filled },
        { label: 'Stamp or signature', score: findings.saps534.dealer_stamp_or_signature },
        { label: 'Block letters', score: findings.saps534.block_letters },
        {
          label: 'Dealer licence visible',
          score: findings.saps534.dealer_licence_visible,
          extra: findings.saps534.extracted_dealer_licence
            ? `read: "${findings.saps534.extracted_dealer_licence}"`
            : undefined,
        },
      ],
    },
    {
      title: 'Stock register',
      rows: [
        { label: 'Last line only (privacy)', score: findings.stockRegister.last_line_only },
        {
          label: 'Serial matches listing',
          score: findings.stockRegister.serial_matches_listing,
          extra: findings.stockRegister.extracted_serial
            ? `read: "${findings.stockRegister.extracted_serial}"`
            : undefined,
        },
      ],
    },
    {
      title: 'Firearm',
      rows: [
        {
          label: 'Serial legible',
          score: findings.firearm.serial_legible,
          extra: findings.firearm.extracted_serial
            ? `read: "${findings.firearm.extracted_serial}"`
            : undefined,
        },
        { label: 'Matches listing', score: findings.firearm.serial_matches_listing },
        { label: 'Order reference visible', score: findings.firearm.order_reference_visible },
      ],
    },
    {
      title: 'Cross-check',
      rows: [
        {
          label: 'Serial consistent across all 3 photos',
          score: findings.serial_consistency_across_photos,
        },
      ],
    },
  ];

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.title}>
          <p
            className="text-xs uppercase tracking-wider mb-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {g.title}
          </p>
          {g.rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2 text-xs mb-1">
              <span
                className="inline-block w-4 text-center"
                style={{
                  color:
                    r.score >= 80
                      ? '#22c55e'
                      : r.score >= 50
                        ? '#f59e0b'
                        : 'var(--red)',
                }}
              >
                {r.score >= 80 ? '✓' : r.score >= 50 ? '⚠' : '✕'}
              </span>
              <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{r.label}</span>
              {r.extra && (
                <span style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                  {r.extra}
                </span>
              )}
              <span
                className="text-xs"
                style={{ color: 'var(--text-tertiary)', minWidth: 35, textAlign: 'right' }}
              >
                {r.score}%
              </span>
            </div>
          ))}
        </div>
      ))}
      {findings.recommendation_reason && (
        <p
          className="text-xs mt-2 p-3 rounded"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          <strong>Bot summary:</strong> {findings.recommendation_reason}
        </p>
      )}
    </div>
  );
}
