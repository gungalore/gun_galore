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
import { verifyToken } from '@clerk/backend';

// ────────────────────────────────────────────────────────────────────
// LETTING A PHONE UPLOAD ON A DESKTOP MEMBER'S BEHALF.
//
// The whole point of the QR handoff is that the phone is NOT signed in —
// asking somebody to log in on their phone before they can photograph a card
// is the friction the handoff exists to remove. The token is the credential.
//
// ⚠️ IT SETS request.clerkUserId TO THE AUTHORISING MEMBER, which means every
// service behind it runs exactly as if that member had called it themselves —
// `@CurrentUser()` reads that field and nothing downstream can tell the
// difference. That is deliberate (it is why no *ForUser service variants were
// needed) and it is also why the purpose check below is not optional: a token
// minted for anything else must never reach this path.
//
// ⚠️ IT DOES NOT CONSUME. A scanning session is several files, and consuming
// on the first would 410 the rest mid-scan with no recovery but a re-mint.
// The token is bounded by a 15-minute expiry instead — see the note on
// SCAN_HANDOFF in action-tokens.service.ts.
// ────────────────────────────────────────────────────────────────────

@Injectable()
export class ScanHandoffGuard implements CanActivate {
  private readonly logger = new Logger(ScanHandoffGuard.name);

  constructor(
    private readonly tokens: ActionTokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & {
      clerkUserId?: string;
      viaActionToken?: boolean;
    }>();

    // A signed-in caller is still welcome — the same phone page works for
    // somebody who happens to be logged in, and the desktop uses these
    // routes in tests.
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = await verifyToken(auth.slice(7), {
          secretKey: process.env.CLERK_SECRET_KEY!,
        });
        request.clerkUserId = payload.sub!;
        request.viaActionToken = false;
        return true;
      } catch {
        // Stale bearer — fall through to the token.
      }
    }

    const tokenStr = this.extractTokenParam(request);
    if (!tokenStr) throw new UnauthorizedException();

    try {
      const resolved = await this.tokens.resolve(tokenStr);
      if (resolved.purpose !== 'SCAN_HANDOFF') {
        // ⚠️ WRONG-PURPOSE USE COUNTS TOWARD THE LOCK. Five of these and the
        // token is dead for good — which is the point, because probing one
        // valid token against every other purpose's handler is exactly what
        // somebody who found a QR code would try.
        await this.tokens.markInvalid(tokenStr);
        throw new UnauthorizedException(
          'This link is not authorised for scanning documents',
        );
      }
      const user = await this.prisma.user.findUnique({
        where: { id: resolved.authorisedUserId },
        select: { clerkId: true },
      });
      if (!user) throw new UnauthorizedException();
      request.clerkUserId = user.clerkId;
      request.viaActionToken = true;
      return true;
    } catch (err) {
      this.logger.debug(`Scan handoff token check failed: ${(err as Error).message}`);
      throw new UnauthorizedException();
    }
  }

  private extractTokenParam(request: Request): string | null {
    const q = request.query?.t;
    if (typeof q === 'string' && q.length > 0) return q;
    return null;
  }
}
