import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { verifyClerkToken } from './clerk-verify';

@Injectable()
export class ClerkGuard implements CanActivate {
  private readonly logger = new Logger(ClerkGuard.name);

  // In-flight sync promises keyed by clerkUserId. When the page that
  // just finished signing up fires several authenticated requests at
  // once (the user navigates, the dashboard fetches /me, etc.), all
  // of them hit canActivate before the User row exists. Without this
  // dedup, every request kicks off its own Clerk getUser + upsert,
  // which we'd see as the same "Auto-synced" log line printed N times
  // and N redundant write txns. The entry is cleared once the sync
  // settles so a future first-request for a different user isn't
  // accidentally blocked.
  private readonly inFlightSyncs = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) throw new UnauthorizedException();

    let clerkUserId: string;
    try {
      const payload = await verifyClerkToken(token);
      clerkUserId = payload.sub!;
      (request as Request & { clerkUserId?: string }).clerkUserId = clerkUserId;
    } catch {
      throw new UnauthorizedException();
    }

    // Fallback: in local dev (no public webhook), make sure our User row
    // exists. If it doesn't, fetch from Clerk's Backend API and upsert.
    // Cheap path: existsBy clerkId. If found, return true.
    const existing = await this.prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });
    if (!existing) {
      // Share one Clerk getUser + upsert across all concurrent
      // first-time requests for this user.
      let pending = this.inFlightSyncs.get(clerkUserId);
      if (!pending) {
        pending = this.syncFromClerk(clerkUserId).finally(() => {
          this.inFlightSyncs.delete(clerkUserId);
        });
        this.inFlightSyncs.set(clerkUserId, pending);
      }
      await pending;
    }

    return true;
  }

  private async syncFromClerk(clerkUserId: string) {
    // Single code path with the webhook + /users/me backstop: fetch from
    // the Clerk API, upsert (incl. relink-by-email), stamp consent. It
    // refuses to create a row when the Clerk user has NO email — the old
    // inline version mapped that to '' and died every request on the
    // email unique constraint once one ''-email row existed. Never
    // blocks the request either way; downstream throws if it truly
    // needs a row.
    const user = await this.usersService.lazyProvisionFromClerk(clerkUserId);
    if (user) {
      this.logger.log(`Auto-synced new user from Clerk: ${clerkUserId}`);
    } else {
      this.logger.warn(
        `Auto-sync did not create a row for ${clerkUserId} — likely an ` +
          `email-less Clerk user (created outside the sign-up form) or a ` +
          `Clerk API failure; see UsersService logs.`,
      );
    }
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
