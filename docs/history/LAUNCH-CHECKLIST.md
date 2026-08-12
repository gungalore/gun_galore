# Gun Galore — Production Launch Checklist

**Companion to:** `AUDIT-2026-06-10.md` (full audit report).
**Purpose:** the definitive list of everything that must be done at production launch — operator-only items (credentials, contracts, env), schema migrations (require `prisma db push` / `prisma migrate deploy`), and intentionally-deferred features that need a real engineering pass.

Items already fixed in code and pushed to origin are crossed off the audit; they ship the moment you `deploy now`. **This file lists only what is NOT yet done.**

---

## 🔴 Tier 0 — Launch blockers (must be true on day 1)

### Credentials / accounts (operator)

- [ ] **Clerk production instance** (audit C3). Create a Clerk **production** instance, point it at the `gungalore.co.za` domain, add the CNAME DNS records Clerk requires, then swap in prod env:
  - frontend `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…` (rebuild + redeploy)
  - backend `CLERK_SECRET_KEY=sk_live_…`
  - backend `CLERK_WEBHOOK_SECRET=<re-created against the prod instance>`
  - **Verify**: live HTML contains `pk_live_…`, not `pk_test_…`.
- [ ] **VerifyNow → production** (audit C4). Set `VERIFYNOW_MODE=production` in backend `.env`, confirm `VERIFYNOW_API_KEY` and `VERIFYNOW_BASE_URL` point at production, confirm the account has credits. Restart and verify the boot warning is gone.
- [ ] **Payment gateway — live credentials** (audit C5). Decide and commit: Stitch live? Ozow? Paystack? FNB EFT?
  - **If Stitch:** swap `STITCH_CLIENT_ID` / `STITCH_CLIENT_SECRET` to live values; run one real end-to-end test sale; confirm funds settle in your account; confirm `/checkout/complete` reconciles.
  - **If Ozow / Paystack:** see § "Deferred features" below — adapter must be built first.
  - **If FNB EFT route:** see § "Deferred features" — the inbound-EFT matcher + bulk-payout CSV are not yet built.
- [ ] **Payment webhook secret** (audit H11). Register the gateway's webhook against `POST https://gungalore.co.za/api/payments/webhook/stitch` (or its successor) and put the returned signing secret in prod `.env` as `STITCH_WEBHOOK_SECRET=whsec_…`. Webhooks fail closed until this is set.

### Infrastructure (operator)

- [ ] **HSTS at Cloudflare** (audit H8). Cloudflare → SSL/TLS → Edge Certificates → enable **HSTS** with `max-age ≥ 31536000`, `includeSubDomains`, `preload` (only after confirming every subdomain is HTTPS-only). Verify with `curl -sS -D - -o /dev/null https://gungalore.co.za/ | grep -i strict-transport`.
- [ ] **Lift the coming-soon gate**. Set `COMING_SOON_GATE` ≠ `on` (e.g. unset or `off`). The middleware already emits `X-Robots-Tag: noindex` while the gate is on, so this is also what flips the site to indexable.

### Schema migrations (operator runs once)

- [ ] **Run `npx prisma migrate deploy` on prod** (audit M32). Switch from the current `prisma db push --accept-data-loss` flow to a tracked-migration flow before any new schema lands. Without this, a future deploy could drop the runtime-added tsvector columns. (DBA/dev pairing required — write the baseline migration, then apply.)
- [ ] **Declare runtime-added FTS columns in `schema.prisma`** (audit M32 / FIX-9 / BC-SCHEMA-DRIFT). The `ask-gg`, `reloading`, `hunt-pdf` services add `tsvector` columns at boot via raw DDL. Put them into `schema.prisma` (as `Unsupported("tsvector")`) and create a tracked migration that creates them + their GIN indexes.
- [ ] **Add + push the deferred schema additions** (these were rolled back from the audit-fix deploy to avoid colliding with the tsvector drift). Once you're running tracked `prisma migrate deploy` (the line above):
  - `Transaction.firearmAttestationAcceptedAt DateTime?` — durable evidence of the 18+/SAPS-competency consent. Today the gate refuses checkout without the flag and logs a `FIREARM_ATTESTATION` line per transaction, but does not persist a timestamp on the row. Add the column, then re-add the write in `transactions.service.ts:create()` (the comment block in the file flags exactly where).
  - `@@index([paymentStatus, acceptDeadlineAt])` and `@@index([paymentStatus, dispatchDeadlineAt])` on `Transaction` — the accept-escalation (10-min) and dispatch-SLA (hourly) sweeps will degrade to sequential scans as transaction volume grows without these.

---

## 🟠 Tier 1 — Strongly recommended before public launch (code work still to do)

### Money path / payments (Claude can build)

