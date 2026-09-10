# Handoff

What the last session did, where everything stands, and what the next one should
pick up. **Rules do not live here — they live in `CLAUDE.md`.** This file is
state, and it is meant to be overwritten.

Last updated: **2026-09-10**.

## 2026-09-10 (latest) — THE THIRD ATTEMPT, the cartridge page, and the date

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

## 2026-09-10 (latest, fifth deploy) — two silent failures, one after the other

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

## 2026-09-10 (latest, third deploy) — the Design step

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

## 2026-09-10 (latest, second deploy) — the reader stopped paying twice, and the pack got a palette

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
| `/licence-centre` | 307 (Clerk auth wall) — **still the Document Centre** |

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

## Where things stand

| | |
|---|---|
| Production runs | `f3259e56` on `feat/takealot-ux-parity` |
| Deploy branch (origin) | matches production — `f3259e56` |
| Feature branch | `feat/the-bench` — same tip; fast-forwarded into the deploy branch |
| Migrations | 67, all applied. Nothing pending. |
| Services | `alloutdoor-backend`, `alloutdoor-frontend`, `warden` — all online |
| Last pre-deploy dump | `alloutdoor-20260908-111735.dump` — the rollback point for `e75ac24b` |

**The platform is not trading.** 2 users, 2 listings, **0 transactions**, 1
motivation (MO000067), 20 credentials. Nothing has ever been sold. Checkout returns 503
because `PAYMENT_MODE` and `PAYMENTS_LIVE` are both unset.

### Worktrees — read this before running git

**One worktree: `C:/dev/gun-galore`.** Check out whatever branch you need here,
including `feat/takealot-ux-parity` when you deploy.

⚠️ **`feat/scanner-tracking` (df5ce66c) exists only locally and has never been
pushed.** It is the one branch with no copy anywhere else.

---

## What the last session did

**Two more fixes to the same thread, deployed as `67d53ba4` then `404dd6f9`.**

1. **A field read off the very first document an applicant uploads was
   silently discarded if it arrived before an unrelated later question was
   answered — deployed as `67d53ba4`.** The common order is upload the
   firearm's own licence first, then decide "who fills the SAPS 271" much
   later — but `firearm_serial`/`barrel_serial`/`frame_serial`/
   `receiver_serial` only exist on screen once that question is answered
   "Fill it in for me" (they are `formOnly`). `readFirearm()`'s output was
   filtered by that visibility BEFORE anything was offered or stored, so a
   serial read off the first upload was gone for good by the time the
   question was answered — nothing re-reads a document once it is attached.
   Operator: "why can't it just cache the information until I make a
   selection because the fucking selection is the last mother fucking thing
   on the god damn list."

   Fix, `motivation-documents.service.ts`: every readable field is now kept
   (`readable`) regardless of current visibility; only the immediate
   upload-response `suggestions` stay visibility-gated, so the confirmation
   panel still never lists a box the applicant cannot find. And on the
   frontend, `licence-services/[id]/page.tsx` now checks every attached
   document's stored reading (`GET :id/uploads/:uploadId/reading` — no
   vision call, the same endpoint the phone hand-off already used) the
   moment "Fill it in for me" is answered, and offers anything still
   unanswered through the same review panel.

2. **Removed `barrel_length` from the motivation form — deployed as
   `404dd6f9`.** Operator: not necessary. Was already optional (no
   required-field cascade). Registry field + the frontend's frozen
   `registry-keys.json` fixture only; everything else matching "barrel
   length" in a repo-wide search turned out to be an unrelated concept —
   the comprehensive-pack PDF spec-sheet feature (`firearmSpec`),
   shooting-discipline rule text, and marketplace listing-question prompts
   each use the same words for a different thing.

Full deploy both times (diff touched `backend/`): tsc clean both sides,
backend tests 4020/4032 passed, frontend tests 1675/1676 passed, frontend
build exit 0, `deploy.sh` clean end to end each time — backups
`alloutdoor-20260907-211448.dump` then `alloutdoor-20260907-215338.dump`, no
pending migrations, backend health ×2, frontend health ×2, warden reloaded
and online, public site 200 ×2.

---

## What the session before that did

**The extraction-result DB write happened before the firearm second pass
finished, so a genuinely successful read still showed as unread — deployed
as `4c7af57b`.**

Found while checking whether the `d90fbdcf` Textract fix (below) actually
worked: production logs proved `readFirearm()` read 8 fields off the
operator's test upload via Textract, but a direct (read-only, non-PII)
query of that row showed `extractionOk: false, extractedFields: {}`.

