import { extractJaracalListings, JaracalAdapter, parseTitlePrice } from './jaracal.adapter';
import { SourceQuery } from '../types';

jest.mock('../http', () => ({ getText: jest.fn() }));
import { getText } from '../http';

const FIXTURE = `
  <a href="./viewtopic.php?t=111&amp;sid=x" class="topictitle">Labradar - R5500 - Bloemfontein - Prys verlaag</a>
  <a class="topictitle" href="./viewtopic.php?t=222&amp;sid=x">Redding Boss press - R4200</a>
  <a href="./viewtopic.php?t=333&amp;sid=x" class="topictitle">Gesoek: .223 Rem Reamer</a>
  <a href="./viewtopic.php?t=111&amp;sid=y" class="topictitle">Labradar - R5500 (dup)</a>
`;

const query: SourceQuery = { categorySlug: 'reloading-equipment', make: 'Redding', model: 'Boss', keySpec: null, conditionBand: 'GOOD', limit: 10 };

describe('parseTitlePrice', () => {
  it('reads a plain, comma-grouped or trailing-cents price', () => {
    expect(parseTitlePrice('Labradar - R5500 - Bloemfontein')).toBe(5500);
    expect(parseTitlePrice('NF SHV 4-14x56 IHR - R 11,000 (Bloem)')).toBe(11000);
    expect(parseTitlePrice('Nikon Gold Monarch E R5000-00')).toBe(5000);
    expect(parseTitlePrice('Sig Sauer M4, R 40,000.00')).toBe(40000);
    expect(parseTitlePrice('no price here')).toBeNull();
  });
});

describe('extractJaracalListings', () => {
  it('keeps priced topics, dedupes by topic id, ignores the rest', () => {
    const items = extractJaracalListings(FIXTURE);
    expect(items).toEqual([
      { refId: '111', title: 'Labradar - R5500 - Bloemfontein - Prys verlaag', priceZar: 5500 },
      { refId: '222', title: 'Redding Boss press - R4200', priceZar: 4200 },
    ]);
  });
});

describe('JaracalAdapter', () => {
  beforeEach(() => {
    (getText as jest.Mock).mockReset();
    (getText as jest.Mock).mockResolvedValue(FIXTURE);
  });

  it('returns only listings relevant to the item', async () => {
    const hits = await new JaracalAdapter().search('jaracal.com', query);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'Redding Boss press - R4200', priceZar: 4200, domain: 'jaracal.com' });
  });

  it('is inert without search terms', async () => {
    const hits = await new JaracalAdapter().search('jaracal.com', { ...query, make: null, model: null });
    expect(hits).toEqual([]);
    expect(getText).not.toHaveBeenCalled();
  });
});
