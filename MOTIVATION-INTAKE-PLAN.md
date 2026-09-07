# Motivation Centre intake: plan

Date: 2026-09-07. Status: proposal for operator sign-off. Supersedes the "who fills the
SAPS 271" gate in `motivation-fields.ts` and the elicitation half of
`motivation-narrative-engine.md` §3, which this plan implements.

Sources read: the live registry (`FIELD_REGISTRY_VERSION 2026-09-07c`), both wizards
(`STEP_PLAN`, `WIZARD_STEPS`), `motivation-prefill.service.ts`, `saps271-coverage.ts`,
`SAPS271-PREFILL.md`, `motivation-narrative-engine.md`, `motivation-document-routing.md`,
`DFO-application-documents-by-section.md`, the Engala motivations questionnaire (xlsm),
seven approved motivations (Gerstner x4 S16 DS, Fourie x2 S16 DH, one S13 Afrikaans), the
SAPS e271 AcroForm, the seller consent page.

---

## 1. The decision: stop asking who fills the 271

The SAPS 271 is split by party, not by "the dealer does it or we do":

| Part | Who completes it | Where the data already is |
|---|---|---|
| D  type of application | applicant | `licenceType` |
| E  the firearm | dealer (350(a)) on a dealer sale; applicant otherwise | licence card / invoice OCR, `firearm_*` |
| F  current owner | dealer, private seller (81-87), or executor | `firearm_source`; the seller consent flow already collects every F box |
| G  applicant | applicant, always | ID, address, employer, competency, owned licences, association: all vault |
| H  declarations | applicant, always | six history questions |

So the applicant's half (D, G, H) is ours to produce in every case, and we hold almost all
of it. The current `fill_saps271` choice hides ~48 fields behind a decision the applicant
cannot make well on step 1 and that the dealer never actually makes for them (a dealer
completes E/F/350(a), not G and H).

**Rule going forward: every pack ships a pre-filled 271 with D, G and H complete and E
filled from what we read off the firearm.** F is filled by route:

- `From a dealer`: F left blank for the dealer; pack cover note says so. The dealer's
  350(a) is on their side.
- `From a private owner`: F 81-87 pre-filled from the seller consent flow, printed as the
  seller's page to sign. The consent letter and this page are the same data.
- `Inherited from a deceased estate`: F Type E pre-filled from the executor's appointment
  letter (`EXECUTOR_APPOINTMENT` upload already exists); executor signs 79-87.
- `S24_RENEWAL`: no 271. SAPS 518(a) instead (not built; see §7).

Delete the question. Nothing else is decided by it once formOnly stops gating.

Regulation 13(3) says the form is completed "in black ink by the applicant personally".
SAPS's own e271 is a typed AcroForm, and typed 271s are accepted at every DFO in the
approved packs on file, so the exposure is the signature, not the typing: the pack cover
sheet tells the applicant to sign in black ink, in person, at the DFO.

---

## 2. Principles the flow is built on

1. **Documents first, questions last.** A photograph of a licence card, an ID, a competency
   card, an association certificate and a proof of address answer roughly forty boxes and
   half the motivation. Every step opens with its document door and asks only what the
   documents did not answer.
2. **Selection, not composition.** No free-text box is ever the primary input. The engine
   proposes cards; the applicant taps. One optional "anything specific" box per step,
   prefilled with the synthesis of what was tapped. This is `motivation-narrative-engine.md`
   §3 and it is what the approved packs actually contain: the applicant-specific prose in a
   21-page Gerstner motivation is about 300 words.
3. **Profile once, application many.** Anything true of the person rather than the
   application (marital status, premises security, reloading, what each owned firearm is
   used for) is captured once against the member and reused. The second application asks
   nothing that the first one did.
4. **Fill it in, arm it, let them change it.** Operator rule, 2026-08-25. A derived value is
   written with provenance and shown as filled, never held back for confirmation.
5. **The motivation never learns about a "No".** The formOnly discipline stays exactly where
   it protects the writer (clean-record answers, contact numbers, spouse ID). It stops
   deciding what is asked.

---

## 3. The flow

Nine screens. Typical taps in brackets for an S16 sport applicant with a populated vault.

### 3.1 Section
Licence type. Blocked at entry if `inventory` already holds an S13 licence and the applicant
picks S13 (one firearm under s13). S24 routes to the renewal flow and skips E/F entirely.
[1 tap]

