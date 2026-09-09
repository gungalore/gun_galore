import { packableIncident, packableIncidents } from './motivation-incident-filter';
import type { NewsIncident } from '../news/news.types';

// ────────────────────────────────────────────────────────────────────
// WHAT THE PICKER OFFERED.
//
// Walking MO000072's "Where you travel" step: among the reports near the
// applicant were a child rape in Atlantis and an Afrikaans story about a court
// appearance being postponed. Both were offered as evidence for a self-defence
// application, and either would have printed as an annexure with the
// applicant's name on the cover.
// ────────────────────────────────────────────────────────────────────

const inc = (over: Partial<NewsIncident>): NewsIncident => ({
  id: 'x',
  sourceKey: 'tygerburger',
  sourceName: 'TygerBurger',
  url: 'https://example.co.za/a',
  headline: 'Armed robbery at Bothasig shopping centre',
  standfirst: 'Three men held up staff at gunpoint on Tuesday evening.',
  imageUrl: null,
  author: null,
  publishedOn: '2026-07-14',
  crimeType: 'armed robbery',
  places: ['Bothasig'],
  distanceKm: 4.2,
  ...(over as object),
}) as NewsIncident;

describe('what a pack may carry', () => {
  it('keeps the crime a self-defence motivation argues from', () => {
    for (const t of [
      'murder',
      'attempted murder',
      'house robbery',
      'business robbery',
      'armed robbery',
      'hijacking',
      'assault',
      'burglary',
    ]) {
      expect(packableIncident(inc({ crimeType: t }))).toBe(true);
    }
  });

  it('⚠️ REFUSES A SEXUAL OFFENCE, whatever it was classified as', () => {
    // The classifier is a model. One miscategorised as 'assault' passes the
    // type filter, and the type filter is the only thing between it and an
    // annexure — so the words are checked independently.
    expect(packableIncident(inc({ crimeType: 'rape' }))).toBe(false);
    expect(
      packableIncident(
        inc({
          crimeType: 'assault',
          headline: 'Man in court for rape of Atlantis girl (8)',
        }),
      ),
    ).toBe(false);
    expect(
      packableIncident(
        inc({
          crimeType: 'assault',
          headline: 'Community outraged after Atlantis attack',
          standfirst: 'The child was sexually assaulted on her way home.',
        }),
      ),
    ).toBe(false);
  });

  it('⚠️ READS THE STANDFIRST, because papers bury it in the second line', () => {
    expect(
      packableIncident(
        inc({
          headline: 'Outrage in Kraaifontein',
          standfirst: 'The accused will appear in the magistrate’s court on Friday.',
        }),
      ),
    ).toBe(false);
  });

  it('refuses a court diary entry, which is about a case and not a place', () => {
    for (const h of [
      'Murder accused’s case postponed to November',
      'Hijacking trial set down for March',
      'Man sentenced to 15 years for Goodwood robbery',
      'Verdagte se saak uitgestel tot Desember',
      'Bail application denied in Bothasig house robbery',
    ]) {
      expect(packableIncident(inc({ headline: h }))).toBe(false);
    }
  });

  it('⚠️ REFUSES "other", AND THAT COSTS A REAL CUTTING', () => {
    // NEWS_CRIME_TYPES keeps 'other' because a crime we cannot classify is
    // still a crime near the applicant — and 'other' is also where a fraud
    // trial and a municipal dispute land. One less cutting beats one wrong one.
    expect(packableIncident(inc({ crimeType: 'other' }))).toBe(false);
    expect(packableIncident(inc({ crimeType: null }))).toBe(false);
  });

  it('keeps the order it was given', () => {
    const a = inc({ id: 'a' });
    const bad = inc({ id: 'b', crimeType: 'rape' });
    const c = inc({ id: 'c' });
    expect(packableIncidents([a, bad, c]).map((i) => i.id)).toEqual(['a', 'c']);
  });
});
