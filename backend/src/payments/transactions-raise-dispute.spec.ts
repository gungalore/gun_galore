// Policy gate: the buyer dispute route covers an item that NEVER ARRIVED only.
// Condition/description/damage complaints are between the buyer and the seller —
// never a platform refund — and must be refused at both the controller and the
// service (defence in depth).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import {
  DISPUTE_NEVER_ARRIVED_ONLY_GUIDANCE,
  TransactionsService,
} from './transactions.service';

const GUIDANCE = DISPUTE_NEVER_ARRIVED_ONLY_GUIDANCE;

describe('TransactionsController.raiseDispute — reason gate', () => {
  function makeController() {
    const txService = {
      raiseDispute: jest.fn().mockResolvedValue({ disputed: true }),
    };
    const controller = new TransactionsController(
      txService as never,
      {} as never, // tracking
      {} as never, // dealerVerification
      {} as never, // receipts
      {} as never, // remittances
      {} as never, // tokens
    );
    return { controller, txService };
  }

  it.each(['DAMAGED', 'WRONG_ITEM', 'OTHER'])(
    'rejects retired reason %s with the guidance message',
    async (reason) => {
      const { controller, txService } = makeController();
      // raiseDispute is synchronous, so it throws before returning a promise.
      expect(() =>
        controller.raiseDispute('TX1', 'U1', {
          reason,
          details: 'This needs to be at least ten characters long.',
        }),
      ).toThrow(GUIDANCE);
      expect(() =>
        controller.raiseDispute('TX1', 'U1', {
          reason,
          details: 'This needs to be at least ten characters long.',
        }),
      ).toThrow(BadRequestException);
      expect(txService.raiseDispute).not.toHaveBeenCalled();
    },
  );

  it('accepts NEVER_ARRIVED', async () => {
    const { controller, txService } = makeController();
    await expect(
      controller.raiseDispute('TX1', 'U1', {
        reason: 'never_arrived',
        details: 'The parcel never arrived at my address.',
      }),
    ).resolves.toEqual({ disputed: true });
    expect(txService.raiseDispute).toHaveBeenCalledWith(
      'TX1',
      'U1',
      'NEVER_ARRIVED',
      'The parcel never arrived at my address.',
    );
  });
});

describe('TransactionsService.raiseDispute — reason gate', () => {
  function makeService() {
    const tx = {
      id: 'TX1',
      buyerId: 'B1',
      sellerId: 'S1',
      swapId: null,
      paidAt: new Date(),
      rejectedAt: null,
      paymentStatus: 'HELD',
      shippingMethod: 'COURIER',
      dispatchedAt: new Date(),
      confirmedDeliveryAt: null,
      adminNote: null,
      buyer: { id: 'B1', username: 'bob' },
      seller: { id: 'S1', email: 'seller@example.com' },
      // Even if a historical attestation is present, the admin note must no
      // longer carry the seller's "tested & working" claim.
      listing: { title: 'Scope', testedWorkingAttestedAt: new Date() },
    };
    const prisma = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue(tx),
        update: jest.fn().mockResolvedValue(tx),
        // The dispute is a CAS on (HELD, paidAt not null) so it cannot
        // overwrite a RELEASED payout.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      adminAlert: { create: jest.fn().mockResolvedValue({}) },
    };
    const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };
    const service = new TransactionsService(
      prisma as never,
      {} as never, // fees
      {} as never, // notifications
      {} as never, // ozow
      {} as never, // kyc
      {} as never, // shipping
      tracking as never,
      {} as never, // tokens
      {} as never, // referenceNumbers
      {} as never, // fraudRisk
      {} as never, // cloudinary
      {} as never, // zohoBooks
      {} as never, // wishlistAlerts
      {} as never, // saps534
    );
    return { service, prisma, tracking };
  }

  it('rejects DAMAGED with the guidance message', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.raiseDispute(
        'TX1',
        'B1',
        'DAMAGED' as never,
        'The item arrived cracked and unusable.',
      ),
    ).rejects.toThrow(GUIDANCE);
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
  });

  it('accepts NEVER_ARRIVED and records a non-delivery dispute', async () => {
    const { service, prisma, tracking } = makeService();
    await expect(
      service.raiseDispute(
        'TX1',
        'B1',
        'NEVER_ARRIVED',
        'The parcel never arrived at my address.',
      ),
    ).resolves.toEqual({ disputed: true });
    const update = prisma.transaction.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({
      id: 'TX1',
      paymentStatus: 'HELD',
      paidAt: { not: null },
    });
    expect(update.data.paymentStatus).toBe('DISPUTED');
    expect(update.data.adminNote).toContain('[BUYER DISPUTE: NEVER_ARRIVED]');
    expect(update.data.adminNote).not.toContain('ATTESTATION');
    // The unconditional write is gone — it could flip a RELEASED payout.
    expect(prisma.transaction.update).not.toHaveBeenCalled();
    expect(tracking.recordInternal).toHaveBeenCalledWith(
      'TX1',
      'BUYER_RAISED_DISPUTE',
      expect.objectContaining({ occurredAt: expect.any(Date) }),
    );
    expect(prisma.adminAlert.create).toHaveBeenCalled();
  });

  it('loses the race cleanly when the payment left HELD before the CAS', async () => {
    // The read above saw HELD, but the admin released the payout in between —
    // the CAS matches 0 rows and the dispute must be refused, not written.
    const { service, prisma, tracking } = makeService();
    prisma.transaction.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.raiseDispute(
        'TX1',
        'B1',
        'NEVER_ARRIVED',
        'The parcel never arrived at my address.',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
    expect(tracking.recordInternal).not.toHaveBeenCalledWith(
      'TX1',
      'BUYER_RAISED_DISPUTE',
      expect.anything(),
    );
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });
});
