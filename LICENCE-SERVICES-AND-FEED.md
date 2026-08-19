# Licence Services + Community Feed — Build Plan

*Planned 2026-08-18 with the operator (16 tickbox decisions). Status: PLANNED, not started.*
*Competitive context: Safari Outdoor app teardown 2026-08-18 (25 operator photos, v4.5.8+420) —
see `memory/project_competitor_safari_outdoor.md`. Their marketplace is dead (16 ads) but their
feed is alive and their licence utility is the sticky asset. This plan out-builds it.*

---

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Build order | **Writer → Checker → Feed + Awards** |
| 2 | Writer production | **Fully automated, instant PDF** (no human review) |
| 3 | Price | **R199** per motivation |
| 4 | Placement | **Behind the All Outdoor login only** — no public pages, no separate domain |
| 5 | Licence types at launch | **All four**: self-defence (s13), hunting (s15+s16), sport shooting (s16), renewals (s24) |
| 6 | Firearm-buyer perk | **Half price (R99)** with a firearm purchase on the platform |
| 7 | Pre-payments launch | **Free beta, capped (~first 100)**, testimonial permission asked |
| 8 | Input method | **Form + Boet follow-ups**, PLUS camera-scan uploads of previous motivations, current licences, competency certs (operator addition) |
| 8b | Sensitive file storage | **ON OUR OWN SERVER, encrypted at rest** (operator, 2026-08-18) — see below |
| 8c | Sample motivations | Operator supplies real motivations as reference. **Structure/register only — never verbatim** (see below) |
| 9 | Writer branding | **Boet runs the interview; the PDF is formal** — no mascot anywhere near the document |
| 10 | Second module | **Checker** |
| 11 | Checker depth | **Milestones + crowd stats + auto-drafted follow-up/escalation letters** |
| 12 | Feed visibility | **Split**: outdoor content public, hunting/regulated content members-only |
| 13 | Post structure | **Structured types from day one** (General/Hunting/Target/Fishing/Question/Review) |
| 14 | Moderation | **Claude pre-screen on every post + comment, fail-closed** + user reports |
| 15 | Awards | **Badges + levels + leaderboard — cosmetic only**, no monetary value |
| 16 | Rank flavour | **Bilingual SA outdoor ranks** (Groentjie → … → Legende; final ladder at build time) |

---

## Phase 1 — Motivation Writer (ships first)

**The market:** fly-by-night writers charge R450–R1,000 per motivation. We produce a
better-structured document for R199 (R99 with a firearm purchase, free for the first ~100
beta users). Safari Outdoor's app has a "Motivation Application" menu item — this out-builds it.

### Flow
1. **Pick the motivation type** — s13 self-defence / s15 occasional hunter / s16 dedicated
   hunter / s16 dedicated sport shooter / s24 renewal.
2. **Structured form** — occupation, purpose, the specific firearm (make/model/calibre and
   why it fits the stated purpose), safe storage arrangements, association memberships,
   experience history, current licences, prior applications/refusals.
3. **Camera-scan uploads** — existing licences, previous motivations, competency certificate,
   association cards. REUSE: the KYC camera flow (`kyc/verify`) and the Claude-vision licence
   reader (SAP 534 work) already exist; extraction PREFILLS the form so the user confirms
   instead of typing.
4. **Boet follow-ups** — targeted questions only where answers are thin (conversational,
   Boet-voiced). ~15 minutes total.
5. **Generation** — Claude, one prompt framework per licence type, citing the FCA sections
   that matter for that type, built strictly from the applicant's OWN facts.
   **Anti-template engineering is mandatory** (operator chose no human review): enforced
   structural variation between documents + a per-user throttle (one motivation per type per
   application) so CFR never sees a flood of identical documents.
6. **Automated quality gate** — a second Claude pass scores completeness, specificity and
   internal consistency. Fail → more follow-up questions. A thin motivation never renders.
7. **Formal PDF** — sober template, applicant's name, no mascot, no All Outdoor branding
   beyond a discreet footer. Stored encrypted in the account, re-downloadable.

### Sensitive file storage — on our own server (operator decision 2026-08-18)

