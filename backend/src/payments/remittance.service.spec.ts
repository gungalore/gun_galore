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

function prismaWith(row: unknown) {
  return {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id }),
      ),
    },
    transaction: { findUnique: jest.fn().mockResolvedValue(row) },
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
});
