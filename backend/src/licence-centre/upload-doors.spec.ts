import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_INTERCEPTOR_MAX,
  UPLOAD_MIME,
} from './upload-limits';

// ────────────────────────────────────────────────────────────────────
// EVERY DOOR INTO THE CENTRE MUST BEHAVE THE SAME.
//
// Operator, 2026-08-28: "make sure the phone uploads with QR code, the web/PWA
// scan and uploads doe the same job with the OCR and the documents behave the
// same for all off them when it reaches the server."
//
// They do. The web/PWA camera is not a separate path at the network layer —
// DocumentScanner's contract is `onDone: (files: File[])`, so it hands back the
// same File objects a picker produces and the caller posts them to the same
// endpoint. That leaves two controllers, and they exist separately only because
// LicenceCentreController carries @UseGuards(ClerkGuard) at CLASS level, so a
// phone holding only a scan token would be 401'd before its token was read.
//
// These tests read the controller SOURCE rather than instantiating Nest. What
// is being pinned is not runtime behaviour — that is identical the moment both
// call the same service method — but the DECLARATIONS around it, which is where
// a divergence would actually be introduced by somebody editing one file.
// ────────────────────────────────────────────────────────────────────

const here = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const desk = here('licence-centre.controller.ts');
const phone = here('licence-centre-scan.controller.ts');

describe('the desk and the phone accept exactly the same files', () => {
  it('neither controller declares its own limits any more', () => {
    // ⚠️ THE ACTUAL FAULT THIS FIXES. Both files used to declare
    // UPLOAD_MAX_BYTES, UPLOAD_INTERCEPTOR_MAX and UPLOAD_MIME themselves,
    // with equal values — equal today and silently divergent the first time
    // somebody raised one. The failure would be invisible from the desk: the
    // desktop path would go on accepting a file the phone had just refused.
    for (const [name, src] of [
      ['desk', desk],
      ['phone', phone],
    ] as const) {
      expect(`${name}:${/const UPLOAD_MAX_BYTES\s*=/.test(src)}`).toBe(
        `${name}:false`,
      );
      expect(`${name}:${/const UPLOAD_MIME\s*=/.test(src)}`).toBe(
        `${name}:false`,
      );
    }
  });

  it('both import the shared limits', () => {
    for (const src of [desk, phone]) {
      expect(src).toMatch(/from '\.\/upload-limits'/);
      expect(src).toContain('UPLOAD_MAX_BYTES');
      expect(src).toContain('UPLOAD_INTERCEPTOR_MAX');
      expect(src).toContain('UPLOAD_MIME');
    }
  });

  it('both hand the file to the SAME service method', () => {
    // If these ever stop matching, the two doors have started doing different
    // work — which is the thing the operator asked to be sure of. The OCR, the
    // classification and the encrypted row all live behind this one call, and
    // it takes no argument saying which door was used.
    for (const src of [desk, phone]) {
      expect(src).toMatch(/this\.svc\.create\(\s*clerkId,/);
    }
  });

  it('neither door stamps confirmedAt', () => {
    // The service's own rule: "NOTHING HERE STAMPS confirmedAt EXCEPT
    // confirmExpiry." Extraction proposes, the member confirms, only then can
    // a reminder fire. Every upload from every door lands UNCONFIRMED, and a
    // controller that shortcut that would arm reminders on a date nobody read.
    for (const src of [desk, phone]) {
      expect(src).not.toContain('confirmedAt');
    }
  });

  it('the shared values are the ones we think they are', () => {
    expect(UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(UPLOAD_INTERCEPTOR_MAX).toBeGreaterThan(UPLOAD_MAX_BYTES);
    expect(UPLOAD_MIME.test('image/jpeg')).toBe(true);
    expect(UPLOAD_MIME.test('application/pdf')).toBe(true);
    // Reverted platform-wide after full-resolution iPhone HEICs produced 413s.
    expect(UPLOAD_MIME.test('image/heic')).toBe(false);
  });
});
