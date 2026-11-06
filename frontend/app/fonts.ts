import localFont from 'next/font/local';

/**
 * The site's typefaces — League Spartan (display) + Montserrat (body).
 *
 * Both are SIL OFL, self-hosted as SUBSET variable woff2 via localFont. No
 * next/font/google dependency — production builds never reach the network.
 * Latin subset covers English and Afrikaans diacritics. One request each
 * covers every weight we use; next/font emits stable class names so there
 * is no layout shift on first paint.
 *
 *   LEAGUE SPARTAN  display — geometric sans-serif matching the wordmark's
 *                    shapes. Weight range 500-800 covers H1-H4 headings.
 *   MONTSERRAT      body/UI — legible at 13px in dense listing cards.
 *                    Weight range 300-700 covers regular through semibold.
 *
 * ⚠️ THE .woff2 FILES ARE THE SERVED ONES AND THE .ttf FILES ARE THEIR SOURCE.
 * Until 2026-11-06 these three pointed at the raw .ttf — next/font/local does
 * NOT transcode, it copies what it is given — so every cold start downloaded
 * 1.42 MB of TrueType (672 + 685 + 92) where 141 KB of woff2 says the same
 * thing. With `display: 'swap'` the visible cost was text painting in Arial,
 * then reflowing when a 672 KB face landed. The Desk's two faces were already
 * woff2, which is what made the original comment ("self-hosted as variable
 * woff2") true of half the repo and false of the half users actually see.
 *
 * Regenerate (needs `pip install fonttools brotli`):
 *
 *   pyftsubset app/fonts/montserrat-variable.ttf \
 *     --output-file=app/fonts/montserrat-variable.woff2 \
 *     --flavor=woff2 --layout-features='*' \
 *     --unicodes=U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD
 *
 * ⚠️ THAT UNICODE LIST IS THE SUBSET. It is Google's "latin" range plus the
 * punctuation a document-led product needs (en/em dash, curly quotes,
 * ellipsis, the euro sign). Dropping U+2000-206F silently breaks every
 * apostrophe in the copy; widening it to `*` puts the Cyrillic and Greek the
 * original carried back into the download.
 */

export const fontDisplay = localFont({
  src: [{ path: './fonts/league-spartan-variable.woff2', weight: '500 800', style: 'normal' }],
  variable: '--font-display',
  display: 'swap',
  // Brand pack fallbacks: Arial Black for headings.
  fallback: ['Arial Black', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

export const fontBody = localFont({
  src: [
    { path: './fonts/montserrat-variable.woff2', weight: '300 700', style: 'normal' },
    { path: './fonts/montserrat-italic-variable.woff2', weight: '300 700', style: 'italic' },
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
