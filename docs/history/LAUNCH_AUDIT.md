# Gun Galore — Launch-Readiness Report

## 1. Verdict

**NO-GO.** Multiple confirmed CRITICALs let an unauthenticated attacker mark any order PAID without paying (and trigger immediate payout + PII reveal), admin refunds never actually return money to buyers, accepted-offer firearm/items can be double-sold and double-charged, and admin auth fails open to a public hardcoded secret — any one of these is a money-loss/legal event on day one.

---

## 2. Launch blockers (CRITICAL + HIGH, ordered by risk)

**CRITICAL**

- **CRITICAL — Forged Peach webhook marks any order PAID (free orders, instant payout, PII reveal)** — `backend/src/payments/peach.service.ts:298-322`, `transactions.controller.ts:284-310`, `transactions.service.ts:299-325,926-957` — Fail-CLOSED on a required `PEACH_WEBHOOK_SECRET`, HMAC over `req.rawBody` (not `JSON.stringify(body)`), and re-confirm out-of-band via `verifyPayment(resourcePath)` asserting `merchantTransactionId` + amount before `markPaid`. *(merges 3 findings: fail-open webhook, re-serialized-body signature, and the missing amount check exploited through it)*
- **CRITICAL — `POST /transactions/:id/verify-result` is unauthenticated and binds the Peach result to neither the tx id nor the amount** — `transactions.controller.ts:91-97`, `transactions.service.ts:264-287,926-982` — Guard with `ClerkGuard` (verify caller is the buyer) and reject unless `result.merchantTransactionId === id` AND `result.amount === tx.buyerTotal` (exact cents); treat any mismatch as hard-fail + admin alert.
- **CRITICAL — Admin refund flips status to REFUNDED and emails the buyer "refund issued" but never calls Peach — money never returns** — `backend/src/admin/admin.service.ts:989-1054` — Inject `PeachService`; call `peach.refundPayment(tx.peachPaymentId, tx.buyerTotal)` and only set REFUNDED / notify / credit-note on gateway success, with an urgent alert on failure. *Same fix should add the missing `paymentStatus` precondition (atomic `updateMany WHERE paymentStatus IN ['HELD','DISPUTED']`) so a RELEASED/REFUNDED order can't be re-refunded.*
- **CRITICAL — Offer-checkout never re-checks listing availability → TAKE_A_SHOT items sell to multiple buyers (double-charge)** — `transactions.service.ts:73-89,167-171` — In the offer branch require `listing.status === 'ACTIVE'`, reserve atomically via `updateMany({ where:{ id, status:'ACTIVE' }, data:{ status:'PAYMENT_PENDING' } })` (abort if count===0), and mass-reject sibling open offers on accept/markPaid. *(merges the two offer double-sell findings)*
- **CRITICAL — Admin JWT secret falls back to the committed string `dev-admin-secret-change-in-prod` with no boot validation → full admin takeover (refunds, PII dossiers, bulk-ban) if the env var is unset/empty** — `admin-jwt.guard.ts:16`, `admin-auth.service.ts:31`, `ask-gg.module.ts:27`, `reloading.module.ts:29` — Remove the literal from all four files, source from one config provider, throw at bootstrap when `NODE_ENV==='production'` and the secret is missing/empty/equals the default, and rotate the secret (it's in git history). *(merges the two admin-JWT findings; the second verdict's CRITICAL rating governs.)*

**HIGH**

