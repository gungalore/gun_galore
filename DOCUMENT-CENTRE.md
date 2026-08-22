# The Document Centre

One place for everything a member keeps. Built 2026-08-22 to 23, on the
operator's instruction:

> "When a person does their first application, WE need to store all the
> attachments they save. So if a new application is started we can prompt them
> if we may use previously loaded documents."
>
> "we also need to launch a window asking the user for us to keep the documents
> and explain why. Maybe when they first launch the Motivation Centre. Also give
> them access to it so they can add/remove documents from it"
>
> "maybe combine the licence centre and the document vault into one module where
> they can keep everything"
>
> "so we will have Document Centre and Motivation Centre"

---

## Why it existed as two things, and why that was wrong

The split ran on **expiry**, which is not a distinction any member recognises.

| | Licence Centre (`Credential`) | Motivation uploads (`MotivationUpload`) |
|---|---|---|
| Scope | The person | One application |
| Retention | **None — lives with the account** | **730 days, then the bytes go** |
| Member can add/remove | Yes | Only from inside that application |

So a competency certificate was safe and manageable, while the same member's
**ID copy and the photographs of their safe** — the most reusable documents a
person owns — sat on a deletion clock in a place they could not reach.

---

## What was already built (and nobody had said so)

Before any of this work:

- `buildLibrary()` already unioned the vault with **every upload across all the
  member's applications**, deduped on sha256.
- `addFromLibrary()` already **copied bytes** into the new application.
- The wizard already offered a picker on each checklist slot.

Documents were therefore already being kept and re-offered across applications
— **with no consent record anywhere.** That gap, not the plumbing, was the real
work.

---

## Decisions, and the reasoning that survives

### Widen the vault; do not build a third store

Three architectures were weighed. A new `MemberDocument` table put its service
in `LicenceCentreModule` and had `motivations.service` call it — a module cycle
that `tsc` passes and Nest crash-loops on, guarded by
`licence-centre.module.spec.ts`. A read-only facade never extended
`CREDENTIAL_TO_UPLOAD`, so it would have compiled clean and shipped inert.

Eight `CredentialKind` values were added instead, **named identically to their
`MotivationUploadKind` counterparts**, so the mapping is an identity map and
there is no translation table to get wrong.

### The member says what expires — not the enum

⚠️ **The first design got this wrong and a database constraint enforced the
mistake.** It listed eight "person" kinds that supposedly never run out, with
`IDENTITY_DOCUMENT` among them.

**A passport is an identity document and it expires.** The Centre's own
classifier prompt says so: *"the green barcoded book, the smart ID card, or the
photo page of a passport."* A member filing one would have met a database error
with no way round it.

`neverExpires` and `issuedOnUnknown` carry the answer; CHECK constraints keep
each answer internally consistent (a tick means the date column is null) rather
than second-guessing which documents may have dates. `'no-expiry'` is a real
state reading **"Kept on file"**, distinct from `unknown`: nobody-looked-yet is
outstanding work, ticked is settled.

Vision reads issue and expiry on everything **except** the four photographs of a
safe. There is nothing printed on those; a call returns empty and then flags the
row *"we could not read anything off that one"* against a photo that is fine.

### Bytes are copied, never shared

Vault documents have no retention clock and motivation uploads do. A shared
`storageKey` would let the writer's sweep — which nulls `storageKey` and stamps
`purgedAt` — silently blank a document out of somebody's Centre two years later,
with nothing in the Centre's own code to explain it.

**There are now five document write sites**, and every one mints a fresh key:

| Site | Namespace |
|---|---|
| `licence-centre.service.ts` `create()` | `credentials` |
| `motivations.service.ts` `addUpload()` | `motivations` |
| `motivations.service.ts` `addFromLibrary()` | `motivations` |
| `vault-adoption.service.ts` `adoptUpload()` | `credentials` |
| `kyc.service.ts` `submitDocument()` / selfie | `kyc` |

A sixth is a review failure.

### Consent is a comparison, not a null check

Five states — `never-asked`, `declined`, `given`, `stale`, `withdrawn`. The
version is stamped on **both** answers, because a no that stamps nothing is
indistinguishable from never having been asked, and the window would return on
every visit.

`stale` **fails soft**: keep what is kept, accrue nothing new. Deleting a
feature over a wording change is worse than a banner.

⚠️ **`never-asked` keeps working.** Reuse across applications is what the
product already does; switching it off for everybody the day this ships would
take a working feature away from people to punish them for our omission. The
narrowing bites on `declined` and `withdrawn` only.

### The backfill is cursor-driven, and that is why deletion means deletion

It walks strictly **older** than a watermark and advances it each batch, so a
document the member deletes afterwards is never re-copied. A nightly cron — the
obvious alternative — would resurrect it every night, because the row it copies
*from* is still sitting in the application.

Bounded at 15 per request: nginx caps at 60s, Cloudflare at 100s, and this
project has already lost a paid-for motivation to a 504 that hid completed work.
Consent is re-checked **every batch**.

