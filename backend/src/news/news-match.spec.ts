import { boundingBox, districtMatches, haversineKm } from './news-geo';
import { namesTouch, crimeSearch, clippingFactLines } from './news.service';
import {
  GOOGLE_NEWS_KEY,
  NEWS_SOURCES,
  googleNewsUrl,
  pollableSources,
} from './news-sources';
import type { NewsIncident } from './news.types';

// Two real precincts, far enough apart that no plausible radius joins them.
const BROOKLYN = { lat: -25.7671, lng: 28.2367 }; // Pretoria
const KEMPTON = { lat: -26.1, lng: 28.23 }; // Kempton Park, ~37 km south
const DURBAN = { lat: -29.8587, lng: 31.0218 };

describe('haversineKm', () => {
  it('is zero for a point against itself', () => {
    expect(haversineKm(BROOKLYN.lat, BROOKLYN.lng, BROOKLYN.lat, BROOKLYN.lng)).toBe(0);
  });

  it('measures two Gauteng precincts against a known separation', () => {
    const km = haversineKm(BROOKLYN.lat, BROOKLYN.lng, KEMPTON.lat, KEMPTON.lng);
    expect(km).toBeGreaterThan(35);
    expect(km).toBeLessThan(40);
  });

  it('puts Durban far outside any local radius of Pretoria', () => {
    expect(haversineKm(BROOKLYN.lat, BROOKLYN.lng, DURBAN.lat, DURBAN.lng)).toBeGreaterThan(
      450,
    );
  });
});

describe('boundingBox', () => {
  // ⚠️ THE BOX IS THE SQL PRE-FILTER AND MUST CONTAIN THE CIRCLE. A box that
  // clipped it would silently drop the furthest true matches — a bug nobody
  // sees, because the answer still looks like a list of clippings.
  it('contains every point on the circle it approximates', () => {
    const km = 25;
    const box = boundingBox(BROOKLYN.lat, BROOKLYN.lng, km);
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const rad = (bearing * Math.PI) / 180;
      const dLat = (km / 111.32) * Math.cos(rad);
      const dLng = (km / (111.32 * Math.cos((BROOKLYN.lat * Math.PI) / 180))) * Math.sin(rad);
      const lat = BROOKLYN.lat + dLat;
      const lng = BROOKLYN.lng + dLng;
      expect(lat).toBeGreaterThanOrEqual(box.minLat);
      expect(lat).toBeLessThanOrEqual(box.maxLat);
      expect(lng).toBeGreaterThanOrEqual(box.minLng);
      expect(lng).toBeLessThanOrEqual(box.maxLng);
    }
  });

  it('excludes a point well outside the radius', () => {
    const box = boundingBox(BROOKLYN.lat, BROOKLYN.lng, 25);
    expect(KEMPTON.lat < box.minLat || KEMPTON.lat > box.maxLat).toBe(true);
  });
});

describe('districtMatches — the fallback for an article with no coordinates', () => {
  // ⚠️ SAPS writes "Ehlanzeni District"; a municipality writes "Ehlanzeni".
  it('folds the district/metro/municipality wording and the case', () => {
    expect(districtMatches('Ehlanzeni District', 'Ehlanzeni')).toBe(true);
    expect(districtMatches('City of Tshwane', 'Tshwane')).toBe(true);
    expect(districtMatches('ethekwini', 'eThekwini Metropolitan')).toBe(true);
  });

  it('does not join two different districts', () => {
    expect(districtMatches('Ehlanzeni District', 'Nkangala District')).toBe(false);
    expect(districtMatches('Ugu District', 'iLembe District')).toBe(false);
  });

  it('is false when either side is missing', () => {
    expect(districtMatches(null, 'Ehlanzeni')).toBe(false);
    expect(districtMatches('Ehlanzeni', null)).toBe(false);
    expect(districtMatches('District', 'District')).toBe(false);
  });
});

describe('namesTouch', () => {
  it('matches a town in a source’s coverage list', () => {
    expect(namesTouch(['Kempton Park', 'Tembisa'], 'Tembisa')).toBe(true);
  });

  // ⚠️ WHOLE TOKENS. A national title writes "British High Commission" several
  // times a year, and Brits is a real precinct.
  it('does not match a town name inside a longer word', () => {
    expect(namesTouch(['British High Commission'], 'Brits')).toBe(false);
  });

  it('is false for a station name too short to be distinctive', () => {
    expect(namesTouch(['Ballito'], 'KZ')).toBe(false);
  });
});

