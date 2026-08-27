'use client';

// UX-4 — added-to-cart confirmation drawer.
//
// Mounted once at the root layout. Listens for the `gg:added-to-cart` event the
// AddToCartButton fires on a genuine add, then slides in: a right-side drawer on
// desktop, a bottom sheet on mobile. Shows the added item + cart subtotal, a
// "Go to Cart" CTA and "Continue shopping" dismiss, plus the existing cross-sell
// rail (highest-intent moment to surface "you might also need…").
//
// Presentation ONLY — it reads the cart via useCart() and never mutates it, so
// the checkout payload is untouched. Respects prefers-reduced-motion (Tailwind
// motion-reduce disables the slide). Closes on Esc, backdrop, dismiss, or route
// change.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useCart, type CartItem } from '@/lib/cart-store';
import { formatPrice } from '@/lib/utils';
import { CrossSellRow } from '@/components/cross-sell-row';
import { useScrollLock } from '@/lib/use-scroll-lock';

export function AddedToCartDrawer() {
  const [item, setItem] = useState<CartItem | null>(null);
  const [entered, setEntered] = useState(false);
  const pathname = usePathname();
  const items = useCart();

  // Lock the page behind the drawer while it's open.
  useScrollLock(!!item);

  // Open on the add event.
  useEffect(() => {
    function onAdded(e: Event) {
      const detail = (e as CustomEvent).detail as { item?: CartItem } | undefined;
      if (!detail?.item) return;
      setItem(detail.item);
      // Two frames so the off-screen → on-screen transform actually animates.
      requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    }
    window.addEventListener('gg:added-to-cart', onAdded);
    return () => window.removeEventListener('gg:added-to-cart', onAdded);
  }, []);

  // Escape closes the drawer while open.
  useEffect(() => {
    if (!item) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  // Close on navigation (e.g. tapping a cross-sell card or "Go to Cart").
  useEffect(() => {
    setEntered(false);
    setItem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function close() {
    setEntered(false);
    // Unmount after the slide-out (no-op delay under reduced motion).
    setTimeout(() => setItem(null), 220);
  }

  if (!item) return null;

  const count = items.length;
  const subtotal = items.reduce((sum, i) => sum + i.price, 0);
  const excludeIds = items.map((i) => i.listingId).join(',');

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        aria-hidden
        className="fixed inset-0 z-[70] transition-opacity duration-200 motion-reduce:transition-none"
        style={{ background: 'rgba(0,0,0,0.55)', opacity: entered ? 1 : 0 }}
      />
      {/* Panel — bottom sheet on mobile, right drawer on desktop */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Added to cart"
        className={[
          'fixed z-[71] bg-[var(--bg-card)] flex flex-col',
          'left-0 right-0 bottom-0 max-h-[85vh] rounded-t-[16px]',
          'md:left-auto md:top-0 md:right-0 md:bottom-0 md:h-full md:w-[400px] md:max-h-none md:rounded-none',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          entered
            ? 'translate-y-0 md:translate-x-0'
            : 'translate-y-full md:translate-y-0 md:translate-x-full',
        ].join(' ')}
        style={{ borderLeft: '0.5px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '0.5px solid var(--border)' }}
        >
          <span className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            Added to cart&nbsp;✓
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 20, lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Added item */}
          <div className="flex gap-3 items-start mb-4">
            <div
              style={{
                width: 64,
                height: 64,
                flexShrink: 0,
                borderRadius: 6,
                overflow: 'hidden',
                background: 'var(--bg-inset)',
                position: 'relative',
              }}
            >
              {item.imageUrl && (
                <Image src={item.imageUrl} alt="" fill sizes="64px" style={{ objectFit: 'cover' }} />
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p
                className="text-sm line-clamp-2"
                style={{ color: 'var(--text-primary)', fontWeight: 500, margin: 0 }}
              >
                {item.title}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--red)', fontWeight: 500 }}>
                {formatPrice(item.price)}
              </p>
            </div>
          </div>

          {/* Cart subtotal */}
          <div
            className="flex items-center justify-between text-sm mb-3 pb-3"
            style={{ borderBottom: '0.5px solid var(--border)' }}
          >
            <span style={{ color: 'var(--text-tertiary)' }}>
              Cart subtotal ({count} item{count === 1 ? '' : 's'})
            </span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {formatPrice(subtotal)}
            </span>
          </div>

          {/* CTAs */}
          <Link
            href="/cart"
            className="block w-full py-3 rounded-[6px] text-sm text-center mb-2"
            style={{ background: 'var(--red)', color: '#fff', fontWeight: 500, textDecoration: 'none' }}
          >
            Go to Cart
          </Link>
          <button
            type="button"
            onClick={close}
            className="block w-full py-2.5 rounded-[6px] text-sm text-center"
            style={{
              background: 'transparent',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Continue shopping
          </button>

          {/* Cross-sell — highest-intent moment. Self-hides when empty. */}
          <div className="mt-5">
            <CrossSellRow
              listingId={item.listingId}
              excludeIds={excludeIds}
              title="You might also need…"
            />
          </div>
        </div>
      </aside>
    </>
  );
}