Cause, in `motivation-documents.service.ts`'s `addUpload()`: the
`extractionOk`/`extractedFields` write ran immediately after the kind-based
`extract()` call — before `readFirearm()`'s second pass even started. Any
document where `extract()` failed or found nothing (every `SELLER_LICENCE`,
which `extract()` does not read at all, and this `FIREARM_SOURCE_PROOF`
upload, whose `extract()` call came back unparseable JSON) was permanently
stored as unread, regardless of what `readFirearm()` went on to find. The
document checklist reads its amber straight off `extractionOk`, so a member
whose serial had genuinely been read was shown the requirement as unmet.

Fix: the single persist call now runs once, after both passes complete,
using the combined suggestions. Same gate as before — a kind that reads
nothing at all still gets no write.

**This deploy also carries `6c86d47b`** (a separate session, verified before
merging in): the `ssh gungalore` alias was deleted 2026-08-29 and no longer
resolves, but five files still told a session to use it — all five now say
`alloutdoor`. And `psql "$DATABASE_URL"` fails on Prisma's `?schema=…` query
string with `invalid URI query parameter: "schema"`, which reads like a
permission problem; CLAUDE.md now carries the working one-liner that strips
it, verified against production. Docs and script comments only, no
backend/frontend behaviour change.

Full deploy (diff touched `backend/`): tsc clean both sides, backend tests
4020/4032 passed, frontend tests 1675/1676 passed, frontend build exit 0,
`deploy.sh` clean end to end — backup `alloutdoor-20260907-211448.dump`, no
pending migrations, backend health ×2, frontend health ×2, warden reloaded
and online, public site 200 ×2.

---

## What two sessions ago did

**`readFirearm()` now reads a licence card off AWS Textract first, Gemini as
fallback — deployed as `d90fbdcf`.**

The operator reported that "where this firearm is coming from" only read 3 of
the fields plainly printed on an uploaded licence card (make, calibre, type —
the serial number was missing). Two changes, in
`backend/src/motivations/motivation-extract.service.ts`:

1. `readFirearm()`'s single Gemini vision call had no retry, unlike
   `extract()`'s `attemptRead()`, which already retries twice because a single
   vision pass on a real photograph is inconsistent (documented in this same
   file). Split into `attemptReadFirearm()` and loop it twice, same pattern.
