import { describe, it, expect } from 'vitest';
import { authErrorMessage } from './auth-error';

const FALLBACK = 'Something went wrong. Please try again.';

/** A stand-in for fetch's Response, with just the two things we read. */
function res(status: number, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (n: string) => headers[n] ?? null },
  };
}

describe('authErrorMessage', () => {
  // ⚠️ THE CASE THIS FILE EXISTS FOR. A member filled in the whole sign-up
  // form and got "ThrottlerException: Too Many Requests" in red.
  it('never shows the framework rate-limit string', () => {
    const out = authErrorMessage(
      res(429),
      { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
      FALLBACK,
    );
    expect(out).not.toMatch(/exception/i);
    expect(out).toBe('Too many attempts. Try again in a few minutes.');
  });

  it('says how long to wait when the server says', () => {
    expect(authErrorMessage(res(429, { 'Retry-After': '45' }), {}, FALLBACK)).toBe(
      'Too many attempts. Try again in a minute.',
    );
    expect(authErrorMessage(res(429, { 'Retry-After': '600' }), {}, FALLBACK)).toBe(
      'Too many attempts. Try again in about 10 minutes.',
    );
    expect(authErrorMessage(res(429, { 'Retry-After': '3600' }), {}, FALLBACK)).toBe(
      'Too many attempts. Try again in about an hour.',
    );
  });

  it('rounds the wait UP', () => {
    // 90s told as "1 minute" sends them back to a second refusal, which
    // reads as the site being broken rather than as them being early.
    expect(authErrorMessage(res(429, { 'Retry-After': '91' }), {}, FALLBACK)).toBe(
      'Too many attempts. Try again in about 2 minutes.',
    );
  });

  it('ignores a nonsense Retry-After instead of doing arithmetic on it', () => {
    for (const bad of ['', 'soon', '-5', '0']) {
      expect(
        authErrorMessage(res(429, { 'Retry-After': bad }), {}, FALLBACK),
      ).toBe('Too many attempts. Try again in a few minutes.');
    }
  });

  it('does not leak a server error', () => {
    expect(
      authErrorMessage(res(500), { message: 'Internal server error' }, FALLBACK),
    ).toBe('Something went wrong on our end. Please try again shortly.');
    expect(authErrorMessage(res(502), {}, FALLBACK)).toMatch(/on our end/);
  });

  it('passes OUR OWN messages through untouched', () => {
    // The whole point is filtering framework leakage, not flattening every
    // failure into one unhelpful sentence.
    expect(
      authErrorMessage(
        res(409),
        { message: 'That username is already taken.' },
        FALLBACK,
      ),
    ).toBe('That username is already taken.');
  });

  it('shows the first of a validation array', () => {
    expect(
      authErrorMessage(
        res(400),
        {
          message: [
            'Password must include at least one number',
            'Password must include at least one special character, such as ! ? # or @',
          ],
        },
        FALLBACK,
      ),
    ).toBe('Password must include at least one number');
  });

  it('falls back on a bare framework status word', () => {
    // A 400 with no useful body says "Bad Request", which tells a member
    // nothing about which of eight fields is wrong.
    for (const leak of ['Bad Request', 'Unauthorized', 'Forbidden']) {
      expect(authErrorMessage(res(400), { message: leak }, FALLBACK)).toBe(
        FALLBACK,
      );
    }
  });

  it('falls back on a missing, empty or malformed body', () => {
    expect(authErrorMessage(res(400), {}, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(res(400), null, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(res(400), { message: '   ' }, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(res(400), { message: [] }, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(res(400), 'not an object', FALLBACK)).toBe(FALLBACK);
  });

  it('works when the response has no headers at all', () => {
    // Some call sites hand in a plain object rather than a real Response.
    expect(authErrorMessage({ status: 429 }, {}, FALLBACK)).toMatch(
      /Too many attempts/,
    );
  });
});
