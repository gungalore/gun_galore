// Compact delivery & handover summary for the listing detail buy column.
//
// 2026-11-24 operator audit ("Bulk, clutter and order of importance"):
// the old block rendered one full card per handover method with a sentence of
// prose under each — roughly 180px of scrolling between the price and the buy
// button on a phone, and the buy button itself came AFTER it. Amazon/eBay/
// Takealot all put the buy box first and keep delivery to a compact, scannable
// block next to the CTA (see docs/history/UI-SALES-LAYOUT-AUDIT-2026-11.md).
//
// So: one bordered box, one row per offered route, no descriptions. The
// detail (rates, addresses, dealer paperwork) belongs at checkout or behind
// the one explanatory link; it does not belong between the buyer and Buy.

import type {
  ListingDeliveryEstimate,
  CollectionMode,
} from '@/lib/delivery-estimate';

export interface ListingDeliverySummaryProps {
  /** Raw `listing.shippingMethods` — order is normalised here, not by caller. */
  methods: string[];
  isFirearm: boolean;
  vicinity: string;
  estimate: ListingDeliveryEstimate;
  collectionMode: CollectionMode;
}

// Row model: label + the shortest honest hint that answers "how does it get
// to me / how do we meet". No sentences.
type Row = { label: string; hint: string };

function rowsFor({
  methods,
  isFirearm,
  vicinity,
  estimate,
  collectionMode,
}: ListingDeliverySummaryProps): Row[] {
  const rows: Row[] = [];
  const has = (m: string) => methods.includes(m);

  if (!isFirearm && (has('COURIER') || estimate?.kind === 'COURIER')) {
    rows.push({
      label: 'Courier delivery',
      hint:
        estimate?.kind === 'COURIER'
          ? `Est. ${estimate.minDays}–${estimate.maxDays} business days · rate at checkout`
          : 'Tracked door-to-door · rate at checkout',
    });
  }

  if (has('DEALER_TRANSFER')) {
    rows.push({
      label: 'Dealer transfer',
      hint: 'Licensed dealer to dealer',
    });
  }

  if (has('PRIVATE_ARRANGE')) {
    rows.push({
      label: isFirearm ? 'Arrange privately' : 'Meet in person',
      hint: isFirearm ? 'At a licensed dealer' : 'Arrange with the seller',
    });
  }

  if (has('COLLECTION') || estimate?.kind === 'COLLECTION') {
    // Honesty guard (see lib/delivery-estimate.ts): only the FREIGHT_OK case
    // may suggest the buyer is not the person who collects. IN_PERSON_ONLY is
    // the dangerous-goods case where nobody else may transport it.
    rows.push({
      label: 'Collection',
      hint:
        collectionMode === 'FREIGHT_OK'
          ? `${vicinity} · collect or send your own transporter`
          : vicinity,
    });
  }

  // De-duplicate (a legacy payload can carry both COLLECTION and the flag).
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.label)) return false;
    seen.add(r.label);
    return true;
  });
}

export function ListingDeliverySummary(props: ListingDeliverySummaryProps) {
  const rows = rowsFor(props);
  if (rows.length === 0) return null;

  return (
    <section
      aria-label="Delivery and handover"
      className="rounded-[6px] mb-4"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-visible)',
      }}
    >
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <p
          className="text-[11px] uppercase"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            fontWeight: 600,
          }}
        >
          Delivery &amp; handover
        </p>
        {props.isFirearm && (
          <a
            href="/members/regulated-items"
            className="text-[11px]"
            style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}
          >
            How it works
          </a>
        )}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
            style={{ borderTop: '0.5px solid var(--border-divider)' }}
          >
            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {row.label}
            </span>
            <span
              className="text-[11px] text-right"
              style={{ color: 'var(--text-tertiary)', lineHeight: 1.35 }}
            >
              {row.hint}
            </span>
          </li>
        ))}
      </ul>
      <p
        className="px-3 pb-2.5 text-[11px]"
        style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}
      >
        Chosen at checkout.
      </p>
    </section>
  );
}
