import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SELF_DEFENCE_CATEGORIES,
  type CrimeStatsRelease,
  type CrimeStatsStation,
  type NearestStationResult,
  type PrecinctCategory,
  type PrecinctFigures,
  type QuarterCount,
} from './crime-stats.types';
import { addressPlaceTokens, normaliseStationName } from './station-name';
import { quarterLabel } from './parse-raw-data';

// ────────────────────────────────────────────────────────────────────
// ANSWERING "WHAT DID SAPS RECORD IN THIS PRECINCT".
//
// Everything here reads our own loaded copy of a SAPS workbook. Nothing calls
// saps.gov.za at request time, and nothing here recalls a statistic — a figure
// exists in an answer only because a named release contains it.
// ────────────────────────────────────────────────────────────────────

/** Google is asked to look 15 km out. Rural precincts are large. */
const NEAREST_RADIUS_M = 15_000;
/** Both Google calls. A member is waiting; a slow answer is no answer. */
const GOOGLE_TIMEOUT_MS = 8_000;
const MAX_CANDIDATES = 5;
/** Stations change about once a year. Ten minutes is generous. */
const STATION_CACHE_MS = 10 * 60 * 1000;

interface StationRow {
  id: string;
  name: string;
  district: string;
  province: string;
}

@Injectable()
export class CrimeStatsService {
  private readonly logger = new Logger(CrimeStatsService.name);

