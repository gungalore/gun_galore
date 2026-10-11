import { extractGunAfricaListings } from './gunafrica.adapter';
import { SourceQuery } from '../types';

function q(over: Partial<SourceQuery> = {}): SourceQuery {
  return {
    categorySlug: 'firearms',
    make: null,
    model: null,
    keySpec: null,
    conditionBand: 'GOOD',
    limit: 10,
    ...over,
  };
}

// Both real Gun Africa shapes: a simple featured anchor and a search-result row.
const HTML =
  '<a title="Sig Sauer M4, R 40,000.00" href="/x">..</a>' +
  '<a title="Revolvers, Revolvers, RUGER SUPER BLACKHAWK , R 8,500.00, Ruger, New model super blackhawk, Like New, South Africa, Mpumalanga, Belfast" href="/x">..</a>' +
  '<a title="Voere STL 3 30-06 Hunting Rifle, R 29,000.00" href="/x">..</a>' +
  '<a title="Norinco SR762, R 15,000.00" href="/x">..</a>';

describe('extractGunAfricaListings', () => {
  it('reads a search row and its make/model/condition fields', () => {
    const hits = extractGunAfricaListings(HTML, 'gunafrica.co.za', q({ model: 'Super Blackhawk' }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ priceZar: 8500, brand: 'Ruger', model: 'New model super blackhawk', condition: 'EXCELLENT' });
    expect(hits[0].title).toBe('RUGER SUPER BLACKHAWK');
  });

  it('reads a simple featured anchor', () => {
    const hits = extractGunAfricaListings(HTML, 'gunafrica.co.za', q({ model: 'STL 3' }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ priceZar: 29000, title: 'Voere STL 3 30-06 Hunting Rifle' });
  });

  it('does not mistake a model code for a price', () => {
    const hits = extractGunAfricaListings(HTML, 'gunafrica.co.za', q({ model: 'SR762' }));
    expect(hits).toHaveLength(1);
    expect(hits[0].priceZar).toBe(15000);
  });
});
