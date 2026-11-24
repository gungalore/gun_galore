// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListingDeliverySummary } from './listing-delivery-summary';

describe('ListingDeliverySummary', () => {
  it('renders courier + in-person as compact rows with no prose', () => {
    render(
      <ListingDeliverySummary
        methods={['COURIER', 'PRIVATE_ARRANGE']}
        isFirearm={false}
        vicinity="Kraaifontein, Western Cape"
        estimate={{ kind: 'COURIER', minDays: 2, maxDays: 10 }}
        collectionMode={null}
      />,
    );

    expect(screen.getByText('Delivery & handover')).toBeTruthy();
    expect(screen.getByText('Courier delivery')).toBeTruthy();
    expect(screen.getByText(/2–10 business days/)).toBeTruthy();
    expect(screen.getByText('Meet in person')).toBeTruthy();
    expect(screen.getByText('Arrange with the seller')).toBeTruthy();
    expect(screen.getByText('Chosen at checkout.')).toBeTruthy();
    // The old block carried a sentence per method; the audit removed them.
    expect(screen.queryByText(/tracked\. The live courier rate/i)).toBeNull();
    expect(screen.queryByText(/payment is held until you confirm/i)).toBeNull();
  });

  it('renders firearm handover as dealer transfer + arrange privately, with the guide link', () => {
    render(
      <ListingDeliverySummary
        methods={['DEALER_TRANSFER', 'PRIVATE_ARRANGE']}
        isFirearm
        vicinity="Gauteng"
        estimate={{ kind: 'FIREARM' }}
        collectionMode={null}
      />,
    );

    expect(screen.getByText('Dealer transfer')).toBeTruthy();
    expect(screen.getByText('Licensed dealer to dealer')).toBeTruthy();
    expect(screen.getByText('Arrange privately')).toBeTruthy();
    expect(screen.getByText('At a licensed dealer')).toBeTruthy();
    expect(screen.getByText('How it works')).toBeTruthy();
    // Firearms never get a courier row.
    expect(screen.queryByText('Courier delivery')).toBeNull();
  });

  it('only invites a transporter when the collection mode allows it', () => {
    const base = {
      methods: ['COLLECTION'],
      isFirearm: false,
      vicinity: 'Durban, KwaZulu-Natal',
      estimate: { kind: 'COLLECTION' } as const,
    };
    const { rerender } = render(
      <ListingDeliverySummary {...base} collectionMode="IN_PERSON_ONLY" />,
    );
    expect(screen.queryByText(/send your own transporter/i)).toBeNull();

    rerender(<ListingDeliverySummary {...base} collectionMode="FREIGHT_OK" />);
    expect(screen.getByText(/send your own transporter/i)).toBeTruthy();
  });

  it('renders nothing when no route is offered', () => {
    const { container } = render(
      <ListingDeliverySummary
        methods={[]}
        isFirearm={false}
        vicinity="Cape Town"
        estimate={null}
        collectionMode={null}
      />,
    );
    expect(container.innerHTML).not.toContain('Delivery & handover');
  });
});
