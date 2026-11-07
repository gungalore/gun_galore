import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { FeeModel } from '@prisma/client';
import { RemittanceService } from './remittance.service';

const PAID_AT = new Date('2026-10-24T10:00:00Z');

function tx(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx1',
    sellerId: 'user_seller',
    seller: { id: 'user_seller', username: 'scope_seller' },
    listing: { title: 'X-BAG' },
    order: { orderReference: 'GG-AU-1234' },
    orderReference: null,
    listingPrice: 100_000,
    commissionZar: 5_000,
    sellerPayout: 95_000,
    feeModel: FeeModel.SELLER_DEDUCT,
    paidOutAt: PAID_AT,
    ...overrides,
  };
}

function prismaWith(row: unknown, recoveries: unknown[] = []) {
  return {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id }),
      ),
    },
    transaction: { findUnique: jest.fn().mockResolvedValue(row) },
    // Charges this payout was set off against. Empty is the normal case; the
    // document must still reconcile when one is present.
    sellerChargeRecovery: { findMany: jest.fn().mockResolvedValue(recoveries) },
  };
}

describe('RemittanceService — seller payment voucher', () => {
  it('issues a one-page remittance advice for a paid-out auction sale', async () => {
    const prisma = prismaWith(tx());
    const svc = new RemittanceService(prisma as never);

    const { pdf, filename } = await svc.generateForTransaction(
      'tx1',
      'user_seller',
    );

    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(filename).toBe('remittance-GG-AU-1234.pdf');
  });

  it('refuses anyone but the seller', async () => {
    const prisma = prismaWith(tx());
    const svc = new RemittanceService(prisma as never);

    await expect(svc.generateForTransaction('tx1', 'user_buyer')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses before the payout has actually been paid', async () => {
    const prisma = prismaWith(tx({ paidOutAt: null }));
    const svc = new RemittanceService(prisma as never);

    await expect(
      svc.generateForTransaction('tx1', 'user_seller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s for an unknown transaction', async () => {
    const prisma = prismaWith(null);
    const svc = new RemittanceService(prisma as never);

    await expect(
      svc.generateForTransaction('nope', 'user_seller'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renders a Buy Now sale with no deduction', async () => {
    const prisma = prismaWith(
      tx({
        feeModel: FeeModel.BUYNOW_MARKUP,
        commissionZar: 0,
        sellerPayout: 100_000,
        orderReference: 'GG-BN-9',
        order: null,
      }),
    );
    const svc = new RemittanceService(prisma as never);

    const { pdf, filename } = await svc.generateForTransaction(
      'tx1',
      'user_seller',
    );

    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    expect(filename).toBe('remittance-GG-BN-9.pdf');
  });

  it('shows a courier re-weigh charge as a deduction against the payout', async () => {
    const prisma = prismaWith(tx(), [
      { amountCents: 4_500, charge: { kind: 'SHIPPING_VARIANCE' } },
    ]);
    const svc = new RemittanceService(prisma as never);

    const { pdf } = await svc.generateForTransaction('tx1', 'user_seller');

    // Still one page: the deduction is a line, not a section. (pdf-lib cannot
    // read text back, so the reconciliation itself is covered by the render
    // path and the ledger specs; this proves the charge is LOOKED UP for the
    // right sale and does not break the document.)
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    expect(prisma.sellerChargeRecovery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ transactionId: 'tx1' }),
      }),
    );
  });
});
