# Buyer report: card payment came back to a disabled Pay button, then the bug report failed

**Date:** 2026-11-24 (23:02–23:10 SAST). **Reported by:** operator, on behalf of buyer `ruanda`.
**Shipped:** checkout recovery + bug-report hardening, deployed 5aaaa52c (full deploy: backend + frontend, 23:51 SAST). Rollback dump lloutdoor-20261124-235105.dump. Post-deploy: health OK ×2, public 200 ×2, GET /transactions/unpaid and POST /transactions/:id/abandon correctly 401 unauthenticated, new copy present in the deployed bundles, no new error lines.

## What the buyer experienced

1. On `/checkout/cmvjgomeu00sd3gvn0zzmyzy0` ("VersaX Rest Bag", seller `turbosnail`) she
   selected **Card (Peach)**, went through to the Peach hosted page, then pressed
   Back.
2. Back on checkout the **Pay button was greyed out** with no explanation. She
   could not finish and could not tell what was missing.
3. She opened **Report a bug**, typed it, and after "sending" froze for a while
   the form said **"Load failed"** — so the report never reached us.

## Evidence (production)

| Evidence | Value |
|---|---|
| Transaction | `cmwv6kphi0069aovn8xh9f7zi` — `paymentStatus=HELD`, `paymentProvider=PEACH`, `gatewayCheckoutId=8615af259c494d50a724e01f15514908`, `gatewayRedirectUrl=https://secure.peachpayments.com/checkout?…`, `paidAt=null`, `buyerTotal=74535` |
| Created | 2026-11-24 21:02:20 UTC / **23:02:20 SAST**; Peach webhook at 23:02:24 reported status `000.200.100` ("pending") and logged "not successful on re-fetch" |
| Return to checkout | nginx shows a full page load at **23:02:46** (`POST /transactions/hold` 201, `GET /payment-methods` 200, `POST /shipping/delivery-options` 200) |
| Listing | `cmvjgomeu00sd3gvn0zzmyzy0`, status **ACTIVE** (tracked stock: a HELD attempt does not flip the listing), so the old "resume" UI — which only looked at `PAYMENT_PENDING` — never appeared |
| Bug report | **No `POST /api/bugs/report` ever reached nginx** around 23:00–23:10; the fetch died on the device |

## Root causes

1. **Pay was disabled because the delivery choice was lost on the way back.**
   `deliveryOption` starts `null` and the picker required a manual tap. After the
   gateway round-trip (page reload) the form remounted with no option selected,
   so `isReady()` was false and Pay rendered disabled — silently.
2. **No way to resume or restart an unfinished payment.** The resume surface
   only existed when the listing was `PAYMENT_PENDING`; on tracked listings it
   stays `ACTIVE`, so checkout treated her as a brand-new buyer while an unpaid
   Peach session (and its reserved unit) was still open. Clicking Pay again could
   mint a **second payable session** — a double-charge risk.
3. **The bug report held the HTTP request open while it sent the email.**
   `BugsService` awaited `NotificationsService.bugReport()` (Resend API +
   screenshot attachment). On a phone that can exceed nginx's 95s read timeout,
   so the browser sees a dropped connection — Safari's opaque **"Load failed"**.
   The screenshot was also captured at full page size (multi-MB) which makes the
   upload slow without adding support value.

## Fixes shipped

### Checkout recovery (frontend + backend)

- **Cheapest-delivery default.** `DeliveryOptionsPicker` now auto-selects the
  cheapest door rate (else fastest, else first pickup) as soon as options load,
  keeps an existing choice across quantity/address re-quotes, and tells the
  parent immediately. Pay is no longer disabled for a choice the buyer never
  knew they had to re-make.
- **Why-is-Pay-disabled line.** The form renders a plain-language reason above
  the Pay button (verify phone/email, acknowledge papers, reserve the item,
  choose a delivery option, pricing delivery, etc.).
