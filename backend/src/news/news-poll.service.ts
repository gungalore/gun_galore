import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { LlmService } from '../common/llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseFeed, type FeedItem } from './feed-parse';
import { cachedPlace } from './news-place';
import { fetchTextCapped, getArticlePage } from './news-http';
import { GOOGLE_NEWS_KEY, NEWS_SOURCES, googleNewsUrl } from './news-sources';
import { looksLikeCrime } from './crime-words';
import { parseSharePreview, readHead } from './share-preview';
import {
  NEWS_CRIME_TYPES,
  NEWS_TAG_SCHEMA,
  type NewsCrimeType,
  type NewsPollOutcome,
} from './news.types';

// ────────────────────────────────────────────────────────────────────
// THE NIGHTLY POLL.
//
// Fetch every registered feed, keep what is new, ask each publisher for its
// own share card, decide what is crime, put it on the map, and delete
// everything older than a year. In that order, and each stage tolerant of the
// one before it failing.
//
// ⚠️ NOTHING HERE MAY THROW INTO THE CRON — the same rule as
// crime-stats-fetch.service.ts, for the same reason: an unhandled rejection
// out of a @Cron logs a fatal at three in the morning for a job nobody is
// waiting on. Every source is caught, counted and logged as one line.
//
// ⚠️ THE ARTICLE ROW IS WRITTEN BEFORE IT IS ENRICHED OR TAGGED, on purpose.
// The url index is the dedupe key, so a run that dies half way must leave
// behind the rows it already saw — otherwise the next run re-fetches every
// article page it already read. An un-tagged row (taggedAt null) is picked up
// by the NEXT run automatically, which is also how a night with no model key
// heals itself.
// ────────────────────────────────────────────────────────────────────

/** Twelve months — the operator's limit on how old a clipping may be. */
export const RETENTION_MONTHS = 12;

/** How many feeds are in flight at once. Politeness, not throughput. */
const SOURCE_CONCURRENCY = 5;
/** How many article pages are read at once, within one source. */
const ENRICH_CONCURRENCY = 4;

/** ⚠️ 20 per model call — the operator's number. Cheap and easy to verify. */
const TAG_BATCH = 20;
/** A ceiling on one night's tagging, so a backlog cannot become a bill. */
const MAX_TAG_ITEMS = 600;

/** A Google News query is not re-run inside this window. */
const SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;

const TAG_SYSTEM = [
  'You are reading South African local newspaper share previews.',
  'For each numbered item you are given a headline and, sometimes, a standfirst.',
  'Decide whether the item reports a specific CRIME INCIDENT in South Africa.',
  'isCrime is true only for a reported incident, arrest, court appearance or',
  'sentencing arising from one. It is false for sport, politics, weather,',
  'road accidents with no crime alleged, opinion, crime statistics with no',
  'incident, and for national policy pieces about crime.',
  'crimeType must be one of: ' + NEWS_CRIME_TYPES.join(', ') + '.',
  'places lists the South African place names PRINTED in the text — suburb,',
  'town or road — exactly as printed, most specific first. Never infer a',
  'place that is not written down, and never add a province that is not there.',
  'Answer for every index you were given, and only those.',
].join(' ');

interface SourceRow {
  id: string;
  key: string;
  name: string;
  feedUrl: string;
  province: string;
  district: string | null;
  towns: string[];
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  kind: string;
}

export interface PollOptions {
  /** Stop after this many sources — the smoke test's lever. */
  maxSources?: number;
  /** Only these registry keys. */
  sourceKeys?: string[];
}

@Injectable()
export class NewsPollService {
  private readonly logger = new Logger(NewsPollService.name);

  /**
   * ⚠️ ONE RUN AT A TIME, single-process. The admin "Poll now" button and the
   * 02:50 cron can land together and two runs of the same feed race each
   * other into the unique url index. This box runs one pm2 instance, which is
   * what makes a flag sufficient; a second instance would want an advisory
   * lock. Same reasoning, same shape as CrimeStatsFetchService.
   */
  private running = false;

  /**
   * Google News queries already run, and when. ⚠️ IN MEMORY, so a restart
   * re-runs a query — which costs one feed fetch and inserts nothing, because
   * the url index deduplicates. A table for this would be a table nobody ever
   * reads.
   */
  private readonly searchedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /**
   * 02:50 — after the 02:00 pg_dump window and before anybody is awake.
   * ⚠️ Server time is SAST; every other cron in this repo is written that way.
   */
  @Cron('50 2 * * *', { name: 'news-poll' })
  async nightly(): Promise<void> {
    try {
      const out = await this.runNow();
      this.logger.log(
        `news poll: ${out.sourcesOk}/${out.sourcesTried} sources, ${out.itemsNew} new, ` +
          `${out.previewsFound} previews, ${out.itemsTagged} tagged, ${out.crimeItems} crime, ` +
          `${out.deleted} expired`,
      );
    } catch (err) {
      // Belt and braces: runNow already catches everything per source.
      this.logger.error(`news poll failed: ${(err as Error).message}`);
    }
  }

