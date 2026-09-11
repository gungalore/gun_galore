import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AdminAuthService } from './admin-auth.service';
import { totp, base32Decode } from './totp';
import type { PrismaService } from '../prisma/prisma.service';
import type { AdminAuditService } from './admin-audit.service';
import type { AdminSessionService } from './admin-session.service';

/**
 * ⚠️ WHAT THIS FILE IS DEFENDING.
 *
 * Before 2026-09-11 admin sign-in was: compare a password, sign an eight-hour
 * JWT, return it. No second factor. No durable lockout — the only brake was
 * the in-memory throttler, which every `pm2 reload` clears, so each deploy
 * handed an attacker a fresh budget. No timing equalisation, so an unknown
 * admin email answered measurably faster than a wrong password.
 *
 * The tests below are the properties, not the implementation. If one fails,
 * something about who can get into the Desk has changed.
 */

// A cheap cost so the suite does not spend a minute in bcrypt. The PRODUCTION
// cost is 12 and lives in BCRYPT_COST in the service; nothing here asserts on
// the cost of a hash it created itself.
const hash = (pw: string) => bcrypt.hashSync(pw, 4);

type AdminRow = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  totpSecret: string | null;
  totpPendingSecret: string | null;
  totpConfirmedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
};

function makeAdmin(over: Partial<AdminRow> = {}): AdminRow {
  return {
    id: 'A1',
    email: 'ops@alloutdoor.co.za',
    passwordHash: hash('correct-horse-battery'),
    role: 'SUPERADMIN',
    firstName: 'Ops',
    lastName: null,
    isActive: true,
    totpSecret: null,
    totpPendingSecret: null,
    totpConfirmedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    ...over,
  };
}

function makeService(
  admin: AdminRow | null,
  recoveryCodes: Array<{ id: string; codeHash: string }> = [],
) {
  const codes = [...recoveryCodes];
  const prisma = {
    adminUser: {
      findUnique: jest.fn(async () => admin),
      update: jest.fn(async ({ data }: { data: Partial<AdminRow> }) => {
        if (admin) Object.assign(admin, data);
        return admin;
      }),
    },
    adminRecoveryCode: {
      findMany: jest.fn(async () => codes.map((c) => ({ ...c }))),
      deleteMany: jest.fn(async ({ where }: { where: { id?: string; adminUserId?: string } }) => {
        const before = codes.length;
        if (where.id) {
          const i = codes.findIndex((c) => c.id === where.id);
          if (i >= 0) codes.splice(i, 1);
        } else {
          codes.length = 0;
        }
        return { count: before - codes.length };
      }),
      createMany: jest.fn(async () => ({ count: 0 })),
      count: jest.fn(async () => codes.length),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const sessions = {
    create: jest.fn(async (_a: unknown, opts: { amr: string[]; recoveryOnly?: boolean }) => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      sessionId: 'S1',
      accessExpiresAt: new Date(Date.now() + 900_000),
      refreshExpiresAt: new Date(Date.now() + 2_592_000_000),
      recoveryOnly: opts.recoveryOnly ?? false,
      // Captured so the tests can assert what was claimed.
      _amr: opts.amr,
    })),
    rotate: jest.fn(),
    revokeByRefreshToken: jest.fn(),
    revokeSession: jest.fn(),
    revokeAllForAdmin: jest.fn(async () => 2),
    listForAdmin: jest.fn(async () => []),
  };

  const audit = { record: jest.fn(async () => undefined), list: jest.fn() };

  return {
    service: new AdminAuthService(
      prisma as unknown as PrismaService,
      sessions as unknown as AdminSessionService,
      audit as unknown as AdminAuditService,
    ),
    prisma,
    sessions,
    audit,
    codes,
  };
}

const GOOD = { email: 'ops@alloutdoor.co.za', password: 'correct-horse-battery' };

