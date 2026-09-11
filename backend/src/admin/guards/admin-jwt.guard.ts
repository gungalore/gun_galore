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
import { OWN_ACCOUNT_ROUTE } from '../decorators/own-account-route.decorator';

// Methods that cannot change anything. EVERYTHING ELSE is a write as far
// as this guard is concerned, whether or not anyone remembered to say so.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The only tier that may write. ADMIN is the legacy tier and the column
// default (AdminUser.role @default(ADMIN)); the schema says to treat it as
// MONITORING_ADMIN going forward, so anything that isn't SUPERADMIN reads.
const WRITE_ROLE = 'SUPERADMIN';

type AdminTokenPayload = {
  sub: string;
  email: string;
  role: string;
  /** AdminSession.id. Absent on tokens minted before 2026-09-11. */
  sid?: string;
  /** Authentication methods: ['pwd','otp'] | ['pwd','recovery'] | ['pwd']. */
  amr?: string[];
};

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
 * THE ROLE COMES OFF THE ROW, NOT THE TOKEN. Re-reading the row is what makes
 * a demotion — and, far more importantly, a DEACTIVATION — bite on the very
 * next request instead of whenever the token happens to expire. "Switch off"
 * is the emergency control for a compromised administrator; one that takes
 * hours to land is not a switch.
 *
 * ⚠️ THIS GUARD IS MOUNTED FROM FOURTEEN MODULES — admin, licence-centre,
 * ratings, motivations, news, crime-stats, desk, reloading, ask-gg,
 * marketing, complaints, manual-payments, orders and support. Nest resolves a
 * controller's @UseGuards dependencies inside the controller's OWN module, so
 * GIVING THIS CLASS A NEW CONSTRUCTOR ARGUMENT CRASH-LOOPS THE BACKEND AT
 * BOOT in every module that has not also been given that provider — while
 * `tsc` and every unit test stay green. That is the failure that took the
 * site down for four minutes on 2026-09-07.
 *
 * It is also why the session check below reads `prisma.adminSession`
 * DIRECTLY instead of injecting AdminSessionService, which is the obvious
 * thing to reach for and would have required editing all fourteen modules to
 * add a provider none of them otherwise needs. The service still owns minting
 * and rotation; the guard owns one read it can already make.
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

    // ⚠️ A TOKEN WITH NO `sid` IS REFUSED, NOT GRANDFATHERED. Before
    // 2026-09-11 the admin JWT WAS the session: eight hours long, revocable
    // by nothing, and sign-out cleared a cookie this guard never read. Those
    // tokens are precisely the thing AdminSession exists to abolish, and
    // there is no row that could ever revoke one — so accepting them "just
    // during the rollout" would leave every live pre-deploy token immortal
    // until it expired. The cost is that everyone signs in again on deploy.
    // That is the intended cost; deploy when the operator is at a keyboard.
    if (!payload.sid) {
      throw new UnauthorizedException(
        'Your Desk session predates the new sign-in and cannot be verified. Sign in again.',
      );
    }

    // Verified token → trust `sub` and `sid`, and nothing else about it.
    //
    // ⚠️ TWO READS PER REQUEST, DELIBERATELY, AND NOT WHAT THE MEMBER SIDE
    // DOES. SessionService.verify() is a pure token check with NO database
    // read, because the member access token is on the hot path of the whole
    // public API and its fifteen-minute life is what bounds a revoked session
    // still being accepted. This surface is one operator on a panel that can
    // approve a command running as root on the production box: the fifteen
    // minutes between revoking a session and it actually stopping is the
    // difference between "we cut them off" and "we cut them off shortly".
    // Two indexed lookups on a single-operator panel cost nothing next to
    // that. Do NOT copy the member pattern here to save a query.
    const [admin, session] = await Promise.all([
      this.prisma.adminUser.findUnique({
        where: { id: payload.sub },
        select: { role: true, isActive: true },
      }),
      this.prisma.adminSession.findUnique({
        where: { id: payload.sid },
        select: {
          adminUserId: true,
          revokedAt: true,
          expiresAt: true,
          recoveryOnly: true,
        },
      }),
    ]);

    if (!admin) {
      throw new ForbiddenException(
        'This admin account no longer exists. Ask a Full admin (SUPERADMIN) to recreate it, then sign in again.',
      );
    }

    // Checked before the method split: a switched-off admin gets nothing,
    // not even reads. This is the line that closes the token's own window.
    if (!admin.isActive) {
      throw new ForbiddenException(
        'Your admin access has been switched off. Ask a Full admin (SUPERADMIN) to reactivate your account.',
      );
    }

    // ⚠️ THE SESSION MUST BELONG TO THE SUBJECT IN THE TOKEN. Both halves are
    // signed, so this cannot currently disagree — but a future change that
    // mints a token from one place and a session from another would otherwise
    // let a valid session id be paired with somebody else's `sub`, and the
    // role read above would then be the WRONG admin's role. Check it here,
    // where it is one comparison, rather than reason about it later.
    if (!session || session.adminUserId !== payload.sub) {
      throw new UnauthorizedException('That session has ended. Sign in again.');
    }
    if (session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('That session has ended. Sign in again.');
    }

    // Hand downstream the LIVE role, not the one baked into the token.
    // SuperadminGuard and @CurrentAdmin() both read this object, so they
    // inherit the fresh value without either of them changing.
    (request as unknown as Record<string, unknown>)['adminUser'] = {
      ...payload,
      role: admin.role,
      sid: payload.sid,
      amr: payload.amr ?? [],
      recoveryOnly: session.recoveryOnly,
    };

    if (SAFE_METHODS.has(request.method?.toUpperCase() ?? '')) return true;

    // A mutating verb on a route nobody explicitly marked as a read IS a
    // write. @ReadShapedRoute() is the deliberate, commented exception.
    const readShaped = this.reflector.getAllAndOverride<boolean>(
      READ_SHAPED_ROUTE,
      [context.getHandler(), context.getClass()],
    );
    if (readShaped) return true;

    // The second exception: a write whose only subject is the caller's own
    // credential — their password, their TOTP secret, their sessions.
    //
    // ⚠️ THIS MUST COME BEFORE BOTH REMAINING CHECKS. A monitoring admin has
    // to be able to change the password they were handed, and a recovery-only
    // session has to be able to re-enrol the factor that lifts its own
    // restriction. Put this after either check and a lost phone becomes an
    // unrecoverable account, or a read-only admin can never rotate a
    // credential — in both cases discovered only by somebody locked out.
    const ownAccount = this.reflector.getAllAndOverride<boolean>(
      OWN_ACCOUNT_ROUTE,
      [context.getHandler(), context.getClass()],
    );
    if (ownAccount) return true;

    // ⚠️ CHECKED BEFORE THE ROLE, so the refusal says the useful thing. A
    // SUPERADMIN on a recovery-only session who is told "your role is
    // read-only" would reasonably conclude their account had been demoted.
    // A recovery code proves possession of a piece of paper, not of the
    // phone — so the session reads, and nothing more, until TOTP is
    // re-enrolled and a fresh session is opened.
    if (session.recoveryOnly) {
      throw new ForbiddenException(
        'This session was opened without your authenticator app, so it can view but not change anything. Enrol your authenticator again under Account, then sign in with it.',
      );
    }

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
