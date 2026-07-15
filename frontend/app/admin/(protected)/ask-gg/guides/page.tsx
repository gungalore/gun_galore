'use client';

// /admin/ask-gg/guides — GG site-guide (G5) editor.
//
// The static GUIDES catalog (backend guide-content.ts) ships as the baseline;
// here the operator can OVERRIDE any page guide's title / intro / points /
// CTAs. Flow per key:
//   DEFAULT   → no override; users see the shipped guide
//   DRAFT     → an override is saved but NOT live (preview only)
//   PUBLISHED → the override is live for users
// Save keeps status (editing a Published guide updates it live). Publish takes
// a draft live; Unpublish reverts users to the default (keeps the draft);
// Reset discards the override entirely. Live auction state + each signed-in
// user's personal overlay are computed at serve time and can't be edited here.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { useReasonModal } from '@/components/admin/reason-modal';

type Status = 'DEFAULT' | 'DRAFT' | 'PUBLISHED';

interface CatalogRow {
  key: string;
  defaultTitle: string;
  status: Status;
  publishedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface GuideCtaView {
  label: string;
  href?: string;
  ask?: string;
}
interface GuideContent {
  title: string;
  intro: string | null;
  points: string[];
  ctas: GuideCtaView[];
}
interface GuideDetail {
  key: string;
  default: GuideContent;
  override:
    | (GuideContent & { status: Status; publishedAt: string | null; updatedAt: string | null })
    | null;
}

// The editable CTA shape (kind + single value → maps to href|ask on save).
interface EditCta {
  label: string;
  kind: 'link' | 'ask';
  value: string;
}

interface Form {
  title: string;
  intro: string;
  points: string[];
  ctas: EditCta[];
}

function contentToForm(c: GuideContent): Form {
  return {
    title: c.title,
    intro: c.intro ?? '',
    points: c.points.length ? [...c.points] : [''],
    ctas: c.ctas.map((cta) => ({
      label: cta.label,
      kind: cta.href ? 'link' : 'ask',
      value: cta.href ?? cta.ask ?? '',
    })),
  };
}

function formToPayload(f: Form) {
  return {
    title: f.title.trim(),
    intro: f.intro.trim(),
    points: f.points.map((p) => p.trim()).filter(Boolean),
    ctas: f.ctas
      .filter((c) => c.label.trim() && c.value.trim())
      .map((c) =>
        c.kind === 'link'
          ? { label: c.label.trim(), href: c.value.trim() }
          : { label: c.label.trim(), ask: c.value.trim() },
      ),
  };
}

export default function GuideAdminPage() {
  const [list, setList] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<GuideDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { ask, modal } = useReasonModal();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch('/admin/ask-gg/guides');
      if (res.ok) setList((await res.json()) as CatalogRow[]);
      else setError(`Failed to load (${res.status}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }, []);

  useEffect(() => {
    if (!requireAdminToken()) return;
    void refresh();
  }, [refresh]);

  async function openKey(key: string) {
    setError(null);
    setNotice(null);
    try {
      const res = await adminFetch(`/admin/ask-gg/guides/${key}`);
      if (!res.ok) {
        setError(`Failed to open (${res.status}).`);
        return;
      }
      const d = (await res.json()) as GuideDetail;
      setDetail(d);
      setSelected(key);
      setForm(contentToForm(d.override ?? d.default));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  function closeEditor() {
    setSelected(null);
    setDetail(null);
    setForm(null);
    setNotice(null);
  }

  async function save(): Promise<boolean> {
    if (!selected || !form) return false;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminFetch(`/admin/ask-gg/guides/${selected}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPayload(form)),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        setError(msg?.message ?? `Save failed (${res.status}).`);
        return false;
      }
      await refresh();
      await openKey(selected);
      setNotice('Saved.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function action(kind: 'publish' | 'unpublish') {
    if (!selected) return;
    // Save first so publish always reflects the current form.
    if (kind === 'publish') {
      const ok = await save();
      if (!ok) return;
    }
    setError(null);
    try {
      const res = await adminFetch(`/admin/ask-gg/guides/${selected}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        setError(msg?.message ?? `${kind} failed (${res.status}).`);
        return;
      }
      await refresh();
      await openKey(selected);
      setNotice(kind === 'publish' ? 'Published — live for users.' : 'Unpublished — users see the default.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  async function reset() {
    if (!selected) return;
    const reason = await ask({
      title: 'Reset this guide to the shipped default?',
      message: 'Your override is discarded and users see the built-in guide. Logged to the audit trail.',
      defaultValue: 'Reverting to the default copy.',
      confirmLabel: 'Reset to default',
      danger: true,
    });
    if (!reason) return;
    setError(null);
    try {
      const res = await adminFetch(`/admin/ask-gg/guides/${selected}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setError(`Reset failed (${res.status}).`);
        return;
      }
      await refresh();
      closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  const counts = list
    ? {
        published: list.filter((r) => r.status === 'PUBLISHED').length,
        draft: list.filter((r) => r.status === 'DRAFT').length,
        total: list.length,
      }
    : null;

  return (
    <div>
      {modal}
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Ask GG · Page guides
        </h1>
        {counts && (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {counts.published} published · {counts.draft} draft · {counts.total} pages
          </p>
        )}
      </div>

      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        These are the per-page guides GG shows in its &ldquo;Guide&rdquo; tab.
        Each page ships with a built-in guide; edit and <strong>publish</strong>{' '}
        to override it, or <strong>reset</strong> to the default. Live auction
        state and each user&rsquo;s own account overlay are added automatically
        and can&rsquo;t be edited here.
      </p>

      {error && (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      )}

      {selected && form && detail ? (
        <Editor
          detail={detail}
          form={form}
          setForm={setForm}
          saving={saving}
          notice={notice}
          onSave={() => void save()}
          onPublish={() => void action('publish')}
          onUnpublish={() => void action('unpublish')}
          onReset={() => void reset()}
          onLoadDefault={() => setForm(contentToForm(detail.default))}
          onClose={closeEditor}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list?.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => void openKey(row.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                textAlign: 'left',
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                borderRadius: 8,
                padding: '11px 14px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {row.defaultTitle}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                  {row.key}
                </span>
              </span>
              <StatusBadge status={row.status} />
            </button>
          ))}
          {!list && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading…</p>}
        </div>
      )}
    </div>
  );
}

