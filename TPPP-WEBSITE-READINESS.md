# TPPP Website Readiness — Work Order

**For:** Claude Opus 4.8, ultracode session (`ultracode` keyword in the kickoff prompt)
**Repo:** `C:\dev\gun-galore` · branch `feat/takealot-ux-parity` · prod = Vultr VPS via `ssh gungalore` (read `CLAUDE.md` first)
**Written:** 2026-07-16, from a 12-agent verified audit of the LIVE site + code (33 confirmed HIGH/MED findings, 0 refuted). Prod == local HEAD (`df0ed50`) at audit time.
**Mission:** Make gungalore.co.za read like a clean due-diligence file to a bank underwriter reviewing our TPPP (Third Party Payment Provider) application. Everything published must be TRUE; the job is to remove false/overclaiming copy, add the statutory pages a reviewer expects, and present the (genuinely strong) compliance posture on purpose-built pages.

---

## 1. Disclosure posture (read before writing any copy)

1. **Truth only.** Nothing published may be false or claim a credential we lack. The biggest current risk is an *overclaim* (see W1) — we fix by removing it, not by adding spin.
2. **Publish** everything legally required (ECT s43, POPIA, PAIA, CPA/ECT rights, complaints route, fees transparency) and everything that is true and trust-building (KYC, dealer-only firearm transfers, funds-held model, manual bank-detail review).
3. **Do NOT volunteer** on the public site: the TPPP application's existence/status; names of banks/PSPs under negotiation (Nedbank, Ivori, Peach, Stitch — none may appear in public copy until a contract is signed); internal audits, bug history, or incident history; the history of removed features (raffles, manual EFT) — describe the present truthfully, never narrate the past; security-stack internals; founding capital or financials.
4. **Hard lines** (house rules — violations are release blockers):
   - The word **"escrow"** never appears in public copy → "funds held" / "payment held". (Currently clean; keep the in-code guard comments and add them to new pages.)
   - Never claim **automated** bank-account verification/AVS — the check is a **manual admin review** and the copy must say so. (Currently worded correctly in /terms §8 and /aml-policy §2.1 — preserve those sentences verbatim through every edit.)
   - Real names of *marketplace users* never appear publicly (usernames only). The director's name in the statutory s43/POPIA blocks is a deliberate legal disclosure and is fine.
   - No claims of PCI DSS or "bank-grade" security until actually certified. Current modest wording ("secure card checkout") is the ceiling.
5. **No visible draft markers** on statutory pages. Attorney-review notes go in the commit message, never on-page.
6. When a legal page is materially edited, refresh its "Updated <date>" line (pattern already used on /refund-policy).

## 2. Facts needed from the operator (W0 — gate items marked ⛔)

| # | Fact | Blocks | Notes |
|---|------|--------|-------|
| F1 | Customer-service **telephone number** (any answerable number — VoIP/answering service fine) | ⛔ W2 | Same gap already blocking the Nedbank compliance pack. ECT s43(1)(b) requires it. |
| F2 | Confirmation to **publish the fee schedule** publicly (numbers come from code, see W8) | ⛔ W8 | Recommended yes — fee transparency is a card-scheme checklist item. |
| F3 | Decision to **adopt sanctions screening** as a step in the manual first-payout review (check seller name against the FIC Targeted Financial Sanctions list) | ⛔ W11 | The AML policy may only describe screening if it is actually performed. Adopt the ops step and the copy together, or skip both. |

Everything not marked ⛔ proceeds immediately. If F1 is unavailable, W2 waits — do **not** creatively hide the gap.

## 3. Facts already established (do not re-derive, do not contradict)

Live and verified 2026-07-16: legal name **GunGalore (Pty) Ltd**, reg **2026/393321/07**, trading as Gun Galore, director **Gerhard Johan Petrus Fourie** (also POPIA Information Officer), registered office **36 Sterappel Crescent, Langeberg Glen, Cape Town, 7570**, `support@gungalore.co.za`, VAT: not yet registered, self-regulatory memberships: none. All of this is in the site-wide footer + `/legal` + `/terms` §21. Complaints SLA published on `/legal`: acknowledge 2 business days, resolve 14. Governing law: RSA, Western Cape High Court. 18+ / competency attestation at firearm checkout EXISTS and is enforced server-side (`backend/src/payments/transactions.service.ts:339`). Site checkout is intentionally gated: "Card payments are launching soon" (`frontend/components/payments-coming-soon.tsx`) — that copy is the tone benchmark; do not change it.

---

## 4. Work items

