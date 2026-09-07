// ────────────────────────────────────────────────────────────────────
// LOCAL CRIME REPORTING NEAR AN APPLICANT — THE SHAPES THE APP SEES.
//
// Operator, 2026-09-07: "pull rss feeds from local papers all over south
// africa to give full articles regarding crime in that region of the
// applicant … the past year as a limit" and then, on what goes in the pack:
// "just the picture and headline and subscript that outline the article,
// the reason is it must look authentic, no CFR is going to sit and type in
// a stupid link we supply him to read the article."
//
// So a CLIPPING is a share preview: the paper's name, the date, the
// headline, the picture and the standfirst — what a news site publishes for
// exactly this purpose — printed to look like a cutting, with the link small
// underneath. Never the body of the article: it adds nothing a reviewer can
// check, and reproducing it is the publisher's right, not ours.
//
// ⚠️ NOTHING HERE IS A FACT ABOUT THE APPLICANT. A clipping is a fact about
// the precinct, chosen by the applicant, supplied to the motivation writer
// with its source and date so it can be cited — never embellished.
// ────────────────────────────────────────────────────────────────────

export type NewsSourceKind = 'local' | 'regional' | 'national' | 'google-news';

export interface NewsSource {
  /** Stable key, e.g. "lowvelder". */
  key: string;
  name: string;
  homepage: string;
  /** RSS/Atom URL, or a Google News search template for kind 'google-news'. */
  feedUrl: string;
  province: string;
  district: string | null;
  /** Towns and suburbs the title covers, as SAPS/Google spell them. */
  towns: string[];
  /** Coverage centre and radius, for distance matching. */
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  kind: NewsSourceKind;
}

export interface NewsIncident {
  id: string;
  sourceKey: string;
  sourceName: string;
  url: string;
  headline: string;
  /** The standfirst / og:description, ≤ 400 characters. */
  standfirst: string | null;
  /** The lead picture (og:image), a URL we fetch only when a pack is built. */
  imageUrl: string | null;
  author: string | null;
  /** ISO day. */
  publishedOn: string;
  /** e.g. 'house robbery' | 'hijacking' | 'murder' | 'armed robbery' | 'assault' | 'other'. */
  crimeType: string | null;
  /** Place names read from the piece, as printed. */
  places: string[];
  /** From the query point, when the query had one. */
  distanceKm: number | null;
}

export interface IncidentQuery {
  station?: { name: string; province: string };
  lat?: number;
  lng?: number;
  /** Default 25. */
  withinKm?: number;
  /** Default 12, the operator's limit. */
  months?: number;
  /** Default 12. */
  limit?: number;
}

/** A picture fetched for a pack, bounded and re-encoded. */
export interface ClippingImage {
  mimeType: 'image/jpeg';
  /** Base64. */
  data: string;
  width: number;
  height: number;
}

// ────────────────────────────────────────────────────────────────────
// THE TAGGING CONTRACT — added 2026-09-07 with the poller.
// ────────────────────────────────────────────────────────────────────

/**
 * What a piece is about, in the words a motivation can use.
 *
 * ⚠️ THESE ARE SAPS'S CATEGORIES IN PLAIN ENGLISH, NOT A JOURNALIST'S. The
 * whole value of a clipping beside the precinct figures is that the two can
 * be read together — "eleven house robberies in the quarter, and here are
 * three of them" — which only works if a clipping's type is a word the
 * figures also use. 'other' is deliberately present: a real crime we cannot
 * classify is still a crime near the applicant.
 */
export const NEWS_CRIME_TYPES = [
  'murder',
  'attempted murder',
  'house robbery',
  'business robbery',
  'armed robbery',
  'hijacking',
  'rape',
  'assault',
  'burglary',
  'other',
] as const;

export type NewsCrimeType = (typeof NEWS_CRIME_TYPES)[number];

/** One item's verdict, as the model returns it. */
export interface NewsTag {
  isCrime: boolean;
  crimeType: NewsCrimeType | null;
  /** Place names as PRINTED in the piece — suburb, town, road. Never added to. */
  places: string[];
}

/**
 * The JSON schema handed to LlmService.
 *
 * ⚠️ AN ARRAY OF VERDICTS KEYED BY INDEX, not a bare array, because a model
 * that drops or reorders one item in a batch of twenty would otherwise tag
 * nineteen articles with the wrong verdicts and there would be no way to tell.
 * The index is checked on the way back; a verdict whose index we did not ask
 * about is discarded.
 */
export const NEWS_TAG_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          isCrime: { type: 'boolean' },
          crimeType: {
            type: 'string',
            enum: [...NEWS_CRIME_TYPES],
            nullable: true,
          },
          places: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'isCrime'],
      },
    },
  },
  required: ['items'],
} as const;

/** What one poll run did, for the admin panel and the loader script. */
export interface NewsPollOutcome {
  sourcesTried: number;
  sourcesOk: number;
  sourcesFailed: number;
  itemsSeen: number;
  itemsNew: number;
  previewsFound: number;
  itemsTagged: number;
  crimeItems: number;
  deleted: number;
  /** One line per source. */
  messages: string[];
}
