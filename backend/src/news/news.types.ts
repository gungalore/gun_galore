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
