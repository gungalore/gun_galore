# ALL Outdoor - Design Spec (v1.2)

This file defines how alloutdoor.co.za must look, feel and move. Follow it for every UI change.
Tokens live in `tokens.css` next to this file. Never hard-code a colour, radius, shadow or duration
that exists as a token.

## 0. Mission: polish, do not rebuild

The site structure, routes, data flow and page layouts stay as they are. The job is to raise the finish:
rounder, warmer, more depth, more responsive to touch, consistent everywhere.

- Change styling, markup details and micro-interactions. Do not restructure pages or rename routes.
- Work one area at a time (order in section 12). Each change must leave the page fully working.
- If a component is used in several places, fix the shared component, not each usage.
- When unsure, pick the quieter option. Premium outdoor retail, not a gaming site.

## 1. Brand feel

Rugged, trustworthy, local. Think a well-made piece of kit: solid, clean, no fluff, one sharp red accent.

- **Red is a signal, not a paint.** Outdoor Red marks the one primary action per view, active states,
  prices on auction wins and live indicators. Target: red covers under 5% of any screen.
- **Warm neutrals, never cold grey.** Page background is warm off-white (`--stone-50`), cards are white.
- **Depth through soft shadow and layering**, not borders everywhere.
- **Photography carries the outdoors.** UI chrome stays calm so listings and gear photos pop.
- Brand rule: no firearms or ammunition in core brand identity (logo, hero art, social avatars).
  Listing photos are content, not identity, and are fine.

## 2. Logo usage

- Always render via `components/brand/Logo.tsx` (in this folder). Files go in `/public/brand`.
- "light" artwork = for light backgrounds (black + red). "dark" artwork = for dark backgrounds (white + red).
- Header: horizontal logo, 32-36px tall desktop, emblem only below 380px viewport width.
- Minimum: horizontal logo 24px tall, emblem 20px tall.
- Clear space: at least 25% of the emblem height on all sides.
- Never: recolour, stretch, add shadow/glow/outline, animate the logo shape, place on busy photos
  without a dark scrim behind it.

## 3. Colour

Use role tokens (`--text`, `--surface`, `--accent`...) in components. Scales are for exceptions.

