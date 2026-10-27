import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DealerPortalService } from './dealer-portal.service';
import type { DealerStampVerification } from './dealer-stamp-verification.service';

/**
 * The dealer portal is the payout-gating attestation for a firearm
 * DEALER_TRANSFER sale. These tests pin what protects the buyer after the
 * 2026-10-27 rule: a firearm is only marked stocked once the dealer has
 * uploaded BOTH their stamp (five fields at 70%, CIPC-checked) and the SAPS
 * 350(a) with this firearm's details — and a serial mismatch, a failed check
 * or an outage can never auto-approve.
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
    plannedDealerName: 'Boomsticks Cape Town',
    plannedDealerAddress: '73 Harrington Street',
    plannedDealerProvince: 'Western Cape',
    plannedDealerArea: 'Cape Town',
    plannedDealerLocation: 'Boomsticks — Cape Town, Western Cape',
    plannedDealerPhone: '021 020 0620',
    plannedDealerWebsite: 'https://boomsticks.example',
    plannedDealerEmail: 'dealer@boomsticks.example',
    plannedDealerPlaceId: 'place-1',
    plannedDealerLat: -33.9,
    plannedDealerLng: 18.4,
    ...overrides,
  };
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    transactionId: 'tx-1',
    dealerEmail: 'dealer@boomsticks.example',
    expiresAt: new Date(Date.now() + 86_400_000),
    status: 'SENT',
    transaction: { listing: listing() },
    ...overrides,
  };
}

function file(mimetype = 'image/jpeg'): Express.Multer.File {
  return {
    mimetype,
    buffer: Buffer.from('%PDF-1.4' === mimetype ? '%PDF-1.4' : 'stamp'),
    originalname: 'x',
    fieldname: 'x',
  } as unknown as Express.Multer.File;
}

const PASSING: DealerStampVerification = {
  pass: true,
  unavailable: false,
  stamp: [
    { field: 'dealer_name', score: 95, pass: true },
    { field: 'registration_number', score: 95, pass: true },
    { field: 'address', score: 90, pass: true },
    { field: 'contact_number', score: 90, pass: true },
    { field: 'dealer_licence', score: 95, pass: true },
  ],
  stock: [
    { field: 'serial', score: 95, pass: true },
    { field: 'make_model', score: 90, pass: true },
    { field: 'calibre', score: 90, pass: true },
    { field: 'dealer_named', score: 90, pass: true },
    { field: 'signed', score: 90, pass: true },
  ],
  stampText: 'BOOMSTICKS CAPE TOWN (PTY) LTD Reg No: 2019/139703/07',
  stockText: 'SAPS 350(a) CZ 6.35mm serial ABC123',
  extracted: {
    dealerName: 'BOOMSTICKS CAPE TOWN (PTY) LTD',
    registrationNumber: '2019/139703/07',
    address: '73 Harrington Street',
    contactNumber: '021 020 0620',
    licenceNumber: '101091',
  },
  registration: {
    number: '2019/139703/07',
    didit: {
      ok: true,
      matchType: 'full_match',
      status: 'Approved',
      companyName: 'BOOMSTICKS CAPE TOWN (PTY) LTD',
      registrationNumber: '2019/139703/07',
      reason: null,
    },
    registryName: 'BOOMSTICKS CAPE TOWN (PTY) LTD',
  },
  issues: [],
  jevModel: 'jev-1.13.0',
};

const FAILING: DealerStampVerification = {
  ...PASSING,
  pass: false,
  stamp: PASSING.stamp.map((f) =>
    f.field === 'address' ? { ...f, score: 30, pass: false } : f,
  ),
  issues: ['The dealer address could not be read or matched on the dealer stamp.'],
};

const UNAVAILABLE: DealerStampVerification = {
  ...PASSING,
  pass: false,
  unavailable: true,
  issues: ['We could not confirm the company registration number with CIPC just now.'],
};

function build(
  opts: {
    tx?: Record<string, unknown> | null;
    liveRequest?: Record<string, unknown> | null;
    tokenRow?: Record<string, unknown> | null;
    trusted?: Record<string, unknown> | null;
    verification?: DealerStampVerification;
    notificationTx?: Record<string, unknown> | null;
  } = {},
) {
  const prisma = {
    transaction: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.tx ??
            opts.notificationTx ?? {
            seller: {
              email: 'seller@example.com',
              firstName: 'Sam',
              lastName: 'Seller',
              phone: '0820000000',
            },
            listing: { title: 'CZ 6.35mm' },
          },
        ),
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
    uploadRaw: jest.fn().mockResolvedValue({ url: 'https://cdn/saps350.pdf' }),
  };
  const notifications = {
    dealerPortalRequest: jest.fn().mockResolvedValue(undefined),
    dealerVerificationRejected: jest.fn().mockResolvedValue(undefined),
  };
  const stampVerification = {
    verify: jest.fn().mockResolvedValue(opts.verification ?? PASSING),
  };
  const svc = new DealerPortalService(
    prisma as never,
    cloudinary as never,
    notifications as never,
    stampVerification as never,
  );
  return { svc, prisma, cloudinary, notifications, stampVerification };
}

const VALID_BODY = {
  serialNumber: 'ABC123',
  acknowledgement: 'true',
  dealerName: 'Boomsticks Cape Town',
};

const VALID_FILES = () => ({
  stamp: file('image/jpeg'),
  saps350: file('application/pdf'),
});

describe('DealerPortalService', () => {
  it('does nothing for a non-dealer-transfer rail', async () => {
    const { svc, prisma, notifications } = build({
      tx: {
        id: 'tx-1',
        shippingMethod: 'PRIVATE_ARRANGE',
        dealerVerificationStatus: null,
        dealerVerificationRequestedAt: null,
        listing: {
          id: 'l',
          title: 'x',
          isFirearm: true,
          serialNumber: 'S',
          plannedDealerName: 'D',
          plannedDealerEmail: 'd@x.co',
        },
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
        plannedDealerName: 'Boomsticks Cape Town',
        plannedDealerEmail: 'dealer@boomsticks.example',
      },
    };
    const first = build({ tx, liveRequest: null });
    await first.svc.requestForTransaction('tx-1', 'dealer@boomsticks.example');
    expect(first.prisma.dealerPortalRequest.create).toHaveBeenCalledTimes(1);
    expect(first.notifications.dealerPortalRequest).toHaveBeenCalledTimes(1);

    const second = build({
      tx,
      liveRequest: {
        id: 'req-old',
        dealerEmail: 'dealer@boomsticks.example',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await second.svc.requestForTransaction('tx-1', 'dealer@boomsticks.example');
    expect(second.prisma.dealerPortalRequest.create).not.toHaveBeenCalled();
    expect(second.notifications.dealerPortalRequest).not.toHaveBeenCalled();
  });

  it('rejects an unknown or expired link', async () => {
    const unknown = build({ tokenRow: null });
    await expect(unknown.svc.getByToken('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const expired = build({
      tokenRow: tokenRow({ expiresAt: new Date(Date.now() - 1000) }),
    });
    await expect(expired.svc.getByToken('nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('⚠️ refuses a submission with no dealer stamp', async () => {
    const { svc, cloudinary } = build({
      tokenRow: tokenRow(),
      trusted: { id: 'dealer-1', licenceNumber: '101091', regNumber: null },
    });
    await expect(
      svc.submit('token', { saps350: file('application/pdf') }, VALID_BODY),
    ).rejects.toThrow(/dealer stamp/i);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('⚠️ refuses a submission with no SAPS 350(a) — the stock document is not optional', async () => {
    const { svc } = build({
      tokenRow: tokenRow(),
      trusted: { id: 'dealer-1', licenceNumber: '101091', regNumber: null },
    });
    await expect(
      svc.submit('token', { stamp: file('image/jpeg') }, VALID_BODY),
    ).rejects.toThrow(/350\(a\)/i);
  });

  it('rejects a serial mismatch before any upload or model spend', async () => {
    const { svc, cloudinary, stampVerification } = build({
      tokenRow: tokenRow(),
      trusted: { id: 'dealer-1', licenceNumber: '101091', regNumber: null },
    });
    await expect(
      svc.submit('token', VALID_FILES(), { ...VALID_BODY, serialNumber: 'WRONG' }),
    ).rejects.toThrow(/serial number does not match/i);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
    expect(stampVerification.verify).not.toHaveBeenCalled();
  });

  it('marks the firearm stocked when the stamp and the 350(a) both pass', async () => {
    const { svc, prisma, stampVerification } = build({
      tokenRow: tokenRow(),
      trusted: { id: 'dealer-1', licenceNumber: '101091', regNumber: '2019/139703/07' },
    });

    const out = await svc.submit('token', VALID_FILES(), VALID_BODY);

    expect(out.status).toBe('APPROVED');
    expect(stampVerification.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: expect.objectContaining({
          name: 'Boomsticks Cape Town',
          serialNumber: 'ABC123',
          licenceNumber: '101091',
        }),
      }),
    );
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dealerVerificationStatus: 'APPROVED' }),
      }),
    );
    expect(prisma.dealerPortalRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          saps350PhotoUrl: 'https://cdn/saps350.pdf',
        }),
      }),
    );
  });

  it('⚠️ rejects and tells the seller WHICH field failed', async () => {
    const { svc, prisma, notifications } = build({
      tokenRow: tokenRow(),
      trusted: { id: 'dealer-1', licenceNumber: '101091', regNumber: null },
      verification: FAILING,
    });

    const out = await svc.submit('token', VALID_FILES(), VALID_BODY);

    expect(out.status).toBe('REJECTED');
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dealerVerificationStatus: 'REJECTED' }),
      }),
    );
    expect(notifications.dealerVerificationRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'tx-1',
        issues: FAILING.issues,
      }),
    );
  });

  it('⚠️ queues a human — never approves — when the check could not run', async () => {
    const { svc, prisma, notifications } = build({
      tokenRow: tokenRow(),
      trusted: { id: 'dealer-1', licenceNumber: '101091', regNumber: null },
      verification: UNAVAILABLE,
    });

    const out = await svc.submit('token', VALID_FILES(), VALID_BODY);

    expect(out.status).toBe('PENDING_ADMIN_REVIEW');
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dealerVerificationStatus: 'PENDING_ADMIN_REVIEW',
        }),
      }),
    );
    expect(prisma.adminAlert.create).toHaveBeenCalled();
    // A human decides; the seller is not told their dealer failed.
    expect(notifications.dealerVerificationRejected).not.toHaveBeenCalled();
  });

  it('accepts the legacy saps534 field name as the stock document', async () => {
    const { svc } = build({
      tokenRow: tokenRow(),
      trusted: { id: 'dealer-1', licenceNumber: '101091', regNumber: null },
    });
    const out = await svc.submit(
      'token',
      { stamp: file(), saps534: file('application/pdf') },
      VALID_BODY,
    );
    expect(out.status).toBe('APPROVED');
  });
});
