import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { verifyClerkToken } from './clerk-verify';

/**
 * Dual-auth guard: accepts EITHER a Clerk session bearer token OR
 * a All Outdoor CHECKOUT-scoped action token via ?t=<token>.
 *
 * Used on endpoints that need to work from BOTH the normal
 * Clerk-authed app AND from an SMS-link checkout flow:
 *   - POST /transactions  (buyer creates the order + Peach checkout)
 *   - GET  /users/me      (checkout-form fetches saved address)
 *   - PATCH /users/me     (checkout-form saves captured address)
 *
 * Sets the same `request.clerkUserId` the existing @CurrentUser()
 * decorator reads, so no decorator changes are needed.
 *
 * Also stamps `request.viaActionToken = true/false` so downstream
 * handlers can apply extra checks specific to token-auth requests
 * (e.g. POST /transactions verifies body.listingId matches the
 * token's targetId — otherwise the token holder could pay for a
 * different listing than the SMS pointed at).
 *
 * Does NOT consume the token here — consumption is the action's
 * responsibility, since a CHECKOUT token spans multiple requests
 * (load user, update address, create transaction) and consuming
 * on first read would break the flow.
 */
@Injectable()
export class ClerkOrTokenGuard implements CanActivate {
  private readonly logger = new Logger(ClerkOrTokenGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: ActionTokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<
        Request & { clerkUserId?: string; viaActionToken?: boolean; actionTokenTargetId?: string }
      >();

    // Try Clerk first — it's the cheapest path (no DB hit) for the
    // common case where the user is signed in.
    const bearer = this.extractBearer(request);
    if (bearer) {
      try {
        const payload = await verifyClerkToken(bearer);
        request.clerkUserId = payload.sub!;
        request.viaActionToken = false;
        return true;
      } catch {
        // Bearer present but invalid — fall through to token check.
        // We don't fail outright because the user might be on a
        // token-only flow with a stale Clerk cookie.
      }
    }

    // Fall back to action token via ?t= query param.
    const tokenStr = this.extractTokenParam(request);
    if (tokenStr) {
      try {
        const resolved = await this.tokens.resolve(tokenStr);
        if (resolved.purpose !== 'CHECKOUT') {
          // Token exists but isn't a checkout token — don't accept.
          // Wrong-purpose use is suspicious; increment invalid counter.
          await this.tokens.markInvalid(tokenStr);
          throw new UnauthorizedException(
            'This link is not authorised for checkout',
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
        request.actionTokenTargetId = resolved.targetId;
        return true;
      } catch (err) {
        // Token resolve threw — propagate as Unauthorized. The
        // ActionTokensService gives us tailored errors (404/410/403)
        // for resolve failures; for guards we just unify them as 401.
        this.logger.debug(
          `Action token check failed: ${(err as Error).message}`,
        );
        throw new UnauthorizedException();
      }
    }

    // Neither a bearer nor a token — reject.
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
