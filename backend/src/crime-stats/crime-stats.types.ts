// ────────────────────────────────────────────────────────────────────
// SAPS STATION-LEVEL CRIME STATISTICS — THE SHAPES THE REST OF THE APP SEES.
//
// Operator, 2026-09-07: "is it possible for us to pull the per police
// station crime stats from SAPS and keep it updated? … pull the region we
// are looking for stats in?"
//
// SAPS publishes one Excel workbook a quarter on
// https://www.saps.gov.za/services/crimestats.php. Its "RAW Data" sheet is
// station-level: one row per station per crime category (~55,000 rows, ~1,150
// stations, 48 categories), with a count for every quarter back five years.
// There is no API. We fetch the workbook when a new one appears, keep our own
// copy per release, and answer questions like "what did SAPS record in the
// Brooklyn precinct" from that copy — so a motivation cites a period and a
// release, and the citation stays true.
//
// ⚠️ EVERY FIGURE HERE IS A SUPPLIED FACT FOR THE MOTIVATION WRITER, which is
// otherwise forbidden from recalling any statistic. That is the whole point of
// holding the data ourselves: the number in the document is checkable against
// a release we can name.
// ────────────────────────────────────────────────────────────────────

export interface CrimeStatsStation {
  /** As SAPS spells it in the workbook, e.g. "Brooklyn". Unique per province. */
  name: string;
  district: string;
  province: string;
}

export interface CrimeStatsRelease {
  /** Stable key, e.g. "2025-2026-Q4". */
  key: string;
  /** The period the release's latest quarter covers, e.g. "January to March 2026". */
  periodLabel: string;
  /** ISO day the file was seen on the SAPS page. */
  fetchedOn: string;
  sourceUrl: string;
}

export interface QuarterCount {
  /** e.g. "2026-Q1" for January–March 2026 (calendar quarter). */
  period: string;
  label: string;
  count: number;
}

export interface PrecinctCategory {
  /** As SAPS names it, e.g. "Robbery at residential premises". */
  category: string;
  latest: QuarterCount;
  /** The same quarter one year earlier, when the release carries it. */
  sameQuarterLastYear: QuarterCount | null;
  /** Newest last; up to eight quarters. */
  recent: QuarterCount[];
  /** Latest vs same quarter last year; null when either is missing or zero. */
  yearOnYearPct: number | null;
  /** Sum of the four most recent quarters. */
  lastTwelveMonths: number;
}

export interface PrecinctFigures {
  station: CrimeStatsStation;
  release: CrimeStatsRelease;
  categories: PrecinctCategory[];
}

/**
 * The categories a self-defence motivation actually argues from, in the
 * order they are presented. Everything else SAPS records (stock theft,
 * commercial crime…) is available on request but not pushed at the writer.
 */
export const SELF_DEFENCE_CATEGORIES: readonly string[] = [
  'Murder',
  'Attempted murder',
  'Robbery with aggravating circumstances',
  'Robbery at residential premises',
  'Carjacking',
  'Burglary at residential premises',
  'Rape',
  'Assault with the intent to inflict grievous bodily harm',
  'Common robbery',
];

export interface NearestStationResult {
  station: CrimeStatsStation | null;
  /** How it was found: a Places lookup near the address, or a name match. */
  how: 'places' | 'name' | null;
  /** Other plausible stations, for the member to pick from instead. */
  candidates: CrimeStatsStation[];
}
