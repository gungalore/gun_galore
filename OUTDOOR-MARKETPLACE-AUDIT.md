# Gun Galore → The Ultimate SA Outdoor Marketplace
## Full-platform audit & upgrade roadmap — 2 July 2026

**How this was produced:** 12 specialist agents — 5 read-only codebase auditors (Ask GG engine, taxonomy, finance, Zoho Books, site UX), 4 market researchers (SA/international resale competitors, camping + overlanding, fishing + clothing, hunting packages), and 3 adversarial critics (feasibility vs the real code, SA legal compliance, business/sequencing). 123 findings; the 67 critical/high ones were individually verdict-checked by all three critics. Feasibility: 64 sound / 3 corrected. Compliance: 0 rejected / 17 guard-railed. Business: consolidated duplicates, parked 4 wrong-stage items.

---

# 1. Executive summary

**The thesis holds and nobody occupies the space.** SA's secondhand outdoor trade lives on Gumtree, Facebook groups, Sealine and 4x4community classifieds — all payment-unprotected and scam-saturated (~46% of SA consumers have been hit by courier/EFT fraud; 1-in-6 Facebook Marketplace users report fraud). The one SA proof point is **Yaga** (fashion resale): 2M+ users, profitable on a ~25-person team, monetised purely by a buyer-side protection fee (6.5% + R19.90) + funds-held-until-confirmed + Pudo/PAXI delivery — **exactly the architecture Gun Galore already runs**, applied to a vertical Yaga is weak in. Your KYC + funds-held + integrated-courier + dealer-transfer stack is ahead of every local channel. The work is not architecture; it's **fixing money leaks, switching on built-but-unbilled revenue, broadening the catalogue, and pointing Ask GG at the whole outdoor market.**

**But the audit found real money and compliance bugs that come first.** The most important discoveries are not new features:

1. **Auction commission is currently uncollectable** — an auction winner's checkout link dead-ends (the checkout page rejects non-ACTIVE listings and there is no auction branch in the checkout service). Every won auction strands.
2. **Partial refunds never pay out** — the admin can record a partial refund and the buyer is SMSed about it, but on the manual rail no money moves and the refund CSV only picks up fully-REFUNDED transactions. Phantom refund notices = CPA complaint risk + double-pay exposure.
3. **Three firearm-gating holes** — editing a listing's category doesn't re-derive the firearm flag (a firearm listing could be re-filed as "camping" and bypass dealer transfer), admin-created subcategories default to non-firearm, and the secondhand-availability flag isn't enforced server-side. Existential FCA risk; must close before ANY category expansion.
4. **Core revenue never reaches your books** — Zoho commission invoices are only created for *firearm* sales (dealer-verification hook). Every ordinary courier sale's commission never lands in Books, so bank deposits can't tie to revenue. Only 3 of 11 revenue streams are wired to Zoho at all.
5. **Only three revenue streams actually collect money today** — commission, the 1.5% EFT fee, and swap leg fees. Featured slots (fully built, R100–R500/slot) are hard-disabled in production; MEMBER/PRO subscriptions have no price and no purchase flow ("Launching soon"); raffle tickets dead-end on the dormant gateway; shipping is pure pass-through with zero margin.
6. **The swap cash top-up is an open commission dodge** — cash amount has no cap, so any sale can masquerade as a R50-flat swap. Fee-scale or cap it.
7. **Refund batch rows silently skip forever** when the buyer has no bank details on file — nobody is told, the money just never leaves.

**Fix those, then switch on the built revenue, then grow.** The roadmap below is sequenced exactly as the business critic ordered it: compliance → money bugs → billing on existing rails → supply breadth (taxonomy/copy/discovery) → retention → new verticals.

---

# 2. What the market research says

## 2.1 The competitive gap
| Channel | Volume | Trust | Payments | Logistics |
|---|---|---|---|---|
| Gumtree / FB groups | High | Scam-ridden | None | None |
| 4x4community / Sealine / SA Hunters forums | Medium, loyal | Reputation-based | None | None |
| GunAfrica / Gunmarket / GunFinder | Guns only | Disclaim everything | None | None |
| ClassicArms | Auctions | High | Yes (17.25% buyer premium) | Limited |
| Yaga | Fashion only | High | Funds-held, buyer fee | Pudo/PAXI/Aramex/Pargo |
| **Gun Galore today** | Low (new) | **KYC + funds-held + dealer network** | **Live EFT rail** | **Pudo + TCG integrated** |

**No dedicated SA outdoor resale marketplace exists.** The winning international patterns to import: buyer-side fee monetisation (Yaga/Vinted/Depop), hold-then-auto-release settlement (SidelineSwap 72h), condition-grading standards (REI/GearTrade), and BookYourHunt's 10% success-fee model for hunts.

## 2.2 The categories with proven used demand (research-verified ZAR bands)
- **Overlanding (the biggest missing segment):** National Luna/Engel fridges resell at 50–60% of new (R5k–R9k); Howling Moon rooftop tents ~35% of new (R10k–R12k); Front Runner racks R6k–R10k; 270° awnings R8.5k–R15k; Conqueror/Echo/Bushwakka trailers R80k–R300k (all three manufacturers run their own "pre-loved" desks — the demand is proven).
- **Fishing:** Stella/Saltiga-class offshore reels, fly kit, Hobie kayaks (R40k–R120k), fish finders (used 40–60% of retail). Trade lives on Sealine classifieds + Facebook, fake-EFT-proof scams everywhere.
- **Technical apparel:** First Ascent, K-Way, Sniper Africa, Wildebees, Jonsson, Courteney — Yaga is weak here; it's your wedge. Only viable with PAXI-class R60 shipping + bundling (a R150 fleece over a R100 courier is dead).
- **Hunting packages:** biltong hunting is R3bn+/season, ZAR-priced, permit-light, and *is your existing user base*. Pricing is template-stable: day fee R600–R1,500 pp/night, guide R2,000/day, per-animal list (springbok R2,500 → kudu R25k), 50% deposit, balance on arrival. BookYourHunt (10% success fee) barely serves the local market; SA Hunters' 38,500-member portal books via one phone number.

## 2.3 Hard compliance lines the researchers + compliance critic drew
- **Gas cylinders:** cannot be couriered at all (TCG prohibits all compressed gas) — collection-only listing policy, enforced server-side in shipment booking, never as copy alone.
- **Lithium batteries:** standalone packs are UN3480 Class 9 dangerous goods — Wh-threshold rule: small batteries inside devices OK, standalone/large = collection-only.
- **Trailers/caravans:** NaTIS papers + roadworthy on ownership change — v1 is collection-only with a "papers in order" attestation, not a bespoke workflow.
- **Hunts:** platform must position as **intermediary/venue, never supplier** (CPA), hold **deposit only** (never full booking value for months — that drifts toward Banks Act deposit-taking), vet outfitter/exemption papers, CPA s17 tiered cancellation. Keep "Hunting Packages" category inactive until this framework ships.
- **Subscriptions:** CPA s14 — fixed-term subs need 20-business-day cancellation with pro-rata refunds.
- **Badges/attestations:** "Tested & working" must render as the *seller's* attestation, "GG Verified" as "photos verified as this seller's possession on [date]" — never a GG warranty of condition (CPA s41; and never word a protection fee as insurance/indemnity).
- **"Protection fee":** structure and word as a *platform service fee* (Yaga-style), never as insurance.

---

# 3. The roadmap

Phases are ordered by the business critic's sequencing rule: **compliance → revenue bugs → billing on existing rails → supply breadth → retention → new verticals.** Each phase is deployable on its own, in the established pattern (tsc + build + adversarial review on money/compliance phases + deploy via SSH).

## PHASE 0 — Stop the bleeding (compliance + money bugs) · ~1 week
*Everything here is small/medium effort and protects money or licence-to-operate.*

| # | Item | Why |
|---|---|---|
| 0.1 | **Close the 3 firearm-gating holes** (re-derive isFirearm on category change + DB CHECK; admin subcategory inherits parent flags; enforce availableSecondhand server-side) | FCA — existential. Blocks all category work. |
| 0.2 | **Fix auction-winner checkout** (+ same-day stopgap: flag off new auctions until fixed) | Entire auction commission stream = R0 today. |
| 0.3 | **Fix partial refunds on the manual rail** (emit partial-refund rows into the FNB batch; stop phantom notifications) | Money recorded + buyer notified but never paid. |
| 0.4 | **Capture buyer bank details at refund time + surface skipped refund rows** in admin | Refunds silently skip forever today. |
| 0.5 | **Cap/fee-scale the swap cash top-up** (e.g. commission on cash above a threshold) | Open commission-avoidance channel. |
| 0.6 | **Wire non-firearm commission invoicing into confirmDelivery** (Zoho) + verify ZOHO_BOOKS_ENABLED + CFP account in prod | Core revenue currently never reaches Books. |
| 0.7 | **Invoice the 1.5% EFT pass-through** as a line on the commission invoice | Real revenue, currently undocumented. |

## PHASE 1 — Switch on built-but-unbilled revenue · ~1–2 weeks
| # | Item | Why |
|---|---|---|
| 1.1 | **MEMBER/PRO billing on the manual-EFT rail** (own reference lane in the reconciler; CPA s14 cancellation terms; Zoho receipts) | First MRR. Every perk already built and gating users. **Needs your price decision — see §5.** |
| 1.2 | **Featured slots paid via payout deduction** (or EFT reference lane) instead of waiting for a card gateway | 10 slots × R100–R500, zero COGS, earning R0 since launch. |
| 1.3 | **Zoho hygiene batch:** monthly aggregated swap-fee receipt; failed-sync queue + alert surface; fix stale "Peach Pending" deposit account; VAT-readiness pass on all four document builders | Accountant-proof the books before volume. |
| 1.4 | **Held-funds reconciliation report** (platform-generated CFP position vs Books) — the critic's pragmatic alternative to per-transaction mirroring | Trust-money audit trail without scale-stage machinery. |

