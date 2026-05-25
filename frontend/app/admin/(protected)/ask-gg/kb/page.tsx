'use client';

// /admin/ask-gg/kb — Phase C Sprint 3 admin queue.
//
// Three-stage flow per entry:
//   DRAFT     → admin reviews + edits + clicks Verify
//   VERIFIED  → surfaced to users via the search-first composer cards
//   ARCHIVED  → soft-hidden; can be returned to DRAFT to re-review
//
// DRAFT entries come from the user-side "Did that solve it? → Yes"
// prompt on /ask-gg. Admin can either fix the auto-collapsed text
// (title + question + answer were taken from the first user message
// + last assistant message of the conversation) or hard-delete a
// mis-collapsed one. Verification fires AdminAuditEvent with a
// reason; once VERIFIED the entry shortens future users' path to
// the answer (no Claude call when their question matches).

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';

type Status = 'DRAFT' | 'VERIFIED' | 'SUBMITTED' | 'ARCHIVED';

interface KbEntry {
  id: string;
  title: string;
  question: string;
  answer: string;
  category: string | null;
  tags: string[];
  status: Status;
  usefulCount: number;
  surfacedCount: number;
  verifiedAt: string | null;
  createdAt: string;
  sourceConversationId: string | null;
  author: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

interface ListResponse {
  rows: KbEntry[];
  total: number;
  limit: number;
  offset: number;
  counts: Record<Status, number>;
}

export default function KbAdminPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Status | 'ALL'>('DRAFT');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch(
        `/admin/ask-gg/kb?status=${statusFilter}&limit=100`,
      );
      if (res.ok) {
        setData((await res.json()) as ListResponse);
      } else {
        setError(`Failed to load (${res.status}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }, [statusFilter]);

  useEffect(() => {
    if (!requireAdminToken()) return;
    void (async () => {
      await refresh();
      setLoaded(true);
    })();
  }, [refresh]);

  async function handleVerify(id: string) {
    const reason = window.prompt(
      'Reason for verifying (will appear in the audit log):',
      'Reviewed; answer is correct and useful.',
    );
    if (!reason) return;
    try {
      const res = await adminFetch(`/admin/ask-gg/kb/${id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setError(`Verify failed (${res.status}).`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  async function handleArchive(id: string) {
    const reason = window.prompt(
      'Reason for archiving:',
      'Low quality / not useful enough.',
    );
    if (!reason) return;
    try {
      const res = await adminFetch(`/admin/ask-gg/kb/${id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setError(`Archive failed (${res.status}).`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  async function handleUnarchive(id: string) {
    try {
      const res = await adminFetch(`/admin/ask-gg/kb/${id}/unarchive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Returned for re-review.' }),
      });
      if (!res.ok) {
        setError(`Unarchive failed (${res.status}).`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  async function handleDelete(id: string) {
    const reason = window.prompt(
      'Hard-delete (cannot be undone). Reason:',
      'Mis-collapsed conversation; unsalvageable.',
    );
    if (!reason) return;
    if (
      !window.confirm(
        'Hard-delete this KB entry? This is permanent.',
      )
    ) {
      return;
    }
    try {
      const res = await adminFetch(`/admin/ask-gg/kb/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setError(`Delete failed (${res.status}).`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  async function handleSaveEdit(
    id: string,
    patch: {
      title: string;
      question: string;
      answer: string;
      category: string;
    },
  ): Promise<boolean> {
    setError(null);
    try {
      const res = await adminFetch(`/admin/ask-gg/kb/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setError(`Save failed (${res.status}).`);
        return false;
      }
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      return false;
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1
          className="text-lg font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          Ask GG · Knowledge base
        </h1>
        {data && (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {data.counts.DRAFT} drafts · {data.counts.VERIFIED} verified ·{' '}
            {data.counts.ARCHIVED} archived
          </p>
        )}
      </div>

      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        DRAFT entries come from users marking conversations as
        &ldquo;solved.&rdquo; Review the auto-collapsed text, edit if
        needed, then Verify. VERIFIED entries surface above the chat
        composer for the next user who asks something similar &mdash;
        their question gets answered without burning a Claude call.
      </p>

      {/* Status tabs */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        {(['DRAFT', 'VERIFIED', 'ARCHIVED', 'ALL'] as const).map((s) => {
          const isActive = statusFilter === s;
          const count =
            s === 'ALL'
              ? Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0)
              : data?.counts[s as Status] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                background: isActive
                  ? 'rgba(200,16,46,0.12)'
                  : 'var(--bg-card)',
                border: `0.5px solid ${
                  isActive ? 'var(--red)' : 'var(--border)'
                }`,
                color: isActive ? 'var(--red)' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {s} {data && <span style={{ opacity: 0.7 }}>({count})</span>}
            </button>
          );
        })}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            margin: '0 0 14px',
            padding: '8px 10px',
            fontSize: 13,
            color: 'var(--red)',
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            borderRadius: 6,
          }}
        >
          {error}
        </p>
      )}

      {loaded && data && data.rows.length === 0 && (
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
          No entries in this status. Try a different tab.
        </p>
      )}

      {data && data.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.rows.map((entry) =>
            editingId === entry.id ? (
              <EditRow
                key={entry.id}
                entry={entry}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => {
                  const ok = await handleSaveEdit(entry.id, patch);
                  if (ok) setEditingId(null);
                }}
              />
            ) : (
              <KbRow
                key={entry.id}
                entry={entry}
                onEdit={() => setEditingId(entry.id)}
                onVerify={() => void handleVerify(entry.id)}
                onArchive={() => void handleArchive(entry.id)}
                onUnarchive={() => void handleUnarchive(entry.id)}
                onDelete={() => void handleDelete(entry.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function KbRow({
  entry,
  onEdit,
  onVerify,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  entry: KbEntry;
  onEdit: () => void;
  onVerify: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const [showAnswer, setShowAnswer] = useState(false);
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text-primary)',
            flex: 1,
            minWidth: 200,
          }}
        >
          {entry.title}
        </h3>
        <StatusBadge status={entry.status} />
      </div>
      <p
        style={{
          margin: '4px 0 8px',
          fontSize: 11,
          color: 'var(--text-tertiary)',
        }}
      >
        {entry.category ? `${entry.category} · ` : ''}
        by {entry.author.email} · {entry.usefulCount}/{entry.surfacedCount} useful/surfaced ·{' '}
        {new Date(entry.createdAt).toLocaleString('en-ZA')}
      </p>
      <p
        style={{
          margin: '0 0 6px',
          fontSize: 12,
          color: 'var(--text-secondary)',
          fontStyle: 'italic',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}
      >
        Q: {entry.question}
      </p>
      <button
        type="button"
        onClick={() => setShowAnswer((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'var(--text-tertiary)',
          fontSize: 11,
          cursor: 'pointer',
          textDecoration: 'underline',
          fontFamily: 'inherit',
          marginBottom: 6,
        }}
      >
        {showAnswer ? 'Hide answer' : 'Show answer'}
      </button>
      {showAnswer && (
        <p
          style={{
            margin: '4px 0 8px',
            padding: '8px 10px',
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--text-primary)',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {entry.answer}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 8,
          flexWrap: 'wrap',
        }}
      >
        <button type="button" onClick={onEdit} style={btnSecondary}>
          Edit
        </button>
        {entry.status === 'DRAFT' && (
          <button
            type="button"
            onClick={onVerify}
            style={{ ...btnSecondary, background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}
          >
            Verify
          </button>
        )}
        {entry.status === 'VERIFIED' && (
          <button type="button" onClick={onArchive} style={btnSecondary}>
            Archive
          </button>
        )}
        {entry.status === 'ARCHIVED' && (
          <button type="button" onClick={onUnarchive} style={btnSecondary}>
            Return to draft
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          style={{ ...btnSecondary, color: 'var(--red)' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function EditRow({
  entry,
  onCancel,
  onSave,
}: {
  entry: KbEntry;
  onCancel: () => void;
  onSave: (patch: {
    title: string;
    question: string;
    answer: string;
    category: string;
  }) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(entry.title);
  const [question, setQuestion] = useState(entry.question);
  const [answer, setAnswer] = useState(entry.answer);
  const [category, setCategory] = useState(entry.category ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await onSave({
      title: title.trim(),
      question: question.trim(),
      answer: answer.trim(),
      category: category.trim(),
    });
    setSaving(false);
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--red)',
        borderRadius: 8,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        Category
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. cleaning · safety · reloading"
          style={inputStyle}
        />
      </label>
      <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        Question
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
        />
      </label>
      <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        Answer
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={8}
          style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={{
            padding: '9px 18px',
            background: saving ? 'var(--bg-inset)' : 'var(--red)',
            color: saving ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '9px 14px',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const styles: Record<
    Status,
    { bg: string; border: string; color: string; label: string }
  > = {
    DRAFT: {
      bg: 'rgba(200,160,80,0.12)',
      border: 'rgba(200,160,80,0.40)',
      color: '#c9a050',
      label: 'Draft',
    },
    VERIFIED: {
      bg: 'rgba(120,180,90,0.12)',
      border: 'rgba(120,180,90,0.40)',
      color: '#7eb45c',
      label: 'Verified',
    },
    SUBMITTED: {
      bg: 'var(--bg-inset)',
      border: 'var(--border)',
      color: 'var(--text-tertiary)',
      label: 'Submitted',
    },
    ARCHIVED: {
      bg: 'var(--bg-inset)',
      border: 'var(--border)',
      color: 'var(--text-tertiary)',
      label: 'Archived',
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

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  fontSize: 13,
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
