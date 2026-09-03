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

/**
 * The Desk's typefaces — the back-of-house admin, and nothing else.
 *
 * The storefront is Archivo + Public Sans. The Desk is deliberately a
 * different pair, because it is a different product: the operator should
 * never mistake the admin for the white shop. Both are SIL OFL and both are
 * committed to the repo as variable woff2, exactly like the two above, so the
 * build still reaches the network for nothing.
 *
 *   GEIST       UI — body, headlines, buttons, tags. Neutral to the point of
 *               invisibility, which is the point: on the Desk the type is not
 *               the voice, the state colours are.
 *   GEIST MONO  data — anything the operator would copy out: refs, money,
 *               times, config keys, type labels. Setting those in mono is
 *               what makes a reference read as a reference and not as prose.
 *
 * Tabular numerals are switched on globally under [data-desk] rather than per
 * component: money columns that do not line up are the fastest way to make a
 * ledger look broken.
 */

export const fontDesk = localFont({
  src: [{ path: './fonts/geist-variable.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-geist',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

export const fontDeskMono = localFont({
  src: [{ path: './fonts/geistmono-variable.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-geist-mono',
  display: 'swap',
  // Consolas first: it is the closest metric match on the Windows boxes the
  // operator actually uses, so the swap does not reflow a table of amounts.
  fallback: ['ui-monospace', 'Cascadia Mono', 'Consolas', 'monospace'],
});
