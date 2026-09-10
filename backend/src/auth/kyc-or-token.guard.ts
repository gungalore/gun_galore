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
 * Dual-auth guard for the KYC endpoints: accepts EITHER a member session OR
 * an All Outdoor KYC_VERIFY action token via ?t=<token>.
 *
 * Mirrors AuthOrTokenGuard but scoped to the KYC_VERIFY purpose so the seller
 * can complete identity verification straight from the SMS link without
 * signing in (the SMS opens in the default browser, which has no PWA
 * session). Kept as a SEPARATE guard rather than widening AuthOrTokenGuard so
 * each guard stays bound to exactly one token purpose — wrong-purpose tokens
 * are rejected + counted, preserving the brute-force lock semantics.
 *
 * Security note: the token only removes the LOGIN wall. It does not weaken the
 * identity proof — the member still has to satisfy Didit's document read,
 * passive liveness and face match. The token is single-purpose, user-bound,
 * expiring, and delivered to the seller's own phone.
 *
 * Sets `request.userId` (read by `@CurrentUser()`) from the token's authorised
 * user, so the KYC service methods work unchanged.
 */
@Injectable()
export class KycOrTokenGuard implements CanActivate {
  private readonly logger = new Logger(KycOrTokenGuard.name);

  constructor(
    private readonly tokens: ActionTokensService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<
        Request & {
          userId?: string;
          sessionId?: string;
          viaActionToken?: boolean;
        }
      >();

    // Session first — cheapest path for a signed-in user.
    const token = extractAccessToken(request);
    if (token) {
      try {
        const payload = await this.sessions.verify(token);
        request.userId = payload.sub;
        request.sessionId = payload.sid;
        request.viaActionToken = false;
        return true;
      } catch {
        // Stale/invalid session — fall through to the token check.
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
        request.userId = resolved.authorisedUserId;
        request.viaActionToken = true;
        return true;
      } catch (err) {
        this.logger.debug(`KYC token check failed: ${(err as Error).message}`);
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
