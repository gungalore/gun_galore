'use client';

import type {
  IntakeOwnedFirearm,
  MotivationOutputMode,
} from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE OWNED-FIREARMS STEP OPENS WITH WHAT THE FILE ALREADY HOLDS.
//
// ⚠️ IT IS A CORRECTION PANEL, NOT DECORATION. The interview is about to ask for
// Make / Model / Calibre / Serial for every firearm the applicant owns; the
// Document Vault has usually read those off a licence card already. Showing them
// first turns six blank boxes into six confirmations, and gives the member a
// reason to add the licence photo before typing anything.
//
// ⚠️ IT NEVER PUTS A FIREARM IN THE APPLICATION. This is a read-out of the
// server's `ownedFirearms`; only the card's answers are submitted. An empty list
// renders the "we have not found one yet" line and the count question below does
// the work.
// ────────────────────────────────────────────────────────────────────

/** The stored strings, joined in the order a licence card prints them. */
export function ownedFirearmLine(firearm: IntakeOwnedFirearm): string {
  const value = (part: string | undefined) => part?.trim() || '—';
  return [
    value(firearm.make),
    value(firearm.model),
    value(firearm.calibre),
    value(firearm.serial),
  ].join(' · ');
}

export default function OwnedFirearmsPanel({
  firearms,
  outputMode,
}: {
  /** What the server can already see, or undefined while/if it cannot. */
  firearms?: IntakeOwnedFirearm[] | null;
  outputMode?: MotivationOutputMode | null;
}) {
  const seen = (firearms ?? []).filter(
    (firearm) => firearm && typeof firearm.index === 'number',
  );
  return (
    <section
      aria-label="Firearms we can see on your documents"
      className="mt-4 rounded-xl border px-3 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)' }}
    >
      <p className="m-0 text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        Firearms we can see on your documents
      </p>

      {seen.length ? (
        <>
          <ul className="m-0 mt-1 list-none p-0 text-[12.5px] leading-5 text-[var(--text-secondary)]">
            {seen.map((firearm) => (
              <li key={firearm.index}>{ownedFirearmLine(firearm)}</li>
            ))}
          </ul>
          {/* ⚠️ SAID OUT LOUD: these are a read of their own vault, not ours. */}
          <p className="m-0 mt-1 text-[11.5px] leading-4 text-[var(--text-tertiary)]">
            from your Document Vault
          </p>
        </>
      ) : (
        <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          We haven&rsquo;t found a firearm licence in your documents yet. Tell us
          how many you own and we&rsquo;ll ask for the details.
        </p>
      )}

      <p className="m-0 mt-1 text-[11.5px] leading-4 text-[var(--text-tertiary)]">
        {outputMode === 'PRINT_READY'
          ? "For a print-ready pack we need a photo or scan of each firearm's licence — you can add them under Documents."
          : 'For a motivation-only draft these details are enough.'}
      </p>
    </section>
  );
}
