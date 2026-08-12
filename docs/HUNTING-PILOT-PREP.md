# Gun Galore — Hunting Packages Concierge Pilot: Prep Pack

**Version:** 1.0 · Drafted 2026-07-03 · For operator use
**Status:** Pre-launch. This is the audit's Phase 7.1 — the **manual concierge pilot with no software build**. It exists to validate demand and learn the operational + dispute shapes *before* Gun Galore builds any "experience engine."

> ⚠️ **Not legal advice.** This pack is an operational starting point drafted from the platform audit. Before you hold a single cent of anyone's deposit, get a short written opinion from an SA attorney on (a) the deposit-holding structure vs the **Banks Act** deposit-taking rules, and (b) your **CPA** intermediary positioning + cancellation terms. The one-page brief for that attorney is in §7.

---

## 1. The model in one paragraph

Gun Galore is the **introducer and payments-protection layer**, never the supplier of the hunt. A hunter finds a vetted outfitter through GG; GG holds a **small, refundable booking deposit** in trust (via the existing manual-EFT rail) so the hunter has recourse if the outfitter no-shows; the hunter pays the **balance directly to the outfitter** on arrival. After the hunt, GG releases the held deposit to the outfitter **minus GG's introducer commission (~10%)**. GG **never holds the full booking value** for months — that is what drifts toward regulated deposit-taking, and it is the single rule this pilot must not break.

This is the **BookYourHunt** template (10% success fee, verified outfitters, money-mostly-stays-with-the-outfitter) — but with GG's KYC + funds-held rail adding a protection layer BookYourHunt can't offer.

**Why range packages first (audit recommendation):** if you want to warm up the ops with the lowest legal risk, run a **shooting-range / range-day package** pilot before biltong hunts — zero seasonality, no game/permit/TOPS exposure, same audience. The vetting + booking flow below applies to both; the game-specific items (§3 C–E) simply don't apply to a range day.

---

## 2. Guardrails — the five rules this pilot must never break

1. **GG is an intermediary, never the supplier.** Every touchpoint (enquiry reply, invoice, confirmation, T&Cs) says GG *facilitates the introduction and holds a deposit*; the **outfitter is the supplier** of the hunt and carries the CPA supplier obligations for it.
2. **Deposit only, never the full price.** Hold a small booking deposit (recommend a **fixed R-amount or ≤15% of the package**, whichever is lower, and cap it — e.g. **max R5,000**). The balance is paid hunter→outfitter directly. Never route the full booking value through GG.
3. **Time-bounded + segregated.** The deposit sits for the shortest sensible window (booking → hunt date → short verification), in the existing client-funds-held position, tracked like any other held transaction. It is not a float, not investable, not commingled.
4. **Vetted outfitters only.** No self-serve outfitter listings. Every outfitter clears the §3 checklist and is admin-approved before a single enquiry is taken. Keep the "Hunting Packages & Experiences" category **inactive** in the public catalogue until this framework + a legal opinion are in place (the audit flags an empty bookable category as pure confusion + risk).
5. **No unvetted service listings + no prohibited species.** Trophies/`Taxidermy` stay out of scope for this pilot. If any package touches listed species, that's a TOPS/NEMBA permit question — out of scope for v1; keep it to common plains-game biltong hunts + range days.

---

## 3. Outfitter vetting checklist

Collect and file **all** of the following before an outfitter can receive a single enquiry. Store them against the outfitter's GG record; reuse the **existing KYC + SAP-534 document-review pattern** (Claude-vision read + admin confirm) for the ID + registration docs.

### A. Identity & business
- [ ] **Principal's SA ID** (the person GG contracts with) — run through existing KYC.
- [ ] **Company registration** (CIPC / CK number) if trading as a company/CC.
- [ ] **Physical address** of the operation + the **hunting property** address(es).
- [ ] **Bank account** in the business/principal's name (GG remits the deposit-minus-commission here — verify the holder name matches the vetted identity, same manual bank-ownership check GG already does for sellers).
- [ ] **Contactable references:** 2–3 past clients + (ideally) one industry reference (a PHASA member, a game farm, a taxidermist).

