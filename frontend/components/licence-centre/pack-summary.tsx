'use client';

import Saps271Meter from '@/components/licence-pack/saps271-meter';
import type { Saps271Coverage } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// "YOUR PACK" — the 271's completeness, and what to take to the DFO.
//
// ⚠️ THE F ROW READS "dealer" OR "seller", NEVER A PERCENTAGE. Part F is the
// CURRENT OWNER's half of the form. On a dealer sale it is deliberately left
// blank for them; on a private sale it fills from the seller's own signed
// consent. Either way it is not the applicant's work, and scoring it against
// them says they are behind on something that was never theirs.
//
// ⚠️ AND THIS SECTION IS NOT A CHIP CLOUD. The screen it replaces ended with
// "15 answers still to give" as fifteen unlinked chips and "5 documents still
// needed" as five more, none of which went anywhere. The one number that
// matters is already in the strip and the footer; this is the list a member
// prints and carries.
// ────────────────────────────────────────────────────────────────────

export interface PackSummaryProps {
  coverage: Saps271Coverage;
  licenceType: string;
  /** Which route Part F takes, from `firearm_source`. */
  sourceRoute: 'dealer' | 'seller' | 'estate' | 'unstated';
  /** What SAPS wants, by tier — the take-to-SAPS list. */
  needs: { kind: string; label: string; tier: string; have: boolean }[];
}

const F_LINE: Record<PackSummaryProps['sourceRoute'], string> = {
  dealer:
    'Part F is left for your dealer — they complete it with their own SAPS 350(a).',
  seller:
    'Part F fills in from the current owner’s signed consent, and their page goes in the pack.',
  estate:
    'An estate firearm uses its own block on the form, which the executor completes by hand.',
  unstated:
    'Tell us where the firearm is coming from and we will say who completes Part F.',
};

export default function PackSummary({
  coverage,
  licenceType,
  sourceRoute,
  needs,
}: PackSummaryProps) {
  const isRenewal = licenceType === 'S24_RENEWAL';

  return (
    <div>
      {/*
        ⚠️ NO 271 ON A RENEWAL, AND THE METER ALREADY KNOWS. A section 24 is
        lodged on the SAPS 518(a) and the backend refuses to render a 271 for
        one; the meter takes the licence type so it does not name a form this
        application does not use.
      */}
      <Saps271Meter coverage={coverage} licenceType={licenceType} />

      {!isRenewal ? (
        <p className="m-0 mt-2 text-[12.5px] leading-[1.4] text-[var(--gold-strong)]">
          {F_LINE[sourceRoute]}
        </p>
      ) : (
        <p className="m-0 mt-2 text-[12.5px] leading-[1.4] text-[var(--text-tertiary)]">
          A renewal is lodged on the SAPS 518(a), not the 271. Your motivation
          goes with it as it stands.
        </p>
      )}

      {needs.length ? (
        <div className="mt-4">
          <p className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
            Take these with you
          </p>
          <ul className="m-0 list-none p-0">
            {needs.map((n) => (
              <li
                key={n.kind}
                className="flex items-start gap-[10px] border-b border-[var(--border-divider)] py-[10px] text-[13.5px] leading-[1.35] last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={`mt-[3px] h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border ${
                    n.have
                      ? 'border-[var(--success)] bg-[var(--success)]'
                      : 'border-[var(--border-hover)]'
                  }`}
                />
                <span
                  className={
                    n.have
                      ? 'text-[var(--text-tertiary)] line-through'
                      : 'text-[var(--text-primary)]'
                  }
                >
                  {n.label}
                  {/*
                    ⚠️ 'expected' IS NOT 'optional'. The tier exists because a
                    document with no statute behind it can still stop an
                    application at the counter; calling it optional sends
                    somebody to a DFO to be turned away.
                  */}
                  {n.tier === 'expected' && !n.have ? (
                    <span className="ml-[6px] text-[11px] text-[var(--gold-strong)]">
                      they will ask for this
                    </span>
                  ) : null}
                  {n.tier === 'strengthens' && !n.have ? (
                    <span className="ml-[6px] text-[11px] text-[var(--text-tertiary)]">
                      helps, not required
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
