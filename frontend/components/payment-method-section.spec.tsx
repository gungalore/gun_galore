// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentMethodSection } from './payment-method-section';
import type { PaymentMethodOption } from '@/lib/payment-methods';

const peach: PaymentMethodOption = {
  provider: 'PEACH',
  label: 'Credit & Debit Card',
  description: 'Pay securely by card.',
};
const ozow: PaymentMethodOption = {
  provider: 'OZOW',
  label: 'Instant EFT',
  description: 'Pay from your bank.',
};

// Peach-only launch state: one enabled rail means there is nothing to choose,
// so the block renders NOTHING at all — the buyer only sees the Pay button.
// Peach's own hosted page offers the card/EFT options. Two rails get a review
// row plus a Change that expands the radio cards.
describe('PaymentMethodSection', () => {
  it('renders nothing when the backend returned no enabled rail', () => {
    const { container } = render(
      <PaymentMethodSection methods={[]} value={null} onChange={() => undefined} />,
    );
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText('Payment method')).toBeNull();
  });

  it('renders nothing for a single enabled rail (Peach-only: Pay only)', () => {
    const { container } = render(
      <PaymentMethodSection
        methods={[peach]}
        value="PEACH"
        onChange={() => undefined}
      />,
    );
    expect(container.textContent).toBe('');
    expect(screen.queryByText('Payment method')).toBeNull();
    expect(screen.queryByText('Credit & Debit Card')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('renders nothing for one rail even when read-only', () => {
    const { container } = render(
      <PaymentMethodSection
        methods={[peach]}
        value="PEACH"
        onChange={() => undefined}
        disabled
      />,
    );
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button', { name: /change/i })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows the selected rail and expands the radios on Change when 2+ exist', () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodSection
        methods={[ozow, peach]}
        value="OZOW"
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Instant EFT')).toBeInTheDocument();
    // Collapsed: the review row only.
    expect(screen.queryByRole('radio')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    expect(screen.getByRole('radio', { name: /Instant EFT/i })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Credit & Debit Card/i }));
    expect(onChange).toHaveBeenCalledWith('PEACH');
    // Choosing collapses back to the review row.
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
