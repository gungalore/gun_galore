# The Bench — build spec (handoff)

**Status:** ready to build · 2026-09-02
**Design:** https://claude.ai/code/artifact/d17c9776-658a-4f2c-89b6-c27f4360be9a (two working screens)
**Prototype source (the visual and behavioural spec):** `Main.dc.html` (desktop 1440) and `Pwa.dc.html` (installed app 390) in this folder. Read both before writing any UI. Their inline styles ARE the spec; every value in them was lifted from `frontend/app/globals.css` and the shell components.
**Product brief:** `C:\Users\gerha\Downloads\the-bench\SPEC.md` (the operator's; sections 4.3, 6 and 12 are the ones this spec leans on). Data in `C:\Users\gerha\Downloads\the-bench\data\`.

This document is written for a Claude Code session working in **this worktree** (`C:\dev\gun-galore`, branch `feat/takealot-ux-parity`) while other work is in flight. Section 1 says how to stay out of its way.

---

## 1. Worktree rules — read first

- **Other sessions are active in this checkout.** `git status` shows untracked Desk work (`backend/src/desk/`, `frontend/app/admin/desk*`, `frontend/components/desk/`, `frontend/lib/desk-*.ts`, `frontend/scripts/desk-*.cjs`, `overlays/`) and the competency/fee work described in CLAUDE.md. **Never edit, stage, stash or delete any of those.** The backend `tsc` gate is red for reasons CLAUDE.md explains; leave it.
- **Only create files under these paths.** Everything for The Bench is new:
  - `backend/src/bench/**` (module, controllers, services, DTOs, specs)
  - `backend/src/bench/scripts/**` (import + parse scripts)
  - `backend/prisma/migrations/<timestamp>_bench/migration.sql` (additive only)
  - `frontend/app/bench/**`
  - `frontend/components/bench/**`
  - `frontend/lib/bench/**`
  - `docs/design/the-bench/**`
- **Shared files you may touch, one line each, and nothing else in them:**
  - `backend/src/app.module.ts` — add `BenchModule` to imports.
  - `backend/prisma/schema.prisma` — append the new models at the END of the file under a `// ─── The Bench ───` banner. Do not reorder or reformat anything above.
  - `frontend/lib/shell-routes.ts` — add `['/bench', 'The Bench']` to `PUSH_TITLES`.
  - `frontend/lib/account-menu-data.ts` — add `{ href: '/bench', label: 'The Bench', Icon: CartridgeIcon }` directly under the Load Lab entry (line ~228).
- **Prisma:** write a real migration and run `npx prisma migrate dev --name bench` locally, then `npx prisma generate`. **Never `prisma db push`** (the tsvector-column trap in CLAUDE.md). All new tables; no changes to existing models.
- **Do not deploy.** Deploy is the operator's `deploy now` command in their own session. Leave the working tree committed on a branch off `feat/takealot-ux-parity` named `feat/the-bench`; do not push unless asked.
- **Commit only your own paths**: `git add backend/src/bench frontend/app/bench frontend/components/bench frontend/lib/bench docs/design/the-bench backend/prisma/migrations/<yours> backend/prisma/schema.prisma backend/src/app.module.ts frontend/lib/shell-routes.ts frontend/lib/account-menu-data.ts` — never `git add .`.
- **Gates before you say "done":** `cd frontend && npx tsc --noEmit >/dev/null 2>&1 && echo CLEAN`; `cd backend && npx nest build` (spec files are excluded from the build); the backend `tsc --noEmit` red count must not grow beyond the 17 errors already documented in CLAUDE.md.

---

## 2. What it is

One screen at `/bench`, members only, reached from Account → The Bench. A reloader keeps a **bench** (powders, bullets, cartridges they own). The screen answers "what can I load from what is on my shelf" as a list of **consolidated loads**, and everything else opens on top of that screen: a load's card, the cartridge's spec card (2D drawing, 3D lathe, half section), the log-a-load form, the load log, the add-a-powder picker. There are no sub-pages.

**Non-negotiable copy rules (operator, 2026-09-02):** nothing on any Bench surface names where a figure comes from. No "manual", no "CIP", no "SAAMI", no "published", no source counts. Wording is **start charge / max charge**, **Dimensions**, **Pmax**, **the maximum** (for COAL). Powder and bullet MAKER names (Hodgdon, Hornady, Somchem, PMP) are product facts and stay. The one safety line, verbatim, on the results screen and on every load card: **"Work every load up from the start charge while watching for pressure signs."** Also on the results screen, once: **"Velocities are indicative only."** No "escrow" anywhere (site rule).

**Units:** metric first with imperial in brackets everywhere — `732 m/s (2400 fps)`, `48.77 mm (1.920″)`, `4 350 bar (63 092 psi)`. Charges stay in grains. A `units` preference (`metric` | `imperial`) flips the order; store it on the bench record.

---

## 3. Data

### 3.1 Inputs (one-off import, operator's machine → server)

| File | Rows | Use |
|---|---|---|
| `data/consolidated_loads.csv` | 51,551 | source rows, internal only |
| `data/cartridge_reference.csv` | 256 | one row per cartridge name variant; alias table + L3/L6/Pmax |
| `data/CIP_TDCC_Cartridge_Dimensions_Combined.pdf` | 628 pp | dimension sheets; **already split per cartridge on the box** — see 3.4 |

Facts the build must respect (verified against the files on 2026-09-02, and the brief's own §3 is wrong on two of them):

- Join key is `cartridge_european`. `cartridge_saami` is blank on 12,325 rows. `cartridge_as_printed` is display/alias only.
- **Somchem IS in the data**: 612 rows, `source_manual = "Somchem — somchemreload.com"`, `source_page = 0`, powders S321/S335/S355, ~40 cartridges. Import them like any other rows.
- **`compressed_load` and `case_brand` are empty on all 51,551 rows.** Import the columns, expose nothing that depends on them. There is no compressed toggle in the UI.
- `bullet_manufacturer` mixes `HDY/SRA/NOS` with `Hornady/Sierra/Nosler`; Hodgdon rows put the maker inside `bullet_type` (`HDY ELD-M`, `SIE HPBT`) with `bullet_manufacturer` blank. Normalise both.
- Powder names differ in case and spacing (`H4350` / `H 4350`, `N160` / `N-160`, `VARGET` / `Varget`).
- `bullet_weight_gr` is `140` in some manuals and `140.0` in others; parse as float.
- No row has pressure or barrel length. Velocities were measured in different barrels; hence the one-line "indicative only" note.
- 2,041 rows carry `cartridge_name_source ≠ verified`; keep a boolean, show nothing for it in v1.

### 3.2 Canonical tables (Prisma, all new, additive)

```prisma
// ─── The Bench ─────────────────────────────────────────────────────────
model BenchCartridge {
  key            String   @id            // cartridgeKey(cartridge_european) from load-lab/recommended-loads.service — SAME helper as CartridgeSpec.cartridgeKey so the two join
  name           String                  // cartridge_european as printed by the reference file, e.g. "6,5 Creedmoor"
  slug           String   @unique        // url slug, e.g. "6-5-creedmoor"
  type           String?                 // "1 rimless" etc. from cartridge_reference.cartridge_type
  origin         String?
  year           Int?
  caseLengthMm   Float?                  // L3
  maxLengthMm    Float?                  // L6 — the COAL ceiling
  pmaxPsi        Int?
  pmaxBar        Int?                    // psi / 14.5038, rounded
  aliases        BenchCartridgeAlias[]
  dims           BenchCipDimension?
  loads          BenchLoad[]
  sources        BenchSourceLoad[]
}
model BenchCartridgeAlias { id String @id @default(cuid()); cartridgeKey String; cartridge BenchCartridge @relation(fields:[cartridgeKey], references:[key]); printed String; @@unique([printed]) }

model BenchPowder { id String @id @default(cuid()); name String @unique; maker String?; aliases BenchPowderAlias[]; loads BenchLoad[] }
model BenchPowderAlias { id String @id @default(cuid()); powderId String; powder BenchPowder @relation(fields:[powderId], references:[id]); printed String @unique }

model BenchBulletMaker { id String @id @default(cuid()); name String @unique; aliases String[] }   // ["HDY","Hornady"]

// Internal. Never exposed by any endpoint. One row per CSV row.
model BenchSourceLoad {
  id            String  @id @default(cuid())
  cartridgeKey  String
  cartridge     BenchCartridge @relation(fields:[cartridgeKey], references:[key])
  printedName   String
  nameVerified  Boolean
  bulletMaker   String?         // canonical
  bulletType    String          // raw string as printed
  bulletCategory String         // FMJ | HP | SP | BT | TIP | CAST | MONO | OTHER (mapping table in code)
  weightGr      Float
  powderId      String
  startGr       Float
  startFps      Int?
  maxGr         Float
  maxFps        Int?
  coalMm        Float?
  source        String          // source_manual (internal audit only)
  sourcePage    Int?
  needsReview   String?
  loadId        String?         // the consolidated load this row was folded into
  load          BenchLoad? @relation(fields:[loadId], references:[id])
  @@index([cartridgeKey, weightGr])
}

// Public. One row per cartridge + bullet maker + weight + bullet category + powder.
model BenchLoad {
  id             String  @id @default(cuid())
  cartridgeKey   String
  cartridge      BenchCartridge @relation(fields:[cartridgeKey], references:[key])
  bulletMaker    String
  bulletType     String          // the most common raw type string in the group, for display ("ELD Match")
  bulletCategory String
  weightGr       Float
  powderId       String
  powder         BenchPowder @relation(fields:[powderId], references:[id])
  startGr        Float           // LOWEST start in the group
  startFps       Int?            // the velocity printed beside that start
  maxGr          Float           // HIGHEST max in the group
  maxFps         Int?            // the velocity printed beside that max
  coalMm         Float?          // the COAL printed beside the highest max, else the group's most common
  coalLoMm       Float?          // set only when the group's COALs span > 0.5 mm
  coalHiMm       Float?
  sourcesCount   Int             // internal; never serialised
  sources        BenchSourceLoad[]
  @@unique([cartridgeKey, bulletMaker, weightGr, bulletCategory, powderId])
  @@index([powderId])
}

model BenchCipDimension {
  cartridgeKey String @id
  cartridge    BenchCartridge @relation(fields:[cartridgeKey], references:[key])
  // CARTRIDGE MAXI — values in mm and degrees exactly as printed, tolerance kept as text
  R Float?  R1 Float?  R3 Float?  E Float?  E1 Float?  eMin Float?  f Float?  beta String?
  P1 Float?  P2 Float?  alpha String?  S Float?  r1Min Float?  r2 Float?
  H1 Float?  H2 Float?  G1 Float?  G2 Float?  F Float?  L1 Float?  L2 Float?  L3 Float?  L4 Float?  L5 Float?  L6 Float?
  pmaxBar Int?  pkBar Int?  peBar Int?  M Float?  EE Float?
  // CHAMBER MINI
  cL1 Float?  cL2 Float?  cL3 Float?  cP1 Float?  cP2 Float?  cH1 Float?  cH2 Float?  cG Float?  cAlpha1 String?  cH Float?  cS Float?  cI String?  cW Float?
  // Barrel
  bF Float?  bZ Float?  bB Float?  bN Int?  bU Float?  bQ Float?
  tolerances Json?      // { "L1": "-0.20", ... } as printed
  footnotes  Json?      // { "L3": "1", "P1": "*" }
  rawText    String  @db.Text   // the page's text block, for audit
  tab        String?  sheetDate String?  revision String?
  imageOnly  Boolean @default(false)
}

model UserBench {
  userId     String   @id            // User.id (Clerk-backed)
  powderIds  String[]
  bullets    Json                    // [{ maker, weightGr, category, type }]
  cartridgeKeys String[]
  units      String   @default("metric")
  updatedAt  DateTime @updatedAt
}

model BenchLogEntry {
  id           String   @id @default(cuid())
  userId       String
  cartridgeKey String
  bulletLabel  String
  powderName   String
  chargeGr     Float
  coalMm       Float?
  primer       String?
  caseLabel    String?
  loadId       String?               // the consolidated load it was based on, nullable
  shotAt       DateTime @default(now())
  velocityMs   Int?
  groupMm      Float?
  notes        String?  @db.Text
  createdAt    DateTime @default(now())
  @@index([userId, createdAt])
}
```

### 3.3 Import script — `backend/src/bench/scripts/bench-import.ts`

Run with `npx ts-node -r tsconfig-paths/register src/bench/scripts/bench-import.ts --dir <data dir>` (mirror how `src/reloading/scripts/extract-loads.ts` is invoked). Steps, in order, idempotent (upsert by natural keys):

1. **Cartridges** from `cartridge_reference.csv`: one `BenchCartridge` per distinct `cartridge_european`; every row's `cartridge_as_printed` becomes an alias. Key with `cartridgeKey()` from `backend/src/load-lab/recommended-loads.service.ts`. Slug: lower-case, `,`→`-`, spaces and `.`→`-`, collapse dashes (`6,5 Creedmoor` → `6-5-creedmoor`).
2. **Powders**: canonical name = collapse whitespace and dashes, upper-case letters, keep digits (`H 4350`→`H4350`, `N-160`→`N160`, `Alliant RL-15`→`RL15` with maker Alliant, `NORMA 203 B`→`NORMA203B`). Display name is the most common printed form. Every printed form is an alias.
3. **Bullet makers**: alias table seeded in code: `{HDY:Hornady, SRA:Sierra, NOS:Nosler, SPR:Speer, BAR:Barnes, BER:Berger, SIE:Sierra, SFT:Swift, LAP:Lapua, WIN:Winchester}`. When `bullet_manufacturer` is blank, take the first token of `bullet_type` if it is an alias, and strip it from the type.
4. **Bullet category** mapping (regex on the raw type, first match wins): `FMJ|TMJ`→FMJ · `ELD-X|SST|InterLock|SP|Spitzer|Partition|A-Frame|TOG|Classic Hunter|Ballistic Tip|V-MAX|TTSX|TSX|GMX|CX`→ see table in code (TIP for polymer tips, MONO for TSX/TTSX/GMX/CX/Classic Hunter, SP for the rest) · `HPBT|BTHP|ELD-M|ELD Match|Match|Scenar|HP`→HP · `L\)|cast|RNGC|LSWC`→CAST · else OTHER. Uncertain → OTHER, which forms its own group (brief §4.3).
5. **Source rows** → `BenchSourceLoad` (all 51,551).
6. **Consolidation** → `BenchLoad` per brief §4.3, exactly: group key `(cartridgeKey, bulletMaker, weightGr, bulletCategory, powderId)`; `startGr = min(start)`, `startFps` = the fps on that same row; `maxGr = max(max)`, `maxFps` = the fps on that row; `coalMm` = COAL on the max row, else the group's most common; if the group's COALs span more than 0.5 mm set `coalLoMm/coalHiMm`. Rows with `start == max` (single-charge rows, e.g. Speer 55 gr in 223) consolidate normally.
7. **Report** to stdout and `bench-import-report.json`: cartridges without a reference match, unresolved powder aliases, groups with a single source, groups where `max − start > 10% of start` (brief §9 step 4 says review these by hand).

Expected sanity numbers to print: 868 source rows for `6,5 Creedmoor`; 1,901 for `308 Win.`; 1,717 for `223 Rem.`; 612 Somchem rows.

### 3.4 CIP dimension parser — `backend/src/bench/scripts/bench-cip-parse.ts`

The combined PDF is **already split per cartridge on the production box** by `backend/src/motivations/cip-sheet.service.ts` (`CIP_SHEETS_DIR`, default `/home/alloutdoor/data/cip`, indexed by `backend/src/motivations/cip-index.json`, exact-key match only). Reuse that index; do not split again. For each sheet run `pdftotext -layout` (or pdf-parse, which the reloading module already uses), detect `CARTRIDGE MAXI`, and fill `BenchCipDimension` per brief §12.1 (values as printed, mm and bar, no conversion). Five sheets have no text layer → `imageOnly = true`. Report: sheets found, fields parsed per sheet, sheets that failed, names that did not match.

Until this script has run, the spec card shows the drawing from the reference file's L3/L6 only where a full sheet is missing, and the "For the reloader" chamber rows show bracketed placeholders exactly as the prototype does (`[chamber L2] vs 41.52 mm`). Never invent a chamber figure.

---

## 4. API — `backend/src/bench/` (NestJS `BenchModule`)

All under `/api/bench`. Guards: reads use `OptionalClerkGuard` (never rejects; stamps `request.clerkUserId`); bench and log writes use `ClerkGuard`. Follow `load-lab.controller.ts` for shape and `viewerFetch` on the client — **never cache a response that varies by viewer** (CLAUDE.md).

| Method + path | Auth | Purpose | Response |
|---|---|---|---|
| `GET /bench/me` | member | the caller's bench, or a default empty one | `{ powders:[{id,name,maker}], bullets:[…], cartridges:[{key,name}], units }` |
| `PUT /bench/me` | member | replace the bench | same |
| `GET /bench/loads` | optional | consolidated loads that can be built from the bench | see below |
| `GET /bench/powders?q=` | optional | canonical powder list for the picker, with per-powder `loadsForBench` count when signed in | `[{id,name,maker,loadsForBench}]` |
| `GET /bench/cartridges/:key` | optional | spec card | `{ cartridge, dims, stations, shellHolderGroup:[…], loadCount, loadsForBench }` |
| `GET /bench/log` · `POST /bench/log` · `DELETE /bench/log/:id` · `GET /bench/log.csv` | member | load log | rows as `BenchLogEntry` minus `userId` |
| `POST /bench/share` · `GET /bench/share/:token` | optional | permalink for a query (stores the filter object; 90-day TTL) | `{ token, url }` |

`GET /bench/loads` query: `cartridgeKey?`, `weightMin?`, `weightMax?`, `powderId?`, and — for guests, who have no stored bench — `powders[]`, `bullets[]` (`maker|weight|category`), `cartridges[]`. Response:

```json
{ "count": 12, "groups": [ { "cartridge": { "key": "65creedmoor", "name": "6,5 Creedmoor", "maxLengthMm": 71.76, "pmaxBar": 4350, "pmaxPsi": 63092, "thumb": {…dims subset for the silhouette…} },
    "weights": [ { "weightGr": 140, "rows": [ { "id": "…", "bulletMaker": "Hornady", "bulletType": "ELD Match", "powder": "H4350", "startGr": 35.6, "startFps": 2400, "maxGr": 41.5, "maxFps": 2700, "coalMm": 71.12, "coalLoMm": null, "coalHiMm": null, "flags": ["COAL_NEAR_MAX","COAL_RANGE"] } ] } ] } ] }
```

Sort: cartridge (bench order), then weight ascending, then powder name. **Never serialise `sourcesCount`, `BenchSourceLoad`, or any source/manual/page field.** Add a unit test that asserts the JSON of every public endpoint contains none of the strings `source`, `manual`, `page`, `CIP`, `SAAMI`, `published`.

Flags are computed server-side against `BenchCartridge.maxLengthMm`: `COAL_OVER_MAX` (coal > L6), `COAL_NEAR_MAX` (L6 − coal ≤ 0.5 mm, using `coalHiMm` when set), `COAL_RANGE` (lo/hi set). The client renders them as the mono tags in the prototype (`COAL −0.13 MAX`, `COAL OVER MAX`, `COAL RANGE`).

The **components strip** (brief §5) is **out of v1**: which reloading components may be listed is an open legal item, and the site's public/members gate must not be widened for it.

---

## 5. Frontend — `frontend/app/bench/page.tsx` + `frontend/components/bench/*`

### 5.1 Route and chrome

- `app/bench/page.tsx` is a client page like `app/load-lab/page.tsx`: `<main className="mx-auto px-4" style={{ maxWidth: 'var(--page-max)' }}>`. Not in `middleware.ts`'s public list, so Clerk requires a session (the brief's guest bench is deferred; the public spec pages are phase 2, below).
- Desktop: the site header stays; the tool bar under it is the page's own (`Main.dc.html`, "Tool bar" block). Height 64, `border-bottom: 0.5px solid var(--border-divider)`.
- Installed app (standalone): the shell renders the push header from `PUSH_TITLES` (`The Bench`) and the tab bar; the page renders the tool strip from `Pwa.dc.html`. Use `lib/use-standalone.ts` to pick the layout, not a width query, so the phone web view keeps the desktop tool bar collapsed sensibly (`md:` breakpoint for rail vs sheet).

### 5.2 Components (one file each under `components/bench/`)

| Component | Source in prototype | Notes |
|---|---|---|
| `BenchRail` | `Main.dc.html` "Bench rail" card | 280px fixed, desktop only. Chips toggle inclusion for THIS search without editing the saved bench (`off` set in URL state). |
| `BenchSheet` | `Pwa.dc.html` "My bench sheet" | Mobile: same content in a bottom sheet behind the **My bench** button, which shows `powders · bullets · cartridges` counts. |
| `ResultsList` | "Results" | Scrolls inside its own container; groups by cartridge with the silhouette thumbnail (`CartridgeThumb`), then weight sub-headers, then rows. Desktop rows are a 7-column grid (`1.4fr 1fr 1fr 1fr 0.8fr 1.1fr 28px`); mobile rows are the card with two figure tiles. |
| `LoadCard` | "Load card" | Desktop: centred modal 760px. Mobile: bottom sheet. Contents: two figure tiles (start / max, 28px Archivo 600 tabular), COAL gauge, charge-vs-velocity chart, buttons **Log this load** (red) · **Cartridge spec** · share. Footer: the safety line. |
| `CoalGauge` | inside LoadCard | Track from `L6 − 4 mm` to `L6`; amber zone = last 0.5 mm; pin colour `var(--success)` or `var(--warning)`. Text: `COAL 71.63 mm` · `0.13 mm under the maximum · check`. |
| `LoadChart` | inside LoadCard | SVG 340×220. One line start→max, series colour `#2a78d6`, 2px, 4.5px markers with 2px white ring, axis labels `m/s` / `charge, gr`, caption "the line joins the start and max points only". Draw-in animation (see §8). |
| `SpecCard` | "Spec card slide-over" / "Spec card, pushed in" | Desktop: 720px sheet from the right. Mobile: full-screen push with its own 54px header (back + name + mm/inch). Sections: view segmented (2D · 3D lathe · Half section), drawing, Dimensions table (hover on desktop, tap on mobile, both link to the drawing via the letter), For the reloader, Loads (count + same-shell-holder chips + **Show only X** button). |
| `CartridgeDrawing2D` | the `<svg viewBox="0 0 560 250">` block | Pure function of the dims: profile → mirrored path; lengths L1 L2 L3 L6 stacked below at 17px pitch; diameters R1 P1 P2 H1 G1 above at three levels; shoulder arc α. Hot letter in `var(--red)` with 1.5px stroke and 600 weight. Port `profile()` and the layout code from the prototype verbatim; it is already parameterised on the dims object. |
| `CartridgeThumb` | `thumbOf()` | 128×30 (desktop) / 96×24 (mobile) silhouette, no dimension lines. |
| `LatheView` | `drawLathe()` and friends | **Rebuild with three.js** (`npm i three`, dynamic `import()` on first switch to 3D; fall back to the 2D drawing when WebGL is unavailable). Behaviour to match the prototype exactly — see §6. The prototype's canvas-2D renderer exists only because the design sandbox blocks script hosts; do not port it. |
| `LogSheet` | "Log this load" | Pre-filled from the load: cartridge, bullet, powder (read-only), charge = start, COAL = the load's COAL, primer, case, date. Live flags: `ABOVE MAX 41.5` (warn), `BELOW START 35.6`, COAL flags as on rows. Save → `POST /bench/log`, toast `Logged · 6,5 Creedmoor · H4350 35.6 gr`, Load log badge pulses. |
| `LogList` | "Load log list" | Rows + delete + **Export CSV** (`GET /bench/log.csv`). |
| `PowderPicker` | "Add a powder" | Search box filters the canonical list; each row shows maker and `n loads on your bench`; tap adds and closes, toast `H4831SC added to your bench`. |
| `Toast` | `.toast` | 2.2 s, bottom-centre (desktop) / above the tab bar (mobile). |

### 5.3 Tokens

Everything is a `globals.css` token; the prototype inlines the resolved values. Map back when you build:

| Prototype value | Token |
|---|---|
| `#FFFFFF` page/card | `--bg`, `--bg-card` |
| `#F4F2EC` | `--bg-inset` (chips, tiles, selects) |
| `#FAF9F5` | `--bg-card-hover` |
| `#DDD8CC` / `#EDEAE1` | `--border` / `--border-divider` |
| `#C8102E` / `#A00D24` | `--red` / `--red-hover` — CTA, active tab/pill, hot dimension, log badge, calliper ring. Nowhere else. |
| `rgba(200,16,46,0.09)` | `--red-wash` (hot table row) |
| `#B10E28` | `--link` |
| `#1A1613 / #4A443C / #7A7267 / #9C948A` | `--text-primary / -secondary / -tertiary / -faint` |
| `#1F7A50` / `#8F6E0F` | `--success` / `--warning` (COAL pin; warn tags use `--gold-wash` + `--gold-line`) |
| `'Public Sans'` / `'Archivo'` | `--font-sans` / `--font-head` (both self-hosted already) |
| `ui-monospace, Consolas` | new token `--font-mono` is NOT defined; use the same fallback stack inline, as Load Lab does |
| radii 6 / 8 / 999 | `--r-sm` / `--r-md` / pill |
| `0 2px 4px … 0 22px 48px rgba(26,22,19,…)` | `--elev-2` |
| `cubic-bezier(0.22,1,0.36,1)` / `(0.4,0,0.2,1)` | `--ease-out` / `--ease-standard` |
| 120 / 200 / 300 / 420 ms | `--dur-press` / `--dur-fast` / `--dur-base` / `--dur-sheet` |

**Shadow trap:** `* { box-shadow: none !important }` is global. The prototype's inline `box-shadow` on `.modal` / `.sheet` will render as nothing in the app. Add ONE rule to `globals.css` is not allowed (shared file); instead give the overlay a class in `components/bench/bench.css` (imported by the page) declared as `.bench-overlay { box-shadow: var(--elev-2) !important; }`, the same way `.gg-tile` opts in. The `.bump` pulse uses `box-shadow` too; declare it with `!important` in the same file.

Type ramp used: page title 28/Archivo 600 (24 on mobile); card/section titles 15/Archivo 600; body 13; table header 11/500 uppercase `letter-spacing: .02em`; tags 10.5 mono; figures 28 (desktop) / 26 (mobile) Archivo 600 `tabular-nums`. Every number column carries `.gg-nums`.

### 5.4 Layout

| Breakpoint | Layout |
|---|---|
| ≥ 1024 (desktop web) | tool bar row; rail 280 + results flex-1, gap 16; results panel scrolls internally at `calc(100vh − var(--nav-h) − 64px − 14px)`; overlays are modals / right sheet. |
| 768–1023 | rail collapses to the **My bench** sheet button (mobile tool strip), results full width, desktop overlays. |
| < 768 web | as `Pwa.dc.html` without the tab bar (the web nav stays). |
| standalone | exactly `Pwa.dc.html`: push header, tool strip, results, safety line, tab bar. Root is a flex column at `100dvh`; results scroll inside. |

---

## 6. Behaviour

### 6.1 Finder

- **Bench chips** toggle inclusion for this search; off = dashed border, `--text-faint`, grey dot. Results and the count recompute immediately. Nothing is saved until the member edits the bench in the sheet/rail's **Add** flows (which do `PUT /bench/me`).
- **Cartridge filter** segmented: `All` + each bench cartridge. **Weight** segmented: `Any gr · ≤ 100 gr · 100–150 gr · 150 gr +`.
- **Empty state** (no group): title "Nothing on the shelf builds this", line "Turn a chip back on, widen the weight range, or add a powder.", **Reset filters** button.
- **Permalink**: `POST /bench/share` with the current filters + the bench snapshot; copy the URL; toast `Permalink copied`. Opening `/bench?s=<token>` applies it.
- **Group header click** opens the spec card. **Row click** opens the load card. Hover on desktop tints the row `--bg-card-hover` and reveals the chevron.

### 6.2 Load card

Fields, order and copy as in the prototype. **Cartridge spec** closes the card and opens the spec card for that cartridge. **Log this load** opens the log sheet on top of the card. The card's footer carries the safety line. Escape / backdrop closes the top-most overlay only.

### 6.3 Spec card

- Header: name; `Rimless · United States · 2012` (type, origin, year) — no TAB/revision chips.
- **2D**: drawing + Dimensions list (`R1 R E1 E P1 P2 L1 L2 L3 H1 H2 G1 L6 α`). Hover a row/dimension on desktop, tap on mobile → the letter goes red in both.
- **mm / inch** segmented: primary unit swaps and the other is bracketed (`48.77 mm (1.920″)` ↔ `1.920″ (48.77 mm)`); drawing labels show the primary only.
- **3D lathe** (three.js `LatheGeometry` from the same profile; brass `MeshStandardMaterial` for the case, copper for the bullet; `renderer.localClippingEnabled` for the section):
  - Model spins about its own axis (auto at rest, ~0.7 rad/s; a drag flick sets the velocity and it eases back to the idle rate). Vertical drag tilts the axis ±0.5 rad. Pointer capture on the canvas; `touch-action: none`.
  - **Dimensions** stay in the plane through the axis that faces the camera, drawn as lines with `depthTest: false` and high `renderOrder`; labels as HTML positioned by projecting anchors each frame (no CSS2DRenderer). Toggle button.
  - **Calliper**: one ring on the axis, driven by the slider under the canvas (0 … L6, 0.1 mm steps) or by dragging the ring; snaps within 1.3 mm to the stations `R1 (0.7) · E1 (E−1.4) · P1 (E+3) · P2 (L1−0.8) · H1 (L2+3.5) · H2 (L3−0.6) · G1 (L3+3)` and the length marks `L1 L2 L3 L6`. Snapped: label `P2 = 11.74 mm`, `37.8 mm from the head`, and the letter is set hot so the table row highlights. Off a station: `Ø 11.81 mm`, `30.0 mm from the head`. Small hotspot dots mark the diameter stations; the snapped one is red.
  - **Half section**: clipping plane through the axis facing the camera; the cap on the cut face is the mirrored 2D profile drawn flat (outer profile minus an interior). The interior profile is illustrative: solid web to `E + 4.2`, primer pocket r 2.7 × 3.2 deep, flash hole r 0.95, wall thinning from 0.75 to 0.33 mm toward the neck, bullet seated 7 mm into the neck. Hatch the brass section. Spin is disabled in this mode (the cut always faces you); tilt still works. **Chamber ghost** (brief §12.2) waits for `BenchCipDimension.c*` values — render it only when they exist.
  - **Show all**: freezes side-on (spin 0, tilt 0), dimensions on, calliper cleared, and exports a PNG (`canvas.toBlob`) named `<slug>-dimensions.png` with the cartridge name in the corner. Toast `Snapshot saved`.
  - Fallback: no WebGL → stay on 2D and hide the 3D/Half options.
- **For the reloader** rows: `Pmax` (`4 350 bar (63 092 psi)`), `u` proof-barrel twist (`203 mm (1:8″)`), `L2` shoulder headspace band (`[chamber L2] vs 41.52 mm` until parsed), `H1` neck clearance (same pattern). Copy under the title: "The cartridge standard, not your rifle."
- **Loads** box: count (all loads for the cartridge) + `n from your bench`; same-shell-holder chips (group by `R1`, `R`, `E1` within ±0.05 mm — no manufacturer numbers); **Show only <name> in the finder** applies the cartridge filter and closes the card.
- Drawing note, verbatim: "Drawn to scale. The bullet ogive is illustrative: only the bullet diameter G1 and the overall length L6 are fixed."

### 6.4 Log

Sheet and list as in §5.2. `POST /bench/log` validates `chargeGr > 0`, `coalMm` optional; the server also returns the computed flags so the list can show them. CSV columns: `date, cartridge, bullet, powder, charge_gr, coal_mm, primer, case, velocity_ms, group_mm, notes`.

---

## 7. States

| Element | State | Behaviour |
|---|---|---|
| Bench chip | on / off / pressed | `--bg-inset` + green dot / white + dashed + faint / `scale(.96)` for `--dur-press` |
| Segmented pill | active | `--red` fill, white, 600 |
| Row | hover (desktop) | `--bg-card-hover`, chevron fades in and slides 4px |
| Group header | hover | thumbnail slides 4px right; "Spec card ›" fades in |
| Load log button | has entries / new entry | red count badge / `.bump` pulse once (600 ms) |
| Results | loading | six skeleton rows using `.gg-skeleton` (existing class), keep the tool bar live |
| Results | error | inline card: "The bench could not load. Try again." + retry button; never a blank panel |
| Spec card | loading | header immediately from the group data; drawing skeleton 560×250 until `/bench/cartridges/:key` returns |
| 3D canvas | no WebGL | option hidden, 2D shown |
| Log sheet | invalid charge (empty / NaN) | Save disabled; no red border, just the disabled button |
| Toast | any | 2.2 s, one at a time, last wins |

---

## 8. Motion

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Rows | list (re)render | `rise`: opacity 0→1, translateY 6→0, 35 ms stagger per row | 300 ms | `--ease-out` |
| Backdrop | overlay open | opacity 0→1; `backdrop-filter: blur(3px)` | 200 ms | `--ease-standard` |
| Modal (desktop) | open | `pop`: translateY 14→0, scale .96→1, opacity | 320 ms | `--ease-out` |
| Right sheet (desktop spec) | open | `slide`: translateX 48→0, opacity | 420 ms | `--ease-out` |
| Bottom sheet (mobile) | open | `sheetUp`: translateY 40→0, opacity | 420 ms | `--ease-out` |
| Push screen (mobile spec) | open | `pushIn`: translateX 100%→0 | 420 ms | `--ease-out` |
| Chart line | card open | stroke-dashoffset draw-in, then markers/labels fade at +800 ms | 700 ms | `--ease-out` |
| COAL pin | load change | `left` transition | 420 ms | `--ease-out` |
| Toggle knob | tap | `left` 2→16 px | 200 ms | `--ease-out` |
| Log button | save | `pulse` ring 0→10 px, once | 600 ms | `--ease-out` |
| Lathe | idle | spin ~0.7 rad/s; drag sets velocity, eases back | — | — |

`prefers-reduced-motion: reduce` → all of the above collapse to 1 ms and the lathe does not auto-spin.

---

## 9. Accessibility

- Overlays are `role="dialog" aria-modal="true"` with a labelled title; focus moves to the title on open and returns to the opener on close; Tab is trapped inside; Escape closes the top-most only. Backdrop click closes.
- Chips are `<button aria-pressed>`; segmented controls are `role="tablist"` / `role="tab" aria-selected` (copy `SubViewToggle` in `app/load-lab/LoadLabPanel.tsx`).
- Rows are buttons (`<button>` wrapping the grid, or `role="button" tabIndex=0` with Enter/Space).
- Calliper slider is a native `<input type="range">` with `aria-valuetext` = the readout text. The 3D canvas has `aria-label="3D view of <name>; use the slider to measure"` and is not the only way to any information (the table carries every figure).
- Tag text is real text, not colour alone (`COAL −0.13 MAX`).
- Tap targets ≥ 44 px on mobile (pills 44, chips 40 with 4 px gap — acceptable, buttons 44, inputs 44 at 16 px type so iOS does not zoom).

---

## 10. Phase 2 (not in this build, do not start)

- Public, static, indexable `/reloading/cartridges/[slug]` pages reusing `SpecCard` with `generateStaticParams` over `BenchCartridge`. **Before shipping, confirm with the operator** that a public page titled "<cartridge> dimensions and load data" is acceptable under the Public vs Members rules in CLAUDE.md (Meta has restricted the site twice; reloading components are members-only). The page must go through `OptionalClerkGuard` and show no listings.
- Guest bench (session-only, sign-in prompt to keep it).
- Overlay comparison (brief §12.3) — `CartridgeDrawing2D` is already a pure function of the dims, so this is a second call with an offset and a delta table.
- Somchem burn-rate neighbour table (admin-editable) and the components strip.

---

## 11. Acceptance checklist

- [ ] Migration applied locally with `migrate dev`; `schema.prisma` diff is append-only.
- [ ] Import report printed; the 6,5 Creedmoor / 308 Win. / 223 Rem. counts above match.
- [ ] `GET /bench/loads` for a bench of `H4350, Varget, S321, N160, H335` + `Hornady ELD Match 140, Sierra HPBT 168, PMP SP 168, Hornady V-MAX 55` + the three cartridges returns the rows the prototype hardcodes (e.g. 6,5 Creedmoor · ELD Match · H4350 · 35.6 → 41.5 gr · 71.12 mm; W760 flagged `COAL_NEAR_MAX` at 71.63).
- [ ] A test asserts no public response body contains `source`, `manual`, `page`, `CIP`, `SAAMI`, `published`.
- [ ] Desktop and standalone layouts match the two prototypes at 1440 and 390.
- [ ] Every overlay opens on top of the finder; the URL never changes except the `?s=` permalink.
- [ ] 3D: spin, tilt, calliper snap → table highlight, half section, Show all PNG, WebGL fallback.
- [ ] `tsc` clean in `frontend`; `nest build` clean in `backend`; the documented 17 spec-file errors unchanged.
- [ ] Only the paths in §1 are in the commit.