ID documents, firearm licences, competency certificates and previous motivations
are stored **on the alloutdoor box, encrypted at rest**, NOT on Cloudinary.

This replaces the earlier "scan-and-forget" design. The infra audit found that every
existing upload in the codebase lands on a **public** Cloudinary `secure_url` — there is no
private mode, no signed URL, no S3/R2 anywhere, and `ALLOUTDOOR-REPLATFORM.md` already
concedes "the URL is unguessable, which is obscurity, not access control." Scan-and-forget
was the workaround for that; keeping the files properly is the better answer, so the
workaround is gone.

BUILT: `backend/src/common/secure-file-storage.service.ts` (+ `encryptBuffer`/`decryptBuffer`
in `blob-crypto.ts`). AES-256-GCM on disk, `0600`, sharded `<namespace>/<yyyy>/<mm>/<id>.enc`,
path-traversal gate on every read (the key round-trips through the DB and a request, so it is
treated as untrusted coming back in). Location: `SECURE_UPLOAD_DIR`, default
`<home>/secure-uploads` — deliberately OUTSIDE `/home/alloutdoor/app` so deploys never touch
it. Box has 81 GB free. There is **no public URL at all**; bytes are only reachable through an
authenticated endpoint that checks ownership first, and deletion is real deletion.

⚠️ **Backups are now two things.** Everything worth keeping used to be in Postgres, so a
pg_dump was a complete backup. These files are not in the database — a restore without the
file tree leaves upload rows whose bytes are gone. Any backup routine must cover both.
⚠️ Rotating `ID_HASH_SECRET` makes every stored file unreadable. Nothing can recover them.

### Sample motivations from the operator

The operator supplies real motivations as reference material. Handling rules:

- **Never committed to this repo** and never stored with live user data — they contain third
  parties' ID numbers, addresses and security circumstances.
- Used to derive **structure, section ordering, register and the shape of a strong argument**.
  Short paraphrased fragments may inform the prompt frameworks.
- **Never reproduced verbatim** in a generated document. Two independent reasons: pasting real
  prose into the generator recreates the exact template-sameness risk the variation engine
  exists to prevent, and motivations bought from a paid writer carry a provenance question.
- Where a sample came from a third-party service, treat it as competitor reference, not source
  material.

### Rules that are not negotiable
- **Never promise outcomes.** No "improves your chances / guaranteed approval" anywhere in
  copy. We sell structure and completeness, not odds. (CPA / advertising exposure.)
- **Disclaimer on every document**: not legal advice; the applicant confirms the facts are
  true and signs it as their own motivation.
- **POPIA**: motivation data is deeply personal (ID, address, security concerns, firearm
  details). Encrypt at rest (same pattern as the SAP 534 encrypted SA ID), stated purpose,
  retention policy, deletion on request. Prompt-sanitiser rules apply (existing).
- **Beta cap** is a DB setting with a counter, testimonial permission is an explicit
  checkbox, and beta users get asked for their CFR outcome later — which seeds Phase 2's
  crowd data.
- **Attorney reviews the TEMPLATES once** (prompt frameworks + disclaimer + PDF skeleton),
  not each document. Same posture as the raffle rules.

### Commercial wiring

**The price table** (operator, 2026-08-18). Two levers, and they stack:

| | firearm bought elsewhere | firearm bought on site |
|---|---|---|
| no subscription | **R199** | **R99** |
| AO Pro | **R99** | **FREE** |

Built as `backend/src/motivations/motivation-pricing.ts` — pure, no Nest, no clock, 11 tests.

The shape is the commercial argument, not a discount scheme: R100 off is a reason to buy the
firearm HERE rather than privately, and a free motivation is a reason to hold the
subscription. Every cell undercuts the R450–R1,000 the fly-by-night writers charge, so we
never compete on price alone. A test asserts every cell stays under R450.

⚠️ **FREE is a real outcome, not a R0 charge.** The caller skips the payment step entirely —
a 0.00 authorisation would be rejected by Peach and would show a member a failed payment for
something they are entitled to.

⚠️ `firearmBoughtOnSite` must be established from a REAL ORDER, never from anything the
applicant types. It is worth R100–R199, so it is exactly the claim someone would make.

