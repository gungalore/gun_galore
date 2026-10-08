import { buildAnchorQueries, buildQueries } from './query-builder';

describe('buildQueries', () => {
  it('site-scopes to the category domains and adds generic SA queries', () => {
    const q = buildQueries({
      make: 'Jurgens',
      model: 'XT120',
      keySpec: '2010',
      sources: ['bidorbuy.co.za', 'gumtree south africa', 'facebook marketplace south africa'],
    });
    expect(q.some((s) => s.startsWith('site:bidorbuy.co.za'))).toBe(true);
    expect(q.some((s) => s.includes('Jurgens XT120 2010 used'))).toBe(true);
    expect(q.some((s) => /secondhand South Africa/.test(s))).toBe(true);
  });

  it('returns nothing without identifying terms', () => {
    expect(buildQueries({ sources: ['gunafrica.com'] })).toEqual([]);
  });

  it('caps the number of queries and dedupes', () => {
    const q = buildQueries({
      make: 'Ruger',
      model: 'M77',
      sources: ['a.co.za', 'b.co.za', 'c.co.za', 'd.co.za', 'e.co.za', 'f.co.za'],
    }, 4);
    expect(q.length).toBeLessThanOrEqual(4);
    expect(new Set(q).size).toBe(q.length);
  });

  it('builds anchor queries', () => {
    const a = buildAnchorQueries({ make: 'Vortex', model: 'Viper', sources: [] });
    expect(a[0]).toMatch(/price South Africa new/);
  });
});
