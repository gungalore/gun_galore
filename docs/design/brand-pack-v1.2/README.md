# ALL Outdoor Brand Pack - v1.1

Rebuilt September 2026 from the approved AO mountain-and-road emblem and ALL Outdoor wordmark.
Every file in this pack is generated from one clean vector master, so all versions match exactly.

## What changed from v1.0

- **Clean vectors.** The old SVGs were pixel traces with stair-stepped edges and stray specks. All SVGs are
  now smooth, true vector artwork that scales to signage and vehicle decals.
- **One geometry.** Light, dark and monochrome versions previously came from different artwork with different
  proportions and a different road edge. They are now identical shapes in different colours.
- **No clipping.** The "r" of Outdoor and the emblem base were cut off at the file edge in almost every PNG.
  All PNGs now have a safe margin.
- **No artefacts.** Stray lines above "Outdoor" (horizontal logo, wordmark, Open Graph image) removed.
- **Consistent lockups.** Wordmark centred under the emblem in the stacked logo; horizontal lockup uses fixed proportions.
  Horizontal monochrome versions added.
- **Icons.** Favicons are rounded squares; app icons, PWA and maskable icons respect platform safe zones.
- **Watermarks** unified to 15% opacity (were 16% and 18%).
- **Typography simplified.** Headings: League Spartan. Body/UI: Montserrat. Anton retired (its condensed shape
  clashed with the wide geometric wordmark).
- **Full UI palette** added (red scale, warm neutrals, semantic colours), contrast-checked.
- **Developer files** rewritten for Next.js: tokens, Tailwind v4 theme, metadata, manifest, Logo component,
  and `DESIGN.md`, the look-and-feel spec for the website. The Shopify snippet was removed.
- **Guide contradictions fixed.** One clear-space rule, correct labels (the old board called the stacked logo
  "horizontal" and showed the white mark in black).

Known limit: the tip of the "r" was already cut off in every original source file. It has been kept as a clean
flat terminal. If the original vector/AI file or the wordmark font turns up, rebuild the wordmark from that.

## Core palette

| Colour | HEX | RGB | Use |
| --- | --- | --- | --- |
| Outdoor Red | `#E30613` | 227, 6, 19 | Road accent, calls to action, wordmark accent |
| Black | `#000000` | 0, 0, 0 | Logo artwork on light surfaces |
| White | `#FFFFFF` | 255, 255, 255 | Logo artwork on dark surfaces |

UI text uses near-black `#1A1A1A` and warm neutrals, see `09-Developer-Files/tokens.css`.
For print, ask the printer to convert to their CMYK or spot profile. Suggested starting point: Pantone 485 C.

## Which logo

- File names say which **background** they are for: `light` = on light backgrounds (black + red),
  `dark` = on dark backgrounds (white + red).
- Primary (stacked) for square-ish spaces, horizontal for headers and wide spaces.
- Monochrome for engraving, embossing, one-colour vinyl, stamps, single-thread embroidery.
- Emblem alone for app icons, avatars, favicons and tight spaces.
- SVG for print, signage and the website. PNG for email, social and places that can't take SVG.

## Clear space and minimum size

- Clear space: at least 25% of the emblem's height on every side.
- Horizontal logo minimum: 24 px tall on screen, 8 mm tall in print.
- Stacked logo minimum: 80 px wide on screen, 25 mm wide in print.
- Emblem minimum: 20 px tall on screen, 6 mm tall in print.

## Typography

- Headings: **League Spartan** 700-800.
- Body and UI: **Montserrat** 400-600.
- Fallbacks: Arial Black (headings), Arial (body).
- The wordmark is artwork. Never retype it.

## Do not

- Stretch, squash, rotate or skew the logo.
- Change the red, black or white values in the logo.
- Add drop shadows, glows, bevels, outlines or gradients to the logo.
- Use light-background artwork on dark surfaces or the reverse.
- Place the logo on a busy photo without a clean scrim or holding shape.
- Separate, redraw or rearrange the mountain, road, A or O.
- Add firearms, ammunition or other restricted items to the core brand identity.

## Folders

- `01-Primary-Logos` - stacked, horizontal and monochrome lockups (SVG + 2400 px PNG).
- `02-Emblems-and-Wordmarks` - emblem and wordmark on their own.
- `03-App-Icons` - iOS (opaque 1024 masters) and Android adaptive layers.
- `04-Favicons` - favicon.ico, rounded PNG favicons, PWA and maskable icons.
- `05-Social-Media` - avatars, posts, story, Open Graph, Facebook/LinkedIn and YouTube covers.
- `06-Web-and-Email` - website headers, mobile emblem, email signature.
- `07-Print-and-Watermarks` - 3000 px print masters and 15% watermarks.
- `08-Brand-Guides` - `brand-guide.html` (open in a browser, loads the real fonts) and `identity-sheet.png` (static snapshot, type samples in a fallback font).
- `09-Developer-Files` - `DESIGN.md`, `tokens.css`, `Logo.tsx`, `nextjs-metadata.ts`, `site.webmanifest`.