- Payments are OFF until Peach — the table goes live with the paygate; before that the
  capped free beta runs. No manual EFT (retired). The price a member is quoted during the
  beta comes from this module, so it is the price they will actually pay.

### Continuity for a returning applicant (operator, 2026-08-18)

*"Keep the motivation so when they apply for another one we have context of their previous
applications and keep the same story line."*

This cuts across two things already built, and both needed changing:

1. **The sameness engine was fighting it.** `recentFingerprints` compared a new document
   against every completed motivation of that type — including the applicant's OWN earlier
   ones — and regenerated when they were too alike. But that engine exists for exactly one
   reason: so the CFR never sees a flood of near-identical documents from DIFFERENT people.
   Two motivations by the same person describe one life; they SHOULD share circumstances, and
   forcing them apart manufactures the precise contradiction a DFO looks for. **Fixed**: the
   corpus now excludes the applicant themselves.

2. **Retention would delete the very thing we now keep.** `retentionPurgeAt` is written on the
   COMPLETED branch and nothing reads it yet, so nothing is lost today — but the purge cron
   must not simply delete a member's history. The split to build:

   - **The motivation TEXT is the storyline.** Keep it while the account exists. That is what
     a second application is written from.
   - **The uploaded IDENTITY SCANS are the risk.** ID copies, licences and competency
     certificates carry no storyline and every bit of the exposure, so they purge on the
     original schedule.

   ⚠️ POPIA needs the stated purpose to match. "Retained so a later application is consistent
   with your earlier one" is a legitimate purpose and must be what the privacy copy says.
   ⚠️ Erasure on request still deletes everything, immediately.
- Marketing: in-app (firearm listing pages, checkout, account), consent-based SMS/WhatsApp
  to the existing base, word of mouth. **No public pages** (operator decision — the public
  site stays firearm-clean).

### Phase 1 — LIVE, SOFT LAUNCH (2026-08-19)

`motivation_writer_enabled` = **true**, `motivation_beta_free_cap` = **3**.

⚠️ **The cap is 3, not 100, on purpose.** The attorney has NOT reviewed the
templates — the operator's own recorded gate — and nobody has completed the flow
against a real Clerk login. Three seats is enough to walk it end to end while the
exposure stays small. **Raise to 100 only after both.**

The cap was set BEFORE the flag was flipped. The other order leaves a window at
100 seats.

Verified after switching on: `/motivations` still 307s signed-out, the homepage
and `/raffle` still carry zero motivation or firearm wording, the sitemap has not
gained a single URL, no seats claimed, no rows, zero errors.

**On the live box** at `5d5882c`, three migrations applied, both services
reloaded, health checked twice. `motivation_writer_enabled` is unset and
therefore **FALSE**, so every endpoint 404s and no Anthropic spend is possible.
`Motivation` and `MotivationUpload` are empty.

Verified after the reload: no `ID_HASH_SECRET` boot warning (the secret is
there), `SECURE_UPLOAD_DIR` resolves to `/var/lib/alloutdoor/secure-uploads`,
`/motivations` 307s signed-out, zero new errors, and the homepage still carries
no firearm or motivation wording.

### What shipped

| Piece | Where |
|---|---|
| Field registry, 170 fields, conditional visibility | `motivation-fields.ts` |
| Prompts, structure plan, sameness engine | `motivation-prompts.ts`, `motivation-structure.ts` |
| Visual variation — 13 fonts × 10 palettes × 4 leadings × 6 formats | `motivation-style.ts` |
| Overlap check (".308 and .270 are both medium game") | `motivation-overlap.ts` |
| Price table R199 / R99 / FREE | `motivation-pricing.ts` |
| Gap detection (free) + ONE batched Claude call | `motivation-gaps.ts` |
| Profile prefill with per-motivation consent | `motivation-profile.ts` |
| Uploads → encrypted store, follow-up interview | `motivations.service.ts` |
| Retention purge + account-deletion purge | `motivation-retention.service.ts` |
| SAPS 271: measured map, mapping, fill service | `saps271-*.ts`, `scripts/saps271-*.mjs` |
| Wizard | `frontend/app/motivations/` |

**Still to do before the flag goes on:**

