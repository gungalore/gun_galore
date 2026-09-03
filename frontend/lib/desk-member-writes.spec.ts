import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLOSE_MIN_REASON,
  KYC_STATUSES,
  SELLER_TIERS,
  USERNAME_MAX,
  USERNAME_MIN,
  closeMemberAccount,
  setKycStatusDirect,
  setSellerTier,
  setUsername,
  usernameIsUsable,
} from './desk-member';

// ────────────────────────────────────────────────────────────────────
// THE WRITES THE PER-ROW ACTIONS MENU USED TO CARRY.
//
// 🚨 I GUESSED BOTH ENUMS AND GOT BOTH WRONG. The first draft wrote
// SELLER_TIERS as NONE / INDIVIDUAL / BUSINESS / DEALER — only DEALER was
// real — and KYC_STATUSES as NOT_STARTED / PENDING / VERIFIED / REJECTED,
// missing NONE and UNDER_REVIEW. @IsEnum would have turned every wrong option
// into a 400, which is the loud failure mode, but a picker offering choices
// that can never work is a control lying about what it does.
//
// So this reads prisma/schema.prisma and compares. A list transcribed by hand
// stays right only until the next person adds a value.
// ────────────────────────────────────────────────────────────────────

function schemaEnum(name: string): string[] {
  const schema = readFileSync(
    join(process.cwd(), '..', 'backend', 'prisma', 'schema.prisma'),
    'utf8',
  );
  const start = schema.indexOf(`enum ${name} {`);
  expect(start, `enum ${name} not found in schema.prisma`).toBeGreaterThan(-1);
  const body = schema.slice(start, schema.indexOf('\n}', start));
  return body
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/\/\/[^\n]*/, '').trim())
    .filter((l) => /^[A-Z][A-Z_]*$/.test(l));
}

describe('🚨 the pickers offer exactly what the database accepts', () => {
  it('seller tiers match the SellerTier enum', () => {
    expect([...SELLER_TIERS].sort()).toEqual(schemaEnum('SellerTier').sort());
  });

  it('kyc statuses match the KycStatus enum', () => {
    expect([...KYC_STATUSES].sort()).toEqual(schemaEnum('KycStatus').sort());
  });

  it('includes UNDER_REVIEW, which a first pass truncated away', () => {
    // It is the Claude-vision inconclusive verdict, and payout gates check
    // `!== VERIFIED` — so it blocks a payout while looking like an ordinary
    // in-progress state. Leaving it off would have made the status an
    // operator most needs to move someone OUT of the only unselectable one.
    expect(KYC_STATUSES).toContain('UNDER_REVIEW');
  });

  it('does not offer NOT_STARTED, which does not exist', () => {
    expect(KYC_STATUSES as readonly string[]).not.toContain('NOT_STARTED');
    expect(SELLER_TIERS as readonly string[]).not.toContain('INDIVIDUAL');
  });
});

describe('the requests', () => {
  function stub() {
    const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{}',
    }));
    vi.stubGlobal('fetch', spy);
    return spy;
  }
  afterEach(() => vi.unstubAllGlobals());

  it('seller tier PATCHes only that field', async () => {
    const spy = stub();
    await setSellerTier('u1', 'TRUSTED');
    expect(spy.mock.calls[0][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ sellerTier: 'TRUSTED' });
  });

  it('kyc status PATCHes only that field', async () => {
    const spy = stub();
    await setKycStatusDirect('u1', 'VERIFIED');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ kycStatus: 'VERIFIED' });
  });

  it('a rename trims and sends only the username', async () => {
    const spy = stub();
    await setUsername('u1', '  newhandle  ');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ username: 'newhandle' });
  });

  it('close-account posts a trimmed reason to its own route', async () => {
    const spy = stub();
    await closeMemberAccount('u1', '  duplicate account  ');
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/users\/u1\/close-account$/);
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      reason: 'duplicate account',
    });
  });
});

describe('the username bounds mirror the DTO', () => {
  it('rejects too short and too long, measured after trimming', () => {
    expect(usernameIsUsable('ab')).toBe(false);
    expect(usernameIsUsable('  ab  ')).toBe(false);
    expect(usernameIsUsable('abc')).toBe(true);
    expect(usernameIsUsable('x'.repeat(USERNAME_MAX))).toBe(true);
    expect(usernameIsUsable('x'.repeat(USERNAME_MAX + 1))).toBe(false);
  });

  it('matches UpdateUserDto', () => {
    expect(USERNAME_MIN).toBe(3);
    expect(USERNAME_MAX).toBe(30);
    expect(CLOSE_MIN_REASON).toBe(5);
  });
});
