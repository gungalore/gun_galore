import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminJwtGuard } from './admin-jwt.guard';
import { READ_SHAPED_ROUTE } from '../decorators/read-shaped-route.decorator';
import { OWN_ACCOUNT_ROUTE } from '../decorators/own-account-route.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { Reflector } from '@nestjs/core';

/**
 * ⚠️ THE FOUR PROPERTIES THIS GUARD CARRIES, AND WHAT BREAKS WITHOUT EACH:
 *
 *  1. Deny-by-default on the METHOD, not on a list of protected routes. A
 *     mutating route added next month is covered by the act of authenticating.
 *  2. The role and `isActive` come off the ROW, not the token — so switching
 *     an admin off bites on the very next request rather than whenever their
 *     token happens to expire. That was the only revocation lever that worked
 *     at all before AdminSession existed.
 *  3. The session row is checked too. A sign-out, a password change or a
 *     deactivation revokes it, and the next request with the still-unexpired
 *     access token is refused. Without this, "sign out" is cosmetic.
 *  4. A session opened with a recovery code may READ and nothing else,
 *     whatever the admin's role says — because a recovery code proves
 *     possession of a piece of paper, not of the phone.
 */

// ADMIN_JWT_SECRET must be present or adminJwtSecret() throws in production
// and returns a dev default otherwise; the tests stub verifyAsync anyway.
function makeGuard(opts: {
  payload?: Record<string, unknown> | null;
  admin?: { role: string; isActive: boolean } | null;
  session?: {
    adminUserId: string;
    revokedAt: Date | null;
    expiresAt: Date;
    recoveryOnly: boolean;
  } | null;
  readShaped?: boolean;
  ownAccount?: boolean;
}) {
  const jwtService = {
    verifyAsync: jest.fn(async () => {
      if (opts.payload === null) throw new Error('bad token');
      return (
        opts.payload ?? {
          sub: 'A1',
          email: 'ops@alloutdoor.co.za',
          role: 'SUPERADMIN',
          sid: 'S1',
          amr: ['pwd', 'otp'],
        }
      );
    }),
  };

  const prisma = {
    adminUser: {
      findUnique: jest.fn(async () =>
        opts.admin === undefined
          ? { role: 'SUPERADMIN', isActive: true }
          : opts.admin,
      ),
    },
    adminSession: {
      findUnique: jest.fn(async () =>
        opts.session === undefined
          ? {
              adminUserId: 'A1',
              revokedAt: null,
              expiresAt: new Date(Date.now() + 86_400_000),
              recoveryOnly: false,
            }
          : opts.session,
      ),
    },
  };

  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === READ_SHAPED_ROUTE
        ? (opts.readShaped ?? false)
        : key === OWN_ACCOUNT_ROUTE
          ? (opts.ownAccount ?? false)
          : false,
    ),
  };

  return {
    guard: new AdminJwtGuard(
      jwtService as unknown as JwtService,
      prisma as unknown as PrismaService,
      reflector as unknown as Reflector,
    ),
    prisma,
  };
}

function ctx(method: string, token = 'a.b.c') {
  const request: Record<string, unknown> = {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as never,
  };
}

describe('the constructor signature is load-bearing', () => {
  it('TAKES EXACTLY THREE DEPENDENCIES AND MUST KEEP TAKING THREE', () => {
    // 🚨 THIS IS NOT A STYLE TEST. AdminJwtGuard is mounted from FOURTEEN
    // modules — admin, licence-centre, ratings, motivations, news,
    // crime-stats, desk, reloading, ask-gg, marketing, complaints,
    // manual-payments, orders, support. Nest resolves a controller's
    // @UseGuards dependencies inside the controller's OWN module, so adding a
    // fourth constructor argument crash-loops the backend at boot in every
    // one of those modules that has not also been given the new provider —
    // while `tsc` stays clean and every other unit test passes. pm2 restarted
    // the API 54 times on 2026-09-07 for exactly this, and the site was down
    // for four minutes.
    //
    // It is also why the session check reads `prisma.adminSession` directly
    // instead of injecting AdminSessionService, which is the obvious thing to
    // reach for and would have meant editing all fourteen modules.
    //
    // If you genuinely need a fourth: add the provider to all fourteen
    // modules in the SAME commit, then change this number.
    expect(AdminJwtGuard.length).toBe(3);
  });
});

