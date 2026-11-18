'use client';

// ────────────────────────────────────────────────────────────────────
// "WHAT SAPS NEEDS" — what the pack carries, and what to take in person.
//
// ⚠️ NO FORM AND NO COMPLETENESS METER. We no longer generate the SAPS 271, so
// this card stopped scoring a document that does not exist. What is left is
// what the member actually acts on: the pack holds the motivation and a copy
// of every document we hold, and the blanks are the originals they carry to
// the counter.
//
// ⚠️ AND A TICK MEANS "COPY IN YOUR PACK", NOT "NOTHING TO DO". Every document
// we hold is printed into the pack as an annexure — so a ticked row is a job
// we have done and an ORIGINAL the applicant still has to carry. Read the
// other way it is how somebody arrives at a DFO without their competency
// certificate.
// ────────────────────────────────────────────────────────────────────

export interface PackSummaryProps {
  licenceType: string;
  /** What SAPS wants, by tier — the take-to-SAPS list. */
  needs: { kind: string; label: string; tier: string; have: boolean }[];
  /**
   * How many answers are still outstanding on the sheet above this.
   *
   * The header count is the one to act on, so while it is above zero this card
   * says so rather than describing a pack that cannot be generated yet.
   */
  outstanding?: number;
}

export default function PackSummary({
  licenceType,
  needs,
  outstanding,
}: PackSummaryProps) {
  const isRenewal = licenceType === 'S24_RENEWAL';
  const waiting = (outstanding ?? 0) > 0;

  return (
    <div>
      <p className="m-0 text-[13.5px] leading-[1.45] text-[var(--text-secondary)]">
        Your pack is your motivation, with a copy of every document we hold
        printed behind it as a lettered annexure.{' '}
        {isRenewal
          ? 'A renewal is lodged on the SAPS 518(a) your DFO issues — the motivation goes with it as it stands.'
          : 'The application form itself is the blank your DFO gives you; it must be signed in front of them, not beforehand.'}
      </p>

      {waiting ? (
        <p className="m-0 mt-2 text-[13px] leading-[1.45] text-[var(--gold-strong)]">
          {outstanding === 1
            ? 'One answer is still outstanding above.'
            : `${outstanding} answers are still outstanding above.`}{' '}
          Finish those before you generate the pack.
        </p>
      ) : null}

      {needs.length ? (
        <div className="mt-4">
          <p className="m-0 mb-1 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
            What to take to the DFO
          </p>
          <p className="m-0 mb-2 text-[12.5px] leading-[1.4] text-[var(--text-secondary)]">
            We print a copy of everything we hold into your pack. Take the
            originals with you — the DFO will want to see them.
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
                <span className="text-[var(--text-primary)]">
                  {n.label}
                  {n.have ? (
                    <span className="ml-[6px] text-[11px] text-[var(--success)]">
                      copy in your pack — bring the original
                    </span>
                  ) : null}
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
