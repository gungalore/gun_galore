import { MotivationLicenceType } from '@prisma/client';
import { fieldByKey } from '../motivation-fields';
import { catalogueChips, rankCardOptions } from './interview-chips';
import { S13_REASONS } from '../motivation-cards';

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;
const S16 = MotivationLicenceType.S16_DEDICATED_HUNTER;

describe('ranking a card set', () => {
  const keys = (options: { key: string }[]) => options.map((o) => o.key);

  it('keeps registry order when we know nothing', () => {
    const ranked = rankCardOptions(S13_REASONS, {
      type: S13,
      answers: {},
    });
    expect(keys(ranked)).toEqual(S13_REASONS.map((o) => o.key));
  });

  it('puts the precinct card first when we hold a police station', () => {
    const ranked = rankCardOptions(S13_REASONS, {
      type: S13,
      answers: { police_station: 'Bethlehem' },
    });
    expect(ranked[0].key).toBe('precinct_crime');
    // Nothing is hidden — only reordered.
    expect(ranked).toHaveLength(S13_REASONS.length);
  });

  it('puts the cash-or-stock card first for the trades that carry it', () => {
    const ranked = rankCardOptions(S13_REASONS, {
      type: S13,
      answers: { occupation: 'Building contractor' },
    });
    expect(ranked[0].key).toBe('cash_or_stock');
  });

  it('does not guess a risk from an unrelated occupation', () => {
    const ranked = rankCardOptions(S13_REASONS, {
      type: S13,
      answers: { occupation: 'Teacher' },
    });
    expect(ranked[0].key).toBe(S13_REASONS[0].key);
  });

  it('puts the cards a cartridge actually supports first', () => {
    const options = [
      {
        key: 'small_game',
        sentence: 'I use it for small game and varmints.',
        rankBy: 'calibre' as const,
      },
      {
        key: 'plains_game',
        sentence: 'I use it for plains game.',
        rankBy: 'calibre' as const,
      },
      {
        key: 'dangerous_game',
        sentence: 'I use it for dangerous game.',
        rankBy: 'calibre' as const,
      },
    ];
    const ranked = rankCardOptions(options, {
      type: S16,
      answers: { firearm_calibre: '.30-06 Springfield' },
    });
    expect(ranked[0].key).toBe('plains_game');
  });
});

describe('the catalogue chips', () => {
  it('gives the province’s own ground for the hunting locations', () => {
    // `hunting_locations` is a section 15 field; the dedicated sections ask
    // the `hunt_terrain` card instead and compose the long answer from it.
    const field = fieldByKey(
      MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      'hunting_locations',
    );
    expect(field).toBeDefined();
    const chips = catalogueChips(field!, {
      type: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      answers: { police_station_province: 'Free State' },
    });
    expect(chips.map((c) => c.value)).toContain('Free State plains');
  });

  it('gives no location chip when we do not know the province', () => {
    const field = fieldByKey(
      MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      'hunting_locations',
    );
    expect(
      catalogueChips(field!, {
        type: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
        answers: {},
      }),
    ).toEqual([]);
  });

  it('names the discipline the applicant chose, not a generic format list', () => {
    const field = fieldByKey(
      MotivationLicenceType.S16_DEDICATED_SPORT,
      'competition_record',
    );
    expect(field).toBeDefined();
    const chips = catalogueChips(field!, {
      type: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers: { discipline_exercise: 'IPSC Practical Rifle' },
    });
    expect(chips[0].value).toContain('IPSC Practical Rifle');
  });

  it('offers hunting activity for a renewal of a hunting rifle', () => {
    const field = fieldByKey(MotivationLicenceType.S24_RENEWAL, 'continued_use');
    const chips = catalogueChips(field!, {
      type: MotivationLicenceType.S24_RENEWAL,
      answers: { firearm_calibre: '.30-06 Springfield', firearm_type: 'Rifle' },
    });
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0].value.toLowerCase()).toContain('hunt');
  });
});
