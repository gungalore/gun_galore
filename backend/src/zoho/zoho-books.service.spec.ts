import { ZohoBooksService } from './zoho-books.service';

const ACCOUNTS = [
  { account_id: 'acc-fee', account_name: 'Processing Fee Revenue' },
  { account_id: 'acc-handling', account_name: 'Shipping Handling Revenue' },
  { account_id: 'acc-shipping', account_name: 'Shipping Charge' },
  { account_id: 'acc-carrier', account_name: 'Courier and Delivery Costs' },
  { account_id: 'acc-cfp', account_name: 'Client Funds Payable' },
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

function buyerTx(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx1',
    buyerId: 'buyer1',
    buyer: { id: 'buyer1', email: 'buyer@example.com' },
    sellerId: 'seller1',
    listingPrice: 100_000,
    processingFee: 11_595,
    shippingCost: 14_500,
    shippingHandlingCents: 1_450,
    commissionZar: 0,
    sellerPayout: 100_000,
    buyerTotal: 127_545,
    zohoBuyerInvoiceId: null,
    zohoHandlingJournalId: null,
    zohoShippingExpenseId: null,
    zohoSyncStatus: null,
    listing: { title: 'Test item', referenceNumber: 'GG-BN-1234' },
    seller: { username: 'scope_seller' },
    ...overrides,
  };
}

