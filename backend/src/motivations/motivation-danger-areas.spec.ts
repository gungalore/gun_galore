import type { NewsIncident } from '../news/news.types';
import {
  MAX_AREAS,
  TOO_BROAD,
  areaKey,
  clippingIdsFor,
  dangerAreas,
  parseTravelledAreas,
} from './motivation-danger-areas';

// ────────────────────────────────────────────────────────────────────
// THE AREAS THE MEMBER TICKS.
//
// Operator, 2026-09-08: "generate a list of dangerous areas around the
// applicants home in a 50km radius that has articles attached to it and lets
// them just tick the ones they travel through with a reason thats optional."
//
// ⚠️ THE LIST HAS TO BE READABLE OR THE QUESTION IS NOT ASKED. Fourteen rows
// of street names, half of them "Cape Town", is a wall somebody scrolls past —
// and the annexure it feeds is the difference between a section 13 that argues
// from the applicant's own movements and one that argues from a printout.
// ────────────────────────────────────────────────────────────────────

let n = 0;
const inc = (over: Partial<NewsIncident> = {}): NewsIncident => ({
  id: `i${++n}`,
  sourceKey: 'cape-town-etc',
  sourceName: 'Cape Town ETC',
  url: 'https://example.test/a',
  headline: 'Smash-and-grab leaves man stabbed',
  standfirst: null,
  imageUrl: null,
  author: null,
  publishedOn: '2026-09-07',
  crimeType: 'armed robbery',
  places: ['Edgemead'],
  distanceKm: 19.1,
  ...over,
});

