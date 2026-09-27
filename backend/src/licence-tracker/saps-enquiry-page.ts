// ────────────────────────────────────────────────────────────────────
// WHAT SAPS'S ENQUIRY PAGE SAYS, TURNED INTO SOMETHING WE CAN DIFF.
//
// ⚠️ PURE STRING PARSING. No network, no clock, no database. Everything
// that decides what a result MEANS — is this a row, is SAPS simply holding
// no record, or did we get a page we cannot read — belongs here; everything
// that decides what to DO about it belongs to the service. A parser that
// touched the network could not be tested against the four fixtures, and
// the fixtures are the only thing standing between us and a bad deploy that
// silently blanks a member's known status.
//
// ⚠️ REGEX, NOT A DOM. The backend carries no HTML parser dependency
// (cheerio / node-html-parser / parse5 are all absent) and the markup is a
// single flat table. If the fixtures ever stop covering the real page, add
// a dependency deliberately rather than growing a second, softer regex —
// a parser that half-matches is how a status gets invented.
//
// The shape being read, from the live enquiry:
//
//   <div class="pagSelMed">
//     <p>The records were updated on <b>2026-09-19</b>.</p>
//     <table>
//       <tr><th>Application Type</th> … <th>Next Step</th></tr>
//       <tr class="active">
//         <td>LICENCE</td><td>10000001</td><td>DEMO-CAL</td> … 9 cells
//       </tr>
//     </table>
//   </div>
//
// ⚠️ A BLANK CELL IS "<td> </td>", NOT "<td></td>". It is a single space,
// and it has to reach the database as null rather than as a space, or a
// competency's calibre prints as an empty-looking value that is not empty.
// ────────────────────────────────────────────────────────────────────

/** One record row, in the order the enquiry prints its nine columns. */
export interface EnquiryRow {
  applicationType: string;
  applicationNumber: string;
  calibre: string;
  make: string;
  serialNumber: string;
  /** Raw as SAPS prints it — 'YYYY/MM/DD'. The service converts to a Date. */
  statusDate: string;
  status: string;
  statusDescription: string;
  nextStep: string;
}

export interface EnquiryParseResult {
  /** The snapshot date SAPS prints, or null when the page did not carry one. */
  updatedOn: string | null;
  rows: EnquiryRow[];
  noRecords: boolean;
  /** The page's own complaint, verbatim. Present = we must NOT read this as a result. */
  validationMessage: string | null;
}

const ROW_RE =
  /<tr\b[^>]*\bclass\s*=\s*"[^"]*\bactive\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
const UPDATED_ON_RE =
  /were updated on\s*<b>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*<\/b>/i;
const NO_RECORDS_RE = /No records to retrieve/i;
// ⚠️ THE PAGE ALSO USES THIS LINE FOR A GENUINE PROMPT — "please supply a
// serial" is what it says when we sent a licence without one, AND what it
// sometimes says when it is being rate-limited and means nothing at all.
// Either way we cannot read a status out of it, so it is an error with
// backoff and never a no-records.
const VALIDATION_RE = /Please supply[^<]*/i;

/**
 * Strip tags and decode the handful of entities the page actually uses, then
 * collapse whitespace — so `<td> </td>` and `<td>&nbsp;</td>` both become ''.
 */
function cellText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read the enquiry response.
 *
 * ⚠️ THIS FUNCTION DOES NOT DECIDE WHAT THE RESULT MEANS. It reports
 * everything it saw and leaves the classification to the caller, because
 * the precedence — a row beats no-records beats an unreadable page — is a
 * policy about safety, not about markup.
 */
export function parseEnquiryResponse(html: string): EnquiryParseResult {
  const updatedOn = html.match(UPDATED_ON_RE)?.[1] ?? null;
  const noRecords = NO_RECORDS_RE.test(html);
  const validationMessage = html.match(VALIDATION_RE)?.[0]?.trim() ?? null;

  const rows: EnquiryRow[] = [];
  // Fresh lastIndex per call — a module-level /g regex keeps state between
  // calls, which is exactly how a second parse quietly returns nothing.
  ROW_RE.lastIndex = 0;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = ROW_RE.exec(html)) !== null) {
    const body = rowMatch[1];
    const cells: string[] = [];
    CELL_RE.lastIndex = 0;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = CELL_RE.exec(body)) !== null) {
      cells.push(cellText(cellMatch[1]));
    }
    // ⚠️ EXACTLY NINE, OR IT IS NOT A RECORD. A row we cannot align to the
    // nine published columns would be read with the wrong value in every
    // field, so it is skipped rather than guessed at.
    if (cells.length !== 9) continue;
    rows.push({
      applicationType: cells[0],
      applicationNumber: cells[1],
      calibre: cells[2],
      make: cells[3],
      serialNumber: cells[4],
      statusDate: cells[5],
      status: cells[6],
      statusDescription: cells[7],
      nextStep: cells[8],
    });
  }

  return { updatedOn, rows, noRecords, validationMessage };
}