- [ ] **Auction winner-pay path** (audit C2). The "you won — pay now" link from the auction-end SMS currently 404s because the checkout page only accepts `ACTIVE + BUY_NOW`. Build:
  - Backend: new `payAuctionWin(clerkId, listingId, tokenWinAmount)` in `TransactionsService` that accepts a `PAYMENT_PENDING + AUCTION` listing, verifies the caller is the auction winner, uses the winning bid amount, mints checkout + transaction the same way the BUY_NOW path does.
  - Frontend: relax `/checkout/[listingId]` to accept the auction case when the URL carries a valid CHECKOUT action token.
  - **Scope**: ~1 day. Touches `auctions.service.ts`, `transactions.service.ts`, `transactions.controller.ts`, `checkout/[listingId]/page.tsx`.
  - **Re-enable** the auction Buy-Now button I disabled in `auction-panel.tsx` once this path exists.
- [ ] **Abandoned-checkout reconcile cron** (audit H2). Today, a buyer who starts checkout but never returns / their card declines / the gateway link expires leaves the listing PERMANENTLY in `PAYMENT_PENDING`. Build:
  - New cron in `tasks.service.ts` (every 5 min): for every `PAYMENT_PENDING` listing whose `Transaction.createdAt` > 24h ago and `paidAt` is still null, re-query the gateway. If paid → markPaid; if expired/cancelled/failed → revert listing to `ACTIVE` + stamp transaction `paymentStatus='EXPIRED'`.
  - Add a Stitch (or successor) `payment.expired` / `payment.cancelled` webhook handler that does the same per-event.
  - Apply the same sweep to auction `PAYMENT_PENDING` listings.
  - **Scope**: ~1 day.
- [ ] **Real featured-slot charging** (audit H1). I disabled `featured.service.ts` binding in production (it was marking bids paid with a fake gateway id). To re-enable: wire a real Stitch (or successor) charge before flipping the bid to WON. Until then, featured slots cannot be bound in production.
- [ ] **Offer checkout full price breakdown** (audit H6 + M19). The accepted-offer Pay button currently shows item-only price; the gateway then charges item + shipping + processing. Mirror the Buy-Now checkout's logic: fetch `/shipping/quote`, render full order summary, capture TCG coords, gate the Pay button on a ready quote. Scope: ~half-day, all in `frontend/app/checkout/offer/[offerId]/offer-checkout-form.tsx`.
- [ ] **Raffle: unique ticket + atomic cap** (audit H4). Add `@@unique([raffleId, ticketNumber])` to `Ticket` in `schema.prisma`; replace the pre-check + counter in `RafflesService.createPendingTickets` with an atomic conditional `updateMany` (`{ ticketsSold + qty <= target }`). **Verify there are no existing duplicate `(raffleId, ticketNumber)` rows BEFORE pushing the unique constraint** (a duplicate would block the migration). The H5 backup-deadline reset is already done in code.
- [ ] **POPIA soft-delete + scrub for Clerk `user.deleted`** (audit H3 — full version). The interim try/catch + scrub I shipped keeps the webhook from looping forever. Full POPIA-correct fix:
  - Add `deletedAt DateTime?` + `deletedReason String?` to `User`.
  - All `User.find*` queries: filter `deletedAt: null` (write a `findActive` helper).
  - Soft-delete instead of hard-delete in `deleteByClerkId`; scrub PII (same fields as my interim fix).
  - Switch FK `onDelete: RESTRICT` to soft-delete-aware semantics on Transaction/Offer/Rating.

### POPIA / security (Claude can build)

- [ ] **Admin JWT to httpOnly cookie** (audit M22). Today the admin session JWT is in localStorage + a JS-readable cookie. An XSS on an admin page exfiltrates a platform-admin token. Move to backend-set httpOnly + Secure + SameSite=Strict cookie. ~half-day.
- [ ] **Counterparty PII strip in `Transaction.findById`** (audit M11). Add explicit DTO/select that omits `adminNote`, `peachPaymentId`, `peachResultCode`, and counterparty PII from the API response.
- [ ] **Soft-delete `SmsLog` retention** (audit POPIA-4). SMS bodies (incl. OTPs, contact-reveal details) accumulate forever. Add a cron that scrubs `message` to `"[redacted]"` after N days (suggest 30) — keeps the row for audit, drops the PII.
- [ ] **Re-key `kycIdHash`** (audit POPIA-5). Switch from `sha256(secret + idNumber)` to `HMAC-SHA256(secret, idNumber)`. This requires a one-time migration to re-hash existing rows — coordinate with the operator.

### Reliability / hardening (Claude can build)

- [ ] **Global Nest exception filter** (audit EXC-1 defense-in-depth). Add an `APP_FILTER` global exception filter in `app.module.ts` that returns sanitised `{statusCode, message}` JSON for all errors and prevents stack-trace leakage on 5xx.
- [ ] **Pudo webhook signature verification** (audit M1). The Pudo webhook (`POST /api/shipping/webhook/pudo`) is fully unauthenticated — anyone can POST shipping events. Needs Pudo's webhook signing scheme (header name + HMAC algo) from Pudo's docs/support, then verify fail-closed in prod. **TCG half of this is DONE** (2026-06-13 audit pass): `webhook/tcg` now fails closed in production when `TCG_WEBHOOK_SECRET` is unset (`shipping.controller.ts`). Still TODO for TCG: constant-time secret compare.
- [ ] **Consume CHECKOUT token on transaction creation** (audit M3). The CHECKOUT action token lives 24h and isn't consumed on use — a leaked URL stays a valid bearer credential. Consume it in `TransactionsService.create()` when the bound transaction is created.
- [ ] **Fee math: rename `PEACH_*` → Stitch (or successor)** (audit M7). `fee.calculator.ts:28-33` hard-codes Peach's 3.5% + R1.50 + VAT. Replace with the live gateway's real fee schedule (confirm exact rate with operator). The constants are persisted on every order — wrong rates over- or under-charge sellers.