- **HIGH — Declined card shows the buyer "Payment successful" and redirects to the order page** — `frontend/app/checkout/complete/page.tsx:24-38` — Parse the JSON body and gate on `success === true`, not just `res.ok`; render the failure UI for `{ success:false }`.
- **HIGH — Buyer's full legal name leaked to the seller in offer / counter-offer notifications (email/SMS/in-app)** — `backend/src/offers/offers.service.ts:409,526,547` (rendered `notifications.service.ts:1178-1204,1365-1417`) — Replace `buyerName` with `offer.buyer.username` (fallback "A buyer"); violates the username-only policy + POPIA.
- **HIGH — Counterparty real name (and buyer email) returned in the transaction API payload for all non-PRIVATE_ARRANGE orders** — `transactions.service.ts:736-757` (and list endpoint `685-686`) — In the non-private-arrange branch also null the other party's `firstName`/`lastName`/`email`; better, only select `username` for the counterparty unless `isPaidPrivateArrange`.
- **HIGH — Offer-checkout hardcodes `isFirearm={false}`, so accepted-offer firearm buyers are never offered DEALER_TRANSFER and are hard-rejected at submit (no path to buy)** — `frontend/app/checkout/offer/[offerId]/page.tsx:102` (consumed `offer-checkout-form.tsx:55,78`) — Add `isFirearm` to the offer DTO + `Offer` type and pass `offer.listing.isFirearm`; wire the dealer-picker into the offer form.
- **HIGH — KYC (VerifyNow) defaults to `mode='sandbox'` → identity checks silently pass against canned data in prod** — `backend/src/kyc/verifynow.service.ts:77-81,91-100` — Assert `VERIFYNOW_MODE==='production'` at boot (throw otherwise) and add it to `.env.example`. *(Shipped `.env` is `sandbox` and the example omits the var — high real-world likelihood.)*
- **HIGH — Money-state transitions use read-then-write, not atomic conditional updates → webhook+result-page (or double-click) double-processes, corrupting public `totalSales` and duplicating notifications/tokens** — `transactions.service.ts:264-325,765-808,926-955` — Gate each transition with `updateMany` on the guard field and act only when count===1 (the pattern already used in `action-tokens.service.ts:175-188`); add `@unique` on `peachPaymentId`.
- **HIGH — Express `trust proxy` never set → throttler keys every request to nginx's IP, collapsing all per-route limits to one shared bucket (DoS + lost cost-control on paid AI endpoints)** — `backend/src/main.ts`, `app.module.ts:54-55` — `app.set('trust proxy', 1)` (fixed hop count, not `true`); consider a per-Clerk-user tracker for authed routes.
- **HIGH — Prod schema applied via `prisma db push --accept-data-loss` every deploy; migration history abandoned and drifted** — `CLAUDE.md:70-79`, `backend/prisma/migrations/` — Baseline a catch-up migration and switch the deploy to `prisma migrate deploy`; at minimum drop `--accept-data-loss` so a destructive diff aborts.
- **HIGH — Clerk `user.deleted` hard-deletes the User row → cascade wipes Subscription/SubscriptionCharge (SARS/POPIA) and crash-loops on Restrict FKs (no try/catch)** — `backend/src/users/users.service.ts:151-153`, `webhooks.controller.ts:81-83`, `schema.prisma:2032,2068` — Anonymise/soft-delete instead of hard-delete; change Subscription/SubscriptionCharge off `onDelete: Cascade` from User; wrap the webhook call in try/catch.
- **HIGH — `isFirearm` is a point-in-time snapshot on Listing with no DB coupling; a category re-class or a `categoryId` PATCH leaves a real firearm with `isFirearm=false` + courier shipping (SAPS breach)** — `schema.prisma:494-500,538,584`; `listings.service.ts` update path doesn't recompute it; `admin-categories.service.ts` doesn't back-fill — Re-derive `isFirearm` on any `categoryId` change and re-run the DEALER_TRANSFER guard against the new category; back-fill listings on a category flip; add a Postgres CHECK rejecting firearm + {PUDO,TCG} / empty `shippingMethods`.
- **HIGH — Auction "Buy Now" writes no state and routes the buyer to a checkout page that 404s on non-BUY_NOW listings → the feature is entirely non-functional** — `backend/src/auctions/auctions.service.ts:548-587` (dead-ends at `frontend/app/checkout/[listingId]/page.tsx:34`) — Either reserve the listing and create the buy-now transaction server-side, or route auction buy-now through a checkout path that accepts `AUCTION` listings with an atomic ACTIVE→PAYMENT_PENDING claim. *(Note: the originally-asserted concurrency race is a false positive; the real defect confirmed by the verdict is that the flow is broken.)*

---

## 3. Category summary

