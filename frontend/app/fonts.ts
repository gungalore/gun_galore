import localFont from 'next/font/local';

/**
 * The site's typefaces — League Spartan (display) + Montserrat (body).
 *
 * Both are SIL OFL, self-hosted as variable woff2 via localFont. No
 * next/font/google dependency — production builds never reach the network.
 * Latin subset covers English and Afrikaans diacritics. One request each
 * covers every weight we use; next/font emits stable class names so there
 * is no layout shift on first paint.
 *
 *   LEAGUE SPARTAN  display — geometric sans-serif matching the wordmark's
 *                    shapes. Weight range 500-800 covers H1-H4 headings.
 *   MONTSERRAT      body/UI — legible at 13px in dense listing cards.
 *                    Weight range 300-700 covers regular through semibold.
 */

export const fontDisplay = localFont({
  src: [{ path: './fonts/league-spartan-variable.ttf', weight: '500 800', style: 'normal' }],
  variable: '--font-display',
  display: 'swap',
  // Brand pack fallbacks: Arial Black for headings.
  fallback: ['Arial Black', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

export const fontBody = localFont({
  src: [
    { path: './fonts/montserrat-variable.ttf', weight: '300 700', style: 'normal' },
    { path: './fonts/montserrat-italic-variable.ttf', weight: '300 700', style: 'italic' },
  ],
  variable: '--font-body',
  display: 'swap',
  fallback: ['Arial', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

/**
 * The Desk's typefaces — the back-of-house admin, and nothing else.
 *
 * The storefront uses League Spartan + Montserrat. The Desk is deliberately a
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
