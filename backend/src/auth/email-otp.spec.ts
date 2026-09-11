import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';

/**
 * The email verification code, which is ours again rather than the identity
 * provider's (2026-09-11).
 *
 * ⚠️ WHY THIS FILE EXISTS. A six-digit code is a million combinations — an
 * afternoon for a script if it may guess freely. The length is not the
 * control; the attempt cap, the expiry and the single-use discard are. Each
 * one is load-bearing on its own, so each one is asserted here rather than
 * left to a reading of the happy path.
 */

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

type Row = Record<string, unknown> | null;

/** A prisma double that records what was written, so writes can be asserted. */
function prismaWith(row: Row) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    user: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn((args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return Promise.resolve({});
      }),
    },
  };
}

function make(row: Row, notifications: Record<string, unknown> = {}) {
  const prisma = prismaWith(row);
  const notif = {
    emailVerificationCode: jest.fn().mockResolvedValue(undefined),
    ...notifications,
  };
  const sessions = {
    create: jest
      .fn()
      .mockResolvedValue({ sessionId: 's1', accessToken: 'a', refreshToken: 'r' }),
  };
  const service = new AuthService(
    prisma as never,
    sessions as never,
    notif as never,
    {} as never,
  );
  // recordLogin writes a LoginEvent we do not care about here.
  (service as unknown as { recordLogin: () => Promise<void> }).recordLogin =
    jest.fn().mockResolvedValue(undefined);
  return { service, prisma, notif, sessions };
}

const future = () => new Date(Date.now() + 10 * 60_000);
const past = () => new Date(Date.now() - 1_000);

describe('sendEmailCode', () => {
  const OLD = process.env.RESEND_API_KEY;
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key-so-the-dev-stub-stays-off';
  });
  afterAll(() => {
    if (OLD === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = OLD;
  });

  it('stores the code hashed, never in the clear', async () => {
    const { service, prisma, notif } = make({
      id: 'u1',
      emailVerifiedAt: null,
      accountClosedAt: null,
    });
    await service.sendEmailCode('Someone@Example.com');

    const sent = notif.emailVerificationCode.mock.calls[0][0] as {
      code: string;
    };
    const written = prisma.updates[0] as { emailOtpHash: string };
    expect(written.emailOtpHash).toBe(sha256(sent.code));
    expect(written.emailOtpHash).not.toContain(sent.code);
  });

  it('mints six digits, zero-padded', async () => {
    const { service, notif } = make({
      id: 'u1',
      emailVerifiedAt: null,
      accountClosedAt: null,
    });
    await service.sendEmailCode('a@b.com');
    const { code } = notif.emailVerificationCode.mock.calls[0][0] as {
      code: string;
    };
    expect(code).toMatch(/^\d{6}$/);
  });

  it('resets the attempt counter when a new code is minted', async () => {
    // Otherwise "resend" is a free reset of the guess budget: burn five, ask
    // for another code, burn five more, indefinitely.
    const { service, prisma } = make({
      id: 'u1',
      emailVerifiedAt: null,
      accountClosedAt: null,
    });
    await service.sendEmailCode('a@b.com');
    expect(prisma.updates[0]).toMatchObject({ emailOtpAttempts: 0 });
  });

  it('lower-cases the address before looking it up', async () => {
    const { service, prisma } = make({
      id: 'u1',
      emailVerifiedAt: null,
      accountClosedAt: null,
    });
    await service.sendEmailCode('  MiXeD@Example.COM  ');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'mixed@example.com' } }),
    );
  });

  // ⚠️ THE ANTI-ENUMERATION RULE. The resend endpoint is unauthenticated and
  // takes any address, so a different answer for "no such account" turns it
  // into a membership oracle for a firearms marketplace.
  it.each([
    ['an unknown address', null],
    [
      'an already-verified address',
      { id: 'u1', emailVerifiedAt: new Date(), accountClosedAt: null },
    ],
    [
      'a closed account',
      { id: 'u1', emailVerifiedAt: null, accountClosedAt: new Date() },
    ],
  ])('is silent, and sends nothing, for %s', async (_label, row) => {
    const { service, prisma, notif } = make(row as Row);
    await expect(service.sendEmailCode('a@b.com')).resolves.toBeUndefined();
    expect(notif.emailVerificationCode).not.toHaveBeenCalled();
    expect(prisma.updates).toHaveLength(0);
  });

  it('keeps the hash when the send throws', async () => {
    // A send that failed at the provider may still have been delivered.
    // Clearing the hash would refuse a code the member is holding.
    const { service, prisma } = make(
      { id: 'u1', emailVerifiedAt: null, accountClosedAt: null },
      { emailVerificationCode: jest.fn().mockRejectedValue(new Error('smtp')) },
    );
    await expect(service.sendEmailCode('a@b.com')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.updates).toHaveLength(1);
    expect(prisma.updates[0]).toHaveProperty('emailOtpHash');
  });
});

