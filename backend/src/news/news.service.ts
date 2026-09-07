import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { boundedImageBytes } from '../common/image-bytes';
import { PrismaService } from '../prisma/prisma.service';
import { NewsPollService } from './news-poll.service';
import { boundingBox, districtMatches, haversineKm } from './news-geo';
import { fetchImageBytes } from './news-http';
import { cachedPlace } from './news-place';
import type { ClippingImage, IncidentQuery, NewsIncident } from './news.types';

// ────────────────────────────────────────────────────────────────────
// WHAT WAS REPORTED NEAR THIS PRECINCT, IN THE PAST YEAR.
//
// The read path. Everything it answers with was gathered by the nightly poll
// (news-poll.service.ts); the one exception is a precinct so thinly covered
// that the registry has almost nothing for it, where a Google News search is
// run there and then — see the fallback below.
//
// ⚠️ NOTHING HERE IS A FACT ABOUT THE APPLICANT. A clipping is a fact about
// the precinct, handed to the motivation writer with its source and date so a
// citation can be checked. See news.types.ts.
// ────────────────────────────────────────────────────────────────────

/** The operator's limit: "the past year". */
const DEFAULT_MONTHS = 12;
const DEFAULT_WITHIN_KM = 25;
const DEFAULT_LIMIT = 12;
/** Never hand back more than this, whatever the caller asks for. */
const MAX_LIMIT = 50;

/**
 * ⚠️ FEWER THAN THIS AND WE GO LOOKING. Four clippings is the smallest number
 * that reads as a pattern rather than an anecdote in a motivation, and a
 * precinct under it is almost always one no local title covers — which is
 * exactly what the Google News fallback is for.
 */
const SEARCH_BELOW = 4;

/** How many rows a single match reads before filtering in memory. */
const CANDIDATE_TAKE = 400;

/** The long edge a clipping's picture is re-encoded to for the pack. */
const CLIPPING_MAX_EDGE = 1200;

const INCIDENT_SELECT = {
  id: true,
  url: true,
  headline: true,
  standfirst: true,
  imageUrl: true,
  author: true,
  publishedOn: true,
  crimeType: true,
  places: true,
  lat: true,
  lng: true,
  source: {
    select: { key: true, name: true, district: true, province: true, towns: true },
  },
} as const;

