import { ComplaintsService } from './complaints.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

function makeService(over: { tx?: unknown; heldCount?: number } = {}) {
  const created: Record<string, unknown> = {};
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'U1', username: 'bob' }) },
    transaction: {
      findUnique: jest.fn().mockResolvedValue(over.tx ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: over.heldCount ?? 1 }),
    },
    complaint: {
      create: jest.fn().mockResolvedValue({ id: 'C1', referenceNumber: 'CO000001' }),
      update: jest.fn().mockResolvedValue({}),
    },
    complaintPhoto: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    trackingEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const reference = { allocate: jest.fn().mockResolvedValue('CO000001') };
  const cloudinary = { uploadImage: jest.fn() };
  // adminUpdate tells the complainant when their case moves; the seller gets
  // a neutral heads-up for condition/description concerns.
  const notifications = {
    complaintStatusChanged: jest.fn().mockResolvedValue(undefined),
    complaintConcernForSeller: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new ComplaintsService(
    prisma as never,
    reference as never,
    cloudinary as never,
    notifications as never,
  );
  return { svc, prisma, notifications, created };
}

const HELD_TX = {
  id: 'TX1',
  buyerId: 'U1',
  sellerId: 'S1',
  paymentStatus: 'HELD',
  paidAt: new Date(),
  swapId: null,
  adminNote: null,
  listing: { title: 'Scope' },
  seller: { email: 'seller@example.com', firstName: 'Sam' },
};

describe('ComplaintsService.create', () => {
  it('flips a HELD order to DISPUTED for a buyer NOT_ARRIVED complaint', async () => {
    const { svc, prisma } = makeService({ tx: HELD_TX });
    const res = await svc.create('clerk1', {
      category: 'NOT_ARRIVED',
      subject: 'Never came',
      body: 'The item was marked delivered but nothing arrived at my address.',
      transactionId: 'TX1',
    });
    expect(res.drovePayoutHold).toBe(true);
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'TX1', paymentStatus: 'HELD' },
        data: expect.objectContaining({ paymentStatus: 'DISPUTED' }),
      }),
    );
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'COMPLAINT_LODGED', urgent: true }),
      }),
    );
  });

  it('does NOT hold payout for an ITEM_NOT_AS_DESCRIBED complaint and needs no photo', async () => {
    const { svc, prisma } = makeService({ tx: HELD_TX });
    const res = await svc.create('clerk1', {
      category: 'ITEM_NOT_AS_DESCRIBED',
      subject: 'Wrong scope',
      body: 'The scope delivered is a different model to the listing.',
      transactionId: 'TX1',
    });
    expect(res.drovePayoutHold).toBe(false);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    // Photos are optional — nothing was attached and the complaint was accepted.
    expect(prisma.complaintPhoto.createMany).not.toHaveBeenCalled();
    expect(prisma.complaint.create).toHaveBeenCalled();
  });

  it('does NOT hold payout for a DAMAGED complaint and needs no photo', async () => {
    const { svc, prisma } = makeService({ tx: HELD_TX });
    const res = await svc.create('clerk1', {
      category: 'DAMAGED',
      subject: 'Arrived broken',
      body: 'The item arrived damaged in transit, no photos attached yet.',
      transactionId: 'TX1',
    });
    expect(res.drovePayoutHold).toBe(false);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.complaintPhoto.createMany).not.toHaveBeenCalled();
  });

  it('does NOT hold payout for a non-payout category (e.g. DELIVERY)', async () => {
    const { svc, prisma } = makeService({ tx: HELD_TX });
    const res = await svc.create('clerk1', {
      category: 'DELIVERY',
      subject: 'Late',
      body: 'The parcel is taking much longer than expected to arrive.',
      transactionId: 'TX1',
    });
    expect(res.drovePayoutHold).toBe(false);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT hold when the complainant is the SELLER on the order', async () => {
    const { svc, prisma, notifications } = makeService({
      tx: { ...HELD_TX, buyerId: 'X', sellerId: 'U1' },
    });
    const res = await svc.create('clerk1', {
      category: 'DAMAGED',
      subject: 'Damage claim',
      body: 'Buyer claims damage but it was fine when I shipped it out.',
      transactionId: 'TX1',
    });
    expect(res.drovePayoutHold).toBe(false);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    // The seller is the complainant — no seller heads-up.
    expect(notifications.complaintConcernForSeller).not.toHaveBeenCalled();
  });

  it('rejects a linked order the user is not a party to', async () => {
    const { svc } = makeService({ tx: { ...HELD_TX, buyerId: 'X', sellerId: 'Y' } });
    await expect(
      svc.create('clerk1', {
        category: 'DAMAGED',
        subject: 'Damage claim',
        body: 'This order is not mine but I am trying to complain about it.',
        transactionId: 'TX1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unknown category', async () => {
    const { svc } = makeService();
    await expect(
      svc.create('clerk1', {
        category: 'NONSENSE',
        subject: 'Damage claim',
        body: 'Some sufficiently long complaint body text here.',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not hold when the order already left HELD (CAS count 0)', async () => {
    const { svc } = makeService({ tx: HELD_TX, heldCount: 0 });
    const res = await svc.create('clerk1', {
      category: 'NOT_ARRIVED',
      subject: 'Never came',
      body: 'The item was marked delivered but nothing arrived at my address.',
      transactionId: 'TX1',
    });
    expect(res.drovePayoutHold).toBe(false);
  });

  it('notifies the seller for a buyer condition complaint linked to an order', async () => {
    const { svc, notifications } = makeService({ tx: HELD_TX });
    await svc.create('clerk1', {
      category: 'ITEM_NOT_AS_DESCRIBED',
      subject: 'Wrong scope',
      body: 'The scope delivered is a different model to the listing.',
      transactionId: 'TX1',
    });
    expect(notifications.complaintConcernForSeller).toHaveBeenCalledTimes(1);
    expect(notifications.complaintConcernForSeller).toHaveBeenCalledWith({
      email: 'seller@example.com',
      name: 'Sam',
      listingTitle: 'Scope',
      referenceNumber: 'CO000001',
    });
  });

  it('does NOT send the seller a condition heads-up for a NOT_ARRIVED complaint', async () => {
    const { svc, notifications } = makeService({ tx: HELD_TX });
    await svc.create('clerk1', {
      category: 'NOT_ARRIVED',
      subject: 'Never came',
      body: 'The item was marked delivered but nothing arrived at my address.',
      transactionId: 'TX1',
    });
    expect(notifications.complaintConcernForSeller).not.toHaveBeenCalled();
  });

  it('keeps the photo/video caps', async () => {
    const { svc } = makeService({ tx: HELD_TX });
    await expect(
      svc.create('clerk1', {
        category: 'DAMAGED',
        subject: 'Arrived broken',
        body: 'The item arrived damaged in transit, please see the photos.',
        transactionId: 'TX1',
        photos: Array.from({ length: 7 }, (_, i) => ({
          url: `https://img/${i}.jpg`,
          publicId: `p${i}`,
        })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
