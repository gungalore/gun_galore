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
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    trackingEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const reference = { allocate: jest.fn().mockResolvedValue('CO000001') };
  const cloudinary = { uploadImage: jest.fn() };
  const svc = new ComplaintsService(
    prisma as never,
    reference as never,
    cloudinary as never,
  );
  return { svc, prisma };
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
};

describe('ComplaintsService.create', () => {
  it('flips a HELD order to DISPUTED for a buyer payout-affecting complaint', async () => {
    const { svc, prisma } = makeService({ tx: HELD_TX });
    const res = await svc.create('clerk1', {
      category: 'ITEM_NOT_AS_DESCRIBED',
      subject: 'Wrong scope',
      body: 'The scope delivered is a different model to the listing.',
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
    const { svc, prisma } = makeService({ tx: { ...HELD_TX, buyerId: 'X', sellerId: 'U1' } });
    const res = await svc.create('clerk1', {
      category: 'DAMAGED',
      subject: 'Damage claim',
      body: 'Buyer claims damage but it was fine when I shipped it out.',
      transactionId: 'TX1',
    });
    expect(res.drovePayoutHold).toBe(false);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
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
});