  /**
   * ⚠️ The whole station table is ~1 174 rows and the nearest-station lookup
   * has to compare Google's spelling against every one of them. That is a
   * normalise-and-scan, not a query, so the table is cached rather than
   * re-read per request.
   */
  private stationCache: { at: number; rows: StationRow[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ─── releases ──────────────────────────────────────────────────────

  /**
   * The newest release we have fully loaded.
   *
   * ⚠️ 'ready' ONLY. A 'loading' row is a half-inserted release, and a
   * precinct answered from one is a number that is quietly too small.
   */
  async latestRelease(): Promise<CrimeStatsRelease | null> {
    const row = await this.prisma.crimeStatsRelease.findFirst({
      where: { status: 'ready' },
      orderBy: [{ latestPeriod: 'desc' }, { fetchedAt: 'desc' }],
    });
    return row ? toRelease(row) : null;
  }

  // ─── station search ────────────────────────────────────────────────

  /**
   * Free-text station search. Name first, then district — a member who types
   * "Tshwane" should still be shown the precincts inside it.
   */
  async searchStations(q: string, limit = 10): Promise<CrimeStatsStation[]> {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const cap = Math.min(Math.max(limit, 1), 50);

    const rows = await this.prisma.crimeStatsStation.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { district: { contains: term, mode: 'insensitive' } },
        ],
      },
      // Over-fetch so the ranking below has something to rank. Without it a
      // limit of 10 could return ten district matches and hide the exact
      // name match sitting behind them.
      take: cap * 5,
      orderBy: { name: 'asc' },
    });

    const lower = term.toLowerCase();
    const rank = (s: StationRow): number => {
      const n = s.name.toLowerCase();
      if (n === lower) return 0;
      if (n.startsWith(lower)) return 1;
      if (n.includes(lower)) return 2;
      if (s.district.toLowerCase().startsWith(lower)) return 3;
      return 4;
    };
    return rows
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, cap)
      .map(toStation);
  }

  // ─── nearest station ───────────────────────────────────────────────

  /**
   * The precinct an address most likely falls in.
   *
   * ⚠️ THIS IS A BEST GUESS AND IT IS PRESENTED AS ONE. Precinct boundaries
   * are not published as polygons anywhere we can reach, so "nearest police
   * station" is a proxy for "the precinct you live in" — a good one in a
   * suburb, a poor one on a boundary. That is why up to five `candidates`
   * always come back: the member picks, we do not decide for them.
   *
   * ⚠️ NEVER THROWS, AND NEVER LOGS THE ADDRESS. A home address is the most
   * sensitive field in a self-defence motivation; it goes to Google because
   * the member asked for a lookup, and it goes nowhere else — not into a log
   * line, not into an error message.
   */
  async nearestStation(address: string): Promise<NearestStationResult> {
    const empty: NearestStationResult = {
      station: null,
      how: null,
      candidates: [],
    };
    const text = (address ?? '').trim();
    if (!text) return empty;

    const stations = await this.stations();
    if (stations.length === 0) return empty;

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      try {
        const viaPlaces = await this.nearestViaPlaces(text, key, stations);
        if (viaPlaces) return viaPlaces;
      } catch (err) {
        // The address must not appear in the log; the failure mode must.
        this.logger.warn(
          `nearest-station Places lookup failed: ${(err as Error).message}`,
        );
      }
    }

    // Fallback: the address's own place words against station names. No key,
    // no quota, no network — and for "12 Main Road, Brooklyn, Pretoria" it is
    // the right answer anyway.
    const byName = this.matchByTokens(text, stations);
    if (byName.length === 0) return empty;
    return {
      station: byName[0],
      how: 'name',
      candidates: byName.slice(0, MAX_CANDIDATES),
    };
  }

  private async nearestViaPlaces(
    address: string,
    key: string,
    stations: StationRow[],
  ): Promise<NearestStationResult | null> {
    const geo = await this.geocode(address, key);
    if (!geo) return null;

    const url = new URL(
      'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
    );
    url.searchParams.set('location', `${geo.lat},${geo.lng}`);
    url.searchParams.set('radius', String(NEAREST_RADIUS_M));
    url.searchParams.set('type', 'police');
    url.searchParams.set('key', key);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: string;
      results?: {
        name?: string;
        geometry?: { location?: { lat: number; lng: number } };
      }[];
    };
    if (!body.results?.length) return null;

    // Places ranks by prominence, which puts a provincial head office above
    // the little station round the corner. Distance is what we asked about.
    const ranked = body.results
      .map((r) => ({
        name: r.name ?? '',
        km: haversineKm(
          geo.lat,
          geo.lng,
          r.geometry?.location?.lat ?? geo.lat,
          r.geometry?.location?.lng ?? geo.lng,
        ),
      }))
      .sort((a, b) => a.km - b.km);

    // ⚠️ The province from the geocode is the disambiguator. Two provinces
    // spelling a station the same way is ordinary in South African place
    // names, and Google's name alone cannot tell them apart.
    const inProvince = geo.province
      ? stations.filter((s) => s.province === geo.province)
      : stations;
    const pool = inProvince.length > 0 ? inProvince : stations;
    const byKey = new Map<string, StationRow[]>();
    for (const s of pool) {
      const k = normaliseStationName(s.name);
      byKey.set(k, [...(byKey.get(k) ?? []), s]);
    }

    const out: CrimeStatsStation[] = [];
    const seen = new Set<string>();
    for (const r of ranked) {
      const k = normaliseStationName(r.name);
      if (!k) continue;
      for (const s of byKey.get(k) ?? []) {
        const id = `${s.name}|${s.province}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(toStation(s));
      }
      if (out.length >= MAX_CANDIDATES) break;
    }
    if (out.length === 0) return null;
    return { station: out[0], how: 'places', candidates: out };
  }

  private async geocode(
    address: string,
    key: string,
  ): Promise<{ lat: number; lng: number; province: string | null } | null> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    // South Africa only. Without it "Brooklyn" geocodes to New York.
    url.searchParams.set('region', 'za');
    url.searchParams.set('components', 'country:ZA');
    url.searchParams.set('key', key);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: {
        geometry?: { location?: { lat: number; lng: number } };
        address_components?: { long_name: string; types: string[] }[];
      }[];
    };
    const first = body.results?.[0];
    const loc = first?.geometry?.location;
    if (!loc) return null;
    const admin1 = first?.address_components?.find((c) =>
      c.types.includes('administrative_area_level_1'),
    );
    // Google spells the nine provinces exactly as SAPS does, KwaZulu-Natal
    // included, so no mapping table is needed — but an unrecognised value
    // must widen the search rather than empty it (see the caller).
    return { lat: loc.lat, lng: loc.lng, province: admin1?.long_name ?? null };
  }

  private matchByTokens(
    address: string,
    stations: StationRow[],
  ): CrimeStatsStation[] {
    const tokens = addressPlaceTokens(address);
    if (tokens.length === 0) return [];
    const out: CrimeStatsStation[] = [];
    const seen = new Set<string>();
    // Tokens arrive longest-phrase-first, so "table view" is tried before
    // "table"; exact name matches inside a token pass are taken first.
    for (const t of tokens) {
      for (const pass of [0, 1]) {
        for (const s of stations) {
          const n = normaliseStationName(s.name);
          const hit = pass === 0 ? n === t : n.startsWith(`${t} `);
          if (!hit) continue;
          const id = `${s.name}|${s.province}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(toStation(s));
          if (out.length >= MAX_CANDIDATES) return out;
        }
      }
    }
    return out;
  }

  private async stations(): Promise<StationRow[]> {
    const now = Date.now();
    if (this.stationCache && now - this.stationCache.at < STATION_CACHE_MS) {
      return this.stationCache.rows;
    }
    const rows = await this.prisma.crimeStatsStation.findMany({
      select: { id: true, name: true, district: true, province: true },
      orderBy: { name: 'asc' },
    });
    this.stationCache = { at: now, rows };
    return rows;
  }

  // ─── precinct figures ──────────────────────────────────────────────

  /**
   * Every self-defence category for one precinct, from the newest release.
   *
   * ⚠️ THE CITED RELEASE IS THE NEWEST 'ready' ONE, AND `latest` IS ALWAYS
   * ITS OWN NEWEST QUARTER. Older releases are read too — they are the only
   * source of the OTHER three calendar quarters, because one workbook carries
   * the same quarter five years running — but anything they contributed is
   * named in the category's `note`. A figure a reader cannot trace back to a
   * file is not a supplied fact.
   */
  async precinct(
    station: string,
    province?: string,
  ): Promise<PrecinctFigures | null> {
    const name = (station ?? '').trim();
    if (!name) return null;

    const release = await this.latestRelease();
    if (!release) return null;

    const row = await this.prisma.crimeStatsStation.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(province
          ? { province: { equals: province.trim(), mode: 'insensitive' } }
          : {}),
      },
      orderBy: { province: 'asc' },
    });
    if (!row) return null;

    const figures = await this.prisma.crimeStatsFigure.findMany({
      where: {
        stationId: row.id,
        category: { in: [...SELF_DEFENCE_CATEGORIES] },
        release: { status: 'ready' },
      },
      select: {
        category: true,
        period: true,
        count: true,
        release: { select: { key: true, latestPeriod: true } },
      },
    });
    if (figures.length === 0) return null;

    // (category, period) -> the value from the NEWEST release that carries
    // it. SAPS revises: a figure republished in a later workbook supersedes
    // the one we loaded from an earlier one.
    const best = new Map<
      string,
      { count: number; releaseKey: string; from: string }
    >();
    for (const f of figures) {
      const k = `${f.category} ${f.period}`;
      const prev = best.get(k);
      if (!prev || prev.from < f.release.latestPeriod) {
        best.set(k, {
          count: f.count,
          releaseKey: f.release.key,
          from: f.release.latestPeriod,
        });
      }
    }

    const categories: PrecinctCategory[] = [];
    for (const category of SELF_DEFENCE_CATEGORIES) {
      const built = buildCategory(category, best, release);
      if (built) categories.push(built);
    }
    if (categories.length === 0) return null;

    return { station: toStation(row), release, categories };
  }
}

