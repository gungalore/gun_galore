import {
  inventoryEligible,
  resolvePurchaseQuantity,
  reversalListingData,
  isSoldOutAfterSale,
} from './inventory';

describe('inventory helpers (P8a)', () => {
  it('only plain BUY_NOW non-firearm is inventory-eligible', () => {
    expect(inventoryEligible('BUY_NOW', false)).toBe(true);
    expect(inventoryEligible('BUY_NOW', true)).toBe(false); // firearm
    expect(inventoryEligible('AUCTION', false)).toBe(false);
    expect(inventoryEligible('TAKE_A_SHOT', false)).toBe(false);
  });

  describe('resolvePurchaseQuantity', () => {
    it('non-tracked listings always resolve to 1 (ignores requested)', () => {
      expect(
        resolvePurchaseQuantity({ requested: 5, trackInventory: false, quantityAvailable: 1, quantityReserved: 0 }),
      ).toEqual({ quantity: 1 });
    });
    it('tracked: accepts a quantity within sellable stock', () => {
      expect(
        resolvePurchaseQuantity({ requested: 3, trackInventory: true, quantityAvailable: 5, quantityReserved: 1 }),
      ).toEqual({ quantity: 3 }); // sellable = 4
    });
    it('tracked: rejects more than sellable', () => {
      const r = resolvePurchaseQuantity({ requested: 5, trackInventory: true, quantityAvailable: 5, quantityReserved: 2 });
      expect('error' in r && r.error).toMatch(/Only 3 left/);
    });
    it('tracked: sold out', () => {
      const r = resolvePurchaseQuantity({ requested: 1, trackInventory: true, quantityAvailable: 2, quantityReserved: 2 });
      expect('error' in r && r.error).toMatch(/sold out/i);
    });
    it('tracked: rejects zero / negative / fractional', () => {
      expect('error' in resolvePurchaseQuantity({ requested: 0, trackInventory: true, quantityAvailable: 5, quantityReserved: 0 })).toBe(true);
      expect('error' in resolvePurchaseQuantity({ requested: -1, trackInventory: true, quantityAvailable: 5, quantityReserved: 0 })).toBe(true);
      // 2.5 floors to 2, which is valid
      expect(resolvePurchaseQuantity({ requested: 2.5, trackInventory: true, quantityAvailable: 5, quantityReserved: 0 })).toEqual({ quantity: 2 });
    });
  });

  describe('reversalListingData', () => {
    it('legacy listing → plain reactivation, no stock change', () => {
      expect(reversalListingData(false, 1)).toEqual({ status: 'ACTIVE', soldAt: null });
    });
    it('tracked listing → restocks the units', () => {
      expect(reversalListingData(true, 3)).toEqual({
        status: 'ACTIVE',
        soldAt: null,
        quantityAvailable: { increment: 3 },
      });
    });
  });

  describe('isSoldOutAfterSale', () => {
    it('true when the sale takes the last units', () => {
      expect(isSoldOutAfterSale({ quantityAvailable: 3, quantity: 3 })).toBe(true);
      expect(isSoldOutAfterSale({ quantityAvailable: 2, quantity: 3 })).toBe(true);
    });
    it('false when stock remains', () => {
      expect(isSoldOutAfterSale({ quantityAvailable: 5, quantity: 2 })).toBe(false);
    });
  });
});
