// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrintDelivery from './print-delivery';
import { motivationsApi } from '@/lib/motivations-api';

vi.mock('@/components/saved-address-picker', () => ({
  SavedAddressPicker: () => null,
}));

vi.mock('@/lib/motivations-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/motivations-api')>();
  return {
    ...actual,
    motivationsApi: {
      ...actual.motivationsApi,
      printQuote: vi.fn(async () => ({
        motivationCents: 29_500,
        printFeeCents: 7_500,
        shippingCents: 5_000,
        totalCents: 42_000,
        serviceName: 'Door to door',
        deliveryDaysMin: 1,
        deliveryDaysMax: 2,
      })),
    },
  };
});

const token = async () => 't';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response),
  );
});

describe('Print and Deliver', () => {
  it('offers Print / Download and Print and Deliver (R75)', () => {
    render(
      <PrintDelivery
        motivationId="mo-1"
        token={token}
        baseCents={29_500}
        feeCents={7_500}
        mode="DIGITAL"
        locked={false}
        onModeChange={vi.fn()}
        onSelection={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Print \/ Download/i })).toBeDefined();
    expect(
      screen.getByRole('button', { name: /Print and Deliver/i }),
    ).toBeDefined();
    expect(screen.getByText(/R 75/)).toBeDefined();
  });

  it('asks the server to switch the mode', async () => {
    const onModeChange = vi.fn();
    render(
      <PrintDelivery
        motivationId="mo-1"
        token={token}
        baseCents={29_500}
        feeCents={7_500}
        mode="DIGITAL"
        locked={false}
        onModeChange={onModeChange}
        onSelection={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Print and Deliver/i }));
    expect(onModeChange).toHaveBeenCalledWith('DELIVER');
  });

  it('publishes the single-payment total to the pack page', async () => {
    const onSelection = vi.fn();
    render(
      <PrintDelivery
        motivationId="mo-1"
        token={token}
        baseCents={29_500}
        feeCents={7_500}
        mode="DIGITAL"
        locked={false}
        onModeChange={vi.fn()}
        onSelection={onSelection}
      />,
    );
    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'DIGITAL', totalCents: 29_500 }),
      ),
    );
  });

  it('shows the address fields once delivery is chosen', () => {
    render(
      <PrintDelivery
        motivationId="mo-1"
        token={token}
        baseCents={29_500}
        feeCents={7_500}
        mode="DELIVER"
        locked={false}
        onModeChange={vi.fn()}
        onSelection={vi.fn()}
      />,
    );
    expect(screen.getByText('Delivery address')).toBeDefined();
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });
});