// ─── pure helpers ────────────────────────────────────────────────────

function toStation(row: {
  name: string;
  district: string;
  province: string;
}): CrimeStatsStation {
  return { name: row.name, district: row.district, province: row.province };
}

function toRelease(row: {
  key: string;
  periodLabel: string;
  latestPeriod: string;
  fetchedAt: Date;
  sourceUrl: string;
}): CrimeStatsRelease {
  return {
    key: row.key,
    periodLabel: row.periodLabel,
    latestPeriod: row.latestPeriod,
    fetchedOn: row.fetchedAt.toISOString().slice(0, 10),
    sourceUrl: row.sourceUrl,
  };
}

/** "2026-Q1" -> { year: 2026, quarter: 1 }. */
export function splitPeriod(period: string): { year: number; quarter: number } {
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!m) throw new Error(`Not a quarter key: ${period}`);
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

/** The quarter immediately before this one. */
export function previousQuarter(period: string): string {
  const { year, quarter } = splitPeriod(period);
  return quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
}

/** The same quarter one year earlier. */
export function sameQuarterLastYearOf(period: string): string {
  const { year, quarter } = splitPeriod(period);
  return `${year - 1}-Q${quarter}`;
}

export function quarterCount(period: string, count: number): QuarterCount {
  const { year, quarter } = splitPeriod(period);
  return { period, label: quarterLabel(year, quarter), count };
}

/**
 * One category's figures.
 *
 * ⚠️ A CATEGORY WITH NO FIGURE FOR THE CITED RELEASE'S NEWEST QUARTER IS
 * OMITTED, not zeroed. SAPS renames categories between releases, and an
 * omitted line is a gap a reader can see; a zero is a claim we did not make.
 */