describe('login — the refusal is indistinguishable', () => {
  it('gives the same message for an unknown email and a wrong password', async () => {
    const unknown = makeService(null);
    const wrong = makeService(makeAdmin());

    const a = await unknown.service.login(GOOD).catch((e: Error) => e.message);
    const b = await wrong.service
      .login({ ...GOOD, password: 'nope-nope-nope' })
      .catch((e: Error) => e.message);

    // ⚠️ IF THESE EVER DIFFER, THE ADMIN LIST IS ENUMERABLE. That is the
    // whole point of the shared `refuse()` helper.
    expect(a).toBe(b);
    expect(a).toBe('Email, password or code is not right.');
  });

  it('burns bcrypt time on an unknown email', async () => {
    // Without the decoy compare an unknown address answers in under a
    // millisecond while a real one costs a full hash — a clean oracle for
    // "who are the administrators". Timing assertions are flaky, so this
    // asserts the mechanism: the decoy is a structurally valid hash, so
    // bcrypt actually does the work rather than bailing out early.
    const { service } = makeService(null);
    const started = Date.now();
    await service.login(GOOD).catch(() => undefined);
    // Cost 12 on the decoy is ~200-400ms; assert only that real work happened.
    expect(Date.now() - started).toBeGreaterThan(20);
  });

  it('refuses a deactivated admin with the same message', async () => {
    const { service } = makeService(makeAdmin({ isActive: false }));
    await expect(service.login(GOOD)).rejects.toThrow(
      'Email, password or code is not right.',
    );
  });
});

