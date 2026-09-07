import {
  parseSapsWorkbookLinks,
  releaseKeyFromFileName,
  SAPS_SERVICES_BASE,
} from './saps-page';

// The hrefs below are copied verbatim from the live page on 2026-09-07,
// including the two SAPS have mis-spelled ("3nd_Quarter") and the one that
// answers 404 because the release was postponed.
const PAGE = `
<a href="downloads/2026/Postponement-of-crime-statistics-release-for-the-first-quarter-letter.pdf">letter</a>
<a href="downloads/2026/2026-2027-calendar.pdf">calendar</a>
<a href="downloads/2026/2026-2027_-_1st_Quarter_WEB.pptx">presentation</a>
<a href="downloads/2026/2026-2027_-_1st_Quarter_WEB.xlsm">Q1 workbook</a>
<a href="downloads/2025/2025-2026_-_4th_Quarter_WEB.pdf">Q4 pdf</a>
<a href="downloads/2025/2025-2026_-_4th_Quarter_WEB.xlsx">Q4 workbook</a>
<a href="downloads/2025/2025-2026_-_3rd_Quarter_WEB.xlsx">Q3 workbook</a>
<a href="downloads/2023-2024_-_3nd_Quarter_WEB.pdf">a typo, and a pdf</a>
<a href="downloads/2023-2024 _Annual_WEB.pdf">annual</a>
<a href="downloads/2022-2023-Annual-Crime-Statistics-Report.pdf">annual report</a>
`;

describe('releaseKeyFromFileName', () => {
  it('reads the key SAPS put in the file name', () => {
    expect(releaseKeyFromFileName('2025-2026_-_4th_Quarter_WEB.xlsx')).toBe(
      '2025-2026-Q4',
    );
    expect(releaseKeyFromFileName('2026-2027_-_1st_Quarter_WEB.xlsm')).toBe(
      '2026-2027-Q1',
    );
  });

  it('survives the ordinal SAPS mis-spells', () => {
    // "3nd_Quarter" is on the live page. Insisting on "3rd" would hide a
    // whole release.
    expect(releaseKeyFromFileName('2023-2024_-_3nd_Quarter_WEB.xlsx')).toBe(
      '2023-2024-Q3',
    );
  });

  it('keeps SAPS numbering, which is NOT the calendar quarter', () => {
    // Their year starts in April, so their Q4 file holds January to March.
    // The calendar quarter is derived from the date headers inside the sheet,
    // never from this key.
    expect(releaseKeyFromFileName('2025-2026_-_4th_Quarter_WEB.xlsx')).toBe(
      '2025-2026-Q4',
    );
  });

  it('is null for anything that is not a quarterly release', () => {
    expect(releaseKeyFromFileName('2023-2024 _Annual_WEB.xlsx')).toBeNull();
    expect(releaseKeyFromFileName('2026-2027-calendar.pdf')).toBeNull();
  });
});

describe('parseSapsWorkbookLinks', () => {
  const links = parseSapsWorkbookLinks(PAGE);

  it('takes only the spreadsheets, never the PDFs or the presentation', () => {
    expect(links.map((l) => l.key)).toEqual([
      '2026-2027-Q1',
      '2025-2026-Q4',
      '2025-2026-Q3',
    ]);
  });

  it('resolves the href against /services/, not the site root', () => {
    // ⚠️ THE BUG THIS TEST EXISTS FOR. The page writes a href relative to
    // itself; resolved against the root every one of them is a 404.
    expect(links.find((l) => l.key === '2025-2026-Q4')!.url).toBe(
      'https://www.saps.gov.za/services/downloads/2025/2025-2026_-_4th_Quarter_WEB.xlsx',
    );
    expect(SAPS_SERVICES_BASE.endsWith('/')).toBe(true);
  });

  it('takes the .xlsm the newest release ships as', () => {
    const q1 = links.find((l) => l.key === '2026-2027-Q1')!;
    expect(q1.fileName).toBe('2026-2027_-_1st_Quarter_WEB.xlsm');
  });

  it('returns newest first, so a bounded run loads the newest releases', () => {
    expect(links[0].key).toBe('2026-2027-Q1');
  });

  it('lists each release once even when the page repeats the link', () => {
    const doubled = parseSapsWorkbookLinks(PAGE + PAGE);
    expect(doubled).toHaveLength(3);
  });

  it('returns nothing rather than throwing on a page it cannot read', () => {
    expect(parseSapsWorkbookLinks('')).toEqual([]);
    expect(parseSapsWorkbookLinks('<html>maintenance</html>')).toEqual([]);
  });
});
