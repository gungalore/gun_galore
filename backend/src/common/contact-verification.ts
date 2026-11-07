import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The one gate that decides whether a member has PROVEN both of their contact
 * points.
 *
 * Email is verified at sign-up (login refuses an unverified address), so this
 * is mostly about the phone — but both are checked here so a legacy row that
 * slipped through cannot buy, bid or sell on an unproven contact point.
 *
 * ⚠️ WHY A FORBIDDEN WITH A CODE, NOT A BARE MESSAGE. The client needs to tell
 * "verify your phone" apart from every other 403 so it can send the member
 * straight to /verify-phone instead of showing a dead end. The code is the
 * contract; the message is for humans and logs.
 */
export const CONTACT_UNVERIFIED = 'CONTACT_UNVERIFIED';

export async function assertContactVerified(
  prisma: PrismaService,
  userId: string,
  action: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true, phone: true, phoneVerified: true },
  });
  // The caller has already authenticated this user; a missing row is not this
  // gate's problem, and failing open here cannot grant anything — whatever
  // comes next will fail on its own user lookup.
  if (!user) return;

  const missing: string[] = [];
  // ⚠️ `=== null` / `=== false`, NOT falsy checks. Every row in production has
  // a real operator ID and the phone columns are booleans, but a row loaded
  // through a narrower select (or a test fixture) can carry `undefined`, and
  // treating "not loaded" as "unproven" would block a fully verified member.
  if (user.emailVerifiedAt === null) missing.push('email address');
  if (!user.phone) missing.push('phone number');
  else if (user.phoneVerified === false) missing.push('phone number');

  if (missing.length === 0) return;

  throw new ForbiddenException({
    code: CONTACT_UNVERIFIED,
    missing: missing.map((m) =>
      m === 'email address' ? 'email' : 'phone',
    ),
    message:
      missing.length === 2
        ? `Verify your email address and phone number before you ${action}.`
        : `Verify your ${missing[0]} before you ${action}.`,
  });
}