// ─── Editor ─────────────────────────────────────────────────────────

function Editor({
  detail,
  form,
  setForm,
  saving,
  notice,
  onSave,
  onPublish,
  onUnpublish,
  onReset,
  onLoadDefault,
  onClose,
}: {
  detail: GuideDetail;
  form: Form;
  setForm: (f: Form) => void;
  saving: boolean;
  notice: string | null;
  onSave: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onReset: () => void;
  onLoadDefault: () => void;
  onClose: () => void;
}) {
  const status: Status = detail.override?.status ?? 'DEFAULT';
  const setPoint = (i: number, v: string) => {
    const points = [...form.points];
    points[i] = v;
    setForm({ ...form, points });
  };
  const setCta = (i: number, patch: Partial<EditCta>) => {
    const ctas = form.ctas.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    setForm({ ...form, ctas });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={onClose} style={{ ...btnSecondary }}>
          ← All guides
        </button>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
            {detail.key}
          </span>
          <StatusBadge status={status} />
        </span>
      </div>

      {notice && (
        <p style={{ ...alertStyle, color: 'var(--text-secondary)', background: 'var(--bg-inset)', borderColor: 'var(--border)' }}>
          {notice}
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'minmax(0,1fr)',
        }}
        className="guide-editor-grid"
      >
        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14 }}>
          <label style={labelStyle}>
            Title
            <input type="text" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Intro (optional)
            <textarea value={form.intro} maxLength={400} rows={2} onChange={(e) => setForm({ ...form, intro: e.target.value })} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </label>

          <div>
            <span style={labelStyle}>Points</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {form.points.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <textarea value={p} rows={2} maxLength={300} onChange={(e) => setPoint(i, e.target.value)} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', flex: 1 }} />
                  <button type="button" aria-label="Remove point" onClick={() => setForm({ ...form, points: form.points.filter((_, idx) => idx !== i) })} style={miniBtn}>
                    ✕
                  </button>
                </div>
              ))}
              {form.points.length < 12 && (
                <button type="button" onClick={() => setForm({ ...form, points: [...form.points, ''] })} style={{ ...btnSecondary, alignSelf: 'flex-start' }}>
                  + Add point
                </button>
              )}
            </div>
          </div>

          <div>
            <span style={labelStyle}>Buttons (CTAs)</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {form.ctas.map((c, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 8, background: 'var(--bg-deep)', border: '0.5px solid var(--border)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="text" placeholder="Label" value={c.label} maxLength={60} onChange={(e) => setCta(i, { label: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                    <select value={c.kind} onChange={(e) => setCta(i, { kind: e.target.value as EditCta['kind'] })} style={{ ...inputStyle, width: 'auto' }}>
                      <option value="link">Link</option>
                      <option value="ask">Ask GG</option>
                    </select>
                    <button type="button" aria-label="Remove button" onClick={() => setForm({ ...form, ctas: form.ctas.filter((_, idx) => idx !== i) })} style={miniBtn}>
                      ✕
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder={c.kind === 'link' ? 'Internal path e.g. /listings/new' : 'Question staged into the chat'}
                    value={c.value}
                    maxLength={300}
                    onChange={(e) => setCta(i, { value: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              ))}
              {form.ctas.length < 6 && (
                <button type="button" onClick={() => setForm({ ...form, ctas: [...form.ctas, { label: '', kind: 'link', value: '' }] })} style={{ ...btnSecondary, alignSelf: 'flex-start' }}>
                  + Add button
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Preview
          </p>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{form.title || '(no title)'}</h3>
          {form.intro.trim() && <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{form.intro}</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {form.points.filter((p) => p.trim()).map((p, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                <span aria-hidden style={{ flexShrink: 0, marginTop: 6, width: 6, height: 6, borderRadius: 999, background: 'var(--red)' }} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
            {form.ctas.filter((c) => c.label.trim()).map((c, i) => (
              <span key={i} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 999, background: c.kind === 'link' ? 'var(--red)' : 'var(--bg-card)', color: c.kind === 'link' ? '#fff' : 'var(--text-secondary)', border: c.kind === 'link' ? 'none' : '0.5px solid var(--border)' }}>
                {c.label}
                {c.kind === 'ask' && ' →'}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {status !== 'PUBLISHED' ? (
          <button type="button" onClick={onPublish} disabled={saving} style={btnPublish}>
            Save &amp; publish
          </button>
        ) : (
          <button type="button" onClick={onUnpublish} disabled={saving} style={btnSecondary}>
            Unpublish
          </button>
        )}
        <button type="button" onClick={onLoadDefault} style={btnSecondary}>
          Load default copy
        </button>
        {status !== 'DEFAULT' && (
          <button type="button" onClick={onReset} style={{ ...btnSecondary, color: 'var(--red)' }}>
            Reset to default
          </button>
        )}
      </div>

      <details style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        <summary style={{ cursor: 'pointer' }}>Shipped default (reference)</summary>
        <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-inset)', border: '0.5px solid var(--border)', borderRadius: 6, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          <strong>{detail.default.title}</strong>
          {detail.default.intro ? `\n${detail.default.intro}` : ''}
          {'\n\n'}
          {detail.default.points.map((p) => `• ${p}`).join('\n')}
        </div>
      </details>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const styles: Record<Status, { bg: string; border: string; color: string; label: string }> = {
    DEFAULT: { bg: 'var(--bg-inset)', border: 'var(--border)', color: 'var(--text-tertiary)', label: 'Default' },
    DRAFT: { bg: 'rgba(200,160,80,0.12)', border: 'rgba(200,160,80,0.40)', color: '#c9a050', label: 'Draft' },
    PUBLISHED: { bg: 'rgba(120,180,90,0.12)', border: 'rgba(120,180,90,0.40)', color: '#7eb45c', label: 'Published' },
  };
  const s = styles[status];
  return (
    <span style={{ display: 'inline-block', flexShrink: 0, padding: '3px 9px', borderRadius: 999, background: s.bg, border: `0.5px solid ${s.border}`, color: s.color, fontSize: 11, fontWeight: 500 }}>
      {s.label}
    </span>
  );
}

const alertStyle: React.CSSProperties = {
  margin: '0 0 14px',
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--red)',
  background: 'rgba(200,16,46,0.10)',
  border: '0.5px solid var(--red)',
  borderRadius: 6,
};

const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 };

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
  padding: '7px 13px',
  background: 'var(--bg-inset)',
  color: 'var(--text-secondary)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnPrimary: React.CSSProperties = {
  padding: '9px 18px',
  background: 'var(--red)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnPublish: React.CSSProperties = {
  ...btnPrimary,
  background: '#1a9e4b',
};

const miniBtn: React.CSSProperties = {
  flexShrink: 0,
  width: 30,
  background: 'var(--bg-inset)',
  color: 'var(--text-tertiary)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