1. ⬜ **Attorney reviews the templates** — prompt frameworks, disclaimer, PDF
   skeleton, and the declaration copy in the wizard. Gating item, agreed up front.
2. ⬜ **Confirm the SAPS 271 revision** is current before anyone prints one. The
   checklist already marks the form reference `verifyBeforeUse`.
3. ⬜ **Verify the fee** on the checklist, same reason.
4. ✅ **`SECURE_UPLOAD_DIR` pinned** (2026-08-19) to
   `/var/lib/alloutdoor/secure-uploads` — outside the app directory, so deploys
   cannot touch it, and decoupled from HOME, which was the actual risk: under pm2
   HOME is whatever the service account has, and changing it would make existing
   files invisible rather than throw (`read()` just ENOENTs). Created `0700`.
   ⚠️ The running process does NOT have it yet and does not need it — the
   motivations code is not deployed to that box. **The next deploy picks it up.**
5. ✅ **`ID_HASH_SECRET` confirmed present** on the live box (2026-08-19, 64
   chars; value never printed). main.ts now warns loudly at boot if it ever goes
   missing — which matters because the two consumers fail in OPPOSITE directions:
   the crypto modules throw, while KYC falls back to a hardcoded salt and writes
   ID hashes that stop matching the moment the real secret is set.
6. ⬜ **Exercise the wizard against a real Clerk session** — still outstanding,
   and not something that can be done from here: production keys are
   domain-locked, so localhost bounces every authenticated route. It needs a
   deploy and a real login.
7. ✅ **Backups exist** (2026-08-19) — `infra/backup/`, nightly 02:10 SAST,
   database AND the encrypted file tree, each dump verified with
   `pg_restore --list`.
   ⚠️ **There was no backup of ANYTHING before this.** Not the uploads, not the
   database — no crontab, no timer, one manual dump from 12 August left
   world-readable.
   ⚠️ Same disk as the originals: covers a bad migration, not a lost machine.
   ⚠️ Nothing alerts on failure yet.
   ⚠️ The upload archive is useless without `ID_HASH_SECRET`, and rotating that
   secret destroys every stored file in every backup, permanently.

## Phase 1 follow-ons — operator corrections (2026-08-19)

### M-A. Competency cannot be pending

Operator: *"when applying for a licence a competency can't be pending. User already has
to have the certificate."* The wizard currently carries the opposite assumption in two
places: `motivation-fields.ts` says *"Leave blank if the application is still pending"*
on the competency number, and `motivation-documents.ts` names the person still waiting
for competency as exactly who should be drafting. Both were my guesses; both are wrong.

- `competency_number` and `competency_expiry` become **required for every licence type**
  (renewals included — a renewal also rides on a valid competency).
- Every "still pending / applied for" phrase is removed from help text, prompts and the
  posture comments.
- The numbers come off the uploaded certificate via the existing extraction, so for an
  applicant who uploads the certificate this adds **zero typing** — they confirm what we
  read. Someone who cannot produce the certificate now cannot reach Generate, because the
  required-answers gate (`missingRequired`) already blocks on empty required fields.
- The document panel already lists the certificate as required. The upload row itself
  stays advisory (module posture: we say what SAPS needs, we do not hold work hostage) —
  the required-NUMBER gate is what enforces possession, since the number only exists on
  the certificate in hand.

### M-B. The form collapses onto the documents

Operator: *"Remove all the fields that we can get the information off the uploaded
documents."* The registry holds 113 fields; extraction already proposes values for the
identity, address, competency, association and existing-licence blocks — but the fields
still render as questions, pre-filled at best. That inverts.

**Mechanism** — a `docSourced` flag on the registry entry:

- A `docSourced` field is **hidden from the question flow** whenever a confirmed
  extraction covers it. It appears instead in the "what we read from your documents"
  card — editable there, because extraction misreads and POPIA requires correctability.
- If the covering document is missing or the extraction failed, the field **resurfaces
  as a question**. Nobody gets stuck; the fallback is just typing.
- The gap engine and `requiredKeys` see answers exactly as before — the PDF pipeline,
  271 filler and overlap engine change not at all. This is a presentation change with
  one registry flag, not a data-model change.