type Row = {
  id: string;
  url: string;
  headline: string;
  standfirst: string | null;
  imageUrl: string | null;
  author: string | null;
  publishedOn: Date;
  crimeType: string | null;
  places: string[];
  lat: number | null;
  lng: number | null;
  source: {
    key: string;
    name: string;
    district: string | null;
    province: string;
    towns: string[];
  };
};

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly poll: NewsPollService,
  ) {}

  /** Crime reporting near a station or point, newest first, within the window. */
  async incidentsNear(q: IncidentQuery): Promise<NewsIncident[]> {
    const months = clamp(q.months ?? DEFAULT_MONTHS, 1, 24);
    const withinKm = clamp(q.withinKm ?? DEFAULT_WITHIN_KM, 1, 200);
    const limit = clamp(q.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
    const since = monthsAgo(months);

    const at = await this.queryPoint(q);
    const found = await this.match(q, at, since, withinKm, limit);
    if (found.length >= SEARCH_BELOW || !q.station) return found;

    // ── The fallback. A precinct with almost nothing is the ordinary case
    // for a rural station: no local title covers it, so the registry cannot.
    // ⚠️ The search runs for the STATION and then for its DISTRICT, because a
    // station name alone is often a farm and a suburb at once ("Bronkhorstspruit"
    // returns the town; "Tshwane" returns the metro's reporting round it).
    const district = at.district;
    const queries = [
      crimeSearch(`"${q.station.name}" ${q.station.province}`),
      ...(district ? [crimeSearch(`"${district}" ${q.station.province}`)] : []),
    ];
    let added = 0;
    for (const s of queries) added += await this.poll.ingestSearch(s);
    if (added === 0) return found;

    return this.match(q, at, since, withinKm, limit);
  }

  /** The chosen clippings for a pack, in the order asked for; unknown ids dropped. */
  async byIds(ids: string[]): Promise<NewsIncident[]> {
    const wanted = ids.filter((id) => typeof id === 'string' && id).slice(0, MAX_LIMIT);
    if (wanted.length === 0) return [];
    const rows = (await this.prisma.newsArticle.findMany({
      where: { id: { in: wanted } },
      select: INCIDENT_SELECT,
    })) as Row[];
    // ⚠️ THE CALLER'S ORDER IS THE PACK'S ORDER. Annexure A is whatever the
    // member put first, and a findMany answers in whatever order it likes.
    const byId = new Map(rows.map((r) => [r.id, r]));
    return wanted
      .map((id) => byId.get(id))
      .filter((r): r is Row => r !== undefined)
      .map((r) => toIncident(r, null));
  }

  /**
   * The lead picture for a clipping, fetched at pack time only, bounded to
   * ~1200px on the long edge, JPEG. Null when the site has none or refuses.
   *
   * ⚠️ NULL IS A NORMAL ANSWER AND THE CALLER MUST SURVIVE IT. Publishers
   * hotlink-protect, expire and re-path their images; a clipping without its
   * picture is still a headline, a paper and a date, and a pack that threw
   * because one photograph 404'd would be worse than one that prints three
   * cuttings and a fourth without art.
   */
  async clippingImage(incident: NewsIncident): Promise<ClippingImage | null> {
    if (!incident.imageUrl) return null;
    const raw = await fetchImageBytes(incident.imageUrl);
    if (!raw) return null;

    // ⚠️ jpeg/png/webp ONLY. Those are the three boundedImageBytes is typed
    // for and the three sharp decodes without surprises; an og:image that is
    // an SVG is a masthead logo rather than a news photograph, and handing
    // arbitrary SVG to an image pipeline is not a thing to do with a URL a
    // third party chose.
    const mime = raw.mimeType;
    if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
      return null;
    }

    const bounded = await boundedImageBytes(
      { base64: raw.base64, mimeType: mime },
      CLIPPING_MAX_EDGE,
    );
    // boundedImageBytes never fails the call — it returns the ORIGINAL bytes
    // when sharp cannot read them. For a clipping that is not good enough:
    // the pack's contract is a JPEG of known size.
    if (bounded.mimeType !== 'image/jpeg') return null;

    try {
      const meta = await sharp(Buffer.from(bounded.base64, 'base64')).metadata();
      if (!meta.width || !meta.height) return null;
      return {
        mimeType: 'image/jpeg',
        data: bounded.base64,
        width: meta.width,
        height: meta.height,
      };
    } catch {
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // MATCHING
  // ══════════════════════════════════════════════════════════════════

  /**
   * Where the question is being asked from.
   *
   * ⚠️ A NULL POINT IS WORKABLE, NOT AN ERROR. With no Maps key — a
   * developer's machine, or a station Google cannot place — the match falls
   * through to district and town names, which is coarser but still the right
   * precinct. Distance is then reported as null rather than guessed.
   */
  private async queryPoint(q: IncidentQuery): Promise<{
    lat: number | null;
    lng: number | null;
    district: string | null;
    province: string | null;
  }> {
    if (typeof q.lat === 'number' && typeof q.lng === 'number') {
      return { lat: q.lat, lng: q.lng, district: null, province: null };
    }
    if (!q.station) return { lat: null, lng: null, district: null, province: null };

    const station = await this.prisma.crimeStatsStation.findFirst({
      where: { name: q.station.name, province: q.station.province },
      select: { district: true, province: true },
    });
    const at = await cachedPlace(
      this.prisma,
      `${q.station.name} police station, ${q.station.province}, South Africa`,
      `${q.station.name} police station|${q.station.province}`,
    );
    return {
      lat: at?.lat ?? null,
      lng: at?.lng ?? null,
      district: station?.district ?? null,
      province: station?.province ?? q.station.province,
    };
  }

  private async match(
    q: IncidentQuery,
    at: { lat: number | null; lng: number | null; district: string | null; province: string | null },
    since: Date,
    withinKm: number,
    limit: number,
  ): Promise<NewsIncident[]> {
    const base = { isCrime: true, publishedOn: { gte: since } } as const;
    const rows = new Map<string, Row>();

    // ── By distance. The bounding box is what the (lat, lng) index can serve;
    // the circle is cut in memory afterwards.
    if (at.lat !== null && at.lng !== null) {
      const box = boundingBox(at.lat, at.lng, withinKm);
      const near = (await this.prisma.newsArticle.findMany({
        where: {
          ...base,
          lat: { gte: box.minLat, lte: box.maxLat },
          lng: { gte: box.minLng, lte: box.maxLng },
        },
        orderBy: { publishedOn: 'desc' },
        take: CANDIDATE_TAKE,
        select: INCIDENT_SELECT,
      })) as Row[];
      for (const r of near) rows.set(r.id, r);
    }

    // ── By area. ⚠️ SEPARATE QUERY, NOT AN `OR`. The district match is
    // lenient (see districtMatches — SAPS writes "Ehlanzeni District" and a
    // municipality writes "Ehlanzeni"), and leniency cannot be expressed in
    // an index-usable WHERE. So the province narrows it in SQL and the
    // district and towns are compared in memory over a bounded page.
    const province = at.province ?? q.station?.province ?? null;
    if (province) {
      const inProvince = (await this.prisma.newsArticle.findMany({
        where: { ...base, source: { province } },
        orderBy: { publishedOn: 'desc' },
        take: CANDIDATE_TAKE,
        select: INCIDENT_SELECT,
      })) as Row[];
      const stationName = q.station?.name ?? '';
      for (const r of inProvince) {
        if (rows.has(r.id)) continue;
        // A row that HAS coordinates was already offered to the distance
        // test above and lost; letting it in here would quietly widen every
        // search to the whole province.
        if (r.lat !== null && r.lng !== null && at.lat !== null) continue;
        const areaHit =
          districtMatches(r.source.district, at.district) ||
          namesTouch(r.source.towns, stationName) ||
          namesTouch(r.places, stationName);
        if (areaHit) rows.set(r.id, r);
      }
    }

    const withDistance = [...rows.values()].map((r) => {
      const km =
        at.lat !== null && at.lng !== null && r.lat !== null && r.lng !== null
          ? haversineKm(at.lat, at.lng, r.lat, r.lng)
          : null;
      return { r, km };
    });

    return withDistance
      .filter(({ km }) => km === null || km <= withinKm)
      .sort((a, b) => b.r.publishedOn.getTime() - a.r.publishedOn.getTime())
      .slice(0, limit)
      .map(({ r, km }) => toIncident(r, km));
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

function toIncident(r: Row, km: number | null): NewsIncident {
  return {
    id: r.id,
    sourceKey: r.source.key,
    sourceName: r.source.name,
    url: r.url,
    headline: r.headline,
    standfirst: r.standfirst,
    imageUrl: r.imageUrl,
    author: r.author,
    publishedOn: r.publishedOn.toISOString().slice(0, 10),
    crimeType: r.crimeType,
    places: r.places,
    distanceKm: km === null ? null : Math.round(km * 10) / 10,
  };
}

/**
 * Does either list of place names name the station's town?
 *
 * ⚠️ WHOLE-TOKEN, NOT SUBSTRING. "Brits" inside "British High Commission" is
 * the failure this prevents, and it is not hypothetical — a national title
 * writes that sentence several times a year.
 */
export function namesTouch(names: readonly string[], station: string): boolean {
  const want = station.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (want.length < 3) return false;
  return names.some((n) => {
    const has = ` ${n.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim()} `;
    return has.includes(` ${want} `);
  });
}

/**
 * The Google News query for a precinct.
 *
 * ⚠️ THE CRIME TERMS ARE PART OF THE QUERY, not a filter afterwards. Google
 * News returns thirty items for a town name and twenty-eight of them are
 * municipal notices; asking for the crime words is what makes one request
 * enough. The model still decides what is actually a crime.
 */
export function crimeSearch(where: string): string {
  return `${where} (robbery OR hijacking OR murder OR burglary OR shooting)`;
}

function monthsAgo(months: number, now = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

/**
 * What the motivation writer receives about the chosen clippings — one plain
 * line each, naming the paper, the date and the headline, so a citation in
 * the document can be checked against the annexure it points at.
 */
export function clippingFactLines(clips: readonly NewsIncident[]): string[] {
  return clips.map(
    (c, i) =>
      `Press clipping ${i + 1}: ${c.sourceName}, ${c.publishedOn} — "${c.headline}"` +
      (c.standfirst ? ` — ${c.standfirst}` : '') +
      (c.crimeType ? ` [${c.crimeType}]` : '') +
      (c.places.length ? ` (${c.places.join(', ')})` : ''),
  );
}
