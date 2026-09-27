import {
  SAPS_INTERMEDIATE_SHA256,
  SECTIGO_OV_R36_PEM,
  encodeForm,
  extractCookie,
  intermediateFingerprint,
} from './saps-http';

describe('the Sectigo intermediate we supply for saps.gov.za', () => {
  it('is a certificate, and the one that was pinned when it was fetched', () => {
    expect(SECTIGO_OV_R36_PEM.startsWith('-----BEGIN CERTIFICATE-----')).toBe(
      true,
    );
    expect(intermediateFingerprint()).toBe(SAPS_INTERMEDIATE_SHA256);
  });
});

// ────────────────────────────────────────────────────────────────────
// The enquiry is a form POST, so the two things that can go wrong without
// anything throwing are the ENCODING and the COOKIE. Both are pure and
// both are tested here rather than discovered against saps.gov.za.
// ────────────────────────────────────────────────────────────────────

describe('encodeForm', () => {
  it('encodes a body the way an HTML form submits it', () => {
    expect(encodeForm({ fsref: 'C00000001', csrf_token: 'abc123' })).toBe(
      'fsref=C00000001&csrf_token=abc123',
    );
  });

  it('turns a space into + and escapes the reserved characters', () => {
    // A serial with a space or a slash in it is the ordinary case, and an
    // unescaped one arrives at SAPS mangled rather than rejected.
    expect(encodeForm({ fserial: 'ZA 000/0000' })).toBe(
      'fserial=ZA+000%2F0000',
    );
  });

  it('encodes an empty value as a bare key rather than dropping it', () => {
    expect(encodeForm({ fsref: 'A1', fserial: '' })).toBe('fsref=A1&fserial=');
  });
});

describe('extractCookie', () => {
  const NAME = 'csrf_token';
  const VALUE = 'a'.repeat(64);

  it('reads the value out of a single set-cookie header', () => {
    const headers = {
      'set-cookie': `${NAME}=${VALUE}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
    };
    expect(extractCookie(headers, NAME)).toBe(VALUE);
  });

  it('stops at the first semicolon, not at the end of the header', () => {
    // Swallowing the attributes turns the POST's cookie into a value SAPS
    // does not match, and the answer comes back as an empty table.
    const got = extractCookie(
      { 'set-cookie': `${NAME}=${VALUE}; Path=/; HttpOnly` },
      NAME,
    );
    expect(got).toBe(VALUE);
    expect(got).not.toContain('Path');
  });

  it('finds the cookie among several, in both header shapes', () => {
    const asArray = {
      'set-cookie': ['sessionid=xyz; Path=/', `${NAME}=${VALUE}; Path=/`],
    };
    expect(extractCookie(asArray, NAME)).toBe(VALUE);

    const asOneLine = {
      'set-cookie': `sessionid=xyz; Path=/, ${NAME}=${VALUE}; Path=/`,
    };
    expect(extractCookie(asOneLine, NAME)).toBe(VALUE);
  });

  it('does not match a different cookie that merely ends in the name', () => {
    // x_csrf_token contains csrf_token; a substring match sends the wrong
    // value and the failure looks like a SAPS problem.
    expect(extractCookie({ 'set-cookie': `x_${NAME}=nope` }, NAME)).toBeNull();
  });

  it('returns null when the header is absent or the value is empty', () => {
    expect(extractCookie({}, NAME)).toBeNull();
    expect(extractCookie({ 'set-cookie': `${NAME}=; Path=/` }, NAME)).toBeNull();
  });
});
