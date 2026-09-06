'use client';

// ────────────────────────────────────────────────────────────────────
// "YOU ALREADY HAVE SOME OF THESE."
//
// A section 16 pack repeats itself: the dedicated status and the letter of
// good standing describe the PERSON, not the firearm, so the ones from the
// last application are still the right documents — provided the letter has not
// gone stale, which the server checks before it offers them. The endorsement
// is deliberately never here: it names one firearm, so a previous one
// describes the wrong gun.
//
// Lifted out of the wizard on 2026-09-06 with no behaviour change.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { LibraryItem, MotivationApiError } from '@/lib/motivations-api';

export default function SuggestedDocuments({
  suggested,
  dismissed,
  needsPlaceConfirm,
  onAttach,
  onDone,
  onDismiss,
  onConfirmPlace,
}: {
  /** Empty is the normal case on a first application. */
  suggested: LibraryItem[];
  /** They have attached them, or said not now. The offer does not come back. */
  dismissed: boolean;
  /** The server held the safe photographs back pending the place tick. */
  needsPlaceConfirm: boolean;
  onAttach: (item: LibraryItem, placeConfirmed: boolean) => Promise<void>;
  /** Every one attached. */
  onDone: () => void;
  /** "Not now" — put the offer away without attaching anything. */
  onDismiss: () => void;
  /** Re-run the automatic attach, this time with the place confirmed. */
  onConfirmPlace: () => void;
}) {
  const [busy, setBusy] = useState(false);
  /** Named failures, on the panel, instead of a swallowed rejection. */
  const [errs, setErrs] = useState<string[]>([]);
  /** "These are the safe at the address on this application." */
  const [place, setPlace] = useState(false);

  return (
    <>
      {suggested.length > 0 && !dismissed && (
        <div className="mt-3 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3">
          <p className="text-sm font-medium">
            You already have {suggested.length === 1 ? 'one' : suggested.length}{' '}
            of these
          </p>
          <ul className="mt-1 space-y-1 text-xs text-[var(--text-secondary)]">
            {suggested.map((sg) => (
              <li key={`${sg.source}:${sg.sourceId}`}>
                <span>
                  {sg.title} — added {sg.addedOn}
                </span>
                {/* ⚠️ THE CAUTION WAS COMPUTED, SHIPPED, AND DROPPED ON THE
                    FLOOR. The whole point of `caution` is that a proof of
                    address four months old is still theirs to send and may
                    have a reason — what must never happen is it going in
                    SILENTLY and a DFO being the one to notice. One tap
                    attaching everything with the warnings invisible is the
                    exact failure it was written to prevent. */}
                {sg.caution && (
                  <span
                    className="block"
                    style={{
                      color:
                        sg.caution.tone === 'stale'
                          ? 'var(--warning)'
                          : 'var(--text-tertiary-on-card)',
                    }}
                  >
                    {sg.caution.text}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* ⚠️ THE PLACE TICK, THE SAME QUESTION LibraryPicker ASKS. The
              one-tap path passed placeConfirmed=false for everything, so a
              safe photograph in this list could only ever be refused by the
              server — quietly, since the rejection was swallowed too. */}
          {suggested.some((sg) => sg.askPlace) && (
            <label className="mt-2 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5"
                checked={place}
                onChange={(e) => setPlace(e.target.checked)}
              />
              <span>
                These are the safe at the address on this application.
              </span>
            </label>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                busy ||
                (suggested.some((sg) => sg.askPlace) && !place)
              }
              className="min-h-[44px] rounded bg-[var(--red)] px-4 py-2 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
              onClick={async () => {
                // ⚠️ THE PANEL STAYS UP UNTIL EVERY ONE IS ATTACHED. It used
                // to set `suggestDone` FIRST and then swallow every
                // rejection, so a failure took the panel, the list and any
                // way of retrying with it — and the member was left believing
                // documents were on their application that were not.
                //
                // ⚠️ SEQUENTIAL, like every other upload path here: each
                // attach counts the existing rows against the cap and writes
                // a new one, so firing them together lets several see the
                // same count and slip past it.
                setBusy(true);
                setErrs([]);
                const failed: string[] = [];
                for (const sg of suggested) {
                  try {
                    await onAttach(sg, sg.askPlace ? place : false);
                  } catch (ex) {
                    failed.push(
                      `${sg.title}: ${
                        ex instanceof MotivationApiError
                          ? ex.message
                          : 'could not be attached'
                      }`,
                    );
                  }
                }
                setErrs(failed);
                if (!failed.length) onDone();
                setBusy(false);
              }}
            >
              {busy
                ? 'Attaching…'
                : `Attach ${suggested.length === 1 ? 'it' : 'them'}`}
            </button>
            <button
              type="button"
              className="min-h-[44px] rounded border border-[var(--border)] px-4 py-2 text-sm"
              onClick={onDismiss}
            >
              Not now
            </button>
          </div>
          {errs.length > 0 && (
            <ul role="alert" className="mt-2 space-y-1 text-xs text-[var(--red)]">
              {errs.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* M6 — the server held the safe photographs back. Ask, then re-run. */}
      {needsPlaceConfirm && (
        <div className="mt-3 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3">
          <p className="text-sm font-medium">
            One more thing before we add your safe photographs
          </p>
          <label className="mt-2 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5"
              onChange={(e) => {
                if (!e.target.checked) return;
                onConfirmPlace();
              }}
            />
            <span>
              My safe photographs are at the same address as this application.
            </span>
          </label>
        </div>
      )}
    </>
  );
}
