'use client';

// ────────────────────────────────────────────────────────────────────
// WHAT YOU HAVE ALREADY GIVEN US, ON THE STEP THAT ASKED FOR IT.
//
// ⚠️ THE REBUILT WIZARD HAD NO LIST OF ATTACHED DOCUMENTS ANYWHERE.
// capture-cards.tsx is a camera and a file picker and nothing else — it does
// not know what is attached — so a member who photographed the wrong page, or
// filed their proof of address as their ID, had no way to see it and no way to
// undo it. removeUpload, refileUpload, rereadUpload and uploadBlobUrl all
// existed on the API with zero call sites in the new tree.
//
// The old page solved this with one long checklist carrying every requirement
// and its controls. The rebuilt design puts the question on the step that asks
// it, so this is the same controls in the new shape: under the capture cards,
// showing only the kinds THIS step is about.
//
// ⚠️ FOUR ACTIONS, AND THEY ARE NOT INTERCHANGEABLE.
//   View     open it, so "attached" can be checked rather than believed
//   Read again  the OCR failed; try it once more before typing by hand
//   Change type it IS a document, we filed it on the wrong line
//   Remove   it should not be in the pack at all
//
// Removing a document to re-upload it under the right name is the gesture
// "Change type" exists to prevent: it costs the member a photograph and costs
// us a second vision call for a document we have already read.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { PickableKind, UploadRow } from '@/lib/motivations-api';

export default function AttachedDocuments({
  documents,
  kinds,
  pickable,
  busyId,
  onView,
  onRemove,
  onReread,
  onRefile,
}: {
  documents: UploadRow[];
  /** The kinds this step asks for. Anything else belongs to another step. */
  kinds: readonly string[];
  /** Every kind a document may be refiled as. */
  pickable: PickableKind[];
  busyId?: string | null;
  onView: (id: string) => void;
  onRemove: (id: string) => void;
  onReread: (id: string) => void;
  onRefile: (id: string, kind: string) => void;
}) {
  const [refiling, setRefiling] = useState<string | null>(null);

  const mine = documents.filter((d) => kinds.includes(d.kind));
  if (!mine.length) return null;

  return (
    <div className="max-w-[560px]">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
        {mine.length === 1 ? 'Attached' : `Attached · ${mine.length}`}
      </p>

      <ul className="space-y-1.5">
        {mine.map((d) => {
          const busy = busyId === d.id;
          return (
            <li
              key={d.id}
              className="gg-tile rounded-[8px] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5"
              style={busy ? { opacity: 0.55 } : undefined}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[13.5px] font-medium">{d.label}</span>
                {d.annexure && (
                  <span className="text-[11.5px] text-[var(--text-tertiary)]">
                    Annexure {d.annexure}
                  </span>
                )}
                {/* ⚠️ THE BYTES CAN OUTLIVE NOTHING AND THE ROW CAN OUTLIVE
                    THE BYTES. A purged document still lists — it is a record
                    that it was submitted — but must not offer a View that
                    would fail after the member taps it. */}
                {!d.available && (
                  <span className="text-[11.5px] text-[var(--text-tertiary)]">
                    no longer stored
                  </span>
                )}
              </div>

              {/* Amber, not red. "We could not read this" is not a rejection
                  — the document may be perfectly good and simply hard to
                  photograph, and the member can still type the values. */}
              {d.suspect && (
                <p
                  className="mt-1 text-[11.5px]"
                  style={{ color: 'var(--gold-strong)' }}
                >
                  We could not read what this type of document usually carries.
                  Read it again, or change its type if we filed it wrong.
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12.5px]">
                {d.available && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onView(d.id)}
                    className="underline underline-offset-2 text-[var(--text-secondary)]"
                  >
                    View
                  </button>
                )}
                {d.available && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onReread(d.id)}
                    className="underline underline-offset-2 text-[var(--text-secondary)]"
                  >
                    Read again
                  </button>
                )}
                {d.available && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setRefiling((cur) => (cur === d.id ? null : d.id))
                    }
                    className="underline underline-offset-2 text-[var(--text-secondary)]"
                  >
                    Change type
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(d.id)}
                  className="underline underline-offset-2"
                  style={{ color: 'var(--red)' }}
                >
                  Remove
                </button>
              </div>

              {refiling === d.id && (
                <div className="mt-2">
                  <label className="block text-[11.5px] text-[var(--text-tertiary)]">
                    File it as
                  </label>
                  <select
                    defaultValue={d.kind}
                    disabled={busy}
                    onChange={(e) => {
                      const next = e.target.value;
                      setRefiling(null);
                      // ⚠️ NO-OP ON THE SAME KIND. Refiling a document as
                      // what it already is costs a round trip and, on the
                      // server, re-runs the extraction — a paid call to learn
                      // nothing.
                      if (next && next !== d.kind) onRefile(d.id, next);
                    }}
                    className="mt-1 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-[13px]"
                  >
                    {pickable.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