**What collapses** (typed today → read tomorrow): `full_name`, `id_number`,
`residential_address` + postal code, all four competency fields, association
name/number/since, and all six `existing_firearm_N_*` blocks. **Extractor work needed**:
CURRENT_LICENCE extraction currently maps only slot 1 — it must fill the next FREE
`existing_firearm_N` slot per licence uploaded, and read `barrel_serial` where printed.
EMPLOYMENT_CONFIRMATION gains `employer_name` / `employer_address` extraction
(best-effort suggestions, field stays visible).

**What stays typed, deliberately**: everything no document shows — occupation, residence
type, the NEW firearm's details (unless bought on site — see the pricing tie-in, where
the order supplies make/model/calibre/serial), `firearm_fit_reason`, storage detail,
history (extraction NEVER reads history — existing rule, unchanged), spouse/marital
(271-only, no source document).

**Net effect**: a first-time s13 applicant types roughly a dozen narrative answers; the
identity-shaped remainder is photographed, read and confirmed. That is the honest
version of "minimal effort" — fewer questions because we already hold the answer, never
fewer because we stopped asking.

---

## Licence & Competency Centre — the vault pillar (planned 2026-08-19)

Operator: *"We need to create like a licence and competency centre on its own. Where
people can keep and upload their licences and competencies. So it can be kept book of
and tracked for expiry. This way we can have recurring income."*

One sentence: **a private, encrypted vault where a member keeps every firearm licence,
competency certificate and dedicated-status letter, with expiry tracked and renewal
handled by the motivation writer.** It slots between the writer and the checker: the
writer fills it (every motivation upload can be kept), it fills the writer (a renewal
pre-attaches everything), and the checker will later read it.

### Why this is the recurring-income engine

Licences expire on a statutory clock — renewal demand RECURS by law, forever. The Centre
owns the moment that demand surfaces:

1. **Renewal packs** (exists already): the T-180 reminder lands with one tap → an
   `S24_RENEWAL` motivation, pre-filled from the vault, priced by the existing table
   (R199 / R99 / free-with-PRO). No new billing surface needed for revenue on day one.
2. **Subscription pull**: reminder automation + the family vault are natural AO Pro
   benefits — a reason to HOLD the R99/mo that has nothing to do with trading.
3. **The data moat**: a member whose licences live here renews here, and Phase 2's
   checker and Phase 3's feed get their coldest data warm.

### Data model (mirrors MotivationUpload, deliberately)

```
enum CredentialKind { FIREARM_LICENCE | COMPETENCY_CERTIFICATE | DEDICATED_STATUS
                      | PROFICIENCY | OTHER }

model Credential {
  id, userId, kind
  title            String    // user's own name for it: "My .308" — guidance says no serials
  detailsEncrypted String?   // number, holder, make/calibre/serials, issuer — AES-GCM,
                             // same blob-crypto keys as motivation uploads
  issuedOn  DateTime?        // IN THE CLEAR — the reminder cron queries it
  expiresOn DateTime?        // IN THE CLEAR — dates alone identify nothing; every
                             // identifying value lives in detailsEncrypted
  confirmedAt DateTime?      // ⚠️ THE SAFETY RAIL — see below
  storageKey, mimeType, byteSize, sha256   // SecureFileStorage, existing crypto
  extractionEncrypted, extractionOk, extractedFields   // same pattern as uploads
  reminderStagesSent String[]  // idempotency: 'T180','T120','T100','T30','D0'
  remindersMuted Boolean @default(false)
  @@unique([userId, sha256])  @@index([expiresOn])  @@index([userId])
}
```

### The one rule that matters most

**Reminders fire ONLY on a date the member has confirmed** (`confirmedAt`). Extraction
proposes the expiry; the member sees it large and confirms or corrects it. A misread
expiry that silently drives reminders is how someone misses a real renewal deadline
because of us — worse than no reminder, and the sort of harm no disclaimer unwinds. The
document as printed always governs; the confirm screen and every reminder say so.

### Reminder engine

