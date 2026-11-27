import { NotFoundException } from '@nestjs/common';
import { SellersPublicController } from './sellers-public.controller';

/**
 * The public storefront header.
 *
 * Audit, 2026-11-27: it served the cached `averageRating` with no count, so the
 * page averaged the capped public review list instead. `totalRatings` is the
 * real count the cached average is computed over.
 */
function build() {
  const prisma = {
    user: { findUnique: jest.fn(async () => null as unknown) },
  };
  const controller = new SellersPublicController(prisma as never);
  return { controller, prisma };
}

const PROFILE = {
  id: 'seller',
  username: 'seller-handle',
  avatarUrl: null,
  sellerTier: 'TRUSTED',
  totalSales: 12,
  averageRating: 4.8,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  subscriptionTier: 'FREE',
  isVerifiedExpert: false,
  verifiedExpertAt: null,
  expertBadgeReason: null,
  kycStatus: 'VERIFIED',
  kycIdVerifiedAt: new Date('2024-02-01T00:00:00Z'),
  phoneVerified: true,
  emailVerifiedAt: new Date('2024-01-02T00:00:00Z'),
  _count: { ratingsReceived: 11 },
};

describe('the public seller profile', () => {
  it('serves the real review count the cached average is based on', async () => {
    const { controller, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(PROFILE);

    const response = (await controller.getSellerProfile('seller')) as Record<
      string,
      unknown
    >;

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          _count: { select: { ratingsReceived: true } },
        }),
      }),
    );
    expect(response.totalRatings).toBe(11);
    // The count wrapper is not part of the payload.
    expect(response).not.toHaveProperty('_count');
    // Everything else about the privacy-safe payload is unchanged.
    expect(response).toMatchObject({
      username: 'seller-handle',
      totalSales: 12,
      averageRating: 4.8,
      sellerTier: 'TRUSTED',
      idVerified: true,
      verification: {
        phoneVerified: true,
        emailVerified: true,
        idVerified: true,
      },
    });
    expect(response).not.toHaveProperty('firstName');
    expect(response).not.toHaveProperty('email');
  });

  it('404s a missing or closed seller', async () => {
    const { controller, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(controller.getSellerProfile('gone')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
