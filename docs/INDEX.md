# Documentation index

Every document in this repo, what question it answers, and — the part that matters — whether
it still describes the running system.

Two rules before you read anything here:

1. **Where a document and the code disagree, the code wins.** Everything under
   `docs/history/` was true on the date printed at the top of it and has not been maintained
   since. Several describe rails that were later removed, features that no longer exist, or
   vendors that were evaluated and rejected.
2. **Reports whose subject was removed from the product have been deleted deliberately**, so
   nothing here can lead a reader (or an agent) back to a retired feature. Reports that still
   carry reasoning worth keeping — why the money model is shaped the way it is, why "escrow"
   is a banned word, why an Order fans out into one Transaction per seller — are kept under
   `docs/history/`. Read those for the argument, not the status.

The live product is **Marketplace** (Buy Now listings with offers), **Auctions** and
**Motivations**, with **Item Valuation** paid per item.

---

## Start here

| Document | Read it when |
|---|---|
| [`README.md`](../README.md) | You have just cloned the repo and need it running locally. Stack, ports, env, and the domain glossary (SAPS dealer transfers, the listing types and offers, seller verification, Bob Go delivery). |
| [`docs/project-reference.md`](project-reference.md) | You need the house rules and the standing decisions: what is legally load-bearing, what wording is banned, what must never be changed without an operator call. This is the successor to the former `CLAUDE.md` (which no longer exists). It is long, but it is the most current rules document in the repo. |
| [`HANDOFF.md`](../HANDOFF.md) | You are starting a session and need the current state rather than the rules: what production runs, what the last session did, the open items, and the traps found the hard way. Overwritten each time; `docs/project-reference.md` holds anything durable. |
| [`ALLOUTDOOR-REPLATFORM.md`](../ALLOUTDOOR-REPLATFORM.md) | The clean-slate build under the new company. **The marketplace move is DONE** — production is the Absolute Hosting box and `alloutdoor.co.za` is live. What is still open is section 7 (applications left on the old Vultr box) and section 8 (operator decisions). Read sections 7 and 8 and the top-three-risks; treat the phased build in section 5 as executed. |

## Current reference

| Document | Read it when |
|---|---|
| [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) | You want how the pieces fit: the request path, the money state machine, the listing types and offers end to end, background jobs and third-party integrations. |
| [`docs/ENVIRONMENT.md`](ENVIRONMENT.md) | You are configuring a deploy or debugging a missing variable: every environment variable, what breaks when it is absent, and which are required in production. |
| [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) | You are deploying or operating the box. |
| [`PAYMENTS-GO-LIVE.md`](../PAYMENTS-GO-LIVE.md) | You are enabling or auditing real payments (Ozow pay-in + pay-out). The operator runbook: the production dashboard state, the exact `.env` flips, the float and live tests, and the open Ozow items. |
| [`COMPLIANCE-RULES.md`](../COMPLIANCE-RULES.md) | You need the regulated-goods and platform rules as enforced in code. |
| [`LICENCE-SERVICES-AND-FEED.md`](../LICENCE-SERVICES-AND-FEED.md) | You are touching the licence stack or the community feed and want the plan they came from. |
| [`DOCUMENT-CENTRE.md`](../DOCUMENT-CENTRE.md) | You are working on the Paper Work Vault (Document Centre) storage, retention or purge flow. |
| [`docs/MOTIVATION-GUIDE-BOOK.md`](MOTIVATION-GUIDE-BOOK.md) | You are working on the Motivation Creator. |
| [`docs/valuation-spec.md`](valuation-spec.md) | You are working on Item Valuation. |
| [`docs/design/the-bench/SPEC-BUILD.md`](design/the-bench/SPEC-BUILD.md) | You are building or changing **The Bench**, the reverse load finder for reloaders. |
| [`docs/design/licence-centre/SPEC-BUILD.md`](design/licence-centre/SPEC-BUILD.md) | You are building the **`/licence-centre` review sheet** (Motivation Centre). |
| [`docs/design/community-feed/spec.md`](design/community-feed/spec.md) | You are working on the members-only community feed. |
| [`docs/design/brand-pack-v1.2/`](design/brand-pack-v1.2/) | You need the official ALL-Outdoor Brand Pack v1.2 tokens, components and assets. See `SOURCE.md` inside for provenance. |
| [`docs/SESSION-LOG.md`](SESSION-LOG.md) | You want what a recent session actually did: edits, root causes, traps and open items, newest entry first. |

