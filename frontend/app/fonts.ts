import localFont from 'next/font/local';

/**
 * The site's typefaces.
 *
 * Until now `body` was `font-family: system-ui` — Segoe UI on Windows, Roboto
 * on Android, SF on iOS. Three different sites depending on who was looking,
 * and none of them chosen. It was the single loudest "template, not brand"
 * signal on the page: a commissioned golden-hour hero photograph sitting over
 * whatever type the visitor's OS happened to ship.
 *
 * SELF-HOSTED, NOT next/font/google. The Google loader fetches the files at
 * BUILD time, which would put every production deploy at the mercy of the
 * build box reaching fonts.gstatic.com. These are committed to the repo, so
 * the build has no network dependency at all. Both faces are SIL OFL, which
 * permits bundling. Latin subset only — it covers English and Afrikaans
 * (ë, ê, ô, î, á all live in the latin range).
 *
 * Variable files: one request each covers every weight we use, and next/font
 * self-hosts them with a stable class name, so there is no layout shift and
 * no third-party connection on first paint.
 *
 *   ARCHIVO      display — headings. A grotesque with real mass and slightly
 *                squared counters; it holds its own at 3.4rem over a
 *                photograph, which is exactly where the hero needs it, and it
 *                stays sturdy rather than fashionable at small sizes.
 *   PUBLIC SANS  body/UI — drawn for dense civic interfaces, so it is legible
 *                at 13px in a dense listing card and neutral enough to sit
 *                under Archivo without competing.
 *
 * Deliberately NOT Inter, Space Grotesk or Poppins: those are the current
 * defaults, and defaulting is what this change exists to undo.
 */

export const fontDisplay = localFont({
  src: [{ path: './fonts/archivo-latin.woff2', weight: '400 800', style: 'normal' }],
  variable: '--font-display',
  display: 'swap',
  // Matched fallback metrics keep the swap from jolting the layout.
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

export const fontBody = localFont({
  src: [{ path: './fonts/publicsans-latin.woff2', weight: '300 700', style: 'normal' }],
  variable: '--font-body',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
  adjustFontFallback: 'Arial',
});