| Role | Token | Use |
|---|---|---|
| Page background | `--bg` (#F7F6F3) | `body` |
| Card / panel | `--surface` (#FFF) | cards, header, dropdowns |
| Sunken | `--surface-sunken` | input fills, table stripes, skeletons |
| Border | `--border` | 1px hairlines, only where shadow isn't enough |
| Text | `--text` (#1A1A1A) | headings, body. Never pure #000 for text |
| Secondary text | `--text-2` | descriptions, meta |
| Muted text | `--text-3` | placeholders, timestamps |
| Primary action | `--accent` (#E30613) | one primary button per view |
| Accent tint | `--accent-soft` | selected rows, active chips, icon wells |

Rules:
- Red text on light: use `--red-700` for body-size text, `--red-500` only at 14px+ semibold.
- Red text on dark surfaces: use `--red-400`. Brand red on near-black fails contrast.
- Error states use `--danger` plus an icon plus text. Never colour alone.
- Success/warning/info only for status, never decoration.
- Dark sections (hero, footer, live auction panel): wrap in `.surface-dark`, tokens flip automatically.

## 4. Typography

- **Display/headings:** League Spartan 700-800 (matches the wordmark's geometric shapes).
- **Body/UI:** Montserrat 400-600. Load both via `next/font/google` (see `nextjs-metadata.ts`).
- Anton is retired. Do not use it.

| Style | Font | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Hero H1 | display | clamp(2.25rem, 4vw, 3.5rem) / 1.05 | 800 | -0.02em |
| H2 section | display | 2rem / 1.15 | 700 | -0.015em |
| H3 card title | body | 1.0625rem / 1.3 | 700 | -0.005em |
| Body | body | 0.9375rem / 1.6 | 400 | 0 |
| Small / meta | body | 0.8125rem / 1.5 | 500 | 0 |
| Eyebrow | body | 0.75rem / 1.4 | 700 | 0.14em, uppercase |
| Price | display | 1.25rem+ / 1 | 700 | -0.01em, tabular-nums |
| Button | body | 0.875rem / 1 | 600 | 0.005em |

- Max 3 font sizes per card. Max line length 68ch for paragraphs.
- Prices, bids, countdowns, counts: `font-variant-numeric: tabular-nums` so digits don't jitter.
- Currency format: `R 12 500` (non-breaking space as thousands separator, no decimals unless cents exist).

## 5. Shape: radius

Everything gets rounder. Nested radius rule: inner radius = outer radius minus padding.

| Element | Radius |
|---|---|
| Badges, tags, small chips | `--radius-xs` 6px |
| Inputs, selects, small buttons, thumbnails | `--radius-sm` 10px |
| Dropdowns, menus, toasts, list rows | `--radius-md` 14px |
| Cards, tiles, listing cards, panels | `--radius-lg` 20px |
| Modals, hero content panels, feature blocks | `--radius-xl` 28px |
| Primary/secondary buttons, search bar, segmented controls, avatars | `--radius-pill` |

Images inside cards inherit the card radius on their exposed corners (`overflow: hidden` on the card).
No sharp corners anywhere except full-bleed hero images and page edges.

## 6. Depth: shadow and surfaces

- Resting cards: `--shadow-sm`, no border, or `--shadow-xs` plus a `--border` hairline on `--bg`.
- Hover (pointer devices only): lift to `--shadow-md` and `translateY(-2px)`.
- Dropdowns, popovers, sticky header when scrolled: `--shadow-lg`.
- Modals: `--shadow-xl` plus backdrop `rgb(17 17 17 / 0.45)` with `backdrop-filter: blur(4px)`.
- Primary button: `--shadow-red` on hover only.
- Subtle top highlight on dark/red surfaces: `--inner-highlight`.
- Hero: dark gradient scrim for text legibility,
  `linear-gradient(90deg, rgb(17 17 17 / .85) 0%, rgb(17 17 17 / .45) 55%, transparent 100%)`.
- Never stack more than 3 elevation levels on one screen.

## 7. Motion

Motion must feel quick, physical and purposeful. It confirms actions and guides the eye. It never delays the user.

**Durations and easing** (tokens): press 120ms, hover/focus 200ms, open/close 320ms, section enter 500ms.
Default easing `--ease-out`. `--ease-spring` only for small "pop" confirmations (like, add to cart badge).

**Implementation:** CSS transitions for hover/press/focus. The `motion` package (motion.dev) only for:
enter animations with stagger, AnimatePresence (toasts, modals, accordion content), and layout animations
(filters reordering a grid). No other animation libraries.

**Patterns:**
- *Press:* every clickable surface scales to `0.97` on `:active` (120ms). Cards scale to `0.985`.
- *Hover lift:* cards `translateY(-2px)` plus shadow step, image inside scales to `1.04` over 500ms.
  Wrap in `@media (hover: hover)` so touch devices don't get sticky hovers.
- *Section enter:* fade from `opacity 0, translateY(12px)` to rest, 500ms, once per page load when
  scrolled into view. Grids stagger children by 40ms, cap total stagger at 400ms.
- *Hero:* heading and CTA fade up on load (stagger 80ms). Background image slow zoom
  `scale(1.06)` to `scale(1)` over 1.6s. No parallax.
- *Dropdowns/menus:* `opacity 0, scale(0.96), translateY(-4px)` to rest, 200ms, origin at trigger.
- *Accordion:* height animates with motion `layout`, chevron rotates 180deg, 320ms.
- *Toasts:* slide in from bottom-right (bottom-centre on mobile), auto-dismiss 5s, pause on hover.
- *Skeletons:* shimmer gradient sweep 1.4s linear infinite on `--surface-sunken`.
- *Live data (bids, countdowns):* value change flashes `--accent-soft` background for 600ms,
  number rolls or cross-fades. Final 60 seconds of an auction: countdown text turns red and pulses once per second.
- *Like/watch (heart):* spring pop `scale 1 > 1.25 > 1`, fill transitions to red.
- *Cart badge:* bump `scale 1 > 1.2 > 1` when count changes.
- *Page transitions:* none beyond section enters. Never block navigation.

**Never:** animate layout properties (width/height/top/left) with CSS, loop decorative animation,
animate the logo, exceed 500ms on anything interactive, or ignore `prefers-reduced-motion`
(tokens.css already collapses durations; motion components must also check `useReducedMotion()`).

## 8. Components

### Buttons
| Variant | Look |
|---|---|
| Primary | Pill, `--accent` bg, white 600 text, height 44px (40px in header), padding 0 22px. Subtle top highlight. Hover: `--accent-hover`, `--shadow-red`, `translateY(-1px)`. Press: `--accent-press`, scale 0.97. |
| Secondary | Pill, `--surface` bg, `--text`, 1px `--border-strong`. Hover: `--surface-sunken` bg. |
| Ghost | No bg. Hover: `--surface-sunken` pill bg fades in. |
| Dark (on photos/hero) | Pill, white bg, `--stone-900` text. Or primary red. |
| Icon button | 40px circle, ghost style, 20px icon, tooltip on hover (400ms delay). |
| Destructive | Secondary shape with `--danger` text; confirm via modal. |

- One primary button per view. Everything else secondary or ghost.
- Buttons with arrows: the arrow nudges `translateX(3px)` on hover.
- Loading: keep width, swap label for a 16px spinner, disable pointer events.
- Focus: `box-shadow: var(--focus-ring)` on `:focus-visible` for every interactive element. Never remove outlines without this.
- Min touch target 44x44px.

### Inputs and search
- Height 44px, `--radius-sm` (search bar: pill), `--surface-sunken` fill, no border at rest.
- Focus: fill turns `--surface`, 1px `--accent` border, `--focus-ring`. 200ms.
- Header search: pill, 44px, leading search icon, category dropdown joined inside the pill on the left.
  On focus it widens slightly (max 40px) using a transform-free flex change animated by motion `layout`.
- Labels above fields, 13px 600. Errors below in `--danger` with icon.

### Header
- White, sticky. At top: no shadow. After 8px scroll: `--shadow-md` and 1px bottom hairline fade in.
- Height 72px desktop, 60px mobile.
- Shop/Community switch: segmented pill control; active segment is a sliding red pill
  (motion `layoutId`) with white text.
- User menu: avatar + first name in a pill; dropdown per section 7.
- "Sell your gear" is the header's single primary button.

### Module tiles (home page)
- Card: `--surface`, `--radius-lg`, `--shadow-sm`, padding 20px, min height 88px.
- Icon well: 44px, `--radius-md`, `--accent-soft` bg, icon in `--red-700`. On hover the well turns
  `--accent` and the icon white (200ms).
- Title H3, description `--text-2` 13px, one line with ellipsis on desktop.
- Chevron right aligned, nudges 3px on hover.
- All tiles share one state. No tile renders "expanded" with a different border/shadow by default.
  If a tile groups sub-modules, open them in a popover or inline accordion, styled per section 7.
- Grid: 3 columns desktop, 2 tablet, 1 mobile, 16px gap. The tile grid overlaps the hero bottom
  by 40px on desktop (negative margin) for depth.

### Chip rails (global: every row of category, filter or tag pills)
One component for all of them: `components/ui/ChipRail.tsx` + `chip-rail.css` (in this folder).
Replace every existing pill row with it: community categories, marketplace categories, auction filters,
search refinements, calibre/cartridge pickers, group tabs. Do not build one-off pill rows.

- **Never show a scrollbar or scroll arrows from the browser.** Overflow scrolls horizontally with
  the scrollbar hidden; edges fade out (48px mask) only on the side that has more content.
- **Arrow buttons:** 32px white circles with `--shadow-md`, only on pointer devices, only on the side
  that can scroll, fade in/out. Click scrolls 80% of the visible width, smooth.
- **Touch:** swipe with `scroll-snap-type: x proximity`, no arrows.
- **Chip:** 38px tall (32px `sm`), pill, 13px 600 Montserrat, `--surface` with 1px `--border`,
  `--text-2`. Hover: `--text`, `--border-strong`. Press: scale 0.96.
- **Single-select active:** dark ink pill (`--stone-900`, white text) that slides between chips
  (motion `layoutId`, spring). Red is not used here; red stays for the primary action on the page.
- **Multi-select active:** `--accent-soft` fill, `--red-700` text, check icon.
- Optional leading 16px icon and trailing count badge (tabular numbers).
- Active chip scrolls itself into view on load and on change.
- Keyboard: arrow keys, Home and End move focus; single-select is a radiogroup, multi is a group of checkboxes.
- The rail must be able to shrink (`min-width: 0`) so it never pushes the page wider.
- Pair a rail with at most one control on the right (e.g. a "Latest" sort dropdown pill). Nothing else on that line.
- On `.surface-dark` chips turn translucent and the active pill turns white.

### Listing cards (Marketplace)
- `--radius-lg`, image top at 4:3 with `object-fit: cover`, `overflow: hidden`.
- Watch/heart icon button over the image, top right, white circle with `--shadow-sm`.
- Condition chip over image, top left: white/85% with blur, `--radius-xs`.
- Body padding 14px: title (2 lines max), location + time `--text-3`, price large at bottom.
- Hover per section 7. Whole card is the link. Heart stops propagation.
- Sold: image desaturated 60%, "Sold" chip dark.

### Auction cards and live bidding
- As listing card, plus a bottom bar: current bid (price style) left, countdown right.
- Countdown pill: `--surface-sunken`; under 1 hour `--warning-bg`/`--warning`;
  under 60s `--danger` text with pulse.
- Live indicator: 8px red dot with a soft ping ring animation (the one allowed loop, only while live).
- Bid buttons: primary pill; quick-bid increments as secondary pills ("+ R50").
- New bid from another user: row flashes `--accent-soft`, toast "You've been outbid" if applicable.

### Community page (`/community`)
Layout: feed column (max 720px) + sidebar 320px, 24px gap, container-centred. Sidebar is `position: sticky`
(top = header height + 24px). Below 1024px the sidebar content moves into a top summary card and a
bottom-sheet menu; the feed goes full width.

**Page head:** H1 "Community" in display font (2rem, 800) with one line of `--text-2` intro under it.
**Filter bar:** ChipRail (single-select categories) + one "Latest" sort pill on the right.
The "Show content I've muted" checkbox is removed from here; it moves to the sidebar as "Muted content".
**Composer:** first card in the feed: avatar + sunken pill "Share a hunt, build or question...".
Click expands it in place into the full composer card (motion `layout`), no page jump.
The sidebar "Create post" button opens the same composer.

**Post card:**
- `--radius-lg`, `--shadow-sm`, padding 18px. Header: 40px avatar, name 600, category as a small sunken
  tag chip next to the name (not a line of red text), time `--text-3` below. Overflow menu (...) as a
  40px ghost icon button.
- Title 18px 700, body `--text-2` 15px, max 5 lines then "Show more".
- Media inside the card with `--radius-md`. 1 image: 4:3 max, cover. 2-4 images: rounded grid, 4px gap,
  "+N" overlay on the last tile. Click opens a lightbox (swipe on mobile).
- **Sensitive/graphic media gate:** heavy blur (`backdrop-filter: blur(28px)`) plus a 35% dark scrim.
  Centred stack: 48px glass circle with eye-off icon, "Graphic content" 16px 600 white, one line of
  reason in white/80% ("This post shows a harvested animal."), white pill button "Show image".
  No red box, no giant text. Reveal: blur and scrim fade out over 320ms. A per-user setting
  "Always show hunting images" skips the gate.
- Action row: hairline divider above, ghost pill buttons with 20px icons: Like (heart pop, count),
  Comment (count), Share. Counts tabular. Liked state `--red-700`.
- Comments expand inline under the card (accordion motion), newest 2 shown, "View all N comments".

**Sidebar:**
- Card 1: "Create post" primary button (the page's only red button), then your avatar, name, "Manage"
  link, then stats (Posts, Comments, Followers, Following) in a sunken rounded strip, numbers in display font.
- "My recent posts" list: 48px rounded thumbnails, title, status chip (Live = `--success-bg`/`--success`),
  Edit/Delete in an overflow menu, not as bare red text.
- Card 2 nav list: Feed, Groups, Notifications, Muted content. Rows 40px, 28px icon well
  (`--accent-soft`, `--red-700` icon), current row `--surface-sunken`. Notification count as a red dot badge.

**States:** skeleton post cards while loading (avatar circle, two text bars, media block). Empty
category: icon well, "No posts in Fishing yet", button "Be the first to post". Error: per section 8.

### Motivations, Licence Vault, Reloading Bench (tool pages)
- Step flows use a horizontal stepper: numbered circles, completed steps filled red with a check,
  connecting line fills red as progress advances (320ms).
- Document items in the Vault: rows with file-type icon well, name, expiry date. Expiry within
  90 days: `--warning` chip. Expired: `--danger` chip. Renewal dates use tabular numbers.
- Upload zones: dashed 2px `--border-strong`, `--radius-lg`; on drag-over the border turns red and
  the zone tints `--accent-soft`.
- Reloading Bench data tables: sticky header, zebra rows `--surface-sunken`, numeric columns right
  aligned and tabular. Warnings about max loads in `--danger` with icon, always visible, never collapsed.

### Accordion / FAQ ("Good to know")
- Each item a row in a single `--radius-lg` card, hairline dividers between.
- Plus icon rotates 45deg into an x when open. Content animates height (section 7).

### Toasts and nudges (e.g. "Profile 75% complete")
- Floating card `--radius-md`, `--shadow-lg`, bottom-left desktop, full-width bottom sheet style on mobile
  with 12px margin. Include a slim progress bar (red on sunken track) for completion nudges.
- Must never cover the primary content or the cart/chat button. Dismiss persists (don't show again for 7 days).

### Empty, error and loading states
- Never a bare line of text in a box. Structure: 48px icon well, title, one-line reason, one action.
- Error: "We couldn't load the latest listings" + secondary "Try again" button (spinner while retrying).
- Loading: skeleton cards matching the real card shape. No spinners for content areas.
- Empty: friendly and specific, e.g. "No auctions closing today. Browse the marketplace."

### Modals and sheets
- Desktop modal `--radius-xl`, max width 560px, enter: fade + `scale(0.97)` to 1, 320ms.
- Mobile: bottom sheet with 28px top radius and a grab handle, drags to dismiss.

## 9. Layout and spacing

- Container max 1280px, side padding 24px desktop, 16px mobile.
- 4px grid. Section vertical spacing 64-80px desktop, 48px mobile.
- Card internal padding 16-20px. Gaps: 16px in grids, 8-12px inside components.
- Align everything to the container edges. The current home page has large empty side margins
  at 1920px; keep 1280px but centre the hero content to the same container.

## 10. Copy rules

- No em dashes anywhere in UI copy. Use a hyphen, comma, colon or full stop.
- South African English: licence (noun), license (verb), colour, armoury, catalogue, organise.
- Currency: Rand, `R 1 250`. Dates: `23 Sep 2026`. Times: 24h `14:30`.
- Sentence case for headings and buttons ("Sell your gear", not "Sell Your Gear").
- Buttons say what happens: "Place bid", "Upload licence", not "Submit".
- Module names, used identically everywhere (nav, tiles, page titles, emails):
  Marketplace, Auctions, Community, Motivations, Licence Vault, Reloading Bench.
  Tile copy may use action phrasing ("Buy now") only as the description, not the title.

## 11. Accessibility (non-negotiable)

- Text contrast 4.5:1 minimum (tokens are pre-checked; stay on them).
- Visible `:focus-visible` ring on everything interactive.
- Icon-only buttons need `aria-label`. Decorative icons `aria-hidden`.
- Animations respect `prefers-reduced-motion`.
- Hit targets 44px. Forms fully keyboard operable. Live bid updates announced via `aria-live="polite"`.

## 12. Rollout order

Do these in order, one per session. Verify each on desktop (1440px) and mobile (390px) before moving on.

1. Install tokens + fonts + Logo component + favicon/manifest/metadata. Swap `body` background to `--bg`.
2. Buttons, inputs, focus ring (shared components).
3. Header (sticky shadow, segmented Shop/Community, search pill, user menu dropdown).
4. Hero (scrim, type, entrance) + module tiles (unify state, icon wells, overlap).
5. Listing and auction cards, skeletons, empty/error states.
6. ChipRail component (replace every pill row sitewide), then the Community page.
7. Motivations, Licence Vault, Reloading Bench tool UIs.
8. Accordion/FAQ, toasts/nudges, modals/sheets.
9. Final sweep: search the codebase for hard-coded hex colours, `rounded-none`, `rounded-sm`,
   em dashes (U+2014) in strings, Anton, and any `transition: all`. Replace with tokens.

## 13. Definition of done (per component)

- [ ] Uses tokens only, no hard-coded colours/radii/shadows/durations
- [ ] Rounded per section 5
- [ ] Hover (pointer only), press, focus-visible, disabled and loading states all present
- [ ] Motion per section 7, reduced motion respected
- [ ] Looks right at 390px and 1440px
- [ ] Copy follows section 10
