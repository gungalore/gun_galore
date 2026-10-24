import { ZohoBooksService } from './zoho-books.service';

const ACCOUNTS = [
  { account_id: 'acc-fee', account_name: 'Processing Fee Revenue' },
  { account_id: 'acc-handling', account_name: 'Shipping Handling Revenue' },
  { account_id: 'acc-shipping', account_name: 'Shipping Charge' },
  { account_id: 'acc-carrier', account_name: 'Courier and Delivery Costs' },
  { account_id: 'acc-trust', account_name: 'Client Funds Payable (Trust)' },
  { account_id: 'acc-cfp', account_name: 'Client Funds Payable' },
  {
    account_id: 'acc-bank',
    account_name: 'ABSA Business Account',
    account_number: '40505183',
    account_type: 'bank',
  },
  {
    account_id: 'acc-fnb',
    account_name: 'Bank - FNB Business',
    account_type: 'bank',
  },
  { account_id: 'acc-uf', account_name: 'Undeposited Funds' },
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
    zohoBuyerInvoiceEmailedAt: null,
    zohoSellerInvoiceEmailedAt: null,
    zohoHandlingJournalId: null,
    zohoShippingJournalId: null,
    zohoCommissionSettleJournalId: null,
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
          .mockResolvedValue(buyerTx({ zohoBuyerInvoiceId: 'inv1' })),
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
      if (u.includes('/invoices/inv1/email') && init?.method === 'POST') {
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
    expect(body.reference_number).toBeUndefined();
    expect(body.notes).toContain('Principal Supplies');
    expect(body.notes).toContain('Agent Supplies - All Outdoor Platform Fee');
    expect(body.notes).toContain('Ref: GG-BN-1234');
    expect(body.line_items).toHaveLength(3);
    // Item price and the whole delivery figure are third-party money.
    expect(body.line_items[0]).toMatchObject({
      name: 'Test item *',
      description: '',
      rate: 1_000,
      account_id: 'acc-trust',
    });
    expect(body.line_items[1]).toMatchObject({
      name: 'Delivery *',
      description: '',
      rate: 159.5,
      account_id: 'acc-trust',
    });
    // Only our platform fee is revenue.
    expect(body.line_items[2]).toMatchObject({
      name: 'Platform Fee **',
      description: '',
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
    expect(paymentBody.account_id).toBe('acc-bank');
    expect(paymentBody.invoices[0].invoice_id).toBe('inv1');

    // The buyer sees one Delivery figure; the margin is moved to income.
    const journalPost = calls.find(
      (c) => /\/journals(\?|$)/.test(c.url) && c.init?.method === 'POST',
    );
    const journalBody = JSON.parse(String(journalPost?.init?.body));
    expect(journalBody.line_items).toEqual([
      expect.objectContaining({
        account_id: 'acc-trust',
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

    const buyerEmail = calls.find(
      (c) => c.url.includes('/invoices/inv1/email') && c.init?.method === 'POST',
    );
    expect(JSON.parse(String(buyerEmail?.init?.body))).toEqual({
      to_mail_ids: ['buyer@example.com'],
      subject: 'Your ALL Outdoor invoice',
      body: expect.any(String),
    });
    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zohoBuyerInvoiceEmailedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('clears the carrier freight out of the liability with a journal', async () => {
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
      if (/\/journals(\?|$)/.test(u) && init?.method === 'POST') {
        return response({
          journal: { journal_id: 'jr-ship', journal_number: 'JRN-2' },
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${u}`);
    }) as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.createShippingCostJournal('tx1');

    const journalPost = calls.find(
      (c) => /\/journals(\?|$)/.test(c.url) && c.init?.method === 'POST',
    );
    const body = JSON.parse(String(journalPost?.init?.body));
    expect(body.line_items).toEqual([
      expect.objectContaining({
        account_id: 'acc-trust',
        debit_or_credit: 'debit',
        amount: 145,
      }),
      expect.objectContaining({
        account_id: 'acc-bank',
        debit_or_credit: 'credit',
        amount: 145,
      }),
    ]);

    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx1' },
        data: expect.objectContaining({ zohoShippingJournalId: 'jr-ship' }),
      }),
    );
  });

  it('creates no carrier journal when there is no waybill', async () => {
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
    await svc.createShippingCostJournal('tx1');

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
          .mockResolvedValue({ id: 'seller1', zohoContactId: 'contact-seller', email: 'seller@example.com' }),
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
      to_mail_ids: ['seller@example.com'],
      subject: 'ALL Outdoor account statement',
      body: 'Your ALL Outdoor account statement for the selected period is attached.',
    });
  });

  it('settles an auction seller fee from the liability, then clears the A/R via Undeposited Funds', async () => {
    const calls: FetchCall[] = [];
    const db = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-au',
          sellerId: 'seller1',
          seller: { id: 'seller1' },
          commissionZar: 5_000,
          zohoCommissionInvoiceId: 'inv-seller',
          zohoCommissionPaymentId: null,
          zohoCommissionSettleJournalId: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
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
      if (u.includes('/chartofaccounts')) {
        return response({ chartofaccounts: ACCOUNTS });
      }
      if (/\/invoices\/inv-seller/.test(u) && init?.method === 'GET') {
        return response({ invoice: { balance: 50, total: 50 } });
      }
      if (/\/journals(\?|$)/.test(u) && init?.method === 'POST') {
        return response({ journal: { journal_id: 'jr-fee' } });
      }
      if (u.includes('/customerpayments')) {
        return response({ payment: { payment_id: 'pay-fee' } });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${u}`);
    }) as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.markCommissionInvoicePaid('tx-au');

    const journal = calls.find(
      (c) => /\/journals(\?|$)/.test(c.url) && c.init?.method === 'POST',
    );
    expect(JSON.parse(String(journal?.init?.body)).line_items).toEqual([
      expect.objectContaining({
        account_id: 'acc-trust',
        debit_or_credit: 'debit',
        amount: 50,
      }),
      expect.objectContaining({
        account_id: 'acc-uf',
        debit_or_credit: 'credit',
        amount: 50,
      }),
    ]);

    const payment = calls.find((c) => c.url.includes('/customerpayments'));
    expect(JSON.parse(String(payment?.init?.body))).toEqual(
      expect.objectContaining({
        amount: 50,
        account_id: 'acc-uf',
      }),
    );
  });

  it('creates a zero-total settlement advice for a Buy Now seller (no fee)', async () => {
    const calls: FetchCall[] = [];
    const db = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-bn',
          sellerId: 'seller1',
          seller: {
            id: 'seller1',
            email: 'seller@example.com',
            username: 'scope_seller',
          },
          listing: {
            title: 'Test item',
            referenceNumber: 'GG-BN-1234',
          },
          commissionZar: 0,
          listingPrice: 100_000,
          sellerPayout: 100_000,
          zohoCommissionInvoiceId: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'seller1',
          zohoContactId: 'contact-seller',
          email: 'seller@example.com',
          username: 'scope_seller',
          firstName: 'Scope',
          lastName: 'Seller',
        }),
        update: jest.fn(),
      },
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
      if (/\/invoices(\?|$)/.test(u) && init?.method === 'POST') {
        return response({
          invoice: { invoice_id: 'inv-advice', invoice_number: 'INV-ADV' },
        });
      }
      if (u.includes('/status/sent')) {
        return response({ code: 0 });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${u}`);
    }) as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.createCommissionInvoice('tx-bn');

    const invoicePost = calls.find(
      (c) => /\/invoices(\?|$)/.test(c.url) && c.init?.method === 'POST',
    );
    const body = JSON.parse(String(invoicePost?.init?.body));
    expect(body.reference_number).toBeUndefined();
    // The settlement maths now lives in the notes, not a P.O.# field.
    expect(body.notes).toContain('R 0 (Platform Fee)');
    expect(body.line_items).toHaveLength(1);
    expect(body.line_items[0]).toMatchObject({
      name: 'Sale settlement advice (not a tax invoice)',
      rate: 0,
      account_id: 'acc-trust',
    });
    expect(body.notes).toContain('not a tax invoice');
    expect(
      calls.some(
        (c) => c.url.includes('/status/sent') && c.init?.method === 'POST',
      ),
    ).toBe(true);
    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zohoCommissionInvoiceId: 'inv-advice',
          zohoSyncStatus: 'OK',
        }),
      }),
    );
  });

  it('emails the seller their document once', async () => {
    const calls: FetchCall[] = [];
    const db = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-s',
          seller: { email: 'seller@example.com' },
          listing: { referenceNumber: 'GG-1' },
          zohoCommissionInvoiceId: 'inv-s',
          zohoSellerInvoiceEmailedAt: null,
        }),
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
      if (u.includes('/invoices/inv-s/email') && init?.method === 'POST') {
        return response({ code: 0 });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${u}`);
    }) as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.emailSellerInvoiceIfNeeded('tx-s');

    const email = calls.find((c) => c.url.includes('/invoices/inv-s/email'));
    expect(JSON.parse(String(email?.init?.body))).toEqual({
      to_mail_ids: ['seller@example.com'],
      subject: 'Your ALL Outdoor seller document',
      body: expect.any(String),
    });
    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zohoSellerInvoiceEmailedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('never emails the same seller document twice', async () => {
    const db = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-s',
          seller: { email: 'seller@example.com' },
          zohoCommissionInvoiceId: 'inv-s',
          zohoSellerInvoiceEmailedAt: new Date(),
        }),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn(), update: jest.fn() },
    };
    global.fetch = jest.fn() as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.emailSellerInvoiceIfNeeded('tx-s');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.transaction.update).not.toHaveBeenCalled();
  });

  it('does not try to settle a zero-fee settlement advice at payout', async () => {
    const db = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-bn',
          sellerId: 'seller1',
          seller: { id: 'seller1' },
          commissionZar: 0,
          zohoCommissionInvoiceId: 'inv-advice',
          zohoCommissionPaymentId: null,
          zohoCommissionSettleJournalId: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn(), update: jest.fn() },
    };
    global.fetch = jest.fn() as unknown as typeof fetch;

    const svc = new ZohoBooksService(db as never);
    await svc.markCommissionInvoicePaid('tx-bn');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zohoCommissionPaymentId: 'NOT_APPLICABLE',
        }),
      }),
    );
  });
});


