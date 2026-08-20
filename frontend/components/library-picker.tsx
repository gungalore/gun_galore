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
}: {
  /** Already narrowed to the requirement this sits under. */
  items: LibraryItem[];
  onPick: (item: LibraryItem) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ⚠️ WHAT IS ALREADY ATTACHED HERE IS NOT A CHOICE. Offering it invites the
  // member to attach the same page twice — which is the duplicate problem
  // this control exists to remove, arriving through the control itself.
  const usable = items.filter((i) => !i.alreadyHere);
  if (usable.length === 0) return null;

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
          setBusy(true);
          setErr(null);
          try {
            await onPick(chosen);
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
      {err && <span className="mt-1 text-xs text-[var(--red)]">{err}</span>}
    </span>
  );
}
