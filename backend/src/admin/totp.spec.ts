import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totp,
  verifyTotpCode,
  verifyTotpStep,
  TOTP_STEP_SECONDS,
} from './totp';
import { BRAND_NAME } from '../common/brand';

/**
 * This file is the reason the hand-rolled TOTP is allowed to exist.
 *
 * The published vectors are the only thing that can tell "my code is right"
 * from "my code and my test agree with each other and both differ from every
 * authenticator app on earth". If one of these fails, the implementation is
 * wrong — do not adjust the expectation.
 */

// RFC 4226 Appendix D and RFC 6238 Appendix B both use this ASCII secret.
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET = Buffer.from(RFC_SECRET_ASCII, 'ascii');

describe('base32 (RFC 4648)', () => {
  it('round-trips arbitrary bytes', () => {
    for (const sample of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const buf = Buffer.from(sample, 'ascii');
      expect(base32Decode(base32Encode(buf))).toEqual(buf);
    }
  });

  it('matches the RFC 4648 §10 vectors', () => {
    // Padding is omitted on encode, so compare against the vectors with '='
    // stripped. A decoder that cannot read them back is the real failure.
    expect(base32Encode(Buffer.from('foobar', 'ascii'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString('ascii')).toBe('foobar');
  });

  it('tolerates the spacing and case a human types', () => {
    expect(base32Decode('mzxw 6ytb oi').toString('ascii')).toBe('foobar');
    expect(base32Decode('MZXW6YTBOI======').toString('ascii')).toBe('foobar');
  });

  it('throws on a character that is not base32 rather than skipping it', () => {
    // ⚠️ Skipping it would decode to a DIFFERENT secret that enrols happily
    // and then never verifies — a silent lockout with nothing in any log.
    expect(() => base32Decode('MZXW6YTB0I')).toThrow(/base32/);
  });
});

describe('HOTP — RFC 4226 Appendix D test vectors', () => {
  const EXPECTED = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];

  EXPECTED.forEach((code, counter) => {
    it(`counter ${counter} → ${code}`, () => {
      expect(hotp(RFC_SECRET, counter)).toBe(code);
    });
  });
});

describe('TOTP — RFC 6238 Appendix B test vectors (SHA-1)', () => {
  // The published table is 8 digits; the 6-digit code every authenticator
  // shows is its last six characters, which is what this implementation
  // returns at TOTP_DIGITS = 6.
  const VECTORS: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  VECTORS.forEach(([seconds, eightDigits]) => {
    it(`T=${seconds} → ${eightDigits}`, () => {
      expect(totp(RFC_SECRET, seconds * 1000, TOTP_STEP_SECONDS, 8)).toBe(
        eightDigits,
      );
      expect(totp(RFC_SECRET, seconds * 1000)).toBe(eightDigits.slice(-6));
    });
  });

  it('T=20000000000 proves the counter is written as 64 bits', () => {
    // 20000000000 / 30 = 666_666_666, which still fits in 32 bits — but the
    // vector is here because a 4-byte counter buffer fails the RFC's own
    // 8-byte framing and this is the published row that catches it.
    expect(totp(RFC_SECRET, 20000000000 * 1000)).toBe('353130');
  });
});

describe('verifyTotpCode', () => {
  const secret = base32Encode(RFC_SECRET);
  // A moment mid-step, so ±1 step is unambiguous.
  const now = 1_111_111_111_000;

  it('accepts the code for the current step', () => {
    expect(verifyTotpCode(secret, totp(RFC_SECRET, now), { now })).toBe(true);
  });

  it('accepts one step either side — the operator phone clock drifts', () => {
    const back = totp(RFC_SECRET, now - TOTP_STEP_SECONDS * 1000);
    const forward = totp(RFC_SECRET, now + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotpCode(secret, back, { now })).toBe(true);
    expect(verifyTotpCode(secret, forward, { now })).toBe(true);
  });

  it('refuses two steps away', () => {
    const stale = totp(RFC_SECRET, now - 2 * TOTP_STEP_SECONDS * 1000);
    expect(verifyTotpCode(secret, stale, { now })).toBe(false);
  });

  it('refuses anything that is not six digits, without throwing', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5']) {
      expect(verifyTotpCode(secret, bad, { now })).toBe(false);
    }
  });

  it('tolerates the space an app puts in the middle of the code', () => {
    const code = totp(RFC_SECRET, now);
    expect(
      verifyTotpCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { now }),
    ).toBe(true);
  });

  it('returns false on a corrupt stored secret rather than throwing a 500', () => {
    // A thrown 500 on a typed code tells an attacker they found an
    // interesting input. "No" is the only answer this function may give.
    expect(verifyTotpCode('not base32 !!', '123456', { now })).toBe(false);
    expect(verifyTotpCode('', '123456', { now })).toBe(false);
  });

  it('refuses a valid code for a DIFFERENT secret', () => {
    const other = generateTotpSecret();
    expect(verifyTotpCode(other, totp(RFC_SECRET, now), { now })).toBe(false);
  });
});

