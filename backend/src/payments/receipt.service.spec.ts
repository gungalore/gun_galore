import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReceiptService } from './receipt.service';

describe('ReceiptService — buyer purchase receipt', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    transaction: { findUnique: jest.Mock };
  };
  let service: ReceiptService;

  const buyer = { id: 'buyer1', clerkId: 'clerk_buyer' };
  const baseTx = {
    id: 'tx1',
    buyerId: 'buyer1',
    sellerId: 'seller1',
    orderReference: 'GG-0001',
    paidAt: new Date('2026-06-01T10:00:00Z'),
    paymentStatus: 'HELD',
    shippingMethod: 'PUDO',
    listingPrice: 250000,
    shippingCost: 9900,
    processingFee: 9100,
    passFeeToBuyer: true,
    buyerTotal: 269000,
    listing: { title: 'Sako 85 Hunter .30-06' },
    seller: { username: 'bushveldarms' },
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(buyer) },
      transaction: { findUnique: jest.fn().mockResolvedValue(baseTx) },
    };
    service = new ReceiptService(prisma as never);
  });

  it('returns a PDF for the buyer of a paid order', async () => {
    const { pdf, filename } = await service.generateReceiptPdf(
      'tx1',
      'clerk_buyer',
    );
    expect(filename).toBe('gun-galore-receipt-GG-0001.pdf');
    // Valid PDF starts with the %PDF- magic bytes.
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('rejects a non-buyer (e.g. the seller)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'seller1',
      clerkId: 'clerk_seller',
    });
    await expect(
      service.generateReceiptPdf('tx1', 'clerk_seller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the order has not been paid', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      ...baseTx,
      paidAt: null,
    });
    await expect(
      service.generateReceiptPdf('tx1', 'clerk_buyer'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFound when the transaction does not exist', async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);
    await expect(
      service.generateReceiptPdf('missing', 'clerk_buyer'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
