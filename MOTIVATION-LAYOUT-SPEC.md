# Motivation PDF: layout spec

Date: 2026-09-08. Companion to `MOTIVATION-S13-OUTPUT-REVIEW.md` §1.6. Mockup:
`docs/design/motivation-layout-mock.html` and `.pdf` (four pages: cover, two motivation
pages, an annexure divider). The mockup is the target look; the copy in it is illustrative
and the reason-generator rules still govern the words.

## 1. What is wrong with the current layout (MO000071)

The current pack is styled like a brochure: black cover band, letter-spaced small caps
everywhere, a heavy diagonal watermark that text tools read as stray capitals, running
headers that say "CONTENTS" on every page, inline numbered headings in body size, justified
text with wide word gaps, and a contents page that lists only the annexures. A DFO handles
Word documents all day; this reads as marketing and it hides the structure the approved
packs make obvious.

## 2. Principles

- It is a legal submission, not a brand piece. White paper, black text, one brand-red rule
  and red section numerals. The logo appears once, on the cover, small.
- The reader finds things by heading. Fixed heading set, set as headings (bold sans, upper
  case, 11.5pt, red numeral), never inline with the paragraph.
- Everything that is data is a table: cover particulars, owned firearms, competency,
  annexure index. Prose carries argument only.
- One running header and one footer, the same on every page, telling the reader whose
  pack this is, which firearm, and which page of how many.
- Left-aligned body text. Justification on a narrow serif column produces the rivers seen on
  pages 3 to 5.

## 3. Page geometry

> **NOTE (2026-10-08, verified against code).** The numbers in this section are
> the TARGET from the mock, not the shipped page. The current pdfkit renderer
> uses 14 mm side padding and 9 mm below the running banner
> (`PAD_X`/`PAD_TOP` in `motivation-pdf-chrome.ts`); it does not use the 22 mm
> margins below. Treat §3 to §6 as target geometry/type, not as current
> behaviour — see §8.

- A4 portrait, margins 22 mm left and right, 22 mm top, 20 mm bottom. Text column 166 mm.
- Running header at 10 mm from top: left "Motivation · G J P Fourie · 890512 5220 089",
  right "Section 13 · Glock 9mm · ZABA01892" (on annexure pages the right side reads
  "Annexures" or "Annexure G"). 8.5pt sans, grey 60%, hairline below.
- Footer at 10 mm from bottom: left "Prepared with All Outdoor", right "MO000071 · G J P
  Fourie · page n of N". 8.5pt sans, grey, hairline above. No logo in the footer.
- Preview watermark: a single word "PREVIEW" at 64pt, 5% black, rotated 24 degrees, on its
  own content layer so it is not extracted as text. The final issue has none.

## 4. Type

> **NOTE (2026-10-08, verified against code).** Shipped type differs from this
> target: the embedded faces are **Archivo** (sans, used for headings and page
> furniture) and **Source Serif 4** (serif body, about 10.9 pt), registered in
> `motivation-pdf-chrome.ts`. The `Inter / Helvetica` and `10.5pt` figures below
> are the mock's target, not the current renderer — see §8.

- Body: a serif (Source Serif 4 or the pdf-lib embedded equivalent), 10.5pt, 1.5 leading,
  left aligned, 3 mm after each paragraph.
- Headings: sans (Inter / Helvetica), 11.5pt bold, upper case, letter-spacing .06em, red
  numeral then the title, 7 mm before and 2 mm after.
- Labels in tables and key-value blocks: sans 8pt, upper case, .06em, grey 55%.
- Annexure citations inline in italic grey: "(Annexure G: existing licences)". Titles in
  the third person, never "your".
- Cover title: sans 26pt bold "Motivation" under a red 9pt kicker "APPLICATION FOR A
  LICENCE TO POSSESS A FIREARM"; below it the section line in 12pt regular.

## 5. Pages