describe('verifyTotpStep — the number that makes a code single-use', () => {
  const secret = base32Encode(RFC_SECRET);
  const now = 1_111_111_111_000;
  const stepOf = (atMs: number) => Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);

  it('names the step it matched, not just "yes"', () => {
    // ⚠️ THE CALLER CANNOT ENFORCE RFC 6238 §5.2 WITHOUT THIS NUMBER. A
    // boolean says a code is valid; it cannot say whether this is the first
    // time it has been presented, and the accepted window is three steps —
    // up to ninety seconds — wide. AdminUser.totpLastUsedStep is compared
    // against exactly this return value.
    expect(verifyTotpStep(secret, totp(RFC_SECRET, now), { now })).toBe(
      stepOf(now),
    );
  });

  it('names the PREVIOUS and NEXT step when the drift allowance is used', () => {
    const backAt = now - TOTP_STEP_SECONDS * 1000;
    const forwardAt = now + TOTP_STEP_SECONDS * 1000;
    expect(verifyTotpStep(secret, totp(RFC_SECRET, backAt), { now })).toBe(
      stepOf(backAt),
    );
    expect(verifyTotpStep(secret, totp(RFC_SECRET, forwardAt), { now })).toBe(
      stepOf(forwardAt),
    );
    // ⚠️ AND THE THREE ARE DISTINCT NUMBERS, which is the whole point:
    // spending the current step must also burn the previous one, because a
    // shoulder-surfer saw both codes on the same screen. `lt` in
    // AdminAuthService.spendTotpStep is what does that, and it needs three
    // different numbers to do it with.
    expect(stepOf(backAt)).toBe(stepOf(now) - 1);
    expect(stepOf(forwardAt)).toBe(stepOf(now) + 1);
  });

  it('returns null, never a step, on anything it refuses', () => {
    // A step of 0 is a real value (1 January 1970), so "falsy" is not the
    // same answer as "refused" — hence null rather than a sentinel number.
    expect(verifyTotpStep(secret, '000000', { now: 0 })).toBeNull();
    expect(verifyTotpStep(secret, 'abcdef', { now })).toBeNull();
    expect(verifyTotpStep('not base32 !!', '123456', { now })).toBeNull();
  });

  it('verifyTotpCode is exactly "did verifyTotpStep return a step"', () => {
    // Two implementations of one drift loop is how a code gets accepted by
    // one caller and refused by another.
    const code = totp(RFC_SECRET, now);
    expect(verifyTotpCode(secret, code, { now })).toBe(
      verifyTotpStep(secret, code, { now }) !== null,
    );
    expect(verifyTotpCode(secret, '000000', { now: 0 })).toBe(false);
  });
});

describe('generateTotpSecret', () => {
  it('is 160 bits of base32 and decodes to 20 bytes', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(seen.size).toBe(50);
  });
});

describe('otpauthUri', () => {
  it('carries the secret, and the label issuer matches the parameter', () => {
    const uri = otpauthUri({
      secret: 'JBSWY3DPEHPK3PXP',
      account: 'ops@alloutdoor.co.za',
      issuer: 'All Outdoor Desk',
    });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    const parsed = new URL(uri);
    expect(parsed.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1');
    expect(parsed.searchParams.get('digits')).toBe('6');
    expect(parsed.searchParams.get('period')).toBe('30');
    // ⚠️ The label's issuer prefix and issuer= must agree or some apps show
    // two entries for one account and the operator picks the wrong one.
    const issuerParam = parsed.searchParams.get('issuer') ?? '';
    expect(decodeURIComponent(uri.split('/totp/')[1].split(':')[0])).toBe(
      issuerParam,
    );
  });

  it('defaults the issuer from brand.ts, not from a literal', () => {
    // ⚠️ AN AUTHENTICATOR ENTRY IS WRITTEN ONCE AND WE CAN NEVER REWRITE IT.
    // CLAUDE.md: brand strings live in brand.ts, never hard-coded. A stale
    // name in an SMS is one embarrassing message; a stale name here sits
    // permanently in the app the operator opens to reach the only account
    // that can approve a command on the production box — the same failure as
    // create-admin.mjs printing a gungalore.co.za sign-in URL long after the
    // rebrand, where anybody following the output could not sign in and
    // nothing said why.
    const uri = otpauthUri({ secret: 'AAAA', account: 'ops@alloutdoor.co.za' });
    expect(new URL(uri).searchParams.get('issuer')).toBe(`${BRAND_NAME} Desk`);
  });

  it('escapes an account that contains a colon', () => {
    const uri = otpauthUri({ secret: 'AAAA', account: 'a:b@c.co.za' });
    expect(uri).toContain('a%3Ab%40c.co.za');
  });
});