  async runNow(opts: PollOptions = {}): Promise<NewsPollOutcome> {
    const out: NewsPollOutcome = {
      sourcesTried: 0,
      sourcesOk: 0,
      sourcesFailed: 0,
      itemsSeen: 0,
      itemsNew: 0,
      previewsFound: 0,
      itemsTagged: 0,
      crimeItems: 0,
      deleted: 0,
      messages: [],
    };
    if (this.running) {
      out.messages.push('a poll is already running — skipped');
      return out;
    }
    this.running = true;
    try {
      await this.syncRegistry();

      const sources = await this.pollableRows(opts);
      out.sourcesTried = sources.length;

      await mapLimit(sources, SOURCE_CONCURRENCY, async (src) => {
        const line = await this.pollSource(src, out);
        out.messages.push(line);
        this.logger.log(line);
      });

      const tagged = await this.tagPending();
      out.itemsTagged = tagged.tagged;
      out.crimeItems = tagged.crime;

      out.deleted = await this.retain();
      return out;
    } finally {
      this.running = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // REGISTRY
  // ══════════════════════════════════════════════════════════════════

  /**
   * Bring the DB copy in line with the checked-in table.
   *
   * ⚠️ lat/lng, enabled, lastError and itemCount ARE NOT TOUCHED. They are the
   * poll's own bookkeeping, not the registry's — an upsert that reset them
   * would re-geocode every centre nightly and un-disable a feed an operator
   * had turned off.
   */
  async syncRegistry(): Promise<void> {
    for (const s of NEWS_SOURCES) {
      const shared = {
        name: s.name,
        homepage: s.homepage,
        feedUrl: s.feedUrl,
        province: s.province,
        district: s.district,
        towns: s.towns,
        radiusKm: s.radiusKm,
        kind: s.kind,
      };
      await this.prisma.newsSource.upsert({
        where: { key: s.key },
        create: { key: s.key, ...shared },
        update: shared,
      });
    }
  }

  private async pollableRows(opts: PollOptions): Promise<SourceRow[]> {
    const rows = (await this.prisma.newsSource.findMany({
      where: {
        enabled: true,
        // ⚠️ The search template is NOT a feed. Fetching it verbatim would
        // ask Google News for the literal string "{q}".
        kind: { not: 'google-news' },
        ...(opts.sourceKeys?.length ? { key: { in: opts.sourceKeys } } : {}),
      },
      orderBy: { key: 'asc' },
      select: SOURCE_SELECT,
    })) as SourceRow[];
    return opts.maxSources ? rows.slice(0, opts.maxSources) : rows;
  }

  // ══════════════════════════════════════════════════════════════════
  // ONE SOURCE
  // ══════════════════════════════════════════════════════════════════

  private async pollSource(src: SourceRow, out: NewsPollOutcome): Promise<string> {
    try {
      await this.ensureCentre(src);

      const xml = await fetchTextCapped(src.feedUrl);
      const items = parseFeed(xml);
      out.itemsSeen += items.length;
      if (items.length === 0) throw new Error('feed parsed to zero items');

      const fresh = items.filter((i) => withinWindow(i.publishedOn));
      const added = await this.ingest(src, fresh, out);

      await this.prisma.newsSource.update({
        where: { id: src.id },
        data: {
          lastPolledAt: new Date(),
          lastError: null,
          itemCount: { increment: added },
        },
      });
      out.sourcesOk += 1;
      return `${src.key}: ${items.length} items, ${added} new`;
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      out.sourcesFailed += 1;
      await this.prisma.newsSource
        .update({
          where: { id: src.id },
          data: { lastPolledAt: new Date(), lastError: message },
        })
        .catch(() => undefined);
      return `${src.key}: FAILED — ${message}`;
    }
  }

  /**
   * The source's coverage centre, geocoded once and cached in NewsPlace.
   *
   * ⚠️ A NULL CENTRE IS NOT AN ERROR. With no Maps key — the ordinary state
   * of a developer's machine — every source stays at null and matching falls
   * back to district and town names. The feature degrades; it does not break.
   */
  private async ensureCentre(src: SourceRow): Promise<void> {
    if (src.lat !== null && src.lng !== null) return;
    const town = src.towns[0];
    if (!town) return;
    const at = await this.place(`${town}, ${src.province}, South Africa`, town);
    if (!at) return;
    src.lat = at.lat;
    src.lng = at.lng;
    await this.prisma.newsSource.update({
      where: { id: src.id },
      data: { lat: at.lat, lng: at.lng },
    });
  }

  /** New rows for the items we have not seen, each enriched best-effort. */
  private async ingest(
    src: SourceRow,
    items: FeedItem[],
    out: NewsPollOutcome,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const urls = items.map((i) => i.url);
    const existing = new Set(
      (
        await this.prisma.newsArticle.findMany({
          where: { url: { in: urls } },
          select: { url: true },
        })
      ).map((r) => r.url),
    );
    const wanted = items.filter((i) => !existing.has(i.url));

    let added = 0;
    await mapLimit(wanted, ENRICH_CONCURRENCY, async (item) => {
      const preview = await this.preview(item.url);
      if (preview) out.previewsFound += 1;
      // The masthead comes off whichever title we end up using, and both
      // names are tried: the feed's <source> (Google News) and the
      // registry's own (a WordPress og:title tab suffix).
      const headline = stripSourceSuffix(
        stripSourceSuffix(preview?.title ?? item.title, item.sourceName),
        src.name,
      );

      // ⚠️ THE FEED IS THE FLOOR, THE SHARE CARD IS THE CEILING. Enrichment
      // can only ADD — a publisher with no og: tags still yields a clipping
      // with the feed's own headline, summary and date.
      const created = await this.prisma.newsArticle
        .create({
          data: {
            sourceId: src.id,
            url: item.url,
            urlHash: createHash('sha256').update(item.url).digest('hex'),
            headline,
            standfirst: preview?.description ?? item.summary,
            imageUrl: preview?.image ?? item.imageUrl,
            author: preview?.author ?? item.author,
            publishedOn:
              preview?.publishedTime ?? item.publishedOn ?? new Date(),
            places: [],
            lat: src.lat,
            lng: src.lng,
          },
          select: { id: true },
        })
        // A concurrent run or a feed that lists the same link twice: the
        // unique index is doing its job, and there is nothing to report.
        .catch(() => null);
      if (created) {
        added += 1;
        out.itemsNew += 1;
      }
    });
    return added;
  }

  /** The publisher's own share card, or null when there isn't one. */
  private async preview(url: string) {
    try {
      const res = await getArticlePage(url);
      const head = await readHead(res);
      const card = parseSharePreview(head);
      return card.title || card.description || card.image ? card : null;
    } catch {
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // TAGGING
  // ══════════════════════════════════════════════════════════════════

  /**
   * Everything not yet tagged, including leftovers from an earlier run.
   *
   * The keyword pre-filter settles most of it for free: an item with no crime
   * word is written straight to isCrime=false, taggedAt=now and never costs a
   * token. Only what survives the filter is sent to the model.
   */
  async tagPending(limit = MAX_TAG_ITEMS): Promise<{ tagged: number; crime: number }> {
    const pending = await this.prisma.newsArticle.findMany({
      where: { taggedAt: null, publishedOn: { gte: windowStart() } },
      orderBy: { publishedOn: 'desc' },
      take: limit,
      select: {
        id: true,
        headline: true,
        standfirst: true,
        lat: true,
        lng: true,
        source: { select: { province: true, lat: true, lng: true } },
      },
    });
    if (pending.length === 0) return { tagged: 0, crime: 0 };

    const maybe = pending.filter((a) => looksLikeCrime(a.headline, a.standfirst));
    const no = pending.filter((a) => !looksLikeCrime(a.headline, a.standfirst));

    if (no.length) {
      await this.prisma.newsArticle.updateMany({
        where: { id: { in: no.map((a) => a.id) } },
        data: { isCrime: false, taggedAt: new Date() },
      });
    }

    if (!this.llm.isConfigured()) {
      // ⚠️ LEAVE THEM PENDING. Writing isCrime=false because we could not ask
      // would bury real clippings permanently under a missing API key.
      this.logger.warn(
        `news tagging skipped: no model configured (${maybe.length} items left pending)`,
      );
      return { tagged: no.length, crime: 0 };
    }

    let crime = 0;
    let tagged = no.length;
    for (let i = 0; i < maybe.length; i += TAG_BATCH) {
      const batch = maybe.slice(i, i + TAG_BATCH);
      const verdicts = await this.askModel(batch);
      for (const [idx, v] of verdicts) {
        const article = batch[idx];
        if (!article) continue;
        const at =
          v.isCrime && v.places[0]
            ? await this.place(
                placeQuery(v.places[0], article.source.province),
                v.places[0],
              )
            : null;
        await this.prisma.newsArticle.update({
          where: { id: article.id },
          data: {
            isCrime: v.isCrime,
            crimeType: v.isCrime ? v.crimeType : null,
            places: v.places.slice(0, 6),
            lat: at?.lat ?? article.lat ?? article.source.lat,
            lng: at?.lng ?? article.lng ?? article.source.lng,
            taggedAt: new Date(),
          },
        });
        tagged += 1;
        if (v.isCrime) crime += 1;
      }
    }
    return { tagged, crime };
  }

  /**
   * One batched verdict call.
   *
   * ⚠️ THE MODEL IS GIVEN THE HEADLINE AND STANDFIRST AND NOTHING ELSE — no
   * URL, no publisher, no date. Those would let it answer from what it
   * recognises rather than from what it was shown, and a clipping's whole
   * worth is that its type can be checked against the text printed on it.
   */
  private async askModel(
    batch: { headline: string; standfirst: string | null }[],
  ): Promise<[number, { isCrime: boolean; crimeType: NewsCrimeType | null; places: string[] }][]> {
    const payload = batch.map((a, index) => ({
      index,
      headline: a.headline,
      standfirst: a.standfirst ?? '',
    }));
    try {
      const res = await this.llm.complete({
        system: TAG_SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        maxTokens: 4_000,
        temperature: 0,
        json: { schema: NEWS_TAG_SCHEMA as unknown as Record<string, unknown> },
        // A verdict has nothing to reason about at length, and the budget
        // would be billed as output on every one of ~120 items a night.
        thinking: { budgetTokens: 0 },
        purpose: 'news.tag',
        timeoutMs: 90_000,
      });
      return readVerdicts(res.text, batch.length);
    } catch (err) {
      this.logger.warn(`news tag batch failed: ${(err as Error).message}`);
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // GOOGLE NEWS FALLBACK
  // ══════════════════════════════════════════════════════════════════

  /**
   * Run one Google News search and store what it finds as ordinary articles.
   *
   * ⚠️ THIS IS THE ONLY PATH THAT FETCHES AT REQUEST TIME, and it exists
   * because a rural precinct has no local paper — Google News is the only
   * place a Hoedspruit hijacking is indexed at all. Returns the number of new
   * rows; the caller re-queries rather than reading a return value, so a
   * search that finds nothing simply leaves the answer as it was.
   *
   * ⚠️ THE STORED URL IS GOOGLE'S REDIRECT, not the publisher's. Enrichment
   * usually fails on it (Google answers a consent interstitial), so these
   * clippings often carry the feed's headline and no picture. That is honest:
   * the headline, the paper and the date are still the publisher's own.
   */
  async ingestSearch(query: string): Promise<number> {
    const key = query.trim().toLowerCase();
    const last = this.searchedAt.get(key);
    if (last && Date.now() - last < SEARCH_CACHE_MS) return 0;
    this.searchedAt.set(key, Date.now());

    const src = (await this.prisma.newsSource.findUnique({
      where: { key: GOOGLE_NEWS_KEY },
      select: SOURCE_SELECT,
    })) as SourceRow | null;
    if (!src) return 0;

    try {
      const xml = await fetchTextCapped(googleNewsUrl(query, src.feedUrl));
      const items = parseFeed(xml).filter((i) => withinWindow(i.publishedOn));
      const out: NewsPollOutcome = blankOutcome();
      const added = await this.ingest(src, items, out);
      if (added > 0) await this.tagPending(TAG_BATCH * 3);
      return added;
    } catch (err) {
      this.logger.warn(`google news search failed: ${(err as Error).message}`);
      return 0;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PLACES AND RETENTION
  // ══════════════════════════════════════════════════════════════════

  /** A place name's coordinates — see news-place.ts; cached forever. */
  private place(query: string, cacheName: string) {
    return cachedPlace(this.prisma, query, cacheName);
  }

  /**
   * Delete everything older than the window.
   *
   * ⚠️ THE WINDOW IS THE PRODUCT, not a storage policy. The operator's rule is
   * "the past year as a limit", so an article outside it can never appear in
   * a pack — keeping it would only mean a stale row that a future widening of
   * the query could silently surface.
   */
  async retain(): Promise<number> {
    const res = await this.prisma.newsArticle.deleteMany({
      where: { publishedOn: { lt: windowStart() } },
    });
    return res.count;
  }
}

// ─── module-scope helpers, so the specs can reach them ───────────────

const SOURCE_SELECT = {
  id: true,
  key: true,
  name: true,
  feedUrl: true,
  province: true,
  district: true,
  towns: true,
  lat: true,
  lng: true,
  radiusKm: true,
  kind: true,
} as const;

/** The oldest publication date a clipping may carry. */
export function windowStart(months = RETENTION_MONTHS, now = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * ⚠️ AN ITEM WITH NO DATE IS KEPT. A feed that omits pubDate is not evidence
 * the article is old, and the row falls back to now() — which is the only
 * honest reading of "the publisher just listed it".
 */
export function withinWindow(when: Date | null, months = RETENTION_MONTHS): boolean {
  if (!when) return true;
  return when >= windowStart(months) && when.getTime() <= Date.now() + 86_400_000;
}

/**
 * "Three held after Brits farm attack - Rekord" → "Three held after Brits
 * farm attack", and "CCTV leads to arrest | Southern Courier" likewise.
 *
 * ⚠️ TWO SEPARATE PUBLISHERS DO THIS FOR TWO REASONS and both land on the
 * clipping: Google News appends " - <paper>" to every headline in its feed,
 * and most WordPress sites append " | <paper>" to og:title for the browser
 * tab. Printed under a masthead that already says which paper it is, the
 * repetition reads as a mistake.
 *
 * ⚠️ ONLY EVER THE EXACT PUBLISHER NAME WE HOLD — never a pattern. A real
 * headline may legitimately end in a dash and a phrase ("Man held - police
 * confirm"), and a greedy rule would cut it off.
 */
const MASTHEAD_SEPARATORS = [' - ', ' | ', ' – ', ' — ', ' · '];

export function stripSourceSuffix(title: string, sourceName: string | null): string {
  if (!sourceName?.trim()) return title;
  const lower = title.toLowerCase();
  for (const sep of MASTHEAD_SEPARATORS) {
    const suffix = `${sep}${sourceName}`.toLowerCase();
    if (lower.endsWith(suffix) && title.length > suffix.length) {
      return title.slice(0, -suffix.length).trim();
    }
  }
  return title;
}

/** A place with its province, unless the source is national. */
export function placeQuery(place: string, province: string): string {
  return province && province !== 'National'
    ? `${place}, ${province}, South Africa`
    : `${place}, South Africa`;
}

/**
 * Read the model's answer.
 *
 * ⚠️ INDEX-CHECKED AND CLAMPED. A verdict for an index we did not ask about
 * is dropped, a duplicate index keeps the first answer, and an unknown
 * crimeType becomes 'other' rather than a string nobody downstream expects.
 * The model is right nearly always; "nearly" is what this guards.
 */
export function readVerdicts(
  text: string,
  size: number,
): [number, { isCrime: boolean; crimeType: NewsCrimeType | null; places: string[] }][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const out = new Map<
    number,
    { isCrime: boolean; crimeType: NewsCrimeType | null; places: string[] }
  >();
  for (const raw of items) {
    const r = raw as {
      index?: unknown;
      isCrime?: unknown;
      crimeType?: unknown;
      places?: unknown;
    };
    const index = typeof r.index === 'number' ? r.index : Number.NaN;
    if (!Number.isInteger(index) || index < 0 || index >= size) continue;
    if (out.has(index)) continue;
    const isCrime = r.isCrime === true;
    const type =
      typeof r.crimeType === 'string' &&
      (NEWS_CRIME_TYPES as readonly string[]).includes(r.crimeType)
        ? (r.crimeType as NewsCrimeType)
        : null;
    out.set(index, {
      isCrime,
      crimeType: isCrime ? (type ?? 'other') : null,
      places: Array.isArray(r.places)
        ? r.places.filter((p): p is string => typeof p === 'string' && !!p.trim())
        : [],
    });
  }
  return [...out.entries()];
}

function blankOutcome(): NewsPollOutcome {
  return {
    sourcesTried: 0,
    sourcesOk: 0,
    sourcesFailed: 0,
    itemsSeen: 0,
    itemsNew: 0,
    previewsFound: 0,
    itemsTagged: 0,
    crimeItems: 0,
    deleted: 0,
    messages: [],
  };
}

/** Run `fn` over `items`, at most `limit` at a time, in order of completion. */
export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      await fn(next);
    }
  });
  await Promise.all(workers);
}
