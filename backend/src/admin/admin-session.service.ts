import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { adminJwtSecret } from './admin-jwt-secret';

/**
 * How long an admin access token is good for.
 *
 * ⚠️ FIFTEEN MINUTES, DOWN FROM EIGHT HOURS, AND THAT IS THE POINT OF THE
 * WHOLE FILE. The old token was the session: nothing could revoke it, so
 * "sign out" cleared a cookie the guard never read and a stolen token kept
 * working for the rest of the working day. Fifteen minutes bounds the damage
 * even in the seam where a revoked session's last access token is still in
 * flight — and because AdminJwtGuard re-reads the session row on every
 * request (see the comment there), even that seam is closed for this surface.
 */
export const ADMIN_ACCESS_TTL_SECONDS = 15 * 60;

/** How long a refresh token is good for, sliding on each use. */
export const ADMIN_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a just-rotated refresh token keeps working.
 *
 * Long enough for a second Desk tab that woke at the same moment to finish
 * its own refresh; far too short to be worth stealing. Matches the member
 * side's REFRESH_GRACE_MS deliberately — one number, one behaviour.
 */
export const ADMIN_REFRESH_GRACE_MS = 30 * 1000;

/**
 * What a Desk access token carries.
 *
 * `sub`, `email` and `role` were all in the old token and stay for
 * compatibility with @CurrentAdmin()'s 60 call sites. `sid` and `amr` are new.
 */
export interface AdminTokenPayload {
  /** AdminUser.id. */
  sub: string;
  email: string;
  /**
   * The role at the moment of signing.
   *
   * ⚠️ NOT AUTHORITATIVE, AND NOTHING MAY AUTHORISE ON IT. AdminJwtGuard
   * overwrites it with the live row value before any handler sees it. It is
   * here so a token can be read in isolation, not so it can be trusted.
   */
  role: string;
  /** AdminSession.id — the row that can revoke this token. */
  sid: string;
  /**
   * Authentication methods reference, RFC 8176 flavoured.
   *
   * `['pwd','otp']` — password plus TOTP. `['pwd','recovery']` — password
   * plus a single-use recovery code, which the guard refuses to let write.
   * `['pwd']` — password alone, only possible while ADMIN_TOTP_REQUIRED is
   * off or before the operator has enrolled.
   */
  amr: string[];
}

export interface IssuedAdminSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  recoveryOnly: boolean;
}

/**
 * Mint, verify, rotate and revoke Desk sessions.
 *
 * This is deliberately a near-copy of `backend/src/auth/session.service.ts`
 * rather than a clever shared abstraction. The two differ in three ways that
 * matter — an `amr` claim, a recovery-only flag, and a guard that re-reads
 * the session row on every request — and a shared base class would either
 * grow flags for all three or quietly give the member side admin semantics.
 * Two files that can be diffed beat one file with a mode switch.
 */