describe('sendEmailCode — the unconfigured-mail fallback', () => {
  const OLD = process.env.RESEND_API_KEY;
  const OLD_ENV = process.env.NODE_ENV;
  afterAll(() => {
    if (OLD === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = OLD;
    process.env.NODE_ENV = OLD_ENV;
  });

  it('prints the code instead of sending, when mail is unconfigured in dev', async () => {
    // Without this nobody can complete a sign-up on a fresh clone.
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'test';
    const { service, notif } = make({
      id: 'u1',
      emailVerifiedAt: null,
      accountClosedAt: null,
    });
    await service.sendEmailCode('dev@example.test');
    expect(notif.emailVerificationCode).not.toHaveBeenCalled();
    expect(service.devEmailCode('dev@example.test')).toMatch(/^\d{6}$/);
  });

  // ⚠️ THE HALF THAT MATTERS. A production box missing the mail credential
  // must fail the sign-up loudly, not log every new member's code.
  it('NEVER falls back in production', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'production';
    const { service, notif } = make(
      { id: 'u1', emailVerifiedAt: null, accountClosedAt: null },
      {
        emailVerificationCode: jest
          .fn()
          .mockRejectedValue(new Error('RESEND_API_KEY is not set')),
      },
    );
    await expect(service.sendEmailCode('a@b.com')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(notif.emailVerificationCode).toHaveBeenCalled();
    expect(service.devEmailCode('a@b.com')).toBeUndefined();
  });
});

describe('verifyEmail', () => {
  const meta = { userAgent: 'jest', ip: '127.0.0.1' };
  const CODE = '123456';

  function pending(over: Record<string, unknown> = {}) {
    return {
      id: 'u1',
      emailVerifiedAt: null,
      accountClosedAt: null,
      emailOtpHash: sha256(CODE),
      emailOtpExpiresAt: future(),
      emailOtpAttempts: 0,
      ...over,
    };
  }

  it('accepts the right code and stamps the address verified', async () => {
    const { service, prisma } = make(pending());
    await service.verifyEmail('a@b.com', CODE, meta);
    expect(prisma.updates[0]).toMatchObject({
      emailVerifiedAt: expect.any(Date),
    });
  });

  it('spends the code on success', async () => {
    // Leaving it live would let the same six digits re-verify later.
    const { service, prisma } = make(pending());
    await service.verifyEmail('a@b.com', CODE, meta);
    expect(prisma.updates[0]).toMatchObject({
      emailOtpHash: null,
      emailOtpExpiresAt: null,
      emailOtpAttempts: 0,
    });
  });

  it('tolerates whitespace around the typed code', async () => {
    const { service } = make(pending());
    await expect(
      service.verifyEmail('a@b.com', `  ${CODE} `, meta),
    ).resolves.toBeDefined();
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const { service, prisma } = make(pending());
    await expect(
      service.verifyEmail('a@b.com', '999999', meta),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.updates[0]).toMatchObject({
      emailOtpAttempts: { increment: 1 },
    });
  });

  it('refuses an expired code and clears it', async () => {
    const { service, prisma } = make(pending({ emailOtpExpiresAt: past() }));
    await expect(
      service.verifyEmail('a@b.com', CODE, meta),
    ).rejects.toThrow(/expired/i);
    expect(prisma.updates[0]).toMatchObject({ emailOtpHash: null });
  });

  it('refuses when no code is outstanding', async () => {
    const { service } = make(
      pending({ emailOtpHash: null, emailOtpExpiresAt: null }),
    );
    await expect(service.verifyEmail('a@b.com', CODE, meta)).rejects.toThrow(
      /no code waiting/i,
    );
  });

  // ⚠️ THE CAP IS THE WHOLE SECURITY ARGUMENT FOR SIX DIGITS.
  it('refuses once the attempt cap is reached, even with the RIGHT code', async () => {
    const { service } = make(pending({ emailOtpAttempts: 5 }));
    await expect(service.verifyEmail('a@b.com', CODE, meta)).rejects.toThrow(
      /too many/i,
    );
  });

  it('discards the code when the cap trips, so it cannot be ground down', async () => {
    const { service, prisma } = make(pending({ emailOtpAttempts: 5 }));
    await service.verifyEmail('a@b.com', CODE, meta).catch(() => undefined);
    expect(prisma.updates[0]).toMatchObject({
      emailOtpHash: null,
      emailOtpExpiresAt: null,
    });
  });

  it('checks the cap BEFORE comparing', async () => {
    // Counting after comparing hands the attacker one free guess past the
    // limit on every code.
    const { service, prisma } = make(pending({ emailOtpAttempts: 5 }));
    await service.verifyEmail('a@b.com', '999999', meta).catch(() => undefined);
    expect(prisma.updates[0]).not.toMatchObject({
      emailOtpAttempts: { increment: 1 },
    });
  });

  it('rejects an unknown or closed account outright', async () => {
    for (const row of [
      null,
      { ...pending(), accountClosedAt: new Date() },
    ] as Row[]) {
      const { service } = make(row);
      await expect(
        service.verifyEmail('a@b.com', CODE, meta),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('is a no-op on an already-verified address, and issues a session', async () => {
    // Re-submitting a code after a double tap must not fail the member.
    const { service, prisma } = make(
      pending({ emailVerifiedAt: new Date(), emailOtpHash: null }),
    );
    await expect(
      service.verifyEmail('a@b.com', CODE, meta),
    ).resolves.toBeDefined();
    expect(prisma.updates).toHaveLength(0);
  });
});