describe('ZohoBooksService buyer paperwork', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
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

  it('posts item + delivery to CFP, the fee to revenue, and strips the handling margin by journal', async () => {
    const calls: FetchCall[] = [];
    const db = {
      transaction: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(buyerTx())
          .mockResolvedValue(buyerTx()),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'buyer1', zohoContactId: 'contact-buyer' }),
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
          invoice: { invoice_id: 'inv1', invoice_number: 'INV-1' },
        });
      }
      if (u.includes('/status/sent')) {
        return response({ code: 0 });
      }
      if (/\/invoices\/inv1/.test(u) && init?.method === 'GET') {
        invoiceReads += 1;
        return response({
          invoice: {
            status: invoiceReads === 1 ? 'draft' : 'sent',
            balance: 1_275.45,
          },
        });
      }
      if (u.includes('/customerpayments')) {
        return response({ payment: { payment_id: 'pay1' } });
      }
      if (/\/journals(\?|$)/.test(u) && init?.method === 'POST') {
        return response({
          journal: { journal_id: 'jr1', journal_number: 'JRN-1' },
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${u}`);
    }) as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.createBuyerInvoice('tx1');

    const invoicePost = calls.find(
      (c) => /\/invoices(\?|$)/.test(c.url) && c.init?.method === 'POST',
    );
    const body = JSON.parse(String(invoicePost?.init?.body));
    expect(body.reference_number.length).toBeLessThanOrEqual(100);
    expect(body.reference_number).toContain('R 115.95');
    expect(body.reference_number).toContain('R 159.50');
    expect(body.notes).toContain('acts as agent');
    expect(body.line_items).toHaveLength(3);
    // Item price and the whole delivery figure are third-party money.
    expect(body.line_items[0]).toMatchObject({
      rate: 1_000,
      account_id: 'acc-cfp',
    });
    expect(body.line_items[1]).toMatchObject({
      name: 'Delivery',
      rate: 159.5,
      account_id: 'acc-cfp',
    });
    // Only our platform fee is revenue.
    expect(body.line_items[2]).toMatchObject({
      name: 'Platform Fee',
      rate: 115.95,
      account_id: 'acc-fee',
    });
    expect(
      body.line_items.reduce(
        (t: number, l: { rate: number }) => t + l.rate,
        0,
      ),
    ).toBe(1_275.45);

    expect(
      calls.some(
        (c) => c.url.includes('/status/sent') && c.init?.method === 'POST',
      ),
    ).toBe(true);

    const payment = calls.find((c) => c.url.includes('/customerpayments'));
    const paymentBody = JSON.parse(String(payment?.init?.body));
    expect(paymentBody.amount).toBe(1_275.45);
    expect(paymentBody.deposit_to_account_id).toBe('acc-cfp');
    expect(paymentBody.invoices[0].invoice_id).toBe('inv1');

    // The buyer sees one Delivery figure; the margin is moved to income.
    const journalPost = calls.find(
      (c) => /\/journals(\?|$)/.test(c.url) && c.init?.method === 'POST',
    );
    const journalBody = JSON.parse(String(journalPost?.init?.body));
    expect(journalBody.line_items).toEqual([
      expect.objectContaining({
        account_id: 'acc-cfp',
        debit_or_credit: 'debit',
        amount: 14.5,
      }),
      expect.objectContaining({
        account_id: 'acc-handling',
        debit_or_credit: 'credit',
        amount: 14.5,
      }),
    ]);

    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx1' },
        data: expect.objectContaining({ zohoSyncStatus: 'OK' }),
      }),
    );
    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx1' },
        data: expect.objectContaining({ zohoHandlingJournalId: 'jr1' }),
      }),
    );
  });

  it('records a Bob Go expense for the carrier share only', async () => {
    const calls: FetchCall[] = [];
    const db = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue(buyerTx()),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn(), update: jest.fn() },
    };

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/oauth/v2/token')) {
        return response({ access_token: 'token', expires_in: 3600 });
      }
      if (u.includes('/chartofaccounts')) {
        return response({ chartofaccounts: ACCOUNTS });
      }
      if (u.includes('/contacts?contact_type=vendor')) {
        return response({ contacts: [] });
      }
      if (/\/contacts(\?|$)/.test(u) && init?.method === 'POST') {
        return response({ contact: { contact_id: 'vendor-bobgo' } });
      }
      if (/\/expenses(\?|$)/.test(u) && init?.method === 'POST') {
        return response({ expense: { expense_id: 'exp1' } });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${u}`);
    }) as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.createShippingExpense('tx1');

    const expensePost = calls.find(
      (c) => /\/expenses(\?|$)/.test(c.url) && c.init?.method === 'POST',
    );
    const body = JSON.parse(String(expensePost?.init?.body));
    expect(body.vendor_id).toBe('vendor-bobgo');
    expect(body.amount).toBe(145);
    expect(body.account_id).toBe('acc-carrier');
    expect(body.paid_through_account_id).toBe('acc-cfp');

    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx1' },
        data: expect.objectContaining({ zohoShippingExpenseId: 'exp1' }),
      }),
    );
  });

  it('creates no carrier bill when there is no waybill', async () => {
    const db = {
      transaction: {
        findUnique: jest
          .fn()
          .mockResolvedValue(buyerTx({ shippingCost: 0 })),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn(), update: jest.fn() },
    };
    global.fetch = jest.fn() as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.createShippingExpense('tx1');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.transaction.update).not.toHaveBeenCalled();
  });

  it('emails the seller statement for the requested period', async () => {
    const calls: FetchCall[] = [];
    const db = {
      transaction: { findUnique: jest.fn(), update: jest.fn() },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'seller1', zohoContactId: 'contact-seller' }),
        update: jest.fn(),
      },
    };

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/oauth/v2/token')) {
        return response({ access_token: 'token', expires_in: 3600 });
      }
      if (u.includes('/statements/email') && init?.method === 'POST') {
        return response({ code: 0, message: 'Statement sent' });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${u}`);
    }) as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await expect(
      svc.emailSellerStatement('seller1', '2026-06-01', '2026-06-30'),
    ).resolves.toBe(true);

    const post = calls.find((c) => c.url.includes('/statements/email'));
    expect(post?.url).toContain('/contacts/contact-seller/statements/email');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      send_mail: true,
      from_date: '2026-06-01',
      to_date: '2026-06-30',
    });
  });
});


