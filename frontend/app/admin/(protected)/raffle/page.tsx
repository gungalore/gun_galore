'use client';

// /admin/raffle — PRO prize-draw control panel: advisory budget (the only
// place the % maths ever appears), prize creation, draw history +
// fulfilment. Frequency / % / floor / master flag live in /admin/settings.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-auth';

interface Budget {
  frequency: string;
  cycleDays: number;
  poolPercent: number;
  floorCents: number;
  windowRevenueCents: number;
  payingMembers: number;
  suggestedBudgetCents: number;
}
interface DrawRow {
  id: string;
  title: string;
  prizeValueCents: number;
  status: string;
  drawAt: string;
  drawnAt: string | null;
  entrantCount: number;
  fulfilmentNote: string | null;
  winner: { username: string | null } | null;
}
interface State {
  enabled: boolean;
  budget: Budget;
  draws: DrawRow[];
}

const rand = (c: number) => `R${(c / 100).toLocaleString('en-ZA')}`;

export default function AdminRafflePage() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Create form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    adminFetch('/admin/raffle')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setState)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function uploadPhoto(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await adminFetch('/admin/raffle/image', { method: 'POST', body: fd });
      const body = (await r.json().catch(() => null)) as { url?: string; message?: string } | null;
      if (!r.ok || !body?.url) throw new Error(body?.message ?? 'Upload failed');
      setImageUrl(body.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function createDraw() {
    setBusy(true);
    setError(null);
    try {
      const r = await adminFetch('/admin/raffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          prizeValueCents: Math.round(parseFloat(value || '0') * 100),
          imageUrls: imageUrl ? [imageUrl] : [],
        }),
      });
      const body = (await r.json().catch(() => null)) as { message?: string } | null;
      if (!r.ok) throw new Error(body?.message ?? 'Could not create the draw');
      setTitle('');
      setDescription('');
      setValue('');
      setImageUrl(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await adminFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      const body = (await r.json().catch(() => null)) as { message?: string } | null;
      if (!r.ok) throw new Error(body?.message ?? 'Action failed');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const b = state?.budget;
  const liveDraw = state?.draws.find((d) => d.status === 'LIVE');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          PRO Prize Draw
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Budget maths is advisory and internal — it never appears publicly.
          Master switch, frequency, pool % and floor are in Settings.
        </p>
      </div>

      {error && (
        <div className="rounded-[6px] px-4 py-3 text-sm" style={{ background: 'rgba(200,16,46,0.10)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {state && !state.enabled && (
        <div className="rounded-[6px] px-4 py-3 text-sm" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
          The draw is currently <strong>OFF</strong> (pro_draw_enabled). The
          public page shows a teaser; no draws will run.
        </div>
      )}

      {b && (
        <div className="rounded-[8px] p-4" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
          <p className="text-xs uppercase mb-2" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            Suggested budget for the next prize
          </p>
          <p className="text-2xl font-semibold m-0" style={{ color: 'var(--text-primary)' }}>
            {rand(b.suggestedBudgetCents)}
          </p>
          <p className="text-xs mt-2 m-0" style={{ color: 'var(--text-secondary)' }}>
            {b.poolPercent}% of {rand(b.windowRevenueCents)} subscription revenue
            over the last {b.cycleDays} days (floor {rand(b.floorCents)}, rounded
            up to R100). Paying PRO members right now: <strong>{b.payingMembers}</strong>.
            Frequency: <strong>{b.frequency}</strong>.
          </p>
        </div>
      )}

      {/* Create the next prize — only when nothing is currently on display. */}
      {state && !liveDraw && (
        <div className="rounded-[8px] p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
          <p className="text-sm font-medium m-0" style={{ color: 'var(--text-primary)' }}>
            Put the next prize on display
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Prize title (as displayed publicly)"
            className="w-full text-sm px-3 py-2 rounded-[6px]"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Public description of the prize"
            rows={3}
            className="w-full text-sm px-3 py-2 rounded-[6px]"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <input
            type="number"
            min={100}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Prize value in Rand (displayed publicly)"
            className="w-full text-sm px-3 py-2 rounded-[6px]"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadPhoto(f);
              }}
            />
            {uploading && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Uploading…</span>}
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="prize" style={{ height: 48, borderRadius: 6 }} />
            )}
          </div>
          <button
            type="button"
            disabled={busy || uploading}
            onClick={() => void createDraw()}
            className="text-sm px-4 py-2 rounded-[6px]"
            style={{ background: 'var(--red)', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            Go live (draw in one cycle)
          </button>
          <p className="text-xs m-0" style={{ color: 'var(--text-tertiary)' }}>
            The draw date is set automatically from the frequency setting. A
            live prize keeps its announced draw date — cancel it (with a
            reason) if you must replace it.
          </p>
        </div>
      )}

      {/* Draw history */}
      <div className="rounded-[8px] overflow-x-auto" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
              <th className="px-4 py-2 text-xs font-normal">Prize</th>
              <th className="px-4 py-2 text-xs font-normal">Value</th>
              <th className="px-4 py-2 text-xs font-normal">Status</th>
              <th className="px-4 py-2 text-xs font-normal">Draw</th>
              <th className="px-4 py-2 text-xs font-normal">Winner</th>
              <th className="px-4 py-2 text-xs font-normal">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(state?.draws ?? []).map((d) => (
              <tr key={d.id} style={{ borderTop: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}>
                <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>{d.title}</td>
                <td className="px-4 py-2">{rand(d.prizeValueCents)}</td>
                <td className="px-4 py-2">{d.status}</td>
                <td className="px-4 py-2">
                  {new Date(d.drawAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                  {d.status === 'DRAWN' || d.status === 'FULFILLED'
                    ? ` · ${d.entrantCount} entrants`
                    : ''}
                </td>
                <td className="px-4 py-2">{d.winner?.username ?? '—'}</td>
                <td className="px-4 py-2">
                  {/* Inline forms, not window.prompt: native prompts are
                      blocked in installed-PWA/standalone contexts and on iOS
                      read as a browser bug. The old cancel prompt also
                      silently did nothing on an empty reason (prompt returns
                      '' which is falsy), so the admin thought it had failed. */}
                  {d.status === 'DRAWN' && (
                    <DrawAction
                      label="Mark fulfilled"
                      placeholder="Fulfilment note (optional)"
                      confirmLabel="Save"
                      requireText={false}
                      busy={busy}
                      tone="primary"
                      onConfirm={(note) =>
                        act(`/admin/raffle/${d.id}/fulfil`, { note })
                      }
                    />
                  )}
                  {d.status === 'LIVE' && (
                    <DrawAction
                      label="Cancel"
                      placeholder="Reason for cancelling this draw"
                      confirmLabel="Confirm cancel"
                      requireText
                      busy={busy}
                      tone="secondary"
                      onConfirm={(reason) =>
                        act(`/admin/raffle/${d.id}/cancel`, { reason })
                      }
                    />
                  )}
                </td>
              </tr>
            ))}
            {state && state.draws.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-sm" colSpan={6} style={{ color: 'var(--text-tertiary)' }}>
                  No draws yet — put the first prize on display above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Expanding inline row action — replaces window.prompt for the two
// draw actions that need a note/reason. Collapsed it is a single button;
// expanded it is an input + confirm, with confirm disabled until the text
// rule is satisfied so an empty required reason can never silently no-op.
function DrawAction({
  label,
  placeholder,
  confirmLabel,
  requireText,
  busy,
  tone,
  onConfirm,
}: {
  label: string;
  placeholder: string;
  confirmLabel: string;
  /** Cancel needs a reason; fulfilment explicitly allows an empty note. */
  requireText: boolean;
  busy: boolean;
  tone: 'primary' | 'secondary';
  onConfirm: (text: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const primaryStyle =
    tone === 'primary'
      ? { background: 'var(--red)', color: '#fff', border: 'none' }
      : {
          background: 'transparent',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
        };

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded-[4px]"
        style={primaryStyle}
      >
        {label}
      </button>
    );
  }

  const ready = !requireText || text.trim().length > 0;

  return (
    <div className="flex items-center gap-1.5 min-w-[260px]">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 px-2 py-1 rounded-[4px] text-xs outline-none"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />
      <button
        type="button"
        disabled={busy || !ready}
        onClick={() => {
          void onConfirm(text.trim());
          setOpen(false);
          setText('');
        }}
        className="text-xs px-2 py-1 rounded-[4px] shrink-0"
        style={{
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          opacity: busy || !ready ? 0.5 : 1,
          cursor: busy || !ready ? 'not-allowed' : 'pointer',
        }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setText('');
        }}
        className="text-xs px-2 py-1 rounded-[4px] shrink-0"
        style={{
          background: 'transparent',
          border: '0.5px solid var(--border)',
          color: 'var(--text-tertiary)',
        }}
      >
        Back
      </button>
    </div>
  );
}
