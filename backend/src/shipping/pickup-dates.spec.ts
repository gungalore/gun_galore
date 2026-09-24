import {
  collectionMinDate,
  nextPickupDay,
  pickupDeadline,
  pickupInstant,
  soonestPickupDate,
  daysBetween,
} from './pickup-dates';

// Weekday reference for the fixed instants below (all 2026):
//   Wed 23 Sep · Thu 24 Sep · Fri 25 Sep · Sat 26 · Sun 27 · Mon 28 · Tue 29

describe('pickup-dates (SAST, business days)', () => {
  describe('soonestPickupDate', () => {
    it('before the cut-off → the next day', () => {
      const wed = new Date('2026-09-23T09:00:00+02:00');
      expect(soonestPickupDate(wed)).toEqual({
        iso: '2026-09-24',
        weekday: 'Thursday',
      });
    });

    it('at/after the cut-off → the day after', () => {
      const wed = new Date('2026-09-23T14:00:00+02:00');
      expect(soonestPickupDate(wed).iso).toBe('2026-09-25'); // Friday
    });

    it('uses SAST, not the server clock (14:30 SAST is "after")', () => {
      const instant = new Date('2026-09-23T12:30:00Z'); // 14:30 SAST
      expect(soonestPickupDate(instant).iso).toBe('2026-09-25');
    });

    it('Friday → Monday, before or after the cut-off', () => {
      const friAm = new Date('2026-09-25T09:00:00+02:00');
      const friPm = new Date('2026-09-25T15:00:00+02:00');
      expect(soonestPickupDate(friAm)).toEqual({
        iso: '2026-09-28',
        weekday: 'Monday',
      });
      expect(soonestPickupDate(friPm).iso).toBe('2026-09-28');
    });

    it('Thursday PM rolls over the weekend to Monday', () => {
      const thuPm = new Date('2026-09-24T15:00:00+02:00');
      expect(soonestPickupDate(thuPm).iso).toBe('2026-09-28');
    });
  });

  describe('nextPickupDay', () => {
    it('steps one business day', () => {
      expect(
        nextPickupDay({ iso: '2026-09-28', weekday: 'Monday' }).iso,
      ).toBe('2026-09-29');
    });

    it('skips the weekend from a Friday', () => {
      expect(
        nextPickupDay({ iso: '2026-09-25', weekday: 'Friday' }).iso,
      ).toBe('2026-09-28');
    });
  });

  describe('pickupDeadline (Pargo payout clock)', () => {
    it('is the end of the next day when that day is a weekday', () => {
      const ready = new Date('2026-09-23T10:00:00+02:00'); // Wed
      expect(pickupDeadline(ready)).toEqual({
        iso: '2026-09-24',
        weekday: 'Thursday',
      });
    });

    it('rolls to Monday when the next day is a weekend', () => {
      const ready = new Date('2026-09-25T10:00:00+02:00'); // Fri
      expect(pickupDeadline(ready).iso).toBe('2026-09-28'); // Monday
    });
  });

  describe('wire values', () => {
    it('builds the Bob Go collection_min_date', () => {
      expect(collectionMinDate({ iso: '2026-09-24', weekday: 'Thursday' })).toBe(
        '2026-09-24T08:00:00+02:00',
      );
    });

    it('builds a real instant for collectionNotBeforeAt', () => {
      const d = pickupInstant({ iso: '2026-09-24', weekday: 'Thursday' });
      expect(d.toISOString()).toBe('2026-09-24T06:00:00.000Z'); // 08:00 SAST
    });
  });

  describe('daysBetween', () => {
    it('counts calendar days across a weekend', () => {
      expect(
        daysBetween(
          { iso: '2026-09-25', weekday: 'Friday' },
          { iso: '2026-09-28', weekday: 'Monday' },
        ),
      ).toBe(3);
    });
  });
});
