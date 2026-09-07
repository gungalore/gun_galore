// ────────────────────────────────────────────────────────────────────
// READING THE SAPS CRIME-STATS PAGE.
//
// Pure string work, kept out of the fetch service so it can be tested without
// a network: given the HTML of https://www.saps.gov.za/services/crimestats.php,
// which workbooks does it offer and what do we call them?
// ────────────────────────────────────────────────────────────────────

export interface SapsWorkbookLink {
  /** Our stable release key, e.g. "2025-2026-Q4". */
  key: string;
  /** Absolute URL, ready to fetch. */
  url: string;
  /** The file name as SAPS wrote it, for the log line. */
  fileName: string;
}

const PAGE_URL = 'https://www.saps.gov.za/services/crimestats.php';

/**
 * ⚠️ THE HREFS ARE RELATIVE TO /services/, NOT TO THE SITE ROOT.
 * The page writes `href="downloads/2025/2025-2026_-_4th_Quarter_WEB.xlsx"`;
 * resolved against the root that is a 404, and resolved against the PAGE it
 * is the real file. This constant is the base the WHATWG URL resolver needs
 * and the reason it ends in a slash.
 */
export const SAPS_SERVICES_BASE = 'https://www.saps.gov.za/services/';

export const SAPS_CRIME_STATS_PAGE = PAGE_URL;

/**
 * ⚠️ A BROWSER-ISH User-Agent IS NOT OPTIONAL. saps.gov.za sits behind a
 * filter that answers a bare node fetch with a block page rather than the
 * file, and a block page saved to disk is a 1 KB "xlsx" that only fails when
 * exceljs tries to unzip it.
 */
export const SAPS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const ORDINALS: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
};

/**
 * "2025-2026_-_4th_Quarter_WEB.xlsx" -> "2025-2026-Q4".
 *
 * ⚠️ SAPS's OWN QUARTER NUMBER, NOT A CALENDAR ONE. Their financial year
 * starts in April, so their 4th quarter is January to March. We keep their
 * numbering in the key because the key's whole job is to name their file;
 * the CALENDAR quarter each figure belongs to is derived separately, from
 * the date headers inside the sheet (see parse-raw-data.ts).
 *
 * ⚠️ The ordinal suffix is matched loosely on purpose — SAPS have shipped
 * `3nd_Quarter` on this very page. Insisting on "3rd" would have hidden a
 * whole release.
 */
export function releaseKeyFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const m = /(\d{4})[-_ ]+(\d{4})\D+?(\d|first|second|third|fourth)\s*(?:st|nd|rd|th)?[-_ ]*quarter/i.exec(
    base,
  );
  if (!m) return null;
  const q = ORDINALS[m[3].toLowerCase()];
  if (!q) return null;
  return `${m[1]}-${m[2]}-Q${q}`;
}

/**
 * Every quarterly workbook the page links to, newest key first, one entry per
 * key (the page sometimes lists the same file twice).
 *
 * Annual and calendar PDFs, presentations and the postponement letters are
 * all dropped: only `.xlsx` / `.xlsm` under a `downloads/` path whose name
 * yields a quarter key survives.
 */
export function parseSapsWorkbookLinks(
  html: string,
  base = SAPS_SERVICES_BASE,
): SapsWorkbookLink[] {
  const out: SapsWorkbookLink[] = [];
  const seen = new Set<string>();
  const re = /href\s*=\s*["']([^"']*downloads\/[^"']+\.(?:xlsx|xlsm))["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    const fileName = decodeURIComponent(href.split('/').pop() ?? '');
    const key = releaseKeyFromFileName(fileName);
    if (!key || seen.has(key)) continue;
    let url: string;
    try {
      url = new URL(href.replace(/ /g, '%20'), base).toString();
    } catch {
      continue;
    }
    seen.add(key);
    out.push({ key, url, fileName });
  }
  // Newest first. The keys sort lexically into chronological order because
  // every one is "YYYY-YYYY-Qn" with fixed-width years.
  out.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return out;
}
