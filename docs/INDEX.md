# Documentation index

Every document in this repo, what question it answers, and — the part that matters — whether
it still describes the running system.

Two rules before you read anything here:

1. **Where a document and the code disagree, the code wins.** Everything under
   `docs/history/` was true on the date printed at the top of it and has not been maintained
   since. Several describe rails that were later ripped out (manual EFT), features that were
   removed (the internal-ballistics calculator), or vendors that were evaluated and rejected
   (KoraPay).
2. **Nothing has been deleted.** These files record real decisions and, more usefully, the
   reasoning behind them — why the money model is shaped the way it is, why "escrow" is a
   banned word, why an Order fans out into one Transaction per seller. That reasoning is not
   recoverable from the code. If a history doc looks wrong, it is probably a snapshot of a
   decision that was later reversed; read it for the argument, not the status.

---

## Start here

| Document | Read it when |
|---|---|
| [`README.md`](../README.md) | You have just cloned the repo and need it running locally. Stack, ports, env, the domain glossary (SAPS dealer transfers, the selling modes, KYC, PUDO). |
| [`CLAUDE.md`](../CLAUDE.md) | You need the house rules and the standing decisions: what is legally load-bearing, what wording is banned, what must never be changed without an operator call. It is written for an AI agent and it is long, but it is the most current document in the repo. |
| [`ALLOUTDOOR-REPLATFORM.md`](../ALLOUTDOOR-REPLATFORM.md) | The in-flight cutover: moving the marketplace off the Vultr VPS to Absolute Hosting, `gungalore.co.za` → `alloutdoor.co.za`. Live work, not history. |

## Current reference

| Document | Read it when |
|---|---|
| [`docs/HUNTING-PILOT-PREP.md`](HUNTING-PILOT-PREP.md) | You are working on Experiences / Hunting Packages. The module (E0–E5) is deployed but not switched on in production, and this is the operator playbook for the manual concierge pilot that is supposed to run *before* the software is switched on: the deposit-holding model, the supplier and dispute shapes, and the brief for the attorney opinion that gates go-live. Forward-looking, still unexecuted. |

---

# History

Point-in-time reports, all under `docs/history/`. Grouped by theme, newest concern first
within each group. Dates are the dates printed in the documents.

## Money rails and payments

| Document | Date | What it covered / where it stands |
|---|---|---|
| [`PEACH-IVORI-MIGRATION-INSTRUCTIONS.md`](history/PEACH-IVORI-MIGRATION-INSTRUCTIONS.md) | 2026-07-12 | The locked operator decision to delete manual EFT entirely and move pay-in to Peach and pay-out to Ivori, with the full implementation plan. **Half-superseded:** manual EFT really was stripped (see the comment at the top of `backend/src/manual-payments/manual-payments.module.ts`) and Peach was built, but payouts went to Peach Payouts, not Ivori — there is no Ivori integration in the code, only two stale comments. Read it for *why* EFT had to go. |
| [`KORAPAY-INTEGRATION.md`](history/KORAPAY-INTEGRATION.md) | 2026-07-17 | Investigation-only write-up of KoraPay as an alternative pay-in/payout rail, mapped onto the existing service seam. Outcome was **don't build**: no ZAR card acceptance, firearms appetite unconfirmed, Nigerian-law contract. Read it if someone proposes Kora again. |
| [`PHASE8-MULTIBUY-DESIGN.md`](history/PHASE8-MULTIBUY-DESIGN.md) | 2026-06-28 | The design decision behind the cart: do **not** widen `Transaction`; layer `Order` + `OrderLineItem` above it and fan one Order into N Transactions, one per seller. Both models exist in `schema.prisma` today, so this is the rationale for the shape you will actually meet. The 8c half (store credit, vouchers, promos) was never built — no `StoreCredit`/`Voucher`/`Promo` models exist. |

## Compliance, legal and launch readiness

| Document | Date | What it covered / where it stands |
|---|---|---|
| [`TPPP-WEBSITE-READINESS.md`](history/TPPP-WEBSITE-READINESS.md) | 2026-07-16 | Work order to make the public site read like a clean due-diligence file for a bank underwriter assessing the Third Party Payment Provider application: remove overclaiming copy, publish the statutory pages. **Executed** — the pages are live under `frontend/app/(legal)/`. Still worth reading before you touch public copy: it is the clearest statement of what the site is allowed to claim and what it is not (no "escrow", no automated-AVS claims, no promises of services that do not exist). |
| [`LAUNCH-CHECKLIST.md`](history/LAUNCH-CHECKLIST.md) | 2026-06-13 | The pre-launch to-do list that accompanied `AUDIT-2026-06-10.md` — credentials, migrations, deferred features. **Do not use as a to-do list:** the site went public at the end of June 2026, many of these items were done and none of the boxes were ever ticked, and it still assumes the Stitch payment rail that no longer exists. Historical only. `CLAUDE.md` cites it by its old root path in several places. |
| [`AUDIT-2026-06-10.md`](history/AUDIT-2026-06-10.md) | 2026-06-10 | Pre-launch security and readiness audit: 91 confirmed findings (5 critical) across backend, frontend, TLS/headers/cache, dependencies. The remediation shipped before launch. Read it to understand which classes of bug this codebase has historically had. |
| [`LAUNCH_AUDIT.md`](history/LAUNCH_AUDIT.md) + [`LAUNCH_AUDIT_findings.json`](history/LAUNCH_AUDIT_findings.json) | ~2026-06-01 (committed 06-12) | The earlier, blunter launch-readiness pass — verdict **NO-GO** — that found the forged-webhook-marks-order-PAID, refunds-that-never-refund and admin-auth-fails-open classes of defect. All fixed since. The `.json` is the machine-readable finding list for the same run. |

