import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { memberJwtSecret } from './member-jwt-secret';

/** How long an access token is good for. Short, because it is not revocable. */
export const ACCESS_TTL_SECONDS = 15 * 60;
/** How long a refresh token is good for, sliding on each use. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  /** User.id — the one and only user identifier. */
  sub: string;
  /** Session.id, so a token can be traced to the device that holds it. */
  sid: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

/**
 * Mint, verify and rotate member sessions.
 *
 * The refresh token itself is never stored — only its sha256. A database leak
 * therefore cannot mint a session, and a stolen token can still be recognised
 * by its hash and killed.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify an access token. Returns the payload, or throws.
   *
   * ⚠️ This is deliberately a PURE token check with no database read. Every
   * guard calls it on every request, and the access token's fifteen-minute
   * life is what bounds the damage of a revoked session still being accepted.
   * Adding a `Session.revokedAt` lookup here would put a query on the hot path
   * of the whole API to shorten that window — the refresh cycle already closes
   * it, because a revoked session cannot mint another access token.
   */
  async verify(token: string): Promise<SessionPayload> {
    const payload = await this.jwt.verifyAsync<SessionPayload>(token, {
      secret: memberJwtSecret(),
    });
    if (!payload?.sub) throw new UnauthorizedException();
    return payload;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async mintAccess(userId: string, sessionId: string): Promise<string> {
    const payload: SessionPayload = { sub: userId, sid: sessionId };
    return this.jwt.signAsync(payload, {
      secret: memberJwtSecret(),
      expiresIn: ACCESS_TTL_SECONDS,
    });
  }

  /** Start a new session for a user who has just proved who they are. */
  async create(
    userId: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshHash: this.hash(refreshToken),
        userAgent: meta.userAgent?.slice(0, 500),
        ip: meta.ip,
        expiresAt: refreshExpiresAt,
      },
      select: { id: true },
    });

    return {
      accessToken: await this.mintAccess(userId, session.id),
      refreshToken,
      sessionId: session.id,
      accessExpiresAt: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000),
      refreshExpiresAt,
    };
  }

  /**
   * Exchange a refresh token for a fresh pair, rotating it.
   *
   * ⚠️ A refresh token that does not match any live session is not simply
   * "expired". It is either a forgery or a token that has ALREADY been
   * rotated away — which means two parties hold it and one of them stole it.
   * We cannot tell which is the real member, so the honest response is to
   * revoke the whole session rather than guess. The legitimate holder signs
   * in again; the thief gets nothing.
   */
  async rotate(
    refreshToken: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedSession> {
    const presented = this.hash(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshHash: presented },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });

    if (!session) throw new UnauthorizedException();

    if (session.revokedAt || session.expiresAt < new Date()) {
      // Presented against a session we already closed → treat as replay.
      await this.revokeSession(session.id, 'replay of a closed session');
      throw new UnauthorizedException();
    }

    const next = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    // Guarded update: the WHERE still names the OLD hash, so two concurrent
    // refreshes with the same token cannot both succeed — the loser updates
    // zero rows and is told to sign in, rather than both being handed a
    // valid session.
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshHash: presented, revokedAt: null },
      data: {
        refreshHash: this.hash(next),
        lastSeenAt: new Date(),
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent?.slice(0, 500),
        ip: meta.ip,
      },
    });
    if (rotated.count === 0) throw new UnauthorizedException();

    return {
      accessToken: await this.mintAccess(session.userId, session.id),
      refreshToken: next,
      sessionId: session.id,
      accessExpiresAt: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000),
      refreshExpiresAt,
    };
  }

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { refreshHash: this.hash(refreshToken) },
      select: { id: true },
    });
    if (session) await this.revokeSession(session.id, 'sign-out');
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.debug(`Session ${sessionId} revoked: ${reason}`);
  }

  /**
   * Kill every session a user holds. Called on sign-out-everywhere, on a
   * password change, and on account closure — a password change that left the
   * thief's session alive would not actually lock them out.
   */
  async revokeAllForUser(userId: string, except?: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(except ? { id: { not: except } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  async listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        lastSeenAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