describe('the Google News fallback query', () => {
  it('asks for the crime words, not just the place', () => {
    expect(crimeSearch('"Brooklyn" Gauteng')).toBe(
      '"Brooklyn" Gauteng (robbery OR hijacking OR murder OR burglary OR shooting)',
    );
  });

  // ⚠️ ONE UNENCODED & IN A STATION NAME WOULD TRUNCATE THE QUERY and return
  // the whole country's news as if it were the applicant's precinct.
  it('encodes the query into the template rather than concatenating it', () => {
    const url = googleNewsUrl(crimeSearch(`"Grocott's & Co" Eastern Cape`));
    expect(url.startsWith('https://news.google.com/rss/search?q=')).toBe(true);
    expect(url).toContain('%26');
    expect(url).toContain('hl=en-ZA&gl=ZA&ceid=ZA:en');
    const q = new URL(url).searchParams.get('q');
    expect(q).toContain("Grocott's & Co");
    expect(q).toContain('robbery OR hijacking');
  });
});

describe('the registry', () => {
  it('has a unique key for every title', () => {
    const keys = NEWS_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a unique feed URL for every title', () => {
    // The survey found fifteen domains serving another title's feed; listing
    // one twice would double-count itemCount and print a cutting twice.
    const urls = NEWS_SOURCES.map((s) => s.feedUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('is all https, with no leftover placeholder but the search template', () => {
    for (const s of NEWS_SOURCES) {
      expect(s.feedUrl.startsWith('https://')).toBe(true);
      expect(s.homepage.startsWith('https://')).toBe(true);
      if (s.key !== GOOGLE_NEWS_KEY) expect(s.feedUrl).not.toContain('{q}');
    }
  });

  // ⚠️ 0 MEANS "NO COVERAGE CIRCLE". A national title with a real radius would
  // drop the whole country's crime into one precinct's clippings.
  it('gives national titles no coverage circle and local ones a real one', () => {
    for (const s of NEWS_SOURCES) {
      if (s.kind === 'national' || s.kind === 'google-news') {
        expect(s.radiusKm).toBe(0);
        expect(s.towns).toEqual([]);
      } else {
        expect(s.radiusKm).toBeGreaterThan(0);
        expect(s.towns.length).toBeGreaterThan(0);
      }
    }
  });

  it('starts every local title with no coordinates, for the poll to fill in', () => {
    expect(NEWS_SOURCES.every((s) => s.lat === null && s.lng === null)).toBe(true);
  });

  // ⚠️ THE TEMPLATE IS NOT A FEED. Fetching it verbatim asks Google News for
  // the literal string "{q}".
  it('keeps the search template out of the pollable set', () => {
    expect(pollableSources().some((s) => s.key === GOOGLE_NEWS_KEY)).toBe(false);
    expect(pollableSources().length).toBe(NEWS_SOURCES.length - 1);
  });

  it('carries enough titles to cover the country', () => {
    expect(NEWS_SOURCES.length).toBeGreaterThanOrEqual(60);
    const provinces = new Set(
      NEWS_SOURCES.filter((s) => s.kind === 'local' || s.kind === 'regional').map(
        (s) => s.province,
      ),
    );
    expect(provinces.size).toBe(9);
  });
});

describe('clippingFactLines', () => {
  const clip: NewsIncident = {
    id: 'a1',
    sourceKey: 'kempton-express',
    sourceName: 'Kempton Express',
    url: 'https://kemptonexpress.co.za/x',
    headline: 'Two arrested after Norkem Park house robbery',
    standfirst: 'Police recovered a firearm.',
    imageUrl: null,
    author: null,
    publishedOn: '2026-09-06',
    crimeType: 'house robbery',
    places: ['Norkem Park'],
    distanceKm: 4.2,
  };

  // The writer cites these; each line must name the paper and the date so the
  // citation can be checked against the annexure it points at.
  it('names the paper, the date and the headline on one line', () => {
    expect(clippingFactLines([clip])[0]).toBe(
      'Press clipping 1: Kempton Express, 2026-09-06 — "Two arrested after Norkem Park house robbery" — Police recovered a firearm. [house robbery] (Norkem Park)',
    );
  });

  it('is empty for no clippings', () => {
    expect(clippingFactLines([])).toEqual([]);
  });
});