### 3.2 The firearm
Document door: licence card, dealer invoice or pro-forma, advert, half-filled 271. Reads type,
action, make, model, calibre, all four serials. Cover photo from the same upload where it is a
photograph of the firearm. Asked only if unread: model, calibre. [0-2 taps]

Then `firearm_source` (dealer / private / estate / undecided). On private, the seller consent
link is sent from here and runs in parallel; its return fills F and attaches the seller's ID
and licence copies to the pack. [1 tap]

**New:** overlap check runs here, immediately. `motivation-overlap.ts` already compares
calibres against the owned table; extend it with the type/action/section axes from the
narrative-engine §4.2 and surface the result as a card on this screen: "You already hold a
CZ 75 in 9mm. This one will be your ___" with the engine's ranked angles (division /
backup / match-and-practice / different format) as taps. The applicant confirms one. This
is the single highest-value question in the product and it currently arrives as an empty
`overlap_justification` textarea on step 3.

### 3.3 Competency
Entirely from the vault (`COMPETENCY_CERTIFICATE`, `PROFICIENCY_CERTIFICATE`). Shows what was
read, flags a missing endorsement for this firearm type against `requiredEndorsement()`.
Asked only if the vault is empty. [0 taps]

### 3.4 Firearms you already own
From vault `CURRENT_LICENCE` rows. **New, profile-level:** for each owned firearm without a
`primary_use`, one card row with calibre-derived suggestions ("plains game to 300 m",
"IPSC Production", "self-defence carry", "clays"). Asked once per firearm, ever. This is
what the "Existing firearms" section of every approved motivation is written from, and what
the overlap angle in 3.2 needs. [1 tap per unassigned firearm, then never again]

### 3.5 About you
ID, address, occupation, employer from documents. Cellphone from the account
(`motivation-profile.ts` already offers it as `cellphone`; today it is hidden by
`formOnly`), email from the account. Postal address: "same as residential" toggle, default on. Residence type: one tap. Marital
status: one tap; spouse name and ID only if married. All of these become plain optional
fields, not formOnly, so the 271 can always be completed. Profile-level; asked once.
[2-4 taps first time, 0 after]

### 3.6 Your premises and storage
**New section, profile-level.** The Engala questionnaire's security block, as tap cards,
because every approved motivation carries a "Security and safe storage facility" paragraph
and the registry cannot write one today:

- premises enclosure (wall / palisade / electric fence / none)
- access control (remote gate / manual gate / guards / estate boom)
- alarm (yes: monitoring company as a short field) and armed response (yes/no)
- burglar bars, security gates (yes/no each)
- safe type (rifle safe / handgun safe / strongroom) and mounting (wall / floor / both)
- who holds the key (only me / shared)

`safe_present`, `safe_type`, `safe_mounted`, `safe_mounted_to` lose formOnly so the S86
paragraph is written for everybody. `safe_storage_detail` becomes the prefilled optional
box. Photo door: `SAFE_PHOTOGRAPHS`. [6-8 taps first time, 0 after]

### 3.7 Your case (type-specific; the only screen that differs by section)
Cards, pre-ranked by what the vault already says. Each card is one sentence in the
applicant's voice. Selected means true (FCA s120(9)(f) is why this is selection and not
silent inclusion).

**S13 self-defence** [6-10 taps]
- Lives in a precinct with documented housebreaking / robbery (auto-suggested from
  `police_station` + crime stats; stat shown on the card; `press_clippings` attach here)
- Travels at night or on isolated routes
- Work involves cash, stock or valuable equipment
- Smallholding / no armed-response perimeter
- Responsible for dependants at home (count)
- Load shedding leaves gate and perimeter unpowered
- Rents and cannot harden the property further
- Victim of crime in the last five years (optional CAS number and station; `INCIDENT_REPORT`
  door). Never suggested, only offered.
- Carry style: concealed / home defence / both
- Existing measures already covered by 3.6, rendered as "the firearm supplements these"
- Movement profile from the Engala list (restaurants, outdoor events, camping, cycling,
  hiking, fishing, hunting, golf) as multi-select; drives the "daily movements" paragraph

