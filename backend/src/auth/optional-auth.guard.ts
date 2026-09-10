import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from './session.service';
import { extractAccessToken } from './extract-token';

/**
 * Optional auth for public-but-owner-aware reads.
 *
 * Unlike {@link AuthGuard}, this NEVER rejects: if a valid session token is
 * present it stamps `request.userId` (so `@CurrentUser()` resolves the
 * caller); otherwise the request simply proceeds anonymously.
 *
 * Used on endpoints that are public by default but hand the resource OWNER a
 * few extra fields — e.g. `GET /listings/:id`, where anonymous / non-owner
 * callers get the public projection and the authenticated seller additionally
 * gets their hidden reserve, auto-accept threshold, and moderation banner
 * data. An invalid / expired token is treated as anonymous (never a 401), so a
 * stale session can't turn a public read into an error.
 *
 * ⚠️ A public read path with NO guard at all is a leak, not a shortcut: with
 * nothing stamping `request.userId` the handler cannot tell owner from
 * stranger, and the owner-only branch is the one that returns the reserve.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { userId?: string; sessionId?: string }>();

    const token = extractAccessToken(request);
    if (token) {
      try {
        const payload = await this.sessions.verify(token);
        request.userId = payload.sub;
        request.sessionId = payload.sid;
      } catch {
        // Invalid / expired token → treat as anonymous. Public reads must
        // never 401 just because a signed-in user's token has gone stale.
      }
    }

    return true;
  }
}
