'use client';

// Marketplace settings editor — one widget per flag, grouped by
// `group`. Each flag tracks its draft value locally; Save fires a
// PATCH with a required reason. Dirty rows get a red dot + a Save
// button; clean rows are quiet.
//
// Type-driven widget selection:
//   - boolean  → checkbox
//   - number   → number input
//   - percent  → number input with 0..1 hint
//   - text     → textarea
//
// Danger flags (`danger: true` in the backend FLAGS registry) are the
// go-live switches — they change what the public sees, spend real
// money, or turn a safety net off. They used to render identically to
// harmless tuning knobs, so one stray checkbox click plus "asd" in the
// reason box could ship a module. They now get a red rail, a
// "go-live switch" chip, a longer required reason, and a type-the-key
// confirmation before Save unlocks.

import { useState } from 'react';
import { adminFetch } from '@/lib/admin-auth';

interface Flag {
  key: string;
  label: string;
  hint: string;
  group: string;
  type: 'boolean' | 'number' | 'text' | 'percent';
  default: string;
  currentValue: string;
  // Optional because the flag list is parsed straight from the API and
  // ordinary knobs simply omit it (backend: SettingFlag.danger).
  danger?: boolean;
}

// Mirrors REASON_MIN / DANGER_REASON_MIN in
// backend/src/admin/admin-settings.service.ts. Kept in sync by hand so
// the operator is blocked in the UI rather than by a surprise 400.
const REASON_MIN = 3;
const DANGER_REASON_MIN = 15;

const AMBER = '#f59e0b';