**S15 occasional hunter / sport** [3-5 taps]
- Game-class cards ranked by calibre fit (small / plains light / plains medium-large /
  dangerous / wingshooting), each pulling species and range bands
- Terrain and province multi-select
- Where they hunt: farms by invitation / own or family land / outfitter
- Started hunting at (decade picker) and roughly how often per season
- Generic: meat for the pot, culling, introducing family, own firearm instead of borrowing

**S16 dedicated hunter** [3-5 taps]
- Association block from the vault (`ASSOCIATION_CARD`, `GOOD_STANDING_LETTER`,
  `ASSOCIATION_ENDORSEMENT`); the endorsement's own discipline wording is preferred for
  the angle because it agrees with a document in the same pack
- S15 hunting cards plus the association's hunting-derived exercises card
- `activity_record` door: `SHOOTING_ACTIVITY_LOG`, hunt permits, register pages

**S16 dedicated sport** [3-5 taps]
- Discipline cards from `shooting-disciplines.ts` (already 59 entries with equipment
  rules), ranked by association; tapping one seeds `discipline_requirement`
- The overlap angle from 3.2, shown again for confirmation if the applicant skipped it
- Generic: own equipment instead of borrowing, own range time, postal exercises, maintain
  dedicated status, competitive equipment
- Competition record: multi-select of formats (club monthly / provincial / national /
  postal) plus optional attachments; free text stays optional and prefilled

**S24 renewal** [2 taps]
- Purpose unchanged (yes) and still active (yes). Anything else routes out.
- `existing_licence_number` and `licence_expiry` read off the card, never typed.

### 3.8 Declarations
The six history yes/no questions, asked of everyone, near the end, "No" not first. A "Yes"
opens its detail (to the writer) and its four form boxes (formOnly). This section moves out
from behind the 271 gate: today a dealer-path applicant is never asked, so a conviction
never reaches the motivation, which is the one thing the document must address head-on.
[6 taps]

### 3.9 Your pack
- Coverage meter (`saps271-coverage.ts`, unchanged: it counts questions, not boxes)
- The pre-filled 271 as a preview, with the F route explained
- The pack checklist by section and by source route from
  `DFO-application-documents-by-section.md` (Engala prints exactly this as the cover page:
  "Vat saam met jou ... al die onderstaande dokumente")
- Anything still empty appears inline here, once, not scattered back through the wizard
- Generate

---

## 4. What stops being asked

| Today | Becomes |
|---|---|
| `fill_saps271` choice | removed; F route from `firearm_source` |
| `threat_circumstances`, `daily_movements`, `alternatives_considered` (long) | S13 cards; one optional prefilled box |
| `hunting_history`, `hunting_locations`, `intended_quarry` (long/short) | hunting cards |
| `competition_record`, `activity_record` (long) | format multi-select + attachments |
| `firearm_fit_reason` (long, required) | written from the overlap angle + Tier 1 research; optional box |
| `safe_storage_detail` (long, required) | written from 3.6 cards; optional box |
| `overlap_justification` (long) | the confirmed angle card in 3.2 |
| `continued_use` (long, S24) | two yes taps |
| `competency_expiry` (typed) | derived (already `dateSource: 'derived'` in the vault) |

Every long field survives in the registry as optional and prefilled, so nothing a member
already typed is lost and `sanitiseAnswers` keeps accepting it.

---

## 5. Registry changes (the actual diff)

1. New `kind: 'cards'` with `options: CardOption[]` (`key`, `sentence`, `rankBy?`) and
   `multi: true`. Stored as a comma list like `multi` today, so `showIf` on a card value
   works unchanged.
2. `scope: 'profile' | 'application'` on `MotivationField`. Profile-scoped answers are
   written to `MemberProfileAnswers` (new, encrypted like `answersEncrypted`) and offered
   through `motivation-prefill.service.ts` under the existing `ProvenanceSource`
   `'PROFILE'`. Until a member has profile-scoped answers, `priorAnswers()` /
   `carriesForwardAsAnswer()` in `prior-readings.ts` cover the transition from their last
   application.
3. Remove `formOnly` from: history yes/no x6, `safe_present`, `safe_mounted`,
   `marital_status`, `spouse_*` gate, `postal_address`, `residence_type`,
   `home_telephone`, `work_telephone`, `cellphone`, `licence_holder_type`. Keep it on the
   station/CAS/charge/outcome boxes, dialling codes, postal codes, spouse ID/passport.
   `NEVER_PROMPTED` keeps the clean-record answers out of the fact pack; that set is what
   does the anti-padding work, not `formOnly`.