> Per-item: files are exact (verified against HEAD `df0ed50`); if a line number has drifted, match on the quoted text. After EVERY new top-level route: add it to `isPublicRoute` in `frontend/middleware.ts` — Clerk 307s any unlisted route to /sign-in (known gotcha), which is precisely the failure a reviewer sees.

### W1 — Purge the uncontracted payment-provider name from all public legal copy 🔴 HIGHEST PRIORITY
**Defect (confirmed live):** Four statutory pages assert in present tense that "Stitch Express" processes our payments. No PSP is contracted. This is the one finding that can sink a TPPP review on its own: it contradicts the application file and misstates who holds the money flow.
- `frontend/app/(legal)/terms/page.tsx` — lines ~143–148, 153, 157, 167, 184, 329 (≈14 rendered mentions). Includes: "All payments on GunGalore are processed by Stitch Express…", the §8 fee sentence "plus a processing fee charged by Stitch Express", the §7 insolvency sentence ("…insolvency of Stitch Express"), and the §16 force-majeure provider list.
- `frontend/app/(legal)/refund-policy/page.tsx` — ~54, 57, 109 ("holds the buyer's payment through Stitch Express…", "Stitch captures the amount from your card or EFT", "payment is reversed via Stitch").
- `frontend/app/(legal)/aml-policy/page.tsx` — ~40 ("We process payments through Stitch Express, which is licensed.").
- `frontend/app/(legal)/privacy/page.tsx` — ~136, 184 (§4 collection sentence + the POPIA operator-table row).

**Spec:** Replace every mention with provider-neutral wording: "our appointed third-party payment service provider, a licensed South African payment service provider" (first use per page; "the payment service provider" thereafter). Drop "or EFT" wherever it rides along. In the privacy operator table, **remove** the Stitch row entirely and add one sentence to §4: payment-instrument data will be processed by the appointed licensed payment service provider once card payments launch. Preserve the §7 not-a-bank/not-an-FSP disclaimer and the §8 manual bank-review sentence verbatim. Refresh "Updated" dates. Add an in-code guard comment on each page: `// NEVER name a payment provider here until a contract is signed (TPPP house rule).`
**Accept:** `rg -i "stitch" frontend/app frontend/components` → zero hits in rendered JSX text (code comments allowed); post-deploy `curl -s https://gungalore.co.za/{terms,privacy,refund-policy,aml-policy} | grep -ic stitch` = 0 on all four.

### W2 — Publish the telephone number; kill the placeholder ⛔ blocked on F1
**Defect:** `/legal` ECT s43 statutory block renders literally: **"Phone: To be added before public launch"** (`frontend/app/(legal)/legal/page.tsx:139`) — the site has been public since 2026-06-24. No phone exists anywhere on the site; ECT s43(1)(b) requires one.
**Spec:** Insert the real number (from F1) in: the `/legal` s43 block (:139, delete the placeholder wording entirely), `/terms` §21 disclosure list (add a "Telephone:" line, `terms/page.tsx:390-399`), the footer s43 line (`frontend/components/site-footer.tsx:189-198`), and the new /contact page (W5). Format: `+27 XX XXX XXXX`.
**Accept:** placeholder string gone from repo; number renders on /legal, /terms, footer, /contact.

