// ────────────────────────────────────────────────────────────────────
// COLOURS FOR THINGS DRAWN OVER THE CAMERA.
//
// ⚠️ THESE ARE DELIBERATELY NOT THEME TOKENS. DO NOT "TIDY" THEM BACK INTO
// var(--…). The scanner is a viewfinder: every surface it paints on is a
// hardcoded `background: '#000'` behind a live video frame, and that black is
// the same black whatever the site theme is — a camera app does not turn white
// because the shop around it did.
//
// This module exists because the site theme DID turn white, and one token came
// with it. `--warning` was retuned from #d49a3a to #8F6E0F on 2026-08-26 so it
// would carry on a white card (globals.css). That is correct for a card. It is
// wrong here: on the scanner's black backdrop the darker amber drops from about
// 8.5:1 to about 4.4:1, and the accent whose entire job is to pull the eye to
// "this photo is too dark to read" or "those corners cross" goes quiet at
// exactly the moment it is needed.
//
// The rule for anything added here: if it is painted over video, it is a
// constant; if it is painted on an ordinary page surface — the buttons before
// the camera opens, the hand-off dialog, the review list — it is a theme token
// and belongs nowhere near this file.
// ────────────────────────────────────────────────────────────────────

/**
 * Amber for warnings shown on the black overlay: the exposure notes and the
 * corner editor's invalid-crop banner.
 *
 * This is the value `--warning` held under the dark theme, kept because the
 * surface it sits on never stopped being dark.
 */
export const OVERLAY_WARNING = '#d49a3a';
