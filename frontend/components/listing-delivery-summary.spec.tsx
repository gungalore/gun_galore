// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListingDeliverySummary } from './listing-delivery-summary';

// ⚠️ THE TWO-OPTION TOGGLE, WITH THE SHARED LABELS. The old block listed four
// enum-flavoured labels ("Courier delivery", "Dealer transfer", "Meet in
// person", "Collection") as rows; the member now sees the legal pair and only
// the pair, named Courier / Private / Dealer Stock.
describe('ListingDeliverySummary', () => {
  it('offers goods Courier and Private as a two-option toggle', async () => {
    const user = userEvent.setup();
    render(
      <ListingDeliverySummary
        listingId="listing-1"
        shippingMethods={['COURIER', 'PRIVATE_ARRANGE']}
        isFirearm={false}
      />,
    );

    expect(screen.getByText('Delivery')).toBeTruthy();
    EXPECT_RADIO('Courier', true);
    EXPECT_RADIO('Private', false);
    expect(screen.queryByText('Dealer Stock')).toBeNull();
    expect(screen.queryByText('Meet in person')).toBeNull();
    expect(screen.queryByText('Arrange privately')).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Private' }));
    EXPECT_RADIO('Private', true);
    expect(screen.getByText("We'll use this at checkout.")).toBeTruthy();
  });

  it('offers firearms Dealer Stock and Private, never a courier', () => {
    render(
      <ListingDeliverySummary
        listingId="listing-2"
        shippingMethods={['DEALER_TRANSFER', 'PRIVATE_ARRANGE']}
        isFirearm
      />,
    );

    expect(screen.getByRole('radio', { name: 'Dealer Stock' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Private' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Courier' })).toBeNull();
    expect(screen.getByText('How it works')).toBeTruthy();
  });

  it('offers a collection-only item Private only', () => {
    render(
      <ListingDeliverySummary
        listingId="listing-3"
        shippingMethods={['COLLECTION']}
        isFirearm={false}
        collectionOnly
      />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(
      screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});

/** Small helper: aria-checked on the two-option toggle. */
function EXPECT_RADIO(label: string, checked: boolean) {
  expect(
    screen
      .getByRole('radio', { name: label })
      .getAttribute('aria-checked'),
  ).toBe(String(checked));
}
