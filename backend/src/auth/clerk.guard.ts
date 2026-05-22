import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken, createClerkClient } from '@clerk/backend';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class ClerkGuard implements CanActivate {
  private readonly logger = new Logger(ClerkGuard.name);
  private readonly clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });

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
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
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
    try {
      const u = await this.clerk.users.getUser(clerkUserId);
      // Phone preference: verified Clerk phone > unsafe metadata > none
      const unsafePhone =
        typeof u.unsafeMetadata?.phone === 'string'
          ? u.unsafeMetadata.phone
          : undefined;
      const phone = u.phoneNumbers[0]?.phoneNumber ?? unsafePhone;

      await this.usersService.upsertFromClerk({
        clerkId: u.id,
        email: u.emailAddresses[0]?.emailAddress ?? '',
        username: u.username ?? undefined,
        firstName: u.firstName ?? undefined,
        lastName: u.lastName ?? undefined,
        phone,
        avatarUrl: u.imageUrl ?? undefined,
      });
      this.logger.log(`Auto-synced new user from Clerk: ${clerkUserId}`);
    } catch (err) {
      // Don't block the request — the downstream service will throw its
      // own ForbiddenException if it really needs a User row.
      this.logger.warn(
        `Failed to auto-sync ${clerkUserId} from Clerk: ${(err as Error).message}`,
      );
    }
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
