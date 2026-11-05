/**
 * Turn the three LawLibrary text exports into section-level provisions.
 *
 * PURE. No Prisma, no filesystem, no clock — so the parser can be tested
 * against a handful of representative lines without a database.
 *
 * ⚠️ THE SOURCES ARE OCR EXPORTS, NOT CLEAN XML. Page furniture is stripped,
 * but the words inside a section are left exactly as printed. The corpus is for
 * finding the law and quoting the hand-proofread sections in
 * motivation-statute.ts. It is not a substitute for checking the Gazette.
 */

export type LegalDocumentType = 'ACT' | 'REGULATIONS' | 'AMENDMENT_ACT';

export interface ParsedProvision {
  documentType: LegalDocumentType;
  chapter: string | null;
  part: string | null;
  sectionNumber: string;
  heading: string | null;
  citation: string;
  ordinal: number;
  text: string;
}

export interface LegalSourceSpec {
  slug: string;
  title: string;
  shortTitle: string;
  citation: string;
  documentType: LegalDocumentType;
  version: string;
  effectiveDate: string | null;
  licence: string;
  sourceUrl: string | null;
  sourcePath: string;
}

export interface ParsedSource {
  spec: LegalSourceSpec;
  provisions: ParsedProvision[];
}

const PAGE_FURNITURE: RegExp[] = [
  /^By LawLibrary,.*$/i,
  /^Firearms Control Regulations, 2004.*South Africa$/i,
  /^Firearms Control Act, 2000.*South Africa$/i,
  /^GOVERNMENT GAZETTE.*$/i,
  /^No\.\s*\d+.*$/i,
  /^Vol\.\s*\d+.*$/i,
  /^Act No\.\s*\d+.*$/i,
  /^THE PRESIDENCY$/i,
  /^AIDS HELPLINE:.*$/i,
  /^View online$/i,
  /^About this collection$/i,
  /^This is a free download.*$/i,
  /^www\.lawlibrary.*$/i,
  /^FRBR URI:.*$/i,
  /^This PDF is licensed.*$/i,
  /^\d{1,4}$/,
  /^[ivxlcdm]{1,6}$/i,
];

function cleanLines(raw: string): string[] {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      return !PAGE_FURNITURE.some((re) => re.test(t));
    });
}

function cleanHeading(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value
    .replace(/\s+\d{1,3}$/, '')
    .replace(/^[\s.:;-]+|[\s.:;-]+$/g, '')
    .trim();
  if (!t) return null;
  if (/^(chapter|part)\b/i.test(t)) return null;
  if (t.length > 180) return null;
  return t;
}

function chapterFrom(line: string): string | null {
  const m = /^\s*CHAPTER\s+([0-9]+[A-Z]?)\b(.*)$/i.exec(line);
  if (!m) return null;
  const title = cleanHeading(m[2]);
  return title ? `Chapter ${m[1]} — ${title}` : `Chapter ${m[1]}`;
}

function partFrom(line: string): string | null {
  const m = /^\s*PART\s+([0-9]+[A-Z]?|[tT])\b(.*)$/i.exec(line);
  if (!m) return null;
  const title = cleanHeading(m[2]);
  return title ? `Part ${m[1]} — ${title}` : `Part ${m[1]}`;
}

function bodyStart(lines: string[], type: LegalDocumentType): number {
  if (type === 'REGULATIONS') {
    const i = lines.findIndex((l) => /^Chapter\s+1\s*$/.test(l.trim()));
    return i >= 0 ? i : 0;
  }
  if (type === 'AMENDMENT_ACT') {
    const i = lines.findIndex((l) =>
      /^Amendment of section 1 of Act/i.test(l.trim()),
    );
    return i >= 0 ? i : 0;
  }
  const i = lines.findIndex((l) => /IT THEREFORE ENACTED/i.test(l));
  return i >= 0 ? i + 1 : 0;
}

function bodyEnd(
  lines: string[],
  type: LegalDocumentType,
  start: number,
): number {
  if (type === 'REGULATIONS') {
    const i = lines.findIndex(
      (l, index) => index > start && /^Annexure A\b/i.test(l.trim()),
    );
    return i >= 0 ? i : lines.length;
  }
  if (type === 'AMENDMENT_ACT') {
    const i = lines.findIndex(
      (l, index) =>
        index > start && /^Short title and commencement/i.test(l.trim()),
    );
    return i >= 0 ? i : lines.length;
  }
  const i = lines.findIndex(
    (l, index) => index > start && /^SCHEDULE 1\b/i.test(l.trim()),
  );
  return i >= 0 ? i : lines.length;
}

/**
 * Parse one source.
 *
 * Section starts are `12.` / `16A.` at the beginning of a line. Subsection
 * numbers are `(1)` and never match, which is what keeps a section whole.
 */
