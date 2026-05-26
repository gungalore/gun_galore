/* eslint-disable no-console */
/**
 * One-shot dev/test helper — grants the lifetime Ballistic Calculator
 * license to a specific user without going through Peach. Use this in
 * dev when you want to test purchaser-only paths (profile save,
 * unlimited AI lookups) without actually running a payment.
 *
 * Usage:
 *   cd backend
 *   npx ts-node --project tsconfig.json scripts\grant-ballistics-license.ts gjpfourie@gmail.com
 *
 * Idempotent: re-running on an already-licensed user is a no-op.
 * To REVOKE in dev, pass --revoke as the second argument.
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2];
  const revoke = process.argv[3] === '--revoke';
  if (!email || !email.includes('@')) {
    console.error(
      'Usage: npx ts-node scripts/grant-ballistics-license.ts <email> [--revoke]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        ballisticsPurchasedAt: true,
      },
    });
    if (!user) {
      console.error(`No user with email ${email}. Sign in to the app first.`);
      process.exit(1);
    }

    if (revoke) {
      if (!user.ballisticsPurchasedAt) {
        console.log(`User ${email} has no active license — nothing to revoke.`);
        return;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ballisticsPurchasedAt: null,
          ballisticsPurchasePeachId: null,
          ballisticsPurchaseAmountCents: null,
        },
      });
      console.log(`✓ Revoked ballistics license for ${email}.`);
      return;
    }

    if (user.ballisticsPurchasedAt) {
      console.log(
        `User ${email} already owns the license (since ${user.ballisticsPurchasedAt.toISOString()}). No-op.`,
      );
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ballisticsPurchasedAt: new Date(),
        ballisticsPurchasePeachId: 'dev-grant',
        ballisticsPurchaseAmountCents: 29900,
      },
    });
    console.log(`✓ Granted ballistics license to ${email} (dev-grant).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
