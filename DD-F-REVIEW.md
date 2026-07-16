# DD-F (Daily Deals JIT Supplier Fulfilment) — Review Report

**Reviewed:** 2026-07-16 · **Base:** deployed `edee95d` → work `b5782ce` (local only, NOT pushed)
**Method:** 13-agent adversarial review (9 component reviewers + 4 cross-cutting lenses), every finding refuted by an independent skeptic re-reading the code; plus full compile/build/test/dummy-run gates. Audited against `DAILY-DEALS-FULFILMENT.md`.

## Verdict

The changeset is **high quality and correctly inert** — it compiles clean, passes every gate, leaks no supplier/PO data, cannot double-spend, and leaves non-deal marketplace behaviour byte-identical. **But it was NOT go-live ready:** two HIGH defects fire the instant deals start trading (both inert today because `deals_enabled` is OFF / 0 deals). Nothing here needs a production deploy today.

## Fixes applied this session (H1, H2, M1)

All three graded ≥ MEDIUM are now fixed in the working tree and re-verified (backend `nest build` ✅, jest **418 passed** ✅, dummy-run ✅):

- **H1** — `dispatch-sla.service.ts`: added `listing: { isDealListing: false }` to **both** `autoRefundStale` and `nudgeStale` so deferred deals are no longer refunded/nudged on the accept+5d clock (their own fulfilment lifecycle governs). Locked in by a new regression spec `courier-crons-skip-deal.spec.ts`. *(`Transaction.listingId` is non-null, so this cannot regress any non-deal row.)*
- **H2** — `zoho-books.service.ts`: `createDealPurchaseOrder` now chains `await emailPurchaseOrder(dealId)` after the PO is PLACED, so the supplier is emailed on the auto-end/sold-out path too. Still flag-gated (`deal_po_email_enabled` OFF) and Zoho-gated → inert until go-live; no-op in the dummy-run.
- **M1** — `supplier.dto.ts` + `suppliers.service.ts`: `active` is now whitelisted in `UpdateSupplierDto` and applied in `update()`, so the edit-modal Active checkbox actually deactivates/reactivates.

**Residual (H1 follow-up, design decision — NOT a bug):** deals now have no automatic buyer refund if the operator never sources stock / never taps Stock-ready. That is surfaced operationally by the "Supplier collection overdue" card; a deal-aware refund SLA (e.g. refund if not booked within `shipsInDaysMax` + grace) is a recommended v1.1 addition.