- Nightly cron (03:00 SAST, admin-health monitored like the other 26): scan confirmed
  `expiresOn`, fire stages **T-180 → T-120 → T-100 → T-30 → D0**, stamp
  `reminderStagesSent`. T-100 exists because of the statutory renew-by window
  (⚠️ verifyBeforeUse: s24 says at least 90 days before expiry — attorney confirms the
  copy; until then the wording is "well before expiry", no number).
- Channels: in-app notification + account-menu badge (module-counts rail exists), PWA
  push, email — and SMS per the pricing decision below.
- **SMS wording is neutral, always**: "A document in your Licence Centre expires in 90
  days." Never the word firearm in an SMS preview on a lock screen.
- ⚖️ Copy discipline: we REMIND, we never ENSURE. "We'll make sure you never miss a
  renewal" is an outcome promise — banned, same as the writer.

### Wiring into what exists

- **Writer → Centre**: after a motivation completes, one tap keeps its licence /
  competency uploads in the vault (bytes DUPLICATED, not shared — the two rows have
  different retention lives, and the writer's purge must never eat the vault's copy).
- **Centre → Writer**: the wizard's documents step offers "attach from your Licence
  Centre" — no re-photographing. M-A's competency requirement is satisfied in one tap by
  the vault's certificate; M-B's collapsed fields read off it.
- **Renewal loop**: reminder → prefilled S24_RENEWAL → priced by the existing table →
  outcome lands back in the vault as the NEW licence. The circle is the product.

### Privacy + lifecycle (attorney gate, with the template review)

- POPIA purpose stated at upload: kept to track expiry and prefill applications, nothing
  else. Admin surfaces see counts and health, never blobs or decrypted details.