### B. Professional registration & permits
- [ ] **Professional Hunter (PH) / Hunting Outfitter registration** with the relevant **provincial conservation authority** (registration is provincial in SA — e.g. the province where the property sits). Get the certificate + number + expiry.
- [ ] **PHASA** (Professional Hunters' Association of SA) membership, if held — not mandatory but a strong signal.
- [ ] Confirm the registration **covers the province + the type of hunting** being offered.

### C. Property & game (skip for range-day packages)
- [ ] **Game farm / property exemption certificate** (Certificate of Adequate Enclosure, where the province requires it for a game farm).
- [ ] Confirmation the offered **species are common plains game** (springbok, impala, blesbok, kudu, gemsbok, etc.) — **no TOPS-listed / protected species** in the pilot.
- [ ] Who arranges the **hunting permit / licence** for the hunter, and confirmation it will be in place before the hunt.

### D. Firearms (if the outfitter provides/hires rifles)
- [ ] The outfitter's compliance for **hiring/lending firearms to clients** (dealer/permit status). If hunters bring their own, capture the **temporary import / transport** arrangements instead.
- [ ] Range/sight-in facilities on the property (safety).

### E. Insurance & safety
- [ ] **Public liability insurance** (get the policy number + cover amount + insurer).
- [ ] Hunting-specific / professional indemnity cover, if held.
- [ ] Basic **safety brief** the outfitter runs (firearms handling, vehicle, medical/evacuation plan for a remote property).

### F. Commercials
- [ ] Written **price sheet**: day fee (typ. R600–R1,500 pp/night), PH/guide fee (typ. ~R2,000/day), **per-animal trophy/meat fees** (e.g. springbok ~R2,500 → kudu ~R25k — confirm the outfitter's current list), what's included (meals, accommodation, field prep, transport).
- [ ] Agreement on the **deposit amount + GG commission (~10%)** and that the **balance is paid direct** to the outfitter on arrival.
- [ ] The outfitter's own **cancellation terms** (feeds §5).

**Approval:** an admin signs off the file (all boxes ticked + docs vision-read + references checked) before the outfitter goes live. Keep the file current — re-check registration/insurance expiry annually.

---

## 4. Concierge booking flow (admin-managed, v1 = manual)

No engine. This runs on the existing manual-EFT rail + admin actions + email/SMS. Steps:

1. **Enquiry.** Hunter contacts GG (form / message / email) with dates, party size, target species (or a range-day package).
2. **Availability check.** Admin confirms dates + final quote with the vetted outfitter. Nothing is promised to the hunter until the outfitter confirms.
3. **Deposit invoice.** GG issues the hunter a **deposit** invoice on the manual-EFT rail with a dedicated **order reference** (a distinct prefix, e.g. `HP-####`, so it reconciles + reports separately from marketplace orders). Invoice states clearly: *this is a refundable booking deposit held by Gun Galore; the balance of R____ is payable directly to the outfitter on arrival.*
4. **Deposit held.** Hunter EFTs the deposit → the existing reconciler matches the reference → the funds sit **HELD** in the client-funds position (exactly like a marketplace sale awaiting release). GG confirms the booking to **both** parties in writing, including the §5 cancellation terms + the §6 hunter attestations.
5. **Hunt happens.** Hunter travels, pays the **balance directly to the outfitter** on arrival (GG is not in that money flow). Outfitter runs the hunt.
6. **Completion + release.** After the hunt date + a short verification window (both parties confirm it happened, no dispute), GG **releases the held deposit to the outfitter minus the ~10% commission**, remitting via the existing payout rail to the vetted bank account.
7. **Invoice the commission.** GG raises its **introducer-commission invoice** in Zoho (new revenue line) against the released deposit — same hook pattern as marketplace commission.

**Disputes / no-show:** if the outfitter no-shows or materially fails to deliver, GG **refunds the deposit to the hunter** (admin decision, documented) rather than releasing it — this is the protection layer that justifies the deposit existing. Handle manually in v1; log every decision.

**Money never at risk of Banks-Act drift:** only the small deposit ever passes through GG, HELD briefly, released-or-refunded shortly after the hunt. Full booking value never touches GG.

---

## 5. CPA cancellation schedule (starting point — attorney to confirm)

Publish a **plain-language cancellation policy** the hunter accepts at booking. A defensible, CPA s17-aware tiered schedule (subject to the outfitter's own reasonable terms and the attorney's review):

| When the hunter cancels | Deposit treatment |
|---|---|
| **More than 30 days** before the hunt | Deposit refunded **less a small admin fee** (e.g. R250) |
| **14–30 days** before | **50%** of the deposit refunded |
| **Less than 14 days** before | Deposit **forfeited** (covers the outfitter's held date + prep) |
| **Outfitter cancels / no-shows / materially fails** | **Full deposit refunded** to the hunter |

Notes:
- CPA s17 requires cancellation penalties to be **reasonable** (they may reflect the supplier's actual loss from the late cancellation, not be punitive). Because GG only holds a *deposit* (not the full price), forfeiting the deposit for a very-late cancellation is generally defensible — but the **outfitter's** terms for the balance are the outfitter's to set + disclose.
- Disclose the schedule **before** the hunter pays, and get their acceptance (a ticked attestation, logged).
- Force majeure (fire/flood/road closure/illness) → default to a **date change** offer before any forfeit.

---

## 6. Hunter attestations (captured at booking)

The hunter accepts, in writing, before the deposit is taken:
- [ ] I am **18 or older**.
- [ ] I hold the **firearm competency + licence(s)** required for any firearm I will use, OR I am hiring from / hunting under the outfitter's supervision per their arrangement.
- [ ] I understand **Gun Galore is the introducer and holds my deposit only**; the **outfitter is the supplier** of the hunt and I pay the balance directly to them.
- [ ] I have read + accept the **cancellation policy** (§5).
- [ ] I will comply with all **hunting laws, permits and the outfitter's safety rules**; I accept the inherent risks of hunting.

(These mirror the platform's existing 18+/licence attestation pattern used at firearm checkout + dealer transfer.)

---

## 7. One-page brief for the attorney (before go-live)

> **Ask:** We want to run a small concierge pilot introducing hunters to 2–3 vetted SA hunting outfitters (+ possibly shooting-range day packages). Gun Galore takes a **refundable booking deposit** (small fixed amount / ≤15% of the package, capped ~R5,000) which we **hold in trust** on our existing manual-EFT rail and then **release to the outfitter minus a ~10% introducer commission** after the hunt, or **refund to the hunter** if the outfitter fails to deliver. The **balance is paid hunter→outfitter directly** — the full booking value never passes through us.
>
> **Please confirm / advise on:**
> 1. **Banks Act:** does holding a small, time-bounded, segregated *deposit* in this structure stay clear of "deposit-taking" as a business? What limits (amount, duration, segregation, disclosure) keep us safe?
> 2. **CPA:** is our **intermediary-not-supplier** positioning + disclosure adequate, and is the §5 cancellation schedule reasonable under s17?
> 3. **FICA/AML:** any obligations triggered by holding + remitting these deposits (we already run KYC on both sides)?
> 4. Any **licence/registration** we (the platform) need to broker hunts, vs the outfitter's own PH/outfitter registration.
> 5. Wording we must put in the hunter-facing T&Cs + the outfitter agreement.

---

## 8. What GG builds *later* (parked — for reference only)

The productised **experience engine** stays parked until this manual pilot proves demand + teaches the dispute shapes. When it's time, it's roughly:
- A **service/experience listing mode** exempt from parcel-dims + courier validation (shared seam with the bulky-goods/collection work).
- Fixed-price **date-slot bookings**; **range packages first** (lowest risk), then biltong hunts.
- **Deposit-held-as-commission** money model (deposit in, ~10% retained, balance direct) — a two-transaction split (deposit + balance) building on the partial-refund/split-settlement work.
- Outfitter **vetting admin flow** (reusing KYC + SAP-534 doc-review).
- International trophy hunting stays deferred (USD pricing, TOPS permits, PH registration drag).

---

## 9. Your next actions

1. **Get the legal opinion** (§7 brief) — this gates everything money-related.
2. **Line up 2–3 outfitters** (+ 1–2 ranges) and run them through the §3 checklist.
3. **Decide the deposit rule** (fixed R-amount vs %, and the cap) + confirm the **~10% commission** with each outfitter.
4. **Publish the cancellation policy + attestations** (§5, §6) and the intermediary disclosure copy.
5. **Run 2–3 real bookings by hand** on the existing EFT rail (use the `HP-` reference prefix). Log everything — the frictions you hit become the spec for the engine.
6. Only after the pilot converts + the disputes are understood → greenlight the §8 engine build.
