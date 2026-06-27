import {
  addBusinessDays,
  estimateDeliveryDate,
  methodHasEstimate,
} from './delivery-estimate';

describe('delivery-estimate (P5.1)', () => {
  it('adds business days, skipping weekends', () => {
    // Fri 2026-06-26 + 1 business day = Mon 2026-06-29
    const fri = new Date('2026-06-26T09:00:00Z');
    expect(addBusinessDays(fri, 1).getUTCDate()).toBe(29);
    // Fri + 2 business days = Tue 2026-06-30
    expect(addBusinessDays(fri, 2).getUTCDate()).toBe(30);
  });

  it('counts only weekdays across a week', () => {
    // Mon 2026-06-22 + 5 business days = Mon 2026-06-29
    const mon = new Date('2026-06-22T09:00:00Z');
    const out = addBusinessDays(mon, 5);
    expect(out.getUTCDate()).toBe(29);
    expect(out.getUTCDay()).toBe(1); // Monday
  });

  it('estimates PUDO (5d) and TCG (4d) from dispatch', () => {
    const mon = new Date('2026-06-22T09:00:00Z');
    expect(estimateDeliveryDate('PUDO', mon)?.getUTCDate()).toBe(29); // +5 biz
    expect(estimateDeliveryDate('TCG', mon)?.getUTCDate()).toBe(26); // +4 biz → Fri 26th
  });

  it('returns null for methods with no platform-estimable transit', () => {
    const now = new Date('2026-06-22T09:00:00Z');
    expect(estimateDeliveryDate('PRIVATE_ARRANGE', now)).toBeNull();
    expect(estimateDeliveryDate('DEALER_TRANSFER', now)).toBeNull();
    expect(estimateDeliveryDate(null, now)).toBeNull();
    expect(estimateDeliveryDate(undefined, now)).toBeNull();
  });

  it('methodHasEstimate is true only for PUDO/TCG', () => {
    expect(methodHasEstimate('PUDO')).toBe(true);
    expect(methodHasEstimate('TCG')).toBe(true);
    expect(methodHasEstimate('PRIVATE_ARRANGE')).toBe(false);
    expect(methodHasEstimate(null)).toBe(false);
  });
});
