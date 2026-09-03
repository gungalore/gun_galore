import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { adminJwtSecret } from '../admin-jwt-secret';
import { READ_SHAPED_ROUTE } from '../decorators/read-shaped-route.decorator';

// Methods that cannot change anything. EVERYTHING ELSE is a write as far
// as this guard is concerned, whether or not anyone remembered to say so.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The only tier that may write. ADMIN is the legacy tier and the column
// default (AdminUser.role @default(ADMIN)); the schema says to treat it as
// MONITORING_ADMIN going forward, so anything that isn't SUPERADMIN reads.
const WRITE_ROLE = 'SUPERADMIN';

type AdminTokenPayload = { sub: string; email: string; role: string };

/**
 * Admin authentication AND authorization, in one guard on purpose.
 *
 * @UseGuards(AdminJwtGuard) is the only way a route authenticates as an
 * admin in this codebase, so putting the role check inside it makes coverage
 * STRUCTURAL: every one of the ~148 admin routes across ~14 controllers gets
 * it today, and a controller added next month gets it by the act of
 * authenticating at all. The alternative — a second guard each controller
 * opts into — fails OPEN on the controller that forgets, which is the wrong
 * failure direction for an authorization control.
 *
 * THE ROLE COMES OFF THE ROW, NOT THE TOKEN. admin-auth.service signs
 * { sub, email, role } with expiresIn '8h', so the token's role is whatever
 * was true at login. Re-reading the row is what makes a demotion — and, far
 * more importantly, a DEACTIVATION — bite on the very next request instead
 * of whenever the token happens to expire. "Switch off" is the emergency
 * control for a compromised administrator; one that takes up to 8 hours to
 * land is not a switch. Same reasoning AdminService already applies to its
 * three sensitive writes: the JWT can't be forged into a SUPERADMIN tier.
 *
 * One indexed lookup per admin request, on a panel that serves a single
 * operator. The cost is nothing next to the property it buys.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extract(request);
    if (!token) throw new UnauthorizedException();

    let payload: AdminTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AdminTokenPayload>(token, {
        secret: adminJwtSecret(),
      });
    } catch {
      throw new UnauthorizedException();
    }

    // Verified token → trust `sub`, and nothing else about the identity.
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { role: true, isActive: true },
    });

    if (!admin) {
      throw new ForbiddenException(
        'This admin account no longer exists. Ask a Full admin (SUPERADMIN) to recreate it, then sign in again.',
      );
    }

    // Checked before the method split: a switched-off admin gets nothing,
    // not even reads. This is the line that closes the 8-hour window.
    if (!admin.isActive) {
      throw new ForbiddenException(
        'Your admin access has been switched off. Ask a Full admin (SUPERADMIN) to reactivate your account.',
      );
    }

    // Hand downstream the LIVE role, not the one baked into the token.
    // SuperadminGuard and @CurrentAdmin() both read this object, so they
    // inherit the fresh value without either of them changing.
    (request as unknown as Record<string, unknown>)['adminUser'] = {
      ...payload,
      role: admin.role,
    };

    if (SAFE_METHODS.has(request.method?.toUpperCase() ?? '')) return true;

    // A mutating verb on a route nobody explicitly marked as a read IS a
    // write. @ReadShapedRoute() is the deliberate, commented exception.
    const readShaped = this.reflector.getAllAndOverride<boolean>(
      READ_SHAPED_ROUTE,
      [context.getHandler(), context.getClass()],
    );
    if (readShaped) return true;

    if (admin.role !== WRITE_ROLE) {
      throw new ForbiddenException(this.refusal(admin.role, request.method));
    }

    return true;
  }

  // Refusals name the role and say what to do next — an operator who hits
  // one should not have to guess which of the three tiers they are on.
  private refusal(role: string, method: string): string {
    const tier =
      role === 'ADMIN'
        ? 'ADMIN (the legacy tier, treated as read-only)'
        : `${role} (read-only)`;
    return `Your admin role is ${tier}, so you can view this but not change it. A ${method} request changes data and needs the SUPERADMIN role ("Full admin"). Ask a Full admin to make the change, or to upgrade your role.`;
  }

  private extract(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return undefined;
  }
}