### W3 — Truthful-claims pass (overclaims + stale EFT copy)
All confirmed live-or-reachable copy that a reviewer can falsify or that references the removed EFT rail:
1. **Footer tagline** (`site-footer.tsx:59-63`, site-wide): "Every seller verified. Every transaction protected." → KYC actually gates *payout*, not listing. Replace with defensible copy, e.g. "Seller identity verified before payout. Every payment held until delivery is confirmed."
2. **Trust bullets** (`frontend/components/trust-bullets.tsx:24`, rendered on every PDP + cart): "Every seller ID-verified" → "Sellers ID-verified before they're paid" (matches the FAQ's own wording).
3. **Layout metadata** (`frontend/app/layout.tsx` ~78, 90, 105): same absolute claim in meta descriptions — align with the new tagline.
4. **PDP buy panel** (`frontend/app/listings/[id]/page.tsx:563-567`): "You'll get bank-transfer (EFT) details and 24 hours to pay…" → "Takes you to secure checkout. Your payment is held until the sale completes, then released to the seller."
5. **Deals PDP** (`frontend/app/deals/[id]/page.tsx:218-221`): "you'll get bank-transfer (EFT) details and 24 hours to pay" → "Secure checkout — your payment is held until the item ships." (Fix now, before any deal goes live.)
6. **Private-arrangement consent** (`frontend/components/firearm-consents.tsx:236-239` + duplicate `frontend/app/checkout/[listingId]/checkout-form.tsx:~2102-2105`): "paid immediately once your bank transfer (EFT) is confirmed" → "paid immediately once your payment is confirmed". Fix BOTH copies (header comment says keep in sync).
7. **Checkout-complete page** (`frontend/app/checkout/complete/page.tsx:121-126`): "If you just paid by instant EFT…" → "If you completed payment, it may take a moment to reflect — check your orders shortly."
**Accept:** `rg -in "EFT|bank transfer" frontend/app frontend/components` → remaining hits are code comments/admin-only history labels only; the five user-visible surfaces above read rail-neutral.

### W4 — Retire the featured-slot EFT lane (backend + frontend) ⚠️ money-adjacent
**Defect (verifier-confirmed NOT dead code):** `backend/src/featured/featured.service.ts:618,630-638` still returns `{ awaitingPayment: true, amountCents, orderReference, payByAt, bankDetails: null }` and records event `AWAITING_EFT_PAYMENT`; `frontend/app/featured/bid/page.tsx:1180-1211` then renders a **"Pay your slot fee by EFT"** modal with a payment reference — instructions for a rail that no longer exists. Auth-gated, but a live dead-end and exactly what a walkthrough demo would trip over.
**Spec:** Make bind return the payments-coming-soon state outright (no `awaitingPayment` lane — mirror how checkout gates via `assertPaymentsLive()`); delete the frontend `eft` state + modal branch; leave the `AWAITING_EFT_PAYMENT` event name in historical data untouched.
**Guardrails:** This touches a money-adjacent service: backend `tsc` + jest must pass, **boot-verify** (pm2 uptime stable post-reload — DI crashes only show at boot), and give the diff a short adversarial self-review before deploy.

### W5 — Public `/contact` + `/support` pages
**Defect:** Footer links `/support` on every page (`site-footer.tsx:151`, `public-chrome.tsx:33`, `ask-gg/ticket-draft-card.tsx:104`) but the route doesn't exist → anonymous visitors get 307→sign-in (and a signed-in user would 404). `/contact`, `/contact-us`, `/help` all 307 too. A reviewer testing the advertised support channel concludes it's fictional.
**Spec:** Build `frontend/app/(legal)/contact/page.tsx` (entity name, reg no., registered address, support email, phone once W2 lands, response SLA, link to /complaints and /legal) and `frontend/app/(legal)/support/page.tsx` (public: contact channels, FAQ signposting, complaints summary; the ticket form stays sign-in-gated *in-page* with a clear "sign in to open a ticket" CTA). Add `/contact` and `/support` to `isPublicRoute`. Match the (legal) route-group's existing page component style — read `/legal`'s page.tsx first and reuse its layout idioms.
**Accept:** anonymous `curl -s -o /dev/null -w "%{http_code}"` on /contact and /support = 200; footer Support link lands somewhere real signed-out.

### W6 — Public `/complaints` page + fix the wrong escalation body
**Defect:** The complaints procedure exists only inside `/legal`, and its payment-escalation line names **PASA** (`legal/page.tsx:167`) — an industry body, not a consumer forum. `/refund-policy` §6 says CGSO/NCC contact details are available "on request".
**Spec:** Build `frontend/app/(legal)/complaints/page.tsx` rendering the full procedure (2-business-day acknowledge / 14-business-day resolve; escalation: Information Regulator for privacy, NCC / Consumer Goods & Services Ombud for CPA matters, **National Financial Ombud (nfosa.co.za)** for payment disputes, SAPS for firearms). On `/legal`, replace the PASA line with the NFO. In `/refund-policy` §6, publish CGSO/NCC contact details inline. Add `/complaints` to `isPublicRoute`, link from footer + /legal + /contact.

### W7 — PAIA manual at `/paia` 🔴 statutory
**Defect:** No PAIA manual exists anywhere (confirmed absent site-wide) — it is statutorily required for every SA company and compliance teams check for it.
**Spec:** Build `frontend/app/(legal)/paia/page.tsx`: a PAIA s51 manual — company details (reuse §3 facts), Information Officer (Gerhard Johan Petrus Fourie, support@gungalore.co.za), categories of records held (corporate, customer/KYC, transaction, marketplace content, personnel), how to request access (form reference, prescribed fees, response timelines per the Act), grounds for refusal summary, Information Regulator contact block (already on /privacy — reuse). Follow the Information Regulator's published manual template structure. Add to `isPublicRoute`, `/legal` index, footer legal links, and `frontend/app/sitemap.ts`. Commit message flags attorney review.

### W8 — Public `/fees` page ⛔ blocked on F2
**Defect:** No public fee schedule; `/terms` §8 explicitly defers the numbers to the signed-in sell flow. Fee transparency is on the card-scheme website checklist.
**Spec:** Build `frontend/app/(legal)/fees/page.tsx` publishing: seller commission bands, buyer processing fee, subscription tiers' pricing if public, featured-slot pricing model, payout timing ("after delivery is confirmed / dealer transfer verified"), and "no charge until a sale completes" if true. **Source every number from `backend/src/payments/fee.calculator.ts` (and subscriptions/featured pricing constants) — never invent or round.** Update `/terms` §8 to link `/fees` (its Stitch fee-sentence is already rewritten in W1). Add to `isPublicRoute`, footer, /legal index, /faq cross-link, sitemap.

### W9 — `/how-payments-work` + `/about`
1. **/how-payments-work** (the single strongest TPPP collateral page): consolidate the funds-held story that today lives scattered across /how-selling-works, /faq and /refund-policy into one canonical page: buyer pays → **funds held** by GunGalore → seller dispatches → delivery confirmed (or stamped SAPS 534 dealer transfer for firearms) → payout released to the seller's **manually verified** bank account; GG earns commission only; refunds path; disputes path; South Africa only, ZAR only; card payments launching soon. Never the word "escrow"; never "automated verification".
2. **/about**: short and real — what the platform does, who runs it (director, per the s43 disclosure), registered details, compliance posture links (/legal, /firearms-compliance, /how-payments-work). Note: middleware already whitelists `/about(.*)` (`middleware.ts:17`) but the page 404s today — build the page; no middleware change needed.
Add /how-payments-work to `isPublicRoute` + both to footer, /legal index, sitemap.

### W10 — Firearms-compliance form-number alignment + phantom-surface wording
1. **SAPS 271 → SAPS 534** (`frontend/app/(legal)/firearms-compliance/page.tsx:122,169`): the page says dealers complete "SAPS 271" paperwork while the deployed product flow and /privacy both use SAPS 534. Align to 534. Leave the `:158` SAPS 522 mention as-is; flag both for attorney confirmation in the commit message.
2. **"New Store surface where supported"** (`acceptable-use/page.tsx:58`, `firearms-compliance/page.tsx:106`): references a surface that doesn't publicly exist. Rephrase verifiably: ammunition "may only be sold by SAPS-licensed dealers through dealer storefronts, where that capability is enabled".

### W11 — AML sanctions-screening clause ⛔ blocked on F3
**Defect:** `/aml-policy` never mentions sanctions screening (0 hits) — a gap every bank AML reviewer notices.
**Spec (only if F3 = yes):** Add §2.6: sellers are screened against the FIC Targeted Financial Sanctions list (and adverse-media check) as part of the manual first-payout review; matches held/reported per FIC guidance. The wording must describe exactly what the ops step does — no more. If F3 = no, skip entirely; do not write aspirational compliance copy.

### W12 — Small statutory/discovery polish
1. `frontend/public/.well-known/security.txt` (`Contact: mailto:support@gungalore.co.za`, `Expires:` +1 year) + whitelist `/.well-known/(.*)` and `/security.txt` in `isPublicRoute`.
2. `frontend/app/sitemap.ts`: add /contact /support /complaints /paia /fees /how-payments-work /about; **drop /wishlist** (it's Clerk-gated — a sign-in-walled sitemap URL looks broken to a crawler and a reviewer).
3. `/terms` §7: add one line — "All prices are quoted and charged in South African Rand (ZAR)."

### W13 — Admin-console label hygiene (LOW, do last)
If a bank rep ever gets an admin walkthrough: `frontend/app/admin/(protected)/transactions/[id]/page.tsx:446-451` ("Processing fee (Peach)", "Peach checkout ID", "Peach payment ID", "Peach result code"), `featured/[slotId]/force-evict-button.tsx:133` ("Refund occupant via Peach"), `users/[id]/page.tsx:383` ("AVS verified"). Rename provider-neutral ("Provider checkout ID", "Refund via payment provider") and "AVS verified" → "Bank details reviewed (manual)".

---

## 5. Do-NOT-publish list (final gate before deploy)

Grep the full diff before deploying. None of the following may appear in any user-visible string you added or edited:
`Stitch`, `Peach`, `Ivori`, `Nedbank`, `FNB`, `escrow`, `TPPP`, `PASA` (as a complaints body), `PCI` (as a certification claim), "automated verification"/"AVS" (as a claim about bank details), "instant payout"/"same-day payout", any bank-account number, any marketplace user's real name, any mention of removed features' history (raffles, manual EFT), application/negotiation status with any bank or PSP.

## 6. Verification & deploy

**Offline gates (all must pass):** frontend `tsc` + `next build`; backend `tsc` + jest + **clean boot** (W4); the W1/W3 grep gates; every new route present in `isPublicRoute`; every new page linked from footer + `/legal` + sitemap; new pages carry the standard (legal) layout, an "Effective" date, and the escrow/provider guard comments.

**Deploy (house rules — full sequence in CLAUDE.md):** DB backup (habit, even code-only) → push → prod pull → detached builds (`setsid`; both apps — W4 touches backend) → `pm2 reload gungalore-backend` → **verify pm2 uptime stable** (boot-crash class) → `pm2 restart gungalore-frontend` (explicit — reload alone misses it) → live checks.

**Live acceptance:** anonymous curl 200 on: /contact /support /complaints /paia /fees /how-payments-work /about /.well-known/security.txt; `grep -ic stitch` = 0 on /terms /privacy /refund-policy /aml-policy; "To be added before public launch" absent from /legal; footer shows phone + new links; /legal lists the new documents; sitemap includes them and excludes /wishlist.

## 7. Confirmed-findings → work-item map (audit appendix)

| Finding(s) | Severity | What | Work item |
|---|---|---|---|
| ID-2 / LEGAL-01 / POL-1 / POL-2 / MP-3 / PAY-1 / SW-1..4 | HIGH | "Stitch Express" asserted as live processor on /terms /privacy /refund-policy /aml-policy | W1 |
| ID-1 / LEGAL-02 / POL-3 / MP-4 | HIGH | No phone anywhere; /legal renders "Phone: To be added before public launch" | W2 |
| ID-6 / PAY-6 | MED | "Every seller verified. Every transaction protected." overclaim (footer, trust-bullets, layout meta) | W3.1–3 |
| PAY-2 / SW-5 | MED | PDP buy panel promises EFT details + 24h | W3.4 |
| PAY-5 / SW-6 | LOW | Deals PDP promises EFT details | W3.5 |
| PAY-4 / SW-7 | MED | PA consent: "bank transfer (EFT) confirmed" | W3.6 |
| PAY-7 / SW-9 | LOW | Checkout-complete "instant EFT" | W3.7 |
| PAY-3 / SW-8 | MED | Featured-slot "Pay your slot fee by EFT" modal + backend awaitingPayment lane still live | W4 |
| ID-3 / MP-6 | MED | Footer /support link → sign-in wall → 404 | W5 |
| ID-4 / MP-5 | MED | No public /contact under any spelling | W5 |
| POL-4 | MED | PASA named as payment-complaints body; CGSO details "on request" | W6 |
| POL-7 | LOW | /complaints URL doesn't resolve | W6 |
| MP-1 | HIGH | PAIA manual absent site-wide | W7 |
| MP-2 | HIGH | No public fee schedule | W8 |
| MP-7 | MED | No consolidated payments/trust page | W9.1 |
| ID-5 / MP-5 | MED | /about whitelisted but 404s | W9.2 |
| POL-5 | MED | firearms-compliance says SAPS 271; product + privacy use SAPS 534 | W10.1 |
| POL-8 | LOW | "New Store surface" phantom reference | W10.2 |
| POL-6 | MED | AML policy silent on sanctions screening | W11 |
| MP-8 | LOW | No security.txt | W12.1 |
| OK-4 (missing-pages) | LOW | /wishlist in sitemap though Clerk-gated | W12.2 |
| LEGAL-06 | LOW | No explicit ZAR-pricing clause | W12.3 |
| SW-10 | LOW | Admin labels: "Peach", "AVS verified" | W13 |

**Verified healthy — do not touch:** zero "escrow" site-wide (guard comments working); manual bank-review wording in /terms §8 + /aml-policy §2.1; 18+/competency attestation (frontend consent + `transactions.service.ts:339` enforcement); payments-coming-soon gate copy; robots.txt/sitemap hygiene (admin/api/checkout disallowed); no PCI/security overclaims; no payout-timing promises; complaints SLA + Information Regulator block on /legal; the full s43 identity block (minus phone); CPA s55/56 + ECT s44 cooling-off coverage in /refund-policy; not-a-bank/not-an-FSP disclaimer in /terms §7.
