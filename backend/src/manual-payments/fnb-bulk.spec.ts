import {
  FNB_BULK_COLUMNS,
  accountTypeCode,
  fnbBulkRow,
  buildFnbBulkFile,
  sastActionDate,
  type FnbRecipient,
} from './fnb-bulk';

const rec = (o: Partial<FnbRecipient> = {}): FnbRecipient => ({
  name: 'Jan Seller',
  account: '62123456789',
  accountType: 'cheque',
  branchCode: '250655',
  amountCents: 123_45,
  ownReference: 'UM000123',
  recipientReference: 'UM000123',
  email: 'jan@example.co.za',
  phone: '0821234567',
  ...o,
});

describe('fnb-bulk column layout', () => {
  it('has exactly 36 columns matching FNB row 4', () => {
    expect(FNB_BULK_COLUMNS.length).toBe(36);
    expect(FNB_BULK_COLUMNS[0]).toBe('RECIPIENT NAME');
    expect(FNB_BULK_COLUMNS[4]).toBe('AMOUNT');
    expect(FNB_BULK_COLUMNS[FNB_BULK_COLUMNS.length - 1]).toBe('SMS 2 NUMBER');
  });

  it('a data row has the same field count as the header', () => {
    // recipient has no commas in any field → comma-split is exact
    expect(fnbBulkRow(rec(), true).split(',').length).toBe(36);
    expect(fnbBulkRow(rec(), false).split(',').length).toBe(36);
  });
});

describe('accountTypeCode', () => {
  it('maps cheque/current → 1', () => {
    expect(accountTypeCode('cheque')).toBe('1');
    expect(accountTypeCode('Current')).toBe('1');
  });
  it('maps savings → 2, transmission → 3', () => {
    expect(accountTypeCode('savings')).toBe('2');
    expect(accountTypeCode('transmission')).toBe('3');
  });
  it('blanks the unknown/null so the operator fills it', () => {
    expect(accountTypeCode(null)).toBe('');
    expect(accountTypeCode('weird')).toBe('');
  });
});

describe('fnbBulkRow', () => {
  it('formats the core fields (type code 1, amount in rand, refs)', () => {
    const f = fnbBulkRow(rec(), true).split(',');
    expect(f[0]).toBe('Jan Seller');
    expect(f[1]).toBe('62123456789');
    expect(f[2]).toBe('1'); // cheque
    expect(f[3]).toBe('250655');
    expect(f[4]).toBe('123.45'); // 12345 cents → rand
  });

  it('populates EMAIL 1 + SMS 1 when notify is ON and contacts exist', () => {
    const f = fnbBulkRow(rec(), true).split(',');
    expect(f[7]).toBe('Yes'); // EMAIL 1 NOTIFY
    expect(f[8]).toBe('jan@example.co.za'); // EMAIL 1 ADDRESS
    expect(f[30]).toBe('Yes'); // SMS 1 NOTIFY
    expect(f[32]).toBe('0821234567'); // SMS 1 NUMBER
  });

  it('leaves notify columns "No"/blank when notify is OFF', () => {
    const f = fnbBulkRow(rec(), false).split(',');
    expect(f[7]).toBe('No'); // EMAIL 1 NOTIFY
    expect(f[8]).toBe(''); // EMAIL 1 ADDRESS
    expect(f[30]).toBe('No'); // SMS 1 NOTIFY
    expect(f[32]).toBe(''); // SMS 1 NUMBER
  });

  it('does not notify a channel with no contact even when notify is ON', () => {
    const f = fnbBulkRow(rec({ email: null, phone: null }), true).split(',');
    expect(f[7]).toBe('No');
    expect(f[30]).toBe('No');
  });

  it('escapes a name containing a comma so columns do not shift', () => {
    const row = fnbBulkRow(rec({ name: 'Smith, John' }), false);
    expect(row).toContain('"Smith, John"');
    // CSV-aware split would still yield 36; naive split would over-count → assert the quote is present
    expect(row.startsWith('"Smith, John",')).toBe(true);
  });
});

describe('buildFnbBulkFile', () => {
  it('emits the 4-line header block then data rows (CRLF)', () => {
    const out = buildFnbBulkFile([rec()], {
      sourceAccount: '63210989191',
      actionDate: '28-06-2026',
      notify: true,
    });
    const lines = out.split('\r\n');
    expect(lines[0]).toBe('BInSol - U ver 1.00');
    expect(lines[1]).toBe('28-06-2026');
    expect(lines[2]).toBe('63210989191,'); // source account, 2nd field blank
    expect(lines[3]).toBe(FNB_BULK_COLUMNS.join(','));
    expect(lines).toHaveLength(5); // 4 header + 1 data row
  });
});

describe('sastActionDate', () => {
  it('formats DD-MM-YYYY in SAST (UTC+2)', () => {
    // 2026-06-28T23:30:00Z → 01:30 SAST on the 29th
    expect(sastActionDate(new Date('2026-06-28T23:30:00Z'))).toBe('29-06-2026');
    // 2026-06-28T08:00:00Z → 10:00 SAST same day
    expect(sastActionDate(new Date('2026-06-28T08:00:00Z'))).toBe('28-06-2026');
  });
});