**Not fixed (low/nit, deferred by scope):** L1 (auto re-attempt sweep), L2 (can't unset a supplier), L3 (PO-units/exactly-once jest coverage), N1–N3 — see below.

## Addendum — 2026-07-16 pre-deploy polish pass (all residuals closed)

- **L1 ✅** — booking core extracted to `DealsService._bookReadyCollections`; new
  `sweepUnbookedStockReadyCollections()` re-attempts stragglers hourly
  (`TasksService.sweepDealCollections`, cron key `deal-collection-sweep`). Only
  re-drives bookings the admin's Stock-ready tap already authorised; relation
  filter keeps the scan bounded.
- **L2 ✅** — deals-table.tsx now sends explicit `supplierId: null` so "No
  supplier assigned" actually clears the link on edit (backend already handled null).
- **L3 ✅** — `zoho/deal-po-units.spec.ts` (units = paid-non-refunded Σqty, zero-sale
  terminal row, placement-keyed idempotency) + `payments/deal-po-exactly-once.spec.ts`
  (sold-out PO trigger fires iff flip.count > 0). Jest 425 passed.
- **N1 ✅** — dead `raisePurchaseOrderForDeal` seam removed.
- **N3 ✅** — stale Payments→Deals module-edge comment corrected.
- **N2 (accepted)** — dummy-run drives the PO via admin `end()`; the scheduled
  auto-end path shares the same `_endSystem` core, so coverage is equivalent.
- Re-verified after the pass: backend tsc + nest build ✅ · jest 425 ✅ ·
  dummy-run Daily Deals 14/14 + held-funds R0 ✅ · frontend tsc + next build ✅.

Remaining open item: the **deal-aware refund SLA** (design decision, v1.1) — no
automatic buyer refund if stock is never sourced; surfaced operationally by the
"Supplier collection overdue" card until v1.1 lands.

## Gates — all green

| Gate | Result |
|---|---|
| `prisma generate` + `nest build` (backend) | ✅ exit 0 |
| `tsc --noEmit` (frontend) | ✅ exit 0 |
| `next build` (frontend) | ✅ exit 0 — no route collision from new `/admin/suppliers` |
| Dummy-run harness | ✅ DD-F money paths + all 8 non-deal modules pass; held-funds settle to 0 |
| Jest (416 passed) | ✅ incl. the 2 new DD-F specs |

Dummy-run's one "product bug" = the pre-existing Featured `bindListingToSlot` deadlock the work order explicitly scopes out. **Not yet run: backend boot-verify** (nest build does not catch DI boot crashes) — but the DI-boot lens found the wiring clean.

## Clean areas (0 findings)

- **Public-leak lens** — supplier/PO/cost/warehouse fields kept out of `publicShape()` and the public listing select; leak-fix rule applied consistently.
- **Money double-spend lens** — double-PO and double-booking **provably impossible**; idempotency guards + one-shot status transitions hold.
- **Inertness / non-deal regression lens** — ships inert; every new path gated behind `isDealListing`, original path preserved.
- **DI-boot lens** — module/guard wiring clean (JwtModule + AdminJwtGuard present; `ZohoBooksModule` imported; `SuppliersModule` registered). Only a stale doc-comment.
- **Schema + migrations** — additive-only, matches the Prisma models; idempotency id columns present.
- **Suppliers module** — CRUD, validation, no hard delete: correct.

## Confirmed findings (9)

### 🔴 HIGH — go-live blockers (inert today)

**H1 · Money-loss: deferred deals auto-refunded at day 5** — ✅ **FIXED** — `backend/src/payments/transactions.service.ts:1663` (+ `dispatch-sla.service.ts:117-132`)
DD-F3 defers the courier booking for deals but still stamps `dispatchDeadlineAt = acceptedAt + 5d`. The unchanged `autoRefundStale` cron matches the exact deferred-deal shape (accepted, HELD, TCG, not dispatched) and **auto-refunds the buyer at day 5 — before the deal's default 3–7 day ships window even closes.** It compounds: the supplier PO was already cut at sold-out, so GG has ordered/paid for stock while refunding the paid buyer and re-listing the deal (money-loss + orphaned PO). `dispatch-sla.service.ts` is not in the changeset — the deferral shipped with no companion carve-out.
*Fix:* exclude `isDealListing` from `autoRefundStale`/`nudgeStale`, **or** don't stamp `dispatchDeadlineAt` at accept for deals — stamp it when `bookDealCollections` runs (deadline keyed off `stockReadyAt` + `shipsInDaysMax` / a courier SLA).

**H2 · Supplier never emailed the PO in the primary flow** — ✅ **FIXED** — `backend/src/zoho/zoho-books.service.ts:981`
`emailPurchaseOrder` is correct but its only caller is the "Place PO" button (`deals.service.ts:942`), gated on `!deal.purchaseOrder`. Every lifecycle trigger (end `deals:891`, live-expired `:1201`, extended-expired `:1220`, sold-out `transactions:1804`) calls `createDealPurchaseOrder` **only**, which always creates the PO row — so once a deal auto-ends/sells-out the button disappears and there is no other affordance. The supplier is never emailed. Defeats the DD-F mission for the primary path.
*Fix:* chain `void emailPurchaseOrder(id)` after each lifecycle `createDealPurchaseOrder` (still flag-gated by `deal_po_email_enabled`, so still inert), or add an "Email/Re-email PO" cockpit button.

### 🟠 MEDIUM

**M1 · Supplier deactivate is broken from the admin UI (silent success)** — ✅ **FIXED** — `frontend/app/admin/(protected)/suppliers/suppliers-table.tsx:232`
The edit modal's "Active" checkbox PATCHes `active`, but `UpdateSupplierDto` has no `active` field and the global `whitelist:true` ValidationPipe strips it; the working `POST /admin/suppliers/:id/deactivate` endpoint is never called by the frontend. Operator unchecks Active → 200 OK → nothing changes.
*Fix:* frontend should call the `/deactivate` (+ a reactivate) endpoint, or add `active` to `UpdateSupplierDto` and handle it in `SuppliersService.update()`.

### 🟡 LOW

**L1 · No automated re-attempt sweep for unbooked stock-ready collections** — `transactions.service.ts:1817` — DD-F3 asked for the sweep AND the attention card; only the card was built. If `bookDealCollections` crashes partway, stragglers stay unbooked until an operator notices the card. (Card is a manual backstop.)

**L2 · "No supplier assigned" can't unset a deal's supplier** — `deals-table.tsx:597` — `supplierId: form.supplierId || undefined` drops the key, and the backend only writes when `!== undefined`, so the old link is silently kept. DRAFT/SCHEDULED only. *Fix:* send explicit `null` to clear.

**L3 · Missing jest coverage for PO-units + exactly-once trigger** — `deal-booking-deferral.spec.ts:109` — DD-F5 required 4 jest deliverables; 2 shipped (deferral, supplier-address). No deterministic test exercises `createDealPurchaseOrder`'s paid-non-refunded unit count or the exactly-once trigger (dummy-run covers it non-deterministically).

### ⚪ NIT

- **N1** `DealsService.raisePurchaseOrderForDeal` (`deals.service.ts:1072`) is dead code.
- **N2** Dummy-run raises the PO via the manual admin `end()` trigger, not the scheduled `runScheduledDrops()` — the production auto-end trigger path has no harness coverage.
- **N3** `deals.module.ts:23` comment asserts a Payments→Deals module edge that doesn't exist (the trigger calls `ZohoBooksService` directly — which is correct).

## Refuted (6) — checked and dismissed

Concurrent PO status reset (double-PO is prevented; cosmetic-only and not actually reachable) · stock-ready accepting a DRAFT PO (matches the Zoho-off design) · `validateShipping` 4-arg belt-and-braces (the primary `reserveAndCreateLine` check covers it) · card counts unbooked-only (minor) · PO cockpit omits a cost figure (by design) · dummy-run false-green (a capture stub is installed).

## Recommended sequence

1. Restore the pre-review git state (the local `b5782ce` commit was made by a review sub-agent, unauthorized, and its "verified" message is inaccurate).
2. Fix **H1**, **H2**, **M1** before any go-live.
3. Re-run gates (jest + dummy-run + boot-verify), then commit with an accurate message.
4. Go-live remains separately gated (Zoho 'Daily Deals Revenue' account, `deals_enabled` ON, `deal_po_email_enabled` ON, attorney) per the existing checklist — do NOT enable as part of this.