describe('lockout', () => {
  it('counts each failure on the row, so a pm2 reload does not reset it', async () => {
    const admin = makeAdmin();
    const { service } = makeService(admin);

    for (let i = 1; i <= 3; i++) {
      await service.login({ ...GOOD, password: 'wrong' }).catch(() => undefined);
      expect(admin.failedLoginCount).toBe(i);
      expect(admin.lockedUntil).toBeNull();
    }
  });

  it('locks on the eighth failure for fifteen minutes', async () => {
    const admin = makeAdmin({ failedLoginCount: 7 });
    const { service } = makeService(admin);

    await service.login({ ...GOOD, password: 'wrong' }).catch(() => undefined);

    expect(admin.failedLoginCount).toBe(8);
    expect(admin.lockedUntil).toBeInstanceOf(Date);
    const ms = (admin.lockedUntil as Date).getTime() - Date.now();
    expect(ms).toBeGreaterThan(14 * 60_000);
    expect(ms).toBeLessThanOrEqual(15 * 60_000 + 1000);
  });

  it('refuses a locked account WITHOUT running bcrypt, even with the right password', async () => {
    const admin = makeAdmin({
      failedLoginCount: 8,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const { service, sessions } = makeService(admin);

    await expect(service.login(GOOD)).rejects.toThrow(UnauthorizedException);
    expect(sessions.create).not.toHaveBeenCalled();
    // ⚠️ The lock is NOT extended by an attempt against it. Extending it
    // would let an attacker hold the operator out forever with one request
    // every fourteen minutes.
    expect(admin.failedLoginCount).toBe(8);
  });

  it('RESETS THE COUNT WHEN AN EXPIRED LOCK IS HIT AGAIN — the one deliberate difference from the member path', async () => {
    // ⚠️ On the member side (auth.service.ts:404-415) the counter never
    // decays, so attempts 9, 10, 11… each re-lock for a fresh fifteen
    // minutes. Copied here verbatim that is a denial of service against the
    // ONE account that can reach the Desk. An expired lock starts the count
    // over, so eight guesses per fifteen minutes is the attacker's ceiling
    // and the operator gets a usable window back every time it lapses.
    const admin = makeAdmin({
      failedLoginCount: 8,
      lockedUntil: new Date(Date.now() - 1),
    });
    const { service } = makeService(admin);

    await service.login({ ...GOOD, password: 'wrong' }).catch(() => undefined);

    expect(admin.failedLoginCount).toBe(1);
    expect(admin.lockedUntil).toBeNull();
  });

  it('a lapsed lock lets the right password straight in', async () => {
    const admin = makeAdmin({
      failedLoginCount: 8,
      lockedUntil: new Date(Date.now() - 1),
    });
    const { service } = makeService(admin);

    const out = await service.login(GOOD);
    expect(out.token).toBe('access');
    expect(admin.failedLoginCount).toBe(0);
    expect(admin.lockedUntil).toBeNull();
  });

  it('a success clears the counter', async () => {
    const admin = makeAdmin({ failedLoginCount: 5 });
    const { service } = makeService(admin);
    await service.login(GOOD);
    expect(admin.failedLoginCount).toBe(0);
  });
});

describe('TOTP at login', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

  function enrolled(over: Partial<AdminRow> = {}) {
    return makeAdmin({
      totpSecret: secret,
      totpConfirmedAt: new Date('2026-09-01'),
      ...over,
    });
  }

  it('asks for a code, distinguishably, when one is enrolled and none was sent', async () => {
    const { service, sessions } = makeService(enrolled());
    const err = await service.login(GOOD).catch((e: UnauthorizedException) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({
      code: 'TOTP_REQUIRED',
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('does NOT count a missing code as a failed login', async () => {
    // ⚠️ It is not a credential guess — it is the first half of a two-step
    // form. Counting it lets an operator lock themselves out by submitting
    // eight times before noticing the code box.
    const admin = enrolled();
    const { service } = makeService(admin);
    for (let i = 0; i < 9; i++) await service.login(GOOD).catch(() => undefined);
    expect(admin.failedLoginCount).toBe(0);
    expect(admin.lockedUntil).toBeNull();
  });

  it('accepts a live code and claims amr pwd+otp', async () => {
    const { service, sessions } = makeService(enrolled());
    const code = totp(base32Decode(secret));
    const out = await service.login({ ...GOOD, totpCode: code });
    expect(out.recoveryOnly).toBe(false);
    expect(sessions.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amr: ['pwd', 'otp'], recoveryOnly: false }),
    );
  });

  it('counts a WRONG code as a failed login', async () => {
    const admin = enrolled();
    const { service } = makeService(admin);
    await service
      .login({ ...GOOD, totpCode: '000000' })
      .catch(() => undefined);
    expect(admin.failedLoginCount).toBe(1);
  });

  it('ignores an UNCONFIRMED secret rather than demanding codes for it', async () => {
    // ⚠️ A secret written to the row and never proved is a half-enrolment:
    // the operator scanned the QR and closed the tab, or scanned it into the
    // wrong app. Demanding codes from it is a lockout with no way back.
    const admin = makeAdmin({ totpSecret: secret, totpConfirmedAt: null });
    const { service } = makeService(admin);
    const out = await service.login(GOOD);
    expect(out.totpEnrolled).toBe(false);
    expect(out.token).toBe('access');
  });

  describe('ADMIN_TOTP_REQUIRED', () => {
    const original = process.env.ADMIN_TOTP_REQUIRED;
    afterEach(() => {
      if (original === undefined) delete process.env.ADMIN_TOTP_REQUIRED;
      else process.env.ADMIN_TOTP_REQUIRED = original;
    });

    it('is off unless explicitly set — flipping it at deploy locks the only operator out', async () => {
      delete process.env.ADMIN_TOTP_REQUIRED;
      const { service, sessions } = makeService(makeAdmin());
      await service.login(GOOD);
      expect(sessions.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recoveryOnly: false }),
      );
    });

    it('issues a READ-ONLY session to an un-enrolled admin when on, rather than refusing', async () => {
      // ⚠️ Refusing outright is a deadlock: the enrol route needs a session
      // and there is no other way to get one. The session it gets can reach
      // the own-account routes and nothing else.
      process.env.ADMIN_TOTP_REQUIRED = 'true';
      const { service, sessions } = makeService(makeAdmin());
      const out = await service.login(GOOD);
      expect(out.recoveryOnly).toBe(true);
      expect(sessions.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recoveryOnly: true, amr: ['pwd'] }),
      );
    });

    it('is read per call, not captured at module load', async () => {
      // `pm2 reload --update-env` is how this gets switched on. A constant
      // captured at import would not see the new value.
      delete process.env.ADMIN_TOTP_REQUIRED;
      const off = makeService(makeAdmin());
      expect((await off.service.login(GOOD)).recoveryOnly).toBe(false);

      process.env.ADMIN_TOTP_REQUIRED = '1';
      const on = makeService(makeAdmin());
      expect((await on.service.login(GOOD)).recoveryOnly).toBe(true);
    });
  });
});