@Injectable()
export class AdminSessionService {
  private readonly logger = new Logger(AdminSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify an access token's signature and shape. Throws on anything else.
   *
   * ⚠️ NO DATABASE READ HERE, and no route calls this instead of the guard.
   * The revocation check lives in AdminJwtGuard, which is already doing one
   * indexed lookup per request for {role, isActive} — it reads the session
   * row in the same place. Putting a second lookup here would double the
   * query count on every admin request for no additional property.
   */
  async verify(token: string): Promise<AdminTokenPayload> {
    const payload = await this.jwt.verifyAsync<AdminTokenPayload>(token, {
      secret: adminJwtSecret(),
    });
    if (!payload?.sub) throw new UnauthorizedException();
    return payload;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async mintAccess(row: {
    sessionId: string;
    adminUserId: string;
    email: string;
    role: string;
    amr: string[];
  }): Promise<string> {
    const payload: AdminTokenPayload = {
      sub: row.adminUserId,
      email: row.email,
      role: row.role,
      sid: row.sessionId,
      amr: row.amr,
    };
    return this.jwt.signAsync(payload, {
      secret: adminJwtSecret(),
      expiresIn: ADMIN_ACCESS_TTL_SECONDS,
    });
  }

  /** Start a session for an admin who has just proved who they are. */
  async create(
    admin: { id: string; email: string; role: string },
    opts: {
      amr: string[];
      recoveryOnly?: boolean;
      userAgent?: string;
      ip?: string;
    },
  ): Promise<IssuedAdminSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + ADMIN_REFRESH_TTL_MS);
    const recoveryOnly = opts.recoveryOnly ?? false;

    const session = await this.prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        refreshHash: this.hash(refreshToken),
        recoveryOnly,
        userAgent: opts.userAgent?.slice(0, 500),
        ip: opts.ip,
        expiresAt: refreshExpiresAt,
      },
      select: { id: true },
    });

    return {
      accessToken: await this.mintAccess({
        sessionId: session.id,
        adminUserId: admin.id,
        email: admin.email,
        role: admin.role,
        amr: opts.amr,
      }),
      refreshToken,
      sessionId: session.id,
      accessExpiresAt: new Date(Date.now() + ADMIN_ACCESS_TTL_SECONDS * 1000),
      refreshExpiresAt,
      recoveryOnly,
    };
  }

  /**
   * Exchange a refresh token for a fresh pair, rotating it.
   *
   * ⚠️ A refresh token matching no live session is not simply "expired". It
   * is either a forgery or a token that has ALREADY been rotated away — which
   * means two parties hold it and one of them stole it. We cannot tell which
   * is the operator, so the honest response is to revoke the whole session
   * rather than guess. They sign in again; the thief gets nothing.
   */
  async rotate(
    refreshToken: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedAdminSession> {
    const presented = this.hash(refreshToken);

    const session = await this.prisma.adminSession.findUnique({
      where: { refreshHash: presented },
      select: {
        id: true,
        adminUserId: true,
        revokedAt: true,
        expiresAt: true,
        recoveryOnly: true,
      },
    });

    if (!session) {
      // Nothing matches the CURRENT hash. Before calling that a forgery,
      // check whether it is what we rotated away from moments ago — which is
      // what a second Desk tab refreshing in parallel looks like.
      const recent = await this.prisma.adminSession.findFirst({
        where: {
          prevRefreshHash: presented,
          prevRefreshExpiresAt: { gt: new Date() },
          revokedAt: null,
        },
        select: { id: true, adminUserId: true, recoveryOnly: true },
      });
      if (recent) {
        // ⚠️ DO NOT ROTATE AGAIN. Handing this caller a third token would
        // invalidate the one the winning tab holds, and the two tabs would
        // take turns signing each other out forever. Mint a fresh ACCESS
        // token against the session and leave the refresh side alone.
        const admin = await this.loadAdminForMint(recent.adminUserId);
        return {
          accessToken: await this.mintAccess({
            sessionId: recent.id,
            adminUserId: recent.adminUserId,
            email: admin.email,
            role: admin.role,
            amr: recent.recoveryOnly ? ['pwd', 'recovery'] : ['pwd', 'otp'],
          }),
          refreshToken,
          sessionId: recent.id,
          accessExpiresAt: new Date(
            Date.now() + ADMIN_ACCESS_TTL_SECONDS * 1000,
          ),
          refreshExpiresAt: new Date(Date.now() + ADMIN_REFRESH_TTL_MS),
          recoveryOnly: recent.recoveryOnly,
        };
      }
      throw new UnauthorizedException();
    }

    if (session.revokedAt || session.expiresAt < new Date()) {
      await this.revokeSession(session.id, 'replay of a closed session');
      throw new UnauthorizedException();
    }

    const admin = await this.loadAdminForMint(session.adminUserId);

    const next = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + ADMIN_REFRESH_TTL_MS);

    // Guarded update: the WHERE still names the OLD hash, so two concurrent
    // refreshes with the same token cannot both succeed — the loser updates
    // zero rows and is told to sign in, rather than both walking away with a
    // valid session.
    const rotated = await this.prisma.adminSession.updateMany({
      where: { id: session.id, refreshHash: presented, revokedAt: null },
      data: {
        refreshHash: this.hash(next),
        prevRefreshHash: presented,
        prevRefreshExpiresAt: new Date(Date.now() + ADMIN_REFRESH_GRACE_MS),
        lastSeenAt: new Date(),
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent?.slice(0, 500),
        ip: meta.ip,
      },
    });
    if (rotated.count === 0) throw new UnauthorizedException();

    return {
      accessToken: await this.mintAccess({
        sessionId: session.id,
        adminUserId: session.adminUserId,
        email: admin.email,
        role: admin.role,
        // ⚠️ THE RECOVERY RESTRICTION SURVIVES ROTATION. Refreshing is not a
        // second authentication; if a recovery-only session could rotate into
        // a full one, the read-only rule would last fifteen minutes and then
        // quietly evaporate.
        amr: session.recoveryOnly ? ['pwd', 'recovery'] : ['pwd', 'otp'],
      }),
      refreshToken: next,
      sessionId: session.id,
      accessExpiresAt: new Date(Date.now() + ADMIN_ACCESS_TTL_SECONDS * 1000),
      refreshExpiresAt,
      recoveryOnly: session.recoveryOnly,
    };
  }

  /**
   * Read the admin's current email and role for a token about to be minted.
   *
   * Deliberately re-read rather than carried over from the old token: a
   * refresh is a fine moment to pick up a demotion, and a deactivated admin
   * must not be able to refresh at all.
   */
  private async loadAdminForMint(
    adminUserId: string,
  ): Promise<{ email: string; role: string }> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { email: true, role: true, isActive: true },
    });
    if (!admin || !admin.isActive) {
      // Their sessions are dead weight now — take them all, not just this one.
      await this.revokeAllForAdmin(adminUserId);
      throw new UnauthorizedException();
    }
    return { email: admin.email, role: admin.role };
  }

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const session = await this.prisma.adminSession.findUnique({
      where: { refreshHash: this.hash(refreshToken) },
      select: { id: true },
    });
    if (session) await this.revokeSession(session.id, 'sign-out');
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.debug(`Admin session ${sessionId} revoked: ${reason}`);
  }

  /**
   * Kill every session an admin holds.
   *
   * Called on a password change, a TOTP reset, a deactivation and
   * sign-out-everywhere. ⚠️ A password change that left the thief's session
   * alive would not actually lock them out — which is the entire reason
   * anybody changes a password in a hurry.
   */
  async revokeAllForAdmin(adminUserId: string, except?: string): Promise<number> {
    const res = await this.prisma.adminSession.updateMany({
      where: {
        adminUserId,
        revokedAt: null,
        ...(except ? { id: { not: except } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  async listForAdmin(adminUserId: string) {
    return this.prisma.adminSession.findMany({
      where: {
        adminUserId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        userAgent: true,
        ip: true,
        recoveryOnly: true,
        createdAt: true,
        lastSeenAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
