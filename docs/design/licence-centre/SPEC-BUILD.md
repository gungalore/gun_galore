# Licence Centre — build spec for the new `/licence-centre` surface

Written 2026-09-08 from the design canvas. This is the **frontend half of Phase 3** of
`MOTIVATION-REBUILD-BRIEF.md` (repo root). It tells a build session how to turn the
artboards into the running surface without redesigning anything.

**Precedence.** `MOTIVATION-REBUILD-BRIEF.md` (scope and behaviour) → the canvas (what it
looks like) → this file (how the two join). `MOTIVATION-INTAKE-PLAN.md` is the question
model, `MOTIVATION-UX-REVIEW.md` is why the old screens are wrong. Where this file and the
canvas disagree, the canvas wins; where either disagrees with the brief, the brief wins.

**The canvas:** https://claude.ai/code/artifact/1efcb795-8db2-41c9-9828-8558842c67aa
(two pages: *Screens* and *Kit*). The same artboards sit beside this file as
`*.dc.html`, with `kit.mjs` (the CSS, every value) and `build.mjs` (the generator).
Open the `.dc.html` files in a browser if you cannot reach the canvas — they render
as plain HTML.

**Do not start here.** Phase 0 (a file-by-file plan) and Phases 1–2 (backend) come
first per the brief §7. This spec assumes `GET /motivations/:id/sheet` and
`GET /motivations/:id/preview` exist (brief §5.2).

---

## 1. Artboard → route

| Artboard | Route / thing | Frame | Notes |
|---|---|---|---|
| `List.dc.html` | `/licence-centre/applications` (brief §0 E: `/licence-centre` itself stays the Document Centre) | 390 | Your applications, then the five licence-type cards from `lib/licence-labels.ts` `LICENCE_TYPES` (label, section, blurb verbatim). |
| `Main.dc.html` | `/licence-centre/[id]` | 390 | The sheet. S16 sport, populated vault, dealer route. Every section, every row state. **This is the reference screen.** |
| `EmptyVault.dc.html` | `/licence-centre/[id]` | 390 | Same page, first-timer: shelf empty with the wide Add tile, every row `needs_you`. No onboarding wizard exists. |
| `PrivateSale.dc.html` | Firearm section only | 390 | `firearm_source = From a private owner`: the seller-consent card under the source row, with the signed Part F line. Rest of the sheet unchanged. |
| `Preview.dc.html` | Preview drawer, phone | 390×844 | Bottom sheet over the page. Same content as the desktop aside. |
| `Pack.dc.html` | `/licence-centre/[id]/pack` | 390 | After generation. Motivation readable in-page, cover photo, 271, annexures, witnesses, take-to-SAPS, print. |
| `Desktop.dc.html` | `/licence-centre/[id]` ≥ 1024px | 1440 | Same column at 760px, preview docked right and sticky. Nothing else changes between the two. |
| `Kit.dc.html` | component sheet | 900 | Every row state with the prop that produces it, chips, shelf, footer, toast, tokens. |

All sample data on the canvas is invented (Johan Pretorius, MO000066, the CZ Shadow 2).
Never seed it anywhere.

---

## 2. What the canvas matched, and the tokens to use

The artboards reproduce the running app: `globals.css` tokens, Archivo + Public Sans
(`app/fonts.ts`), the Document Centre section and row anatomy
(`components/document-centre/section.tsx`, `document-row.tsx`, `doc-thumb.tsx`), the
pills in `components/motivation/provenance.tsx`, the yes/no pills in
`components/licence-pack/yes-no-pills.tsx`, the 271 meter values in
`components/licence-pack/saps271-meter.tsx`, and the mobile PUSH header in
`components/shell/shell-header.tsx`. Nothing new was invented.

**In code, always the `var()` name, never the hex.** The canvas inlines hex only because
the design sandbox has no `globals.css`.

