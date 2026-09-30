import {
  looksLikeSerial,
  normaliseChipList,
  normaliseNumeric,
  normaliseSingleValue,
  sanitisePostDetails,
} from './feed.types';

describe('feed detail-field helpers', () => {
  describe('normaliseChipList', () => {
    it('keeps only allowed values, lowercased and hyphenated, deduped and capped', () => {
      const allowed = ['bass', 'carp', 'blue-wildebeest'];
      expect(
        normaliseChipList([' Bass ', 'BASS', 'Carp', 'shark', 'Blue Wildebeest'], allowed),
      ).toEqual(['bass', 'carp', 'blue-wildebeest']);
    });

    it('returns [] for non-arrays', () => {
      expect(normaliseChipList('bass', ['bass'])).toEqual([]);
      expect(normaliseChipList(undefined, ['bass'])).toEqual([]);
    });
  });

  describe('normaliseSingleValue', () => {
    it('accepts only known values', () => {
      expect(normaliseSingleValue(' Rifle ', ['rifle', 'shotgun'])).toBe('rifle');
      expect(normaliseSingleValue('bazooka', ['rifle'])).toBeNull();
      expect(normaliseSingleValue(42, ['rifle'])).toBeNull();
    });
  });

  describe('normaliseNumeric', () => {
    it('clamps into bounds and rounds', () => {
      expect(normaliseNumeric(6, 'gearRating')).toBe(5);
      expect(normaliseNumeric(0, 'gearRating')).toBe(1);
      expect(normaliseNumeric('3.7', 'gearRating')).toBe(4);
    });

    it('drops non-numeric input', () => {
      expect(normaliseNumeric('abc', 'sizeCm')).toBeNull();
      expect(normaliseNumeric(undefined, 'sizeCm')).toBeNull();
    });
  });

  describe('looksLikeSerial', () => {
    it('flags long digit runs but passes ordinary model numbers', () => {
      expect(looksLikeSerial('SN 12345678')).toBe(true);
      expect(looksLikeSerial('Remington 700')).toBe(false);
      expect(looksLikeSerial('Howa 1500')).toBe(false);
      expect(looksLikeSerial('1911')).toBe(false);
    });
  });

  describe('sanitisePostDetails', () => {
    it('keeps only the fields valid for the post type', () => {
      const out = sanitisePostDetails(
        {
          species: ['Kudu', 'warthog'],
          calibre: '  .308 Win ',
          shotDistanceM: 120,
          waterType: 'dam',
          gearRating: 4,
        },
        'HUNTING',
      );
      expect(out).toEqual({
        species: ['kudu', 'warthog'],
        calibre: '.308 Win',
        shotDistanceM: 120,
      });
      expect('waterType' in out).toBe(false);
      expect('gearRating' in out).toBe(false);
    });

    it('drops chip values outside the vocabulary', () => {
      const out = sanitisePostDetails({ species: ['kudu', 'unicorn'] }, 'HUNTING');
      expect(out.species).toEqual(['kudu']);
    });

    it('omits keys the client did not send (so edits cannot wipe fields)', () => {
      const out = sanitisePostDetails({ body: 'hello' }, 'GEAR_REVIEWS');
      expect(out).toEqual({});
    });

    it('parses occurredAt and rejects invalid dates', () => {
      expect(sanitisePostDetails({ occurredAt: '2026-09-12' }, 'GENERAL').occurredAt).toEqual(
        new Date('2026-09-12'),
      );
      expect(sanitisePostDetails({ occurredAt: 'not-a-date' }, 'GENERAL').occurredAt).toBeNull();
    });

    it('never puts a firearmModel on a Fishing post', () => {
      const out = sanitisePostDetails({ firearmModel: 'Something' }, 'FISHING');
      expect('firearmModel' in out).toBe(false);
    });
  });
});
