// The principal sale. A paid motivation is ALL Outdoor's own product, so its
// R295 must reach the ledger as REVENUE — never as an agent collection into
// Client Funds Payable. These tests pin the two things that decide that: which
// account the invoice line posts to, and where the cash settles.

import { ZohoBooksService } from './zoho-books.service';

const ACCOUNTS = [
  { account_id: 'acc-motivation', account_name: 'Motivation Revenue' },
  { account_id: 'acc-fee', account_name: 'Processing Fee Revenue' },
  { account_id: 'acc-trust', account_name: 'Client Funds Payable (Trust)' },
  {
    account_id: 'acc-bank',
    account_name: 'ABSA Current Account',
    account_type: 'bank',
  },
];

type FetchCall = { url: string; init?: RequestInit };

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function build(overrides: Record<string, unknown> = {}) {
  const calls: FetchCall[] = [];
  // A mutable row so finalize() sees the invoice id create() just wrote.
  const row: Record<string, unknown> = {
    id: 'pay1',
    status: 'PAID',
    userId: 'u1',
    motivationId: 'mo1',
    motivationRef: 'MO000146',
    amountCents: 29_500,
    paidAt: new Date('2026-11-20T18:00:00Z'),
    createdAt: new Date('2026-11-20T17:55:00Z'),
    zohoInvoiceId: null,
    zohoPaymentId: null,
    zohoInvoiceEmailedAt: null,
    zohoSyncStatus: null,
    ...overrides,
  };
  const db = {
    motivationPayment: {
      findUnique: jest.fn(async () => ({
        ...row,
        motivation: { referenceNumber: 'MO000146' },
        user: { id: 'u1', email: 'member@example.co.za' },
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, data);
        return row;
      }),
      findMany: jest.fn(async () => []),
    },
    user: {
      // ensureContact short-circuits on the stored id.
      findUnique: jest.fn(async () => ({ id: 'u1', zohoContactId: 'c1' })),
      update: jest.fn(),
    },
  };

  let invoiceReads = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('/oauth/v2/token')) {
      return response({ access_token: 'token', expires_in: 3600 });
    }
    if (u.includes('/chartofaccounts')) {
      return response({ chartofaccounts: ACCOUNTS });
    }
    if (/\/invoices(\?|$)/.test(u) && init?.method === 'POST') {
      return response({
        invoice: { invoice_id: 'inv9', invoice_number: 'INV-9' },
      });
    }
    if (u.includes('/status/sent')) return response({ code: 0 });
    if (/\/invoices\/inv9/.test(u) && init?.method === 'GET') {
      invoiceReads += 1;
      return response({
        invoice: {
          status: invoiceReads === 1 ? 'draft' : 'sent',
          balance: 295,
          customer_id: 'c1',
        },
      });
    }
    if (u.includes('/customerpayments')) {
      return response({ payment: { payment_id: 'pay9' } });
    }
    if (u.includes('/invoices/inv9/email')) return response({ code: 0 });
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${u}`);
  }) as unknown as typeof fetch;

  const svc = new ZohoBooksService(db as never);
  return { svc, calls, row };
}

describe('ZohoBooksService — the motivation principal sale', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ZOHO_BOOKS_ENABLED: 'true',
      ZOHO_BOOKS_CLIENT_ID: 'client',
      ZOHO_BOOKS_CLIENT_SECRET: 'secret',
      ZOHO_BOOKS_REFRESH_TOKEN: 'refresh',
      ZOHO_BOOKS_ORG_ID: 'org',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('invoices R295 as principal revenue and settles it into the bank', async () => {
    const { svc, calls, row } = build();

    await svc.createMotivationInvoice('pay1');

    const invoicePost = calls.find(
      (c) => /\/invoices(\?|$)/.test(c.url) && c.init?.method === 'POST',
    );
    const body = JSON.parse(String(invoicePost?.init?.body));
    expect(body.customer_id).toBe('c1');
    expect(body.date).toBe('2026-11-20');
    expect(body.line_items).toEqual([
      {
        name: 'Motivation MO000146',
        description: '',
        rate: 295,
        quantity: 1,
        account_id: 'acc-motivation',
      },
    ]);
    // ⚠️ THE PRINCIPAL CLAIM, ON THE DOCUMENT ITSELF. The accountant reads a
    // one-line invoice with no other context.
    expect(body.notes).toContain('Principal supply');
    expect(body.notes).toContain('Not an agent collection');
    expect(body.notes).toContain('Ref: MO000146');
    // Not VAT registered: no tax line may be attached. (The NOTES say so in
    // words — that is the point — so this asserts the structured fields, not
    // the text.)
    expect(body.tax_id).toBeUndefined();
    expect(
      (body.line_items as Array<Record<string, unknown>>).every(
        (l) => l.tax_id === undefined && l.tax_name === undefined,
      ),
    ).toBe(true);

    // The cash lands in the bank, not in the liability.
    const payment = calls.find((c) => c.url.includes('/customerpayments'));
    const paymentBody = JSON.parse(String(payment?.init?.body));
    expect(paymentBody.amount).toBe(295);
    expect(paymentBody.account_id).toBe('acc-bank');
    expect(paymentBody.reference_number).toBe('Motivation MO000146');
    expect(paymentBody.invoices[0].invoice_id).toBe('inv9');

    // The member gets the invoice by email.
    expect(calls.some((c) => c.url.includes('/invoices/inv9/email'))).toBe(true);

    expect(row.zohoInvoiceId).toBe('inv9');
    expect(row.zohoPaymentId).toBe('pay9');
    expect(row.zohoSyncStatus).toBe('OK');
  });

  it('never invoices an attempt the bank has not confirmed', async () => {
    const { svc, calls } = build({ status: 'PENDING' });
    await svc.createMotivationInvoice('pay1');
    expect(calls).toHaveLength(0);
  });

  it('leaves UNCERTAIN alone — a blind retry can duplicate the invoice', async () => {
    const { svc, calls, row } = build({ zohoSyncStatus: 'UNCERTAIN' });
    await svc.createMotivationInvoice('pay1');
    expect(calls).toHaveLength(0);
    // The row keeps its state so a human sees it.
    expect(row.zohoSyncStatus).toBe('UNCERTAIN');
  });

  it('does not raise a second invoice when one already exists', async () => {
    const { svc, calls } = build({ zohoInvoiceId: 'inv9' });
    await svc.createMotivationInvoice('pay1');
    expect(
      calls.filter(
        (c) => /\/invoices(\?|$)/.test(c.url) && c.init?.method === 'POST',
      ),
    ).toHaveLength(0);
  });
});
