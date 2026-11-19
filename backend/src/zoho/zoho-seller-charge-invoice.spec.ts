import { ZohoBooksService } from './zoho-books.service';

/**
 * The seller-cancellation debit note. `ZohoBooksService` is hand-built here
 * because the real constructor needs the whole Books/Prisma graph; the test
 * only needs the invoice write, its account and its idempotency key.
 */
function makeService(charge: Record<string, unknown>) {
  const request = jest.fn(async (method: string, path: string, _body?: unknown) => {
    void method;
    void _body;
    if (path === '/invoices') {
      return { invoice: { invoice_id: 'inv-1', invoice_number: 'INV-1' } };
    }
    return {};
  });
  const update = jest.fn().mockResolvedValue({});
  const svc = Object.create(ZohoBooksService.prototype) as ZohoBooksService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    isEnabled: jest.fn(() => true),
    ensureContact: jest.fn().mockResolvedValue('contact-1'),
    resolveAccountId: jest.fn().mockResolvedValue('acct-1'),
    markFailed: jest.fn(),
    clearUncertain: jest.fn(),
    request,
    prisma: {
      sellerCharge: {
        findUnique: jest.fn().mockResolvedValue(charge),
        update,
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({ zohoUncertainDocs: [] }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'seller-1', email: 'seller@example.com' }),
      },
    },
  });
  return { svc, request, update };
}

const CHARGE = {
  id: 'sc-1',
  sellerId: 'seller-1',
  transactionId: 'tx-12345678',
  kind: 'SELLER_CANCELLED',
  amountCents: 4000,
  reason: 'STOCK_ISSUE: no longer available',
  zohoInvoiceId: null,
};

describe('Zoho seller-charge invoices', () => {
  it('⚠️ raises a seller-cancellation recovery invoice, not a re-weigh one', async () => {
    const { svc, request, update } = makeService(CHARGE);

    await svc.createSellerChargeInvoice('sc-1');

    const invoice = request.mock.calls.find(([, path]) => path === '/invoices');
    expect(invoice).toBeDefined();
    expect(invoice![2]).toMatchObject({
      customer_id: 'contact-1',
      line_items: [
        expect.objectContaining({
          name: 'Seller cancellation recovery',
          rate: 40,
          quantity: 1,
          account_id: 'acct-1',
        }),
      ],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      data: { zohoInvoiceId: 'inv-1' },
    });
  });

  it('⚠️ is idempotent once the invoice exists', async () => {
    const { svc, request } = makeService({
      ...CHARGE,
      zohoInvoiceId: 'already-there',
    });

    await svc.createSellerChargeInvoice('sc-1');

    expect(request).not.toHaveBeenCalled();
  });
});
