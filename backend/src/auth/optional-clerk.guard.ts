import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { Request } from 'express';

/**
 * Optional Clerk auth for public-but-owner-aware reads.
 *
 * Unlike {@link ClerkGuard}, this NEVER rejects the request: if a valid
 * `Authorization: Bearer <clerk-session-token>` is present it stamps
 * `request.clerkUserId` (so the existing `@CurrentUser()` decorator resolves
 * the caller); otherwise the request simply proceeds anonymously.
 *
 * Used on endpoints that are public by default but hand the resource OWNER a
 * few extra fields — e.g. `GET /listings/:id`, where anonymous / non-owner
 * callers get the public projection and the authenticated seller additionally
 * gets their hidden reserve, auto-accept threshold, and moderation banner
 * data. An invalid / expired token is treated as anonymous (never a 401), so a
 * stale session cookie can't turn a public read into an error.
 *
 * Does NOT auto-sync the User row from Clerk (a read doesn't need one) — that
 * lazy-sync stays the responsibility of {@link ClerkGuard} on write paths.
 */
@Injectable()
export class OptionalClerkGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { clerkUserId?: string }>();

    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) {
      try {
        const payload = await verifyToken(token, {
          secretKey: process.env.CLERK_SECRET_KEY,
        });
        request.clerkUserId = payload.sub!;
      } catch {
        // Invalid / expired token → treat as anonymous. Public reads must
        // never 401 just because a signed-in user's token has gone stale.
      }
    }

    return true;
  }
}
