import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE PHONE CODE IS SIX DIGITS, AND THE SCREEN THAT TAKES IT MUST SAY SIX.
 *
 * ⚠️ THIS SHIPPED BROKEN AND NOTHING CAUGHT IT. `users.service.ts` has minted a
 * PHONE_CODE_LENGTH = 6 code since the OTPs came back in-house, while
 * `/profile/edit` asked for four — label, maxLength, the slice in onChange, and
 * the Verify button's enable test, all four saying 4.
 *
 * The failure was worse than a refusal. maxLength and the slice TRUNCATE, so a
 * member typing the six digits they were sent ends up holding the first four;
 * `otp.length !== 4` then goes false and ENABLES Verify on that truncated
 * value. So the screen looked ready, submitted a code that could never match,
 * and consumed an attempt. No phone number could be verified from that screen,
 * ever, and the member had no way to tell why.
 *
 * ⚠️ THE SPEC READS THE BACKEND CONSTANT RATHER THAN HARD-CODING 6. The bug was
 * two files disagreeing; a test that asserts "the page says 6" would go green
 * the moment somebody changed the minting length and left the page behind —
 * which is the same defect again with different digits. The backend is the
 * source of truth because it is what SMSPortal actually delivers.
 *
 * ⚠️ IT IS A .spec.ts UNDER lib/, WHICH IS COLLECTED. vitest.config.ts includes
 * `lib/**\/*.spec.ts` and `components/**\/*.spec.tsx`. Nothing under app/ is
 * collected at all — which is precisely why a defect sitting in app/ for this
 * long had no test standing over it. A spec for an app/ screen has to live
 * here and read the source.
 */

const PAGE = readFileSync(new URL('../app/profile/edit/page.tsx', import.meta.url), 'utf8');
const SERVICE = readFileSync(
  new URL('../../backend/src/users/users.service.ts', import.meta.url),
  'utf8',
);

/** The length the server actually mints and sends by SMS. */
function backendPhoneCodeLength(): number {
  const m = /const PHONE_CODE_LENGTH = (\d+)/.exec(SERVICE);
  expect(
    m,
    'backend/src/users/users.service.ts no longer declares PHONE_CODE_LENGTH. ' +
      'If the phone code moved, move this spec with it — do not delete it and ' +
      'leave the screen unpinned.',
  ).not.toBeNull();
  return Number(m![1]);
}

/**
 * The phone-verification block in the profile page.
 *
 * ⚠️ WINDOWED, NOT WHOLE-FILE. The same page has a SECOND code entry — the
 * email-change confirmation around line 1047, which is independently 6 — plus a
 * six-digit bank branch code with its own `slice(0, 6)`. A file-wide count
 * would pass on those while the phone block stayed at 4.
 */
function phoneBlock(): string {
  const at = PAGE.indexOf('digit code we sent to');
  expect(
    at,
    'the phone-verification copy moved. Re-anchor this spec rather than removing it.',
  ).toBeGreaterThan(-1);
  const start = PAGE.lastIndexOf('<p', at);
  const end = PAGE.indexOf('Wrong number?', at);
  expect(end, 'the phone block no longer ends at the "Wrong number?" button').toBeGreaterThan(at);
  return PAGE.slice(start, end);
}

describe('the phone OTP screen agrees with the code the server sends', () => {
  const n = backendPhoneCodeLength();
  const block = phoneBlock();

  it('tells the member the right number of digits', () => {
    expect(block, `the copy must say ${n}-digit`).toContain(`${n}-digit code we sent to`);
  });

  it('lets all of the digits be typed', () => {
    const max = /maxLength=\{(\d+)\}/.exec(block);
    expect(max, 'the phone code input declares no maxLength').not.toBeNull();
    expect(
      Number(max![1]),
      `maxLength is ${max?.[1]} against a ${n}-digit code. Short, it TRUNCATES — ` +
        'the member holds a prefix that can never match.',
    ).toBe(n);
  });

  it('does not truncate in onChange either', () => {
    const slice = /slice\(0, (\d+)\)/.exec(block);
    expect(slice, 'the onChange no longer slices — if the guard moved, re-point this').not.toBeNull();
    expect(Number(slice![1]), 'the onChange slice must keep the whole code').toBe(n);
  });

  it('only enables Verify on a complete code', () => {
    const gate = /otp\.length !== (\d+)/.exec(block);
    expect(gate, 'the Verify button no longer gates on otp.length').not.toBeNull();
    expect(
      Number(gate![1]),
      `Verify enables at ${gate?.[1]} digits against a ${n}-digit code. This is the ` +
        'half that turns a refusal into a wasted attempt: it submits a code that ' +
        'cannot match while looking ready.',
    ).toBe(n);
  });
});
