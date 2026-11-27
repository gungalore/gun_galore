import { describe, expect, it } from 'vitest';
import {
  deliveryClassFor,
  deliveryLabel,
  methodsForItem,
} from './delivery-methods';

// ⚠️ ONE VOCABULARY: Courier / Private / Dealer Stock. The enum on the wire is
// untouched; only the member's labels are unified (meet-in-person, arrange
// privately and collection-only are all Private; dealer transfer is Dealer
// Stock).
describe('deliveryLabel', () => {
  it('names the three routes the member sees', () => {
    expect(deliveryLabel('COURIER')).toBe('Courier');
    expect(deliveryLabel('PRIVATE_ARRANGE')).toBe('Private');
    expect(deliveryLabel('COLLECTION')).toBe('Private');
    expect(deliveryLabel('DEALER_TRANSFER')).toBe('Dealer Stock');
  });

  it('maps the deprecated spellings to the same three labels', () => {
    expect(deliveryLabel('MEET_IN_PERSON')).toBe('Private');
    expect(deliveryLabel('ARRANGE_PRIVATELY')).toBe('Private');
    expect(deliveryLabel('COLLECTION_ONLY')).toBe('Private');
    expect(deliveryLabel('DEALER')).toBe('Dealer Stock');
  });

  it('humanises anything new rather than printing an enum', () => {
    expect(deliveryLabel('DRONE_DROP')).toBe('Drone Drop');
    expect(deliveryLabel('')).toBe('Private');
  });
});

describe('deliveryClassFor', () => {
  it('splits firearms from goods', () => {
    expect(deliveryClassFor({ isFirearm: true })).toBe('FIREARM');
    expect(deliveryClassFor({ isFirearm: false })).toBe('GOODS');
    expect(deliveryClassFor({})).toBe('GOODS');
  });
});

describe('methodsForItem', () => {
  it('offers goods Courier and Private', () => {
    expect(methodsForItem({}).map((option) => option.label)).toEqual([
      'Courier',
      'Private',
    ]);
    expect(methodsForItem({}).map((option) => option.method)).toEqual([
      'COURIER',
      'PRIVATE_ARRANGE',
    ]);
  });

  it('offers firearms Dealer Stock and Private, never a courier', () => {
    const options = methodsForItem({ isFirearm: true });
    expect(options.map((option) => option.label)).toEqual([
      'Dealer Stock',
      'Private',
    ]);
    expect(options.map((option) => option.method)).toEqual([
      'DEALER_TRANSFER',
      'PRIVATE_ARRANGE',
    ]);
  });

  it('makes a collection-only item Private only', () => {
    const options = methodsForItem({
      isFirearm: true,
      collectionOnly: true,
      shippingMethods: ['COLLECTION'],
    });
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('Private');
    expect(options[0].method).toBe('COLLECTION');
  });

  it("narrows to the server's list and never widens it", () => {
    expect(
      methodsForItem({ shippingMethods: ['COURIER'] }).map((o) => o.method),
    ).toEqual(['COURIER']);
    expect(
      methodsForItem({ isFirearm: true, shippingMethods: ['PRIVATE_ARRANGE'] })
        .map((o) => o.method),
    ).toEqual(['PRIVATE_ARRANGE']);
  });

  it('de-duplicates two enum values that read the same', () => {
    const options = methodsForItem({
      shippingMethods: ['PRIVATE_ARRANGE', 'COLLECTION'],
    });
    expect(options).toHaveLength(1);
    expect(options[0].method).toBe('PRIVATE_ARRANGE');
  });
});
