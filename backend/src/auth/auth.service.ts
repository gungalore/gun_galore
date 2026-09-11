import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { SessionService, IssuedSession } from './session.service';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

/** Matches the admin side rather than the seed's 10 — one cost, the higher one. */
const BCRYPT_COST = 12;

/**
 * Failed logins before the account locks, and for how long.
 *
 * The global throttler is NOT enough on its own: its store is in-memory and
 * every `pm2 reload` clears it, so a deploy hands an attacker a fresh budget.
 * This counter lives on the row and survives.
 */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/** A password-reset link is short-lived on purpose. */
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * The email verification code.
 *
 * ⚠️ MINTED AND CHECKED HERE, DELIVERED BY RESEND — not by the identity
 * provider. It went to Didit in the cut-over and came back on 2026-09-11:
 * Didit charged $0.03 a send and the mail arrived under Didit's own branding
 * from Didit's domain, which is a stranger's name on the first email a new
 * member ever gets from us. Resend already carries every other transactional
 * email in the house style, so this one joins them.
 *
 * ⚠️ SIX DIGITS IS ONLY SAFE BECAUSE THE ATTEMPTS ARE BOUNDED. A million
 * combinations falls to a script in seconds if it may guess freely, so
 * EMAIL_OTP_MAX_ATTEMPTS is the control, not the code length. Raising the
 * length is not a substitute for keeping the cap.
 */
const EMAIL_OTP_LENGTH = 6;
const EMAIL_OTP_TTL_MS = 15 * 60 * 1000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;

