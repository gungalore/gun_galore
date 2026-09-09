'use client';

import { useState } from 'react';
import { licenceCentreApi, type TokenGetter } from '@/lib/licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// TYPE IN WHAT THE SCAN COULD NOT READ.
//
// Operator, 2026-09-09: "If not all fields came through in a scan the scan must
// be rejected with the reason why everywhere on this website" — and, in the
// same breath, "givn an optio to manually type the mssing field".
//
// ⚠️ THE TWO HALVES SIT IN ONE PANEL ON PURPOSE. The reason and the fix are one
// thought; a rejection at the top of a card and a correction somewhere else is
// two screens for one problem, and the second one does not get found.
//
// ⚠️ AND IT ONLY EVER ASKS FOR WHAT IS MISSING. The server names the fields in
// `attention` / `readNotes`; this renders a box per name and sends only what
// was typed. Nothing here can overwrite a value the card already gave us.
// ────────────────────────────────────────────────────────────────────

/**
 * The fields a firearm licence always prints, and what a member calls them.
 *
 * ⚠️ MIRRORS MUST_READ IN credential-completeness.ts, and the server is the
 * authority. If the two drift, the server refuses a key this offers and the
 * box quietly does nothing — so a field added there must be added here.
 */
const LABELS: Record<string, string> = {
  licence_number: 'Licence number',
  holder_name: 'Name on the card',
  firearm_type: 'Type',
  make: 'Make',
  model: 'Model',
  calibre: 'Calibre',
  barrel_serial: 'Barrel serial number',
  frame_serial: 'Frame serial number',
  receiver_serial: 'Receiver serial number',
  section: 'Section it is licensed under',
};

/** Which fields the note named, in the order the server listed them. */
export function missingFrom(readNotes: readonly string[]): string[] {
  const note = readNotes.find((n) => n.startsWith('We could not read'));
  if (!note) return [];
  return Object.keys(LABELS).filter((k) =>
    note.toLowerCase().includes(LABELS[k].toLowerCase()),
  );
}

export default function MissingFields({
  id,
  fields,
  token,
  onSaved,
}: {
  id: string;
  fields: readonly string[];
  token: TokenGetter;
  onSaved: () => Promise<void> | void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = fields.filter((k) => (values[k] ?? '').trim());

  if (!fields.length) return null;

  return (
    <div className="mt-3 border-t border-[var(--border-divider)] pt-3">
      <p className="m-0 mb-2 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
        Type in what the card says. Where a part carries no number the card
        prints <strong>NONE</strong> — write that, exactly as it appears.
      </p>
      <div className="flex flex-col gap-2">
        {fields.map((k) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary-on-card)]">
              {LABELS[k] ?? k}
            </span>
            <input
              value={values[k] ?? ''}
              onChange={(e) =>
                setValues((v) => ({ ...v, [k]: e.target.value }))
              }
              className="min-h-[44px] w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-[10px] text-[14px] text-[var(--text-primary)]"
              placeholder="As printed on the card"
            />
          </label>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-[12px] text-[var(--red)]">{error}</p>
      ) : null}
      <button
        type="button"
        disabled={busy || !filled.length}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            /* Only what was typed. An empty box is a field they have not got
               to yet, not an instruction to blank anything. */
            await licenceCentreApi.correctDetails(
              token,
              id,
              Object.fromEntries(filled.map((k) => [k, values[k].trim()])),
            );
            setValues({});
            await onSaved();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : 'We could not save that just now.',
            );
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 min-h-[44px] w-full rounded-[var(--r-sm)] bg-[var(--red)] px-4 text-[13.5px] font-medium text-white disabled:opacity-50"
      >
        {busy
          ? 'Saving…'
          : filled.length === 1
            ? 'Save this one'
            : `Save these ${filled.length}`}
      </button>
    </div>
  );
}
