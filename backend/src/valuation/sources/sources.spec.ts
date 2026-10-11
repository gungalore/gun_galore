import { diffProduct } from './diff-product';
import { hitKind, toRawComp } from './to-raw-comp';
import { isRelevant, searchTerms } from './relevance';
import { ProductHit, SourceQuery } from './types';

const item = { make: 'MSR', model: 'Hubba Hubba NX2', keySpec: null };

function q(over: Partial<SourceQuery> = {}): SourceQuery {
  return { categorySlug: 'camping-outdoor', make: 'MSR', model: 'Hubba Hubba NX2', keySpec: null, conditionBand: 'GOOD', limit: 10, ...over };
}

describe('diffProduct', () => {
  it('is empty (exact) for the same make and model', () => {
    expect(diffProduct({ brand: 'MSR', model: 'Hubba Hubba NX2' }, item)).toEqual([]);
  });

  it('flags a different model', () => {
    const diffs = diffProduct({ brand: 'MSR', model: 'Hubba NX' }, { make: 'MSR', model: 'Hubba Hubba NX2', keySpec: null });
    expect(diffs.map((d) => d.dimension)).toContain('model');
  });

  it('never claims exact when the maker is unknown on one side', () => {
    const diffs = diffProduct({ model: 'Hubba Hubba NX2' }, item);
    expect(diffs.map((d) => d.dimension)).toContain('make');
  });

  it('flags both dimensions when nothing is known', () => {
    const dims = diffProduct({}, { make: null, model: null, keySpec: null }).map((d) => d.dimension);
    expect(dims).toEqual(expect.arrayContaining(['make', 'model']));
  });
});

describe('hitKind', () => {
  it('treats a sold hit as a used comp even from an anchor source', () => {
    expect(hitKind({ sold: true } as ProductHit, ['ANCHOR'])).toBe('USED_COMP');
  });
  it('treats new stock as a retail anchor even from a used source', () => {
    expect(hitKind({ isNew: true } as ProductHit, ['USED'])).toBe('RETAIL_ANCHOR');
  });
  it('uses the source role when the hit is neutral', () => {
    expect(hitKind({} as ProductHit, ['ANCHOR'])).toBe('RETAIL_ANCHOR');
    expect(hitKind({} as ProductHit, ['USED'])).toBe('USED_COMP');
  });
});

describe('toRawComp', () => {
  it('produces a synthetic, non-revealing url and rounds the price', () => {
    const comp = toRawComp(
      { refId: 'hubba-nx2', title: 'MSR Hubba Hubba NX2', priceZar: 4199.6, domain: 'shop.example', brand: 'MSR', model: 'Hubba Hubba NX2', isNew: true },
      ['ANCHOR'],
      item,
    );
    expect(comp.url).toBe('src://shop.example/hubba-nx2');
    expect(comp.sourceSite).toBe('shop.example');
    expect(comp.kind).toBe('RETAIL_ANCHOR');
    expect(comp.priceZar).toBe(4200);
    expect(comp.pageOpened).toBe(true);
  });
});

describe('relevance', () => {
  it('requires the model when one is known', () => {
    expect(isRelevant('MSR Hubba Hubba NX2 Tent', q())).toBe(true);
    expect(isRelevant('Generic 2 Person Tent', q())).toBe(false);
  });
  it('falls back to spec terms when neither make nor model is known', () => {
    const query = q({ make: null, model: null, keySpec: '10x42' });
    expect(isRelevant('Vortex Diamondback 10x42 Binoculars', query)).toBe(true);
    expect(isRelevant('Random scope', query)).toBe(false);
  });
  it('extracts terms', () => {
    expect(searchTerms(q())).toEqual(expect.arrayContaining(['msr', 'hubba']));
  });

  it('rejects catalogue junk that only shares a colour word', () => {
    const query = q({ make: 'Blue Marlin', model: 'G3 Series', keySpec: '4.20m / 6-8oz' });
    expect(isRelevant('BLUE TARPAULIN POLYETHYLENE 5m x 6m', query)).toBe(false);
    expect(isRelevant('PVC NAVY BLUE RUBBERDUCK 1.5m (M)', query)).toBe(false);
    expect(isRelevant('STEERING WHEEL 320mm WITH HUB', query)).toBe(false);
    expect(isRelevant('Blue Marlin G3 Series 4.20m multi-tip fishing rod', query)).toBe(true);
  });
});
