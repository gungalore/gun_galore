// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckoutSummary } from './checkout-summary';
import { formatPrice } from '@/lib/utils';

// Phase B — the sticky order summary. Presentational: totals come from the
// host's previewBreakdown(), and the CTA is ONE component shared with the
// mobile bar so both always agree about whether the buyer can pay.

// formatPrice groups thousands with a non-breaking space; testing-library's
// text normaliser turns it into a plain space, so match the normalised form.
const priceText = (cents: number) => formatPrice(cents).replace(/\u00a0/g, ' ');

const ITEM = {
  imageUrl: null,
  title: 'Match saver',
  meta: 'Good · Shooting accessories',
  sellerUsername: 'seller',
  quantity: 1,
  priceCents: 100_000,
};

function renderSummary(overrides: Partial<Parameters<typeof CheckoutSummary>[0]> = {}) {
  const props = {
    item: ITEM,
    itemsCents: 100_000,
    delivery: { value: formatPrice(15_000), muted: false },
    platformFeeCents: 12_000,
    totalCents: 127_000,
    needsAddress: false,
    ready: true,
    onSelectAddress: vi.fn(),
    onPay: vi.fn(),
    ...overrides,
  };
  render(<CheckoutSummary {...props} />);
  return props;
}

describe('CheckoutSummary', () => {
  it('renders the item, seller and the Items / Delivery / Platform Fee / Total rows', () => {
    renderSummary();

    expect(screen.getByText('Item for delivery')).toBeTruthy();
    expect(screen.getByText('Match saver')).toBeTruthy();
    expect(screen.getByText(/Sold by/)).toBeTruthy();
    expect(screen.getByText('seller')).toBeTruthy();

    expect(screen.getByText('Items')).toBeTruthy();
    expect(screen.getByText('Delivery')).toBeTruthy();
    expect(screen.getByText('Platform Fee')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getAllByText(priceText(100_000)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(priceText(15_000)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(priceText(12_000)).length).toBeGreaterThan(0);
    expect(screen.getByText(priceText(127_000))).toBeTruthy();
  });

  it('shows "Select Delivery Address" and opens the drawer when the courier has no address', () => {
    const onSelectAddress = vi.fn();
    const onPay = vi.fn();
    renderSummary({ needsAddress: true, ready: false, onSelectAddress, onPay });

    const cta = screen.getByRole('button', {
      name: /select delivery address/i,
    });
    // It is an ACTION, not a dead disabled button.
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cta);
    expect(onSelectAddress).toHaveBeenCalledTimes(1);
    expect(onPay).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^pay /i })).toBeNull();
  });

  it('shows a disabled "Pay R X" with the plain-language reason when not ready', () => {
    renderSummary({
      ready: false,
      blockedReason: 'Choose a delivery option above to continue.',
    });

    const cta = screen.getByRole('button', { name: `Pay ${formatPrice(127_000)}` });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText('Choose a delivery option above to continue.'),
    ).toBeTruthy();
  });

  it('calls onPay from the enabled "Pay R X" CTA when the order is ready', () => {
    const onPay = vi.fn();
    renderSummary({ onPay });

    const cta = screen.getByRole('button', { name: `Pay ${formatPrice(127_000)}` });
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cta);
    expect(onPay).toHaveBeenCalledTimes(1);
  });
});