| On the canvas | In code |
|---|---|
| page / card white `#FFFFFF` | `var(--bg)`, `var(--bg-card)` |
| inset `#F4F2EC` | `var(--bg-inset)` |
| card hover `#FAF9F5` | `var(--bg-card-hover)` |
| border `#DDD8CC`, divider `#EDEAE1` | `var(--border)`, `var(--border-divider)` |
| ink `#1A1613` / `#4A443C` / `#7A7267` / `#9C948A` | `--text-primary` / `--text-secondary` / `--text-tertiary` / `--text-faint` |
| red `#C8102E`, wash `rgba(200,16,46,.09)` | `var(--red)`, `var(--red-wash)` (never concatenate an alpha onto `--red`) |
| green `#1F7A50` + wash/line | `--success`, `--success-wash`, `--success-line` |
| gold `#8F6E0F` + wash/line | `--gold-strong`, `--gold-wash`, `--gold-line`; amber "still needed" = `--warning` |
| radii 6 / 8 / 12 | `--r-sm` / `--r-md` / `--r-lg` |
| shadows | `--elev-1` (overlap card, list cards), `--elev-2` (drawer, toast) — **only render through `.gg-tile`**, see §9 |
| Archivo 500 | `font-[family-name:var(--font-head)] font-medium` |
| Public Sans | the body default |

**Type scale** (px): page h1 24 · section h2 18 · meter figure 33 · row value 14.5/500 ·
body and card sentence 13.5 · row label 12.5 · source line 12 · shelf name 11 · pill
10.5/500 · shelf label 11 uppercase `.11em`. Weights 400 and 500 only (the shell title
is 700 because `shell-header.tsx` already is).

**Spacing:** page gutter 16px on the phone; section `padding: 20px 16px 8px`; row
`padding: 11px 0` with a `--border-divider` rule between rows (none after the last);
row grid `minmax(0,1fr) auto`, column gap 12; cards gap 8; shelf gap 10.

---

## 3. Page anatomy and the sticky arithmetic

```
phone                                     desktop (≥1024)
┌ shell PUSH header 54 (existing)        ┌ site nav 62 (existing)
├ .strip  sticky top:54   z:4            ├ 1280 content column, grid 760px | 1fr, gap 40
│  row1: ref · type · progress pill       │  ├ .strip sticky top:0 inside the column
│  row2: section chips · Preview toggle   │  ├ shelf
├ shelf (horizontal scroll)               │  ├ sections …
├ sections (scroll-margin-top 120)        │  └ footer (sticky bottom)
├ … 8 sections                            └ aside sticky top:20 — the preview panel
└ .foot  sticky bottom                       (bordered card, --elev-1, scrolls inside)
```

- The shell header is the app's own (`isTabRoute` is false for these routes, so it is
  the PUSH archetype: back chevron + title). `lib/shell-routes.ts` already maps
  `/licence-centre` → "Licence Centre" (the Document Centre); add `/licence-centre/applications` → "Applications" and `/licence-centre/:id/pack` → "Your pack".
- The strip's `top` is `var(--shell-header-h)` on the phone and `0` on desktop.
- Section anchors: `id="firearm" | "you" | "competency" | "own" | "premises" | "case" |
  "declarations" | "pack"`, each with `scroll-margin-top: 120px` so a chip tap lands
  under the strip, not behind it.
- The preview drawer on the phone is a bottom sheet (`--r-lg` top corners, `--elev-2`,
  a 36×4 grab bar, 640px tall over a 32% ink scrim). On desktop it is the aside and the
  Preview toggle only collapses it.

---

## 4. Components to create

All new files under `frontend/components/licence-centre/`. Everything presentational
takes plain props and calls back; **`app/licence-centre/[id]/page.tsx` is the only
stateful file** (same rule as The Bench).

