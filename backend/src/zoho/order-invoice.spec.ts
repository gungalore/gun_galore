import { ZohoBooksService } from './zoho-books.service';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ONE BUYER INVOICE FOR A MULTI-ITEM ORDER (2026-11-27).
 *
 * Item line per item, ONE delivery line per seller courier booking, ONE Platform
 * Fee line, and the total must equal order.buyerTotal. Order children are
 * explicitly excluded from the single-transaction buyer-invoice path so the
 * buyer is never billed twice.
 * ────────────────────────────────────────────────────────────────────────────
 */

function makeService(order?: Record<string, unknown> | null) {
  const requests: { method: string; path: string; payload: unknown }[] = [];
  const orderUpdates: { id: string; data: Record<string, unknown> }[] = [];
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(order ?? null),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        orderUpdates.push({ id: args.where.id, data: args.data });
        return {};
      }),
    },
    transaction: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const svc = Object.create(ZohoBooksService.prototype) as ZohoBooksService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    prisma,
    isEnabled: () => true,
    ensureContact: jest.fn().mockResolvedValue('CONTACT-1'),
    resolveAccountId: jest
      .fn()
      .mockResolvedValueOnce('ACCOUNT-CFP')
      .mockResolvedValueOnce('ACCOUNT-FEE'),
    request: jest.fn(async (method: string, path: string, payload: unknown) => {
      requests.push({ method, path, payload });
      if (path === '/invoices') {
        return { invoice: { invoice_id: 'INV-1', invoice_number: 'INV-0001' } };
      }
      return {};
    }),
  });
  return { svc, prisma, requests, orderUpdates };
}

const ORDER = {
  id: 'O1',
  orderReference: 'GG-ORD-1',
  buyerTotal: 42_000, // 10,000 + 20,000 items + 9,000 delivery + 3,000 fee
  processingFee: 3_000,
  zohoBuyerInvoiceId: null,
  buyer: { id: 'BUYER', email: 'buyer@example.co.za' },
  transactions: [
    {
      id: 'TX1',
      listingPrice: 10_000,
      shippingCost: 9_000,
      shippingHandlingCents: 0,
      listing: { title: 'Rifle scope' },
    },
    {
      id: 'TX2',
      listingPrice: 20_000,
      shippingCost: 0,
      shippingHandlingCents: 0,
      listing: { title: 'Range bag' },
    },
  ],
};

describe('createOrderBuyerInvoice', () => {
  it('raises ONE invoice with item, delivery and fee lines that foot to buyerTotal', async () => {
    const { svc, requests, orderUpdates } = makeService(ORDER);

    await svc.createOrderBuyerInvoice('O1');

    const create = requests.find(
      (r) => r.method === 'POST' && r.path === '/invoices',
    );
    expect(create).toBeDefined();
    const payload = create!.payload as {
      line_items: { name: string; rate: number }[];
    };
    // 2 items + 1 per-seller courier delivery + 1 Platform Fee.
    expect(payload.line_items).toHaveLength(4);
    const rates = payload.line_items.map((l) => l.rate);
    expect(rates).toEqual([100, 200, 90, 30]); // R100 + R200 + R90 + R30 = R420
    expect(rates.reduce((sum, r) => sum + Math.round(r * 100), 0)).toBe(
      ORDER.buyerTotal,
    );
    // One delivery line only — the consolidated sibling has shippingCost 0.
    expect(
      payload.line_items.filter((l) => /delivery/i.test(l.name)),
    ).toHaveLength(1);
    expect(payload.line_items.at(-1)!.name).toMatch(/Platform Fee/i);

    // The order stores the invoice id, then the emailed-once stamp.
    expect(orderUpdates[0]).toEqual({
      id: 'O1',
      data: { zohoBuyerInvoiceId: 'INV-1' },
    });
    expect(orderUpdates.at(-1)).toEqual({
      id: 'O1',
      data: { zohoBuyerInvoiceEmailedAt: expect.any(Date) },
    });
    // Marked sent + emailed through Books, not left as a draft.
    expect(requests.map((r) => r.path)).toEqual(
      expect.arrayContaining(['/invoices', '/invoices/INV-1/status/sent', '/invoices/INV-1/email']),
    );
  });

  it('is idempotent: an order that already has an invoice is not re-created', async () => {
    const { svc, requests } = makeService({
      ...ORDER,
      zohoBuyerInvoiceId: 'INV-EXISTING',
    });
    await svc.createOrderBuyerInvoice('O1');
    expect(requests).toHaveLength(0);
  });

  it('fails closed when the invoice lines do not foot to order.buyerTotal', async () => {
    const { svc, requests } = makeService({ ...ORDER, buyerTotal: 41_999 });
    await svc.createOrderBuyerInvoice('O1');
    expect(requests.filter((r) => r.path === '/invoices')).toHaveLength(0);
  });
});

describe('createBuyerInvoice — order children never invoice themselves', () => {
  it('returns early when the transaction belongs to an order', async () => {
    const { svc, prisma, requests } = makeService();
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'TX1',
      orderId: 'O1',
      zohoBuyerInvoiceId: null,
    });
    await svc.createBuyerInvoice('TX1');
    expect(requests).toHaveLength(0);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});
