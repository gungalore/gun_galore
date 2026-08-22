'use client';

import { useState } from 'react';
import type { LibraryItem } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// "I ALREADY GAVE YOU THAT."
//
// A firearm licence application is mostly the same paperwork as the last one.
// The ID copy never changes. The safe photographs never change until the safe
// does. Asking for them again on every application is asking somebody to
// re-photograph documents we are already holding — and it fills the system
// with duplicates of one page.
//
// So every requirement that the member can already answer offers the document
// they have. Picking one copies it across server-side: no upload, no camera,
// no second version of the same page to keep straight.
//
// ⚠️ IT DOES NOT APPEAR WHEN THERE IS NOTHING TO PICK. A dropdown reading
// "Choose a document…" over an empty list is a control that looks broken. The
// first application is meant to have upload work in it; the second is not.
// ────────────────────────────────────────────────────────────────────

export default function LibraryPicker({
  items,
  onPick,
  keeping,
  onTurnOn,
}: {
  /** Already narrowed to the requirement this sits under. */
  items: LibraryItem[];
  onPick: (item: LibraryItem, placeConfirmed: boolean) => Promise<void>;
  /**
   * Are we keeping this member's documents at all?
   *
   * ⚠️ FALSE IS NOT THE SAME AS AN EMPTY LIBRARY, and saying "nothing saved to
   * reuse yet" to somebody holding twelve documents they told us not to keep
   * is simply untrue.
   */
  keeping?: boolean;
  /** Open the consent window. Only used when `keeping` is false. */
  onTurnOn?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** The chosen safe photograph, held until the place tick is answered. */
  const [pending, setPending] = useState<LibraryItem | null>(null);

  // ⚠️ WHAT IS ALREADY ATTACHED HERE IS NOT A CHOICE. Offering it invites the
  // member to attach the same page twice — which is the duplicate problem
  // this control exists to remove, arriving through the control itself.
  const usable = items.filter((i) => !i.alreadyHere);

  // ⚠️ IT RENDERS EVEN WITH NOTHING IN IT, disabled and saying so.
  //
  // It used to return null when the library was empty, which is invisible —
  // and invisible is indistinguishable from never built. The operator asked
  // for this control three times while looking straight at the place it was
  // supposed to be, because on his account there was nothing to put in it.
  // A disabled select that says "nothing saved yet" answers the question the
  // absence could not.
  // ⚠️ A THIRD STATE, BETWEEN "NOTHING SAVED" AND A LIST. Somebody who
  // declined, or withdrew, has documents and has told us not to offer them —
  // so the honest control is neither an empty dropdown nor a full one, it is
  // the way back in.
  if (keeping === false) {
    return (
      <button
        type="button"
        onClick={onTurnOn}
        className="min-h-[44px] rounded border px-3 py-2 text-sm"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-inset)',
          color: 'var(--text-secondary)',
        }}
      >
        Turn on saved documents
      </button>
    );
  }

  if (usable.length === 0) {
    return (
      <select
        className="gg-datecell min-h-[44px] rounded border px-2 py-2 text-sm"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-inset)',
          color: 'var(--text-tertiary-on-card)',
        }}
        disabled
        value=""
        aria-label="Use a document you already have — nothing saved yet"
      >
        <option value="">Nothing saved to reuse yet</option>
      </select>
    );
  }

  return (
    <span className="inline-flex flex-col">
      <select
        className="gg-datecell min-h-[44px] rounded border px-2 py-2 text-sm"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-inset)',
          color: 'var(--text-primary)',
        }}
        disabled={busy}
        value=""
        aria-label="Use a document you already have"
        onChange={async (e) => {
          const chosen = usable.find(
            (i) => `${i.source}:${i.sourceId}` === e.target.value,
          );
          if (!chosen) return;
          // ⚠️ A SAFE PHOTOGRAPH WAITS FOR THE PLACE TICK. It is a photograph
          // of one safe at one dwelling, and somebody who has moved house
          // would otherwise attach pictures of their old wall without ever
          // being asked. The server refuses it too — this is the asking.
          if (chosen.askPlace) {
            setPending(chosen);
            setErr(null);
            return;
          }
          setBusy(true);
          setErr(null);
          try {
            await onPick(chosen, false);
          } catch {
            setErr('We could not attach that one.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="">
          {busy ? 'Attaching…' : 'Use one I already have…'}
        </option>
        {usable.map((i) => (
          <option key={`${i.source}:${i.sourceId}`} value={`${i.source}:${i.sourceId}`}>
            {i.title}
            {/* When it was added is how somebody tells this year's competency
                certificate from the one it replaced. */}
            {` — added ${i.addedOn}`}
          </option>
        ))}
      </select>

      {/* ⚠️ THE PLACE TICK, NOT A DATE. A safe photograph does not go stale
          with time; it goes wrong when the applicant moves house. There is no
          address stored against the picture to check it against, so it is
          asked. */}
      {pending && (
        <span className="mt-2 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3 text-xs">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              onChange={async (e) => {
                if (!e.target.checked) return;
                const chosen = pending;
                setPending(null);
                setBusy(true);
                try {
                  await onPick(chosen, true);
                } catch {
                  setErr('We could not attach that one.');
                } finally {
                  setBusy(false);
                }
              }}
            />
            <span>
              These are the safe at the address on this application.
            </span>
          </label>
          <button
            type="button"
            className="mt-2 underline text-[var(--text-tertiary)]"
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </span>
      )}

      {/* Warnings, never blocks. A four-month-old proof of address is still
          theirs to send; what must not happen is it going in silently and a
          DFO being the one to notice. */}
      {usable.some((i) => i.caution) && (
        <span className="mt-1 flex flex-col gap-1">
          {usable
            .filter((i) => i.caution)
            .map((i) => (
              <span
                key={`c-${i.source}:${i.sourceId}`}
                className="text-xs"
                style={{
                  color:
                    i.caution!.tone === 'stale'
                      ? 'var(--warning)'
                      : 'var(--text-tertiary)',
                }}
              >
                {i.caution!.text}
              </span>
            ))}
        </span>
      )}
      {err && <span className="mt-1 text-xs text-[var(--red)]">{err}</span>}
    </span>
  );
}