## Whole-platform audits and roadmaps

These are the big ones. They are where the current product roadmap came from, and several
still have open items.

| Document | Date | What it covered / where it stands |
|---|---|---|
| [`UX-AUTOMATION-AUDIT-2026-07.md`](history/UX-AUTOMATION-AUDIT-2026-07.md) | 2026-07-24 | Whole-site UX and automation sweep, 110 confirmed findings, with a shipped-log at the top listing which batch and commit landed each one. Almost everything shipped; what is left is operator decisions (store credit, follow-seller, a real bulky-freight rail). The closest thing the repo has to a recent product backlog. |
| [`ADMIN-AUDIT-REPORT.md`](history/ADMIN-AUDIT-REPORT.md) | 2026-07-09 | Six-agent audit of the admin surface for a sole non-coder operator running real money: "visibility without levers", alerts with no inbox, stuck-money states with no button. Batches ADM-0…ADM-10 were specified; a separate wiring pass shipped the alerts inbox and cron monitoring, but the ADM batches themselves were **not** implemented. |
| [`TAKEALOT-UX-PARITY-REPORT.md`](history/TAKEALOT-UX-PARITY-REPORT.md) | 2026-07-05 | Gap analysis of the shopper journey against Takealot, batch by batch (UX-1…UX-8). Shipped. Read it if you want to know why a particular shop surface looks the way it does. |
| [`TRANSACTION-FLOW-AUDIT.md`](history/TRANSACTION-FLOW-AUDIT.md) | 2026-07-03 | End-to-end trace of every money path — select → checkout → payment → acceptance → fulfilment → delivery → release → payout → invoicing → reversals — by 12 parallel tracers with adversarial verification. 59 confirmed gaps in batches F1–F7. **Partly open:** F1–F3 were committed, F4–F7 were not built. The single best map of how money actually moves through this system. |
| [`OUTDOOR-MARKETPLACE-AUDIT.md`](history/OUTDOOR-MARKETPLACE-AUDIT.md) | 2026-07-02 | The strategy document: 12 agents on the thesis that the firearms marketplace should become a general SA outdoor marketplace (camping, fishing, overlanding, hunting packages), with competitor research and SA legal guard-rails. This is the origin of the taxonomy work and, downstream, of the All Outdoor rebrand. Big and mostly still-unbuilt roadmap. |

## Daily Deals — built, switched off

The whole module (DD-1…DD-5 plus DD-F) is deployed with every feature flag OFF, so it is
inert in production. If you are asked to switch it on, these four are the spec.

| Document | Date | What it covered |
|---|---|---|
| [`ONEDAYONLY-TEARDOWN.md`](history/ONEDAYONLY-TEARDOWN.md) | 2026-07-15 | Teardown of OneDayOnly.co.za — the business model being copied. Read first. |
| [`DAILY-DEALS-PLAN.md`](history/DAILY-DEALS-PLAN.md) | 2026-07-15 | The module design: Gun Galore as first-party seller, drops, Extra Time, admin-created deals. Firearms are deliberately excluded. |
| [`DAILY-DEALS-FULFILMENT.md`](history/DAILY-DEALS-FULFILMENT.md) | 2026-07-16 | The sell-first-buy-after half (DD-F): deal sells out → Zoho Books purchase order raised against the supplier → supplier ships. Includes the go-live sequence (create suppliers, flip `deals_enabled` and `deal_po_email_enabled`). |
| [`DD-F-REVIEW.md`](history/DD-F-REVIEW.md) | 2026-07-16 | 13-agent adversarial review of the DD-F changeset before deploy: two HIGH defects that fire the moment deals start trading, both fixed in that session. Useful as a worked example of the review bar money-touching code is held to. |

## Verification runs

| Document | Date | What it covered |
|---|---|---|
| [`DUMMY-RUN-REPORT.md`](history/DUMMY-RUN-REPORT.md) | 2026-07-17 | Output of the offline end-to-end harness: every module driven against a throwaway database with all external integrations stubbed. Shows what "green" looked like on that date. Note the drivers assert the old manual-checkout shape and will fail now that manual EFT has been removed — the report is a record, not a suite you can currently run. |

## Removed features

| Document | Date | What it covered |
|---|---|---|
| [`LOAD-LAB-PORT-GUIDE.md`](history/LOAD-LAB-PORT-GUIDE.md) | 2026-06-27 | How the Load Lab worked and how to port it into the standalone ballistics app. The internal-ballistics **calculator was removed from this repo on 2026-07-13** (see the comment in `backend/src/load-lab/load-lab.controller.ts`); what survives here is the PRO-gated published-load browser, the free powder burn-rate chart and the powder/cartridge data files. This is the only written description of the physics engine those data files were built for. |

---

**Known stale cross-references:** `CLAUDE.md` still refers to `LAUNCH-CHECKLIST.md` and
`AUDIT-2026-06-10.md` by their old repo-root filenames. Both now live in `docs/history/`.