/** sha256 hex. Codes are stored hashed, never in the clear. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    // NOTE: no DiditService. Auth no longer touches it — the email code is
    // minted here and delivered by Resend. Didit's only remaining job on this
    // platform is the KYC identity session.
    private readonly notifications: NotificationsService,
    private readonly tokens: ActionTokensService,
  ) {}

  /**
   * True when there is no mail credential and we are not in production, so a
   * verification code is printed instead of sent.
   *
   * ⚠️ THE `NODE_ENV` HALF IS THE SAFETY. A production box missing
   * RESEND_API_KEY must FAIL a sign-up loudly, not log the code and hand
   * anyone with log access every new member's account.
   */
  private get emailStubbed(): boolean {
    return (
      !process.env.RESEND_API_KEY && process.env.NODE_ENV !== 'production'
    );
  }

  /** Codes minted while mail is unconfigured. Never populated in production. */
  private readonly devCodes = new Map<string, string>();

  /**
   * Read back a code minted by the dev fallback above.
   *
   * Exists for the end-to-end suite, which has no mailbox to read and must
   * not depend on scraping a log line. Returns undefined whenever mail is
   * genuinely configured, so it cannot become a back door.
   */
  devEmailCode(email: string): string | undefined {
    return this.devCodes.get(email.trim().toLowerCase());
  }

  private get appUrl() {
    return (
      process.env.FRONTEND_URL?.replace(/\/+$/, '') ??
      'https://alloutdoor.co.za'
    );
  }

  // ── Sign-up ──────────────────────────────────────────────────────────

  /**
   * Create the account, unverified, and send the email code.
   *
   * The row is created BEFORE the address is proven, which is what makes the
   * unique constraint do the work of stopping two people claiming one address.
   * The cost is that an unverified row squats on somebody else's email — so a
   * repeat sign-up on an address that is claimed but STILL UNVERIFIED simply
   * takes it over. Whoever can read the mailbox wins, which is the right
   * answer, and the daily sweep clears the rest.
   */
  async register(dto: RegisterDto, meta: { userAgent?: string; ip?: string }) {
    const email = dto.email.trim().toLowerCase();
    const usernameLower = dto.username.trim().toLowerCase();

    const [byEmail, byUsername] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        select: { id: true, emailVerifiedAt: true },
      }),
      this.prisma.user.findUnique({
        where: { usernameLower },
        select: { id: true },
      }),
    ]);

    if (byUsername && byUsername.id !== byEmail?.id) {
      throw new ConflictException('That username is already taken');
    }
    if (byEmail?.emailVerifiedAt) {
      // Deliberately explicit. Hiding it would be account-enumeration theatre:
      // the sign-up form has to tell somebody their address is already
      // registered or they cannot get past it, and the sign-in page leaks the
      // same fact to anyone who tries.
      throw new ConflictException(
        'An account with that email already exists. Try signing in instead.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const now = new Date();
    const consent = {
      termsAcceptedAt: dto.terms ? now : null,
      privacyConsentAt: dto.privacy ? now : null,
      ageAffirmedAt: dto.age ? now : null,
      marketingConsentAt: dto.marketing ? now : null,
      consentPolicyVersion: dto.policyVersion ?? null,
    };

    const user = byEmail
      ? await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            username: dto.username.trim(),
            usernameLower,
            passwordHash,
            phone: dto.phone?.trim() || null,
            phoneVerified: false,
            campaignKey: dto.campaignKey?.trim().slice(0, 40) || undefined,
            ...consent,
          },
          select: { id: true, email: true },
        })
      : await this.prisma.user.create({
          data: {
            email,
            username: dto.username.trim(),
            usernameLower,
            passwordHash,
            phone: dto.phone?.trim() || null,
            campaignKey: dto.campaignKey?.trim().slice(0, 40) || null,
            ...consent,
          },
          select: { id: true, email: true },
        });

    await this.sendEmailCode(email);
    this.logger.log(`Registered ${user.id} (${email}) — awaiting email code`);
    return { email, next: 'verify-email' as const };
  }

  /**
   * Mint a fresh code, store its hash, and send it. Also the resend path.
   *
   * ⚠️ SILENT ON AN UNKNOWN OR ALREADY-VERIFIED ADDRESS. The resend endpoint
   * is unauthenticated and takes an arbitrary email, so answering differently
   * for "no such account" turns it into a membership oracle — type an address,
   * read the response, learn whether that person banks here. The caller gets
   * the same 200 either way and the controller says "if that address needs a
   * code, one is on its way".
   *
   * ⚠️ MINTING INVALIDATES THE PREVIOUS CODE, including its attempt count.
   * Otherwise "resend" would be a free reset of the guess budget.
   */
  async sendEmailCode(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true, accountClosedAt: true },
    });
    if (!user || user.emailVerifiedAt || user.accountClosedAt) return;

    // `randomInt` is uniform and CSPRNG-backed; Math.random is neither, and a
    // predictable verification code is an account takeover.
    const code = String(randomInt(0, 10 ** EMAIL_OTP_LENGTH)).padStart(
      EMAIL_OTP_LENGTH,
      '0',
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailOtpHash: sha256(code),
        emailOtpExpiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS),
        emailOtpAttempts: 0,
      },
    });

    // ⚠️ WITHOUT THIS, NOBODY CAN SIGN UP ON A FRESH CLONE. The identity
    // provider's adapter carried the same fallback for the same reason: with
    // no mail credentials the first thing a new developer meets is a sign-up
    // that cannot be completed. Print the code, never pretend it was sent,
    // and refuse to do any of it in production.
    if (this.emailStubbed) {
      this.devCodes.set(email, code);
      this.logger.warn(
        `EMAIL NOT CONFIGURED — verification code for ${email} is ${code} (development only)`,
      );
      return;
    }

    try {
      await this.notifications.emailVerificationCode({
        email,
        code,
        minutes: Math.round(EMAIL_OTP_TTL_MS / 60_000),
      });
    } catch (err) {
      // ⚠️ The hash stays on the row. A send that failed at Resend may still
      // have been delivered, and clearing it would refuse a code the member
      // is holding. sendAuthEmail has already parked it in the outbox.
      this.logger.error(
        `Verification email failed for ${email}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'We could not send the code right now. Please try again shortly.',
      );
    }
  }

  async verifyEmail(
    rawEmail: string,
    code: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<IssuedSession & { userId: string }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        emailVerifiedAt: true,
        accountClosedAt: true,
        emailOtpHash: true,
        emailOtpExpiresAt: true,
        emailOtpAttempts: true,
      },
    });
    if (!user || user.accountClosedAt) throw new UnauthorizedException();

    if (!user.emailVerifiedAt) {
      if (!user.emailOtpHash || !user.emailOtpExpiresAt) {
        throw new BadRequestException(
          'There is no code waiting for this address. Request a new one.',
        );
      }
      if (user.emailOtpExpiresAt.getTime() < Date.now()) {
        // Clear it so a stale hash cannot be ground against indefinitely.
        await this.prisma.user.update({
          where: { id: user.id },
          data: { emailOtpHash: null, emailOtpExpiresAt: null },
        });
        throw new BadRequestException('That code has expired. Request a new one.');
      }
      // ⚠️ THE CAP IS CHECKED BEFORE THE COMPARISON, and the code is discarded
      // when it trips. Counting after comparing leaves the attacker one free
      // guess past the limit on every code.
      if (user.emailOtpAttempts >= EMAIL_OTP_MAX_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { emailOtpHash: null, emailOtpExpiresAt: null },
        });
        throw new BadRequestException(
          'Too many incorrect codes. Request a new one.',
        );
      }

      // Constant-time: a wrong code must not be distinguishable by how long
      // the comparison took, digit by digit.
      const given = sha256(code.trim());
      const match =
        given.length === user.emailOtpHash.length &&
        timingSafeEqual(Buffer.from(given), Buffer.from(user.emailOtpHash));

      if (!match) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { emailOtpAttempts: { increment: 1 } },
        });
        throw new BadRequestException('That code is not right.');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: new Date(),
          // The code is spent. Leaving it live would let the same six digits
          // re-verify after a later email change.
          emailOtpHash: null,
          emailOtpExpiresAt: null,
          emailOtpAttempts: 0,
        },
      });
    }

    const issued = await this.sessions.create(user.id, meta);
    await this.recordLogin(user.id, issued.sessionId);
    return { ...issued, userId: user.id };
  }

  // ── Sign-in ──────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    meta: { userAgent?: string; ip?: string },
  ): Promise<IssuedSession & { userId: string }> {
    const identifier = dto.identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { usernameLower: identifier }],
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        emailVerifiedAt: true,
        failedLoginCount: true,
        lockedUntil: true,
        isBanned: true,
        accountClosedAt: true,
      },
    });

    // One message for every failure below, so the response cannot be used to
    // tell "no such account" from "wrong password" from "locked".
    const refuse = () =>
      new UnauthorizedException('Email, username or password is not right.');

    if (!user || user.accountClosedAt) {
      // Burn comparable time so a missing account is not measurably faster
      // than a wrong password.
      await bcrypt.compare(dto.password, `$2a$${BCRYPT_COST}$${'.'.repeat(53)}`);
      throw refuse();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw refuse();

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.recordFailedLogin(user.id, user.failedLoginCount);
      throw refuse();
    }

    if (user.isBanned) {
      throw new ForbiddenException(
        'This account has been suspended. Contact support.',
      );
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        message: 'Verify your email address to finish signing in.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      });
    }

    const issued = await this.sessions.create(user.id, meta);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.recordLogin(user.id, issued.sessionId);
    return { ...issued, userId: user.id };
  }

  private async recordFailedLogin(userId: string, current: number) {
    const next = current + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: next,
        lockedUntil:
          next >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    });
  }

  /** Analytics mirror of the session. Never allowed to fail a sign-in. */
  private async recordLogin(userId: string, sessionId: string) {
    await this.prisma.loginEvent
      .create({ data: { userId, sessionId, startedAt: new Date() } })
      .catch(() => undefined);
  }

  async logout(refreshToken: string | undefined, sessionId?: string) {
    if (refreshToken) await this.sessions.revokeByRefreshToken(refreshToken);
    else if (sessionId) await this.sessions.revokeSession(sessionId, 'sign-out');
    if (sessionId) await this.closeLoginEvent(sessionId, 'signed-out');
  }

  async logoutEverywhere(userId: string) {
    const count = await this.sessions.revokeAllForUser(userId);
    return { revoked: count };
  }

  private async closeLoginEvent(sessionId: string, reason: string) {
    await this.prisma.loginEvent
      .updateMany({
        where: { sessionId, endedAt: null },
        data: { endedAt: new Date(), endReason: reason },
      })
      .catch(() => undefined);
  }

  // ── Passwords ────────────────────────────────────────────────────────

  /**
   * Always resolves the same way whether or not the address exists — a
   * different response here is a free account-enumeration oracle, and unlike
   * sign-up there is no UX reason to reveal anything.
   */
  async forgotPassword(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        username: true,
        accountClosedAt: true,
        emailVerifiedAt: true,
      },
    });
    if (!user || user.accountClosedAt || !user.emailVerifiedAt) return;

    const token = await this.tokens.mint({
      purpose: 'PASSWORD_RESET',
      targetType: 'user',
      targetId: user.id,
      authorisedUserId: user.id,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });

    await this.notifications
      .passwordReset({
        email: user.email,
        name: user.username,
        url: `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
      })
      .catch((err) =>
        this.logger.error(`Password-reset email failed: ${err.message}`),
      );
  }

  async resetPassword(dto: ResetPasswordDto, ip?: string, userAgent?: string) {
    let userId: string;
    try {
      const resolved = await this.tokens.resolve(dto.token);
      if (resolved.purpose !== 'PASSWORD_RESET') {
        await this.tokens.markInvalid(dto.token);
        throw new UnauthorizedException();
      }
      userId = resolved.authorisedUserId;
    } catch {
      throw new BadRequestException(
        'That reset link is no longer valid. Request a new one.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    // Consume FIRST. If the write below fails the member simply asks for
    // another link; if the order were reversed a crash between the two would
    // leave a used-looking link that still works.
    await this.tokens.consume(dto.token, ip, userAgent);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });

    // A reset that left the thief's session alive would not lock anybody out.
    await this.sessions.revokeAllForUser(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });
    if (user) {
      await this.notifications
        .passwordChanged({ email: user.email, name: user.username })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    keepSessionId?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException();

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Your current password is not right.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_COST) },
    });
    // Every other device signs out — that is the point of changing it.
    const revoked = await this.sessions.revokeAllForUser(userId, keepSessionId);
    await this.notifications
      .passwordChanged({ email: user.email, name: user.username })
      .catch(() => undefined);

    return { ok: true, otherSessionsRevoked: revoked };
  }

  // ── Session refresh ──────────────────────────────────────────────────

  async refresh(refreshToken: string, meta: { userAgent?: string; ip?: string }) {
    return this.sessions.rotate(refreshToken, meta);
  }

  /**
   * The viewer object the frontend renders its chrome from — the shape
   * `useUser()` used to hand back, minus everything the identity provider owned.
   */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        username: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        phone: true,
        phoneVerified: true,
        kycStatus: true,
        profileCompletedAt: true,
        sellerTier: true,
        createdAt: true,
      },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
