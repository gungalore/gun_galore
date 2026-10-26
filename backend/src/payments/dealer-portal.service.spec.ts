import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DealerPortalService } from './dealer-portal.service';

/**
 * The dealer portal is the payout-gating attestation for a firearm
 * DEALER_TRANSFER sale. These tests pin the two things that protect the
 * buyer: the invitation only fires for a dealer-transfer firearm sale, and a
 * serial mismatch cannot be approved.
 */

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    title: 'CZ 6.35mm',
    isFirearm: true,
    make: 'CZ',
    model: 'NONE',
    calibre: '6.35mm Browning',
    serialNumber: 'ABC123',
    firearmType: 'Handgun',
    plannedDealerName: 'Wildman',
    plannedDealerAddress: '1 Main Road',
    plannedDealerProvince: 'Western Cape',
    plannedDealerArea: 'Cape Town',
    plannedDealerLocation: 'Wildman — Cape Town, Western Cape',
    plannedDealerPhone: '021 000 0000',
    plannedDealerWebsite: 'https://wildman.example',
    plannedDealerEmail: 'dealer@wildman.example',
    plannedDealerPlaceId: 'place-1',
    plannedDealerLat: -33.9,
    plannedDealerLng: 18.4,
    ...overrides,
  };
}

function build(opts: {
  tx?: Record<string, unknown> | null;
  liveRequest?: Record<string, unknown> | null;
  tokenRow?: Record<string, unknown> | null;
  trusted?: { id: string } | null;
} = {}) {
  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(opts.tx ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    dealerPortalRequest: {
      findFirst: jest.fn().mockResolvedValue(opts.liveRequest ?? null),
      findUnique: jest.fn().mockResolvedValue(opts.tokenRow ?? null),
      create: jest.fn().mockResolvedValue({ id: 'req-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    dealer: {
      findFirst: jest.fn().mockResolvedValue(opts.trusted ?? null),
      create: jest.fn().mockResolvedValue({ id: 'dealer-new' }),
      update: jest.fn().mockResolvedValue({}),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const cloudinary = {
    uploadImage: jest.fn().mockResolvedValue({ url: 'https://cdn/stamp.jpg' }),
    uploadRaw: jest.fn().mockResolvedValue({ url: 'https://cdn/saps534.pdf' }),
  };
  const notifications = {
    dealerPortalRequest: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new DealerPortalService(
    prisma as never,
    cloudinary as never,
    notifications as never,
    undefined,
  );
  return { svc, prisma, cloudinary, notifications };
}

describe('DealerPortalService', () => {
  it('does nothing for a non-dealer-transfer rail', async () => {
    const { svc, prisma, notifications } = build({
      tx: {
        id: 'tx-1',
        shippingMethod: 'PRIVATE_ARRANGE',
        dealerVerificationStatus: null,
        dealerVerificationRequestedAt: null,
        listing: { id: 'l', title: 'x', isFirearm: true, serialNumber: 'S', plannedDealerName: 'D', plannedDealerEmail: 'd@x.co' },
      },
    });
    await svc.requestForTransaction('tx-1', 'd@x.co');
    expect(prisma.dealerPortalRequest.create).not.toHaveBeenCalled();
    expect(notifications.dealerPortalRequest).not.toHaveBeenCalled();
  });

  it('invites the dealer once and reuses the live link', async () => {
    const tx = {
      id: 'tx-1',
      shippingMethod: 'DEALER_TRANSFER',
      dealerVerificationStatus: null,
      dealerVerificationRequestedAt: null,
      listing: {
        id: 'l',
        title: 'CZ 6.35mm',
        isFirearm: true,
        serialNumber: 'ABC123',
        plannedDealerName: 'Wildman',
        plannedDealerEmail: 'dealer@wildman.example',
      },
    };
    const first = build({ tx, liveRequest: null });
    await first.svc.requestForTransaction('tx-1', 'dealer@wildman.example');
    expect(first.prisma.dealerPortalRequest.create).toHaveBeenCalledTimes(1);
    expect(first.notifications.dealerPortalRequest).toHaveBeenCalledTimes(1);

    const second = build({
      tx,
      liveRequest: {
        id: 'req-old',
        dealerEmail: 'dealer@wildman.example',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await second.svc.requestForTransaction('tx-1', 'dealer@wildman.example');
    expect(second.prisma.dealerPortalRequest.create).not.toHaveBeenCalled();
    expect(second.notifications.dealerPortalRequest).not.toHaveBeenCalled();
  });

  it('rejects an unknown or expired link', async () => {
    const unknown = build({ tokenRow: null });
    await expect(unknown.svc.getByToken('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const expired = build({
      tokenRow: {
        id: 'req-1',
        transactionId: 'tx-1',
        dealerEmail: 'd@x.co',
        expiresAt: new Date(Date.now() - 1000),
        transaction: { listing: listing() },
      },
    });
    await expect(expired.svc.getByToken('nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a serial mismatch before any upload or AI call', async () => {
    const { svc, prisma, cloudinary } = build({
      tokenRow: {
        id: 'req-1',
        transactionId: 'tx-1',
        dealerEmail: 'd@x.co',
        expiresAt: new Date(Date.now() + 86_400_000),
        status: 'SENT',
        transaction: { listing: listing() },
      },
      trusted: { id: 'dealer-1' },
    });
    await expect(
      svc.submit(
        'token',
        {},
        { serialNumber: 'WRONG', acknowledgement: 'true', dealerName: 'Wildman' },
      ),
    ).rejects.toThrow(/serial number does not match/i);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
    expect(prisma.dealerPortalRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
  });

  it('auto-approves a trusted dealer on a matching serial + acknowledgement', async () => {
    const { svc, prisma } = build({
      tokenRow: {
        id: 'req-1',
        transactionId: 'tx-1',
        dealerEmail: 'd@x.co',
        expiresAt: new Date(Date.now() + 86_400_000),
        status: 'SENT',
        transaction: { listing: listing() },
      },
      trusted: { id: 'dealer-1' },
    });
    const out = await svc.submit(
      'token',
      {},
      { serialNumber: 'abc-123', acknowledgement: 'true', dealerName: 'Wildman' },
    );
    expect(out.status).toBe('APPROVED');
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dealerVerificationStatus: 'APPROVED',
        }),
      }),
    );
  });
});