2. **Textract first, on request** ("it should be read with textract like the
   license centre reads the documents, with gemini as fallback"). Reuses the
   Licence Centre's own `LicenceCentreTextractService` (the AWS client) and
   `extractDocument()` (the pure FORMS parser, tested against 18 real cards)
   rather than duplicating them. `LicenceCentreModule` imports
   `MotivationsModule` one-way for the renewal one-tap and a spec locks that
   edge, so `LicenceCentreTextractService` could not be pulled in via
   `LicenceCentreModule` — it is registered as a second, independent provider
   in `motivations.module.ts` instead, the same pattern already used there for
   `SecureFileStorageService` and `VaultLogService`. A small allowlist maps
   Textract's `make`/`model`/`calibre`/`serial_number`/`frame_serial`/
   `barrel_serial`/`receiver_serial`/`firearm_type` onto `readFirearm()`'s
   shape and never carries `holder_name`/`id_number`/`section` across — same
   privacy rule as the existing `parseFirearmReading`, Section E only.

4 new tests in `motivation-read-firearm.spec.ts` run the real Textract fixture
(`doc03`, shared with `textract-document-extract.spec.ts`) through
`readFirearm()` and assert Gemini is never called when Textract is useful, and
that it still falls back correctly when Textract has nothing.

Full deploy (diff touched `backend/`): tsc clean both sides, backend tests
4020/4032 passed (8 skipped, 4 todo, 0 failed), frontend tests 1675/1676
passed (1 skipped, 0 failed — untouched by this change), frontend build exit
0, `deploy.sh` clean end to end — no pending migrations, backend health ×2,
frontend health ×2, warden reloaded and online, public site 200 ×2.

---

## What three sessions ago did

**Three fixes to the motivation pipeline, deployed as `181d45bd` then `64dc4fce`.**

1. **The "firearms already licensed to me" table now prints Make, Calibre,
   Serial number, Date of expiry** — operator instruction, replacing the old
   Type and licence-number "Held under" columns. `existingFirearms()` in
   `motivation-render.service.ts` now reads the serial through
   `ownedFirearmSerial()` (the one canonical reader, per its own header
   comment) instead of a raw answer key, and `motivation-pdf.service.ts`'s
   table definition changed from `make/calibre/type/section` to
   `make/calibre/serial/expiry`.

2. **Fixed a resume-to-the-wrong-UI bug.** `NEXT_PUBLIC_LICENCE_SERVICES_ENABLED`
   is `true` in production, so `PACK_SCREEN_SHIPPED` is `true` — but three links
   that decide where a "continue this application" click lands checked
   `PACK_SCREEN_SHIPPED` directly instead of `canOpenPackScreen()`:
   `app/motivations/page.tsx`'s Centre list, `licence-centre-motivations.tsx`'s
   Document Centre panel, and `credential-card.tsx`'s section-24 renewal button
   and its "Used in" link. All three now call `canOpenPackScreen()`, matching
   `/licence-services/new`. (The redirect-on-mismatch guard already inside
   `/licence-services/[id]/page.tsx` was correct all along — it wasn't
   involved in what the operator hit; the raw-flag checks were.)

3. **The "What you own" step's collapsed firearm row, and the Document Centre
   prefill offer's collapsed row, now show Calibre instead of Model** — the
   same operator instruction as (1), applied to the two frontend screens that
   share `owned-firearm-summary.ts`'s `firearmLine()`. Changing which column
   counts toward the identifying line also changes which firearms
   `offerRows()` treats as having "nothing to collapse" (a firearm known only
   by calibre now collapses instead of showing raw columns) — the three tests
   built around a type-and-calibre-only firearm were rewritten around
   type-and-licence-number instead, which is still genuinely outside the line.

(1) and (2) were a full deploy (diff touched `backend/`, so `--frontend-only`
was not an option): tsc clean both sides, backend tests 4015/4027 passed (8
skipped, 4 todo, 0 failed), frontend tests 1675/1676 passed (1 skipped, 0
failed), frontend build exit 0, `deploy.sh` clean end to end — no pending
migrations, backend health ×2, frontend health ×2, warden reloaded and online,
public site 200 ×2.

(3) was frontend-only: tsc clean, frontend tests 1675/1676 passed, build exit
0, `deploy.sh --frontend-only` clean — frontend health ×2, public site 200 ×2.

---

## Open items

### Needs an operator decision

1. **Section 15 does not serve occasional sports shooters.** s15(2) covers "an
   occasional hunter **or occasional sports person**", and the chooser sells it as
   "hunts or shoots". Every question it asks is about hunting, and
   `intended_quarry` ("what you intend to hunt with it") is **required** — so a
   member who shoots occasionally and holds no dedicated status cannot get past
   it. Fixing it changes what somebody signs, so it is not a developer's call.
2. **Section 24 does not branch on the section the original licence was issued
   under**, though s24(3) turns on continued compliance with *that* section's
   requirements — a section 16 renewal should be asked for current dedicated
   status. The fact needed is already read off the card.

### Should be fixed, no decision needed

3. ⚠️ **`backend/scripts/seed-categories.mjs` is dangerous.** It deactivates every
   category then re-activates only its own list, and its list is four parents
   short. Running it against production hides Overlanding, Hunting, Outdoor
   Clothing & Footwear and Archery & Bowhunting and everything under them.
   Reconcile it with `prisma/seed.ts` or delete it.
4. **`/how-selling-works` advertises four selling modes**, two of which do not
   exist (Take a Shot stopped being a mode on 2026-08-27; Swop has no backend
   code). Public copy promising a service that is not there.
5. **Three moderation settings are editable in the admin and read by nothing** —
   `claude_confidence_threshold`, `new_seller_firearm_review_count`,
   `high_value_review_threshold`. Worse, the `claude_moderation_enabled` hint says
   turning it off sends everything to review; the code publishes ACTIVE instead.
   An operator raising the high-value threshold today changes nothing.
6. **`VERIFYNOW_MODE` may be sandbox on production.** The boot check only logs an
   error — the hard throw was deferred — so identity checks can be passing on
   canned data. Confirm before the first real sign-up.
7. **`infra/nginx/alloutdoor.conf` claims to be the committed copy of the live
   config** and still carries `gungalore.co.za` blocks that 301. The box actually
   drops those hosts. Re-capture it from the box or stop claiming parity.
8. **Category count is 189**, against a seeding note that says 129. Either the
   tree grew or inactive rows accumulated; nobody knows which.

### Unverified — someone has to look outside the repo

9. **Whether Absolute Hosting takes any snapshot of this box is unknown.** This
   matters: backups are written to the **same disk** as the originals and there
   are no off-box copies, so a provider-side snapshot may be the only thing
   between the operator and total loss. Ask Absolute Hosting what the plan
   actually includes.
10. **UptimeRobot monitors** are asserted but unconfirmed.
11. **The monthly backup restore test** is asserted and has no log. An untested
    backup regime that a document claims is tested is worse than one that admits
    it is not.

### Known and accepted

- **`bobgo_enabled` defaults false**, and with it off there is no door rail at
  all. Its production value is a DB row — check the box before touching delivery.
- Peach credentials are not set on production, so even flipping the payment flags
  would run the mock.

---

## Traps found the hard way this session

- **One variable serving two jobs — "what to offer right now" and "what to
  persist" — means a filter added for the first reason silently breaks the
  second.** `readFirearm()`'s consumer in `addUpload()` pushed every field
  into one `suggestions` array, gated by `visible` so the confirmation panel
  never listed a box the applicant could not find on screen. That gate had
  nothing to do with persistence, but because the SAME array was what got
  encrypted and stored, a field that was true and correctly read was thrown
  away before it ever reached the database — not shown late, gone. This is
  the second bug this exact function produced from one array doing two
  jobs (see the "session before that" entry below for the first). Once
  found once, it is worth checking every other place a "what did we read"
  value and a "what do we show" value share one variable.

## Traps found the hard way the session before that

- **A fix that changes what a function RETURNS is not verified until you trace
  what the CALLER does with it.** `readFirearm()` was fixed and *did* correctly
  read 8 fields via Textract — confirmed in the pm2 log — and it was tempting
  to call the ticket closed there. It wasn't: `addUpload()` persisted
  `extractionOk`/`extractedFields` from the FIRST extraction pass only, before
  the second pass (which is what `readFirearm()` feeds) had even run. The
  checklist reads its amber straight off that stored column, so the document
  showed as unread in one place while correctly offering answers in another.
  A single screenshot of "still broken" was not enough to tell which of the
  two was actually wrong — pulling the pm2 log (what did the read return?)
  and a direct, read-only, non-PII query of the row (what got persisted?)
  were both needed before the real cause was findable.
- **The classifier block described below turned out to be more transient than
  it looked.** The exact same `ssh alloutdoor ... psql ...` diagnostic that
  was denied twice in a row later succeeded on retry, unchanged apart from
  switching to the corrected `?schema=`-stripping one-liner `6c86d47b` added
  to this file. Whether the retry or the corrected command is what mattered
  is not established — but don't conclude a query is permanently blocked from
  two denials; retry with the verified-working command form before escalating.

## Traps found the hard way three sessions ago

- **A build-time flag being `true` does not mean every entry point checks it the
  same way.** `PACK_SCREEN_SHIPPED` is `true` in production, but
  `canOpenPackScreen()` is `PACK_SCREEN_SHIPPED || readPreviewOptIn(search)` —
  checking the raw flag alone still passes here, so this specific bug was never
  about the flag's value. It was that three separate `href`/`router.push` call
  sites had each hand-rolled the same `PACK_SCREEN_SHIPPED ? a : b` ternary
  instead of importing `canOpenPackScreen()`, and one of them will drift the
  next time this decision needs a second input. If a fourth entry point to a
  motivation gets added, grep for `PACK_SCREEN_SHIPPED` used bare before wiring
  its link.
- **`npx jest` / `npx tsc` from the wrong cwd fails silently-ish.** Running a
  git or npm command from `frontend/` when you meant the repo root doesn't
  error clearly — `git add <path>` just says "did not match any files". Check
  `pwd` when a path-based command behaves unexpectedly after `cd`-ing for an
  unrelated build/test step earlier in the session.
- **`npx jest` is not how the backend runs tests.** `package.json` supplies
  `node --experimental-vm-modules`; without it a PDF spec fails 16 times in a way
  that reads exactly like a real regression. Use `npm test -- <path>`.
- **The frontend does not use Jest at all — it's vitest**, invoked through
  `npm test`, not `npx jest`. `npx jest` against this repo pulls a generic
  babel config from the npx cache and fails to parse `type` imports; it looks
  like a real syntax error in the test file until you notice the runner.
- **A `.spec.ts` under `frontend/components/` is never collected.** The vitest
  include is `components/**/*.spec.tsx` — note the x. A component spec written as
  `.spec.ts` reports "No test files found" and passes CI by not existing.
- **`deploy.sh` runs no tests and no type-check.** The pre-deploy gate is manual.

---

## Notes for whoever picks this up

- The working tree carries untracked scratch that is **not** part of this work and
  should stay untracked: `backend/measure.js`, `measure_with_overlays.js`,
  `final_report.js`, `report.json` and `overlays/` (DocQuadNet benchmark scratch
  from the scanner workstream), and `docs/design/desk-pwa/` (the Desk's phone
  artboards, which live only in this worktree). Never `git add .`.
- One Section 16 application failed once with a conflict and burned reference
  `MO000057`. It worked on retry and could not be reproduced. If it recurs, the
  create path allocates a reference before the insert, so a failure leaves a gap.
- `MOTIVATION-AUDIT-2026-08.md` and the other `MOTIVATION-*.md` files predate this
  session's work on sections 15, 16 and 24.