export default function SettingsEditor({ flags }: { flags: Flag[] }) {
  // Group by `group` so the page renders sections (Moderation, …).
  const groups = new Map<string, Flag[]>();
  for (const f of flags) {
    const list = groups.get(f.group) ?? [];
    list.push(f);
    groups.set(f.group, list);
  }

  if (flags.length === 0) {
    return (
      <div
        className="rounded-[8px] p-6 text-center"
        style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Could not load settings.
        </p>
      </div>
    );
  }

  const anyDanger = flags.some((f) => f.danger);
  const anyOffDefault = flags.some((f) => f.currentValue !== f.default);

  return (
    <div className="space-y-6">
      {/* Legend for the two row markers, so a red rail or an amber chip
          isn't decoration the operator has to decode. Only rendered
          when there's something to explain. */}
      {(anyDanger || anyOffDefault) && (
        <div
          className="rounded-[8px] px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs"
          style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
        >
          {anyDanger && (
            <span className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 3,
                  height: 14,
                  background: 'var(--red)',
                  borderRadius: 1,
                }}
              />
              Go-live switch — changes what the public sees or what the
              business spends. Needs the flag key typed to confirm.
            </span>
          )}
          {anyOffDefault && (
            <span className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(245,158,11,0.12)',
                  color: AMBER,
                  border: `0.5px solid ${AMBER}`,
                }}
              >
                off default
              </span>
              Live value differs from the shipped default.
            </span>
          )}
        </div>
      )}

      {Array.from(groups.entries()).map(([groupName, items]) => (
        <div key={groupName}>
          <p
            className="text-xs uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {groupName}
          </p>
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            {items.map((f, i) => (
              <FlagRow
                key={f.key}
                flag={f}
                last={i === items.length - 1}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FlagRow({ flag, last }: { flag: Flag; last: boolean }) {
  const [value, setValue] = useState(flag.currentValue);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // What the SERVER currently holds, as far as this row knows. Dirty state
  // used to compare against flag.currentValue, which is parent-fetched state
  // that router.refresh() never re-runs (the parent is a client component) —
  // so every successful save left the red "unsaved" dot on and the ✓ tick
  // (gated on !dirty) never appeared, leaving the operator unsure whether the
  // change took. Tracking the saved value locally makes both honest.
  const [savedValue, setSavedValue] = useState(flag.currentValue);
  // Danger rows only: the operator must retype the flag key. Muscle
  // memory can tick a checkbox and type a three-letter reason; it
  // cannot accidentally type "deal_po_email_enabled".
  const [confirmKey, setConfirmKey] = useState('');

  const isDanger = !!flag.danger;
  const dirty = value !== savedValue;
  // Compare the PERSISTED value against the shipped default, not the
  // draft — this chip answers "is prod running something non-standard
  // right now?", which is the question you have mid-incident.
  const offDefault = savedValue !== flag.default;
  const reasonMin = isDanger ? DANGER_REASON_MIN : REASON_MIN;
  const confirmOk = !isDanger || confirmKey.trim() === flag.key;
  const canSave =
    dirty && reason.trim().length >= reasonMin && confirmOk && !busy;

  async function save() {
    // Belt-and-braces: the button is disabled, but never let a stale
    // render fire a go-live write without the typed confirmation.
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await adminFetch(`/admin/settings/${flag.key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      setSaved(true);
      setReason('');
      setConfirmKey('');
      // The server now holds this value — advance the baseline so the row
      // reads "saved" and Revert rolls back to the persisted value.
      setSavedValue(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    outline: 'none',
  };

  return (
    <div
      className="px-4 py-3"
      style={{
        ...(last ? null : { borderBottom: '0.5px solid var(--border)' }),
        // Red rail down the left of every go-live switch. paddingLeft
        // drops to 13 so the 3px rail lands flush with the px-4 (16px)
        // gutter of the ordinary rows above and below it.
        ...(isDanger
          ? {
              borderLeft: '3px solid var(--red)',
              paddingLeft: 13,
              background: 'rgba(239,68,68,0.04)',
            }
          : null),
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium flex items-center gap-2 flex-wrap"
            style={{ color: 'var(--text-primary)' }}
          >
            {flag.label}
            {isDanger && (
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(239,68,68,0.12)',
                  color: 'var(--red)',
                  border: '0.5px solid var(--red)',
                }}
                title="Changing this changes what the public sees or what the business spends. Requires typed confirmation."
              >
                go-live switch
              </span>
            )}
            {offDefault && (
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(245,158,11,0.12)',
                  color: AMBER,
                  border: `0.5px solid ${AMBER}`,
                }}
                title={`Live value differs from the shipped default (${flag.default || '(empty)'})`}
              >
                off default
              </span>
            )}
            {dirty && (
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: 'var(--red)' }}
                title="Unsaved changes"
              />
            )}
            {saved && !dirty && (
              <span
                className="text-xs"
                style={{ color: '#22c55e' }}
              >
                ✓ saved
              </span>
            )}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {flag.hint}
          </p>
          <p
            className="text-xs mt-1"
            style={{
              color: 'var(--text-tertiary)',
              fontFamily: 'monospace',
            }}
          >
            {flag.key} · default: {flag.default || '(empty)'}
            {/* Spell out the live value when it has drifted off the
                default, so the amber chip is self-explaining rather
                than sending the operator back to the audit log. */}
            {offDefault && (
              <>
                {' · '}
                <span style={{ color: AMBER }}>
                  live: {savedValue || '(empty)'}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="shrink-0" style={{ minWidth: 240, maxWidth: 320 }}>
          {flag.type === 'boolean' ? (
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={value === 'true'}
                onChange={(e) => setValue(e.target.checked ? 'true' : 'false')}
                style={{ accentColor: 'var(--red)' }}
              />
              <span>{value === 'true' ? 'Enabled' : 'Disabled'}</span>
            </label>
          ) : flag.type === 'number' || flag.type === 'percent' ? (
            <input
              type="number"
              step={flag.type === 'percent' ? 0.01 : 1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={inputStyle}
            />
          ) : (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          )}
        </div>
      </div>

      {/* Danger confirmation. Only shown once the value actually
          changed — an untouched go-live switch shouldn't nag. The typed
          key is the gate: canSave stays false until it matches exactly,
          so Save cannot be reached by tabbing through. */}
      {dirty && isDanger && (
        <div
          className="mt-3 rounded-[6px] p-3"
          style={{
            background: 'rgba(239,68,68,0.06)',
            border: '0.5px solid var(--red)',
          }}
        >
          <p className="text-xs" style={{ color: 'var(--red)', fontWeight: 500 }}>
            Go-live switch — {flag.label} will be{' '}
            {flag.type === 'boolean'
              ? value === 'true'
                ? 'TURNED ON'
                : 'TURNED OFF'
              : `set to "${value || '(empty)'}"`}{' '}
            for everyone, immediately.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Type{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {flag.key}
            </span>{' '}
            to confirm.
          </p>
          <input
            value={confirmKey}
            onChange={(e) => setConfirmKey(e.target.value)}
            placeholder={flag.key}
            autoComplete="off"
            spellCheck={false}
            className="mt-2"
            style={{
              ...inputStyle,
              fontFamily: 'monospace',
              borderColor: confirmOk ? '#22c55e' : 'var(--red)',
            }}
          />
        </div>
      )}

      {dirty && (
        <div className="mt-3 flex gap-2 items-end">
          <div className="flex-1">
            <label
              className="text-xs block mb-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Reason (≥{reasonMin} chars, audit log)
              {isDanger && ' — go-live switches need a real explanation'}
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this changing?"
              style={inputStyle}
            />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="px-3 py-1.5 rounded text-sm font-medium"
            // Say WHY Save is dead rather than leaving a greyed button
            // the operator pokes at — the two gates are the reason
            // length and (danger only) the typed key.
            title={
              canSave
                ? undefined
                : !confirmOk
                  ? `Type ${flag.key} to confirm this go-live switch`
                  : reason.trim().length < reasonMin
                    ? `Reason must be at least ${reasonMin} characters`
                    : undefined
            }
            style={{
              background: canSave ? 'var(--red)' : 'var(--bg-inset)',
              color: canSave ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Saving…' : isDanger ? 'Save go-live change' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              // Revert to what the server holds — NOT flag.currentValue, which
              // is the pre-save value after a save and would silently roll the
              // operator back past a change they just made.
              setValue(savedValue);
              setReason('');
              setConfirmKey('');
              setError(null);
            }}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm"
            style={{
              background: 'transparent',
              color: 'var(--text-tertiary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Revert
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
