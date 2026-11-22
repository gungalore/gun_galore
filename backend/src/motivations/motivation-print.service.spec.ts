import { MotivationPrintService } from './motivation-print.service';
import { FLAGS } from '../settings/settings.service';

const ADDRESS = {
  streetAddress: '1 Long Street',
  suburb: 'Gardens',
  city: 'Cape Town',
  postalCode: '8001',
  province: 'WESTERN_CAPE',
} as const;

function build(
  opts: {
    motivation?: Record<string, unknown> | null;
    order?: Record<string, unknown> | null;
    emailThrows?: boolean;
    booking?: Record<string, unknown>;
  } = {},
) {
  const settings = {
    get: jest.fn(async (flag: { key: string }) => {
      if (flag.key === FLAGS.motivationPriceCents.key) return 29_500;
      if (flag.key === FLAGS.motivationPrintFeeCents.key) return 7_500;
      return 0;
    }),
  };
  const shipping = {
    quotePrivateDelivery: jest.fn(async () => ({
      priceCents: 5_000,
      serviceCode: 'svc-1',
      serviceName: 'Door to door',
      providerSlug: 'bobgo',
      serviceLevelCode: 'economy',
      deliveryDaysMin: 1,
      deliveryDaysMax: 2,
    })),
    bookPrivateDelivery: jest.fn(async () =>
      opts.booking ?? {
        provider: 'BOBGO',
        submission: 'SUBMITTED',
        shipmentId: 'ship-1',
        trackingReference: 'TRACK-1',
        pin: '1234',
      },
    ),
    recheckPrivateDelivery: jest.fn(async () => ({
      provider: 'BOBGO',
      submission: 'SUBMITTED',
      shipmentId: 'ship-1',
      trackingReference: 'TRACK-1',
      pin: '1234',
    })),
  };
  const render = {
    renderPdf: jest.fn(async () => ({
      pdf: Buffer.from('pdf-bytes'),
      filename: 'MO1.pdf',
    })),
  };
  const notifications = {
    motivationPrintOrderForOperator: jest.fn(async () => {
      if (opts.emailThrows) throw new Error('resend down');
    }),
    motivationPrintBookedBuyer: jest.fn(async () => undefined),
  };
  const order = opts.order ?? null;
  const prisma: Record<string, any> = {
    motivation: {
      findFirst: jest.fn(async () => opts.motivation ?? { id: 'mo-1' }),
      findUnique: jest.fn(async () => opts.motivation ?? null),
    },
    user: {
      findUnique: jest.fn(async () => ({
        firstName: 'Gerhard',
        lastName: 'Fourie',
        username: 'turbosnail',
        email: 'buyer@example.com',
        phone: '0821234567',
      })),
    },
    motivationPrintOrder: {
      findFirst: jest.fn(async () => order),
      findUnique: jest.fn(async () => order),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'print-1',
        ...data,
      })),
      update: jest.fn(async () => order),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    adminAlert: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(),
  };
  const svc = new MotivationPrintService(
    prisma as never,
    settings as never,
    shipping as never,
    render as never,
    notifications as never,
  );
  return { svc, prisma, settings, shipping, render, notifications };
}

const PAID_ORDER = {
  id: 'print-1',
  reference: 'PRABC',
  motivationId: 'mo-1',
  userId: 'user-1',
  status: 'PAID',
  motivationCents: 29_500,
  printFeeCents: 7_500,
  shippingCents: 5_000,
  totalCents: 12_500,
  deliveryAddress: ADDRESS,
  contactName: 'Gerhard Fourie',
  contactPhone: '0821234567',
  contactEmail: 'buyer@example.com',
  serviceName: 'Door to door',
  serviceCode: 'svc-1',
  providerSlug: 'bobgo',
  serviceLevelCode: 'economy',
  pdfEmailedAt: new Date('2026-11-23T08:00:00Z'),
  bobgoShipmentId: null,
  bobgoTrackingReference: null,
  failureReason: null,
};

beforeEach(() => {
  process.env.MOTIVATION_PRINT_PHONE = '0821234567';
});

afterEach(() => {
  delete process.env.MOTIVATION_PRINT_PHONE;
});

describe('pricing the printed add-on', () => {
  it('adds R75 and the live courier rate to the motivation price', async () => {
    const { svc } = build();
    const q = await svc.quote('user-1', 'mo-1', ADDRESS as never);
    expect(q).toMatchObject({
      motivationCents: 29_500,
      printFeeCents: 7_500,
      shippingCents: 5_000,
      totalCents: 42_000,
      serviceName: 'Door to door',
    });
  });

  it('refuses an incomplete address before calling the courier', async () => {
    const { svc, shipping } = build();
    await expect(
      svc.quote('user-1', 'mo-1', {
        streetAddress: '',
        suburb: 'Gardens',
        city: 'Cape Town',
        postalCode: '8001',
        province: 'WESTERN_CAPE',
      } as never),
    ).rejects.toMatchObject({
      response: { code: 'motivation-print-address-incomplete' },
    });
    expect(shipping.quotePrivateDelivery).not.toHaveBeenCalled();
  });
});

