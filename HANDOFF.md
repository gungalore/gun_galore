# Handoff

What the last session did, where everything stands, and what the next one should
pick up. **Rules do not live here — they live in `AGENTS.md` and
`docs/project-reference.md`.** This file is state, and it is meant to be
overwritten.

Last updated: **2026-10-28**.

## 2026-10-28 - THE PACK COUNTED ANSWERS, NOT DOCUMENTS (FRONTEND-ONLY)

Deployed `a333f792` (rollback `alloutdoor-20261028-163915.dump`, 32,457,618
bytes; no migrations; health A-2 OK; public 200 A-2; three services online).

**The report.** MO000104 showed “Your pack — Done”, but Write refused with “2
required documents are still missing.”

**The cause.** `sheet.sections[].missing` carries required **answer keys** only.
The header pill, pack fold and footer all read that list, so a complete
questionnaire read as a complete pack. `generate()` uses the separate
`needs.missingRequired` document list, which held proof of address and safe
photographs.

**The fix.**
- The sheet now counts `needs.missingRequired` with the answer keys for the
  header, the “Your pack” fold and the footer. The pack folds as “2 still
  needed”, not “Done”.
- The generation toast now names the missing documents from
  `MotivationApiError.missingDocuments` instead of repeating the generic count.

**The two documents are genuinely absent.** MO000104 has 12 uploads (licences,
competency, proficiency, association, ID, source proof) but no
`ADDRESS_CONFIRMATION` or `SAFE_PHOTOGRAPHS`. The vault for this member also has
no rows of either kind — this is not a failed autolink. Upload both to clear the
gate.

**Gates.** Backend `tsc` clean; 390 suites / 5,961 passed / 8 skipped.
Frontend `tsc` clean; 159 files / 1,819 passed / 1 skipped; production build
clean.

## 2026-10-28 - A PAIRED PROFICIENCY IS NOT A DUPLICATE (FULL DEPLOY)

Deployed `b2f95848` (rollback `alloutdoor-20261028-162151.dump`, 32,439,767
bytes; no pending migrations; health A-2 OK; public 200 A-2; three services
online).

**The report.** After deleting and reuploading, the vault showed “three extra
copies”.

**The cause.** The three proficiency front pages were still carrying a stale
`duplicateOfId` pointing at their own back page. The front is usually uploaded
first and was flagged a copy before the other side arrived; pairing then set
`otherSideId` without clearing it. The list folded the pair correctly, but the
Duplicates count and the duplicate fold reported three copies that were really
three pairs.

**The fix.**
- Pairing now clears `duplicateOfId`, the `duplicate` attention code and the
  “Looks like a copy of …” note on both sides.
- A list load clears the same stale flag on rows that were already paired.
- The three existing rows were cleared in the database; duplicate flags are now
  **0**.

**One genuine oddity remains.** A lone **“Proficiency - Handgun” back page** has
no front. That is a missing side (`SIDE_MISSING`), not a copy; attach the
handgun certificate front to pair it.

**Gates.** Backend `tsc` clean; 390 suites / 5,961 passed / 8 skipped.
Frontend unchanged; `tsc` clean and the last full run was 159 files / 1,819
passed.

## 2026-10-28 - LICENCE CARD DATE RANGE, SECTION FACT, BACKFILL (FULL DEPLOY)

Deployed `8f026427` (date range) and `b23c73c6` (section fact + backfill
script). Final deploy `b23c73c6` (rollback
`alloutdoor-20261028-154059.dump`, 32,434,608 bytes; no pending migrations;
health A-2 OK; public 200 A-2; three services online).

**The report.** A licence card prints its issue and expiry as an unlabelled
range under the section, e.g. `2025-08-27 – 2035-08-26` under `SECTION 16`; the
reader looked for the words "issue" and "expiry" and returned neither. Six
licences reached the vault with no date, three competencies had the issue date
only in their details, and the banner asked the member to confirm a date the
reader had never read.

**What changed.**

- The capture, vault-read and motivation-read prompts now split the licence
  range into **Issue date** and **Expiry date**, with normalized ISO values.
- The capture also lists an unlabelled `SECTION 16` line as a **Section** fact;
  without it `mayArmReadExpiry` correctly refused to arm the dates.
- A competency's `competency_issued` detail is copied into the `issuedOn`
  column before the derived expiry runs.
- The Document Centre banner now says “we could not read a date” when
  `expiresOn` is null, instead of claiming a date was read.

**Backfill (`backend/scripts/backfill-missing-credential-dates.ts`).** Dry-run
by default; `--apply` writes. Applied to the operator's vault:
- six licences read and **armed**: CZ 6.35 Browning, Glock 9mm, Howa 6.5
  Creedmoor, Marlin .45-70, Mauser .30-06, Nordiske .223;
- three competencies had their stored issue date copied into the column and
  their derived expiry recomputed.
- The missing-date query now returns **zero** rows.

**Gates.** Backend `tsc` clean; 390 suites / 5,961 passed / 8 skipped.
Frontend `tsc` clean; 159 files / 1,819 passed / 1 skipped; production build
clean.

**Next:** upload one fresh licence and confirm the log fills both dates and
arms them without the banner. The backfill script is dry-run by default.

## 2026-10-28 - DOCUMENT CAPTURE MOVED TO FLASH-LITE WITH NO REASONING (FULL DEPLOY)

Deployed `8314ee16` (rollback `alloutdoor-20261028-150515.dump`, 32,370,523
bytes; no pending migrations; health A-2 OK; public 200 A-2; three services
online).

**The report.** A document upload was taking 30-60 seconds to read.

**The cause, from production logs.** `document.capture` was running on
`gemini-3.8-flash` with the 32,768-token OCR thinking budget:
`31513ms`, `45232ms`, and one `60002ms FAILED timeout`. It was on the request
path, so every upload waited for it; the timeout then fell back to
`vault.transcribe` and made the request longer still.

**The fix.** Capture is transcription and label/value listing, not judgement:

- `document.capture` is now in the document-purpose set, so it runs on
  `gemini-3.1-flash-lite`;
- its thinking budget is 0;
- its timeout is 30 seconds.
- Jev and the projector still make the filing/projection decisions; the tuned
  extractor remains the fallback when the core field is missing.

**Gates.** Backend `tsc` clean; 390 suites / 5,959 passed / 8 skipped.
Frontend `tsc` clean; 159 files / 1,819 passed / 1 skipped; foreground
production build clean.

**Next:** confirm the next real upload logs
`document.capture gemini/gemini-3.1-flash-lite ...` in single-digit seconds. If
flash-lite facts are consistently too thin, escalate only the missing cases to
3.8 rather than moving every page back.

## 2026-10-28 - CAPTURE PROJECTION INTO CONTAINER FIELDS (FULL DEPLOY)

Deployed `c7dcd3df` (rollback `alloutdoor-20261028-144743.dump`, 34,073,902
bytes; no pending migrations; health A-2 OK; public 200 A-2;
`alloutdoor-backend`, `alloutdoor-frontend` and `warden` online).

**What changed.** The one-pass capture is now the **first** reader, not only a
stored transcript. `DocumentProjectionService` maps its labelled facts into the
document kind's fields:

- exact and alias labels first (including Afrikaans labels, the letterhead as
  an association/issuer candidate, `NONE` component serials, and `document_side`
  reduced to `front`/`back`);
- one typed Jev `choice` per still-empty key, with the page text and facts in
  the state; confidence floor 0.6; a fact is used once;
- dates normalised to `yyyy-mm-dd` from the capture's `normalized` value or the
  printed form;
- a **core-field veto**: a licence without a serial, a dedicated document
  without an association, an ID without an id number, etc. falls back to the
  tuned extractor rather than writing a thin reading.

`LicenceCentreService.create` and `MotivationDocumentsService.addOneUpload` use
the projection first and skip the second vision read when the core field is
present. The motivation path remaps owned-firearm slots and returns the values
as `suggestions` with provenance, so the form auto-fills (including
`dedicated_since`) and `reapplyOffer` sees the same values. The old extractor
remains the fallback.

**Gates.** Backend `tsc` clean; 390 suites / 5,959 passed / 8 skipped.
Frontend `tsc` clean; 159 files / 1,819 passed / 1 skipped; foreground
production build clean.

**Next:** watch real captures against the old extractor and add aliases where
Jev is doing too much work. Once coverage is consistently complete, the second
vision read can be retired for the kinds that prove out.

## 2026-10-28 - BODY-ONLY EVIDENCE, 5.2 SUITABILITY WRITER, DOCUMENT CAPTURE (FULL DEPLOY)

Deployed `75044cc4` (rollback `alloutdoor-20261028-115634.dump`, 34,071,573
bytes; three migrations applied; health A-2 OK; public 200 A-2;
`alloutdoor-backend`, `alloutdoor-frontend` and `warden` online).

**What changed.**

- **Evidence is body content, always.** Every evidence container is now
  `placement: 'body'`; `EVIDENCE_ANNEXURE_MAX` is 0. Only DFO/CFR-required
  documents take an annexure letter. The new **Incident and crime scene** group
  adds `BREAK_IN_PHOTO`, `DAMAGE_PHOTO`, `CCTV_STILL`,
  `ARMED_RESPONSE_REPORT`, `REPAIR_QUOTE`, `STOLEN_ITEMS_LIST`, `NEWS_REPORT`
  and `NEIGHBOUR_STATEMENT`. Optional documents (activity log, incident report,
  character reference, employment letter, previous motivation, OTHER) also
  print in the body. Evidence no longer ticks a document row.
- **The 5.2 page is now written for the application.** `motivation-suitability.ts`
  builds the exact question ("Why is the Glock 43X, chambered in 9mm, suited for
  self-defence inside a townhouse?"), and the service writes 12-16 bullet facts
  in four groups, ~400 words. **Stopping power** and **over-penetration** are
  required for self-defence and hunting; velocity, energy, weight, dimensions,
  capacity and availability are refused. Result stored on `Motivation`, hashed
  for reuse, printed by `motivation-pdf.service.ts`.
- **The pack chooses its four body items.** A deterministic curator
  (`motivation-evidence-curator.ts`) ranks the application's evidence by
  purpose, container, description quality and diversity, stores the selection
  and the renderer uses it. Older rows fall back to the first four.
- **One-pass capture.** `DocumentCaptureService` reads the page once (full text
  + every printed label/value pair; plus a visual description for photographs).
  It is wired into both extract services, carried through `DocumentIdentify`,
  and stored on `Credential`/`MotivationUpload` (`captureEncrypted`,
  `captureVersion`, `captureAt`). The facts reach Jev's filing state. The
  container projection still uses the existing tuned extractor.
- **Nothing dormant enters.** Vault `create` and motivation `addUpload` refuse
  `OTHER`/null-container evidence before bytes are written; if the member gives
  words, the evidence classifier re-runs once. The motivation sheet shows an
  unplaced-upload dialog with the reason, two description attempts and a delete
  nudge after the final refusal. A mismatched endorsement is refused, not
  demoted to `OTHER`.

**Migrations.** `20261028120000_motivation_suitability`,
`20261028130000_motivation_evidence_selection`,
`20261028140000_document_capture`. All additive.

**Gates.** Backend `tsc` clean; 389 suites / 5,944 passed / 8 skipped.
Frontend `tsc` clean; 159 files / 1,819 passed / 1 skipped; foreground
production build clean.

**Next:** open one regenerated pack and check the 5.2 page and the Activities
2×2; the capture is stored but not yet used as the projection source.

## 2026-10-27 - MOTIVATION EXHIBIT PROMPTS REWRITTEN TO THE IMAGINE GUIDE (BACKEND DEPLOY)

Deployed `15485b2f` (rollback `alloutdoor-20261027-215114.dump`, 35,630,056
bytes; no pending migrations; health ×2 OK; public 200 ×2; `alloutdoor-backend`,
`alloutdoor-frontend` and `warden` online).

**What changed.** The purpose exhibits now use a shared prompt builder
(`motivation-image-brief.ts`) that follows xAI's Imagine order: subject first,
then detail/angle, art direction, light with a readable exposure, colour,
lens/framing, the snapshot treatment, and the exclusions last.

- **Authentic but readable.** Kept the 2026-10-25 unedited-phone-snapshot look
  (imperfect framing, ordinary light, clutter) but removed the demands for
  motion blur, soft focus, crushed shadows and a smudged lens. Every prompt
  keeps the subject inside the middle two-thirds so the 21:9 → 2:1 centre crop
  cannot cut it.
- **Scope.** Species, all six self-defence scenes and both fallbacks
  (`motivation-plates.ts`), and the shared course-of-fire tail
  (`motivation-courses.ts`). Quarry stays retired and untouched. Per-species
  habitat overrides fix springhare/jackal/caracal/bushpig/nyala/hippo and the
  dry-land birds, which were inheriting a waterhole or rocky outcrop.
- **Version.** `PLATES_PROMPT_VERSION` → `2026-10-27a`. Existing stored plates
  keep their old bytes; new/regenerated motivations use the new brief. One
  four-plate pack still costs $0.32 (2K/medium, $0.08 a plate).
- **Preview.** New `npm run motivation:plates:preview` from `backend/` builds
  the real prompts for hunting, sport and self-defence (add `--draw` to spend
  ~$0.48 on six 2K/medium plates, `--limit 4` for a full pack, `--case both`).
  It routes through `LlmService` with a no-op ledger and writes raw + 2:1 JPEGs
  to `backend/tmp/plate-preview/`.
- **Gates.** Backend and frontend `tsc` clean; backend 5,918 passed / 8 skipped
  (1 suite skipped); frontend 1,815 passed / 1 skipped; foreground frontend
  production build clean. **The paid draw was not run**: the safety net blocked
  reading `backend/.env` to confirm `GROK_API_KEY`, so the six preview images
  have not been inspected yet.
- **Next:** run `npm run motivation:plates:preview -- --draw` from `backend/`,
  inspect the raw and cropped images, and adjust the wording only if the
  subjects are wrong. Regenerating a motivation is what puts the new brief in
  front of a member; existing packs keep their stored plates.

## 2026-10-27 - SELLER FAILURE CHARGES: COST RECOVERY FROM THE NEXT PAYOUT

Deployed `cd067374` (rollback `alloutdoor-20261027-130940.dump`, migration
`20261027130000_seller_failure_charges` applied, health ×2, public 200 ×2, three
services online).

A PAID sale that ends because the seller declined it, never dispatched, or never
delivered now recovers the platform's unrecoverable cost: **4% of the amount
refunded** (the gateway round trip) plus the **committed courier rate** when a
waybill exists. It is deliberately **not** the Platform Fee — that is returned to
the buyer, so docking it would be lost margin, not an indemnity.

- **Ledger, not a column.** The failed sale is refunded and its `sellerPayout` is
  already zero, so the debt lives in `SellerCharge` and is set off FIFO against a
  later payout through `SellerChargeRecovery` (RESERVED in the payout claim,
  SETTLED on PayoutComplete, RELEASED on failure/return so it is never
  double-recovered). `netPayoutCents` subtracts the reserved slice;
  `getHeldFundsReport` nets outstanding charges out of `owedToSellers`.
- **Triggers:** `rejectTransaction` (only when the reason earns a strike, so
  `BUYER_SUSPICIOUS` is not billed), `autoRefundStale` (only when the seller is
  not blameless), and an explicit admin `chargeSeller` flag on
  `refundTransaction`. The admin refund dialog now takes an amount and the
  charge, with a live preview.
- **Notice:** one email only, 48h after payment
  (`DELIVERY_OBLIGATION_AFTER_HOURS`) to a paid, undispatched seller, stating the
  exact 4% + courier amount and why. `deliveryObligationNotifiedAt` makes it fire
  once; no inbox row, no SMS, no seller-facing UI copy. Terms §11 carries the
  indemnity + set-off clause.
- **Admin:** seller dossier gets a failure-charges panel (waive = the credit path
  when a Bob Go charge is reclaimed by hand) and a reject-strike ledger with
  per-strike **Remove** (the API already existed; only the UI was missing).

**Gates:** backend tsc clean + 5 893 tests; frontend tsc clean + 1 815 tests;
production build clean.


## 2026-10-27 - DEALER STOCK-IN: STAMP + SAPS 350(a), CIPC AND JEV 70%

Operator, 2026-10-27: *"We can only mark the firearm stocked once the dealer
filled in the form we sent them and also attached their dealer stamp, and the
350 form filled in with the correct firearm details"*, *"Jev needs 70% upwards
on all fields to pass the dealer"*, and *"use gemini 3.1 flash lite as OCR"*.

**The pipeline is now Gemini reads → Jev judges → Didit proves.** One service,
`DealerStampVerificationService`, is shared by BOTH surfaces (the dealer portal
and the seller's SAPS 534 upload):

- **OCR** (`gemini-3.1-flash-lite`, new purposes `dealer.stamp.ocr` and
  `dealer.saps350.ocr` added to `DOCUMENT_PURPOSES`): the stamp is read into a
  small JSON envelope (verbatim text plus name / CIPC number / address /
  contact / licence) so the directory row is built from what the page PRINTS,
  not from a model's opinion. The 350(a) is transcribed verbatim.
- **Jev** (`dealer.stamp.verify`, one batched call) returns a probability per
  field: dealer name, registration number, address, contact number, SAPS
  licence, then the stock document's serial / make+model / calibre / dealer
  named / signed. **Every field must be ≥ 70%**; a missing answer scores zero.
- **Didit** (`DiditService.validateCompanyRegistry`) asks the CIPC registry
  (`/v3/database-validation/`, `issuing_state=ZAF`, `services=zaf_company_registry`,
  multipart as Didit documents it) whether the registration number belongs to
  the business we hold. `full_match` and `partial_match` pass; `no_match` is a
  mismatch; an outage is `unavailable`.
- **Three outcomes, not two.** All fields + CIPC → `APPROVED` (stocked, payout
  gate opens). A mismatch → `REJECTED` **and the seller is emailed the exact
  fields that failed** (`dealerVerificationRejected` gained `issues`). An outage
  → `PENDING_ADMIN_REVIEW`. An outage can never approve and a mismatch can never
  read as "we could not check".

**The portal now demands both documents.** `saps350` is a required multipart
field (`saps534` still accepted as the legacy alias), the stamp is required for
every dealer — trusted or not — and the auto-approve fast path is gone. The
dealer invitation email and the seller's verification tips were rewritten to
name the 350(a) and the five stamp fields.

**Schema:** `Dealer.regNumber` (the CIPC number, nullable, not unique — one
company can hold several licences) and `DealerPortalRequest.saps350PhotoUrl`.
Migration `20261027120000_dealer_stamp_saps350`. The auto-registration hook now
stores the stamp's registration number on the directory row.

**Know.** `getByToken` still returns `requiresIdentity`; the page no longer
branches on it (the stamp is always required) and the field is kept only so an
open client build does not break. A deployment without `JEV_API_KEY` or a Didit
key routes every dealer check to a human, by design.

**⚠️ DIDIT CIPC IS GATED ON THE ACCOUNT TYPE.** The live key answers
`403` with Didit's own words: *"To protect against abuse, database validation
is disabled until your organization's first top-up. You can still test it for
free on a sandbox application."* So the registry check currently returns
`not_configured` → `unavailable` → **every dealer verification routes to admin
review** until the operator tops up (or a sandbox application is used to
exercise it). The check itself was probed with the real stamp:
`2019/139703/07` / "Boomsticks Cape Town". The warn line now carries Didit's
`detail`, because a 403 here is a top-up/sandbox gate as often as a bad key.

**Firefox/Didit console:** the Playwright MCP now launches with a persistent
profile (`--user-data-dir C:\Users\gerha\AppData\Local\opencode-playwright-firefox`,
`~/.config/opencode/opencode.json`, backup `.bak-playwright-profile-20261027`).
Restart opencode, sign in once at business.didit.me, and the session survives.

**Verification:** backend tsc clean, 382 suites / 5,871 tests; frontend tsc
clean, 158 files / 1,815 tests; frontend production build OK.

## 2026-10-26 - MO000100 PACK REVIEW: LAYOUT, 5.2 FALLBACK, 271 GAPS (DEPLOYED)

Deployed `6c74db02`, backend-only, rollback `alloutdoor-20261026-223543.dump`.

**The pack the operator generated was read page by page** (text extracted from
both PDFs; the PDFs themselves cannot be opened as images here). The applicant's
own licence in the test data belongs to the applicant — treated as a
third-party firearm, so the empty battery table and the blank Section F are
correct, not faults.

- **Annexure captions were drawn at the page margin**, so on the 2×2 safe sheet
  the left cell's caption printed twice (over itself) and the right cell had
  none; and every one-item annexure printed its heading and then the identical
  sentence again as a caption. `PlacedImage` now carries `captionX/captionW`
  (the cell for the safe sheet) and a headered page prints only
  `Annexure A (n of m)` — nothing when there is one copy (`compactCaption`).
- **The PAJA running banner** read "REQUEST FOR PRIOR NOTICE AND WRITTEN
  REASO…" wrapped over two lines: `RUNNING_LABELS` was looked up
  case-sensitively against an ALL-CAPS title. Now a case-folded Map.
- **Contents:** the "last sheets are yours… checklist" line printed although
  the take-with-you pages were removed in October; it is now conditional. The
  gap note said "2, 4 or 10" on a section 13 that prints 2 and 4 and omits 8 and
  10 — `gapNumbers()` derives the list from `printedNumbers`.
- **5.2 suitability fallback** was third person ("the applicant is alone",
  "a combination he can keep") and filled one column of two. Extracted to
  `motivation-suitability-fallback.ts`, first person, enough bullets to close
  the sheet, no ammunition-availability claim and no dimension recital.
- **Writer prompt:** the S13 authority to call the round a "common service
  calibre with readily available ammunition" is gone (it rested on holding a
  Bench dimension sheet, and 6.35mm Browning disproves it), and
  `storage_safety` may no longer name the current holder or the transfer route
  — MO000100 wrote "formal transfer to occur via a licensed dealer" into a pack
  whose own 271 ticks the private-owner block. `calibre_fact_sheet` retired with
  the claim. **Prompt cache re-baselined** in `motivation-prompt-cache.spec.ts`.
- **Action label:** the choice string "Semi-automatic (self-loading)" reached
  the writer and the cover verbatim and came back as "semi-loading" three
  times. `displayAction()` prints "Semi-automatic" everywhere prose appears.
- **Exhibit scenes read `premises_type`, which is not a registry field** — so
  the matcher never fired and MO000100's townhouse led with "Communal access"
  (an apartment block). Now reads `residence_type` (falling back to the retired
  key) and a townhouse leads with the driveway gate.
- **`firearmLine()`** was make + type + serial ("CZ Handgun, serial 81815").
  Now make, model, calibre, serial — the PAJA letter and the footer name the
  firearm a reviewer can find.
- **271:** a printed competency issue date is exempt from the settled-date gate
  so box 1.6 fills off an unconfirmed certificate (the expiry stays gated —
  that is what the reminder sweep reads); a private sale with no signed consent
  records in `leftBlank` that the current owner completes Section F.
- **Precinct table:** `precinctTablesFor` retries without the province filter
  and warns for the home station when nothing resolves. MO000100's body cites
  Durbanville figures with no table under them; the retry should print it on
  the next download, and the warning names the station if the answer moved
  after generation.

**Not changed:** G.61's MO reference and the "ALL Outdoor" disclaimer (attorney
sign-off), the cover logo, the `firearm_source` picker. **Deferred:**
`leftBlank` is still computed and dropped at the controller, so the 271 notes
above do not reach the member yet — that needs its own endpoint and panel.

**Verification:** backend tsc clean; 381 suites / 5,845 tests; deploy health ×2,
public 200 ×2, all three services online. Repo-wide prettier stays red
(pre-existing drift in untouched files; not a deploy gate).

## 2026-10-26 - MOTIVATIONS + DOCUMENT LIBRARY AUDIT FIXES (DEPLOYED)

**A document's printed date is not always an expiry.** The reported 100-day
"proof of address expires" reminder came from vision reading a payment/statement
date into `expiresOn` and the batch commit confirming it. Proof of address,
employment letters and activity logs are now dateless: no `expires_on` is read
from them, and the expiry sweep skips them.

- **Proof of address gets the check the operator asked for:** one "Is your proof
  of address still valid?" reminder from `issuedOn`, a month before the 90-day
  DFO window closes (`licence-centre-reminders.service.ts`,
  `NotificationsService.credentialStillValid`). Correcting the printed date
  re-arms it. Two migrations cleared the false dates already stored; the
  production row now has `expiresOn` null, `neverExpires` true and will be
  checked on the next 03:20 sweep.

Other fixes in the same batch:

- **Document Centre:** batch `identify`/`commit` now sniff magic bytes and
  enforce the MIME allowlist; deleting a credential or erasing a user forgets
  its page rasters and OCR cache; `rotate` forgets the old hash and turns
  motion copies matched by sha256; competency batch-confirm no longer clears its
  derived date; pairing is guarded against a third upload; endorsement
  duplicates fingerprint on number/serial; the 30-item evidence cap applies to
  the batch door; admin health counts `dateSource` as settled; ASSOCIATION
  fingerprints added.
- **Motivations:** S14 renders press clippings and SAPS crime tables and
  prefills the station; combination-gun auto-link no longer accepts a
  handgun-only certificate; held section 14 cards are read and offered;
  `section_held` includes 14; first-time TOC counts purpose plates, evidence and
  the battery heading; the retry window is 15 min; single-motivation erasure
  removes witness/seller signatures, cover photo and caches; refiling clears the
  endorsement-mismatch sentinel; `keepInCentre` pairs proficiencies and carries
  `firearmSelfLoading`; generation provenance is stamped; seller consent
  re-derives the competency.
- **Frontend:** `?doc=` resolves a paired document to its lead page; banner
  links open the section; batch preview resets when emptied; the partner tab
  gets its own copies; competency "Change" edits instead of re-saving; autosave
  keeps newer keystrokes, flushes before Write and reports `refused`; the pack
  poll refetches the sheet and stops claiming to be working after its deadline;
  completed rows open the pack; phone hand-off applies its stored reading;
  danger-area ticks re-seed for a new station; the footer syncs `declared`; the
  consent notice uses the server's retention window; unresolved evidence can be
  described on its card.

Deployed `d6920b8c` at 21:44 SAST (full; rollback
`alloutdoor-20261026-214452.dump`, 32,057,829 bytes) and `b3d6fad4` at 21:48
(backend-only; rollback `alloutdoor-20261026-214757.dump`, 32,058,034 bytes).
Migrations applied; backend/frontend health x2, public 200 x2, three PM2
services online. Gates: backend tsc + 380 suites / 5,822 tests (8 skipped);
frontend tsc + 158 files / 1,815 tests (1 skipped) + production build clean.

## 2026-10-26 - CREDENTIAL REMINDERS OPEN THE DOCUMENT (DEPLOYED)

**"Tap to act" now opens the document that is expiring.** Two defects:

- The `Act` pill on an action-required inbox row was a plain `<span>` beside the
  `<Link>`, so tapping the pill itself did nothing. It is inside the link now.
- Credential reminders persisted `url: '/documents'`; the Centre opens folded and
  selects its first row, so the member landed beside the document the reminder
  was about. The expiry sweep and the confirm-date nudge now write
  `/documents?doc=<credentialId>`; legacy rows derive the same target from
  `linkedId` (`notificationHref`), and the Centre opens that row's section and
  selects it (`deepLinkedDocument`). The email CTA and SMS carry the deep link
  too.

Commit `ad175ef0`. Deploy at 20:57 SAST, full: rollback
`alloutdoor-20261026-205631.dump` (32,057,397 bytes), no migrations,
backend/frontend health ×2 OK, public 200 ×2, three PM2 services online.
Gates: backend tsc + 380 suites / 5,821 tests (8 skipped); frontend tsc + 158
files / 1,815 tests (1 skipped); production build clean.

## 2026-10-26 - EXPLAINERS FOLDED INTO THE TERMS, SITE TIDIED (DEPLOYED)

**The payment explainers are gone; the binding text is in the Terms.** A sweep
of every explanation surface found five places repeating the same rules. What
was duplication is retired; what earns its place stayed.

- `/how-payments-work` and `/buyer-protection` no longer render. Both answer
  with a config redirect (308) to `/terms#payments` and
  `/terms#buyer-protection`. ⚠️ NOT page-level `permanentRedirect()`: a
  redirect-only page under a static layout is prerendered, so the response is a
  200 with the redirect digest in the RSC payload and the URL stays indexable.
  Config redirects run before middleware and render nothing.
- Terms additions: South-Africa-only delivery in §9, and a §11 Buyer protection
  paragraph carrying the scope AND the exclusions (remorse, accepted fault,
  post-delivery losses) that used to live on the retired page. Anchors added to
  §7 and §11.
- Removed the dead `TrustGuaranteeModal` (mounted in the root layout, but
  nothing ever linked `?why=alloutdoor`/`?guarantee=true`) and its public
  mockup HTML.
- Homepage "Good to know" is now a one-line link strip (selling guide, FAQ,
  fees, condition guide, contact) instead of three duplicate accordions.
- `/about` keeps the company/ECT § 43 block and points at the Terms and Fees in
  place of its procedural "How it works" copy.
- Retired routes removed from the footer, `/legal` index, sitemap and
  `fine-print-routes`; middleware no longer lists them as public paths.
- Kept: `/faq` (SERP JSON-LD), `/fees` (worked examples),
  `/condition-guide` (grading rubric), `/how-selling-works`, cart
  `TrustBullets`, PDP `HelpTip`s, firearm checkout "How this works".

Commits `7728ab3c` + `4c6d5fc7`. Deploy at 19:53 SAST, full: rollback
`alloutdoor-20261026-195331.dump` (32 054 362 bytes), no migrations,
backend/frontend health x2 OK, public 200 x2, three PM2 services online.
Live verified: both old URLs return `308` with the anchored `Location`.
Gates: frontend tsc + prod build clean, 156 files / 1 806 tests (one unrelated
`design-picker` canvas test timed out in the full run and passes in isolation);
backend tsc + 379 suites / 5 818 tests.

## 2026-10-26 - SIGN-UP NAMES + CELL OTP, PROFILE ADDRESS IN THE BOOK (DEPLOYED)

**Sign-up now actually keeps the name and proves the cell number.** The form
already collected first/surname but discarded them, and phone verification only
existed on `/profile/edit`.

- `RegisterDto` requires `firstName`/`lastName` (trimmed, whitespace-only
  rejected); `AuthService.register` persists them. Public surfaces still show
  username only.
- Sign-up is now details → email code → cell OTP → channel prefs. The phone step
  reuses `POST /users/me/phone/request-otp` + `/verify` (SMSPortal), auto-sends
  once, and offers resend/change-number. ⚠️ It is wizard-enforced, not
  session-enforced: closing the tab after email verification leaves an account
  with an unverified phone, which can still be verified later from the profile.
  The request route is capped at 3/10 min per IP, so shared-IP sign-ups can hit
  429.
- KYC adopts the ID-read names only when the Didit verdict is `VERIFIED` (a
  rejected/in-review session no longer renames the account); `/profile/edit`
  keeps the fields locked once verified, and the stale "Home Affairs" hint is
  gone.

**The profile address is now part of the saved-address book.**
`GET /users/me/addresses` prepends a read-through entry (id `profile`) built
from `User.addr*`, only when street/city/postal/province are complete.

- Settings can edit it (writes back to the User row) and make it default, but
  cannot delete it. Book rows keep normal CRUD.
- Default rule: a book default wins; otherwise the profile address is default.
  Adding the first extra address no longer silently takes the default over.
- Cart and offer checkout now show the picker from one address up and prefill
  from the default; single-listing checkout keeps the chip for one address and
  the picker for 2+.

Gates: backend tsc clean, 379 suites / 5 818 tests; frontend tsc + production
build clean, 157 files / 1 807 tests. Deploy at 18:55 SAST (full, commits
`3658c2dc` + `7757e0ff`): rollback `alloutdoor-20261026-185459.dump`
(32 053 466 bytes), no pending migrations, backend/frontend health x2 OK,
public 200 x2, three PM2 services online.

## 2026-10-26 - DEALER FORM TEST EMAIL, NOT A BCC (DEPLOYED)

**The BCC copy was removed; the operator only wants on-demand test emails.**
Dealer invitations go to the dealer and nowhere else.

- `NotificationsService.dealerPortalRequestEmail()` holds the one template;
  both the real invitation and the test send use it.
- `npm run dealer-form:test -- <email>` boots an app context and sends that
  template with sample data (Wildman Cape Gate / TEST-1234; the CTA points at
  `/dealer-portal/test-preview`, so the link is a preview only). It creates no
  transaction or portal request.
- The `DEALER_FORM_COPY_EMAIL` line was removed from the box's `backend/.env`
  (backup `.env.bak-dealer-copy-removed-20261026`).

Deploy at 18:11 SAST, backend-only (commit `6c96ce36`, script in `9e1964d5`):
rollback `alloutdoor-20261026-181151.dump` (32 051 297 bytes), no migrations,
health x2 OK, public 200 x2, three PM2 services online. Notifications suites
8 files / 62 tests green; backend tsc clean. Test email sent to
gerhard.fourie@alloutdoor.co.za at 18:12; no outbox row, so Resend accepted
it. Re-send any time with `npm run dealer-form:test -- <email>` on the box.

**The test link now works, and a real dealer-link bug was found.**
`/dealer-portal/*` was missing from the middleware's public-route list, so a
signed-out dealer — the normal case — was 307'd to sign-in. It is now public
(token in the URL is the credential), matching `/consent` and `/witness`.
`/dealer-portal/test-preview` also renders the real form with sample data,
a "Test preview" banner and a disabled submit button.

Deployed frontend-only at 18:16/18:19 SAST (`27f76a9c`, `ad5ada61`), rollback
`alloutdoor-20261026-181624.dump` then `alloutdoor-20261026-181911.dump`, no
migrations, health x2 OK, public 200 x2, three services online. Anonymous
request to `/dealer-portal/test-preview` now returns 200.

## 2026-10-26 - ADDRESS AUTOCOMPLETE NOW GOES THROUGH THE BACKEND (DEPLOYED)

**Root cause found: the browser Maps key cannot use Places Autocomplete.**
Calling `places:autocomplete` with the public key returns
`403 API_KEY_SERVICE_BLOCKED`, so the legacy `google.maps.places.Autocomplete`
widget returned no predictions. The earlier mount/retry fix (b39b8085) was a
real race but not the cause.

- `GooglePlacesService.autocomplete()` and `.address()` call Places API (New)
  with the backend key (which works: "wildman ca" returns Wildman Cape Gate).
- New routes `GET /listings/place-autocomplete?input=&types=` and
  `GET /listings/place/:placeId` (optional auth, 60/min throttle). The first
  is public because the seller-consent page is token-based.
- `AddressAutocomplete` now renders its own dropdown from those endpoints
  (debounced, keyboard-navigable, theme-token styled). The Maps JS library is
  used only by "use my current location" (Geocoder). This applies to every
  address field: sell form, dealer search, checkout, profile, Licence Centre.
- The post composer still builds the legacy widget itself; it has the same
  key limitation and should move to this component/endpoints next.

Deploy at 17:58 SAST (commit `4d02caca`): rollback
`alloutdoor-20261026-175839.dump` (33 826 431 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Gates: backend tsc
clean, 379 suites / 5 811 tests; frontend tsc + build clean, 156 files /
1 804 tests. Live check: `place-autocomplete` returned 5 Wildman suggestions
and `place/:id` returned the Cape Gate address/components.

## 2026-10-26 - DEALER PLACES SEARCH ON FIRST MOUNT (DEPLOYED)

**The dealer auto-search field no longer needs the Manual Entry toggle to start
working.** `loadMapsOnce()` resolved on the script's `load` event, which can
fire before `google.maps.places` is attached; the wiring effect then saw no
`PlacesLib`, returned for good, and the field stayed dead until a remount (the
reported toggle workaround).

- `frontend/components/address-autocomplete.tsx`: the loader now polls until
  `google.maps.places` exists (10s deadline, auth failure short-circuits), and
  the wiring effect retries ~10s instead of giving up. Applies to every
  autocomplete on the site, including the pickup address.

Deploy at 17:42 SAST, frontend-only (commit `b39b8085`): rollback
`alloutdoor-20261026-174225.dump` (33 824 903 bytes), no migrations, health x2
OK, public 200 x2, three PM2 services online. Backend 378 suites / 5,808 tests
green; frontend 1,801 passed (same flaky tree-scan timeout, green standalone
2/2); tsc + production build clean.

## 2026-10-26 - FIREARM LICENCE EXPIRY IS INFORMATIONAL (DEPLOYED)

**Licence expiry no longer blocks or delists a firearm listing.** The vision
read still extracts and stores `licenceExpiresAt`, and the date is now shown to
buyers.

- `FirearmLicenceService.verify()` keeps the serial / holder / legibility /
  "is this an SA firearm licence" BLOCKs. Expired, <30-day and unreadable dates
  all return OK (operator: "read it, but not a block").
- The 06:00 `checkFirearmLicenceExpiry` cron no longer flips listings to
  `EXPIRED`. It still sends the one-time 31–90-day warning; the email/inbox copy
  no longer promises a delist. The `firearmLicenceExpiry` notification lost its
  `kind`/`delisted` branch.
- `licenceExpiresAt` is now in `PUBLIC_LISTING_SELECT` and the `Listing` type.
  The detail page renders it as a `Licence expiry` row in the Specifications
  block below the description (only for firearms with a readable date). Holder
  name, serial and licence photos stay private.
- `COMPLIANCE-RULES.md` §2.5 updated.

Deploy at 17:32 SAST (commit `4b58af0f`): rollback
`alloutdoor-20261026-173245.dump` (33 823 689 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Gates: backend tsc
clean, 378 suites / 5,807 passed (one load-related timeout in
`motivation-pdf.service.spec.ts`, green standalone 94/94); frontend tsc + build
clean, 1,801 passed (`no-self-recursive-callbacks` timeout under parallel load,
green standalone 2/2). Live API now returns `licenceExpiresAt` (null on the
non-firearm listing currently public).

## 2026-10-26 - LISTING AREA FROM POSTAL CODE (DEPLOYED)

**Listings now show the postal AREA, not Google's metro locality.** A
Kraaifontein address used to render as "Cape Town"; code 7570 now resolves to
"Kraaifontein, Western Cape".

- `backend/src/listings/postal-locality.ts` resolves
  `pickupPostalCode` against the bundled GeoNames dataset
  (`backend/data/sa-postal-codes-geonames.tsv`). Order: exact `pickupSuburb`
  match when a code carries several names, then a unique name, then the name
  nearest `pickupLat`/`pickupLng`; otherwise it falls back to the sanitised
  town (`locality.ts`).
- Wired into listing create and edit. `pickupPostalCode` / `pickupSuburb`
  remain off `PUBLIC_LISTING_SELECT`; only the resolved area label is public.
- Firearm listings still show `plannedDealerLocation`, not the seller's postal
  code.
- Existing rows: `npm run listings:backfill-locality` on the box — checked 10,
  updated 10, unresolved 0. Verified 7570 -> Kraaifontein (9 rows) and
  7110 -> Somerset West.

Deploy at 17:15 SAST (commit `d88376da`): rollback
`alloutdoor-20261026-171502.dump` (33 823 235 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Frontend suite again
timed out `lib/no-self-recursive-callbacks.spec.ts` under parallel load; it
passes standalone (2/2).

## 2026-10-26 - AUCTION MINIMUM VALUES RAISED (DEPLOYED)

**Floors are now 3 days R2,500; 5 days R5,000; 7 days R7,500; 14 days
R10,000.** Changed in `backend/src/listings/listings.service.ts`
(`AUCTION_MIN_VALUE_CENTS`) and the frontend mirror
(`frontend/lib/auction-minimums.ts`), with the spec's boundary cases updated.
`COMPLIANCE-RULES.md` §4 matches. Terms §10 now states the same table and
explains that the floor is measured against the reserve, or the typed starting
bid when there is no reserve.

Deploy at 17:01 SAST (commits `02aad04c`, `08379000`): rollback
`alloutdoor-20261026-170043.dump` (33 823 121 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Frontend suite reported
one timeout in `lib/no-self-recursive-callbacks.spec.ts` under parallel load;
it passes standalone (2/2).

## 2026-10-24 - PRECINCT CARD ON THE LICENCE SHEET (DEPLOYED)

**The SAPS quarterly figures are now shown on the motivation sheet.**
`PrecinctCard` was built and tested but mounted by nothing since Phase 4 deleted
the wizard, so the member only ever saw the figures in the finished pack. It now
renders in the Licence Centre's "Your circumstances" section for S13/S14, under
the association rows and above "Where you travel". `DangerAreas` still owns the
press clippings.

Production check before deploy: the public Maps key returns Places predictions
and Geocoder results; the backend `GOOGLE_MAPS_API_KEY` (39 chars) returns
Geocoding `OK`; `CrimeStatsRelease` / `Figure` / `Station` hold 5 / 1 290 300 /
1 179 rows; no geocode failures in recent backend logs; no `GENERATING`
motivations in flight.

Deploy at 16:58 SAST (commit `afbd916f`, frontend-only): rollback
`alloutdoor-20261024-165838.dump` (36 202 697 bytes), no migrations,
health x2 OK, public 200 x2, three PM2 services online.

⚠️ **Open:** the community post composer still builds
`google.maps.places.Autocomplete` itself instead of using `AddressAutocomplete`,
and only tries once when the modal opens — if the async Maps script has not
loaded yet, its location autocomplete silently does nothing. It also uses a
controlled input, the pattern `address-autocomplete.tsx` says breaks the binding.

Environment note: the Playwright MCP default is now Firefox
(`~/.config/opencode/opencode.json`), so a new session checks production in
Firefox; this session still ran Chromium.

## 2026-10-24 - LISTING COPY + MOTIVATION GOLDEN SET (DEPLOYED)

**Three completed workstreams that had been sitting uncommitted.**

- **Plain-sentence descriptions render as bullets.** `parseDescriptionBlocks`
  splits hand-typed sentences into one fact per bullet when the seller used
  no bullet markers or section headings; authored structure is untouched.
  The preview modal now uses `ListingDescription` like the listing page.
- **The 10-business-day delivery window moved to Terms 9.** Listing pages no
  longer print it on every item; the firearm dealer-transfer note and the
  collection lead-in stay.
- **Motivation golden set.** `backend/scripts/motivation-golden.ts` +
  `test/fixtures/motivation-golden.json` + the `motivation:golden` /
  `:init` npm scripts. Reads stored text only; the fixture is empty until
  `--init` is run against a database with COMPLETED packs.

Deploy at 16:09 SAST (commit `22cc6d8e`): rollback
`alloutdoor-20261024-160925.dump` (36 202 217 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. (`backend/package.json`
and the listing/terms WIP that had been stashed for earlier deploys is now
committed rather than stashed.) Untracked `.opencode/`, `.playwright-mcp/`
and a stray root `package.json` were left alone.

## 2026-10-24 - REMITTANCE EMAILED; SELLER STATEMENTS RETIRED (DEPLOYED)

**The seller's payout paperwork is the remittance advice, sent as a PDF
attachment.** On Ozow payout completion the seller receives
`payoutRemittanceReadySeller` with the advice attached (the mail links to
`/my/earnings` as a fallback; the outbox stores HTML only, so a retried send
loses the attachment but keeps the link).

**Statements are gone end to end:** the `POST /sellers/me/statement/email`
route, `SellerToolsService.emailAccountingStatement`, the Zoho
`emailSellerStatement` call, and the smoke's statement emails. The payout
statement (JSON/CSV on `/my/earnings`) is a data view only and is never sent.

What each party gets:

| Flow | Buyer | Seller |
|---|---|---|
| Buy Now | invoice | remittance advice (no invoice) |
| Auction | invoice | 5% Platform Fee invoice + remittance advice |

Live smoke after deploy: INV-000064 (Buy Now buyer, no seller invoice),
INV-000065/66 (Auction buyer + R50 seller invoice), no statements emailed,
CFP/UF at R0.00, remittance PDFs one page each (R1,000 / R950).

Deploy at 15:58 SAST (commit `852d4968`): rollback
`alloutdoor-20261024-155810.dump` (36 202 130 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Unrelated
Terms/listing/motivation WIP stashed and restored unchanged.

## 2026-10-24 - SMOKE NOW RENDERS THE REMITTANCE ADVICE (DEPLOYED)

**The Books smoke could not see the payout document, because the app builds
it.** `RemittanceService.buildPdf` is now pure (no database access) and
`backend/scripts/remittance-smoke.ts` renders the same Auction and Buy Now
samples the flows use, writing them to `%TEMP%\alloutdoor-remittance-smoke`
and asserting one page each. `zoho-marketplace-smoke-test.ps1` runs it before
the verdict and fails the run if either document is malformed.

Verified output: Auction — Sale price R1 000,00, Platform Fee R50,00, You
receive R950,00; Buy Now — Sale price R1 000,00, You receive R1 000,00. Both
one page, both carry the disclosed-agent note.

Deploy at 15:36 SAST (commit `0711ccf5`): rollback
`alloutdoor-20261024-153617.dump` (36 202 022 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Unrelated
Terms/listing/motivation WIP stashed and restored unchanged.

## 2026-10-24 - SELLER REMITTANCE ADVICE; R0 SELLER INVOICE RETIRED (DEPLOYED)

**Every paid-out sale now has a remittance advice** — the document a seller
shows SARS against the credit on their bank statement.

- `GET /api/transactions/:id/remittance` (seller-only) returns a one-page PDF:
  payout date, order reference, sale type, paid-to/paid-from, the item, gross
  sale, any Platform Fee deduction, and the exact net paid. It refuses until
  `Transaction.paidOutAt` is set, so the figure is money that reached the bank.
- `/my/earnings` has a **PDF** button per paid row (the payout statement
  payload now carries `paidOutAt`).
- When the Ozow payout completes, the seller gets a "payout paid" email
  pointing at the advice (`payoutRemittanceReadySeller`).

**The Buy Now zero-total settlement advice is retired.** `createCommissionInvoice`
now returns immediately when `commissionZar <= 0`; a Buy Now seller has no
seller-side Books document (the remittance advice is their paperwork). Auction
sellers keep the 5% Platform Fee invoice. `markCommissionInvoicePaid` still
stamps legacy zero-fee advice rows `NOT_APPLICABLE`.

**Live smoke re-run after deploy:** INV-000055 (Buy Now buyer) with **no**
seller advice, INV-000056/57 (Auction buyer + R50 seller invoice), CFP and
Undeposited Funds at R0.00. The remittance PDF itself is covered by unit tests
(auth, one page, paid-only) — not yet exercised by a live payout.

Deploy at 13:55 SAST (commit `cfdafb26`): rollback
`alloutdoor-20261024-135505.dump` (36 201 420 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Unrelated
Terms/listing/motivation WIP stashed and restored unchanged.

## 2026-10-24 - BUYER INVOICES USE FOOTNOTE MARKERS (DEPLOYED)

**Line descriptions are gone; the markers explain the supplies.** Buyer
invoices (Buy Now and Auction) now read:

| Line | Heading | Posts to |
|---|---|---|
| Item | `X-BAG *` | Client Funds Payable (Trust) |
| Delivery | `Delivery *` | Client Funds Payable (Trust) |
| Platform Fee | `Platform Fee **` (auction: `Platform Fee (5%) **`) | Platform Fee Revenue |

with the notes legend:

```
* Principal Supplies - Fees collected on behalf of unrelated third parties (Item Seller and Courier Service)
** Agent Supplies - All Outdoor Platform Fee
Ref: <order reference>
```

Dropping the description lines keeps the PDF to one page (the P.O.# block stays
gone). Smoke scripts mirror the shape and the X-BAG / R150 fixture.

**Live smoke (INV-000051/52/53/54) passed:** both flows one page, markers and
legend render, CFP and Undeposited Funds close at R0.00, bank is ABSA.

**Still open:** the seller Remittance Advice (Payment Voucher) discussed for
auctions/Buy Now, and retiring the R0 Buy Now settlement advice. Not built.

Deploy at 13:38 SAST (commit `35e0dffe`): rollback
`alloutdoor-20261024-133848.dump` (36 201 322 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Unrelated
Terms/listing/motivation WIP stashed and restored unchanged.

## 2026-10-24 - ZOHO CASH NOW LANDS IN ABSA 5183 (DEPLOYED)

**ABSA (account ending 5183) handles every transaction.** `resolveBankAccountId`
now prefers the ABSA account by name, then by `account_number` ending `5183`,
then by name containing `5183`; the retired FNB account is only a fallback (then
any `bank`-type account, then Undeposited Funds). That resolver drives buyer
receipts, the Bob Go carrier-freight journal and seller payout journals, so all
three credit ABSA. The smoke script resolves the bank in the same order, and the
unit-test chart carries both ABSA (40505183) and the old FNB row so ABSA wins.

**Verify on the next smoke run:** the buyer payment, carrier journal and payout
journal should show ABSA in Books, not FNB.

Deploy at 12:29 SAST (commit `8acb5214`): rollback
`alloutdoor-20261024-122929.dump` (36 200 881 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Unrelated
Terms/listing/motivation WIP stashed and restored unchanged.

## 2026-10-24 - INVOICE LINES RENAMED, P.O.# GONE (DEPLOYED)

**Supersedes the earlier reference-shortening fix.** The buyer and seller
invoices now read, on every Buy Now and Auction document:

| Line | Description | Zoho account |
|---|---|---|
| Item (listing title) | `Seller of item (Principal)` | Client Funds Payable (Trust) |
| Delivery | `Courier (Principal)` | Client Funds Payable (Trust) |
| Platform Fee | `All Outdoor (Agent)` | Platform Fee Revenue |

`reference_number` is no longer sent on any invoice, so Zoho stops printing the
`P.O.#` block entirely (that block wrapped to four lines and pushed paid buyer
invoices onto a blank page 2). The order reference remains in the notes. The
auction seller's Platform Fee line uses the same `All Outdoor (Agent)` wording,
and the sale maths moved into its notes.

Both smoke scripts mirror the shape and now fail if a line posts to the wrong
account (Buy Now and Auction, buyer and seller).

**Not yet re-verified live** - run
`backend/scripts/zoho-marketplace-smoke-test.ps1`, download a buyer and seller
invoice, and confirm one page, no P.O.#, and the new labels. Clean up with
`zoho-smoke-cleanup.ps1 -Apply`.

Deploy at 12:05 SAST (commit `1a662c37`): rollback
`alloutdoor-20261024-120535.dump` (36 200 738 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Unrelated
Terms/listing/motivation WIP stashed and restored unchanged.

## 2026-10-24 - BUYER INVOICE NO LONGER SPILLS A BLANK PAGE 2 (DEPLOYED)

**Every paid buyer invoice PDF had a second page containing only the footer
page number.** The cause was page-1 height, not the template: page 1 finished
at y=54-65 of an 842pt page (footer number at y=33), so OpenPDF split the last
block and emitted an empty page. Invoices that ended at y=144+ were one page.

Fix in `createBuyerInvoice`: reference shortened to `ref: total` (the 77-char
"item + delivery + fee" reference wrapped to four lines in the narrow P.O.#
column), one-line line-item descriptions, and a two-line agent/disclosure note
(four lines before). The smoke script mirrors the same shape so the next run is
representative.

**Not yet re-verified against a live invoice** - re-run
`backend/scripts/zoho-marketplace-smoke-test.ps1` and download INV-0000xx to
confirm one page, then clean up with `zoho-smoke-cleanup.ps1 -Apply`.

Deploy at 09:31 SAST (commit `85175324`): rollback
`alloutdoor-20261024-093134.dump` (36 199 490 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Unrelated
Terms/listing/motivation WIP stashed and restored unchanged.

## 2026-10-23 - DELIVERY HANDLING MARGIN REMOVED (DEPLOYED)

**The buyer no longer pays a 10% margin on shipping, and the Platform Fee is no
longer charged on one.** `SHIPPING_HANDLING_RATE` is 0 and
`displayShippingCents` returns the bare courier rate.
`Transaction.shippingHandlingCents` stays on the row so historical sales keep
their original margin; new sales store 0. Example: a R145 carrier used to be
R159.50 delivery with the fee on R159.50; now delivery is R145 and the fee base
is item + R145.

- Updated: shipping specs (no `withMargin`), `/fees` example and delivery
  section, sell-form notes, help-centre `ship-handling-fee`,
  `COMPLIANCE-RULES.md`, `docs/project-reference.md`.
- Verification: backend `tsc`, 5,787 backend tests, frontend `tsc`, 1,802
  frontend tests, production build.

Deploy at 16:00 SAST (commit `18620e7c`): rollback
`alloutdoor-20261023-155902.dump` (36 071 929 bytes), no pending migrations,
health x2 OK, public 200 x2, three PM2 services online. Unrelated
Terms/listing/motivation WIP stashed and restored unchanged.

## 2026-10-23 - BOTH PARTIES RECEIVE THEIR ZOHO PAPERWORK (DEPLOYED)

**Creating the document was not enough: the emails were never sent.** Buyer
invoices and seller documents were marked sent and left in Books. Now:
- the buyer invoice is emailed to the buyer after settlement;
- the seller fee invoice (auction) or settlement advice (Buy Now) is emailed to
  the seller on creation;
- `zohoBuyerInvoiceEmailedAt` / `zohoSellerInvoiceEmailedAt` (migration
  `20261023150000_zoho_invoice_emails`) make each send idempotent;
- the hourly sweep retries a missed send without re-creating the document.

**Live smoke (R1,000 + R145 freight, commit `151a820d`), every email sent to
gerhard.fourie@alloutdoor.co.za:**

| | Buyer document | Seller document |
|---|---|---|
| Buy Now | INV-000039 · R1,275.45 · emailed | INV-000040 · R0 advice · emailed |
| Auction | INV-000041 · R1,217.48 · emailed | INV-000042 · R50.00 · emailed |

Both seller statements were emailed too. Ledger closed at **trust R0.00 /
Undeposited Funds R0.00**.

Deploy at 15:02 SAST: rollback `alloutdoor-20261023-150238.dump`
(36 071 115 bytes), migrations applied, health x2 OK, public 200 x2, three PM2
services online. Unrelated Terms/listing/motivation WIP stashed and restored
unchanged. Remove the smoke records with
`backend/scripts/zoho-smoke-cleanup.ps1 -Apply`.

## 2026-10-23 - BUY NOW SELLER PAPERWORK + SMOKE (DEPLOYED)

**A Buy Now seller had no Zoho document at all** (zero commission was marked
SKIPPED). `createCommissionInvoice` now branches: a fee-bearing sale (auction)
gets the 5% Platform Fee invoice; a zero-fee sale (Buy Now) gets a **zero-total
settlement advice** — clearly named "Sale settlement advice (not a tax
invoice)", a balance-sheet line, no ledger effect — created, marked sent and
stored in `zohoCommissionInvoiceId`. The payout batch stamps zero-fee rows
`NOT_APPLICABLE` instead of re-reading them every run, and refunds skip the
credit note when there is no fee.

**Live smoke (R1,000 + R145 freight, commit `39870c49`):**

| | Buyer | Seller |
|---|---|---|
| Buy Now | INV-000035 · R1,275.45 paid | INV-000036 · R0 settlement advice |
| Auction | INV-000037 · R1,217.48 paid | INV-000038 · R50.00 paid |

Both parties' documents were emailed, both seller statements were emailed, and
the ledger closed at **trust R0.00 / Undeposited Funds R0.00**.

Deploy at 14:44 SAST: rollback `alloutdoor-20261023-144418.dump`
(36 070 929 bytes), no pending migrations, health x2 OK, public 200 x2, three
PM2 services online. Unrelated Terms/listing/motivation WIP stashed and
restored unchanged. Clean up the smoke records with
`backend/scripts/zoho-smoke-cleanup.ps1 -Apply`.

## 2026-10-23 - ZOHO LEDGER CORRECTION + LIVE SMOKE TEST (DEPLOYED)

**The first principal/agent recipe could not reconcile, and the live smoke test
proved it.** Books ignores `deposit_to_account_id` on a customer payment and
silently deposits into **Undeposited Funds**; an **Expense credits** its
paid-through account, so the Bob Go freight *increased* the trust liability; and
the seller commission payment likewise never touched the liability. Net effect
on a two-scenario run: trust R630 credit, Undeposited Funds R2,492.93.

Corrected recipe (commit **`aebe598d`**, migration
`20261023133000_zoho_ledger_correction`):
- Buyer payment uses **`account_id`** and lands in **Bank - FNB Business**.
- Carrier freight is a **journal** Dr Client Funds Payable / Cr bank
  (`zohoShippingJournalId`), not an Expense.
- Auction seller fee: invoice stays, then a **journal** Dr trust / Cr
  Undeposited Funds (`zohoCommissionSettleJournalId`) paired with the seller's
  customer payment into Undeposited Funds.
- The FNB bank is resolved by name fragment: the live name's dash is not ASCII,
  so an exact match silently missed and Books defaulted to Undeposited Funds.

**Live verification (R1,000 + R145 freight, Buy Now and Auction):**
- Buy Now: buyer invoice R1,275.45 paid; seller statement emailed.
- Auction: buyer invoice R1,217.48 paid; seller commission invoice **R50.00**
  paid; seller statement emailed.
- Closing ledger: **trust R0.00, Undeposited Funds R0.00**.
- Scripts: `backend/scripts/zoho-marketplace-smoke-test.ps1` (both flows,
  `-NoEmails` supported) and `backend/scripts/zoho-smoke-cleanup.ps1`
  (dry-run by default, `-Apply` to delete SMOKETEST artefacts).
- The passing run's documents were left in Books for inspection; remove with
  the cleanup script when done.

Deploy at 13:39 SAST: rollback `alloutdoor-20261023-133925.dump`
(36 070 341 bytes), migrations applied, health x2 OK, public 200 x2, all three
PM2 services online. Unrelated Terms/listing/motivation WIP stashed and
restored unchanged.

## 2026-10-23 - PRINCIPAL/AGENT SPLIT ON ZOHO INVOICES (DEPLOYED)

**The buyer invoice now states the whole checkout, with the principal/agent
split in the ledger.** Item price and delivery post to **Client Funds Payable**
(third-party money); only the Platform Fee posts to revenue. Because Zoho cannot
split one line across two accounts and the buyer must still see one Delivery
figure, the delivery handling margin is moved out of the liability by a
**manual journal** (`zohoHandlingJournalId`, new migration
`20261023120000_zoho_handling_journal`) leaving the carrier's pure rate to be
cleared by the Bob Go expense. The invoice refuses to post if its lines do not
equal `buyerTotal`.

Auctions keep the split fee: the buyer pays a 5% Platform Fee on the invoice and
the seller is invoiced the other 5% against their hammer, settled from the same
held funds. Sellers can now request their Zoho accounting statement from
`POST /api/sellers/me/statement/email`.

The previously uncommitted Zoho shipping-expense work (schema field, migration
`20261021193000`, release hooks, retry wiring) shipped with it, because the
deployed schema and code depend on each other.

Commit **`83d94a86`**. Full deploy at 12:51 SAST: rollback
`alloutdoor-20261023-125108.dump` (36 069 720 bytes), box HEAD matches,
migrations applied, backend/frontend health x2 OK, public 200 x2, all three PM2
services online. Unrelated Terms/listing-description/motivation WIP was stashed
and restored unchanged.

## 2026-10-23 - HANDOVER CONSENT MOVED TO THE TERMS (DEPLOYED)

**The in-person handover consent block is gone from checkout.** Single-item,
offer and cart checkout no longer render the bullets, the two tickboxes and the
typed "I UNDERSTAND". The held-funds, contact-sharing, no-delivery-guarantee
and non-refundable Platform Fee terms now live in Terms sections 3 and 7 (with
contact sharing named in Privacy sections 6 and 7) and are accepted with the
Terms at registration. The checkout payload still sends
`privateArrangeConsent: true`, so `privateArrangeAcceptedAt` is still stamped.
The firearm 18+/SAPS-competency attestation stays at checkout. Sign-up copy now
names the handover/contact-sharing/fee terms and `POLICY_VERSION` is
`2026-10-23`.

Commit **`330435fa`**. Full deploy at 10:34 SAST: rollback
`alloutdoor-20261023-103445.dump` (36 068 477 bytes), box HEAD matches,
backend/frontend health x2 OK, public 200 x2, all three PM2 services online.
No pending migrations. The Zoho shipping-expense WIP was stashed and restored.

## 2026-10-22 - IN-PERSON HANDOVER EVERYWHERE, PARGO-ONLY PICKUP (DEPLOYED)

**In-person handover (`PRIVATE_ARRANGE`) is now offered on every non-collection
listing**, firearm or goods, regardless of the seller's listing options. Funds
stay HELD until the buyer confirms the handover (or 5 days after payment when
there is no dispute); both parties get WhatsApp/SMS/email/in-app confirmation
links at payment. On any refund or upheld dispute **ALL Outdoor keeps the
Platform Fee** — only the item price is refunded.

**Every cart item now has its own Courier / Arrange privately choice**
(firearms: Dealer stock / Arrange privately). Only courier lines go to the Bob
Go quote, and same-seller courier lines still consolidate into one parcel. The
offer checkout gained the same delivery-method choice.

**Pargo is the only pickup-point network** — Bob Box locker rates are filtered
out (`pargoPickupRates`). Pargo cards read `Pargo – <store>`, show the distance,
and reveal the address/trading hours only once selected. The checkout's
"Before you pay" bullet block was replaced by the single acknowledgement
checkbox, with the detail in the Terms/Refund Policy (Pargo-only and
non-refundable Platform Fee now explicit).

Commit **`f1803e86`**. Full deploy at 23:54 SAST: rollback
`alloutdoor-20261022-235405.dump` (35 930 753 bytes), box HEAD matches,
backend/frontend health x2 OK, public 200 x2, all three PM2 services online.
No pending migrations. Unrelated Zoho/payments work was stashed and restored.

## 2026-10-22 - PHOTO-FLAGGED LISTINGS STAY IN REVIEW (DEPLOYED)

**Preview can hold a listing for a photo, but create re-moderates text only**
(images are uploaded after the row exists). `forceReview` was set only from the
separate client-side photo screen, so a preview verdict of `HUMAN_REVIEW` from
the server vision pass still published `ACTIVE` — the modal said admin review
and the listing never entered the queue. `requiresAdminReview()` now carries
the preview verdict into `forceReview`; spec covers both sources.

Commit **`864bbd0d`**. Frontend-only deploy at 13:50 SAST: rollback
`alloutdoor-20261022-135043.dump` (35 915 510 bytes), box HEAD matches,
frontend health x2 OK, public 200 x2, all three PM2 services online. No
migration. Unrelated Zoho/payments work was stashed and restored.

## 2026-10-22 - STALE-SESSION GRIDS AND OVERSIZED SELL PREVIEW (DEPLOYED)

**Discovery grids after an idle tab.** The 15-minute access-token cookie can
expire while the refresh cookie still looks signed-in to middleware. A hard
load in that window rendered the page anonymously, so a members-only grid came
back empty until the next navigation. `<CatalogLiveRefresh>` now passes the
server's verdict to the client heartbeat, which re-runs the page once the
client session has been renewed. Home, category, brand and seller grids.

**Sell Preview 413.** Full-resolution base64 photos for up to ten staged images
exceeded the backend's 15 MB preview body, failing with a raw "request entity
too large" before anything was published. The form now downscales to the
vision pass's 1280px working size and sends only the five photos it reads, and
a 413 is translated into an actionable message.

Commits **`35b0da48`** and **`0a66ca3c`**. Frontend-only deploy at 13:28 SAST:
rollback `alloutdoor-20261022-132835.dump` (35 913 550 bytes), box HEAD matches,
frontend health x2 OK, public 200 x2, all three PM2 services online. No
migration. Unrelated Zoho/payments work was stashed and restored.

## 2026-10-21 - DELIVERY / HANDOVER OPTIONS (DEPLOYED)

**Firearms:** Dealer transfer stays mandatory and is shown on the listing;
sellers may additionally offer Arrange privately, with the required contact
consent.

**Other goods:** sellers now offer Courier delivery (always) plus optional
Arrange privately. The listing detail shows the routes before the CTA, and
checkout renders the seller's actual subset. The private-arrangement consent
copy adapts for goods (in-person handover / courier fallback) instead of
assuming a firearm dealer meet.

Commit **`4928e65c`**. Full deploy at 18:27 SAST: rollback
`alloutdoor-20261021-182754.dump` (35 782 399 bytes), box HEAD matches,
backend/frontend health x2 OK, public 200 x2, all three PM2 services online.
No migration. `backend/package.json` was stashed and restored.

## 2026-10-21 - COVER VIDEO ON CARDS AND PREVIEW (DEPLOYED)

**Sell Preview now shows the clip**, as the hero when it is ticked as the
cover and below the photos when it is not. Browse/search/recently-viewed card
payloads now include approved video metadata. A ticked cover video renders in
the card's 4:3 photo slot, muted and looping, and plays/pauses from an
IntersectionObserver as the card scrolls in and out of view. Pending/rejected
video rows are stripped from card payloads server-side.

Commit **`f544a0f2`**. Full deploy at 11:27 SAST: rollback
`alloutdoor-20261021-112700.dump` (35 775 587 bytes), box HEAD matches,
backend/frontend health x2 OK, public 200 x2, all three PM2 services online.
No migration in this deploy. `backend/package.json` was stashed and restored.

## 2026-10-21 - MEDIA, DESCRIPTION AND VERIFICATION POLISH (COMMITTED)

Commit **`59b922be`**; docs **`5ee6af35`**. Full deploy at 11:07 SAST:
migration `20261021110000_listing_video_hero` applied, rollback
`alloutdoor-20261021-110752.dump` (35 774 206 bytes), box HEAD matches,
backend/frontend health x2 OK, public 200 x2, all three PM2 services online.
`backend/package.json` was stashed before deploy and restored after.

- Upload progress for video no longer claims it is screening again; the clip
  was already screened on selection.
- A replaced/blurred photo keeps its preview. `PhotoDropzone` now creates and
  revokes one object URL per thumbnail instead of holding a stale map.
- Video is no longer the cover by default. Sell/Edit has **Use the video as
  the cover**; only a ticked clip leads the gallery. A ticked clip's thumbnail
  is a live muted loop. New migration:
  `20261021110000_listing_video_hero` (`ListingVideo.isHero`).
- AI-tidied descriptions are normalised to `- ` bullets server-side, including
  AUTO_FIX contact redactions. Seller-typed text is untouched.
- Public usernames now carry three green trust ticks (ID / Phone / Email) on
  listing cards/detail, seller profiles, buyer reviews, community posts,
  comments, profiles, followers and likers. APIs expose booleans only.
- `backend/package.json` remains an unrelated uncommitted change (motivation
  golden scripts); do not include it.

Verification: backend 371 suites / 5 740 tests, frontend 149 files / 1 771
tests, both `tsc` clean, backend `nest build` clean, frontend production build
clean. Lint is noisy on pre-existing CRLF/Prettier issues; no new frontend
errors beyond the pre-existing unused `TIER_COLOR`.

## 2026-10-21 - SELLER-BLURRED AREAS PASS RE-SCAN (IMAGE REDACTION HOTFIX)

**A blurred phone number or email was still being flagged.** The re-scan sent
only the pixels; the model could still read the blurred shape as "hidden
contact details" and refused it. The screen now receives an explicit
`redacted` flag for seller-blurred photos, and the image prompt treats that
area as intentionally removed while still flagging readable text elsewhere.
The final uploaded file is still screened authoritatively.

`POST /listings/image-screen` accepts `redacted=true`; `/listings/preview`
accepts `images[].redacted`; the Sell and Edit blur flows send it. A new
regression spec covers the prompt contract.

Commit **`9d09f6c4`**. Full deploy at 10:14 SAST: box HEAD matches, rollback
`alloutdoor-20261021-101453.dump` (35 772 856 bytes), backend/frontend health
x2 OK, public 200, backend/frontend/warden online. `image-screen` still answers
401 without auth (mounted). Gates before deploy: backend **371 suites / 5 737
tests**, frontend **147 files / 1 768 tests**, tsc and production build clean.

**Next:** repeat the `ppprsa.shop` photo through blur -> re-scan -> publish.
The listing should pass without admin review now. Then run a flagged video
through Reupload, Admin review, and Delete.

## 2026-10-21 - BLUR TOOL POINTER ALIGNMENT (FRONTEND-ONLY HOTFIX)

**The blur selection box did not follow the cursor.** The canvas was styled
`width:100%` with a `maxHeight` and `object-fit:contain`; the element box and
the rendered image were therefore not the same rectangle, so pointer
coordinates were scaled against the wrong width. Fixed by auto-sizing the
canvas inside a centred flex container (`max-width:100%`, `max-height:56vh`,
no `object-fit`), and by tracking drag start/current in refs so fast pointer
moves cannot commit a stale box.

Commit **`ad371eed`**. Frontend-only deploy at 09:40 SAST: rollback
`alloutdoor-20261021-094022.dump` (35 772 368 bytes), frontend health x2 OK,
public 200 x2; backend/warden untouched and online. tsc clean, targeted media
specs green, production build exit 0.

## 2026-10-21 - EARLY MEDIA SCREENING, IMAGE BLUR, PENDING VIDEO REVIEW (FULL DEPLOY)

**Sell starts media moderation at selection.** Every photo is sent to the new
`POST /listings/image-screen` as soon as it is picked; the selected video uses
the existing `video-preflight`. Failures open one fixing window at a time, in a
queue, without waiting for Preview.

**Image failures open the seller's blur tool.** The model's detected reason is
shown, the seller draws over the photo, and applies one fixed Gaussian blur
strength/padded band. The redacted file is re-screened immediately. Clear ->
continue; still flagged or unreadable -> the listing is forced to
`PENDING_REVIEW`. `forceReview` on create means it cannot become public before
an admin approves it. "Replace photo" remains the secondary action, and a
manual "Hide details" control is on every thumbnail.

**A flagged video gets three paths:** upload another, send for admin review, or
delete. Admin review stores the clip privately, publishes the listing with its
photos, and hides the video until approved. Approval promotes it to a public
asset; rejection deletes it and notifies the seller. A video failure at publish
never rolls back a listing that already has photos. Admin review now has a
Video review queue in `/admin/operate` with audit logging.

**Edit has the same manual blur/replace tool** for existing and new photos, plus
early video preflight and the three video paths. Edited photos are re-screened;
if they still flag, the live listing is moved to `PENDING_REVIEW`. New edit
photos are not auto-screened on selection; the edit form still has no image
screen of its own.

Review SLA copy is now **up to 24 hours** across the seller surfaces and the
submitted-listing email preview.

Commit **`a9f1ea55`**. Full deploy at 09:11 SAST: migration
`20261020233000_listing_video_review` applied, rollback
`alloutdoor-20261021-091059.dump` (35 770 724 bytes), backend/frontend health
x2 OK, public 200 x2, backend/frontend/warden online. New routes answer 401
without auth (mounted).

Gates: backend `tsc` clean + **371 suites / 5 736 tests** (1 skipped);
frontend `tsc` clean + **147 files / 1 768 tests** (1 skipped) + production
build exit 0.

**Next:** manually run a flagged photo through blur -> rescan -> publish, and a
flagged video through each of the three paths. Confirm the admin Video review
queue approves a private clip and that it appears on the live listing.

## 2026-10-20 - PREVIEW VIDEO MODERATION AND ADMIN REVIEW TOAST (FULL DEPLOY)

**The sell Preview now screens the selected clip before the listing exists.**
`POST /listings/video-preflight` (auth, 64 MB, MP4/MOV/WebM, 10/min) uploads
the clip to a throwaway Cloudinary `preflight` folder, runs the same
image/audio moderation as publish (honouring the Without sound / With sound
choice), deletes the asset in `finally`, and returns the verdict only. Preview
runs it in parallel with the photo audit and merges the worst verdict: a
REJECT blocks publish with a red "Video issue" chip; HUMAN_REVIEW keeps publish
enabled but marks the listing as going to admin review; APPROVE leaves the
photo verdict alone. The verdict is cached per file + sound choice and
invalidated when either changes. Publish still re-uploads and re-screens the
attached file, so the final moderation is authoritative — the trade-off is a
second upload of the same clip.

**Admins now get a popup, not just a tab badge, when a listing enters review.**
`AdminTabBar` tracks `pendingListings` from the existing 60s attention poll and
raises the shared admin toast when the count increases: "N new listing(s)
waiting — open Operate". The first poll is a baseline, so opening the panel
with an existing queue stays quiet. Worst-case lag is the 60s poll.

Commits **`8ae96430`** (listings) and **`205ecb6d`** (admin). Full deploy at
21:43 SAST: rollback `alloutdoor-20261020-214308.dump` (35 637 847 bytes), no
pending migrations, backend/frontend health x2 OK, public 200 x2, all three
pm2 services online. New preflight route answers 401 without auth (mounted).

Gates: backend `tsc` clean + **370 suites / 5 729 tests** (8 skipped);
frontend `tsc` clean + **145 files / 1 764 tests** (1 skipped) + production
build exit 0.

**Next:** upload a clip with a visible contact detail and confirm Preview
blocks it; upload a clean muted clip and confirm it publishes; create a
pending review listing and confirm the admin toast appears within one poll.

## 2026-10-20 - PWA VIDEO PLAYBACK AND IOS SIGN-IN (FRONTEND-ONLY DEPLOY)

**Video playback was being swallowed by the service worker.** The Cloudinary
cache matched the whole host, videos included, and the default runtime cache
also treated `.mp4/.webm` as cache-first. WebKit plays with Range requests, so
a SW-cached response left the poster visible but the controls dead in the
installed iOS PWA. Fixed: video requests (`destination === 'video'` or
`.mp4/.webm/.m3u8`) are NetworkOnly before every cache rule, and the
Cloudinary cache is image-destination only. The installed PWA must take the new
SW via the update banner/reload.

**iOS Chrome sign-in was a client-side bounce, not a session conflict.** The
server logged five `POST /api/auth/login` 200s and five separate CriOS sessions,
none revoked; the PWA's session is a separate cookie jar and multiple device
sessions are allowed. The form now hard-navigates (`window.location.assign`)
after `adopt(...)` instead of `router.push` + `router.refresh`, so the fresh
httpOnly cookie is used rather than a prefetched unauthenticated RSC redirect.

Commit **`0b4180b5`**. Frontend-only deploy at 21:23 SAST: rollback
`alloutdoor-20261020-212335.dump` (35 637 190 bytes), frontend health x2 OK,
public 200 x2, backend/warden untouched and online.

Gates: frontend `tsc` clean + production build exit 0; full suite
**1 763 / 1 765** with the known `design-picker` pdf.js timeout, which passes
alone (7/7). Backend unchanged: tsc clean + **370 suites / 5 726 tests**.

**Still open (not built):** the listing video is not part of Preview — it is
moderated only at upload; the admin review queue has a 60s tab badge but no
popup, and the latest turret-tags listing is ACTIVE/APPROVE with no pending row.

## 2026-10-20 - VIDEO SOUND CHOICE AND AUDIO MODERATION (FULL DEPLOY)

**Marketplace clips can now be published with or without sound.** The Sell and
Edit forms default to **Without sound**; muted delivery uses a Cloudinary
`ac_none` derivative, so the audio is actually removed from the file. The public
listing payload no longer exposes the original `url`/`publicId` for a muted clip.
With sound keeps the audio and runs a second, audio-inclusive moderation pass.

**Audio is screened when the seller opts in.** Gemini receives a 720p
(fallback 480p) derivative with audio and is asked to listen for spoken phone
numbers, emails, URLs, social handles, "WhatsApp/call me/come to my shop" and
advertising in any SA language; ordinary narration, ambience, music, shots and
manufacturer names pass. Positive for banned content -> the clip is deleted and
the upload refused (a new listing's publish cleanup removes the half-built
listing). Unsure/unreadable audio -> the clip is stored, the listing moves to
PENDING_REVIEW and the reasons land in `claudeReasons` for `/admin/operate`.
Muted clips stay visual-only and never reach the audio screen.

**Existing clips backfilled as sound-on.** Migration
`20261020193500_listing_video_audio` adds `ListingVideo.audioEnabled` (default
false) and sets existing rows true. Sound can be changed later via
`PATCH /listings/:id/video`; turning sound on re-runs the audio screen, turning
it off only switches delivery to the muted derivative.

Commit **`3c6146ef`**. Full deploy at 20:40 SAST: rollback
`alloutdoor-20261020-204025.dump` (35 633 651 bytes), migration applied, health
x2 OK, public 200 x2, backend/frontend/warden online.

Gates: backend `tsc` clean + **370 suites / 5 726 tests** (1 skipped);
frontend `tsc` clean + **145 files / 1 764 tests** + production build exit 0.

**Next:** upload one muted and one sound-on clip to verify delivery and the
audio prompt in production; an unsure clip should appear in `/admin/operate`.

## 2026-10-20 - PHOTO MODERATION TO ADMIN REVIEW (FULL DEPLOY)

**A legitimate product-photo URL was being auto-blocked.** The vision screener
returned a hard REJECT for any image violation, so a packaging/shop URL
(ppprsa.shop) blocked the listing before an admin could judge it. Image flags
now return HUMAN_REVIEW: the seller publishes into the admin queue, the detailed
model reasons stay on the queue, and the seller sees a neutral "A photo needs an
admin check" line instead of "third-party advertising". Live ammunition remains
the one hard REJECT (with a reason-text fallback when the model omits the
category). QR codes, signage and contact details are now admin-judged too.

**Review SLA is visible.** The preview modal, pending-review banner,
`/my/listings` status hint and the sell form now say reviews can take up to 3
hours during business hours.

**Sell form helpers removed.** The "Not sure which to pick? See how selling
works" link and the "Not sure what to charge? / Suggest a price" box (and its
dead RVE state/handler) are gone. The backend estimate-price endpoint remains
unused by the form.

Commits **`c723a814`** (moderation) and **`39afbeb6`** (sell form). Full deploy
at 19:29 SAST: rollback `alloutdoor-20261020-192909.dump` (35 631 212 bytes),
no pending migrations, health x2 OK, public 200 x2, backend/frontend/warden
online.

Gates: backend `tsc` clean + **368 suites / 5 710 tests** (1 suite / 8 skipped);
frontend `tsc` clean + **145 files / 1 764 tests** (1 skipped) + production
build exit 0.

**Next:** re-run Preview on the Distance Turret Tags listing; it should publish
as Pending review. The listing-submitted email preview still says "2 business
hours" in `backend/data/email-previews/listing-submitted.html`; the runtime
template source is not in this repo.

## 2026-10-20 - LIVE LISTINGS AND SAVED COUNTS (FULL DEPLOY)

**The browse grids stayed stale until the buyer pulled to refresh.** Home,
category, brand and seller pages now poll `GET /api/listings/live-version`
every 20s and call `router.refresh()` only when the token actually moves
(active count + newest `updatedAt` + visible wishlist saves). The poll pauses
on a hidden tab, offline, and while a field/dialog has focus, and never
refreshes more than once a minute. The PDP polls `GET /api/listings/:id/stats`
every 15s for the saved count and refreshes itself when the listing sells or
goes payment-pending. Both endpoints use the same optional-auth and
`publicVisible`/status gates as the detail endpoint and answer
`Cache-Control: private, no-store`.

**Items now show how many people saved them.** The real Wishlist count rides
on every browse/search/recently-viewed/wishlist payload and renders as
`N saved` on cards from the first save (zero renders nothing); the PDP pill
drops its old >=3 floor. The viewer's own heart press moves the number
immediately and reconciles on the next poll. This is Wishlist saves, not
`AuctionWatch` opt-ins, so do not relabel it "watching".

Gates: backend `tsc` clean + **367 suites / 5 704 tests** (1 suite / 8
skipped); frontend `tsc` clean + **145 files / 1 764 tests** (1 skipped) +
production build exit 0.

Commit **`c75dd0ff`**. Full deploy at 14:49 SAST: rollback
`alloutdoor-20261020-144952.dump` (35 628 420 bytes), no pending migrations,
health x2 OK, public 200 x2, backend/frontend/warden online.

**Know.** Worst-case lag is the poll interval (20s browse, 15s PDP), not
instant push. A brand-new listing can appear in the token before Meilisearch
indexes it, so a search-results page may miss it until the next catalogue
change. The one ACTIVE listing in production is members-only, so anonymous
`live-version` currently returns `0:0:0` - that is the visibility gate, not a
bug. The `backend/package.json` motivation-golden scripts remain uncommitted.

## 2026-10-19 - GROK PLATE TIMEOUT FIX (BACKEND DEPLOY)

**The 2K/medium Grok plates were paid for and thrown away.** Measured on the box, one 2K/medium plate takes **99.5s**; both plate services still passed `timeoutMs: 60_000`, so every call aborted, retried twice and failed at ~181s. MO000099's 16:32 attempt logged four `motivation.plate` timeouts and kept nothing.

`TIMEOUT_MS` is now **180_000** in `motivation-plates.service.ts` and `quarry-plate.service.ts`. No key/model/aspect change was needed: `GROK_API_KEY` (last4 `jWRY`) returned a real 9.35 MB 2K image, and `21:9` is a supported ratio.

**Gemini key replaced too.** The box key (last4 `-HUg`) now returns **200 OK** on `gemini-3.5-flash` and `gemini-3.8-flash`; the previous `…s1Dw` value was returning 401 `ACCESS_TOKEN_TYPE_UNSUPPORTED`.

Gates: backend `tsc` clean + **366 suites / 5 695 tests** (8 skipped); frontend `tsc` clean + **143 files / 1 756 tests** (1 skipped) + production build exit 0. One frontend run hit the known 5s timeout in `no-self-recursive-callbacks.spec.ts`; it passed alone and the full rerun was green.

Commit **`fa2bb01f`**. Backend-only deploy at 19:35 SAST from a clean worktree (the main tree still carries the uncommitted fee-model rework): rollback `alloutdoor-20261019-193540.dump` (31 167 315 bytes), no pending migrations, health x2 OK, public 200 x2, backend/frontend/warden online.

**Next:** regenerate MO000099 once and confirm the log says `Purpose plates drawn (…): 4/4 kept`. If a render still exceeds 180s, raise the constant rather than lowering quality.

## 2026-10-19 - GROK PLATE QUALITY (FULL DEPLOY)

**Motivation plates now render at the same quality as Grok online.** xAI `/images/generations` was called without `quality` or `resolution`, so every plate defaulted to `1k` + `low`; the 1 k image was then upscaled to 1 800 px and stored at JPEG 82. `XaiProvider` now pins `quality: "medium"` and `resolution: "2k"`, the ledger prices the 2K-medium rate (`$0.08` an image), and both plate services store at JPEG 92 with `4:4:4` chroma so the downscale keeps detail.

**Prompts rewritten to xAI's six-part guide.** The species plates, all six self-defence scenes and the quarry line-up now lead with the subject, then materials/count/angle, props, directional light with readable exposure, colour fields, and lens/framing. The self-defence scenes moved off "dusk/night/dim" onto well-exposed twilight. `PLATES_PROMPT_VERSION` and `QUARRY_PROMPT_VERSION` are `2026-10-19a`; the course prompts share the new `EMPTY` tail.

Gates: backend `tsc` clean + **366 suites / 5 698 tests** (8 skipped); frontend `tsc` clean + **143 files / 1 756 tests** (1 skipped) + production build exit 0.

Commit **`4e0e8338`**. Full deploy at 14:32 SAST: rollback `alloutdoor-20261019-143219.dump` (32 829 034 bytes), no pending migrations, health x2 OK, public 200 x2, backend/frontend/warden online.

**Know.** A four-plate pack now costs `$0.32` (was `$0.16`). Existing stored plates keep their old bytes; only newly generated or regenerated motivations use the new settings, and each row's `promptVersion` records which brief drew it.

## 2026-10-19 - PWA SYSTEM CHROME REASSERT (FRONTEND-ONLY DEPLOY)

**Android launch inset.** The pre-paint theme script can run before Next emits the `theme-color` meta tags, leaving Chrome on stale system chrome until the member toggles theme; the bottom bar sat behind the system bar. `useTheme` now writes the resolved theme colour once after mount, mirroring the toggle that settled the insets.

Gates: frontend `tsc` clean + **143 files / 1 756 tests** (1 skipped), production build exit 0. Backend unchanged.

Commit **`b9ac2471`**. Frontend-only deploy at 08:35 SAST: rollback `alloutdoor-20261019-083529.dump` (32 812 167 bytes), health x2 OK, public 200 x2, backend/frontend/warden all online.

**Know.** Installed PWA keeps the light system bar and dark buttons; the app content still switches light/dark. The status bar is also light because Android uses one `theme-color` for both bars.

## 2026-10-19 - PWA SYSTEM CHROME AND NOTIFICATIONS BACK (FRONTEND-ONLY DEPLOY)

**Installed PWA system chrome stays light.** Android derives the navigation-button tint from `theme-color`; a dark theme-color left white buttons invisible on the device's default white bar. In standalone mode the app now keeps `theme-color` light (`#F7F6F3`) while the app content still switches light/dark. Browser tabs keep the app-coloured theme-color.

**Notifications back goes to Account.** The top-left chevron on `/notifications` now always `router.replace('/account')`, even when the PWA has history (iOS always does). System back will not fall into the notification tabs again.

Gates: frontend `tsc` clean + **143 files / 1 756 tests** (1 skipped), production build exit 0. Backend unchanged.

Commit **`4ded4e4a`**. Frontend-only deploy at 08:23 SAST: rollback `alloutdoor-20261019-082311.dump` (32 811 826 bytes), health x2 OK, public 200 x2, backend/frontend/warden all online.

**Know.** The PWA cannot keep a dark status bar while forcing a light navigation bar: Android uses the same `theme-color` for both. A TWA would be required for independent control.

## 2026-10-18 - MOBILE CHROME, NOTIFICATION ICON AND BACK STACK (FRONTEND-ONLY DEPLOY)

**Android system chrome.** The app could render dark while the `theme-color` meta stayed on the light arm (the media query follows the OS, not the member's explicit choice), so Android painted a white navigation bar under the dark tab bar. The pre-paint theme script and `useTheme` now rewrite every `theme-color` meta to the rendered theme.

**Notification icon.** Android was using the full-colour logo as the small notification icon. Added `notification-icon.png` (white alpha silhouette) and pointed the service worker `badge` at it.

**Notifications back stack.** Buyer/Seller/Account were history entries, so Android/iOS back cycled through them. The tabs now use `replace`; the header back button falls back to `/account` when Notifications was opened cold from a push.

**Notch safety.** The photo lightbox close button, counter, hint and thumbnails now respect `safe-area-inset-top/right/bottom`.

Gates: frontend `tsc` clean + **143 files / 1 756 tests** (1 skipped), production build exit 0. Backend unchanged.

Commit **`635e0e1d`**. Frontend-only deploy at 22:12 SAST: rollback `alloutdoor-20261018-221201.dump` (32 723 348 bytes), health x2 OK, public 200 x2, backend/frontend/warden all online.

**Know.** The service worker must finish an update (close/reopen the PWA or accept the update banner) before the new notification icon and app-badge code apply. Android/Samsung must also have notification badges enabled.

## 2026-10-18 - APPLE PUSH IPV4 FIX (FULL DEPLOY)

**iPhone push timed out, every time.** Samsung/Windows FCM accepted the test, but `web.push.apple.com` returned `ETIMEDOUT`. The same request with an IPv4-only HTTPS agent returns `201` in under a second. `PushService` now uses `new Agent({ family: 4, keepAlive: true })` for Apple endpoints only; FCM keeps the default agent.

Gates: backend `tsc` clean + **364 suites / 5 682 tests** (8 skipped); frontend unchanged (143 files / 1 756 tests, production build during deploy).

Commit **`4b9e7f11`**. Full deploy at 21:40 SAST: rollback `alloutdoor-20261018-214015.dump` (32 721 729 bytes), no pending migrations, health x2 OK, warden reloaded/online, public 200 x2, all three pm2 services online.

**Verified through the deployed `PushService`:** a real `test_notification` row for `turbosnail` sent to all **3** subscriptions and returned `sent=3` — Samsung, Windows and iPhone (Apple `201`). If the iPhone still shows nothing, check iOS Settings > Notifications for the installed PWA; the server-to-Apple leg is now working.

## 2026-10-18 - PER-DEVICE PUSH SUBSCRIPTIONS AND APP BADGE (FRONTEND-ONLY DEPLOY)

## 2026-10-18 - PER-DEVICE PUSH SUBSCRIPTIONS AND APP BADGE (FRONTEND-ONLY DEPLOY)

**Push is per device again.** `usePush` used `/push/me` (an account-wide answer) as if it meant "this device is enabled", so a second phone/laptop never showed the opt-in prompt when another device was already subscribed. It now requires both the account row **and** a local `pushManager.getSubscription()`. The backend already fans out to every `PushSubscription` row for the user.

**App-icon badge.** The service worker now mirrors the active notification count with `setAppBadge()` on push and `clearAppBadge()` when none remain; `notificationclose` also resyncs. The `badge` option on `showNotification` is only the status-bar glyph, not the launcher count.

Gates: frontend `tsc` clean + **143 files / 1 756 tests** (1 skipped), production build exit 0. Backend unchanged.

Commit **`93cbb7e2`**. Frontend-only deploy at 21:28 SAST: rollback `alloutdoor-20261018-212820.dump` (32 720 602 bytes), health x2 OK, public 200 x2, backend/frontend/warden all online.

**Test sent.** A real `test_notification` inbox row was created for `turbosnail` and pushed to both FCM subscriptions; both sends were accepted. Existing clients keep the old service worker until every tab/PWA window is closed and reopened, or the update banner is accepted; only then will the new app-icon badge code run. Android/Samsung launchers must also have notification badges enabled.

## 2026-10-18 - SIGNED ACTION LINKS FOR WHATSAPP, EMAIL, SMS AND PRIVATE ARRANGE (FULL DEPLOY)

**One action model across channels.** Sales, offers, counters, outbid and auction-win notifications now use the same signed `/a/<token>` action link and the same action verbs in WhatsApp, email, SMS and the in-app inbox. WhatsApp quick replies for `Accept`/`Decline` are resolved from the tapped message's `context.id` and the sender's phone, not from anything in the button text.

**Private Arrangement has a real action page.** `PRIVATE_ARRANGE_ACTION` tokens are minted for the seller and buyer; `/a/<token>` offers seller `Item delivered`, buyer `Item received` and either party `Dispute` without a session. The PA handover, delivery and buyer-reminder emails/SMS/in-app rows now use that page instead of `/transactions/<id>`.

**Declines match email/SMS.** WhatsApp sale and offer declines send the reason-picker link instead of silently recording `Declined via WhatsApp`/`OTHER`. Courier decline keeps its existing reason-picker, and counter decline still rejects directly.

Gates: backend `tsc` clean + **364 suites / 5 682 tests** (8 skipped); frontend `tsc` clean + **142 files / 1 754 tests** (1 skipped), foreground production build exit 0.

Commit **`6e95e447`**. Full deploy at 21:00 SAST: rollback `alloutdoor-20261018-210052.dump` (32 720 157 bytes), no pending migrations, health x2 OK, warden reloaded and online, public 200 x2, backend/frontend/warden all online.

**Know.** The Meta English template deletion lock is active until roughly 24-25 Oct. The four missing templates (`dealer_collection_ready_buyer`, `motivation_ready_applicant`, `motivation_needs_info_applicant`, `motivation_failed_applicant`) and the eight planned quick-reply/URL edits are still pending; quick replies will not fire until those templates are edited and approved. `bid_outbid_buyer` is still MARKETING, so its marketing-consent decision remains open. The PA action page and decline links are live now.

**Unrelated worktree state.** The tree still carries the pre-existing motivation-golden scripts in `backend/package.json`, the motivation changes and repo-wide CRLF-only stat noise. They were not committed. The deploy ran from a clean detached worktree at `6e95e447` because `deploy.sh` refuses a dirty tree.

## 2026-10-17 — INVALIDATE THE FROZEN RESEARCH (BACKEND DEPLOY)

Second inspection of MO000099, generated after `e807ad16`: the exhibit page break worked (page 5 is exhibits only; section 5 starts page 6), the 271 NONE boxes still pass, and the prior notice still fits. 5.2 was still the fallback.

**Why the new research never ran.** `researchAskVersion` was already `2026-10-17c` when `e807ad16` shipped. The generator treats a matching version as current and reuses `researchEncrypted`; MO000099's frozen pack was the old 180-byte firearm-only block, so the new purpose-aware ask and the quality gate were never reached. `RESEARCH_ASK_VERSION` is now **`2026-10-17d`**, which invalidates every frozen pack and forces one fresh pass. The old thin cache row is already ignored by the quality gate, and the new ask is keyed to sport shooting for this .223 self-loader.

Gates: backend `tsc` clean + **362 suites / 5 672 tests** (8 skipped); frontend unchanged, 142 files / 1 749 tests.

Commit **`512351fa`**. Backend-only deploy at 20:54 SAST: rollback `alloutdoor-20261017-205419.dump` (32 605 443 bytes), health x2 OK, warden reloaded and online, public 200 x2, backend/frontend/warden all online. No migration.

**Unrelated worktree state:** `backend/package.json` carries two uncommitted motivation-golden scripts from another session. It was stashed for the deploy's clean-tree gate and restored immediately after; it remains uncommitted and untouched.

**Next:** regenerate MO000099 once more. 5.2 should now contain the researched sport-specific bullet article; if the model again returns a thin answer, the retry runs once and the page falls back to the exhibit notes. The seller's card still prints receiver serial `ZA22265488` against headline/barrel `ZA2226548`; the 271 copies both faithfully and the applicant should verify it with the DFO.

## 2026-10-17 — RESEARCH THE PACK'S REAL PURPOSE, EXHIBITS KEEP THEIR PAGES (BACKEND DEPLOY)

Inspection of MO000099 / MO000099-saps271, generated after `2eeaa93b`. NONE, the 271 Section E / item 2.1 boxes, the cover hero, 5.1, the prior notice and the blank-page/TOC fixes all passed. Three things did not.

**The calibre ask was keyed to the wrong purpose.** MO000099 is a Section 16 hunter application whose .223 self-loader is argued as sport. `targetsFor` still used `USE_CLASS[S16_DEDICATED_HUNTER]` and asked for “advantages for hunting” beside four sport courses. The research now uses `resolveSportingPurpose` for the ask and its cache key, exactly as the plan and the exhibits do; the sport ask asks for recoil, sight recovery, accuracy, velocity/power factor and course demands, not impact energy.

**A truncated answer was cached as research.** The stored `.223` row was one 244-byte bullet ending “[cite: CIP”. `entryFor` now requires 120 words for a calibre entry (25 for a firearm, 20 for discipline/quarry, 40 for a held comparison), retries once when the answer is thin or ends mid-citation, and refuses to store or serve such a row. `cartridgeArticle` also accepts a single long paragraph; it used to require three lines, which discarded a valid one-block answer and sent 5.2 to the fallback.

**The last exhibit page shared section 5.** Page 5 carried the second pair of course photos plus heading 5 and its opening paragraph, under a running head saying THE FIREARM APPLIED FOR. `drawPurposePlates` now forces the next section onto a fresh page. The fallback's dangling “checked against:” bullet is gone.

**Verify with the DFO:** the seller’s card itself prints `Receiver Serial No ZA22265488` while the headline and barrel serial are `ZA2226548`. The 271 faithfully copies both; this is a card/SAPS-record discrepancy, not a PDF bug.

Gates: backend `tsc` clean + **362 suites / 5 672 tests** (8 skipped); frontend unchanged, `tsc` clean + **142 files / 1 749 tests** (1 skipped).

Commit **`e807ad16`**. Backend-only deploy at 20:30 SAST: rollback `alloutdoor-20261017-203021.dump` (32 553 495 bytes), health x2 OK, warden reloaded and online, public 200 x2, backend/frontend/warden all online. No migration.

**Know.** Regenerate MO000099 to fetch the full 5.2 article; re-downloading it already moves section 5 off the exhibit page. The old thin research row is ignored, so the next generation asks again.

## 2026-10-17 — NONE ON THE CARD, PURPOSE-RESEARCHED 5.2, PACK LAYOUT REPAIRS (FULL DEPLOY)

Operator: "it does not fill in NONE where model is ... it also dropped all the NONE inputs on the 271"; "Dedicated status held since should have ... a tickbox that says same as member of that association since"; "the WHY .30-06 SPRINGFIELD SUITS THIS PURPOSE should be researched why it fits the purpose exhibits"; and the attached MO000098's blank page 9, stray TOC "9", cover photograph and prior-notice spill.

**NONE survives the reader and the form.** The extract system prompt now says NONE is a value, not a blank, and forbids omitting the row or copying a neighbouring serial into it. `firearmIdentityPrompt()` was telling the reader to leave NONE rows out — reversed for model, make and every component serial/make. A NONE on a firearm key is trusted even when the model marks it low, so the one-tap upload writes it. `CURRENT_LICENCE` asks for the two retired component serials again (stored and printed on SAPS 271 item 2.1; the sheet still shows one serial row). `card-placeholder-boundary.spec.ts` now asserts `e_model = NONE`.

**Dedicated status since.** The date row offers "Same as member of that association since"; ticking copies `association_joined`, unticking clears it (`sheet-row.tsx`, wired from the licence-centre page).

**`.30-06` resolves.** The production Bench files it as "30-06 Spring." and the C.I.P. index under `3006springfield`. `calibreCandidates` now contracts SPRINGFIELD to both SPRG and SPRING and expands Spring back to Springfield, so the card's `.30-06 SPRINGFIELD` reaches the Bench drawing and the C.I.P. sheet. The cover gets the rendered hero again; 5.1 gets the full sheet.

**5.2 is researched against the exhibits.** The calibre ask names the four generated species/courses and asks why the round suits each; the cache key includes the exhibit set, and `RESEARCH_ASK_VERSION` is `2026-10-17c`. If a stored article predates the ask and names none of the exhibits, the page leads with them; if there is no usable article, the fallback uses the exhibit captions instead of C.I.P. platitudes.

**Layout.** The cover photo frame shrinks to leave the Part 7.2 grid on page 1. The empty outer cartridge heading is gone, so 5.1 and 5.2 are adjacent with no blank page or stray TOC entry. The prior-notice reserve now includes the applicant name and ID, keeping the whole signature block on the letter sheet.

Gates: backend `tsc` clean + **362 suites / 5 670 tests** (8 skipped); frontend `tsc` clean + **142 files / 1 749 tests** (1 skipped), foreground production build exit 0.

Commit **`2eeaa93b`**. Full deploy at 19:17 SAST: rollback `alloutdoor-20261017-191723.dump` (32 050 243 bytes), health x2 OK, warden reloaded and online, public 200 x2, backend/frontend/warden all online. No migration.

**Know.** A re-download fixes the existing pack's cover, 5.1, blank page and prior notice. Regenerate the motivation to fetch the new purpose-specific 5.2 research; an existing stored article is still used unless it names none of the exhibits, in which case the page now leads with them.

## 2026-10-17 — ONE S16 ENTRY, AUTOMATED ROUTE, TWO FULL CARTRIDGE SHEETS (FULL DEPLOY)

Operator: "only one entry point for s16", "remove all the questions that asks the user what are they planning to do with this firearm", "look at what firearms they already own and what section the licenses falls in, look for gaps", and "the rendered cartridge shows on the first page ... the full page CIP dimension sheet ... a second cartridge sheets ... the two page images of either animals ... or the shooting activities ... mix them if the firearm is capable of both."

**S16 is one door.** `frontend/lib/licence-labels.ts` offers one "Dedicated hunting or sport-shooting" tile under Section 16. The enum still holds both values so every stored application loads; `LICENCE_TYPE_LABELS` and the association labels are neutral, and `dedicatedStatusFits()` accepts hunter, sport and both papers on any Section 16 application (professional-hunter registrations remain refused).

**No purpose questions, anywhere.** `firearm_use_kind`, `intended_quarry`, `hunting_history`, `hunting_locations`, `activity_record`, `competition_record`, `s13_reasons`, `s13_movements`, `s13_carry_style`, `threat_circumstances`, `daily_movements`, `alternatives_considered`, `continued_use`, `firearm_fit_reason` and the owned rows' `use`/`primary_use` are `internal` — hidden from the sheet, still accepted from old drafts, and still reaching the writer where a member had answered. The client no longer fires the "confirm this reason" call on page load. Empty sheet sections are dropped.

**The pack chooses hunting, sport or both.** New `motivation-purpose.ts` reads the applied-for firearm (handgun/self-loader = sport; dangerous chambering = hunting; manual rifle/shotgun = both) and then the battery: where a held Section 15/16 firearm is the same calibre class, the new one is argued into the complementary gap. Used by `planFor`, the candidate uses, the reason angles, the research ask and the exhibits. Both Section 16 types now share one angle pool.

**Two full cartridge sheets plus the cover hero.** The cover keeps our rendered cartridge. Inside, after the firearm section, page one is the FULL-PAGE C.I.P. dimension sheet (our full-width drawing is the fallback for a wildcat); page two is a FULL PAGE of why the round suits the applied-for purpose. The old half-column inset is gone. `CipSheetService.lookup` now resolves card spellings (`9MM PAR ( 9X19MM )`, `9x19mm`, `6.5MM CREEDMOOR`, `.45-70 GOVERNMENT`) through `calibreCandidates`, so the sheet pulls in where it used to miss.

**Exhibits: four plates over two pages.** Hunting shows four quarry species (two a page), sport four courses of fire, and a firearm that does both shows two of each; the species reserve fills from the cartridge's class so a page is never half empty for a known firearm.

Gates: backend `tsc` clean + **362 suites / 5 662 tests**; frontend `tsc` clean + **142 files / 1 746 tests**, foreground production build exit 0.

Commit **`87004018`**. Full deploy at 17:55 SAST: rollback `alloutdoor-20261017-175548.dump` (30 921 319 bytes), health x2 OK, warden reloaded and online, public 200 x2, backend/frontend/warden all online. No migration.

## 2026-10-17 — THE CARD'S NONE IS NEVER DISCARDED (BACKEND DEPLOY)

Commit **`851b38af`**, 2 backend source + 2 specs. Backend-only deploy via `infra/deploy/deploy.sh --backend-only`. Rollback point `alloutdoor-20261017-104615.dump` (30 918 236 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `851b38af`. No migration.

Gates: backend `tsc` clean + **360 suites/5647 tests**.

Re-deployed `8dda18ab` at 11:50 SAST to align the recorded HEAD to the docs commit (backend bytes unchanged): rollback `alloutdoor-20261017-115016.dump` (30 918 633 bytes), health x2 OK, warden online, public 200 x2.

**The ask.** Operator, 2026-10-17: "Uploaded a licence inside the motivation for the firearm I want to apply for and it discards the NONE from the model. Make sure it never discards the NONE from any field on the motivation or the 271 form."

**What shipped.** The readers, the vault, `sanitiseAnswers` and the SAPS 271 already kept NONE — the loss was at the three suggestion/offer builders, which ran `answerValue()` and turned a card's "NONE" into nothing before the member could accept it. New `printedAnswerValue()` in `card-placeholder.ts`: **NONE is a value**, while N/A, nil, a bare dash and model-declining phrases are still dropped. Applied at `addUpload`'s stored reading, `readingFor` (desktop read-back) and `addFromLibrary` (vault adoption). The writer's prose boundary (`renderFacts` → `answerValue`) still strips every placeholder, so the letter never writes about a firearm called None. Specs updated: NONE kept at the offer, "-" dropped, plus a `readingFor` regression.

**Know.** A document already uploaded does not need re-scanning — its stored reading kept the NONE and `readingFor` now offers it; re-open the upload to see the suggestion. The writer's prose is unchanged by design.

## 2026-10-17 — PRIOR-NOTICE LETTER SHORTENED (BACKEND DEPLOY)

Commit **`0eba8e74`**, 1 backend source + 1 spec. Backend-only deploy via `infra/deploy/deploy.sh --backend-only`. Rollback point `alloutdoor-20261017-095738.dump` (32 408 581 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `0eba8e74`. No migration.

Gates: backend `tsc` clean + **360 suites/5646 tests**.

**The ask.** Operator, 2026-10-17: "still the same, work on the wording and shorten the whole document" — the signature block (and the name) was still spilling past the letter's page.

**What shipped.** `buildPriorNoticeRequest` rewritten shorter. Every provision it rests on is kept — reg 89, PAJA s3, reg 91(1)(a) with the 90 days, reg 91(4) — and the three numbered asks stay three. Cut: the second sentence of each point, the repetition between them, and the separate contact undertaking. `PRIOR_NOTICE_VERSION` bumped to `pn-2026-10-16-a-draft`. The type-shrink fallback from `84bfbbf4` stays as the second line of defence. Render now closes the letter, signature included, on its own page (regression spec updated).

## 2026-10-16 — PRIOR-NOTICE LETTER FITS ONE SHEET (BACKEND DEPLOY)

Commit **`84bfbbf4`**, 1 backend source + 1 spec. Backend-only deploy via `infra/deploy/deploy.sh --backend-only`. Rollback point `alloutdoor-20261016-165926.dump` (32 277 561 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `84bfbbf4`. No migration.

Gates: backend `tsc` clean + **360 suites/5646 tests**.

**The ask.** Operator, 2026-10-16: "trim the REQUEST FOR PRIOR NOTICE AND WRITTEN REASONS — the name and surname spills over to the next page."

**What shipped.** The one-sheet fit for the prior-notice letter searched spacing only, and a slightly longer letter ran out of air — the signature block, and the applicant's name, went overleaf. The fit now also shrinks the **body type** (down to 90%), keeping every word; the first candidate is still 11 pt, so a letter that already fits is unchanged. Masthead untouched. Regression spec renders a long firearm line and asserts the first sentence, the last sentence and the signature rule all sit on the letter's own sheet.

## 2026-10-16 — DOCUMENT DICTIONARY, STEP C1 + C2 (BACKEND DEPLOY)

Operator direction: "do what is safe in steps, so we can keep track of what is done and what still needs to be done." Step C is the internal consolidation of the document tables; C1 and C2 below moved data with NO behaviour change (both are re-exports, so every importer is unchanged).

- **C1 — `72cacd2a`** (backend-only deploy). New `common/document-filing/document-dictionary.ts` is the single source for the vault kind/cover options and the motivation kind options; `vault-kind-options.ts` and `motivation-kind-options.ts` became thin re-exports. `document-dictionary.spec.ts` pins it: vault options are live `CredentialKind`s (`currentKind` maps each to itself), the cover set is the kind set minus `OTHER`, and the motivation set mirrors `CLASSIFIABLE` (now exported).
- **C2 — `b1503345`** (backend-only deploy, rollback `alloutdoor-20261016-163235.dump`). `CREDENTIAL_TO_UPLOAD` (the vault-kind → motivation-slot placement map) moved into the dictionary and is re-exported from `motivation-credentials.ts`. Spec pins the dedicated-certificate row.

- **C3 — `4e64e225`** (backend-only deploy, rollback `alloutdoor-20261016-164120.dump`). `WANTED` (what each `CredentialKind` is read for, 263 lines) moved into the dictionary and is re-exported from `licence-centre-extract.service.ts`. A vault kind's folder, its placement and its read fields now all live in one module.

Gates each step: backend `tsc` clean + **360 suites/5645 tests**.

**Step C — complete.** C4 ("a decider/placer seam shared by the two classify paths") was assessed and NOT pursued as a refactor: the decider is already shared (`DocumentFilingService.fileVault` + `readMarkers`), the placer maps now live in the dictionary (`CREDENTIAL_TO_UPLOAD`, `effectiveUploadKinds`), and the remaining per-service glue is surface-specific (different enums, different marker→kind maps, different vision fallback). Merging it would be risk without behaviour gain. The dictionary spec is the drift guard.

**Also still pending (needs a live action, not code):** re-download MO000096 to confirm the annexure index no longer lists the good-standing letter; upload/read one document to confirm a HIGH-reasoning read returns complete fields.

## 2026-10-16 — OCR REASONING, ANNEXURE-INDEX COVERAGE, ENDORSEMENT GUARD (FULL DEPLOY)

Commit **`54e7d1e7`**, 11 backend files + 1 frontend. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261016-162206.dump` (32 186 918 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `54e7d1e7`. No migration.

Gates: backend `tsc` clean + **359 suites/5638 tests**; frontend `tsc` clean + **142 files/1745 tests** + prod build.

**STEP A — the annexure index asked for a good-standing letter a valid cert already covered.** `motivation-render.service.ts:1260` built the missing-document set from `u.kind` only and the uploads query did not select `coversKinds`, so `documentStatus(...).missingRequired` at `:1359` missed the date-gated coverage every other surface counts. Now: select `coversKinds`; `missingRequired` uses `[kind, ...coversKinds]`; `buildAnnexures` stays kind-only.

**STEP B — HIGH reasoning on every OCR call, on flash-lite.** `modelFor` (`llm.service.ts`) now pins every document purpose (`vault.*`, `licence.card.*`, `motivation.transcribe`, `motivation.classify(.file)`, `motivation.source.face`, `motivation.evidence.classify`, `motivation.extract.*`) to `gemini-3.1-flash-lite`. New `OCR_THINKING` (budget 32 768 ⇒ `HIGH` on 3.x) and `OCR_MAX_TOKENS = 65 536` (the model's own cap, probed) applied at all 12 OCR call sites, replacing 40/120/200/700/1200/2400 caps — thinking inside the output budget could previously truncate a read. Non-Gemini roads are unaffected (DeepSeek always sends its own `thinking: disabled`).

**STEP D — endorsement over-cover + copy.** `ASSOCIATION_ENDORSEMENT` added to `EXCLUSIVE_COVERS` (`licence-centre-extract.service.ts`) so Jev cannot tag it `also_covers: DEDICATED_DISCIPLINE` (as it did on the operator's row); Document Centre associations copy now says a valid dedicated certificate serves as the good-standing letter. Spec added in `licence-centre-naming.spec.ts`.

**Still to do — STEP C: one decide → read → place pipeline.** The decider (markers → Jev) and per-kind extractor already exist on both surfaces and now run on flash-lite HIGH; `WANTED` and `CREDENTIAL_TO_UPLOAD` are already enum-exhaustive. The remaining work is the **consolidation of the scattered tables** (`VAULT_KIND_OPTIONS`/`VAULT_COVER_OPTIONS`, `MOTIVATION_KIND_OPTIONS`, `CLASSIFIABLE`, `CREDENTIAL_TO_UPLOAD`, `WANTED`, `document-fields`) into one document dictionary consumed by both surfaces — a refactor with no behaviour change, deliberately NOT bundled into this release. Operator direction: do safe work in tracked steps.

**Pending verification.** Re-download MO000096 to confirm the index no longer lists the good-standing letter; upload/read one document to confirm a HIGH-reasoning read returns complete fields.

## 2026-10-16 — UNSTATED HELD-FIREARM PURPOSE REWRITTEN TO THE SECTION (FULL DEPLOY)

Commit **`ec9d2e69`**, 2 backend source + 1 spec. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261016-133117.dump` (32 222 090 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `ec9d2e69`. No migration.

Gates: backend `tsc` clean + **359 suites/5638 tests**; frontend `tsc` clean + **142 files/1745 tests** + prod build.

**The report.** Operator: "check why it couldn't generate a new motivation" (MO000096), then "the cz does have a section printed on the license card". Diagnosis confirmed the section IS on record (`existing_firearm_2_section_held = "section_16"`; vault card `section: "SECTION 16"`). The real cause was downstream: the `FirearmUseProfile` table has EMPTY uses for `6.35MM BROWNING / Handgun / s16_hunt` and `/s16_sport` (s13=7, s15_sport=3). So the held row had neither a stated purpose (`existing_firearm_2_primary_use` is unset) nor candidate uses, and the writer's "the CZ … is for sport shooting" was refused as a purpose nobody stated — a CLAIM, so `repairTargets` returns null and the run fails hard after 3 attempts. Third recurrence (MO000074, MO000075, MO000096) on the same CZ 6.35mm.

**What shipped.**
- New pure `repairUnstatedPurpose(text, ctx)` in `motivation-scope.ts`: for a sentence that names a held firearm with no stated purpose and no candidate uses and uses a sporting/hunting word, it replaces the sentence with the section-only form (`The CZ 6.35MM BROWNING is licensed under section 16.`), or its identity where no section is known.
- Run in `motivation-generation.service.ts` before the model repair; the full gate (`packConsistency` + `documentScope` + `followsPlan`) re-runs over the rewrite, so an invented fact or wrong section still fails. No model call, no tokens.
- 2 scope spec tests: the rewrite clears the very check it tripped, and a stated purpose or a bare identity is left alone.

**Know.** The empty `6.35mm` s16 use rows were left in place (data untouched). A held firearm with a known section but no stated purpose now generates instead of failing. The durable alternative — the applicant stating the held firearm's purpose ("What it is for") — remains the better fix and is still worth prompting for.

## 2026-10-16 — MALFORMED CARTRIDGE ARTICLE REFUSED (FULL DEPLOY)

Commit **`1269bf69`**, 1 backend source + 1 spec. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261016-124355.dump` (32 223 477 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `1269bf69`. No migration.

Gates: backend `tsc` clean + **359 suites/5636 tests**; frontend `tsc` clean + **142 files/1745 tests** + prod build.

**The report.** Operator attached `MO000096 (10).pdf` and said "inspect". Rasterised it: 24 pages, **only page 7 (cartridge) broken**. The stored research article came back as one word per line with a stray counter — `The / 2 cartridge / 3 is / 4 properly / … / 12 which` — a truncated fragment with citation markers. It printed as twelve one-word paragraphs and left the page blank. Everything else on pages 1-6 and 8-24 is clean.

**What shipped.**
- **`articleIsUsable` guard** in `motivation-pdf.service.ts`: a sliced article with fewer than 60 words, or whose lines are mostly under three words, is refused and the page falls back to the held-figure bullets (always clean). This is a render-time guard, so a **re-download** fixes the page with no regeneration.
- Restores the earlier `articleIsUsable`-style protection; test fixtures lengthened past the floor so the column tests still exercise a real article.

**Know.** The bad text is in `Motivation.researchEncrypted` — a data problem from the grounding provider, not a layout bug. The fallback shows on the next download; the **real advantages only return when the pack is REGENERATED** under the current ask (`RESEARCH_ASK_VERSION 2026-10-16b`). The writer also received that garbage research, but the body reads fine, so only the cartridge page was affected. A deeper fix — refusing/retrying malformed research at GENERATION, before it is stored — is not done and is worth doing if it recurs.

## 2026-10-16 — CARTRIDGE PAGE FILLED: DIMENSIONS BLOCK + MORE BULLETS (FULL DEPLOY)

Commit **`b0bf9cd6`**, 2 backend source + 1 spec. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261016-120532.dump` (32 313 451 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `b0bf9cd6`. No migration.

Gates: backend `tsc` clean + **359 suites/5635 tests**; frontend `tsc` clean + **142 files/1745 tests** + prod build.

**The ask.** Operator, 2026-10-16, on MO000096 page 7: "not happy with that" — the bullet-article page shipped in `0c025dca` came out two thirds blank because that pack had no research article (it fell back to four lines) and the dimensions block had been removed. Follow-up answer on the word count: "more words more facts".

**What shipped.**
- **The STANDARD DIMENSIONS block is back**, under the cartridge image in the right column, built from the same `completeDims` set the drawing cuts. It fills the right column whatever the research returned.
- **The no-research fallback is ten bullets**, so that case fills the left column too (it was four).
- **The writer is asked for 350-400 words across 12-16 bullets** (was 250-300). `RESEARCH_ASK_VERSION` bumped `2026-10-16a` → `2026-10-16b`.
- **Measured ceiling:** 400 words / 16 bullets render on ONE sheet; 450 spill to a second. 350-400 is the safe band.

**Verified by rasterising the page** (`dist/src/motivations/pdf-raster.child.js`, scale 2): at 350 words the bullets fill the left column (1-10) and continue under the image/table down the right column (11-14) to the foot — both columns full, matching the operator's sketch.

**Know.** The earlier page was blank because (a) research was absent for that pack — the render is a read, so a completed pack only gains the researched bullets when it is REGENERATED under the new ask version — and (b) the dimensions block had been removed. Both are fixed; a pack that is only re-downloaded still shows the fallback until it is regenerated.

## 2026-10-16 — CARTRIDGE PAGE IS A TWO-COLUMN BULLET ARTICLE (FULL DEPLOY)

Commit **`0c025dca`**, 2 backend source + 2 specs. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261016-114243.dump` (32 277 765 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `0c025dca`. No migration.

Gates: backend `tsc` clean + **359 suites/5635 tests**; frontend `tsc` clean + **142 files/1745 tests** + prod build.

**The ask.** Operator, 2026-10-16, with a sketch: "i want to fill the cartridge page. Let the writer write all the advantages in bullete style why the cartridge is suited for the chosen role ... between 250 and 300 words. The cartridge image still has to be on the page ... in a articale style as the illustration."

**What shipped.**
- **Bullet article layout.** The cartridge page fills the left column top to bottom, then continues under the cartridge image down the right column — the sketch's magazine-feature shape. Replaces the old left/right "balanced" split.
- **Bullets.** The writer (researcher) sets the advantages as a bullet list, 250–300 words across 8–12 bullets, one reason per bullet why THIS round suits THIS application. `- ` line format; `RESEARCH_ASK_VERSION` bumped `2026-10-15a` → `2026-10-16a` so cached calibres re-ask. Bullets render with a `•` marker and a hanging indent, justified like the rest of the document.
- **The image stays.** It is the inset (C.I.P. sheet, else our drawing) at the top of the right column; the right-column text starts below it.
- **The standalone dimensions table is gone** (per the sketch; the image carries the dimensions as callouts). The no-research fallback is now bullets derived from the held figures.

**Know.** Removing the table was a judgement call on the sketch; flag to the operator if it should come back. `docs/project-reference.md` still describes the removed table and should be updated on the next doc pass.

## 2026-10-16 — EVERY PROSE PARAGRAPH JUSTIFIED (FULL DEPLOY)

Commit **`98ee029c`**, 3 backend files. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261016-102429.dump` (32 277 246 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `98ee029c`. No migration.

Gates: backend `tsc` clean + **359 suites/5635 tests** (1 suite/8 skipped); frontend `tsc` clean + **142 files/1745 tests** + prod build (untouched, run anyway).

**The ask.** Operator, 2026-10-16: "make the paragraph justify for the whole document."

**What shipped.**
- Justified prose: the body paragraphs and the declaration (main body loop), the PAJA prior-notice letter, the character-statement prose blocks (`text` and the italic quote block), and the HTML preview (`p { text-align: justify }`).
- **Reverses MOTIVATION-GUIDE-BOOK Part 7.1** (ragged right). The reversal is recorded at the body draw in `motivation-pdf.service.ts`. pdfkit justifies by word-spacing alone (no hyphenation), so a line heavy with serials or calibres can open white gaps.
- Left unchanged (not paragraphs): headings, tables, captions, the cover, annexure labels, and form furniture — notes, numbered questions, answer pills.

**Know.** No spec asserted the old alignment and none broke; pdf-parse still extracts the spaces, so the `squash()` helper was not needed for the new justified body.

## 2026-10-16 — CARTRIDGE GETS A FULL PAGE + PAGE-BALANCE FIXES (FULL DEPLOY)

Commit **`e654ea5d`**, 6 backend files (3 source, 3 specs) + `docs/project-reference.md`. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261016-095544.dump` (32 214 111 bytes). Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `e654ea5d`. No migration.

Gates: backend `tsc` clean + **359 suites/5635 tests** (1 suite/8 shown skipped); frontend `tsc` clean + **142 files/1745 tests** + prod build (frontend untouched, run anyway).

**The ask.** Operator, 2026-10-15, on MO000096: "Check for structure and lay out issues … it must apply to section 13, 14, 15, 16 and renewals. On the cartridge, I want it to have it's own page. the dimensions with the advantages of the cartridge for the applied for purpose, we can have the researcher research that. It must be a full page. Also address the almost completely empty pages."

**What shipped.**
- **The cartridge owns a sheet, always.** `placeCartridgeFeature`, the deferred path and the `wantsCartridge` branch all break to the feature's own page; it no longer depends on a research article existing (which is why MO000096 left a bare third: the calibre research came back empty, so the drawing fell into the firearm section's tail).
- **Dimensions table.** New `cartridgeDrawing.specs`, built in `motivation-render.service.ts` from the same `completeDims` the drawing cuts, via `cartridgeDimRows`; drawn as `STANDARD DIMENSIONS` under the picture in the right column (`drawSpecTable`). Table and callouts cannot disagree, and a derived letter is omitted from both.
- **Advantages researched.** The calibre ask now asks for the cartridge's advantages for the applied-for purpose; length re-measured to ~300 words / 8 sections for the full-page slot. `RESEARCH_ASK_VERSION` bumped `2026-09-10c` → `2026-10-15a`, so cached calibre rows re-ask on the next generation.
- **No-research fallback.** `CARTRIDGE_STANDALONE` prints a standardisation/interchangeability note derived from the held figures, so the page is never bare.
- **Declaration measured fit.** It opens its own page only when the whole close (heading + paragraphs + signature + disclaimer) will not fit what is left; otherwise it fills the sheet. MO000096's orphan-paragraph page 9 came from the old unconditional break.
- **PAJA letter fits one sheet by spacing**, never by cutting words (four measured leading/gap candidates).
- **Owned-firearms `Section` column** widened 46 → 60pt; the header no longer wraps to "SECTIO / N".
- **Licence cards three to a sheet.** `planAnnexurePages` gained `{ perPage }` and `AnnexureImagePage.threeUp` (set for `CURRENT_LICENCE`); a 5-card run is 3 + 2, not 2 + 2 + 1.

**Verification.** All motivations suites green; full backend suite green; frontend untouched but its gates run. A throwaway render harness (since deleted) confirmed the cartridge page carried heading + callouts + table + article and nothing from the next section, the fallback printed with no research, and five licence cards packed 3 + 2.

**Know.** The cartridge page now deliberately owns a sheet on both sides, so the page *before* it can end short — the tradeoff the operator asked for. `docs/project-reference.md` updated (annexure packing, cartridge slots, declaration/PAJA rules).

## 2026-10-15 — A DOCUMENT CAN BE ADDED TO A COMPLETED PACK (FULL DEPLOY)

Commit **`a45ef7f0`**, 2 files edited + 1 new spec. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-222807.dump`. Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `a45ef7f0`. No migration.

Gates: backend `tsc` clean + **359 suites/5630 tests**. Frontend untouched.

**The report.** Operator: "uploaded it but nothing seemed to have happened" (the SA Hunters endorsement, after the match feature shipped). Diagnosed from production: nginx logged `POST /api/motivations/<id>/uploads 409`, and the row never appeared. **Root cause: MO000096 is `COMPLETED`**, and every document route required `EDITABLE` (DRAFT / INTERVIEW / NEEDS_MORE_INFO) — the pack was locked. Nothing to do with the endorsement code.

**Why COMPLETED should allow it.** The pack re-renders on every download from the stored rows, so a document added after generation appears on the next download and takes its annexure letter from the same `buildAnnexures` call; the written prose is unchanged until the member regenerates, which `REGENERABLE` already allows from `COMPLETED`. Locking uploads left an admin as the only way to add a document the DFO requires.

**What shipped.**
- New **`DOCUMENT_EDITABLE = EDITABLE + COMPLETED + FAILED`** in `motivation-shared.service.ts` (NOT `GENERATING`/`QUALITY_REVIEW`/`ABANDONED`).
- Applied to the document routes in `motivation-documents.service.ts`: autolink, add-from-library (`openForAttach`), `identify`, `addUpload`, `applyExtraction`, `removeUpload`. `changeUploadKind` (refile) already had no gate.
- **Left as EDITABLE-only:** `removeCredentialFromEditableDrafts` — a completed pack is retained evidence and is not swept when a vault credential is deleted.
- Spec: `motivation-document-editable.spec.ts`.

**Next.** Re-upload the endorsement to MO000096: it should now file as an endorsement (serial `ZABA01892` matches) and print on the next download.

## 2026-10-15 — ENDORSEMENT MISMATCH NOW SAYS SO (FULL DEPLOY)

Commit **`87d23635`**, 2 backend files + 1 frontend. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-221902.dump`. Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `87d23635`. No migration.

Gates: backend `tsc` clean + **358 suites/5627 tests**; frontend `tsc` clean + **142 files/1745 tests** + prod build.

**The ask.** Operator, 2026-10-15: "we read a different firearm's serial" — surface the reason, which the previous build left silent (the row just read "Something else").

**What shipped.**
- **Persisted reason.** `ENDORSEMENT_FIREARM_MISMATCH` sentinel written to `MotivationUpload.extractedFields` (no schema change — the SAPS_271_MARKER trick), so the reason survives a reload.
- **Row caution.** The GET uploads row now carries an amber `caution`: "We read a different firearm's serial on this document, so it was not filed as your endorsement. Re-file it if that is wrong." The wizard's `UploadRowNotes` already renders `row.caution`.
- **Immediate.** `addUpload` returns the same caution and the licence-centre toast shows it.
- **No fill from a mismatched endorsement.** Demotion leaves `resolved = OTHER`, which is `FIREARM_READABLE`, so the readFirearm fill is now suppressed for that row — otherwise the wrong firearm's serial would be offered on the application's own boxes.
- Constants live in `motivation-endorsement.ts` (`ENDORSEMENT_FIREARM_MISMATCH`, `ENDORSEMENT_MISMATCH_CAUTION`).

**Know.** The caution is `amber`, not `red` — it does not block or untick anything, it tells the member and offers the correction control.

## 2026-10-15 — ASSOCIATION ENDORSEMENT: GENERIC RECOGNITION + MATCH TO THE APPLIED-FOR FIREARM (FULL DEPLOY)

Commit **`c4b0604c`**, 4 files edited / 2 new. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-220658.dump`. Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `c4b0604c`. No migration.

Gates: backend `tsc` clean + **358 suites/5627 tests** (1 suite/8 tests skipped). Frontend untouched.

**The ask.** Operator, 2026-10-15: "the endorsement is a requirement for dedicated hunting and sport. We need to OCR it as such as well. We don't need to pull the information to fill in anywhere. But it must be matched to the firearm that is applied for. We can recognize it because it will say endorsement somewhere in the document. And it will also specify the firearm. Endorsements from different entities do not look the same, so we need to generically match them."

The example (`108828_Endorsement (1).pdf`) is a **scanned image (no text layer)** — that is the point. Rendered, it reads: title "ENDORSEMENT – DEDICATED SPORT SHOOTER", "PART TWO SUITABILITY OF FIREARM", a table Handgun · 9 mm Parabellum · Glock · Self loading · `ZABA01892` — the applied-for firearm exactly.

**What shipped.**
- **Generic recognition.** The Gemini fallback prompt `CLASSIFY_USER` only listed a subset of `CLASSIFIABLE` and omitted the endorsement; it now offers `ASSOCIATION_ENDORSEMENT`, `GOOD_STANDING_LETTER` and `FIREARM_SOURCE_PROOF`, and the Jev/Gemini hints key on the word "endorsement" plus a firearm named by type/calibre/make/action/serial (a "suitability of firearm" table). No per-entity layout is assumed.
- **Match (`motivation-endorsement.ts`, new).** `endorsementVerdict(endorsed, applied)` compares the read endorsement to the application's `firearm_*` answers: **serial first and it decides alone** (a same-serial endorsement is accepted even if worded differently; a different serial is refused even if everything else agrees); with no serial, type + calibre, refusing only on a clear disagreement (different class, or a differing lead number like 9 vs 308). Returns `match | mismatch | unverified`.
- **Wired at upload (`motivation-documents.service.ts`).** An endorsement is read once for the match. **Mismatch → demoted to OTHER (1a)** — it can no longer sit under the endorsement row. **Firearm not yet described → kept on trust (2a).**
- **No fill.** `ASSOCIATION_ENDORSEMENT` removed from `EXTRACTABLE` and `FIREARM_READABLE`, so it never writes a form field; it is read only to be matched.
- Tests: `motivation-endorsement.spec.ts` (9 verdict cases), `motivation-read-firearm.spec.ts` updated.

**Know.**
- The mismatch demotion is server-side and silent in the payload: the row simply reads "Something else" and the member can re-file it. There is no dedicated reason field on the upload row; a follow-up could surface the reason on the card.
- Jev filing is live in prod (`JEV_API_KEY` set). The Gemini fallback is the path when Jev cannot place the document.

## 2026-10-15 — MOTIVATION PACK LAYOUT: ANNEXURE HEADINGS, STAMP BLOCK, NO WATERMARK, NO END PAGES (FULL DEPLOY)

Commit **`5325e4ad`** (`feat(motivations) annexure headings, STAMP block, no watermark, no end pages`), 6 files edited / 0 new. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-214250.dump`. Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `5325e4ad`. No migration.

Gates: backend `tsc` clean + **357 suites/5617 tests** (1 suite/8 tests skipped). Frontend untouched.

**Operator's asks (2026-10-15), on MO000096 (6).pdf.** "I don't like the annexures that has one page dividers … I'd rather just have the page itself have a nice heading that says Annexure x with the content below it"; "remove the before you go pages at the end"; "remove the watermark"; "on the annexures that needs certification just add a 60mm x 60mm block at the bottom with the heading stamp"; "remove the things in the screenshots" (the index certification column and the Regulation 13(4)(b) note).

**What shipped.**
- **Annexure headings, no divider** (`motivation-pdf.service.ts`, `motivation-annexure-layout.ts`). The M8 divider sheet (`drawAnnexureDivider`: big letter, edge tab, item count) is gone. Each annexure now opens with `Annexure X — <label>` at the top of its first content page; the planner gained an `openingHeadingH` argument that reserves `HEADING_H` (18 mm) on the opening page only. Copies are planned **per letter**, so a letter always opens its own page and the heading lands at the top.
- **STAMP block** (`motivation-pdf.service.ts`, `motivation-annexure-layout.ts`). The four-field commissioner frame (Commissioner of Oaths / Signature / Date) and the `CERTIFICATION REQUIRED — REGULATION 13(4)(b)` heading are replaced by a single **60 × 60 mm box headed `STAMP`**. `STAMP_H` 92 pt → 170 pt (≈60 mm).
- **Index cleaned** (`motivation-pdf.service.ts`). The certification pill column (`REQUIRED` / `USUALLY ASKED`) and the Regulation 13(4)(b) paragraph are removed; the index is Tab · Document only.
- **Watermark removed everywhere** (`motivation-render.service.ts`, `motivation-pdf.service.ts`, `motivation-pdf-merge.ts`, `motivation-html.service.ts`, `motivations.service.ts`). The unpaid `NOT FOR USE` mark (pdfkit draw + pdf-lib merged-page draw) and the cover `Preview copy` line are gone; the flag is forced `false`. **This reverses the 2026-08-22 "watermark until paid" rule — unpaid packs are now clean.**
- **End pages removed** (`motivation-render.service.ts`). `takeWithYou` is no longer passed, so the `BEFORE YOU GO / TAKE THESE WITH YOU` sheets (last two pages) are not drawn. The renderer block and its insertion anchor still exist but stay gated.

**Open / not done.**
- **Endorsement (ask 2a).** Operator said the association's endorsement of the firearm "does not add". **It is not a render bug: MO000096 has no `ASSOCIATION_ENDORSEMENT` upload at all** — its 15 uploads are identity, competency, 2 proficiency, address, 3 safe photos, 5 current licences, association card (covers `GOOD_STANDING_LETTER`), firearm source proof. The index only letters an endorsement when one exists (`buildAnnexures` counts the kind). Awaiting a decision: (a) confirm the endorsement is expected to be generated, or (b) it is an upload that is being mis-classified elsewhere — needs the upload to reproduce.
- **Page fill.** The only near-empty prose pages are **p9 (210 chars)** and **p12 (439 chars)** — tails of a section that spilled one sentence onto the next sheet. Annexure pages are sparse by design. A generation-side top-up (the `motivation-fill.ts` path) would address it; not changed in this build.

## 2026-10-15 — MOTIVATION PLATES MOVE TO xAI (GROK IMAGINE) (FULL DEPLOY)

Commit **`476a953d`** (`feat(llm) xAI Grok Imagine provider for the motivation plates`), 6 files edited / 2 new. Full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-211118.dump`. Health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `476a953d`. No migration. Live probe on the box: xAI returned `status 200`, 1 image, `cost_in_usd_ticks` 400000000 ($0.04).

Gates: backend `tsc` clean + **357 suites/5619 tests** (1 suite/8 tests skipped). Frontend untouched.

**The ask.** Operator, 2026-10-15: "wire in the grok. just send it our own enhanced prompt." xAI has **no "enhance prompt" parameter** (the website's button is a client-side step, not an API field); the curated course-of-fire and species prompts are sent verbatim, exactly like the Gemini path.

**What shipped.**
- **`xai.provider.ts` (new).** The `xai` provider: `POST https://api.x.ai/v1/images/generations`, model `grok-imagine-image-2.0`, `response_format: b64_json`, `aspect_ratio` passed through (the plates use `21:9`, in xAI's list). Empty output is a `safety` refusal (a blank box must never be stored); retries the transient codes; maps HTTP/transport errors to the same `LlmError` codes as the other providers. **Images only** — `complete`/`stream` throw `unsupported`, and nothing routes text to it.
- **`llm.service.ts`.** `providerFor` pins `motivation.plate` and `motivation.quarry` to `xai` (the platform's only two `generateImage` call sites); an explicit `LLM_PROVIDER=…=xai` is also honoured, and `LLM_PROVIDER_MOTIVATION_PLATE=gemini` moves a plate back without a deploy.
- **`llm.pricing.ts`.** `grok-imagine-image-2.0` at a **flat $0.04/image** (docs.x.ai/developers/pricing; the API echoed `cost_in_usd_ticks` = 400000000). `costUsdMicros` charges `images × flatPerImageUsd`, carried on `LlmUsage.images`. Without this a plate would book as **$0** — the nano-banana 2.1 trap.
- **`llm.types.ts`** — `LlmProvider` gains `'xai'`; `LlmUsage.images`.
- **Tests** — `xai.provider.spec.ts` (7), routing/ledger pins in `llm.service.spec.ts` (the generic image-rescue tests moved to `dealer.verify`, since `motivation.*` is now pinned), and a flat-pricing test in `gemini-schema.spec.ts`.

**Env.** `GROK_API_KEY` set in `backend/.env` on the box (value from the local env; `XAI_API_KEY` accepted as a fallback). `XAI_IMAGE_MODEL` overrides the model. Backed up as `.env.bak-xai-<ts>` before the edit.

**Know.**
- The key must exist on the box for plates to draw; without it the plates fail soft and the pack renders with no exhibits.
- Grok output is cropped to the 2:1 page frame at store time (`fit: cover`, the existing pipeline); the 21:9 request only decides how much the model frames.
- The pins are code-level; the fallback lever if Grok draws badly is `LLM_PROVIDER_MOTIVATION_PLATE=gemini` (and `_QUARRY`) plus a reload.

## 2026-10-15 — MOTIVATIONS: COURSE-OF-FIRE EXHIBITS, CHEAPER PICTURES, FULL PAGES (FULL DEPLOY)

Commits **`84b1ef34`** (cheaper image model), **`ad3260c8`** (course-of-fire exhibits + page-fill), **`863c4973`** (keep ICORE off a pistol's defaults), 3 files new / 8 edited. Full deploy via `infra/deploy/deploy.sh` (Git Bash) x2 (the ICORE tweak redeployed). Rollback point `alloutdoor-20261015-192513.dump`. Health x2 OK, warden reloaded, public 200 x2, three pm2 services online. Deployed HEAD `863c4973`. No migration.

Gates: backend `tsc` clean + **356 suites/5608 tests** (1 skipped).

**Operator's three asks.**
1. "the current prompts does not look good ... research what the layout rules are for each course ... take out any humans and action. we just need to show the course of fire and explain it."
2. "use a cheaper gemini to create the images, nana banana is too expensive."
3. "sometimes it writes just one sentence on a page and the rest is empty ... add content to where the page is at least 50% full."

**What shipped.**

- **Course-of-fire exhibits (`motivation-courses.ts`).** The sport plates no longer draw a generic venue. **18 curated courses** — handgun (IPSC Practical Pistol, SADPA/IDPA, Steel Challenge, ICORE, Natshoot 20 m); self-loading rifle (IPSC Rifle, 3-Gun, TPS, SADPA Long Gun); manual rifle (SA Hunters bolt, Fullbore, Lever-Action, Cowboy, F-Class, PRS); shotgun (Clay/Trap/Skeet, IPSC Shotgun, Multi-Gun) — each sets out the actual course (targets, distances, positions, props) and a caption that EXPLAINS it. Selection mines the generated uses (`intendedUsesFor`, now computed BEFORE the draw) against each course's keywords, falls back to the class/action defaults, and never crosses class. `PLATES_PROMPT_VERSION` -> `2026-10-16a`.
- **Empty courses (`EMPTY` tail).** Every sport prompt now ends with no people, no shooter, no hands, no firearms, no muzzle, no muzzle flash, no motion or action. Verified on MO000096: an empty IPSC bay and an empty Steel Challenge plate array.
- **Cheaper pictures (`gemini.provider.ts`).** `DEFAULT_IMAGE_MODEL` -> **`gemini-3.1-flash-lite-image`** (~$0.0336/plate; priced in `llm.pricing.ts`). 2.1 was expensive AND unpriced — the ledger booked its spend as $0.
- **Full pages (`motivation-fill.ts`).** Geometry-derived floors from the real body column (BODY_SIZE/LEADING/indent): the writer is now told "no section is a single line" (rule 13) and a **thin-section detector** feeds the retry loop, which now also runs while a section is under its floor (bounded by the existing 3 attempts). Per-section floor ~18 % of a page, lower for sections short by design; the 50 %/40 % target is a PAGE fill, stored as `qualityFindings.pageFillEstimate` + `thinSections`. Rule 7 holds: the answer to a short section is the detail the brief names, never padding.

**Redraw.** MO000096 redrawn (plates-only): **IPSC Practical Pistol, Defensive Pistol (SADPA/IDPA), Steel Challenge, Natshoot / SA Jagters 20 m handgun** — `model = gemini-3.1-flash-lite-image`.

**Know.**
- The fill change is an ESTIMATE of page fill (from the layout geometry), not a measurement of the rendered PDF, and it targets SECTIONS under their floor — the retry loop is what tops them up. A true rendered-page measurement remains open.
- ICORE is revolver-only and now rank-last: shown when the firearm is a revolver or the uses name it, never as a pistol default.

## 2026-10-15 — MOTIVATIONS: ONE ANIMAL PER QUARRY EXHIBIT, UP TO FIVE (FULL DEPLOY)

Commit **`2d1ab786`** (`feat(motivations) one animal per exhibit, up to five, and retire the quarry line-up`), 4 files, full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-155124.dump`. Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `2d1ab786`. No migration.

Gates: backend `tsc` clean + **355 suites/5602 tests** (1 skipped).

**The report.** Operator, 2026-10-15: "do the same for the quarry. one animal per picture with up to five animals where applicable ... research what animals each firearm is good for in south africa ... give a description of why it is good for that animal." Asked where it should render, the operator chose: **Heading-3 exhibits, drop the cartridge-page line-up, animal alone (wildlife photograph)**.

**What shipped (hunting exhibits, `motivation-plates.ts`).**
- One animal per plate, **cap raised 4 -> 5** (`MAX_HUNTING_PLATES`; sport/self-defence stay at 4). Five plates is three pages — 2 + 2 + 1.
- Each species keeps its own picture (already one-to-a-plate) and now carries a **why-this-cartridge-suits-it** sentence. The reason is stated CLASS BY CLASS, not invented per species (`CLASS_RATIONALE`), and the plate is on the page because the cartridge brief for THIS application named the species (see `quarriesFor`). No energy, velocity or figure is asserted — a recalled number would be an invented fact on a signed document.
- Species still come from the research the document prints (firearm + calibre blocks) filtered by the applicant's own `hunt_game_class`; the research already asks what the round is used for in South Africa.

**What shipped (retire the composite line-up).**
- `motivation-generation.service.ts`: the `quarryPlates.makeFor(...)` draw is removed (nothing spends money on the line-up).
- `motivation-render.service.ts`: `quarryPhotoFor` deleted and `cartridgePhoto` no longer passed — the cartridge page keeps its text and C.I.P. inset, and the empty slot collapses (the PDF already handled "no quarry photo" for sport packs).
- `quarry-plate.service.ts` and its stored rows are left in place but are no longer drawn or shown. The `quarryPlates`/`quarry` constructor deps are kept (marked RETIRED) so specs that build these services positionally are untouched.

**Know.**
- No hunting motivation exists on prod to redraw (only MO000096, a sport pack), so nothing was regenerated. A NEW hunting pack draws its animals under heading 3; an EXISTING hunting pack loses the line-up on its next render (the render no longer supplies it) but keeps its cartridge text.
- `QUARRY_PROMPT_VERSION` is untouched (the composite prompt is dead); `PLATES_PROMPT_VERSION` -> `2026-10-15c`.

## 2026-10-15 — MOTIVATIONS: EXHIBITS ON NANO BANANA 2.1, TARGETS DOWNRANGE (FULL DEPLOY + REDRAW)

Commit **`78cf339e`** (`feat(motivations) draw exhibits with Nano Banana 2.1 and keep targets downrange`), 3 files, full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-150209.dump`. Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `78cf339e`. No migration.

Gates: backend `tsc` clean + **355 suites/5601 tests** (1 skipped).

**The report.** Operator, 2026-10-15: "it needs to use nano banana 2.1 to generate the images. Some of the images do not make sense, where the targets sit next to the shooting benches."

**What shipped.**
- **Model.** `DEFAULT_IMAGE_MODEL` in `common/llm/gemini.provider.ts` moved from `gemini-3.1-flash-lite-image` (the cheapest, "Nano Banana Lite") to **`gemini-nano-banana-2.1`**. The id is on the account's own `GET /v1beta/models` list and was probed live on 2026-10-15: it answers the ordinary generateContent shape at `21:9`. Still overridable with `LLM_IMAGE_MODEL` (unset on the box, so the code default applies). This is the model for EVERY image — quarry plate, cover photo and the purpose exhibits.
- **Layout.** A shared `DOWNRANGE` clause is now appended to every range venue prompt: the firing point/benches are in the foreground and every target is far downrange beyond them, never beside or behind the firing point. The "Target rifle and benchrest" prompt was rewritten to name the firing point and the butts explicitly — the one whose target frames sat next to the benches. `PLATES_PROMPT_VERSION` -> `2026-10-15b`.

**Redraw.** MO000096's plates were replaced (plates-only backfill): **Practical shooting (IPSC / IDPA)**, **Steel challenge**, **Indoor and club range practice**, **Club-level competition** — 4/4 kept, `model = gemini-nano-banana-2.1`, 1800x900.

**Know.**
- 2.1 is slower than Lite: ~14-20 s per plate vs ~4-7 s (observed on the redraw). Plates run in parallel so a pack gains roughly 20 s, but a regeneration that draws plates is slower than before.
- 2.1 costs more than Lite per image; the operator chose it for quality deliberately.

## 2026-10-15 — MOTIVATIONS: THE EXHIBITS FOLLOW THE FIREARM'S CLASS (FULL DEPLOY + REDRAW)

Commit **`5166718e`** (`fix(motivations) picture only the disciplines the applied-for firearm is eligible for`), 2 files, full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-144141.dump`. Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `5166718e`. No migration.

Gates: backend `tsc` clean + **107 motivations suites / 2404 tests** (full suite not re-run); frontend untouched.

**The report.** Operator, 2026-10-15: the exhibits now generate, "but I need the images to be specific to the type of firearm ... For the last motivation it must be disciplines a Glock 43X will be eligible for to use."

**Root cause.** `pickActivities` (`motivation-plates.ts`) filled its shortfall from the WHOLE `SPORT_ACTIVITIES` list, not just the matching ones — so MO000096 (GLOCK, 9 mm Parabellum, Handgun, semi-auto) was pictured with "Long-range precision", "Clay target shooting" and "Target rifle and benchrest": rifle and shotgun venues on a pistol pack.

**What shipped.**
- `weaponClass()` classifies the applied-for firearm from its own answers (type first — Handgun/Rifle/Shotgun — calibre only breaks a tie). Exported for tests.
- Every `SPORT_ACTIVITIES` entry declares the class(es) it may be pictured with; `pickActivities` only ever fills within the firearm's class. "Club-level competition" stays class-agnostic. An unrecognised type keeps the whole catalogue (never withholds exhibits).
- New handgun venues (Steel challenge, Indoor and club range practice) and a rifle (Veldskiet and gong) and shotgun (Practical shotgun) entry so each class can reach two pages on its own.
- `PLATES_PROMPT_VERSION` -> `2026-10-15a`.

**Redraw.** MO000096's four stale plates were replaced (plates-only backfill, document text untouched): **Practical shooting (IPSC / IDPA)**, **Steel challenge**, **Indoor and club range practice**, **Club-level competition** — 4/4 kept.

**Know.**
- The copy names the class, not the model: MO000096's answers carry `firearm_model = "NONE"` (make GLOCK), so the descriptions say "a compact self-loading pistol in 9 mm Parabellum". Fill the model on the application to have it named.
- Plates are stored at generation/backfill time; changing the wording or the class of an existing pack needs a redraw, not just a deploy.

## 2026-10-15 — MOTIVATIONS: THE PURPOSE EXHIBITS ACTUALLY DRAW (FULL DEPLOY + BACKFILL)

Commit **`329ce53b`** (`fix(motivations) request a supported image ratio so the purpose exhibits actually draw`), 5 files, full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-133544.dump`. Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `329ce53b`. No migration.

Gates: backend `tsc` clean + **355 suites/5598 tests** (1 suite/8 skipped, pdftotext); frontend untouched.

**The report.** Operator, 2026-10-15: "where is the pictures it is supposed to generate that will exhibit some of the activities that will be done with the firearm?" The purpose exhibits (operator 2026-10-14) shipped on 2026-10-14 but no pack ever carried one: `MotivationPlate` was empty.

**Root cause.** The plates asked the image model for aspect ratio `2:1`, which is NOT in the API's enumerated set. Every draw came back 400 INVALID_ARGUMENT and `Purpose plates drawn (sport): 0/4 kept`:

```
aspect_ratio must be one of '1:1','1:4','1:8','2:3','3:2','3:4','4:1','4:3','4:5','5:4','8:1','9:16','16:9','21:9'
```

The quarry plate never hit this because it already asks for `21:9`.

**What shipped.**
- `motivation-plates.service.ts`: asks for `PLATE_REQUEST_RATIO = '21:9'` (supported) and still crops to the operator's 2:1 frame at store time, so the printed shape is unchanged.
- `common/llm/llm.types.ts`: `SUPPORTED_IMAGE_ASPECT_RATIOS` — the API's own enumerated set.
- `common/llm/llm.service.ts`: `generateImage` refuses an unsupported `aspectRatio` up front with a clear message (names the value) instead of spending a call that returns 400.
- Regression tests: the plates ratio is in the supported set and the frame is 2:1; the LLM guard refuses `2:1` and still draws `21:9`.

**Backfill.** MO000096 (COMPLETED, no plates) was backfilled by drawing the plates only — sport plates are built from the applicant's own answers, so no research spend and the document text was not rewritten. A hand-built `MotivationPlatesService(prisma, new LlmService(prisma))` (the `scripts/backfill-*` pattern, bare `PrismaClient` + `PrismaPg`) drew **4/4 kept** (2 pages × 2, 1800×900, `gemini-3.1-flash-lite-image`). A completed pack re-renders on download, so its next download now carries the exhibits.

**Know.**
- Future generations draw plates inline; no further backfill is needed for new packs.
- Existing packs generated between 2026-10-14 and this deploy have no plates and need a backfill (or a regeneration) if their exhibits are wanted.

## 2026-10-15 — MOTIVATIONS: A SPELLED MEASUREMENT IS FOLDED, NOT FATAL (FULL DEPLOY)

Commit **`dbb07e6d`** (`fix(motivations) fold a spelled measurement into figures instead of failing the pack`), 3 files, full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-132159.dump`. Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `dbb07e6d`. No migration.

Gates: backend `tsc` clean + **355 suites/5596 tests** (1 suite/8 tests skipped, the pdftotext-missing ones); frontend untouched.

**The report.** Operator, 2026-10-15: "see why the last motivation did not generate." MO000096, a section 16 dedicated-sport application, was FAILED with the reason *"the document spells out a measurement; write it in figures"*.

**Root cause.** The reject draft was decrypted from `documentTextEncrypted`; the offending sentence was `steel targets spread over distances extending from seven to twenty-five metres.` — the mechanical `documentScope` check caught `twenty-five metres` (`spellsOutMeasurement`, `motivation-scope.ts`). It survived all three regenerations, and the mender could not touch it: `repairTargets` calls `phraseIn(issue)`, which returns `null` for this complaint because it names no vocabulary word, so the repair pass is skipped entirely. Three fresh drafts, the same slip, and the applicant was emailed "we could not finish".

**What shipped.** A deterministic `normaliseMeasurements` in `motivation-scope.ts`, folded into `southAfricanise` (so it runs before the gate, exactly like the spelling fold), converts an adjacent spelled number word — and a `to` range — in front of a unit into figures: `two hundred metres` -> `200 metres`, `seven to twenty-five metres` -> `7 to 25 metres`. The leading article is dropped only when it IS the number (`a hundred metres` -> `100 metres`) and kept when it belongs to the noun (`a five metre room` -> `a 5 metre room`). The unit word is untouched. The check stays and now fires only on a spelled number the fold could not parse. `firearm-uses.service.ts` deliberately still DROPS a spelled measurement (not folds) — its slice usually also carries the figures form and folding would ship both — so `spellsOutMeasurement` is screened on the raw sentence first.

**Know.**
- The writer prompt (`motivation-prompts.ts:839-840`) still grants an exception for a measurement that OPENS a sentence. After this fix that exception is moot: a sentence-initial spelled measurement is silently converted to figures too, so it neither fails nor survives. Left as-is to avoid re-baselining the prompt-cache spec.
- A slipped measurement is no longer worth a manual fix; the gate only pages an admin for what the fold cannot parse.

## 2026-10-15 — MOTIVATIONS: THE DEDICATED STATUS RUNS WITH THE MEMBERSHIP (FULL DEPLOY)

Commit **`b02f3a67`** (`fix(motivations) the dedicated status runs with the association membership`), 3 files, full deploy via `infra/deploy/deploy.sh` (Git Bash). Rollback point `alloutdoor-20261015-102428.dump`. Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `b02f3a67`. No migration.

Gates: backend `tsc` clean + **355 suites/5595 tests**; frontend `tsc` clean + **142 files/1745 tests** + production build OK.

**The report.** Operator, 2026-10-15, pointing at the "Dedicated status held since" and the association "valid until" rows: "these two are actually the same thing. If the membership expires so does the dedicated status." Asked how to treat the pair, the operator ruled: "keep both but link the two dates and user can change the dates if he wants."

**What shipped.** Copy on both rows (both association slots) says the dedicated status runs with the membership and ends on the membership's valid-until; both stay fully editable. A new warning `dedicated-status-after-membership` fires when `dedicated_since` is dated AFTER `association_expiry` — the status cannot begin after the membership it depends on has lapsed — so the pair is kept consistent.

**Know.**
- The vault already models membership + dedicated status + good standing as ONE validity (`licence-centre-naming.spec.ts`), and SAPS 271 item 60 already prints the membership's valid-until. This change only aligned the wizard wording and added the consistency guard.
- If the operator wants a LIVE link (editing one date auto-fills the other's value in the wizard) rather than a consistency guard, that is a frontend change and was deliberately not done — setting "held since" equal to "valid until" is usually an impossible date.

## 2026-10-14 — MOTIVATIONS: PURPOSE EXHIBITS, 1–2 PAGES OF GENERATED PICTURES UNDER HEADING 3 (FULL DEPLOY + MIGRATION)

Commit **`4d6cc2d5`** (`feat(motivations) purpose exhibits: 1-2 pages of generated pictures under heading 3`), 14 files (3 new source + spec, hand-written migration `20261014180000_motivation_plates`). Full deploy via `infra/deploy/deploy.sh` (Git Bash). Migration applied by `migrate deploy` — verified: `MotivationPlate` exists on the box and the migration is recorded finished. Rollback point `alloutdoor-20261014-201455.dump` (`/var/backups/alloutdoor/db/`, ~30.5 MB). Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `4d6cc2d5`.

Gates: backend `tsc` clean + **355 suites/5592 tests** (one file-storage timeout was an unrelated flake, green in isolation); frontend `tsc` clean + **142 files/1745 tests** + production build OK.

**The report.** Operator, 2026-10-14: "i want nano banana 2.1 images generated for all sections. 1 to 2 pages per application with descriptions of the pictures. For hunting the quarry the rifle can hunt, for self defense scenarios where the person might find themselves in. For sport shooting the activities they will be attending in competition or recreationally." Confirmed: embedded under heading 3, 2 pages, `gemini-3.1-flash-lite-image`.

**What shipped.**
- **`motivation-plates.ts`** — the scenes chosen IN CODE from the applicant's own answers, never a model. `purposeFor()` maps S13/S14 → self-defence, S16 hunter / S15 hunting → hunting, S16 sport / S15 sport → sport, S24 → none. Hunting pictures one plate per species the research names, filtered by the applicant's own `hunt_game_class` (reuses `quarriesFor`). Self-defence picks scenes (rural perimeter, communal access, commute, driveway) from premises/movements/circumstances. Sport picks disciplines from firearm class, action and association. Fail-soft: an empty list is a valid answer.
- **`motivation-plates.service.ts`** — draws in PARALLEL (4 max) via `LlmService.generateImage` (`model` defaults to `gemini-3.1-flash-lite-image`, `aspectRatio: '2:1'`), crops with `sharp` to 1800×900, stores one row per plate; replaces on regeneration; one refusal/slow call loses one plate.
- **`MotivationPlate`** table (schema + migration), bytes in-row so `pg_dump` covers them. A row per plate so a partial failure is not all-or-nothing.
- **PDF** (`motivation-pdf.service.ts`): `drawPurposePlates()` prints the exhibits under the plan's heading 3 — matched on `purposeHeading` off the structure plan, flushed at the next heading like the crime evidence — each page a clean `addPage()` with `3.1 Purpose exhibits (page N of M)` in the contents. A plate with no picture still prints its words.
- **Generation** (`motivation-generation.service.ts`): `purposePlates.makeFor()` beside the quarry plate; NOT gated on research.

**Know.**
- ⚠️ The prompts keep a self-defence or sport scene to the PLACE (a gate, a road, a range bay) with no people, weapons or acts, so the image model's violence filter clears. Do not add a person or a firearm to those prompts — a refused plate is a blank page in a lodged document.
- ⚠️ Cost and latency: ~$0.035/image, up to 4 per application, drawn in parallel (~15–25 s added to a run). A hunting pack whose research names no species gets no exhibits.
- ⚠️ A regeneration redraws the plates (a second gate cycle pays again), deliberately — matching the quarry plate, because new research can name different species/scenarios.
- Existing packs (e.g. MO000094) are unchanged; regenerate or file a new application to see the exhibits.

## 2026-10-14 — MOTIVATIONS: THE SAPS 271'S FIREARM BOXES, AND KEEPING THE CARD'S "NONE" (FULL DEPLOY)

Commit **`7b2bc27b`** (`fix(motivations) fill the 271's firearm boxes and keep the card's NONE`), 7 files, full deploy via `infra/deploy/deploy.sh` (Git Bash, backend touched). Rollback point `alloutdoor-20261014-165253.dump` (`/var/backups/alloutdoor/db/`). Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `7b2bc27b`. No migration.

Gates: backend `tsc` clean + **354 suites/5578 tests**; frontend `tsc` clean + **142 files/1745 tests** + production build OK.

**The reports.** Operator, 2026-10-14, on the generated SAPS 271 for MO000094 (S13, applied-for Glock 9mm): "It missed a lot of the applied for firearms details. It also wrongly filled in my current firearms details." Then: "make sure NONE is always kept and used as it is on the card."

**Cause (read from the live row MO000094 + the vault).**
- **The applied-for firearm's component rows (E 1.7–1.12) printed blank.** The FIREARM_SOURCE_PROOF upload's stored reading held all 12 fields, including `barrel_serial/frame_serial/receiver_serial` and their makes (all `ZABA01892`/`GLOCK`), but the ANSWERS carried only six. `FIREARM_SOURCE_PROOF`'s `EXTRACTABLE` list stopped at `firearm_serial`; the six component keys came ONLY from the `readFirearm` second pass, which tags every value `trusted: false`, and the one-tap upload flow (`applyReads`, `frontend/app/licence-centre/[id]/page.tsx`) writes only trusted fields — so they were read and dropped.
- **Item 2.1's Barrel Serial No column printed blank on every row.** `credentialOffer` computed it, but `offer()` gates on `keys.has(key)` where `keys` came from `fieldsFor()`, which deliberately excludes the collapsed legacy keys `existing_firearm_N_barrel_serial`/`_frame_serial`. Every owned barrel/frame serial the vault held (e.g. the Marlin's `NONE`, the Glock's `ZABA01892`) was silently dropped.
- **NONE was stripped in three places** while the SAPS 271 wants it: `parseFirearmReading` dropped it; the readFirearm answer boundary ran `answerValue`; and the offer gate above.

**What shipped.**
- `motivation-extract.service.ts` — added `barrel_serial, barrel_make, frame_serial, frame_make, receiver_serial, receiver_make` to `EXTRACTABLE.FIREARM_SOURCE_PROOF`, so the component rows reach the answers on the trusted confidence path.
- `common/firearm-identity.ts` — `parseFirearmReading` keeps `NONE`/`N/A`/`nil`; only the model declining (`unknown`, `not visible/stated/shown/legible`) is dropped.
- `motivation-documents.service.ts` — the readFirearm answer boundary keeps the card's value verbatim.
- `motivation-credentials.ts` — `offer()` now accepts the legacy owned component keys. The strip stays at the PROSE boundary (`renderFacts`), so the writer never sees "Model NONE".

**Know.**
- ⚠️ The fix applies to NEW reads and NEW applications. MO000094 (and any already-completed form) will not change; regenerate it (or a fresh application) to see the boxes fill. The vault already holds the component serials (WANTED.FIREARM_LICENCE reads them), so a fresh create picks them up via `credentialOffer`.
- ⚠️ Left as-is, deliberately: in-wizard `CURRENT_LICENCE` batches all target the same free row (the slot is computed from SAVED answers before any is applied). It is harmless here because those reads are untrusted and the vault already lists the firearms; making them trusted would duplicate the vault rows.
- ⚠️ Section F (current owner) stays blank until the private seller completes consent — by design.

## 2026-10-14 — MOTIVATIONS: THE DOCUMENTS SHELF STOPS RE-FETCHING (FRONTEND DEPLOY)

Commit **`f6a9bc6d`** (`fix(motivations) stop the documents shelf re-fetching every thumbnail on every render`), 3 files, frontend-only deploy via `infra/deploy/deploy.sh --frontend-only` (Git Bash) — the backend kept serving (uptime 29m after). Rollback point `alloutdoor-20261014-145152.dump` (~30 MB). Frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `f6a9bc6d`. No migration.

Gates: frontend `tsc` clean + **142 files/1745 tests** + production build OK.

**The report.** Operator, 2026-10-14: "Why can't I see or open the thumbnails anymore onside a motivation in the Your documents?"

**Cause.** nginx showed the per-document blob route (`GET /api/motivations/<id>/uploads/<uploadId>`) returning **429**. The shelf fetches one authenticated blob per tile, and that route has no per-route limit, so it shares the global 60-requests-a-minute bucket. The page passed `loadUrl` as an INLINE ARROW — a new function identity on every render — and the page re-renders on every scroll tick and every state change, so each tile's effect (which had `loadUrl` in its deps) re-fetched all N documents in a burst. Once throttled, tiles fell back to the generic icon and the View preview (same loader) 429'd too, so a shelf that had worked with a few documents broke as the count grew.

**What shipped.** `app/licence-centre/[id]/page.tsx` memoises `loadUrl` (`useCallback([getToken, id])`); `components/licence-centre/document-shelf.tsx` reads it through a ref so the tile effect depends only on `[doc.id, isImage]` — the bytes are fetched ONCE per document. A spec re-renders with a fresh `loadUrl` and asserts no second fetch.

**Know.** The global throttle is still 60/min per IP for ALL routes; a much larger shelf plus the page's other calls could brush it again. Raising the uploads GET's own limit (`@Throttle` on the route) is the lever if it recurs.

## 2026-10-14 — DOCUMENT CENTRE: A PHOTOGRAPH KIND IS NEVER FILTERED (FRONTEND DEPLOY)

Commit **`41cf1df1`** (`fix(document-centre): skip the scanner treatment for a photograph kind, not only text-less pages`), 2 files, frontend-only deploy via `infra/deploy/deploy.sh --frontend-only` (Git Bash) — the backend kept serving (uptime 17m after). Rollback point `alloutdoor-20261014-143919.dump` (~30 MB). Frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `41cf1df1`. No migration.

Gates: frontend `tsc` clean + **142 files/1744 tests** + production build OK.

**The report.** Operator, 2026-10-14: "it is ignoring the filter on the first picture and then applying it to the rest."

**Cause.** The text-only skip (see the entry below) half-worked. Read from the live `DocumentIdentify` rows: the three safe photographs all classified `SAFE_PHOTOGRAPHS`/confident, but their `ocrChars` were **null, 11 and 37** — Google Vision `DOCUMENT_TEXT_DETECTION` catches a serial or a word off a label in the frame — so `shouldPolish` skipped the null one and POLISHED the other two. A text test can never separate a photograph from a page on its own.

**What shipped.** `shouldPolish` (`components/document-centre/upload-batch.tsx`) now returns false for any `SAFE_PHOTO_KINDS` kind (`SAFE_PHOTOGRAPHS` plus the retired safe kinds) WHATEVER the text, and keeps the `ocrChars` test only as the net for a text-less page the classifier filed as something else. Spec pins the null/11/37 case.

## 2026-10-14 — OCR/IDENTIFICATION ON 3.1-FLASH-LITE, AND NO FILTERS ON A PHOTOGRAPH (FULL DEPLOY)

Commits **`f6105520`** (`feat(llm): OCR and identification run on 3.1-flash-lite, escalating to 3.8 on low confidence`, 8 files) and **`cb7a039e`** (`fix(document-centre): do not run the scanner filters over a photograph with no text`, 3 files), full deploy (both sides touched) via `infra/deploy/deploy.sh`. Rollback point `alloutdoor-20261014-142233.dump` (~30 MB). Backend and frontend health x2 OK, warden reloaded and online, public 200 x2, three pm2 services online. Deployed HEAD `cb7a039e`. No migration.

Gates: backend `tsc` clean + **354 suites/5578 tests** (`npm test -- --maxWorkers=2`); frontend `tsc` clean + **142 files/1743 tests** + production build OK.

**The reports.** Operator, 2026-10-14: "can we have gemini 3.1 flash lite with reasoning do the OCR to save on tokens" → "just implement 3.1 if the confidence is not high with a OCR or identification switch to 3.8 to help with that task"; and "it also applies the filters to the safe pictures washing them out. can we not do this when the is no text available on the document."

**What shipped.**
- **Model escalation.** `FAST_GEMINI_MODEL` (`gemini-3.1-flash-lite`) is now the PRIMARY for `vault.classify`, `vault.read` and `licence.card.*` (`modelFor` in `llm.service.ts`); a not-confident answer retries ONCE on `STRONG_GEMINI_MODEL` (`gemini-3.8-flash`). `classifyVision` retries a `low`/unparseable answer (the retry wins only if IT is confident); `read` retries a parsed-but-unsure one and keeps the stronger reply only if it recovered more (`readingScore`); the licence-card OCR retries an incomplete card (missing ID or component row) then runs the focused ID pass, both on strong. ⚠️ Reasoning does NOT save tokens — the cheaper model does; on a 3-series id the thinking config is a LEVEL, so `budgetTokens: 0` still reasons at LOW.
- **Pricing.** `llm.pricing.ts` 3.1-flash-lite (`$0.25`/`$1.50`/`$0.025`) and 3.8-flash (`$0.75`/`$3.75`/`$0.075`) confirmed from the operator's pricing-page screenshots, replacing wrong placeholders. ⚠️ 3.8-flash DOUBLES on 2027-01-01 (input `$1.50`, output `$7.50`); the ledger under-reports by half after that until the row is re-read.
- **No filters on a text-less page.** The Document Centre batch (`prepareCard` in `app/licence-centre/page.tsx`) polishes a document ONLY when the identify pass read text off it — `shouldPolish(v) = v.role === 'document' && (v.ocrChars ?? 0) > 0` (`components/document-centre/upload-batch.tsx`). A page with no OCR characters is a photograph: the colour/light normalise washed it out and the wrap-to-a-page crop had no page to aim at. Its raw bytes go up like evidence. This keys off TEXT, not the kind, so a misclassified photograph is caught too.

**Know.**
- ⚠️ If the OCR call is down, `ocrChars` is `null` and a real document will also skip the polish (cosmetic; recoverable with "Fix crop"). Fall back to `kind`-based if that ever bites.
- Scope of the no-filter change: the Document Centre batch only. `lib/scan-upload/source-batch.ts` (the applied-for firearm's paperwork) has no `ocrChars` on its verdict and is untouched.
- The three safe photographs from the earlier report still sit as `OTHER` — refile them or re-scan; new uploads classify correctly (see the entry below).

## 2026-10-14 — DOCUMENT CENTRE: A SAFE PHOTOGRAPH FILES AS A SAFE PHOTOGRAPH (BACKEND DEPLOY)

Commit **`6960bd6d`** (`fix(document-centre): require a confidence so a safe photograph files as one`), 2 files, backend-only deploy via `infra/deploy/deploy.sh --backend-only` (Git Bash) — the frontend kept serving (uptime 29m after). Rollback point `alloutdoor-20261014-132237.dump` (30.5 MB). Backend health x2 OK, public 200 x2, three pm2 services online (`alloutdoor-backend`, `alloutdoor-frontend`, `warden`). Deployed HEAD `6960bd6d`. No migration.

Gates: backend `tsc` clean + **354 suites/5572 tests** (`npm test -- --maxWorkers=2`).

**The report.** Operator, 2026-10-14: "uploaded 3 photos to the document centre. It is pictures of my safe and it recognized them as something else." The three (2026-10-14, 09:04Z) were filed as `OTHER` / "Supporting document" (`cmv805f7h…`, `cmv805jx8…`, `cmv805o9v…`); the vault ledger showed `classify → model-unsure`, and the live model had actually named them correctly.

**Cause.** The photographs carry no printed text, so `classify()` fell to the vision classifier (`classifyVision`). Replayed against the live model with the production prompt, it names `SAFE_PHOTOGRAPHS` every time — but returned it as bare `{"role":"document","kind":"SAFE_PHOTOGRAPHS"}`. `CLASSIFY_SCHEMA` required only `role`, so a schema-enforced model omitted the optional `confidence`; `classifyVision` read the absence as `(parsed.confidence ?? '') === 'high'` → `false`, and `filedKindOrOther` (`licence-centre.service.ts:160`) then downgraded the CORRECT kind to `OTHER`. A sure answer arrived looking unsure. (Production token count was 13 — exactly the no-confidence JSON.)

**What shipped.** `CLASSIFY_SCHEMA.required` is now `['role','confidence']` (`kind` stays optional: an evidence item has none). `licence-centre-classify.spec.ts` pins it. Replayed against the same three images: all now return `confidence:"high"` and file as `SAFE_PHOTOGRAPHS`.

**Know.** The fix governs NEW uploads only. The three existing rows are still `OTHER` — refile them as *Safe photographs* on the card, or re-scan. There are currently ZERO `SAFE_PHOTOGRAPHS` rows in the vault.

## 2026-10-14 — COMMUNITY: FOLLOWER/FOLLOWING LISTS + REMOVE FOLLOWER (FULL DEPLOY)

Commit **`dfaa7c32`** (`feat(community): follower/following lists with remove-follower and unfollow`), 8 files, full deploy (backend touched). Rollback point `alloutdoor-20261014-125336.dump`. Health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `dfaa7c32`.

Gates: backend `tsc` clean + **354 suites/5571 tests**; frontend `tsc` clean + **142 files/1740 tests** + production build OK. (The two suites run in PARALLEL produced one 5s-timeout failure each in unrelated heavy specs — `motivations/motivation-pdf.service.spec.ts` and `components/licence-centre/design-picker.spec.tsx`; both pass in isolation and in the sequential full runs, so it was CPU contention, not a regression. Run the two suites sequentially on this box.)

**The report.** Operator, 2026-10-14: "in the community. I want the users to be able to see who follows them and who they follow as well as remove followers from the list and also unfollow people who they are following."

**What shipped.** The Followers and Following numbers on the community control panel (right rail / homepage Community tab) are now buttons that open a `FollowsSheet`: the member's followers (per-row Remove) and the members they follow (per-row Unfollow). New backend: `GET /community/me/followers`, `GET /community/me/following` (cursor-paged, `FEED_PAGE_MAX`, privacy-gated username+avatar, `isFollowing` per row) and `DELETE /community/me/followers/:id` (idempotent, no notification) — `listFollowers`/`listFollowing`/`removeFollower` in `feed.service.ts`, routes in `feed.controller.ts`. Frontend: `components/community/follows-sheet.tsx` + `fetchMyFollowers`/`fetchMyFollowing`/`removeFollower` in `lib/community-api.ts`. No schema change (reuses `Follow`). Spec §21 in `docs/design/community-feed/spec.md`.

**Know.** Unfollowing reuses the existing `DELETE /community/users/:id/follow`. The lists are the member's OWN only — other members' profiles still just show the counts.

## 2026-10-14 — MOTIVATIONS: SLIDERS ON THE DOCUMENTS STRIP (FRONTEND DEPLOY)

Commit **`739305db`** (`feat(motivations) slide the documents strip left and right when it overflows`), 2 files, frontend-only deploy. Rollback point `alloutdoor-20261014-075133.dump`. Frontend health x2 OK, public 200 x2, three pm2 services online (backend untouched). Deployed HEAD `739305db`.

Gates: frontend `tsc` clean + **141 files/1735 tests** + production build OK.

**The report.** Operator, 2026-10-14: "add a slider when the documents get too much so the user can slide left and right to view them in your documents."

**What shipped.** `.gg-row` hides the scrollbar (globals.css:1206), so once "Your documents" runs past the edge a mouse had nothing to drag. The shelf now shows a left arrow at the start and a right arrow at the end, each only while there is somewhere to go, and they scroll the strip by ~80% of its width with `scroll-behavior: smooth`. Verified live: with 7+ documents the right arrow appears at the strip's end.

## 2026-10-14 — MOTIVATIONS: THE ATTACHED DOCUMENTS ARE VISIBLE AND PREVIEWABLE (FRONTEND DEPLOY)

Commit **`f4f3fb7f`** (`feat(motivations) show the attached documents and preview them full-screen`), 4 files, frontend-only deploy. Rollback point `alloutdoor-20261014-073607.dump`. Frontend health x2 OK, public 200 x2, three pm2 services online (backend untouched). Deployed HEAD `f4f3fb7f`.

Gates: frontend `tsc` clean + **141 files/1733 tests** + production build OK.

**The report.** Operator, 2026-10-14, driving the live page: "I don't see the physical documents." The shelf drew a generic file icon for every attachment, so the actual licence page was invisible.

**What shipped.** `DocumentShelf` now fetches each document's authenticated blob URL (`loadUrl`) and draws the ACTUAL page as a 72px thumbnail (images; PDFs keep the icon), and a View control opens it full-screen (`components/licence-centre/document-preview.tsx` — image or PDF, Esc/backdrop to close). Verified live: the composed "Where the firearm is coming from" page shows the licence front on top and its back below on one page, and the firearm boxes (Type/Make/Model/Calibre/Serial + components) are filled "from a document you uploaded".

**Know.** The thumbnails fetch one encrypted blob per image document on load; the URL is revoked when the tile unmounts.

## 2026-10-14 — MOTIVATIONS: THE READ FIELDS ARE APPLIED (FRONTEND DEPLOY)

Commit **`27f99a11`** (`fix(motivations) apply the uploaded paperwork's read fields so the firearm boxes fill`), 1 file, frontend-only deploy. Rollback point `alloutdoor-20261014-072457.dump`. Frontend health x2 OK, public 200 x2, three pm2 services online (backend untouched). Deployed HEAD `27f99a11`.

Gates: frontend `tsc` clean + **141 files/1731 tests** + production build OK.

**The report.** Operator, 2026-10-14: "it says added the paperwork but I can't see where it is or preview it. It also does not autofill anywhere I can see."

**What was wrong.** The document WAS stored and read (the server logged `Firearm read filled 10 field(s)`), but the licence-centre page DROPPED the read fields. `addUpload` returns `suggestions` and deliberately does not write them; the caller must confirm. `onAddFile` ignored the return value and NOTHING on the page called `applyExtraction`, so every box stayed empty after a perfect read.

**What shipped.** The page now collects the suggestions from each upload and calls `applyExtraction` for the TRUSTED ones (`trusted: false` is a read our own checks doubt and is still refused), then reloads. `onAddFile` (the shelf) and the source-paperwork batch both do it. `applyExtraction` only fills EMPTY fields, so a value the member typed is never overwritten, and each filled row carries a "from a document you uploaded" source line and stays editable.

**Know.** The uploaded page serves at the top of the sheet in "Your documents" (label "Where this firearm is coming from"); the shelf has a remove control but no full preview — the Document Centre is where preview/rotate live.

## 2026-10-14 — MOTIVATIONS: TWO PHOTOS = ONE PAGE, AND A READABLE TOAST (FRONTEND DEPLOY)

Commit **`c2bff8b1`** (`fix(motivations) two picked photos always become one page; toast readable in dark mode`), 3 files, frontend-only deploy. Rollback point `alloutdoor-20261014-005519.dump`. Frontend health x2 OK, public 200 x2, three pm2 services online (backend untouched). Deployed HEAD `c2bff8b1`.

Gates: frontend `tsc` clean + **141 files/1731 tests** + production build OK.

**The reports.** Operator, 2026-10-14: "Still nothing" (the two card photos still filed as two pages) and "what is this white bar that pops up" (the toast).

- **Pairing.** The order-independent fix (`fd53ebe7`) was not enough: when the server did not NAME both sides, the batch fell back to two pages — and the identify is not naming them reliably. `prepareSourceBatch` now composes two picked IMAGES onto one page even when neither side was named (the side only decides which goes on top). A lone image, a PDF, or three-plus files stay their own pages.
- **The white bar** is `SheetToast`. It painted `bg-[var(--text-primary)] text-white`, so in DARK MODE the bar is near-white and the white text vanishes. Now `text-[var(--bg)]` — the true inverse of the bar, readable in both themes.

## 2026-10-14 — MOTIVATIONS: THE CARD SIDES PAIR IN ANY ORDER (FRONTEND DEPLOY)

Commit **`fd53ebe7`** (`fix(motivations) pair a licence front with its back whatever order they were picked`), 2 files, frontend-only deploy. Rollback point `alloutdoor-20261014-004659.dump`. Frontend health x2 OK, public 200 x2, three pm2 services online (backend untouched). Deployed HEAD `fd53ebe7`.

Gates: frontend `tsc` clean + **141 files/1729 tests** + production build OK.

**The report.** Operator, 2026-10-14, testing on production: one attempt composed the two card sides onto one page, the next did not (two uploads). The server logs showed the extraction working (the earlier JSON-schema fix holds — no more `unparseable JSON`, and `Firearm read filled 10 field(s)`), so the failure was purely the pairing.

**What was wrong.** `prepareSourceBatch` paired a front with a back only when the front came FIRST in the pick. A member who picked the back first — or whose picker returned them that way — got two separate pages. `frontIdx`/`backIdx` now find the sides wherever they are, so the order no longer matters.

## 2026-10-14 — MOTIVATIONS: THE PAPERWORK READS (FULL DEPLOY)

Commit **`aaae2c75`** (`fix(motivations) read the paperwork readably: JSON-shaped extraction, word-based card side, visible progress`), 4 files, full deploy. Rollback point `alloutdoor-20261014-003426.dump`. Backend and frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `aaae2c75`.

Gates: backend `tsc` clean + **353 suites/5564 tests**; frontend `tsc` clean + **141 files/1728 tests** + production build OK.

**The report.** Operator, 2026-10-14, on the source button just shipped: "i selected two pictures to be uploaded and it gave me a blank notification bar ... and then nothing happened." The server had actually filed both pages (two 201s and a sheet reload), so the real failures were that nothing was READ from the documents and the two sides were not paired.

**What was wrong.** Two faults, both model-shape faults:
- `motivation.extract.*` relied on the system prompt saying "Return STRICT JSON and nothing else". The current model answers in prose ("Here is the JSON …"), so every extraction came back `unparseable JSON` and NOTHING filled. `readFirearm` never had this because it constrains the shape with `json: { schema }`.
- `classifyFace` made one unguarded model call; the same model answered in prose, the parse threw, the side read as null, and the two card sides were never composed. It also ignored the OCR text, which already prints the words that name each side.

**What shipped.**
- `extract()` now sends `json: { schema: EXTRACT_SCHEMA }`, so the page is read as `{fields:[…]}` (the same constraint `readFirearm` carries).
- `classifyFace` names the side from the OCR words FIRST — front = "Serial Number" + "Calibre", back = "Signature" + "Fingerprint" — with no model call; only when the words are absent is the model asked, and then with two attempts and the OCR text handed in. A SAPS 271 is still flagged.
- The button now says "Reading your pictures…" while a batch is in flight, and a failure shows the server's own message rather than a blank bar. A blank toast is now impossible: every branch has words.

## 2026-10-14 — MOTIVATIONS: THE APPLIED-FOR FIREARM'S PAPERWORK IS TREATED (FULL DEPLOY)

Commit **`124e8440`** (`feat(motivations) treat the applied-for firearm's paperwork: scan, pair the card sides, read and file`), 11 files, full deploy. Rollback point `alloutdoor-20261014-001952.dump`. Backend and frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `124e8440`.

Gates: backend `tsc` clean + **353 suites/5560 tests**; frontend `tsc` clean + **141 files/1728 tests** + production build OK.

**The report.** Operator, 2026-10-14: "When the user selects this button they will upload the evidence in the form of a consent letter, the licence card, an invoice, a dealer completed 271 form ... If its two images that the owner just sent me ... they must get the scanner treatment in the background ... pulled straight, color corrected, cropped, scaled properly and put onto one page ... the information can be OCR'd and classified by JEV to find their correct places." Decisions locked: pair a licence FRONT (Serial Number, Make, Calibre, Type, Model) with a BACK (Signature, Fingerprint); front top / back bottom on one page; a 271 is read but NOT annexed; add the classifier rotation; no review screen.

**What shipped.**
- The "Upload the applied-for-firearm's paperwork" button (`SourceActions`) now runs a batch: `POST /motivations/:id/identify` names each file, then `autoPolish` (the same headless scanner pipeline the vault uses) treats each image, then the two sides of a licence are composed onto one page, then each page is filed as `FIREARM_SOURCE_PROOF`. PDFs and undecodable files pass through.
- `frontend/lib/scan-upload/compose.ts` (new): front on top, back below on a portrait page. `frontend/lib/scan-upload/source-batch.ts` (new): the pairing.
- Identify verdict gained `rotate`, `side` and `saps271`; `classifyFace` in `motivation-extract.service.ts` answers them (front/back by the operator's keys; rotation from the page top).
- A SAPS 271 is read and never annexed: `looksLikeSaps271`/`SAPS_271_MARKER` (`common/document-markers.ts`), stamped into `extractedFields` at upload, filtered out of `kinds` + `annexureImages` in `motivation-render.service.ts`. No schema change, no migration.

**Know.** Identify adds one small model call per image (same posture as the vault's orient); up/down rotation depends on that answer. The 271 suppression uses the model verdict (covers PDFs Vision cannot OCR) plus the printed form number when OCR is available.

## 2026-10-13 — MOTIVATIONS: COLLAPSED CONSENT, VISIBLE LETTER, REPLACEABLE (FULL DEPLOY)

Commit **`7a601e75`** (`feat(motivations) one paperwork row with a collapsed consent, viewable and replaceable`), 14 files, full deploy. Rollback point `alloutdoor-20261013-232159.dump`. Backend and frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `7a601e75`.

Gates: backend `tsc` clean + **353 suites/5555 tests**; frontend `tsc` clean + **140 files/1722 tests** + production build OK.

**The report.** Operator, 2026-10-13: the consent panel was rendering fully open at the top of the firearm section ("this is then still there, why?"). It had to be "hidden underneath a button alongside upload proof of applied for firearm", the filled-out state shown with a "View", and a signed consent replaceable: "if it is already submitted by the owner, the applicant can send another one but a pop up must warn them that the current one will be overwritten". Also: "after generation there won't be access to the fields again" and the letter is shown "using a default style", re-rendered in the member's picked style at generation.

**What shipped.**
- `SourceActions` (`components/licence-centre/source-actions.tsx`) is the applied-for firearm's row: "Upload the applied-for firearm's paperwork" (filed as `FIREARM_SOURCE_PROOF`) beside a collapsed "Ask the current owner for consent". A filled-out consent shows the subscript "Consent filled out" and a "View". The consent control hides on a known dealer sale; the whole row renders nothing once the motivation is `COMPLETED`. Replaces the old inline `ConsentCard` at `app/licence-centre/[id]/page.tsx`.
- View opens the consent letter read-only (`ConsentLetterModal`) from a new `GET /motivations/:id/seller-consent/letter`. It reuses the pack's own `consentFormFor`/`buildSellerConsent` + `renderStatementForm` (`MotivationPdfService.renderStandaloneStatement`), DEFAULT scheme, no annexure caption.
- Replacing a signed consent: `MotivationSellerConsent` gains "Send a new one" with a styled `ConfirmDialog` warning; the form starts blank and sends `replace: true`. `invite()` requires `replace` for that path, refuses any invite once the motivation is `COMPLETED`, and destroys the old signature/licence/section F only AFTER the replacement link is delivered (a failed send restores the signed state).
- No schema change, no migration.

**Know.** The View letter is generated per request, default style only; the member's colourway/layout is applied when the whole motivation is generated. Post-generation the row disappears entirely, so an already-sent consent notice is not shown then. The paygate on "Generate my motivation" and the full field lock are still to be built.

## 2026-10-13 — MOTIVATIONS: ONE SOURCE UPLOAD, JEV DECIDES THE ROUTE (FULL DEPLOY)

Commit **`37e1ecc3`** (`feat(motivations) one source upload, Jev decides the dealer/private route`), 10 files, full deploy. Rollback point `alloutdoor-20261013-222851.dump`. Backend and frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `37e1ecc3`.

Gates: backend `tsc` clean + **353 suites/5547 tests**; frontend `tsc` clean + **139 files/1713 tests** + production build OK.

**The report.** Operator, 2026-10-13: "remove the dealer/private picker. Let Jev make the call what it is and how it should be processed ... just one upload applied for firearm license/evidence." The dealer/private choice at "Where is this firearm coming from?" is gone; the member uploads whatever paperwork they hold and the reader settles the route. Decisions locked with the operator: (1) Jev may set the SAPS 271 section-F owner-type tick, from the uploaded document; (2) one upload row; (3) `firearm_source` removed from the wizard; (4) the consent link stays as a secondary action.

**What changed.**
- `motivation-fields.ts`: `firearm_source` is now `internal` (never on screen, never in `requiredKeys`) and no longer `required`. It is still stored, accepted and validated — the reader writes it.
- `motivation-documents.ts`: the private route no longer adds a second `SELLER_LICENCE` checklist row. The invoice, the current owner's licence (front and back) and the consent letter all land on the single `FIREARM_SOURCE_PROOF` row. Guidance is route-agnostic until the reader settles which.
- `motivation-extract.service.ts`: the source reader now also returns `firearm_source` (dealer vs private-owner), with a dedicated instruction because this is the one judgement the transcriber is otherwise told not to make. A choice is canonicalised and validated in `parse`, so a vague answer is dropped rather than stored. It arrives on the confirm card like every other read.
- `motivation-kind-options.ts`: `CURRENT_LICENCE` is now explicitly the applicant's OWN licence; `FIREARM_SOURCE_PROOF` names the owner's licence/consent, so Jev does not file someone else's card as the member's.
- `motivation-seller-consent.service.ts`: a completed consent writes `firearm_source = From a private owner` when empty.
- `frontend/app/licence-centre/[id]/page.tsx`: the consent card is a standing secondary action under the source row, shown until the route is known to be a dealer sale.

**Know.** If the reader is unsure of the route it omits the value, section F stays unticked, and the only fallback is the consent link — there is no explicit inline "dealer or private?" prompt for the omit case yet. `SELLER_LICENCE` survives as a kind (the consent flow still files the owner's two licence photographs as it) but is no longer a checklist row; the DFO still gets the licence front and back through the consent. No schema change, no migration.

## 2026-10-13 — LICENCE CENTRE: A PROOF OF ADDRESS IS RECOGNISED (FULL DEPLOY)

Commit **`da65f6f2`** (`fix(licence-centre) recognise a proof of address when Jev files it`), 3 files, full deploy. Rollback point `alloutdoor-20261013-214336.dump`. Backend and frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `da65f6f2`.

Gates: backend `tsc` clean + **353 suites/5547 tests**; frontend `tsc` clean + **139 files/1713 tests** + production build OK.

**The report.** Operator, 2026-10-13: "uploaded a proof of address and it was not recognized as such."

**What was wrong.** The vault classification is now Jev filing from the folder hints in `common/document-filing/vault-kind-options.ts`. The `ADDRESS_CONFIRMATION` hint was a stub — "a utility bill or bank statement" — which dropped the full definition the retired vision prompt still carries at `licence-centre-extract.service.ts:1746`. Separately, the role question in `document-filing.service.ts` listed a bare "an affidavit" as an evidence example, and a confirmation of residence is usually one, so Jev could file it as evidence. A lease, a SARS/insurance/medical-aid letter, or a signed confirmation of residence matched neither path.

**What shipped.** The proof-of-address hint now names municipal/rates accounts, bank and retail statements, SARS/insurance/telecoms/medical-aid letters, leases, and a signed confirmation of residence (even an affidavit). The role criteria claim the affidavit explicitly ("an affidavit that confirms where the member lives is a proof of residence, NOT evidence"). A spec case pins the disambiguation. Backend-only, no schema change.

## 2026-10-13 — LICENCE CENTRE: A FIREARM LICENCE CARD HAS NO LICENCE NUMBER (FULL DEPLOY)

Commit **`f763679e`** (`fix(licence-centre) a firearm licence card has no licence number; the serial is the reference`), 14 files, full deploy. Rollback point `alloutdoor-20261013-212348.dump`. Backend and frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD `f763679e`.

Gates: backend `tsc` clean + **353 suites/5546 tests**; frontend `tsc` clean + **139 files/1713 tests** + production build OK.

**The report.** Operator, 2026-10-13: "there is no license number on a firearm license card. The police will use the Serial Number as the reference number of the card." A card prints the holder's ID number (13 digits, top left) and a card/control number (4 digits, top right), neither of which is a licence number; the identifier is the row the card labels "Serial Number".

**What was wrong.** The vault's WANTED list asked every licence for `licence_number`, a field the card never prints, so `MUST_READ` flagged every licence "Worth a look" for a missing field. When the reader guessed, it grabbed the holder's ID number or the 4-digit card number, which `credential-duplicates.ts` records as having flagged unrelated firearms as copies of each other. The renewal reference and the SAPS 271 fed off the same field.

**What shipped.** The vault reads the headline Serial Number row as `serial`; completeness, the duplicate fingerprint, the renewal reference (`existing_licence_number`) and `applicationRef` all use it. On the SAPS 271 the serial fills the row's single serial box and flows to item 2.1's Frame/receiver column; the "Licence or permit no" box stays for storage permits and is left blank. The licence-number branches in the motivation matcher were removed. No schema change, no migration.

**Know.** Existing rows still hold the stale `licence_number` and the old "Worth a look" flag; the operator is deleting and re-adding the licences rather than running a backfill.

## 2026-10-13 — DOCUMENT CENTRE: ROTATE A STORED DOCUMENT (FULL DEPLOY)

Commit **`e3c5da26`** (`feat(licence-centre) rotate a stored document from the
Document Centre`), 8 files, full deploy (frontend + backend) via
`infra/deploy/deploy.sh`. Rollback point `alloutdoor-20261013-201502.dump`.
Backend and frontend health x2 OK, public 200 x2, three pm2 services online.
Deployed HEAD `e3c5da26`.

Gates: backend `tsc` clean + **353 suites/5546 tests**; frontend `tsc` clean +
**139 files/1713 tests** + production build OK.

**The report.** Operator: "can we add a rotate document directly in the document
library" — "my ID scan is on its side." A scan with no EXIF Orientation tag
stores landscape pixels, and the pre-commit model orient call is not always
right, so a page can land in the vault sideways with no way to fix it.

**What shipped.** `POST /licence-centre/:id/rotate` (`{ direction: left|right }`),
throttled 30/min. `rotate-document.ts` re-encodes an image upright via sharp
(white-flattened JPEG) and adjusts each PDF page's `/Rotate` with pdf-lib (no
rasterising). The row is re-keyed to a new storageKey and the old file removed;
`P2002` on the new sha is a 409, not a 500. `rotateAttachedCopies` also turns
every `MotivationUpload` with the same `sourceCredentialId`, because
`addFromLibrary` copies bytes into the `motivations` namespace and the Used-in
list matches by sha256. Ledger: `member/corrected/rotated`. On the card
(`credential-card.tsx`), a real image preview plus Rotate left/right beside View;
the preview is images only (PDFs stay on View).

**Know.** Rotating fixes the stored file and everything produced afterwards; it
does not rewrite a pack PDF already generated, and it does not re-run an earlier
OCR read. The preview downloads the whole file (up to 10MB) when a card is
selected. No schema change, no migration, no new dependency.

## 2026-10-13 — DOCUMENT CENTRE: RECOGNISE A PROFICIENCY BY ITS NUMBER (BACKEND DEPLOY)

Commit **`1432baa1`** (`fix(document-centre): recognise a proficiency by its
unit-standard number`), 3 files, backend-only deploy via `--backend-only`.
Rollback point `alloutdoor-20261013-143349.dump` (30 MB). Backend health x2 OK,
public 200 x2, three pm2 services online. Deployed HEAD `1432baa1`.

Gates: backend `tsc` clean + **346 suites/5512 tests**.

**The report.** Operator: "why is there two dates to check on competency
certificates. those are the certificates for the handgun. It says Competency
course on it ... Proficiency certificates must be recognized by their number.
the handgun certificates shows 117705." The handgun training certificates print
"COMPETENCY COURSE" and their unit-standard codes; the vault filed them as
COMPETENCY_CERTIFICATE (two rows, `cmv6ni1rf` and `cmv6l6p7o`, details empty),
and the competency card then asks for two dates to check — on documents that do
not expire.

**Cause.** When Textract was removed, the vault classifier dropped the marker
library and relied on Jev alone. Jev read the words "COMPETENCY COURSE" and
picked the competency folder. The marker library (`common/document-markers.ts`)
already recognises these **by number** — `accredited-provider-course-certificate`
(NSN's "COMPETENCY COURSE" cert: accreditation line + completion phrase + unit
code) and `unit-code-beside-its-title` — and the MOTIVATION classifier already
uses it. Only the vault path had lost it.

**What shipped.** `classify()` now runs `readMarkers` on the Gemini
transcription **before** Jev, exactly as the motivation classifier does. A
verdict maps to a vault kind through `UPLOAD_TO_CREDENTIAL`; anything the
markers do not decide falls through to Jev. The SAPS-524 and application vetoes
in the marker table are untouched, so a real competency certificate (and a SAPS
517 applying for one) stays a competency. Jev's own Proficiency/Competency hints
now name the unit-standard numbers (117705, 119649-119652, 243200) so it too
places a numbered page correctly.

**Know.** The two blank COMPETENCY rows already in the vault do not re-classify
themselves — refile them as Proficiency (the card's type control) or re-scan;
a new scan now lands as PROFICIENCY. Tests: 2 cases added to
`licence-centre-classify.spec.ts` (the COMPETENCY COURSE cert read by number
with Jev bypassed; a real SAPS 524 kept a competency).

## 2026-10-13 — MOTIVATIONS: THE PROFICIENCY CERTIFICATE IS OPTIONAL (BACKEND DEPLOY)

Commit **`681a08c8`** (`fix(motivations): the proficiency certificate is
optional`), 3 files, backend-only deploy via `--backend-only`. Rollback point
`alloutdoor-20261013-141346.dump` (29 MB). Backend health x2 OK, public 200 x2,
three pm2 services online. Deployed HEAD `681a08c8`.

Gates: backend `tsc` clean + **346 suites/5510 tests**.

**The correction (operator, 2026-10-13).** The earlier gate (762da5de) made the
provider certificate mandatory. The operator clarified the rule: "the pack must
include the annexure for the act and the annexure for the firearm that is being
applied for. minimum statement of results. Certificate optional but must be
added if available. if both are on one statement of result just add one annexure
but reference both Act and firearm."

**What changed.** `proficiencyPackGap()` now blocks on only two things: no
attached page carries 117705, or no attached page carries the applied firearm's
unit standard. A single statement of results carrying both satisfies both. The
missing certificate is still noted as `certificateMissing`, but
`hasProficiencyPackGap()` ignores it, so a lone statement of results never
refuses a pack. The gate message and its spec were updated to match.

**Know.** "Reference both Act and firearm" is satisfied by the one-page case: a
combined statement settles both requirements on a single annexure. The annexure
INDEX title is still the generic "Proficiency / training certificate" — it is
built from upload KINDS only, so if the operator wants that index line to name
the codes, `buildAnnexures` would need the unit standards passed in (not done;
flag if wanted).

## 2026-10-13 — MOTIVATIONS: THE ACT AND A COMPLETE PROFICIENCY (BACKEND DEPLOY)

Commit **`762da5de`** (`feat(motivations): the pack needs the Act and a
complete proficiency`), 4 files, backend-only deploy via
`infra/deploy/deploy.sh --backend-only` (Git Bash) — the frontend kept serving
(uptime 21m after). Rollback point `alloutdoor-20261013-134754.dump` (29 MB).
Backend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD
`762da5de`. No migration.

Gates before deploy: backend `tsc` clean + **346 suites/5510 tests**
(`npm test -- --maxWorkers=2`).

**The rule (operator, 2026-10-13).** Every motivation needs 117705 (Knowledge of
the Firearms Control Act) plus the applied firearm's unit standard, evidenced by
its statement of results AND its certificate. If the Act sits on the firearm's
own statement, one page settles both; if it is on a separate statement (usually
the first course), both statements are needed. This was already modelled for the
MEMBER (`common/sa-proficiency-cover.ts` — "do they hold 117705 anywhere") and
for the autolink (`pickProficiencyPair`), but nothing blocked a SUBMITTED pack
that was short, and a lone statement (the operator's handgun `back`) satisfied
the checklist on its own.

**What shipped.** New pure `proficiencyPackGap()` in `motivation-upload-row.ts`
reads the proficiency pages ON the application — their unit standards and which
side each is (`document_side`) — and reports: a missing Act page, a statement
for the wrong firearm, or a half proficiency (a statement without its
certificate). The generation gate (`motivation-generation.service.ts`, after the
H13 document check) throws `motivation-proficiency-incomplete` with the specific
pieces named. It never runs on an unreadable page and never invents a
requirement for a pack that attaches no proficiency (the proficiency is on the
EXPECTED tier, not REQUIRED).

**Know.**
- Frontend needs no change: the generic error handler already shows
  `body.message`, and the message names exactly what is missing.
- `motivations.service.spec.ts` gained a gate test; `motivation-upload-row.spec.ts`
  gained the pure-rule cases (complete pack, Act on the firearm statement,
  missing Act, half proficiency, wrong firearm, unreadable, no firearm yet).
- The gate reads `extractionEncrypted` (unit_standard + document_side) with the
  OCR text as fallback; a page whose `document_side` was never read is not
  accused of missing its certificate.

## 2026-10-13 — DOCUMENT CENTRE: A TRAINING ROW IS NAMED BY ITS FIREARM (FRONTEND DEPLOY)

Commit **`a73a7b39`** (`fix(document-centre): name a training certificate by
its firearm, not the Act`), 2 files, frontend-only deploy via
`infra/deploy/deploy.sh --frontend-only` (Git Bash) — the backend kept serving
(uptime 27m after). Rollback point `alloutdoor-20261013-132644.dump` (29 MB).
Frontend health x2 OK, public 200 x2, three pm2 services online. Deployed HEAD
`a73a7b39`.

Gates before deploy: frontend `tsc` clean + **136 files/1701 tests** +
production build.

**The report.** Operator: "scanned all my proficiency certs, it missed the
handgun and just gave the firearms control act on it." Diagnosed from the live
DB (the newest rows, 13:16–13:18 SAST):

- The handgun statement of results **read correctly** — `unit_standard =
  "117705, 119649"`, derived title "Proficiency - Handgun". So the handgun unit
  (119649) was never actually dropped.
- The vault names a training row by its unit standards **in print order**
  (`trainingName`, `frontend/lib/document-centre-sections.ts`). 117705 —
  "Demonstrate knowledge of the Firearms Control Act..." — is on virtually
  every statement of results and endorses no firearm, so it led the row and the
  handgun hid behind it. On the list the row read as a Firearms Control Act
  document.

**What shipped.** `trainingName` now sorts the firearm units first and the
mandatory knowledge unit (117705) last. Code and title are kept — a DFO asks by
number — only the order changes, so "119649 · Handle and use a handgun · 117705
· ..." is what the row reads.

**Left for you (data, not code).** The handgun statement is **unpaired** — its
side is `back` and it carries `{side-missing}` attention, because the handgun
certificate FRONT was never in the vault (the rifle/shotgun/SL-rifle
proficiencies each have both sides). One page in that session (13:17:24 SAST)
also landed as a blank `COMPETENCY_CERTIFICATE` (`extractionOk=false`,
`present: []`) — if that was the handgun certificate front, it was misclassified
and should be re-scanned as a proficiency. The blank-read half should be gone
now that `read()` disables thinking (see the entry below); if it recurs the log
line names the cause. Re-scan the handgun certificate front to pair it.

## 2026-10-13 — DOCUMENT CENTRE: READ EVERY PAGE, COUNT EVERY ARRIVAL (FULL DEPLOY)

Commit **`02c8320f`** (`fix(document-centre): read every page, and count every
arrival`), 6 files, full deploy via `infra/deploy/deploy.sh` (Git Bash).
Rollback point `alloutdoor-20261013-125946.dump` (29 MB). Backend + frontend
health x2 OK, warden reloaded and online, public 200 x2, three pm2 services
online. Deployed HEAD `02c8320f`. No migration (no-op).

Gates before deploy: backend `tsc` clean + **346 suites/5501 tests**
(`npm test -- --maxWorkers=2`); frontend `tsc` clean + **136
files/1700 tests** + production build.

**The report.** Operator: "The scanner said 5 are sent, desktop reported 4
received but there are 5 licenses in the vault" — and the five had not been
properly read. Diagnosed from the live DB and ledger (five rows at 12:40–12:41
SAST, all `FIREARM_LICENCE`, all high-confidence):

- **Two of the five reads came back empty** — the log said `Credential read
  returned unparseable JSON (FIREARM_LICENCE)`. `read()` in
  `licence-centre-extract.service.ts` sent **no `thinking: { budgetTokens: 0 }`**,
  unlike `transcribe()`. On the `gemini-3.8-flash` default the reasoning pass can
  consume the 1200-token output budget and truncate the JSON mid-object;
  `JSON.parse` then threw and `parse()` returned an empty reading, which is a
  document filed with nothing on it.
- **One readable licence never armed its expiry.** Jev answered `also_covers:
  [ASSOCIATION_ENDORSEMENT]` for it (a licence and an endorsement both name a
  firearm by serial), and `mayArmReadExpiry` refuses to arm a date when a
  document "fills more than one role" — so the date was read and then never
  watched.
- **The desktop said "4 arrived" because the handoff count asked on `added`**
  (rows whose reading had SETTLED), and the two blank reads were not settled
  until the 45s backstop. All five rows were in the vault the whole time; the
  server already computed `landed` (every row since the token) and only used it
  for `pending`.

**What shipped.**
- `read()` now disables thinking (`transcribe()` is the precedent) and its
  budget goes 1200 → 2400. `classifyVision()` and `orient()` disable thinking
  too.
- `parse()` has its tolerant `/\{[\s\S]*\}/` object hunt back (the schema was
  assumed to guarantee bare JSON; production disproved it), and an unparseable
  reply now logs `stopReason` and a **PII-free shape** (`truncated` / `fenced` /
  `prose`) via `replyShape()` so the next one is diagnosable without guessing.
- `cleanAlsoCovers()` now enforces `EXCLUSIVE_COVERS`: a `FIREARM_LICENCE` is
  never also an `ASSOCIATION_ENDORSEMENT` (and vice versa), at the single choke
  point both classify paths use — so the licence arms its own expiry again.
- `scan-handoff` returns `landed`, and the dialog's "N documents arrived" reads
  it, so a blank read still counts as arrived.

**Know.** The `motivation-pdf.service.spec.ts` suite is load-flaky: it fails
under the default parallel Jest workers and passes alone (82/82). Run the
backend gate as `npm test -- --maxWorkers=2` for a stable result — that is what
was green here.

## 2026-10-13 — DOCUMENT CENTRE: A RANDOM FILE IS NOT A FIREARM LICENCE (FULL DEPLOY)

Commit **`a770cd61`** (`fix(document-centre): a random file is not a firearm
licence`), 7 files, full deploy via `infra/deploy/deploy.sh` (Git Bash).
Rollback point `alloutdoor-20261013-123502.dump` (29 MB). Backend + frontend
health x2 OK, warden reloaded and online, public 200 x2, three pm2 services
online. Deployed HEAD `a770cd61`. No migration in the changeset (no-op).

Gates before deploy: backend `tsc` clean + **346 suites/5497 tests**; frontend
`tsc` clean + **136 files/1700 tests** + production build.

**The bug.** Operator: "i read in a random file into the document centre and it
came back as a license. thats wrong." Two seams let it happen.

- **The vocabulary called any licence ours.** `DocumentFilingService.fileVault`
  told Jev a `document` is "an identity document, a licence, ...", and the
  vision `CLASSIFY_SYSTEM`/`CLASSIFY_USER` said the same. Any licence - a
  driver's, TV, business or software one, a EULA - satisfied the document
  branch, and the nearest kind was `FIREARM_LICENCE`.
- **A low-confidence kind was stored as that kind.** `create()` wrote
  `resolved` from the classifier answer regardless of `confident`, and
  `confident` only drove the "Not sure" badge. So a weak guess of
  `FIREARM_LICENCE` landed the row in the firearms section, one confirmation
  from arming a renewal for a firearm that does not exist.

**What shipped.** `document-filing.service.ts` role criteria now say "a FIREARM
licence" and route non-firearm licences, EULAs and unrelated files to evidence;
the kind instruction prefers OTHER and warns a licence naming no firearm is not
Firearm licence. `vault-kind-options.ts` tightens the Firearm licence hint to
require a named firearm or a cited Act section. `licence-centre-extract.service.ts`
makes `CLASSIFY_SYSTEM`/`CLASSIFY_USER` firearm-specific with an explicit
"answer OTHER" rule. New `filedKindOrOther()` in `licence-centre.service.ts`:
a specific kind proposed below the confidence floor is filed as `OTHER` (covers
dropped), applied in `create()`, `identifyOne()` and the identify cache path.
A member-declared kind never passes through it.

**Know.** A low-confidence document is now filed as OTHER and reads back as
"we think this is a document" on the batch card and the review row, instead of
wearing the guessed type. Specs updated/added: guard in `identify-batch.spec.ts`
(stale-id fallback now expects OTHER), prompt assertions in
`licence-centre-classify.spec.ts` and `document-filing.service.spec.ts`. Repo
lint remains red on untouched files (prettier drift) and is not a deploy gate.

## 2026-10-12 — DOCUMENT CENTRE: EVERY SECTION OPENS COLLAPSED (FRONTEND DEPLOY)

Commit **`f6cecd47`** (`feat(document-centre): open every section collapsed`),
frontend-only deploy via `infra/deploy/deploy.sh --frontend-only` (Git Bash).
Rollback point `alloutdoor-20261012-205747.dump` (~30.1 MB). Health x2 OK, public
200 x2, three pm2 services online. Deployed HEAD `f6cecd47`.

Gates before deploy: backend `tsc` clean + **346 suites/5488 tests**; frontend
`tsc` clean + **136 files/1700 tests** + production build.

**What shipped.** `/licence-centre` now opens with every section folded, every
time. Removed the two-defaults-open set (`Your firearms` + `Competency` via
`defaultOpenSections`) and the per-browser persistence (`document-centre:open-sections`
in `localStorage`) in `frontend/app/licence-centre/page.tsx`. `openSections` is
now a session-only map starting empty; `isOpen` returns false unless toggled. No
change to the grouping lib — `defaultOpenSections` is still exported and covered
by `lib/document-centre-sections.spec.ts`, just no longer called from the page.

## 2026-10-12 — RETIRED-FEATURE PURGE (DOCS + CODE) (FULL DEPLOY)

Commit **`22d23b11`** (92 files), full deploy via `infra/deploy/deploy.sh`
(Git Bash). Rollback point printed by the box's `~/bin/backup.sh`; migration
`20261012120000_drop_retired_models` applied (`prisma migrate status`: 116
migrations, schema up to date). Health x2 OK, public 200 x2, three pm2 services
(`alloutdoor-backend`, `alloutdoor-frontend`, `warden`) online. Deployed HEAD
`22d23b11`.

Gates before deploy: backend `tsc` clean + **346 suites/5488 tests**; frontend
`tsc` clean + **136 files/1700 tests** + production build.

**What shipped.** Removed every reference to the retired feature set from
documentation and code, so nothing in the repo implies a removed feature is
live.

- **Docs.** Deleted the dedicated removed-feature docs (Daily Deals x3,
  OnDayOnly teardown, KoraPay, Peach/Ivori, Clerk-removal, Load Lab port guide,
  hunt pilot, and the Bob Go migration record `BOBGO-MIGRATION.md`). Scrubbed
  the retired set (Swop, the `TAKE_A_SHOT` listing type, Experiences/Hunting
  Packages, PRO/raffle, Featured slots, Ask Boet, hunt-ballistics, legacy
  payment/identity vendors, TCG/Pudo) from `README`, `docs/INDEX`,
  `docs/ARCHITECTURE`, `docs/project-reference`, `docs/ENVIRONMENT`,
  `ALLOUTDOOR-REPLATFORM`, `COMPLIANCE-RULES`, `ACCOUNT-CLOSURE`, `HANDOFF`
  history and the rest. `docs/ARCHITECTURE` §4 was replaced with a concise
  current-state courier section; `docs/INDEX` rewritten and its "nothing is
  ever deleted" rule dropped.
- **Guard.** `AGENTS.md` gained a **"Retired Features (do not rebuild)"** list
  and the note that `docs/project-reference.md` replaces the deleted
  `CLAUDE.md`.
- **Schema.** Dropped the orphaned models `FeaturedSlot*`(6), `PrizeDraw`,
  `Deal`, `DealPurchaseOrder`, `Supplier` and their enums/relations via
  `20261012120000_drop_retired_models`. `Listing.isDealListing` is kept (a live
  public-discovery chokepoint).
- **Code.** Dead flags removed (`pro_draw_enabled`, `raffle_*`,
  `subscription_pro_price_cents`, the four `ask_gg_*` message caps); retired
  public routes removed from `frontend/middleware.ts`; the stale `dummy-run`
  harness and `seed-featured-slots` seeder deleted; stale comments scrubbed.
  **Kept:** the live offers/"Take a Shot" brand, `isDealListing`, the Bob Go
  `tcg` provider slugs, the create-listing photo helper. "Ask Boet" branding on
  that helper and the tier badges was renamed to neutral copy.
- **Left for a follow-up (deliberate):** the deeper refactor — `Swap`/
  `SwapProposal` + `Transaction.swapId`, `Subscription`/`SubscriptionCharge` +
  `SubscriptionTier`, the `TAKE_A_SHOT`/`SWOP` enum values, the
  `AskGgConversation` cluster and `manual-payments`. These are still referenced
  by live code.

**Know.** Removing the retired public middleware patterns means those dead URLs
now 307 to sign-in instead of serving an honest 404. A `docs/history` report that
described the deleted offline harness (`DUMMY-RUN-REPORT.md`) is retained; the
harness itself is gone.

## 2026-10-12 - GEMINI 3.8 FLASH + JEV FILES DOCUMENTS (FULL DEPLOY)

Commit **`3190fb12`** (27 files), full deploy via `infra/deploy/deploy.sh`.
Rollback point **`alloutdoor-20261012-175530.dump`**; no pending migrations.
Backend + frontend health x2 OK, warden online, public 200 x2, three pm2
services online. Gates: backend tsc clean + **346 suites/5496 tests**; frontend
tsc clean + **136 files/1701 tests** + prod build.

**Two asks shipped.**
- **Model routing.** Platform default is now `gemini-3.8-flash`
  (`llm.service.ts`, `gemini.provider.ts`). Moderation (images, escalation,
  video) is pinned to `gemini-3.1-flash-lite` by the `modelFor` code backstop.
  DeepSeek and Qwen are retired from routing (the provider classes stay as
  rollback). The licence-card OCR and valuation now run on Gemini. Price rows
  added for both models — **PLACEHOLDER rates, confirm against Google's rate
  card**. Fixed the stale "DeepSeek is the default" header.
- **Jev files documents.** New `backend/src/common/document-filing/`
  (`DocumentFilingService`). Gemini transcribes the whole page to raw text and
  Jev picks the folder: vault credential kind plus `also_covers`, motivation
  document kind, and evidence container. Wired into the vault and motivation
  classifiers. A photograph with no printed text keeps the tuned vision
  classifier — Jev cannot see.

**Know.** Moderation TEXT stays on Jev; the ladder's second opinion moved to
`gemini-3.1-flash-lite` and the verdict `source` label is now `gemini`. New
purposes: `vault.transcribe`, `vault.file`, `motivation.transcribe`,
`motivation.classify.file`, `motivation.evidence.file`. With Jev configured, a
photo pays one extra Gemini transcription before the vision classifier. Set
`LLM_MODEL=gemini-3.8-flash` on the box only if you want it explicit; the code
default already is.

## 2026-10-11 - FEED RESUME + REFRESH + LIVE COUNTS (FULL DEPLOY)

Commit **`6798540f`** (7 files), full deploy via `infra/deploy/deploy.sh`.
Rollback point **`alloutdoor-20261011-075803.dump`** (30,026,584 bytes); no
pending migrations. Backend + frontend health x2 OK, warden online, public 200
x2, three pm2 services online. Gates: backend tsc clean + **330 suites/5388
tests**; frontend tsc clean + **136 files/1700 tests** + prod build.

**Three asks shipped.**
- **Resume place.** `feed-client.tsx` persists filter/sort/search + scroll
  position to `sessionStorage` (`gg.community.feedState`), anchored to the
  topmost visible `[data-post-id]`, on scroll (rAF-throttled) and on unmount.
  On mount it restores the controls, tops up loaded pages (cap 5) so the
  position is reachable, then scrolls the anchor into view.
- **Refresh button.** Header row; non-silent reload (spinner) then scroll to top.
- **Live counts.** New `GET /community/counts?ids=` (`FeedService.postCounts`,
  throttled 120/min, <=100 ids, PUBLISHED only) + `fetchPostCounts`; the feed
  polls every 20s **only while the tab is visible** (and on visibilitychange
  back), merging like/comment counts in place - never reorders or moves scroll.

Verified live: Refresh button renders; `/api/community/counts` 200 with live
counts for the feed's post.

## 2026-10-11 - GRAPHIC-CONTENT PREFERENCE NOW PERSISTS (FULL DEPLOY)

Commit **`0001f127`** (4 files), full deploy via `infra/deploy/deploy.sh`.
Rollback point **`alloutdoor-20261011-074017.dump`** (30,026,454 bytes); no
pending migrations. Backend + frontend health x2 OK, warden online, public 200
x2, three pm2 services online. Gates: backend tsc clean + **329 suites/5385
tests**; frontend tsc clean + **136 files/1698 tests** + prod build.

**Second, deeper bug (found by driving Chrome).** The feed-settings
"Graphic content" toggle never persisted even after the render fix (`c70f9117`):
`FeedPreferencesDto` had no `feedShowGraphic` field, so the global
`ValidationPipe({ whitelist: true })` **stripped it from every PUT**; and
`viewer()`, `getPreferences` and `setPreferences` all omitted it. So
`GET /community/preferences` never returned `feedShowGraphic`, the client got
`undefined` and always rendered "Off", and nothing was ever written.
Fixed end to end: DTO field (`@IsOptional() @IsBoolean()`), `ViewerRow` +
`viewer()` select, `getPreferences` response, `setPreferences` write + update
`select`. Spec: `feed-preferences.spec.ts` (3).

Verified live in Chrome as `turbosnail`: toggle Off -> persists across reload
(`feedShowGraphic:false`) and the Hunting post shows the blur + "Tap to reveal";
toggle On -> persists and the post is ungated. DB left at the default (`true`).

## 2026-10-11 - COMMUNITY GRAPHIC-CONTENT TOGGLE FIXED (FRONTEND-ONLY DEPLOY)

Commit **`c70f9117`** (3 files), deployed `--frontend-only` (backend untouched).
Rollback point **`alloutdoor-20261011-072956.dump`** (30,026,365 bytes). Health
x2 OK, public 200 x2, three pm2 services online. Gates: backend tsc clean +
**328 suites/5382 tests**; frontend tsc clean + **136 files/1698 tests** + prod
build.

**Bug.** `post-card.tsx` computed `hiddenForever` but never used it - the gate
rendered on `graphic && !revealed`, ignoring the `showGraphic` prop. So the
feed-settings "Graphic content" On/Off switch changed nothing, and `forceBlur`
could not suppress the reveal button.

**Fix.** `gated = graphic && (!showGraphic || (isExtreme && !!forceBlur))` now
drives both the blur and the overlay; the reveal button is hidden when
`hiddenForever` (EXTREME + forceBlur, or member off). Removed the dead
`overlayBoxStyle`/`CSSProperties`. Behaviour matches brand-pack
`DESIGN.md` ("a per-user setting [Always show hunting images] skips the gate"):
- On (default): FIELD media shown ungated; EXTREME still gated (operator
  `feedGraphicBlurForced` default true -> hidden, no reveal).
- Off: all graphic media gated - FIELD tap-to-reveal, EXTREME hidden.
Adds 3 gate cases to `post-card.spec.tsx`. Note the default-behaviour change:
FIELD gore now shows unblurred when the setting is On (previously always gated).

## 2026-10-10 - COMMUNITY: "LIKED BY" LIST (FULL DEPLOY)

Commit **`0f45114c`** (8 files), full deploy via `infra/deploy/deploy.sh`
(Git Bash). Rollback point **`alloutdoor-20261010-225237.dump`** (29,949,105
bytes); no pending migrations. Backend + frontend health x2 OK, warden online,
public 200 x2, three pm2 services online. Gates: backend tsc clean + **328
suites/5382 tests**; frontend tsc clean + **136 files/1695 tests** + prod build.

**What shipped.** Any signed-in member can now see who liked a post.
- Backend: `FeedService.listPostLikes` + `GET /community/posts/:id/likes`
  (throttled 60/min). Newest like first, cursor-paged via `?before` (50/page),
  404 for a missing/non-published post. Exposes username + privacy-gated avatar
  (`feedShowAvatar`) only - never a real name.
- Frontend: `components/community/liked-by-sheet.tsx` (bottom-sheet on mobile,
  centred card on desktop; rows link to `/community/u/[username]`), opened by
  tapping the like count on `post-card.tsx` (the heart still toggles the like).
  `lib/community-api.ts` gained `FeedLiker` + `fetchPostLikes`.
- Specs: `feed-post-likes.spec.ts` (5), `liked-by-sheet.spec.tsx` (4).

Operator decision: the list is visible to the whole member base, not just the
author. Note: the frontend full-suite run had one flaky timeout in
`components/licence-centre/design-picker.spec.tsx` (canvas draw under parallel
load); it passes in isolation and on the rerun - unrelated to this change.

## 2026-10-10 — T&Cs / PRIVACY UPDATED FOR THE TRADE CHANGES (FRONTEND-ONLY DEPLOY)

Commit **`aa245641`**, deployed `--frontend-only` (health ×2 OK, public 200 ×2,
three pm2 services online). Brought the legal copy in line with W1–W4:
- **Terms** — new "Cancelling an order" clause (request → freeze → fee-retained
  refund); private-arrangement rewritten to **held funds** (buyer-receipt /
  5-day auto-release, disputes hold); messaging-monitoring clause (contact
  details auto-stripped); WhatsApp added to §17 notices as an opt-in channel.
- **Privacy** — buyer↔seller message moderation/retention paragraph added.
- **Buyer-protection** — dropped the "private arrangement has no protection"
  exclusion.
- **Regulated-items** — private arrangement now funds-held, not immediate
  payout (paragraphs 11, 13, 15).
Verified live: `/terms` 200 (contains "Cancelling an order"), `/privacy` 200.
WhatsApp templates are approved and the app is published (operator), so the
`whatsapp_enabled=true` flip from the previous entry is now effective end-to-end.

## 2026-10-10 — TRADE HARDENING W1–W4 + WHATSAPP HANDOVER; WHATSAPP FLIPPED LIVE

**Deployed.** Commit **`0da075cc`** (43 files) — full deploy via
`infra/deploy/deploy.sh` (Git Bash). Rollback point
**`alloutdoor-20261010-202100.dump`**; `prisma migrate status` up to date
(113 migrations, incl. the two new ones). Backend + frontend health ×2 OK,
warden online, public 200 ×2, three pm2 services online. Gates: backend tsc +
**327 suites/5377 tests**; frontend tsc + **135 files/1691 tests** + prod build.

**What shipped (four workstreams).**
- **W1 cancellation:** buyers can no longer self-refund — `POST
  /transactions/:id/cancel-request` FREEZES the order (no accept/booking/
  dispatch/payout), notifies the seller; support resolves via a fee-retained
  refund (Buyer Protection Fee always kept; carrier cost only when a waybill
  exists). `Transaction.cancellationRequestedAt/Reason`.
- **W2 private-arrange held funds:** funds stay HELD after payment; seller
  "Item delivered", buyer "Item received" releases the payout, either disputes;
  24h buyer follow-up + 5-day auto-release cron; PRIVATE_ARRANGE now legal for
  non-firearms. `privateArrangeDelivered/Received/RemindedAt`.
- **W3 distance:** coarse 5 km-snapped `GET /listings/:id/distance` + listing
  chip (device geolocation, saved-address fallback); seller coords never leave
  the server.
- **W4 messaging:** new `MessagesModule` (buyer↔seller on a transaction), Jev
  auto-strips contact details (blocks abuse).

**WhatsApp handover + flipped LIVE.**
- Three quick-reply templates created at Meta (via
  `backend/scripts/whatsapp-create-private-arrange-templates.mjs`):
  `private_arrange_seller_handover`, `private_arrange_buyer_confirm`,
  `private_arrange_buyer_reminder` — all **PENDING approval**.
- Registry gained `buttonType: 'quick_reply'`; send path skips the URL button
  for them; the webhook routes "Item delivered / Item received / Dispute" taps
  (`context.id` → log row → `vars.txId`) to `TransactionsService` via ModuleRef.
- **`whatsapp_enabled` flipped to `true`** in the production `Setting` table
  (was unset; no cache — effective immediately). ⚠️ Real delivery still needs
  Meta **publish + payment method**, and the three templates to be **approved**;
  any send failure falls back to **SMS** (safe), and a failed run raises a
  `WHATSAPP_OUTAGE` alert. Unset the flag to switch back.

**Still open (W2 follow-ups).** >50 km Arrange-Private popup; non-firearm
PrivateArrangeConsent copy is still SAPS/dealer-worded; Sell form does not yet
offer PRIVATE_ARRANGE for non-firearms (legacy empty-`shippingMethods` listings
do). Ozow site `ALL-ALL-035` max-amount R0.01 blocker + support ticket still
open (unrelated to this deploy).

## 2026-10-10 — SALES-CYCLE HARDENING (BUY-NOW + AUCTIONS) DEPLOYED

**Scope.** Full audit of the buy-now and auction cycle from product select →
checkout → Ozow payment. Fixes for the flaws found, then committed and deployed.

**Deployed.** Commit **`8e1e1dcf`** `fix(payments): harden the buy-now + auction
sales cycle` (23 files). Full deploy via `bash infra/deploy/deploy.sh` (Git
Bash): rollback point **`alloutdoor-20261010-161434.dump`** (29M),
box HEAD matches local, backend + frontend health ×2 OK, warden online, public
200 ×2, all three pm2 services online. Gates: backend tsc clean + **319
suites/5321 tests**; frontend tsc clean + **135 files/1691 tests** + prod build.

**What shipped (highest value first).**
- **Auction-win Ozow failure no longer resurrects the ended auction as an
  `ACTIVE` zombie** — the failure rollback restores `PAYMENT_PENDING` + the
  original pay window (`transactions.service.ts`), so the winner can retry and
  `sweepUnpaidWins` still applies. Previously every failed auction-win checkout
  during the Ozow outage left an unbuyable/unbiddable listing needing DB surgery.
- **Abandoned gateway checkouts are now reclaimed** by a new 10-min sweep
  `reconcileStaleGatewayCheckouts()` (`tasks.service.ts`): after the 24h Ozow
  link TTL it re-polls unpaid gateway txs — recovering a lost-webhook PAID order
  via `markPaid`, else releasing the reservation + deleting the dead tx;
  abandoned auction wins are handed back to the unpaid-winner lifecycle
  (EXPIRED + strike + runner-up). Previously nothing freed them (orphan reclaim
  excludes gateway txs).
- **`ListingsService.cancel()`** rejects `PAYMENT_PENDING`/`SOLD` and is atomic —
  a seller can no longer cancel a listing mid-checkout or after it sold.
- **Ozow webhook handler failures return 500** so the gateway re-delivers (was
  swallowed to 200, consuming the only notification); **chargeback/dispute**
  deliveries now route to the money-safety handler instead of being dropped.
- **Cart checkout gated off** via `CART_CHECKOUT_LIVE` (`payment-mode.ts`): it
  reserved every line + created an `AWAITING_PAYMENT` Order but never created a
  payment or frontend hand-off. Env var is unset in prod → cart stays off.
- Auction correctness: runner-up promotion moves `Bid.isWinner` to the actual
  buyer (same tx); `cancelProxy` CAS on `currentBid`/leader (+`bidCount`) so a
  concurrent opposing bid can't regress the visible bid; `id desc` tiebreaks.
- Inventory Model A everywhere: `sellable = quantityAvailable` (already nets
  reservations). Fixed the double-count in `inventory.ts` + 4 frontend callers.
- CHECKOUT action token is now **single-use** (consumed after a successful
  create); verify-result amount mismatch raises an urgent admin alert;
  `getPaymentStatus` prefers the successful attempt, not `results[0]`.

**Tests.** New specs: `auction-win-rollback`, `gateway-checkout-reconcile`,
`ozow-webhook-dispatch`, `payments-webhook.controller`,
`transactions.controller`; extended `auctions.service`, `inventory`,
`ozow.service`, `listings.service`, `automation-reminders`.

**Still open (unchanged).** The Ozow site `ALL-ALL-035` **max transaction
amount = R0.01** blocker below — until Ozow sets real min/max, no pay-in can be
created, so the new reconcile sweep simply releases every attempt. Paygate
itself is already ON (`PAYMENT_MODE=paygate`, `PAYMENTS_LIVE=true`,
`OZOW_ENV=live`); the pay-out float was topped up to **R100** on 2026-10-10.
Deferred (LOW): a bidder can still lower their own proxy ceiling.

## 2026-10-10 — CHECKOUT FAILS AT OZOW: SITE MAX TXN AMOUNT = R0.01 (OZOW-SIDE; LOG IMPROVED)

**Symptom.** Buyer "Ruanda" got *"Payment processing failed — please try again."*
on checkout.

**Cause — Ozow-side config, not our code.** `POST one.ozow.com/v1/payments`
returned **400 BadRequest**:
`Error occurred creating merchant request (Parameter 'Merchant has a maximum transaction amount of 0.01')`.
Production site `ALL-ALL-035` has its **maximum transaction amount set to R0.01**,
so every real amount is refused at creation. Our code rolled back correctly
(released the listing hold, deleted the tx row — hence no row in `Transaction`),
then threw the generic message (`transactions.service.ts:735`). One occurrence
only, 2026-10-10 14:44:14 SAST, tx `cmv2dys6y000vi5vnmnwdnvfe`. Zero Ozow pay-ins
have ever succeeded (0 rows with `gatewayCheckoutId`). Env is correct
(`OZOW_ENV=live`, site `ALL-ALL-035`, `PAYMENT_MODE=paygate`, `PAYMENTS_LIVE=true`).
This surfaced *after* the checkout-404 fix above — i.e. the fix worked.

**Operator action (open).** Have Ozow set the site's min/max transaction amount
to production values (suggest min R1.00, max R250,000). Separately, the pay-out
float was topped up to R100 on 2026-10-10 (see the section above).

**Code (this deploy).** `ozow.service.ts` gained exported `ozowErrorDetail()`
(extracts Ozow's ProblemDetails `title`/`detail`); the failure log in
`transactions.service.ts` now prints the attempted amount + that reason instead of
only the raw body. 3 new tests. Commit `ef25480a`, full deploy: rollback point
`alloutdoor-20261010-145536.dump`; backend + frontend health ×2 OK, warden online,
public 200 ×2. Backend 314 suites/5293, frontend 135 files/1691, both tsc clean.

## 2026-10-10 — FIREARM "BUY NOW" 404 (FIXED, FRONTEND-ONLY DEPLOY)

**Symptom.** Buyer clicked **Buy Now** on a listing and got the 404 page.

**Cause.** Firearm listings are members-only (`publicVisible=false`; migration
`20260811180000_public_visibility` sets `isFirearm` categories non-public). The
listing detail page forwards the viewer's session token when it fetches
`/listings/:id`, but the **checkout page did not** — its SSR fetch was anonymous,
so the backend 404'd the members-only row (`listings.service.ts:2752`,
`!userId && !listing.publicVisible`) and the page called `notFound()`
(`checkout/[listingId]/page.tsx`). Gap dated to the members-only gating commit
`25ca612c`; the checkout page was never updated.

**Fix.** `frontend/app/checkout/[listingId]/page.tsx` now forwards the buyer's
token on both the `generateMetadata` and the page fetch, mirroring
`listings/[id]/page.tsx`. Commit `efaf11db`, deployed `--frontend-only`.

**State.** tsc clean (both), backend 314 suites/5290, frontend 135 files/1691,
frontend prod build OK. Rollback point `alloutdoor-20261010-144051.dump`.
Frontend health ×2 OK, public 200 ×2, three pm2 services online. No live browser
pass of a real firearm Buy Now was performed post-deploy.

## 2026-10-09 — FEED POSTS STUCK "IN REVIEW": JEV + DEEPSEEK KEYS MISSING IN PROD (FIXED)

**Symptom.** Posting showed *"In review — a moderator will take a look and follow
up."* (the `IN_REVIEW` state: `status = PENDING_MODERATION` **with** `moderatedAt`
set). The DB `moderationReason` was **`moderation_unavailable`**.

**Cause.** The feed's text/image moderation engine is **Jev (text) + DeepSeek
Flash (images)**, and production's backend `.env` had neither key:
`JEV_API_KEY` and `DEEPSEEK_API_KEY` were absent (`GEMINI_API_KEY` present,
`FEED_MOD_ENGINE` unset → the split path). `feed-moderation.service.ts` fails
**closed**: no Jev key → `moderation_unavailable` → held for a human. So **every
non-video post** was being held; only video posts published, because video takes
the single Gemini call.

**Fix (ops, no code change).** Copied `JEV_API_KEY` + `DEEPSEEK_API_KEY` from the
local `backend/.env` into the prod `backend/.env` and `pm2 reload
alloutdoor-backend --update-env`. Verified from the box: Jev `POST
api.typesafe.ai/v1/systemone` → **200 / jev-1.13.0**; DeepSeek `/models` 200 and
`/chat/completions` 200 on `deepseek-flash`. Health 200 ×2.

**Backlog cleared.** One post held with `moderation_unavailable`; its
`moderatedAt` was reset and the 5-minute sweep re-moderated it →
**PUBLISHED** (graphicTier FIELD, behind the content warning), ledger shows
`moderation.feed.images` via `deepseek/deepseek-flash` ok.

⚠️ **If this recurs:** the inline copy says "a moderator will look", but the
member card never shows `moderationReason`. Check `AiUsage` (purpose
`moderation.feed.*`) and the backend `.env` keys before assuming a content hold.
Rollback lever `FEED_MOD_ENGINE=legacy` routes non-video posts through Gemini,
but loses the Jev contact/promo text battery.

## 2026-10-09 (hotfix) — POSTING 500: MISSING `Post.location` COLUMN (DEPLOYED)

**Symptom.** Posting showed "The server had a problem posting." Backend error log:
`P2022 — column "location" of relation "Post" does not exist`, thrown by
`FeedService.createPost` (`prisma.post.create`).

**Cause — pre-existing schema drift, not the composer feature.** `schema.prisma`
has both `Post.location` and `Post.locationPlaceId`, but the 2026-09-23 migration
(`20260923130000_post_location_place_id`) adds **only** `locationPlaceId`. No
migration ever created `location`; it existed on the box from an earlier hand run
and was missing again. A full-column audit of prod `Post` found `location` as the
**only** absent column. `prisma migrate status` says "up to date" because it
tracks the migration table, not drift.

**Fix.** Migration `20261009140000_add_post_location_column`
(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "location" TEXT;`, idempotent),
shipped in `3f14f060` (full deploy). Verified on prod: `location` column present,
and a throwaway `prisma.post.create({ location: 'Malena Lodge', ... })` returned
`CREATED_OK` then `DELETED_OK`. Health ×2 OK, public 200 ×2, three pm2 services
online.

**Also fixed.** The composer used Google's literal `"unnamed road"` as the
location label when a place resolved to an unnamed way. `placeLabel()` now treats
that as "no name" and falls back to the town, the member's selected text, or the
first line of the formatted address.

⚠️ **Watch for more drift.** The location migration was recorded applied without
its DDL. Other columns added by a similarly reconciled migration could be
missing too — `prisma migrate diff` / a column audit is the way to find them.

## 2026-10-09 — KYC: RETURN TO PROFILE AFTER VERIFICATION (DEPLOYED)

**Why.** After verifying, the Didit hosted page returns the member to
`/kyc/verify?returned=1&verificationSessionId=…&status=…` — it carries none of
our query, so `returnTo` is lost. The done card had no onward action and the old
auto-bounce was gated on `returnTo`, so a verified member was stranded on a
dead-end "you are verified" screen instead of their profile.

**Fix (frontend only).** `app/kyc/verify/page.tsx`: the `done` state always
returns (after 3s) with a **Go to my profile** button; destination is `returnTo`
when present, otherwise `/profile`. Opening the wizard while already verified
bounces to the profile too. Origin survives the round-trip in `localStorage`;
new `lib/kyc-return.ts` holds `safeReturnPath` (open-redirect guard) and
`isSessionFreeKycLanding`, both tested.

**No-session / installed-PWA path (the "option b").** On an installed PWA the
Didit page opens in Safari, whose cookie store the app does not share, so the
return lands with no session. `middleware.ts` now exempts
`/kyc/verify?returned=1` from the auth wall — narrowly, via
`isSessionFreeKycLanding` (exact path + `t` or `returned=1` only) — and the page
renders a neutral, data-free "Return to ALL Outdoor" landing rather than hanging
on "Loading…" or bouncing to sign-in.

**Deployed** as `656668e9` (frontend-only deploy). Gates: backend `tsc` clean +
314 suites / 5288 tests; frontend `tsc` clean + 135 files / 1689 tests; prod
build exit 0. Health ×2 OK, public 200 ×2. Live check: `/kyc/verify?returned=1`
→ **200** (was 307 to sign-in), bare `/kyc/verify` → still 307, `/kyc/verify?t=`
→ still 200.

**Follow-ups.** (1) No live browser pass on a phone. (2) On iOS a link from
Safari cannot re-open the installed PWA programmatically; the landing asks the
member to switch back. (3) `steps.verification` still reports `true` for any
session, including `Not Started` — see the note in the entry below.

## 2026-10-09 — KYC: RESTARTABLE UNFINISHED SESSIONS (DEPLOYED)

**Why.** A new member (`ruandadb97@gmail.com` / `ruanda`) registered, gave
consent and details, and created a Didit session at 19:17:58 — which stayed
`Not Started`. Their iPhone loaded Didit's hosted page at 19:18:00 (Didit's own
`ip_analyses` records the device) but they never submitted a document. Because
`verdictFor('Not Started')` returned `PENDING`, `GET /kyc/status` drove
`nextStep = 'waiting'`, so the wizard rendered "Checking your documents…" and
polled forever. On a fresh load `hostedUrl` is null, so there was no Start / QR /
SMS control at all — a dead end for a session that was never actually in flight.

**Fix (backend only).** `kyc.service.ts`: `verdictFor` now maps `Not Started`,
`Abandoned`, `Expired` and `Kyc Expired` to `PENDING` (they are not verdicts and
must not strike or park a member); new `isSessionInFlight()` gates the `waiting`
state, and only `In Progress` / `Resubmitted` / `Awaiting User` qualify.
Everything else falls through to `verify`, where `POST /kyc/session` returns the
same unfinished session (Didit idempotent while open) or mints a fresh one.
`In Review` and unrecognised statuses still park in `UNDER_REVIEW` as before.
Frontend unchanged: the existing `verify` step already renders Start / QR / SMS.

**Verified + deployed.** `8464da9d` (`fix(kyc): restart unfinished Didit
sessions instead of stranding them`). Gates: backend `tsc` clean + 314 suites /
5288 tests; frontend `tsc` clean + 134 files / 1683 tests; frontend prod build
exit 0. Full `infra/deploy/deploy.sh` (backend + frontend): rollback point
`alloutdoor-20261009-215255.dump`, both health checks OK, public 200 ×2, pm2
`alloutdoor-backend` / `alloutdoor-frontend` / `warden` online; server HEAD at
`8464da9d`.

**Follow-ups.** (1) No live browser pass of the restart path. (2) Existing
production rows already in the stuck state are corrected on next `GET /kyc/status`
with no data migration needed (the verdict is derived from the session row).
(3) `steps.verification` still reports `true` for any session, including
`Not Started` — harmless for `nextStep` but worth revisiting if the step rail is
ever driven off it.

## 2026-10-09 — COMPOSER: ONE-OF-THREE POSTS + AUTOCOMPLETE DETAILS (DEPLOYED)

**Deployed to production** as `37424e65` (one commit, full deploy — backend +
migration + frontend). Gates: backend `tsc` clean + 314 suites / 5283 tests;
frontend `tsc` clean + 134 files / 1683 tests; frontend prod build exit 0.
Rollback point `alloutdoor-20261009-214136.dump`. Migration
`20261009130000_widen_post_single_columns` applied (`prisma migrate status`:
"Database schema is up to date!", 110 migrations). Health after: `/api/health`
twice OK, public 200 twice, all three pm2 services online.

**Operator decisions (all 8 answered).**
1. A post needs only ONE of text ("What's on your mind?"), a photo, or a video.
2. Free text is accepted in every detail field — the vocabularies are
   suggestions, not gates.
3. Permit-huntable dangerous game is included (buffalo, elephant, lion, leopard,
   cheetah, hippo, crocodile); protected species are not (rhino, wild dog,
   pangolin).
4. `firearmModel` stays free text — no list.
5. Fishing species expanded like hunting.
6. Numerics stay free text (no suggestions).
7. `testResult` gets a small phrase list + free text.
8. Chip cap stays 8.

**Backend.** `body` is now optional (`create-post.dto.ts`) and stored as `''`
for media-only posts. `submitPost` AND `updatePost` enforce "at least one of
text/photo/video" (`feed.service.ts`) — create-time cannot, because media is
attached after create. The moderation sweep (`tasks.service.ts`) skips
content-less posts and deletes never-submitted empty orphans older than 24 h, so
an abandoned create can never publish a blank card. The Jev text axis is skipped
when there is no text (`feed-moderation.service.ts`). `normaliseChipList` /
`normaliseSingleValue` (`feed.types.ts`) accept free text (lowercase,
spaces→hyphens, deduped, capped: chips 32, singles 32); `POST_CHIP_VOCAB` /
`POST_SINGLE_VOCAB` are now **seeds, not gates**. Migration
`20261009130000_widen_post_single_columns` widens the six single-select columns
`VarChar(20) → VarChar(32)` (metadata-only in Postgres). New spec
`post-content-gate.spec.ts`; `feed.types.spec.ts` updated.

**Frontend.** One new control `components/community/vocab-combobox.tsx`
(type-to-search; nothing shows until you type; free text committed on Enter;
multi-select renders removable tokens) replaces every pill wall and every
dropdown in "+ Add details", for all nine categories. Data in
`lib/post-vocab.ts` (species, flair, singles, test-result, with Afrikaans
aliases) + generated `lib/post-vocab-cartridges.ts` (578 CIP cartridges from
`backend/prisma/seed-data/grt-caliber.csv`, via new
`backend/scripts/build-post-vocab-cartridges.ts`). `fold()` was lifted to
`lib/fold-text.ts` and re-exported from `BenchCartridgePicker` so the Bench spec
is untouched. Post button now enables on any one of the three
(`post-composer.tsx`); the type `<select>` gained `aria-label="Post category"`.
`post-card.tsx` hides an empty body. `my-posts-client.tsx` lets an edit clear
the body when media exists. New specs: `lib/post-vocab.spec.ts`,
`components/community/vocab-combobox.spec.tsx`; the two pill tests in
`post-composer.spec.tsx` were rewritten to drive the combobox.

**Not done, if it matters next time:** no live browser pass of the new composer
post-deploy.

## 2026-10-09 — COMMUNITY FEED ENABLED FROM CODE (DEPLOYED)

**Deployed to production** as `9e6e9747` (one commit). Full deploy
(`& "C:\Program Files\Git\bin\bash.exe" infra/deploy/deploy.sh`, no side flag —
the diff touches `backend/`). Gates first: backend `tsc` + 313 suites / 5279
tests (1 suite / 8 tests skipped), frontend `tsc` + 132 files / 1668 tests
(1 skipped), frontend prod build exit 0 (`BUILD_ID` present). Rollback point:
`alloutdoor-20261009-204150.dump` (~29.8 MB). Health after: `/api/health` twice
OK, public 200 twice, all three pm2 services online. No migration ("No pending
migrations to apply").

**Symptom.** Posting to the community showed *"Community is temporarily
unavailable"*. That copy is the composer's hard-coded handler for an HTTP **404**
from the community API (`frontend/components/community/post-composer.tsx:110-114`),
which it originally meant "route not deployed". Routes ARE deployed — anonymous
`/api/community/*` returns **401** (the `AuthGuard` runs before the handler). For
a signed-in member the request passes auth and then hit `assertEnabled()` →
`NotFoundException()` because the `feed_enabled` master flag was false.

**Why it could not be flipped from the UI.** The admin PWA no longer exposes a
settings/flags editor (the flags table was deliberately removed from Insights),
so there was no admin surface to turn `feed_enabled` on. `admin-settings.service.ts`
still carries the registry entry but nothing renders it.

**What changed (3 files).**
1. `backend/src/feed/feed.service.ts` — `assertEnabled()` no longer reads
   `FLAGS.feedEnabled`; it is hardcoded ON, so a stale `feed_enabled=false`
   Setting row can no longer 404 the whole feed. Kept named/async so the 30+
   callsites still read as a gate and a future kill switch has one place to land.
2. `backend/src/settings/settings.service.ts` — `FLAGS.feedEnabled.default`
   flipped `false` → `true` (runtime registry).
3. `backend/src/admin/admin-settings.service.ts` — mirror default `'false'` → `'true'`.

**Note for the next session.** `feed_enabled` no longer gates anything; enabling
the community is now a code fact, not a DB setting. `npm run feed:flags -- off`
writes the `Setting` row but `assertEnabled()` ignores it — do not expect it to
turn the feed off. If a real kill switch is wanted again, re-wire `assertEnabled()`
to read the flag. True end-to-end verification of posting needs a signed-in
session (anonymous requests are 401 regardless of the flag).

## 2026-10-09 (late) — PARGO PICKUP SURFACED + RETIRED-COURIER SWEEP (DEPLOYED)

**Deployed to production** as `076d7e69` (one commit). Full deploy
(`& "C:\Program Files\Git\bin\bash.exe" infra/deploy/deploy.sh`, no side flag —
the diff touches `backend/`). Gates first: backend `tsc` + 313 suites / 5279
tests (1 suite / 8 tests skipped), frontend `tsc` + 132 files / 1668 tests
(1 skipped), frontend prod build (`BUILD_ID` present). Rollback point:
`alloutdoor-20261009-183116.dump` (~29.8 MB). Health after: `/api/health` twice
OK, public 200 twice, all three pm2 services (`alloutdoor-backend`,
`alloutdoor-frontend`, `warden`) online. No migration ("No pending migrations to
apply").

**Context.** The operator asked to add Pargo pickup to BOB GO, but the rails are
already built: door-to-door vs Pargo pickup is the existing
`DeliveryOption { DOOR_CHEAPEST, DOOR_FASTEST, STORE_PICKUP }` in the checkout /
cart pickers, the nearest-5 Pargo counters by buyer-address distance already
come from Bob Go's `/rates-at-checkout` (`shipping.service.ts` `menuFromRates`,
capped at 5, sorted by `pickupPointDistanceKm`), the courier always collects from
the seller, and firearms/barrels are already locked to
`DEALER_TRANSFER`/`PRIVATE_ARRANGE`. What was missing was the **Pargo status leg**
and the last user-visible retired-carrier copy.

**What changed (17 files).**
1. **`READY_FOR_PICKUP` was invisible to the frontend.** Added it to the
   `ShippingStatus` union (`frontend/lib/types.ts`), a label + hint in
   `status-labels.ts`, a case in `/my/orders`, the `SHIPPING_STATUS_LABEL`
   record on the transaction page, and a 3-step pickup timeline
   (`COLLECTED → IN_TRANSIT → READY_FOR_PICKUP`) on `/shipping` — the `steps`
   array had to be typed `readonly string[]` or TS narrowed `indexOf`'s arg to
   the array intersection. A Pargo parcel waiting at the counter used to render
   as "Awaiting collection by the courier".
2. **Sell form (operator call 2026-10-09).** Removed the non-firearm
   door-delivery info box entirely; the Pickup address field is now the only
   seller input. The `Delivery` Field renders for firearms only.
3. **Retired-carrier sweep.** Help-centre FAQ copy (RAG KB, `AskGgKbEntry`)
   rewritten onto Bob Go door + Pargo pickup and the stale carrier tags
   dropped; deleted the stale `backend/prisma/dev-test-webhooks.ts` (posted to
   the removed legacy webhook route); cleared the invalid `LOCKER` value from the valuation
   configs + `docs/valuation-spec.md`; `docs/INDEX.md` glossary and the admin
   mockup word swept. **Legacy enum placeholders stay** (historical rows)
   and the accurate "retired" notes in `project-reference.md` /
   `ARCHITECTURE.md` / `ENVIRONMENT.md` stay.

**One thing left for you.** The help-centre FAQ is seeded into the DB; run
`npm run seed:help` (backend) against the box to refresh the live KB rows — the
code deploy alone does not rewrite them.

## 2026-10-09 (night) — TWO-SIDED DOCUMENTS RIDE WHOLE (DEPLOYED)

**Deployed to production** as `342cc214` (one commit). Full deploy. Gates:
backend `tsc` + 106 suites / 2358 tests, frontend `tsc` + 132 files / 1668
tests, frontend prod build. Health after: `/api/health` twice OK, public 200
twice, three pm2 services online. No migration.

**What it fixes.** Auto-link gated the SECOND page of a two-sided proficiency
on its OWN settled-date row, so a certificate could ride without its statement
of results (or the reverse) even though the two are ONE document — the lead
passed the gate, the partner did not, and the pack carried a half document.
`attachWithOtherSide` now resolves the partner by `otherSideId` and rides it
along regardless of the caller's candidate gate; the delete-refusal gate still
applies. A one-sided document is unchanged: it attaches its one side and is
never blocked. Operator, 2026-10-09: "if it has two sides add it, if it has
only one side just add the one side — it shouldn't be a blocker."

**⚠️ What this does NOT do.** MO000083 (the operator's S13 handgun pack) still
shows only the Statement of Results under Annexure C, because the handgun
proficiency in the vault is a SINGLE side: `cmtzq08e5…` has `document_side =
back` and `otherSideId = null`, and there is no front row anywhere in the vault
(verified by dumping all 21 credentials). The rifle and shotgun proficiencies
are proper front+back pairs; handgun is not. The pack is faithful to the vault.
To get both pages into the pack for MO000083, the handgun proficiency
certificate (the front) must be added to the Document Centre. No code change
can supply a document that was never uploaded.

## 2026-10-09 (evening) — WRITER PERSONA + PRINTER TEST FLAKE FIX (DEPLOYED)

**Deployed to production** as `420e9de1` (2 commits: `251b8c12` the persona,
`420e9de1` the test fix). Full deploy (`bash infra/deploy/deploy.sh`, no side
flag — the diff touches `backend/`). Gates first: backend `tsc` + 313 suites /
5279 tests (1 suite / 8 tests skipped), frontend `tsc` + 132 files / 1668 tests
(1 skipped), frontend prod build (`BUILD_ID` present). Health after:
`/api/health` twice OK, public site 200 twice, all three pm2 services online.
No migration.

**Commit `251b8c12` — the writer now carries a persona.** Operator complaint:
the generated content reads generic. `writerVoice` in `motivation-prompts.ts`
was rewritten from a lone "firearm expert" into a seasoned South African
motivation writer who is also, for the document in hand, a specialist in the
firearms it is about, with the specialism gated to the licence type
(self-defence vs hunting/sport vs renewal). Two new emphases: RICH AND SPECIFIC
(write from THIS applicant's facts, name the actual thing, depth from one real
fact) and MUST NOT READ AS MACHINE-WRITTEN (no hedged both-sides phrasing,
stacked triads or throat-clearing). The rule 1 recall guard is preserved: the
expertise is the step from fact to requirement, never a licence to invent a
figure. Two discipline-spec tests lock the persona and the type gating.

**Commit `420e9de1` — printer smoke test no longer flaky.** The
`chromium-pdf.service` integration test spawns a real browser; under the full
suite the cold start competed for CPU and could miss the 30s timeout, failing a
test that passes in isolation. Raised the printer timeout to 60s and gave the
test one retry with a 120s budget.

**Note for the next person.** The persona is a prompt change, so its real effect
is only visible on a freshly generated pack. If you want to see it, regenerate a
licence centre sheet and compare the body prose against MO000083 (the pre-persona
sample in `~/Downloads`). The pack review of MO000083 also lists other open
items (half-empty pages from forced breaks, contents lists 13 before 12, a safe
photo captioned only "2/3 and 3/3", a trend cell carrying a provenance
paragraph, raw card-case calibres in the held-firearm prose) — none of those are
addressed by this change.

## 2026-10-09 (later) — CONSENT LICENCE-CARD OCR PINNED TO GEMINI + ID RE-READ (DEPLOYED)

**Deployed to production** as `94534952` (one commit). Full deploy
(`bash infra/deploy/deploy.sh`, no side flag — the diff touches `backend/`).
Gates first: backend `tsc` + 313 suites / 5277 tests (1 suite / 8 tests
skipped), frontend `tsc` + 132 files / 1668 tests (1 skipped, one
`no-self-recursive-callbacks` flake on the first run that passed on rerun and
in isolation), frontend prod build (`BUILD_ID` present). Health after:
`/api/health` twice OK, public site 200 twice, all three pm2 services online.
No migration. Rollback point: the pre-deploy dump taken by `deploy.sh`.

**What changed.** The seller consent link reads the previous owner's licence
card (`LicenceCardOcrService`) and proposes the fields, including the
13-digit ID the seller must not type by hand.

1. **The OCR purpose is pinned to Gemini.** `LlmService.providerFor` now
   returns `gemini` for any `licence.card.*` purpose, so the reader stays on
   **Gemini 3.5 Flash-Lite** and a global `LLM_PROVIDER` switch (or a
   stated DeepSeek default) cannot move a vision call onto a non-vision model.
   This matches the operator decision 2026-10-09: "keep it at gemini 3.5 flash
   lite as the OCR reader." See the `licence.card.*` pin next to the video and
   image pins in `backend/src/common/llm/llm.service.ts`.
2. **A missed ID is re-read on its own.** When the full 14-field read returns
   without a valid 13-digit ID, the service makes one focused second call for
   the ID alone (`purpose: licence.card.read.id`, 40 tokens). `readId` also
   coerces an ID returned as a JSON number. Regression tests in
   `licence-card-ocr.spec.ts` (re-read, numeric coercion) and
   `llm.service.spec.ts` (pin under `LLM_PROVIDER=deepseek`).

**The investigation, for the next person.** The reported symptom ("does not
pick up ID number") was NOT reproducible in code: the model read the ID from
every real fixture in `scan-fixtures/real` (raw camera JPEGs and the scanner's
dewarped `out/*.quad.jpg`) through the full `LlmService` path, and even from a
PNG mislabelled as JPEG. The pipeline, schema, prompt and model are all sound.
The miss is situational (a hard photo or a hard card), which is exactly why the
ID now gets a second, focused pass rather than relying on one.

**One thing left open.** `llm.service.ts` header comment still claims the
platform default "is set to deepseek", but the box sets no `LLM_PROVIDER` at
all (verified), so the platform default is Gemini. The card OCR is now pinned
regardless, so this is a comment-vs-env mismatch to tidy, not a live bug.

## 2026-10-09 — MOTIVATION AUDIT FIXES + PHASE 4 HTML/CHROMIUM FOUNDATION (DEPLOYED)

**Deployed to production** as `4ebd9b6a` (2 commits: `4490c77e` the audit
fixes, `4ebd9b6a` the renderer foundation). Full deploy (`bash
infra/deploy/deploy.sh`, no side flag — the diff touches `backend/`). Gates
first: backend `tsc` + 313 suites / 5274 tests (1 suite / 8 tests skipped),
frontend `tsc` + 132 files / 1668 tests (1 skipped), frontend prod build
(`BUILD_ID` present). Health after: `/api/health` twice OK, public site 200
twice, all three pm2 services (`alloutdoor-backend`, `alloutdoor-frontend`,
`warden`) online. No migration in this change set.

**Commit `4490c77e` — motivation layout, content and gate fixes.** Layout:
ellipsised running banner and fitted every heading style; one embedded type
system (the 15 Helvetica draw sites are gone); table headers repeat on
continuation pages; the em-dash Purpose column drops when nothing is stated;
layout-aware top margin; merged annexure PDFs are watermarked; merged-annexure
contents page numbers corrected; spec-compliant signature block; sane battery
column widths; rows measured before a page break; scheme-pure neutrals;
annexure divider pages with edge tabs; the hanging rule drawn with a
conditional indent. Content: the prompt's self-banned exemplar removed; the
comparison carve-out added to the firearm briefs; the slop/outcome lists
published; the spelling fold no longer manufactures "utilise"; drafted reasons
carry a provenance block; gate findings feed the retry; `gateCycles` resets
when answers change; the gate sees the intended-uses and overlap blocks; the
S13 ammo claim is conditional; quotable template sentences removed; arsenal
calibres and dates tidied; word bands and repetition wired as advisory
feedback; "dedicated" banned on S15; repaired text re-folded; spelled-out
measurements detected.

**Commit `4ebd9b6a` — Phase 4 foundation, ADD-ONLY, NOT WIRED.**
`backend/src/motivations/motivation-html.service.ts` (pure `MotivationPdfInput`
-> HTML/CSS, headings parsed with the same `isHeading`/`splitHeading` rules as
pdfkit) and `chromium-pdf.service.ts` (dependency-free headless-Chromium
printer via `chrome --headless=new --print-to-pdf`; no new npm package). Plus
`backend/scripts/motivation-html-sample.ts`. **The pdfkit renderer is still
authoritative**; nothing in the served download path references the new
services.

### Traps worth keeping

1. **Chromium repeats `position: fixed`, but a fixed TOP header collides with
   flow content on continuation pages** (it lands at the content edge, not the
   margin band). Only the footer is fixed in the HTML renderer; the running head
   is a one-time masthead. Page numbers and per-page section labels still need
   the CDP/Playwright header-footer templates. See `MOTIVATION-LAYOUT-SPEC.md`
   §8, which now records the true status.
2. **A `\s` inside a normal string literal is just `s`.** `motivation-scope.ts`
   built `PARA_BREAK` as `String.fromCharCode(10) + '\s*' + ...`, so paragraph
   splitting never matched a blank line. Fixed to `'\\s*'`. Watch for the same
   trap in any hand-built regex.
3. **The HTML generator must mirror `isHeading`/`splitHeading` from
   `motivation-pdf.service.ts`.** The old colon-only heading test dropped every
   numbered heading ("1. Application") into the body and produced 19 sparse
   pages; the fixed parser flows the document to 5.
4. Untracked and intentionally NOT committed: `COMPLIANCE-RULES.md`,
   `backend/.ozow-test-evidence/`, and the dev artifact
   `motivation-html-sample.pdf` (repo root). `deploy.sh`'s `git diff --quiet`
   gate ignores untracked files.

## 2026-10-01 — COMMUNITY POST DETAILS: OPTIONAL PER-CATEGORY FIELDS (DEPLOYED)

**Deployed to production** as `23a550b3`. Full deploy (`bash infra/deploy/deploy.sh`,
no side flag — the diff touches `backend/` and `prisma/`), all gates green first:
backend `tsc` + 302 suites / 5181 tests, frontend `tsc` + 128 files / 1657 tests,
frontend prod build. Rollback point: `alloutdoor-20261001-002118.dump`
(~28.6 MB). Health after: `/api/health` twice OK, public site 200 twice, all
three pm2 services (`alloutdoor-backend`, `alloutdoor-frontend`, `warden`) online.
Migration `20260930120000_add_post_structured_fields` applied on the box.

**What it does:** every community post type now has a compact set of **optional**
fields (Hunting: species/calibre/shot distance; Firearms: type/calibre/model/
purpose; Reloading: cartridge/bullet weight/charge/result; Fishing: species/
water/method/size; Overland: condition/trip days; Camping: site type/facilities/
nights; Gear: category/rating/condition; Questions: topic/context; plus a shared
date). Chips + free tags coexist; only the body is required. The composer shows a
collapsed **"+ Add details (optional)"** section that swaps with the category and
remembers choices in `localStorage` (`gg.community.postDetails`).

### Three traps worth keeping

1. ⚠️ **`prisma migrate dev` CANNOT BE USED IN THIS REPO.** The dev DB carries
   intentional raw-DDL drift (the Ask GG KB `searchTsv` and reloading
   `textTsv` columns, plus a pg_trgm index — all absent from `schema.prisma`), so
   `migrate dev` reports drift and offers to **RESET the database**. The new
   migration was **hand-written** (`prisma/migrations/20260930120000_.../migration.sql`)
   and applied with `prisma migrate deploy` + `prisma generate`. Do the same next
   time.
2. **The vocabulary is code, not enums.** `backend/src/feed/feed.types.ts` holds
   `POST_CHIP_VOCAB` / `POST_SINGLE_VOCAB` / `POST_NUMERIC_BOUNDS` /
   `POST_DETAIL_FIELDS`, and `sanitisePostDetails(input, type)` strips any field
   not valid for the type, drops unknown chip values and clamps numbers.
   It **omits keys the client did not send**, so an edit never wipes an untouched
   field. `looksLikeSerial()` refuses a `firearmModel` with a 5+ digit run —
   model name only, serials are never collected. The dead `gear Json?` column was
   dropped. The frontend mirror is `frontend/lib/post-fields.ts`.
3. **Filters are backend-only for now.** `GET /community/feed` and `/search`
   accept `species[]`, `calibre` and `minRating`, but no filter UI was built yet.

### ⚠️ CRLF phantom status (not new, but read before panicking)

`core.autocrlf=true` here. `git status` reports ~600 stat-dirty files that are
**not real edits**; `git diff` (content) shows only the true changes, and
deploy.sh's `git diff --quiet` gate passes once the real work is committed. Stage
explicit paths — never `git add .`.

## 2026-09-30 (later) — GOOGLE KEYS MOVED TO alloutdoor-api + PWA THEME SWITCHER (DEPLOYED)

**Deployed to production** as `6741e594` (2 commits: `b3a7da14` the theme switcher,
`6741e594` the env-doc correction), `--frontend-only` (the diff touched only
`frontend/` and `docs/`). Gates first: backend tsc + 298 suites / 5145 tests,
frontend tsc + 128 files / 1655 tests, frontend prod build (`BUILD_ID` present).
Health after: `/api/health` twice OK, public site 200 twice, all three pm2
services online.

### The Google outage had TWO causes, and only the second one was real

1. **Wrong project.** Production's browser key (`…qF_tME`) belonged to
   **`gun-galore-dealer-scans`** — a *different Google account* (the console's
   `authuser=0`). Billing was enabled on `alloutdoor-api`, which owned none of
   the site's keys, so nothing changed. Confirmed by reading the key value out
   of the console's Show-key dialog.
2. **Then the migration fixed it.** Box env swapped to the `alloutdoor-api`
   keys and the frontend rebuilt (`NEXT_PUBLIC_*` is baked at build time — an
   env edit alone does nothing):
   - `frontend/.env.production` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` = `…LDDR0g`
     (`alloutdoor-frontend-web`, referrer-restricted).
   - `backend/.env` → `GOOGLE_MAPS_API_KEY` = `…3N7234`
     (`alloutdoor-backend-server`, IP-restricted — the Web Service APIs reject
     referrer-restricted keys, hence two keys in one project).
   - `GOOGLE_VISION_API_KEY` (`All Outdoor - Vision OCR (server)`) was already
     on `alloutdoor-api`.
   Backups: `backend/.env.bak-gmaps-migrate-*`, `frontend/.env.production.bak-gmaps-*`.

**Verified live, not assumed:** box → Google Geocoding `OK` and Routes
`computeRoutes` 50,378 m Cape Town→Stellenbosch; browser on production serving
`…LDDR0g` → Places `OK`, Geocoder `OK`, Place Details `OK` (name + lat + 9
components) — which is exactly what the firearm planned-dealer guard needs, so
**firearm listings can be published again**.

⚠️ **The old key in `gun-galore-dealer-scans` is now unused** — worth disabling
there, and it lives under your other Google login. `GEMINI_API_KEY` is a Google
AI Studio key (`AQ.…`), not a GCP project key, so it is not part of this.

### Theme switcher on the phone / PWA

The nav's toggle is `hidden md:flex` because the mobile ROOT header has **8px of
slack at 390px** (measured) — so the PWA had no theme control at all. It now
lives in the **PUSH header** (every inner screen) and as a labelled
**System / Light / Dark** row on **/account** (`components/theme-choice.tsx`).

Mounting it shell-wide exposed a real **hydration mismatch**: `useTheme`
computed its initial state from `window`, so on an OS-dark device the server
rendered light and the client dark and React threw *"Hydration failed"*. The
hook now renders SSR-safe and adopts the stored/OS theme after mount, skipping
the first DOM sync so the pre-paint script's value is never clobbered. Console
is clean in production after the fix.

## 2026-09-30 — MOBILE/PWA HOME: ONE-ROW MINI BAR, NO HERO (DEPLOYED)

**Deployed to production** as `cbf8c638` (2 commits: `3defe541` the feature,
`cbf8c638` a small payout-harness `--amount` flag). Full deploy
(`bash infra/deploy/deploy.sh`, no side flag — the diff touches `backend/`), all
gates green first: backend `tsc` + 298 suites / 5145 tests, frontend `tsc` +
127 files / 1652 tests, frontend prod build (`BUILD_ID` present). Health after:
`/api/health` twice OK, public site 200 twice, all three pm2 services online.

The operator's complaint: on a phone/PWA the shell's shop-mode bar
(`frontend/components/shop-mode-tiles.tsx`) was ~340px tall and the hero another
260px, so the product feed — the thing that sells — started ~815px down.

- **`shop-mode-tiles.tsx`** — below `sm` the bar is now **one row of three mini
  icon buttons** (Buy Now / Auctions / Armory): 28px chip, 13px label, centred
  icon-over-label via a new `mini` prop on `TileBody`/`ModeTile`/`ArmoryTile`.
  Blurb and live count are hidden on mobile; Armory's caret rides the label row
  (a new `Caret` component now draws both the link chevron and the disclosure
  caret). Armory lost its `col-span-2`; the nav grid is `grid-cols-3` signed in,
  `grid-cols-2` signed out. The panel's sub-tiles deliberately do NOT pass
  `mini`, so they keep full rows **and** their blurbs. `sm+` is byte-identical.
- **`hero.tsx`** — `.hero-section` is `display:none` below 768px (width-gated,
  so the server HTML stays identical at every viewport). `layout.tsx`'s hero
  preload is now `media="(min-width: 768px)"` so phones stop downloading a plate
  they never show.
- **`page.tsx`** — landing section `py-10` → `pt-5 pb-10 sm:py-10`, grid wrapper
  `mt-0 sm:mt-10`, "Latest listings" header `mb-3 sm:mb-5`.

Result measured at 390px: bar 95px, first product row at ~275px. **Caveat for
the next session:** both the local and production catalogues currently return
`total: 0`, so the card row could not be eyeballed with stock — the position is
measured, not seen. Signed-in Armory is covered by spec only (no local session).

⚠️ **RUN `deploy.sh` WITH GIT BASH, NOT `bash`.** `bash` on this box resolves to
`C:\Windows\System32\bash.exe` (WSL), whose git has `core.autocrlf` unset — it
sees **401** files as modified, so `deploy.sh`'s `git diff --quiet` gate dies
with "uncommitted changes". Use
`& "C:\Program Files\Git\bin\bash.exe" infra/deploy/deploy.sh`.
Related and pre-existing: `git status` in Windows git lists ~594 phantom `M`
entries (LF/CRLF stat noise — `git diff` is empty for every one of them), so
never stage with `git add .` and do not try to "fix" the tree.

## 2026-09-28 — "UPLOADED 5 DOCUMENTS AT ONCE AND IT FAILED"

**Working tree only.** The five-file upload never reached `commit`. Root cause
was a **timeout, not a rejection**: the browser posts to same-origin `/api/*`
(`NEXT_PUBLIC_API_URL=/api`, `LOCAL_API_PROXY=true`), which Next.js proxies to
`:3001`. Next's dev proxy **aborts a proxied request after 30s**
(`proxy-request.js: n || 30_000`). `identify()` walked the batch **one file at
a time** — one classify (~5s) plus, for a document, an orient call (~4s) — so
five files took **47s** (log: classify 16:38:17 → orient 16:39:04). The proxy
cut the request; the backend, never told, finished all five. A single document
(~9s) was always under the line, which is why one worked and five did not. No
credential was created (checked the DB), and no `commit` ever ran.

Fixes:

- `backend/src/licence-centre/licence-centre.service.ts` — `identify()` now
  runs files through a small pool (`IDENTIFY_CONCURRENCY = 3`,
  `mapWithConcurrency`), **validation hoisted before any call** so a bad file
  does not bill for its siblings, and **verdicts written by index** so the
  client still matches verdict to file by position. Five files ≈ 18s; twenty
  under a minute. This also protects production's edge timeout, not just local.
- `frontend/next.config.mjs` — `experimental.proxyTimeout: 300_000`, off the
  30s default. Belt and braces: the pool fixes the common case, the timeout
  stops any long batch being reported as a failure. Confirmed loaded in the dev
  log (`Experiments: proxyTimeout: 300000`).
- `backend/src/licence-centre/identify-batch.spec.ts` — the "one file's call
  throws" test no longer asserts which **index** receives the single rejected
  answer (concurrent calls race); it asserts both files get a verdict and the
  roles are `['document','evidence']`. 5125 backend tests pass.

**Also applied:** the local DB was **missing `DocumentIdentify`** (pending
migration `20260926160000_document_identify`), so every identify verdict failed
to persist and `commit()` re-classified each document from scratch. Ran
`prisma migrate deploy` (the one pending migration; non-destructive). The table
now exists, so commits reuse the stored verdict instead of paying the model
again. The noisy `public.DocumentIdentify does not exist` warning is gone.

Servers restarted: backend `node dist/src/main` (owns :3001), frontend
`npm run dev` (owns :3000).

## 2026-09-25 — THE SAPS APPLICATION TRACKER (local, uncommitted)

**NOTHING DEPLOYED.** Branch `feat/takealot-ux-parity`, working tree only. The
whole feature exists — backend, migration, frontend, tests, docs — and no
command has been run against the box.

Members applying for a competency or a licence had no way to see where the
application stands short of phoning their DFO. SAPS publishes the answer on a
public web enquiry; the tracker saves a reference, polls that enquiry, keeps
every observation it makes, and notifies on a change. It is the **fourth
Armory sub-tile**, at `/licence-centre/tracking`.

**The enquiry is a CSRF-protected form, so reading it is three requests, not
one:** `GET` the page, take `csrf_token` off the `set-cookie`, then `POST`
form-encoded — and the field name is **`csrf_token`**, not `csrf` (which
answers HTTP 400). A `COMPETENCY` sends `fsref` alone; a licence or renewal
sends `fsref` + `fserial`.

- **Backend** — `backend/src/licence-tracker/`: a regex parser
  (`saps-enquiry-page.ts`) with four sanitised fixtures, the service, the
  member controller (`/api/licence-centre/tracking`), an admin controller
  (`/api/admin/licence-tracker`, health + an on-demand `check-all`), the weekly
  sweep (`@Cron('40 4 * * 0')`) and a module boot spec.
- **`backend/src/common/saps-http.ts`** — the SAPS HTTPS client moved out of
  `crime-stats/` (its only importer was `crime-stats-fetch.service.ts`), and
  gained `sapsPostForm`, `extractCookie` and `node:zlib` gzip/deflate/br
  decode. No new dependency.
- **Schema** — `TrackedApplication` + `TrackedApplicationEvent`, additive, in
  `20260926000000_tracked_applications`. The reference and the serial are
  **encrypted at rest** (`common/blob-crypto`) with a `referenceHash` for the
  `@@unique([userId, referenceHash])` dedupe. Events go on `onDelete: Cascade`.
- **Four flags**, in **both** registries: `licence_tracker_enabled`,
  `licence_tracker_sweep_enabled`, `licence_tracker_check_cooldown_hours` (6),
  `licence_tracker_sweep_max` (50).
- **Frontend** — `lib/licence-tracker-api.ts` (sibling of
  `licence-centre-api.ts`, same four load-bearing properties), the list and
  detail pages, and `components/licence-tracker/` (card, timeline, status
  badge, add form).

**Seven decisions worth knowing before you touch it.**

1. ⚠️ **`licence_tracker_enabled` DEFAULTS TO `true` IN THIS BUILD** — the
   operator asked for it on so the feature can be exercised and debugged
   locally. It is a real `Setting` row, so `/admin` turns it off without a
   deploy, and **it is the one value to flip before a production deploy.**
2. **A status, an outcome and a "we are blind" are three different facts and
   the UI keeps them apart.** `lastOutcome` is what our last poll did
   (`row` / `no_records` / `error`), never what SAPS decided. A failed poll
   **never** writes or overwrites `status`, and the empty state reads **"SAPS
   has no record yet"** — never "no records", which is a claim we cannot make.
3. **`sapsUpdatedOn` is not `lastCheckedAt`.** The first is when SAPS
   refreshed its own records, the second is when *we* last asked. A card that
   could only say "APPROVED" and never "SAPS said APPROVED three weeks ago"
   could not tell a live status from a stale one.
4. **The cooldown is an answer, not a failure.** It returns **429** carrying
   `retryAfter` as an ISO instant, and `TrackerCooldownError` / `retryMessage`
   name that moment — "in 6 hours" read at 09:00 and re-read at 15:00 has
   already expired. Hourly, not per-minute: repeated enquiries get a block page.
5. ⚠️ **`formatDay` renders in UTC, always, including for a full ISO instant.**
   The server stores a SAPS date as `Date.UTC(y, m-1, d)`; read back in the
   viewer's zone that is the **previous day** anywhere west of Greenwich.
6. ⚠️ **THE FIRST ENQUIRY RUNS THE MOMENT THE ROW EXISTS, AND THE FORM FIRES
   IT — NOT THE POST.** `create` writes the row and nothing else, so a card
   that sat unread read as "we asked SAPS and it had no record", and the
   member reached for Check now to fix a problem that was really a missing
   step. `create` in `frontend/app/licence-centre/tracking/page.tsx` therefore
   calls `void check(created.id)` after the row lands, `TrackerStatusBadge`
   gained an `asking` state ("Asking SAPS…") that sits **below** the two real
   outcomes so a re-ask never erases an answer we already hold, and
   `AddTrackerForm` clears on success so a second tap cannot hit the 409. It
   is deliberately **not** folded into `POST` — the handshake is two legs with
   a 20s timeout each, so a synchronous create would hold "Start tracking" for
   up to forty seconds.
7. ⚠️ **THE JOURNEY IS A READING AID, AND EVERY FIGURE ON IT SAYS WHAT IT WAS
   MEASURED FROM.** `daysSince()` is arithmetic on the member's own lodge date;
   with no date, `DaysCounter` prints a quiet prompt rather than counting from
   our `createdAt`, which would put "1 067 days since you lodged it" over a row
   made last week. `SAPS_STAGES` is the order those statuses *usually* arrive
   in — a rung is marked "seen before" only when one of the member's own rows
   actually carries that status, an unrecognised status gets a sentence naming
   the raw text **instead of** a rung, and a refusal or a cancellation is lifted
   out of the ladder entirely, because a position on it is itself a claim about
   where the file is. `journey()` measures each step on SAPS's own status dates
   wherever both rows carry one and falls back to our observation stamps only
   when they do not (a weekly sweep notices on Sunday what moved on Tuesday),
   and `elapsedWord()` names **which of the two clocks** the number came off.
   ⚠️ **"In SAPS's own words" filters on `source === 'SAPS'`** — the milestone
   form has a "what happens next" box, so a member row can carry a `nextStep`
   and a search across every row would quote them back to themselves under the
   Service's name.
   **"View history"** sits below Check now on the card as a **sibling of the
   link, never inside it**, and opens `TrackerHistorySheet`: a bottom sheet in a
   browser, the whole screen in an installed PWA, with a drag banner that says
   in words what dragging does and a **110px** threshold so a thumb that twitches
   mid-scroll cannot close the history. The detail route renders the same
   `TrackerJourney` **inline** and deliberately has no second copy in a window —
   the list opens the sheet because a summary row carries no events, and this
   route already has the full detail.

**Retention and erasure (POPIA, Phase 4).** A deactivated tracker is hard-deleted
after `TRACKER_RETENTION_DAYS = 365` inside the existing
`licence-centre-retention.service.ts` sweep — it is a `deleteMany` on
`updatedAt < cutoff` and `active: false`, so its events go by cascade.
`purgeForUser` deletes a departing member's trackers **explicitly** rather than
trusting the cascade: the account-closure path has a fallback branch that keeps
the `User` row, under which no cascade runs.

**Verified:** backend `npx tsc --noEmit` CLEAN; `npm test` **4941 pass** (2
pre-existing unrelated failures in `motivations/` — `motivation-pdf-layouts
.spec.ts:381` expects `#C8102E` where the committed service sets `#E30613`, and
`motivation-consent-pack.spec.ts:100`, which was already listed here);
`licence-tracker` 50/50, `saps-enquiry-page` 16/16,
`licence-centre-retention.spec.ts` 7/7. Frontend `npx tsc --noEmit` CLEAN;
`npm test` **1568 pass / 1 skipped** across 120 files (the journey added
`TrackerCard.spec.tsx` 13, `TrackerJourney.spec.tsx` 12,
`TrackerHistorySheet.spec.tsx` 15, and 5 more in
`licence-tracker-api.spec.ts` / `TrackerTimeline.spec.tsx`); `npm run build` 0,
with `/licence-centre/tracking` and `/licence-centre/tracking/[id]` in
`app-path-routes-manifest.json`.

⚠️ **Nothing polls on a schedule in this build, and that is the flag, not a
bug.** The sweep is `@Cron('40 4 * * 0')` and gated on
`licence_tracker_sweep_enabled`, which ships **`false`** — so `licence_tracker%`
has **no** `Setting` rows, the runtime defaults apply, and the only enquiries
that happen are the automatic first read on add and a manual **Check now**.
Turn the flag on in `/admin` to have it start polling weekly.

**Not done, deliberately:** no SMS in v1 (in-app + push + email only); the
crowd statistics, escalation letters and outcome-capture loop in
`LICENCE-SERVICES-AND-FEED.md` §Phase 2 remain unbuilt, and that section's false
premise ("SAPS application status cannot be read programmatically") is now
corrected in place. ⚠️ **Nothing has been checked against the live SAPS host
from this worktree** — the parser is built to fixtures, and the first real call
must be watched.

## 2026-09-23 — THE WARDEN DAEMON IS WIRED (local, uncommitted)

**NOTHING DEPLOYED.** Branch `feat/takealot-ux-parity`, working tree only. The
open backend task from the panel's own handoff — "rebuilding that proxy is the
main open backend task" — is done, and the panel's `NOT WIRED` card is gone.

**The proxy is back, adapted, and no longer Desk-shaped.** The deleted
`backend/src/desk/warden.*` was restored into `backend/src/admin/` (it is an
admin surface; co-locating let it reuse `AdminModule`'s `AdminJwtGuard` and
`AdminAuditService` with no import cycle). Two Desk couplings were **dropped, not
rebuilt**: `gates()` (its source, `DeskSiteService`, is deleted) and `settings()`
plus `maskSaPhone()` (the operator removed the settings board on sight — a
decided rule must not sit behind an off switch).

- Routes: `GET|POST /admin/warden/chat`, `POST /admin/warden/proposals/:id/approve|decline`,
  `GET /admin/warden/board`, `GET /admin/warden/audit`, `POST /admin/warden/sweep|pause|resume`.
  Method is the authorisation (GET any admin, POST SUPERADMIN).
- **`GET /admin/warden/board` is new**, and it names the absence instead of
  collapsing it: `WardenBoardView` carries `present` + `absence`
  (`not_deployed` | `unreachable`), because a null board is three different
  facts and rendering any of them as "all clear" reports a board nobody read.
- `warden.boot.spec.ts` compiles the controller with `AdminJwtGuard` for real
  (the crash-loop class the news module spec documents). `warden.spec.ts` was
  restored minus the gates/settings/maskSaPhone describes; its hand-mirror now
  holds backend types against **both** `warden/src/types.ts` and the new panel
  component.
- Frontend: `components/admin/warden-thread.tsx` (exports `WARDEN_KINDS`, the
  third leg of the mirror), the daemon page at `/admin/warden/daemon` (thread +
  composer, proposal cards with an approve confirm that restates the exact
  command, board, audit trail, sweep/pause/resume behind a reason dialog), and
  `WardenDaemonCard` on the Warden tab is now a real compact card linking to it.
- ⚠️ **A RED GATE RENDERS NO BUTTONS.** It has no command and cannot be approved
  or declined; the card says so in words. `operationName === null` reads as
  "free-hand, not safe-list-bounded" (the louder warning), and `reversible` is
  never inferred.

**Proven against a real daemon on this machine.** `warden/.env` (untracked;
`warden/.gitignore` has `.env`) booted the daemon on `127.0.0.1:8787` with a
local token and **no** model key. The compiled backend `WardenService` was then
pointed at it directly: reads returned a real 30-row board (`ok:3 bad:2
unknown:25`, `dropped:0`), a 10-message thread and one red gate with
`command: null`; writes exercised `send` (the daemon answered honestly that it
has no model), `sweep` (`finished:true forced:true`), `pause` (expiry + operator
recorded) and `resume`. The daemon was then stopped. `backend/.env` was left
**unset** for `WARDEN_BASE_URL`/`WARDEN_TOKEN`, so the local panel honestly shows
`NOT DEPLOYED` and the box's own config is untouched.

**Verified:** backend `tsc` 0, `nest build` 0, jest **4900 pass** (1 pre-existing
failure, `motivations/motivation-consent-pack.spec.ts:100` — unrelated); frontend
`tsc` 0, `npm test` **1449 pass** (4 new), `npm run build` 0 with
`/admin/warden/daemon` emitted. Local-only; no commit, no deploy.

## Local dev (standing — not a dated entry)

Kept out of the dated entries so it does not age out with them, and moved here
from `docs/SESSION-LOG.md` under that file's retention rule.

- Backend `npm run start:dev` → `:3001`; frontend `npm run dev` → `:3000`.
  Healthy = `200 {"status":"ok"}` on `:3001/api/health` and `:3000/api/health`.
- Phone-reachable consent links: `cloudflared tunnel --url http://localhost:3000`
  → an ephemeral `*.trycloudflare.com`. ⚠️ ngrok's free tier injects a browser
  interstitial (`ERR_NGROK_6024`) that is blank on phones and **cannot be
  disabled** — use cloudflared. The host changes on every restart: update
  `FRONTEND_URL` + `PUBLIC_WEB_URL` in `backend/.env` and restart the backend.
- ⚠️ A tunnel to `:3000` alone is not enough. The browser calls `<host>/api`, so
  the same-origin `/api` rewrite in `frontend/next.config.mjs` and the
  `frontend/middleware.ts` entry must both be on. Gated by
  `LOCAL_API_PROXY=true`, with `NEXT_PUBLIC_API_URL=/api` in
  `frontend/.env.local`.
- ⚠️ Sign-in renders blank on a tunnel host until `allowedDevOrigins` covers it —
  the form is a client component under `Suspense fallback={null}` and Next dev
  blocks the client runtime for an unknown origin.
- The Google Maps key is referrer-restricted to the legacy domain + `localhost`,
  so it fails on tunnel hosts. Console fix, not code. Fail-soft.
- ⚠️ Stale `nest --watch` processes pile up and can serve an old `dist/`. Kill
  every backend node process and confirm the PID changed. `node dist/src/main`
  serves compiled code — prefer `start:dev`.
- ⚠️ PowerShell strips single quotes in `node -e '...'`; use a here-string.
- Local DB only, never production: `Setting motivation_writer_enabled=true`
  (`false` 404s every motivation route).

## 2026-09-22 (cont. 2) — KYC IMAGES COME FROM DIDIT; FULL MEMBER PROFILE; PRIVACY CORRECTED

**NOTHING DEPLOYED.** Same session, same branch, working tree only.

### The privacy policy now describes what we actually do
Four places claimed we store the identity document image and the selfie on our own
servers for the life of the account. We do not, and with this change we will not:
the images are captured and held by **Didit**, and an admin views them from
Didit on demand. Corrected in `frontend/app/(legal)/privacy/page.tsx` (§3.2, §8,
§9), plus the liveness video is now named. Two further corrections found while
editing: **Didit's country was wrong** — their own docs state EU-by-default
processing on AWS, so `Israel` became `European Union` in the provider table and
§8; and **stale identity-provider disclosures were removed** — the provider table still
listed the retired provider as a recipient, §8 still named it, and §3.1/§3.6 still said
email was "verified via" it and session data was "handled by" it. It was
removed from the codebase on 2026-09-10.

### Reveal ID / selfie now pulls from Didit (view-only, nothing stored)
`DiditService.fetchSessionImage(sessionId, 'id_front' | 'selfie')` re-requests the
decision — which mints **fresh 4-hour presigned links** — and streams the bytes
back. `AdminService.readKycFile` tries any stored key first (worthless now: no
row has one) and then walks the member's `DiditVerification` rows newest-first.
Field choice is load-bearing and unit-tested: the **selfie is
`liveness_checks[].reference_image`** (the live capture), NOT
`id_verifications[].portrait_image` (the face cropped off the card); the ID is
`full_front_image` with `front_image` as fallback. Every failure is named —
`gone` (retention passed), `forbidden` (wrong environment), `no_image`,
`unreachable`, `not_an_image` — because "the button did nothing" was the
original complaint.

**⚠️ THE LOCAL BOX CANNOT EXERCISE THIS.** It holds a **sandbox** Didit key and
the only stored session is **live**, so the reveal correctly answers "this
deployment cannot read that verification session". That message is the feature,
not a bug; the real image needs the live key on the box.

### Full member profile at `/admin/people/[id]`
Leads with a **verified / not-verified checklist** (email, phone, profile
complete, identity, bank, selling ban, standing), then identity-verification
detail, contact/address, banking, consent, comms prefs, selling standing,
activity counts, enforcement, and the admin audit trail. The People drawer gained
an "Open full profile" link and now shares one `components/admin/user-actions.tsx`
with the page — the ban/close/erase/strike/KYC-review flows and their exact
confirmation wording live in ONE place so the two surfaces cannot drift.

**⚠️ THE ID NUMBER IS NOT A DOSSIER FIELD, AND SHOULD NOT BECOME ONE.** The
dossier selects `idNumberEncrypted` only to derive `hasIdNumber` and strips it
before responding; the number itself comes from `GET
/admin/users/:id/id-number`, which decrypts with `decryptSaIdNumber()` and
**writes an `AdminAuditEvent` on every reveal**. The audit is the point: it is the
most sensitive field we hold outside the documents, and the log answers "who
looked at whose ID". A key rotation makes the value undecryptable and that is
reported as such — never as "no ID number", which is a different and actionable
wrong conclusion.

**⚠️ THE BACKEND ON THIS BOX RUNS COMPILED `dist/`, NOT `--watch`.** Source
changes are invisible to the running API until `npm run build` + restart. Half an
hour was spent staring at a profile that showed "email not verified" for a user
whose row says otherwise — the new select simply was not deployed yet.

## 2026-09-22 (cont.) — THE WARDEN ADMIN PANEL (the new `/admin`)

**NOTHING DEPLOYED.** Same session, same branch, working tree only.

The Desk's replacement is built as a from-scratch dark neon PWA. Design mockup
and spec live at `docs/design/admin-pwa/` (+ a live copy at
`frontend/public/admin-mockup.html`); the real panel is under `frontend/app/admin/`.

**What exists now**

- `/admin` → redirects to `/admin/warden`; `/admin/login` is outside the gate.
- Five tabs: **Warden** (`/admin/warden`), **Money** (`/admin/money`),
  **People** (`/admin/people`), **Operate** (`/admin/operate`),
  **Insights** (`/admin/insights`).
- It is its **own installable PWA**: `app/admin/manifest.webmanifest/route.ts`
  with id/start_url `/admin/warden` and scope `/admin/`, so "Add to Home Screen"
  installs Warden rather than the shop.
- Theme is scoped to `.admin-os` in `app/admin/admin.css`; nothing touches
  `:root`, and `html:has(.admin-os)` repaints the canvas so the white shop
  ground never shows through. The global box-shadow kill switch still applies —
  every glow class restates `box-shadow !important` on a class to outrank `*`.
- Session gate is a component that runs (`components/admin/admin-session.tsx`),
  not an exported helper; `AdminJwtGuard` reads a Bearer token, so
  `lib/admin-api.ts` owns the token store and a single-flight refresh.
- Writes are gated on role (SUPERADMIN only) and go through
  `ReasonDialog`/`ConfirmDialog`; danger flags require 15+ characters, mirroring
  the backend.
- Polling only (no websockets): attention queue 15s, pulse/alerts/services/queues
  30s, crons/activity 60s, analytics 60–120s, settings 120s.

**The Warden card is honest about what is not wired.** `WardenDaemonCard` probes
`/admin/warden/board` once and says "NOT WIRED" when it 404s — because the
standalone `warden/` daemon's **backend proxy is still not rebuilt** (it was
deleted with the Desk). Rebuilding that proxy is the main open backend task;
until then the daemon's proposals and red gates cannot appear in the panel.

**🚨 NEVER PUT A `z-index` ON `.adm-col`, AND THE AMBIENT GRID IS A BACKGROUND
FOR THAT REASON.** The operator reported drawer buttons "obstructed by the
navbar". Cause: the ambient mesh was a `position: fixed` `::before` at
`z-index: 0`, which forced `.adm-col` into a stacking context (`z-index: 1`) to
sit above it. The bottom tab bar is a **sibling** of `.adm-col` at `z-index:
200`, so it painted over that whole subtree — including drawers and dialogs
whose own `z-index: 500` was trapped inside it. Measured with
`elementFromPoint`: the tab bar won the overlap and **"Clear strikes" and
"Erase data" were underneath it** — visible, untappable. Fixed by painting the
mesh as `.admin-os`'s own `background-image` (`background-attachment: fixed`)
and deleting both the pseudo-element and the wrapper's z-index. Any future
decorative layer must go on the wrapper's background, not on a child element.

**⚠️ DRAWERS MOUNT ONLY WHILE OPEN, AND THEIR BASE STATE IS VISIBLE.** The
operator found "windows generated off screen" on the People board. Two causes,
both fixed: (1) Money and Operate kept their drawers mounted permanently and
parked below the viewport for the exit animation — now they render nothing when
closed, and the entrance is a CSS keyframe with `fill-mode: backwards` so the
base state stays on-screen even if the animation never runs; (2) the drag
handle was a 5px sliver, so grabbing the sheet did nothing — the whole header
now drags (`.adm-grab`, `touch-action: none`, `user-select: none`), and People
and Money were moved onto the shared `AdminDrawer` so all three boards have the
same drag, Escape and focus-trap behaviour. **Never restore a resting
`transform: translateY(100%)`** — that is the off-screen window.

**⚠️ A FAILED ACTION MUST SAY SO.** "Reveal ID" did nothing when tapped: the
KYC route answers 404 "No stored file for this user. It may still be on the old
CDN" and the handler swallowed it. `adminFetchBlob` now parses the backend's
message, and the reveal buttons have a busy state plus an inline reason. Any
new admin fetch must follow the same rule — a silent catch reads to the
operator as a broken button.

**⚠️ NO SETTINGS TABLE IN THE PANEL, AND DO NOT RE-ADD ONE.** Insights first
shipped the runtime flag registry as an on/off board. The operator removed it on
sight (2026-09-22): those flags are rules the codebase has already decided — the
community feed's moderation posture, the motivation writer's gate, the licence
vault's master switch — and a decided rule must not sit behind an off switch in
an operator screen, because the toggle implies the decision is still open and a
mis-tap can silently stop a statutory workflow. `PATCH /admin/settings/:key` and
the registry still exist for deliberate deploy-time changes; the UI does not
surface them. Insights is analytics only: KPIs, sales velocity, sales by
category, top makes/models. The Warden's "services below alarm" row therefore
went from a link to a plain count — there is no longer a board to land on.

**Verified:** frontend `tsc --noEmit` exit 0; `npm test` 110 files / 1445 pass;
`npm run build` exit 0 with all six admin routes emitted
(`warden|money|people|operate|insights|login`). Login was exercised against the
running backend and returned the backend's own credential error, so the auth
wiring is proven end-to-end; the gated boards have **not** been eyeballed yet
because the local admin password is not the seed default. Sign in at
`http://localhost:3000/admin/login` to review them.

## 2026-09-22 — THE DESK IS OUT; FOUR PILLARS ONLY (local, uncommitted)

**NOTHING DEPLOYED.** Branch `feat/takealot-ux-parity`, working tree only.

Goal: leave only Marketplace, Auctions, The Armory and Community. The route and
surface audit found almost nothing else removable — the help, legal,
condition-guide, witness and `/t/[code]` shortlink routes are all live/linked,
and the operator said leave the footer intact — so the real removal is the Desk:

- Backend: `src/desk/` (incl. `warden.*`, `desk-payouts`, `desk-whatsapp`) and
  its `app.module.ts` entries deleted. `src/ballistics/` deleted (orphaned; no
  caller). `ask-gg` trimmed to `POST /ask-gg/identify-listing` only — the admin
  KB + page-guide editors went with the Desk.
- Frontend: all of `app/admin/**`, `components/desk/**`, `lib/desk-*.ts` (+
  specs), `scripts/desk-guard.cjs`, `desk-cutover.cjs`, `make-desk-icons.py`,
  the four `public/icon-desk-*.png`, and the `desk:guard`/`desk:cutover`
  scripts removed. The `build` script no longer runs the desk gates.
- `app/sw.ts` decoupled from `lib/desk-offline.ts`: the shop's fallback rule
  moved to the new `lib/sw-offline.ts` (+ spec). The `/admin` NetworkOnly route
  and the `/admin` fallback carve-out are kept as insurance for the rebuild.

**⚠️ SELLER PAYOUTS ARE PAUSED BY DESIGN.** The Desk was the only trigger for
`ManualPaymentsService.getPayoutsDue()` → `OzowService.createPayout()`; the old
FNB batch cron was already gone (`tasks.service.ts`). The operator chose to
pause payouts until the rebuilt Desk exists. The connectors themselves stay:
`ManualPaymentsModule`, `OzowService`, Bob Go, Zoho.

**Prisma orphans kept deliberately** (no migration): `Deal`, `DealPurchaseOrder`,
`Message`, `Competition`, and the ask-gg conversation/message/KbEntry/
GuideOverride tables. Nothing writes them.

**Verified:** backend `tsc --noEmit` exit 0; frontend `typecheck` exit 0 after
clearing a stale `.next/types`; frontend suite 110 files / 1445 pass; frontend
production build exit 0 with **no `/admin` routes emitted**; backend jest 4831
pass with **one pre-existing failure** in
`motivations/motivation-consent-pack.spec.ts:100` (untouched area).

## 2026-09-15 — VAULT DELETION LEAVES NO CRUMBS; A PACK REVIEW FOUND SEVEN MORE

**NOTHING DEPLOYED. The box is untouched.** Branch `feat/takealot-ux-parity`,
and the whole of this session's work is **uncommitted** in the working tree.
`git status` is large — 27 tracked files modified, `CLAUDE.md` deleted and
replaced by `AGENTS.md`, plus untracked `docs/project-reference.md`,
`docs/SESSION-LOG.md`, four `MOTIVATION-*.md` review documents and
`backend/prisma/migrations/20260915000000_backfill_good_standing_covers/`.
Read the diff before committing anything.

### What this session fixed — deleting from the vault now cleans the drafts

The operator deleted a MARLIN .45-70 from the vault to re-add it as a test
licence, then found the firearm still printed in the generated pack
(`MO000001.pdf`) as though they still owned it. **The cause was not a stale
cache.** Generation reads the saved answers, and the vault only ever ADDED to
them:

- `MotivationGenerationService.topUpOwnedFirearms()` is add-only — it fills
  `existing_firearm_N_*` from surviving credentials and **returns early when the
  vault is empty**, so it never removes a row whose source is gone.
- `LicenceCentreService.remove()` deliberately preserved the motivation copies
  (`sourceRemovedAt`, `onDelete: SetNull`), and nothing cleared the copied
  answers.
- The renderer reads `existing_firearm_N_*` out of the answers blob, not the
  vault.

**The fix, and the boundary the operator chose:** "leave submitted packs
unchanged." `MotivationDocumentsService.removeCredentialFromEditableDrafts()`
now runs inside `LicenceCentreService.remove()` **before** `credential.delete`
(after it, the pointer is null and indistinguishable from a copy that never
came from the vault), and for `DRAFT` / `INTERVIEW` / `NEEDS_MORE_INFO` only:

- deletes the motivation upload copies whose `sourceCredentialId` matches —
  bytes first, fail-soft — and purges the content-addressed read cache for each;
- deletes only answers whose provenance is `VAULT` **and** whose `sourceId`
  equals the deleted credential. A `MEMBER` value survives, as it must.

`COMPLETED` / `FAILED` / `ABANDONED` packs are never touched.

**Verified:** `npm run build` exit 0, and 41 targeted tests green
(`motivation-vault-delete-cleanup.spec.ts` new; the three licence-centre specs
whose `motivations` doubles gained the method).

⚠️ **MO000001.pdf still contains the MARLIN, and that is correct.** It was
already generated; the fix governs future deletion and regeneration. To clear
the existing draft, remove the MARLIN answers/attachment and regenerate.

### The pack review — seven defects, none fixed yet

A page-by-page read of `MO000001.pdf` (a section 13) produced this list. **A
plan was written but the operator has NOT approved it, so no code has moved.**
Take them together — they are one pipeline (autolink → annexure order → pdfkit
layout):

1. **Contents page is incomplete** — only body headings and a single
   "Annexures" line; the real annexure index sits on a later page, and a long
   list can overflow the sheet with no continuation.
2. **The Bench cartridge drawing is not the cover hero** — the cover falls back
   to the firearm photograph.
3. **The "about the cartridge" page is missing** — no history/facts article and
   no inset diagram. Gated on `hasCartridgeBlock`, which goes false when the
   hero exists but the inset raster fails.
4. **The current owner's licence prints as an extra annexure (`Annexure ?`)** —
   `SELLER_LICENCE` is unlettered in `ANNEXURE_ORDER`, but `annexureImages()`
   still walks every upload. The consent form already carries front and back.
5. **The rifle proficiency is missing** — only Unit Standard 117705 (Knowledge
   of the Firearms Control Act) attached. `pickProficiencyPair` treats a linked
   certificate + its statement of results as two competing candidates and skips
   both.
6. **Safe photos spill across pages** — they must be one page, 2×2, max four.
7. **Proficiency print order** — the statement of results must sit directly
   behind the certificate it belongs to, with 117705 after it. Uploads print in
   `createdAt` order today.

⚠️ **Two traps for whoever takes this up.** Skipping `SELLER_LICENCE` in
lettering only still reprints it — the filter has to be in `annexureImages()`.
And the certificate + statement-of-results pair must be folded into ONE
candidate **before** the `several-candidates` check, or the rifle pages stay
dropped.

### Also in the working tree this session (not deployed)

- The dedicated sport-shooter / hunter certificate now qualifies as a letter of
  good standing on its **`expiresOn` alone** — no issue date required — with a
  backfill migration for editable drafts.
- Standard documents auto-attach when an application opens: `SAFE_PHOTOGRAPHS`
  moved into `AUTOLINK_KINDS`, the consent gate is `mayOfferAcross` (reuse
  default-on, stops only on decline/withdraw), and the settled-date filter is
  gone. A document uploaded straight to an application inherits the roles its
  identical Document Centre row fills, matched by `sha256`.
- Licence-card OCR moved onto `LlmService`.
- Inline vault consent on the licence-centre page, and `vault-consent` finally
  wired into the Document Centre.
- `document-shelf.tsx` keeps the scan/upload tiles outside the scroll area.

### Still outstanding (unchanged from the last entry)

1. The `pruneJournal` sudoers line (`warden/README.md`).
2. `npm run sweep` on the box; read every row.
3. Delete `backend/.env.bak.didit` and `.env.bak.totp` once settled.
4. Rotate the dead AWS keys rather than merely deleting them.
5. Read-only Postgres role, Tailscale, an external uptime monitor on the apex.
6. Confirm Places API is enabled/authorised on the Google Maps browser key
   (Cloud Console → Credentials → API restrictions).
7. Watch `motivation-pdf.service.spec.ts`'s cover-table test for recurring
   timeouts under full-suite load — bump its timeout if it keeps happening
   rather than re-diagnosing from scratch each time.

---

## 2026-09-13 — SEVENTH DEPLOY: WhatsApp as a third notification channel

Full deploy (`e885a500`), exit 0, both health checks, site 200 twice, three
pm2 services online. Branch `feat/whatsapp-channel` merged into
`feat/takealot-ux-parity`.

**It ships INERT.** `whatsapp_enabled` is still **false**, so every send
writes a `STUB` row and nothing reaches a member. The five `WHATSAPP_*`
credentials ARE now set on the box (permanent System User token, not the
24-hour one).

**What shipped.** A Meta Cloud API provider behind the WhatsApp scaffolding
that had existed since August with nothing driving it. `backend/src/whatsapp/`
mirrors `SmsService` (stub mode, retry with backoff, `WHATSAPP_OUTAGE`
alert). Buyer and seller order updates, shipping updates, and a welcome
nudge, each with a URL button opening the PWA on the screen needing
attention. 16 templates in a server-side registry. The three
`/admin/desk/whatsapp` endpoints the Desk drawer had been calling into
nothing for weeks, plus the `whatsapp_reply` card. A post-sign-up
channel-preferences sheet writing an append-only `NotificationConsent` trail.

**The seam.** `sendSms` gained one optional `whatsapp` option and one branch:
WhatsApp replaces the SMS when the member is reachable on it, and falls back
to SMS on any miss. `tryWhatsapp` fails closed at every step. `critical`
still bypasses the SMS mute but deliberately does NOT bypass
`notifyWhatsappEnabled` — an internal mute and a Meta-facing consent record
are different things.

⚠️ **A WhatsApp message may never name the listed item — only the order
reference.** Enforced structurally, not by discipline: the registry is the
only place variables are declared, `sendTemplate` refuses a missing or blank
one before anything leaves, and a spec fails if any var is ever named
title/item/name.

⚠️ **The welcome fires from `verifyPhoneChange`, NOT from `verifyEmail`.**
The obvious home is the once-per-account email verification, and it is wrong:
nobody has a verified phone at that instant, so it would no-op on every
account forever with nothing failing. `phone-otp.spec.ts` pins the placement.

**Verified on the box:** migration applied (4 tables), webhook GET handshake
echoes the challenge with the right verify token and 403s with a wrong one,
and both are reachable through Cloudflare — a POST with no signature returns
**200** with the handler skipped, per the same convention Peach and Didit use.

**What the next session must know — this is NOT finished.** Three external
gates remain, all operator-side in Meta:
1. **Templates are not submitted yet.** Bodies and button config are in the
   plan; start with `order_confirmed_buyer` and `shipment_dispatched_buyer`.
2. **The app is UNPUBLISHED.** Until it is published, no production webhooks
   are delivered and outbound sends only reach numbers added as test
   recipients in App Dashboard > WhatsApp > API Setup.
3. **The webhook is not registered in Meta yet** — the endpoint is live and
   proven, but the callback URL still has to be saved at App > WhatsApp >
   Configuration (`https://alloutdoor.co.za/api/whatsapp/webhook`).

Only flip `whatsapp_enabled` once the first templates are approved, and
expand one approved template at a time.

**Still open, an operator decision:** `shippingFailed` reaches buyers by
**email only** — it has no SMS call today, so the seam had nothing to hook.
The `shipment_failed_buyer` template exists and is unused. Wiring it means
WhatsApp with no SMS fallback.

**Meta guidance corrected mid-session:** do NOT volunteer the regulated
categories during Business Verification. Answer what is asked, truthfully,
and nothing more. The auth wall is content-neutral architecture, not
cloaking — and it only stays defensible while it never branches on
user-agent.

## 2026-09-13 — SIXTH DEPLOY: Delete option on the bulk document review screen

Frontend-only deploy (`593f3889`), exit 0, both health checks, site 200 twice.
Backend and warden untouched (~39h uptime). Pre-deploy backup:
`alloutdoor-20260913-141201.dump`.

**What shipped.** `components/document-centre/review-screen.tsx` — each row
in the "check what we made of your documents" screen (reached after
uploading or scanning several documents at once into the Document Centre) now
offers **Delete**, next to "Not sure". Before this, dropping a
wrongly-captured page or a duplicate meant filing it anyway and finding it
again in the main vault to remove it. Same confirm wording and the same
`licenceCentreApi.remove()` call as the main vault's own Delete
(`credential-card.tsx`), so it reads as one gesture wherever it is offered.
A batch that ends in deletions rather than confirmations now says "All N
deleted / Nothing was kept" instead of the misleading "All 0 filed".

**Verification:** tsc clean both sides; backend 4,759 passed, frontend 1,901
passed (both 0 failed); `npm run build` exit 0 foreground. Browser-verified
end to end against the local backend and Postgres — not just the diff: signed
in as a local test member (`lictest1@example.com`, a minted JWT against the
local `JWT_MEMBER_SECRET`), uploaded two files at once, confirmed the
confirm-dialog wording and that cancelling it fires no API call, then
confirmed and watched the DELETE reach the real backend (200) and the rows
actually leave the database.

### Still outstanding (unchanged from the last entry)

1. The `pruneJournal` sudoers line (`warden/README.md`).
2. `npm run sweep` on the box; read every row.
3. Delete `backend/.env.bak.didit` and `.env.bak.totp` once settled.
4. Rotate the dead AWS keys rather than merely deleting them.
5. Read-only Postgres role, Tailscale, an external uptime monitor on the apex.
6. Confirm Places API is enabled/authorised on the Google Maps browser key
   (Cloud Console → Credentials → API restrictions).
7. Watch `motivation-pdf.service.spec.ts`'s cover-table test for recurring
   timeouts under full-suite load — bump its timeout if it keeps happening
   rather than re-diagnosing from scratch each time.

---

## 2026-09-13 — FIFTH DEPLOY: Armory, a third landing tile for the three member tools

Frontend-only deploy (`43af3c6e`), exit 0, both health checks, site 200 twice.
Backend and warden untouched (38h uptime). Pre-deploy backup:
`alloutdoor-20260913-131302.dump`.

**What shipped.** Motivations, the Document Centre and The Bench had no entry
point on the landing page at all — only the account menu, plus a promoted
hero and two flanking cards on `/account`. They now sit as **Armory**, a
third tile beside Buy Now and Auctions, which expands in place to reveal the
three as sub-tiles. Renamed with it: **Motivations / Paper Work Vault /
Reloading Tool**.

The renames are in `ACCOUNT_GROUPS` (`lib/account-menu-data.tsx`), the single
source of truth, so the nav dropdown, mobile drawer, PWA More sheet and
`/account` all moved together. `findAccountItem` moved there too and is now
exported — the Armory panel reads label, icon and href off that one list
rather than growing a second hardcoded copy. `lib/shell-routes.ts` push
titles follow (`Paper Work Vault`, `Reloading Tool`, `Motivations`); the
in-page `<h1>`s were deliberately left alone.

`/account` lost its three-tier structure with this: the gold Motivation hero,
both `ServiceCard`s, `TILE_GROUPS`, `PROMOTED_HREFS` and a stale retired-tool
comment are gone, and the page is now one flat tier of grouped cards.

**Things worth knowing if you touch this again:**

- ⚠️ **The tile is gated on `serverAuth()` in `app/page.tsx`, and that is not
  cosmetic.** These are members-only surfaces; advertising them to an
  anonymous visitor is the auth-wall leak the public/members split exists to
  prevent. Signed-out gets the unchanged two-up row with **no third column at
  any width**. Verified against production HTML after deploy: zero occurrences
  of Armory / Paper Work Vault / Reloading Tool / Motivations signed out.
- The row went **flex → grid** (`grid-cols-2 sm:grid-cols-3`). Three tiles
  across a 390px phone is ~118px each, and the tile's internal layout has
  already produced one bug at ~180px, so Armory takes `col-span-2` on mobile
  and joins the row at `sm`.
- The tile interior is now a shared `TileBody`. All six tiles render the same
  markup — that is what keeps "all looking the same" true without four copies
  to maintain.
- ⚠️ **The disclosure draws its chevron at EVERY width**, unlike the link
  tiles which keep `hidden sm:block`. Armory does not navigate, so the caret
  is the only thing on a phone saying it expands; hiding it left the primary
  audience with what looked like a dead link.
- Every blurb is short because the blurb span is `truncate`. They were
  measured (`scrollWidth > clientWidth`) at 375px and 1280px, not guessed —
  the first Armory line ellipsised even full-width and was cut down.

**Verification:** tsc clean both sides; backend 4,759 passed; frontend 1,901
passed; `npm run build` exit 0 foreground. Browser-checked signed-out and
signed-in at 375px and 1280px — panel opens, `aria-expanded` flips, the three
hrefs are right, six tiles measure 396px each at 1280px, no horizontal
overflow at either width.

⚠️ **`/account` was NOT browser-verified.** Rendering it needs a real backend
session and the check was done with a locally-minted dev JWT, which `/account`
correctly refuses. That page's change rests on the diff, tsc and the build —
worth an eyeball next time someone is signed in on production.

### Still outstanding (unchanged from the last entry)

1. The `pruneJournal` sudoers line (`warden/README.md`).
2. `npm run sweep` on the box; read every row.
3. Delete `backend/.env.bak.didit` and `.env.bak.totp` once settled.
4. Rotate the dead AWS keys rather than merely deleting them.
5. Read-only Postgres role, Tailscale, an external uptime monitor on the apex.
6. Confirm Places API is enabled/authorised on the Google Maps browser key
   (Cloud Console → Credentials → API restrictions).
7. Watch `motivation-pdf.service.spec.ts`'s cover-table test for recurring
   timeouts under full-suite load — bump its timeout if it keeps happening
   rather than re-diagnosing from scratch each time.

---

## 2026-09-13 — FOURTH DEPLOY: profile-nudge dismiss fix; stray category deactivated

Frontend-only deploy (`e7cba87f`), exit 0, both health checks, site 200 twice.
Backend and warden untouched (36h uptime). Pre-deploy backup:
`alloutdoor-20260913-105850.dump`.

**What shipped:** `profile-complete-nudge.tsx` — `goComplete()` (the "Get
fully verified here" button) called the same `markDismissedThisSession()`
that closing with ✕ does, so a member who clicked through without finishing
their profile never saw the reminder again for the rest of the browser
session — read by the operator as "it's gone," not as a nag correctly
standing down. Only ✕ should suppress it; `/profile/edit` already hides it
via `EXCLUDED_PREFIXES` while they're there. Found by the operator hitting it
live on their own (now-VERIFIED, 75%-complete) production account.

⚠️ **Test-gate note:** `motivations/motivation-pdf.service.spec.ts`'s
`"⚠️ LEAVES THE PARTICULARS TABLE ON THE COVER, on every layout"` test timed
out (>5000ms) on the first `npm test` run of this session, unrelated to
anything in this diff. Isolated re-run passed in 2.9s; a second full-suite
run passed clean (4,759/4,759). Treated as a flaky timeout under load, not a
regression — worth a second look if it recurs, since the timeout budget is
tight for a PDF-rendering test.

**Also this session (no deploy needed — pure data, not code):** the
"the retired on-site-services" category was still `isActive: true` in
production (never deactivated when the feature's code was removed
2026-08-26 — only the seed *source* was updated, and `prisma/seed.ts` is
unsafe to run against prod, so the live row never got the memo). Flipped
`isActive` and `isExperience` to `false` directly via a scoped SQL update
(row `cmspt3aie000i2jvnhipoybqi`, 0 listings under it, fully reversible).
Confirmed gone from `/api/categories/with-counts` for both anonymous and
member callers. The operator was shown what a real build-out would require
(deposit-only payment model, a legal opinion,
an unenforced 5-part legal attestation gate, an unused outfitter-vetting
pipeline) and chose not to build any of it right now.

### Still outstanding (unchanged from the last entry)

1. The `pruneJournal` sudoers line (`warden/README.md`).
2. `npm run sweep` on the box; read every row.
3. Delete `backend/.env.bak.didit` and `.env.bak.totp` once settled.
4. Rotate the dead AWS keys rather than merely deleting them.
5. Read-only Postgres role, Tailscale, an external uptime monitor on the apex.
6. Confirm Places API is enabled/authorised on the Google Maps browser key
   (Cloud Console → Credentials → API restrictions).
7. Watch `motivation-pdf.service.spec.ts`'s cover-table test for recurring
   timeouts under full-suite load (see above) — bump its timeout if it keeps
   happening rather than re-diagnosing from scratch each time.

---

## 2026-09-12 — THIRD DEPLOY: address-autocomplete fallback, profile nudge

Frontend-only deploy (`793e37cc`), exit 0, both health checks, site 200 twice.
Backend and warden untouched (10h uptime, unaffected). Pre-deploy backup:
`alloutdoor-20260912-082810.dump`.

**What shipped:**
- `address-autocomplete.tsx` — the operator reported typed address autofill
  doing nothing on `/profile/edit` while "use my current location" kept
  working. Diagnosis: two different Google APIs on one key — Places
  (autocomplete) vs Geocoding (current-location). When Places API isn't
  enabled/authorised for the project, the console prints
  `ApiNotActivatedMapError`, which wasn't in `patchConsoleErrorOnce`'s match
  list, so the widget never fell back to "fill in manually" — it just looked
  silently broken. Added the missing match.
  ⚠️ **This is a diagnostic/UX fix, not a confirmed root-cause fix.** The
  actual cause is almost certainly a Google Cloud Console setting (Places API
  not checked in the browser key's API restrictions) that only the operator
  can verify/flip — no Console access from here. If autofill is still silent
  after this deploy, that setting is where to look next.
- `profile-complete-nudge.tsx` (new) — a persistent bottom-left reminder
  bubble ("Profile X% complete → Get fully verified here", `/profile/edit`),
  mounted in `layout.tsx` alongside `ProfileSetupPrompt`. Unlike that one-time
  welcome dialog (14-day signup window, once-per-session-ever), this has no
  age limit and reappears every new browser session for as long as the
  profile is incomplete — sessionStorage dismiss, not localStorage. Verified
  live in local dev (fresh signup → appears → dismiss → survives reload
  hidden → reappears in a new tab).

### Still outstanding (unchanged from the last entry)

1. The `pruneJournal` sudoers line (`warden/README.md`).
2. `npm run sweep` on the box; read every row.
3. Delete `backend/.env.bak.didit` and `.env.bak.totp` once settled.
4. Rotate the dead AWS keys rather than merely deleting them.
5. Read-only Postgres role, Tailscale, an external uptime monitor on the apex.
6. Confirm Places API is enabled/authorised on the Google Maps browser key
   (Cloud Console → Credentials → API restrictions) — see above.

---

## 2026-09-11 — SECOND DEPLOY, TOTP ENFORCED, CLOUDFLARE OPEN

### The phone code could never be entered (shipped fix, `f5cd0a26`)

Frontend-only deploy, exit 0, both health checks, site 200. Backend untouched.

`users.service.ts` mints a **six**-digit phone code; `/profile/edit` asked for
**four** — label, `maxLength`, the `slice` in onChange and the Verify button's
enable test. Because maxLength and the slice TRUNCATE, a member typing the six
digits they were sent held the first four, `otp.length !== 4` went false, and
**Verify enabled itself on the truncated value** — submitting a code that could
not match and consuming an attempt. No phone number could be verified from
that screen, ever, and nothing told the member why.

⚠️ **The operator found this by using the product. Nothing in the suite could
have.** vitest collects `lib/**/*.spec.ts` and `components/**/*.spec.tsx` —
**nothing under app/** — and this screen is app/. The new
`frontend/lib/phone-otp-length.spec.ts` reads BOTH sources and pins the page to
the backend constant rather than to the literal 6, because the bug was two
files disagreeing. Proved red by restoring `maxLength={4}`.
**Worth a sweep: any other app/ screen carrying a magic number that belongs to
the backend is unguarded the same way.**

### TOTP is now required

`gerhard.fourie@alloutdoor.co.za` enrolled and confirmed at 19:18. Verified in
the database BEFORE flipping the flag — `totpSecret` live, `totpConfirmedAt`
stamped, nothing left pending. Then `ADMIN_TOTP_REQUIRED=true` appended to
`backend/.env` (backup at `.env.bak.totp`) and
`pm2 reload alloutdoor-backend --update-env`. Healthy, 200 twice.

⚠️ **`/proc/<pid>/environ` does NOT show the flag, and that is not a fault.**
The app loads `.env` through dotenv at boot rather than inheriting from pm2 —
`DIDIT_MODE` is absent from environ too, and the boot hard-throws without it.
Do not "fix" a missing var by adding it to the pm2 ecosystem file on the
strength of that check.

🚨 **`admin@alloutdoor.co.za` is a second SUPERADMIN, seeded 2026-08-12, signed
in ONCE that day and never since, no second factor.** Since the flag went on it
can only hold a read-only session until it enrols, so it is not an open door —
but it is a dormant full-admin credential nobody rotates, on the account tier
that can approve a command against the box. **Deactivating it was offered and
not yet answered.** `prisma/seed.ts` re-introduces a seed admin, which is one
more reason never to run it against production.

### Cloudflare — the Didit webhook is through

A WAF **custom rule** (not an IP Access rule), scoped to
`ip.src eq 18.203.201.92 and http.host eq "alloutdoor.co.za" and
starts_with(http.request.uri.path, "/api/webhooks/didit")`, action Skip.

⚠️ **This is only sufficient because Bot Fight Mode is OFF, and that is load
bearing.** Bot Fight Mode runs outside the Ruleset Engine, so Skip and Allow
have no effect on it — turning it on would silently re-break webhook delivery
with **nothing in any application log**, since the request dies at the edge.
If it is ever switched on, an **IP Access rule** must be added as well: that is
the one mechanism Bot Fight Mode respects.

### Still outstanding

1. The `pruneJournal` sudoers line (`warden/README.md`).
2. `npm run sweep` on the box; read every row.
3. Delete `backend/.env.bak.didit` and `.env.bak.totp` once settled — they
   hold live secrets, sit inside the app dir, and are **not** covered by the
   uploads backup.
4. Rotate the dead AWS keys rather than merely deleting them.
5. Read-only Postgres role, Tailscale, an external uptime monitor on the apex.

---

## 2026-09-11 — DEPLOYED. The Desk rebuild and self-hosted member auth are live.

`deploy.sh` exited **0** at 21:03 SAST, deploying **0dbca899** — 35 commits,
the Desk rebuild plus self-hosted member auth. Both health checks passed on
each app, the public site answered 200 twice, and `pm2 list` shows three
services online: `alloutdoor-backend`, `alloutdoor-frontend`, `warden`.

**Rollback point: `alloutdoor-20260911-210151.dump`** (the pre-deploy backup
deploy.sh took). Worth keeping the name to hand — the first migration below
**drops the identity-provider column and is not reversible**, so a restore is the only way
back past it.

Four migrations applied: `20260910200000_self_hosted_auth`,
`20260911030000_local_email_phone_otp`, `20260911120000_admin_auth_hardening`,
`20260911150000_admin_totp_replay_and_session_amr`.

### What unblocked it

The box had been refusing this deploy on missing env, and both guards are
deliberate hard throws in production, so it would have been a crash-loop after
a `pm2 reload` that had already killed the old process — an outage, not a
failed deploy. Both are now set on the box:

- **`JWT_MEMBER_SECRET`** — generated ON the box (never through a chat),
  written to `backend/.env` and `frontend/.env.production`. Verified: same
  value in both (compared by hash), 62 chars, **differs from
  `JWT_ADMIN_SECRET`**, and no `NEXT_PUBLIC_` copy anywhere.
- **`DIDIT_MODE=live`** plus `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET` and
  `DIDIT_WORKFLOW_ID=b792ee05-948a-410a-8fa4-ca3d89511259`, pasted by the
  operator at a prompt on the box. The API key was **rotated first** — the
  previous one had been pasted into a chat and is burned.
  ⚠️ A backup of the pre-edit file sits at `backend/.env.bak.didit`. It
  contains the live secrets; delete it once you are confident, and note that
  it is inside the app dir, so it is **not** covered by the uploads backup.

Boot confirms both: Nest started clean, `DiditWebhookController` and the two
TOTP routes mapped, and the only ERROR lines are the known Peach "runs in MOCK
mode" pair, which is payments being deliberately inert.

⚠️ The dead `VERIFYNOW_*` keys are still in `backend/.env` (lines 32-34), as
are the retired identity-provider and AWS ones. Inert, but **AWS should be
rotated, not merely deleted.**

### Still outstanding, in this order

1. **Enrol TOTP, THEN set `ADMIN_TOTP_REQUIRED=true`** and
   `pm2 reload alloutdoor-backend --update-env`. The other order locks the
   only operator out of the only admin surface with no route left that could
   enrol them. Save the ten recovery codes off-device — shown once, never
   re-readable.
2. **Allow Didit's webhook IP `18.203.201.92` in Cloudflare's WAF.** Until
   then every verdict is dropped at the edge with **nothing in any application
   log** — sellers sit at pending and no error explains it anywhere.
3. **Second sudoers line for `pruneJournal`**, next to the nginx one; both are
   written out in `warden/README.md`. `sudo -n` fails closed, so a missing
   line is a refusal, not a hang.
4. `npm run sweep` on the box and read **every** row, so a local permission
   gap can be told from a real one.
5. Read-only Postgres role for the agent query path; Tailscale; an **external**
   uptime monitor on the apex.

---

## 2026-09-11 — READY TO DEPLOY, BUT THE BOX IS NOT

`feat/takealot-ux-parity` is fast-forwarded to `cd18d459` — the Desk rebuild
and the self-hosted member auth, **34 commits**. Verified on the deploy branch:
backend **4,759** tests, frontend **1,896**, warden **394**, `tsc` clean in all
three trees, both production builds exit 0, and both artefacts present
(`backend/dist/src/main.js`, `frontend/.next/BUILD_ID`).

🚨 **DO NOT RUN deploy.sh YET. THE BOX WOULD CRASH-LOOP AT BOOT.** Its `.env`
is still the pre-self-hosted-auth world, and this deploy contains two guards that HARD
THROW in production. `pm2 reload` runs `instances: 1`, so it is a restart: the
old process is already gone when the new one refuses to start. That is an
outage, not a failed deploy.

### The three blockers, in order

**1. `JWT_MEMBER_SECRET` is missing — from BOTH env files.**
`backend/src/auth/member-jwt-secret.ts` throws "Refusing to start with a
missing/empty/default member secret" when `NODE_ENV=production`. The frontend
needs the SAME value: `middleware.ts` and the server components verify the
session cookie with it.
- add to `backend/.env` and `frontend/.env.production`
- ⚠️ the two files must carry the SAME value, and it MUST differ from
  `JWT_ADMIN_SECRET` — identical, and a member token verifies on an admin route
- ⚠️ NOT `NEXT_PUBLIC_`. That prefix inlines the signing secret into the
  browser bundle.

**2. The `DIDIT_*` set is missing.** `DiditService.onModuleInit()` throws
unless `DIDIT_MODE === 'live'` in production — deliberately, because its
predecessor defaulted to sandbox and a production box once ran passing every
identity on canned data.
- `DIDIT_MODE=live`, `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`,
  `DIDIT_WEBHOOK_SECRET` (and `DIDIT_BASE_URL` if not defaulted)
- the workflow to use is `b792ee05-948a-410a-8fa4-ca3d89511259` — see the KYC
  section of `docs/project-reference.md` for why every other one the key reaches is wrong
- 🚨 **the current Didit API key was pasted into a chat and must be ROTATED
  before it goes on the box.**
- ⚠️ Cloudflare's WAF must allow **18.203.201.92** or every webhook is dropped
  at the edge with nothing in any application log.

**3. The box's working tree is dirty** — `M backend/package-lock.json`.
`deploy.sh` runs `git pull --ff-only` and will stop with "pull failed — check
for local edits on the box". Clear it on the box first.

### What this deploy actually does

- **Full deploy, not `--frontend-only`** — `backend/` and `prisma/` both change.
- **Four migrations run**, and the box is 2 commits behind the deploy branch:
  `20260910200000_self_hosted_auth`, `20260911030000_local_email_phone_otp`,
  `20260911120000_admin_auth_hardening`,
  `20260911150000_admin_totp_replay_and_session_amr`.
  ⚠️ The first **drops the identity-provider column** and is not reversible. `deploy.sh`
  takes a pre-deploy `pg_dump` and prints the name — that is the rollback
  point, and it is worth reading the name out loud before continuing.
- The retired identity-provider, VerifyNow and AWS keys on the box become dead afterwards. They are
  inert, not harmful — but AWS should be **rotated, not merely deleted**.

### After a green deploy, in this order

1. **Enrol TOTP on the box, THEN set `ADMIN_TOTP_REQUIRED=true`** and
   `pm2 reload alloutdoor-backend --update-env`. Doing it the other way round
   locks the only operator out of the only admin surface with no route left
   that could enrol them. Save the ten recovery codes off-device — they are
   shown once and cannot be re-read.
2. Add the **second sudoers line** for `pruneJournal`, next to the nginx one.
   Both are written out in `warden/README.md`. `sudo -n` fails closed, so a
   missing line is a refusal, not a hang.
3. `pm2 list` must show **three** services, and the health checks run twice.
4. Then `npm run sweep` on the box and read every row.

⚠️ **Ask before deploying if a motivation might be mid-generation** — a reload
kills it, and the row used to strand the member. A pass is about two minutes.

---

## 2026-09-11 — DESK REBUILD: ALL TWELVE PHASES LANDED

**STILL NOT DEPLOYED. Nothing on this branch has touched the box.** Branch
`feat/desk-rebuild`, **nineteen commits** off `feat/self-hosted-auth`, nothing
pushed.

**Phases 0–9, 11 and 12 are done.** Phase 10 (Tailscale) is provisioning, not
code — it belongs to deploy day and is in the checklist below.

Verified at `a1b4dce5`: backend **4,759** tests, frontend **1,896** (136
files), warden **391**, `tsc` clean in all three trees, `desk-guard` clean,
`npm run build` **exit 0** through all four gates.

### The last three phases

**Phase 8 — four tabs.** Now / People / Health / Agent, each carrying a count
from ONE poll mounted in the desk layout (the only node under `/admin/desk`
that survives a tab press). Pulse and `lib/desk-pulse*` deleted.
⚠️ `charts.tsx` is NOT deleted — the plan's premise that Pulse was its only
consumer is wrong; `app/admin/desk-kit` renders five of its components.

**Phase 9 — the front door.** A precached static stand-in at `/admin/offline`.
⚠️ This REVERSES a deliberate decision in `app/sw.ts` ("admin pages never fall
back — they must error visibly"), and is only defensible because the stand-in
shows no figure at all.

**Phase 12 — the tool loop.** Five closed read-only tools. ⚠️ **NOT WIRED INTO
THE LIVE DIAGNOSE PATH, on purpose.** The one-shot path is byte-identical.
Wiring it is a deliberate decision for whoever takes it up — do not assume the
comments describe something an operator can see today.

### The four defects worth carrying forward

1. **A real secret leak in the tool loop.** `tail_log`'s `contains` filter
   dropped lines BEFORE redaction, which defeats every net whose pattern spans
   a newline — `/\bBearer\s+…/` matches across `\n`, so a wrapped
   Authorization header is one match in the whole text and none in either line
   alone. The token reached the prompt in clear AND reported
   `redactions: []`, which the contract says means "nothing fired". **A false
   all-clear is worse than silence.** Rule now pinned: a branch that DROPS part
   of the box's output redacts the whole of it first — truncation is not
   enough, a filter is a drop and so is a row cap.
2. **The site dot drew a green "Healthy" it could not measure**, indefinitely,
   through a total gates outage. Fixed per-arm and per-sweep. A stale COUNT on
   a badge is fine; a stale green VERDICT is not.
3. **One admin URL gated every visitor's service-worker install.** A precache
   is all-or-nothing and `/admin/offline` was the only rendered route in it.
4. **The ledger redirect dropped the two params it existed to preserve.**

⚠️ **THE FAILURE MODE OF THIS WHOLE BRANCH, WRITTEN DOWN SO THE NEXT SESSION
DOES NOT REPEAT IT:** every single pass closed its defects AND shipped a fresh
⚠️ claim wider than the code — "every env() is clamped", "the operator reads
this total", "a third sudo operation cannot ship undocumented", "every branch
redacts before it drops anything". Each was disproved by the next reviewer
within the hour. Two specs passed on the exact bug they were written for. A
guard could not see the plan shape it guarded. A source scan failed on its own
documentation because it counted the literal inside a comment.

**So the three habits this branch earned, and they are cheap:** strip comments
before any source scan; never trust a green spec you have not watched go red;
and when you write a universal, try to break it first and write the narrow rule
if you can.

### Deploy day

Two migrations, both additive and applied locally:
`20260911120000_admin_auth_hardening` and
`20260911150000_admin_totp_replay_and_session_amr`. `prisma migrate deploy`,
never `db push`.

1. **Enrol TOTP on the box BEFORE setting `ADMIN_TOTP_REQUIRED`.** Flipping it
   first locks the only operator out of the only admin surface with no route
   left that could enrol them. Save the ten recovery codes off-device — they
   are shown once and cannot be re-read. Confirm
   `backend/scripts/admin-reset-totp.mjs` runs; shell on the box is the only
   backstop, and there is deliberately no email or SMS reset.
2. **The second sudoers line** for `pruneJournal`, alongside the nginx one —
   both are in `warden/README.md`'s "Permissions the box needs". `sudo -n`
   fails closed, so a missing line is a refusal, not a hang.
3. **A read-only Postgres role** for the agent's query path, if Phase 12 is
   ever wired.
4. **Tailscale** (Phase 10) on the box and the phone; confirm the ops listener
   answers on the tailnet and NOT on the public interface.
5. **An external uptime monitor** on the apex. "The box is gone" must be told
   to you by something that is not the box.
6. Then `npm run sweep` on the box and read every row.

---

## 2026-09-11 — DESK REBUILD: PHASES 5, 6, 7 AND 11

**STILL NOT DEPLOYED. Nothing on this branch has touched the box.** Branch
`feat/desk-rebuild`, now **fifteen commits** off `feat/self-hosted-auth`.

**Phases 0–7 and 11 are done. 8, 9 and 12 are not started; 10 is deploy-day
provisioning rather than code.**

| | |
|---|---|
| `b422b839` | Phase 7 — the Now board |
| `f13ce413` | Phase 11 — six new safe-list operations |
| `89b5ccdd` | Phases 5 + 6 — Agent and Health out of the Site board |
| `e0ac23f1` | Fix: the ledger redirect dropped two params |

Verified at `e0ac23f1`: backend **4,759** tests, frontend **1,838** (134
files), warden **288**, `tsc` clean in all three trees, `desk-guard` clean,
`npm run build` **exit 0**.

### What is on screen now

`/admin/desk/site` and `/admin/desk/ledger` are 307s; six tabs, not seven
(seven bottom tabs measure 43.1px of tap width at 360px, under the 44
minimum). Verified in a browser: Agent and Health both render, and the two
redirects answer correctly.

**Agent** wires the four Warden routes nothing had ever called — the audit
trail especially, which means "what has this agent run on the box" is finally
answerable without ssh. The approval queue is the first card; the old
"Pause Warden" button posted a chat message and stopped nothing.

**Health** is 11 files, most-likely-to-need-you first, each section keeping its
own fetch and its own failure. That isolation is the feature, not tidiness.

**Now** killed the Ribbon, moved the money line above the pile, and — the part
that mattered — `drawerTargetFor()` no longer returns null for five card
types. It used to tell the operator to *"use the legacy admin panel"*, a panel
CLAUDE.md records as deleted and `desk-guard.cjs` fails the build for
reintroducing.

**Phase 11** took the safe list 6 → 12. `startProcess` is the one that
matters: `restartProcess` uses `pm2 reload`, and reload on a STOPPED app
errors rather than starting it — so *"the backend is down"*, the most likely
emergency, was not covered at all.

### Three defects worth remembering

1. **The money-grade confirm claimed the safe list for commands the safe list
   never saw.** It said "It runs inside Warden's own safe list" for EVERY
   proposal. The daemon knows better — its stored proposal holds
   `operation: {name,args}` and `reversible` — and dropped both before the
   wire. The NAME now rides the wire (never the args) and the dialog speaks in
   two voices.
2. **The ledger redirect dropped `?status` and `?page`** — the two params it
   was written to preserve — landing on an unfiltered page one that looks
   exactly like a filtered one. Found by curling the running server, not by
   reading. The route handler's own header named that exact string as "the
   failure nobody reports".
3. **A guard that could not see the shape it was guarding.** The new test
   proving every sudo operation has a documented sudoers line only inspected
   TOP-LEVEL argv plans — and a `node` plan can reach sudo from inside
   `run()`, which `clearNextCache` already does. A thirteenth operation
   flushing iptables that way passed 29/29.

⚠️ **AND A SOURCE SCAN THAT CANNOT TELL CODE FROM PROSE FAILS ON ITS OWN
DOCUMENTATION.** The header note explaining that counter quotes the literal it
counts, so the file failed for describing its own rule. Strip comments first —
the same lesson `tokens.spec.tsx` and the hatch inventory already carry.

### What is left

- **Phase 8 — four tabs.** Delete Pulse, `charts.tsx`, `lib/desk-pulse`;
  rewrite `tabs.tsx`; add `DeskStatusProvider` so one poll serves the whole
  app and the tabs can carry counts. Mostly deletion. The sixth tab is interim
  and collapses here.
- **Phase 9 — front door + PWA.** ⚠️ `app/sw.ts` DELIBERATELY carves `/admin`
  out of the offline fallback today ("admin pages never fall back — they must
  error visibly"). The plan reverses that with a precached
  `/admin/desk/offline`. That is a considered decision being changed, not a
  gap being filled — read the existing comment before touching it.
- **Phase 12 — the read-only tool loop.** Five tools, fenced results, an
  injection detector.
- **Phase 10 — Tailscale.** Provisioning, not code. Deploy day.

---

## 2026-09-11 — DESK REBUILD: PHASES 2, 3 AND 4, THE FRONTEND HALF, AND A HARDENING PASS

**STILL NOT DEPLOYED. Nothing on this branch has touched the box.** Branch
`feat/desk-rebuild`, now nine commits, off `feat/self-hosted-auth`. The
operator's instruction stands: the whole build ships in one go.

Four new commits on top of Phases 0 and 1:

| | |
|---|---|
| `9cc0b8aa` | Phase 2 — the closed `dk-` class layer |
| `bc16883c` | Phase 3 — admin sessions, TOTP, lockout, recovery codes, Tier-1 audit |
| `9afa9803` | Phase 4 — Warden observability, and the `act()` KYC bypass deleted |
| `d0eb7d43` | Hardening pass over all three, 39 files |
| `e2897f5c` | Phase 3, frontend half — the Desk wired to the new auth |

### Verified at `d0eb7d43`

backend **4,756** tests (three consecutive clean full runs), frontend **1,737**,
warden **265**, `tsc` clean in all three trees, `npm run build` **exit 0**
through all four gates. **Both migrations applied to the LOCAL database and
checked**: `AdminSession` and its four indexes, the four `totp*` columns,
`AdminSession.amr` — and both `tsvector GENERATED` columns still `ALWAYS`.

### What each phase actually changed

**Phase 2.** Nineteen `dk-` classes in `tokens.css`, and the NUMBER is
load-bearing — the admission rule is in the file header and the cap is enforced
by `desk-guard.cjs`, which runs in `npm run build`. It is checked in two
places on purpose: `tokens.spec.tsx` holds the ledger and the argument, but
vitest is in no build gate and there is no CI, so a cap living only in a spec
binds whoever remembers to run the tests. `.dk-phone-only` / `.dk-desk-only`
retire `useIsPhone` for every purely presentational branch, which is what fixes
the desktop-first-paint relayout on every cold load.

**Phase 3.** `AdminSession` with rotating refresh and a 30s grace window,
15-minute access tokens, row-level lockout that survives the `pm2 reload` which
clears the in-memory throttler, TOTP in ~40 lines of `node:crypto` (no new
dependency) pinned against the RFC 4226 and 6238 vectors, ten single-use
bcrypt-hashed recovery codes. The guard keeps its per-request `{role, isActive}`
read and now refuses a token with no `sid`.

**Phase 4.** `GET /audit` (200 persisted records had no route at all),
`POST /sweep`, real pause/resume that still MEASURES while paused, and the
`act()` bypass deleted — it wrote `kycStatus: 'VERIFIED'` straight onto the row
with no `UNDER_REVIEW` guard, no reviewer stamp, no reason, no audit row, no
seller notification, on a firearms marketplace.

### The three that were live defects, not polish

Found by a three-lens adversarial review, each reproduced before the fix and
re-broken after it to prove the fix:

1. **A two-request privilege escalation.** `enrolTotp` wrote the new secret
   straight to `totpSecret` and nulled `totpConfirmedAt`, so one POST to a
   route that is deliberately open to a read-only recovery session switched the
   account's second factor OFF — and `login` reads
   `enrolled = totpSecret && totpConfirmedAt`, so the next password-only
   sign-in came back with full write. The ten paper codes went inert at the
   same moment, because that branch is nested inside `if (enrolled)`. The new
   secret now stages in `totpPendingSecret` until a code from it verifies.
2. **A TOTP code was replayable for up to 90 seconds.** Nothing recorded that a
   code had been spent. The matched step is now spent through a guarded write
   whose affected-row count is the proof of single use.
3. **An ordinary two-tab refresh signed the operator out and logged it as
   theft.** The grace branch hands the loser back the token it presented, and
   the controller wrote that into `gg_admin_rt` — ONE cookie shared by every
   tab — clobbering the winner's fresh one. `IssuedAdminSession.rotated` now
   says whether the refresh side moved, and `setCookies` leaves the cookie
   alone when it did not.

Also: the Desk scope guard had gone blind to every `@media` block (the selector
extractor consumed the opening brace), so seven `.dk-` rules stopped being
scope-checked — an unscoped `.dk-phone-only` is a global
`display: none !important` loose on the storefront.

⚠️ **TWO SPECS PASSED ON THE BUG THEY WERE WRITTEN FOR.** One read "the next
`gap:` within 600 characters" and found the inner element's; the other compared
three spellings that were all `null` at its fixed instant. Both now mint real
values, and both were proved by reintroducing the original bug. Worth
remembering as a review habit on this branch: a green spec is not evidence
until you have watched it go red.

⚠️ **THE RECURRING DEFECT ON THIS BRANCH IS THE CONFIDENTLY WRONG ⚠️.** Every
pass shipped at least one — "every env() on the Desk is clamped", "the operator
reads this total", "the sign-in path has never called it". In a tree where the
comments are the specification, that is its own defect class. The rule applied
throughout: make the code true, or state the narrow rule and NAME the residual
gap. Do not hedge a claim until it says nothing.

### Residual gaps, stated rather than implied

- **The audit `dropped` count is honest on the wire and reaches no screen.**
  Nothing under `frontend/` fetches `GET /admin/warden/audit` — the Site
  board's audit drawer reads the `AdminAudit` table, a different trail. Whoever
  builds that panel must render `dropped` SEPARATELY from `truncated`: one is
  answered by asking for the next page, the other by ssh.
- **Login's timing equalisation is better, not complete.** `BCRYPT_COST` went
  10 → 12 and existing rows were not re-hashed, so a wrong password on an admin
  still on a cost-10 hash returns in about a quarter of the time an unknown
  email does. Closing it means re-hashing on next successful login.
- **`ADMIN_TOTP_REQUIRED` defaults OFF**, deliberately — turning it on at
  deploy locks the only operator out of the only admin surface with no route
  left that could enrol them. Order is: deploy, enrol, scan, confirm, THEN set
  the flag and `pm2 reload alloutdoor-backend --update-env`.

### The frontend half of Phase 3 (`e2897f5c`)

Phases 2–4 were backend-only by instruction, which left the Desk **broken
against its own API**, not merely dated. All three would have surfaced on
deploy day:

- The three privilege routes now require a `reason` and the Desk sent none —
  a 400 on the routes that decide who may approve a command on the box. And
  `desk-admins.spec.ts` PINNED the old shape, so the suite was green while the
  feature was dead.
- The access token went 8h → 15 min with nothing refreshing it. `authedFetch`
  now refreshes single-flight (a board fires several parallel reads; N
  concurrent refreshes race the rotation) and retries once.
- TOTP had no UI at all.

⚠️ **AND A MISTYPED SIX-DIGIT CODE SIGNED THE OPERATOR OUT.** `authedFetch`
read every 401 as a dead token, but the backend answers business refusals with
401 too (wrong TOTP code, wrong password). On the recovery path that is the
whole 2am failure: a recovery code spent to get in, a typo ejects them, a
second code to get back. A refresh that SUCCEEDS means the session is alive, so
a 401 after it is now surfaced with the server's sentence; and the routes that
judge a typed secret opt out of the retry, because replaying sends the wrong
code twice.

⚠️ **SIGNING OUT DID NOT END THE SESSION.** The sign-in page cleared
localStorage and left the 30-day httpOnly refresh cookie, and
`RequireDeskSession` refreshes before giving up — so pressing Back after
"signing out" redeemed the cookie and rendered the boards with no password.
The front door now revokes server-side.

⚠️ **SHELL-LEVEL DRAWERS DID NOT SUSPEND THE PILE'S SHORTCUTS.** The board
passes its own drawer stack; DeskShell mounts drawers it knows nothing about.
A stray "a" behind the Account drawer fired the primary action on the card
underneath. The check now asks the DOM, as the search palette always has.

### Verified in a browser — the flows, not just the tests

Everything above was also driven end-to-end against the local stack at 375px,
which is the one thing the test suite cannot do:

- sign in → **two-step sign-in once enrolled** → Desk renders in Desk tokens;
- enrolment: QR renders, secret grouped in fours, **a wrong code shows the
  server's sentence and does NOT sign you out** (the critical fix, confirmed:
  still on `/admin/desk`, token intact, drawer open);
- the ten recovery codes resist **Escape, the backdrop, and Done while
  unticked**;
- signing in with a recovery code yields a session where `GET /admin/alerts`
  answers **200** and `POST /admin/alerts/bulk-resolve` answers **403** — on a
  SUPERADMIN, so the recoveryOnly check really does run before the role check;
- both previously-17px tap targets measure **44px** at 375px;
- `scripts/admin-reset-totp.mjs` ran and reported "recovery codes deleted: 9",
  which independently proves single-use consumption — ten minted, one spent.

⚠️ **The local admin's TOTP was enrolled and then RESET during that pass.** The
local DB is back to password-only (no secret, no pending, no codes, no
sessions, lockout clear). Production was never touched.

### Deploy-day additions to the checklist in the plan

1. **TWO migrations now**, both additive, applied and verified locally:
   `20260911120000_admin_auth_hardening` and
   `20260911150000_admin_totp_replay_and_session_amr`.
   `prisma migrate deploy`, never `db push`.
2. **Enrol TOTP on the real box BEFORE flipping `ADMIN_TOTP_REQUIRED`.** Save
   the ten recovery codes off-device — they are returned exactly once and
   cannot be re-read. Confirm `backend/scripts/admin-reset-totp.mjs` runs;
   shell on the box is the only backstop and there is deliberately no email or
   SMS reset (SIM-swap fraud is endemic here).
3. `ADMIN_TOTP_REQUIRED` is in `backend/.env.example` but must be set on the
   box.

---

## 2026-09-11 — THE DESK REBUILD: PHASES 0 AND 1 LANDED

**NOT DEPLOYED, and nothing will be until the whole build ships in one go**
(operator instruction). Branch `feat/desk-rebuild`, five commits, off
`feat/self-hosted-auth` — which itself is 14 unpushed commits off
`feat/takealot-ux-parity`. Neither branch has touched the box.

The plan is at `~/.claude/plans/we-are-going-to-stateful-stallman.md`:
four surfaces (Now / People / Health / Agent), an ops agent built on Warden
that may run server operations with one approval each, TOTP 2FA with
server-side admin sessions, and PWA shell-caching that never caches data.
**Twelve phases; 0 and 1 are done, 2 through 12 are not started.**

### Done

**Phase 0 — the guard, and what hid in its blind spot.** `desk-guard.cjs` did
not police `app/admin/login`, so the sign-in screen had accumulated seven
storefront tokens and the shop's manifest and cream theme — the first screen
of the dark installed PWA on every expired session. Login and logout are now
guarded and the screen is rebuilt in Desk tokens. Two more things the blind
spot hid: `/admin/logout` was a server route that could only clear the cookie
and not the localStorage JWT that actually authenticates (deleted, replaced
with a client page at the same path), and `/admin/desk-kit` had no session
gate while `/admin(.*)` is public in middleware. New guard rule bans a
control-sized `height:` literal; `Chip` was 30px, so the primary navigation
control on every board was under the tap-target minimum on every phone.

**Phase 1 — the comfort fixes, which are what "uncomfortable" meant.**
- Typing one character into the dealer form's Suburb field threw the cursor
  back to Dealer name. `DialogFrame`'s focus effect had `[onClose]` in its dep
  list and every call site passes an inline arrow, so it re-ran per keystroke
  and refocused the panel's first element. Both overlays are now two effects
  with no deps and a handler ref; `Drawer` became a wrapper so the mount
  carries `open`. `focus-trap.spec.tsx` types into the SECOND field.
- `--dk-fs-field` (13px desk / 16px phone) stops mobile Safari zooming the
  board on every tap. Not a viewport lock — that is an a11y regression Safari
  ignores outside standalone anyway.
- `RegisterList` replaces the row markup in sales-book, cases-register and
  listings-register, none of which had a phone layout. The breakpoint is CSS
  in tokens.css, not `useIsPhone`, so it is correct in the first frame.

`npm run build` exits 0 through all four gates. 1,726 frontend tests.

### Pick up at Phase 2

Order and rationale are in the plan. Two things to know before starting:

- **Phase 3 (auth) must land before Phase 11 (new safe-list operations).** The
  agent's approve path turns an admin session into a production shell, and that
  session is currently an 8-hour bearer in localStorage with no second factor.
- **`useIsPhone` is still the desktop-first-paint problem everywhere except the
  registers.** Phase 2's `dk-` class layer is what retires it; roughly 70% of
  the `phone ?` call sites are padding, width or flex-direction and belong in
  the media query.

### Local dev note

`admin@alloutdoor.co.za`'s password was set to `local-desk-password-1` **in the
local database only**, to drive the Desk during verification. Production is
untouched.


## 2026-09-10 (latest) — SELF-HOSTED AUTH; VERIFICATION IS DIDIT

**NOT DEPLOYED.** On `feat/self-hosted-auth`, four commits, off
`feat/takealot-ux-parity`. Nothing has touched the box.

**The rules are in `docs/project-reference.md`.** This is state and the pick-up list.

### What is done

Backend, frontend and peripherals are complete and green: backend `tsc` clean
with 4,554 tests passing, frontend `tsc` clean with 1,680 passing, and
`npm run build` exits 0. The identity-provider column is gone — `User.id` is the only user
identifier and `@CurrentUser()` returns it. Sessions are ours (httpOnly
cookies, rotating refresh, bearer fallback for the app shells). **Seller KYC
goes through Didit; the e-mail and phone codes do NOT** — they are minted and
checked here, delivered by Resend and SMSPortal (see 2026-09-11 below). VerifyNow, AWS Rekognition and the
Gemini identity read are deleted; Gemini keeps the Licence Centre reader and
`readFirearm()`.

### ⚠️ WHAT HAS NOT BEEN RUN

**No part of this has touched a database or a live Didit call.** The migration
`20260910200000_self_hosted_auth` is hand-written — the local dev database is
behind on migrations and was not mine to migrate — and verified only by
cross-checking the schema diff, the index names in the baseline, and
`migration-order.spec.ts` (which caught one real error: a table named
`SupportTicketMessage` that is actually `SupportTicketReply`).

Nobody has yet signed up, signed in, reset a password, or completed a
verification against the running system. That end-to-end pass is the next
session's first job, against the Didit **sandbox** application
(`a8cb5177-…`, workflow `f30edb44-…`), using `sandbox_scenario` to force
outcomes without billing.

⚠️ **The migration opens with `TRUNCATE "User" CASCADE`.** That is the
operator's instruction and it takes every listing, transaction, offer, bid,
motivation and bench with it. Admin accounts, the taxonomy, dealers, the
reloading corpus and the Bench reference data survive. **Take a backup first**
— `~/bin/backup.sh` — and know that the encrypted identity documents under
`SECURE_UPLOAD_DIR` are NOT removed by it and want clearing by hand.

### Before this can go live

1. Set `JWT_MEMBER_SECRET` in **both** `.env` files — same value, and
   different from `JWT_ADMIN_SECRET`. Both hard-throw at boot in production.
2. Create the Didit **live** application, publish a KYC workflow with
   **white-label OFF**, and set `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`,
   `DIDIT_MODE=live`.
3. Register the webhook destination at
   `https://alloutdoor.co.za/api/webhooks/didit` and put its secret in
   `DIDIT_WEBHOOK_SECRET`. **No webhook exists yet** — the account has none.
4. **Allow `18.203.201.92` in Cloudflare's WAF.** Didit delivers from that
   single IP; without the rule every verification outcome is dropped at the
   edge and nothing in any application log will say so.
5. Rebuild the frontend after removing the retired identity-provider vars from
   `.env.production` — `NEXT_PUBLIC_*` is inlined at build time, so the old
   key stays in the served bundle until you do.

### Left for the operator, not for code

- **Rotate, do not just delete.** `frontend/.env.local` and
  `frontend/.env.local.bak-20260825-214941` both hold a live `sk_live_`
  retired-provider secret in plaintext; the AWS access key was live on the box. Deleting the
  lines revokes nothing — kill the provider key in its dashboard and the IAM user
  in the AWS console.
- **A decision, not a bug: there is no Home Affairs check any more.** VerifyNow
  gave us the applicant's official name and date of birth, which is what let
  the verdict cross-check what somebody typed against the state. Didit's free
  tier has no equivalent, so names come off the document and the DOB is checked
  against the ID number's own digits. The anchored high-value re-check is gone
  with it. `zaf_africa_national_id` and `zaf_dha_photo` buy them back at
  \$1.10 each. **Until then no user-facing copy may claim a Home Affairs
  verification.**
- **Google sign-in and 2FA are gone** and were not rebuilt — both lived in
  the retired provider's hosted surfaces. Settings now says plainly that 2FA is unavailable.
- Didit is on the **free tier** (500/month each of ID verification, passive
  liveness, face match, IP analysis; \$10 balance, currently 1 of each used).
  Email codes cost \$0.03 and ZA SMS about \$0.105 — the operator accepted
  both. `didit_org_get_balance` after a test run should show
  `total_cost: 0` on the four free lines; anything else means white-label
  crept onto the workflow.

### Worth knowing

The `gungalore.co.za` → `alloutdoor.co.za` rename was **blocked** by the retired provider's
FAPI domain (`infra/nginx/alloutdoor.conf:30-31`). That blocker is gone.

`docs/ARCHITECTURE.md` had been claiming an `api.gungalore.co.za` vhost and
that CORS mattered because the origins differed. It is same-origin — which is
what makes the cookie session work at all — and the doc is corrected.

---

## 2026-09-10 — THE CARTRIDGE PAGE, THE QUARRY, AND SIX RED MARKS

Deployed as **6a1482eb**. **PARKED HERE** at the operator's request — the work
below is finished and shipped; the list at the bottom is where to pick it up.

**The rules from this session are in CLAUDE.md**, not here: the image adapter
and its pricing trap, the three fixed slots, the quarry gate, dates-as-words,
`researchAskVersion`, the two page-break rules, the annexure changes, and the
"do not deploy mid-generation" trap. This file is the state and the pick-up
list only.

### The cartridge feature page

Three fixed slots, sizes chosen from measured geometry rather than content:
the C.I.P. sheet 88x119 mm at the top of the right column, a 21:9 quarry
photograph 182x78 mm across the foot, and about 183 mm of column for text.
`MEASURE_SLOT=1` on a render prints the measurements the numbers came from.

⚠️ **THE RESEARCH ASK IS SIZED TO THE SLOT.** 0.899 mm per word measured with
the real face, so the slot holds about 204 words; the ask asks for 190 in about
7 sections. Existing briefs already ran 192 — the bare page was never a
word-count problem, it was the missing third slot.

⚠️ **AND A RUN-IN HEADING EMPTIED HALF OF IT.** The research writes either
`**Origin**` or `Origin: ...`, and it switched to the second the day the ask
gained a length instruction. Groups split on subheadings, so run-ins made ONE
atomic group of the whole article and the balancer left a column blank.
Nothing failed; one group is a valid layout, which is why no test caught it.

### Nano Banana Lite

`gemini-3.1-flash-lite-image`, read off `GET /v1beta/models` on our own key.
`LlmService.generateImage` is the one door; image output is $30/1M against
$1.50/1M for text and BOTH arrive in one `candidatesTokenCount`, so the image
half is carved out and priced separately — about 3.4 US cents a plate.

⚠️ **DRAWN AT GENERATION, NOT AT RENDER.** The pack renders on every
download and the model takes 10-20 s against a 60 s nginx ceiling.

Gated on `firearm_use_kind` being hunting or both — operator: "if its hunting
or hunting/sport shooting, yes. both on section 15 and 16." Species come from
the research the page itself prints, whole-word matched ("eland" is inside
"Zeeland"), and only from the WELL-MATCHED half of the brief.

### Six red marks on a rendered pack

- **OVERFLOW** — `BODY_BOTTOM` leaves 12 mm, not 6. A paragraph now moves
  whole rather than splitting, BUT only once the page is 70% full
  (`breakBeforeParagraph`, pure and tested — the two operator rules pull
  against each other and it holds them in tension).
- **CIP?** — the inset failed on every render since it shipped. Its stack
  named `paintFormXObjectBegin`; it rasterises the RAW sheet now instead of
  the A4 re-embed. ⚠️ **UNPROVEN** — never reproduced outside the running
  service. The stack logging stays.
- **Quarry** — see above.
- **2?** — every licensed firearm in the vault now fills the form
  automatically, before `missingRequired`. It can never overwrite an answer.
- **Annexure** — the previous owner’s consent is a lettered annexure.
- **Remove** — `SELLER_LICENCE` no longer letters; the consent page already
  carries both sides of that card.

### ⚠️ A DEPLOY STRANDED A MEMBER MID-GENERATION

`pm2 reload` is a restart here. The row stayed GENERATING, which is not in
REGENERABLE, so every retry answered "already being prepared" forever and the
status had to be edited by hand. A GENERATING row untouched for ten minutes
can now be re-claimed. **Do not deploy while the operator is generating.**

### Still open

- The C.I.P. inset is unproven — the next download decides it.
- `gemini-3.1-flash-lite-image` had never run in production before today.
- The quarry plate has never rendered end-to-end from a real generation:
  MO000075 is dedicated SPORT, so it is correctly gated out of it.

---

## WHERE TO PICK IT UP

**Nothing is half-built.** Everything below is either a verification somebody
has to eyeball, or a decision the operator has not been asked for yet.

### 1. ⚠️ THE C.I.P. INSET IS UNPROVEN — DO THIS FIRST

It failed on EVERY render from the moment it shipped, silently falling back to
our own drawing. Its stack named `CanvasGraphics.paintFormXObjectBegin`, so it
now rasterises the RAW sheet instead of the A4 re-embed that wraps the page as
a Form XObject.

**It has never been proven.** The A4 form rasterises perfectly from a script on
the box, five concurrently, so the production failure was never reproduced.

*How to check:* download MO000075's pack and look at the cartridge page. Either
the C.I.P. sheet is in the top-right of the right column, or:

```bash
ssh alloutdoor "pm2 logs alloutdoor-backend --lines 300 --nostream --raw | grep 'C.I.P. inset failed'"
```

which now prints three stack frames. The logging is deliberate — leave it until
a render settles it.

### 2. THE QUARRY PLATE HAS NEVER RENDERED END-TO-END

`gemini-3.1-flash-lite-image` had never run in production before this session.
The line-up was generated by hand against the live key and dropped into a
fixture render, which is how the page images in the transcript were made — but
no real generation has produced one.

MO000075 cannot test it: it is a dedicated SPORT application and is correctly
gated out (`firearm_use_kind` must be `hunting` or `both`). **A section 15 or
16 HUNTING pack is the first real one.** Watch for:

```
Quarry plate drawn (impala+springbok+blesbok+warthog): 1400x600, ~175KB
llm motivation.quarry gemini-3.1-flash-lite-image ...
```

and check `select count(*) from "QuarryPlate";` afterwards.

### 3. DECISIONS THE OPERATOR HAS NOT BEEN ASKED FOR

- **Where the consent annexure sits.** It letters and prints LAST, because
  every other annexure is an uploaded image laid out by `planAnnexurePages` and
  this is a page we render. Moving it earlier means teaching the planner about
  a non-image. Offered, not raised.
- **The cover hero is still our own drawing**, not the C.I.P. sheet. They only
  ever objected to the inset. A datasheet makes a poor cover, so it was left —
  worth confirming.
- **Strict baseline alignment across the two columns.** Only the right column's
  START is snapped to the left column's grid. A full grid was built and
  reverted: subheadings are smaller than the body and the paragraph gap is
  0.7 em, so rounding each to a whole line added ~30 mm, pushed the last
  section onto a second sheet and put a blank line under every heading. Buying
  the room means shrinking the photo slot.

### 4. WORTH KNOWING BEFORE TOUCHING THE CARTRIDGE PAGE

- `MEASURE_SLOT=1` on a render prints the slot geometry the constants came
  from. Use it rather than re-deriving.
- Rendering a page to look at it: `pdf-to-img` at `scale: 2` (it is a real
  dependency and works on the box; `pdftoppm` is NOT installed locally).
- The attachment tooling reports a wrong page count for these packs — it said
  117 for a 26-page document. `pdf-lib`'s `getPageCount()` is the truth.

### 5. STILL TRUE FROM EARLIER SESSIONS

- The repair pass has now fired ONCE in production (mended "platform" —
  "configuration", 320 tokens).
- `AiUsage` shows two unexplained slow calls: a gate at 37.8 s and a verify at
  51.6 s against ~1 s normally, same prompts and sizes. Provider-side, two
  samples, not a trend. Watch it.

### 6. TWO PHASE-2 ITEMS NEVER VERIFIED AS DONE

The Phase 0-3 record further down is largely superseded, but these two were not
confirmed either way and are the only things in it still worth chasing:

- The Document Centre asking `primary_use` at vault-adoption time (brief §5.7).
  The field exists, is profile-scoped and is already served by the sheet; the
  ASKING is a Document Centre screen change.
- The five sample PDFs to `scan-fixtures/motivation-samples/` (ruling J).
  ⚠️ `scan-fixtures/` is gitignored and must never be committed.

### 7. HOUSEKEEPING THAT SURVIVED THE OLD HANDOFF

- ⚠️ **The working tree carries untracked scratch that is NOT part of this
  work.** `backend/measure*.js`, `backend/report.json`, `overlays/` (DocQuadNet
  benchmark scratch from the scanner workstream) and `docs/design/desk-pwa/`
  (the Desk phone artboards, which live only in this worktree). **Never
  `git add .`** — stage deliberately.
- The create path allocates a reference number **before** the insert, so a
  failed create leaves a gap in the sequence. That is how `MO000057` was
  burned; it worked on retry and never reproduced.

---

## 2026-09-10 — THE THIRD ATTEMPT, the cartridge page, and the date

Deployed as **3c47def6**. Rollback: `alloutdoor-20260910-123916.dump`.
Before it **ae27307e** (`alloutdoor-20260910-122548.dump`).

### ⚠️ THE WRITER KEPT MISTYPING A DATE IT WAS GIVEN

`3c47def6`. MO000075 failed three times on this, the 12:33 run included:

```
supplied 2027-06-30   drafted 2030-06-30
supplied 2024-06-07   drafted 2004-06-07
```

The wizard stores ISO and the fact pack handed it straight over, so the
writer's job in the association paragraph was to copy ten characters.
⚠️ **A WRONG DIGIT IN AN ISO DATE IS STILL A WELL-FORMED DATE**, which is
what makes it a wrong FACT in a signed document rather than a typo.

Neither existing mechanism helps. This is not the variance the third attempt
was for — it is the SAME error each time. And the repair pass refuses a CLAIM
on purpose: mending one means choosing which fact was meant, and a model can
pick a different supplied date, satisfy the check and still be wrong.

So `renderFacts` spells dates: `spelledDate("2027-06-30")` — `"30 June 2027"`.
A slip must now be a whole wrong word. It is also what the letter should always
have said — "valid until 2027-06-30" is a database row, not a sentence.

⚠️ **NOTHING DOWNSTREAM LOSES DIGITS.** `packConsistency` reads document and
answers through one `datesIn`, which parses "30 June 2027" and ISO alike; the
SAPS 271 prefill reads the ANSWERS, never the document. `spelledDate` hands
back anything it cannot fully parse, 31 February included.

## 2026-09-10 — THE THIRD ATTEMPT, and the cartridge page

Deployed as **ae27307e**. Rollback: `alloutdoor-20260910-122548.dump`.
Before it, **595cd0f8** (rollback `alloutdoor-20260910-115127.dump`).

### We had never once taken the third attempt

`595cd0f8`. The loop said it would take three and every failure log for five
days read `regenerating 2/3` and then stopped, because of this:

```js
if (mechanics.length && mechanics.length >= before) break;
```

That assumed determinism, and it was TRUE when it was written — the failures
then were systematic: a brief quoting the sentence it forbade, research full of
manufacturer marketing, a marker being suppressed. Every one is fixed at source.
What is left is variance, and one sample says nothing about the next.

It worked on the first run after the deploy, and both new mechanisms fired:

```
12:07:44  regenerating 2/3   (structureOk=true, sameness=0.00, mechanics=2)
12:07:50  regenerating 3/3   (structureOk=true, sameness=0.00, mechanics=1)
12:07:56  motivation.repair  in=320 out=104
12:07:56  mended 1 sentence(s) rather than regenerating
12:07:58  gate + verify passed — "Your document is ready — MO000075"
```

The mend is visible in the delivered pack: "the stable bolt-action
**configuration**", where the writer had put "platform". One word, 320 tokens.

⚠️ **THE DATE REFUSALS WERE THE GATE WORKING.** An earlier attempt wrote
`2004-06-07` for an association joined `2024-06-07`, and `2030-06-30` for an
expiry of `2027-06-30`. Two digit slips in a document somebody signs. The repair
pass declines these on purpose — mending a CLAIM means choosing which fact was
meant, and a model can pick a different supplied date, satisfy the check and
still be wrong. That wall stays.

### The cartridge feature

`ae27307e`, from the operator's sketch and then a screenshot.

- **The drawing was missing from the feature page** because a rule written on
  09-09 said the body gives up its figure when the cover takes a hero. That rule
  is right about the same PICTURE printing twice and is still enforced. The round
  is now rasterised TWICE: a hero for the cover (two lengths, no engineering) and
  an **inset** for the feature, full callouts, a third of the width. It rides on
  `cartridgeDrawing.inset` and is only built when there is a hero.
- **The spread takes a page of its own, on both sides.** Operator: "see the
  declaration is also rendering above it." Claiming a fresh page fixed only the
  visible half — the letter's prose went on setting underneath the columns. A
  latch spends the break on the next block there actually is, so a feature that
  ends the body leaves no blank sheet.
- ⚠️ **`placeDrawing` now draws the box it measured.** Given a width alone
  pdfkit scales to the PNG's own pixel aspect while every later placement —
  callouts, `rightTop`, the orphan guard — is off the declared millimetres. They
  agree in production because one rasteriser makes both; when they disagree the
  failure is SILENT, prose straight over the picture.

### Research is re-gathered when the ask changes

`Motivation.researchAskVersion` (migration `20260910130000`). `RESEARCH_ASK_VERSION`
was only ever in the SHARED cache key, so rewording an ask reached everybody who
had not been researched yet and nobody who had. MO000075 printed
**"1,000 to 1,300 yards"** and **"heavier calibers"** on a page dimensioned in
millimetres a full day after the ask gained METRIC ONLY, because its block was
frozen the day before. NULL reads as stale, so every existing row re-gathers once.
The calibre ask now asks for South African spelling too.

### Still owed to the operator

Two questions from their PDF message, unanswered and blocking the rest of it:

1. **The consent letter as an annexure** — does it MOVE into the annexure set with
   its own letter and index entry, or stay where it is and just gain one?
2. **The duplicate licence scan** — the consent page already carries front and
   back. Which copy goes: that one, or the existing-licence annexure?

Also open: the repair pass has now fired once in production; the quarry plates
(`QuarryPlate`, generate-once-per-species, human-approved) are unbuilt.

## 2026-09-10 — MO000075 GENERATES, and the cartridge is a feature

Deployed as **931583c6**. Rollback: `alloutdoor-20260910-115127.dump`.

### It generates

After five rounds. Each refusal was a different genuine cause, and the last two
were the ones worth keeping:

`616cb0fe` **the repair pass.** The gate is all-or-nothing over ~900 words, and
each attempt tripped a DIFFERENT word — platform, then terminal ballistic, then
engage targets — on a draft that was structurally clean every time. That is
variance, not a bug still to find. When every outstanding complaint is about a
WORD, the offending sentences are rewritten and the rest is left alone.

⚠️ **IT IS NARROW ON PURPOSE AND MOST OF ITS SPEC IS IT REFUSING.** A
refused CLAIM — wrong section, missing annexure, unstated purpose — is the
writer corrupting facts in a document the applicant signs, and rephrasing one
would hide it. A mixed set repairs nothing. The full gate re-runs over the
result, and the model must echo the original sentence verbatim or that sentence
is left alone.

`abd0d451` **the research kept the ballistics, and the writer glossed the
section.** The scrub had exempted COMPARISON_TERMS, on the reading that research
is what a comparison is argued from — but the carve-out permits those words only
about a firearm ALREADY HELD, and the research is about the one applied FOR.
And the writer got round the not-stated marker by writing "licensed under
section 16, AS A DEDICATED HUNTER OR DEDICATED SPORTS SHOOTER": no invented use,
just the Act's own words, and packConsistency read "hunt" out of it. The marker
now says BY NUMBER ONLY.

⚠️ **THERE ARE TWO RESEARCH CACHES.** The shared `MotivationResearch` table
is what `RESEARCH_ASK_VERSION` invalidates; `Motivation.researchEncrypted` is a
second, per-document copy, frozen so attempt two is graded against the same
brief as attempt one, and NEVER refetched. A fix to the shared cache does
nothing for a document that already has one. The scrub therefore runs at the
point of USE.

### The cartridge is a feature, not a table

`e7dd11c1` then `931583c6`. Operator: "We don't need that bunch of dimensions,
rather give the history and good facts about the cartridge. The dimension sheet
should shrink to a third of the page with the history, description and facts
written around it like a news article style" — then a sketch.

One heading; the article runs full height down the LEFT column; the dimension
sheet is inset at the top of the RIGHT column with text continuing beneath it.

⚠️ **THE FIRST BUILD RAN IT FULL WIDTH** with the text below, which is what
a feature does with a wide photograph and is not what was asked. A cartridge
squeezed into a third of the COLUMN is a centimetre of brass nobody can read a
dimension off; inset at the top of one column it takes a third of the PAGE.

The prose is the research the writer was already given, sliced out of the stored
block at render time — **no second model call, ever, in the download path**.
Safe to print unchecked prose because it is about the CARTRIDGE and carries no
claim about the applicant, and it has been through the same scrub.

Columns fill by whichever is shorter, a subheading travels with its own
paragraphs, and neither column runs off the page — pdfkit sets text past the
bottom margin without complaint when given an explicit y, and the footer prints
over it. Overflow goes full width overleaf.

Rendering caught both of those, and "1,000 to 1,300 yards" under a drawing
marked 71.76 mm. The calibre brief now asks for metric only.

### Still open — asked, not answered

Operator, 2026-09-10, on the generated pack:
1. **The consent letter should be an annexure.** Unclear whether it MOVES into
   the annexure set or stays put and simply gets a letter and an index entry.
2. **The full licence scan is attached twice** — the consent page already
   carries front and back. Which copy is redundant is not yet established: the
   pack has both a consent page and an existing-licence annexure.

Both change what a DFO receives, so both were put back to the operator rather
than guessed at.

## 2026-09-10 fifth deploy — two silent failures, one after the other

Deployed as **459c0e68**. Rollback: `alloutdoor-20260910-104712.dump`.

### The catalogue copy came from our own research, not the writer

`8489239f`. MO000075 was refused a THIRD time. Removing the bad example from
the brief on 2026-09-09 did nothing, because the brief was never the source.

The refused sentence is almost word for word out of the pack's own firearm
research: "built on the Howa 1500 platform ... a turn-bolt, push-feed repeating
action based on a robust one-piece forged steel receiver". ⚠️ **THE WRITER
WAS NOT INVENTING IT.** It was reporting what we handed it, in a block it is
told to treat as fact — because a grounded web search for a rifle MODEL returns
the manufacturer's marketing. An instruction cannot beat the evidence in front
of the model.

The `firearm` ask was requesting exactly that ("design features, action and
configuration") and was never revisited when the operator ruled "we need whats
on the license card, nothing else". It now asks what the model is USED for.

⚠️ **AND THE KEY NOW CARRIES THE QUESTION.** `RESEARCH_ASK_VERSION` is in
`cacheKeyFor`, or the reword would have been inert for 180 days. This trap was
written down that morning and needed the same afternoon.

⚠️ **THE GUARANTEE IS MECHANICAL.** `withoutRefusedCopy` drops any research
SENTENCE carrying vocabulary the writer would be refused for repeating, plus a
research-only spec list. Whole sentences, never words. The spec words are
deliberately NOT in `documentScope` — a motivation may honestly say "barrel".

Second refusal, same document: the `licensed_for="NOT STATED"` marker was
emitted only when a row had NO candidate uses, so the use generator suppressed
a fix from the day before. Always emitted now, and a spec that asserted the
suppression now pins the reverse and carries the evidence.

### The Design samples were empty on a phone

`fee2039a` then `459c0e68`. Two failures, both silent, both mine.

⚠️ **PDF-IN-IFRAME RENDERS NOTHING ON iOS.** Verified on desktop Chrome,
where it could not fail. The pack screen already carries a note saying an embed
can fail silently; this reproduced it five times on a mobile-first product.
Rasterised with pdf.js to a canvas now.

⚠️ **THEN pdf.js NEEDED A REAL WORKER** and `workerSrc=''` + `disableWorker`
is not a thing in v4 — every card stayed empty a second time. The worker ships
at `/pdfjs/4.10.38/pdf.worker.min.mjs`; **versioned path**, same rule as /scan
assets, and a spec fails if the path and package.json drift.

⚠️ **AND THE PER-CARD `catch` WAS BARE**, so when all five failed the console
was clean. A caught error nobody can read is the same fault as the empty box.
It logs now — and the log is what named the worker problem.

⚠️ **jsdom HAS NO CANVAS**, so no unit test on this stack can see a thumbnail
render. The spec says so out loud. Verify in a real browser at a real viewport.
Confirmed at 430px: `<img alt="Banner sample cover">` in the DOM, no failure
message, clean console.

### Still open

**MO000075 has not been regenerated since `8489239f`.** Press "Write my
motivation" and watch `pm2 logs`. Expect no `regenerating 2/3`. If it fails on
a catalogue word again, the phrase-level repair pass is the fix — send back the
offending sentences rather than binning a clean document over two words.

## 2026-09-10 third deploy — the Design step

Deployed as **5aa6155b**. Rollback point:
`/var/backups/alloutdoor/db/alloutdoor-20260910-100307.dump`. No migration.

Five layouts and a colour catalogue have been served since August with **no
caller** — Phase 4 deleted the wizard that had one. Every pack ever made took
`asLayout(null)`; MO000075's three template columns are still null.

The card sits on the review sheet **above the sticky footer**, closed by
default, with the red button still primary underneath. The footer's own note
argues the placement: a separate step for a cosmetic choice is the
confirm-guarding-a-value-we-already-hold shape ruled out on 2026-08-25.

⚠️ **THE SAMPLES ARE REAL RENDERS.** `GET /motivations/:id/design-sample`
runs the actual renderer over the applicant's own cover and returns page one.
**No model call** — the expensive half of a motivation is the prose, and
rendering is a pure function over figures already held. The old picker drew its
own approximation in 511 lines and drifted: it advertised Report as
"sans-serif throughout" to members whose packs were serif. A drawing of a
document can lie about the document; this cannot.

⚠️ **CLOSED, IT FETCHES NOTHING** — otherwise every member loading the sheet
costs the box five document renders they never look at. Pinned by a spec.

⚠️ **THE CLIENT COLOUR TYPE HAD UNDER-DECLARED THE RESPONSE AGAIN.** Its own
comment records doing this once before. `accent` reached the renderer on
2026-08-24 and never reached the type. The component now uses the API's types
rather than a local copy — which is how it drifted both times.

Also: one axis per PATCH (a colour click can never reset a chosen layout);
`null` means NEVER CHOSEN rather than default, so the server owns the fallback;
blob URLs revoked through a ref (five alive at once, replaced per swatch).

**Verified live** in the operator's own browser on MO000075: the card opens,
thirteen swatches and five layout cards render, each carrying a genuine cover
with the cartridge hero.

### ⚠️ STILL OPEN: the prompt fix is deployed but UNPROVEN

`MO000075` is still `status = FAILED`, carrying the failure reason from
**00:53 on 2026-09-10** — before `324b4182` shipped. Nobody has pressed "Write
my motivation" since. The draft visible on the sheet is the RETAINED REJECTED
one, which is easy to mistake for a fresh success.

**Next session: regenerate MO000075 and watch `pm2 logs`.** Expect no
`regenerating 2/3` and no `motivation-verify-failed` AdminAlert. If it fails
again on a catalogue word, the phrase-level repair pass discussed on 2026-09-10
is the fix — send back only the offending sentences rather than regenerating a
whole clean document over two words.

## 2026-09-10 second deploy — the reader stopped paying twice, and the pack got a palette

Deployed as **1cdfe457**. Rollback point:
`/var/backups/alloutdoor/db/alloutdoor-20260910-093334.dump`. Carried a
migration (`DocumentReadCache`), applied cleanly.

### The brief handed the writer the very sentence it was forbidding

`324b4182`. MO000075 would not generate: refused twice by `documentScope` on
"platform" and "engage targets", and the applicant emailed to say we could not
finish it. The rest of the draft was clean — structureOk, sameness 0.00.

The cause was ours. The general `the_firearm` brief quoted a fully formed
catalogue sentence naming a real make and model, and the draft rewrote it almost
word for word on an application for that very rifle. ⚠️ **A WELL-FORMED
NEGATIVE EXAMPLE IS A TEMPLATE** — the model matched the pattern and read past
the prohibition around it. Faults are now described, never quoted, and no
example may name a real make or model.

"engage targets" was a second gap: written in the DISCIPLINE section, where
nothing warned, because the ban was only ever stated in the brief for the
firearm section. `documentScope` is document-wide and the instruction was not.
Rule 6 now carries it — in the SYSTEM prompt, so it costs nothing per document.

⚠️ **THE BALLISTICS WORDS ARE DELIBERATELY NOT IN THAT LIST.**
`COMPARISON_TERMS` carves them out where a sentence says what a held firearm
cannot do. Banning them everywhere would have killed the strongest paragraph in
a same-class application.

### We were paying six times to read the same ten licences

`49d7e006`. The `AiUsage` ledger carried exactly ten
`motivation.extract.current_licence` calls and four `proficiency_certificate`
calls, repeated **six times over three days** against the same stored files —
177 calls against 23 documents. Every pick of a vault document into a pack
re-read the bytes.

⚠️ **RE-READING IS A DECISION, NOT AN OVERSIGHT**, so `DocumentReadCache`
caches the reader's OUTPUT. Carrying values across from the vault by name had
already produced four bugs. Nothing here reintroduces a mapping.

Keyed on sha256(bytes) + kind + licence type + asked fields + `READER_VERSION`.
⚠️ The version and field list are in the key deliberately: the research cache
next door keys on its subject and not its question, so rewording that brief is
inert for 180 days. ⚠️ The owned-firearm SLOT is deliberately *not* in the key —
payloads are stored normalised at row 1 and remapped out, or a ten-firearm
applicant still pays ten times.

⚠️ **AN EMPTY READ IS NEVER REMEMBERED** — `[]` means both "blank document"
and "model timed out", and caching the second as the first makes a marginal
document unreadable for thirty days. Payload encrypted, 30-day expiry, swept
nightly, and **purged when the document is deleted** — a cached transcription
outliving the card would make the delete a lie.

### The banners are tints, and the house scheme finally looks like the house

`1cdfe457`. Operator wanted more spectrum, then banners at 50%, then no white
text. The hues were never the problem — accents already spanned 19°–350°; the
banners were 0–18% saturation on all eleven.

⚠️ **ON PAPER THERE IS NO 50% OPACITY** — the sheet is the backdrop, so the
schemes store the composited result. ⚠️ **AND THE BANNER NEEDED ITS OWN
COLOURS**: `deep`/`deep2` read like a banner pair but are an INK role used by
twenty call sites as fill for headings, labels, fields and marks on white paper.
`bannerFrom`/`bannerTo` are new; nothing else moved. Banner text comes from
`onBanner()`, derived from luminance rather than stored, and the brand mark
flips with it.

⚠️ **THE HOUSE SCHEME HAD BEEN MATCHING A RETIRED SITE.** Its note said "the
site is a #0f0f0f ground" — true on 2026-08-24, and the white theme landed three
days later. Its banner is now the site's own pale surfaces.

Three hues added (indigo 262°, petrol 176°, burgundy 348°); **Sand removed** —
it sat 1° from Stone and their tints were 1.0 apart out of 441, identical at
65%. Thirteen schemes that are actually thirteen. `asScheme()` validates on
read, so no stored preference breaks.

### Next: the Design step

The picker is the piece still missing — see the note under the previous entry.
The palette and the layouts above are what it will offer, and the sample render
approach is proven: `MotivationPdfService.render()` is pure and costs no model
call, so a real cover can be rendered per layout for free.

## 2026-09-10 — the cartridge: its tip, and its place in the pack

Deployed as **4c0a9548**. Rollback point:
`/var/backups/alloutdoor/db/alloutdoor-20260910-003146.dump`.

### The bullet's tip stopped on a flat face instead of following the ogive

`a66990c0`. The nose is a tangent ogive closed by a small sphere, and the
sphere was a flat **22 % of the bullet's radius on every cartridge alike**. On
a 6.5 Creedmoor that is a 1.5 mm ball on a 6.7 mm bullet: by the time a
three-calibre ogive reaches the front it is far narrower than that, so the
sphere stopped softening the point and became it — the outline left the arc
half a millimetre short, bulged back out, and ended on a vertical face.

The tip radius now falls away as the nose lengthens, in calibres of the bullet
it sits on, which is what real bullets do: a short nose is a round nose, a long
nose is a spitzer. Luger keeps 16 %, .223 7 %, Creedmoor 3 %.

⚠️ **The old rule was scaled off the wrong quantity and ran backwards** — a
fraction of the BULLET, on a nose whose own width at the front falls with its
LENGTH, made the pistol round the *sharper* of the two at the tip (0.121
against the .223's 0.159). The spec pins the order across three real sheets.

⚠️ **The same nose code is in `frontend/lib/bench/geometry.ts`**, which is the
upstream of the port, and it was fixed there too. A member must not see one
shape on The Bench and another in their pack.

### The cartridge is now the cover's hero

`4c0a9548`, operator item 4 of five. The drawing **moves** to the cover rather
than joining it, and it stays on the `cartridgeDrawing` input because two other
decisions read that field to know a drawing exists — the spliced C.I.P. sheet
is suppressed by it, and the contents page counts on it.

⚠️ **THE COVER NOW MEASURES WHAT IT OWES BEFORE IT DRAWS ITS IMAGE, and that
is the part worth knowing.** Drawn at the full 182 mm column the hero block came
to 73 mm, the cover ran 19 mm over, and the whole particulars table moved to
page two behind a cover with a hole in it — **silently**, because the
renderer's own overflow net catches it and moves it tidily. Nothing throws.

Two things had to change for that: the particulars grid is measured *before*
the cover image (`particularRows` / `measureGrid`), and the address block
measures and draws through **one** code path (`dossierHead(top, draw)`),
because a second copy of its increments would drift the first time one moved.

The room is not a constant, because the masthead is not: the five covers hand
back between **76 mm (Ledger) and 100 mm (Plate)**, which is most of a hero.
Plate then landed on the bottom margin to the point, so the reserve keeps 5 mm
back. The spec renders all five layouts with the book's Part 7.2 table in full
and fails if any puts it on page two.

### Open — the logo on a lodged pack

⚠️ **Every cover carries the All Outdoor mark and wordmark**, and CLAUDE.md
records the guide-book rule as *no service name anywhere in a lodged pack*. The
cover code predates that rule and was never revisited. **Put to the operator,
not yet answered** — do not "fix" it either way without their word.

### The motivation templates were never removed from the backend

Asked and answered 2026-09-10. Only **two frontend files** went, in the
Motivation Centre rebuild (`7f2b2628`):
`frontend/components/motivation-template-picker.tsx` (496 lines) and
`motivation-template-preview.tsx` (511), both mounted solely in the deleted
wizard at `frontend/app/motivations/[id]/page.tsx`. Recover with
`git show 7f2b2628^:<path>`.

Everything behind them is **live**: `GET /motivations/templates`
(`templateCatalogue()`), `PATCH /motivations/:id/template`, the
`templateFormat` / `templateColourway` / `templateLayout` columns, and the
renderer reading all three. There are **zero frontend callers today**.

⚠️ **The preview is a client-side mock, not a render** — the catalogue ships
layout tokens so the client can draw a fake page cheaply, which is how the
picker once advertised "sans-serif throughout" to members whose packs were all
serif. If it comes back, **its mock cover needs the hero** or it will promise a
cover nobody receives.

### The figures now print beside the firearm (item 3 — done)

`970f79c4`. Nine figures, plain English, two to a line, under the writer's own
cartridge heading with the prose falling in underneath. Down one column nine
rows is a list, not a table, and would push most of a page of prose out of its
section; paired, it is a five-line block read across in one look.

⚠️ **A stood-in letter is never printed.** `cartridgeDimRows` filters on the
same `derived` set the drawing's callouts refuse — a 9 mm Luger has no
shoulder, so it gets no shoulder diameter. It lives beside `completeDims`
because that is what creates the set. ⚠️ **And nothing names a source**; the
labels are words a DFO uses and the sheet's own letters appear nowhere. Both
are pinned by tests.

The body's cartridge block owns two things now, so its latch changed from "the
cover took it" to "is there anything left" — otherwise a hero pack lost the
figures in silence.

**The operator's five items are all closed.** Employer-address autofill was
also verified rather than assumed: `ADDRESS_KEYS` in `sheet-row.tsx` includes
`employer_address` and its branch runs before the `long`-field branch. The
missing "Use my current location" there is deliberate — GPS reads where the
MEMBER is, which is an invitation to put their kitchen table in the employer
box.

### Next — a one-page cartridge sheet for a DFO who wants more

Operator, 2026-09-10: "Maybe we can give a one pager history and interesting
fact about the cartridge in a cool pa[ge] layout if the dfo and cfr wants to
know more about it?"

⚠️ **THE CONTENT ALREADY EXISTS AND IS ALREADY PAID FOR.** `targetsFor()`'s
`calibre` target already asks for "its origin and character — recoil, typical
factory loads, effective range — and what it is commonly used for in South
Africa", grounded against the web, cached 180 days on calibre + use class. The
real 6.5 Creedmoor row in production comes back as publishable prose under its
own headings — Origin, Character and Recoil, Typical Factory Loads, Effective
Range, Common Uses in South Africa, Match Suitability — with sources attached.
Nobody renders it today; the writer digests it and it is thrown away.

So the job is a renderer, not a research feature. What it still needs:

1. **A decision:** inside the signed body, or back matter after the signature?
   The operator's own framing — "if the DFO wants to know more" — points at
   back matter, outside the twelve-heading spine, but it is theirs to make.
2. **Metric.** The payload quotes fps, yards and ft-lbs beside a figures table
   in mm and bar. Ask for metric.
3. ⚠️ **CHANGING THE ASK IS INERT UNTIL THE TTL EXPIRES.** `cacheKeyFor` keys
   on calibre + use class and NOT on the ask, so a reworded brief silently
   keeps serving 180-day-old payloads. Any wording change needs a version
   segment in the key, or it does nothing for half a year.
4. A small markdown pass — the payload carries `**bold**` headings and `*`
   bullets, and nothing in the renderer parses them today.
5. Cite the sources at the foot, which is the pattern press clippings already
   set (paper, date, annexure letter).

## 2026-09-09 — MO000075, read off the box

Every fault below was diagnosed from production data rather than guessed, and
each one is deployed. Rollback points are the dumps deploy.sh printed.

### One bad field kept four firearms off a signed form

⚠️ **`licence_number` WAS NOT A LICENCE NUMBER.** The reader had no guidance
for it, so it wrote the holder's 13-digit **ID number** on three cards and a
bare **four-digit** number on the other four — the same value every time. That
one bad read did damage in three places:

| where | what it did |
|---|---|
| `documentFingerprints` | flagged five of six firearms as duplicates of an unrelated one |
| `alreadyOnForm` | judged four firearms "already listed", so **two of six** reached the motivation and the 271 — silently, because an `identifier` match means "nothing to say" |
| SAPS 271 item 2.1 | put the ID number in "Licence or permit no" |

`looksLikeLicenceNumber` now guards both comparisons, and the reader is told
what a licence number is and the two things it never is.

⚠️ **AND `receiver_serial` WAS READ BY NOBODY.** WANTED is both the question and
the filter, so the key missing from FIREARM_LICENCE meant the reader was never
asked AND would have discarded it. The Marlin prints NONE for frame and barrel
and carries its number on the receiver — so in the vault it had no serial at
all, could never be matched to a section, and its candidate uses were withheld.

### A scan that loses a field is rejected, with the reason, and can be typed in

Operator: *"If not all fields came through in a scan the scan must be rejected
with the reason why everywhere on this website"* + *"givn an optio to manually
type the mssing field"*. **Both halves shipped together** — a rejection with no
fix is the SMS that promised a retry the product refused.

⚠️ **THE LIST IS THE FIREARM LICENCE AND NOTHING ELSE.** It rests on an
invariant stated for that document only: *"the license card will always have
either a serial or say NONE for all fields. It will never ever have an emty
field."* **To extend it, the operator must name the guaranteed rows per kind** —
a proficiency carries a certificate number OR an SCV number OR an
authentication code, not all three, and rejecting those would refuse real
paperwork.

### 117705 was read correctly and thrown away twice

- `proficiencyCovers` dropped the handgun statement as an "endorsement
  mismatch" on a rifle application — before `pickProficiencyPair`, whose law
  branch exists to attach exactly that page. Thirty such skips in the log.
- `proficiencyFor` read attached packs only, so a member whose knowledge unit
  sits on an unattached statement looked like somebody who never did the
  course. It reads the vault too now.

### Also fixed

- **Deleting stopped at ten.** The route was throttled 10/min; the operator
  deleted ten in 36 seconds and read the 429s as "safe pictures and
  proficiencies wont delete". Now 60, and a 429 says what it is.
- **A proficiency deleted half of itself** — two scans of one certificate, one
  side removed, the other promoted to lead so nothing changed on screen.
- **The good-standing row** — the review sheet was the one caller of
  `documentStatus` dropping `coversKinds`.
- **MO000075 failed on "platform"** — the firearm brief *asked* for "the
  action, the barrel, the capacity, the mass". It now takes what a licence card
  carries and spends the section on the use.
- **The Marlin's barrel box** no longer borrows the receiver's serial.

### Still open

1. **The cartridge drawing** — not in the pack at all; CIP dimensions belong in
   the firearm section; the rendered cartridge wanted as a cover hero with its
   dimensions and the make/calibre as a subscript. Not started.
2. **Consent channels** — SMS / Email / send-me-the-link as tick boxes, any
   combination, plus looking the seller up in our own users and notifying them
   in-app. Today both phone and email are REQUIRED and both always send.

## 2026-09-09 — What a firearm is FOR, generated per class

Deployed `a81c74cd`, full deploy — it carries migration
`20260909180000_firearm_use_profile`. All three services online, both health
checks passed, public site 200 twice. `FirearmUseProfile` exists on the box and
is EMPTY: it fills itself the first time a class is asked for.

### The rule that was overridden, and by whom

Guide-book Part 1 rule 7 (and prompt rule 12): a held firearm's purpose comes
from the applicant's stated use or from an endorsement naming that serial, and
where neither exists the writer names the firearm and its calibre and stops.
MO000074 failed three times because the writer would not stop — it wrote that
the Mauser, the Marlin and the Howa were each "for hunting", and nothing in the
pack said so.

⚠️ **THE OPERATOR OVERRODE THAT RULE ON 2026-09-09, AND THE ACT AGREES WITH
THEM.** ss 13(4), 14(6), 15(4) and 16(3) each say a licensed firearm "may be
used where it is safe to use the firearm and for a lawful purpose" — a
permission attached to the licence, not a test, and not a commitment to the
quarry anybody named. Their words: *"The use of the firearm I declare is not
set in stone. If I state that I will be hunting a kudu with my 30-06 and decide
I want to shoot tin cans with it, thats fine. Main thing is that I do it safely
and legally."* A first design that offered the member a menu was rejected: *"I
don't want an applicant to sit and read and tick fucking boxes."*

### What was built

`backend/src/motivations/firearm-uses.service.ts`, `FirearmUseProfile`.

- **One row per class AND SLICE.** A class is calibre + type + action; a slice
  is a section, and for 15 and 16 a discipline (`s13`, `s14`, `s15_hunt`,
  `s15_sport`, `s16_hunt`, `s16_sport`). ONE model call fills every slice a
  class can fall into — written against each other, so occasional and dedicated
  do not blur — and the member's own licence card chooses which the writer
  sees.
- **Keyed on the class, not the member.** The operator's own battery is the
  case that shaped it: their 6.5 Creedmoor is section 15 and the rest are
  section 16, in one pack. The second applicant with a .30-06 pays nothing,
  whatever section they hold it under. No personal data, so nothing is
  encrypted.
- **`eligibleSlices()` asks `sectionAllows()`**, which already holds the Act
  and already holds the two directions it was got wrong in once before: a
  semi-automatic shotgun is never s13, a handgun is never s14 however it
  cycles, a semi-automatic rifle is never s15. An unstated action rules nothing
  out.
- ⚠️ **EVERY SENTENCE IS SCREENED THROUGH `documentScope()` BEFORE IT IS
  STORED**, as the licence type its slice belongs to. Section discipline is
  therefore enforced rather than asked for, and a sentence that would fail the
  gate costs nothing instead of a regeneration. Spelling is folded first, so
  "caliber" is a fix and not a loss. Measured live: it dropped 1 of 3 on three
  of four classes.
- **`documentScope`'s invented-purpose rule now accepts a row carrying
  candidate uses.** A row with NEITHER a stated use nor generated ones still
  refuses — which is why `forClass()` returns `[]` and never throws.
- ⚠️ **THE SECTION IS NOT OVERRIDDEN AND MUST NOT BE.** It comes off the card
  and only chooses a slice. A section is checkable against a document in the
  same pack; a use is not. That is MO000071's actual defect.
- `ownedFirearmCardTypes()` reads the card's Type row, which prints "S/L RIFLE"
  where the form's four choices cannot — reduced to one word for the key, or
  three spellings would buy three generations.

### Two corrections the same day, deployed `ef72be07` (backend only)

⚠️ **THE LISTS WERE BEING MERGED BEFORE THE WRITER SAW THEM.** The table held
the disciplines apart correctly and then `forClass()` interleaved them into one
flat array capped at eight. Operator: *"that would give two lists instead of
one consolidated list."* A row now renders `<uses for="occasional hunting">`
and `<uses for="occasional sport shooting">` as separate blocks and the writer
chooses the LIST first — the argument — then one sentence inside it. The
per-firearm cap is gone; the per-list cap is twelve.

⚠️ **AND GEMINI WAS BEING ASKED IN SECTION NUMBERS.** *"use the fucking words
and not the sections"*, then *"you can keep the section in you database, but
what we serve gemini should be dedicated hunter, dedicated sport shooter,
occational hunter occational sport shooter."* Slice ids and the `section`
column are unchanged; `SLICE_KEY` maps each to the words it is asked and
answered under, those are the JSON schema properties, the labels are people
rather than subsections, and rule 8 forbids the model citing statute at all.

### What it actually produces

Measured against the live model, not asserted:

| class | lists |
|---|---|
| 12 gauge, manual shotgun | **5** — self-defence, occasional hunting, occasional sport, dedicated hunting, dedicated sport |
| 6.5 Creedmoor, bolt rifle | **4** — no self-defence list exists for a rifle |
| self-loading shotgun | **3** — loses s13 at one end and s15 at the other |

### Volume, deployed `e66f3d0f` and `157cd9b7` (backend only)

*"what can we querry it to give more reasons? We need a huge list of reasons."*

⚠️ **RAISING THE CAP DID NOTHING AND WAS NEVER GOING TO.** Asked once the model
answers with its best two to five and stops, whatever `maxItems` says. Three
things changed it:

- **It is asked THREE TIMES**, and every round after the first is shown
  everything already collected and told to give only what is not there. That is
  the lever — a model that cannot see its previous answer rewords it.
- **The prompt enumerates instead of asking.** Quarry, terrain, method,
  distance, season, competition format, and the preparation around the
  shooting, with a use demanded from each axis.
- **The anti-length bias is gone.** "An honest short list beats a padded one"
  was doing exactly what it said.

Measured live: a 12 gauge went 12 → 64 sentences across five lists in 12.6 s; a
6.5 Creedmoor 13 → 78 across four in 10.5 s. Three calls, once per class, ever.
Rounds are small (twelve per list) because forty in one response invites a
truncated body, and a truncated body is a `JSON.parse` throw that costs the
whole class. A round that fails keeps the earlier ones.

⚠️ **A REWORDING IS NOT A NEW REASON.** `merge()` compares CONTENT WORDS with
the shared scaffolding stripped, measured against the shorter sentence so
padding cannot get a duplicate back in.

⚠️ **THE TABLE HOLDS EVERYTHING; THE PROMPT DOES NOT.** Forty per list across
five held firearms is four hundred suggestions wrapped around a handful of
facts. The writer sees ten per list, in a window seeded on the firearm's serial
— stable across regenerations, different between members.

### What the model knew that we were not asking for

The operator put the same question to Gemini in a chat window and got back PRS
from barricades, F-Class prone at 600 m, metal silhouette on animal-shaped
steel, veld-shooting off sticks, and named bodies. Ours said "I compete in
national Long Range Rifle shooting leagues".

- **The disciplines are the half worth having**, and the FORMAT axis now demands
  them by name with positions, distances and target types.
- **The ballistics are the half that would fail our own gate** — coefficients,
  recoil, barrel life, component availability. Rule 6 names them and says why:
  a cartridge's virtues are not uses.
- ⚠️ **THE ASSOCIATION IS NAMED IN THE DOCUMENT, NOT IN THE TABLE.** Operator:
  *"if they are member of that mentioned association we can use it as a
  reason… if the are applying for a section 16 then they must be a member."*
  True, and the pack carries `association_name`. But this table is written once
  per class and served to everyone who holds one, so a name baked into a stored
  sentence reaches the members of every other body. Stored sentences say "my
  association"; `arsenalBlock` tells the writer to substitute the applicant's
  own name from the facts, and to keep the generic words where the facts name
  none.
- **Storage claims and doubled words are refused** — live runs produced "I keep
  it loaded…", "I stage the firearm securely…" and "thick coastal coastal
  thickets". Nothing downstream proofreads a use; the writer lifts it whole.

### The giraffe, deployed `515a41cd` and `e5ad8a66`

⚠️ **A GENERATED SENTENCE MUST NEVER CLAIM THE APPLICANT HAS DONE SOMETHING.**
A live run stored *"I hunt giraffe on vast bushveld farms during regulated
culling contracts"* against a held .300 Winchester Magnum. Operator: *"the I
hunt gireaffe shit aint going to fly, that a blatant lie."* Right, and it is
MO000071's fault in a different coat — a generated fact about the APPLICANT, in
a document signed under s120(9) of the Act. The present tense filled the gap on
a held firearm by manufacturing a history.

**Two honest voices now, and neither is a history.** The operator allowed both:
*"the .300winmag is suited for giraffe hunting so the .300prc will do the same
… or the intent wording works fine as well."*

| voice | used for | example |
|---|---|---|
| **suitability** (`uses`) | a firearm already held | "It is used for harvesting blue wildebeest and gemsbok during winter biltong expeditions." |
| **intent** (`usesProspective`) | the firearm applied for | "I intend to use it for the systematic culling of large plains game populations under structured association management contracts." |

⚠️ **ENFORCED, NOT ASKED** — the giraffe is proof that a rule the model is only
asked to follow holds until it does not. The suitability voice refuses any
sentence carrying a first-person pronoun; the intent voice refuses any sentence
with no intent marker, which is a positive test and cannot be walked around.
Both writer-side blocks say the same thing, because one verb could undo either.

⚠️ **AND RULE 11: PREFER THE ORDINARY TO THE EXOTIC.** Giraffe, buffalo and
elephant are not what a plains-game rifle is for, and a list that reaches for
them reads as somebody who has never hunted.

**Why the basket exists at all** (operator): *"lets say I have a section 16 300
winmag. Now I want a 300 prc, they both can do the exact same thing … so it can
pick one for the 300 winmag I already own and state another reason why I would
want the 300 prc."* The `<intended-uses>` block says in terms that a reason
already spent on a firearm in `<arsenal>` may not be spent again.

The applied-for firearm is offered intent uses ONLY where the applicant stated
no purpose themselves (`hunt_game_class`, `hunt_reasons`, `sport_reasons`,
`sport_formats`, `intended_quarry` all empty) — the same rule `licensedFor`
follows on a held row. An S16_DEDICATED_HUNTER application gets only the
hunting list; a section 24 renewal gets nothing.

### The capability carve-out, deployed `09118e3b`

Operator's decision after being told the words were on the hard refuse list:
allow them in the comparison paragraph and nowhere else. Their sentence: *"the
.300winmag is suited for giraffe hunting so the .300prc will do the same but I
will have the same stopping power and accuracy at further ranges."*

`COMPARISON_TERMS` — terminal ballistics, stopping power, muzzle energy and
velocity, foot-pounds, bullet weight, penetration, expansion — now leave the
whole-document catalogue sweep and are judged PER SENTENCE. A sentence may
carry one only where it BOTH names a firearm the applicant holds AND says that
firearm falls short of something. Naming a firearm is not comparing.

⚠️ **`magazine capacit` IS NOT ON THE LIST, ON PURPOSE**, nor are the frame,
the trigger, the finish or the manufacturer's history. None of those is a
comparison. `renderOverlap` carries the same boundary so the prompt and the
gate agree; the cache baseline moved by exactly eight lines on all six types.

### Why deletion "did not work", deployed `fff935dd` (full)

Operator: *"safe pictures and proficiencies wont delete."* **Neither kind was
the problem.**

⚠️ **THE DELETE ROUTE WAS THROTTLED AT TEN A MINUTE.** The vault event log
shows exactly ten deletes between 16:15:27 and 16:16:03 and none after — five
licences, four competencies, one proficiency. Everything from the eleventh on
returned 429, `credential-card.tsx` renders any failure as "We could not delete
that just now", and the kinds reached eleventh were the safe photographs and
the remaining proficiencies. The ceiling is 60 now, matching the upload route
which learned the same lesson in the other direction; a 429 says what it is, in
the shared client, so no caller has to know.

⚠️ **AND THE ONE PROFICIENCY THAT DID DELETE ONLY DELETED HALF OF ITSELF.** Two
scans of one certificate point at each other through `otherSideId` and
`documentsOf()` folds them into a single row; deleting one side left the other
standing and the list promoted it to lead — same title, same thumbnail, same
place. Both sides go now, bytes included, and any pointer left aiming at either
is cleared (`otherSideId` is a plain string, not a relation).

⚠️ **THE TIDY-UP IS `try/catch`, NOT `.catch()`** — the erasure has already
happened by that line, and a missing method is a synchronous throw.

Every other delete route in the licence stack was audited: the credential erase
was the only one throttled below the global default.

**The applications list is now two piles.** COMPLETED is the only status that
means finished; everything else is In progress, a FAILED run included, because
FAILED became regenerable today. Each row carries its own SAPS 271 — the 271
stopped being an opt-in on 2026-09-08 — except a section 24, which is lodged on
the 518(a) and says so rather than offering a button that returns 409.

### Open, for the operator

⚠️ **A HANDGUN CANNOT FALL UNDER SECTION 14, so it gets 13/15/16 and not 14.**
The operator's message said "when we have a handgun or manual shotgun, it has
to give the section 13, 14, 15 and 16 reasons"; s14 is for a RESTRICTED firearm
— a semi-automatic rifle or shotgun — and a semi-automatic pistol is an
ordinary s13 firearm. Their own general rule ("all sections it can fall into")
is what shipped. They have been told and can overrule it.

⚠️ **A ROW WITH NO SECTION STILL GETS NOTHING.** Where no card placed a firearm
we cannot tell a self-defence pistol from a sporting one, and offering both
sets is how a self-defence firearm acquires a hunting sentence. That is the old
behaviour, deliberately kept.

## 2026-09-09 — MO000074: why a real pack could not be produced

The operator generated a real section 13 application and it FAILED, with an
SMS: *"we could not finish document MO000074. Nothing is lost and nothing was
charged. Open it and try again."* Then they read the SAPS 271 it had produced
and listed seven defects on it.

Deployed, in order: `a30020b5`, `40552155`, `a669e72c`, `c3fb82fe`, `4bf3adf0`.
Rollback point for the last full deploy: **`alloutdoor-20260909-152424.dump`**.

### Why it failed, from the row rather than from a guess

`failureReason` on the FAILED row named three mechanical checks:

- **the calibre did not "appear in the document"** — our fault, not the
  writer's. The card stores `9MM PAR ( 9X19MM )` and the fact pack hands the
  model `displayCalibre` of it; the check then demanded one of those two
  strings VERBATIM, so a writer naming it the way every approved pack does —
  "9mm Parabellum" — was reported as having lost it. `calibreForms` now accepts
  the card form, the tidy form, the tidy form without its bracketed metric
  equivalent, and that equivalent alone. **Not** "9mm" on its own: naming the
  diameter and not the cartridge has not identified the firearm.
- **two Americanisms** — "organiz", "specializ". The check is right (book rule
  3) but it is MECHANICAL, and a mechanical failure costs the whole pack.
  `southAfricanise` folds the spelling before anything is checked, in the main
  writer AND in the reason writer.

⚠️ **The reason writer was throwing away paid calls over a letter.** Read off
the box: MO000074's "why this firearm" paragraph was rejected on "recogniz",
then "specializ", then "utiliz" across consecutive attempts, and it re-runs on
every page load.

### Two structural faults found by pressing the button

⚠️ **THE SMS PROMISED A RETRY THE PRODUCT REFUSED.** FAILED was excluded from
`REGENERABLE` — "an admin owns those" — so the member opens the link, presses
an enabled button, and gets **409 "This document cannot be prepared again from
here. Contact support."** Measured through the real page. FAILED is now
retryable; GENERATING, QUALITY_REVIEW and ABANDONED stay out.

⚠️ **THE RETRY WAS BLIND.** A mechanical failure regenerates once with a fresh
seed and the IDENTICAL prompt, so the second attempt failed on the same words
as the first. It now carries what the previous draft tripped, after
`<applicant-facts>` so it cannot be read as an applicant fact.

⚠️ **AND THE REJECTED DRAFT WAS DISCARDED**, so `failureReason` named the WORD
and never the sentence. Diagnosing this meant reasoning about a document that
no longer existed. It is kept now, encrypted, unreachable by the member.

### The seven defects on the 271

| Reported | Cause |
|---|---|
| Marital status missing; all safe ticks missing | `renderSaps271` read the APPLICATION's answers only. Every `scope: 'profile'` field lives on the member. Both render paths now use `answersFor`, the door the writer already used. |
| Competency date of issue blank | The vault asks a competency card for `competency_issued`; the extractor's date router only knew `issued_on`, so the date landed in `details` and never in `Credential.issuedOn` — the column the form and the expiry derivation both read. All four competency credentials on the box have `issuedOn` NULL. |
| Competency "handgun" mark off | The tick box was 3.1pt wide at x=177.3, a sliver on the cell boundary. Now 17.8pt at x=184.4, consistent with rifle and shotgun. |
| Marlin barrel and receiver serial missing | `first()` walked barrel, frame, serial — never `receiver_serial`. A Marlin card reads BARREL: NONE / FRAME: NONE / RECEIVER: MR90189D, so it ran out of keys and the row was stored with NO serial. |
| Surname of current owner missing | Items 4, 5 and 82 were wired end to end with no input anywhere. The seller's form now asks for surname and initials. |
| Negligence tick missing | `history_negligence` is only asked when something was lost or stolen. Nothing lost ⇒ No is the only answer the facts admit; written only where item 64 is an explicit No. |
| — | **`WESTERN_CAPE`** printed raw in both addresses. Not on the operator's list; found reading the same page. The existing test froze it as expected output. |

### ⚠️ THE OPEN DECISION: a filler word throws away the whole pack

MO000074 was retried six times through the live page. Every mechanical fault
named in this section was fixed and the writer converged — the last run went
**3 issues → 1 → failed**, and the one was this:

> "**Furthermore,** my daily work commute takes me through high-risk precincts
> where violent crime is prevalent."

A complete 1 432-word section 13 motivation was discarded, and the applicant
sent "we could not finish document MO000074", because one sentence begins with
"Furthermore".

**The gate does not distinguish a style slip from a corrupted identity.** Its
own comment says what it is for — *"A wrong serial or a citation to a tab that
does not exist … is the writer corrupting identity data, our defect, an admin's
problem."* That is exactly right for a wrong serial. "Furthermore" is a Part 8.3
style rule and is being enforced with the same weapon.

⚠️ **THIS NEEDS AN OPERATOR DECISION, because it is about what reaches SAPS.**
Three options, in the order I would rank them:

1. **Split the mechanical checks into fatal and cosmetic.** Fatal keeps its
   teeth: a wrong serial or ID, a missing calibre, a citation to an annexure
   that is not in the pack, a section claim that contradicts the card — none of
   those may ever reach a DFO. Cosmetic (filler, catalogue copy, outcome words,
   section-discipline slips) is retried, and if it survives the retries the
   document is still produced with the residue surfaced as a quality note
   rather than thrown away.
2. **Fold the deletable fillers**, exactly as `southAfricanise` folds the
   -ize/-ise alternation. "Furthermore", "Moreover", "In conclusion" and "At the
   end of the day" can be deleted from the head of a sentence with no loss of
   meaning. ⚠️ NOT all of SLOP_PHRASES: "peace of mind" and "law-abiding" are
   CLAIMS inside a sentence, and deleting them leaves a sentence that means
   something else. Those must stay fatal.
3. **Leave it as is** and accept that some applications fail on a word.

There is also a data gap worth closing regardless: **the applicant has five
held firearms and has stated a purpose for none of them.** `licensed_for` is
empty on every row, so heading 6 cannot say what any of them is for, and the
writer kept inventing one until the row was made to say NOT STATED out loud.
Asking `existing_firearm_N_primary_use` during the interview removes a whole
class of refusals at source and is what the book's heading 6 needs anyway.

### Where it stands

MO000074 was retried twice through the live page. The calibre and the
Americanisms are gone from `failureReason`; the third attempt failed on
`"furthermore"` (filler) and on `"hunt"`/`"hunting"` appearing outside a
sentence the scope check recognises as being about a held firearm. That
applicant holds four hunting rifles, so heading 6 has to describe them — worth
checking whether `bestFirearmMatch` is too strict about what counts as "a
sentence about a held firearm", now that the rejected draft is kept and can be
read.

---

## 2026-09-09 — why the safe photographs never reached an application

Operator: *"why doesn't the safe pictures pull in from the vault?"* and then
*"the safe pictures should automatically be set that the date never expires."*

**Deployed `b3b8b36e`** (full deploy). Rollback point
**`alloutdoor-20260909-142658.dump`**. Backend tsc CLEAN, 4 367 tests pass;
frontend tsc CLEAN, 1 658 tests pass, build exits 0. Health after reload:
backend 200 ×2, frontend 200 ×2, alloutdoor.co.za 200 ×2, three services online,
no errors in the backend log beyond the standing Peach MOCK-mode warnings.

### FOUR faults on one path, each enough on its own

1. **The one-or-nothing rule ate all three photographs.** `decideAutolink`
   refuses any kind with more than one candidate — two competency certificates
   is a question, and a coin toss puts the wrong one in front of a DFO. A safe
   is three frames and `SAFE_PHOTO_MIN` is 3, so three photographs looked like
   an ambiguity. Measured before the fix: three in, ZERO attached. One in, one
   attached, and the row still read "not done". `SAFE_PHOTOGRAPHS` now sits in
   `TAKE_ALL_KINDS` beside `CURRENT_LICENCE`. ⚠️ **The old test passed ONE
   candidate**, which is why it survived — there is nothing ambiguous about one.

2. **The once-per-application guard refused the re-run the tick triggers.** M6's
   design is: hold back, report `needsPlaceConfirm`, tick, run again with
   `placeConfirmed`. The first run stamps `autolinkedAt` (held-back rows land in
   `skipped`, so `considered > 0`) and the second returned `already-done`. The
   tick could never do anything, on any application, since it shipped. A place
   re-run now passes the guard with `wanted` narrowed to `SAFE_PHOTOGRAPHS`, so
   it cannot resurrect anything else the member deleted — which is what the
   guard exists for.

3. **Nothing asked the tick.** The panel lived in `suggested-documents.tsx`,
   imported by NOBODY — another Phase-4 orphan, like the pre-filled 271 and the
   delete button. And the review sheet read `needsPlaceConfirm` *after* an early
   return that fires in exactly the case that raises it. Lifted into
   `components/motivation/place-confirm.tsx`, used by both, mounted at page
   level — not inside a section, because they all start closed.

4. ⚠️ **TICKED IS NOT THE SAME AS SETTLED, and this one made the other three
   unreachable.** `neverExpires` says what the answer is; `dateSource` says
   somebody stands behind it, and the candidate query reads the SECOND one. A
   safe photograph had neither, so it was never a candidate at all. On the box:
   four safe photographs, ALL adopted from an application, three with
   `neverExpires` false and both date columns null — because the ADOPTION path
   never applied even the tick (it writes only what `datesFor` returns, and a
   photograph carries no dates). `settledByNature(kind)` now settles them on
   both write paths, and migration `20260909160000_photographs_never_expire`
   backfilled the three. Verified after the deploy: all four are candidates now,
   and the member-confirmed one was correctly left untouched.

⚠️ **`settledByNature` answers for photographs and for nothing else**, and the
line is deliberate. The warning at the top of `credential-kinds.ts` is about
kinds where only the member can see the answer — a green barcoded ID does not
expire and a passport does, and both are `IDENTITY_DOCUMENT`. A photograph of a
gun safe is not that case: there is provably nothing printed on it, which is why
no vision call is spent on one. A test pins the distinction.

**What always worked, and still does:** the library picker asks the same tick
and attaches one document at a time. Nothing was ever lost from the vault.

**Not eyeballed in a browser.** The place-confirm panel needs a signed-in member
with safe photographs in their Centre and none on the application, which cannot
be staged locally — it is covered by a jsdom spec and a check that every CSS
token it uses is defined. Worth a look on the box.

---

## 2026-09-09 — the guide book applied, everything except the estate

Operator: *"apply the whole document apart from the estate. One other rule,
only paperwork required by the dfo are attached as annexures. all other things
like the cartridge specs and clippings and those things must be in the body of
the document itself and form part of the flow."*

**Deployed `c6ba1835`** (full deploy, 2026-09-09 ~13:11 SAST). Ten commits,
`7312768e` through `c6ba1835`. Backend tsc CLEAN, 4 356 tests pass; frontend tsc
CLEAN, 1 654 tests pass, build exits 0.

- **Rollback point: `alloutdoor-20260909-131036.dump`** (pre-deploy backup).
- `20260909140000_licence_type_s14` applied. Verified in `pg_enum`:
  `S14_RESTRICTED_SELF_DEFENCE` is present, last in sort order. Purely additive
  (`ALTER TYPE … ADD VALUE IF NOT EXISTS`), no row changed type, nothing
  backfilled. The box runs Postgres 16, so the statement is transaction-safe and
  the value is not used in the same transaction.
- Health after reload: backend 200 ×2, frontend 200 ×2, alloutdoor.co.za 200 ×2.
  `pm2 list` shows all three online. Backend stderr since the reload carries only
  the standing Peach MOCK-mode warnings.

The book itself is vendored at `docs/MOTIVATION-GUIDE-BOOK.md`. Where it
disagrees with an earlier decision it wins, because it is dated 2026-09-09 and
the operator asked for all of it.

### What shipped

| Commit | What |
|---|---|
| `7312768e` | The book in the repo, and the section 13 statement of law corrected (s13(1)(a) excludes a semi-automatic SHOTGUN; "not fully automatic" offered a member a section their firearm cannot go under). |
| `3d9802a5` | Annexure discipline. Only paperwork a DFO asks the original of is an annexure; the cartridge drawing, the precinct table and the press cuttings moved into the body flow. |
| `ecf43224` | The book's writing rules, enforced in `motivation-scope.ts` rather than instructed in a prompt. |
| `c642a92c` | Cap warnings on the applicant's own checklist page — never in the motivation, which would hand the Registrar the refusal. |
| `a5dab9c8` | **Section 14.** The product had a dead end: `sectionAllows` refuses a semi-automatic rifle or shotgun under section 13 and names section 14 as the way forward, and nothing offered it. |
| `27799080` | **The fixed skeleton.** Twelve numbered headings, the same ones every time. |
| `c9b8957d` | Layout: ragged right, an initial line on every page, and no service name anywhere in the pack. |
| `fc08dcb9` | The take-with-you sheet is route-aware and section-aware. |
| `2a136885` | The statutory block set as a quote rather than as prose. |

### Two reversals worth knowing about

⚠️ **`motivation-structure.ts` NOW DOES THE OPPOSITE OF WHAT IT WAS BUILT FOR.**
It randomised headings, openings and cadence from a seed so a reviewer would not
recognise our documents. Failure mode 9: that produced "a document that read as
stitched together". A DFO does not compare applicants' letters for plagiarism;
they compare the facts to the annexures, and one consistent spine makes that
faster. The plan is now a pure function of the licence type and four facts about
the applicant. **The seed is kept as an identifier only.**

Consequence: sameness stopped being a reason to regenerate — a fresh seed gives
the same plan — and became an admin alert (`motivation-sameness-high`). A high
score now means the PROSE is repeating, which is a different and worse problem.

⚠️ **"PREPARED BY ALL OUTDOOR" AND THE LOGO ARE OFF THE LODGED PACK**, which
reverses an explicit instruction (operator, 2026-08-24). Part 1 rule 2 is
absolute: *"no service name anywhere in the lodged pack. No 'prepared by', no
footer brand, no 'we'. The applicant signs it as their own letter."* Failure
mode 20 is the same point from the other end. The footer now carries the
applicant's full names, ID number, the motivation line, the page number and an
`INITIAL: ____` rule. Our MO reference came off the cover and the footer too
(Part 7.2 ends "Nothing else") and is printed once, on the take-with-you sheet,
which is torn off before the counter — plus the filename and the PDF Title.
**If the operator wants the branding back, that is one decision to reverse, not
a code problem.**

### Three defects found by rendering a pack and looking at it

- Every contents line read **"1. introduction"**. Headings reached the renderer
  already uppercased and `titleCase` folds by lowercasing then capitalising the
  first character — which on a numbered heading is a digit.
- The section band numbered itself **01, 02, 03 as it drew**. The numbers are
  the book's twelve now, gaps included (a section 15 runs 1, 3, 5, 6, 7, 8, 9,
  11, 12), so it takes them off the heading.
- **Section marks have never drawn.** `sectionMarksFor` keys them uppercased and
  colon-stripped; the renderer looked them up with the raw heading line.

### Still outstanding from the book

- **Part 7.4 — the competency table.** The book names three body tables; we draw
  the battery and the precinct figures, not the competency one (certificate
  number, date of issue, endorsements, unit standards, provider).
- **Part 7.5 — who supplies the statute.** The book says the RENDERER generates
  the quoted block from Part 2 and the writer supplies only the sentences. Today
  the writer reproduces the supplied block and the renderer styles it (Part 7.5's
  look, not its mechanism). Moving it needs a labelled contract between the two.
- **Part 7.7 — annexure divider pages.** No divider page per annexure (letter at
  48 pt, title at 14 pt, "(n pages)"). The index exists; the dividers do not.
- **Part 7.3 — where the annexure index lives.** The book puts it on the contents
  page; ours is its own page.
- **Part 7.1 — "black on white, no colour except in photographs".** The five
  layouts draw tinted bands, a gradient masthead and a red ring node. That is a
  house-style decision the operator picked from a picker, so it was left alone
  rather than deleted. **Their call.**
- **Failure mode 6 — a renewal's underlying section.** The book says the
  underlying section drives a renewal; we do not record it, so the association
  heading on a renewal is gated on membership instead. It needs one question or
  a read off the licence card.
- **The estate route**, excluded on instruction.

---

## 2026-09-09 — a firearm held under another section ANSWERS the overlap

Deployed `3765c07a` (backend only).

Operator: *"If someone owns a handgun and its on section 16. Then the new
applicant is allowed to apply for a section 13 of that firearm if they do meet
all the other conditions."*

⚠️ **NOTHING WAS BLOCKING IT, AND NOTHING SHOULD.** `applicationBlockers` tests
the section against the firearm's TYPE, the competency's endorsement, and the
competency's currency. It counts holdings nowhere, so a section 16 handgun has
never stood in the way of a section 13 application. That half was already right.

**What was wrong was how the document argued it.** A licence is issued under a
section FOR A PURPOSE, so a handgun held under section 16 is held on a sport or
hunting licence that does not cover keeping or carrying it for defence — the
section 13 application is asking for the first firearm licensed to do THIS job,
not a second one to do the same job.

`overlapStrengthClause` knew the sections differed and put it second, as "worth
naming", behind an ACTION clause reading *"it is also semi-automatic, which
makes this a CLOSER duplication — press it"*. On exactly this case the writer
was told to press a duplication the licence card disposes of in a line.

Reversed: the section leads, and where it differs the note says **SAY THIS
FIRST AND STOP THERE**, names the held section, and points at the licence copy
in the annexures. Matching actions become "what makes the two look alike on a
register" rather than what makes them compete for a role.

⚠️ **ONLY WHERE THE SECTIONS DIFFER.** Two bolt rifles both under section 16 do
compete for one role, and that still gets pressed. The spec pins both.

New card `different_section` leads the overlap angles on every type.
⚠️ It says the LICENCE does not cover this purpose — not that the firearm may
not be used. The stronger claim is a proposition about the Act, and the card's
sentence goes verbatim into a document somebody signs.

---

## 2026-09-09 (later) — MOTIVATION-S13-OUTPUT-REVIEW.md §4, items 1 to 5

Deployed: `9edf30f9`, `bd966943`, `12b0aacc`, `07289a06`, `aec47df2`. The last
carried a Prisma migration; `prisma migrate deploy` applied it and all three
services came back online with both health checks and the public site twice.

### The document can no longer state what nothing supplied

`documentScope()` (`motivation-scope.ts`) runs beside `packConsistency` on every
generation, so a failure costs ONE regeneration and then an admin alert —
**never a question back to the applicant**, who cannot fix the writer's
vocabulary by answering something else. It refuses:

- a **section** named for a held firearm that is not the one on its card, and
  any section at all for a firearm no card placed. Three of MO000071's five
  guesses were right; a guess that is right by chance is still a guess.
- a **purpose** for a held firearm nothing supplied — rule 12, enforced.
- **catalogue copy anywhere**, not only in the reason paragraph. `validateReason`
  has policed this since it shipped and has only ever seen its own paragraph.
- hunting, sport and reloading words in an S13, **judged per sentence**. ⚠️ A
  blanket ban would delete the strongest paragraph an S13 has: "licensed under
  section 16 for hunting, and a section 16 firearm may not be carried for
  self-defence". A sentence about a held firearm keeps the vocabulary.
- any **date until which a competency is valid**. A SAPS competency prints no
  expiry, so every such date is derived, and MO000071's was derived wrongly.

`existing_firearm_N_section_held` is a real column now, filled off the licence
card by `credentialOffer` — the vault has read `section` off every card scanned
since the Centre shipped and nothing ever used it — and **the member's answer
beats the vault lookup**, so a correction is not overwritten next generation.

### The gates before a model call is spent

- **Competency currency** is an `applicationBlockers` entry: section 6(2) makes
  a lapsed competency an application that cannot be granted, which is the same
  class of fact as a rifle under section 13. Valid THROUGH the expiry date; the
  clock is injected so a re-check months later reaches the same verdict.
- Reloading is **not asked on an S13** (`NOT_ASKED_BY_TYPE`, so old answers are
  still accepted and old drafts still save).
- The **117705 alert waits for a statement of results to be about**. It fired on
  an application with four certificates in the Centre and none chosen.

### The S13 is ordered as the approved corpus orders it

`introduction → the_threat → storage_safety → existing_measures → the_firearm →
comparison → statutory_application → conclusion`.

`personal_circumstances`, `the_calibre` and `compliance_history` are gone from
the S13 skeleton; `existing_measures` is new and is the half of the section 13
test the document never made — what is already being done about the risk, and
where each measure stops. `experience` folds into the statutory section.

⚠️ **THE ROOM WAS THE INSTRUCTION.** `the_firearm` had 2–4 paragraphs and a
brief asking for the action, barrel, capacity and ballistics. On an S13 it is
one paragraph, sixty words, four facts, and a brief forbidding everything else.

⚠️ **AN S13 NOW HAS NO PERMUTING PAIR** — its pair was experience/storage. The
anti-template load falls entirely on heading alternates, the opening, the
closing, the cadence and the conditional comparison section. **Watch the admin
sameness report**; the fix is more heading alternates, not a looser order.

### What the pack prints

- The **battery table moved under the comparison heading**, where the argument
  is, and carries **Type, Section and Purpose**. Section prints an em dash where
  no card established one; Purpose is stated or absent and never derived from
  the section number.
- The **press-clippings annexure opens with the SAPS quarterly table** for each
  precinct cited — home station plus up to two the applicant ticked — with the
  release named on every table.
- The **cartridge is drawn** (see the earlier entry) and the writer is told it
  does not know whether a drawing was placed or where, so it must never refer
  to one.
- Annexure titles drop the second person; the calibre prints as a calibre
  (`displayCalibre`), and `packConsistency` accepts either form.

### What the member is offered

- The **incident picker refuses sexual offences and court-diary items** and
  anything classified `other`. It offered a child rape in Atlantis. The filter
  runs on the picker, the area list AND the stored ids, because a draft can
  hold something chosen before the filter existed.
- The **take-to-the-station list is route-aware** — a private sale is no longer
  told to bring the dealer's tax invoice — and "Character references, if you
  have them" is gone until there is a slot to put one in.
- **Proof of address says what else it shows.** MO000071's was a rental
  statement carrying the applicant's rent and a R134 arrears line.
- "Use my current location" is off the Employer's address; the six component
  rows stay off the sheet until a reader fills one; the 271 meter holds its
  tongue while the header still has a count.

### The endorsement, and The Bench

`CredentialKind.ASSOCIATION_ENDORSEMENT` exists (migration
`20260909100000_credential_association_endorsement`), the classifier has one
test for it — **does the page name a firearm by serial** — and the Document
Centre offers it instead of filing one as dedicated status. An endorsement
matched to an owned row **by serial** fills that row's purpose.

⚠️ **It stays out of `VAULTABLE`, for `CURRENT_LICENCE`'s reason**: the Centre
is the route, and adopting from an application would file a second row.

**The Bench draws 83 more cartridges.** `canDraw` wanted all thirteen letters
and only 132 of 215 sheets print them, so 9 mm Luger and .38 Special drew
nothing. The pack's `completeDims` is ported into `lib/bench/geometry.ts`, kept
identical on purpose, and the 2D drawing never annotates a letter it filled in.

### Still open, and needing the operator

1. ⚠️ **§1.7's article body / screenshot is NOT done and is not mine to decide.**
   The review asks for the article body or a page screenshot in the clippings
   annexure, "with the paraphrase rule relaxed for an annexed source". The
   operator ruled the opposite way on 2026-09-07 and `news/news.types.ts`
   records it in their own words: "just the picture and headline and subscript
   ... Never the body of the article ... reproducing it is the publisher's
   right, not ours." Two rulings a day apart, opposite ways, on somebody else's
   copyright. The half both agree on — the precinct figures table — is built.
2. **`association-activities.ts` is not built.** Brief §5.5a wants a per-
   association library of exercises with each eligibility rule verbatim, seeded
   from natshoot.co.za and sahunters.co.za, and says in as many words that the
   operator reviews it before it ships. Until it exists, `UNPROVABLE_RULE_WORDS`
   keeps refusing the claims it would let the writer prove.
3. **`cipSheetEnabled`.** The spliced facsimile page now renders only when we
   hold no figures for the round, and its heading no longer names a source.
   Retire the flag, or leave it as the fallback — a decision, not a defect.
4. ⚠️ **`MO000072` is the only motivation on the box**, S13, still `DRAFT`.
   MOTIVATION-S13-OUTPUT-REVIEW.md asks for it to be deleted; that predates
   MO000071 going, and deleting it now leaves production with nothing to test
   against.

---

## 2026-09-09 — the cartridge drawing, the arsenal, and the SAPS 271 back on screen

Deployed: `df04ec15` (full), `641f79e0` (backend), `65c1d72b` (full),
`36104303` (backend). Three services online each time, both health checks and
the public site twice each.

### The cartridge, drawn rather than reproduced

Operator: *"why arent we pulling in the dimension sheet of the cartridge its
using from The Bench? And describing the cartridge and how it would suffice for
a self defence round?"*, then *"you can render the cartridge in 3D with the main
measurements and make it half a page with half a page description"*.

`backend/src/motivations/motivation-cartridge-drawing.ts` draws a side-on solid
of revolution — rim, extractor groove, taper, case mouth, seated bullet — shaded
from one light and dimensioned with the letters the sheet printed. It lands
**under the writer's own cartridge heading**, so the picture and the argument
share a page. `motivation-cartridge.ts` puts the same figures into the fact pack
as text, so the writer stops recalling ballistics.

Three traps, all of which produced a drawing that rendered without error:

- ⚠️ **A gradient in the default object-bounding-box units restarts inside every
  shape it fills.** The half above the axis and the half below each took a full
  sweep, so the round was lit from two directions with a seam down the middle.
  `gradientUnits="userSpaceOnUse"`, and the case and jacket lit separately
  because they are two metals.
- ⚠️ **librsvg has no `system-ui`.** SVG `<text>` was set in whatever face
  fontconfig offered — differently here and on the box. The SVG now carries
  geometry only; `DrawingText` travels beside it and pdfkit sets the lettering
  in the document's own type, which also makes it selectable in the PDF.
- ⚠️ **The nose is a tangent ogive, and the bearing surface is proportional.**
  What was there was `sqrt(1 − t²)` — a semicircle, which holds full diameter
  and then drops vertically — plus a `+ 0.35 (1 − t)` term that bulged the
  radius OUTWARD at the join, and a flat 6 mm shank that on a 9 mm Luger is
  more than half the exposed bullet. Operator: *"yours looks like a fucking
  dick head or a mushroom"*. The ogive radius is not tuned: it is the only one
  that meets the shank flat and still reaches the tip in the length the round
  has, so 9 mm Luger falls out at ~1.1 calibres (round nose) and .223 at ~3.4
  (spitzer) from their own figures. Below a nose length of one bullet radius no
  tangent ogive exists — the algebra returns a negative tangency radius and
  draws a nose folded inside out — so a wadcutter takes a quarter ellipse.
  ⚠️ **Changed in `lib/bench/geometry.ts` AND the backend port together.** The
  Bench had this nose too, on its 2D drawing and revolved on its 3D view.
- ⚠️ **Case brass and jacket copper, not two brasses.** Cartridge brass is ~70 %
  copper and yellow; a jacket is ~95 % and reads red. Lit with the same stops
  in a lighter tint the two differed only in exposure and the round read as one
  turned piece with a seam. Same lighting structure, different hue.
- ⚠️ **The prose must never point at the drawing.** Whether one is placed
  depends on holding figures for the calibre, and where it lands is the
  renderer's decision taken long after the writing — so "the drawing above"
  comes out pointing at nothing, or at something underneath. `cartridgeFacts()`
  now says so to the writer in as many words.
- ⚠️ **`completeDims` derives the letters a sheet does not print.** Only **132 of
  the 215 sheets** carry all thirteen: a case with no shoulder does not print
  one, and a rimmed revolver case prints no extractor groove either. The strict
  rule refused 9 mm Luger and .38 Special — the two cartridges a self-defence
  applicant actually uses. A derived letter is drawn and never dimensioned.

⚠️ **It REPLACES the spliced C.I.P. page** (`cipSheet`), which is now the
fallback for a round we hold no figures for. Two cartridge sections is a
document that has lost its place, and that page is a facsimile captioned with
somebody else's name printed into our contents — which is the republication
question `cipSheetFor()` already recorded as open. The precedence is stated in
**two** places, because reserving the page and merging it are separate passes:
gated only in the body, the sheet was skipped in the contents and still appended
after the signature.

### Resolving the calibre a member typed

`firearm_calibre` is free text and the stored names are not what anybody writes:
".357 Magnum" is filed as "357 Mag.", 9 mm Luger's only mention of 9×19 is
inside a slashed alias, "9mm Parabellum" appears nowhere. `findCartridge` now
tries exact, then contractions as well as expansions, then a **unique** prefix
and a **unique** substring with a four-character floor.

⚠️ **Uniqueness is the whole safety argument.** A bare `9mm` touches 9 mm Luger,
9 mm Makarov and 9 mm Browning court, so it resolves to **nothing** and the pack
ships without a drawing rather than with another round's dimensions under the
applicant's signature. Uniqueness counts **cartridges, not strings**.

### The SAPS 271 was unreachable

Operator: *"see why the 271 is not appearing. It needs to be filled in."*

Nothing was broken. `GET /motivations/:id/saps271` works, `buildSaps271` fills
it, `saps271-coords.ts` still hashes clean, and `motivationsApi.saps271BlobUrl`
was already in the client. **The only screen that ever offered it was
`components/licence-pack/pack-finish.tsx`** — the finish step of the
`/licence-services` wizard deleted in Phase 4 on 2026-09-08 — and
`/licence-centre/[id]/pack` never picked it up. So a member read a completeness
meter telling them how much of their 271 was done, with no way to open the thing
being measured.

It is on the pack screen now: Show the form / Download the form, fetched **on
demand** rather than with the page (two multi-megabyte blobs on one document is
a phone tab being dropped), with the section 24 case handled by licence type.

⚠️ **`pack-finish.tsx` gated the button on the retired `fill_saps271` opt-in.**
That gate is gone from the backend; every pack ships a form.

⚠️ **Nine more components under `components/licence-pack/` are mounted by
NOBODY** — `attached-documents`, `bulk-capture`, `extraction-review`,
`owned-firearm-summary`, `section-chooser`, `pack-finish` and their specs. They
are the deleted wizard's parts. Before deleting any of them, check whether it is
the only surface for a capability the way `pack-finish` was: that is now twice.

### Open, and needing the operator

1. ✅ **The Bench draws them now** — `completeDims` was ported into
   `lib/bench/geometry.ts` later the same day. See the entry above.
2. ✅ **The label no longer names a source.** Whether to retire
   `cipSheetEnabled` altogether is still a decision; see above.
3. ⚠️ **`MO000072` is the ONLY motivation on the box**, S13 self-defence, still
   `DRAFT`. `MOTIVATION-S13-OUTPUT-REVIEW.md` asks for it to be deleted; that
   ask predates MO000071 going, and deleting it now would leave production with
   no application at all and nothing to test against. Leave it until the
   operator says otherwise. Its pack screen shows "not written yet" for the
   motivation and still offers the SAPS 271, which is correct — the form fills
   from the answers and does not wait on the writer.

### Outstanding from `MOTIVATION-S13-OUTPUT-REVIEW.md` §4

⚠️ **Superseded — items 1 to 5 all shipped later the same day.** See the entry
above this one for what each of them turned into and what is still open.

---

## Next up: finish Phase 2 — the rest is DEPLOYED

> ⚠️ **LARGELY SUPERSEDED, KEPT FOR THE REASONING.** Read as history, not as
> status. Most of "What Phase 2 still owes" below has since shipped — the page-1
> particulars grid, the owned-firearms table, the statutory quote-then-apply, the
> annexure index and the take-to-SAPS checklist all render today, and the heading
> collapse is settled: CLAUDE.md now fixes **twelve numbered headings, the same
> ones every time**, and `motivation-structure.ts` no longer randomises.
>
> Two items could NOT be verified as done and are carried in **WHERE TO PICK IT
> UP** at the top of this file instead: the Document Centre asking `primary_use`
> at vault-adoption time (brief §5.7), and the five sample PDFs to
> `scan-fixtures/motivation-samples/` (ruling J).

The operator's brief is `MOTIVATION-REBUILD-BRIEF.md` (repo root), whose **§0
amendments table is the ruling set** — it overrides the sections it names. The
companions are `MOTIVATION-INTAKE-PLAN.md` (the question model) and
`MOTIVATION-UX-REVIEW.md` (what is wrong with the live screens). The
file-by-file plan for all four phases is
`docs/design/licence-centre/PHASE-0-PLAN.md`; the Phase 3 frontend spec is
`docs/design/licence-centre/SPEC-BUILD.md`.


⚠️ **Phase 2 is HALF DONE AND STOPPED ON PURPOSE.** Brief §0 ruling H makes the
14 → 12 heading mapping the first step of Phase 2, with its own sign-off,
before `HEADING_ALTERNATES` may collapse. That mapping is delivered — see
`docs/design/licence-centre/PHASE-0-PLAN.md` §2.0 — and everything that does
NOT depend on it has been built. What remains is listed under "What Phase 2
still owes" below.

**Phases 1, 1B, 3 and 4 are DEPLOYED and committed** — `7f2b2628`, then the
shelf follow-up `fe78bd12`, both 2026-09-08. **Phase 2 is half done** and
stopped on the §2.0 heading-mapping sign-off; that mapping,
in `docs/design/licence-centre/PHASE-0-PLAN.md` §2.0, is the next thing that
needs the operator rather than a developer.

### What Phase 1 did

1. **The registry (`motivation-fields.ts`), `FIELD_REGISTRY_VERSION` → `2026-09-08`.**
   New `kind: 'cards'`; new field properties `options`, `scope` and `internal`;
   `showIf.hasAny`. New `'Your premises'` section (profile-scoped) with seven
   new questions, absorbing the four safe fields out of 'Storage and safety'.
   `existing_firearm_N_primary_use` on all fourteen owned rows. `overlap_angle`.
   Nine reason-card sets. Every `long` field lost `required` and became the
   optional prefilled "anything else" box under the cards that replaced it.
2. **`fill_saps271` is retired as a QUESTION**, not deleted — `RETIRED_FIELDS`
   keeps `fieldByKey` finding it so an old draft still saves. `formOnly` no
   longer decides what is ASKED, only what reaches the writer. Roughly
   forty-eight questions that hung off the opt-in are asked of everybody now,
   **including the six history questions**, which on the dealer path were never
   asked at all — so a conviction never reached the writer.
3. **`internal: true`** replaced the deliberate `formOnly` × `showIf`
   contradiction on `police_station_province`, `press_clippings` and
   `competency_renews_with_licence`. Safe now because the frontend's mirror of
   `isVisible()` is retired: `motivation-sheet.service.ts` computes item state
   server-side and is the only visibility decision in the system.
4. **The profile store.** New `MemberProfileAnswers` model + migration +
   `member-profile-answers.service.ts`. `saveAnswers()` splits the incoming blob
   by scope; `findOne()` and the sheet layer the application over the profile.
5. **`GET :id/sheet` and `GET :id/preview`** — `motivation-sheet.service.ts`
   composes prefill, documents, coverage, overlap and preview into one read;
   `motivation-preview.ts` is a pure, deterministic, **no-model-call** preview.
6. **SAPS 271 F-by-route** — the opt-in gate is gone from
   `motivation-render.service.ts`; the checklist note now names the route.
   `saps271-map.ts` gained `'Both'` for `safe_mounted_to` (item 69 has two
   boxes and no third, so the new choice had to become two ticks).
7. **Overlap** gained action and section axes and a ranked `suggestedAngle`
   drawn from the fixed `OVERLAP_ANGLES` vocabulary.
8. **The follow-up interview is gone** — `motivation-gaps.ts` (+spec) deleted,
   `queueFollowUps`, `askFollowUpBatch`, `askFollowUp`, the four follow-up
   prompts, `listMessages`, `answerFollowUp`, both `messages` endpoints, the
   `MotivationMessage` table and its two frontend client calls.
9. **Frontend appendix (non-visual).** Both registry fixtures regenerated from
   the live registry (they were hand-maintained and had gone stale, so
   `wizard-coverage` was checking the wizard against a registry that no longer
   existed); `visibleFields()` lost the 271 gate; `STEP_PLAN` and `WIZARD_STEPS`
   re-pointed at `'Your premises'`; the follow-up UI removed from both wizards.

### What Phase 2 did

1. **The research layer** — `MotivationResearch` table + migration +
   `motivation-research.service.ts`. Four narrower questions (firearm model,
   cartridge, discipline, class of game) each keyed on a fact about the WORLD,
   so a row is shared by everyone who asks the same one and the second
   applicant for a Beretta 1301 costs no call. 180-day TTL, checked on read
   rather than swept.
2. **It is a privacy improvement, not only a cost one.** The free-text brief it
   replaces carried the applicant's suburb into a web search. Precinct figures
   already come from our own SAPS workbook, so **no applicant datum reaches a
   search query at all now** — locked by a spec that asserts no name, ID,
   address, suburb, station, employer or serial appears in any target.
3. **The old free-text path is removed** — `research()`, `researchBrief()` and
   `ResearchArgs`. ⚠️ `redactToArea()` was deliberately KEPT with its tests: it
   is a tested privacy primitive and the next person who needs to put a place
   into a prompt should find it rather than write it again, worse.
4. **Length bands halved** — S13 900–1400, S15/S16 1200–1800, S24 600–900,
   because ~60% of the approved corpus's page count is manufacturer copy and
   quoted regulation that rule 7 already forbids.
5. **Cadence fixed to `plain`, one opening instead of four.** The similarity
   detector survives as a test-time guard.
6. **Reloading asked once**, profile-scoped (`reloads`, `reload_calibres`,
   `reload_since`).
7. **⚠️ A REAL BUG CAUGHT ON THE WAY: tapped cards were reaching the writer as
   SLUGS.** `s13_reasons` stores `night_travel, rented`, and the fact-pack
   renderer would have handed those two tokens to the model as the whole
   self-defence case. This is the identical failure the file already documents
   for `discipline`. Card answers now render as their first-person sentences,
   through the `long` shape so the 200-character scalar cap cannot silently
   drop somebody's fifth reason. Three new tests.

### What Phase 2 still owes (all blocked on the §2.0 sign-off)

- `HEADING_ALTERNATES` and `TYPE_HEADING_ALTERNATES` collapsing to one title
  per section.
- The rendered-from-data blocks: page-1 particulars, the owned-firearms battery
  table, the S13 existing-measures list, the statutory quote-then-apply, the
  annexure index, and page 2's take-to-SAPS checklist. Their PLACEMENT is what
  the mapping decides, which is why they waited.
- `motivation-pdf.service.ts` table definitions for those blocks.
- The Document Centre asking `primary_use` at vault-adoption time (brief §5.7).
  ⚠️ Deliberately NOT stubbed in the backend: the field exists, is
  profile-scoped and is already served by the sheet; the asking is a Document
  Centre screen change and belongs with Phase 3 rather than as a backend hook
  nothing calls.
- The five sample PDFs to `scan-fixtures/motivation-samples/` (ruling J).

### What Phase 1B did — AWS Textract is gone

Operator, 2026-09-08: "we will also be losing AWS textract and only be using
gemini going forward. Gemini can write straight into json." Scope: everything,
KYC included. Removed from all three places it lived.

1. **The Licence Centre reader.** `licence-centre-textract.service.ts` and
   `textract-document-extract.ts` deleted; `licence-centre-extract.service.ts`
   is Gemini-only with a per-call `json: { schema }` whose `key` is enumerated
   to that call's own `wantedFor()` list. `document_side` (front/back of a
   proficiency pair) used to need a SECOND Textract call to decide, even when
   the model had done the read — it is now just another key in the prompt.
2. **`readFirearm()`.** The Textract-first pass, `firearmFromTextract` and the
   key map are gone; the call takes `FIREARM_READING_SCHEMA`.
3. **KYC.** `textract-extract.ts` deleted; `readIdentityDocument()` is one
   Gemini schema call, and **SA ID numbers are validated with `readSaId` in
   code** — a Luhn failure nulls the number rather than flagging it.
   `textract:*` out of `infra/aws/kyc-iam-policy.json`.
4. **`@aws-sdk/client-textract` uninstalled.** Nothing imported it any more and
   leaving it would tell the next session Textract was still live.

⚠️ **AWS DID NOT LEAVE.** `aws-kyc.service.ts` still uses Rekognition for face
match and Face Liveness. The client, the region, `AWS_KYC_LIVENESS_ROLE_ARN`
and every `rekognition:*` IAM statement stay.

### ⚠️ What Phase 1B cost, stated plainly

- **`legibilityScore()` is no longer a legibility measure.** It was Textract's
  mean per-line OCR confidence × field completeness, and it gates whether a
  seller is asked to retake their ID. A vision model reports no such
  confidence and must not be asked to invent one, so it is **completeness
  alone** now. The "no ID number caps at 40" rule is kept verbatim.
  **A smudged document the model reads confidently but WRONGLY now scores high,
  where Textract's low confidence would have forced a retake.**
- **The Licence Centre lost its marker fast-path.** `readMarkers` ran off
  Textract's OCR text, so `classify()` could read a form number for free and
  without hallucinating. It now always costs a model call. **This is fixable** —
  `GoogleVisionOcrService` already exists and motivations' own classifier uses
  it for exactly this — but it is a third provider, and the instruction was
  "only gemini", so it needs an operator call. `UPLOAD_TO_CREDENTIAL` has no
  production caller left as a result.
- **The public privacy page was made accurate.** It told members their identity
  document goes to AWS Ireland for "automated text extraction", which is now
  Google. Corrected in `frontend/app/(legal)/privacy/page.tsx` — both the
  paragraph and the cross-border operator table. ⚠️ **This is POPIA §72
  cross-border disclosure copy and should have an attorney's eye on it.**
- ⚠️ **Two sets of Textract fixtures are ORPHANED AND TRACKED IN GIT** —
  `backend/src/kyc/__fixtures__/textract/` (6 real identity documents) and
  `backend/src/licence-centre/__fixtures__/textract/`. Nothing reads them.
  They carry real names and identity numbers. Not deleted: that is the
  operator's call, and git history keeps them regardless, which is the deeper
  problem worth a decision.

### What Phase 3 did — the surface is built

Fourteen files under `frontend/components/licence-centre/` plus three routes.
**73 new tests**, `npm run build` exit 0, all four routes registering:
`/licence-centre` (static — the Document Centre, untouched),
`/licence-centre/applications`, `/licence-centre/[id]`,
`/licence-centre/[id]/pack`.

Components: `contract.ts`, `sheet-row`, `cards-row`, `declaration-row`,
`sheet-header`, `sheet-footer`, `sheet-section`, `document-shelf`,
`sheet-toast`, `overlap-card`, `consent-card`, `competency-lines`,
`pack-summary`, `preview-panel`, `__fixtures__/sheet.fixture.ts`.
Routes: the sheet (the only stateful file), the applications list, the pack.

### The acceptance gates (ruling G — RTL, not Playwright)

`components/licence-centre/sheet-gates.spec.tsx`. The counter **throws on any
keystroke**, so "zero typing" is enforced rather than observed.

- **(a)** populated vault, S16 sport → enabled button in **1 tap**, zero
  typing, against a ceiling of 12.
- **(b)** empty vault → every unanswered item renders an OPEN input; the button
  opens once they are answered.
- **(c)** private sale → the consent card's Part F line changes once the seller
  signs, and never blames the applicant for a signature they cannot hurry
  (`pack-cards.spec.tsx`).

### Decisions in Phase 3 worth knowing

⚠️ **The two client calls live in `lib/motivations-api.ts`, NOT a client of
their own** — a departure from the Phase 0 plan.
`backend/src/common/api-route-contract.spec.ts` parses THAT FILE and asserts
every call has a matching route; a separate module falls outside the check,
which is how the two `messages` calls outlived their endpoints. Verified
passing with both new routes.

⚠️ **`/licence-centre` had to join `PUSH_TITLE_INDEX_ONLY`** in
`lib/shell-routes.ts`, or that prefix swallows the subtree and heads every
application "Licence Centre" instead of its own name.

⚠️ **The page holds a `pending` map of unsaved edits separately from the
sheet**, cleared only AFTER the refetch lands. Clearing on the save's response
blanks the member's text for one frame, which reads as the form eating what
they typed.

⚠️ **`cards-row` stops prefilling the own-words box once the member types.**
Re-joining over their sentence would delete what they wrote, and that box is
the one place their own voice reaches a signed document.

⚠️ **The shelf's Add tile mounts the EXISTING `bulk-capture.tsx`**, which
already owns the picker, the phone hand-off and the re-file dropdown and is
tested where it lives. Phase 4 moves the file; Phase 3 did not rewrite it.

### What Phase 3 did NOT do

- **`witnesses` and the cover-photo chooser are not on the pack page.** Both
  components exist (`motivation-witnesses.tsx`, `motivation-cover-photo.tsx`)
  and both are in the §4 move list. The pack page renders the motivation, the
  271 summary and the take-to-SAPS list; the two chooser panels are a small
  follow-on rather than something to fake.
- **Nothing was moved out of `components/licence-pack/` or
  `components/motivation/`.** They are imported where they stand, exactly as
  SPEC-BUILD §4 says — a move plus a rewrite in one phase is how a regression
  hides. Phase 4 moves them.
- **The old screens are untouched and still work.** No redirects, no deletions;
  that is Phase 4 and a separate sign-off.

### The deploy — 2026-09-08, `7f2b2628`

Full deploy (the diff touches `backend/` and `prisma/`, so `--frontend-only`
was not an option). tsc clean both sides; backend **4041/4053**, frontend
**1561/1562**, 0 failed; frontend build exit 0 in the foreground with
`.next/BUILD_ID` present. `deploy.sh` clean end to end — backup
`alloutdoor-20260908-085731.dump`, backend health ×2, frontend health ×2,
warden reloaded and online, public site 200 ×2, three pm2 services online.

**Three migrations applied**, schema up to date: `MemberProfileAnswers` and
`MotivationResearch` created, `MotivationMessage` **dropped**. Verified on the
box: both new tables present, `MotivationMessage` gone, the one existing
motivation intact.

**All four redirects verified in production**, plus the one that must NOT fire:

| Path | Result |
|---|---|
| `/motivations` | 308 → `/licence-centre/applications` |
| `/licence-services/new` | 308 → `/licence-centre/applications` |
| `/motivations/:id` | 308 → `/licence-centre/:id` |
| `/licence-services/:id` | 308 → `/licence-centre/:id` |
| `/licence-centre` | 307 (session auth wall) — **still the Document Centre** |

### The mockup's two asks — 2026-09-08, `391e921c` + `91663c2d`

The operator sent `Licence Centre.pdf`, a mockup of the review sheet, with two
demands: build the live example on the left, and "there still is no proficiency
section with the links I asked for twice already, why???"

**The honest answer to the second one:** both earlier asks were answered
SERVER-SIDE. `motivation-autolink.ts`'s `enforcePair` attaches a competency and
its statement of results together and refuses one without the other, and
`agreeOnCategory` makes them match. A rule with no surface is a rule nobody can
see. The Competency section rendered four ANSWERS — number, covers, issued,
expiry — and never named the two DOCUMENTS behind them, so a member who had
never uploaded a statement of results saw a section that looked finished.

1. **`motivation-credential-slots.ts`** (new, pure) — the pair as one block:
   the class this application needs, what is attached (annexure letter and
   origin), how many the Document Centre could still supply, unit standard
   117705, and the one sentence saying a half is not enough. Wired into
   `sheetFor` as `SheetResponse.credentials`.
2. **`CredentialPair`** renders it in BOTH states, under the answers rather
   than instead of them. Three doors per half: **Add from your Licence Centre**
   (only when there is something behind it), **Scan it**, **Upload a file**.
   The Centre door opens the existing `LibraryPicker` on a list fetched THEN —
   `GET :id/library` already folds a two-page proficiency into one entry and
   respects the across-applications consent, and the sheet carries only a
   count.
3. **The section is titled "Competency and proficiency"**. The chip strip
   scrolls; the word being looked for is now on the screen.
4. **The live preview is docked.** The two-column grid is the page at `lg`, as
   SPEC-BUILD §3 and the mockup both have it, not a mode a toggle turns on. The
   drawer and its Preview button stay for the phone.
   ⚠️ **TWO MOUNTS, NOT ONE THAT CHANGES SHAPE** — a `fixed` ancestor is what
   stops `position: sticky` sticking, so an element that is a bottom sheet on a
   phone and a sticky grid child at `lg` scrolls away with the page.
5. **`91663c2d`** ranks the matching class to the top of the picker. It RANKS,
   never hides: `competencyCovers` gates the ATTACHING, where a wrong class is
   a refusal; this is the member choosing, and there the doctrine is "unknown
   is a yes". `neededLabel` moved to the `display` wording ("Manual Rifle", not
   "Rifle or carbine - manually operated") because that is what
   `derivedCredentialTitle` names the member's own vault rows with, and two
   vocabularies for one class match nothing.

**Verified live on MO000069** at 2133px: two columns with the prose beside the
form, "Competency and proficiency" in the strip, "The two documents behind it"
with a Handgun pill, three doors on each half, and the picker listing four
proficiencies folded to one entry each.

### The corpus, and what it moved — 2026-09-08, `58dc9448` + `03de411d`

The operator added `MOTIVATION-CORPUS-LEARNINGS.md`: ten motivations written by
paid writers, **nine approved by the CFR**. It moves the gate in both
directions at once.

**LOOSER, BECAUSE THE REGISTRAR IS.** The approved packs include a fourth 9mm
argued from a generic product comparison, a 1,200-word essay that never names
the applicant's own firearms, and an S15 whose existing-firearms section reads
"see attached". What carries a pack is the BUNDLE — dedicated status, an
endorsement for this serial, the association's exercise rules bound in,
competency, safe photographs, every claim pointing at an annexure. So rule 10
stops being a stop: `blockers` is now `warnings`, the paragraph is always
written, and the sheet shows the warning in the toast instead of handing
somebody a blank box.

**STRICTER, BECAUSE THE REAL REFUSAL TRIGGER WAS UNCHECKED.** The generator's
2026-09-07 output on the operator's own Glock application — still sitting in
`firearm_fit_reason` on the live site — described his **section 16** CZ as
"dedicated to backup use and close protection", invented a role for all five of
his firearms, named a **USPSA** division, and wrote like a catalogue. Not one
of those was caught.

- The defence vocabulary is refused on **every** section 15/16 paragraph. It
  was checked on the two hunting types and **not on section 16 sport**, which
  is the type that application was.
- A role may only be written for a firearm something on file gives a use for.
  ⚠️ **CHECKED BY ARGMAX ACROSS THE BATTERY, NOT BY OVERLAP** — a make and a
  calibre do not identify a firearm, and a first version accused every sentence
  about a CZ Shadow 2 because a roleless CZ P-10 C shared both. A tie
  identifies nothing and is not a match.
- Product-page vocabulary; divisions not shot in South Africa.
- 180-320 words in two paragraphs, because the battery sentence now names each
  held firearm with its calibre and section the way the packs' tables do.
- `exercise_eligibility` is the preferred angle.
- `03de411d` locks the live paragraph verbatim as a regression fixture, with
  one assertion per rule it broke.

⚠️ **THE BAD PARAGRAPH IS STILL ON MO000069.** The reason effect only fires
into an EMPTY box, so the stored one will not be replaced by itself. It is ours
(`DERIVED` + `inferred`), not the member's, so clearing it is safe — but it is
production data and the operator should say so.

### The rewrite, and the four rounds it took — `2d605562` → `c7439b2a`

The operator asked for the new paragraph, so `POST /:id/reason` was called
directly on MO000069 (the stored one was `DERIVED`, not `MEMBER`, so `stamp()`
allows the overwrite). Each generation revealed the next fault.

**Round 1 fixed everything the corpus named** — no defence words on a section
16 firearm, no invented roles, no USPSA division, no catalogue vocabulary, 204
words in two paragraphs, `warnings: ["roles_unconfirmed"]`. Two faults left:

- **The licence card shouts.** "a NORDISKE PRECISION 223 REM rifle licensed
  under section 16", because rule 13 says spell a make as the input spells it
  and the input is the card's own transcription. `proseFirearmName()` fixes it
  at the PROSE boundary only — same discipline as `answerValue()` and the
  card's "NONE". ⚠️ **Four letters or more**, so CZ, FN, ADP and REM survive,
  and a model designation ("T3X", "SP-01") is never touched.
- **It stated rules nothing can prove.** "restricted to pocket pistol events",
  "cannot meet the capacity requirements", "entry criteria ... up to twenty
  five metres". Plausible, probably true, supported by nothing in the pack.
  `association_activities[]` is now in the contract, empty, and its emptiness
  is ENFORCED (rule 16 + a validator that refuses a rule-assertion or an
  unsupported distance).

**Round 2 failed twice, and the cause was mine.** `exercise_eligibility` went
in as the PREFERRED angle while nothing can feed it, so the model chose it and
had every sentence it needed refused. One died on "restricted to"; the other,
told that, shrank to 167 words avoiding it and died on the floor.
⚠️ **The angle is withheld until `association_activities[]` is non-empty** —
the same rule as the "Add from your Licence Centre" door: do not draw a door
onto an empty list. The validator refuses it back too, not just the prompt.

**Round 3 wrote 202 words and passed**, but with five sentences each beginning
"I hold a" (a list, not a person) and — worse — **"authorized", "utilized" and
"recognized" on a document lodged with SAPS under an Act that spells it
"licence"**. Rule 8 had forbidden Americanisms since the first draft and
nothing enforced it. ⚠️ **The unambiguous spellings only**: "licence" is the
noun and "license" the verb in both registers, so "licensed under section 16"
— the commonest phrase in the paragraph — must never trip.

**Round 4 is what is on MO000069 now.** 193 words, angle
`division_differentiation`, `warnings: ["roles_unconfirmed"]`, one battery row
with commas the way the approved packs' tables read.

**`c7439b2a` raises the retry budget 2 → 3.** The spec says "retry once, then
fall back to the templated preview paragraph" — but there is no fallback
WRITE: a run that fails twice leaves the box empty, and the sheet latches on
`make|type` so it never tries again for that firearm. Six independent checks
against two attempts is a coin toss.

⚠️ **`223 REM` AND `9mm PAR` STILL READ ODDLY**, and that is the four-letter
rule working as designed: renaming a manufacturer is the failure, leaving one
shouty is merely untidy. A calibre normaliser is a separate job from a
case-fixer and would want the Bench's cartridge aliases behind it.

### The section it invented — 2026-09-08, `aa5d159b`

Operator, reading his own generated motivation: **"Howa in 6.5mm Creedmoor is
section 15."** The paragraph said "all licensed under section 16".

⚠️ **THE ARSENAL CARRIED NO SECTIONS AT ALL.** It has always been make, model,
calibre, type, serial and expiry — and rule 11, as written that morning, told
the model to name "the section it is licensed under" for every held firearm. It
did the only thing left and took the section of the APPLICATION. That is rule
12's own crime, asserting a fact nobody supplied, written into the prompt by
hand.

**The vault has always known.** `section` is in `WANTED.FIREARM_LICENCE` and has
been read off every licence card scanned since the Licence Centre shipped;
nothing had ever joined it to the owned-firearm rows.
`owned-firearm-sections.ts` does — **by SERIAL and never by make-and-calibre**,
because two of a battery can share both and picking the wrong one writes the
wrong section. A card placeholder ("NONE") is not a serial. Two cards
disagreeing about one serial means one was misread, so the row gets nothing.

Three guards, because absent must stay absent:

1. The prompt forbids taking a section from the application, from the other
   firearms, or as a blanket "all licensed under section N".
2. The validator refuses a section number no card and no application carries.
3. ⚠️ **NAMING THE RIGHT NUMBER IS NOT THE SAME AS BEING ENTITLED TO NAME IT.**
   "all licensed under section 16" passes (2) whenever the application IS a
   section 16 — the operator's exact sentence. So with no card section
   supplied, the paragraph may mention a section ONCE: the closing statutory
   line. It relaxes on its own the moment a card supplies one, which is the
   correct shape — the constraint is about what we do not know.

**Verified live.** The regeneration reads:

> I hold a Mauser in .30-06 Springfield and a Nordiske Precision in 223 REM
> under section 16, a Marlin in .45-70 Government, a Howa in 6.5mm Creedmoor
> under section 15, and a CZ in 6.35mm Browning under section 16.

Per-firearm, off the cards. ⚠️ **And the Marlin carries NO section, which is the
feature working** — its card did not match by serial, so nothing is claimed
about it.

### The section 13 audit — 2026-09-08, `144afd84` + `fb2b1ba4`

Walked MO000070 (S13, Kraaifontein) live: the sheet, the vault, the seller
consent and both data endpoints.

**⚠️ THE AUTOLINK SHUT 212ms AFTER THE APPLICATION WAS CREATED.**
`createdAt 18:52:17.572`, `autolinkedAt 18:52:17.784`. The run happens before
anybody has said what the firearm is, so `requiredEndorsement` is null, every
competency and proficiency the member holds is an equally valid candidate,
several-candidates correctly refuses, and the once-only stamp closes. The
operator attached his by hand from the dropdown.

⚠️ **AND I TOLD HIM OTHERWISE OFF EVIDENCE THAT COULD NOT SETTLE IT.**
`origin: vault` is stamped identically by the autolink and by
`addFromLibrary`, so the sheet cannot tell who copied a page. Do not read that
field as proof of either.

**A firearm reaches an application three ways and only one re-opened the
autolink.** `saveAnswers` clears the stamp when the endorsement moves — the
member TYPING it. `applyCardFirearm` (the seller signs) and the document-apply
path both call `prisma.motivation.update` and never touched `autolinkedAt`. On
a private sale the firearm arrives on one of those, so the stamp stayed shut
for ever. `endorsementMoved()` is now one pure predicate and all three ask it.

**ALL THE APPLICANT'S LICENCES.** Operator: *"ALL the applicants licenses must
be shown. there is even a section in the 271 where you have to list them all."*
`CURRENT_LICENCE` was in `NEVER_AUTOLINK` because it "names one specific
firearm" — true of a licence offered as EVIDENCE, false of the applicant's own
battery. Item 2.1 has fourteen rows and a DFO matches each against a card.
`TAKE_ALL_KINDS` attaches every one; one already attached does not close the
slot; the expiry cut is suspended (a licence lapsing in sixty days is still a
firearm they own, and omitting it makes the declaration false).

⚠️ **AND THAT CHANGED NOTHING UNTIL THE SECOND COMMIT.** The licences came
back not as skipped but as **nothing at all** — `wanted` was
`documentStatus(licenceType, [], {})`, an empty answers blob, which describes a
first-time applicant every time. `CURRENT_LICENCE` is a CONDITIONAL need
(required only once the applicant owns something), so it and every other
conditional kind were filtered out one line before the rules meant to decide
them. Verified live afterwards: five licences attached as annexure F, the
required need green.

### Item 2.1's serial columns — 2026-09-08, `4d1650b0`

The operator sent the form's own printed header and ruled on it:

| Type | Calibre | Make | Barrel Serial No | Frame/receiver Serial No | Licence/permit authorization No |

*"we only need to fill in the first 5 fields. the last one the
License/Permit number is if you have a storage permit for someone elses weapon
which is very uncommon, so we can leave that blank."*

**The barrel column went in empty on every row**, deliberately — "one answer
must not become two assertions", s120(9)(f) making a false statement an
offence. But a South African card prints the SAME number against barrel, frame
and receiver in the ordinary case, so an empty box the applicant would fill
with a pen is work handed back to them. Both columns are filled now; where the
second is a copy, the pack says so and asks them to check it against the card.
The licence column stays blank and is deliberately NOT reported — an empty box
there is the ordinary answer.

⚠️ **AND THE CARD'S "NONE" WAS BEING THROWN AWAY BEFORE IT REACHED THE FORM.**
Operator: *"we need to insert NONE if the barrel serial said NONE. DO NOT LEAVE
A NONE BLANK EVER unless I tell you to."* The owned-row offer read the serial
through `first()`, which runs `answerValue` — so a card printing NONE against
the barrel and a number against the receiver arrived as that one number with
the NONE gone. The form then either went in blank or took the receiver's number
into the barrel box, which is the false statement the old rule existed to
prevent, arriving from the other side.

The two component rows are now offered **verbatim** off `details`, not through
`first()`. NONE against a component is the card being COMPLETE, and a DFO
comparing form against licence must find the same word in the same place.

⚠️ **THEY ARE STILL NOT FORM FIELDS.** `_barrel_serial` and `_frame_serial`
were collapsed into `_serial` so nobody types three serial boxes a row; they
stay accepted through `fieldByKey`, which is what lets them be stored without
rendering anything. Nothing asks — we read them off the card, or we hold
nothing and the row's one serial stands in for both.

### The three component makes — 2026-09-08, `dedfcf3b`

Operator, holding his own card: *"all the information is on a license card. All
of them will always have it. It will either be a serial next to every component
or NONE, but it will never be empty."*

⚠️ **THERE ARE FOUR "MAKE" LABELS ON A LICENCE CARD AND `LABELS` HAD ONE.** The
lower block is three rows of `<component> Serial No <value>  Make <value>`. The
first band to match MAKE won, so the firearm's own Make row claimed it and the
barrel, receiver and frame makes were **never read at all**. Everything
downstream was already correct — the consent stores what we read,
`cardToApplicationFirearm` maps all six, section E of the 271 has boxes for
them — so the 271 printed three empty Make boxes beside three filled serials.

**A MAKE is resolved by what else is in its band**, not by a fourth entry in
LABELS: the label text really is identical and what tells them apart is the
row. A MAKE preceded in its own band by a component serial is that component's;
the bare `Make GLOCK  Model NONE` row has no serial label before it and stays
the firearm's. The reassignment walks BACKWARDS within the band only, so a band
holding just `Make X` cannot inherit a component from the row above.

⚠️ **AND A SHORT READ IS SAID OUT LOUD NOW.** The card cannot be short — that is
structural, not a hope — so a missing component is OUR read failing (a glare
band across the lower block, a photograph cropped below the frame row) and not
a card that did not carry it. The seller types it either way; the log is so we
find out it is happening.

⚠️ **MO000070's CONSENT SNAPSHOT IS STALE.** It was read by the old parser, so
it still holds no component makes and `barrel_make` / `frame_make` /
`receiver_make` are still empty on that application. Nothing backfills a signed
consent. Either the member types the three makes into the "Barrel, frame and
receiver" fold, or the consent is deleted and re-sent (`deleteSellerConsent`
exists for exactly this).

### The areas surface — BUILT, 2026-09-08, `116511d1` → `b3db048f`

The operator's design, in four messages, and it is now live end to end.

**Backend** (`116511d1`). `motivation-danger-areas.ts` is pure: roll incidents
up by place, one incident landing in every area it names, two spellings folding
into one, a place too big to drive through dropped (or the commonest area is the
whole metro), nearest report wins the distance, an unplaced area sorting LAST
because "we do not know where this is" is not "next door", capped at twelve.
`GET :id/areas` at **50 km** — this asks where they DRIVE, and a radius that
cannot reach their workplace cannot offer the areas between. Each area carries
its own SAPS station, one geocode each, every one failing alone.
`POST :id/areas` takes keys and reasons and derives the clippings SERVER-SIDE,
spending the cap **area by area** so every ticked area is represented before any
gets a second. `travelled_areas` is the answer; `press_clippings` is the
consequence.

⚠️ **AND MOUNTING THE UI IS WHAT MADE THE ANNEXURE REACHABLE.**
`press_clippings` is internal; its registry comment says the wizard writes it
once the member has picked, and Phase 4 deleted that wizard. The endpoint
worked, the writer supported it, the pack had a letter reserved, and nothing
could set the value.

**The "OR Tambo" fault, and the fix I got wrong first** (`9c0160b0` →
`80e182fa`). A Kraaifontein applicant was offered the area "OR Tambo". Bare, it
resolved to **Edenvale** — a Gauteng precinct on a Western Cape application,
obviously wrong, and the system saying so. I anchored the geocode to the
applicant's province on the reasoning that place names are not unique here. It
then resolved to **Philippi East** and looked entirely plausible. The article
was *"Man arrested at OR Tambo with suspected cocaine en route to Hong Kong"* —
the Johannesburg airport, in a Cape Town community paper.

⚠️ **ANCHORING CANNOT TELL "THIS PLACE IS IN THE WESTERN CAPE" FROM "I TOLD IT
TO ANSWER WITHIN THE WESTERN CAPE."** It laundered the error instead of fixing
it, and removed the one signal that anything was wrong. Reverted; the province
mismatch — already there, already correct — drops the area.

⚠️ **AND `distanceKm` IS MEASURED FROM THE ARTICLE'S STORED POSITION, WHICH FOR
A SYNDICATED PIECE IS THE PAPER'S PATCH.** An airport arrest in Gauteng arrived
22.7km from a Kraaifontein front door. The province check is currently the only
thing in the chain that knows better — so a Gauteng story, in a Gauteng paper,
about a Gauteng place would pass every filter. That is a news-layer accuracy
problem, not an area-list one, and it is not fixed.

**Frontend** (`eab19c13`). `DangerAreas` renders in "Your case": the reason box
appears only AFTER the tick (eleven empty boxes is a form; one box under the
thing they just said yes to is a question), each row carries the report count,
crime types, distance, the police station whose figures the pack annexes, and
the headline. The draft is seeded ONCE — re-seeding per render would wipe a
half-typed reason whenever an unrelated answer landed. An empty list explains
itself. Its own fetch, keyed on the station, because building the list geocodes
every area and the sheet refetches after every answer.

**The workplace autofill** (`b3db048f`). `employer_address` is kind `long` and
fell to the textarea branch — the control the Maps autofill replaces, two rows
below one that had it. ⚠️ It is also the input the ROUTE half will depend on: a
hand-typed workplace makes that lookup fail silently.

### The three that were open — CLOSED, 2026-09-08, `9b3e46d2`

1. **The route.** `motivation-route.ts` decodes Google's polyline and tests each
   area against it. ⚠️ **Against the SEGMENTS, not the vertices** — Google thins
   a polyline on long straights, so two points can be tens of km apart on the N1
   and a suburb halfway along is far from both while sitting on the road they
   drive daily. ⚠️ **The area's own coordinates, not the article's** — that is
   how a Gauteng airport arrest arrived 22.7km from a Kraaifontein front door.
   ⚠️ **The first route only**; the union of every way Google can get there
   ticks roads nobody has driven. ⚠️ **Every failure is the same outcome: no
   pre-ticks** — no key, no work address, a quota error, a 6s timeout, and the
   member is asked exactly as before. ⚠️ **AND THE PRE-TICK STOPS ONCE THEY
   ANSWER** (`answered` on the response): a member who unticks an on-route area
   has said Maps drew a road they do not take, and `onRoute` is still true next
   load — without the flag the tick returns for ever, which is "why can't I
   delete the proof of address?" arriving as a helpful default.
2. **Venue noise.** `isVenue()` drops one-building places. ⚠️ **A mall is
   deliberately NOT on the list** — a centre car park is exactly where a
   hijacking happens and somewhere a member goes weekly. Nor is "Station",
   far too load-bearing in SA place names.
3. **The ticked areas' figures reach the pack.** The home station is where they
   sleep; this is where they spend the day. ⚠️ Every line came off the member's
   own tick, which is what makes another precinct's numbers admissible about
   THIS applicant, and **the reason they gave travels with it**. Three at most —
   twelve stations of quarterly tables is a spreadsheet, not evidence. Stations
   are re-resolved at generation rather than stored, so a corrected address
   cannot leave a frozen precinct behind.

### ⚠️ Still open

- **Crime type is not filtered.** An "other" incident can be a drug bust — but
  "other" also carried a legitimate snatch-thief report on the live list, so
  dropping the type wholesale would lose real evidence. Deliberately left.
- **`distanceKm` is the article's position, not the event's.** A syndicated
  piece carries the paper's patch. The province check is the only thing that
  catches it, so a Gauteng story in a Gauteng paper about a Gauteng place would
  pass every filter. News-layer accuracy, not an area-list problem.

### ⚠️ MO000070 was deleted by the operator, 2026-09-08 ~22:42

Accidentally, and the delete worked exactly as built — answers, uploads and the
seller consent gone, Document Centre untouched (20 credentials survive).

**The operator chose to start a fresh application rather than restore.** The
rollback point exists if that changes:
`/var/backups/alloutdoor/db/alloutdoor-20260908-224005.dump`, taken by deploy.sh
for `eab19c13` minutes before the deletion, 14-day retention. Never restore over
production — a scratch database, then lift the rows.

⚠️ **THE SAFE PHOTOGRAPHS EXIST NOWHERE ELSE, AND THAT IS THE LESSON.** They
were `origin: member` and had never been saved into the Document Centre: the
consent-based keep flow shipped that morning means nothing is copied unless the
member ticks and saves. Four photographs, gone with the application.

⚠️ **SO THE SHELF'S "SAVE TO YOUR LICENCE CENTRE" IS NOT A CONVENIENCE, IT IS
THE ONLY BACKUP A MEMBER HAS.** Nothing on that screen says so. A member who
deletes an application still believes their documents are kept, because the
delete copy tells them their Document Centre is not touched — which is true, and
is exactly why the photographs that were never IN it are the ones that die.

### The clippings surface — the operator's design, NOT YET BUILT

Two messages, 2026-09-08, and together they are the spec:

1. *"you can add clippings of surrounding dangerous areas if the user travels a
   lot. Or you can pull the areas and list them and ask the user if he travels
   through these areas regularly."*
2. *"we could also use the work address and google maps routes to see through
   which areas they travel and link it that way?"*

So the surface is **not a list of articles to tick**. It is:

- `GET :id/incidents` already returns each incident's `places[]` and
  `distanceKm` (verified live: "Jakkalsvlei Avenue", "Jakes Gerwel Drive",
  "Edgemead" at 19.1 km from Kraaifontein).
- Roll those up into AREAS, list them, and ask "do you travel through these
  regularly?" — which is a question the applicant can answer honestly and which
  a DFO can weigh, where a raw article list is neither.
- The answer selects the clippings, so `press_clippings` finally gets written
  by something. It is `internal`, and the registry comment already says "the
  wizard writes the value itself" — the wizard Phase 4 deleted.
- Tier 2: `residential_address` and `employer_address` are both on the form, and
  `GOOGLE_MAPS_API_KEY` is already in the env. A route between them gives the
  areas travelled without asking at all, which is the "automate it — do not
  ask" rule applied to the one S13 question that is genuinely hard to answer
  from memory.
- It ties to `s13_movements` and `daily_movements`, which exist and are already
  answered on MO000070 ("restaurants, camping, hiking, hunting").

⚠️ **AND THE DISTANCE FILTER WANTS A LOOK.** 19 km from the applicant's own
precinct is a different suburb, and a clipping about Dunoon on a Kraaifontein
application is the kind of padding the corpus doc says not to copy.

### It refused to write, and said so nowhere — 2026-09-08, `25aa11a1`

Operator: *"It wont create the motivation. Al sections says their done."*

`POST :id/generate` answers **409 "Please confirm the declaration before we
prepare the document"** — a gate that has always existed, behind a wizard screen
Phase 4 deleted. Every section read Done, `missing` was empty, the button was
enabled, and the click failed.

⚠️ **AND THE FAILURE HAD NO VOICE.** `onWrite` put the message into `error`,
which the render only shows when `sheet` is null — the load-failure state. With
a sheet on screen that branch is unreachable, so the 409 went into a variable
nobody renders. It failed silently every time, with the server saying exactly
what was wrong.

The footer asks now: one tick in front of the button, appearing only once
everything else is answered (a declaration over a form with eleven blanks asks
somebody to swear to answers they have not given). `declarationAcceptedAt` is
served on the sheet so it asks once and never again. A refusal goes to the
TOAST; `error` is for "we could not load your application" and nothing else.

⚠️ **AND THE GATE SPEC PROVED THE WRONG THING.** "opens the button once every
required row is answered" passed throughout — the button opening was never the
same as the document being draftable, and that gap is precisely what shipped.

### Also fixed in the same run

- **`Model NONE` shows and counts as answered.** The sheet ran `answerValue()`
  on every displayed field, so a card printing "Model NONE" rendered blank and
  read `needs_you`. ⚠️ Scoped to VAULT/READ/SELLER provenance: a placeholder is
  a real answer when a document is what said it, and `answerValue` still guards
  every OFFER boundary. Verified live — the seller's card block now reads
  Model NONE with all three component makes populated.
- **Overlap angles are filtered by section.** Sixteen were served to every
  licence type; five argue the sport and four argue hunting. The operator's own
  S13 carried `different_division` because "a different division of the sport"
  was on the screen of a self-defence application, and the tapped sentence goes
  into the document verbatim. `backup` no longer says "does not end my season",
  and S13 gains `concealable` / `home_and_carry`, which it had no way to say.

### ⚠️ What the S13 audit found and did NOT fix

1. ~~The seller's component makes are never read~~ — **FIXED**, `dedfcf3b`.
   See "The three component makes" above. MO000070's own snapshot is stale and
   will not backfill.
2. **Press clippings are unreachable.** `ClippingsPicker` and `PrecinctCard` are
   built, tested and **mounted by nothing** — Phase 4 deleted the wizard that
   mounted them. `press_clippings` is `internal`, and the registry comment says
   "the wizard writes the value itself". So the annexure can never be produced.
   Crime stats DO reach the document (generation pulls them from
   `police_station`), but the member never sees them.
   ⚠️ **OPERATOR'S DESIGN FOR IT, 2026-09-08:** *"you can add clippings of
   surrounding dangerous areas if the user travels a lot. Or you can pull the
   areas and list them and ask the user if he travels through these areas
   regularly."* So the surface is not a list of articles — it is the AREAS off
   the incidents, offered as a question, with the clippings following from the
   answer. It ties to `s13_movements` and `daily_movements`, which already exist.
3. ~~`existing_firearm_N_licence_no` is empty~~ — **NOT a gap.** Operator,
   2026-09-08: that column is for a storage permit over somebody else's
   firearm, which is very uncommon. Blank is the correct answer and it is
   deliberately not reported. See item 2.1 above.
4. **Dead fields.** `home_dialling_code` and `work_dialling_code` are read by
   NOTHING — `saps271-map.ts` derives the code itself with
   `splitTelephone(home_telephone)`. The postal codes ARE printed and stay.
5. **The employer block is not gated.** `occupation` is "Self employed" and the
   form still asks for employer name, address and postal code, with help text
   saying to leave them blank. `occupation` is free text so `showIf` equality
   cannot fix it.
6. **Safe photographs are not in the vault** — 20 credentials, zero safe photos.
   That is the consent flow working as instructed this morning ("stop auto
   copy"); the route in is the shelf's tick plus Save.
7. **"Ready to write" while a required document is missing.** `missing` counts
   answers only; the pack's document needs are a fourth view nobody reconciled.
8. **`firearm_model` is stored "NONE" and rendered blank**, so a finished row
   reads as outstanding.
9. The preview still prints owned firearms in card case ("MAUSER in .30-06
   SPRINGFIELD") — `proseFirearmName` is applied to the reason generator's input
   only.

### ⚠️ What the corpus asks for that is NOT built

`exercise_eligibility` is available and **unfed**. The prompt tells the model to
fall back to type ("none of my rifles can be used in a handgun exercise"),
which is still true and still provable, but the angle's whole strength is the
association's printed equipment rule. Brief §5.5a is the work:

1. **`association-activities.ts`** — per SAPS accreditation number (SAHGCA
   400001 hunting / 1300091 sport, Natshoot, SAPSA, CHASA, ...), every exercise
   with its **eligibility rule verbatim** (calibre floor, barrel length, action,
   box-to-fit), which status it counts toward, source URL, `verifiedAt`. Seed
   from natshoot.co.za and sahunters.co.za; **operator reviews before it ships**.
2. **`ASSOCIATION_ENDORSEMENT` reading** — the SAHGCA form (member no,
   dedicated no, status type, the firearm row, EN number, issue date), linked
   to the owned firearm by serial. An owned firearm's endorsement becomes its
   `primary_use` with provenance `READ`, which is also what feeds `roleless`.
3. **A `section` on each owned-firearm row.** Rule 11 is enforced today as a
   whole-paragraph ban on defence words in a section 15/16 motivation, which is
   correct but blunt. Per-firearm sections would let it be scoped to the
   sentence, and would let the battery sentence print "(section 16, dedicated)"
   as the approved packs' tables do. The registry has no such field; the
   vault's `FIREARM_LICENCE` credentials do.
4. **The exercise-rules annexure**, the battery table with a status column
   (including a disclosed "reported stolen, CAS ..."), and Engala's cover
   checklist as page 2.
5. **`previous_motivations[]`** still travels empty — nothing stores an
   approved application's angle, stated purpose or outcome.

### The reason generator — 2026-09-08, `eeabdea0` → `f3259e56`

Implements the operator's `MOTIVATION-REASON-PROMPT.md`: system prompt,
per-section angles, method, output shape, validator, fallback example banks.
**Verified live on MO000069** — angle `division_differentiation`, 172 words, no
blockers, all five held firearms named with roles before the gap is argued.

⚠️ **THREE THINGS IN THE SPEC DO NOT MATCH THIS CODEBASE**, all recorded at the
top of `motivation-reason.ts`:

1. **There is no "writer tier (Anthropic)".** One adapter, `LlmService`;
   `LLM_PROVIDER=anthropic` is a global **rollback lever**, not a per-call
   choice. This runs on Gemini.
2. **"No structured-outputs API (repo rule)" is the OLD rule, reversed.** Reads
   use `json: { schema }`; hand-parsing a fenced block would be a step
   backwards. No grounding — the research arrives already fetched, which is also
   what keeps the call legal on Gemini, where grounding and json cannot combine.
3. ⚠️ **`previous_motivations` HAS NO STORE.** Nothing records an approved
   application's angle, stated purpose or outcome. The field travels **empty**
   rather than omitted, so the prompt reads it as "first application" and the
   day a store exists only the filling changes. **It is the most valuable idea
   in the document and the only part that is net-new work.**

⚠️ **THE OUTPUT LANDS ON `firearm_fit_reason`** — the field that was `required`
until 2026-09-08 and was "the largest single reason an application stalled: it
asked the applicant to write the argument the product exists to write for them".
Stamped `DERIVED` + `inferred`, so the sheet renders it **`suggested`** and
`stamp()` refuses to overwrite a paragraph the applicant has written. Fired once
per application from the sheet, only while the box is empty — which is what
bounds the bill.

**Three corrections to the spec's validator, every one found live:**

- ⚠️ **"automatic (unless semi-automatic)" as a substring test refuses every
  legitimate self-loading firearm.** Checked after `semi-automatic` is removed.
- ⚠️ **Banning `"match"` on a section 13 paragraph also catches "matches the
  description"**, and `"protect"` catches "protected species". Word boundaries.
- ⚠️ **THE MODEL'S OWN WORD COUNT IS NOT A SAFETY PROPERTY.** Two live
  generations claimed 218 words for paragraphs of 176 and 196. The length rule
  is enforced against a **real** count; whether the model can also do the
  arithmetic is our problem. Corrected, not rejected.

⚠️ **AN EXAMPLE IS DROPPED, NEVER FATAL — THE PARAGRAPH IS THE PRODUCT.** A
generation was lost because a label read "SAPSA Provincial Matches" and
"matches" was not among the supplied terms. The test is **acronyms only** now:
what it guards against is a body we never mentioned ("IDPA Stock Service Pistol"
for an IPSC shooter), and that failure is always an acronym.

⚠️ **A RETRY THAT RE-SENDS THE IDENTICAL PROMPT IS A DICE ROLL.** The second
attempt is told what was wrong with the first; the rejections are already
written for a person, so they are already the right feedback. First live run
offered "collecting" as a reason and the retry dropped it.

⚠️ **AND ONE BUG OF MY OWN, CAUGHT BY ITS OWN TEST:** the held-firearm token
filter dropped anything under three characters, excluding **"CZ"** — one of the
commonest makes in South Africa — so a paragraph correctly naming the
applicant's own CZ was rejected as naming a firearm they do not hold.

**Worth knowing about the output:** with no `primary_use` answered, every role
in the paragraph is *inferred* — the prompt permits that only when no stated
role exists, which was the case. It is why the result is a suggestion the member
confirms rather than an answer.

### Finishing the 2026-09-08 list — `39171000` → `2f418727`

⚠️ **THERE IS NO "SELECT ALL" CONTROL ANYWHERE IN THIS CODEBASE.** "It selects
everything if you sign" is a plain **text selection**: a drag across a signature
pad or a scanner's corner handles starts a selection in the page underneath.
The rule is in `globals.css` and covers `canvas`, `.aos-root`,
`[data-blocking-overlay]` and `.gg-drag-surface` — ⚠️ **global because it has to
reach the vendored scanner**, which must never be edited here. `.gg-selectable`
opts text back in.

**The seller's address** is an `AddressAutocomplete` that also fills the postal
code beside it, with **"Type my address in parts instead"** opening street /
suburb / town / province. ⚠️ **A second door, not a fallback** — Places does not
know every smallholding or farm, and the parts are stored **beside** the
one-line address because Part F prints a single line.

⚠️ **THE AUTOMATIC SWEEP INTO THE DOCUMENT CENTRE IS GONE.** Every upload was
copied the moment it landed, behind a blanket consent, with no UI — a member
could not see what had been kept, could not decline one page of six, and the
swallowed `void ... .catch()` left no trace of a refusal.
`VaultAdoptionService.keepChosen` behind `POST :id/keep-in-centre` is the only
route in, and it reports **`needsConsent`** rather than failing quietly. On the
shelf: a tick on every page the MEMBER added, Select all, one Save button. A
`vault` page carries no tick — it is already there.

⚠️ **A TICK ON "TAKE THESE WITH YOU" USED TO MEAN "NOTHING TO DO", AND IT MEANT
THE OPPOSITE.** Everything we hold prints into the pack as an annexure, so a
ticked row is a job WE have done and an **original** the applicant still has to
carry. Struck through it read as "leave this at home", which is how somebody
arrives at a DFO without their competency certificate.

⚠️ **`invite()` HAD BEEN NAMING AN ACTION THAT DID NOT EXIST** — "Delete that
consent first if you need a new one". `DELETE :id/seller-consent` exists now,
and **the bytes go with the row**: a signed consent holds somebody else's
licence photographs and signature, given for one purpose, so deleting the record
and keeping the files is the worst of both. It takes the annexure upload rows
too. **The preview is the pack's own words** — `declarationFor`,
`firearmRowsFor`, `signedLineFor` — so it cannot disagree with the document.

### ⚠️ NOT DONE: the bottom bar over the camera

Could not identify it. The V3 overlay sets `z-index: 2147483000` in its own
stylesheet, which **is** imported and **is** in the built CSS; it handles
`env(safe-area-inset-bottom)` on its action bars; and every piece of our chrome
sits far below it — the tab bar at 55, the SW update banner at 58. Nothing of
ours can be on top of it. Remaining candidates are the mobile browser's own UI
or something device-specific. **Needs a screenshot from the phone.**

### `MOTIVATION-REASON-PROMPT.md` — usable, with three corrections

Operator-supplied spec for a "why this firearm" generator. Sound, and mostly
adoptable as-is: the system prompt, the allowed angles, the output JSON, the
validator and the per-type example banks. Three things in it do not match this
codebase:

1. ⚠️ **"the writer tier (Anthropic)" does not exist.** One adapter, `LlmService`;
   `LLM_PROVIDER=anthropic` is a global **rollback lever**, not a per-call tier,
   and `ANTHROPIC_API_KEY` is rollback-only. This call runs on Gemini.
2. ⚠️ **"no structured-outputs API (repo rule)" IS THE OLD RULE, REVERSED.** Reads
   now use `json: { schema }` so the provider enforces the shape. Fenced-JSON
   parsing would be a step backwards. (Note `grounding` and `json` still cannot
   combine on Gemini — fine here, this call does no search.)
3. ⚠️ **`previous_motivations` HAS NO STORE.** Nothing records an approved
   application's angle, stated purpose or outcome; the storyline needs a new
   model and a migration. It is the most valuable part of the document and the
   only part that is net-new work.

### The seller's card, all of it — 2026-09-08, `aa4368bc` → `5e9c70fb`

⚠️ **`cardToApplicationFirearm` MAPPED SIX FIELDS AND THE CARD HAS TWELVE.** The
snapshot has carried `barrelSerial`, `frameSerial`, `receiverSerial` and their
makes since `CARD_FIELD_KEYS` was written — the seller photographs the card, the
OCR reads every row, the consent stores all of it — and **the map to application
keys simply did not hand them over.** So the applicant confirmed a make, a model,
a type, a calibre and one serial, and **section E of the SAPS 271 stayed empty**:
exactly the paperwork the consent exists to produce. It also dropped every
"NONE", the fourth and last boundary doing that.

⚠️ **`primarySerial` STILL SKIPS PLACEHOLDERS, AND MUST.** It is a fallback
CHAIN picking the one number that identifies the firearm; a NONE that returns
instead of falling through is how a card with a real receiver number yields no
serial at all. **Transcribing a row and picking a serial are different
questions** — the same reason `first()` and `ownedFirearmSerial()` are untouched.

⚠️ **A SERIAL THE OCR RAN INTO THE LABEL BESIDE IT.** Found while verifying:
the operator's Glock came back as **`ZABA01892 VUURWAPEMLISENSIEN`** — the number
plus a misread of VUURWAPENLISENSIE, the Afrikaans for "firearm licence", bled
in from the heading. The barrel, frame and receiver rows all read a clean
`ZABA01892`. `cleanSerial` **only trusts evidence from the card itself**: a token
is kept where a COMPONENT ROW reads exactly that, because a licence routinely
repeats the one number across the three rows, which makes them a second opinion
rather than a guess. Without that agreement the value is untouched — deciding
which half of an unfamiliar string is the serial is how a real serial containing
a space gets truncated.

⚠️ **"THEIRS WINS" MEANS THE MEMBER'S, NOT A PREVIOUS READ OF THE SAME CARD.**
The adopt was offered once and then hidden for ever, because it OVERWROTE
everything. It now fills a field only when the member did not type it — so a
second adopt is harmless, the panel offers again whenever the card **disagrees**
with what is held, and a read we have since corrected can replace itself. The
server's `stamp()` refuses to overwrite MEMBER provenance anyway; the client
agrees with a rule that already existed rather than inventing one.

**Verified on production against MO000069:** `firearm_serial` `ZABA01892`, all
three component rows, `firearm_model` `NONE` kept, and the adopt block offering
eight rows with the licence photograph beneath it.

### Still owed from the operator's 2026-09-08 list

**Consent form:** the bottom bar over the camera — ⚠️ **the scanner marks itself
`data-blocking-overlay` and NOTHING IN THIS APP CONSUMES THAT**, though its own
z-index is 2147483000, so the likelier culprit is the SW update banner at z-58,
which is fixed to the bottom of every route; the address wants Google autofill
plus a sectioned manual fallback; and ⚠️ **a drag on the signature pad selects
the page text** — there is no "select all" control anywhere, so "it selects
everything if you sign" is text selection, wanting `user-select: none` on every
drag surface.

**Documents:** select / select-all to save member-added documents into the
Licence Centre with consent, the autolink's `skipped` list being the other half
of that surface; the take-with-you list saying "we have put a copy in your pack,
bring the original"; and consent delete + preview.

### One "What this one will be" — 2026-09-08, `047fce9c`

⚠️ **THE SHEET ASKED ONE QUESTION TWICE.** `overlap_angle` is a registry row in
the firearm section **and** `OverlapCard` rendered the same key near the top
with its own copy of the tiles. Two headings, two controls, one answer —
operator: *"There is two What this one will be. One at the bottom and one that
pops up when selecting the firearm type."*

**The registry row won**, and the reasons are worth keeping: it is the only one
carrying the own-words box, and it sits where the section orders it rather than
appearing beside the source answer — which is what *"where it popped up doesnt
seem right"* was about. OverlapCard's prompt moved onto `CardsRow`; the
component is **deleted**, not left orphaned.

⚠️ **THE RULE IT CARRIED OUTLIVED IT.** OverlapCard rendered itself away when
there was no overlap, so nobody is asked why they want this one *as well* when
they hold nothing. That now lives in `stateOf` — the only visibility decision in
the system — and the new label makes it matter more, not less.

Labels tell the two sets apart: **"Why this one as well as the ones you hold"**
for the firearm applied for, against **"What it is for"** on one already held.
`OVERLAP_ANGLES` 7 → 16 and `PRIMARY_USE` 11 → 19. Past eight options the tiles
sit in a bordered scroller; under it they stay a plain grid, because a scrollbar
round four options is chrome for its own sake.

⚠️ **A COUNT ASSERTION PINNED TO A LITERAL BROKE THE MOMENT THE SET GREW.**
`motivation-overlap.spec.ts` read `toHaveLength(7)`; it reads
`OVERLAP_ANGLES.length` now. What that case is about is that nothing is
filtered, and the line above it already said so.

### Still owed from the operator's 2026-09-08 list

**Consent form:** the bottom bar sits over the camera; the address wants Google
autofill plus a sectioned manual fallback rather than one box; and ⚠️ **the
scanner's "select all" ticks the signature and declaration boxes too** —
operator: *"make this universal for every scanner"*.

**Documents:** select / select-all to save member-added documents into the
Licence Centre **with consent**, the autolink's `skipped` list being the natural
home for the other half of that surface; the take-with-you list saying "we have
put a copy in your pack, bring the original"; and consent delete + preview.

### Typing, pills, and the consent capture I broke — 2026-09-08, `15f6e2c3` + `245db6e2`

⚠️ **NO FIELD ON THE SHEET COULD BE TYPED INTO BY HAND.** The page merges
pending edits back over the server's values, so a keystroke changes
`item.value` — and `SheetRow`'s reset effect, written to close an editor when a
document READ moved the value underneath it, could not tell that apart from the
member's own typing. Tap Change, press one key, the box shuts. A `needs_you` row
had the same cause with a different symptom: it is open because of its STATE, so
when the debounced save flipped it to `filled` the control collapsed mid-word.
A `touched` ref now holds the row open until the member leaves it.

**Section pills** are drawn inside `SheetSection` and the page passes a NUMBER.
It was `meta?: React.ReactNode` with every caller building its own span, which
is how two sections end up with two ideas of what "done" looks like.
⚠️ **`color-mix` for the amber, never `var(--warning)` + an alpha** — that is two
tokens, not a colour, and there is no `--warning-wash`. A test asserts the class
carries `color-mix` so nobody "tidies" it into the broken form.

⚠️ **THE V3 SWAP BROKE THE CONSENT CAPTURE, AND THE WRAPPER HAD NO SPEC.**
`licence-card-capture.tsx` was built around V2's contract: finish() called
`onClose()` and THEN `onDone()`, synchronously, **one file at a time**. **V3
collects PAGES, hands them over in a single `onDone(files)`, and never calls
`onClose()` at all.** One mismatch, three reported symptoms:

| Symptom | Cause |
|---|---|
| "the camera does not automaticly return to the form" | nothing closed it; V2's finish() used to |
| the back silently dropped | the wrapper took `files[0]` and nothing else |
| "it won't submit" | `photographed` is `!!front && !!back`, so the button stayed disabled forever |

`handleDone` understands both contracts now, closes explicitly, and **takes two
pages and no more** — a third page is not a third side. Both passes say "two
pictures" in the scanner's own header.

⚠️ **WHEN SWAPPING A SCANNER, READ ITS finish(). The two do not agree**, and
nothing in the type system says so: both satisfy `DocumentScannerProps`.

### Still owed from the operator's 2026-09-08 list

**Consent form:** the bottom bar sits over the camera; the address wants Google
autofill plus a sectioned manual fallback rather than one box; and ⚠️ **the
scanner's "select all" ticks the signature/declaration boxes too** — operator:
"make this universal for every scanner".

**The firearm section:** the own-words box under the reason cards does not say
what it is for; and there are **two headings reading "What this one will be"**
— the overlap card and the owned-firearm purpose set — which need distinct
wording, far more realistic options, and a scrollable select styled to the
theme.

**Earlier and still open:** select / select-all to save member-added documents
to the Licence Centre with consent (the autolink's `skipped` list is the natural
home for the other half); the take-with-you list saying "we have put a copy in
your pack, bring the original"; and consent delete + preview.

### Sheet fixes round 3 — 2026-09-08, `6e1eef04` + `53c11e0f`

⚠️ **SIX PREMISES QUESTIONS WERE FREE-TEXT BOXES.** "Is there an alarm?", "Do
you have armed response?", "Are there burglar bars?", "Are there security
gates?", "Do you have the prescribed safe?" and "Is it mounted?" are all
`yesno` in the registry and `Control` had **no branch for that kind**, so every
one rendered as an empty text field. Declarations never hit it — the page
routes that whole section to `DeclarationRow` — which is why it went unseen.

⚠️ **THE ADDRESS PICKER NEVER RENDERED, AND THE REASON IS A RULE WORTH KEEPING:
A KEY TEST BELOW A KIND TEST ONLY CATCHES THE KINDS NOTHING ELSE CLAIMED.**
`residential_address` is kind `long`, so `ADDRESS_KEYS.has(item.key)` sat below
the textarea branch and was unreachable. The member got a plain multi-line box
and Google Maps was never loaded. Caught on production: the built bundle had
the Maps loader **and a real key**, and no `<script>` tag ever appeared —
because the component that injects it was not on the page at all. The branch is
first now; two specs pin it.

Also: **"Are you the main licence holder"** → **"Will you be"** (they are
applying, not holding); the declarations pills line up right (they needed
**both** `w-full` and `ml-auto` — without the first the block sizes to its
content, without the second they fall left the moment they wrap on a phone);
section headers carry a `--red-wash` band with a `--red-line` keyline, bled into
the gutters. **The wash is on the HEADER, not the section** — tinting the
section would put colour behind every input in it.

**Verified on production against MO000067:** header background
`rgba(200,16,46,0.09)`, **10 yes/no buttons and 0 text inputs** in Premises, the
future tense, and the address row opening a real `<input>` prefilled with the
member's address with `.pac-container` live.

⚠️ **THE SERVICE WORKER SERVES THE OLD BUNDLE UNTIL "Reload" IS TAPPED.**
`skipWaiting: false` is deliberate, and it means a fresh `navigate` in a
verification pass gets the PREVIOUS build. Three rounds of "the fix is not
there" were that. Click the update banner's Reload first, then check.

### Still owed from the operator's 2026-09-08 list

1. ⚠️ **Delete the seller consent, and preview the consent form.** No applicant
   -facing delete endpoint exists — `motivation-seller-consent.service.ts`
   already tells members to "Delete that consent first if you need a new one",
   naming a control that is not built. Preview needs a render of the signed
   page before it reaches the pack.
2. ⚠️ **Proficiencies, and documents filing both ways.** The correct
   proficiencies must be addable from the Licence Centre, scanned, or uploaded;
   **anything attached to an application must also be filed in the Licence
   Centre**; and every document wants its own add control plus an "add all".
   Today the sheet's shelf writes `MotivationUpload` rows only — the vault
   (`Credential`) is not written, so a document added on the sheet is invisible
   to the next application.

### The seller's scanner, and NONE on the form — 2026-09-08, `4170533f` + `e82c1efe`

**"why cant we use the same scanner that the license centre uses"**

⚠️ **`components/consent/licence-card-capture.tsx` IMPORTED THE V2 SCANNER BY
PATH**, so the seller got the old one however `NEXT_PUBLIC_SCANNER_V3` was set
— and it is `1` in production. The flag was only ever read by
`scan/scan-button.tsx` and `/scan/handoff`; that is how one surface sits on the
rebuilt detector while another quietly does not. It now uses the same switch.

⚠️ **THE SWITCH IS COPIED, NOT SHARED, AND THAT IS FORCED.** `dynamic()` needs a
literal `import()` per branch or the bundler cannot split the two scanners. Keep
the expression identical to `scan-button.tsx`'s. `components/scan-v3` stays
vendored — import it, never edit it here.

**"instruct gemini to read a NONE as NONE and not leave it out"**

⚠️ **THE READ SIDE WAS ALREADY RIGHT.** `licence-card-ocr.service.ts` carries the
operator's own words — *"if it says NONE, you put NONE"* — and never INVENTS
one, so a field it could not make out still arrives `undefined` rather than
NONE. The two stayed distinguishable throughout. **The loss was one step later.**

⚠️ **THE STRIP MOVED FROM THE ANSWER BOUNDARY TO THE PROSE BOUNDARY.** It was not
deleted. Three places dropped a card placeholder on the way into `answers`:

| Path | Was | Now |
|---|---|---|
| `motivation-extract.service.ts` — a fresh scan | dropped the row | keeps NONE |
| `motivation-credentials.ts` `credentialOffer()` — the vault carry, **the live one** | dropped the row | keeps NONE |
| `common/document-fields.ts` `toMotivationAnswers()` — not wired today | dropped the row | keeps NONE |

and one place now strips it instead:

| `motivation-prompts.ts` `renderFacts()` | passed answers through | runs `answerValue()` |

**"Model NONE" handed to a language model is an invitation to write a sentence
about a firearm called None** — that is the only thing this protects against,
and the prose boundary is where it belongs.

⚠️ **TWO PLACES STILL SKIP PLACEHOLDERS AND MUST.** `first()` in
`motivation-credentials.ts` and `ownedFirearmSerial()` in `motivation-fields.ts`
are **fallback chains** — frame, then barrel, then receiver. A NONE that returns
instead of falling through is how a row with a real number in the next column
comes back empty. **Picking a serial and transcribing a row are different
questions; only the second wants the word NONE.**

⚠️ **THIS REVERSES A RULE INTRODUCED 2026-09-07, AND THE LEGAL POINT WAS RAISED
AND OVERRULED RATHER THAN OVERLOOKED.** The tests being flipped argued that a
NONE crossing into `answers` is a false statement on a SAPS 271 and therefore an
offence under **section 120(9)(f)**. The operator, who takes these packs to a
DFO, ruled that transcribing what the card itself prints reproduces the document
rather than asserting anything new, and that an empty box says something
different. **Both positions are recorded in the tests; if it is revisited it is a
question for the operator and the DFO, not for whoever is next in the file.**

`card-placeholder-boundary.spec.ts` asserts both ends at once — the 271 prints
NONE, the fact pack does not. Move the strip back and one of the two goes red.

⚠️ **NOT VERIFIED AT RUNTIME: which scanner the consent page loads.** The change
is the same one-line expression the Licence Centre uses and the build is clean,
but the consent link is single-use and the only one issued has been consumed. A
fresh invite would confirm it.

### The seller signed and the sheet did not notice — 2026-09-08, `f0558200`

The consent completed at **12:02 SAST** — front, back, signature, Part F,
firearm snapshot, all stored — and the applicant's page went on saying "When
they sign, Part F … fills in from what they give us", directly beneath a panel
already reading "The owner has signed". **Two bugs, one on each side.**

1. ⚠️ **`saps271Coverage` ONLY PUSHES SECTION F WHEN IT IS TOLD ABOUT THE
   SELLER, and `motivation-sheet.service.ts` passed no context at all.** So the
   sheet had no F row: no "Current owner" line on the pack meter, and nothing
   for the page to read. `motivations.service.ts` has always passed it — the
   sheet is the newer surface and simply did not.

   ⚠️ **`sellerState()` WAS A PRIVATE METHOD ON `MotivationsService`**, which is
   why the second surface could not call it. It now lives on
   `MotivationSharedService`, which both inject; `MotivationsService` delegates.
   Same rule its sibling `waitingOn()` already carries.

2. ⚠️ **THE PAGE READ PROPERTY NAMES THAT DO NOT EXIST.** `sellerSigned` tested
   `c.key === 'F' && (c.done ?? 0) > 0`. The server emits `id`, `label`,
   `percent`, `status`, `note`, `missingRequired`, `applicable`, `answered` —
   there is no `key` and no `done` anywhere, so it read two undefined properties
   and could only ever be false. And `answered`, the field `done` was meant to
   be, is **pinned at 0 for F on purpose** ("STATUS, NEVER A PERCENTAGE"), so
   even spelled correctly it would never have flipped. The correct read is
   `id === 'F' && status === 'complete'`.

   ⚠️ **AN `as` CAST IS WHAT HID IT.** Asserting a shape the server does not
   send turns a compile error into a silent false.

⚠️ **THE LICENCE-CENTRE COVERAGE FIXTURE CARRIED THE SAME INVENTED NAMES** —
`key` / `total` / `done` — so `PackSummary`'s tests passed against a shape
nothing produces. Corrected to what `saps271-coverage.ts` emits. Three new
sheet tests cover the F row: signed, waiting, and absent when nobody was asked.

**Verified on production against MO000067:** the Part F line now reads "Signed.
Part F of your SAPS 271 is filled in from what the seller gave us"; the shelf
carries both sides of the owner's licence; the panel offers **"Use these details
in my application"** with Make CZ / Handgun / 6.35MM BROWNING / 81815 read off
the card, the photograph beneath it to check against. 21 → 18 things left.

### The scanner auto-trigger — diagnosed, NOT changed

Operator, 2026-09-08: *"The scanner did a auto trigger and quality was
unreadible, redid it and then the autotrigger didnt want to fire again."*

- ⚠️ **THE SELLER'S CONSENT PAGE USES THE V2 SCANNER REGARDLESS OF THE FLAG.**
  `components/consent/licence-card-capture.tsx` imports
  `components/scan/document-scanner` by path. `NEXT_PUBLIC_SCANNER_V3=1` is set
  on the box, but the flag is only read through `scan-button.tsx` and
  `/scan/handoff`. So the seller scanned on V2.
- The gate is `ARM_MS` (1200ms from viewfinder open) → `HOLD_MS` (300ms still)
  → guidance exactly `'ready'`. All three are deliberate and carry operator
  history; 700 was "super sensitive", 1100 "way too long", and the motion
  reading was broken during both verdicts.
- ⚠️ **`startedAt` IS SET INSIDE THE DETECT-LOOP EFFECT** (deps `[phase,
  shape]`), so returning to `live` after a retake restarts the arming clock and
  the member pays the full 1200ms again. `ARM_MS`'s own docstring says the
  opposite: "This costs nothing after the first shot of a session … from then
  on the hold alone governs."
- ⚠️ **DO NOT "FIX" THAT TO MATCH THE SENTENCE WITHOUT EVIDENCE.** Per-session
  arming makes a retake instant — which is what this report asks for, and is
  also exactly the "way too fast to take a picture, cant even aim then it snaps"
  that ARM_MS was introduced to stop, since somebody who has just tapped "Take
  it again" is still holding the card in frame. Both readings are defensible.
- A stale comment was corrected: `INK_AT` justified its deliberately weak floor
  by "the real protection is the 1100ms hold", when `HOLD_MS` has been 300 since
  the motion reading was fixed.

**What settles it:** open the scanner with **`?diag=1`**. The panel reports the
live blocker reason, motion and ready% — one capture of that during a failing
retake replaces the guessing this surface's history is made of.

### The invite was broken in THREE layers — 2026-09-08, `9e6e04a3`

⚠️ **THE CONTROLLER NEVER READ THE EMAIL EITHER.**
`motivations-consent.controller.ts` declared a body type with no `email` field
and never passed one to `invite()`, so even after `e75ac24b` added the input
and the API client's field, the service still received `''` and refused with
the same sentence.

⚠️ **THE IDENTICAL REFUSAL IS WHAT HID IT.** "Enter a valid email address for
them." is byte-for-byte the same whether nought, one or two of the three layers
have been fixed — so a round of fixing changes nothing on screen and reads as
having not worked at all. When a message cannot distinguish "you did not type
one" from "we did not send yours", check every layer before believing any of
them.

The chain is whole now: **input → API client body type → controller body type
and pass-through → service → `invitedEmail` stored → the link emailed beside
the SMS.** `motivations-consent.controller.spec.ts` asserts the forwarding
directly.

**Proved on production without sending anything.** The service validates in
order — name, phone, email, then the firearm label — so an invite carrying a
valid address and an empty `firearm: {}` fails at the LAST check and sends no
SMS, no email and writes no row:

| Probe | Response |
|---|---|
| `email: 'not-an-address'` | 400 "Enter a valid email address for them." |
| `email: 'probe@example.co.za'` | 400 "Say which firearm this is about…" |

The error moving past the email check is the proof. `MotivationSellerConsent`
is still at 0 rows.

### One scanner, one picker — 2026-09-08, `0c3eaa75`

⚠️ **THE SHELF AND THE PANEL BOTH OFFERED THE WHOLE CHOICE.** The empty shelf
showed "Add your ID, licences and certificates" and "Upload from this device";
tapping either opened AddPanel, which mounted a `ScanButton` with its own pair
underneath — "Use my phone camera" and "Choose files instead". Operator,
2026-09-08: *"this is double. two scan with phone options."*

**Why it happened:** `ScanButton.autoStart` hides that component's own controls
while it probes and opens. The Scan tile set it; the Upload tile did not — so
the Upload route opened a panel that rendered the entire choice a second time.

- **The empty shelf is two dashed boxes, same style, side by side** — scan,
  and upload beside it. Each says only what it does; the scan box no longer
  reads "or choose files", because it no longer does.
- **The upload control is a `<label>` around a hidden file input**, on both the
  empty shelf and the 72px tile row, so it opens the OS picker directly.
  "Upload from this device" that opens a screen offering to scan with your
  phone is not an upload button.
- **AddPanel renders nothing a member can see.** It mounts only when the SCAN
  box was tapped, always with `autoStart`, purely to host the scanner or the
  hand-off. Its fallback picker survives for the one case where nothing opened
  at all — no camera and no hand-off.
- The spec pins the count: **exactly one scanner and exactly one file input**,
  empty shelf and populated.

⚠️ **`licence-pack/bulk-capture.tsx` IS ORPHANED AGAIN.** It was the only door
to the "we filed this as X — change it" correction, and removing the panel's
visible half took its mounting point with it. The correction wants a home on
the shelf tile itself; until it has one, a mis-classified document cannot be
re-filed from this surface. `onRefile` is still on the page, unused.

**Verified on production against MO000067:** one scan control, one file input,
no "Choose files instead", no "or choose files", no "ADD A DOCUMENT" panel.

### The invite bug and the shelf — 2026-09-08, `e75ac24b`

⚠️ **THE SELLER-CONSENT INVITE HAD NEVER WORKED.** Reported from the live
sheet: "Send them the link" returns *"Enter a valid email address for them."*
over a form with **no email field**. The server is right to want one —
`motivation-seller-consent.service.ts` argues it deliberately ("BOTH, NOT
EITHER … the email carries the link … the number is the nudge") — and the panel
simply never asked: no input, no state, and **no `email` field in the API
client's own body type**, so the request could not have carried one.

⚠️ **THIS IS THE SECOND TIME THE SAME FUNCTION HAS DONE THIS.** The comment
directly beneath that check describes the first: the invite used to demand a
serial number that was `formOnly` and therefore off-screen on the default
path — *"The refusal named a box that was not on screen anywhere."* There is
now `components/motivation-seller-consent.spec.tsx` pinning the shape of the
request against what the server requires, and the button's own gate mirrors the
server's checks rather than enabling into a refusal.

Also in this deploy:

- **The shelf's second tile is "Upload"**, with a tray-and-arrow icon, not
  "+ Add". Operator, 2026-08-24 and again 2026-09-08: *"replace the Add button
  with two buttons, Upload and Scan with phone (Use Icons)."* The empty
  shelf's "Choose files instead" line became a bordered button beside the
  scanner for the same reason.
- **The SAPS 271 meter says "N boxes still empty"**, not "N still needed". It
  counts boxes on the form; the strip, the chip dots and the footer count
  required registry keys. Two honest measures, both saying "still needed" and
  totalling differently, read as the page contradicting itself.
- **The 271's own boxes on "You" fold to the bottom** — postal address, a
  postal code per address, dialling codes split from their numbers. ⚠️ **Folded,
  never deleted:** each is a real box on a statutory form. On the live sheet
  "Postal address, if different" sat open, marked Optional, prefilled with the
  SAME address as residential.

**Verified on production against MO000067:** the shelf shows the wide scan tile
plus **Upload from this device**; the consent card carries **Their email
address**; "You" carries one fold, *"Post and dialling codes · 5 rows"*; the
meter reads *"6 boxes still empty"* and the old wording is gone.

### ⚠️ MO000066 was deleted by the operator, and that is the feature working

The one motivation is now **MO000067** (DRAFT, empty vault). MO000066 and its
four uploads were erased at ~11:02 SAST on 2026-09-08, between the
`104039` and `111735` dumps, using the Delete button shipped in `3f6a8fac`.
The cascade behaved as documented and **the Document Centre was untouched** —
20 `Credential` rows survive (5 firearm licences, 5 competency, 8 proficiency,
1 ID, 1 address), exactly as the confirmation dialog promises.

⚠️ **`Motivation.createdAt` is stored UTC while `psql now()` renders SAST.**
That two-hour offset made the delete look like it happened before it did, and
cost a real detour. Read the backups, not the column, when you need a sequence.

### The sheet fixes — 2026-09-08, `9c339ac8` → `95365781`

A live walkthrough of MO000066 (S16 dedicated hunter, five owned firearms,
four documents) found the review sheet **26,351px tall — 27.7 screens — with
351 form controls**, and Chrome's renderer timed out screenshotting it. Four
deploys, in this order, each with the full gate and its own health check.

**`9c339ac8` — copy and layout.**
- ⚠️ **`sourceLine()` was misspelling every make read off a licence.** It
  lower-cased character 0 of the provenance string, so five owned-firearm rows
  read "from mAUSER .30-06 SPRINGFIELD", "from hOWA 6.5MM CREEDMOOR", "from cZ
  6.35MM BROWNING". It now leaves alone any string carrying a capital of its
  own. Extracted to `source-line.ts` because `competency-lines.tsx` held a
  second copy of the same arithmetic.
- A text row printed `item.help` as the input's placeholder **and** again
  beneath it. Selects and dates keep the line; they have no placeholder.
- The competency help was five sentences inside a 44px box.
- "Six questions everybody is asked" above five. The registry's six is right —
  `history_negligence` is conditional — so the wrong word was "everybody".
- ⚠️ **`main` carried `lg:mx-0` for a grid parent that was never built.** At a
  2133px viewport the sheet sat at x=0 with 1,373px of white beside it;
  `.gg-shell-pane` measures 0 wide. SPEC-BUILD §3's two-column grid now exists
  while the preview is open, and `main` centres itself otherwise.

**`3f6a8fac` — a member can delete an application again.**
⚠️ **Phase 4 deleted both wizards and took the only delete control with them.**
`delete-application.tsx` had been imported by nothing but its own spec ever
since. It is now an outlined 44px button with a trash glyph — mounted on the
sheet past the sticky footer, and on every row of the applications list as a
**sibling** of the `Link` (a `<button>` inside an `<a>` is invalid HTML and the
browsers that tolerate it still follow the link). The confirmation dialog was
already load-bearing and is unchanged: `DELETE :id` is self-serve POPIA
erasure, and it says what survives as well as what goes.

**`0da85116` — the firearm route, and the seller's scanner.**
⚠️ **The seller-consent scanner was built, deployed and unreachable.**
`/consent/[token]` step 1 is "Photograph your licence — both sides of the card
for this firearm". The card that links to it renders only on a private sale,
and `firearm_source` was **Optional and fifth of seventeen rows**, so it was
never answered: the applicant hand-typed make, model, calibre and seven serial
rows for a firearm whose card they have never held, while the pack meter
pleaded "Tell us where the firearm is coming from".
- `firearm_source` is now the **first** row of its section and **required**.
  Three registry comments and its own spec already asserted it was required.
  Safe because `NOT_ASKED_BY_TYPE` excludes S24 — a renewal has no dealer and
  no seller — and there is now a spec pinning that.
- The consent and overlap cards are emitted under the source row, per
  SPEC-BUILD §8.3/§8.4. They used to render after every row in the section.
- New `sheet-disclosure.tsx`. First use: the six barrel/frame/receiver rows
  fold behind one line naming whoever actually fills them in.

**`95365781` — the folds.**
- `sheet-section.tsx` collapses. The heading stays an `<h2>` with a button
  inside it so the page keeps its outline; children are **unmounted**, not
  hidden. Controlled, so a chip can open what it scrolls to.
- Every closed section carries its own "N still needed" from the **same**
  `missing` list the pill, the chip dots and the footer read.
- The opening fold is the first section that still owes something, computed
  **once** — recomputing on each post-save refetch would close a section
  somebody had just opened.
- ⚠️ **One fold per owned firearm, and nothing at all for the rows nobody
  owns.** Which rows exist is `sheet.ownedRows`, new on the sheet response and
  built with the backend's own `ownedRowTaken`. Deciding it in the browser
  would make the page a fourth reader of "is this row in use", and that
  function's note records what happened last time its readers disagreed.

**Verified in Chrome on production, signed in, against MO000066:**

| | Before | After |
|---|---|---|
| Document height | 26,351px | **3,060px** |
| Form controls mounted | 351 | **10** |
| `main` at a 2133px viewport | x=0, 760px | **x=678, centred** |
| "Firearms you own" | 15,840px, 14 rows flat | **546px, 5 folds** |
| "from mAUSER …" | 5 rows | **0** |

Selecting "From a private owner" renders the consent card with **Send them the
link**, and the component fold's note becomes "The seller fills these in when
they photograph their licence". That answer was set only to prove the path and
was **put back to blank**; the application is otherwise as it was found.

⚠️ **Not verified: the phone.** `resize_window` reported success but the
Chrome window would not leave 2133px, so every measurement above is desktop.
The narrow layout is the default and nothing in these four commits is
`lg:`-only except the grid — but the new fold headers (title + "N still
needed" on one 44px row) have not been seen at 390px.

Last pre-deploy dump: **`alloutdoor-20260908-104039.dump`**.

### The follow-up deploy — 2026-09-08, `fe78bd12`

Two things the operator found on the live sheet within minutes of `7f2b2628`
going up. Both were in the shelf, and both were shipped by me.

1. **⚠️ THE DOCUMENT SHELF HAD NO SCANNER.** The empty-state tile read "Scan
   with your phone or choose files" and the door behind it held a file picker
   and nothing else. On a laptop, with a licence card in hand, there was no way
   to photograph it — the copy promised a capability that was never wired.
   `add-panel.tsx` now mounts `ScanButton` (`handoff={{ dest: 'motivation',
   motivationId }}`, `shape="a4"`), and `document-shelf.tsx` takes `onScan`
   alongside `onAdd` and renders a **Scan tile before the Add tile**, so the
   camera is reachable in one tap rather than two.
   ⚠️ **`ScanButton` decides the surface and nothing outside it may.** It offers
   the phone hand-off on a desktop and the on-device camera on a handheld,
   because a laptop webcam cannot resolve a licence serial. The Scan tile sets
   `autoScan`, which goes through its own `autoStart` — an earlier attempt
   elsewhere forced its `open` state from outside and opened a webcam behind a
   button reading "Scan with phone".
2. **The tiles printed raw enum names.** `motivation-sheet.service.ts` shipped
   `label: u.kind`, so the shelf rendered `ADDRESS_CONFIRMATION` and
   `PROFICIENCY_CERTIFICATE`, clipped to `ADDRESS_CO` in a 72px tile. It now
   reads `UPLOAD_KIND_LABELS[u.kind] ?? u.kind` — the member's words, with the
   raw kind only as a last resort so a new kind degrades rather than vanishes.

Full deploy (the diff touches `backend/`). tsc clean both sides; backend
**4041/4053**, frontend **1562/1563**, 0 failed; frontend build exit 0 in the
foreground with `.next/BUILD_ID` present. `deploy.sh` clean end to end — backup
**`alloutdoor-20260908-093317.dump`** (the rollback point), backend health ×2,
frontend health ×2, warden reloaded and online, public site 200 ×2, three pm2
services online, box HEAD `fe78bd12`, `prisma migrate status` up to date with
nothing pending.

### What Phase 4 did — the old surfaces are gone

**Deleted:** `app/motivations/**` and `app/licence-services/**` (both wizards);
eight top-level components (`motivation-step-nav`, `motivation-step-rail`,
`motivation-template-picker`, `motivation-template-preview`,
`motivation-checklist-panel`, `licence-centre-motivations`,
`licence-centre-offer-panel`, `motivation-field-input`); sixteen files under
`components/licence-pack/` (`field-grid`, `pack-row`, `pack-group`,
`pack-section`, `step-answers`, `follow-up-thread`, `prefill-banner`,
`proficiency-alert`, `offer-notes`, `capture-cards`, `wizard-rail`, + specs);
ten files under `lib/` (`motivation-step-plan`, `licence-services-preview`,
`wizard-coverage`, `wizard-document-coverage.spec`, `wizard-step-offset.spec`,
`motivations-grouping.spec`, `follow-up-rules.spec`,
`vault-prefix-coverage.spec`); the four prefill-offer endpoints and their
facade delegators; and the four client calls behind them.

**Redirects (301, permanent):** `/motivations` and `/licence-services/new` →
`/licence-centre/applications`; `/motivations/:id` and `/licence-services/:id`
→ `/licence-centre/:id`. Pinned by `lib/redirects.spec.ts`, whose most
important case asserts an ABSENCE: **`/licence-centre` must NOT redirect**, or
every licence-expiry reminder lands on a list of applications.

**The flag is gone** — `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED`,
`PACK_SCREEN_SHIPPED` and `canOpenPackScreen()` have no references left.

**Links repointed, not left to the redirect:** `notifications.service.ts` was
still BUILDING `/licence-services/[id]` into every "your document is ready" SMS
and inbox row. Also the account menu, the account page's promoted tile, and
`delete-application`'s post-delete push. The old paths still 301 for links
already in inboxes; a link sent today should not need one.

⚠️ **`read-result.tsx` was deleted even though §4 lists it as reuse.** It
imported `motivation-field-input` and `step-answers`, both of which §3 names
explicitly as NOT reused, and it is step-shaped (`stepKey`) on a surface with
no steps. Its job is done by `sheet-toast.tsx` plus rows changing state in
place. Recorded in `components/licence-pack/README-phase4.md`.

⚠️ **Specs were re-pointed rather than deleted wherever the RULE survived.**
`licence-types-coverage.spec.ts` needed no assertion changes at all — it
compares `LICENCE_TYPES` to the SERVER'S registry, never to a screen, so it
survived the surface being replaced underneath it. The four provenance cases
that went through `useLicenceCentre`/`useProfile` now call
`MotivationPrefillService` directly: the delegators died, the rule they
protect (a vault value is stamped VAULT with the credential's id, a profile
value PROFILE with none) did not.

### ⚠️ One capability lost in Phase 4, and it is not a bug to fix blind

`create()` applies the profile and the vault automatically, in the documented
order, so a NEW application still opens prefilled. But a member who adds a
licence to their vault **after** starting an application no longer has any way
to pull it in — that was what `POST :id/use-licence-centre` did behind a
button. `MotivationPrefillService.licenceCentreOffer/useLicenceCentre` still
exist and still work; **nothing calls them.**

The right answer is for the sheet to re-run the vault offer on load, with
provenance, and never over a MEMBER value — but that is design work with a
real risk of overwriting somebody's answer, not a Phase 4 deletion. Left as
the operator's call rather than guessed at.

### What is left in `components/licence-pack/`

Eleven files, per brief §4's reuse list, and only three are reached today
(`saps271-meter`, `yes-no-pills`, `bulk-capture`). The rest are pack-page
furniture waiting on the follow-on panels. `README-phase4.md` in that
directory says which is which — an orphaned component is not evidence of a
live feature.

⚠️ **Nothing was MOVED into `components/licence-centre/`.** SPEC-BUILD §4 asks
for that in Phase 4; it is cosmetic, it would touch every import, and the
directory now carries a README explaining itself. Deferred deliberately rather
than forgotten.

### Verification

Backend `npx tsc --noEmit` CLEAN, `npm test` **4041 passed / 4053** (235 suites;
8 skipped, 4 todo, 0 failed) against a measured pre-Phase-1 baseline of
4020/4032. Frontend `npx tsc --noEmit` CLEAN, `npm test` **1561 passed / 1562**, and
`npm run build` **exit 0** with `.next/BUILD_ID` present (so desk-guard,
desk-cutover and theme-sync all passed). The build lists exactly four routes:
`/licence-centre`, `/licence-centre/applications`, `/licence-centre/[id]`,
`/licence-centre/[id]/pack`.

⚠️ The frontend count fell from 1736 because Phase 4 deleted the two wizards
and the ~175 tests that existed only to guard them — the wizard rail, the
field grid, the step plan, the follow-up thread and the four wizard-coverage
suites. Every deletion was checked against whether the RULE survived; where it
did, the spec was re-pointed instead.

⚠️ **A STALE `.next/dev/types/validator.ts` FAILED THE BUILD** after the routes
were deleted, referencing pages that no longer exist. It is a `next dev`
artefact, not a source problem, and a fresh checkout has none — but it is the
same class of trap CLAUDE.md warns about with `.next/cache` surviving a
rebuild. If a build fails on a missing `app/...page.js` right after a route is
deleted, that is what it is. **Not deployed, not committed.**

⚠️ The backend count DROPPED from Phase 2's 4113 because Phase 1B deleted 44
Textract tests whose subject is gone — `textract-document-extract.spec.ts` (24),
`licence-centre-extract-textract.spec.ts` (11) and `kyc/textract-extract.spec.ts`
(9) — plus three licence-centre specs whose subject was Textract's OCR quirks.
Each deletion was checked against whether the RULE survived: where it did, it is
covered elsewhere and the replacement is named in the tombstone comment.

Net test movement. Deleted with their subjects: `motivation-gaps.spec.ts` (8),
and the two free-text research blocks in `motivation-model.service.spec.ts`
(14) — whose privacy, grounding and fail-soft rules are all re-covered, more
strictly, in `motivation-research.service.spec.ts`. Added:
`motivation-cards.spec.ts` (15), `motivation-preview.spec.ts` (12),
`member-profile-answers.service.spec.ts` (11),
`motivation-sheet.service.spec.ts` (21), `motivation-research.service.spec.ts`
(29), plus extensions to the registry, overlap, 271, checklist and model
suites. **Every existing test that changed is annotated in place with why**,
per brief §2.7.

⚠️ `motivation-prompt-cache.spec.ts` was re-baselined TWICE — once in Phase 1
(S13 label renames) and once in Phase 2 (the halved word bands, all five
types). Both were content changes, which is what those hashes exist to catch,
so the baseline moved rather than the assertion being weakened. **All five line
counts held at 106/106/102/102/94 through both**, which is the check that each
was a rewording and not a loss.

### ⚠️ Three things the operator has to decide before Phase 2

1. **The brief and the code disagree about estate firearms.** Brief §5.3 and
   intake plan §1 say `SOURCE_ESTATE` fills Part F **Type E** from the
   `EXECUTOR_APPOINTMENT` letter and the executor signs items 79–87.
   `saps271-map.ts` says the opposite, and says it as a dated operator ruling:
   *"Only Type A and B from the 271 are what we will process"* (2026-08-29), so
   Type E is never ticked and 79–87 are written on **no route at all**
   (2026-08-28). The code was left alone and the checklist copy was written to
   match the code, not the brief. **This needs a ruling.**
2. **`existing_firearm_N_action` and `existing_firearm_N_section` do not
   exist.** The overlap engine's new action and section axes read them
   defensively and are therefore **inert** until those fields are added. The
   ranking works today off calibre class, firearm type and the tapped
   `primary_use`; the two new axes are wired and waiting.
3. **Phase 1B — drop AWS Textract, Gemini only.** Operator instruction
   2026-09-08, scoped to **everything including KYC**, timed for **after Phase 1
   sign-off**. Full file list in `PHASE-0-PLAN.md` §1B. Two things to know
   going in: it reverses `d90fbdcf` (Textract was put FIRST because a single
   Gemini vision pass on a real photograph was inconsistent — the replacement is
   a `responseSchema` call plus the existing two-attempt retry), and **AWS does
   not leave the codebase** because `aws-kyc.service.ts` couples Textract to
   Rekognition face-match and Face Liveness under one IAM policy.

`MotivationMessage` was counted read-only on production before the drop
migration was written: **0 rows**. Nothing was exported because there was
nothing to export.

---

## Upload → sorted review → vault: one screen, one confirm — 2026-09-28

Operator: *"identified documents gets cropped and all the colour and sharpening
takes place and the next screen they see is documents sorted and evidence sorted
… they can just confirm that it's right and it goes into the vault."*

The batch tail used to be **three checkpoints**: a per-document interactive
cropper, a "File these" preview, and a post-upload date review. It is now
**one**: pick → automatic polish → the sorted review → confirm → vault.

- **Automatic polish.** `frontend/lib/scan-upload/auto.ts` runs the same crop
  pipeline headlessly (`decode → processStill → seal`) and returns a JPEG. It is
  NOT gated on `NEXT_PUBLIC_SCANNER_V3` — the flow promises the treatment, so it
  cannot silently stop cropping where that flag is off. Evidence is never
  touched. The interactive overlay stays, now only for **Fix crop** from the
  review screen.
- **One sorted screen.** `components/document-centre/batch-preview.tsx` is the
  sorted review: **Documents** by type and **Evidence** by container, a
  magnifier on both (a thumbnail is too small to check a crop), and a
  **description box on every evidence item** — compulsory, because the server
  re-reads the image WITH the words to place it. The confirm is dead until each
  evidence item has one.
- **Bulk commit.** `POST /licence-centre/commit` takes the whole batch
  (`files[]` + an index-aligned `manifest` of `{identifyId, description}`) and
  files each. Documents get their **read dates accepted** (operator: the single
  confirm means "this is right", so it arms the reminder); a date that cannot be
  settled leaves the row filed-but-unconfirmed rather than failing. Evidence is
  placed by `redescribeEvidence` against the member's words. One bad file does
  not sink the batch — results come back per item. The identify id remains the
  only trust anchor; type is never sent.

### ⚠️ Orientation — the real cause, and the fix

The operator's own uploads were landing sideways. The file is an iCloud-for-
Windows export: **2048×1536 landscape main image with the page on its side, and
NO EXIF orientation tag.** The embedded EXIF thumbnail is just a landscape copy
of the same pixels (no orientation signal of its own), so the OS "Open" dialog
looking upright was a red herring — nothing in the file says which way is up.
The upload fork's only uprighting is content-based (`chooseRotationPage`).

Measured on three of those pages, on the WARPED rectangle: `held 0.369 / side
0.486` (ratio 1.31), `0.542 / 0.592` (1.09), `0.335 / 0.531` (1.59). The
direction was right every time — the rotated axis always had more blank rows —
but `AXIS_EDGE` in `lib/scan-upload/pipeline/orientation.ts` was **1.5**, tuned
on synthetic fixtures where an upright page separates from a sideways one by
~10x, and real dense certificates separate by as little as 9%. Lowered to
**1.05**; all three now turn, and the existing 11 orientation tests still hold.
A synthetic "scattered stamps" fixture pins the narrow gap (fails at 1.5, passes
at 1.05). ⚠️ Two of the five photos still fail: one has a bad detector reading
(ratio 3.4, not a page), one is genuinely ambiguous (both axes under the blank
floor). Those are what **Fix crop / Rotate** on the review screen are for.

⚠️ **THE QUARTER-ONLY FIX WAS STILL WRONG: the page came back UPSIDE DOWN.** The
blank-row metric says a quarter turn is due but can never say WHICH — and the
direction is not in the ink. Measured on the real pages, `uprightScore` gave
`0:1 90:3 180:-1 270:-3` and similar — ±4, pure noise — and the embedded
thumbnail carries no orientation. So the direction comes from the **vision
model**, which is already looking at the page: a small, SEPARATE call
(`LicenceCentreExtractService.orient()`, purpose `vault.orient`) asks only
"WHICH EDGE IS THE TOP OF THE PAGE ON", asked in `identifyOne` **only of a file
classify() called a document**. The answer rides `IdentifyVerdict.rotate` (NOT
persisted; `create()` files the already-turned bytes) and `autoPolish` →
`processStill(rotate)` applies it in place of the ink guess.

⚠️ **ASKING FOR DEGREES WAS ITSELF THE TRAP.** Asked "how many degrees clockwise
must the picture be turned so the page is upright", the model answered **90 for
a page that needs 270** — the pipeline then produced exactly the operator's
"upside down". Asked instead where the TOP EDGE is (top / right / bottom / left),
it answers correctly and with no rotation to reason about; the degrees are
mapped in code (`right` → 270). Verified live against the operator's own export:
`{"side":"right"}`. ⚠️ Also note the schema: an INTEGER `enum` on the first
draft made Gemini reject the whole request (`bad_request`, `in=0 out=0`) — a
STRING enum is what it accepts.

⚠️ **IT WAS FIRST FOLDED INTO THE CLASSIFY PROMPT, AND THAT BROKE
CLASSIFICATION.** Adding a `rotate` field to the kind prompt made a
phone-scanned competency certificate come back as **EVIDENCE**. The kind prompt
is tuned and cannot carry a second job; it was reverted untouched, and the
orientation question is its own call. (The phone SCAN path posts straight to
`create()`, not through `identify`, so it never gets a rotation — its scanner
already rectifies the page upright.)

Separately, `lib/process-image.ts` re-encoded through `createImageBitmap(file)`
without `imageOrientation: 'from-image'`, which bakes the wrong orientation into
a JPEG that has lost the tag; fixed. And the vault ingest now applies EXIF
orientation once via `backend/src/licence-centre/upright-image.ts` (identify,
create, createEvidence, redescribe), so the model, the stored copy and every
later reader all see upright pixels. It never throws and never resizes.

---

## Deleting a document now detaches the copies that pointed at it — 2026-09-28

Operator: *"It says there are duplicates which I already removed."* Deleting the
ORIGINAL of a flagged pair left every copy that named it still flagged: the
member saw "looks like a copy of —" (the title lookup finding nothing) and the
**extra copy** chip counting a document already thrown away. `replaceWith` had
always known a copy could outlive its original (its not-found branch detaches
the pointer), but `removeOwned` never tidied up — the same dangling-pointer trap
as `otherSideId`, one field over.

Fix: after the delete, `removeOwned` finds rows with `duplicateOfId === row.id`
and runs the existing `detachCopy` on each (clears the pointer, the `duplicate`
attention tag and the "Looks like a copy of" note). The copy is **not** deleted —
the member removed one document, not both. Never fatal: wrapped like the
`otherSideId` cleanup, because the erasure has already happened.

---

---

## The community backend had never been deployed — 2026-09-30

Operator hit *"Something went wrong posting"* on the live feed. The cause was
not the post: **every `/api/community/*` route was a 404 on production.** The
deployed frontend was newer than the deployed backend, so the composer's
`createPost` hit a missing route, and a 404 is not one of the statuses the
composer names — it fell through to the generic message.

Deployed `54335631` (full deploy) which ships the whole community module for the
first time, plus the Jev/DeepSeek moderation below. Verified live:
`/api/community/config` and `/api/community/feed` now answer **401** (auth),
not 404.

⚠️ **The composer got an honest message for this case** (`post-composer.tsx`):
a 404 from the community API now reads "Community is temporarily unavailable",
not the generic "something went wrong", so a half-deployed backend is
diagnosable from the UI next time.

### Jev + DeepSeek moderation (commits `6a5c476c`, `46dd14d9`)

- **Jev** (TypeSafe System One, `JEV_API_KEY`) is the TEXT moderator on every
  user-to-user surface: listings, listing Q&A, offer notes, rating
  comments/replies, and feed posts/comments. A shared six-question contact
  battery (contact details / social handles / full name / address /
  off-platform coordination / third-party advertising) plus a directed-abuse
  question, through one 80/60 ladder: ≥80% block, 60–80% → DeepSeek second
  opinion → admin on unsure. It reads Afrikaans and obfuscated digits
  (`nul sewe vier drie`, `zer0*7*f0ur*…`) — both probed live.
- **DeepSeek Flash** (`deepseek-flash`, vision) screens IMAGES on listings and
  the feed, and (monitor-only, never blocks) uploaded vault documents. Feed
  VIDEO stays on Gemini — DeepSeek cannot take video.
- `LlmService.decide()` is the only door for Jev; prices in `llm.pricing.ts`.
  Rollback levers: `MOD_ENGINE=legacy` (listings), `FEED_MOD_ENGINE=legacy`
  (feed). `MOD_ENGINE` absent ⇒ the Jev path is live.

### Two local traps worth keeping

- **`bash infra/deploy/deploy.sh` under WSL fails** — WSL has no `alloutdoor`
  ssh alias. Run it from **Git Bash**
  (`& "C:\Program Files\Git\bin\bash.exe" -c "bash infra/deploy/deploy.sh"`),
  which reads the Windows `~/.ssh/config`.
- **`git status` shows ~580 files as modified with zero diff** — `core.autocrlf`
  phantom noise. `git diff --numstat` is empty for them; `deploy.sh`'s
  `git diff --quiet` passes. Do not stage them.
- `IDENTIFY_CONCURRENCY` (default 3) now tunes the identify batch's pool; the
  identify-batch spec pins it to 1 so its positional model mock is
  deterministic.

---

## A competency with no linked firearm now defaults to five years — 2026-10-26

Operator: *"If a competency does not have a firearm linked to it to determine
the expiry date, set the default date to 5 years from the date of issue. so that
it stop give the change date notification"*.

`deriveCertificateExpiry` already produced issue + five years when the
certificate's categories had no licence behind them. The date was shown but
deliberately left **unarmed** (`mayArmDerivedExpiry` refused `fallback`), so the
row stayed in the Document Centre's "dates to check" banner and review queue and
kept asking for a date the certificate does not print. `fallback` is now armed,
written as `dateSource: 'derived'` with the existing basis note.

Existing rows backfill themselves: `recomputeDerivedCompetencies` runs on every
Document Centre `list()` and selects unconfirmed competencies with
`dateSource: 'derived'` or `null`. No script and no migration. A certificate
whose `covers` line could not be read (`unknown`) still gets no date — that is
not a no-licence case and has no honest basis.

Deployed `8a7a5f08` (full). Rollback point:
`alloutdoor-20261026-202403.dump` (32,055,861 bytes). Verification: backend
5,820 passed / 8 skipped, frontend 1,807 passed / 1 skipped, both type-checks
clean, production build clean, health ×2 and public ×2 all 200.

