import { DealerStampVerificationService } from './dealer-stamp-verification.service';
import type { LlmPart } from '../common/llm/llm.types';
import type { DiditRegistryLookup } from '../didit/didit.types';

/**
 * THE DEALER STAMP + SAPS 350(a) BATTERY.
 *
 * Operator, 2026-10-27: a firearm may only be marked stocked once the dealer
 * has filled in the form and attached their stamp, with the 350(a) carrying
 * the correct firearm details — and "Jev needs 70% upwards on all fields".
 * These tests pin the three things that protect the buyer:
 *   · a single field below 70% fails the dealer,
 *   · CICP (via Didit) must connect the registration number to the business,
 *   · an outage routes to a human and NEVER passes.
 */

const STAMP_TEXT = [
  'BOOMSTICKS CAPE TOWN (PTY) LTD',
  'Reg No: 2019/139703/07',
  '73 HARRINGTON STR, CAPE TOWN, 8001',
  'Contact: 061 583 0442 / 021 0200620',
  'Dealer Licence: 101091',
].join('\n');

const STOCK_TEXT =
  'SAPS 350(a) — Dealer’s Return: Stock Received. Dealer: Boomsticks Cape Town. ' +
  'Make: CZ. Model: P-07. Calibre: 9mm Parabellum. Serial: ABC123. Signed: 2026-10-27.';

const PART: LlmPart = {
  type: 'image',
  mimeType: 'image/jpeg',
  data: 'AAAA',
};

const ALL_PASS = {
  dealer_name: 0.95,
  registration_number: 0.95,
  address: 0.9,
  contact_number: 0.9,
  dealer_licence: 0.95,
  serial: 0.95,
  make_model: 0.9,
  calibre: 0.9,
  dealer_named: 0.9,
  signed: 0.9,
};

const OK_LOOKUP: DiditRegistryLookup = {
  ok: true,
  matchType: 'full_match',
  status: 'Approved',
  companyName: 'BOOMSTICKS CAPE TOWN (PTY) LTD',
  registrationNumber: '2019/139703/07',
  reason: null,
};

function fakeLlm(opts: {
  stamp?: string | null;
  stock?: string | null;
  answers?: Record<string, number>;
  decideThrows?: boolean;
}) {
  return {
    isConfigured: () => true,
    complete: jest.fn(async (req: { purpose?: string }) => {
      if (req.purpose === 'dealer.stamp.ocr') {
        return {
          text:
            opts.stamp === null
              ? ''
              : (opts.stamp ??
                JSON.stringify({
                  text: STAMP_TEXT,
                  dealer_name: 'BOOMSTICKS CAPE TOWN (PTY) LTD',
                  registration_number: '2019/139703/07',
                  address: '73 Harrington Str, Cape Town, 8001',
                  contact_number: '061 583 0442',
                  licence_number: '101091',
                })),
        };
      }
      return { text: opts.stock === null ? '' : (opts.stock ?? STOCK_TEXT) };
    }),
    decide: jest.fn(async () => {
      if (opts.decideThrows) throw new Error('typesafe down');
      const answers: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(opts.answers ?? ALL_PASS)) {
        answers[key] = { type: 'noul', noul: value };
      }
      return { model: 'jev-1.13.0', answers };
    }),
  };
}

function fakeDidit(lookup: Partial<DiditRegistryLookup> | Error) {
  return {
    validateCompanyRegistry: jest.fn(async () => {
      if (lookup instanceof Error) throw lookup;
      return { ...OK_LOOKUP, ...lookup } as DiditRegistryLookup;
    }),
  };
}

function build(opts: {
  llm?: ReturnType<typeof fakeLlm>;
  didit?: ReturnType<typeof fakeDidit>;
}) {
  return new DealerStampVerificationService(
    (opts.llm ?? fakeLlm({})) as never,
    (opts.didit ?? fakeDidit({})) as never,
  );
}

const EXPECTED = {
  name: 'Boomsticks Cape Town',
  address: '73 Harrington Street, Cape Town, 8001',
  phone: '061 583 0442',
  make: 'CZ',
  model: 'P-07',
  calibre: '9mm Parabellum',
  serialNumber: 'ABC123',
};

const prevKey = process.env.JEV_API_KEY;

beforeEach(() => {
  process.env.JEV_API_KEY = 'test-key';
});

afterAll(() => {
  if (prevKey === undefined) delete process.env.JEV_API_KEY;
  else process.env.JEV_API_KEY = prevKey;
});