export function parseLegalSource(
  raw: string,
  spec: LegalSourceSpec,
): ParsedSource {
  const lines = cleanLines(raw);
  const start = bodyStart(lines, spec.documentType);
  const end = bodyEnd(lines, spec.documentType, start);
  const body = lines.slice(start, end);

  const provisions: ParsedProvision[] = [];
  let chapter: string | null = null;
  let part: string | null = null;
  let current: {
    number: string;
    heading: string | null;
    lines: string[];
  } | null = null;

  const finish = () => {
    if (!current) return;
    const text = current.lines.join('\n').trim();
    if (!text) {
      current = null;
      return;
    }
    const sectionNumber = current.number;
    provisions.push({
      documentType: spec.documentType,
      chapter,
      part,
      sectionNumber,
      heading: current.heading,
      citation:
        spec.documentType === 'REGULATIONS'
          ? `${spec.citation} reg ${sectionNumber}`
          : `${spec.citation} s ${sectionNumber}`,
      ordinal: provisions.length,
      text,
    });
    current = null;
  };

  for (let i = 0; i < body.length; i += 1) {
    const line = body[i];
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) current.lines.push('');
      continue;
    }

    const ch = chapterFrom(trimmed);
    if (ch) {
      finish();
      let title: string | null = null;
      for (let j = i + 1; j < body.length; j += 1) {
        const next = body[j].trim();
        if (!next) continue;
        if (/^\d+[A-Z]?\./.test(next) || /^(CHAPTER|PART)\b/i.test(next)) {
          break;
        }
        title = cleanHeading(next);
        break;
      }
      chapter = title && !ch.includes(' — ') ? `${ch} — ${title}` : ch;
      part = null;
      continue;
    }
    const pt = partFrom(trimmed);
    if (pt) {
      finish();
      let title: string | null = null;
      for (let j = i + 1; j < body.length; j += 1) {
        const next = body[j].trim();
        if (!next) continue;
        if (/^\d+[A-Z]?\./.test(next) || /^(CHAPTER|PART)\b/i.test(next)) {
          break;
        }
        title = cleanHeading(next);
        break;
      }
      part = title && !pt.includes(' — ') ? `${pt} — ${title}` : pt;
      continue;
    }

    const section = /^(\d+[A-Z]?|\$\d+|\d+\}|A\d+)[.,]\s*(.*)$/.exec(trimmed);
    if (section) {
      finish();
      const number = section[1]
        .replace(/^\$/, '8')
        .replace(/\}$/, '1')
        .replace(/^A(\d+)$/, '4$1');
      const rest = section[2].trim();
      let heading: string | null = null;
      let headingFromRest = false;

      if (spec.documentType === 'REGULATIONS') {
        // "2. General provisions relating to accreditation" — heading is on
        // the same line; the body starts at the next "(1)".
        if (rest && !/^\(/.test(rest)) {
          heading = cleanHeading(rest);
          headingFromRest = Boolean(heading);
        }
        if (!heading) {
          for (let j = i - 1; j >= 0; j -= 1) {
            const prev = cleanHeading(body[j].trim());
            if (prev) {
              heading = prev;
              break;
            }
          }
        }
      } else {
        // The Act and the amendment print the title on the line ABOVE:
        // "Application for competency certificate" then "9. (1) ...".
        for (let j = i - 1; j >= 0; j -= 1) {
          const prev = body[j].trim();
          if (!prev) continue;
          if (/^(CHAPTER|PART)\b/i.test(prev)) break;
          const candidate = cleanHeading(prev);
          if (candidate) {
            heading = candidate;
            break;
          }
        }
        if (!heading && rest && !/^\(/.test(rest)) {
          heading = cleanHeading(rest);
          headingFromRest = Boolean(heading);
        }
      }

      current = {
        number,
        heading,
        lines: headingFromRest ? [] : [rest].filter(Boolean),
      };
      continue;
    }

    if (current) current.lines.push(trimmed);
  }
  finish();

  return { spec, provisions };
}

export function legalSourceSpecs(): LegalSourceSpec[] {
  return [
    {
      slug: 'firearms-control-act-60-2000',
      title: 'Firearms Control Act 60 of 2000',
      shortTitle: 'FCA',
      citation: 'Firearms Control Act 60 of 2000',
      documentType: 'ACT',
      version: 'as enacted, 10 April 2001',
      effectiveDate: '2001-04-10',
      licence: 'CC BY-NC-SA 4.0',
      sourceUrl: 'https://www.lawlibrary.org.za',
      sourcePath: 'data/legal/firearms-control-act-2000.txt',
    },
    {
      slug: 'firearms-control-regulations-2004',
      title: 'Firearms Control Regulations, 2004 (GN R345 of 2004)',
      shortTitle: 'FCR',
      citation: 'Firearms Control Regulations 2004 (GN R345 of 2004)',
      documentType: 'REGULATIONS',
      version: 'as at 9 March 2020',
      effectiveDate: '2004-01-01',
      licence: 'CC BY-NC-SA 4.0',
      sourceUrl: 'https://www.lawlibrary.org.za',
      sourcePath: 'data/legal/firearms-control-regulations-2004.txt',
    },
    {
      slug: 'firearms-control-amendment-act-28-2006',
      title: 'Firearms Control Amendment Act 28 of 2006',
      shortTitle: 'FCAA',
      citation: 'Firearms Control Amendment Act 28 of 2006',
      documentType: 'AMENDMENT_ACT',
      version: 'as published, 22 August 2007',
      effectiveDate: '2007-08-22',
      licence: 'CC BY-NC-SA 4.0',
      sourceUrl: 'https://www.lawlibrary.org.za',
      sourcePath: 'data/legal/firearms-control-amendment-act-2006.txt',
    },
  ];
}
