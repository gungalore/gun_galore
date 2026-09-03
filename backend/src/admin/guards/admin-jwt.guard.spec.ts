import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminJwtGuard } from './admin-jwt.guard';
import { SuperadminGuard } from './superadmin.guard';
import { ReadShapedRoute } from '../decorators/read-shaped-route.decorator';

/**
 * The rule under test: reads are open to any ACTIVE admin, writes are
 * SUPERADMIN-only, and the role + isActive come off the AdminUser row rather
 * than the 8-hour token. These tests are written so that weakening the rule
 * breaks them — see the mutation notes on each block.
 */

// Two shapes of route, so the @ReadShapedRoute() escape hatch is exercised
// through the real decorator + a real Reflector, not a stubbed lookup.
class FakeAdminController {
  @ReadShapedRoute()
  previewOnly() {}

  plainWrite() {}
}

const MUTATING_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

type Row = { role: string; isActive: boolean } | null;

function build(row: Row, opts: { tokenRole?: string } = {}) {
  const findUnique = jest.fn().mockResolvedValue(row);
  const prisma = { adminUser: { findUnique } } as never;
  const jwt = {
    verifyAsync: jest.fn().mockResolvedValue({
      sub: 'admin_1',
      email: 'ops@alloutdoor.co.za',
      // The token role is deliberately allowed to disagree with the row —
      // that is the whole point of re-reading.
      role: opts.tokenRole ?? row?.role ?? 'SUPERADMIN',
    }),
  } as never;
  const guard = new AdminJwtGuard(jwt, prisma, new Reflector());
  return { guard, findUnique };
}

function ctx(
  method: string,
  handler: (...args: unknown[]) => unknown = FakeAdminController.prototype.plainWrite,
  // null means "send no Authorization header at all" — undefined would fall
  // back to the default via the parameter default, which is not the same test.
  token: string | null = 'a.valid.token',
) {
  const request: Record<string, unknown> = {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => FakeAdminController,
    } as unknown as ExecutionContext,
  };
}

async function refusal(guard: AdminJwtGuard, context: ExecutionContext) {
  try {
    await guard.canActivate(context);
  } catch (e) {
    return e as ForbiddenException;
  }
  throw new Error('expected the guard to refuse, but it allowed the request');
}

describe('AdminJwtGuard — deny-by-default on HTTP method', () => {
  // MUTATION CHECK: flip the mutating-method branch to allow non-SUPERADMIN
  // (or add MONITORING_ADMIN to the write roles) and all four of these fail.
  describe.each(['MONITORING_ADMIN', 'ADMIN'])('a %s admin', (role) => {
    it.each(MUTATING_METHODS)('is refused %s', async (method) => {
      const { guard } = build({ role, isActive: true });
      const err = await refusal(guard, ctx(method).context);
      expect(err).toBeInstanceOf(ForbiddenException);
      // The refusal has to name the role and the way out.
      expect(err.message).toContain(role);
      expect(err.message).toContain('SUPERADMIN');
      expect(err.message).toContain('Full admin');
    });

    it.each(SAFE_METHODS)('is allowed %s', async (method) => {
      const { guard } = build({ role, isActive: true });
      await expect(guard.canActivate(ctx(method).context)).resolves.toBe(true);
    });
  });

  // The legacy tier is the COLUMN DEFAULT (AdminUser.role @default(ADMIN)),
  // so any row created by a seed or by raw SQL lands here. The schema says
  // treat it as MONITORING_ADMIN; this pins that it is not a write tier.
  it('treats the legacy ADMIN tier as read-only, naming it as legacy', async () => {
    const { guard } = build({ role: 'ADMIN', isActive: true });
    const err = await refusal(guard, ctx('POST').context);
    expect(err.message).toContain('legacy');
  });

  // MUTATION CHECK: change WRITE_ROLE, or make the role check conditional,
  // and this fails — SUPERADMIN behaviour must not move.
  it('leaves a SUPERADMIN able to do everything, on every verb', async () => {
    for (const method of [...MUTATING_METHODS, ...SAFE_METHODS]) {
      const { guard } = build({ role: 'SUPERADMIN', isActive: true });
      await expect(guard.canActivate(ctx(method).context)).resolves.toBe(true);
    }
  });
});

