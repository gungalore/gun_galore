import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CONTACT_UNVERIFIED,
  assertContactVerified,
} from './contact-verification';

function prismaWith(user: Record<string, unknown> | null): PrismaService {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
  } as unknown as PrismaService;
}

const VERIFIED = {
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  phone: '+27821234567',
  phoneVerified: true,
};

describe('assertContactVerified', () => {
  it('lets a fully verified member through', async () => {
    await expect(
      assertContactVerified(prismaWith(VERIFIED), 'u1', 'buy'),
    ).resolves.toBeUndefined();
  });

  it('refuses a member whose phone was never verified', async () => {
    const prisma = prismaWith({ ...VERIFIED, phoneVerified: false });
    await expect(assertContactVerified(prisma, 'u1', 'buy')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      assertContactVerified(prisma, 'u1', 'buy'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: CONTACT_UNVERIFIED }),
    });
  });

  it('refuses a member with no phone at all', async () => {
    const prisma = prismaWith({ ...VERIFIED, phone: null });
    await expect(
      assertContactVerified(prisma, 'u1', 'sell'),
    ).rejects.toThrow(/phone number/);
  });

  it('refuses a member whose email is unverified', async () => {
    const prisma = prismaWith({ ...VERIFIED, emailVerifiedAt: null });
    await expect(
      assertContactVerified(prisma, 'u1', 'bid'),
    ).rejects.toThrow(/email address/);
  });

  it('names BOTH contact points when both are missing', async () => {
    const prisma = prismaWith({
      emailVerifiedAt: null,
      phone: null,
      phoneVerified: false,
    });
    await expect(
      assertContactVerified(prisma, 'u1', 'checkout'),
    ).rejects.toThrow(/email address and phone number/);
  });

  it('fails open when the row is missing entirely — the caller already authenticated', async () => {
    await expect(
      assertContactVerified(prismaWith(null), 'u1', 'buy'),
    ).resolves.toBeUndefined();
  });

  it('does not treat an unloaded field as unproven', async () => {
    // A narrower select (or a fixture) can carry undefined. Treating that as
    // "unverified" would block a fully verified member.
    const prisma = prismaWith({ phone: '+27821234567' });
    await expect(
      assertContactVerified(prisma, 'u1', 'buy'),
    ).resolves.toBeUndefined();
  });
});