- **Resume / Start again banner.** The checkout server now looks up the buyer's
  own unfinished gateway attempt for the listing regardless of listing status
  and passes `unpaidTransactionId` to the form:
  - **Resume payment** → existing `/checkout/resume/:id` flow (same Peach
    session, same amount — no second charge);
  - **Start again** → new `POST /transactions/:id/abandon`, which only releases
    a LAPSED, unpaid attempt after the gateway confirms no capture, hands the
    reserved unit back, and raises `STALE_UNPAID_CHECKOUT_RELEASED` in admin
    alerts. A live window is refused with "use Resume instead".
- **Server-side duplicate guard.** `POST /transactions` now refuses with
  `409 { code: 'UNPAID_CHECKOUT_EXISTS', transactionId }` while the buyer has a
  live unfinished attempt for that listing, and the form catches it to show the
  same banner. A lapsed attempt is released first, so "Pay again" becomes
  "Pay once, correctly".
- **Listing page** also surfaces the resume path: with an unfinished payment the
  buy slot shows **Resume payment** instead of a second Buy; with a live hold it
  shows **Finish checkout** instead of taking a second hold.
- **Checkout compaction** (operator's "same clean up as the listing page"):
  the tall sticky reservation card is now a one-line timer (only the expired
  state shows words); the duplicate "final delivery rate is confirmed on the
  payment page" note is gone; the Platform Fee explainer is one line; delivery
  method cards are tighter. Order remains: items/address → delivery options →
  order summary → payment → Pay.

### Bug report hardening

- **Server returns immediately.** The email send is fire-and-forget: the report
  is validated and accepted, the email is dispatched in the background, and a
  failure raises `BUG_REPORT_EMAIL_FAILED` in admin alerts (categorised SYSTEM).
  A slow Resend call can no longer hold the member's request open.
- **Screenshot is downscaled** to 900px wide / JPEG 0.55 (target <1.5MB) and the
  capture itself is bounded to 8s — past that the report is sent without one.
- **Client upload is bounded to 30s** with friendly copy for a dropped
  connection; the text stays in the form for a retry.

## Files

- [checkout-form.tsx](../../frontend/app/checkout/[listingId]/checkout-form.tsx) — recovery banner, abandon handler, Pay reason, compact clock, conflict handling.
- [checkout page](../../frontend/app/checkout/[listingId]/page.tsx) — server-side unpaid lookup.
- [delivery-options-picker.tsx](../../frontend/components/delivery-options-picker.tsx) — default selection + keep choice.
- [listing page](../../frontend/app/listings/[id]/page.tsx) — ACTIVE-listing resume/hold takeover, resume in buy slot.
- [transactions.service.ts](../../backend/src/payments/transactions.service.ts) — duplicate guard, `abandonUnpaidCheckout`, lapsed release + admin alert.
- [transactions.controller.ts](../../backend/src/payments/transactions.controller.ts) — `POST /transactions/:id/abandon`.
- [bugs.service.ts](../../backend/src/bugs/bugs.service.ts), [capture.ts](../../frontend/components/bug-report/capture.ts), [bug-reports-api.ts](../../frontend/lib/bug-reports-api.ts) — non-blocking email, smaller screenshot, upload timeout.
- [admin-alert-category.ts](../../backend/src/admin/admin-alert-category.ts) — `STALE_UNPAID` → MONEY, `BUG_` → SYSTEM.

## Verification

- Backend: typecheck clean, **444 suites / 6,538 tests pass** (2 specs updated
  with the new `transaction.findFirst` mock; new paths exercised by existing
  checkout-hold tests).
- Frontend: typecheck clean, **187 files / 2,088 tests pass**, production build +
  theme-sync gate clean.
- Ruanda's stranded attempt `cmwv6kphi0069aovn8xh9f7zi` is now recoverable: the
  checkout shows the resume banner; if the Peach window has lapsed, **Start
  again** releases it (after the 5-minute grace) and starts a clean attempt. No
  manual data edit was needed.
- Note for support: an unfinished attempt is visible on the listing's checkout;
  the admin alert `STALE_UNPAID_CHECKOUT_RELEASED` records any automatic release.