Counts use each finding's adversarially-confirmed `finalSeverity`, **after** merging duplicate root causes (Peach-webhook ×3→1; admin-JWT ×2→1; offer-double-sell ×2→1).

| Category | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|
| Payments / payment integrity | 4 | 1 | 4 | 1 |
| Auth & access control / admin | 1 | 1 | 1 | 1 |
| Real-name & PII leakage (POPIA) | 0 | 2 | 1 | 0 |
| Firearms / SAPS compliance | 0 | 2 | 1 | 1 |
| Data model / migrations / retention | 0 | 2 | 2 | 1 |
| Config-fallback / ops / observability | 0 | 2 | 2 | 4 |
| Business logic (raffles / offers / fees) | 0 | 0 | 4 | 3 |
| Checkout UX / frontend | 0 | 1 | 2 | 2 |
| Regulated-term ("escrow") compliance | 0 | 0 | 1 | 0 |
| SSRF / cost-DoS | 0 | 0 | 2 | 0 |
| **Totals** | **5** | **13** | **20** | **13** |

---

## 4. Top 10 fixes before launch (prioritized, deduplicated)

1. **Lock down payment confirmation end-to-end.** Make the Peach webhook fail-CLOSED (require `PEACH_WEBHOOK_SECRET`, HMAC over `req.rawBody`); add `ClerkGuard` to `verify-result`; and in `markPaid` (and both callers) assert `merchantTransactionId === txId` **and** `result.amount === tx.buyerTotal` before marking paid. This single hardening closes the two payment-forgery CRITICALs and the amount-correctness gap.
2. **Make admin refund actually refund.** Inject `PeachService`, call `peach.refundPayment` before flipping to REFUNDED, alert on failure, and add an atomic refundable-status precondition (`HELD`/`DISPUTED` only).
3. **Stop offer double-sell.** Require `listing.status==='ACTIVE'` in the offer branch, reserve via conditional `updateMany` (abort on count===0), and mass-reject sibling offers on accept/markPaid. Also reserve/invalidate on auto-accept so N buyers can't each hold a payable offer.
4. **Fail-closed on secrets/mode at boot.** Throw in production if `JWT_ADMIN_SECRET` is missing/empty/default (rotate it) and if `VERIFYNOW_MODE !== 'production'`. Remove the hardcoded admin-secret literal from all four files. Add `VERIFYNOW_MODE`, `PEACH_WEBHOOK_SECRET`, `BACKEND_URL`, `NEXT_PUBLIC_FRONTEND_URL`, `FRONTEND_URL` to `.env.example`.
5. **Fix the declined-card "Payment successful" lie.** Gate the result page on `success === true` from the JSON body, not `res.ok`; use neutral copy for the verification-error/unknown state (no "your card was not charged" guarantee, no retry CTA).
6. **Stop leaking real names between users.** Use `username` in offer/counter notifications; null `firstName`/`lastName`/buyer-`email` for the counterparty in the transaction API (or only select them when `isPaidPrivateArrange`).
7. **Make money-state transitions atomic.** Convert `markPaid` / `confirmDelivery` / refund to conditional `updateMany` guards (count===1), move the `totalSales` increment inside the guarded transaction, and add `@unique` on `peachPaymentId`.
8. **Set `trust proxy` (fixed hop count).** Restores per-IP throttling so the documented rate limits (auth, KYC, action-tokens, paid AI endpoints) actually isolate users/attackers.
9. **Fix the two broken regulated firearm flows.** Pass real `isFirearm` into offer-checkout (and wire the dealer picker), and either fix or disable auction "Buy Now" (currently dead-ends in a 404). Add a DB CHECK + write-time re-derivation so `isFirearm`/`shippingMethods` can never desync from the category.
10. **Stabilize deploys & deletion.** Move prod to `prisma migrate deploy` (drop `--accept-data-loss`, baseline a catch-up migration), and change the Clerk `user.deleted` path to anonymise/soft-delete (keep financial rows; FK Subscription/charges off Cascade; wrap in try/catch).

---

## 5. Ship now, fix soon after (MEDIUM / LOW)

