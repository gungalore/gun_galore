'use client';

import Link from 'next/link';
// vicinityLabel lives in a PLAIN module, not here: this file is 'use client',
// and Server Components (the product page, the offer-checkout page) call it
// during render. Importing a function out of a client module and invoking it
// on the server throws at runtime with an opaque Next.js digest.
/**
 * The buyer's pre-payment acknowledgement: they have seen where the item is,
 * and location or travel distance is not a refund ground.
 *
 * ONE component, imported by every payment surface (single-item checkout, offer
 * checkout, cart). Not copy-pasted: the offer checkout already carries two
 * duplicated consent blocks that have drifted from the originals, which is the
 * codebase's own written record of what copy-pasting consent costs.
 *
 * WHY JUST ONE SENTENCE. The detail — cancellation deductions, what location
 * means for collection, and the full refund rules — lives in the Terms of
 * Service (§9, §11) and the Refund & Dispute Policy (§5). They already state
 * that location and distance are not refund grounds and what a cancellation
 * costs. Checkout keeps only the specific acknowledgement CPA s49 requires:
 * the buyer's attention is drawn to the term that narrows their rights, and
 * they affirm it, rather than re-reading a policy summary as bullets.
 *
 * The wording is versioned server-side (REFUND_TERMS_VERSION) and the vicinity
 * string is snapshotted onto the transaction, so a dispute can reconstruct
 * exactly what this buyer was shown. Change the copy here and bump that
 * constant, or every dispute after the change points at wording nobody saw.
 */

export type AckVariant = 'collection' | 'firearm' | 'courier';


interface Props {
  variant: AckVariant;
  /** The exact vicinity string — must match what the server snapshots. */
  location: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Cart view: one tick over several items, each with its own town. */
  items?: { title: string; location: string }[];
}

export function BuyerTermsAck({
  variant,
  location,
  checked,
  onChange,
  items,
}: Props) {
  const isCart = !!items?.length;
  const where = isCart
    ? 'these items are'
    : variant === 'firearm'
      ? 'this item transfers'
      : 'this item is';

  return (
    <div
      className="rounded-[10px] p-4 mb-4"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
      }}
    >
      <label
        className="flex items-start gap-3 cursor-pointer select-none"
        style={{ color: 'var(--text-primary)' }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1"
          style={{ accentColor: 'var(--red)', width: 16, height: 16 }}
        />
        <span className="text-sm" style={{ lineHeight: 1.5 }}>
          I&rsquo;ve seen where {where}
          {!isCart && location ? (
            <>
              {' '}
              (<strong>{location}</strong>)
            </>
          ) : null}{' '}
          and I understand that its location and the distance to it are not
          grounds for a refund or a dispute.
        </span>
      </label>

      <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
        Full detail:{' '}
        <Link href="/refund-policy" style={{ color: 'var(--red)' }}>
          Refund &amp; Dispute Policy
        </Link>
        {' · '}
        <Link href="/terms" style={{ color: 'var(--red)' }}>
          Terms of Service
        </Link>
        {variant === 'firearm' && (
          <>
            {' · '}
            <Link
              href="/members/regulated-items"
              style={{ color: 'var(--red)' }}
            >
              Regulated Items Annex
            </Link>
          </>
        )}
        .
      </p>
    </div>
  );
}
