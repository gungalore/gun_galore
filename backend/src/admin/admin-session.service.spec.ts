import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AdminSessionService,
  ADMIN_ACCESS_TTL_SECONDS,
  ADMIN_REFRESH_GRACE_MS,
} from './admin-session.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';

/**
 * ⚠️ THE TWO PROPERTIES THIS FILE EXISTS FOR:
 *
 *  1. A refresh token that has ALREADY been rotated away is a replay — two
 *     parties hold it and one of them stole it — so the whole session dies.
 *  2. EXCEPT within the grace window, where it is simply the Desk's second
 *     tab, and rotating again would hand out a third token that invalidates
 *     the one the winning tab holds. The two tabs then take turns signing
 *     each other out forever. That is the bug the member `Session` model
 *     carries a `prevRefreshHash` column for, and this is the admin copy.
 */

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

type Row = {
  id: string;
  adminUserId: string;
  refreshHash: string;
  prevRefreshHash: string | null;
  prevRefreshExpiresAt: Date | null;
  recoveryOnly: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** A tiny in-memory stand-in for the two tables the service touches. */
function makeStore(admin = { email: 'ops@alloutdoor.co.za', role: 'SUPERADMIN', isActive: true }) {
  const rows: Row[] = [];
  let seq = 0;

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (value === null) {
        if (actual !== null) return false;
      } else if (typeof value === 'object' && value !== null && 'gt' in (value as object)) {
        const gt = (value as { gt: Date }).gt;
        if (!(actual instanceof Date) || actual <= gt) return false;
      } else if (typeof value === 'object' && value !== null && 'not' in (value as object)) {
        if (actual === (value as { not: unknown }).not) return false;
      } else if (actual !== value) {
        return false;
      }
    }
    return true;
  };

  const prisma = {
    adminSession: {
      create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: `S${++seq}`,
          adminUserId: data.adminUserId as string,
          refreshHash: data.refreshHash as string,
          prevRefreshHash: null,
          prevRefreshExpiresAt: null,
          recoveryOnly: data.recoveryOnly ?? false,
          userAgent: data.userAgent ?? null,
          ip: data.ip ?? null,
          createdAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt: data.expiresAt as Date,
          revokedAt: null,
        };
        rows.push(row);
        return { id: row.id };
      }),
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) => matches(r, where)) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) => matches(r, where)) ?? null,
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
          const hits = rows.filter((r) => matches(r, where));
          for (const r of hits) Object.assign(r, data);
          return { count: hits.length };
        },
      ),
      findMany: jest.fn(async () => rows),
    },
    adminUser: {
      findUnique: jest.fn(async () => (admin.isActive === null ? null : admin)),
    },
  };

  return { prisma, rows };
}

function makeService(store: ReturnType<typeof makeStore>) {
  // A fake JWT: the signature is not what these tests are about, and a real
  // one would make every assertion about token CONTENT a base64 exercise.
  const jwt = {
    signAsync: jest.fn(async (payload: unknown) => JSON.stringify(payload)),
    verifyAsync: jest.fn(async (token: string) => JSON.parse(token)),
  };
  return {
    service: new AdminSessionService(
      store.prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
    ),
    jwt,
  };
}

const ADMIN = { id: 'A1', email: 'ops@alloutdoor.co.za', role: 'SUPERADMIN' };

describe('AdminSessionService.create', () => {
  it('stores only the sha256 of the refresh token, never the token', async () => {
    const store = makeStore();
    const { service } = makeService(store);

    const issued = await service.create(ADMIN, { amr: ['pwd', 'otp'] });

    // ⚠️ A dump of this table must not be able to MINT a session, only
    // recognise one. If the raw token ever lands in the row, a leaked backup
    // is a set of live admin sessions.
    expect(store.rows[0].refreshHash).toBe(sha(issued.refreshToken));
    expect(store.rows[0].refreshHash).not.toBe(issued.refreshToken);
    expect(JSON.stringify(store.rows[0])).not.toContain(issued.refreshToken);
  });

  it('puts sid and amr in the access token', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const issued = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    const payload = JSON.parse(issued.accessToken);
    expect(payload.sid).toBe(issued.sessionId);
    expect(payload.amr).toEqual(['pwd', 'otp']);
    expect(payload.sub).toBe('A1');
  });

  it('gives the access token a fifteen-minute life, not eight hours', async () => {
    const store = makeStore();
    const { service, jwt } = makeService(store);
    await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expiresIn: ADMIN_ACCESS_TTL_SECONDS }),
    );
    expect(ADMIN_ACCESS_TTL_SECONDS).toBe(15 * 60);
  });
});