| File | What | Props (shape) |
|---|---|---|
| `sheet-header.tsx` | the `.strip` | `{ reference, licenceType, missingCount, sections: {id,label,missing}[], active, previewOpen, onJump, onTogglePreview }` |
| `document-shelf.tsx` | the shelf | `{ documents: {id, letter, kind, label, mime, state:'read'\|'check'}[], empty: boolean, onAdd }` — thumbs via `DocThumb`/`GlyphThumb` from `document-centre/doc-thumb.tsx` |
| `sheet-section.tsx` | heading + blurb + list | `{ id, title, blurb, children }` |
| `sheet-row.tsx` | **the one row component** | `{ item: SheetItem, onChange(value), onConfirm() }` — branches on `item.state` and `item.kind`, see §5 |
| `cards-row.tsx` | the tile grid for `kind:'cards'` | `{ item, onChange(csv) }` — renders inside `sheet-row.tsx` |
| `declaration-row.tsx` | yes/no + detail + four boxes | wraps the existing `licence-pack/yes-no-pills.tsx`; on "Yes" renders the `_detail` textarea and the four `_station/_case_number/_charge/_outcome` boxes in a two-column grid |
| `overlap-card.tsx` | "This one will be my ___" | `{ owned: string, angles: {key, sentence}[], chosen, onPick }` — from `sheet.overlap.suggestedAngle` |
| `consent-card.tsx` | seller consent status | wraps `components/motivation-seller-consent.tsx`; adds the Part F line |
| `competency-lines.tsx` | one line per certificate + the endorsement check line | from `sheet.items` in the Competency section |
| `pack-summary.tsx` | the 271 meter + take-to-SAPS list in "Your pack" | reuse `licence-pack/saps271-meter.tsx` values; the F row reads "dealer" / "seller" in gold instead of a percentage |
| `preview-panel.tsx` | drawer/aside body | `{ preview: PreviewSection[] }` from `GET :id/preview`; renders the twelve fixed headings in order; a section the writer has not produced yet renders its placeholder line in `--text-faint` italic |
| `sheet-footer.tsx` | the one red button | `{ missingCount, onWrite, busy }` |
| `sheet-toast.tsx` | "Read your competency certificate · 3 rows filled" | dark plate, `--elev-2`, one line, 4s |

Moved in, not rewritten (brief §4): `document-centre/*` stays where it is and is
imported; `motivation/upload-panel.tsx`, `qr-icon.tsx`, `provenance.tsx`
(`Pill`, `toneFor`, `ProvenanceNote`), `licence-pack/bulk-capture.tsx`,
`extraction-review.tsx`, `read-result.tsx`, `yes-no-pills.tsx`, `saps271-meter.tsx`,
`empty-answer.ts`, `owned-firearm-summary.ts`, `delete-application.tsx`,
`pack-finish.tsx`, `motivation-seller-consent.tsx`, `motivation-witnesses.tsx`,
`motivation-cover-photo.tsx`, `motivation-cover-cropper.tsx`. Move them under
`components/licence-centre/` in Phase 4 when the old screens go; until then import
them from where they are.

**Not reused** (brief §4, last paragraph): `field-grid.tsx`, `pack-row.tsx`,
`pack-group.tsx`, `pack-section.tsx`, `motivation-field-input.tsx`, `wizard-rail.tsx`,
`prefill-banner.tsx`, `capture-cards.tsx`, `follow-up-thread.tsx`. `sheet-row.tsx`
replaces the first five.

---

## 5. `sheet-row.tsx` — the states, exactly

Input is one `SheetItem` from `GET /motivations/:id/sheet`:
`{ key, label, kind, state: 'filled'|'suggested'|'needs_you'|'na', value, provenance,
options?, cards?, scope, required, help }`.

