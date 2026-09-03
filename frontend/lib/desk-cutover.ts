/**
 * THE DESK — the cutover map.
 *
 * Phase 6 of the build plan is: the Desk takes over /admin, a redirect map
 * ships, and the entire legacy admin frontend is deleted in the same commit.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THAT CANNOT HAPPEN YET, AND IT RECORDS EXACTLY
 * WHY. The legacy panel is 32 pages. The Desk is five surfaces. Roughly
 * two-thirds of what an operator can do today has no replacement at all —
 * including the audit trail, complaints, support, dealers, categories,
 * credits, trust-and-safety and every dossier view. Deleting the old panel
 * now would not be a cutover, it would be a removal of working capability
 * with nothing behind it.
 *
 * So the map ships inert. Nothing here redirects anything until
 * CUTOVER_ARMED is flipped, and the guard refuses to arm while any route is
 * still marked `desk: null`. That way the decision is made by evidence rather
 * than by a date.
 */

/** Flip to true only when every route below has a Desk destination. */
/*
 * ⚠️ /admin/deals, /admin/deals/pnl and /admin/suppliers were removed from this
 * map on 2026-09-03, not replaced. Daily Deals and its supplier registry were
 * REMOVED from the codebase that day, so those legacy pages no longer exist —
 * three routes that had been recorded as blocking a clean cutover. Deleting a
 * feature is a legitimate way to close a cutover gap; pretending one is covered
 * is not, which is why they are gone from the list rather than marked replaced.
 */
export const CUTOVER_ARMED = false;

export type Coverage =
  /** The Desk does this at least as well. Safe to redirect. */
  | 'replaced'
  /**
   * Deliberately NOT in the Desk, and safe to delete anyway: the capability
   * moved somewhere better on purpose.
   *
   * ⚠️ THIS IS NOT 'none' WEARING A NICER LABEL. 'none' means nobody has
   * built it yet and deleting would cost the operator something. 'retired'
   * means a decision was taken, the capability has a home, and the page is
   * genuinely surplus. Only the first blocks a cutover.
   */
  | 'retired'
  /** The Desk does part of it. Redirecting loses something specific. */
  | 'partial'
  /** Nothing in the Desk does this. Redirecting deletes the capability. */
  | 'none';

export interface CutoverRoute {
  /** The legacy path, relative to /admin. */
  legacy: string;
  /** Where it goes after cutover, or null when nothing replaces it. */
  desk: string | null;
  coverage: Coverage;
  /** What is lost or still missing. Written for the person deciding. */
  note: string;
}

/**
 * Every page under app/admin, and what becomes of it.
 *
 * Ordered as the sidebar was, so it can be read against the old panel.
 */