describe('rolling incidents up into areas', () => {
  it('groups by place and counts the reports', () => {
    const out = dangerAreas([
      inc({ places: ['Edgemead'] }),
      inc({ places: ['Edgemead'] }),
      inc({ places: ['Dunoon'] }),
    ]);
    expect(out.map((a) => `${a.name}:${a.count}`)).toEqual([
      'Edgemead:2',
      'Dunoon:1',
    ]);
  });

  it('⚠️ TREATS TWO SPELLINGS AS ONE AREA, and shows the commoner one', () => {
    // Two papers write a road name two ways. They are one place to drive
    // through, and offering both invites the member to tick the same area
    // twice and wonder which one counted.
    const out = dangerAreas([
      inc({ places: ['Jakes Gerwel Drive'] }),
      inc({ places: ['Jakes Gerwel Drive'] }),
      inc({ places: ['jakes gerwel drive'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Jakes Gerwel Drive');
    expect(out[0].count).toBe(3);
  });

  it('⚠️ DROPS A PLACE TOO BIG TO DRIVE THROUGH', () => {
    // Nearly every Cape article names "Cape Town", so the commonest area would
    // be the whole metro — a row no applicant can usefully tick and one that
    // tells a DFO nothing.
    const out = dangerAreas([
      inc({ places: ['Cape Town', 'Western Cape', 'Edgemead'] }),
      inc({ places: ['Cape Town'] }),
      inc({ places: ['Cape Town'] }),
    ]);
    expect(out.map((a) => a.name)).toEqual(['Edgemead']);
    expect(TOO_BROAD.has('CAPE TOWN')).toBe(true);
  });

  it('⚠️ PUTS ONE INCIDENT IN EVERY AREA IT NAMES', () => {
    // A corner robbery names two roads and a suburb. An applicant who drives
    // one of those roads should be offered it.
    const out = dangerAreas([
      inc({ id: 'x', places: ['Jakkalsvlei Avenue', 'Jakes Gerwel Drive', 'Edgemead'] }),
    ]);
    expect(out).toHaveLength(3);
    for (const a of out) expect(a.incidentIds).toEqual(['x']);
  });

  it('keeps the nearest report’s distance, not the newest', () => {
    const out = dangerAreas([
      inc({ places: ['Edgemead'], distanceKm: 19.1, publishedOn: '2026-09-07' }),
      inc({ places: ['Edgemead'], distanceKm: 4.2, publishedOn: '2026-01-01' }),
    ]);
    expect(out[0].distanceKm).toBe(4.2);
  });

  it('names the crime types it saw, commonest first', () => {
    const out = dangerAreas([
      inc({ places: ['Edgemead'], crimeType: 'hijacking' }),
      inc({ places: ['Edgemead'], crimeType: 'hijacking' }),
      inc({ places: ['Edgemead'], crimeType: 'murder' }),
    ]);
    expect(out[0].crimeTypes).toEqual(['hijacking', 'murder']);
  });

  it('carries a headline, so the row means something unexpanded', () => {
    const out = dangerAreas([
      inc({ places: ['Edgemead'], headline: 'Man stabbed at intersection' }),
    ]);
    expect(out[0].latestHeadline).toBe('Man stabbed at intersection');
    expect(out[0].latestOn).toBe('2026-09-07');
  });
});

describe('the order and the length', () => {
  it('⚠️ AN AREA ON THEIR ROUTE OUTRANKS A BUSIER ONE THEY NEVER SEE', () => {
    // The whole point of asking about routes. A busy suburb across the city is
    // not evidence about this applicant; the road they drive daily is.
    const out = dangerAreas(
      [
        inc({ places: ['Busy Suburb'] }),
        inc({ places: ['Busy Suburb'] }),
        inc({ places: ['Busy Suburb'] }),
        inc({ places: ['My Road'] }),
      ],
      { onRoute: ['my road'] },
    );
    expect(out[0].name).toBe('My Road');
    expect(out[0].onRoute).toBe(true);
    expect(out[1].onRoute).toBe(false);
  });

  it('⚠️ SORTS AN UNPLACED AREA LAST, not first', () => {
    // "We do not know where this is" is not "it is next door", and a null that
    // sorts as zero puts the least-known row at the top of the list.
    const out = dangerAreas([
      inc({ places: ['Unplaced'], distanceKm: null }),
      inc({ places: ['Near'], distanceKm: 2 }),
    ]);
    expect(out.map((a) => a.name)).toEqual(['Near', 'Unplaced']);
  });

  it('caps the list at something a person will read', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      inc({ places: [`Place ${i}`] }),
    );
    expect(dangerAreas(many)).toHaveLength(MAX_AREAS);
  });

  it('drops a place too short to be a name', () => {
    expect(dangerAreas([inc({ places: ['N1', 'X'] })])).toEqual([]);
  });
});

describe('what the member ticked', () => {
  it('reads back keys and optional reasons', () => {
    const out = parseTravelledAreas(
      JSON.stringify([
        { key: 'edgemead', reason: 'my daughter’s school' },
        { key: 'DUNOON' },
      ]),
    );
    expect(out).toEqual([
      { key: 'EDGEMEAD', reason: 'my daughter’s school' },
      { key: 'DUNOON' },
    ]);
  });

  it('⚠️ NEVER THROWS ON A CORRUPT VALUE', () => {
    // Same posture as parsePressClippingIds. Losing a selection is bad;
    // refusing to render the section loses the applicant their whole case.
    expect(parseTravelledAreas('not json')).toEqual([]);
    expect(parseTravelledAreas('{"key":"x"}')).toEqual([]);
    expect(parseTravelledAreas(undefined)).toEqual([]);
    expect(parseTravelledAreas('[1,2,3]')).toEqual([]);
  });

  it('normalises the key it stores, so a tick matches an area', () => {
    expect(parseTravelledAreas('[{"key":"Jakes Gerwel Drive"}]')).toEqual([
      { key: 'JAKES GERWEL DRIVE' },
    ]);
    expect(areaKey('Jakes  Gerwel-Drive')).toBe('JAKES GERWEL DRIVE');
  });
});

describe('which clippings the ticks buy', () => {
  const areas = dangerAreas([
    inc({ id: 'a1', places: ['Alpha'] }),
    inc({ id: 'a2', places: ['Alpha'] }),
    inc({ id: 'a3', places: ['Alpha'] }),
    inc({ id: 'b1', places: ['Bravo'] }),
    inc({ id: 'b2', places: ['Bravo'] }),
    inc({ id: 'c1', places: ['Charlie'] }),
  ]);

  it('takes nothing when nothing is ticked', () => {
    expect(clippingIdsFor(areas, [], 8)).toEqual([]);
  });

  it('takes only the ticked areas', () => {
    expect(clippingIdsFor(areas, [{ key: 'CHARLIE' }], 8)).toEqual(['c1']);
  });

  it('⚠️ REPRESENTS EVERY TICKED AREA BEFORE ANY AREA GETS A SECOND', () => {
    // Taking them by date would spend the whole cap on the busiest area and
    // leave a ticked one with nothing in the pack — so the applicant would
    // have said "I drive through Charlie" and the annexure would not mention
    // it.
    const out = clippingIdsFor(
      areas,
      [{ key: 'ALPHA' }, { key: 'BRAVO' }, { key: 'CHARLIE' }],
      3,
    );
    expect(out).toEqual(['a1', 'b1', 'c1']);
  });

  it('fills the cap once every area has one', () => {
    const out = clippingIdsFor(areas, [{ key: 'ALPHA' }, { key: 'BRAVO' }], 4);
    expect(out).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('stops when the areas run out, without looping', () => {
    const out = clippingIdsFor(areas, [{ key: 'CHARLIE' }], 8);
    expect(out).toEqual(['c1']);
  });
});