**Cover.** Logo top left, reference top right. Kicker, title, section line, red 28 mm rule.
Key-value table: applicant, identity number, firearm (type, make, calibre, serial), section
applied for, submitted to (Registrar through DFO, station), date, annexures. Bottom third:
"IN THIS PACK" with the five top-level entries and page numbers (motivation, owned
firearms, Annexure F, annexures A to I, the applicant's own take-with-you sheet). No
salutation block; the "To the Registrar" line lives in the table.

**Motivation.** Sections in the fixed order with the fixed titles:
1 Application · 2 Why I need a firearm (S13) / Why I need this firearm (S15/S16) · 3 What I
have already done, and why it is not enough (S13) / My hunting or sport shooting (S15/S16) ·
4 The firearm, and how I would keep it · 5 Firearms already licensed to me · 6 Competency ·
7 Association and dedicated status (S16 only) · 8 Section N applied to my case · 9
Declaration and signature. Renumber when a section is absent. Nothing else gets a heading;
the storage paragraph is part of 4, reloading (S15/S16 only) is a sentence in 3.

**Owned-firearms table (section 5).** Every firearm the applicant holds, always, however
many. Columns: Make and model · Type (with action) · Calibre · Serial · Section · Licensed for
(dedicated hunting / dedicated sport shooting / occasional hunting / self-defence, from the
licence and endorsement) · Expires · and, when there is one, a Status note (stolen with CAS,
lost, lapsed). One sentence above the table, one paragraph below it saying why none of
them serves this purpose. The same list goes to SAPS 271 item 2.1 ("firearms already
licensed to the applicant", 14 rows on the form); if the applicant holds more than 14, the
overflow goes on a continuation sheet headed "SAPS 271 item 2.1 continued" and the form's
last row says "see continuation sheet". The motivation table and the 271 rows must agree
serial for serial; render both from the same array.

**Statute (section 8).** The subsection quoted in a shaded block with a red left rule,
then one short paragraph mapping each element to the section of the motivation that
answers it. Quote from `motivation-statute.ts`; the model writes only the mapping.

**Declaration and signature.** Declaration text, then three rules: Signature · Date · Place.
Directly after the last motivation section, never after a table on its own page.

**Annexure F (prior notice).** Same page template, own heading; it already reads well.

**Annexure dividers.** One per letter: header reads "Annexure G"; a black tab on the right
edge with the letter (vertical text) so the stapled pack can be thumbed; red kicker
"ANNEXURE G", title, rule, one line saying what follows and that originals will be
produced, then an item table (G1 to Gn, description, pages) when the annexure has more than
one item. Then the copies, one per page, each stamped bottom-left with "Annexure G3 ·
MO000071".

**Press clippings.** One article per page: masthead line (publication, date, headline),
the article body as published in a narrower column (or a screenshot), the URL, and a
"retrieved on" line. Below or on the next page, the station's quarterly figures as a small
table for each precinct cited in section 2.

**Take-with-you sheet.** Last pages, headed for the applicant, route-aware (dealer /
private / estate), the same typographic system, with a tear-off tone: short checklist rows
with boxes, notes in 8.5pt beneath each.

## 6. Tables

Hairline rules only: 1pt under the header row, .5pt between rows, none vertical. Header
labels sans 8pt upper case grey. Body 9.5pt serif. Cell padding 2.2 mm. Never let a table
break across a page with fewer than two rows on either side; move the whole table if it
does not fit.

## 7. Things to remove

The black cover band; small-caps letter-spacing on body labels; the logo in every footer;
"CONTENTS" as the running header; the bordered "APPLICATION FOR A FIREARM LICENCE" box; the
italic disclaimer line on the cover (it belongs on the take-with-you sheet); the "01 ·
FIREARMS ALREADY LICENSED TO ME" red-dot section marker style; justification.

## 8. Why it looks the way it does, and the fix

> **STATUS: FOUNDATION LANDED, NOT YET WIRED (updated 2026-10-08).** The
> renderer swap described in this section has started but is NOT complete. The
> **pdfkit renderer is still authoritative** for the served download; do not
> treat any statement below as shipped geometry, type or behaviour.
>
> What has landed (all add-only, the live path is unchanged):
> - `backend/src/motivations/motivation-html.service.ts` — a pure
>   `renderMotivationHtml(input)` that turns the existing `MotivationPdfInput`
>   into a self-contained HTML/CSS document (cover, contents, flowing body,
>   owned-firearms table, firearm spec, take-with-you, annexure index,
>   declaration), using the scheme/layout colours. Numbered headings are parsed
>   with the SAME rules as the pdf renderer (`isHeading`/`splitHeading`).
> - `backend/src/motivations/chromium-pdf.service.ts` — a dependency-free
>   headless-Chromium printer (`chrome --headless=new --print-to-pdf`) that
>   turns that HTML into a PDF. It resolves the Chromium executable from
>   `CHROMIUM_EXECUTABLE` or the Playwright browser cache; no new npm
>   dependency was added.
> - `backend/scripts/motivation-html-sample.ts` — a dev utility that renders a
>   sample pack end to end.
>
> Deliberately NOT done yet, and the reason the swap is not wired:
> - Graphical/raster and merge pages still live in pdfkit/pdf-lib: the cover
>   photograph, the cartridge drawing, the C.I.P. sheet, press clippings,
>   activity photographs, the witness/seller-consent forms, the SAPS 271 form,
>   the scanned annexure sheets and the merged annexure PDFs. Switching now
>   would drop content from a legal document.
> - Per-page section labels and "page N of M" need the CDP/Playwright
>   header-footer templates (a fixed top header collides with flow content in
>   Chromium print, so only the footer is fixed today).
> - The motivation test suite asserts on pdfkit draw calls; it moves to
>   rendered-output snapshots when the swap completes.
>
> The mock at `docs/design/motivation-layout-mock.html` remains the target look.
> Read the rest of this section as the design intent for the remaining work.

`motivation-pdf.service.ts` draws the whole document with pdfkit, placing every line by
hand from constants in `motivation-pdf-chrome.ts` (`PAD_X`, `SECTION_INDENT`, banner
heights). That is a typesetter written from scratch, and the symptoms on MO000071 are what
hand typesetting always produces: headings that are just a paragraph with a number in
front, no control of widows and orphans, justified text with rivers, a table that lands
after the summary because that is where the cursor was, and a watermark drawn as glyphs.
No amount of constant-tuning fixes that; the missing piece is a layout engine.

**Change the renderer.** The motivation body, contents page, annexure dividers, statute
block, clippings pages and the take-with-you sheet are rendered from an HTML/CSS template
by headless Chromium (Playwright, already a dev dependency in the frontend; add it to the
backend or run a small render worker). `docs/design/motivation-layout-mock.html` IS the
template: its stylesheet is the spec in §3 to §6, `@page` sets A4 and margins, running
header and footer are positioned elements, tables break with `page-break-inside: avoid`,
`orphans`/`widows` are CSS properties, fonts are web fonts embedded at print. Contents page
numbers come from a two-pass render (render, read page map, render again) or from
`target-counter()` where supported.

pdf-lib stays for what it is good at: filling the SAPS 271 AcroForm, stamping annexure
letters and page numbers on the applicant's uploaded copies, and merging everything into
one file. pdfkit goes.

This is a one-module swap: `motivation-render.service.ts` produces HTML from the fact pack
(it already produces the structure plan), Chromium prints it, `motivation-pdf-merge.ts`
does what it does now. The 271 overlay and the vault-copy stamping are untouched.

Owned-firearms rows and 271 item 2.1 rows come from the same `arsenal[]`.