---

## 🟡 Tier 2 — Soon after launch

### Frontend correctness / a11y / perf

- [ ] **Live countdowns tick** (audit M20). Accept-window / dispatch-deadline chips on `transactions/[id]` are computed server-side once; extract a small `'use client'` countdown component using the existing `useCountdown` hook.
- [ ] **Cloudinary raw `<img>` → next/image with sized variants** (audit M24). `image-gallery.tsx`, `live-search.tsx` — full-resolution originals are downloaded for 52px thumbnails.
- [ ] **Bottom-tab Shop/More sheets — Escape + focus trap** (audit M25). WCAG keyboard-trap violation on the primary PWA nav.
- [ ] **Live-search combobox ARIA + arrow keys** (audit M26). WAI-ARIA combobox pattern.

### SEO / public surface

- Sitemap + OG metadata + `/listings` browse + noindex-while-gated all shipped today.
- [ ] **Per-listing `generateMetadata()`** with the first Cloudinary photo as `og:image`. Hugely improves WhatsApp link unfurls. ~1hr.

### Logging / observability

- [ ] **Promote VerifyNow + Stitch (or successor) boot warnings to hard-throws** so a future deploy can't silently regress to sandbox/test credentials.
- [ ] **CSP enforcement** (audit M28). Today the `headers()` block I shipped sets `Content-Security-Policy: frame-ancestors 'none'` only — full `script-src`/`connect-src` requires per-environment tuning (Clerk, Cloudinary, Anthropic, payment gateway origin). Roll out as Report-Only first, observe for a week, then enforce.
- [ ] **Dependency bumps** (audit M35, DEPS-4):
  - `@clerk/nextjs@latest` + `@clerk/backend@latest` to pull in `js-cookie ≥ 3.0.7` (high-sev advisory GHSA-qjx8-664m-686j).
  - Pin Node version: add `engines.node` to both `package.json`s + `.nvmrc` at repo root.

---

## ✅ Already fixed in this audit-remediation batch

All committed and pushed to `feat/hunt-ballistics-range-estimator`. Ship via `deploy now`.

**Critical / High** — C1 offer→listing binding · H1 featured fake-paid disabled in prod · H3 user.deleted try/catch + PII scrub (interim) · H5 raffle backup deadline reset · H7 reloadOnOnline:false · H9 security headers (XFO + nosniff + Referrer-Policy + Permissions-Policy + COOP + CSP frame-ancestors) · H10 1-year HTML cache TTL replaced with 5min+SWR.

**Medium** — M4 verify-result narrow throttle · M8 offer-accept re-checks listing status · M9 auction Buy-Now disabled in UI · M12 dealer-verification file-type validation · M13 ask-gg image-host allowlist · M14 + M15 + M34 featuredTick + 5 crons try/catch + recordCronRun · M16 createFeaturedSlotInvoice query inside try · M17 raffles PDF narrow per-IP throttle (was @SkipThrottle on the whole controller) · M18 `@@index` on Transaction.acceptDeadlineAt / dispatchDeadlineAt · M21 complete page no-txId surfaces error state · M23 SW offline fallback excludes /kyc + /sign-in + /sign-up · M27 `/listings` redirect (no more 404) · M29 OG + Twitter Card metadata · M30 sitemap.ts · M31 X-Robots-Tag: noindex while coming-soon gate on · M33 18+/competency attestation at firearm checkout (backend HARD-refuses without it; checkbox in both checkout forms; persisted as `firearmAttestationAcceptedAt`) · PAY-8 refund-without-payment-id now raises admin alert instead of silently flipping REFUNDED.

**PWA / cleanup** — PWA-4 stale "peach" SW comment removed.

---

## 📌 Decision log to revisit at launch

- **Payment gateway**: Stitch / Ozow / Paystack / FNB — committed yet? Every code change above downstream of the gateway is gateway-agnostic by design.
- **AVS / bank verification**: confirmed dropped (Stitch Express has no AVS; you do manual admin check at payout). If the gateway changes, re-confirm.
- **POPIA retention windows**: SMS bodies, KYC images, encrypted SA ID — what's your written retention policy? The scrub crons need that number.
- **Featured-slot real charging**: needed for revenue. Currently disabled in prod by the H1 fix.
- **Public raffles**: gated today by the dev-confirm-only path. Don't enable public raffles in prod until the H4 unique-ticket + atomic-cap + real-Stitch-confirm path lands.

---

*Last updated 2026-06-10 during the audit-remediation pass. Cross off as you complete; the source of truth for what's still outstanding is git + the open-items section above, not your memory.*
