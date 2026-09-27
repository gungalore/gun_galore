import { readFileSync } from 'fs';
import * as path from 'path';
import { parseEnquiryResponse } from './saps-enquiry-page';

// ────────────────────────────────────────────────────────────────────
// FOUR FIXTURES, FOUR THINGS THE PAGE CAN BE.
//
// Every one is the shape the live enquiry actually returns, with the
// values replaced by placeholders. They are read from disk rather than
// inlined so the thing under test is the markup SAPS sends, not a
// tidied-up version of it that happens to parse.
//
// ⚠️ THE FAILURE THIS GUARDS AGAINST IS SILENT. A parser that mis-reads
// a row does not throw; it hands the service a status, the service diffs
// it against the last one, and the member either gets no alert for a real
// change or an alert for a change that never happened.
// ────────────────────────────────────────────────────────────────────
function fixture(name: string): string {
  return readFileSync(
    path.join(__dirname, '__fixtures__', `${name}.html`),
    'utf-8',
  );
}

describe('a competency SAPS has approved', () => {
  const result = parseEnquiryResponse(fixture('record-competency'));

  it('reads the snapshot date the page prints', () => {
    expect(result.updatedOn).toBe('2026-09-19');
  });

  it('reads one record row, with all nine columns aligned', () => {
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      applicationType: 'COMPETENCY',
      applicationNumber: 'C00000001',
      // ⚠️ A competency has no firearm, so these three arrive as the page's
      // blank cell. They must be EMPTY, not a single space — a space reads
      // as a value everywhere downstream and renders as a blank that is
      // not blank.
      calibre: '',
      make: '',
      serialNumber: '',
      // Left exactly as SAPS prints it; the service owns the conversion.
      statusDate: '2025/06/06',
      status: 'APPROVED',
      statusDescription: 'The licence / competency was approved.',
      nextStep: 'You will be notified by the DFO when the card is ready for collection.',
    });
  });

  it('is not mistaken for an empty answer', () => {
    expect(result.noRecords).toBe(false);
    expect(result.validationMessage).toBeNull();
  });
});

describe('a firearm licence', () => {
  const result = parseEnquiryResponse(fixture('record-licence'));

  it('reads every populated column', () => {
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].applicationType).toBe('LICENCE');
    expect(result.rows[0].applicationNumber).toBe('10000001');
    expect(result.rows[0].calibre).toBe('DEMO-CAL');
    expect(result.rows[0].make).toBe('DEMO MAKE');
    expect(result.rows[0].serialNumber).toBe('ZDEMO0001');
    expect(result.rows[0].statusDate).toBe('2025/09/22');
    expect(result.rows[0].status).toBe('APPROVED');
  });

  it('does not read the header row as a record', () => {
    // The header is a <tr> of nine <th>, not <td>, and carries no class.
    // Counting it would produce a record whose "status" is the word Status.
    expect(result.rows).toHaveLength(1);
    expect(result.rows.map((r) => r.applicationType)).not.toContain(
      'Application Type',
    );
  });
});

describe('the page holds no record', () => {
  const result = parseEnquiryResponse(fixture('no-records'));

  it('says so, without inventing a row', () => {
    expect(result.rows).toEqual([]);
    expect(result.noRecords).toBe(true);
    expect(result.validationMessage).toBeNull();
  });

  it('still reports the snapshot date it did print', () => {
    // "Held nothing on 2026-09-19" is a different statement from "we could
    // not read the page", and the member is owed the difference.
    expect(result.updatedOn).toBe('2026-09-19');
  });
});

describe('the page complains we left a field out', () => {
  const result = parseEnquiryResponse(fixture('validation'));

  it('reports the page\u2019s own words, and no rows', () => {
    expect(result.rows).toEqual([]);
    expect(result.validationMessage).toBe('Please supply a Serial Number');
  });

  it('is NOT read as "no records"', () => {
    // ⚠️ The trap. A licence with no serial can be answered with this line
    // instead of the record, and it can also come back from a rate-limited
    // enquiry that would succeed a moment later. Reading it as "nothing
    // held" would tell a member their licence does not exist.
    expect(result.noRecords).toBe(false);
  });

  it('carries no snapshot date, because it printed none', () => {
    expect(result.updatedOn).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// The shapes the fixtures do not cover, built inline: they are about the
// PARSER's rules rather than about SAPS's habits.
// ────────────────────────────────────────────────────────────────────
function row(cells: string[]): string {
  return `<tr class="active">${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}

const NINE = ['1', '2', '3', '4', '5', '2025/01/02', '7', '8', '9'];

describe('several records at once', () => {
  it('keeps them in the order SAPS printed them', () => {
    const html = row(['COMPETENCY', ...NINE.slice(1)]) + row(NINE);
    const { rows } = parseEnquiryResponse(html);
    expect(rows).toHaveLength(2);
    expect(rows[0].applicationType).toBe('COMPETENCY');
    expect(rows[1].applicationType).toBe('1');
  });
});

describe('a row the parser cannot align', () => {
  it('is dropped rather than read with a value in the wrong column', () => {
    const html = row(NINE) + row(NINE.slice(0, 8)) + row([...NINE, 'extra']);
    const { rows } = parseEnquiryResponse(html);
    expect(rows).toHaveLength(1);
  });
});

describe('cell text', () => {
  it('decodes the entities the page uses', () => {
    const cells = [...NINE];
    cells[3] = 'Smith &amp; Wesson';
    cells[4] = '&nbsp;';
    const { rows } = parseEnquiryResponse(row(cells));
    expect(rows[0].make).toBe('Smith & Wesson');
    expect(rows[0].serialNumber).toBe('');
  });

  it('collapses inner whitespace so a wrapped cell is one line', () => {
    const cells = [...NINE];
    cells[7] = 'The licence was\n        approved.';
    const { rows } = parseEnquiryResponse(row(cells));
    expect(rows[0].statusDescription).toBe('The licence was approved.');
  });
});

describe('the same html parsed twice', () => {
  it('gives the same answer', () => {
    // ⚠️ The row and cell regexes are module-level and carry /g. Their
    // lastIndex survives between calls, so a parse that forgot to reset it
    // returns the correct answer once and NOTHING on the second call —
    // which in production is the second sweep of the day.
    const html = fixture('record-licence');
    const first = parseEnquiryResponse(html);
    const second = parseEnquiryResponse(html);
    expect(second).toEqual(first);
    expect(second.rows).toHaveLength(1);
  });
});

describe('something that is not the enquiry page', () => {
  it('parses to nothing at all rather than to a status', () => {
    expect(parseEnquiryResponse('')).toEqual({
      updatedOn: null,
      rows: [],
      noRecords: false,
      validationMessage: null,
    });
    const blockPage = parseEnquiryResponse(
      '<html><body><h1>Blocked</h1></body></html>',
    );
    expect(blockPage.rows).toEqual([]);
    expect(blockPage.noRecords).toBe(false);
    expect(blockPage.updatedOn).toBeNull();
  });
});