- Vault retention is USER-controlled — it lives while the account lives (unlike
  motivation uploads, which purge on the writer's own clock). Account deletion extends
  `purgeForUser`: vault rows and blobs go with it.
- Backup note: vault blobs join the nightly Box tree — worthless without
  `ID_HASH_SECRET`, same warning as everything else under that key.

### Pricing — DECIDED: model C, freemium (operator, 2026-08-19)

| Model | Free tier | Paid | Trade-off |
|---|---|---|---|
| **A. PRO-only** | nothing | Centre entirely inside AO Pro R99/mo | cleanest story; smallest funnel — non-Pro members store nothing, data moat starves |
| **B. Standalone sub** | view 1 credential | Centre sub ~R29/mo or ~R249/yr; PRO includes it | own revenue line; second billing surface to build and explain |
| **C. Freemium (recommended)** | store + see expiry dates, unlimited | reminder AUTOMATION (SMS/push/email), family vault, renewal-pack discount = PRO | maximises documents-in (the moat and the prefill), sells PRO at the exact moment the member feels the deadline |

**Chosen: C.** Storage free, automation paid — store + see expiry dates free for
everyone; reminder automation (SMS/push/email), family vault and a renewal-pack discount
are AO Pro. The renewal-pack table already monetises the deadline itself, so free
storage costs us almost nothing and feeds everything. B stays available later as an
annual "Centre pass" for people who will never trade.

**Build status: PLAN ONLY (operator, 2026-08-19).** Nothing starts — M-A/M-B included —
until the operator says so.

### Build phases (each dark behind `licence_centre_enabled`, OFF = INERT)

- **LC0 — vault**: schema + migration, CRUD, upload → extract → CONFIRM flow, expiry
  badges, account-menu module. Reuses SecureFileStorage, extraction service, admin kit.
- **LC1 — reminder engine**: cron + stages + in-app/push/email, admin health row,
  neutral-SMS rail behind `licence_centre_reminders_enabled`.
- **LC2 — writer integration**: attach-from-vault, keep-to-vault, renewal one-tap with
  the pricing table. (M-A/M-B land first and make this mostly wiring.)
- **LC3 — monetisation + polish**: pricing model per the decision above, family vault
  (spouse's documents, PRO), dealer/association document kinds.

### Sequencing amendment

M-A and M-B are small and ship first (they correct live behaviour). Then LC0–LC2. The
checker (old Phase 2) moves AFTER the Centre and gets richer for it — checker milestones
attach to the renewal applications the Centre generates. Feed still ships last.

## Phase 2 — Application Checker

**Fact that shapes it:** SAPS/CFR has no API. Nobody can query application status
programmatically — the honest build is self-tracked milestones plus crowd data, which is
also a unique-data moat nobody in SA publishes.

- **Milestones** (user-updated, with nudges): submitted at DFO → SAP 523 reference captured
  → CFR acknowledged → in circulation → outcome (approved / refused → appeal window).
- **Crowd stats**: anonymised aggregates by licence type + province — "your s16 is at day 62;
  the median approval in Gauteng reached circulation at day 90". Only shown where the sample
  is big enough to be anonymous (n ≥ threshold).
- **Letters** (the differentiator): when an application stalls past the crowd norm, Boet
  drafts the follow-up — status enquiry to the DFO/CFR, PAJA unreasonable-delay escalation,
  refusal → appeal-notice reminder with deadline tracking. Formal PDFs the user sends
  themselves; we never send on their behalf. Attorney reviews these templates too.
- **Loop with Phase 1**: writer users are prompted to track the application the motivation
  went into; outcomes captured here are the quality feedback the automated writer needs.

## Phase 3 — Feed + Awards

- **Structured post types**: General / Hunting / Target / Fishing / Question / Review, with
  optional gear fields (rifle+calibre, rod+bait, scope…) mirroring the proven Safari
  blueprint — but ours link to marketplace listings and brand pages.
- **Visibility split, enforced server-side** like `publicVisible`: Hunting/Target and
  anything regulated-tagged is members-only, full stop. Fishing/camping/general outdoor
  posts can be public (per-post toggle), giving the SEO + WhatsApp-unfurl growth loop that
  Safari's screenshot-blocked, app-locked feed cannot have.
- **Moderation**: Claude pre-screen on EVERY post and comment before publish, fail-closed —
  same pattern as listing moderation. Blocks: ammunition sales talk, contact-detail
  exchange, doxxing, threats. Graphic trophy photos: behind the wall only (the split does
  this automatically), tap-to-reveal blur as polish.
- **Awards**: points for posting, commenting, and likes RECEIVED (never likes given —
  anti-farming), quality-weighted, daily caps. Levels with bilingual ranks, profile badges,
  monthly leaderboard (usernames only — house rule). Cosmetic only.
  ⚖️ **Awards must NEVER grant prize-draw entries** — activity-for-entries walks straight
  into promotional-competition rules and poisons the draw's subscription-benefit framing.
- **Cold start**: beta writer users are the seed audience; Boet posts a weekly digest;
  operator posts. Feed ships LAST for exactly this reason.

## Shared infrastructure (all reused, all existing)
Clerk auth + the members wall · KYC camera capture + Claude vision extraction · fail-closed
moderation service pattern · notifications (push/SMS/email) · activity/insights tracking ·
admin kit (new modules: motivation queue viewer, checker stats, feed mod queue, awards
config) · feature flags per module, default OFF, dark-deployable · encrypted document
storage (SAP 534 pattern).

## Sequencing + dependencies
1. Phase 1 build → **capped free beta live** (no payments needed). ✅ 2026-08-19
2. M-A + M-B (operator corrections above), then Licence Centre LC0–LC2 — the vault
   becomes the second pillar, ahead of the checker.
3. Peach go-live → R199/R99 switches on (same flag discipline as everything else); LC3
   monetisation rides the same moment.
4. Checker build after the Centre (milestones attach to the renewals it generates;
   letters templates to attorney alongside the writer templates).
5. Feed after the writer+centre+checker have filled the user base.
5. Later phases (parked): multi-association activity submission (the anti-FOSA neutrality
   wedge), concierge checker tier, PRO integration (free motivation/year?), sensitive-image
   blur, rank-ladder naming session.

## Risks worth remembering
- **Template-sameness at CFR** is the existential product risk of full automation — the
  variation engineering + quality gate + throttle exist because of it. If beta feedback
  shows CFR pushback, the fallback is spot-check human review, already designed around.
- **The public feed is the only public surface in this plan** — everything else is behind
  the wall. Any leak of regulated content to the public side is a Meta-strategy breach;
  server-side enforcement, never client-side.
- **The R99 buyer discount** needs the voucher to survive refunds/cancellations sanely —
  voucher voids if the firearm order is refunded.