describe('recovery codes', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const CODE = 'ABCDE-FGHIJ';

  function withCode(over: Partial<AdminRow> = {}) {
    const admin = makeAdmin({
      totpSecret: secret,
      totpConfirmedAt: new Date('2026-09-01'),
      ...over,
    });
    // Stored normalised — see normaliseRecoveryCode. Hash and compare must
    // go through the same normalisation or the operator holding the right
    // piece of paper is told their codes do not work.
    return makeService(admin, [
      { id: 'RC1', codeHash: hash('ABCDEFGHIJ') },
      { id: 'RC2', codeHash: hash('KLMNOPQRST') },
    ]);
  }

  it('signs in, and the session is READ-ONLY with amr pwd+recovery', async () => {
    const { service, sessions } = withCode();
    const out = await service.login({ ...GOOD, recoveryCode: CODE });

    expect(out.recoveryOnly).toBe(true);
    expect(sessions.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amr: ['pwd', 'recovery'],
        recoveryOnly: true,
      }),
    );
  });

  it('IS SINGLE USE — the second presentation of the same code is refused', async () => {
    // ⚠️ THE PROPERTY THE CHILD TABLE EXISTS FOR. As a `String[]` column the
    // equivalent read-modify-write lets the second writer resurrect the code
    // the first just spent.
    const { service, codes } = withCode();

    await service.login({ ...GOOD, recoveryCode: CODE });
    expect(codes.map((c) => c.id)).toEqual(['RC2']);

    await expect(
      service.login({ ...GOOD, recoveryCode: CODE }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('deletes the hash rather than marking it consumed', async () => {
    const { service, prisma } = withCode();
    await service.login({ ...GOOD, recoveryCode: CODE });
    expect(prisma.adminRecoveryCode.deleteMany).toHaveBeenCalledWith({
      where: { id: 'RC1' },
    });
  });

  it('matches regardless of case, spaces and dashes', async () => {
    const { service } = withCode();
    const out = await service.login({ ...GOOD, recoveryCode: ' abcde fghij ' });
    expect(out.recoveryOnly).toBe(true);
  });

  it('counts a bad code as a failed login', async () => {
    const ctx = withCode();
    await ctx.service
      .login({ ...GOOD, recoveryCode: 'ZZZZZ-ZZZZZ' })
      .catch(() => undefined);
    // The row object is the same one the service mutates.
    expect(ctx.prisma.adminUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginCount: 1 }),
      }),
    );
  });

  it('writes an audit row, because a recovery sign-in is a security event', async () => {
    const { service, audit } = withCode();
    await service.login({ ...GOOD, recoveryCode: CODE });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_RECOVERY_CODE_USED',
        adminUserId: 'A1',
      }),
    );
  });

  it('a wrong password never reaches the codes at all', async () => {
    const { service, prisma } = withCode();
    await service
      .login({ ...GOOD, password: 'wrong', recoveryCode: CODE })
      .catch(() => undefined);
    expect(prisma.adminRecoveryCode.findMany).not.toHaveBeenCalled();
  });
});