**MEDIUM — fix in the first patch window:**
- **PII over-scoped token:** `/users/me` returns the caller's own bank account number/branch over a replayable 24h URL-bearer CHECKOUT token — trim `bank*` fields when `req.viaActionToken` (`users.controller.ts:51-99`).
- **Compliance copy/legal:** remove the banned word **"escrow"** from public Terms `frontend/app/(legal)/terms/page.tsx:161`; per-raffle skill answer is hardcoded to `'C'` (store `Raffle.correctAnswer` or get legal sign-off); no pre-payment 18+/competency attestation on firearm checkout (persist an attestation on the transaction).
- **Raffle correctness:** `ticketNumber` has no `@@unique([raffleId,ticketNumber])` and is allocated by count (collisions); oversell pre-check runs outside the transaction; postal (`userId=null`) winners can't be notified/claim and are silently skipped on backup promotion — resolve postal contact from `PostalEntry` + raise an operator alert.
- **Config-fallbacks:** `PEACH_BASE_URL` defaults to `test.oppwa.com`; assert an explicit prod value (covered by the `.env.example` work in fix #4).
- **Cost/abuse hardening:** Ask-GG accepts arbitrary client image URLs forwarded to Anthropic (add a Cloudinary host allowlist); range-estimator is an anonymous paid AI endpoint with no per-identity throttle / spend ceiling (depends on the `trust proxy` fix).
- **Frontend:** Peach widget `shopperResultUrl` falls back to a relative path (`NEXT_PUBLIC_FRONTEND_URL` unset); offer-checkout `Pay` button shows item-price-only with no live shipping line (mitigated by the confirmation screen, but misleading).
- **Observability:** `/admin/health` cron panel monitors a key nothing writes (`pending-tickets-sweep`) and omits 5 real crons incl. the every-minute financial `featuredTick` (no `recordCronRun`, no try/catch).
- **Search resilience:** the three runtime tsvector GENERATED columns are dropped by every `db push` and only re-created on next boot (deploy-window search outage; swallowed-failure → silent degradation) — moot once you move to `migrate deploy` (fix #10).

**LOW — backlog / polish:**
- Fee-math edge: R30 commission floor erases the Top-Seller discount and can hit ~100% of sub-R30 sales (already disclosed in the Sell form).
- `User.phone` has no unique index (app-code TOCTOU; duplicates only an SMS-delivery/analytics nuisance — not an auth vector).
- `GET /actions/:token` is `@SkipThrottle` (free amplification surface once `trust proxy` is fixed); `pickModBig` fallback has negligible modulo bias.
- Subscriber auto-enter dedup outside its transaction (operator-only, worst case one free duplicate ticket); credit-poll cron uses `<=` semantics for Anthropic spend and stamps dedup on failed sends.
- No global exception filter / Sentry on the backend (NestJS default filter still catches; AdminAlert + health dashboard cover the dangerous paths).
- Dealer-verification upload omits the `ParseFilePipe` content-type check used elsewhere (Cloudinary `resource_type:image` rejects non-images downstream).
- Stale frontend comment claims seller real names are in the listing payload (they are not — no leak); firearms-compliance policy cites SAPS 271 while the system verifies SAPS 534 and promises a vetted-dealer directory that doesn't exist (reconcile the draft policy text); `FRONTEND_URL`/`BACKEND_URL` Host-header/localhost fallbacks (self-targeting only; resolved by the `.env.example` work).

---

**Key files for the blockers:** `backend/src/payments/{peach.service.ts,transactions.controller.ts,transactions.service.ts}`, `backend/src/admin/admin.service.ts`, `backend/src/admin/guards/admin-jwt.guard.ts`, `backend/src/admin/admin-auth.service.ts`, `backend/src/kyc/verifynow.service.ts`, `backend/src/offers/offers.service.ts`, `backend/src/main.ts`, `backend/src/users/{users.service.ts,webhooks.controller.ts}`, `backend/prisma/schema.prisma`, `frontend/app/checkout/complete/page.tsx`, `frontend/app/checkout/offer/[offerId]/page.tsx`.