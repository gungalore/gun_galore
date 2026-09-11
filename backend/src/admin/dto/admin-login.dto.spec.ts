// class-validator/class-transformer decorators need the metadata polyfill.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminLoginDto } from './admin-login.dto';
import { base32Decode, totp, verifyTotpStep } from '../totp';

/**
 * AdminLoginDto is deliberately LOOSE on `totpCode`, and its docblock says why:
 * the DTO cannot reject a missing or oddly-shaped code without breaking the
 * two-step sign-in, so the real shape check happens further in. These tests pin
 * both halves of that hand-off, because it is stated in a comment and a comment
 * cannot fail.
 *
 * ⚠️ THE DOCBLOCK NAMED verifyTotpCode(), AND IT WAS RIGHT WHEN IT WAS
 * WRITTEN — THEN IT ROTTED. login() really did call the wrapper, from the
 * commit that shipped admin TOTP until the replay fix moved it onto
 * verifyTotpStep(). That history is the whole reason the source-text test at
 * the bottom of this file exists: the reversion it guards against is not a
 * hypothetical, it is a return to code that shipped, passed every test, and
 * read perfectly well.
 *
 * Why the wrapper must never come back to the sign-in path: it returns a
 * boolean, and a boolean cannot distinguish a first presentation of a code
 * from a replay of it. That distinction is the only thing standing between a
 * shoulder-surfed six digits and a second, independent thirty-day admin
 * session. Anyone who "simplifies" login back onto the wrapper deletes replay
 * protection and watches every other test stay green.
 */
describe('AdminLoginDto', () => {
  const credentials = {
    email: 'ops@alloutdoor.co.za',
    password: 'a-real-password',
  };

  it('accepts a sign-in carrying no totpCode at all', async () => {
    // The first request of a two-step sign-in. The service answers it with
    // `code: 'TOTP_REQUIRED'`; a 400 from class-validator here is a response
    // the Desk login page has no branch for.
    const dto = plainToInstance(AdminLoginDto, credentials);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a recoveryCode in place of a totpCode', async () => {
    const dto = plainToInstance(AdminLoginDto, {
      ...credentials,
      recoveryCode: 'abcd-efgh-ijkl',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  // ── The hand-off the docblock describes ──────────────────────────────────

  /**
   * Every one of these is a shape a confused operator or a mis-configured
   * authenticator really produces, and every one is let through by the DTO on
   * purpose. The DTO's job is to keep the conversation interpretable; saying
   * "no" to the code itself belongs to verifyTotpStep.
   */
  const LOOSE_BUT_ACCEPTED: ReadonlyArray<readonly [string, string]> = [
    ['spaces, as most authenticator apps display it', '123 456'],
    ['an 8-digit code from an app set to the wrong digit count', '12345678'],
    ['five digits — a dropped keystroke', '12345'],
    ['letters', 'abcdef'],
    ['empty', ''],
    ['surrounding whitespace from a paste', '  123456  '],
  ];

  it.each(LOOSE_BUT_ACCEPTED.map(([label, code]) => [label, code]))(
    'passes DTO validation with %s, rather than becoming a 400',
    async (_label: string, totpCode: string) => {
      const dto = plainToInstance(AdminLoginDto, { ...credentials, totpCode });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it('rejects a totpCode long enough to be a payload rather than a typo', async () => {
    const dto = plainToInstance(AdminLoginDto, {
      ...credentials,
      totpCode: '1'.repeat(21),
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['totpCode']);
  });

  // A valid base32 secret, so the only thing under test is the code.
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  /**
   * The shapes that can never be a TOTP code, whatever the clock says: after
   * whitespace is stripped they are not exactly six digits. These are the ones
   * the DTO waves through and verifyTotpStep must refuse.
   *
   * `'123 456'` and `'  123456  '` are deliberately NOT in this list — they
   * strip to a well-formed six-digit code, so whether they verify depends on
   * the clock, and asserting null on them would be a test that fails about
   * three times in a million runs. They are pinned below as a stripping rule
   * instead, which is the thing actually worth pinning about them.
   */
  const CANNOT_BE_A_CODE: ReadonlyArray<readonly [string, string]> = [
    ['an 8-digit code', '12345678'],
    ['five digits', '12345'],
    ['letters', 'abcdef'],
    ['empty', ''],
  ];

  it.each(CANNOT_BE_A_CODE.map(([label, code]) => [label, code]))(
    'verifyTotpStep answers null — never a throw — for %s',
    (_label: string, totpCode: string) => {
      // A thrown 500 on a typed code tells an attacker they found an
      // interesting input; the contract is "let them in or don't".
      expect(() => verifyTotpStep(SECRET, totpCode)).not.toThrow();
      expect(verifyTotpStep(SECRET, totpCode)).toBeNull();
    },
  );

  it('verifyTotpStep strips the whitespace the DTO let through', () => {
    // ⚠️ THE CODE IS MINTED, NOT TYPED, AND THAT IS THE WHOLE TEST. Written
    // against a hard-coded '123456' this asserted that three spellings agree —
    // and at any fixed instant they agree by all being NULL, so deleting the
    // strip from verifyTotpStep left it green. A test that passes on the bug
    // it names is worse than no test: it is a claim the regression cannot
    // happen. Minting the code for this instant makes the bare form
    // non-null, so the spaced forms have something real to match.
    //
    // This matters because the DTO deliberately lets whitespace through:
    // authenticator apps display "123 456", and people paste what they see.
    const now = Date.UTC(2026, 8, 11, 12, 0, 0);
    const code = totp(base32Decode(SECRET), now);

    const bare = verifyTotpStep(SECRET, code, { now });
    expect(bare).not.toBeNull();
    expect(verifyTotpStep(SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { now })).toBe(bare);
    expect(verifyTotpStep(SECRET, `  ${code}  `, { now })).toBe(bare);
  });

  it('verifyTotpStep answers null on a malformed secret instead of throwing', () => {
    expect(() => verifyTotpStep('not base32 !!', '123456')).not.toThrow();
    expect(verifyTotpStep('not base32 !!', '123456')).toBeNull();
  });

  // ── The rule the corrected docblock exists to state ──────────────────────

  /**
   * ⚠️ THE SIGN-IN PATH MAY NOT USE verifyTotpCode(). The wrapper is exactly
   * `verifyTotpStep(...) !== null`; the step it discards is what
   * spendTotpStep() burns into AdminUser.totpLastUsedStep, and burning it is
   * what RFC 6238 §5.2 requires and what makes a code single-use. Swapping the
   * wrapper in compiles, keeps every other test green, and quietly makes a
   * stolen code good for the whole ±1-step window, as often as somebody can
   * type it.
   *
   * Asserted against the source text rather than by mocking, because the defect
   * being pinned is "somebody imported the convenient one" — which a
   * behavioural test of login cannot see, since the wrapper returns the right
   * boolean for a first presentation and only the SECOND one differs.
   */
  it('AdminAuthService reaches for verifyTotpStep and never the wrapper', () => {
    const source = readFileSync(
      join(__dirname, '..', 'admin-auth.service.ts'),
      'utf8',
    );
    expect(source).toContain('verifyTotpStep');
    expect(source).not.toMatch(/\bverifyTotpCode\b/);
    // And the step is spent, not merely computed and compared against null.
    expect(source).toContain('spendTotpStep');
  });
});
