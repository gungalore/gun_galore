import { describe, it, expect } from 'vitest';
import { safeReturnPath, isSessionFreeKycLanding } from './kyc-return';

describe('isSessionFreeKycLanding', () => {
  it('accepts the SMS/QR token handoff', () => {
    expect(isSessionFreeKycLanding('/kyc/verify', new URLSearchParams('t=abc'))).toBe(
      true,
    );
  });

  it("accepts Didit's hosted-page return", () => {
    expect(
      isSessionFreeKycLanding(
        '/kyc/verify',
        new URLSearchParams('returned=1&status=Approved'),
      ),
    ).toBe(true);
  });

  // ⚠️ The auth-wall exemption is narrow on purpose: a bare pathname or any
  // other route must NOT be published by it.
  it('rejects the bare path and every other route', () => {
    expect(isSessionFreeKycLanding('/kyc/verify', new URLSearchParams(''))).toBe(
      false,
    );
    expect(isSessionFreeKycLanding('/kyc/verify/', new URLSearchParams('t=x'))).toBe(
      false,
    );
    expect(isSessionFreeKycLanding('/profile', new URLSearchParams('returned=1'))).toBe(
      false,
    );
    // Only the exact Didit marker counts.
    expect(
      isSessionFreeKycLanding('/kyc/verify', new URLSearchParams('returned=0')),
    ).toBe(false);
    expect(
      isSessionFreeKycLanding('/kyc/verify', new URLSearchParams('returned=')),
    ).toBe(false);
  });
});

describe('safeReturnPath', () => {
  it('accepts a same-origin relative path', () => {
    expect(safeReturnPath('/profile')).toBe('/profile');
    expect(safeReturnPath('/profile/edit?tab=id')).toBe(
      '/profile/edit?tab=id',
    );
  });

  // The value comes off a URL and feeds router.push — an unchecked one is an
  // open redirect aimed at a member who has just verified their identity.
  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeReturnPath('//evil.example')).toBeNull();
    expect(safeReturnPath('https://evil.example')).toBeNull();
    expect(safeReturnPath('http://evil.example')).toBeNull();
  });

  it('rejects empty and non-path values', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
    expect(safeReturnPath('profile')).toBeNull();
    expect(safeReturnPath('javascript:alert(1)')).toBeNull();
  });
});