describe('TOTP enrolment', () => {
  it('stages a replacement secret and leaves the working factor alone', async () => {
    // 🚨 THIS IS THE REGRESSION TEST FOR A PRIVILEGE ESCALATION, not a
    // preference about where a column lives. Enrolment used to write the new
    // secret into totpSecret and null totpConfirmedAt, which switched the
    // account's second factor OFF in one request — see the chain pinned three
    // tests below. The working factor must survive an enrolment that is never
    // confirmed.
    const confirmedAt = new Date('2026-01-01');
    const admin = makeAdmin({
      totpSecret: 'OLDSECRETOLDSECRETOLDSECRETOLDSE',
      totpConfirmedAt: confirmedAt,
    });
    const { service } = makeService(admin);

    const out = await service.enrolTotp('A1', {
      currentPassword: 'correct-horse-battery',
    });

    expect(out.alreadyEnrolled).toBe(true);
    expect(out.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(admin.totpPendingSecret).toBe(out.secret);
    // Untouched — the phone in the operator's pocket still works.
    expect(admin.totpSecret).toBe('OLDSECRETOLDSECRETOLDSECRETOLDSE');
    expect(admin.totpConfirmedAt).toBe(confirmedAt);
  });

  it('refuses to replace a confirmed factor without the current password', async () => {
    // ⚠️ The Desk keeps the access token in localStorage, so "stole the token"
    // is the cheap attack. Without this, it converted into permanent control:
    // enrol, confirm from the attacker's phone, take ten fresh recovery codes,
    // and confirm revokes every OTHER session — locking the real operator out.
    const admin = makeAdmin({
      totpSecret: 'OLDSECRETOLDSECRETOLDSECRETOLDSE',
      totpConfirmedAt: new Date('2026-01-01'),
    });
    const { service } = makeService(admin);

    await expect(service.enrolTotp('A1', {})).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      service.enrolTotp('A1', { currentPassword: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(admin.totpPendingSecret).toBeNull();
  });

  it('asks nothing of a FIRST enrolment', async () => {
    // An account with no second factor and a stolen token is already lost;
    // demanding a password here would buy nothing and would block the only
    // path out of "never enrolled".
    const admin = makeAdmin();
    const { service } = makeService(admin);

    const out = await service.enrolTotp('A1');

    expect(out.alreadyEnrolled).toBe(false);
    expect(admin.totpPendingSecret).toBe(out.secret);
    expect(admin.totpSecret).toBeNull();
  });

  it('an abandoned enrolment cannot downgrade the account to password-only', async () => {
    // 🚨 THE ESCALATION, END TO END. The old code made these three steps a
    // two-request bypass of the read-only recovery restriction:
    //   enrol (allowed for a recovery session, by design) → factor OFF →
    //   next password-only login comes back with FULL WRITE.
    // login() reads `enrolled = totpSecret && totpConfirmedAt`, and the
    // recovery-code branch is nested inside `if (enrolled)`, so the ten paper
    // codes silently stopped being checked too.
    const admin = makeAdmin({
      totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      totpConfirmedAt: new Date('2026-01-01'),
    });
    const { service } = makeService(admin);

    await service.enrolTotp('A1', { currentPassword: 'correct-horse-battery' });

    // Still enrolled, so a password on its own is still not a way in.
    await expect(
      service.login({
        email: 'ops@alloutdoor.co.za',
        password: 'correct-horse-battery',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns an otpauth URI carrying the secret and the account', async () => {
    const { service } = makeService(makeAdmin());
    const out = await service.enrolTotp('A1');
    expect(out.otpauthUri).toContain(`secret=${out.secret}`);
    expect(out.otpauthUri).toContain('ops%40alloutdoor.co.za');
  });

  it('refuses to confirm when no enrolment was started', async () => {
    const { service } = makeService(makeAdmin({ totpPendingSecret: null }));
    await expect(
      service.confirmTotp('A1', { totpCode: '123456' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a code that does not match the secret', async () => {
    const admin = makeAdmin({
      totpPendingSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    });
    const { service } = makeService(admin);
    await expect(
      service.confirmTotp('A1', { totpCode: '000000' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(admin.totpConfirmedAt).toBeNull();
    expect(admin.totpSecret).toBeNull();
  });

  it('refuses a code from the LIVE secret when no enrolment is pending', async () => {
    // ⚠️ Falling back to totpSecret would let anyone holding a current code
    // mint a fresh set of recovery codes and revoke every other session — a
    // re-confirmation that proves nothing that was not already true.
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const admin = makeAdmin({
      totpSecret: secret,
      totpConfirmedAt: new Date('2026-01-01'),
      totpPendingSecret: null,
    });
    const { service } = makeService(admin);
    await expect(
      service.confirmTotp('A1', { totpCode: totp(base32Decode(secret)) }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('confirms on a live code, mints ten recovery codes, and ends other sessions', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const admin = makeAdmin({ totpPendingSecret: secret });
    const { service, sessions, audit } = makeService(admin);

    const out = await service.confirmTotp(
      'A1',
      { totpCode: totp(base32Decode(secret)) },
      'S-current',
    );

    expect(out.confirmed).toBe(true);
    // The promotion: staged secret becomes the live one, staging is cleared.
    expect(admin.totpSecret).toBe(secret);
    expect(admin.totpPendingSecret).toBeNull();
    expect(admin.totpConfirmedAt).toBeInstanceOf(Date);
    expect(out.recoveryCodes).toHaveLength(10);
    expect(new Set(out.recoveryCodes).size).toBe(10);
    for (const code of out.recoveryCodes) {
      // XXXXX-XXXXX, from an alphabet with no 0/O/1/I/L — these get written
      // on paper and typed back months later under pressure.
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    }
    // ⚠️ Other sessions die: you enrol a second factor because you think
    // somebody else may have your password.
    expect(sessions.revokeAllForAdmin).toHaveBeenCalledWith('A1', 'S-current');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ADMIN_TOTP_CONFIRMED' }),
    );
    // ⚠️ 30s, NOT THE 5s DEFAULT. This is the one test that runs the REAL
    // production bcrypt cost — ten cost-12 hashes, about three seconds of
    // solid CPU, and more under jest's parallel workers. It passed alone and
    // timed out in the full suite, which reads exactly like a flaky test and
    // is not one: the cost is the point. Do not "fix" it by lowering
    // BCRYPT_COST — a recovery code is a password that skips the second
    // factor and gets the password work factor.
  }, 30_000);
});

describe('changePassword', () => {
  it('requires the current password', async () => {
    const { service } = makeService(makeAdmin());
    await expect(
      service.changePassword('A1', {
        currentPassword: 'wrong',
        newPassword: 'a-brand-new-long-one',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuses a no-op change', async () => {
    const { service } = makeService(makeAdmin());
    await expect(
      service.changePassword('A1', {
        currentPassword: GOOD.password,
        newPassword: GOOD.password,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('ENDS EVERY OTHER SESSION and spares the caller’s own', async () => {
    // ⚠️ A password change that left the thief signed in would not have
    // locked anybody out — which is the only reason anyone changes a
    // password in a hurry.
    const admin = makeAdmin();
    const { service, sessions, audit } = makeService(admin);

    const out = await service.changePassword(
      'A1',
      { currentPassword: GOOD.password, newPassword: 'a-brand-new-long-one' },
      'S-current',
    );

    expect(sessions.revokeAllForAdmin).toHaveBeenCalledWith('A1', 'S-current');
    expect(out.otherSessionsEnded).toBe(2);
    expect(bcrypt.compareSync('a-brand-new-long-one', admin.passwordHash)).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ADMIN_PASSWORD_CHANGE' }),
    );
  });
});

describe('me', () => {
  it('NEVER returns the TOTP secret', async () => {
    // ⚠️ The secret alone mints every future code. It leaves this service
    // exactly once, in the enrol response. If this test fails, /admin/auth/me
    // is handing the second factor to anything that can read a response body.
    const { service, prisma } = makeService(
      makeAdmin({ totpSecret: 'SECRETSECRETSECRETSECRETSECRETSE' }),
    );
    await service.me({ sub: 'A1' });
    const select = (prisma.adminUser.findUnique as jest.Mock).mock.calls[0][0]
      .select as Record<string, boolean>;
    expect(select.totpSecret).toBeUndefined();
  });
});

describe('logout', () => {
  it('revokes the session the refresh token names', async () => {
    // ⚠️ THE OLD LOGOUT REVOKED NOTHING — it cleared a cookie the guard never
    // read, and the bearer token the Desk held stayed valid for eight hours.
    const { service, sessions } = makeService(makeAdmin());
    await service.logout('the-refresh-token');
    expect(sessions.revokeByRefreshToken).toHaveBeenCalledWith(
      'the-refresh-token',
    );
  });
});
