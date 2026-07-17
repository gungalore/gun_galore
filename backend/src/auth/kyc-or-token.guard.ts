import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyClerkToken } from './clerk-verify';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ActionTokensService } from '../actions/action-tokens.service';

/**
 * Dual-auth guard for the KYC endpoints: accepts EITHER a Clerk session
 * bearer OR a Gun Galore KYC_VERIFY action token via ?t=<token>.
 *
 * Mirrors ClerkOrTokenGuard but scoped to the KYC_VERIFY purpose so the
 * seller can complete identity verification straight from the SMS link
 * without signing in (the SMS opens in the default browser, which has no
 * PWA session). Kept as a SEPARATE guard rather than widening
 * ClerkOrTokenGuard so each guard stays bound to exactly one token
 * purpose — wrong-purpose tokens are rejected + counted, preserving the
 * brute-force lock semantics.
 *
 * Security note: the token only removes the LOGIN wall. It does not
 * weaken the identity proof — verifyId() still cross-checks the SA ID
 * against Home Affairs and faceMatch() still matches a live selfie. The
 * token is single-purpose, user-bound, expiring, and delivered to the
 * seller's own phone.
 *
 * Sets `request.clerkUserId` (read by @CurrentUser()) from the token's
 * authorised user, so the KYC service methods work unchanged.
 */
@Injectable()
export class KycOrTokenGuard implements CanActivate {
  private readonly logger = new Logger(KycOrTokenGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: ActionTokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<
        Request & { clerkUserId?: string; viaActionToken?: boolean }
      >();

    // Clerk session first — cheapest path for a signed-in user.
    const bearer = this.extractBearer(request);
    if (bearer) {
      try {
        const payload = await verifyClerkToken(bearer);
        request.clerkUserId = payload.sub!;
        request.viaActionToken = false;
        return true;
      } catch {
        // Stale/invalid bearer — fall through to the token check.
      }
    }

    // Fall back to a KYC_VERIFY action token via ?t=.
    const tokenStr = this.extractTokenParam(request);
    if (tokenStr) {
      try {
        const resolved = await this.tokens.resolve(tokenStr);
        if (resolved.purpose !== 'KYC_VERIFY') {
          // Wrong-purpose use is suspicious — count it toward the lock.
          await this.tokens.markInvalid(tokenStr);
          throw new UnauthorizedException(
            'This link is not authorised for identity verification',
          );
        }
        const user = await this.prisma.user.findUnique({
          where: { id: resolved.authorisedUserId },
          select: { clerkId: true },
        });
        if (!user) {
          throw new UnauthorizedException();
        }
        request.clerkUserId = user.clerkId;
        request.viaActionToken = true;
        return true;
      } catch (err) {
        this.logger.debug(
          `KYC token check failed: ${(err as Error).message}`,
        );
        throw new UnauthorizedException();
      }
    }

    throw new UnauthorizedException();
  }

  private extractBearer(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private extractTokenParam(request: Request): string | undefined {
    const t = request.query?.t;
    if (typeof t === 'string' && t.length > 0 && t.length <= 64) return t;
    return undefined;
  }
}