| `state` | Render | Right-hand action |
|---|---|---|
| `na` | nothing | — |
| `filled` | label 12.5 `--text-secondary` · value 14.5/500 **in full, never masked** · source line 12 `--text-tertiary` "from {provenance.from}" (the server's string, lower-cased after "from") · `Pill check` "check this" when `provenance.inferred` · `Pill profile` "saved to your profile" when `scope==='profile'` | one text button **Change**, red, 44px tall, 13/500 |
| `suggested` | as `filled`, on a gold wash fading left→right (`linear-gradient(to right, var(--gold-wash), transparent 60%)`, bleeding into the 16px gutters), always with the "check this" pill | **Confirm** (red) then **Change** (`--text-tertiary`) |
| `needs_you` | label row with, at the right, `saved to your profile` (profile scope) and `Still needed` (11/500 `--warning`) or `Optional` (11 `--text-tertiary`); then the control **open**, full width, 44px, `--border` keyline, `--r-sm`; keyline `--warning` while required and empty; `help` under it at 12 `--text-tertiary` | none — the control is the action |

Controls by `kind`: `short` text input · `choice` native select with a chevron ·
`date` date input with the calendar glyph · `long` textarea 88px min · `yesno` → the
declaration row · `cards` → `cards-row.tsx` · `multi` → `cards-row.tsx` with short
labels in two columns.

Placeholders are the **shape of the answer** taken from the registry's own `placeholder`
/ `help` (`"Glock, CZ, Taurus"`, `"9mm Parabellum"`, `"13 digits"`). Never "You may know
it", never an empty box.

**Change** on a `filled`/`suggested` row swaps it to the `needs_you` control prefilled
with the current value, with **Done** in place of the action; saving writes `MEMBER`
provenance and the row returns to `filled` with "from you". **Confirm** writes the
suggested value as `MEMBER` without opening anything.

### `cards-row.tsx`

- Tiles: `display:flex; gap:10px; min-height:44px; padding:11px 13px; border:1px solid
  var(--border); border-radius: var(--r-md)`; 13.5px sentence; an 18px checkbox at the
  left. Selected: `border-color: var(--red); background: var(--red-wash); font-weight:
  500`; the box fills `--red` with a white tick.
- One column on the phone. Two columns (`repeat(2, minmax(0,1fr))`) on desktop, and
  on the phone for short labels (disciplines, match formats).
- The top-ranked option carries "most likely" at 10.5 `--text-tertiary` — the first
  card only, and only when the server ranked them.
- Multi-select; value stored as the comma list the registry expects.
- When `item.cards.ownWords` is set, a textarea below labelled "In your own words —
  optional, prefilled from the cards you tapped", prefilled by joining the tapped
  sentences; the member's edits win once they type.

### `declaration-row.tsx`

`yes-no-pills.tsx` unchanged (13.5 question, 12 help, pills 12.5 with 6/15 padding and
44px height, "No" first, nothing pre-selected, `--warning` keyline while unanswered).
A "Yes" opens, inline under the row: the `*_detail` textarea, then the four form boxes
as a two-column grid of 40px inputs with shape placeholders ("Polokwane SAPS",
"CAS 412/03/2019"). The negligence question appears only after lost/stolen = Yes, as
the registry's `showIf` says.

---

## 6. The strip, the chips, the counts — one source of truth

`sheet.missing` is the list of required, unanswered keys. From it, and nothing else:

- the progress pill: `N things left` (amber) or `Ready to write` (green);
- the dot on each section chip: amber if any missing key belongs to that section,
  green otherwise;
- the footer: button disabled at 50% opacity with "N things still needed above" under
  it; enabled with no line when N is 0.

Three views of one number, computed once in the page. Never a fourth.

Section chips: 30px tall, `999px` radius, 12px, `--border` keyline; active = `--red`
keyline on `--red-wash` at weight 500. The active chip follows scroll (IntersectionObserver
on the section headings). The "Preview" toggle is pinned outside the scroller at the
right, same height, `--r-sm`, eye glyph, red keyline on the wash when open.

---

## 7. The shelf

72×92 tiles, **6px radius, `--border` keyline, `--bg-inset`** fill (the
`GlyphThumb` box) with the real thumbnail through `DocThumb` where the mime is an image;
annexure letter bottom-left in a dark tag (mono 10.5/500 on `--text-primary`); a state
dot top-right (green = read cleanly, gold = check). Name under it, 11px, two lines,
clamped. Letters come from `sheet.documents[].letter` and match the annexure index in
the preview and the pack.

The **Add** tile is dashed (`--border-hover`), red plus and the word "Add". When the
vault is empty it becomes the wide tile (`EmptyVault.dc.html`): QR glyph, "Add your ID,
licences and certificates", "Scan with your phone or choose files. We read them and
fill this page in." Tapping either opens the existing `upload-panel.tsx` /
`bulk-capture.tsx` flow as a sheet — the QR hand-off and the file picker, nothing per
section. When a read completes: the toast, and the rows it filled change state in place.

---

## 8. Behaviour rules the canvas assumes

1. **Autosave on change**, whole blob, through `PATCH :id/answers` as today; profile-
   scoped keys are the server's problem (brief §5.2).
2. **Preview refetch** after a save, debounced 600ms, from `GET :id/preview`. The
   sentence a tapped card produced is wrapped in `<mark>` (red wash) in the preview so
   the member sees the tap land.
3. **Overlap card** renders in Firearm as soon as `sheet.overlap.suggestedAngle` is
   non-null (make and calibre known). It sits under the source row, above nothing.
4. **Private sale:** the consent card renders under the source row when `firearm_source`
   is private; the overlap card follows it. Its Part F line appears once the consent is
   signed.
5. **Competency** never shows an upload door when the vault covers the firearm type.
   The endorsement line is green when covered, gold "not covered — add a certificate
   for a {type}" otherwise.
6. **Declarations** never pre-select. Six rows for everyone, "No" first.
7. **Nothing is masked** on the member's own screen (CLAUDE.md rule 7 is about other
   users). Full name, ID number, address, in full.