describe('AdminJwtGuard — the row wins over the token', () => {
  // The 8h token is why deactivation had no teeth. MUTATION CHECK: delete
  // the isActive branch and both of these fail.
  it('refuses a DEACTIVATED admin immediately, on a valid unexpired token', async () => {
    const { guard } = build({ role: 'SUPERADMIN', isActive: false });
    const err = await refusal(guard, ctx('GET').context);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toContain('switched off');
    expect(err.message).toContain('reactivate');
  });

  it('refuses a deactivated admin even on a read-shaped POST', async () => {
    const { guard } = build({ role: 'SUPERADMIN', isActive: false });
    const err = await refusal(
      guard,
      ctx('POST', FakeAdminController.prototype.previewOnly).context,
    );
    expect(err.message).toContain('switched off');
  });

  it('refuses a token whose admin row has been deleted', async () => {
    const { guard } = build(null);
    const err = await refusal(guard, ctx('GET').context);
    expect(err.message).toContain('no longer exists');
  });

  // MUTATION CHECK: read `payload.role` instead of the row's role and this
  // fails — a demoted admin would keep writing until the token expired.
  it('refuses a demoted admin holding a token that still says SUPERADMIN', async () => {
    const { guard } = build(
      { role: 'MONITORING_ADMIN', isActive: true },
      { tokenRole: 'SUPERADMIN' },
    );
    const err = await refusal(guard, ctx('POST').context);
    expect(err.message).toContain('MONITORING_ADMIN');
  });

  it('attaches the live role to request.adminUser, not the token role', async () => {
    const { guard } = build(
      { role: 'MONITORING_ADMIN', isActive: true },
      { tokenRole: 'SUPERADMIN' },
    );
    const { context, request } = ctx('GET');
    await guard.canActivate(context);
    expect(request.adminUser).toEqual({
      sub: 'admin_1',
      email: 'ops@alloutdoor.co.za',
      role: 'MONITORING_ADMIN',
    });
  });

  it('looks the row up by the verified token sub', async () => {
    const { guard, findUnique } = build({ role: 'SUPERADMIN', isActive: true });
    await guard.canActivate(ctx('GET').context);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'admin_1' },
      select: { role: true, isActive: true },
    });
  });
});

describe('AdminJwtGuard — the read-shaped escape hatch', () => {
  // MUTATION CHECK: drop @ReadShapedRoute() from the two marked routes, or
  // stop reading the metadata, and this fails.
  it('lets a monitoring admin through a POST marked @ReadShapedRoute()', async () => {
    const { guard } = build({ role: 'MONITORING_ADMIN', isActive: true });
    await expect(
      guard.canActivate(ctx('POST', FakeAdminController.prototype.previewOnly).context),
    ).resolves.toBe(true);
  });

  // MUTATION CHECK: if the hatch ever leaked onto the whole class (or every
  // POST), this would pass a plain write and fail here.
  it('does not leak to a sibling route on the same controller', async () => {
    const { guard } = build({ role: 'MONITORING_ADMIN', isActive: true });
    await refusal(guard, ctx('POST', FakeAdminController.prototype.plainWrite).context);
  });
});

describe('AdminJwtGuard — authentication is unchanged', () => {
  it('rejects a missing bearer token without touching the database', async () => {
    const { guard, findUnique } = build({ role: 'SUPERADMIN', isActive: true });
    const noHeader = ctx('GET', FakeAdminController.prototype.plainWrite, null);
    await expect(guard.canActivate(noHeader.context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unverifiable token without touching the database', async () => {
    const findUnique = jest.fn();
    const guard = new AdminJwtGuard(
      { verifyAsync: jest.fn().mockRejectedValue(new Error('bad signature')) } as never,
      { adminUser: { findUnique } } as never,
      new Reflector(),
    );
    await expect(guard.canActivate(ctx('GET').context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('SuperadminGuard still guards the three admin-account routes', () => {
  const run = (adminUser: unknown) =>
    new SuperadminGuard().canActivate({
      switchToHttp: () => ({ getRequest: () => ({ adminUser }) }),
    } as unknown as ExecutionContext);

  it('passes a SUPERADMIN, so create / re-role / switch-off keep working', () => {
    expect(run({ sub: 'admin_1', role: 'SUPERADMIN' })).toBe(true);
  });

  // It never actually fires for a read-only admin — AdminJwtGuard refuses
  // first — but it is the second layer on account access, so it must hold.
  it('refuses anything else, naming the role', () => {
    expect(() => run({ sub: 'admin_2', role: 'MONITORING_ADMIN' })).toThrow(
      /MONITORING_ADMIN/,
    );
    expect(() => run(undefined)).toThrow(ForbiddenException);
  });
});