### `VAULTABLE` is not the inverse of `NEVER_REUSABLE`

A document can be safe to offer on another application and still not belong in a
permanent library. An executor's appointment is reusable within one estate and
meaningless after it; an incident report belongs to the incident.

### Staleness: three documents, three different problems

| Document | Problem | Treatment |
|---|---|---|
| Proof of address | **Ages.** Judged on the date printed on it | Arithmetic, 90 days, warning names the date |
| Employment letter | **Goes wrong without ageing** — they changed jobs | A question, not a verdict |
| Safe photographs | **Not about time at all** | Asked: "the safe at the address on this application" |

Freshness reads the **issue date, never `createdAt`**: somebody can photograph a
six-month-old municipal bill today, and judging it by upload date would call a
stale document fresh — the one direction this must never fail in.

---

## Live bugs found on the way

1. **Last year's association endorsement was offered on this year's
   application.** `library()` scoped uploads to `motivation: { userId }` — every
   application ever — and `takeUpload` applied no kind filter. An endorsement
   names one firearm **by serial**. The guard existed and was in the wrong
   place: it kept the endorsement out of the auto-attach *suggestion* and left
   it in the list the member picks from. Shipped alone as Phase 0.

2. **`CREDENTIAL_TO_UPLOAD` was `Record<string, string[]>`** — a missing entry
   compiled clean and failed silently and totally. Typing it to the enum
   immediately named four sites.

3. **`confirmExpiry` wiped a stored issue date** whenever one was omitted. The
   frontend had worked around it by refusing to offer a Clear button.

4. **KYC identity documents and selfies were on world-readable Cloudinary
   URLs** — no `type: 'private'`, no `access_mode`. Retained after verification
   by operator decision, so a momentary exposure was permanent. The erasure path
   called the URLs *"unguessable"* and left deletion as a *"tracked follow-up"*
   that never happened. See below.

5. **Motivation generation was failing with the whole token budget spent on
   thinking**, and every failure branch notified nobody.

---

## KYC documents off the CDN

⚠️ **The URL block only ever worked because the file was public.** The Claude
verdict passed the document to Anthropic as `{type:'url'}` and let Anthropic
fetch it — which *required* world-readability. Securing the file broke the
verification path; both routes now send bytes inline with the real media type.

Reading is **storage-key-first with a URL fallback**, so both states work while
the move runs. Erasure removes the bytes **before** clearing the columns —
nulling first erases our record of the file and leaves the file.

```bash
# report only, changes nothing
ssh alloutdoor "cd /home/alloutdoor/app/backend && npx ts-node scripts/migrate-kyc-off-cloudinary.ts"
```

Order is the safety argument: fetch → store → repoint → **and only then** delete
the CDN copy. For a VERIFIED seller that document is the evidence the
verification happened.

---

## The names

- **`/documents` — Document Centre.** Renamed from Licence Centre.
- **`/motivations` — Motivation Centre.**

⚠️ **Member-facing only.** The backend prefix, the module directory and the scan
hand-off's `dest` string all stay `licence-centre`: a phone part-way through a
hand-off holds a token minted against that path. And `/licence-centre` still
renders rather than redirecting — reminder emails sent before today carry it.

---

## Findings from the adversarial pass, and what was done

| Finding | Outcome |
|---|---|
| `ConfirmPanel` was not keyed, so queue state walked forward — confirming a safe photo could file the licence behind it as a safe photo, wipe its date and stamp it confirmed | **Fixed.** `key={current.id}` |
| The reminder switch appeared on never-expires rows, offering to turn on a reminder that physically cannot be scheduled | **Fixed.** Hidden on `no-expiry` |
| `POST /licence-centre` did not return the ticks, so the page re-read the whole list after every upload | **Fixed at source.** The response carries them; the workaround is gone |
| `confirmExpiry` did not consult the stored tick, so confirming an already-ticked row without re-sending the flag 400'd | **Fixed.** Omitted now means "whatever it already says" |
| The eight kept-on-file kinds were not on the add menu, so a misfiled safe photo was uncorrectable | **Fixed.** On the menu, in two `optgroup`s |
| The KYC-adopted ID arrives unconfirmed, as one outstanding item | **Left as is, comment corrected.** We genuinely do not know whether it is a green book or a passport; the card now offers the tick |
| `kindOptions` showed the first menu entry while state held the real kind — displaying one type and posting another | **Fixed** |
| `queueHandoffArrivals` was dead code at HEAD — the whole "recognition shows its work" fix had never been in effect | **Wired up** |

---

## Still open

- **Flag `licence_centre_enabled` is off.** Phases 1–4 are inert until it flips.
- **`Credential.purgedAt` is read at six sites and written at none**, so
  `purgeSoftDeleted()` can never match and the orphan-bytes safety net does not
  exist. Not fixed here; deserves its own ticket.
- The Cloudinary migration script has not been run.
- Motivation generation's fix is deployed but has not been proven end-to-end.
