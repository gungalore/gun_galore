// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AuctionOdometer } from './auction-odometer';
import { formatPrice } from '@/lib/utils';

// ────────────────────────────────────────────────────────────────────
// Audit L8 — ON THE ONE SURFACE WHERE THE NUMBER IS THE WHOLE POINT.
//
// Every digit of the price was aria-hidden and the live region contained only
// the words "Current bid" and "rand", so a screen reader heard the price
// change as "Current bid rand". The visual roll must stay hidden (a per-digit
// roll read out digit by digit is noise), but exactly one sr-only phrase has
// to carry the real amount.
// ────────────────────────────────────────────────────────────────────

describe('auction odometer price announcement', () => {
  it('announces the real amount in the polite live region', () => {
    const { container } = render(
      <AuctionOdometer amountCents={850_000} bidCount={3} endTime={null} />,
    );

    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(`Current bid ${formatPrice(850_000)}`);
  });

  it('does not round a cent-bearing hammer for the eye or the ear', () => {
    const { container } = render(
      <AuctionOdometer amountCents={850_050} bidCount={1} endTime={null} />,
    );

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      `Current bid ${formatPrice(850_050)}`,
    );
    // The visual digits are the same formatted amount, minus the "R " prefix
    // that is rendered as its own span.
    expect(container.querySelector('.odo-price')?.textContent).toContain(
      formatPrice(850_050).replace(/^R\s/, ''),
    );
  });

  it('keeps every visual digit out of the accessibility tree', () => {
    const { container } = render(
      <AuctionOdometer amountCents={850_000} bidCount={2} endTime={null} />,
    );

    const price = container.querySelector('.odo-price');
    expect(price?.getAttribute('aria-hidden')).toBe('true');
    // One live phrase, not one announcement per digit.
    expect(container.querySelectorAll('.odo-slot').length).toBeGreaterThan(1);
  });
});