8. **One red button** on the sheet: "Write my motivation". Everything else red is text.
   On the pack page there is no red button at all; Print and Download are outlined.
9. **Write** calls `POST :id/generate` and routes to `/licence-centre/[id]/pack`; the
   existing `pack-finish.tsx` polling and its "taking longer than usual" copy carry over.
10. **All reads go through `useViewerFetch` / `viewerFetch`** (`no-store`). Never
    `revalidate` anything on these routes.

---

## 9. Traps (from CLAUDE.md, the ones this surface will hit)

- `* { box-shadow: none !important }` kills every shadow unless the element carries
  `.gg-tile`. The overlap card, the list cards, the drawer and the toast need it.
- `.gg-tile` owns `transition`; do not also add `transition-colors` on the same element.
- An undefined `var()` with no fallback drops the whole declaration silently. Every
  token in §2 exists; do not invent `--bg-page` or `--amber`.
- `--red` + `18` is two tokens, not a colour. Use `--red-wash` / `--red-line` or
  `color-mix`.
- 44px hit targets on every button and tile, including the "Change" text buttons.
- No emoji, no exclamation marks, no legalese in labels, no "KYC", no "escrow", no
  competitor names. Second person. Section blurbs one sentence.
- Weights 400 and 500 only; radii from the three tokens; borders 1px.
- The mobile shell is a route allowlist (`lib/shell-routes.ts`): the PUSH title for
  the sheet must come from `pushTitleFor`, or `document.title` falls back.
- `npm run build` runs `desk-guard`, `desk-cutover` and `theme-sync` first; none of
  them is touched by this work, but a stray file under `frontend/components/admin` or
  `app/admin/(protected)` fails the build.
- Icons are inline stroke SVG on a 24 grid (the kit's `I` map in `kit.mjs` has every
  one used: back, plus, eye, check, chevron, file, qr, calendar, print, pen).

---

## 10. Build order for Phase 3, with the check for each

1. `sheet-row.tsx` + `cards-row.tsx` + `declaration-row.tsx` against a fixture
   `SheetItem[]` — a Vitest/RTL spec per state in §5 (the Kit artboard is the fixture).
2. `sheet-header.tsx`, `document-shelf.tsx`, `sheet-footer.tsx`, `sheet-toast.tsx` —
   spec: the three counts in §6 agree for every `missing` list.
3. `app/licence-centre/[id]/page.tsx` — fetch `sheet`, render the eight sections in
   order, autosave, preview refetch. RTL interaction-count spec (brief §0 G): a populated
   fixture vault, S16 sport, reaches an enabled "Write my motivation" in ≤ 12 taps and
   zero typing. There is no Playwright in this repo; do not add it.
4. `overlap-card.tsx`, `consent-card.tsx`, `competency-lines.tsx`, `pack-summary.tsx`.
   RTL spec: the private-sale variant renders the consent card and the Part F line.
5. `preview-panel.tsx` — drawer on the phone, aside on desktop. Spec: a tapped card's
   sentence appears marked in the preview after the debounce.
6. `app/licence-centre/applications/page.tsx` (list) and
   `app/licence-centre/[id]/pack/page.tsx`. RTL spec: empty vault, S13, fill every
   `needs_you` row and the button enables.
7. `lib/shell-routes.ts` titles for the applications and pack routes; `HANDOFF.md` entry; stop.
   **Phase 4 (deletions and redirects) is a separate sign-off.**

---

## 11. Re-seeding the canvas from a later session

`build.mjs` beside this file writes every artboard from `kit.mjs`; edit those, run
`node build.mjs`, then follow the design skill's seed/publish steps against the artifact
URL above (read it first with the Artifact tool, `--extract`, and re-seed with all files
— the memory note `licence-centre-design-canvas` has the exact moves). The canvas is
the visual truth; keep these copies in sync when it changes.