describe('creating the fulfilment row for the single checkout', () => {
  it('stores the address, contact and the rate that must be replayed', async () => {
    const { svc, prisma } = build({
      motivation: {
        id: 'mo-1',
        referenceNumber: 'MO000123',
        status: 'DRAFT',
        fulfilmentMode: 'DELIVER',
      },
    });
    const prepared = await svc.prepareForPayment({
      userId: 'user-1',
      motivationId: 'mo-1',
      address: ADDRESS as never,
    });
    expect(prepared).toMatchObject({
      orderId: 'print-1',
      printFeeCents: 7_500,
      shippingCents: 5_000,
      totalCents: 42_000,
    });
    expect(prisma.motivationPrintOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        motivationId: 'mo-1',
        userId: 'user-1',
        status: 'AWAITING_PAYMENT',
        totalCents: 42_000,
        contactPhone: '0821234567',
        serviceCode: 'svc-1',
        providerSlug: 'bobgo',
        serviceLevelCode: 'economy',
      }),
    });
  });

  it('refuses when the member never chose Print and Deliver', async () => {
    const { svc } = build({
      motivation: {
        id: 'mo-1',
        referenceNumber: 'MO000123',
        status: 'DRAFT',
        fulfilmentMode: 'DIGITAL',
      },
    });
    await expect(
      svc.prepareForPayment({
        userId: 'user-1',
        motivationId: 'mo-1',
        address: ADDRESS as never,
      }),
    ).rejects.toThrow(/Print and Deliver/i);
  });
});

describe('the desk email', () => {
  it('renders the PDF and sends the order details once', async () => {
    const { svc, render, notifications, prisma } = build({
      order: { ...PAID_ORDER, pdfEmailedAt: null },
      motivation: {
        id: 'mo-1',
        userId: 'user-1',
        referenceNumber: 'MO000123',
        outputMode: 'MOTIVATION_ONLY',
        status: 'COMPLETED',
        completedAt: new Date('2026-11-23T07:00:00Z'),
        user: { username: 'turbosnail' },
      },
    });
    await svc.onGenerationComplete('mo-1');
    expect(render.renderPdf).toHaveBeenCalledWith('user-1', 'mo-1');
    expect(
      notifications.motivationPrintOrderForOperator,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        printReference: 'PRABC',
        motivationReference: 'MO000123',
        customerName: 'Gerhard Fourie',
        customerPhone: '0821234567',
      }),
      expect.any(Buffer),
    );
    expect(prisma.motivationPrintOrder.update).toHaveBeenCalledWith({
      where: { id: 'print-1' },
      data: expect.objectContaining({ pdfEmailedAt: expect.any(Date) }),
    });
  });

  it('does not send it twice for the same completed document', async () => {
    const { svc, notifications } = build({
      order: PAID_ORDER,
      motivation: {
        id: 'mo-1',
        userId: 'user-1',
        referenceNumber: 'MO000123',
        outputMode: 'MOTIVATION_ONLY',
        status: 'COMPLETED',
        completedAt: new Date('2026-11-23T07:00:00Z'),
        user: { username: 'turbosnail' },
      },
    });
    await svc.onGenerationComplete('mo-1');
    expect(
      notifications.motivationPrintOrderForOperator,
    ).not.toHaveBeenCalled();
  });

  it('alerts and leaves the order paid when the email fails', async () => {
    const { svc, prisma, notifications } = build({
      order: { ...PAID_ORDER, pdfEmailedAt: null },
      emailThrows: true,
      motivation: {
        id: 'mo-1',
        userId: 'user-1',
        referenceNumber: 'MO000123',
        outputMode: 'MOTIVATION_ONLY',
        status: 'COMPLETED',
        completedAt: new Date('2026-11-23T07:00:00Z'),
        user: { username: 'turbosnail' },
      },
    });
    await svc.onGenerationComplete('mo-1');
    expect(
      notifications.motivationPrintOrderForOperator,
    ).toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MOTIVATION_PRINT_EMAIL_FAILED',
      }),
    });
    expect(prisma.motivationPrintOrder.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pdfEmailedAt: expect.any(Date) }),
      }),
    );
  });
});

describe('booking the collection', () => {
  it('books Bob Go and emails the buyer the waybill', async () => {
    process.env.MOTIVATION_PRINT_PHONE = '0821234567';
    const { svc, shipping, notifications, prisma } = build({
      order: PAID_ORDER,
    });
    const res = await svc.book('print-1');
    expect(res).toEqual({
      status: 'BOOKED',
      trackingReference: 'TRACK-1',
    });
    expect(shipping.bookPrivateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        customerReference: 'PRABC',
        instructionsCollection: expect.stringContaining('A4 envelope'),
      }),
    );
    expect(prisma.motivationPrintOrder.update).toHaveBeenCalledWith({
      where: { id: 'print-1' },
      data: expect.objectContaining({
        status: 'BOOKED',
        bobgoTrackingReference: 'TRACK-1',
      }),
    });
    expect(notifications.motivationPrintBookedBuyer).toHaveBeenCalled();
  });

  it('refuses to book without a collection phone, and gives the row back', async () => {
    delete process.env.MOTIVATION_PRINT_PHONE;
    const { svc, shipping, prisma } = build({ order: PAID_ORDER });
    await expect(svc.book('print-1')).rejects.toMatchObject({
      response: { code: 'motivation-print-phone-missing' },
    });
    expect(shipping.bookPrivateDelivery).not.toHaveBeenCalled();
    expect(prisma.motivationPrintOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
  });

  it('refuses to book before the PDF has reached the desk', async () => {
    const { svc, shipping, prisma } = build({
      order: { ...PAID_ORDER, pdfEmailedAt: null },
    });
    prisma.motivationPrintOrder.updateMany.mockResolvedValueOnce({ count: 0 });
    process.env.MOTIVATION_PRINT_PHONE = '0821234567';
    await expect(svc.book('print-1')).rejects.toThrow(/PDF/i);
    expect(shipping.bookPrivateDelivery).not.toHaveBeenCalled();
  });
});
