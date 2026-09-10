import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ActionTokensService } from '../actions/action-tokens.service';
import { SessionService } from './session.service';
import { extractAccessToken } from './extract-token';

/**
 * Dual-auth guard: accepts EITHER a member session OR an All Outdoor
 * CHECKOUT-scoped action token via ?t=<token>.
 *
 * Used on endpoints that need to work from BOTH the normal signed-in app AND
 * from an SMS-link checkout flow:
 *   - POST /transactions  (buyer creates the order + Peach checkout)
 *   - GET  /users/me      (checkout-form fetches saved address)
 *   - PATCH /users/me     (checkout-form saves captured address)
 *
 * Sets the same `request.userId` the `@CurrentUser()` decorator reads, so no
 * handler needs to know which door the caller came through.
 *
 * Also stamps `request.viaActionToken` so downstream handlers can apply extra
 * checks specific to token-auth requests (e.g. POST /transactions verifies
 * body.listingId matches the token's targetId — otherwise the token holder
 * could pay for a different listing than the SMS pointed at).
 *
 * Does NOT consume the token here — consumption is the action's
 * responsibility, since a CHECKOUT token spans multiple requests (load user,
 * update address, create transaction) and consuming on first read would break
 * the flow.
 */
@Injectable()
export class AuthOrTokenGuard implements CanActivate {
  private readonly logger = new Logger(AuthOrTokenGuard.name);

  constructor(
    private readonly tokens: ActionTokensService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request & {
        userId?: string;
        sessionId?: string;
        viaActionToken?: boolean;
        actionTokenTargetId?: string;
      }
    >();

    // Session first — it's the cheapest path (no DB hit) for the common case
    // where the user is signed in.
    const token = extractAccessToken(request);
    if (token) {
      try {
        const payload = await this.sessions.verify(token);
        request.userId = payload.sub;
        request.sessionId = payload.sid;
        request.viaActionToken = false;
        return true;
      } catch {
        // Session present but stale — fall through to the token check. We
        // don't fail outright because the user might be on a token-only flow
        // with an expired cookie still in the jar.
      }
    }

    const tokenStr = this.extractTokenParam(request);
    if (tokenStr) {
      try {
        const resolved = await this.tokens.resolve(tokenStr);
        if (resolved.purpose !== 'CHECKOUT') {
          // Token exists but isn't a checkout token — don't accept.
          // Wrong-purpose use is suspicious; count it toward the lock.
          await this.tokens.markInvalid(tokenStr);
          throw new UnauthorizedException(
            'This link is not authorised for checkout',
          );
        }
        // `authorisedUserId` IS User.id, so there is nothing left to look up.
        // The row cascade-deletes with its user, so a token that resolves is
        // proof the user still exists.
        request.userId = resolved.authorisedUserId;
        request.viaActionToken = true;
        request.actionTokenTargetId = resolved.targetId;
        return true;
      } catch (err) {
        // ActionTokensService gives tailored errors (404/410/403) for resolve
        // failures; for guards we unify them as 401 so a probe cannot tell a
        // wrong token from an expired one.
        this.logger.debug(
          `Action token check failed: ${(err as Error).message}`,
        );
        throw new UnauthorizedException();
      }
    }

    throw new UnauthorizedException();
  }

  private extractTokenParam(request: Request): string | undefined {
    const t = request.query?.t;
    if (typeof t === 'string' && t.length > 0 && t.length <= 64) return t;
    return undefined;
  }
}
