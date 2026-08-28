// The upload rules, in ONE place, for every door into the Licence Centre.
//
// Operator, 2026-08-28: "make sure the phone uploads with QR code, the web/PWA
// scan and uploads doe the same job with the OCR and the documents behave the
// same for all off them when it reaches the server."
//
// They do, and this file is what keeps it that way.
//
// ────────────────────────────────────────────────────────────────────
// THE THREE DOORS, AND WHY THEY ALREADY AGREE.
//
//   file picker  →  POST /licence-centre        (ClerkGuard)
//   camera scan  →  POST /licence-centre        (ClerkGuard)
//   phone by QR  →  POST /licence-centre/scan   (ScanHandoffGuard)
//
// The web/PWA camera is not a third path at the network layer: DocumentScanner
// is a pure capture component whose contract is `onDone: (files: File[])`, so
// it hands back the same File objects a file picker produces and the caller
// posts them to the same endpoint. Only the QR hand-off has its own controller,
// and only because LicenceCentreController carries @UseGuards(ClerkGuard) at
// CLASS level — a method-level guard runs in ADDITION to it, never instead, so
// a phone holding only a scan token would be 401'd before its token was ever
// looked at.
//
// Both controllers then call the SAME LicenceCentreService.create(clerkId,
// kind, title, file). It takes no argument saying which door was used and has
// no way to behave differently, so the OCR, the classification, the encryption
// and the stored row are identical by construction.
//
// ⚠️ WHAT DID NOT AGREE BY CONSTRUCTION WAS THIS: the size cap and the MIME
// allowlist were DECLARED TWICE, once per controller, with equal values. Equal
// today and silently divergent the first time somebody raises one of them —
// and the failure would be invisible from the desk, because the desktop path
// would keep accepting a file the phone had just rejected.
//
// ⚠️ ALSO IDENTICAL BY DESIGN, AND EASY TO BREAK: neither door stamps
// confirmedAt. The service's own rule is "NOTHING HERE STAMPS confirmedAt
// EXCEPT confirmExpiry" — extraction proposes, the member confirms, only then
// can a reminder fire. Every upload from every door therefore lands
// UNCONFIRMED, which is correct and must stay that way.

/** The largest file any door accepts. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * What multer is allowed to buffer before the validator runs.
 *
 * Deliberately ABOVE the real cap: multer aborts a stream that exceeds its own
 * limit with a generic error, and the member gets nothing useful. Letting a
 * slightly-too-big file through to the validator produces the real message
 * naming the real limit.
 */
export const UPLOAD_INTERCEPTOR_MAX = UPLOAD_MAX_BYTES + 512 * 1024;

/**
 * What a document may be. Photographs of paper, or a PDF of it.
 *
 * ⚠️ NO HEIC. It was accepted platform-wide and reverted after
 * full-resolution iPhone HEICs produced 413s at the proxy — which is exactly
 * the kind of hard-won rule that must not exist in two copies.
 */
export const UPLOAD_MIME = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

/** Requests per minute, per door. */
export const UPLOAD_THROTTLE = { limit: 60, ttl: 60_000 } as const;