describe('AdminSessionService.rotate', () => {
  it('rotates the refresh token and keeps the old hash as prev', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, { amr: ['pwd', 'otp'] });

    const second = await service.rotate(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(store.rows[0].refreshHash).toBe(sha(second.refreshToken));
    expect(store.rows[0].prevRefreshHash).toBe(sha(first.refreshToken));
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('honours the old token inside the grace window WITHOUT rotating again', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    const second = await service.rotate(first.refreshToken);

    // The second Desk tab, which woke holding the same token.
    const lateTab = await service.rotate(first.refreshToken);

    // ⚠️ IT GETS THE TOKEN IT PRESENTED BACK, not a third one. Handing out a
    // third would invalidate `second`, the winning tab's token, and the two
    // tabs would sign each other out in a loop until somebody reinstalled
    // the browser.
    expect(lateTab.refreshToken).toBe(first.refreshToken);
    expect(store.rows[0].refreshHash).toBe(sha(second.refreshToken));
    expect(store.rows[0].revokedAt).toBeNull();

    // And it is a working session: fresh access token, same session id.
    expect(lateTab.sessionId).toBe(first.sessionId);
    expect(JSON.parse(lateTab.accessToken).sid).toBe(first.sessionId);
  });

  it('treats the old token as a REPLAY once the grace window has passed', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    await service.rotate(first.refreshToken);

    // Age the grace window out by hand rather than with fake timers, so the
    // assertion is about the stored expiry and not about jest's clock.
    store.rows[0].prevRefreshExpiresAt = new Date(Date.now() - 1);

    await expect(service.rotate(first.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('revokes the whole session when a rotated-away token is presented against it', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    const second = await service.rotate(first.refreshToken);

    // The session is closed; the thief presents the token they copied.
    await service.revokeSession(first.sessionId, 'test');
    await expect(service.rotate(second.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(store.rows[0].revokedAt).not.toBeNull();
  });

  it('refuses a token that matches nothing at all', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    await expect(service.rotate('not-a-real-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses to rotate an expired session and revokes it', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    store.rows[0].expiresAt = new Date(Date.now() - 1000);

    await expect(service.rotate(first.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(store.rows[0].revokedAt).not.toBeNull();
  });

  it('CARRIES THE RECOVERY RESTRICTION ACROSS A ROTATION', async () => {
    // ⚠️ If refreshing washed the restriction off, "read-only until you
    // re-enrol" would last fifteen minutes and then silently become full
    // write access — which is the entire control, defeated by waiting.
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, {
      amr: ['pwd', 'recovery'],
      recoveryOnly: true,
    });

    const second = await service.rotate(first.refreshToken);

    expect(second.recoveryOnly).toBe(true);
    expect(JSON.parse(second.accessToken).amr).toEqual(['pwd', 'recovery']);
    expect(store.rows[0].recoveryOnly).toBe(true);
  });

  it('carries the restriction across a GRACE-window refresh too', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, {
      amr: ['pwd', 'recovery'],
      recoveryOnly: true,
    });
    await service.rotate(first.refreshToken);

    const lateTab = await service.rotate(first.refreshToken);
    expect(lateTab.recoveryOnly).toBe(true);
    expect(JSON.parse(lateTab.accessToken).amr).toEqual(['pwd', 'recovery']);
  });

  it('refuses to refresh a deactivated admin and kills their sessions', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, { amr: ['pwd', 'otp'] });

    store.prisma.adminUser.findUnique = jest.fn(async () => ({
      email: ADMIN.email,
      role: 'SUPERADMIN',
      isActive: false,
    })) as never;

    await expect(service.rotate(first.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(store.rows[0].revokedAt).not.toBeNull();
  });

  it('picks up a demotion at refresh rather than carrying the old role forward', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, { amr: ['pwd', 'otp'] });

    store.prisma.adminUser.findUnique = jest.fn(async () => ({
      email: ADMIN.email,
      role: 'MONITORING_ADMIN',
      isActive: true,
    })) as never;

    const second = await service.rotate(first.refreshToken);
    expect(JSON.parse(second.accessToken).role).toBe('MONITORING_ADMIN');
  });

  it('sets the grace window to ADMIN_REFRESH_GRACE_MS and no longer', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const first = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    const before = Date.now();
    await service.rotate(first.refreshToken);

    const prevExpiry = store.rows[0].prevRefreshExpiresAt as Date;
    expect(prevExpiry.getTime()).toBeGreaterThanOrEqual(
      before + ADMIN_REFRESH_GRACE_MS - 50,
    );
    expect(prevExpiry.getTime()).toBeLessThanOrEqual(
      Date.now() + ADMIN_REFRESH_GRACE_MS + 50,
    );
    // Thirty seconds is a second tab; thirty minutes is a stolen token.
    expect(ADMIN_REFRESH_GRACE_MS).toBe(30_000);
  });
});

describe('AdminSessionService revocation', () => {
  it('revokeAllForAdmin spares the session it is told to spare', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const keep = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    await service.create(ADMIN, { amr: ['pwd', 'otp'] });

    const count = await service.revokeAllForAdmin(ADMIN.id, keep.sessionId);

    expect(count).toBe(2);
    expect(store.rows.find((r) => r.id === keep.sessionId)?.revokedAt).toBeNull();
  });

  it('revokeByRefreshToken closes exactly the device that presented it', async () => {
    const store = makeStore();
    const { service } = makeService(store);
    const a = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    const b = await service.create(ADMIN, { amr: ['pwd', 'otp'] });

    await service.revokeByRefreshToken(a.refreshToken);

    expect(store.rows.find((r) => r.id === a.sessionId)?.revokedAt).not.toBeNull();
    expect(store.rows.find((r) => r.id === b.sessionId)?.revokedAt).toBeNull();
  });

  it('a revoked session cannot be rotated back to life', async () => {
    // This is the property that makes sign-out MEAN something. The old admin
    // logout cleared a cookie the guard never read and revoked nothing.
    const store = makeStore();
    const { service } = makeService(store);
    const issued = await service.create(ADMIN, { amr: ['pwd', 'otp'] });
    await service.revokeSession(issued.sessionId, 'sign-out');

    await expect(service.rotate(issued.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
