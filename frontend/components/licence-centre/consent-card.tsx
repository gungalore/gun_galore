'use client';

import MotivationSellerConsent from '@/components/motivation-seller-consent';

// ────────────────────────────────────────────────────────────────────
// THE SELLER'S CONSENT, ON A PRIVATE SALE.
//
// ⚠️ IT RENDERS UNDER THE SOURCE ROW AS A SECONDARY ACTION (2026-10-13). The
// route is no longer picked up front — it is read off whatever the member
// uploads — so this card is shown until the route is known to be a dealer sale.
// The consent link is the second way to settle it: the owner signs on their own
// phone, and the licence and their signed particulars come back into the
// application. A dealer handles their own side, so the card is hidden once we
// know it is a dealer purchase.
//
// ⚠️ THE CONSENT LINE IS THE POINT OF WRAPPING IT. The consent flow captures the
// seller's particulars, and the same data now prints as the seller's own signed
// page inside their link — an annexure in the pack, no longer a half of a form
// we generate. Intake plan §6.1.
//
// ⚠️ THE INNER PANEL IS IMPORTED, NOT REBUILT. It owns the invite, the
// read-back of the signature and the firearm snapshot, all of which are
// tested where they live. This adds the framing and the one line about the
// signature, and nothing else — Phase 4 moves the file, it does not rewrite it.
// ────────────────────────────────────────────────────────────────────

export interface ConsentCardProps {
  motivationId: string;
  applicantName: string;
  firearm: Record<string, string | undefined>;
  /** True once the seller has actually signed. Drives the consent line. */
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
          ? 'Signed. Their signed page and consent go into your pack as an annexure.'
          : 'When they sign, their signed page and consent go into your pack as an annexure.'}
      </p>
    </div>
  );
}
