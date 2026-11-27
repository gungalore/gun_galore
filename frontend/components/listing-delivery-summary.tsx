'use client';

// Compact delivery & handover picker for the listing detail buy column.
//
// ⚠️ THE ITEM'S LEGAL PAIR, AS A TWO-OPTION TOGGLE. Goods are Courier/Private;
// firearms are Dealer Stock/Private; a collection-only item is Private only. The
// old block listed enum-flavoured labels ("Dealer transfer", "Meet in person",
// "Collection") side by side, which read as four different things and not as
// two choices. The labels come from lib/delivery-methods.ts, the same module
// checkout and the sell form use.
//
// The pick is remembered for this visit (lib/delivery-choice.ts) so the
// single-item checkout opens on it; the cart keeps its own per-group routing.

import { useEffect, useMemo, useState } from 'react';
import { methodsForItem } from '@/lib/delivery-methods';
import {
  getSavedDeliveryChoice,
  saveDeliveryChoice,
} from '@/lib/delivery-choice';

export interface ListingDeliverySummaryProps {
  listingId: string;
  /** Raw `listing.shippingMethods`. */
  shippingMethods: string[];
  isFirearm: boolean;
  collectionOnly?: boolean;
}

export function ListingDeliverySummary({
  listingId,
  shippingMethods,
  isFirearm,
  collectionOnly,
}: ListingDeliverySummaryProps) {
  const options = useMemo(
    () => methodsForItem({ isFirearm, shippingMethods, collectionOnly }),
    // Keying on the joined array keeps the memo stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isFirearm, collectionOnly, (shippingMethods ?? []).join(',')],
  );
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const saved = getSavedDeliveryChoice(listingId);
    const pick =
      saved && options.some((option) => option.method === saved)
        ? saved
        : options[0]?.method ?? null;
    setSelected(pick);
  }, [listingId, options]);

  if (!options.length) return null;

  const choose = (method: string) => {
    setSelected(method);
    saveDeliveryChoice(listingId, method);
  };

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
          Delivery
        </p>
        {isFirearm && (
          <a
            href="/members/regulated-items"
            className="text-[11px]"
            style={{
              color: 'var(--text-secondary)',
              textDecoration: 'underline',
            }}
          >
            How it works
          </a>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Delivery method"
        className="grid grid-cols-2 gap-2 px-3 pb-2"
      >
        {options.map((option) => {
          const active = selected === option.method;
          return (
            <button
              key={option.method}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(option.method)}
              title={option.description}
              className="rounded-[6px] px-2.5 py-2 text-center text-[12.5px]"
              style={{
                background: active ? 'var(--red-wash)' : 'var(--bg-inset)',
                border: `1px solid ${active ? 'var(--red)' : 'var(--border)'}`,
                color: 'var(--text-primary)',
                fontWeight: active ? 600 : 500,
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p
        className="px-3 pb-2.5 text-[11px]"
        style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}
      >
        We&apos;ll use this at checkout.
      </p>
    </section>
  );
}