describe('DealerStampVerificationService', () => {
  it('passes when every field clears 70% and CIPC matches the business', async () => {
    const out = await build({}).verify({
      stamp: PART,
      stockForm: PART,
      expected: EXPECTED,
    });

    expect(out.pass).toBe(true);
    expect(out.unavailable).toBe(false);
    expect(out.stamp).toHaveLength(5);
    expect(out.stock).toHaveLength(5);
    expect(out.registration.number).toBe('2019/139703/07');
    expect(out.registration.didit?.ok).toBe(true);
    expect(out.extracted.licenceNumber).toBe('101091');
  });

  it('⚠️ fails on a single field under 70% and NAMES it for the seller', async () => {
    const out = await build({
      llm: fakeLlm({ answers: { ...ALL_PASS, address: 0.69 } }),
    }).verify({ stamp: PART, stockForm: PART, expected: EXPECTED });

    expect(out.pass).toBe(false);
    expect(out.unavailable).toBe(false);
    expect(out.stamp.find((f) => f.field === 'address')).toMatchObject({
      score: 69,
      pass: false,
    });
    expect(out.issues.join(' ')).toMatch(/address/i);
  });

  it('treats exactly 70% as a pass (the floor is inclusive)', async () => {
    const out = await build({
      llm: fakeLlm({ answers: { ...ALL_PASS, contact_number: 0.7 } }),
    }).verify({ stamp: PART, stockForm: PART, expected: EXPECTED });
    expect(out.pass).toBe(true);
  });

  it('⚠️ fails when CIPC cannot tie the number to the business, however confident Jev was', async () => {
    const out = await build({
      didit: fakeDidit({ ok: false, matchType: 'no_match', reason: 'declined' }),
    }).verify({ stamp: PART, stockForm: PART, expected: EXPECTED });

    expect(out.pass).toBe(false);
    expect(out.unavailable).toBe(false);
    expect(out.issues.join(' ')).toMatch(/does not match/i);
  });

  it('⚠️ an outage is UNAVAILABLE, never a rejection and never a pass', async () => {
    const out = await build({
      didit: fakeDidit({ ok: false, reason: 'unavailable' }),
    }).verify({ stamp: PART, stockForm: PART, expected: EXPECTED });

    expect(out.pass).toBe(false);
    expect(out.unavailable).toBe(true);
    expect(out.issues.join(' ')).toMatch(/CIPC/i);
  });

  it('is unavailable when the SAPS 350(a) cannot be read at all', async () => {
    const out = await build({ llm: fakeLlm({ stock: null }) }).verify({
      stamp: PART,
      stockForm: PART,
      expected: EXPECTED,
    });
    expect(out.pass).toBe(false);
    expect(out.unavailable).toBe(true);
  });

  it('is unavailable when the stamp reads as empty', async () => {
    const out = await build({ llm: fakeLlm({ stamp: null }) }).verify({
      stamp: PART,
      stockForm: PART,
      expected: EXPECTED,
    });
    expect(out.unavailable).toBe(true);
  });

  it('is unavailable without a Jev key, and spends no OCR', async () => {
    delete process.env.JEV_API_KEY;
    const llm = fakeLlm({});
    const out = await build({ llm }).verify({
      stamp: PART,
      stockForm: PART,
      expected: EXPECTED,
    });
    expect(out.unavailable).toBe(true);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('is unavailable when the Jev battery errors, rather than scoring zeros', async () => {
    const out = await build({
      llm: fakeLlm({ decideThrows: true }),
    }).verify({ stamp: PART, stockForm: PART, expected: EXPECTED });
    expect(out.unavailable).toBe(true);
    expect(out.pass).toBe(false);
  });

  it('fails with a clear issue when no CIPC number can be found on the stamp', async () => {
    const out = await build({
      llm: fakeLlm({
        stamp: JSON.stringify({
          text: 'BOOMSTICKS CAPE TOWN (PTY) LTD\n73 HARRINGTON STR\nDealer Licence: 101091\nNo registration printed here at all.',
          dealer_name: 'BOOMSTICKS CAPE TOWN (PTY) LTD',
          registration_number: null,
        }),
      }),
    }).verify({ stamp: PART, stockForm: PART, expected: EXPECTED });

    expect(out.pass).toBe(false);
    expect(out.unavailable).toBe(false);
    expect(out.issues.join(' ')).toMatch(/registration number/i);
  });

  it('⚠️ sends the registration number and our held name to Didit', async () => {
    const didit = fakeDidit({});
    await build({ didit }).verify({
      stamp: PART,
      stockForm: PART,
      expected: EXPECTED,
    });
    expect(didit.validateCompanyRegistry).toHaveBeenCalledWith({
      registrationNumber: '2019/139703/07',
      companyName: 'Boomsticks Cape Town',
    });
  });
});