## PHASE 2 — Ask GG becomes the outdoor engine · ~2 weeks
| # | Item | Why |
|---|---|---|
| 2.1 | **Widen the scope gate + all UI copy to the full outdoor spectrum** (system prompt, decline copy, hero, starter tiles, composer placeholder) — bundle every remaining gun-first copy string site-wide (PWA Shop sheet, FAQ, category SEO descriptions) | Near-pure copy; prerequisite for the whole thesis. Ask GG currently *refuses* fishing/camping questions the marketplace already serves. |
| 2.2 | **In-chat marketplace tools: searchMarketplace + getComplements** (Meilisearch listings index + existing cross-sell engine), rendered as tappable listing cards | The single biggest AI revenue lever: every gear answer ends with live stock. |
| 2.3 | **Generalise identifyFromPhotos to outdoor gear** for sell-flow pre-fill (keep the firearm lane's serial/licence checks fully intact when category = firearm) | Supply lever. Fish/spoor/plant ID ships later as marketing garnish. |
| 2.4 | **Fishing regs + region/season advice v1** (ingest DFFE/provincial docs into the existing RAG with a domain tag; prompt-only Kgalagadi-in-July advice using the SANBI biome data already in the codebase; widen the web-search allowlist per topic) | Recurring-utility hooks for the two biggest new audiences. |
| 2.5 | **Domain-tag the manual RAG** and ingest regs/safety docs first (gear manuals only where licence-permitted — copyright guardrail) | Foundation for "THE outdoor engine" moat. |

## PHASE 3 — One consolidated taxonomy + discovery drop · ~2–3 weeks
*Four agents proposed overlapping trees — this is ONE seed migration, not four projects.*

| # | Item | Why |
|---|---|---|
| 3.1 | **The new category tree in one migration:** Overlanding & 4x4 (RTTs, fridges, dual-battery/solar, recovery, awnings, drawer systems, trailers*), camping deepened (Tents at last!), Fishing rebuilt discipline-first (+ Electronics, + Craft), Hunting parent (fix the "Men's Hunting Pants under Gun Smithing" seed bug), Outdoor Clothing & Footwear, Archery & Bowhunting, Optics extended (GPS/comms/drones/thermal with SA-legal flags), Working Dogs & Field Gear | Can't sell what buyers can't file or find. |
| 3.2 | **Collection-only shipping mode** (new ShippingMethod, server-side excluded for firearms) — the cheap 80% of "big & heavy"; unlocks RTTs, trailers, kayaks, boats | Shared dependency of five findings. Full pallet-freight integration deferred. |
| 3.3 | **Dangerous-goods policies enforced server-side:** gas = collection-only/empty/no exchange cylinders; lithium Wh threshold; used fuel containers collection-only | Carrier accounts (TCG/Pudo) are load-bearing; one incident is existential. |
| 3.4 | **Parent-category rollup** in browse + Meilisearch (parent pages currently return zero listings) | Main casual-buyer entry path dead-ends today. |
| 3.5 | **Homepage category tile grid** + link the orphaned /category pages + real Meilisearch facet counts | Discovery + the primary organic-SEO entry. |
| 3.6 | **Commission floor tweak** for low-ticket items (R30 min is 30% of a R100 item) | One-line fee-calculator change; unblocks apparel economics early. |

*Trailers & Caravans opens collection-only with a papers attestation (POPIA: never display NaTIS docs publicly).*

## PHASE 4 — The attribute system (the big structural build) · ~3–4 weeks
| # | Item | Why |
|---|---|---|
| 4.1 | **Per-category attribute schema + sell-form + filters + Meilisearch facets** (fridge litres, RTT sleeps, rod class/length, reel size, battery Ah, boot/clothing size + measurements + New-with-tags) | THE blocker to shoppable clothing/overlanding/fishing. Everything in Phase 3 becomes filterable. |
| 4.2 | **Vehicle-fitment attribute** for racks/canopies/drawers/sliders ("fits: Hilux 2016+") | High-ticket segment is unsearchable without it. |
| 4.3 | **Condition rubric + per-category photo guidance** (keep the existing 5-value enum — relabel, don't rename; advisory photo checklists, not friction) | Sight-unseen buying confidence. |
| 4.4 | **Cross-sell engine keys on attributes** | Compounds the existing engine. |

## PHASE 5 — Trust + retention (the liquidity flywheel) · ~2–3 weeks
| # | Item | Why |
|---|---|---|
| 5.1 | **Saved searches + new-listing alerts** (push/SMS infra already built) | THE retention mechanism for a thin-supply marketplace. |
| 5.2 | **Price-drop + item-sold alerts on wishlisted items** | Highest-converting notification type in resale. |
| 5.3 | **72h auto-release + 3-day dispute window** standardised across buy flows (worded as the platform-mediated remedy clock, not a limit on CPA rights) | Faster predictable payouts; bounds funds-holding (compliance-positive). |
| 5.4 | **"Tested & working" seller attestation badge** for electronics/fridges (rendered as seller's claim) | Unlocks the R5k–R30k appliance segment. |
| 5.5 | **GG Verified (R49): productise the swap proof-of-possession vision pipeline** for any high-value listing ("possession verified on [date]") | Paid trust product on already-built machinery. |
| 5.6 | **Recently-sold price transparency + "what's my gear worth" comps** (from sold data; seeded with the research price bands for the ~10 overlanding hero items). The AI value-estimator ships *after* comp data exists | Faster, better-priced listings; seller magnet. |
| 5.7 | **Brand landing pages** — gated: only generate/sitemap pages with ≥N active listings | Highest-converting SEO, but thin-content-safe. |

## PHASE 6 — Shipping economics programme (one programme, not three) · ~2–3 weeks
| # | Item | Why |
|---|---|---|
| 6.1 | **PAXI (PEP) integration** — R59.95, 5kg, the rural network your demographic uses. NOTE: no public self-serve API; likely needs a partnership/aggregator route — investigate first, Pargo as fallback | Apparel + rural liquidity unlock. |
| 6.2 | **Per-seller shipping consolidation in cart** (one parcel quote per seller, not per line) | Multi-buy is live; shipping math currently punishes it. |
| 6.3 | **Bundle mechanics** (Yaga-style add-to-bundle before payment) | Amortises courier cost on low-ticket items. |
| 6.4 | **Optional small shipping handling margin / per-label fee** | Shipping is pure cost pass-through today. |

## PHASE 7 — Experiences: pilot first, engine later
| # | Item | Why |
|---|---|---|
| 7.1 | **Concierge pilot (no build):** manually broker 2–3 vetted biltong outfitters + 1–2 shooting-range packages through existing EFT rails, admin-managed | Validates demand + teaches the ops before any engine is built. |
| 7.2 | **Compliance framework** (build alongside pilot): intermediary positioning + disclosures, outfitter/exemption vetting file, CPA s17 tiered cancellation policy (published policy + manual admin handling in v1), 18+/licence attestations extended to range packages | The legal shell the vertical needs regardless of engine. |
| 7.3 | **v1 engine (only after pilot converts):** fixed-price date-slot bookings — range packages first (zero seasonality, lowest legal risk, exact audience overlap), then biltong hunts with **deposit-held-as-commission (~10%), balance direct to outfitter** — never hold full booking value | The money model the compliance critic endorsed. |
| — | International trophy hunting | Deferred — USD pricing, TOPS permits, outfitter/PH registration drag. |

## PARKED (explicitly, per the business critic)
- **Trade-in days / instant-credit events** — needs a platform-credit wallet ledger that doesn't exist + physical event ops + Second-Hand Goods Act registration. Revisit at scale.
- **White-label "official resale partner" B2B deals** — epic enterprise sales at the wrong stage. Keep as strategy note.
- **Estate/collection consignment intake** — white-glove per-item labour a solo operator can't carry; FCA landmine (GG must never possess firearms — dealer partner only). Revisit as dealer-partner referral later.
- **Full experience engine with per-animal price sheets** — parked until the Phase 7 pilot proves demand.

---

# 4. Ask GG: from firearms chatbot to outdoor engine (deep-dive)

**Today (inventory):** 6 tools (manual search/pages, external ballistics, internal ballistics PRO, published loads, powder info) + gated web search (25 reloading domains) + vision + photo listing pre-fill + KB deflection + quotas/streaming/cost audit. All of it firearms/reloading-scoped; the module literally cannot see the marketplace (imports only Reloading/Ballistics/LoadLab).

**Target-state toolset after Phases 2 & 5:**
| Tool | Status |
|---|---|
| searchMarketplace / getComplements | NEW — the revenue lever |
| identifyFromPhotos (all outdoor gear) | Generalised, firearm lane intact |
| estimateResaleValue | After sold-comp data exists (Phase 5.6) |
| Fishing regs + region/season advice | NEW knowledge lanes |
| Domain-tagged document RAG (regs, safety, licensed manuals) | Generalised pipeline |
| Ballistics/Load Lab suite | Unchanged (the shooting moat) |
| KB | Seeded per-vertical, same machinery |

The scaffolding (injection resistance, tier gating, cost control, citation chips, KB deflection) all carries over unchanged — this is prompt/copy work plus two module imports plus handlers, not a rebuild.

---

# 5. Decisions I need from you (in order of urgency)

1. **MEMBER/PRO pricing** (Phase 1.1). Suggested for discussion: MEMBER R49–R79/mo, PRO R149–R199/mo, discounted annual. CPA s14 terms will be drafted accordingly.
2. **Fee-model direction** (shapes Phases 3/6): keep seller commission for the existing gun/high-ticket lanes AND introduce a **buyer-side protection-style service fee (Yaga-proved: ~6.5% + R19.90) with 0% seller fee for the NEW low-ticket outdoor/apparel categories** — the critics endorsed this split rather than a blanket switch. Yes/no/tune?
3. **Featured-slot billing mechanism** (Phase 1.2): payout deduction (recommended — zero new payment flow) vs EFT reference lane?
4. **Auction stopgap** (Phase 0.2): OK to flag off *new* auction creation today until the winner-checkout branch is built?
5. **Hunting pilot** (Phase 7.1): want me to prepare the outfitter-vetting checklist + concierge flow so you can approach 2–3 biltong outfitters?

---

# 6. What was NOT broken (worth knowing)

- The manual-EFT reconciler, payout batching, swap module (incl. PoP), dealer-transfer/SAP-534 automation, KYC flow, courier booking, cross-sell engine, KB pipeline, and the Zoho code that *is* wired — all audited clean and well-engineered. The platform's bones are genuinely ahead of every SA competitor in this space.
- SA fishing licences do **not** restrict selling used gear — only a small net deny-list (gill/seine nets; province-restricted cast nets) is needed.
- The Condition enum, notification/push infra, biome data, and multi-buy cart are all reusable foundations the roadmap builds on rather than replaces.

---

*Appendix — the full 123-finding register with per-finding critic verdicts follows.*


---

# APPENDIX — Full finding register (123 findings, critic verdicts on all critical/high)


## A. Ask GG AI engine

**Auditor summary:** Ask GG is a mature, cost-controlled Claude chat (Sonnet default, Opus escalation, SSE streaming, prompt caching, per-message cost audit, tier quotas) with six client tools plus gated web search — but every single tool is reloading/ballistics, the system prompt hard-declines anything not "firearm-adjacent", and the assistant has zero awareness of the marketplace it lives in (AskGgModule imports only Reloading/Ballistics/LoadLab; it cannot reach Meilisearch listings search or the category-generic cross-sell engine in ListingsService.crossSell). The site already sells Fishing and Camping & Outdoor (seeded categories), yet a "which carp reel should I buy?" or "tent for Kgalagadi in July?" question is refused by the scope gate, and the listing photo-ID prompt literally returns "Photos do not appear to show firearms or related gear" for a fishing reel. The underlying seams generalise well: the reloading-manual RAG (FTS + PDF page-slicing + OCR backfill + citation chips) is a domain-agnostic document pipeline, the KB schema is topic-agnostic, hunt-ballistics already does species-ID vision and encodes SANBI biome data, and the web-search allowlist is just a hardcoded array. Headline gaps: no in-chat listings search/cross-sell tool (the biggest revenue lever), no price/value estimator anywhere in the codebase, firearms-only vision, no fishing regs/gear-manual/first-aid knowledge, and firearms-only UI copy on frontend/app/ask-gg/page.tsx.


### askgg-engine-1 · Reference (a): complete capability inventory of Ask GG today
**Impact:** low · **Effort:** small · **Revenue:** none/indirect — reference material

Chat client tools in C:\dev\gun-galore\backend\src\ask-gg\ask-gg-claude.service.ts (TOOLS, lines 60-241): (1) searchReloadingManuals — Postgres FTS over 19 uploaded reloading-manual PDFs, all tiers; (2) fetchManualPages — pdf-lib page slices attached as native PDF documents, all tiers; (3) calculateBallistics — G1 external-ballistics drop/wind/energy tables, MEMBER/PRO (FREE gets an upsell tool_result); (4) computeLoadData — GRT-calibrated internal-ballistics engine (velocity/pressure/ladder + downrange), PRO only; (5) lookupPublishedLoads — structured ManualLoad dataset (38,494 loads/447 cartridges), all tiers; (6) lookupPowderInfo — burn-rate rank/equivalents/cartridges, all tiers; plus (7) Anthropic server web_search, max 2/turn, 25-domain reloading allowlist, MEMBER/PRO only. Non-tool capabilities: chat vision via Cloudinary URLs (SSRF-allowlisted, FREE capped 5 photo-requests/30d, 5-10 photos/msg by tier); identifyFromPhotos one-shot firearms listing pre-fill (POST /ask-gg/identify-listing); KB search-first deflection (Postgres FTS over verified Q&A, zero Claude cost, usefulCount/surfacedCount analytics, auto-DRAFT from resolved conversations, verified-expert badge pipeline at 5+ entries); SSE streaming + user-triggered Opus escalation + per-message cost rows; quotas FREE 5 msgs/30d, MEMBER 20/hr, PRO 60/hr. The Load Lab UI panel (frontend/app/ask-gg/load-lab/) calls /load-lab endpoints directly with no LLM (burn chart, compute, recommended loads, DOPE, charge ladder).

### askgg-engine-2 · Reference (b): where the stack is firearms/reloading-centric
**Impact:** low · **Effort:** small · **Revenue:** none/indirect — reference material

SYSTEM_PROMPT (ask-gg-claude.service.ts lines 303-489): scope list enumerates only firearms/ammo/reloading/optics/hunting/knives/SA-firearms-law and instructs a hard decline for anything else; self-describes as "South Africa's verified firearms marketplace", stale versus the outdoor homepage reframe. All 6 client tools + the RELOADING_WEB_ALLOWLIST (lines 257-288, zero fishing/camping/4x4 domains) are shooting-only. identifyFromPhotos (lines 1367-1392) is "an SA firearms identification assistant" with a calibre field and an explicit non-firearm refusal rule, though it already receives the full category tree including fishing/camping slugs. Frontend (frontend/app/ask-gg/page.tsx): welcome hero "Your firearms-knowledgeable assistant" (line 1925), all 6 starter tiles firearms (lines 1903-1909), composer placeholder "Ask about firearms, ammo, optics, hunting…" (line 878). The KB schema (AskGgKbEntry: title/question/answer/category/tags) is topic-agnostic, but its content pipeline only ever ingests firearms Q&A because the scope gate filters what conversations can exist.

### askgg-engine-3 · Add marketplace listings-search + cross-sell tools inside chat
**Impact:** critical · **Effort:** medium · **Revenue:** Direct — converts the AI cost centre into a discovery/conversion funnel for every category, and feeds the demand-capture flywheel

Chat has zero knowledge of what is for sale: AskGgModule (backend/src/ask-gg/ask-gg.module.ts) imports only Reloading/Ballistics/LoadLab, and no tool touches listings. Meanwhile SearchService already runs a Meilisearch 'listings' index (title/make/model/calibre/category searchable; price/province/category/condition filterable — backend/src/search/search.service.ts) and the cross-sell engine (ListingsService.crossSell, backend/src/listings/listings.service.ts:591) is already category-generic via CategoryRelation and even logs demand misses. Build two tools: searchMarketplace({q, category?, maxPriceZar?, province?}) over the Meilisearch index (ACTIVE-only) and getComplements wrapping crossSell; import ListingsModule/SearchModule into AskGgModule, add tool defs + handlers in the existing handleToolCall switch, and render results as tappable listing cards via the existing citation-chip seam on assistant messages. Every gear-advice answer then ends with real stock ("there are 3 Vortex scopes listed under R8k right now").

**Critic verdicts:**
- *feasibility:* **SOUND** — Verified: AskGgModule imports only Reloading/Ballistics/LoadLab; Meili listings index has categorySlug/province/condition/make filterable; crossSell (listings.service.ts:591) is category-generic. Two corrections to fold in: 'price' is NOT in updateFilterableAttributes (only 'priceRange'), so the maxPriceZar filter needs 'price' added + a settings reindex; and the handleToolCall switch + citation-chip seam exist as claimed, so the wiring is exactly module-import + tool-def work. No circular-dep risk (ListingsModule doesn't import ask-gg).
- *compliance:* **SOUND** — Firearm listings are already public and all FCA gating (dealer transfer, 18+ attestation, SAP-534) is enforced at transaction time, so chat surfacing adds no new exposure. Keep the tool ACTIVE-only and never surface inactive categories (Ammo).
- *business:* **SOUND** — Highest-leverage Ask GG item: turns a pure cost centre into a conversion surface using seams that already exist (Meili index, crossSell). One caveat to carry into build: with thin inventory many searches return zero — chain that into saved-search/demand-capture rather than a dead 'nothing found'.

### askgg-engine-4 · Widen the system-prompt scope and Ask GG UI to the full outdoor spectrum
**Impact:** critical · **Effort:** small · **Revenue:** Direct prerequisite — unlocks Ask GG as the acquisition hook for all non-shooting verticals

The scope gate (ask-gg-claude.service.ts lines 305-323) refuses fishing, camping, overlanding, archery, outdoor clothing, and 4x4 questions today even though Fishing and Camping & Outdoor are live seeded categories (backend/prisma/seed.ts:56-57) — the assistant actively turns away buyers the marketplace already serves. Rewrite the scope list to cover the full outdoor spectrum (fishing, camping/overlanding, archery/bowhunting, optics/electronics, knives, outdoor clothing/footwear, 4x4/recovery, hunting packages), update the decline copy, the "firearms marketplace" self-description, and the frontend hero/6 starter tiles/composer placeholder (page.tsx lines 878, 1903-1929) with outdoor examples. This is a prerequisite for every other gap and is almost pure prompt/copy work; the injection-resistance, tool-routing and law-deferral scaffolding all carry over unchanged.

**Critic verdicts:**
- *feasibility:* **SOUND** — Verified the strict scope list at ask-gg-claude.service.ts:305-323 (declines fishing/camping/overlanding) while Fishing and Camping & Outdoor are live seeded categories. Pure prompt/copy change; injection/tool scaffolding untouched. Cheapest-highest-leverage item in the set.
- *compliance:* **SOUND** — Prompt/copy work; the existing law-deferral and injection-resistance scaffolding carries over. No new regulatory surface.
- *business:* **SOUND** — Cheapest prerequisite in the whole audit — the assistant currently refuses buyers in categories the marketplace already serves. Build first; bundle with the gun-first copy-string fixes as one repositioning pass.

### askgg-engine-5 · Build a secondhand price/value estimator tool ("what is my Engel 40L worth?")
**Impact:** high · **Effort:** medium · **Revenue:** Direct — pulls sellers in to list, improves pricing accuracy → faster sales → more fee revenue

No valuation code exists anywhere in backend/src (no priceSuggest/valuation hits). Build an estimateResaleValue tool: comps from completed Orders/Transactions (real sold prices) + active listing asking prices matched by category/make/model via Meilisearch, blended with a web-search new-price anchor and simple condition/depreciation heuristics; return a range with confidence and the comps used. Seams: a small pricing service in the listings module, exposed (a) as an Ask GG chat tool and (b) as a "suggested price" pre-fill on /listings/new next to the existing identifyFromPhotos flow. Early sold-comp data will be thin, so lead with the web-anchored estimate and label it; the comp base compounds as GMV grows. This is a seller-acquisition magnet nothing else in SA offers.

**Critic verdicts:**
- *feasibility:* **SOUND** — Confirmed zero valuation code in backend/src. Sold comps exist on Transaction/Order rows; Meili matching works. One caveat: Ask GG's web_search tool is hard-allowlisted to reloading domains (RELOADING_WEB_ALLOWLIST, line 299), so the web-price anchor needs a separate per-request search-tool config with a retail allowlist — trivial but must be scoped deliberately.
- *compliance:* **SOUND** — Comps are aggregated transaction/listing prices with no personal information (POPIA-safe). Label estimates clearly as indicative, non-binding ranges so the platform doesn't make a misleading price representation (CPA s41).
- *business:* **NEEDS-CHANGE** — Right instinct, wrong v1. With near-zero sold comps, a web-anchored AI estimate is a hallucination risk on the one number that burns seller trust fastest. V1 should be the camping agent's curated hero-item price bands (static, verified data — the Load Lab data-not-AI pattern); graduate to the live tool only once real sold-comp volume exists.

### askgg-engine-6 · Generalise photo-ID vision: outdoor gear, species, fish, plants, spoor
**Impact:** high · **Effort:** medium · **Revenue:** Indirect-strong — photo ID drives listing creation (supply) and viral sharing (acquisition)

Chat vision today feeds photos into the firearms-scoped prompt (a fish or tent photo → decline), and identifyFromPhotos hard-refuses non-firearm items by rule (ask-gg-claude.service.ts:1385) despite already receiving fishing/camping category slugs in its tree. Fix in two moves: (1) reword identifyFromPhotos into an outdoor-gear identification prompt (brand/model/category/condition; keep calibre as optional firearms-only field) so listing pre-fill works for reels, fridges, tents, bows; (2) add an explicit vision lane to the chat prompt for species/fish/plant/spoor ID with SA context (bag-fish species, tracks, veld plants) — the hunt-ballistics range estimator (backend/src/hunt-ballistics/range-estimator/range-estimator-claude.service.ts) already does confident species ID with a Sonnet→Opus fallback pattern to copy, and the operator's model-pick memory (Haiku for photo→recall) applies. Photo ID is the existing wow feature; fish/spoor ID is the version of it that markets the fishing and hunting verticals.

**Critic verdicts:**
- *feasibility:* **SOUND** — Verified the hard non-firearm refusal rule in the identify prompt (ask-gg-claude.service.ts:1385) and that range-estimator-claude.service.ts exists as the species-ID pattern to copy. Both moves are prompt rewrites on existing seams; category tree already flows in.
- *compliance:* **NEEDS-CHANGE** — Broadening must not weaken the firearm lane: keep the existing serial-number/licence vision checks fully intact whenever the category resolves to a firearm, and hard-refuse firearm-adjacent evasion (e.g. a pistol photographed as 'outdoor gear'). Species/fish ID answers should carry protected-species caveats — if the identified animal is TOPS/NEMBA-listed or has provincial bag/closed-season rules, say so and defer to the authority.
- *business:* **NEEDS-CHANGE** — Split it. Part 1 (outdoor-gear identifyFromPhotos for sell-flow pre-fill) is a direct supply lever and should ship with the scope widening. Part 2 (fish/spoor/plant ID) is marketing polish with no transaction path — park it until the gear-ID version proves listing lift.

### askgg-engine-7 · Gear-matching and kit-builder advice grounded in SA regions/seasons
**Impact:** high · **Effort:** medium · **Revenue:** Direct when chained to listings search — kit lists become multi-item carts (P8b single-seller cart is already live)

"Tent for Kgalagadi in July" is refused today, yet the codebase already holds the grounding data: backend/src/hunt-ballistics/region-flora/sa-biomes.ts encodes SANBI biome polygons + profiles. V1 is prompt-only: scope the assistant to give region/season-aware gear advice (Kgalagadi winter = -10°C nights → sleeping-bag ratings, canvas vs nylon) with the same "informational, verify locally" framing used for law. V2 adds a lookupRegionConditions tool over an extended sa-biomes-style dataset (parks/regions, seasonal temps, terrain, malaria zones) and a kit-builder flow that chains gear advice into the searchMarketplace tool so every checklist item links live stock. Depends on the scope widening and pairs 1:1 with the listings-search tool for revenue.

**Critic verdicts:**
- *feasibility:* **SOUND** — sa-biomes.ts + biome-lookup.service.ts exist in hunt-ballistics/region-flora as claimed. V1 is prompt-only; V2 tool follows the existing tool-handler pattern. Depends on the scope widening, correctly sequenced.
- *compliance:* **SOUND** — Informational advice with the existing 'verify locally' framing. Malaria-zone guidance is health information — keep the same disclaimer pattern (consult a travel clinic), not medical advice.
- *business:* **NEEDS-CHANGE** — Ship V1 (prompt-only region/season advice) as part of the scope-widening pass — it's essentially free. Defer the V2 regions dataset + kit-builder tool until the listings-search tool has proven that chat answers convert to clicks; otherwise you're building a second dataset for an unproven funnel.

### askgg-engine-8 · Fishing regulations and licence knowledge (permits, bag/size limits)
**Impact:** high · **Effort:** medium · **Revenue:** Indirect — recurring-utility hook that pulls the fishing audience onto the platform

Nothing exists: the prompt covers SA firearms law only, and the hardcoded RELOADING_WEB_ALLOWLIST means even MEMBER/PRO web search physically cannot reach fishing-regs sources. Ingest the official recreational-fishing documents (DFFE marine recreational fishing brochure with bag/size/closed seasons, provincial freshwater regs) into the manual RAG as domain-tagged docs and/or add DFFE + provincial domains to the allowlist; answer with the same defer-to-authority framing as firearms law ("confirm with DFFE / your provincial authority"). Bag-limit and permit lookups are a killer recurring use case for the SA fishing community and a trust/SEO wedge into the largest outdoor vertical.

**Critic verdicts:**
- *feasibility:* **SOUND** — RELOADING_WEB_ALLOWLIST is a hardcoded const — adding DFFE/provincial domains is a one-line change; the manual-RAG ingest path (admin inbox, FTS, page slicing) is live. Cleanest if done after the domain-tagged library finding so fishing regs don't pollute reloading retrieval.
- *compliance:* **SOUND** — Defer-to-authority framing plus official DFFE/provincial sources is the correct guardrail. Add document date/version to answers so stale bag limits or closed seasons are never presented as current — wrong limits get users fined under MLRA/provincial ordinances.
- *business:* **SOUND** — Cheap recurring-utility wedge into the biggest vertical, riding the existing RAG rails. Non-negotiable execution detail: date-stamp the ingested regs and keep the defer-to-authority framing — stale bag limits are a trust liability.

### askgg-engine-9 · Generalise the reloading-manual RAG into a domain-tagged outdoor document library
**Impact:** high · **Effort:** medium · **Revenue:** Indirect — cited gear-manual answers are the moat that makes Ask GG THE outdoor engine rather than generic ChatGPT

The pipeline is already a generic document-RAG in everything but name: ReloadingManual/ReloadingManualPage (prisma schema ~line 2540) with tsvector FTS managed in onModuleInit, pdf-lib page slicing returned as native PDF blocks, an OCR backfill script, admin ingest inbox, and citation chips on the frontend. Add a domain column (reloading | gear | regs | safety), let the admin upload flow set it, and either parameterise the existing search/fetch tools by domain or clone a searchOutdoorDocs/fetchDocPages pair with a prompt lane. Then gear manuals (Engel/National Luna fridges, tents, winches, GPS/fish-finders, reels, bows) and regs/safety docs ride the proven rails, giving cited answers ("Per the Engel MT45 manual, p.12") — the exact differentiation that made the reloading answers trustworthy.

**Critic verdicts:**
- *feasibility:* **SOUND** — Adding a domain column to ReloadingManual is an additive migration (allowed); parameterising the existing search/fetch tools by domain rides proven rails. Rename-in-place of the model isn't needed — keep the table, tag rows.
- *compliance:* **NEEDS-CHANGE** — Government regs/safety docs are fine, but serving page-slices of manufacturer gear manuals (Engel, Garmin, etc.) is redistribution under the Copyright Act. Confirm manuals are freely-distributed support material or get permission; otherwise limit to short cited extracts. Same review should retroactively cover the reloading manuals already served.
- *business:* **NEEDS-CHANGE** — The domain column + prompt lane is small and worth doing. But scope the ingestion promise: regs/safety docs first (pairs with the fishing-regs finding); a comprehensive gear-manual library is an unbounded content treadmill for a solo operator. Ingest gear manuals opportunistically, never as a committed backlog.

### askgg-engine-10 · Expand the web-search allowlist per topic (fishing/4x4/camping forums)
**Impact:** medium · **Effort:** small · **Revenue:** Direct-ish — strengthens the GG+ Member/Pro web-search upsell across all new verticals

WEB_SEARCH_TOOL uses one hardcoded 25-domain reloading list (ask-gg-claude.service.ts:257-300). Extend it (or make it topic-bundled) with SA community sources: sealine.co.za (fishing), 4x4community.co.za (overlanding/recovery), plus maker sites (Engel, Front Runner, Shimano, Daiwa) — keeping the existing lesson that crawler-blocked domains (reddit) 400 the whole request, and the ≤~30-domain guidance. The system prompt's "published data authoritative, forums anecdotal" pattern generalises directly: forum sentiment for gear reliability ("do NL fridges outlast Engels?") is the same MEMBER/PRO deep-path upsell that already exists for reloading.

### askgg-engine-11 · Add a wilderness first-aid/field-safety lane with hard medical boundaries
**Impact:** medium · **Effort:** small · **Revenue:** none/indirect — trust and retention

The prompt currently defers ALL health topics to "a real professional", so snakebite, heat exhaustion, and hypothermia questions — core outdoor safety — get declined. Add a prompt section permitting general, widely-published field-safety information (snakebite do/don'ts, heat/cold injury recognition, river-crossing/recovery safety) always paired with SA emergency numbers (10177/112) and a "get certified training, this is not medical advice" overlay, while keeping diagnosis/dosage/treatment specifics off-limits. Optionally ingest a reputable SA wilderness-first-aid reference into the domain-tagged RAG for cited answers. Cheap, high-trust content that positions Ask GG as the companion you consult before and during a trip.

### askgg-engine-12 · Archery/bowhunting and 4x4/recovery: scope now, calculators later
**Impact:** medium · **Effort:** small · **Revenue:** Indirect — covers the remaining marketplace categories (archery gear, 4x4/recovery kit) so chat can cross-sell them

Neither vertical has any tool or data; the ballistics service is G1 bullet-drag only, so arrow trajectories are out of scope for the current engine. Phase 1 (small): include archery/bowhunting (draw-weight legal minimums per province for bowhunting, broadhead selection, bow setup) and 4x4/recovery (tyre pressures, recovery-gear ratings, winch safety) in the widened prompt scope, answering from general knowledge with the conservative verify framing. Phase 2 (optional, large): an arrow-ballistics calculator could reuse the calculateBallistics seam with a drag model swap, and provincial bowhunting regs belong in the regs RAG alongside fishing. Don't block the scope widening on the calculators.

### askgg-engine-13 · Seed the KB with outdoor content and surface category filters
**Impact:** medium · **Effort:** small · **Revenue:** Indirect — KB hits cost R0 per answer, protecting margin as free outdoor traffic scales

AskGgKbEntry is already topic-agnostic (title/question/answer/category/tags with weighted FTS), but because entries only spawn from resolved conversations and conversations are firearms-gated, the KB will stay firearms-only until scope widens — and even then it starts empty for outdoor topics. Have the operator (or a one-off Claude batch) seed 30-50 verified entries for the highest-frequency outdoor questions (bag limits, tent/fridge/sleeping-bag selection, licence basics) so the zero-cost KB deflection works for the new audience from day one, and add the existing category field as filter chips on the KB search cards. Pure content + minor UI; the whole verified-expert badge pipeline then extends to fishing/camping experts automatically.

### askgg-engine-14 · Revisit the FREE quota (5 msgs/30 days) for the acquisition play
**Impact:** medium · **Effort:** small · **Revenue:** Direct — bigger free funnel into GG+ Member/Pro conversion, at controlled marginal cost

The quota (backend/src/ask-gg/ask-gg-quota.service.ts: FREE 5/30d, hardcoded pending the planned SettingsService.FLAGS move) was sized for an expensive reloading-tool assistant. As "the outdoor AI engine" becomes the acquisition hook for fishing/camping audiences, 5 messages a month is a hard ceiling on habit formation. Options that keep cost bounded: raise FREE for KB-answered/non-tool turns (KB deflection is free; plain Sonnet turns without web search or PDF fetches are cents), or a Haiku-powered FREE lane for general outdoor Q&A with tools reserved for paid tiers. Finish the planned move of caps into operator-tunable settings first so this can be A/B'd without deploys.

## B. Category taxonomy

**Auditor summary:** The taxonomy is a 2-level tree (14 parents, 115 children, 129 total) defined in backend/prisma/seed.ts and stored in a minimal Category model (schema.prisma:522) that carries compliance flags (isFirearm, requiresLicence, availableSecondhand, availableNewStore, crossSellEligible) but zero support for category-specific attributes — the only item metadata anywhere is the global make/model/calibre/condition on Listing. Roughly 60% of the tree is shooting-sports; camping and fishing exist but are shallow, and overlanding, archery, hunting (as a parent), outdoor clothing/footwear, boats/trailers, GPS/comms/drones, and dog gear are entirely absent. Browse/filter is a flat category dropdown + brand/province/condition/price; Meilisearch is only engaged when a text query is present, has filterable attributes configured but no facet counts (facetDistribution is never called), and parent categories return zero listings because filtering matches the exact category with no descendant rollup. Firearm gating is keyed off Category.isFirearm snapshotted onto Listing.isFirearm at create time — solid at create, but the listing-update path accepts a categoryId change without re-deriving the flag (a compliance bypass), and admin-created subcategories do not inherit the parent's firearm flags. Building the target catalogue requires three foundations before adding categories: a per-category attribute/filter system, descendant rollup in browse, and a non-courier shipping option for bulky goods (rooftop tents, boats, trailers can't list today because non-firearm listings require parcel dims + PUDO/TCG).


### taxonomy-1 · Reference: current category tree verbatim (14 parents / 115 subs, depth 2)
**Impact:** medium · **Effort:** small · **Revenue:** none/indirect — baseline for all catalogue work

Source backend/prisma/seed.ts (canonical — the seed force-deactivates any row not in it; live prod could have admin-added rows via /admin/categories but a prod DB read was denied by session policy, so verify with one SELECT before planning). Tree (parent(childCount): children): Air Rifles(6): Air Pistols, Air Rifle Pellets, Air Rifle Traps & Accessories, Air Rifles Springer, Air Rifles PCP, Airsoft · Ammo(0) [isActive:false — fully disabled] · Cleaning Equipment(5): Solvents, Sundry Equipment, Jags & Rods, Jags Mops & Brushes, Cleaning Kits · Firearms(10) [isFirearm+requiresLicence, inherited by children]: Pistols, Centerfire Rifles, Semi-Automatic Rifles, Double Rifles, Bespoke Rifles, Revolvers, Rimfire Rifles, Over & Under Shotguns, Semi-Automatic Shotguns, Pump Action Shotguns · Gun Smithing & Parts(11): Actions, Barrels [licenced:true], Rifle Parts & Screws, Rifle Stocks, Rifle Tools, Silencers, Triggers, Men's Hunting Pants & Shorts [misfiled], AR Accessories, AR Magazines, Pistol Magazines · Optics(16): Rifle Scopes, Binoculars, Rangefinders, Optical Cleaning Equipment, Night Vision, Spotting Scopes, Optical Tripods & Window Mounts, Scope Mounts, Air Rifle Scopes, Handgun Scopes, Trail Cameras, Rimfire Rifle Scopes, Rangefinder Binoculars, Rangefinding Rifle Scopes, Previously Owned Optics, Optical Accessories · Reloading Components(4): Rifle Bullets, Rifle Brass Cases, Handgun Bullets, Handgun Brass Cases · Shooting Accessories(16): Ammo Boxes & Storage Cases, Ballistic Software, Bore Sighters, Calling Equipment, Chronographs, Protection, Holster, Rest Bipods & Shooting Sticks, Rest X-Bags & Rear Bags, Rifle Bags, Rifle Safes, Rifle Slings & Straps, Targets & Stands, Windmeters, Weapons Mounted Lights, Ammo Pouch · Fishing(11): Reels, Rods, Lures, Carp Baits, Lines, Terminal Tackle, Fishing Apparel, Fishing Footwear, Fishing Accessories, Fishing By Technique, Fishing Headwear · Camping & Outdoor(6): Lights, Camping & Outdoor Accessories, Sleeping Bags Mattresses & Stretchers, Camping Furniture, Kids Camping, Outdoor Gear · Knives(13): Custom Knives, Tactical Knives, Hunting Knives, Pocket Knives, Multitools, Knife Sets, Knife Sharpeners & Sundries, Axes, Biltong Cutters, Kitchen Knives, Knife & Multitool Pouches, Fishing Knives, Accessories Knives · Self Defence(5): Pepper Sprays, Launchers, Body Armour & Plate Carriers, Stun Guns & Batons, Projectiles and Accessories · Paintball(6): Paintball Accessories, Paintball Masks, Paintball Markers, Paintball Barrels, Paintball Ammo, Paintball Hoppers & Accessories · Reloading Equipment(6): Reloading Dies, Reloading Scales, Measures, Reloading Presses, Reloading Kits, Reloading Sundry Equipment. Schema supports arbitrary depth via parentId but seed, CategoryPicker and category pages all assume exactly 2 levels.

### taxonomy-2 · Build a per-category attribute system (schema + sell form + filters + search) — the single biggest blocker to the target catalogue
**Impact:** critical · **Effort:** large · **Revenue:** Direct — clothing/overlanding/fishing categories are unshoppable without size/spec filters; attribute filters are the difference between a classifieds dump and a catalogue buyers convert on

Today the ONLY item attributes are global Listing fields: make/model/calibre/condition/province plus parcel dims (backend/prisma/schema.prisma:595-660); there is no way to express clothing size, tent sleeps-N, rod class, fridge litres or boot size, and the Sell form no longer even collects make/model/calibre directly (AI extracts them — frontend/app/listings/new/page.tsx:1461). Recommended spec: (1) Schema — new model CategoryAttribute {id, categoryId, key, label, type TEXT|NUMBER|SELECT|MULTI_SELECT|BOOLEAN, unit, options String[], required, filterable, sortOrder} with parent-level attributes applying to descendants, plus a Listing.attributes Json column (JSONB, GIN-indexable) validated server-side in ListingsService.create/update against the category's definitions — JSONB avoids EAV join pain and flattens cleanly into Meilisearch docs. (2) Sell form — after CategoryPicker selection, fetch GET /categories/:id/attributes and render dynamic fields (frontend/components/category-picker.tsx already returns the leaf id). (3) Filters — FilterBar (frontend/components/filter-bar.tsx) and /category/[slug] render the active category's filterable attributes; backend browse adds an attrs param mapped to JSONB containment (Prisma path) and attr_<key> filters (Meili path). (4) Search — flatten attributes as attr_<key> into the index doc (listings.service.ts:1278 indexListing) and append them to updateFilterableAttributes (search.service.ts:43); note Meili requires a settings update + reindex when new filterable keys are added, so ensureIndexes should derive the list from CategoryAttribute rows at boot. (5) Admin — attribute CRUD tab in the existing /admin/categories tree (frontend/app/admin/(protected)/categories/categories-tree.tsx). Migrate calibre into this system later; its normaliser already exists (calibreKey/extractCalibre in listings.service.ts:707-723).

**Critic verdicts:**
- *feasibility:* **SOUND** — Verified only global make/model/calibre/condition fields on Listing. New CategoryAttribute model + Listing.attributes Json are both additive migrations. JSONB-over-EAV is right for this stack. The finding already flags the one real trap (Meili filterable-settings update + reindex when attr_ keys change; derive from CategoryAttribute rows at boot). Large but correctly specced.
- *compliance:* **SOUND** — Pure catalogue infrastructure, no regulatory surface. Positive side-effect: structured attributes make future compliance flags (Wh rating, gas test date, TOPS species) enforceable server-side instead of by copy.
- *business:* **SOUND** — Correctly identified as the backbone; the JSONB-not-EAV spec is right and the Meili reindex gotcha is a real catch. Sequencing: after the gating/revenue fixes, and start with 5-10 flagship attributes per new vertical (fridge litres, rod class, size) rather than full coverage — filters on an empty catalogue add nothing.

### taxonomy-3 · Close three firearm-gating holes before adding any new categories
**Impact:** critical · **Effort:** small · **Revenue:** none/indirect — FCA compliance failure is an existential platform risk

Gating chain: Category.isFirearm → snapshotted to Listing.isFirearm at create (listings.service.ts:461) → every downstream money/shipping/swap/SAP534 flow keys off the listing snapshot (transactions.service.ts:169,352,2514; swaps/swap-proposals.service.ts:111-130; shipping.service.ts:129; dealer-verification.service.ts:162). Hole 1 (worst): UpdateListingDto = PartialType(CreateListingDto) so PATCH /listings/:id accepts categoryId, and update() spreads ...dto into prisma.listing.update without re-deriving isFirearm, without checking the new category exists/isActive, and without the serial/licence vision checks (listings.service.ts:987-1040) — a seller can create in a benign category then edit into Firearms>Pistols and the listing remains isFirearm=false: courier-shippable, no dealer transfer, no 18+ attestation, no SAP534. Fix: strip categoryId from the update path or re-run the full category derivation + firearm checks when it changes. Hole 2: admin create of a subcategory does NOT inherit parent flags — isFirearm defaults false (admin-categories.service.ts:78) and the admin form also defaults false (categories-tree.tsx:261), so a new child added under Firearms silently bypasses all gates unless the operator remembers the toggle; enforce inheritance server-side (child of an isFirearm parent must be isFirearm). Hole 3: availableSecondhand is enforced only client-side in CategoryPicker (category-picker.tsx:38-40); ListingsService.create checks only isActive (listings.service.ts:255) — harmless today because Ammo is also isActive:false, but fragile the moment a category uses the flag alone. Conversely note the safe default: none of the planned new categories (camping, fishing, etc.) can accidentally TRIGGER firearm rules since flags default false — the risk is entirely in the bypass direction.

**Critic verdicts:**
- *feasibility:* **SOUND** — All three holes CONFIRMED in code: (1) UpdateListingDto = PartialType(CreateListingDto) and update() spreads ...dto into prisma.listing.update (listings.service.ts:1024-1027) with no isFirearm re-derivation or category existence check — the category-swap bypass is real; (2) admin-categories.service.ts:78 defaults isFirearm:false with no parent inheritance (the seed inherits, the admin path does not); (3) create() checks only isActive (line 255), availableSecondhand is client-side only. Highest-priority fix in the audit; all three are small server-side patches.
- *compliance:* **SOUND** — Endorse as the single highest compliance priority on the list. Hole 1 is a live FCA violation vector today (a firearm listing edited into a benign category ships by courier with no dealer transfer, no 18+ attestation, no SAP-534). This must land BEFORE any taxonomy expansion, new shipping methods, or vision-prompt broadening — several other findings depend on it.
- *business:* **SOUND** — Build first, full stop. The PATCH-categoryId bypass is an FCA compliance hole on a live firearms marketplace — existential risk, small fix, and it hard-blocks any taxonomy expansion (every new category multiplies the edit-into/out-of-firearms surface).

### taxonomy-4 · Fix parent-category rollup: parent pages and parent filter selections return zero listings
**Impact:** high · **Effort:** small · **Revenue:** Direct — parent-level browsing is the main entry path for casual buyers; today it dead-ends at empty pages

Both browse paths match the exact category only — browseViaPrisma does where.category={slug} / where.categoryId (listings.service.ts:887-888) and the Meili path filters categorySlug = "x" (listings.service.ts:799-800) — while the Sell form forces leaf selection, so listings never sit on a parent. Result: every /category/firearms-style parent landing page (frontend/app/category/[slug]/page.tsx) shows 0 items (its own empty-state copy admits it: 'No listings directly in this category yet — try a subcategory above'), and picking a parent like Fishing in the homepage FilterBar dropdown shows nothing. Fix is small at depth 2: resolve the category, filter categoryId IN (self + children) on the Prisma path, and index a parentSlug (or categoryPath array) field in the Meili doc so the search path can OR them. Also worth fixing in the same pass: the FilterBar dropdown renders all 129 categories flat, ordered by sortOrder-then-name ACROSS parents and children (categories.service.ts findAll), so the list interleaves unrelated parents and subs with no hierarchy cue — group children under indented parent optgroups.

**Critic verdicts:**
- *feasibility:* **SOUND** — Verified exact-match-only on both paths (categoryId/categorySlug at listings.service.ts:799-800 and 887-888). Fix as stated works at the current 2-level depth: categoryId IN (self+children) on Prisma, plus a parentSlug field in the Meili doc — note that requires adding it to filterableAttributes + reindexing existing docs.
- *compliance:* **SOUND** — Browse/UX fix only; no compliance angle.
- *business:* **SOUND** — Small fix, big payoff: parent pages are the natural casual-buyer entry and currently dead-end at zero results. Do it in the same sprint as the homepage tile grid so the newly linked pages actually show stock. Include the flat-129-category dropdown fix.

### taxonomy-5 · Add an Overlanding parent tree — the highest-value missing SA segment — plus the bulky-goods shipping method it depends on
**Impact:** high · **Effort:** medium · **Revenue:** Direct — overlanding gear is high-ticket (R10k-R150k items) with an extremely active SA secondhand scene currently on Facebook groups

Zero overlanding coverage today. Proposed parent Overlanding & 4x4 with children: Rooftop Tents, Awnings & Side Rooms, 12V Fridges & Freezers, Dual-Battery & Solar Power, Recovery Gear (straps/winches/traction boards/hi-lift), Camp Trailers & Teardrops, Water & Fuel Storage, Vehicle Storage & Drawer Systems, Roof Racks & Load Bars, Camp Kitchens. Hard dependency: non-firearm listings currently REQUIRE parcel weight/dims for courier quoting and shippingMethods ⊂ {PUDO, TCG} (schema.prisma:650-659, create-listing.dto.ts:107-118); Pudo's biggest locker is 60×41×69cm/20kg — a 60kg rooftop tent or a trailer cannot list. Needs a COLLECTION/PRIVATE_ARRANGE-style ShippingMethod legal for non-firearm categories (enum + validation in listings.service.ts + checkout), ideally gated by a per-category 'bulky' flag so ordinary parcels still get couriered. Attribute needs: fridge litres, tent sleeps-N, battery Ah, trailer braked/unbraked.

**Critic verdicts:**
- *feasibility:* **SOUND** — Dependency correctly identified: validateShipping (transactions.service.ts:2673-2684) hard-limits non-firearms to PUDO/TCG and parcel dims are required. Adding a COLLECTION enum value is an additive Prisma enum migration; the work fans out to validateShipping, the sell-form DTO, checkout quoting (skip courier fee), and a release trigger that can't be courier-delivery-driven — the firearm PRIVATE_ARRANGE completion flow is the pattern to clone. Medium is fair.
- *compliance:* **NEEDS-CHANGE** — The new COLLECTION/collection-only ShippingMethod must be excluded server-side for isFirearm listings (in listing validation AND transactions validateShipping) so it can never become a dealer-transfer bypass — and it must ship after the firearm-gating-holes fix, since a category-swap hole plus a collection-only method compounds the FCA exposure. Gas cylinders and large lithium batteries in this tree also need the DG policies (separate findings) live first.
- *business:* **SOUND** — Right vertical (high-ticket, hyperactive SA secondhand scene, currently all on Facebook). The collection-only/bulky shipping mode is the shared dependency across five findings — build it once, generically, and this tree unlocks. Fold the tree itself into the single consolidated taxonomy migration.

### taxonomy-6 · Create a Hunting parent category and fix the misfiled clothing item
**Impact:** high · **Effort:** medium · **Revenue:** Direct — hunting packages are a new commission line, not just gear resale

There is no Hunting parent — hunting content is scattered (Hunting Knives under Knives, Calling Equipment under Shooting Accessories, Trail Cameras under Optics) and 'Men's Hunting Pants & Shorts' is an outright seed bug sitting under Gun Smithing & Parts (seed.ts:111). Proposed Hunting tree: Blinds & Hides, Game Feeders & Attractants, Tree Stands & Tripods, Game Handling & Butchery (carcass bags, gambrels, mincers, biltong makers), Hunting Packs & Bags, Scent & Camo, Taxidermy & Trophies, Hunting Packages & Experiences. Note the operator explicitly wants hunting packages/experiences: those are service listings with no parcel, no condition, no courier — they need either a category flag exempting them from parcel-dims/shipping validation (same seam as the bulky-goods fix) or a lightweight new listing mode; without that they cannot be listed at all today.

**Critic verdicts:**
- *feasibility:* **SOUND** — Seed bug confirmed: "Men's Hunting Pants & Shorts" sits in the gun-smithing-parts block (seed.ts). Category work is admin/seed-level. The packages/experiences caveat is correct — they cannot list today (parcel dims + PUDO/TCG required) and need the same exemption seam as bulky goods or the full experience engine.
- *compliance:* **NEEDS-CHANGE** — Two gates: (1) keep 'Hunting Packages & Experiences' isActive:false until the experiences compliance framework ships (outfitter vetting, CPA intermediary disclosures, s17 cancellation) — a bare category invites unvetted service listings the platform can't currently even fulfil; (2) 'Taxidermy & Trophies' needs a TOPS/NEMBA policy before activation: trophies of listed species require permits, rhino horn and ivory are prohibited outright — add a prohibited/permit-required species blocklist to listing moderation.
- *business:* **NEEDS-CHANGE** — Do the gear tree and the seed-bug fix now (in the consolidated taxonomy pass). But hold the 'Hunting Packages & Experiences' child until a listable experience mode exists — a category no one can list into is pure confusion and the finding itself admits they cannot be listed today.

### taxonomy-7 · Deepen Fishing with discipline-level structure, craft and electronics
**Impact:** high · **Effort:** small · **Revenue:** Direct — fishing is the largest SA outdoor participation sport; discipline browsing is how anglers shop

Fishing's 11 children are gear-type-only (Reels, Rods, Lures, Carp Baits, Lines, Terminal Tackle, Apparel, Footwear, Accessories, Headwear) plus a 'Fishing By Technique' leaf that has no children and no meaning. Target requires the discipline axis — Rock & Surf, Freshwater/Bass/Carp, Fly Fishing, Offshore/Deep Sea, Kayak & Float Tube — plus missing hardware children: Fish Finders & Marine Electronics, Fishing Kayaks & Craft (bulky-shipping dependency again), Nets & Gaffs, Bait & Tackle Storage. Discipline is arguably better modelled as a filterable attribute (a 9ft fly rod is one discipline, a Shimano 4000 reel spans several) than as more tree depth — which is exactly what the attribute system enables; rod class/length/pieces, reel size and line class are the flagship attribute examples.

**Critic verdicts:**
- *feasibility:* **SOUND** — Discipline-as-filterable-attribute (not deeper tree) is the right call for this stack and depends on the attribute system finding. Rest is seed/admin work. No conflicts.
- *compliance:* **SOUND** — Taxonomy work, no regulatory surface.
- *business:* **SOUND** — Small and correct, including its own best insight: discipline belongs as a filterable attribute, not tree depth. Merge with the fishing-clothing discipline-tree finding into one fishing taxonomy spec — they're the same work item.

### taxonomy-8 · Add Archery & Bowhunting parent (entirely missing)
**Impact:** medium · **Effort:** small · **Revenue:** Direct — bowhunting is a fast-growing SA segment with expensive, frequently-traded kit

No archery coverage anywhere in the tree. Proposed children: Compound Bows, Recurve & Traditional Bows, Crossbows, Arrows & Bolts, Broadheads & Points, Releases & Tabs, Sights Rests & Stabilisers, Bow Cases & Storage, Archery Targets & Butts. No firearm-law implications — bows/crossbows are not FCA-controlled items in SA, so plain categories with default flags are correct; do NOT set isFirearm. Attribute needs: draw weight, draw length, axle-to-axle, arrow spine.

### taxonomy-9 · Add Outdoor Clothing & Footwear parent — blocked on the attribute system for size
**Impact:** medium · **Effort:** medium · **Revenue:** Direct — clothing is the highest-frequency repeat-purchase category and pulls a broader (incl. female) buyer demographic

No general clothing/footwear tree exists; only Fishing Apparel/Footwear/Headwear plus the misfiled hunting pants. Proposed parent with children: Jackets & Fleece, Shirts & Trousers, Hunting Camo, Boots & Trail Shoes, Socks & Baselayers, Hats & Gloves, Kids Outdoor Clothing, Wet Weather Gear. Ship this only AFTER (or together with) the attribute system: secondhand clothing without size/gender/fit filters produces an unusable browse and heavy returns/disputes — size (EU/UK/SA), gender and fit are required+filterable attributes, boot size numeric. Condition enum (NEW/LIKE_NEW/GOOD/FAIR/POOR, schema.prisma:67) works fine for apparel.

### taxonomy-10 · Extend Optics into GPS, comms, drones and thermal — with SA-legal flags per category
**Impact:** medium · **Effort:** small · **Revenue:** Direct — thermal/NV units are R20k-R100k items with strong resale churn

Optics is strong (16 children incl. Night Vision, Trail Cameras) but the electronics half is missing: add GPS & Navigation, Two-Way Radios & Comms, Drones & Aerial, Thermal Imaging (split from Night Vision — thermal is the hot SA hunting item), Action & Dash Cameras, Power Banks & Batteries, Dog Tracking Collars (or place under dog gear). SA legalities to encode, using the existing per-category flag pattern (Ammo precedent: isActive:false blocks listing): radios — PMR446/CB are licence-free but VHF/UHF amateur and commercial sets need ICASA licences; sale is legal so allow the category but add a listing-page compliance note rather than a block. Drones — sale is legal (SACAA rules govern operation, not resale); allow. Night vision/thermal — legal to buy/sell nationally; hunting-use restrictions are provincial ordinance matters, again a copy note not a gate. None of these should touch isFirearm/requiresLicence; the schema needs no change, but a per-category 'complianceNote' text field would let admin attach such notices data-driven instead of hardcoding.

### taxonomy-11 · Boats, Watercraft & Trailers parent — plan alongside the bulky-goods shipping method
**Impact:** medium · **Effort:** medium · **Revenue:** Direct — highest average ticket size of any proposed category; even low volume moves GMV materially

Entirely missing. Proposed children: Fishing Boats & Bass Boats, Inflatables & Rubber Ducks, Kayaks & Canoes, Outboard Motors, Boat Trailers, Utility & Camping Trailers, Marine Electronics, Boat Accessories & Safety. Every item here fails the current non-firearm listing validation (parcel dims + PUDO/TCG required — listings.service.ts create path), so this category is a hard no-go until the COLLECTION/private-arrange shipping method for non-firearms exists (shared dependency with Overlanding). Trailers also carry NATIS registration papers — worth a compliance-note field reminding buyers to check registration transfer, similar in spirit to the SAP534 flow but purely informational.

### taxonomy-12 · Deepen Camping & Outdoor — there is no Tents subcategory at all
**Impact:** medium · **Effort:** small · **Revenue:** Direct — tents/coolers are the entry-point purchases that seed first-time buyer accounts

Camping & Outdoor has 6 vague children (Lights, Accessories, Sleeping Bags/Mattresses/Stretchers, Camping Furniture, Kids Camping, Outdoor Gear) — 'Outdoor Gear' and 'Accessories' are catch-alls that tell buyers nothing. Most glaring: no Tents & Shelters category on an outdoor marketplace. Add: Tents & Shelters, Gazebos & Tarps, Camp Cooking & Stoves (gas), Coolers & Cooler Boxes, Water Storage & Filtration, Camp Power & Lighting (merge Lights), Backpacks & Daypacks, Camp Hygiene & Showers. Attribute needs: tent sleeps-N, seasons rating, cooler litres. Pure seed/admin data work — no code change needed given the tree already supports it.

### taxonomy-13 · Add Working Dogs & Field Gear category
**Impact:** low · **Effort:** small · **Revenue:** Direct but niche — loyal, repeat-purchase audience adjacent to the existing hunting user base

Zero coverage for the hunting/working-dog segment named in the target catalogue. Proposed children (small parent, can sit under Hunting or standalone): GPS Tracking & E-Collars, Kennels & Crates, Dog Training Gear (dummies, launchers, whistles), Dog Field Protection (vests, boots), Travel & Vehicle Gear, Feeding & Water. No legal flags needed; e-collar/GPS units overlap with the comms/electronics attribute work (frequency/licence note for some tracking systems).

### taxonomy-14 · Turn on real Meilisearch faceting — the plumbing exists but is unused
**Impact:** medium · **Effort:** medium · **Revenue:** Indirect — facet counts measurably lift filter engagement and reduce zero-result dead ends

Filterable attributes are configured (categoryId, categorySlug, status, listingType, condition, province, sellerId, priceRange, make — search.service.ts:43-53) but no code anywhere requests facets/facetDistribution, so filter dropdowns never show counts and can't hide empty options; the brand list is a global Prisma groupBy over ALL listings (listings.service.ts:551) that ignores the active category (browse Fishing, see Glock in the brand dropdown). Meilisearch is also only used when a text query is present (browse() dispatch, listings.service.ts:540-543) — pure filter browsing goes via Prisma, so facet counts would need the Meili path extended to filter-only queries (empty q is fine in Meili). The indexed priceRange bucket field is dead code — indexed, never queried. Recommended: route all browse through Meili when connected, request facets=[condition, province, make, categorySlug, attr_*] and render counts in FilterBar; this is also the delivery vehicle for attribute filters (finding 2).

### taxonomy-15 · Surface category navigation — landing pages are SEO orphans
**Impact:** medium · **Effort:** small · **Revenue:** Indirect — category pages are the SEO landing surface for the outdoor-marketplace repositioning

/category/[slug] pages (frontend/app/category/[slug]/page.tsx) have proper metadata, breadcrumbs and subcategory drill-down pills, and are emitted in the sitemap (app/sitemap.ts:59), but nothing in the site nav, homepage, or Shop sheet links to them — the only in-product category entry is the flat FilterBar dropdown that filters via /?categoryId=. Buyers coming from Google land on nice category pages; buyers already on the site can't find them. Add a category mega-menu/section grid (14 parents with images) to the homepage and nav drawer, linking to /category/<slug>; after the rollup fix (finding 4) these pages become genuinely useful hubs and the natural home for per-category attribute filters.

## C. Finance model

**Auditor summary:** Gun Galore currently has only THREE revenue streams actually collecting money: (1) tiered sale commission — marginal bands 9% on the first R5,000 / 7% to R20,000 / 5% to R100,000 / 3% above, with a R30 minimum and a locked 0.5%-of-price Top Seller discount (C:\dev\gun-galore\backend\src\payments\fee.calculator.ts:11-21, applied at checkout in transactions.service.ts:252-265, deducted from the FNB payout); (2) a 1.5% manual-EFT processing fee on price+shipping (fee.calculator.ts:38, seller-absorbed by default since Listing.passFeeToBuyer defaults false); and (3) flat SWOP fees — R50 per courier leg / R100 per firearm leg, both parties (fee.calculator.ts:49-52, charged in swap-funding.service.ts ensureFundingSetUp). Everything else is built but earns R0: featured-slot bidding (T1 R100/1d…T5 R500/14d) is hard-disabled in production pending a payment integration, MEMBER/PRO subscriptions have no price and no purchase flow ("Launching soon"), paid raffle tickets dead-end on the dormant Stitch gateway, the cross-sell engine has no monetisation, and the standalone ballistics app's purchase flow lives in a separate server-only repo with zero billing integration in this codebase. Shipping is pure pass-through at carrier cost with no margin. The audit also found a likely-broken auction-winner checkout (auction commission uncollectable), a partial-refund path that records and notifies refunds that never move money on the manual rail, an uncapped swap cash top-up that lets any sale masquerade as a R50-flat swap to dodge commission, and refund batch rows that silently skip forever when buyers have no bank details on file.


### finance-1 · Fix the auction-winner checkout dead-end — auction commission is currently uncollectable
**Impact:** critical · **Effort:** medium · **Revenue:** Direct — entire AUCTION commission stream is currently zero; also a trust-killer for the format.

finalizeAuction (C:\dev\gun-galore\backend\src\auctions\auctions.service.ts:705-757) flips a won listing to PAYMENT_PENDING and SMSes the winner a CHECKOUT action-token, but the token redirects to /checkout/[listingId] which returns notFound() for status!==ACTIVE and listingType!==BUY_NOW (C:\dev\gun-galore\frontend\app\checkout\[listingId]\page.tsx:33-34), and the backend reserveAndCreateLine rejects the same two conditions (C:\dev\gun-galore\backend\src\payments\transactions.service.ts:156-163). No auction branch exists anywhere in the payments module and no sweep re-lists an unpaid PAYMENT_PENDING auction, so won auctions dead-end: no payment, no commission, item stuck. The AUCTION listing type is live on the public site, so every real auction with bids ends in a stuck sale.

**Critic verdicts:**
- *feasibility:* **SOUND** — CONFIRMED end-to-end: finalizeAuction flips to PAYMENT_PENDING (auctions.service.ts:736), checkout page notFound()s on status!==ACTIVE and type!==BUY_NOW (page.tsx:33-34), reserveAndCreateLine rejects both (transactions.service.ts:157-162), and no auction branch or unpaid-auction relist sweep exists anywhere in payments/tasks. Implementation note: the auction branch must bind winner (currentBidderId===buyer) at the agreed currentBid and skip the ACTIVE→PAYMENT_PENDING double-sell flip (listing is already PAYMENT_PENDING), plus honour the 24h expiresAt window with a relist/second-chance sweep. Medium is right.
- *compliance:* **SOUND** — Also a consumer-protection fix — winners are currently sold items they cannot pay for or receive. While in there, verify the T&Cs contain rules-of-auction consistent with CPA s45 (reserve, bid retraction, GG's role as auction venue).
- *business:* **NEEDS-CHANGE** — The fix is right and urgent; the sharper version adds a same-day stopgap: flag off new AUCTION creation immediately so no more sales strand while the payment branch is built, and include an unpaid-winner sweep (re-list or second-chance offer) or the fixed flow still leaks. Top-5 build-first.

### finance-2 · Launch MEMBER/PRO billing on the existing manual-EFT rail
**Impact:** critical · **Effort:** medium · **Revenue:** Direct — first recurring-revenue stream; converts the two flagship AI/ballistics features from pure cost to MRR.

Every tier perk is built and gating users today — Ask GG caps (FREE 5/30d, MEMBER 20/h, PRO 60/h in ask-gg-quota.service.ts), Load Lab hard PRO-gate (load-lab.controller.ts:87-92), featured-slot discounts (25%/50%, featured.service.ts:32-36), subscriber raffles — but the pricing table literally says 'Launching soon' with no price and no purchase flow (frontend/app/ask-gg/page.tsx:2239-2242); tiers can only be set by admin. The reference-matched EFT reconciler (manual-payments.service.ts matchOrder) already supports exact-amount unique-reference matching, so a quarterly/annual EFT-paid subscription (e.g. reference SUB-xxxx) is a small extension — no card gateway needed. The Load Lab engine + 38k-load DB and Ask GG are sunk R&D with zero return until this ships.

**Critic verdicts:**
- *feasibility:* **SOUND** — Verified 'Launching soon' placeholders (ask-gg/page.tsx:2240-2241) and that all tier perks gate today. The reconciler fits, but note matchOrder currently only knows Transaction.orderReference and Order references — a SUB-xxxx lane needs a new matcher branch plus an additive SubscriptionPayment (or similar) model and an expiry/renewal cron. Small extension as claimed.
- *compliance:* **NEEDS-CHANGE** — Quarterly/annual consumer subscriptions are fixed-term agreements under CPA s14: the member may cancel on 20 business days' notice with only a reasonable cancellation penalty, and unused prepaid amounts must be refundable pro-rata. Bake the cancellation + pro-rata refund path and T&C wording in before launch (the manual rail makes the refund mechanics easy), and don't auto-renew without prior notice.
- *business:* **SOUND** — The clearest revenue-per-effort item in the audit: every perk is built and actively gating users, and the reconciler already does reference-matched exact-amount matching. Quarterly/annual terms keep solo-operator ops trivial. Top-5 build-first.

### finance-3 · Fix partial refunds on the manual rail — money is recorded and the buyer notified, but never paid
**Impact:** critical · **Effort:** medium · **Revenue:** Loss-prevention — double-refund/over-payout exposure plus CPA/complaint risk from phantom refund notices.

AdminService.refundTransaction (C:\dev\gun-galore\backend\src\admin\admin.service.ts:1109-1276) supports stacking partial refunds, increments refundedAmount, and fires refundIssuedBuyer for each partial — but stitch.refundPayment is a mock no-op in manual mode, and the FNB refund batch only selects paymentStatus='REFUNDED' rows and pays the FULL buyerTotal (manual-payments.service.ts:495-522, 572-590), ignoring refundedAmount entirely. A partial refund therefore moves no money on the manual rail while telling the buyer it did; and if the operator wires the partial manually, the eventual full-refund batch row (full buyerTotal) double-pays. Related: resolveDisputeRelease (admin.service.ts:1286+) releases the FULL sellerPayout even when refundedAmount>0, so GG can pay out more than it holds on one transaction.

**Critic verdicts:**
- *feasibility:* **SOUND** — CONFIRMED: stitch.refundPayment returns MOCK_REFUND when unconfigured (stitch.service.ts:329-333); refund batch selects only paymentStatus=REFUNDED and pays full buyerTotal (manual-payments.service.ts:495-590), ignoring refundedAmount; a partial leaves status HELD/DISPUTED so it never enters a batch; resolveDisputeRelease (admin.service.ts:1286+) releases full sellerPayout with no refundedAmount offset. Fix (partial-refund batch rows + refundedAmount-aware payout/refund amounts) is contained in manual-payments + admin service. Real money-integrity bug, correctly critical.
- *compliance:* **SOUND** — Urgent: telling a buyer a refund was issued when no money moves is CPA s41 misleading-conduct exposure plus double-payment risk, and the split-settlement capability is a hard dependency for CPA s17 cancellation penalties on experiences. Endorse.
- *business:* **SOUND** — Active loss exposure (manual wire + later full-batch row = double refund; dispute release ignoring refundedAmount = over-payout) plus CPA risk from phantom refund notices. Also the hard dependency for any future bookings/cancellation vertical. Top-5 build-first.

### finance-4 · Cap or fee-scale the swap cash top-up — it is an open commission-avoidance channel
**Impact:** high · **Effort:** small · **Revenue:** Direct leak — every structured swap-with-cash bypasses the commission engine while consuming GG's payment risk.

CreateSwapProposalDto.cashAmount has only @Min(0) — no ceiling and no relation to item value (C:\dev\gun-galore\backend\src\swaps\dto\create-swap-proposal.dto.ts:24-28), and breakdownSwapLeg charges only the flat R50/R100 leg fee regardless of cash size (fee.calculator.ts:186-211). Two users can list trinkets as SWOP and 'swap' with a R20,000 cash top-up: GG holds and settles R20k of fully-managed cash for R100 total fee, where the same sale via checkout would earn ~R1,500 commission. Fix: charge the standard commission bands (or a reduced swap rate) on cashAmount above a small threshold, or cap cashAmount at a percentage of the lower-valued item.

**Critic verdicts:**
- *feasibility:* **SOUND** — CONFIRMED: cashAmount has only @IsInt @Min(0) (create-swap-proposal.dto.ts:26-27) and swap legs charge only the flat R50/R100 fee. Commission-on-cash-above-threshold is a fee.calculator + breakdownSwapLeg change; a cap needs an item-value proxy (SWOP listings have no price — price is forbidden on SWOP), so the commission-band-on-cashAmount variant is the practical one.
- *compliance:* **SOUND** — Also compliance-positive: capping cash top-ups bounds the size of client funds GG holds per swap, which supports the platform's deliberate position outside regulated funds-holding territory.
- *business:* **SOUND** — Small, closes a structural leak before anyone discovers it, and the fix (commission bands on cashAmount above a threshold) is a fee-calculator change, not new infrastructure. Do it while swap volume is still low and no grandfathering headache exists.

### finance-5 · Wire featured-slot payment to the EFT rail instead of waiting for a card gateway
**Impact:** high · **Effort:** medium · **Revenue:** Direct — R100–R500 per slot-period across 10 slots is the highest-margin product on the platform (zero COGS).

The whole featured-slot auction machine (10 slots, T1 R100/1d → T5 R500/14d defaults in prisma FeaturedSlotConfig schema.prisma:2063-2100, bid floor R100, tier snapping, bind window, Zoho receipt) is live, but bindListingToSlot refuses in production because no real charge exists (featured.service.ts:523-538 — the AUDIT H1 block throws in NODE_ENV=production). Sellers can bid but never pay/bind, so the stream earns R0. The manual-EFT reference pattern (unique reference + exact amount + reconciler confirm) fits a featured-slot fee naturally; alternatively bill it against the seller's next payout as a deduction (funds already flowing through the FNB batch).

**Critic verdicts:**
- *feasibility:* **SOUND** — CONFIRMED the AUDIT H1 production throw (featured.service.ts:534-538). EFT reference pattern fits but needs a featured-slot lane in matchOrder plus bind-window handling (bid won → awaiting EFT → bind on match; window expiry refund path). The payout-deduction alternative is simpler but interacts with batch freeze logic — either is buildable. Medium is right.
- *compliance:* **SOUND** — GG's own fee revenue, not client funds — no new regulatory surface. If billed as a payout deduction, ensure it appears on the seller-facing invoice for VAT/Books accuracy.
- *business:* **NEEDS-CHANGE** — Unlocking a fully built zero-COGS product earning R0 is obviously right; the sharper version is the finding's own second option — bill the slot fee as a deduction from the seller's next FNB payout, which adds zero new reconciliation work for a solo operator, rather than minting a new EFT reference type per bid.

### finance-6 · Capture buyer bank details at refund time and surface skipped refund batch rows
**Impact:** high · **Effort:** small · **Revenue:** Indirect — unpaid refunds are a CPA/POPIA complaint and chargeback-to-reputation risk, not a revenue gain.

collectDue skips any refund row missing bankAccountHolder/Number/BranchCode with only a server log (manual-payments.service.ts:544-594). Buyers — unlike sellers, who get the ProfileCompletionModal — have no flow that captures banking, and no notification asks a refunded buyer to add bank details (grep of notifications.service.ts finds nothing). Result: most buyer refunds on the manual rail will sit silently un-payable forever. Add a 'we need your bank details' notification + a form on the transaction page when paymentStatus=REFUNDED and banking is missing, and raise an AdminAlert (not just a log line) for rows skipped in a batch.

**Critic verdicts:**
- *feasibility:* **SOUND** — CONFIRMED: collectDue skips bank-less rows with only a logger.warn (manual-payments.service.ts:592-596) and buyers have no banking-capture flow. Notification + form + AdminAlert are all existing patterns. Small.
- *compliance:* **SOUND** — Fixes an existing CPA problem (refunds owed but silently unpayable). POPIA guardrails: collect the minimum fields, state the purpose (refund payment only), protect like seller banking data, and apply a retention/deletion policy once the refund is paid.
- *business:* **SOUND** — Small fix for a silent-forever failure mode with CPA/POPIA complaint exposure. The AdminAlert-instead-of-log-line change is the important half — a solo operator only sees what surfaces.

### finance-7 · Make low-value outdoor items viable: per-seller shipping consolidation and a category-aware commission floor
**Impact:** high · **Effort:** large · **Revenue:** Direct volume unlock — the whole low-ticket outdoor/clothing segment is currently priced out.

The R30 minimum commission (fee.calculator.ts:21) is 30% of a R100 item and only falls below the 9% band above R333; on top, every cart LINE quotes and charges its own full courier fee even from one seller (createOrderCheckout → reserveAndCreateLine quotes per listing; order totals just sum lines in orders/order-math.ts) — three R150 clothing items from one seller cost three full Pudo/TCG fees (~R60-100 each). For the operator's stated expansion into camping/fishing/clothing this pricing makes sub-R300 items dead on arrival vs Facebook groups and Yaga. Recommend: one combined parcel quote per seller in carts (biggest win), and either a lower commission floor (e.g. R15) or a percentage-only floor for a 'soft goods' category class.

**Critic verdicts:**
- *feasibility:* **SOUND** — CONFIRMED: R30 MIN_COMMISSION_CENTS (fee.calculator.ts:21) and per-line shippingCost summed in order-math.ts:64 (each line quotes its own courier fee). Floor change is trivial; combined-parcel-per-seller is genuinely large — quoting needs aggregate parcel dims (heuristic packing), and the P5.2 booking/waybill flow is per-transaction, so one-waybill-per-seller-order restructures dispatch. 'Large' is honest.
- *compliance:* **SOUND** — Pricing/logistics work; no regulatory surface.
- *business:* **NEEDS-CHANGE** — Split it and merge the rest. The commission-floor change is a trivial fee-calculator tweak — do it whenever. Per-seller combined parcels belong in ONE shipping programme together with the Paxi and PAXI/Pargo findings (three agents proposed overlapping versions); sequence that programme when the apparel/low-ticket push actually starts, not before supply exists.

### finance-8 · Experience/package listings: the Order/Transaction rail fits, but four pieces must be built first
**Impact:** high · **Effort:** epic · **Revenue:** Direct — hunting packages/charters/range days are high-ticket (R5k-R50k) where the 7%/5% bands earn real money per booking.

Verdict: the architecture accommodates it — the swap module already proves the pattern (parent entity + synthetic child Transactions with own orderReference, exactly-once release guard, FNB batch settlement). Needed: (1) deposits/balance — the reconciler matches EXACT amount per unique reference (manual-payments.service.ts:118 mismatch→AMBIGUOUS), so model deposit and balance as two child Transactions each with its own reference under a Booking parent, never partial-pay one reference; (2) date inventory — Phase 8a quantity counters exist but have no date dimension; add an AvailabilitySlot model; (3) a non-courier fulfilment method (validateShipping in transactions.service.ts:2664-2693 only knows PUDO/TCG/DEALER_TRANSFER/PRIVATE_ARRANGE) and a release trigger keyed to event-date-passed + no-dispute (clone the swap 48h auto-release cron) instead of confirmDelivery; (4) CPA s17 cancellation — advance bookings may retain a reasonable cancellation penalty, which requires SPLIT settlement (part to seller, part refunded) on one booking; today release is all-of-sellerPayout and refund is all-of-buyerTotal, and the partial-refund rail is broken (see separate finding). Fix partial refunds first — they are a hard dependency.

**Critic verdicts:**
- *feasibility:* **SOUND** — The auditor's own feasibility analysis checks out against code: exact-amount AMBIGUOUS matching confirmed (manual-payments.service.ts:166), validateShipping's closed method list confirmed, swap parent+synthetic-child+auto-release pattern is real, and the partial-refund hard dependency is correctly identified. Two-references-for-deposit/balance is the right design for this reconciler.
- *compliance:* **NEEDS-CHANGE** — Do NOT model deposit AND balance as platform-held transactions: holding full booking values for months until an event date is exactly the drift toward Banks Act deposit-taking / regulated funds-holding the platform avoids (and it isn't a registered FSP). Adopt the deposit-only model from the hunting-packages stream — GG holds only the deposit (which is its commission), balance and per-animal fees flow direct to the operator. Keep held funds segregated and matched to the Client Funds Payable liability. The CPA s17 split-settlement point and the partial-refund dependency are correct — endorse those parts.
- *business:* **SOUND** — Sound as architecture analysis — the deposit/balance-as-two-transactions insight and the partial-refunds hard dependency are exactly right. But treat it as a roadmap document: the build itself is parked with the rest of the experiences vertical.

### finance-9 · Adopt the verified money map: commission + 1.5% EFT fee + swap leg fees are the only live streams
**Impact:** medium · **Effort:** small · **Revenue:** Baseline for every pricing decision; commission bands are competitive vs 5-15% marketplace norms (blended 7.5% at R20k, 5.5% at R100k) and seller-friendly on high-ticket firearms — keep them.

Live: (1) commission bands 9/7/5/3% marginal, R30 floor, TopSeller −0.5% of price (fee.calculator.ts:11-24, calculateCommission:82-109); (2) manual-EFT processing 1.5% of price+shipping (fee.calculator.ts:38,116-122; dormant paygate rate (3.5%+R1.50)×1.15 VAT); (3) SWOP R50/courier leg + R100/firearm leg, both parties, 1.5% absorbed by GG (fee.calculator.ts:49-52,186-211). Dead/dormant: featured slots (prod-disabled), MEMBER/PRO (no billing), raffle tickets (Stitch-dead in prod, dev-confirm 403s — raffles.controller.ts:159-165), cross-sell (recommendations + crossSellMiss demand capture only, no fees), ballistics app (separate repo, no billing integration here). Shipping is pass-through at carrier cost (cheapest-rate selection in pudo.service.ts/tcg.service.ts, no markup). Analytics 'revenue' counts only commissionZar on RELEASED (admin-analytics.service.ts:163), so the 1.5% fee and swap fees are invisible in the dashboard.

### finance-10 · Record swap fees and PRIVATE_ARRANGE commission as revenue in Zoho and analytics
**Impact:** medium · **Effort:** small · **Revenue:** Reporting integrity — money already earned, currently invisible.

Two earned streams never hit the books: (1) swap service fees (R50/R100 per leg) arrive in the bank inside the funding EFT but no Zoho entry exists anywhere in backend/src/swaps (grep 'zoho' = zero hits) and the synthetic swap transactions carry commissionZar=0 so analytics revenue misses them; (2) PRIVATE_ARRANGE sales DO deduct commission from sellerPayout via the normal breakdown, but createCommissionInvoice explicitly skips PRIVATE_ARRANGE (zoho-books.service.ts:407-415 'no commission invoice'), so that commission is bank-only income with no Books record. Both cause understated reported revenue and a growing bank-vs-Books reconciliation drift the accountant will eventually chase.

### finance-11 · Decide the paid-competitions rail: raffle ticket purchases dead-end in production
**Impact:** medium · **Effort:** medium · **Revenue:** Direct when used — GG keeps 100% of ticket revenue on its own competitions.

Admin-created raffles support paid tickets (ticketPriceCents ≥ R1, target count from item value, raffles.service.ts:159-183), but buyTickets routes through the dormant Stitch gateway; unconfigured Stitch returns a mock checkout with empty redirectUrl, the frontend then falls back to /raffles/tickets/dev-confirm (competitions/[id]/enter-panel.tsx:160-182) which throws 'disabled in production' (raffles.controller.ts:159-165). So any prod paid raffle is unbuyable; only the free subscriber-raffle perk works. Either wire ticket bundles to the EFT reference rail (each bundle gets an orderReference like everything else) or hide the paid-entry UI until the new paygate lands. Note SA Lotteries Act constraints already handled via the free postal-entry route.

### finance-12 · Add a small shipping handling margin or per-label fee — shipping is pure cost pass-through today
**Impact:** medium · **Effort:** small · **Revenue:** Direct — small per-order margin on every courier sale, funds the drift/cancellation losses currently eaten.

Quotes pick the CHEAPEST carrier rate and pass it to the buyer unmarked (pudo.service.ts:466-527, tcg.service.ts:186); GG then books on its own Pudo credits/TCG account at seller-accept (shipping.bookForTransaction). GG bears quote-vs-actual drift (wrong dims → carrier surcharge), cancellation costs on refunded orders (cancelForTransaction only works pre-collection), and the Pudo credit float — for zero margin. A flat R5-R10 'shipping handling' line or a 5% shipping margin is invisible at checkout and standard practice (Bob Shop, Yaga both mark up). The 1.5% EFT fee on shipping partially covers this but is absorbed into processing, not shipping risk.

### finance-13 · Add unpulled pricing levers: listing bumps, buyer protection fee, tiered swap fees, seller stores
**Impact:** medium · **Effort:** medium · **Revenue:** Direct — diversifies away from commission-only dependence on GMV.

Currently listing is free with no paid upgrades of any kind (grep confirms no listing-fee code). Cheap wins on the existing EFT rail or payout-deduction: (a) 'bump to top' / bold / gallery badges at R10-R50 (the featured-slot config pattern generalises); (b) a buyer-side 'Buyer Protection' fee (flat R10-R20 or 1-2%) — buyers currently pay only the 1.5% EFT fee while GG funds the entire held-payment/dispute apparatus, and every SA competitor charges one; (c) value-tiered swap fees (R50 flat undercharges a R30k rifle swap that consumes KYC ~R28×2 + dealer coordination + PoP vision costs); (d) seller subscription ('GG Store': lower commission floor + N free bumps + storefront) which pairs naturally with the MEMBER/PRO launch. Sequence after the featured/subscription payment rail exists since all reuse it.

### finance-14 · Give EXPIRED (paid-after-window) payments an in-system refund path
**Impact:** medium · **Effort:** small · **Revenue:** Loss-prevention/audit integrity — currently relies on operator memory for real received money.

When a buyer pays after the 24h window and the sweep already soft-cancelled the order, the reconciler marks the ManualPayment AMBIGUOUS/EXPIRED for admin ('Refund the buyer, or re-fulfil' — manual-payments.service.ts:317-325), but the transaction was never paid (paidAt null, no peachPaymentId), so admin refundTransaction rejects it (needs HELD/DISPUTED + payment id) and it can never enter the FNB refund batch (needs paymentStatus=REFUNDED). The operator must remember to make a fully out-of-band EFT with no system record. Add an admin action that creates a synthetic REFUNDED transaction for the received amount (the swap refundSide pattern at swap-funding.service.ts:686-743 is exactly this) so the money flows through the normal batch + audit trail.

### finance-15 · Stop charging the seller 1.5% on the buyer's shipping when the seller absorbs the fee
**Impact:** low · **Effort:** small · **Revenue:** Negligible direct; seller-trust polish ahead of category expansion.

breakdown() computes processingFee on (listingPrice + shippingCost) and, with the default passFeeToBuyer=false (schema.prisma:694), deducts the whole thing from sellerPayout (fee.calculator.ts:145-159) — so a seller absorbing the fee pays 1.5% of the buyer's courier charge, money that merely passes through GG to the carrier. Minor rand amounts, but it's the kind of line-item unfairness sellers notice and screenshot. Either charge the fee on the listing price only when seller-absorbed, or flip the default to passFeeToBuyer=true (buyer-side 1.5% on the full total is defensible as a payment-handling fee).

## D. Zoho Books accounting

**Auditor summary:** The Zoho Books integration (C:\dev\gun-galore\backend\src\zoho\zoho-books.service.ts) is well-engineered where it exists — OAuth refresh-token flow with in-memory caching and 401-retry, idempotent no-throw document creation, per-row sync status, feature-flag gating — but it covers only three of the eleven revenue streams: firearm commission invoices (dealer-verification APPROVED hook), raffle-ticket sales receipts, and featured-slot sales receipts. The single most serious gap: commission on ordinary non-firearm BUY_NOW/AUCTION/TAKE_A_SHOT sales — the platform's core revenue — never reaches Books, because createCommissionInvoice is called ONLY from the firearm dealer-verification hook (dealer-verification.service.ts:496) and never from confirmDelivery (transactions.service.ts:1912), so the payout-batch markCommissionInvoicePaid call silently no-ops for every courier sale. Swap fees, the 1.5% EFT pass-through, subscriptions, and the ballistics app have zero Books wiring; held buyer money is only represented in Books via the commission-slice drain of Client Funds Payable, so the CFP liability can never reconcile against the real held-funds position. There is no retry queue (fire-and-forget + manual per-transaction retry button only), no aggregate failed-sync surface, and VAT lines are deliberately skipped ('pre-VAT') with a flip-plan comment on only one of the four document builders.


### zoho-books-1 · Wire commission invoicing into the non-firearm release path (core revenue never reaches Books)
**Impact:** critical · **Effort:** small · **Revenue:** Books understates the flagship commission revenue stream for virtually all sales; bank deposits will not tie to any revenue document

createCommissionInvoice/markCommissionInvoicePaid are only called from the firearm dealer-verification APPROVED hook (backend/src/payments/dealer-verification.service.ts:496-497) and the manual admin retry button (backend/src/admin/admin.controller.ts:393-399). The main release path for all courier sales — confirmDelivery at backend/src/payments/transactions.service.ts:1912-1998 — and the admin force-release/dispute-release paths contain no Zoho call, and markPayoutBatchPaid (backend/src/manual-payments/manual-payments.service.ts:756-764) calls markCommissionInvoicePaid which silently returns when zohoCommissionInvoiceId is null (zoho-books.service.ts:530). Net effect: every non-firearm sale's commission is invisible to Books with no FAILED status and no alert. This also answers stream 10: the P8b Order model fans out to one-listing sub-Transactions ('all payout/Zoho logic per Transaction', schema.prisma:819/2863), so invoicing is per-Transaction by design — but non-firearm lines currently get nothing either way.

**Critic verdicts:**
- *feasibility:* **SOUND** — CONFIRMED: createCommissionInvoice called only from dealer-verification.service.ts:496 and admin retry (admin.controller.ts:396); zero zoho references in transactions.service.ts; markCommissionInvoicePaid silently returns when zohoCommissionInvoiceId is null (zoho-books.service.ts:530). Fix is adding the invoice call to confirmDelivery/force-release paths — the payout-batch mark-paid hook already exists and will start working once invoices exist. Small.
- *compliance:* **SOUND** — Endorse — undocumented commission revenue is a SARS/VAT exposure, not just an accounting gap.
- *business:* **SOUND** — Small and necessary — the flagship revenue stream invisible to Books means month-end never ties. Sequence after the ZOHO_BOOKS_ENABLED/CFP verification finding (no point wiring hooks into a possibly-dark integration).

### zoho-books-2 · Represent held buyer funds as a Client Funds Payable liability from receipt to release
**Impact:** critical · **Effort:** large · **Revenue:** Indirect but severe: trust-money misstatement is the first thing an accountant/auditor flags on a marketplace holding client funds

No Books artefact is created when a buyer's manual EFT is matched (manual-payments.service.ts has no receipt-side Zoho hook), so the credit side of Client Funds Payable depends entirely on the accountant hand-journaling bank-feed lines. On the drain side, only the commission slice is posted (markCommissionInvoicePaid with deposit_to_account_id = CFP, zoho-books.service.ts:539-578) and only for firearm sales; seller payouts via FNB batches, buyer refunds, and the shipping/processing-fee slices never drain CFP in Books. Swap funding (courier + R50/R100 fee + cash top-up, held both-sides then released via synthetic RELEASED tx, swap-funding.service.ts:812-891) is entirely invisible. A bookkeeper will find CFP either empty or monotonically drifting — it can never reconcile with the platform's actual held-funds position for orders or swaps.

**Critic verdicts:**
- *feasibility:* **SOUND** — Gap is real (no receipt-side Books hook in manual-payments; swaps have zero zoho references). Buildable on the existing ZohoBooksService request/status plumbing, but 'large' is right and the artefact design (journals vs receipts per EFT match, drain entries per payout/refund/fee slice) should be signed off by the accountant before coding — same caveat the CFP deposit-account comment in the code itself raises.
- *compliance:* **SOUND** — Strongly endorse. Accurate, reconcilable trust-money books are the first thing any accountant, auditor or regulator examines on a platform holding client funds, and the strongest evidence that GG's holding is transactional intermediation rather than deposit-taking. Swap funding must be included.
- *business:* **NEEDS-CHANGE** — The problem is real but per-transaction CFP mirroring in Zoho is scale-stage machinery for a solo operator. Pragmatic version: a platform-generated held-funds reconciliation report (opening/receipts/releases/refunds/closing) plus a monthly summary journal the accountant posts. Revisit full automation when volume forces it.

### zoho-books-3 · Verify ZOHO_BOOKS_ENABLED and the CFP deposit-account setup in the live Books org
**Impact:** high · **Effort:** small · **Revenue:** If the flag is off or CFP rejects payments, even the streams that ARE wired produce nothing in Books

Every method no-ops (status SKIPPED) unless ZOHO_BOOKS_ENABLED=true with full credentials (zoho-books.service.ts:58-88) — worth confirming the prod flag is actually on, since the code deploys dark by design. Separately, markCommissionInvoicePaid posts a customer payment with deposit_to_account_id pointing at the 'Client Funds Payable' liability account, and the code itself admits Books may reject that unless CFP is set up as a bank/clearing-type account (zoho-books.service.ts:563-569: 'if it errors here we'll know'). If misconfigured, every firearm mark-paid is failing into zohoSyncStatus=FAILED where nobody looks (see failed-sync finding). The /admin/health probe is only an unauthenticated HEAD to zohoapis.com (admin-health.service.ts:167-180); the real healthCheck() auth+org probe exists but is not wired in.

**Critic verdicts:**
- *feasibility:* **SOUND** — Code claims verified: isEnabled() dark-deploy gate, the self-doubting CFP comment at zoho-books.service.ts:563-568, and the unauthenticated HEAD probe in admin-health.service.ts:176. This is an ops check + wiring healthCheck() into /admin/health — small and worth doing before any other Zoho work.
- *compliance:* **SOUND** — Operational verification; prerequisite for the trust-money bookkeeping above.
- *business:* **SOUND** — Hours of work that gates every other Zoho finding — if the flag is off or CFP rejects payments, all downstream wiring is theatre. Do this first in the accounting stream.

### zoho-books-4 · Create Books artefacts for SWAP per-leg service fees and swap cash settlement
**Impact:** high · **Effort:** medium · **Revenue:** Direct: swap service fees are live revenue since 2026-06-29 with no accounting trail beyond bank statements

The swaps module (backend/src/swaps/) contains zero Zoho references. The R50 courier-leg / R100 firearm-leg service fees, the pass-through courier recovery, the absorbed 1.5% EFT cost, and the cash-contribution hold/release all bypass Books entirely. Ironically fee.calculator.ts:59-67 documents processingFee as 'retained only as GG's internal absorbed-cost figure (accounting / Zoho)' — but nothing ever consumes it. Since both parties are the customer (GG is the actual service provider, not an agent), the natural artefact is a Sales Receipt per funded leg for the service fee, mirroring the featured-slot pattern.

**Critic verdicts:**
- *feasibility:* **SOUND** — CONFIRMED zero zoho matches in backend/src/swaps and the fee.calculator.ts:59-60 comment promising processingFee 'for accounting/Zoho' that nothing consumes. Sales-receipt-per-funded-leg mirrors the existing featured/raffle receipt code paths in ZohoBooksService. Medium.
- *compliance:* **SOUND** — Live revenue since 2026-06-29 with no accounting document is a SARS/VAT exposure — fix promptly. Sales-receipt-per-funded-leg is the right artefact.
- *business:* **NEEDS-CHANGE** — R50-R100 per leg at launch volumes does not justify per-leg artefacts. A monthly aggregated sales receipt for swap service fees covers the accountant's need; build per-leg documents only if swap volume grows to where aggregation obscures anything.

### zoho-books-5 · Invoice or receipt the manual-EFT 1.5% processing pass-through
**Impact:** high · **Effort:** small · **Revenue:** Direct: 1.5% of every rand flowing through checkout is currently undocumented revenue

The buyer-paid 1.5% EFT handling fee (fee.calculator.ts:38,116-122, stored as Transaction.processingFee) is genuine GG revenue in manual mode, but the commission invoice's only line item is the Platform Fee (zoho-books.service.ts:463-471). The fee is retained out of held buyer funds at payout time yet has no Books document and no CFP drain. Simplest fix: add a second line item ('Payment Processing Fee' to a Processing Fee Revenue account) on the same seller invoice, or a buyer-side sales receipt if the operator prefers charging it to the buyer contact — an accountant should choose, since who the fee is contractually charged to differs (buyer pays it, seller invoice currently carries the commission).

**Critic verdicts:**
- *feasibility:* **SOUND** — MANUAL_RATE 1.5% confirmed (fee.calculator.ts:38,117-118) and stored on Transaction.processingFee. Adding a second invoice line or buyer-side receipt is a small ZohoBooksService change; the finding correctly defers the buyer-vs-seller-document choice to the accountant.
- *compliance:* **SOUND** — Endorse, including the finding's own caveat: have the accountant rule on who is contractually charged (buyer vs seller invoice) and the VAT treatment before wiring it.
- *business:* **SOUND** — Small, direct, and correctly punts the buyer-vs-seller artefact question to the accountant. Do it in the same pass as the non-firearm commission-invoicing fix.

### zoho-books-6 · Build failed-sync visibility: aggregate queue, alerts, and retry coverage for raffles/featured
**Impact:** high · **Effort:** medium · **Revenue:** Indirect: silent failures turn the wired streams into unreliable books that need manual month-end reconstruction

There is no retry queue — every hook is fire-and-forget with per-row zohoSyncStatus/zohoSyncError, and the only retry is the manual per-transaction button (POST /admin/transactions/:id/zoho-retry, admin.controller.ts:393) surfaced solely in the single-transaction dossier ZohoSyncPanel (frontend/app/admin/(protected)/transactions/[id]/zoho-sync-panel.tsx). No backend query anywhere lists FAILED rows, no command-center card, no AdminAlert, no cron re-drive; a failed sync is invisible unless an admin happens to open that exact dossier. Ticket and FeaturedSlotBid rows can also go FAILED (zoho-books.service.ts:954-976, 1094-1113) but have no retry endpoint at all. A small 'Zoho sync backlog' admin list + nightly re-drive cron over FAILED rows would close this.

**Critic verdicts:**
- *feasibility:* **SOUND** — Confirmed the only retry is POST /admin/transactions/:id/zoho-retry surfaced in the single-tx dossier; no FAILED-row query, cron, or alert exists. A nightly re-drive cron fits the existing tasks.service @Cron pattern; admin list fits the command-center card pattern. Medium.
- *compliance:* **SOUND** — Reliability work that supports accurate books; no regulatory surface of its own.
- *business:* **SOUND** — Prerequisite for trusting anything else in the Zoho stream — silent FAILED rows make every wired hook unreliable. A backlog list + nightly re-drive cron is the right minimal shape; don't gold-plate beyond that.

### zoho-books-7 · Handle partial refunds with proportional credit notes
**Impact:** medium · **Effort:** medium · **Revenue:** Direct: commission revenue is overstated in Books after every partial refund

createCommissionCreditNote fires only on FULL refunds (admin.service.ts:1262-1273); partials are deliberately skipped because 'the credit-note helper isn't proportional' — the helper always credits the entire commissionZar (zoho-books.service.ts:732). After a partial refund the Books commission invoice remains at full value with no memo, and the operator is expected to 'reconcile the final settlement' by hand. Extend createCommissionCreditNote to accept an amount and post pro-rata credit notes (or at minimum a Books comment) when TRANSACTION_REFUND_PARTIAL is recorded.

### zoho-books-8 · Prepare VAT readiness across all four document builders before hitting the R1m threshold
**Impact:** medium · **Effort:** medium · **Revenue:** Compliance: none today, mandatory before crossing the VAT threshold — retrofitting late means reissuing documents

All documents are posted tax-free: the commission invoice carries an explicit 'Skip tax — we're pre-VAT' note with the flip-plan (is_inclusive_tax:false + tax_id per line, zoho-books.service.ts:473-475), but the credit note, raffle receipt, and featured receipt builders have no tax handling or comments at all, and there is no tax_id lookup/config anywhere. The buyer receipt correctly states GG isn't VAT-registered (receipt.service.ts:10-13), and the card-fee math already models 15% VAT on gateway cost (fee.calculator.ts:27-32). When commission + fees approach SA's R1m compulsory registration threshold, all four builders plus a VAT-number/tax-rate config need touching in one pass; Subscription.vatNumber/businessName fields exist for Pro business receipts but nothing consumes them.

### zoho-books-9 · Wire subscription billing receipts when the MEMBER/PRO rail goes live
**Impact:** medium · **Effort:** medium · **Revenue:** Latent: zero today, becomes a recurring-revenue blind spot the day paid subscriptions launch

Schema is Zoho-ready (Subscription.zohoCustomerId at schema.prisma:2363, SubscriptionCharge.zohoReceiptId at :2388) but ZohoBooksService has no subscription method and the ask-gg module has zero Zoho references. Billing itself is dormant — Phase A admin comp-grants only, pending Peach tokenisation (schema.prisma:2340-2344) — so today no money is missed, but the moment recurring charges land they will bypass Books unless a createSubscriptionChargeReceipt method is added to the billing cron.

### zoho-books-10 · Fix the stale 'Bank — Peach Pending' deposit account on raffle and featured receipts
**Impact:** low · **Effort:** small · **Revenue:** Indirect: mis-posted deposits create phantom bank balances the bookkeeper must reverse

Both wired sales-receipt flows deposit to 'Bank — Peach Pending' with FNB fallback (zoho-books.service.ts:883-885, 1025-1027), and both rails are keyed on peachPaymentId (raffles.service.ts:782, featured.service.ts:551) — but Peach was removed and live payments are manual EFT into FNB. If a 'Bank — Peach Pending' account still exists in the CoA, receipts post cash to a bank account that will never see the money; the raffle rail itself appears dormant until re-plumbed onto manual EFT. Also note the zoho-books.service.ts header comment (line 18) says featured wins 'create invoices' while the code posts Sales Receipts — harmless doc drift.

### zoho-books-11 · Decide accounting treatment for shipping pass-through and carrier costs (no margin exists)
**Impact:** medium · **Effort:** medium · **Revenue:** Small direct exposure (quote-vs-actual drift), plus a recurring bank-recon headache on every courier order

Shipping is charged to the buyer at the live carrier quote with no markup anywhere in backend/src/shipping (no markup/margin matches), so stream 8's 'margin' is currently zero by design — but the cost side is fully outside Books: Pudo credits are prepaid from a wallet and TCG/ShipLogic bills separately, while the buyer's shipping payment lands in GG's bank inside the buyerTotal. Quote-time vs booking-time price deltas are untracked, and the shipping slice of held funds is never drained in Books (see the CFP finding). An accountant should decide between agent treatment (shipping in/out through CFP) or principal treatment (shipping revenue + carrier COGS); today it's neither.

### zoho-books-12 · Resolve the PRIVATE_ARRANGE commission contradiction and cover the ballistics app separately
**Impact:** medium · **Effort:** small · **Revenue:** Direct if PA commissions are nonzero; ballistics app revenue is entirely off-books today

createCommissionInvoice marks PRIVATE_ARRANGE transactions SKIPPED claiming 'no commission on that flow' (zoho-books.service.ts:407-415), but the FeeCalculator applies commission bands regardless of shipping method (fee.calculator.ts:131-168) and PA sellers are paid via the normal payout batch — if PA sales do carry commission (verify a live PA row's commissionZar), that revenue is deliberately never invoiced and the skip rationale is wrong. Separately, the standalone ballistics app (ballistics.gungalore.co.za, own DB per project memory) has no purchase/payment code in this repo and therefore no path to this Zoho service at all — its sales need either their own Books wiring or a documented manual-invoicing process.

## E. Site & UX

**Auditor summary:** The frontend is genuinely repositioned at the top of the funnel — hero ("South Africa's outdoor & sport marketplace… Optics, camping, fishing, knives and more"), layout/OG metadata, manifest, and footer all lead outdoor — but the repositioning is one layer deep. One click in, the site reverts to gun-first: the PWA Shop sheet sells the Marketplace as "Used firearms and gear", the FAQ and every category page's SEO description lead with "firearms", Ask GG is explicitly "your firearms-knowledgeable assistant for South African shooters", the sell-flow AI says it "couldn't read those photos as a firearm", and 8 of 14 top-level categories are shooting verticals while Camping & Outdoor has six generic subcategories and there is no clothing, overlanding, archery, or watersports taxonomy at all. Merchandising breadth is the biggest structural gap: no category tiles on the homepage, /category/[slug] pages are orphaned (zero internal links), and there are no brand pages, collections/seasonal pages, gear-guide content, or sold-price transparency. Trust is transactional (payment-held, KYC, tiers, ratings) but lacks gear-specific signals: the condition field is a bare 5-value enum with no rubric and no tested/working attestation for electronics/fridges. Discovery is wishlist-only — no saved searches, no price-drop alerts, no follow-seller — despite a notification+push infrastructure that could carry all three cheaply.


### site-outdoor-ux-1 · Fix remaining gun-first copy strings on buyer surfaces
**Impact:** high · **Effort:** small · **Revenue:** Direct: category-page SERP snippets and first-session copy shape whether non-shooter sellers/buyers stay

Specific strings that contradict the outdoor repositioning: (1) PWA Shop sheet (frontend/components/bottom-tab-bar.tsx:644) taglines Marketplace as "Used firearms and gear — pay the listed price and go" while the desktop equivalent (frontend/app/page.tsx:33) already says "Gear, optics & outdoor kit"; (2) FAQ Q1 (frontend/app/faq/page.tsx:17) answers "What is Gun Galore?" with "a South African online marketplace for firearms, optics, hunting and outdoor gear, ammunition and reloading components" — firearms first, camping/fishing absent, and it advertises ammunition although the Ammo category is seeded isActive:false; (3) category-page SEO description (frontend/app/category/[slug]/page.tsx:33) stamps "South Africa's marketplace for firearms, optics, hunting and outdoor gear" onto EVERY category including Fishing and Camping & Outdoor — so Google's snippet for the fishing category leads with firearms; (4) sell-flow AI helper failure copy (frontend/app/listings/new/identify-from-photos.tsx:156) says "I couldn't read those photos as a firearm or related item" — telling a tent or rod seller the tool isn't for them.

**Critic verdicts:**
- *feasibility:* **SOUND** — All four strings verified verbatim: bottom-tab-bar.tsx:644, faq/page.tsx:17, category/[slug]/page.tsx:33, identify-from-photos.tsx:156. Pure copy; note the identify failure string should change together with the backend identify-prompt generalisation so behaviour matches copy.
- *compliance:* **SOUND** — Endorse — removing the FAQ's 'ammunition' claim is also compliance hygiene, since advertising a product line the platform has deliberately kept inactive invites both user confusion and regulator attention.
- *business:* **SOUND** — Small, direct, and the category-page SEO description stamping 'firearms' onto the Fishing SERP snippet is actively repelling the target expansion audience. Bundle with the Ask GG scope widening as one repositioning pass. Top-5 adjacent.

### site-outdoor-ux-2 · Add category tile grid to the homepage and link the orphaned /category pages
**Impact:** critical · **Effort:** medium · **Revenue:** Direct: category landing pages are the primary organic-search entry for "buy second hand camping gear SA" queries and the main breadth-discovery surface

The bare landing page (frontend/app/page.tsx) renders hero + featured marquee + recently-viewed only — there are no category entry points anywhere; buyers must use the filter <select> or search. Meanwhile /category/[slug] pages exist with canonical URLs and sitemap priority 0.7, but a grep shows zero internal links to them outside the category pages' own breadcrumbs — not from the homepage, nav, footer, filter bar (which uses ?categoryId= on / instead), or the listing-detail category badge (a non-linked <span>, frontend/app/listings/[id]/page.tsx:194-201). They are crawl-orphans receiving no link equity and no user traffic. Build a visual tile grid (Camping, Fishing, Optics, Knives, Firearms, …) below the Featured marquee, link the listing-detail category chip, and add top categories to the footer Shop column and nav.

**Critic verdicts:**
- *feasibility:* **SOUND** — Consistent with code: /category/[slug] pages exist with metadata, homepage is hero+featured+recently-viewed, listing-detail category chip is unlinked, FilterBar uses ?categoryId= on /. Frontend-only work plus sitemap; no backend changes needed beyond the parent-rollup fix (do that first or parent tiles land on empty pages).
- *compliance:* **SOUND** — SEO/UX work. A Firearms tile on the homepage is lawful (firearms advertising is not restricted in SA); all controls sit at transaction time.
- *business:* **SOUND** — Crawl-orphaned category pages with zero internal links is a genuine SEO own-goal, and the homepage currently offers no breadth-discovery at all. Ship with the parent-rollup fix so the newly linked pages aren't empty.

### site-outdoor-ux-3 · Build outdoor category taxonomy depth (clothing, overlanding, archery, watersports, fridges/tents subcats)
**Impact:** critical · **Effort:** medium · **Revenue:** Direct: can't sell what buyers can't file or find; First Ascent jackets and Front Runner racks currently have no home

backend/prisma/seed.ts: 8 of 14 top-level categories are shooting verticals (Air Rifles, Ammo, Cleaning Equipment, Firearms, Gun Smithing & Parts, Optics, Reloading Components/Equipment, Shooting Accessories) vs 3 outdoor ones. Camping & Outdoor has only 6 vague children ("Outdoor Gear", "Camping & Outdoor Accessories", Lights, Sleeping Bags, Furniture, Kids Camping) — no Tents, no Fridges & Coolers (the Engel/SnoMaster secondhand market is huge), no Overlanding/4x4 (rooftop tents, canopies, drawer systems, recovery gear), no GPS/Electronics, no Braai. There is NO clothing/apparel top-level at all (only "Fishing Apparel", plus "Men's Hunting Pants & Shorts" mis-nested inside the Gun Smithing & Parts block at seed.ts:111 — a seed data bug worth fixing regardless). No Archery, Cycling, Watersports, or Hunting Packages/Experiences. The frontend renders whatever the taxonomy provides, so this is mostly backend seed + admin work, but it is the prerequisite for every breadth merchandising surface.

**Critic verdicts:**
- *feasibility:* **SOUND** — Seed structure verified (8 shooting parents, thin Camping children, misfiled hunting pants). Mostly admin/seed work as stated — but do the firearm-gating Hole 2 fix (admin subcategory inheritance) BEFORE bulk category creation, since that's exactly when the operator will be mass-adding children.
- *compliance:* **SOUND** — Safe direction — new outdoor categories default isFirearm=false so they cannot accidentally trigger firearm rules. Sequence after the gating-holes fix so admin-created children under Firearms can't silently bypass gates (Hole 2).
- *business:* **NEEDS-CHANGE** — Right diagnosis, but this must merge with the camping-overlanding two-tree map and the fishing/hunting tree findings into ONE seed migration — four agents proposed overlapping taxonomies. And cut archery/cycling/watersports from v1: focus the launch on camping/overlanding/fishing/clothing where the other findings concentrate.

### site-outdoor-ux-4 · Add saved searches with new-listing alerts
**Impact:** critical · **Effort:** medium · **Revenue:** Direct: converts failed searches into return visits and first purchases; the retention mechanism the marketplace currently lacks

Grep across frontend + backend finds no saved-search, price-drop, or follow-seller code (only false positives in legal pages). For a low-liquidity secondhand marketplace this is the single highest-leverage discovery feature: the buyer wanting "Hilux canopy" or "Engel 40L" won't find one today, and nothing brings them back when it lists. The rails already exist: Meilisearch query params are already URL-serialisable (frontend/app/page.tsx SearchParams), the Notification model uses a free-form type string (backend/prisma/schema.prisma:491 "Free-form string so we can add new event types without a migration"), and web-push + the PWA Alerts tab (bottom-tab-bar.tsx) are live. Build: SavedSearch model (userId + serialized params + lastNotifiedAt), a "Save this search / alert me" button next to the FilterBar, a cron matching new ACTIVE listings against saved queries, and notification + push fan-out.

**Critic verdicts:**
- *feasibility:* **SOUND** — Confirmed zero saved-search code and the free-form Notification.type comment at schema.prisma:490-491. SavedSearch model is additive; matcher cron fits tasks.service patterns; push/PWA Alerts rails live. Matching new listings against serialized params is simplest via Prisma-side re-query per saved search (bounded), not Meili percolation — fine at current volumes.
- *compliance:* **SOUND** — User-initiated alerts on a user-defined query are service messages, not POPIA s69 unsolicited direct marketing. Include per-search unsubscribe/management anyway.
- *business:* **SOUND** — The single best demand-side feature for a thin-supply marketplace: it converts today's inevitable failed searches into return visits when stock arrives, and all the rails (URL-serialisable params, free-form notification types, web-push) exist. First item after the top-5.

### site-outdoor-ux-5 · Add price-drop and item-sold alerts on wishlisted items
**Impact:** high · **Effort:** small · **Revenue:** Direct: price-drop pings are among the highest-converting notifications in secondhand marketplaces

Wishlist is well built (WishlistProvider, heart on every card, /wishlist page with tombstones for SOLD/EXPIRED items — frontend/app/wishlist/page.tsx) but completely passive: nothing notifies a saver when the seller drops the price or when the item sells ("you missed it — here are similar"). Sellers also get no "12 people saved your listing — consider a price drop" nudge, even though the count already exists (listing._count.wishlistedBy powers the SocialProofPill on listing detail). Hook listing-update events to notify wishlisters on price decrease, and reuse the cross-sell engine for a similar-items email when a saved item goes terminal.

**Critic verdicts:**
- *feasibility:* **SOUND** — Wishlist + _count.wishlistedBy confirmed in code (listings.service.ts:978-980). Hook point is ListingsService.update (price decrease) and the SOLD/terminal transitions; cross-sell engine exists for similar-items. Small is fair.
- *compliance:* **SOUND** — Tied to explicit user action (wishlisting), so POPIA-safe as service messaging. The 'similar items' email after a sale drifts toward marketing — include a working opt-out and honour it.
- *business:* **SOUND** — Small, rides the same notification rails as saved searches, and price-drop pings are proven high-converters in secondhand. The seller-side 'N people saved your listing' nudge is a free bonus from data that already exists.

### site-outdoor-ux-6 · Introduce standardised condition grading with per-category rubric
**Impact:** high · **Effort:** small · **Revenue:** Indirect: reduces disputes and returns, increases buyer willingness to pay for sight-unseen gear

Condition exists as a bare 5-value enum (NEW/LIKE_NEW/GOOD/FAIR/POOR — frontend/lib/utils.ts CONDITION_LABELS) shown as a chip on cards and listing detail, but no surface anywhere defines what the grades mean, and the sell flow (frontend/app/listings/new/page.tsx, condition defaults to 'GOOD') offers no guidance. For high-value secondhand outdoor gear, grade meaning differs by category (optics: glass clarity/turret function; fridges: compressor runs on 12V+220V; rods: guides intact; tents: zips/waterproofing). Build: a /condition-guide page, a HelpTip rubric in the sell flow's condition picker (HelpTip component already exists), and per-category checklist prompts appended to the description. Cheap because it is copy + existing components.

**Critic verdicts:**
- *feasibility:* **SOUND** — Condition is the bare 5-value enum as claimed. This variant keeps the enum and adds rubric copy/HelpTip/guide page — fully additive, cheap, and the right shape for this stack (unlike the competitors-stream variant that renames grades — see that assessment).
- *compliance:* **SOUND** — Reduces CPA dispute surface (s55/56 quality expectations where sellers are business suppliers). Copy + existing components, no new exposure.
- *business:* **SOUND** — Copy + existing components = the cheap version of the trust upgrade. Ship this one; it subsumes the competitors agent's heavier variant (see that assessment).

### site-outdoor-ux-7 · Add "tested & working" attestation + verified-photos badge for electronics and appliances
**Impact:** high · **Effort:** medium · **Revenue:** Direct: unlocks confident purchases of R5k–R30k fridges/electronics, the marketplace's highest-margin commission band

There is no tested/working attestation anywhere for camp fridges, GPS units, echo sounders, trail cameras, or e-bikes — exactly the items where secondhand buyers fear dead compressors. The proof-of-possession machinery (seller photographs the item next to a GG-minted per-leg code, Claude vision verifies) is already LIVE but only in the SWOP funding flow; normal listings get Claude moderation of photos but no buyer-visible verification badge. Build: (1) a seller checkbox + structured claim ("Tested and working — powered on within the last 7 days") rendered as a badge on the card and listing detail, with the claim written into the dispute record; (2) optionally reuse the PoP code-photo flow as an opt-in "Verified photos" badge for listings above a price threshold.

**Critic verdicts:**
- *feasibility:* **SOUND** — Attestation = additive Listing boolean/timestamp + badge rendering + dispute-record copy: small-medium. The PoP reuse is real but note the flow lives in swap-proof.service.ts keyed to swap legs (per-leg minted codes) — productising it needs extraction into a listing-scoped service, which is the bulk of the 'medium'.
- *compliance:* **NEEDS-CHANGE** — Render the badge unambiguously as the SELLER'S attestation ('Seller attests: tested & working, powered on within 7 days'), never as a GG certification — if GG's UI reads as GG vouching for the claim, GG adopts the representation under CPA s41 and inherits liability for every dead compressor. Writing the claim into the dispute record is exactly right; keep that.
- *business:* **SOUND** — The checkbox + badge + dispute-record claim is cheap and targets the exact fear (dead compressors) blocking the highest-margin band. The PoP-photo reuse is correctly framed as optional/later — keep it that way.

### site-outdoor-ux-8 · Create brand landing pages from the existing make facet
**Impact:** high · **Effort:** medium · **Revenue:** Direct: brand+used queries are the highest-converting SEO traffic for secondhand gear

The brand infrastructure half-exists: listings carry a make field, /listings/brands returns the facet (frontend/app/page.tsx:150), and the FilterBar renders an "All brands" select. But there are no /brand/[slug] pages, so "Shimano reels for sale South Africa", "Engel fridge second hand", "Front Runner roof rack used" — high-intent brand+secondhand queries — have no landing surface, and brands aren't in the sitemap. Build /brand/[slug] mirroring /category/[slug] (grid filtered by make, canonical URL, sitemap entries, metadata), plus a linked brand chip on listing detail. Add a short editorial intro per top-20 brand.

**Critic verdicts:**
- *feasibility:* **SOUND** — make is filterable in both browse paths (verified, incl. Meili filter escaping at listings.service.ts:806-807) and the brands facet endpoint is consumed on the homepage. /brand/[slug] mirroring /category/[slug] is straightforward; needs a slug→make de-normalisation map (make is free-text, so slugging/canonicalising brand names is the only real design decision).
- *compliance:* **SOUND** — Nominative trademark use for genuine resale is lawful. Keep editorial intros factual and avoid implying brand endorsement or partnership.
- *business:* **NEEDS-CHANGE** — Right SEO play, wrong timing if ungated: with thin inventory most /brand/[slug] pages would be near-empty thin content that hurts rather than helps. Gate generation/sitemap inclusion to brands with a minimum active-listing count and let the surface grow with supply.

### site-outdoor-ux-9 · Build curated collection/seasonal pages
**Impact:** medium · **Effort:** medium · **Revenue:** Direct: raises average items-per-session and gives marketing repeatable seasonal campaigns

No collections infrastructure exists — the only curation is the paid Featured slots (homepage marquee, frontend/app/page.tsx). Seasonal/occasion collections ("Winter Kruger trip checklist", "Rifle season prep", "Bass season opener", "First-time camper starter kit") are the natural merchandising layer for an outdoor marketplace with strong seasonality, and they give social/WhatsApp-shareable URLs (the codebase already invested in OG unfurls for exactly that channel — layout.tsx AUDIT M29 comment). Build: a Collection model (title, slug, hero image, editorial intro, query-or-manual listing membership), /collections/[slug] page, admin CRUD (admin kit components already exist), homepage rail slot, and sitemap entries.

### site-outdoor-ux-10 · Add gear-guide content SEO surface
**Impact:** medium · **Effort:** medium · **Revenue:** Indirect but compounding: organic acquisition for non-shooter categories where the site currently has zero query coverage

There are zero content routes — no /guides, no blog. The FAQ (10 entries, FAQPage JSON-LD, frontend/app/faq/page.tsx) and /how-selling-works are the only editorial pages, and both are process-focused. For the target categories, buying-guide content ("How to buy a used camp fridge", "Scope buying guide for SA hunters", "What to check on a secondhand kayak") is the proven top-of-funnel channel and internally links to category/brand pages. Static MDX or a simple Guide model both work; each guide should end in a live listings rail (CrossSellRow already fetches by category and can be reused). Note the operator already has a content-creator skill/workflow available for producing this copy.

### site-outdoor-ux-11 · Add recently-sold price transparency
**Impact:** high · **Effort:** medium · **Revenue:** Direct: better-priced listings sell faster (more commission velocity); comps in the sell flow reduce listing abandonment

SOLD listings vanish from every browse surface (only tombstones on the owner's wishlist), and no surface shows realised prices. Secondhand buyers and sellers both anchor on comps — "what do used Tikka T3x / Engel 40L actually go for?" — and sold-price data is a moat competitors (Gumtree, Facebook Marketplace) cannot show. Build: a "Recently sold in this category" strip on /category/[slug] (price + month, no buyer info — POPIA-safe since listings are already public), and a sold-comps hint in the sell flow's pricing step ("similar items sold for R4,200–R5,600") to improve pricing accuracy and sell-through. Backend already has the data (Listing status SOLD + Transaction amounts).

**Critic verdicts:**
- *feasibility:* **SOUND** — Data exists (ListingStatus SOLD + Transaction amounts). One correction: use the Transaction agreed price, not Listing.price, for realised comps (offers/auctions settle off list price). POPIA framing is fine — prices without buyer identity on already-public listings.
- *compliance:* **SOUND** — Aggregated price + month with no party identities is POPIA-safe as specified. Don't expose per-transaction buyer/seller usernames on sold comps.
- *business:* **SOUND** — Genuine moat vs Gumtree/Facebook and the sell-flow comp hint is the highest-value half (better pricing → faster sell-through). Gate display on a minimum comp count so early sparse data doesn't mislead.

### site-outdoor-ux-12 · Reframe Ask GG (and subscription value) beyond firearms
**Impact:** medium · **Effort:** small · **Revenue:** Direct: doubles the addressable base for MEMBER/PRO subscriptions

Ask GG is marketed as "Your firearms-knowledgeable assistant" (frontend/app/ask-gg/page.tsx:468, :1925 "for South African shooters"), placeholder "Ask about firearms, ammo, optics, hunting…" (:878), and all six starter prompts are firearms/reloading/gun-law. Per bottom-tab-bar.tsx comments it is "Topic-gated at the system-prompt level" to firearm topics — so a paying MEMBER who fishes or camps gets refused on "which camp fridge suits a 2-week Kruger trip". Since Ask GG + Load Lab are the entire MEMBER/PRO value proposition, the subscription is currently only sellable to shooters. Widen the system-prompt topic gate to all outdoor gear, add fishing/camping starter prompts, and retitle to something like "your outdoor-gear expert". Backend prompt change + frontend copy.

### site-outdoor-ux-13 · Add follow-seller
**Impact:** medium · **Effort:** small · **Revenue:** Indirect: repeat-purchase loop and seller retention (followers are a reason to keep listing on GG)

Seller profile pages (frontend/app/sellers/[clerkId]/page.tsx) show ratings, reviews, and active listings but have no follow button — grep confirms no follow model anywhere. Specialist secondhand sellers (a fly-fishing downsizer, a dealer clearing overland kit) are recurring supply; buyers should be notified when a followed seller lists. Straightforward on existing rails: Follow model, button on seller page + listing-detail seller card, notification fan-out on listing publish (notifications service already has resolveByEntity/type-string patterns).

### site-outdoor-ux-14 · Make the PWA Shop sheet category-first, not deal-format-first
**Impact:** medium · **Effort:** medium · **Revenue:** Indirect: mobile is the dominant SA commerce context; category-first navigation raises browse depth for non-shooter buyers

The installed-PWA Shop tab opens a "Choose a surface" sheet listing All listings / Marketplace / Auctions / Take a Shot / Swop / Competitions (bottom-tab-bar.tsx ShopSheet) — a transaction-mode taxonomy. Outdoor buyers think in categories ("camping", "fishing"), not deal formats; no PWA surface offers category browsing at all, and the mobile FilterBar is a cramped row of native <select>s. Add a category section (tile row or list reusing /categories) to the Shop sheet above the surface picker, and consider a proper mobile filter sheet with applied-filter chips. Also reconsider whether Ask GG (a firearms-gated paid feature) deserves one of five primary tabs for the outdoor persona vs. Wishlist or Categories.

### site-outdoor-ux-15 · Add outdoor-relevant structured attributes to listings and filters
**Impact:** medium · **Effort:** large · **Revenue:** Direct for apparel/footwear (currently blocked); indirect elsewhere via filter precision

The only structured attributes are gun-shaped: make/model/calibre (extracted by AI in the sell flow, frontend/app/listings/new/page.tsx:1461, listing-preview-modal.tsx renders a Calibre row) and a parcel weight/dims block. There are no per-category attributes for outdoor gear — tent berth, fridge capacity (L) and power (12V/220V/gas), rod class/length, boot size, jacket size — so clothing and footwear are effectively unsellable (no size filter) and fishing/camping can't be filtered meaningfully. Start narrow: a JSON attributes field + per-category attribute schema for the top 5 outdoor categories, AI-extracted in the existing identify-from-photos flow, surfaced as filter chips on /category pages.

### site-outdoor-ux-16 · Fix low-cost SEO hygiene items
**Impact:** low · **Effort:** small · **Revenue:** Indirect: share-unfurl quality feeds the WhatsApp referral loop the codebase explicitly targets

(1) Sitemap includes /wishlist (frontend/app/sitemap.ts:24) which server-redirects to /sign-in — a junk entry Google will flag; remove it. (2) The global OG image is the 512px logo icon (layout.tsx openGraph.images '/icon-512.png'), so every non-listing share on WhatsApp unfurls as a small logo — create a proper 1200x630 outdoor-branded OG image. (3) Listing JSON-LD (listings/[id]/page.tsx productLd) omits brand and seller aggregateRating even though ratings exist — adding them enriches rich results. (4) /how-selling-works intro still says "There are three ways to list" (how-selling-works/page.tsx:91) while the page documents four modes including Swop.

## F. Competitor research

**Auditor summary:** The SA secondhand outdoor space is fragmented and trust-broken: Gumtree/Facebook Marketplace carry the volume but are scam-saturated (1-in-6 users report Marketplace fraud; the "fake courier link" phish is endemic), forums (4x4community, Sealine, SA Hunters' 40k members) trade on reputation but offer zero payments/logistics, gun classifieds (GunAfrica, Gunmarket, GunFinder) are free ad boards that explicitly disclaim liability and leave dealer transfer to the parties, and ClassicArms monetises trust via a 17.25% buyer's premium at auction. The one breakout SA proof point is Yaga (fashion): 2M+ users, profitable, ~€50M GMV run-rate on a 25-person team, monetised purely by a buyer-side protection fee (6.5% + R19.90 since June 2025) plus funds-held-until-confirmed and integrated Pudo/PAXI/Aramex/Pargo delivery — exactly the architecture Gun Galore already runs, but nobody has applied it to outdoor/hunting gear. Internationally the winning patterns are: buyer-side fee monetisation (Vinted 5%+fixed, Depop's 2024 shift off sellers), hold-then-auto-release settlement (SidelineSwap 72h), retail/brand trade-in partnerships as the growth engine (SidelineSwap×DICK'S 500 events/yr, Out&Back×NEMO, REI Re/Supply's 10-40%-of-retail gift-card loop), and consignment for high-touch categories (GearTrade's pivot from P2P to full consignment). BookYourHunt (10% success fee, verified outfitters, money never touches platform) is a ready-made template for the operator's hunting-packages ambition. Headline gap: no dedicated SA outdoor resale marketplace exists — GG's KYC + courier + funds-held stack is already ahead of every local channel; the work is monetisation mechanics, liquidity features, and community distribution.


### competitors-1 · Adopt a Yaga-style buyer-side Protection Fee as the core take-rate
**Impact:** critical · **Effort:** small · **Revenue:** Direct: converts every existing held-funds transaction into fee revenue at a market-proven SA rate

Yaga proved SA buyers will pay 6.5% + R19.90 per order for funds-held protection (support.yaga.co.za fees guide; raised from 5% June 2025) while sellers list free — and it reached profitability on that single lever. Vinted (5% + ~€0.70) and Depop (dropped the 10% seller fee for a up-to-5% + $1 buyer fee in 2024) confirm the industry-wide shift to buyer-side monetisation because free selling maximises supply, and supply is the binding constraint for a young marketplace. GG already holds EFT funds until delivery confirmation, so this is pricing/display work, not new infrastructure. Frame it as 'Payment Held Protection' (never 'escrow').

**Critic verdicts:**
- *feasibility:* **SOUND** — Mechanically small on this stack — fee.calculator already charges the buyer a processing fee, so a protection-fee line is the same shape; exact-amount EFT matching is unaffected because the fee is computed pre-reference. The real work is the pricing decision (interplay with seller commission bands and the R30 floor) plus display/legal copy ('Payment Held Protection', never 'escrow'). Effort 'small' holds for the mechanics.
- *compliance:* **NEEDS-CHANGE** — A fee charged explicitly for 'protection' risks being construed as insurance business (Insurance Act) if the T&Cs promise indemnity against loss. Structure and word it as a platform service fee for payment handling and dispute mediation — 'Payment Held Protection' describing the process (funds held until delivery confirmed), never a guarantee to reimburse from GG's own pocket beyond returning the held funds. Legal review of the fee T&C wording before launch; never 'escrow' (already policy).
- *business:* **NEEDS-CHANGE** — Don't blanket-replace the take-rate. The evidence supports buyer-side fees + 0% seller fee as the supply-acquisition hook for the NEW low-ticket outdoor/apparel classes (where GG competes with Yaga/Facebook); firearms and high-ticket flows already tolerate seller commission and repricing them risks existing revenue and seller confusion. Model net take by segment before flipping anything, and never mid-flight on live transactions.

### competitors-2 · Standardise 72h auto-release + 3-day dispute window across all buy flows
**Impact:** high · **Effort:** small · **Revenue:** Indirect: faster predictable payouts increase seller retention and listing volume

SidelineSwap releases seller funds on buyer approval OR 72h after delivery, whichever first, with a 3-day not-as-described dispute window (help.sidelineswap.com); Yaga uses the same held-until-'Item received' pattern. GG's swap module already has a 48h verification window and auto-release cron — generalise that exact mechanic to BUY_NOW/AUCTION/TAKE_A_SHOT so payout latency is predictable, disputes have a hard clock, and sellers see a written seller-protection promise (chargeback/fraud cover) mirroring SidelineSwap's. Table stakes, but most SA rivals (Gumtree, gun classifieds) have nothing.

**Critic verdicts:**
- *feasibility:* **SOUND** — Verified no buy-flow auto-release exists (confirmDelivery is the only release trigger; no HELD-after-delivery cron in tasks.service). The swap 48h auto-release cron is the pattern to clone. One dependency to name: the 72h clock needs a trustworthy delivered timestamp from the Pudo/TCG tracking poll/webhook on the transaction, which the P5.2 rails already surface. Small-medium.
- *compliance:* **NEEDS-CHANGE** — The shorter, predictable holding window is compliance-positive (bounds funds-holding). Two wording guardrails: (a) the 3-day window is the platform-mediated remedy clock — it cannot extinguish CPA s56 rights against business sellers, so don't draft it as a waiver; (b) a written 'seller protection / chargeback+fraud cover' promise is an indemnity — make it an express-discretion goodwill policy with a cap, or it looks like unlicensed insurance.
- *business:* **SOUND** — Generalising an already-proven swap cron to all buy flows is cheap, makes payout latency predictable (seller retention), and puts a hard clock on disputes — which directly reduces solo-operator ops load.

### competitors-3 · Ship a category-specific condition-grading standard with photo checklists
**Impact:** high · **Effort:** medium · **Revenue:** Indirect: higher conversion and fewer disputes; enables premium 'verified grade' upsell later

REI Re/Supply gates trade-ins on 'good working condition, <6 years old'; GearTrade requires 'good or better, fully functional, <5 years'; SidelineSwap uses condition tiers buyers filter on. Build a 5-grade scale (New / Like-new / Well-used / Field-worn / For-parts) with per-category mandatory photo prompts (tent: seams+zips+poles; reel: drag+spool; scope: glass+turrets; jacket: cuffs+zips) enforced at listing time. Graded listings get a badge and search boost. This is the single biggest buyer-trust upgrade over Gumtree/Facebook where 'good condition' means nothing. Table stakes internationally, differentiator in SA.

**Critic verdicts:**
- *feasibility:* **NEEDS-CHANGE** — The proposed NEW 5-grade scale (New/Like-new/Well-used/Field-worn/For-parts) means renaming Prisma enum values — that is NOT an additive migration and the existing NEW/LIKE_NEW/GOOD/FAIR/POOR values are baked into the schema, Meili docs, vision prompts, and frontend CONDITION_LABELS. Correction: keep the enum values, change display labels + per-category rubric definitions and photo-prompt checklists (enforced in the sell flow) instead. With that change the rest (badge, search boost, mandatory photo prompts) is buildable as described.
- *compliance:* **SOUND** — Trust/dispute-reduction work; no regulatory surface.
- *business:* **NEEDS-CHANGE** — Duplicate of the site-UX rubric finding — merge them. And make the per-category photo prompts advisory, not mandatory: enforced photo checklists add listing friction exactly when supply is the binding constraint. Enforce later, once liquidity exists and disputes justify it.

### competitors-4 · Add PAXI (Pep) and Pargo pickup networks alongside Pudo/TCG
**Impact:** high · **Effort:** medium · **Revenue:** Indirect: unlocks rural supply/demand; each leg can carry the existing flat shipping service fee

Yaga's delivery menu is Pudo locker-to-locker, PAXI Pep store-to-store, Aramex prepaid sleeve, and Pargo (4,000 points) — that multi-network spread is what makes it work for rural SA, and GG's hunting/fishing/overlanding demographic skews far more rural than Yaga's. Pep stores reach small towns Pudo lockers never will. GG already has the courier-abstraction seam (Pudo + ShipLogic/TCG live), so each network is an adapter, not an architecture change. Table stakes for claiming 'THE SA outdoor marketplace'.

**Critic verdicts:**
- *feasibility:* **NEEDS-CHANGE** — 'Each network is an adapter, not an architecture change' understates two things: (1) PAXI has no public self-serve API — merchant integration is partnership/aggregator-gated, so it's a commercial onboarding project, whereas Pargo has a documented API; start with Pargo. (2) Each new method is a ShippingMethod enum addition (additive, fine) that must also touch validateShipping's hardcoded nonFirearmLegal list, the sell-form DTO/UI, checkout quoting, the P5.2 booking/label/PIN flow, tracking, and the cancel-on-refund hooks. Feasible, but 'medium' per network only after API access exists.
- *compliance:* **SOUND** — Firearms already route DEALER_TRANSFER-only so store networks add no FCA exposure. Encode each network's prohibited-goods list (gas, batteries, size/weight caps) server-side in the booking seam, consistent with the DG findings, to protect the carrier accounts.
- *business:* **NEEDS-CHANGE** — PAXI only in v1 — it's the cheapest parcel in SA and Pep's rural reach maps exactly onto the platteland demographic; Pargo adds a fourth ops surface for marginal incremental coverage. Merge into the single shipping programme with the combined-parcel and apparel-economics findings.

### competitors-5 · Launch hunting packages/experiences on the BookYourHunt model (10% success fee, verified outfitters)
**Impact:** high · **Effort:** large · **Revenue:** Direct: 10% of high-ticket bookings (SA plains-game packages run R20k-R150k+)

BookYourHunt charges outfitters 10% commission only after a booked hunt, verifies every outfitter before listing, enforces price parity with direct booking, and never touches the money (bookyourhunt.com/en/faq) — it already partners with SA Hunters. GG can do one better: use its manual-EFT held-funds rail for deposits (protection BookYourHunt can't offer) and its KYC stack for outfitter verification. This is the operator's stated expansion target and no SA-local player owns it; hunting-package listings also pull exactly the buyers who own the gear GG resells. Defensible moat given the payments+KYC rail.

**Critic verdicts:**
- *feasibility:* **SOUND** — Feasible on the deposit-held model, but it is fully downstream of the EXPERIENCE listing engine (epic) and the outfitter-vetting admin flow; the KYC/SAP-534 document-review patterns to reuse are real. Correct as a large, sequenced item — not a near-term build.
- *compliance:* **NEEDS-CHANGE** — Adopt only with the hunting-packages stream's guardrails attached: outfitter/PH registration and farm exemption-certificate vetting, intermediary-not-supplier positioning with commission disclosure (CPA), the s17 cancellation schedule, and deposit-ONLY funds-holding. Note the finding's pitch — 'use the held-funds rail for deposits, protection BookYourHunt can't offer' — is precisely where holding many high-value deposits for months drifts toward regulated funds-holding; keep held amounts small, segregated and time-bounded, with a legal opinion on the structure.
- *business:* **NEEDS-CHANGE** — Right end-state, wrong verb. Before any build: manually pilot 2-3 vetted outfitters as concierge bookings (deposit via existing EFT rails, admin-managed) to validate demand and learn the dispute shapes. The productised vertical stays parked behind the experience engine.

### competitors-6 · Sell an optional 'GG Verified' item-verification service for high-value gear
**Impact:** high · **Effort:** medium · **Revenue:** Direct fee per verification plus higher conversion on verified high-ticket listings

Vinted charges buyers €10/item to route orders through a verification hub before delivery. GG already built the harder part: the Claude-vision proof-of-possession pipeline (per-item minted code, anti-replay, item-match) live in the swap module. Productise it as a paid badge in two tiers: (a) R49 remote photo-verification using the existing PoP flow at listing time, (b) R199-R299 physical routing via a partner dealer for optics/reels/premium knives. No SA marketplace offers anything like it. Defensible moat — competitors lack both the vision pipeline and the dealer network.

**Critic verdicts:**
- *feasibility:* **SOUND** — The PoP vision pipeline is live but coupled to swap legs (swap-proof.service.ts) — tier (a) requires extracting it into a listing-scoped service plus a paid-fee EFT reference lane in matchOrder (same lane pattern as subscriptions/featured). Tier (b) is ops-heavy (dealer routing) but rides the dealer network. Medium is fair for tier (a); treat tier (b) as separate.
- *compliance:* **NEEDS-CHANGE** — Scope the badge precisely in copy: 'photos verified as this seller's possession of this item on [date]' — NOT a warranty of condition or authenticity — otherwise GG assumes CPA liability for the item's quality at R49 a time. For the physical tier, contract the dealer's inspection scope and liability allocation explicitly. No FCA issue: optics, night-vision and suppressors are not controlled items in SA, so dealer routing is a logistics choice, not a legal need.
- *business:* **NEEDS-CHANGE** — Ship tier (a) only — R49 remote PoP-photo verification reuses live machinery and prices a real trust gap. Tier (b) physical routing through partner dealers is logistics + partner management a solo operator can't carry; park it.

### competitors-7 · Build an estate/collection consignment intake ('sell the whole safe')
**Impact:** high · **Effort:** large · **Revenue:** Direct: 15-20% commission on high-value multi-item consignments

ClassicArms thrives on consigned estates with a 15%+VAT buyer's premium (classicarms.co.za auction terms); US gun-shop consignment runs 15-25%; GearTrade pivoted its whole business from P2P to consignment because casual sellers won't photograph/list/ship. Offer a white-glove intake: heirs/downsizers submit one form, GG (or a partner dealer for firearms, using the existing SAP-534 dealer-transfer rail) grades, photographs, lists and ships, for a 15-20% commission. Estates are where the best-condition rifles, optics and safari gear enter the resale market, and SA has no online-native player doing this. Moat: nobody else has the compliance automation.

**Critic verdicts:**
- *feasibility:* **SOUND** — Mostly operational; platform needs only an intake form + admin-managed listing creation (existing admin patterns) and the firearm legs ride the live SAP-534 dealer-transfer rail. One design decision: who the 'seller' User is for consigned items (GG house account vs estate account) affects KYC/payout wiring — decide before building. Large is right mostly for ops, not code.
- *compliance:* **NEEDS-CHANGE** — Two hard guardrails: (1) FCA — GG must never take possession of firearms or ammunition; estate firearms may only be held and transferred by the licensed dealer partner (the finding says this — make it structurally impossible, not procedural); (2) Second-Hand Goods Act 6 of 2009 — taking in and reselling used goods as a business makes the intake party a second-hand goods dealer requiring SAPS registration, registers and holding-period compliance. Structure so the registered party (GG registers, or the partner dealer) physically receives all stock. Estates also involve executor authority — require letters of executorship before intake.
- *business:* **REJECT** — Wrong stage: white-glove grading/photographing/listing/shipping is manual per-item labour — the definition of what doesn't scale for a solo operator. If revisited later, the viable shape is dealer-executed consignment (partner does the physical work, GG provides the rails and takes a platform cut), not GG-as-consignee.

### competitors-8 · Run trade-in days with dealers, ranges and SA Hunters branches (SidelineSwap×DICK'S playbook)
**Impact:** high · **Effort:** large · **Revenue:** Direct: margin on resale of traded-in gear plus new-buyer acquisition at near-zero CAC

SidelineSwap's growth engine is ~500 trade-in events/year at DICK'S stores — instant gift cards (avg $88) for used gear, resold on the marketplace; Out&Back does the same inside DICK'S/Public Lands; REI's trade-in pays 10-40% of retail in store credit. SA translation: partner with gun shops, shooting ranges and SA Hunters' 80 branches (40,000 members) for gear-drive days where GG issues platform credit for accepted gear and lists it. Credit recirculates as GMV. This simultaneously solves supply, acquisition and the cold-start problem in new categories (fishing, camping). Moat once branch relationships are signed.

**Critic verdicts:**
- *feasibility:* **NEEDS-CHANGE** — The playbook hinges on issuing recirculating platform credit, and NO credit/wallet ledger exists anywhere in this codebase — building one on a manual-EFT rail is a significant new money subsystem with its own Client-Funds-Payable accounting implications (compounding the Zoho CFP gap). Correction for v1: pay accepted gear via the existing FNB payout batch (cash, not credit), or issue single-use discount codes, and only build a credit ledger if the events prove out. With that substitution the rest is ops/partnership work, not code.
- *compliance:* **NEEDS-CHANGE** — Same Second-Hand Goods Act exposure as consignment: acquiring used goods for credit and reselling is second-hand goods dealing — SAPS registration (premises-linked, which complicates roving events; run intake through the registered partner's premises) plus record-keeping. Firearms at events must be handled exclusively by the licensed dealer partner. Platform credit should be structured as a CPA s63 prepaid voucher (min 3-year validity, disclosed terms), not stored value that resembles e-money.
- *business:* **REJECT** — Wrong stage: physical event operations, on-the-spot grading, and a platform-credit liability system (a whole new financial product) for a one-person shop. The SidelineSwap playbook assumed staff and capital. Park until there's a team or a partner who owns the physical side.

### competitors-9 · Sign distribution partnerships with 4x4community, Sealine and club forums
**Impact:** medium · **Effort:** medium · **Revenue:** Indirect-to-direct: channels existing P2P deal flow through GG's fee-bearing rails

4x4community.co.za classifieds and Sealine's Buy/Sell/Swap tackle forum are the highest-intent SA outdoor resale audiences, but both are pure text boards with zero payments, logistics or protection — and Sealine bans commercial ads, keeping it hobbyist. Offer embeddable 'sell it safely on Gun Galore' listing widgets, a club-verified badge for members, and a % -of-fees kickback to the forum/club (fundraiser framing for SA Hunters branches). Forum reputation becomes imported trust; GG becomes the transaction layer those communities never built. Growth loop with moat characteristics (exclusive relationships).

### competitors-10 · Add paid visibility products: listing Bump and Shop Spotlight
**Impact:** medium · **Effort:** small · **Revenue:** Direct: high-margin ancillary revenue, proven at every peer marketplace

Vinted monetises sellers voluntarily via Item Bump ($0.75-$3) and Closet Spotlight ($6.95/week); Depop's boosted listings take 8% only on boosted sales; Bob Shop sells listing enhancements. GG equivalents: R15-R35 bump-to-top per category, R79/week shop spotlight carousel, with PRO subscribers getting monthly bump credits (subscription synergy). Pure-margin revenue that doesn't raise the transaction take-rate, and trivially A/B-testable. Table stakes for marketplace monetisation.

### competitors-11 · Fold marketplace perks into MEMBER/PRO tiers (BackpackingLight gating)
**Impact:** medium · **Effort:** small · **Revenue:** Direct: subscription upgrades; the fee discount is self-funding via volume

BackpackingLight successfully gates its entire Gear Swap behind paid membership — scarcity of trusted venues makes people pay. Don't gate GG's marketplace, but add tier perks: reduced buyer-protection fee for MEMBER/PRO, early access (2h head start) to fresh listings in followed categories, free monthly bumps, saved-search instant alerts. REI's model shows resale access as a membership benefit drives membership sales. Small build on the existing subscription system.

### competitors-12 · Charge a buyer's premium on AUCTION listings
**Impact:** medium · **Effort:** small · **Revenue:** Direct: premium on every auction settlement, priced against a 17.25% incumbent

ClassicArms charges 15% + VAT (17.25% effective) buyer's premium and buyers pay it without complaint because auction is where rare/collectible firearms and optics trade; Bob Shop's success fees (1-5%, capped R5,000) show the low end. GG's AUCTION listing type can carry a 5-8% buyer's premium — well under ClassicArms — positioned as 'still far cheaper than the auction house', with the held-funds protection ClassicArms doesn't offer online. Immediate revenue on an existing feature.

### competitors-13 · Offer an 'Instant Offer' dealer-bid channel for sellers who want cash now
**Impact:** medium · **Effort:** medium · **Revenue:** Direct: dealer-side fees plus retained transactions that would otherwise leave the platform

Cash Converters (~350 stores) and Cash Crusaders (~180) exist because many sellers prefer instant cash over waiting weeks — they just pay brutally low prices. GG version: seller ticks 'accept instant offers', vetted PRO dealers get a feed and bid; seller trades ~15-25% of value for immediacy; GG takes a lead/transaction fee from the dealer. Keeps impatient supply on-platform instead of leaking to pawn shops, and gives dealer subscribers a reason to pay for PRO.

### competitors-14 · Build a 'What's my gear worth?' price guide from sold-listing data
**Impact:** medium · **Effort:** medium · **Revenue:** Indirect: seller acquisition via SEO now; powers priced trade-in/instant-offer products later

Out&Back's instant-quote engine and SidelineSwap's value data are core to their trade-in flows; REI prices trade-ins at 10-40% of original retail. GG should log every sold price into a category/brand/condition price index and expose a free valuation tool — the SEO magnet ('what is my Tikka T3x / Frontrunner tent / Stealth kayak worth used?') that pulls sellers in, and the pricing brain behind instant offers, trade-in credit and listing-price suggestions. Compounds with GMV into a data moat nobody in SA can replicate without the transaction history.

### competitors-15 · Counter-position marketing: 'the anti-Gumtree' scam-safety wedge
**Impact:** medium · **Effort:** small · **Revenue:** Indirect: lowers acquisition cost by converting scam-burned Gumtree/Marketplace users

ESET reports 1 in 6 users defrauded on Facebook Marketplace; the dominant SA scam is a fake 'safe delivery' WhatsApp link against Gumtree/Marketplace sellers (News24/PE Express), and Gumtree's Trustpilot is scathing. GG's real differentiators — KYC'd sellers, payment held until delivery, platform-booked couriers, username-only privacy — map one-to-one onto each scam vector. Produce category content ('How to buy a used rifle scope / trail camera / camping fridge in SA without being scammed') for SEO, plus an in-product 'why this is safe' explainer at checkout. Cheap, and it weaponises the incumbents' biggest weakness.

### competitors-16 · Add stale-listing liquidity mechanics: price-drop bumps and watcher alerts
**Impact:** medium · **Effort:** small · **Revenue:** Indirect: higher sell-through means more fee-bearing transactions from the same supply

BackpackingLight's Gear Swap rule — you may only bump a for-sale post if you cut the price at least 10% — is an elegant liquidity forcer. GG version: after 14 days unsold, prompt the seller with the price-guide suggested cut; a price drop triggers a free bump plus push/email to everyone watching or with a matching saved search. Vinted/Depop favourite-price-drop alerts are among their highest-converting notifications. Table stakes for sell-through rate.

### competitors-17 · Pursue 'official resale partner' white-label deals with SA outdoor retailers
**Impact:** high · **Effort:** epic · **Revenue:** Direct: B2B service fees plus exclusive high-quality supply feeding marketplace GMV

SidelineSwap became Rawlings' Official Resale Partner and powers trade-in at hundreds of retail locations; GearTrade now sells branded-resale services to outdoor brands; Out&Back runs NEMO's trade-in. SA targets: Safari Outdoor, Outdoor Warehouse, Tentco, Camp Master stockists — GG powers their trade-in/certified-pre-owned channel (they issue store credit, GG resells). Long-cycle enterprise selling, but the winner takes the category: whoever owns retail trade-in owns supply. Defensible moat; sequence after trade-in events prove the mechanics.

**Critic verdicts:**
- *feasibility:* **SOUND** — Correctly sequenced after trade-in events and correctly sized as epic; near-zero code today (it's enterprise BD). No architecture conflict — but it inherits the same platform-credit dependency flagged on the trade-in finding if store-credit mechanics are promised.
- *compliance:* **SOUND** — The retail partner takes in and holds the goods, so Second-Hand Goods Act registration and any FCA dealer duties sit with the partner — allocate that explicitly by contract. Long-cycle B2B; no platform-side exposure beyond that.
- *business:* **REJECT** — Epic enterprise sales cycle with zero near-term revenue, and the finding itself sequences it after trade-in events — which are also parked. Keep as a strategy note; spend zero build or sales hours on it now.

### competitors-18 · Ride the resale-boom narrative with cost-of-living positioning
**Impact:** low · **Effort:** small · **Revenue:** Indirect: PR-driven organic acquisition and category-authority SEO

Global secondhand apparel grew ~15% in 2024 to $227B (headed to $367B by 2029), and Yaga's R80m raise (H&M Group participating) made SA resale headline news (bizcommunity/ITWeb). GG should publish a yearly 'SA Outdoor Resale Report' from its own data — average savings vs new per category, most-traded brands — for PR, and run 'gear up for half price' seasonal campaigns (hunting season, December camping). Cheap brand-building that positions GG as the category authority before anyone else claims it.

## G. Camping & overlanding research

**Auditor summary:** SA camping/overlanding retail splits into two distinct trees that Gun Galore must merge: general camping (Outdoor Warehouse, Camp & Climb: tents, furniture, camp kitchen, sleeping, lighting, gas, refrigeration, water/storage) and vehicle-based overlanding (Safari Centre, 4x4 Mega World, Front Runner/Dometic, Alu-Cab: roof racks, rooftop tents, awnings, 12V fridges, dual-battery/solar, recovery, drawer systems, canopies/campers) plus a high-ticket trailers-and-caravans vertical (Conqueror, Echo, Bushwakka — all of whom run their own "pre-loved" used desks, proving the secondhand demand). The used market is deep and price-stable: National Luna/Engel fridges resell at 50-60% of new (R5k-R9k), Howling Moon RTTs at ~35% of new (R10k-R12k vs R34k new), Front Runner racks R6k-R10k, 270 awnings R8.5k-R15k, Conqueror trailers R80k-R300k. Today this trade happens on Gumtree, Facebook groups and 4x4community.co.za classifieds with zero payment protection — courier/delivery fraud is SA's most common fraud type (~46% of consumers hit) — which is exactly Gun Galore's held-funds + KYC + integrated-courier wedge. Hard compliance gates exist: gas cylinders and fuel containers cannot be couriered at all (The Courier Guy prohibits all compressed gas/flammables), standalone lithium batteries are UN3480 Class 9 dangerous goods, and trailers/caravans need NaTIS papers + roadworthy on change of ownership — each needs a listing-policy and logistics rule, several mirroring the SAP-534 dealer-transfer pattern already built.


### camping-overlanding-1 · Adopt a two-tree camping + overlanding category map (≈14 top-level nodes)
**Impact:** critical · **Effort:** medium · **Revenue:** Direct — category coverage is the prerequisite for listing supply in the operator's stated expansion market

Merged from outdoorwarehouse.co.za, campandclimb.co.za, safaricentre.co.za, dometic.com/en-za (Front Runner) and alu-cab.com: (1) Tents & Shelter — ground/canvas/dome tents, gazebos, trailer tents, swags; (2) Rooftop Tents — softshell, hardshell/clamshell, accessories (ladders, annexes); (3) Awnings — pull-out, 270°, bag awnings, sides/annex rooms; (4) 12V Fridges & Freezers — single/dual-zone, fridge slides, covers, ice boxes; (5) Power & Electrical — dual-battery kits, DC-DC chargers, lithium/AGM batteries, inverters, solar (fixed/folding), power stations, 12V lighting; (6) Recovery Gear — winches, kinetic ropes/straps, traction boards, jacks, compressors, tyre repair; (7) Roof Racks & Load Bars + rack accessories; (8) Vehicle Storage — drawer systems, canopies, canopy campers, cargo boxes; (9) Camp Furniture — chairs, tables, stretchers, cupboards, camp kitchens; (10) Cooking & Braai — gas stoves/skottels, cast iron/potjie, grids, cookware, coffee; (11) Water & Fuel — tanks, jerry cans, showers/geysers, toilets, filtration; (12) Gas & Heating — cylinders, regulators, heaters (compliance-gated); (13) Lighting & Electronics — headlamps, lanterns, GPS, two-way radios; (14) Trailers & Caravans — off-road trailers, off-road caravans, camper conversions. Camp & Climb also validates hiking/packs and climbing as adjacent trees Gun Galore already partially covers.

**Critic verdicts:**
- *feasibility:* **SOUND** — Seed/admin work on the proven category system. Sequence after the admin-subcategory inheritance fix (firearm Hole 2) and note several children (RTTs, trailers, gas, lithium power) depend on the bulky/collection-only shipping and compliance-flag findings before they can actually transact.
- *compliance:* **SOUND** — Good that Gas & Heating is already marked compliance-gated. Sequence: activate the gas, battery and trailer nodes only after the corresponding DG/NaTIS policies (separate findings) are enforced server-side.
- *business:* **SOUND** — The best-researched taxonomy spec in the audit — make it the master input to the single consolidated seed migration (merging the site-UX depth finding and the taxonomy agent's overlanding tree, which overlap heavily).

### camping-overlanding-2 · Build vehicle-fitment as a first-class attribute for all vehicle-mounted gear
**Impact:** high · **Effort:** medium · **Revenue:** High-ticket segment (racks R6k-R10k used, canopies R15k-R40k) unlocked by searchability

Roof racks, canopies, drawer systems, bullbars, rock sliders, snorkels and suspension are vehicle-specific — every retailer (Safari Centre, Front Runner, Alu-Cab with per-vehicle accessory lines like 'Jimny Accessories', 'Land Cruiser Accessories', JimSA.co.za) organises them by make/model/cab-type/year. Used Gumtree listings are always titled by vehicle ('Front Runner rack for Prado 150', 'LC79 canopy'). Without make/model/generation + cab-config (single/extended/double cab) filters, buyers cannot find compatible items and this entire high-value segment stays on Facebook. Reuse pattern: a VehicleFitment attribute set (make, model, series/generation, year range, cab type) attached to listings in rack/canopy/drawer/armour categories.

**Critic verdicts:**
- *feasibility:* **SOUND** — Cleanly a client of the CategoryAttribute/JSONB system (make/model/generation/year-range/cab as SELECT/TEXT attributes on rack/canopy/drawer categories). No separate schema needed if the attribute system lands first — build it as attribute definitions, not a bespoke VehicleFitment model.
- *compliance:* **SOUND** — Catalogue work; no regulatory surface.
- *business:* **SOUND** — Correct: fitment is how the entire rack/canopy/drawer segment is searched, and without it the high-ticket vehicle-gear trade stays on Facebook. Sequenced behind the generic attribute system — build it as the flagship attribute set, not a separate mechanism.

### camping-overlanding-3 · Define per-category filter attributes buyers actually use
**Impact:** high · **Effort:** medium · **Revenue:** Better filters raise conversion on existing traffic; enables cross-sell engine to key on attributes

From retailer facets and classifieds patterns: Fridges — capacity litres (15/25/40/50/60/75/95), single vs dual-zone, compressor type (SECOP/Danfoss vs Engel swing motor), 12/24/220V, current draw, brand; RTTs — sleeps (2/3/4), mattress width (1.2/1.4/1.6/1.8/2.4m — Howling Moon's entire range is width-keyed), soft vs hard shell, closed height, weight (55-75kg matters for rack load), ladder/annex included; Batteries/power — Ah, chemistry (LiFePO4 vs AGM vs flooded), Wh, cycle count/age, BMS, brand (Victron/National Luna premium); Solar — watts, panel type, controller (MPPT/PWM); Awnings — coverage (straight vs 270°), freestanding or legs, side, mounted-side (left/right/rear); Tents — sleeps, canvas vs nylon, standing height; Trailers — year, GVM/tare, braked/unbraked, papers-in-hand, sleeps, water/battery capacity; Recovery — rated load (winch lb, strap tonnage). Condition grading + age + 'original receipt' flags matter more here than in most categories because gear is bought for remote-travel reliability.

**Critic verdicts:**
- *feasibility:* **SOUND** — Pure content/configuration on top of the attribute system (fridge litres, RTT mattress width, battery Ah/chemistry, etc.). No independent feasibility risk; blocked solely by the attribute-system build.
- *compliance:* **SOUND** — Catalogue work. Bonus: structured Ah/Wh and cylinder-test-date attributes are what make the DG shipping gates enforceable rather than honour-system.
- *business:* **SOUND** — This is the content spec the attribute system needs — verified against real retailer facets. Build it together with the attribute-system finding; the fridge/RTT/battery lists are exactly the right 'start with flagship attributes' scope.

### camping-overlanding-4 · Seed pricing guidance with verified used-price bands for the ~10 hero items
**Impact:** high · **Effort:** small · **Revenue:** Faster sale-through = more transaction fees; pricing data is also an Ask GG differentiator

Verified anchors (Gumtree/Bobshop listings vs new retail, June 2026): National Luna Weekender 50/52 twin used R6,999-R9,000 (new ~R18-21k); Engel MT45 40L used R5,000-R8,000 (new R12,879-R20k; Engels hold value best — swing-motor longevity is folklore); SnoMaster 41-98L used R4k-R9k (new R8,999-R16,999); Howling Moon Stargazer RTT used R10,000-R12,000 (new R34,130 — i.e. ~35% residual, tents depreciate hard vs fridges at 50-60%); Front Runner Slimline II used R6,000-R10,000 (new R10k-R16k fitted); 270° awnings used R8,500-R15,000; Conqueror trailers 2005 Conquest R79,900 → 2016 Conquest II R295,000; off-road caravans (Echo Kavango, Bushwakka Sundowner) R250k-R750k. A 'typical used price' hint at listing time (like the Load Lab data-not-AI pattern) reduces overpricing — the #1 reason classifieds listings go stale.

**Critic verdicts:**
- *feasibility:* **SOUND** — Small static-data hint in the sell flow, matching the Load Lab data-not-AI pattern. Keep bands as labelled guidance (they'll date quickly) and treat it as the stopgap the price-estimator tool later supersedes.
- *compliance:* **SOUND** — Label bands as indicative market data, not a GG valuation, to avoid misleading-representation exposure (CPA s41). Otherwise no regulatory surface.
- *business:* **SOUND** — Small, data-not-AI, directly attacks the #1 classifieds failure (overpricing → stale listings). This IS the correct v1 of the AI price-estimator finding — ship this, park that.

### camping-overlanding-5 · Launch a Trailers & Off-Road Caravans vertical with NaTIS papers workflow
**Impact:** high · **Effort:** large · **Revenue:** Even a 1-2% success fee on R300k caravans dwarfs current ticket sizes

This is the highest-ticket category in SA overlanding (R80k-R750k used) with proven trade: Conqueror, Conqueror JHB, Echo and Bushwakka all run in-house 'pre-loved' desks, plus Gumtree/AutoTrader/CaravanParks/outdoorcampers.co.za sections. Change of ownership legally requires the NaTIS registration certificate from the seller, a roadworthy certificate, and re-registration within 21 days (gov.za, westerncape.gov.za). Gun Galore should require VIN/chassis + registration-paper photo at listing time and ship a buyer/seller ownership-transfer checklist — structurally similar to the SAP-534 dealer-transfer flow already built, but without a licensed intermediary. Delivery is collection or transport-broker only (no courier), so PRIVATE_ARRANGE-style completion applies.

**Critic verdicts:**
- *feasibility:* **SOUND** — Feasible: VIN/registration-photo capture mirrors the serial/licence vision capture on firearm listings, the admin doc-review pattern exists, and completion is the same collection-only/PRIVATE_ARRANGE-style seam the bulky-goods finding builds. Hard dependency on that non-courier method landing first; large is right.
- *compliance:* **NEEDS-CHANGE** — NaTIS registration certificates contain owner names and ID numbers — POPIA: collect only for the stated verification purpose, never display on public surfaces, encrypt at rest (reuse the SA-ID encryption pattern from KYC/SAP-534), and delete per retention policy. Also word the checklist so GG is clearly a facilitator: change of ownership, roadworthy and 21-day re-registration are the parties' statutory duties, not something GG effects or certifies.
- *business:* **NEEDS-CHANGE** — Highest ticket in the segment, but don't build a bespoke papers workflow for zero current supply. V1: open the category as collection-only/PRIVATE_ARRANGE with a required registration-paper photo and a static ownership-transfer checklist. Build the structured NaTIS workflow only when listings actually appear.

### camping-overlanding-6 · Enforce a gas (LPG) listing policy: collection-only, empty, and no branded exchange cylinders
**Impact:** critical · **Effort:** small · **Revenue:** None/indirect — this is liability avoidance; a gas incident from a couriered cylinder is existential for a firearms-adjacent regulated marketplace

The Courier Guy's T&Cs prohibit ALL compressed gas (butane, propane tanks, aerosols) — so gas cylinders can never enter the platform's courier flow, even empty; Pudo lockers likewise. Legally (lpgas.co.za, SANS 10019/10087, safegasnetwork.co.za): commercially branded cylinders (Cadac 9kg exchange, Easigas etc.) remain the brand owner's property and may only move through official exchange channels — private resale of branded exchange cylinders is restricted; cylinders also carry 10-year test dates. Policy: gas APPLIANCES (stoves, skottels, heaters, lanterns) freely tradable; CYLINDERS collection-only, listed empty, non-branded/user-owned only, with a test-date field. Caravans with fixed gas installations should disclose whether a SAQCC-registered installer CoC exists.

**Critic verdicts:**
- *feasibility:* **SOUND** — Small: per-category compliance flags (collection-only + policy copy + optional test-date attribute) on rails that already do per-category gating (isFirearm precedent). Depends on the collection-only shipping method existing; until then the safe interim is keeping cylinder categories unseeded.
- *compliance:* **SOUND** — Endorse as written — the policy is correct (courier prohibition even when empty, branded exchange cylinders remain brand-owner property, 10-year test dates, CoC disclosure for fixed installations). One strengthening: enforce it server-side in the shipment-booking seam (cylinder categories blocked from Pudo/TCG booking), not as policy copy alone.
- *business:* **SOUND** — Small, pure liability shield, and non-optional for a regulated-adjacent marketplace — a couriered cylinder incident would be existential. Ship the policy with the camping category launch, not after.

### camping-overlanding-7 · Set a lithium-battery shipping rule: Wh threshold gates courier vs collection-only
**Impact:** critical · **Effort:** small · **Revenue:** None/indirect — prevents carrier account suspension (TCG/Pudo are load-bearing for the whole platform)

Standalone lithium batteries are UN3480, Class 9 dangerous goods (IATA guidance, fedex.com/en-za, tnt.com/en_za); The Courier Guy's prohibited list covers dangerous/inflammable materials, and batteries INSIDE devices (fridge with internal battery, power station shipped as equipment) are treated more leniently than loose cells. Practical policy: ≤100Wh (headlamp/GPS batteries) ships normally; portable power stations ship at courier discretion as contained-battery devices; large loose LiFePO4 house batteries (100Ah/1,280Wh — the hot secondhand item post-loadshedding) = collection-only or specialised DG carrier. Encode as a per-category shipping-eligibility flag in the existing shipment-booking seam (project_shipment_booking) so ineligible items never reach Pudo/TCG booking.

**Critic verdicts:**
- *feasibility:* **SOUND** — Same seam as gas: a per-category shipping-eligibility flag enforced in listing validation and the P5.2 booking path. The Wh threshold needs either an attribute field or category-level split (loose LiFePO4 house batteries = collection-only category). Small, and correctly framed as carrier-account protection.
- *compliance:* **SOUND** — Endorse — UN3480/Class 9 analysis and the ≤100Wh / contained-device / loose-large-battery tiering match carrier practice. Encode the Wh gate server-side in the booking seam as proposed; carrier account suspension (TCG/Pudo are load-bearing) and DG liability are the real risks.
- *business:* **SOUND** — Small and protects the two carrier accounts the entire platform stands on. The per-category shipping-eligibility flag is the same seam the gas policy and bulky-goods work need — build once.

### camping-overlanding-8 · Prohibit couriering fuel containers unless new/unused; flag used jerry cans collection-only
**Impact:** medium · **Effort:** small · **Revenue:** none/indirect

Flammable liquids and their residues are courier-prohibited (thecourierguy.co.za T&Cs); a 'dry' used petrol jerry can still carries vapour and fails carrier rules. Camp & Climb sells fuel containers under Storage, and used NATO-style steel cans trade actively (R300-R800). Policy: new/sealed fuel containers courier-eligible; used ones collection-only with a listing-time attestation. Water containers unaffected. Small rule, closes a real carrier-violation vector.

### camping-overlanding-9 · Solve big-and-heavy freight — the structural gap blocking the best inventory
**Impact:** high · **Effort:** large · **Revenue:** Directly unlocks the R5k-R35k mid-ticket segment (fridges, RTTs, awnings, racks) for national trade

The hero items breach standard courier limits: RTTs are 55-75kg and 2.4m long, 50L fridges ~25-30kg boxed but bulky, roof racks are 2m+ flat-pack, trailers unshippable. Pudo lockers cap far below this and TCG standard parcels too; today Facebook sellers simply refuse to ship, capping their market to their city — a core frustration Gun Galore can own. Extend the P5.2 platform-arranged dispatch with a TCG/ShipLogic oversized or pallet-freight service level (both support heavier billable weights on D2D), plus an explicit 'collection-only' listing mode with the existing PRIVATE_ARRANGE-style completion so heavy items can still transact under held-funds protection.

**Critic verdicts:**
- *feasibility:* **SOUND** — Two independently buildable halves: (a) collection-only listing mode with held-funds completion (the PRIVATE_ARRANGE-for-non-firearms seam — smallest path to unlock trailers/RTTs), and (b) ShipLogic oversized/pallet service levels, which is real integration work against TCG's heavier D2D rates. Ship (a) first; 'large' applies to (b).
- *compliance:* **SOUND** — Ensure the DG exclusions (gas cylinders, large lithium batteries) and the firearm exclusion apply equally to the new oversized/pallet service level and the collection-only mode — new fulfilment paths must inherit all existing gates.
- *business:* **NEEDS-CHANGE** — Split: the collection-only listing mode with held-funds completion is the cheap 80% and is a shared dependency of five other findings — build it now. The oversized/pallet-freight courier integration is the expensive 20%; defer until collection-only listings prove the demand exists.

### camping-overlanding-10 · Time merchandising to the SA overlanding calendar
**Impact:** medium · **Effort:** small · **Revenue:** Seasonal campaigns lift both listing supply and conversion at zero infra cost

Demand peaks: Easter/April school holidays, June-July winter school holidays (Kruger dry season — lodges 'booked solid by July', safaribookings.com, krugergatehotel.com), September holidays, and the December festive season (bookings up to a year ahead). Gear-buying runs 4-8 weeks ahead of each peak (Feb-Mar, May-Jun, Oct-Nov), and Jan-Feb is the sell-off window (post-holiday credit stress + gear that disappointed) — the best supply-acquisition moment. Caravan/outdoor shows (Beeld Holiday Show Feb, regional 4x4 expos) also churn gear as owners upgrade. Feed this into homepage merchandising, cross-sell weighting and 'sell your gear' campaigns.

### camping-overlanding-11 · Position against Facebook/Gumtree fraud as the acquisition wedge
**Impact:** high · **Effort:** medium · **Revenue:** This is the customer-acquisition thesis for the whole outdoor expansion

Current venues: 4x4community.co.za classifieds (the trusted core forum since 2006, but forum-mechanics, no payments), Gumtree camping-gear section, Facebook groups ('4x4 and Offroad Equipment Buy & Sell South Africa', 'Camping Equipment For Sale South Africa', Afrikaans koop-en-verkoop groups), JunkMail, Bobshop, and campandlive.co.za's small marketplace. Pain points are documented: courier/delivery fraud is the most common fraud type in SA (~46% of consumers in the past year, sasfin.com/dailyinvestor.com), fake proof-of-payment scams against sellers, fake-giveaway scams in Afrikaans groups (africacheck.org), and no payment protection anywhere except Gumtree's little-used Pay&Ship. Gun Galore's existing stack — KYC'd sellers, funds held until delivery, reference-matched EFT, integrated tracked couriers, username-only privacy — is precisely the antidote; market it with 'never EFT a stranger again' messaging into those groups and consider a white-glove listing-concierge for 4x4community power-sellers.

**Critic verdicts:**
- *feasibility:* **SOUND** — Marketing motion on capabilities that verifiably exist (KYC, funds held, reference-matched EFT, tracked couriers, username-only). Mind the standing copy rules: never 'escrow', usernames only. No build risk.
- *compliance:* **SOUND** — CPA s41 hygiene on the marketing claims: 'never EFT a stranger again' and any 'protection' language must accurately describe what the platform delivers (funds held until delivery confirmation, mediated disputes) — align the copy with the protection-fee wording review so marketing doesn't promise indemnity the T&Cs don't.
- *business:* **SOUND** — This is the correct acquisition thesis for the whole expansion — the trust stack already exists and the fraud pain is documented. Timing: launch the messaging only after the taxonomy/copy/collection-only work lands, so arriving buyers find a marketplace that can actually serve them.

### camping-overlanding-12 · Court dealer 'pre-loved' desks and trade-in consignment as a supply seam
**Impact:** medium · **Effort:** medium · **Revenue:** Dealer listings are recurring, high-ticket, low-moderation supply

Conqueror (conqueror.co.za/product-category/pre-loved-campers), Conqueror JHB, Bushwakka ('Used Trailers & Caravans' section) and multi-brand used dealers (outdoorcampers.co.za) all maintain used inventory — manufacturers are already in the secondhand business because trade-ins fund new sales. A dealer-seller account type (bulk listing, storefront page, existing PRO tier) could bring this professionally-refurbished, papers-clean inventory onto the platform, giving the trailers vertical instant credible supply the way firearm dealers anchor the guns side.

### camping-overlanding-13 · Build brand taxonomy/landing pages for the SA-iconic overlanding brands
**Impact:** medium · **Effort:** small · **Revenue:** SEO capture of high-intent brand queries; near-zero build cost on existing category infra

Secondhand search in this market is brand-first: National Luna, Engel, SnoMaster, Howling Moon, Eezi-Awn, Front Runner, Alu-Cab, Conqueror, Echo, Jurgens, Bushwakka, Quick Pitch, Tentco, Campmor, Oztrail, Victron. Every retailer surfaces brand navigation (Outdoor Warehouse /brands/national-luna, Safari Centre lists Iron Man/Outback Extreme per category), and Gumtree searches are brand-keyed. A brand attribute + SEO landing pages ('Used National Luna fridges for sale South Africa') captures the exact long-tail queries this research surfaced, where current organic results are Gumtree pages.

### camping-overlanding-14 · Note Front Runner's absorption into Dometic when building the brand map
**Impact:** low · **Effort:** small · **Revenue:** none/indirect — taxonomy hygiene

frontrunneroutfitters.com/en/za now 301-redirects to dometic.com/en-za — Front Runner's SA storefront has been folded into Dometic's, whose tree adds useful activity-based navigation (Overlanding, Car Camping, Fishing, Vanlife) worth copying as a browse dimension alongside categories. Keep 'Front Runner' as the listing brand (that is what the used gear is stamped and searched as) but expect Dometic-branded fridges/awnings to appear in supply too.

## H. Fishing & clothing research

**Auditor summary:** Gun Galore today has a flat 11-child "Fishing" category (Reels, Rods, Lures, Carp Baits, Lines, Terminal Tackle, apparel/footwear/headwear, a vague "Fishing By Technique") in backend/prisma/seed.ts, a generic 5-grade Condition enum (NEW/LIKE_NEW/GOOD/FAIR/POOR) in schema.prisma, and no structured attributes (no brand, size, rod class/length, reel size fields) on listings. Research confirms SA fishing licences (DFFE marine e-permit, provincial freshwater angling licences) regulate the ACT of fishing, not the sale of used gear — the only gear whose possession/sale is legally sensitive is netting (gill nets, seine/trek nets; cast nets are permit-endorsed and province-restricted), so a small deny-list suffices. The SA used-tackle trade lives on Sealine forum classifieds, Gumtree/Junk Mail and Facebook groups, all payment-unprotected and plagued by fake-EFT-proof scams — exactly the trust gap GG's funds-held + verification model closes; high-value secondhand (Stella/Saltiga offshore reels, Sage-class fly kit, Hobie kayaks, fish finders) carries R1k–R50k+ tickets. On apparel, Vinted/Poshmark/Depop show the playbook GG lacks: 5-tier condition with "New with tags", mandatory size + measurements, own-photos-only with flaw close-ups, buyer-pays-cheap-locker shipping, bundle discounts to amortise courier cost, and a short item-not-as-described window; SA competitor Yaga (0% seller fee, R14.95+5% buyer fee, Paxi/Pudo/Aramex/PostNet shipping, 1-hour bundling) owns fashion resale but is weak in hunting/outdoor technical apparel — GG's wedge. Low-ticket apparel is only viable with Paxi-class R60 shipping and bundling; a R150 fleece over a R100 courier is dead on arrival, so shipping choice + multi-buy (P8a cart already live) is the economic unlock.


### fishing-clothing-1 · Rebuild Fishing as a discipline-first tree with structured rod/reel attributes
**Impact:** high · **Effort:** medium · **Revenue:** Filterable discipline/attribute search is what makes GG usable vs Facebook groups; directly drives fishing GMV

Current seed.ts has one flat 'Fishing' parent with generic children and an empty-promise 'Fishing By Technique' child. SA's dominant retailer taxonomy (kingfisher.co.za) splits by discipline first — Offshore, Rock & Surf, Bass, Carp, Fly (add Artlure/estuary and Kayak/Float-tube) — each with Rods/Reels/Tackle/Baits/Storage/Combos beneath. Attributes buyers filter on: rods = discipline, cast weight/line class (e.g. 4–6oz surf, 12–15kg jigging, 5wt fly), length (6–14ft+), pieces (1/2/3, travel), blank type; reels = type (coffee-grinder spinning, multiplier/conventional, baitrunner, big-pit carp, fly), size (1000–25000 spinning; 6500-class multipliers like Daiwa Sealine/Penn), gear ratio, line capacity, left/right hand; terminal tackle by discipline (sinkers/traces for surf, method feeders/bolt rigs for carp, jigheads/spinnerbaits for bass, tippet/leader for fly). Reuse the calibre-style hard-attribute seam noted at schema.prisma line ~560 (cross-sell compatibility) so attributes also power 'you might also need'.

**Critic verdicts:**
- *feasibility:* **SOUND** — Consistent with the taxonomy-stream fishing finding: discipline as a filterable attribute + tree cleanup. Depends on the attribute system; the cross-sell attribute-keying bonus is real (CategoryRelation engine already narrows by calibre/make).
- *compliance:* **SOUND** — Taxonomy/attribute work; no regulatory surface.
- *business:* **SOUND** — Right spec; merge with the taxonomy agent's fishing finding (they overlap ~90%) and implement discipline as a filterable attribute per that finding's own insight. Part of the single taxonomy migration.

### fishing-clothing-2 · Add Fishing Electronics and Fishing Craft categories (fish finders, kayaks, float tubes)
**Impact:** high · **Effort:** medium · **Revenue:** Highest average ticket in the fishing vertical (R15k–R60k used Hobies); even low volume moves GMV meaningfully

No home exists today for fish finders/chartplotters (Garmin Striker/Echomap, Lowrance Hook, Humminbird — R3.5k–R25k new via animalgear.co.za, kayakfish.co.za; used ~40–60% of retail) or for craft: fishing kayaks (Hobie Mirage/Pro Angler pedal kayaks R40k–R120k new via hobie.co.za, used R15k–R60k; local Stealth/Fluid paddle kayaks R6k–R20k), float tubes/kick boats (R2k–R8k). Craft can't ship Pudo/TCG parcel — needs a 'collection only / freight quote' listing flag, which also unlocks gun safes, camping furniture and other bulky outdoor goods. Attributes: screen size, transducer included Y/N, GPS/side-imaging for electronics; length, propulsion (pedal/paddle/motor-mount), capacity for kayaks.

**Critic verdicts:**
- *feasibility:* **SOUND** — Category seed work plus the same collection-only/freight flag dependency for craft. Attributes ride the attribute system. No independent risk.
- *compliance:* **SOUND** — Fine; the 'collection only / freight quote' flag it introduces must carry the same server-side non-firearm restriction as the overlanding bulky-goods method.
- *business:* **SOUND** — Highest average ticket in the vertical and currently homeless. Depends on the collection-only flag for craft — same shared seam. Fold into the taxonomy migration.

### fishing-clothing-3 · Confirmed: angler licences do NOT restrict marketplace gear sales — but deny-list nets
**Impact:** medium · **Effort:** small · **Revenue:** None directly; avoids MLRA compliance embarrassment and builds the 'compliant marketplace' brand firearms buyers already trust

DFFE recreational marine e-permits (fishing.dffe.gov.za) and provincial freshwater angling licences (e.g. CapeNature R45 under the Nature Conservation Ordinance) attach to the activity of fishing, never to owning or selling rods/reels/tackle — no licence check is needed at checkout, mirroring how GG already handles non-firearm gear. The exception is netting under the Marine Living Resources Act: gill nets/set nets/drift nets and beach-seine (trek) nets require commercial permits even to possess on a vessel, and recreational cast nets are permit-endorsed, size-capped (max 6m diameter in W. Cape) and province-restricted (bait-only species lists, KZN inland prohibitions per DFFE permit conditions). Action: block 'gill net', 'trek net', 'seine net' listings via the existing prohibited-keyword seam, allow cast nets with a compliance note, and publish a short 'fishing gear & the law' help page for SEO/trust.

### fishing-clothing-4 · Target high-value used-tackle segments with ZAR price-band guidance
**Impact:** medium · **Effort:** medium · **Revenue:** Direct — high-ticket reels/rods at GG's commission beat dozens of R150 items; pricing guidance lifts conversion

Observed secondhand bands: premium offshore spinning (Daiwa Saltiga, Shimano Stella — new R20k–R33k at kingfisher.co.za/basilmanning.co.za, used typically R8k–R18k); mid offshore/jigging (Saltist, Twin Power, Penn Spinfisher R2k–R7k used); rock & surf combos R1.5k–R5k (Sealine classifieds show rods R2.3k–R4.2k, reels ~R2.8k); commodity reels R150–R900 (Gumtree observed range); fly — new Sage rods R13.65k–R13.95k at xplorerflyfishing.co.za, used premium fly rods R4k–R9k, used Stealth reel R850 observed, entry combos (Xplorer/Stealth local brands) R1k–R2.5k; big-pit carp reels (Shimano Ultegra/Daiwa Emblem) R1.5k–R4k used. Surfacing 'typical used value' bands per model (the cross-sell engine's data seam could learn these from sold listings) reduces mispricing — the #1 friction on Gumtree/Facebook.

### fishing-clothing-5 · Poach the Sealine/Facebook used-tackle trade by selling the trust gap
**Impact:** high · **Effort:** small · **Revenue:** Supply acquisition — liquidity is the whole game for the fishing vertical

SA's used-tackle liquidity sits in sealine.co.za's Buy/Sell/Swap/Donate forum (non-commercial, no payments, phone/email deals), Gumtree/Junk Mail, and Facebook groups (e.g. 'Flyfishing Gear 2nd hand or Unwanted - SOUTH AFRICA'), all cash/EFT with zero protection; fake proof-of-payment EFT scams are endemic in SA Facebook sale groups (paysho.co.za, aquariumadvicesa reports) and fake tackle shops impersonate retailers. GG's funds-held-until-delivery, KYC'd sellers, proof-of-possession vision checks and courier integration are a category-killer pitch for exactly this audience. Marketing motion: SEO pages per discipline ('used rock & surf tackle South Africa'), respectful presence in those communities, and the existing SWOP mode is uniquely suited to tackle-swapping culture (Sealine literally has 'Swap' in the forum title).

**Critic verdicts:**
- *feasibility:* **SOUND** — Marketing/SEO motion; the SWOP-fits-tackle-swap-culture observation is accurate (module is live end-to-end incl. PoP). Discipline SEO pages depend on the fishing tree/attribute work for landing surfaces.
- *compliance:* **SOUND** — Marketing motion; same s41 accuracy note on protection claims. Respectful community presence carries no regulatory issue.
- *business:* **SOUND** — Cheap, targeted supply acquisition, and the SWOP-mode fit with tackle-swap culture is a genuinely differentiated hook no incumbent has. Execute alongside the broader anti-fraud positioning motion.

### fishing-clothing-6 · Adopt apparel-grade listing schema: sizes, measurements, fit notes, New-with-tags
**Impact:** high · **Effort:** medium · **Revenue:** Prerequisite for any apparel GMV; size filters are non-negotiable for clothing buyers

schema.prisma's Condition enum (NEW/LIKE_NEW/GOOD/FAIR/POOR) is close to Vinted's proven 5-tier (New with tags / New without tags / Very good / Good / Satisfactory) but listings have no size, brand, gender/age, or measurement fields at all. For apparel/footwear add: structured size (SA/UK letter+numeric for clothing; SA/UK/EU/US for footwear since Courteney uses UK sizing), brand picker backed by a brand catalogue table, garment measurements (pit-to-pit, length — resellers' standard defence against fit disputes), and optional fit note ('runs small'). Per Vinted research, inaccurate condition grading is the top driver of negative reviews and search-visibility loss, so show grade definitions with photo examples at listing time.

**Critic verdicts:**
- *feasibility:* **SOUND** — Size/measurements/fit are attribute-system clients; a brand catalogue table is an additive model. One correction consistent with the condition-enum constraint: 'New with tags' should be a boolean attribute or label refinement on NEW, not a Condition enum change.
- *compliance:* **SOUND** — Catalogue work. One policy note for the apparel vertical generally: prohibit current SANDF-issue uniform/insignia items (unauthorised possession/wearing is an offence under the Defence Act) — civilian camo is unrestricted.
- *business:* **SOUND** — Non-negotiable prerequisite for any clothing GMV and rides the attribute system rather than needing new machinery. Sequence with the clothing category launch, after the attribute system exists.

### fishing-clothing-7 · Enforce apparel photo standards and a short not-as-described window
**Impact:** medium · **Effort:** small · **Revenue:** Reduces disputes/refund admin on the lowest-margin category

Platform norms: own photos only (Depop bans stock photos; Poshmark flags them), flaw close-ups (stains/rips/zips), a tag/label shot for size+authenticity, 4–8 photos, square crop. Returns: Poshmark allows 'item not as described' claims only within 3 days of delivery with photo proof — fit/change-of-mind is not returnable; Depop forces refunds only for undisclosed flaws. GG's funds-held + delivery-confirmation flow already implements the hold; formalise a 48–72h SNAD window for apparel (matching the existing swap 48h verification pattern) and publish that fit issues are not refundable, which protects sellers and keeps CPA-compliant expectations explicit.

### fishing-clothing-8 · Solve low-ticket apparel economics with Paxi-class shipping + bundle mechanics
**Impact:** critical · **Effort:** large · **Revenue:** Determines whether the entire clothing vertical can exist profitably; combined shipping also lifts basket size platform-wide

Courier reality (deliverai.co.za June 2026 index): Paxi via PEP is R59.95 (450x370mm bag, 5kg, 7–9 days) — SA's cheapest parcel, with a R109.95 large tier; Pudo locker-to-locker ~R85 sub-5kg; door courier R100+. A R150 fleece + R85–R100 shipping is a 57–67% shipping overhead — non-viable; at Paxi R60 it's borderline; the fix every apparel platform uses is bundling: Vinted's seller-set bundle discounts (~20% sweet spot at 3+ items) and Yaga's pay-delivery-once bundling (free add-on shipping from the same store within 1 hour). GG's P8a single-seller multi-buy cart already exists — add per-seller combined-shipping (one waybill per seller order) and a seller bundle-discount setting, and set a soft floor (~R100) or 'bundle-only' nudge below it. Adding Paxi as a third courier (PEP's 2,500+ stores = unmatched rural reach, exactly GG's platteland hunting demographic) is the single biggest enabler.

**Critic verdicts:**
- *feasibility:* **SOUND** — Per-line shipping confirmed (order-math sums line shippingCost), so combined-shipping-per-seller is the real unlock and is genuinely large (aggregate quoting + one-waybill booking). Bundle-discount setting is small. Carry over the PAXI caveat: no self-serve API — partnership or aggregator required, so don't gate the vertical's launch on PAXI; Pudo sub-5kg + combined shipping already changes the math.
- *compliance:* **SOUND** — Pricing/logistics; Paxi network addition carries the same encode-the-prohibited-goods-list note as the PAXI/Pargo finding.
- *business:* **NEEDS-CHANGE** — The analysis (shipping-overhead math, bundling as the industry fix) is the best of the three overlapping shipping findings — but consolidate all three into one programme: Paxi integration first, per-seller combined waybill second, seller bundle discounts third. Gate the whole programme on actually committing to the clothing vertical; it's wasted ahead of apparel supply.

### fishing-clothing-9 · Position against Yaga in technical outdoor/hunting apparel, not fashion
**Impact:** high · **Effort:** small · **Revenue:** Pricing/positioning decision that shapes apparel take-rate and seller acquisition cost

Yaga (yaga.co.za) is SA's incumbent preloved-fashion marketplace: 0% seller fee, buyer-protection fee R14.95 + 5%, seller-chosen Pudo/Paxi/Aramex/PostNet shipping, bundling — but it's fashion-oriented and thin on technical outdoor (K-Way and First Ascent listings exist but sparse; no hunting camo depth). GG should own the technical niche Yaga can't serve: camo/hunting apparel, waders, hunting boots — adjacent to GG's existing buyers. Don't compete on generic womenswear; do match Yaga's buyer-fee-funded protection model economics when pricing apparel commission (0% seller fee is the acquisition hook that made Yaga and Vinted work).

**Critic verdicts:**
- *feasibility:* **SOUND** — Positioning/pricing decision, no build risk. Note the tension it creates deliberately: matching Yaga's 0%-seller-fee economics conflicts with the current R30 commission floor — that's resolved by the finance-stream commission-floor finding, which should be decided together with this.
- *compliance:* **SOUND** — Positioning decision. If the Yaga-style buyer-fee economics are adopted, the protection-fee wording guardrail (insurance-framing risk) from the competitors finding applies here too.
- *business:* **SOUND** — Cheap, correct strategic scoping: own the technical niche adjacent to existing buyers, don't fight Yaga on generic fashion. Feeds directly into the buyer-fee pricing decision for the apparel class.

### fishing-clothing-10 · Seed a brand catalogue of SA outdoor/hunting labels with resale-value bands
**Impact:** medium · **Effort:** small · **Revenue:** Brand-filtered supply is what draws buyers from Facebook hunting-kit groups; premium boots/hats carry R2k+ tickets

Demand-side brands with real resale value: First Ascent and K-Way (Cape Union Mart) shells/down/3-in-1s retail R1.5k–R3k (a First Ascent 3-in-1 listed on Yaga referenced R2.6k–R3k retail), used ~30–50% of retail (R400–R1.2k); Sniper Africa and Wildebees camo (Wildebees apparel R359–R599 new; used R150–R300); Jonsson workwear (strong farm/utility demand); Rogue leather hats (cult following, sold via US importers); Courteney boots (Zimbabwe-made, ~US$400 / R7k+ new via safarioutdoor.co.za, hold value exceptionally — used R2.5k–R4.5k, active AfricaHunting.com demand); Veldskoen/Freestyle/Wildebees vellies R899–R1,699 new. Preload these into the brand picker with typical-used-value hints, and treat Courteney/Rogue/Freestyle as the 'high-value used' tier worth individual listings vs bundle-tier commodity fleece.

### fishing-clothing-11 · Extend the fishing apparel/footwear subcategories to discipline-specific technical wear
**Impact:** low · **Effort:** small · **Revenue:** Incremental fishing GMV; completes the discipline shopping experience

Kingfisher's apparel tree (hats, eyewear, shirts, jackets, hoodies, gloves, pants, waders, shoes) shows what fishing-specific clothing needs beyond the current generic 'Fishing Apparel/Footwear/Headwear' children in seed.ts: waders (chest/hip, boot size attribute), wading boots, sun-protection shirts (buffs/gloves), rain suits for ski-boat anglers, PFDs/life jackets for kayak anglers (safety item — condition grading matters). These bridge Part A and Part B: same size/brand attribute schema, but housed under Fishing for discoverability, and PFDs/waders are mid-ticket (R800–R3k used) so courier economics are comfortable.

## I. Hunting packages research

**Auditor summary:** Gun Galore today sells physical goods only (BUY_NOW/AUCTION/TAKE_A_SHOT/SWOP listing types, single Category tree, manual-EFT funds-held rails, courier fulfilment) — there is no date-slot, party-size, or per-animal-price-sheet concept anywhere in the schema, so hunts/experiences need a genuinely new listing shape, not a new category. The SA market splits sharply: local biltong hunting (~R3bn+/season, ZAR-priced, permit-light, exactly Gun Galore's existing user base) versus international trophy hunting (USD daily-rate + trophy-fee model requiring registered outfitters, licensed PHs and TOPS permits — high regulatory drag). Industry pricing is standardized enough to template: day fee per person/night (R600–R1,500), guide fee per group/day, a per-animal price list (springbok R2,500 → kudu bull R25,000 → buffalo R200k), 50% deposit to book, balance on arrival, animal fees settled after the hunt, May–September season. Legally the platform must position as an intermediary/advertising venue with CPA disclosure duties (not supplier of the hunt), vet outfitter/exemption paperwork, and run a CPA s17-compliant tiered cancellation regime (no fee on death/hospitalisation; "reasonable" fees scaled by notice). The incumbent competition is weak — BookYourHunt (10% commission, never touches money) barely serves the local biltong market, SA Hunters' 38,500-member Jagbestemmings portal still books via one phone number, and Facebook groups are scam-prone with zero payment protection — which is precisely the gap Gun Galore's funds-held EFT reconciliation can exploit.


### hunting-packages-1 · Target local biltong hunts first; defer international trophy hunting to a later phase
**Impact:** critical · **Effort:** small · **Revenue:** Directs the whole vertical at the segment that actually transacts in ZAR via EFT

Biltong hunting is the larger and better-fitting market: R3bn+ per season vs ~R2bn for trophy (combined R13.6bn in 2016/17; newer estimates R16bn direct / R45bn with multipliers — theconversation.com/counting-the-contribution-of-hunting-to-south-africas-economy-106715, dailymaverick.co.za 2025-07-13 'hunting bags R45bn'). Biltong hunters are locals paying ZAR by EFT — Gun Galore's existing audience — and the regulatory load is light: written landowner permission on exempted farms suffices in Limpopo/NW/Gauteng/NC/Mpumalanga, provincial licence needed in EC/WC/FS/KZN (sahunters.co.za/hunting-licences-and-permits-in-south-africa). Trophy hunting for foreign clients drags in registered hunting-outfitter + licensed professional-hunter requirements per province, TOPS permits under NEMBA, USD pricing and trophy-export logistics (phasa.co.za criteria pages, dffe.gov.za TOPS process) — poor fit for v1.

**Critic verdicts:**
- *feasibility:* **SOUND** — Scoping decision that strictly reduces build surface (no TOPS/outfitter-registration workflows, ZAR EFT only — matches the rail). Correct sequencing for this platform.
- *compliance:* **SOUND** — Correct regulatory triage — local ZAR biltong hunts avoid the outfitter/PH registration, TOPS/NEMBA permit and trophy-export load of foreign trophy clients. Keep the v1 gates: landowner-permission/exemption-certificate upload, province-aware licence prompts (EC/WC/FS/KZN require provincial licences), and exclude TOPS-listed species from v1 listings entirely.
- *business:* **SOUND** — Exactly right market scoping — ZAR/EFT locals matching the existing audience, with a fraction of the regulatory load of trophy outfitting. Costs nothing now and correctly shapes the (parked) experiences vertical when it starts.

### hunting-packages-2 · Build an EXPERIENCE listing shape: date-slot calendar + party size + per-animal price sheet
**Impact:** critical · **Effort:** epic · **Revenue:** The core sellable unit for the entire experiences vertical

Industry pricing is a stable template the schema can encode: day/accommodation fee per person per night (Karoo Biltongjag R600 pp/night, children R350, min 3 nights), guide fee per group per day (R2,000), a per-animal fee list (springbok ram R2,500, blue wildebeest R12,000, kudu bull R25,000, eland R35,000, buffalo R200,000), skinning R200/animal, and a minimum animal spend per booking (R15,000) — karoobiltongjag.co.za pricing page; boskaroo.co.za publishes the same structure as a PDF. The existing Listing model (C:\dev\gun-galore\backend\prisma\schema.prisma — ListingType enum at line 42, single price field at 614) has no slot/capacity/price-sheet concept, so this is a new listing type with: camp capacity (e.g. 6-bed camps), exclusive-use vs shared, hunter vs non-hunter party pricing, a season-bounded availability calendar (May–Sept peak Jun–Aug — africanskyhunting.co.za/info/when.html), and an itemised quote builder. Fixed-price experiences (range packages, charters) are the degenerate case: one slot type, no animal sheet.

**Critic verdicts:**
- *feasibility:* **SOUND** — New ListingType enum value is additive (established pattern: SWOP was added the same way) and slot/price-sheet models are new additive tables. Verified Listing has no slot/capacity concept. Epic is honest; the degenerate fixed-price case (range packages) should be v1. Blocked on the non-courier fulfilment method + partial-refund fix per the finance-stream analysis.
- *compliance:* **NEEDS-CHANGE** — Add compliance fields to the schema itself so they're enforceable: farm exemption / certificate-of-adequate-enclosure upload, province, and a species list validated against a TOPS/NEMBA flag table (TOPS species blocked or permit-number-required); plus the hook for the CPA s49 prominent risk notice and per-booking indemnity acknowledgement — dangerous-game entries (buffalo) make the risk notice non-optional.
- *business:* **NEEDS-CHANGE** — Park the epic. When the vertical starts, its own analysis shows the right on-ramp: fixed-price date-slot bookings (range packages — the degenerate case) with a simple slot model, before any animal-price-sheet/quote-builder engine. Building the full shape now is scale-stage machinery for zero supply. One of my three explicit parks.

### hunting-packages-3 · Money model: deposit held on GG's EFT rails, balance + animal fees direct to outfitter
**Impact:** high · **Effort:** large · **Revenue:** Deposit-as-commission means GG's fee is already in hand at booking — zero collection risk

Industry norm is 50% of daily rates as deposit to confirm, balance due ~6 months prior or on arrival, and trophy/animal fees settled at the END of the hunt because the final animal count is unknown upfront (game4africa.co.za/hunting-safari-finances, capeafricanhunting.co.za/page/terms-conditions, africahunting.com payment-structure thread). That maps cleanly to Gun Galore's existing reference-matched EFT + funds-held + FNB payout machinery: GG collects and holds ONLY the deposit ('funds held' — never the word escrow), releases it to the outfitter after the hunt start date passes without dispute, and the balance + animal fees flow direct outfitter-side. FishingBooker proves the pattern: commission equals the online-collected deposit (captain sets 10–30%), balance paid to the operator in person (help.fishingbooker.com 'What is the deposit'). Full holding of hunt value is impractical (usage-based animal fees) and increases regulatory surface — avoid it.

**Critic verdicts:**
- *feasibility:* **SOUND** — Deposit-only holding fits the exact-amount reference-matched reconciler perfectly (one reference per deposit, no partial-pay ambiguity) and the release-on-date-passed trigger clones the swap auto-release cron. Avoiding full-value holding is also the right regulatory call for an unlicensed rail. Never use 'escrow' in any of this copy.
- *compliance:* **NEEDS-CHANGE** — Right structure — deposit-only holding is the compliant direction and full-value holding is correctly rejected. Remaining guardrails: hunt deposits can sit 6–12 months, so keep them in the segregated account matched to the Client Funds Payable liability, ensure the refund path honours the s17 schedule at all times, and obtain a legal opinion that months-long aggregate deposit-holding stays within payment-intermediation and outside Banks Act deposit-taking/FAIS before launch. 'Funds held' language only — never 'escrow' (existing policy).
- *business:* **SOUND** — The right risk envelope: deposit-only holding matches industry norms, fits existing rails, keeps regulatory surface small, and deposit-as-commission removes collection risk. Adopt as the settled design decision for whenever the vertical launches — no build now.

### hunting-packages-4 · Position the platform as intermediary/venue with vetting gates, never supplier of the hunt
**Impact:** critical · **Effort:** medium · **Revenue:** None/indirect — protects the whole vertical from CPA and reputational blowback

Under the CPA, a party 'offering to sell to a consumer... a service to be supplied by a third person' is an intermediary with formal disclosure duties (fees, principal identity), and principals carry vicarious liability for agents — full disclaimers do not hold (lssa.org.za Consumer Protection Guide; financialinstitutionslegalsnapshot.com on s61 supplier-consumer scope). Prudent structure: the outfitter is always the named supplier of record on the booking; GG discloses its commission; listings for hunts require upload of the farm's exemption certificate / certificate of adequate enclosure and, for any trophy-client listing, outfitter + PH provincial registration numbers (sahunters.co.za permits page; gov.za outfitter registration notices 36744/38347). Add CPA s49-style prominent risk notices and per-booking indemnity acknowledgement for inherently risky activities (hunting, shooting, charters, 4x4). Reuse the SAP-534/KYC document-review admin pattern for outfitter vetting.

**Critic verdicts:**
- *feasibility:* **SOUND** — Vetting = the existing KYC/SAP-534 admin document-review pattern with new document types (exemption certs, outfitter/PH numbers); disclosure/indemnity are copy + a per-booking attestation checkbox (the firearm 18+ attestation is the exact pattern). Medium is right; legal copy needs a lawyer, not code.
- *compliance:* **SOUND** — Endorse — this IS the CPA framework the whole vertical depends on (intermediary disclosure duties, supplier-of-record on the booking, commission disclosure, s49 notices, document vetting). Add POPIA handling for uploaded certificates and registration numbers (purpose-limited, encrypted, retention policy).
- *business:* **SOUND** — Non-negotiable CPA structuring for the vertical, and reusing the SAP-534/KYC document-review pattern keeps it cheap. Bank it as the compliance blueprint; build with the vertical, not before.

### hunting-packages-5 · Ship a CPA s17-compliant tiered cancellation + weather/no-show engine
**Impact:** high · **Effort:** medium · **Revenue:** Trust differentiator vs Facebook groups; reduces dispute load on ops

CPA s17 gives consumers the right to cancel any advance booking; suppliers may charge only a 'reasonable' cancellation fee judged on notice length, realistic potential to re-book the slot, and industry practice — and NO fee may be charged if cancellation is due to death or hospitalisation of the beneficiary (thencc.org.za Explanatory Note 4 of 2023; Obiter v46 n2 'Determining a Reasonable Deposit... in the Tourism Industry'). Blanket 'non-refundable deposit' clauses common among outfitters (deposit forfeit inside 180 days plains / 360 days dangerous game, 1–2yr rollover credits — capeafricanhunting.co.za T&Cs) are legally fragile, so GG should impose a platform-standard tiered schedule (e.g. full refund >90 days, 50% 30–90, forfeit <30, always-refund on death/hospitalisation, credit-rollover option to next season). Copy FishingBooker's weather rule: operator-called unsafe-weather cancel = full refund or free reschedule; operator-fault cancel = refund + listing-ranking penalty; buyer no-show = deposit released to operator (help.fishingbooker.com cancellation policies).

**Critic verdicts:**
- *feasibility:* **SOUND** — Buildable as a rules engine over booking dates, but it hard-depends on the partial-refund fix (split settlement: partial refund + partial release on one booking is exactly what's broken today) — the finding's own finance-stream sibling names this; treat it as a strict prerequisite, not parallel work.
- *compliance:* **SOUND** — Endorse — correct reading of s17 including the reasonableness factors and the mandatory no-fee carve-out for death/hospitalisation. Hard dependency correctly identified: the partial-refund/split-settlement fix must land first. Platform-standard tiers overriding outfitters' blanket 'non-refundable' clauses is the legally safer posture.
- *business:* **NEEDS-CHANGE** — The legal analysis is right (blanket non-refundable deposits are fragile), but v1 should be a published platform-standard policy + manual admin handling of the rare early cancellations — not an automated engine. Automate when booking volume exists; note it also depends on the partial-refund fix for split settlement.

### hunting-packages-6 · Price the take: ~10% commission anchored as the held deposit, not a listing fee
**Impact:** high · **Effort:** small · **Revenue:** Direct: per-booking commission at 10x the average goods-sale fee

BookYourHunt charges outfitters 10% commission after the hunt is paid, never touches the money, and enforces price parity with the outfitter's direct rates (bookyourhunt.com/en/faq, /en/WhyUseBookYourHunt); FishingBooker's operator-set 10–30% deposit-as-commission is the collected variant; huntafrica.xyz charges only R199/year for a listing (weak monetisation floor). Recommended: GG collects a 10–15% deposit via EFT which IS the commission on completion, plus adopt BookYourHunt's price-parity clause so listings can't be used as a lead-gen billboard for off-platform booking — the same social-bypass problem the username policy already fights. On a typical R25k–R60k biltong group booking that is R2,500–R9,000 per booking, far above marketplace-goods ticket sizes.

**Critic verdicts:**
- *feasibility:* **SOUND** — Deposit-as-commission means zero new collection machinery (the deposit already lands in GG's account via EFT). Price-parity clause is T&C copy plus the same off-platform-bypass enforcement posture as the username policy. Small once the booking engine exists.
- *compliance:* **SOUND** — Commission model is fine. Competition Act note on the price-parity clause: keep it narrow (outfitter won't undercut GG's listed price on their own channel) rather than a wide MFN across all platforms; low risk while GG lacks market power, revisit if that changes.
- *business:* **SOUND** — Right anchor (market-proven at BookYourHunt/FishingBooker), right mechanism (deposit-as-commission = fee in hand at booking), and the price-parity clause correctly extends the existing anti-bypass posture. Settled decision for the parked vertical.

### hunting-packages-7 · Launch adjacent experiences on the same engine: shooting-range packages first, then charters, 4x4, birding, farm stays
**Impact:** high · **Effort:** medium · **Revenue:** Extends commission base year-round and beyond hunters to the whole outdoor audience

Verified SA price bands: shooting-range experience packages R999–R1,850 (theshootingrange.co.za, gunfun.co.za — strongest audience overlap with existing users and zero seasonality); deep-sea charters ~R7,500/boat/day KZN walk-in, Cape Town shared trips from R337 pp (getmyboat.com KZN listing, fishingbooker.com/destinations/country/za); 4x4 self-drive trails R40–R320/vehicle plus multi-day eco-trails (sanparks.org Marakele, sa4x4.co.za); guided birding ~R7,000/day private (birdingecotours.com Cape Peninsula day tour); and game-farm self-catering accommodation fills the Sept–Apr hunting off-season with the same slot inventory. All are fixed-price date-slot bookings — the simple case of the experience engine — so sequence range packages as the pilot (lowest legal risk, no animal price sheet, instant supply from ranges GG users already know).

**Critic verdicts:**
- *feasibility:* **SOUND** — Correct sequencing: fixed-price date-slot bookings are the degenerate case of the experience engine (no animal sheet, no per-usage settlement), lowest legal surface, best audience overlap. Validates the engine before the hunt-package complexity lands.
- *compliance:* **NEEDS-CHANGE** — Sequencing is right (range packages = lowest legal risk; supervised shooting by unlicensed participants at accredited ranges is lawful under the FCA). Required guardrail: extend the operator-vetting checklist per activity type — range accreditation for shooting packages, SAMSA certification/skipper licence and passenger cover for boat charters, park/operator permits for guided 4x4 — and apply the same CPA s49 risk-notice + indemnity acknowledgement to all inherently risky activities.
- *business:* **SOUND** — Correct pilot sequencing: range packages have the strongest audience overlap, lowest legal risk, no animal sheet, and instant supply — the right first tenant for the experience engine whenever it gets built. Keep as the vertical's launch order; no build now.

### hunting-packages-8 · Recruit supply from SA Hunters' analog channel and Facebook's scam vacuum
**Impact:** medium · **Effort:** medium · **Revenue:** Supply density is the gating factor for any commission revenue

SA Hunters' Jagbestemmings portal (destinations.sahunters.co.za, 38,500 members) still routes bookings through one staffer's phone/email and recruits landowner supply the same way — no calendar, no payment, no reviews; huntafrica.xyz is a R199/yr static directory; AfricaHunting.com classifieds are free-form forum posts; Facebook hunting groups have no payment protection at all. The pitch to game farms: a real availability calendar, deposit security via funds-held EFT, vetted-buyer identity (GG's existing KYC), and reviews — none of which any local player offers. A scrape-and-call supply drive against the SA Hunters destination list plus Boskaroo/Karoo-style farms that already publish structured price lists would seed 50–100 listings quickly; the season peak (May–Aug) means supply recruitment should land by Feb–Mar for a season launch.