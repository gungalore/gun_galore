import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PASSWORD_MIN,
  PASSWORD_MAX,
  PASSWORD_HINT,
  PASSWORD_RULES,
  passwordProblem,
  passwordOk,
} from './password-rule';

describe('password rule', () => {
  it('accepts the shortest password that satisfies every rule', () => {
    expect(passwordOk('abcd1!')).toBe(true);
    expect(passwordProblem('abcd1!')).toBeNull();
  });

  it('says nothing about an empty password', () => {
    // `required` covers the empty submit. Scolding someone for not having
    // typed yet is noise, and it fires on every first render.
    expect(passwordProblem('')).toBeNull();
    expect(passwordOk('')).toBe(false);
  });

  it('names every unmet requirement at once, not the first one', () => {
    // Being sent back three times for one more rule each time is how a
    // sign-up gets abandoned.
    expect(passwordProblem('abc')).toBe(
      'Needs 6 characters, a number and a special character.',
    );
    expect(passwordProblem('abcdef')).toBe(
      'Needs a number and a special character.',
    );
    expect(passwordProblem('abcdef1')).toBe('Needs a special character.');
    expect(passwordProblem('abcdef!')).toBe('Needs a number.');
  });

  it('refuses a password longer than the maximum', () => {
    expect(passwordProblem('a1!'.repeat(200))).toBe(
      `Use ${PASSWORD_MAX} characters or fewer.`,
    );
  });

  // ⚠️ THE WHOLE POINT OF THE \s IN THE SPECIAL-CHARACTER CLASS.
  it('does not let whitespace be the special character', () => {
    expect(passwordOk('abcd1 ')).toBe(false);
    expect(passwordProblem('abcd1 ')).toBe('Needs a special character.');
    expect(passwordOk('abc\td1')).toBe(false);
  });

  it('still allows whitespace inside an otherwise valid password', () => {
    // A passphrase is a good password. The rule constrains what COUNTS, not
    // what is permitted.
    expect(passwordOk('two words 1!')).toBe(true);
  });

  it('reports each rule independently', () => {
    const check = (p: string) => PASSWORD_RULES.map((r) => r.ok(p));
    expect(check('')).toEqual([false, false, false]);
    expect(check('abcdef')).toEqual([true, false, false]);
    expect(check('1!')).toEqual([false, true, true]);
    expect(check('abcd1!')).toEqual([true, true, true]);
  });

  it('states the real minimum in the hint', () => {
    // The hint is what most members read; a stale number here is a rule the
    // form teaches wrongly.
    expect(PASSWORD_HINT).toContain(String(PASSWORD_MIN));
    expect(PASSWORD_HINT).toMatch(/number/i);
    expect(PASSWORD_HINT).toMatch(/special character/i);
  });
});

/**
 * ⚠️ THIS IS THE TEST THE OTHERS EXIST FOR.
 *
 * The backend cannot import this file, so the rule is written twice. Drift
 * between the two copies is silent and lands on the member: the form accepts
 * a password, the API answers 400 on the last click of a sign-up, and the
 * error names a rule the screen never showed. Comparing the source text is
 * ugly, and it is the only thing that actually catches it.
 */
describe('agreement with the backend DTO', () => {
  const dto = fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'src', 'auth', 'dto', 'auth.dto.ts'),
    'utf8',
  );

  it('reads the backend copy at all', () => {
    // If this fails the file moved, and every assertion below would have
    // passed vacuously on an empty string.
    expect(dto).toContain('PASSWORD_MIN');
  });

  it('uses the same minimum and maximum', () => {
    expect(dto).toMatch(
      new RegExp(`export const PASSWORD_MIN = ${PASSWORD_MIN};`),
    );
    expect(dto).toMatch(
      new RegExp(`export const PASSWORD_MAX = ${PASSWORD_MAX};`),
    );
  });

  it('uses the same two regexes, character for character', () => {
    expect(dto).toContain('export const PASSWORD_DIGIT_RE = /[0-9]/;');
    expect(dto).toContain(
      'export const PASSWORD_SPECIAL_RE = /[^A-Za-z0-9\\s]/;',
    );
  });

  it('applies the rule to every field that SETS a password', () => {
    // register, reset, change — three. Miss one and the rule is enforced on
    // two screens out of three.
    const applied = dto.match(/@IsMemberPassword\(\)/g) ?? [];
    expect(applied).toHaveLength(3);
  });

  it('never applies the rule to sign-in', () => {
    // A member whose password predates a rule change must still be able to
    // sign in. Sign-in fails on the hash, never on validation.
    const loginDto = dto.slice(
      dto.indexOf('export class LoginDto'),
      dto.indexOf('export class ForgotPasswordDto'),
    );
    expect(loginDto).not.toContain('@IsMemberPassword');
    expect(loginDto).not.toContain('MinLength(PASSWORD_MIN');
  });
});
