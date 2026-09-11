import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminChangePasswordDto,
  AdminConfirmTotpDto,
  AdminEnrolTotpDto,
  AdminLoginDto,
} from './dto/admin-login.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminSessionService, IssuedAdminSession } from './admin-session.service';
import { generateTotpSecret, otpauthUri, verifyTotpCode } from './totp';

/**
 * bcrypt cost for everything this file hashes.
 *
 * ⚠️ TWELVE, MATCHING THE MEMBER SIDE (BCRYPT_COST in auth.service.ts), WHICH
 * IT DID NOT BEFORE. `createAdmin` and `scripts/create-admin.mjs` both hashed
 * at cost 10 while the member comment claimed cost 12 "matches the admin
 * side". It did not. Raising it is safe for new hashes; it does NOT touch
 * existing rows, which stay at cost 10 until their owner changes their
 * password — bcrypt encodes the cost in the hash, so a cost-10 hash keeps
 * verifying and nothing breaks. `changePassword` is what actually migrates a
 * row, so the operator changing their password is the upgrade path.
 */
const BCRYPT_COST = 12;

/** Failed sign-ins before the row-level lock trips. */
const MAX_FAILED_LOGINS = 8;

/** How long the lock holds. */
const LOCKOUT_MS = 15 * 60 * 1000;

/** How many recovery codes an enrolment mints. */
const RECOVERY_CODE_COUNT = 10;

/**
 * A bcrypt hash of a value nobody holds, used to burn comparable time on an
 * unknown email. `$2a$12$` + 53 filler characters is a structurally valid
 * hash, so bcrypt.compare does the full 12-round work rather than rejecting
 * it early. Lifted verbatim from the member login for the same reason.
 */
const TIMING_DECOY = '$2a$12$' + '.'.repeat(53);

/**
 * Is the second factor mandatory on this box?
 *
 * ⚠️ READ PER CALL, NOT CAPTURED AT MODULE LOAD. The switch exists so TOTP
 * can be turned on AFTER the operator has enrolled rather than at the moment
 * of deploy — turning it on at deploy locks the only operator out of the only
 * admin surface, with no route left that could enrol them. `pm2 reload
 * alloutdoor-backend --update-env` is what flips it, and a module-level
 * constant would not see the new value.
 *
 * ⚠️ IT DEFAULTS TO OFF, AND THAT IS A DELIBERATE, TEMPORARY WEAKNESS. The
 * correct sequence is: deploy → sign in → POST /admin/auth/totp/enrol → scan →
 * POST /admin/auth/totp/confirm → save the ten recovery codes → set
 * ADMIN_TOTP_REQUIRED=true → reload. Leaving it off permanently leaves the
 * account that can approve a production shell standing on one password.
 */
