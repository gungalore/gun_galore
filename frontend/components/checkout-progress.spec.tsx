// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckoutProgress } from './checkout-progress';

// Phase B — the honest two-step checkout indicator. There is no local payment
// step: the gateway hosts that page, so the rail goes straight from
// "Delivery & payment" to "Confirmation".
describe('CheckoutProgress', () => {
  it('renders exactly two steps and marks the first as current on checkout', () => {
    render(<CheckoutProgress current={1} />);

    const first = screen.getByText('Delivery & payment');
    const second = screen.getByText('Confirmation');
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first.getAttribute('aria-current')).toBe('step');
    expect(second.getAttribute('aria-current')).toBeNull();
    // No invented payment step.
    expect(screen.queryByText(/^payment$/i)).toBeNull();
  });

  it('marks the confirmation step as current on /checkout/complete', () => {
    render(<CheckoutProgress current={2} />);

    const first = screen.getByText('Delivery & payment');
    const second = screen.getByText('Confirmation');
    expect(second.getAttribute('aria-current')).toBe('step');
    expect(first.getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('navigation', { name: /checkout progress/i })).toBeTruthy();
  });
});
