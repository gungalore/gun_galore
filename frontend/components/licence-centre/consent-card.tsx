'use client';

import MotivationSellerConsent from '@/components/motivation-seller-consent';

// ────────────────────────────────────────────────────────────────────
// THE SELLER'S CONSENT, ON A PRIVATE SALE.
//
// ⚠️ IT RENDERS UNDER THE SOURCE ROW AND ONLY ON A PRIVATE SALE. A dealer
// completes Part F and their own SAPS 350(a); an estate is the executor's.
// Showing this card on either route would be asking somebody to chase a
// signature nobody needs.
//
// ⚠️ THE PART F LINE IS THE POINT OF WRAPPING IT. The consent flow already
// captures every box of section F 81-87, and until now the seller signed a
// consent letter while the F page went to the DFO blank. The same data now
// prints as the seller's own page inside their link, so they sign both on
// their phone and the pack arrives complete — intake plan §6.1.
//
// ⚠️ THE INNER PANEL IS IMPORTED, NOT REBUILT. It owns the invite, the
// read-back of the signature and the firearm snapshot, all of which are
// tested where they live. This adds the framing and the one line about F, and
// nothing else — Phase 4 moves the file, it does not rewrite it.
// ────────────────────────────────────────────────────────────────────

export interface ConsentCardProps {
  motivationId: string;
  applicantName: string;
  firearm: Record<string, string | undefined>;
  /** True once the seller has actually signed. Drives the Part F line. */
  signed: boolean;
  onAdopt?: (fields: Record<string, string>) => void;
  /** The seller answered while the page was open. Reload the application. */
  onArrived?: (status: 'COMPLETED' | 'DECLINED') => void;
}

export default function ConsentCard({
  motivationId,
  applicantName,
  firearm,
  signed,
  onAdopt,
  onArrived,
}: ConsentCardProps) {
  return (
    <div className="gg-tile my-[10px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[14px] py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        The current owner
      </div>

      <MotivationSellerConsent
        motivationId={motivationId}
        applicantName={applicantName}
        firearm={firearm}
        onAdopt={onAdopt}
        onArrived={onArrived}
      />

      {/*
        ⚠️ TWO STATES, AND NEITHER OF THEM IS A TASK FOR THE APPLICANT. Before
        the signature this says what will happen; after it, what did. The
        applicant cannot make the seller sign any faster by being nagged, and
        an amber "outstanding" chip here would be blaming them for somebody
        else's inbox.
      */}
      <p
        className={`m-0 mt-[10px] text-[12.5px] leading-[1.4] ${
          signed ? 'text-[var(--success)]' : 'text-[var(--text-tertiary)]'
        }`}
      >
        {signed
          ? 'Signed. Part F of your SAPS 271 is filled in from what the seller gave us, and their signed page goes in the pack.'
          : 'When they sign, Part F of your SAPS 271 fills in from what they give us — they sign the form page and the consent together.'}
      </p>
    </div>
  );
}