4. `isVisible()` drops the `SAPS271_OPT_KEY` branch. `fill_saps271` moves to
   `retiredChoices`-style acceptance so old blobs still save.
5. New section `'Your premises'` (profile scope) with the 3.6 fields.
6. New `existing_firearm_N_primary_use` (cards, profile scope, `docSourced` never) on the
   owned rows.
7. `primary_use` and the overlap angle feed `motivation-overlap.ts`; extend the curated
   table with type/action/section axes and a `suggestedAngle` output. Still exact-match,
   still asks when the table has no answer.
8. Bump `FIELD_REGISTRY_VERSION`.

`saps271-coverage.ts`, `saps271-map.ts`, `saps271.service.ts` need only the F-by-route
rule. The wizard change goes into `wizard-rail.tsx` (pack screen) if
`NEXT_PUBLIC_LICENCE_SERVICES_ENABLED=true` on the box, else `STEP_PLAN`. Not both.

---

## 6. Recommendations outside the current model

1. **Seller's F page.** The consent flow already captures every F 81-87 value. Render the
   271 F page pre-filled and put it in the seller's link beside the consent letter, so the
   seller signs both on their phone and the pack arrives complete. Today the seller signs a
   consent and the F page is still blank at the counter.
2. **Dealer pro-forma OCR.** On a dealer sale the only document that exists yet is the
   invoice or pro-forma. Add it to `FIREARM_SOURCE_PROOF`'s readers: make, model, calibre,
   serial, and the dealer's name and FAR number for the cover note.
3. **Previous motivation as a seed.** `PREVIOUS_MOTIVATION` is an upload kind already.
   Read it: experience paragraph, premises paragraph, existing firearms table. A member
   who used Engala last time should see their own history pre-ticked.
4. **Reloading, once.** "Do you reload? calibres, since when" as a profile card. Every
   approved hunting pack has a reloading paragraph when it applies.
5. **Tier 1 research cache.** The Gerstner and Fourie packs are 60% firearm and calibre
   writeup. `motivation-model.service.ts` already researches; cache by
   `make|model|calibre|use_class` with a six-month TTL so the second Beretta 1301 applicant
   costs no search call.
6. **SAPS 518(a) for S24.** Same overlay approach as the 271; the pack for a renewal is
   incomplete without it and the applicant has to find and fill it themselves.
7. **Dealer handoff.** Some dealers will want the applicant's D/G/H to arrive typed so they
   can staple their 350(a). A "send to my dealer" action that emails the pack PDF to a
   dealer address the applicant enters removes the last piece of paper-shuffling.
8. **Movement profile and dependants** (S13 only) come from the Engala questionnaire and
   appear in the approved SD motivation; they are one multi-select and one number.

---

## 7. Build order

Each step is deployable alone and leaves the wizard working.

1. Registry: remove formOnly per §5.3, drop the gate in `isVisible()`, retire
   `fill_saps271`, move Declarations to the second-last step. Tests:
   `motivation-fields.spec`, wizard-coverage suites, `saps271-coverage.spec`.
2. 271 F-by-route in `saps271.service.ts`; pack cover note per route.
3. `'Your premises'` section + profile scope + `MemberProfileAnswers` + prefill source.
4. `kind: 'cards'` and the S13 / hunting / sport selection sets; long fields flip to
   optional-prefilled. Writer prompts read cards from the fact pack (one sentence each).
5. `primary_use` on owned rows + overlap angle card on the firearm step.
6. Seller F page in the consent link; dealer pro-forma OCR.
7. Previous-motivation seed; reloading card; research cache; 518(a); dealer handoff.

---

## 8. Open for the operator

- Confirm the F-by-route rule replaces the question entirely (no "don't print a 271" option).
  Proposed: yes; a 271 nobody uses costs one sheet of paper.
- Profile-scoped answers are shared across a member's applications by default. Confirm.
- Cards are written in the first person and the applicant signs under them. Confirm the
  wording review sits with you before each set ships.
- Is `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED` on in production? Decides which wizard the
  step changes land in.
