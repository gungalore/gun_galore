import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { UsersService } from './users.service';

/**
 * The phone verification code, in-house again over SMSPortal (2026-09-11).
 *
 * ⚠️ SAME ARGUMENT AS THE EMAIL CODE. Six digits is a million combinations,
 * which is nothing to a script. The attempt cap, the expiry and the
 * single-use discard are the control; the length is not. Each is asserted
 * here rather than inferred from the happy path.
 */

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const CODE = '481502';
const future = () => new Date(Date.now() + 5 * 60_000);
const past = () => new Date(Date.now() - 1_000);

function build(row: Record<string, unknown> | null, smsOver = {}) {
  const updates: Record<string, unknown>[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(row),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn((a: { data: Record<string, unknown> }) => {
        updates.push(a.data);
        return Promise.resolve({});
      }),
    },
  };
  const sms = {
    toE164: jest.fn((v: string) =>
      v.startsWith('+') ? v : `+27${v.replace(/^0/, '')}`,
    ),
    sendSms: jest.fn().mockResolvedValue({ success: true }),
    ...smsOver,
  };
  const svc = Object.create(UsersService.prototype) as UsersService;
  Object.assign(svc, { prisma, sms });
  return { svc, prisma, sms, updates };
}

function pending(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    phone: '+27821234567',
    phoneVerified: false,
    phoneOtpHash: sha256(CODE),
    phoneOtpExpiresAt: future(),
    phoneOtpAttempts: 0,
    ...over,
  };
}

describe('requesting a phone code', () => {
  it('stores the code hashed and sends the plaintext only in the SMS', async () => {
    const { svc, sms, updates } = build({ id: 'u1', phone: null });
    await svc.requestPhoneChange('u1', '0821234567');

    const body = sms.sendSms.mock.calls[0][0] as { message: string };
    const code = body.message.match(/\b(\d{6})\b/)![1];
    const written = updates[0] as { phoneOtpHash: string };
    expect(written.phoneOtpHash).toBe(sha256(code));
    expect(JSON.stringify(written)).not.toContain(code);
  });

  it('normalises to E.164 before storing or sending', async () => {
    const { svc, sms, updates } = build({ id: 'u1', phone: null });
    await svc.requestPhoneChange('u1', '0821234567');
    expect(updates[0]).toMatchObject({ phone: '+27821234567' });
    expect((sms.sendSms.mock.calls[0][0] as { to: string }).to).toBe(
      '+27821234567',
    );
  });

  it('resets the attempt counter, so a resend is not a free budget reset', async () => {
    const { svc, updates } = build({ id: 'u1', phone: null });
    await svc.requestPhoneChange('u1', '0821234567');
    expect(updates[0]).toMatchObject({ phoneOtpAttempts: 0, phoneVerified: false });
  });

  // ⚠️ The prefix is what tells SmsService never to auto-retry this message.
  // A code redelivered twenty minutes later is expired and billed twice.
  it('tags the send so the retry cron leaves it alone', async () => {
    const { svc, sms } = build({ id: 'u1', phone: null });
    await svc.requestPhoneChange('u1', '0821234567');
    expect((sms.sendSms.mock.calls[0][0] as { reference: string }).reference).toBe(
      'phone-change-u1',
    );
  });

  it('writes the hash BEFORE sending', async () => {
    // A member reading a fast SMS must not beat the database write and be
    // told their correct code is wrong.
    const order: string[] = [];
    const { svc } = build({ id: 'u1', phone: null }, {
      sendSms: jest.fn(() => {
        order.push('send');
        return Promise.resolve({ success: true });
      }),
    });
    (svc as unknown as { prisma: { user: { update: jest.Mock } } }).prisma.user.update =
      jest.fn(() => {
        order.push('persist');
        return Promise.resolve({});
      });
    await svc.requestPhoneChange('u1', '0821234567');
    expect(order).toEqual(['persist', 'send']);
  });

  it('refuses a number that will not normalise', async () => {
    const { svc } = build({ id: 'u1', phone: null }, {
      toE164: jest.fn(() => null),
    });
    await expect(
      svc.requestPhoneChange('u1', 'not-a-number'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a failed send as a send problem, not a bad number', async () => {
    // Telling somebody their valid number is wrong makes them change a
    // correct answer.
    const { svc } = build({ id: 'u1', phone: null }, {
      sendSms: jest.fn().mockResolvedValue({ success: false }),
    });
    await expect(
      svc.requestPhoneChange('u1', '0821234567'),
    ).rejects.toThrow(/could not send/i);
  });
});

describe('checking a phone code', () => {
  it('accepts the right code, flips phoneVerified and spends the code', async () => {
    const { svc, updates } = build(pending());
    await expect(svc.verifyPhoneChange('u1', CODE)).resolves.toEqual({
      verified: true,
    });
    expect(updates[0]).toMatchObject({
      phoneVerified: true,
      phoneOtpHash: null,
      phoneOtpExpiresAt: null,
      phoneOtpAttempts: 0,
    });
  });

  it('rejects a wrong code and counts it', async () => {
    const { svc, updates } = build(pending());
    await expect(svc.verifyPhoneChange('u1', '000000')).rejects.toThrow(
      /doesn't match/i,
    );
    expect(updates[0]).toMatchObject({ phoneOtpAttempts: { increment: 1 } });
  });

  it('refuses an expired code and clears it', async () => {
    const { svc, updates } = build(pending({ phoneOtpExpiresAt: past() }));
    await expect(svc.verifyPhoneChange('u1', CODE)).rejects.toThrow(
      /expired/i,
    );
    expect(updates[0]).toMatchObject({ phoneOtpHash: null });
  });

  it('refuses when nothing is pending', async () => {
    const { svc } = build(pending({ phoneOtpHash: null }));
    await expect(svc.verifyPhoneChange('u1', CODE)).rejects.toThrow(
      /no verification code is pending/i,
    );
  });

  // ⚠️ THE CAP IS THE WHOLE SECURITY ARGUMENT FOR SIX DIGITS.
  it('refuses past the cap even with the RIGHT code, and discards it', async () => {
    const { svc, updates } = build(pending({ phoneOtpAttempts: 5 }));
    await expect(svc.verifyPhoneChange('u1', CODE)).rejects.toThrow(
      /too many/i,
    );
    expect(updates[0]).toMatchObject({
      phoneOtpHash: null,
      phoneOtpExpiresAt: null,
    });
  });

  it('checks the cap BEFORE comparing', async () => {
    // Counting after comparing gives one free guess past the limit.
    const { svc, updates } = build(pending({ phoneOtpAttempts: 5 }));
    await svc.verifyPhoneChange('u1', '000000').catch(() => undefined);
    expect(updates[0]).not.toMatchObject({
      phoneOtpAttempts: { increment: 1 },
    });
  });

  it('rejects a malformed code without spending an attempt', async () => {
    // A fat-fingered letter is not a guess the member really made.
    const { svc, updates, prisma } = build(pending());
    await expect(svc.verifyPhoneChange('u1', 'abcdef')).rejects.toThrow(
      /digit code/i,
    );
    expect(updates).toHaveLength(0);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