export function buildCategory(
  category: string,
  best: Map<string, { count: number; releaseKey: string }>,
  release: CrimeStatsRelease,
): PrecinctCategory | null {
  const at = (period: string) => best.get(`${category} ${period}`);

  // ⚠️ THE CITED RELEASE'S OWN NEWEST QUARTER, NEVER "the newest quarter we
  // happen to hold for this category". Older releases are read for the other
  // three calendar quarters, and SAPS renames categories between releases -
  // so falling back to whatever the map's newest key happened to be would
  // print a 2025 figure under a 2026 heading.
  const latestPeriod = release.latestPeriod;
  const latestHit = at(latestPeriod);
  if (!latestHit) return null;

  const lastYearPeriod = sameQuarterLastYearOf(latestPeriod);
  const lastYearHit = at(lastYearPeriod);

  // ⚠️ THE EIGHT NEWEST QUARTERS WE ACTUALLY HOLD, NOT THE EIGHT QUARTERS
  // BEFORE `latest`. One release carries the SAME calendar quarter five years
  // running, so walking back consecutively would show two entries and throw
  // away three years of the very comparison SAPS published. Newest last, and
  // the period on each entry says which quarter it is, so a gap is visible
  // rather than glossed over.
  const prefix = `${category} `;
  const recent: QuarterCount[] = [...best.keys()]
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter((p) => p <= latestPeriod)
    .sort()
    .slice(-8)
    .map((p) => quarterCount(p, at(p)!.count));

  const yearOnYearPct =
    lastYearHit && lastYearHit.count > 0
      ? ((latestHit.count - lastYearHit.count) / lastYearHit.count) * 100
      : null;

  // The four CONSECUTIVE quarters ending at the latest. See the note on
  // PrecinctCategory.note: one release cannot supply them.
  const window: string[] = [];
  let p = latestPeriod;
  for (let i = 0; i < 4; i++) {
    window.push(p);
    p = previousQuarter(p);
  }
  const present = window.map((q) => ({ q, hit: at(q) })).filter((x) => x.hit);
  const lastTwelveMonths = present.reduce((sum, x) => sum + x.hit!.count, 0);

  const otherReleases = [
    ...new Set(
      present
        .map((x) => x.hit!.releaseKey)
        .filter((k) => k !== release.key),
    ),
  ].sort();

  const notes: string[] = [];
  if (present.length < 4) {
    notes.push(
      present.length === 1
        ? `Covers ${quarterCount(latestPeriod, 0).label} only, not a full year - a SAPS workbook compares the same quarter across five years, so the other three quarters are only in earlier releases we have not loaded.`
        : `Covers ${present.length} of the four quarters to ${quarterCount(latestPeriod, 0).label}; the rest are not in any release we hold.`,
    );
  }
  if (otherReleases.length > 0) {
    notes.push(
      `Quarters before ${quarterCount(latestPeriod, 0).label} come from the ${otherReleases.join(' and ')} release${otherReleases.length > 1 ? 's' : ''}.`,
    );
  }

  return {
    category,
    latest: quarterCount(latestPeriod, latestHit.count),
    sameQuarterLastYear: lastYearHit
      ? quarterCount(lastYearPeriod, lastYearHit.count)
      : null,
    recent,
    yearOnYearPct:
      yearOnYearPct === null ? null : Math.round(yearOnYearPct * 10) / 10,
    lastTwelveMonths,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * The lines a motivation receives as SUPPLIED FACTS for a precinct — plain
 * sentences, each naming the category, the count, the period and the source,
 * so the writer can quote them and a reviewer can check them.
 *
 * ⚠️ EVERY LINE NAMES THE RELEASE OR SITS UNDER A HEADING THAT DOES, AND NO
 * LINE NAMES A PLACE THE FIGURES DO NOT. The station in the first line is the
 * station the figures were read for; nothing here interpolates a suburb, a
 * city or a province from anywhere else.
 */
export function precinctFactLines(figures: PrecinctFigures): string[] {
  const lines: string[] = [];
  const src = `SAPS quarterly crime statistics, ${figures.release.periodLabel} release`;
  lines.push(
    `Police station: ${figures.station.name} (${figures.station.district}, ${figures.station.province}). Source: ${src}.`,
  );
  for (const c of figures.categories) {
    const yoy =
      c.yearOnYearPct === null
        ? ''
        : ` (${c.yearOnYearPct >= 0 ? 'up' : 'down'} ${Math.abs(c.yearOnYearPct).toFixed(0)}% on ${c.sameQuarterLastYear?.label ?? 'the same quarter a year earlier'})`;
    // ⚠️ The twelve-month total is quoted ONLY when it is one — see
    // PrecinctCategory.note. A release on its own carries the same quarter
    // five years running, so calling that "the last four quarters" would put
    // four consecutive Januaries in a member's document as a year.
    const window = c.note
      ? ` ${c.note}`
      : ` ${c.lastTwelveMonths} over the four quarters to ${c.latest.label}.`;
    lines.push(
      `${c.category}: ${c.latest.count} recorded in ${c.latest.label}${yoy}.${window}`,
    );
  }
  return lines;
}
