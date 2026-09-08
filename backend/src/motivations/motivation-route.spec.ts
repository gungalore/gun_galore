import {
  ON_ROUTE_KM,
  areasOnRoute,
  decodePolyline,
  nearRoute,
} from './motivation-route';

// ────────────────────────────────────────────────────────────────────
// THE ROUTE TEST.
//
// Operator, 2026-09-08: "we could also use the work address and google maps
// routes to see through which areas they travel and link it that way?"
//
// ⚠️ WHAT IT DECIDES IS A PRE-TICK ON A DOCUMENT SOMEBODY SIGNS. Too loose and
// a motorway pre-ticks half a metro, putting words in the applicant's mouth;
// too tight and the road they drive every morning is missed. Both failures are
// silent, which is why the geometry is pinned here rather than eyeballed.
// ────────────────────────────────────────────────────────────────────

describe('decoding what Google sends', () => {
  it('reads the reference polyline from Google’s own documentation', () => {
    // "_p~iF~ps|U_ulLnnqC_mqNvxq`@" is the example in the Encoded Polyline
    // Algorithm Format spec: (38.5,-120.2), (40.7,-120.95), (43.252,-126.453).
    const out = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(out).toHaveLength(3);
    expect(out[0].lat).toBeCloseTo(38.5, 5);
    expect(out[0].lng).toBeCloseTo(-120.2, 5);
    expect(out[2].lat).toBeCloseTo(43.252, 5);
    expect(out[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('⚠️ RETURNS WHAT IT MANAGED RATHER THAN THROWING', () => {
    // A truncated or malformed polyline costs the pre-tick. It must not cost
    // the member the whole area list, which is useful with no route at all.
    expect(() => decodePolyline('_p~iF~ps|U_ulL')).not.toThrow();
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline('!!!!')).toEqual([]);
  });
});

describe('is this area on the route', () => {
  // A crude N1 out of Cape Town: two points, ~50km apart.
  const capeTown = { lat: -33.925, lng: 18.424 };
  const paarl = { lat: -33.73, lng: 18.96 };
  const route = [capeTown, paarl];

  it('⚠️ TESTS THE SEGMENT, NOT JUST THE VERTICES', () => {
    // Google thins a polyline on long straight stretches, so two consecutive
    // points can be tens of kilometres apart. A suburb halfway along that
    // straight is far from BOTH vertices and sits on the very road the
    // applicant drives every day.
    const halfway = {
      lat: (capeTown.lat + paarl.lat) / 2,
      lng: (capeTown.lng + paarl.lng) / 2,
    };
    expect(nearRoute(halfway, route)).toBe(true);
  });

  it('refuses somewhere well off the line', () => {
    // Simon's Town, ~35km south of the corridor.
    expect(nearRoute({ lat: -34.19, lng: 18.43 }, route)).toBe(false);
  });

  it('takes an endpoint', () => {
    expect(nearRoute(paarl, route)).toBe(true);
  });

  it('⚠️ THREE KILOMETRES, BECAUSE A SUBURB IS NOT A POINT', () => {
    // A geocoded suburb is one point standing for a few square kilometres, so
    // "on the route" cannot mean "on the line".
    expect(ON_ROUTE_KM).toBe(3);
    // ~2km north of the midpoint: inside.
    const near = {
      lat: (capeTown.lat + paarl.lat) / 2 + 0.018,
      lng: (capeTown.lng + paarl.lng) / 2,
    };
    expect(nearRoute(near, route)).toBe(true);
    // ~11km north: outside.
    const far = {
      lat: (capeTown.lat + paarl.lat) / 2 + 0.1,
      lng: (capeTown.lng + paarl.lng) / 2,
    };
    expect(nearRoute(far, route)).toBe(false);
  });

  it('handles a repeated vertex, which Google does emit', () => {
    expect(nearRoute(capeTown, [capeTown, capeTown])).toBe(true);
  });

  it('says no when there is no route at all', () => {
    expect(nearRoute(capeTown, [])).toBe(false);
    expect(areasOnRoute([{ key: 'X', at: capeTown }], [])).toEqual([]);
  });
});

describe('picking the areas', () => {
  const route = [
    { lat: -33.925, lng: 18.424 },
    { lat: -33.73, lng: 18.96 },
  ];

  it('returns only the keys the line passes', () => {
    const out = areasOnRoute(
      [
        { key: 'PAARL', at: { lat: -33.73, lng: 18.96 } },
        { key: 'SIMONS TOWN', at: { lat: -34.19, lng: 18.43 } },
      ],
      route,
    );
    expect(out).toEqual(['PAARL']);
  });

  it('⚠️ AN AREA WE COULD NOT PLACE IS SIMPLY NOT PRE-TICKED', () => {
    // It is still offered to the member. Failing to geocode a suburb is our
    // problem, and the honest consequence is that we do not answer for them.
    expect(areasOnRoute([], route)).toEqual([]);
  });
});
