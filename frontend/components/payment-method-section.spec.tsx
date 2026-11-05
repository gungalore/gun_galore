// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentMethodSection } from './payment-method-section';
import type { PaymentMethodOption } from '@/lib/payment-methods';

const ozow: PaymentMethodOption = {
  provider: 'OZOW',
  label: 'Instant EFT',
  description: 'Pay from your bank.',
};
const peach: PaymentMethodOption = {
  provider: 'PEACH',
  label: 'Card',
  description: 'Pay by card.',
};

describe('PaymentMethodSection', () => {
  it('renders only the enabled rails', () => {
    render(
      <PaymentMethodSection
        methods={[ozow]}
        value="OZOW"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText('Instant EFT')).toBeInTheDocument();
    expect(screen.queryByText('Card')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it('marks the buyer choice and reports a change', () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodSection
        methods={[ozow, peach]}
        value="OZOW"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: /Instant EFT/i })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Card/i }));
    expect(onChange).toHaveBeenCalledWith('PEACH');
  });
});
