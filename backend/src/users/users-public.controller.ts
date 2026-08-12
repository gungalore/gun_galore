import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

// Public endpoints under /api/users that don't require authentication.
// Used by the sign-up form to check username availability before the user
// actually has a Clerk session.
@Controller('users')
export class UsersPublicController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/users/username-check?u=<value>
   *
   * Returns `{ available: boolean, reason?: string }`. We validate the
   * shape locally so the client gets the same answer the form will (length,
   * allowed characters, banned reserved words) before we hit the DB.
   *
   * Public on purpose — required for the pre-signup flow. Rate-limited
   * tightly because username-check is the most obvious user-enumeration
   * vector (call rate gives an attacker a list of usernames in use).
   * 10 req/min/IP — overrides the global 60/min default down.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('username-check')
  async checkUsername(
    @Query('u') raw: string,
  ): Promise<{ available: boolean; reason?: string }> {
    const u = (raw ?? '').trim().toLowerCase();

    // These rules must stay at least as STRICT as the Clerk instance's
    // username requirements (Configure > User & authentication > Username:
    // min 4, max 64, numeric-only rejected). This endpoint is what puts the
    // green "available" tick next to the field, so anything it accepts and
    // Clerk then rejects turns into a confusing failure AFTER the user has
    // filled in the whole form. If Clerk's rules are relaxed, relax these too
    // — never the other way round.
    if (!u) return { available: false, reason: 'Required' };
    if (u.length < 4) return { available: false, reason: 'Too short (min 4)' };
    if (u.length > 32) return { available: false, reason: 'Too long (max 32)' };
    if (!/^[a-z0-9_]+$/.test(u)) {
      return {
        available: false,
        reason: 'Only lowercase letters, numbers, and underscores',
      };
    }
    // Clerk rejects usernames made only of digits ("Allow numeric usernames"
    // is off), and an all-numeric handle reads as an account ID anyway.
    if (/^[0-9]+$/.test(u)) {
      return { available: false, reason: 'Needs at least one letter' };
    }
    if (RESERVED.has(u)) {
      return { available: false, reason: 'Reserved — pick another' };
    }

    const existing = await this.prisma.user.findUnique({
      where: { username: u },
      select: { id: true },
    });
    if (existing) {
      return { available: false, reason: 'Already taken' };
    }
    return { available: true };
  }
}

// Reserved handles we don't want users grabbing — keeps routes clean and
// blocks impersonation of platform accounts.
const RESERVED = new Set([
  'admin',
  'administrator',
  'support',
  'help',
  'staff',
  'system',
  // Old trading name kept reserved so nobody can squat it post-rebrand.
  'gungalore',
  'gun_galore',
  'alloutdoor',
  'all_outdoor',
  'official',
  'moderator',
  'sales',
  'billing',
  'security',
  'api',
  'root',
  'webmaster',
  'noreply',
  'mail',
  'me',
  'you',
  'anonymous',
  'null',
  'undefined',
  'competitions',
  'auctions',
  'marketplace',
]);