function totpRequired(): boolean {
  const raw = (process.env.ADMIN_TOTP_REQUIRED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Desk sign-in, second factor, recovery and password change.
 *
 * WHAT THIS REPLACED. Until 2026-09-11 the whole of admin auth was: compare a
 * password, sign an eight-hour JWT, return it. No session row, so `logout`
 * revoked nothing. No second factor. No durable lockout — the only brake was
 * the in-memory throttler, whose store every `pm2 reload` clears, so each
 * deploy handed an attacker a fresh budget. No timing equalisation, so an
 * unknown admin email answered measurably faster than a wrong password and
 * the account list was enumerable.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService,
    private readonly audit: AdminAuditService,
  ) {}

  // ── Sign-in ───────────────────────────────────────────────────────────

  /**
   * ⚠️ ONE REFUSAL MESSAGE FOR EVERY WAY THIS CAN FAIL, on purpose. "No such
   * admin", "wrong password", "account switched off" and "locked" all answer
   * identically, so the response cannot be used to enumerate who has admin
   * access or to discover that an attack has already tripped a lock.
   *
   * The two EXCEPTIONS are deliberate and carry a `code` the Desk branches
   * on: TOTP_REQUIRED (the password was right, now give a code) and
   * TOTP_ENROLMENT_REQUIRED. TOTP_REQUIRED does disclose that the password
   * was correct — that is unavoidable in any two-step sign-in, and the
   * alternative (demand a code before knowing whether the account has one)
   * makes the form unusable for an account that has not enrolled.
   */
  private refuse(): UnauthorizedException {
    return new UnauthorizedException('Email, password or code is not right.');
  }

  async login(
    dto: AdminLoginDto,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<{
    token: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    /**
     * When the REFRESH token dies. Returned so the controller can set the
     * cookie expiry from it rather than re-deriving the TTL — a second copy
     * of "30 days" is how a cookie ends up outliving, or dying before, the
     * token inside it.
     */
    refreshExpiresAt: string;
    recoveryOnly: boolean;
    totpEnrolled: boolean;
    admin: {
      id: string;
      email: string;
      role: string;
      firstName: string | null;
      lastName: string | null;
    };
  }> {
    const email = dto.email.trim().toLowerCase();
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });

    // Unknown email, or an account switched off. Burn comparable time before
    // refusing: without this an unknown address answers in a millisecond and
    // a real one takes the ~300 ms of a cost-12 compare, which is a clean
    // oracle for "who are the administrators".
    if (!admin || !admin.isActive) {
      await bcrypt.compare(dto.password, TIMING_DECOY);
      throw this.refuse();
    }

    // ⚠️ CHECKED BEFORE bcrypt. A locked account then costs an attacker one
    // indexed lookup instead of a 300 ms hash, so a flood against a locked
    // account cannot also be used to starve the box of CPU. It also does NOT
    // extend the lock — see recordFailedLogin for why that matters.
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw this.refuse();
    }

    const passwordOk = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!passwordOk) {
      await this.recordFailedLogin(admin);
      throw this.refuse();
    }

    const enrolled = Boolean(admin.totpSecret && admin.totpConfirmedAt);
    let amr = ['pwd'];
    let recoveryOnly = false;

    if (enrolled) {
      if (dto.recoveryCode) {
        // ⚠️ SPENDING A RECOVERY CODE IS PERMANENT AND HAPPENS HERE, before
        // anything else can fail. A code that was consumed but did not sign
        // anyone in is the correct outcome of a half-successful attack; a
        // code that signed someone in and stayed usable is not single-use.
        const spent = await this.consumeRecoveryCode(admin.id, dto.recoveryCode);
        if (!spent) {
          await this.recordFailedLogin(admin);
          throw this.refuse();
        }
        amr = ['pwd', 'recovery'];
        recoveryOnly = true;
        await this.audit.record({
          adminUserId: admin.id,
          action: 'ADMIN_RECOVERY_CODE_USED',
          resourceType: 'AdminUser',
          resourceId: admin.id,
          newValue: { remainingCodes: spent.remaining, ip: meta.ip ?? null },
          reason:
            'Signed in with a single-use recovery code; this session is read-only until TOTP is re-enrolled.',
        });
      } else if (dto.totpCode) {
        if (!verifyTotpCode(admin.totpSecret as string, dto.totpCode)) {
          await this.recordFailedLogin(admin);
          throw this.refuse();
        }
        amr = ['pwd', 'otp'];
      } else {
        // ⚠️ NOT COUNTED AS A FAILED LOGIN. It is not a credential guess —
        // it is the first half of a two-step form. Counting it would let an
        // operator lock themselves out by submitting the form eight times
        // before noticing the code box.
        throw new UnauthorizedException({
          message: 'Enter the six-digit code from your authenticator app.',
          code: 'TOTP_REQUIRED',
        });
      }
    } else if (totpRequired()) {
      // Required, but this admin has never enrolled. We still issue a
      // session — a read-only one — because refusing outright is a deadlock:
      // the enrol route needs a session, and there is no other way to get one.
      // The session can reach the own-account routes and nothing else.
      amr = ['pwd'];
      recoveryOnly = true;
      this.logger.warn(
        `Admin ${admin.email} signed in without a second factor while ADMIN_TOTP_REQUIRED is on — read-only session issued so they can enrol.`,
      );
    }

    const issued = await this.sessions.create(
      { id: admin.id, email: admin.email, role: admin.role },
      { amr, recoveryOnly, userAgent: meta.userAgent, ip: meta.ip },
    );

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        lastLoginAt: new Date(),
        // A success is the only thing that clears the counter. See
        // recordFailedLogin.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    return {
      // ⚠️ `token` IS THE ACCESS TOKEN UNDER ITS OLD NAME. Every existing
      // Desk caller reads `json.token`; renaming it in the same change that
      // shortens its life to fifteen minutes would make a frontend bug and a
      // backend bug indistinguishable. Both keys carry the same string.
      token: issued.accessToken,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.accessExpiresAt.toISOString(),
      refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
      recoveryOnly: issued.recoveryOnly,
      totpEnrolled: enrolled,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        firstName: admin.firstName,
        lastName: admin.lastName,
      },
    };
  }

  /** Rotate a refresh token into a fresh pair. */
  async refresh(
    refreshToken: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedAdminSession> {
    return this.sessions.rotate(refreshToken, meta);
  }

  /**
   * Sign out ONE device.
   *
   * ⚠️ THIS IS THE FIX FOR "LOGOUT REVOKED NOTHING". The old route cleared
   * `gg_admin_sess`, a cookie AdminJwtGuard never read — the Desk's real
   * credential was a bearer token in localStorage, which sign-out could not
   * touch and which stayed valid for the rest of its eight hours. Revoking
   * the session row is what makes the word mean something.
   */
  async logout(refreshToken?: string, sessionId?: string): Promise<{ ok: true }> {
    if (refreshToken) await this.sessions.revokeByRefreshToken(refreshToken);
    else if (sessionId) await this.sessions.revokeSession(sessionId, 'sign-out');
    return { ok: true };
  }

  async me(adminPayload: { sub: string }) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminPayload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        totpConfirmedAt: true,
        // ⚠️ totpSecret is NOT selected and must never be. It is the whole
        // credential: anyone who reads it mints every future code. It leaves
        // this service exactly once, in the enrol response.
      },
    });
    if (!admin) return null;
    const remainingRecoveryCodes = await this.prisma.adminRecoveryCode.count({
      where: { adminUserId: admin.id },
    });
    return {
      ...admin,
      totpEnrolled: Boolean(admin.totpConfirmedAt),
      remainingRecoveryCodes,
      totpRequired: totpRequired(),
    };
  }

  // ── Lockout ───────────────────────────────────────────────────────────

  /**
   * Count a failed sign-in, and lock the row once the count trips.
   *
   * ⚠️ THE ROW-LEVEL COUNTER IS NOT BELT-AND-BRACES OVER THE THROTTLER. The
   * global throttler's store is in memory, so every `pm2 reload` — i.e. every
   * deploy, and `deploy.sh` reloads on each one — resets it and hands an
   * attacker a fresh ten-a-minute budget. This counter lives on the row and
   * survives the restart.
   *
   * ⚠️ ONE DELIBERATE DIFFERENCE FROM THE MEMBER PATH, AND IT IS NOT AN
   * OVERSIGHT. `User.failedLoginCount` never decays: recordFailedLogin there
   * clears `lockedUntil` on every non-tripping failure and only a successful
   * login or a password reset resets the count, so attempts 9, 10, 11… each
   * re-lock for a fresh fifteen minutes. On a members' site that is fine.
   * Here it is a denial of service against the ONE account that can reach the
   * Desk: an attacker who can spend eight requests every fifteen minutes
   * holds the operator out of their own admin panel indefinitely. So an
   * EXPIRED lock resets the count to 1 rather than continuing from 8. The
   * attacker still gets only eight guesses per fifteen minutes; the operator
   * gets a usable window back every time the lock lapses.
   *
   * ⚠️ THIS STILL DOES NOT MAKE A SUSTAINED ATTACK SURVIVABLE, and no
   * row-level lockout can. If the Desk is being held shut, the backstop is a
   * shell on the box — `scripts/admin-reset-totp.mjs` clears the second
   * factor and revokes sessions, and a direct UPDATE clears the lock. Shell
   * access is the strongest authentication in this system; the panel is not.
   */
  private async recordFailedLogin(admin: {
    id: string;
    failedLoginCount: number;
    lockedUntil: Date | null;
  }): Promise<void> {
    const lockHasLapsed = Boolean(
      admin.lockedUntil && admin.lockedUntil <= new Date(),
    );
    const next = lockHasLapsed ? 1 : admin.failedLoginCount + 1;

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginCount: next,
        lockedUntil:
          next >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    });
  }

  // ── TOTP enrolment ────────────────────────────────────────────────────

  /**
   * Step one: mint a secret and hand back the URI a phone scans.
   *
   * ⚠️ THE SECRET IS RETURNED HERE AND NOWHERE ELSE, EVER. Not in /me, not in
   * listAdmins, not in an audit row, not in a log line. Anyone holding it
   * mints every future code for this account.
   *
   * ⚠️ ENROLLING NEVER TOUCHES A WORKING FACTOR. The new secret is STAGED in
   * totpPendingSecret; totpSecret and totpConfirmedAt are left exactly as they
   * were until `confirm` proves a phone holds the new one. This is not
   * tidiness — writing straight to totpSecret and nulling the confirmation was
   * a privilege escalation:
   *
   *   1. This route carries the own-account hatch, so the guard lets a READ-ONLY
   *      recovery session through. That is deliberate and must stay — losing
   *      your phone is precisely when you have to enrol a new one.
   *   2. login() computes `enrolled = totpSecret && totpConfirmedAt`, so
   *      clearing the confirmation means "no second factor".
   *   3. With ADMIN_TOTP_REQUIRED off (the default, and the state this ships
   *      in) the next password-only sign-in came back recoveryOnly: FALSE.
   *
   * Two requests and the read-only restriction was gone. Worse, the recovery
   * branch in login() is nested inside `if (enrolled)`, so the ten paper codes
   * silently stopped being checked the moment the confirmation was cleared.
   * Staging closes all of it: an abandoned — or hostile — enrolment leaves the
   * account bit-for-bit unchanged.
   *
   * ⚠️ AND REPLACING A CONFIRMED FACTOR RE-AUTHENTICATES. `changePassword`
   * two hundred lines below already refuses without the current password;
   * swapping the second factor is the same kind of act and an access token on
   * its own must not be enough to do it. The Desk holds that token in
   * localStorage, so "stole the token" is the cheap attack, and without this
   * it converted into permanent control of the account — enrol, confirm from
   * the attacker's own phone, collect ten fresh recovery codes, and confirm
   * then revokes every OTHER session, locking the real operator out of their
   * own admin. The first enrolment asks for nothing, because an account with
   * no second factor and a stolen token is already lost.
   */
  async enrolTotp(
    adminUserId: string,
    dto: AdminEnrolTotpDto = {},
  ): Promise<{
    secret: string;
    otpauthUri: string;
    alreadyEnrolled: boolean;
  }> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: {
        id: true,
        email: true,
        totpConfirmedAt: true,
        passwordHash: true,
      },
    });
    if (!admin) throw this.refuse();

    const alreadyEnrolled = Boolean(admin.totpConfirmedAt);

    if (alreadyEnrolled) {
      // ⚠️ bcrypt.compare AGAINST AN EMPTY STRING IS A REJECTION, NOT A CRASH,
      // but say so plainly rather than letting a missing field read as a wrong
      // password — the operator retyping a password that was never the problem
      // is how a support call starts.
      if (!dto.currentPassword) {
        throw new UnauthorizedException(
          'Enter your current password to replace the authenticator on this account.',
        );
      }
      const ok = await bcrypt.compare(dto.currentPassword, admin.passwordHash);
      if (!ok) {
        throw new UnauthorizedException(
          'That password is not right, so the authenticator was not changed.',
        );
      }
    }

    const secret = generateTotpSecret();
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        // ⚠️ PENDING, NOT LIVE. totpSecret and totpConfirmedAt are untouched
        // here by design — see the block above. confirm() promotes this.
        totpPendingSecret: secret,
      },
    });

    return {
      secret,
      otpauthUri: otpauthUri({ secret, account: admin.email }),
      alreadyEnrolled,
    };
  }

  /**
   * Step two: prove the secret reached a phone, then trust it and mint the
   * ten recovery codes.
   *
   * The codes are returned ONCE, in plaintext, in this response. They are
   * stored as bcrypt hashes and cannot be re-read; the only way to see them
   * again is to confirm enrolment again, which replaces all ten.
   */
  async confirmTotp(
    adminUserId: string,
    dto: AdminConfirmTotpDto,
    currentSessionId?: string,
  ): Promise<{
    confirmed: true;
    recoveryCodes: string[];
    otherSessionsEnded: number;
  }> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { id: true, totpPendingSecret: true },
    });
    // ⚠️ THE PENDING SECRET IS THE ONLY ONE THIS ROUTE WILL ACCEPT. Falling
    // back to the live totpSecret when there is no enrolment in progress would
    // let anyone holding a current code mint a fresh set of recovery codes and
    // revoke every other session — a re-confirmation that proves nothing new.
    if (!admin?.totpPendingSecret) {
      throw new ForbiddenException(
        'Start an enrolment first — there is no secret on this account to confirm.',
      );
    }
    if (!verifyTotpCode(admin.totpPendingSecret, dto.totpCode)) {
      throw new UnauthorizedException(
        'That code did not match. Check your phone’s clock is set automatically, then try the next code.',
      );
    }

    const { codes, hashes } = await this.mintRecoveryCodes();

    // One transaction: a confirmation without codes, or codes without a
    // confirmation, are both states the operator would have to be talked out
    // of over the phone.
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          // The promotion: the staged secret becomes the live one in the same
          // statement that trusts it, so there is no instant in which the
          // account carries a confirmed secret nobody has proven.
          totpSecret: admin.totpPendingSecret,
          totpConfirmedAt: new Date(),
          totpPendingSecret: null,
        },
      }),
      // Replacing the set: any codes from a previous enrolment answer to a
      // secret that is gone and must not outlive it.
      this.prisma.adminRecoveryCode.deleteMany({
        where: { adminUserId: admin.id },
      }),
      this.prisma.adminRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ adminUserId: admin.id, codeHash })),
      }),
    ]);

    // ⚠️ EVERY OTHER SESSION DIES, INCLUDING ANY READ-ONLY RECOVERY SESSION.
    // You enrol a second factor because you think somebody else may have your
    // password; leaving their session running makes the enrolment decorative.
    // It is also what lifts the recovery-only restriction — that flag lives on
    // the session row, so the way out of read-only is a new session, and the
    // caller gets one by signing in again with the phone they just enrolled.
    // The caller's own session is spared so the response reaches them.
    const otherSessionsEnded = await this.sessions.revokeAllForAdmin(
      admin.id,
      currentSessionId,
    );

    await this.audit.record({
      adminUserId: admin.id,
      action: 'ADMIN_TOTP_CONFIRMED',
      resourceType: 'AdminUser',
      resourceId: admin.id,
      newValue: { recoveryCodesIssued: codes.length, otherSessionsEnded },
      reason: 'Admin enrolled a second factor and was issued recovery codes.',
    });

    return { confirmed: true, recoveryCodes: codes, otherSessionsEnded };
  }

  // ── Recovery codes ────────────────────────────────────────────────────

  /**
   * Ten codes, shaped `XXXXX-XXXXX` from an alphabet with no 0/O/1/I/L.
   *
   * The ambiguity matters: these get written on paper, put in a safe, and
   * typed back months later under pressure by somebody who cannot try again
   * indefinitely.
   *
   * ⚠️ bcrypt COST 12 TIMES TEN IS ABOUT THREE SECONDS OF CPU. That is why
   * this runs once at enrolment and never on a hot path. Do not "optimise" it
   * to a cheaper cost: a recovery code is a password that skips the second
   * factor, so it gets the password work factor.
   */
  private async mintRecoveryCodes(): Promise<{
    codes: string[];
    hashes: string[];
  }> {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const make = () => {
      const bytes = randomBytes(10);
      let out = '';
      for (let i = 0; i < 10; i++) {
        if (i === 5) out += '-';
        out += alphabet[bytes[i] % alphabet.length];
      }
      return out;
    };

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, make);
    const hashes = await Promise.all(
      codes.map((code) => bcrypt.hash(this.normaliseRecoveryCode(code), BCRYPT_COST)),
    );
    return { codes, hashes };
  }

  /**
   * ⚠️ THE NORMALISATION IS PART OF THE SECRET. A code hashed as typed and
   * compared as typed means "abcde-fghij" fails against "ABCDE-FGHIJ" — and
   * the operator, holding the right piece of paper, concludes the codes do
   * not work. Hash and compare through the same function or neither side is
   * comparing what it thinks it is.
   */
  private normaliseRecoveryCode(code: string): string {
    return code.replace(/[\s-]/g, '').toUpperCase();
  }

  /**
   * Spend a recovery code. Returns null if it matched nothing.
   *
   * ⚠️ SINGLE-USE IS ENFORCED BY THE DELETE'S ROW COUNT, NOT BY THE COMPARE.
   * Two requests presenting the same code can both pass bcrypt.compare —
   * they are reading, not writing. What separates them is
   * `deleteMany({ where: { id } })`: exactly one gets count 1 and the other
   * gets 0 and is refused. This is the reason the codes are rows rather than
   * a `String[]` column, where the equivalent read-modify-write would let the
   * second writer resurrect the code the first just spent.
   */
  private async consumeRecoveryCode(
    adminUserId: string,
    presented: string,
  ): Promise<{ remaining: number } | null> {
    const normalised = this.normaliseRecoveryCode(presented);
    if (!normalised) return null;

    const rows = await this.prisma.adminRecoveryCode.findMany({
      where: { adminUserId },
      select: { id: true, codeHash: true },
    });

    for (const row of rows) {
      // Short-circuiting on a match leaks only WHICH of the ten codes
      // matched, by response time. That is not a secret — the codes are
      // independent — and the alternative is ten cost-12 compares (~3 s) on
      // every recovery attempt, which is its own denial of service.
      if (!(await bcrypt.compare(normalised, row.codeHash))) continue;

      const spent = await this.prisma.adminRecoveryCode.deleteMany({
        where: { id: row.id },
      });
      if (spent.count !== 1) return null; // Lost the race; the code is gone.

      const remaining = await this.prisma.adminRecoveryCode.count({
        where: { adminUserId },
      });
      return { remaining };
    }
    return null;
  }

  // ── Password ──────────────────────────────────────────────────────────

  /**
   * Change your OWN admin password.
   *
   * ⚠️ THIS ROUTE EXISTS BECAUSE THERE WAS NO WAY TO SET AN ADMIN PASSWORD AT
   * ALL. `AdminService.createAdmin` writes `bcrypt.hash(randomBytes(24), 10)`
   * as a placeholder — a value nobody has ever seen — with a comment claiming
   * "login goes through the identity provider", which has been false since
   * Clerk was removed on 2026-09-10. A freshly created admin therefore could
   * not log in by any means, and the only working path to an account was
   * `scripts/create-admin.mjs` on the box. That is still the provisioning
   * path (see the script header); this route is how the password stops being
   * the one the script printed to a terminal.
   *
   * ⚠️ THERE IS DELIBERATELY NO "SET SOMEBODY ELSE'S PASSWORD" ROUTE. A Full
   * admin who could set another admin's password could set a Full admin's
   * password, sign in as them, and every audit row after that names the wrong
   * person. Resetting someone else's password is a shell operation on the box
   * (`scripts/create-admin.mjs --reset`), where it leaves a trace an attacker
   * inside the Desk cannot produce.
   */
  async changePassword(
    adminUserId: string,
    dto: AdminChangePasswordDto,
    currentSessionId?: string,
  ): Promise<{ ok: true; otherSessionsEnded: number }> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { id: true, passwordHash: true },
    });
    if (!admin) throw this.refuse();

    const ok = await bcrypt.compare(dto.currentPassword, admin.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Your current password is not right.');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new ForbiddenException('The new password must be different.');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_COST) },
    });

    // ⚠️ EVERY OTHER SESSION DIES, and this is not tidiness. A password
    // change that left the thief's session alive would not lock them out —
    // which is the only reason anyone changes a password in a hurry. The
    // caller's own session is spared so they are not signed out by their own
    // success.
    const otherSessionsEnded = await this.sessions.revokeAllForAdmin(
      admin.id,
      currentSessionId,
    );

    await this.audit.record({
      adminUserId: admin.id,
      action: 'ADMIN_PASSWORD_CHANGE',
      resourceType: 'AdminUser',
      resourceId: admin.id,
      newValue: { otherSessionsEnded },
      reason: 'Admin changed their own password; other sessions were ended.',
    });

    return { ok: true, otherSessionsEnded };
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  listSessions(adminUserId: string) {
    return this.sessions.listForAdmin(adminUserId);
  }

  /**
   * End every session except the one making the request.
   *
   * The "I left it signed in on the laptop at the shop" button. Deliberately
   * scoped to the caller's OWN sessions — ending another admin's is
   * `deactivateAdmin`, which is audited and needs a reason.
   */
  async revokeOtherSessions(
    adminUserId: string,
    currentSessionId?: string,
  ): Promise<{ ended: number }> {
    const ended = await this.sessions.revokeAllForAdmin(
      adminUserId,
      currentSessionId,
    );
    return { ended };
  }
}
