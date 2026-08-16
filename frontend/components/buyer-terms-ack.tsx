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
 * WHY A TICK AND NOT A LINE IN THE TERMS. CPA s49: a term that limits a
 * consumer's rights has to be in plain language, their attention must be drawn
 * to it specifically, and they must be given a chance to ask about it and then
 * assent. A clause buried in paragraph 5 of a policy nobody opened does not
 * meet that; this does. The Terms and Refund Policy links are rendered here
 * because the site footer is suppressed on /checkout/* — without them a buyer
 * on the payment screen has no route at all to the documents they are agreeing
 * to.
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

  const bullets: React.ReactNode[] = isCart
    ? []
    : variant === 'firearm'
      ? [
          <>
            <strong>The seller plans to book this into {location}.</strong> The
            dealer that actually holds it is confirmed after purchase.
          </>,
          <>
            Getting to the dealer, and any fee that dealer charges for
            receiving, storing or handing over the firearm, is yours — it
            isn&rsquo;t part of the price above and isn&rsquo;t refundable from
            us.
          </>,
          <>
            <strong>
              We don&rsquo;t refund an order because of where the dealer is or
              how far you have to travel.
            </strong>
          </>,
        ]
      : variant === 'collection'
        ? [
            <>
              <strong>This item is in {location}.</strong> You collect it from
              the seller, or send your own transporter. We don&rsquo;t arrange,
              quote or insure that transport.
            </>,
            <>
              Travel, fuel and transport costs are yours, and aren&rsquo;t part
              of the price above.
            </>,
            <>
              <strong>
                We don&rsquo;t refund an order because of where the item is or
                how far you have to travel to it.
              </strong>
            </>,
          ]
        : [
            <>
              <strong>This item ships from {location}.</strong>
            </>,
            <>
              <strong>
                We don&rsquo;t refund an order because of where the item is or
                how far it has to travel.
              </strong>{' '}
              Delivery times and costs are quoted above.
            </>,
          ];

  return (
    <div
      className="rounded-[10px] p-4 mb-4"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
      }}
    >
      <p
        className="text-[11px] uppercase mb-3"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.14em',
          fontWeight: 600,
        }}
      >
        Before you pay
      </p>

      <ul
        className="text-sm space-y-2 mb-4 pl-4"
        style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
      >
        {isCart ? (
          <>
            {items!.map((it) => (
              <li key={it.title} style={{ listStyle: 'disc' }}>
                {it.title} — ships from <strong>{it.location}</strong>
              </li>
            ))}
            <li style={{ listStyle: 'disc' }}>
              <strong>
                We don&rsquo;t refund an order because of where an item is or
                how far it has to travel.
              </strong>
            </li>
          </>
        ) : (
          bullets.map((b, i) => (
            <li key={i} style={{ listStyle: 'disc' }}>
              {b}
            </li>
          ))
        )}
        {/* Always last, and never omitted. The acknowledgement narrows ONE
            ground; saying so plainly is what keeps it a disclosure rather than
            a blanket waiver — and a blanket waiver would not survive CPA s51
            anyway. */}
        <li style={{ listStyle: 'disc' }}>
          Everything else still applies: if{' '}
          {isCart ? 'an item' : 'the item'} isn&rsquo;t what was listed, is
          damaged, or the seller never hands it over, you can still raise a
          dispute while your payment is held.
        </li>
      </ul>

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
          {variant === 'firearm' ? (
            <>
              I&rsquo;ve seen where this item transfers, and I understand I
              won&rsquo;t get a refund because of its location or the distance I
              have to travel.
            </>
          ) : isCart ? (
            <>
              I&rsquo;ve seen where these items are, and I understand I
              won&rsquo;t get a refund because of their location or the distance
              involved.
            </>
          ) : (
            <>
              I&rsquo;ve seen where this item is, and I understand I won&rsquo;t
              get a refund because of its location or the distance involved.
            </>
          )}
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
        . Not sure about something?{' '}
        <Link href="/support" style={{ color: 'var(--red)' }}>
          Ask us
        </Link>{' '}
        before you pay.
      </p>
    </div>
  );
}