---

# History

Point-in-time reports, all under `docs/history/`. Grouped by theme, newest concern first
within each group. Dates are the dates printed in the documents.

## Money rails and payments

| Document | Date | What it covered / where it stands |
|---|---|---|
| [`PHASE8-MULTIBUY-DESIGN.md`](history/PHASE8-MULTIBUY-DESIGN.md) | 2026-06-28 | The design decision behind the cart: do **not** widen `Transaction`; layer `Order` + `OrderLineItem` above it and fan one Order into N Transactions, one per seller. Both models exist in `schema.prisma` today, so this is the rationale for the shape you will actually meet. The 8c half (store credit, vouchers, promos) was never built. |

## Compliance, legal and launch readiness

| Document | Date | What it covered / where it stands |
|---|---|---|
| [`TPPP-WEBSITE-READINESS.md`](history/TPPP-WEBSITE-READINESS.md) | 2026-07-16 | Work order to make the public site read like a clean due-diligence file for a bank underwriter assessing the Third Party Payment Provider application. **Executed** — the pages are live under `frontend/app/(legal)/`. Still worth reading before you touch public copy. |
| [`LAUNCH-CHECKLIST.md`](history/LAUNCH-CHECKLIST.md) | 2026-06-13 | The pre-launch to-do list that accompanied `AUDIT-2026-06-10.md`. **Do not use as a to-do list:** the site went public in June 2026, many items were done and none of the boxes were ever ticked. Historical only. |
| [`AUDIT-2026-06-10.md`](history/AUDIT-2026-06-10.md) | 2026-06-10 | Pre-launch security and readiness audit: 91 confirmed findings (5 critical). The remediation shipped before launch. Read it to understand which classes of bug this codebase has historically had. |
| [`LAUNCH_AUDIT.md`](history/LAUNCH_AUDIT.md) + [`LAUNCH_AUDIT_findings.json`](history/LAUNCH_AUDIT_findings.json) | ~2026-06-01 | The earlier launch-readiness pass — verdict **NO-GO** — that found the forged-webhook-marks-order-PAID and admin-auth-fails-open classes of defect. All fixed since. The `.json` is the machine-readable finding list. |

## Whole-platform audits and roadmaps

| Document | Date | What it covered / where it stands |
|---|---|---|
| [`UX-AUTOMATION-AUDIT-2026-07.md`](history/UX-AUTOMATION-AUDIT-2026-07.md) | 2026-07-24 | Whole-site UX and automation sweep, 110 confirmed findings, with a shipped-log at the top. Almost everything shipped; what is left is operator decisions. The closest thing the repo has to a recent product backlog. |
| [`ADMIN-AUDIT-REPORT.md`](history/ADMIN-AUDIT-REPORT.md) | 2026-07-09 | Six-agent audit of the admin surface for a sole non-coder operator running real money. A separate wiring pass shipped the alerts inbox and cron monitoring; the ADM batches themselves were **not** implemented. |
| [`TAKEALOT-UX-PARITY-REPORT.md`](history/TAKEALOT-UX-PARITY-REPORT.md) | 2026-07-05 | Gap analysis of the shopper journey against Takealot, batch by batch (UX-1…UX-8). Shipped. Read it if you want to know why a particular shop surface looks the way it does. |
| [`TRANSACTION-FLOW-AUDIT.md`](history/TRANSACTION-FLOW-AUDIT.md) | 2026-07-03 | End-to-end trace of every money path by 12 parallel tracers with adversarial verification. 59 confirmed gaps in batches F1–F7. **Partly open:** F1–F3 were committed, F4–F7 were not built. The single best map of how money actually moves through this system. |
| [`OUTDOOR-MARKETPLACE-AUDIT.md`](history/OUTDOOR-MARKETPLACE-AUDIT.md) | 2026-07-02 | The strategy document that originated the taxonomy work and, downstream, the All Outdoor rebrand. Big and mostly still-unbuilt roadmap. |

## Verification runs

| Document | Date | What it covered |
|---|---|---|
| [`DUMMY-RUN-REPORT.md`](history/DUMMY-RUN-REPORT.md) | 2026-07-17 | Output of an offline end-to-end harness that drove every module against a throwaway database with all external integrations stubbed. Shows what "green" looked like on that date. A record only — the harness itself has been removed. |