describe('token shape', () => {
  it('refuses a request with no Authorization header', async () => {
    const { guard } = makeGuard({});
    const { context } = ctx('GET', '');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('REFUSES A TOKEN WITH NO sid RATHER THAN GRANDFATHERING IT', async () => {
    // ⚠️ THE WHOLE POINT OF THE PHASE. A sid-less token is a pre-2026-09-11
    // eight-hour bearer with no session row behind it — nothing anywhere can
    // revoke one. Accepting them "just during the rollout" would leave every
    // live pre-deploy token immortal until it expired on its own.
    const { guard } = makeGuard({
      payload: { sub: 'A1', email: 'ops@alloutdoor.co.za', role: 'SUPERADMIN' },
    });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /predates the new sign-in/,
    );
  });

  it('refuses a token that will not verify', async () => {
    const { guard } = makeGuard({ payload: null });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('does not read a cookie — the guard is Bearer-only', async () => {
    // ⚠️ `gg_admin_sess` is set by the login route and read by NOTHING here.
    // Any plan that treats the cookie as the credential will look right in a
    // browser and 401 every request. Making the guard read it also needs CSRF
    // protection, which does not exist — see the controller's comment.
    const { guard } = makeGuard({});
    const { context, request } = ctx('GET', '');
    (request as Record<string, unknown>).cookies = { gg_admin_sess: 'a.b.c' };
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('the row is authoritative, not the token', () => {
  it('refuses when the admin row is gone', async () => {
    const { guard } = makeGuard({ admin: null });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /no longer exists/,
    );
  });

  it('refuses a switched-off admin EVEN ON A GET', async () => {
    // ⚠️ Checked before the method split on purpose. "Switch off" is the
    // emergency control for a compromised administrator; one that still lets
    // them read every member's details is not a switch.
    const { guard } = makeGuard({
      admin: { role: 'SUPERADMIN', isActive: false },
    });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /switched off/,
    );
  });

  it('hands downstream the LIVE role, overwriting the token’s', async () => {
    const { guard } = makeGuard({
      payload: {
        sub: 'A1',
        email: 'ops@alloutdoor.co.za',
        role: 'SUPERADMIN', // stale: they were demoted after signing in
        sid: 'S1',
        amr: ['pwd', 'otp'],
      },
      admin: { role: 'MONITORING_ADMIN', isActive: true },
    });
    const { context, request } = ctx('GET');
    await guard.canActivate(context);
    expect((request.adminUser as { role: string }).role).toBe(
      'MONITORING_ADMIN',
    );
  });
});

describe('the session row is checked', () => {
  it('refuses a revoked session, so sign-out actually signs out', async () => {
    const { guard } = makeGuard({
      session: {
        adminUserId: 'A1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        recoveryOnly: false,
      },
    });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /session has ended/,
    );
  });

  it('refuses an expired session', async () => {
    const { guard } = makeGuard({
      session: {
        adminUserId: 'A1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1),
        recoveryOnly: false,
      },
    });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /session has ended/,
    );
  });

  it('refuses a session that belongs to a DIFFERENT admin', async () => {
    // ⚠️ Both halves are signed today so this cannot currently disagree — but
    // a future change that mints a token in one place and a session in
    // another would otherwise pair a valid session id with somebody else's
    // `sub`, and the role read would then be the WRONG admin's role.
    const { guard } = makeGuard({
      session: {
        adminUserId: 'A2',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        recoveryOnly: false,
      },
    });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /session has ended/,
    );
  });

  it('refuses when the session row simply does not exist', async () => {
    const { guard } = makeGuard({ session: null });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('makes exactly TWO database reads, not more', async () => {
    // ⚠️ The member side's verify() does NO database read, deliberately,
    // because it sits on the hot path of the whole public API. This surface
    // is one operator on a panel that can approve a production shell, so two
    // indexed lookups buy immediate revocation and cost nothing. Do not copy
    // the member pattern here to save a query, and do not add a third.
    const { guard, prisma } = makeGuard({});
    const { context } = ctx('GET');
    await guard.canActivate(context);
    expect(prisma.adminUser.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.adminSession.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('deny-by-default on the method', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    it(`${method} is open to any active admin, whatever their role`, async () => {
      const { guard } = makeGuard({
        admin: { role: 'MONITORING_ADMIN', isActive: true },
      });
      const { context } = ctx(method);
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  }

  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    it(`${method} needs SUPERADMIN`, async () => {
      const { guard } = makeGuard({
        admin: { role: 'MONITORING_ADMIN', isActive: true },
      });
      const { context } = ctx(method);
      await expect(guard.canActivate(context)).rejects.toThrow(
        /needs the SUPERADMIN role/,
      );
    });
  }

  it('treats the legacy ADMIN tier as read-only and names it in the refusal', async () => {
    const { guard } = makeGuard({ admin: { role: 'ADMIN', isActive: true } });
    const { context } = ctx('POST');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /legacy tier, treated as read-only/,
    );
  });

  it('@ReadShapedRoute() lets a read-only admin through a mutating verb', async () => {
    const { guard } = makeGuard({
      admin: { role: 'MONITORING_ADMIN', isActive: true },
      readShaped: true,
    });
    const { context } = ctx('POST');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

describe('the recovery-code write block (amr)', () => {
  const RECOVERY_SESSION = {
    adminUserId: 'A1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    recoveryOnly: true,
  };

  it('lets a recovery-only session READ', async () => {
    const { guard } = makeGuard({ session: RECOVERY_SESSION });
    const { context } = ctx('GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('REFUSES A SUPERADMIN WRITE ON A RECOVERY-ONLY SESSION', async () => {
    // ⚠️ The property the `amr` claim exists for. A recovery code is a bearer
    // secret on a piece of paper: it proves the holder had the paper, not
    // that they still hold the phone. Role is irrelevant here — a Full admin
    // on a recovery session writes nothing.
    const { guard } = makeGuard({
      admin: { role: 'SUPERADMIN', isActive: true },
      session: RECOVERY_SESSION,
    });
    const { context } = ctx('POST');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /without your authenticator app/,
    );
  });

  it('refuses BEFORE the role check, so the message is the useful one', async () => {
    // ⚠️ A SUPERADMIN told "your role is read-only" would reasonably conclude
    // their account had been demoted and go looking for the wrong problem.
    const { guard } = makeGuard({
      admin: { role: 'SUPERADMIN', isActive: true },
      session: RECOVERY_SESSION,
    });
    const { context } = ctx('DELETE');
    const err = await guard
      .canActivate(context)
      .catch((e: ForbiddenException) => e);
    expect((err as Error).message).not.toMatch(/Your admin role is/);
    expect((err as Error).message).toMatch(/Enrol your authenticator again/);
  });

  it('a @ReadShapedRoute() POST still passes on a recovery session — it writes nothing', async () => {
    const { guard } = makeGuard({
      session: RECOVERY_SESSION,
      readShaped: true,
    });
    const { context } = ctx('POST');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('surfaces recoveryOnly on request.adminUser so handlers can see it', async () => {
    const { guard } = makeGuard({ session: RECOVERY_SESSION });
    const { context, request } = ctx('GET');
    await guard.canActivate(context);
    expect(request.adminUser).toMatchObject({
      recoveryOnly: true,
      sid: 'S1',
      amr: ['pwd', 'otp'],
    });
  });
});

describe('@OwnAccountRoute()', () => {
  it('lets a MONITORING_ADMIN change their own credential', async () => {
    // ⚠️ Without this hatch the hardening deadlocks: changing your own
    // password is a POST, so a read-only admin could never rotate the
    // password they were handed.
    const { guard } = makeGuard({
      admin: { role: 'MONITORING_ADMIN', isActive: true },
      ownAccount: true,
    });
    const { context } = ctx('POST');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('LETS A RECOVERY-ONLY SESSION RE-ENROL, which is what lifts its own block', async () => {
    // ⚠️ If the recovery block applied here too, a lost phone would be an
    // unrecoverable account by design: read-only "until you re-enrol", and
    // re-enrolling is a write.
    const { guard } = makeGuard({
      session: {
        adminUserId: 'A1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        recoveryOnly: true,
      },
      ownAccount: true,
    });
    const { context } = ctx('POST');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('does NOT rescue a deactivated admin', async () => {
    // The hatch is about ROLE and the recovery block, never about whether the
    // account still exists. A switched-off admin gets nothing at all.
    const { guard } = makeGuard({
      admin: { role: 'SUPERADMIN', isActive: false },
      ownAccount: true,
    });
    const { context } = ctx('POST');
    await expect(guard.canActivate(context)).rejects.toThrow(/switched off/);
  });

  it('does NOT rescue a revoked session', async () => {
    const { guard } = makeGuard({
      session: {
        adminUserId: 'A1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        recoveryOnly: false,
      },
      ownAccount: true,
    });
    const { context } = ctx('POST');
    await expect(guard.canActivate(context)).rejects.toThrow(
      /session has ended/,
    );
  });
});