export const CUTOVER_MAP: CutoverRoute[] = [
  {
    legacy: '/admin',
    desk: '/admin/desk',
    coverage: 'replaced',
    note: 'The Command Center becomes the pile. Every attention card is a Desk card.',
  },
  {
    legacy: '/admin/listings',
    desk: '/admin/desk',
    coverage: 'partial',
    note: "REACH IS CLOSED, BROWSE IS NOT, and they are different things. Any listing now opens by id or reference from global search (Ctrl K, or the top-bar box on any surface), so the operator who knows WHICH listing they want is served. What is still missing is the operator who does not: there is no surface that lists all listings with the legacy status filters, so a question shaped like 'show me everything pending in Optics' has nowhere to go. The PENDING_REVIEW queue remains a Desk card type, which covers the daily loop but not the browse. Needs a small backend change too — AdminService.getListings takes no search param, though globalSearch already contains the exact OR-clause to reuse.",
  },
  {
    legacy: '/admin/listings/[id]',
    desk: '/admin/desk',
    coverage: 'replaced',
    note: "The Listing drawer carries photos, the seller words, the regulated band, the model verdict, approve / reject with their confirms, and take down with a reason. REACH IS CLOSED. It was the standing gap here — only a listing in the PENDING_REVIEW queue could be opened — and it is now reachable three ways: the review card, the stale-listing card, a reported row on Trust and safety, and global search, which opens ANY listing by id or reference from any surface. 🚨 THE DRAWER NEVER NEEDED A CHANGE FOR ANY OF IT: fetchListingDossier has no status gate and canTakeDown has always covered ACTIVE and PAYMENT_PENDING. Every one of those was missing wiring, not a missing capability, which is why this entry sat partial for so long while the thing it described was already built. HISTORY stays out on purpose: the legacy dossier bids, offers, watchers and Q and A tables are not inputs to a review or a take-down decision.",
  },
  {
    legacy: '/admin/users',
    desk: '/admin/desk/people',
    coverage: 'partial',
    note: 'Search now carries over in full: the box hits the same email / first name / last name / username match, it clears, the list pages (50 at a time, footer states "1–50 of 1,284" rather than printing a total over a truncated list), and all four legacy quick filters have a segment — Closed included, tagged neutral because a closure is a member leaving, not misconduct. Verifying is the broader kyc-outstanding rather than the command centre\'s >24h kyc-stalled, so everyone stalled is still in the segment but the stalled subset can no longer be isolated. TWO THINGS ARE MISSING AND AN EARLIER VERSION OF THIS NOTE ADMITTED ONLY ONE. (1) BULK BAN, left out deliberately rather than left undone. The legacy sweep is safe only because its checkbox column greys out already-banned and closed accounts, and a Desk version could not: the row is a single button that opens the Member drawer, so a checkbox column means rebuilding the row, and the confirm would have to name a count it could not vouch for. Individual bans are in the Member drawer. Whoever builds the sweep: PersonRow carries accountClosedAt for exactly that greying-out, the server caps a call at 50 and skips closed accounts itself, and the confirm must name the eligible count, not the selected one. (2) THE ENTIRE PER-ROW ACTIONS MENU, which is a straight removal of working capability and was not recorded here at all. Legacy renders UserActions in the rightmost cell of every row; the Member drawer carries three of its writes (ban / unban, clear reject strikes, and the KYC decision as approve / reject) and has no home anywhere on the Desk for the other four: EDIT PROFILE (username, first name, last name, phone — the "help a member fix their profile" support path), SELLER TIER, SETTING kycStatus DIRECTLY to any value rather than only approving or rejecting an UNDER_REVIEW row, and CLOSE ACCOUNT. Closure is the one that must block a redirect on its own: POST /admin/users/:id/close-account is a transaction, not a column an admin sets, and admin closure is the ONLY route by which a banned member\'s account can be closed — the self-service button refuses a restricted account by design, so that closing can never launder a ban. Redirect this route and that becomes unreachable. ALSO, since it was live here until this pass: a Sellers segment shipped reading filter=sellers, which AdminService.getUsers has never had. Its filter if-ladder ends `return {}`, so the chip rendered the whole member directory under a label that said otherwise and the header counted it as sellers, with no 400 and nothing in the network tab to say so. Removed rather than corrected — sellerTier defaults to NEW on every registered member, so there is no server-side definition to point it at.',
  },
  {
    legacy: '/admin/users/[id]',
    desk: '/admin/desk/people',
    coverage: 'partial',
    note: 'The Member drawer opens off any People row, in any segment, including a search hit — so reach is not the gap here. It carries identity behind one deliberate reveal, the KYC documents behind a second per-document reveal, approve / reject, ban / unban, bank re-verification, strike clearing and the admin history. Two things are lost. INVENTORY — counts plus the newest five listings, three sales and three complaints, not the full listings, sales, purchases, offers, bids, ratings-given, ratings-received and complaints tables. And THE SAME MISSING WRITES AS /admin/users, because legacy renders the identical UserActions component on this page too: edit profile, seller tier, setting kycStatus directly and CLOSE ACCOUNT are absent from the dossier as well as from the list. See that entry — close-account is the blocker on both routes, not just one. CORRECTION: an earlier version of this note also claimed the closure record was missing. It is not — the drawer renders dossier.closure (who closed it, when, the reason, whether they were banned at the time) and reads the closure snapshot rather than the emptied live columns. What it does not carry is the rest of the legacy closure table: the released email, phone and name are omitted on purpose per the privacy rule, but the ID-hash-held flag, the standing and trust score at closure, the count of listings cancelled and the link to a re-registered account are simply not there. The note was wrong in the safe direction, which is still wrong: this file is read to decide what may be deleted.',
  },
  {
    legacy: '/admin/transactions',
    desk: '/admin/desk/ledger',
    coverage: 'partial',
    note: "⚠️ THIS NOTE WAS STALE AND SAID THE OPPOSITE OF THE CODE. It read 'The Ledger shows the payout run. The order book with the needs-attention filter is not built' — the order book HAS been built: the Ledger carries a second lens (view=orders) with status segments, paging, and deep links that keep the legacy param names so an old bookmark survives. What is genuinely missing is a TRANSACTION book as distinct from the ORDER book: AdminService.getTransactions defaults status to HELD, so there is no way to list sales by any other status. Individual sales are reachable — global search opens any of them by id, reference, waybill or gateway id — so this is the browse half only, same as /admin/listings.",
  },
  {
    legacy: '/admin/transactions/[id]',
    desk: '/admin/desk/ledger',
    coverage: 'replaced',
    note: "🚨 THE PREVIOUS NOTE SAID 'EVERY ACTION [is lost] ... the drawer reads only', AND THE DRAWER'S OWN HEADER SAID THE SAME. Both were false and both are now corrected in place. Release, resolve-dispute-and-release, refund (full and partial), hold payout and lift payout hold were ALL already wired through order-actions.tsx, with hold and lift wired a second time as row controls on the payout run. REACH is closed too: global search opens any sale by id, reference, waybill or gateway id, and the Ledger takes ?txn= for one. THE TWO GENUINELY MISSING LEVERS ARE NOW BUILT, both of which had a live endpoint and no caller anywhere in the frontend. (1) DEALER STOCK-IN OVERRIDE — releaseTransaction refuses an isFirearm + DEALER_TRANSFER payout until dealerVerificationStatus is APPROVED, and that verdict is a model reading three photos, so when it was wrong the seller could not be paid by any route. Approve/Reject now sit in the money levers, gated to dealer sales that are not already approved, each behind a confirm that says approving RELEASES THE MONEY and messages both parties — because the server's adminOverride does exactly that, not merely clear a flag. (2) ZOHO BOOKS RETRY for a failed commission post, with no confirm because the endpoint is idempotent. ⚠️ AND THE EVIDENCE IS ON SCREEN AT LAST: the three photo URLs and every zoho* column were ALWAYS on the wire — getTransactionDossier uses `include` with no top-level select — and were simply undeclared in the frontend type, so an operator was being asked to overrule a machine with none of the machine's inputs visible, and a failed Books post looked identical to a healthy sale. Photos open one at a time on a press, per the same rule that folds KYC documents and intercepted contact text. HISTORY (bids, offers, watchers, Q and A) stays out on purpose: not inputs to a money decision.",
  },
  {
    legacy: '/admin/orders',
    desk: '/admin/desk/ledger?view=orders',
    coverage: 'replaced',
    note: 'The Orders lens on the Ledger. NOTHING FUNCTIONAL IS LOST. All six columns survive with the same values and near-identical fallbacks (orderReference ?? id.slice(0,8), @username ?? anon) — near, not identical: the id fallback now renders as `a1b2c3d4…` where legacy rendered `a1b2c3d4`, the ellipsis added deliberately by orderRowReference so a truncated cuid cannot be mistaken for a whole reference an operator could quote back, the same seven status filters, the same 20 rows a page against the same endpoint. Two shape changes, neither a capability. (1) The status chips and Prev/Next were plain <a> anchors, so they could be middle-clicked into a new tab and survived a full reload; they are now client state written to the URL with replaceState, so middle-click-to-new-tab on "Next" is gone — the URL itself is still copy-pasteable, and status= and page= keep their legacy names so a bookmarked /admin/orders?status=PAID&page=3 carries straight through the redirect. (2) The bare "1,204 total" printed over 20 rows becomes "1–20 of 1,204", which is the honest form. GAINED, and the reason this replaces rather than matches: every row opens the Order drawer, which the legacy list could not do at all.',
  },
  {
    legacy: '/admin/orders/[id]',
    desk: '/admin/desk/ledger?order=<orderId>',
    coverage: 'partial',
    note: 'The Order drawer, opened on the order\'s FIRST LINE, with an Order card carrying the order-level money split (itemsSubtotal / shippingSubtotal / handlingSubtotal / processingFee / buyerTotal) and the manual-EFT stamps (manualPayByAt / manualDetectedAt / manualCancelledAt) — both recovered from the same GET /admin/orders/:id/dossier the board must call anyway to learn which line to open — plus sibling lines that are now CLICKABLE, which is what makes lines 2..N of a multi-seller order reachable for the first time. THREE REAL LOSSES. (1) BUYER EMAIL AND PHONE: the legacy page printed both under the buyer\'s name. Neither is rendered anywhere here and neither is declared on OrderRow or OrderCard, so a future edit reaching for one is a type error and fetchOrderCard drops them before they reach state. Deliberate, in line with the Desk\'s usernames-only rule — but it IS a workflow change: an operator who used to copy a phone number off the order page now goes to People\'s member drawer for identity. (2) PER-SIBLING SELLER, PAYOUT AND REFUND SIDE BY SIDE: legacy listed every child transaction with its seller username, sellerPayout and refundedAmount in one table. The Parcel fold is built from the TRANSACTION dossier, whose sibling select (admin.service.ts ~1736) returns only id, paymentStatus, shippingMethod, shippingStatus, shipsWithId, buyerTotal and listing title/reference — so it cannot show a sibling\'s seller, payout or refund, and those three are visible one line at a time, for whichever line is open. ⚠️ AN EARLIER VERSION OF THIS NOTE SAID RECOVERING THE SIDE-BY-SIDE VIEW NEEDS A BACKEND SELECT CHANGE. IT DOES NOT, and that error was worth more than the gap it described: it would have sent somebody to write a migration-adjacent backend change for data already on the wire. GET /admin/orders/:id/dossier — the call this board ALREADY makes on every drawer open — selects sellerPayout, refundedAmount and seller.username per sibling (admin.service.ts:1870-1886). fetchOrderCard receives all of it and discards it, keeping only lines[0].id, because its privacy membrane collapses the array to firstTransactionId. Recovering the view is therefore a FRONTEND change only: keep the array on OrderCard and render it. Out of scope here, but cheap — do not schedule backend work for it. (3) THE ROUTES THEMSELVES cease to exist, so anything holding those URLs depends on this map — which is why ?order=<orderId> exists at all. NEVER EXISTED, so not a loss: any action. Both legacy pages were pure read; the new surface is strictly more capable, reaching the five per-line money levers in order-actions.tsx. An order-LEVEL refund or release is deliberately absent and MUST STAY ABSENT — a full refund of a consolidated carrier line whose siblings are still HELD throws (admin.service.ts:2233), so it would be a button whose outcome nobody on that screen can predict. STILL MISSING FROM BOTH, and the reason this stays partial rather than replaced: there is no urgency filter and no search. getOrders accepts exactly one OrderStatus or nothing, so "AWAITING_PAYMENT past its manualPayByAt" or "PARTIALLY_FULFILLED sitting too long" cannot be asked for; and it has no search parameter at all, so a box here would search the 20 loaded rows while looking like it searched the table. Both are backend work.',
  },
  {
    legacy: '/admin/manual-payments',
    desk: '/admin/desk/ledger',
    coverage: 'partial',
    note: 'The run preview is replaced. Disbursement is not wired from the Desk — see the Phase 3 note.',
  },
  {
    legacy: '/admin/analytics',
    desk: '/admin/desk/pulse',
    coverage: 'partial',
    note: 'CORRECTED FROM replaced ON REVIEW. "Pulse reads the same AdminAnalyticsService methods" was not true — it reads four of the six the page calls, over a narrower window vocabulary, with no export. FOUR THINGS ARE LOST. (1) TOP MAKES AND MODELS, a whole table, no Desk equivalent. (2) TIME TO SALE, likewise. (3) THE PERIOD RANGE: the legacy switcher offers 7d, 30d, 90d, 365d and all time; Pulse offers the first three, so a year-on-year or all-time read has nowhere to happen. desk-pulse.ts already documents that the server accepts the other two — the map simply never recorded that the chip row does not. (4) THE BUCKET CONTROL and CSV EXPORT: the legacy page switches the series between day, week and month and downloads the series, the makes table and the time-to-sale table as CSV. Pulse takes the server default bucket and exports nothing. Everything Pulse does show is the same service and the same figures.',
  },
  {
    legacy: '/admin/analytics/insights',
    desk: '/admin/desk/pulse',
    coverage: 'partial',
    note: 'The funnel and categories carry over. Heatmaps, search intel and the dormant segment do not.',
  },
  {
    legacy: '/admin/analytics/health',
    desk: '/admin/desk/pulse',
    coverage: 'replaced',
    note: 'Corrected destination: this page was never the gates-and-channels one, it is the three operational blocks — KYC drop-off, the paid-to-dispatch distribution and refund-risk sellers. All three are in the Standing section of Pulse, which is separated from the period charts by a heading that says the period chip does not apply, because none of the three endpoints takes one. Sellers are listed by username only; RefundRiskRow leaves the email the endpoint returns off the type so it cannot be rendered by accident. Two gaps were found on review and closed rather than written down: the paid-to-dispatch buckets print the share of the total again, and the refund-risk row prints ppDifference again — the distance above the marketplace baseline is the entire reason a seller is on that list, and a rate with no baseline beside it is a number nobody can judge. Held at replaced with the one remaining difference stated rather than hidden: the legacy refund-risk row linked to /admin/users/[id] and the Pulse row does not, because Pulse carries no actions by design. Reach survives — the username pasted into the People search opens the same Member drawer, and the card says so — so this is a step, not a dead end. If Pulse ever earns a link, this is the row that should get it.',
  },
  {
    legacy: '/admin/health',
    desk: '/admin/desk/site',
    coverage: 'replaced',
    note: 'Services, crons and queue depths are a Site section, re-probing every 60 seconds with the age of the last sweep on screen, and a failed sweep leaves the previous reading up rather than blanking it. Services sort worst-first; the crons show the ones needing a look with the rest one press away, and the count comes off the response rather than being written down here — this note said 28 when cronStatuses defines 27, and it will move again the next time a job is added or a feature is deleted. Queue cards link to the Desk destination that reproduces the count where one exists — the HELD-past-dispatch-SLA card does not link, because the order book it points at is not built. SERVER VITALS ARE NOT HERE AND ARE NOT FAKED: CPU, memory and disk still need the Warden daemon, and the vitals card still says unknown rather than drawing a gauge with no source behind it.',
  },
  {
    legacy: '/admin/settings',
    desk: '/admin/desk/site',
    coverage: 'partial',
    note: 'CORRECTED FROM replaced ON REVIEW. Four of the registry keys are on the Site board and every other flag changing in code is the design, not a gap — but only ONE of the four is writable. ops_alert_phone, ops_alert_types and ops_alert_quiet_hours were rendered with an edit pencil and no handler: a control that promises a field, does nothing when pressed, and sends the operator hunting for their own mistake. The pencil is now a read-only tag and those three are changed on the legacy page until this board grows a field. The WhatsApp kill switch does write, and its confirm now mirrors the servers own floor of fifteen characters for a danger flag rather than arming at five and collecting a 400.',
  },
  {
    legacy: '/admin/audit',
    desk: '/admin/desk/site',
    coverage: 'partial',
    note: 'CORRECTED FROM replaced ON REVIEW. The audit trail is a drawer on Site — read-only, newest first, with the actor and the reason on every row, and the shape matches the endpoint. What is lost is REACH BACKWARDS: the drawer reads the newest fifty and stops. The legacy page filters by resourceType from a pill row and pages by offset with the total on screen, which is how you answer "who released that payout in July". fetchAudit already takes resourceType and limit; nothing passes them. A record you can only see the last fifty rows of is not the record.',
  },
  {
    legacy: '/admin/alerts',
    desk: '/admin/desk/site',
    coverage: 'partial',
    note: 'CORRECTED FROM replaced ON REVIEW, after the section was found to be showing nothing at all. GET /admin/alerts returns a bare array; lib/desk-site.ts typed it as an envelope and read .rows off it, so the inbox rendered "0 unresolved · Nothing unresolved" however many were waiting — a quiet card reading as all-clear on the one surface whose whole job is to say otherwise. Fixed. What is still lost against the legacy page: it filters by type with a chip row built from server facets, filters to urgent, pages through every match with a cursor, and resolves in bulk behind a confirm with a reason. The Site section reads the newest fifty, shows eight, and resolves one at a time — the header now says that rather than printing a total it cannot vouch for. Warden replaces the inbox when deployed; until then a long tail is only visible on the legacy page.',
  },
  {
    legacy: '/admin/complaints',
    desk: '/admin/desk',
    coverage: 'partial',
    note: "NOW REACHABLE, AND THE PREVIOUS NOTE SAID WHY IT WAS NOT: the Case drawer was built and wired for weeks while DeskService emitted no complaint card, so a finished drawer sat behind a card type that never existed on the wire. desk.service.ts now emits it — id `complaint:<cuid>`, which is the prefix drawerTargetFor splits on — and the pile opens the drawer with the frozen-payout warning, the thread, the evidence, the decision and its confirm, plus the hand-off into the Order drawer holding the money. WHAT IS STILL LOST IS THE REGISTER, and it is the larger half of this page. The pile carries OPEN and UNDER_REVIEW only, oldest first, CAPPED AT 25: AWAITING_USER cases are deliberately absent because the ball is with the member, and RESOLVED and CLOSED are absent because they are done — so there is no history, no way to reopen a closed case, and no way to answer \"what did we decide on CO000118 in June\". No status filter, no search by reference or member, no paging, and no assignment to an owner (assignedAdminId is on the model and nothing on the Desk reads or writes it). A 26th open complaint is simply not on the pile and nothing says so. DO NOT REDIRECT THIS ROUTE on the strength of the drawer: what a pile card replaces is \"act on this case now\", not \"look a case up\". NEXT: a Cases register over fetchCases with the four states and a search, at which point this becomes replaced.",
  },
  {
    legacy: '/admin/support',
    desk: '/admin/desk',
    coverage: 'partial',
    note: "Same shape as /admin/complaints and the same limits — read that entry first. desk.service.ts now emits a support card (id `support:<cuid>`, band reviews_cases rather than disputes, because a question is not a frozen payout), so the Case drawer opens with caseKind support: reply and resolve, each behind a confirm that shows the operator the text going out. The card prints NO reference on purpose — a support ticket carries only a cuid and showing it would look like a number a member could quote back — and it tags a ticket nobody has ever replied to. LOST, BEYOND THE REGISTER ITSELF: the pile asks for status OPEN only, so every AWAITING_USER ticket is invisible on the Desk, and a member who answers our reply moves the ticket back to OPEN and reappears — but a ticket left AWAITING_USER forever is never seen again from here. Legacy lists all four states, filters and pages. Capped at 25 like the complaints. DO NOT REDIRECT until the register exists.",
  },
  {
    legacy: '/admin/dealers',
    desk: '/admin/desk/people',
    coverage: 'partial',
    note: 'The Dealers segment on People is now the directory itself, not just dealer-tier members. All four legacy filter tabs (Active / Pending review / Auto-added / All) are chips, the pending count is on the chip, the top search box searches name, licence and city, and every write the legacy page could make is here: review-and-activate, verify-but-keep-inactive, deactivate, reactivate, edit and add. Each is a confirm that restates what it does to DEALER_TRANSFER checkout, with a ticklist reason on the audit row (the backend floor is 3 chars; create writes its own reason, as it always did). MISSING, and only this: the click-through from an auto-added entry to the transfer that produced it. The dossier behind that link is /admin/transactions/[id], which is itself uncovered, and linking a Desk surface back into the legacy panel is the one thing this rebuild may not do — so the transfer id is printed in the review dialog to be looked up by hand until the Order drawer lands. Close this to replaced then. ⚠️ "ONLY THIS" IS EARNED, NOT ASSUMED, AND IT WAS NOT TRUE WHEN FIRST WRITTEN. Two further things were missing off the legacy card and are now on the Desk row: the STREET LINE, which had been dropped in favour of suburb / city / province even though the street is the one field the whole review is about — where a firearm gets driven — and FIRST SEEN / LAST SEEN on auto-added entries, which DealerRow was fetching and nothing rendered, and which is how an operator tells a dealer who may have moved from one seen last week. Anyone re-marking this replaced: read the legacy card field by field first.',
  },
  {
    legacy: '/admin/categories',
    desk: '/admin/desk/pulse',
    coverage: 'retired',
    note: 'Retired deliberately, in two halves — but the note now lists everything that becomes a deploy, because the first version named only two booleans and that undersold the decision. Editing the tree goes to code because isFirearm and requiresLicence decide what sits behind the members-only gate and a web form leaves no diff to review. Going with them, and worth agreeing to on purpose: isActive, which hides a category from the Sell form and the browse filters and is a same-day merchandising lever; sortOrder; availableSecondhand and availableNewStore; crossSellEligible; and the crossSellTo relationship map. That last one is the sharp edge. Unmet cross-sell demand is now a read-only block in the Standing section of Pulse, labelled as a running tally rather than a period figure — so an operator can see which pairing buyers wanted and can no longer wire it without a deploy. Accept that or build a narrow editor for the relationships alone; do not close this by pretending the reading half was all the page did. The tree is still readable via GET /admin/categories.',
  },
  {
    legacy: '/admin/credits',
    desk: '/admin/desk/site',
    coverage: 'replaced',
    note: "CORRECTED FROM replaced ON REVIEW, THEN CLOSED WHEN THE EDITOR LANDED. The low-balance flag it originally advertised did not exist: the Desk type invented vendor, currency, checkedAt and belowThreshold, none of which /admin/credits/snapshot sends, so every row rendered a blank name keyed on undefined and the warn tag could never fire. Fixed then: the type is the wire shape, rows are keyed and named on service, and the flag is computed against /admin/credits/thresholds for vendors whose pair reads as a floor. Anthropic encodes a daily SPEND CEILING in the same two columns and is left unflagged rather than flagged backwards, which is what the legacy page does. EDITING A FLOOR NOW EXISTS — PUT /admin/credits/thresholds/:service was always there and nothing called it. 🚨 AND THE EDITOR SAYS WHETHER WHAT YOU TYPED CAN EVER FIRE, which the legacy page never did. creditIsLow() returns false for four different reasons and the row renders identically for all of them, so a vendor wired never to warn is indistinguishable from one that is well stocked — the exact state VerifyNow was in at 28 credits. thresholdVerdict() names which of the three inert shapes it is (switched off, a blank side, warn at or below alarm), the dialog shows it live on every keystroke, and the row carries a quiet never-flags tag. It does not BLOCK an inert save: a spend ceiling in those columns is a real thing an operator may want. Still lost: the non-billing test probe and the per-vendor history chart, both read-only conveniences rather than controls.",
  },
  {
    legacy: '/admin/trust-safety',
    desk: '/admin/desk/site',
    coverage: 'replaced',
    note: "All five feeds are one Site section, segmented rather than five stacked tables: repeat offenders, reported Q and A, reported listings, reported sellers, and the contact-detail rejection log. Two deliberate differences from the legacy page, both improvements. The email address it printed under every username on all five tables is gone, per the privacy rule — username identifies the row and the person is worked on from People. And the intercepted text, usually a phone number or an address, is folded and opens one row at a time on a press instead of running down a column. THE CLICK-THROUGH THIS ENTRY WAS HELD OPEN FOR NOW EXISTS. Every legacy row was a link, so the page was a queue you worked FROM, and the Desk section was a list you could only read: a member could be reported for a LIVE listing with no route anywhere on the Desk to open that listing, let alone take it down. Names are now doors — offender, reported seller and rejecting user to the Member drawer, reported listing and the listing a reported question was asked on to the Listing drawer — and both drawers act, so a report leads to the decision it exists to prompt. ⚠️ THE NAME IS THE TARGET, NOT THE ROW: the contact-block row carries its own Show-text button and nesting buttons is invalid markup. Three deliberate non-doors, each because the id genuinely is not there: a reported question carries the asker USERNAME with no id, and `listing` and `seller` are nullable for a listing or account since deleted. ⚠️ AN EARLIER VERSION OF THIS NOTE SAID THE LISTING DRAWER ONLY OPENS FROM A PENDING_REVIEW CARD. That was already wrong when written — the stale-listing card had opened it on an ACTIVE listing since before the cutover — and the drawer needed no change here at all: canTakeDown() has always covered ACTIVE and PAYMENT_PENDING, and POST /admin/listings/:id/delete has never had a status guard. Nothing new was granted; the wiring was simply missing.",
  },
  {
    legacy: '/admin/broadcast',
    desk: '/admin/desk/site',
    coverage: 'replaced',
    note:
      'BUILT: the Send drawer on Site. Same endpoints, same six segments, same 5,000 cap, and the deep link kept as ?send=1&channel=&segment=. It also prints what the old page did not: on SMS every audience except Everyone and Dormant counts MEMBERS, not phones, so the count is labelled a ceiling; the cap is refused before the press rather than by a 400 after it; the SMS credit balance and the per-recipient part cost sit beside the count. The confirm restates channel, count, the exact words and the cost, and will not arm without a typed reason — and says plainly that the reason is NOT stored, because the endpoint has no field for one. TWO THINGS HERE NEED THE BACKEND AND ARE ONLY DESCRIBED, NOT FIXED. A reason field, as above. And THE MUTE: NotificationsService drops a message when the member has switched that channel off, only the Dormant SMS query filters on it, and the broadcast loop counts the muted member as SENT — so they are inside the preview count, inside `sent`, never inside `skipped`, and they receive nothing. The drawer raises it as a caution in the confirm and the result reads "handed over" rather than "delivered", which is the most a frontend can do about a figure the server will not report. Neither gap is a reason to keep the legacy page: it had the same two holes and said nothing about either.',
  },
  {
    legacy: '/admin/campaigns',
    desk: '/admin/desk/site',
    coverage: 'replaced',
    note:
      'BUILT: merged into the same Send drawer, as decided. The key list with banner hits, sign-ups and listed; create; copy link; and turn on/off — now behind a confirm that names the quiet half, that an off key stops ATTRIBUTING and not just showing the banner. Picking a key in Compose inserts its link into the body, and the drawer says that the link IS the attribution. One fix carried in: the copy link uses the current domain, where the legacy page still hands out the retired one.',
  },
  {
    legacy: '/admin/admins',
    desk: '/admin/desk/site',
    coverage: 'replaced',
    note: "REPLACED. components/desk/admins-drawer.tsx wires all three writes — create, change-role and switch-off — each calling the SuperadminGuard-protected endpoint the legacy page used. This was the worst thing the cutover cost: the roster listed administrators and carried no control on any row, so removing a compromised one meant a database write. THE REASON THIS SAT AT partial IS ALSO GONE. MONITORING_ADMIN was documented read-only and enforced nowhere — SuperadminGuard covered exactly the three admin-management routes and every other admin endpoint took any logged-in admin, so the tier could release payouts, refund and ban. AdminJwtGuard now enforces it across every route behind admin auth: deny-by-default on mutating methods rather than an allow-list, so a route added later is covered by the act of authenticating. ⚠️ AND IT READS THE ROW, NOT THE TOKEN — the admin JWT lasts 8 hours with the role baked in at login, and nothing checked isActive at all, so before this a switched-off administrator kept FULL access until their token expired. Switch-off and demotion now bite on the next request, which is what makes the emergency control on this drawer real. Lockout stays unreachable: AdminService blocks changing your own role and deactivating yourself.",
  },
  {
    legacy: '/admin/freshness-graveyard',
    desk: '/admin/desk',
    coverage: 'partial',
    note: "PARTIAL, AND THE HALF THAT MOVED IS THE ACTING. The legacy page is a REPORT: it ranks every dead ACTIVE listing by age x price and, in its own words, tells the operator to “click into a listing’s dossier to delete it” — it carries no action at all, and the nudge-seller feature it advertises has never existed. The Desk now emits a stale_listing card in Housekeeping for the top FIVE, and that card opens the Listing drawer, where take-down with a reason lives. That closes a gap this file recorded separately: canTakeDown() wants an ACTIVE or PAYMENT_PENDING listing and the only previous door into that drawer was a PENDING_REVIEW review card, so no listing that could be taken down could be opened from the Desk at all. WHAT IS STILL LOST IS THE REPORT. Five cards against fifty rows, and a 60-day floor against the report’s 30 — both deliberate, because a pile is a worklist and fifty housekeeping cards would bury the money band — but it means the tail of dead inventory is only visible on the legacy page, and nothing on the Desk says there is a tail. No sorting, no category filter, and the staleScore itself is deliberately never printed. DO NOT REDIRECT: the ranking IS the product here. ⚠️ BOTH SURFACES NOW READ ONE QUERY — admin/freshness-graveyard.ts, called by AdminAnalyticsService and DeskService alike. If either grows its own copy of that SQL they will disagree about which listing is worst and nothing on either screen will show it.",
  },
  {
    legacy: '/admin/reloading',
    desk: null,
    coverage: 'retired',
    note: 'DECIDED: out of the admin panel entirely. Load Lab is changed in code from here on. Ingest already had a standalone script; extraction now has one too (src/reloading/scripts/extract-loads.ts), so the pipeline that feeds /load-lab survives the page being deleted.',
  },
  {
    legacy: '/admin/login',
    desk: '/admin/login',
    coverage: 'replaced',
    note: 'Stays. The Desk uses lib/desk-auth against the same endpoint; the screen itself is unchanged.',
  },
];

/** Everything still blocking a safe cutover. */
export function cutoverBlockers(): CutoverRoute[] {
  return CUTOVER_MAP.filter((r) => r.coverage !== 'replaced');
}

/**
 * Where a legacy path should send someone, once armed.
 *
 * ⚠️ RETURNS null WHILE DISARMED, AND FOR ANYTHING NOT FULLY REPLACED. A
 * redirect from a working page to a Desk surface that does less is not a
 * redirect, it is a quiet removal — the operator lands somewhere plausible
 * and never finds out what they lost.
 */
export function redirectFor(legacyPath: string): string | null {
  if (!CUTOVER_ARMED) return null;
  const hit = CUTOVER_MAP.find((r) => r.legacy === legacyPath);
  return hit && hit.coverage === 'replaced' ? hit.desk : null;
}
