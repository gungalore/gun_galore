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
    desk: '/admin/desk?view=listings',
    coverage: 'replaced',
    note: "BOTH HALVES ARE NOW HERE. REACH was closed by global search (any listing by id, reference, make or model, from any surface) — and the Listing drawer never needed a change for it, because fetchListingDossier has no status gate. BROWSE is this: a Listings lens on the pile at /admin/desk?view=listings, with status chips including an Everything segment, a search box over title, reference, make and model, thumbnails, paging with a real total, and every row opening the same drawer that reviews and takes down. ⚠️ A LENS, NOT A SIXTH TAB — tabs.tsx calls its list 'the five surfaces... nothing configurable about this list'. BACKEND: getListings grew a `search` param and an ALL status. The search REUSES globalSearch's existing OR-clause rather than inventing a second definition of what it means to find a listing; two of those would drift and the one an operator hit would depend on which surface they were standing on. The PENDING_REVIEW default is unchanged and is what the board opens on, so the first paint and a refresh agree. 🚨 THE WIRE CALLS THE ARRAY `listings`, NOT `rows` — desk-listings.ts is the only place that is translated, and reading `.rows` would have rendered an empty register beside a correct-looking total, which is exactly the shape of the alerts bug this rebuild already shipped once.",
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
    coverage: 'replaced',
    note: "Search, paging and all four legacy quick filters carry over as segments — Closed included, tagged neutral because a closure is a member leaving, not misconduct. Verifying is the broader kyc-outstanding rather than the command centre's >24h kyc-stalled, so everyone stalled is in the segment but the stalled subset cannot be isolated on its own. BULK BAN IS BUILT, TO THE SPEC THIS NOTE LEFT: the row carries a DISABLED checkbox (disabled, not hidden, reason on hover — a missing checkbox reads as a glitch), the confirm names the ELIGIBLE count and lists who is being left alone BY NAME, and it refuses over the server cap of 50. The sweep is OFF until turned on, because a checkbox column standing open invites a sweep as the normal way to work and individual bans belong in the drawer where the operator can see who they are banning. THE PER-ROW ACTIONS MENU IS BACK TOO, as an Account admin section on the Member drawer rather than a menu per row — seller tier, verification status direct, rename, and close account. See /admin/users/[id] for what each one warns about.",
  },
  {
    legacy: '/admin/users/[id]',
    desk: '/admin/desk/people',
    coverage: 'replaced',
    note: "The Member drawer opens off any People row and off global search, carries identity behind one deliberate reveal and the KYC documents behind a second per-document reveal, and holds approve / reject, ban / unban, bank re-verification, strike clearing and the admin history. THE MISSING WRITES ARE NOW IN AN ACCOUNT ADMIN SECTION — folded by default, because four destructive-ish controls standing open under every member is an invitation. 🚨 THE ENUM LISTS ARE TRANSCRIBED FROM schema.prisma AND PINNED BY A TEST THAT READS IT, because the first draft of both was GUESSED and both were wrong: seller tiers as NONE/INDIVIDUAL/BUSINESS/DEALER when only DEALER exists, and KYC statuses missing NONE and UNDER_REVIEW. @IsEnum turns a wrong value into a 400 rather than a silent write, but a picker offering options that can never work is a control lying about what it does — and UNDER_REVIEW in particular is the status an operator most needs to move somebody OUT of, since payout gates check !== VERIFIED. ⚠️ SETTING kycStatus DIRECTLY IS NOT THE APPROVE BUTTON and the control says so at the point of use: Approve/Reject run the real path (decision recorded, member messaged, reviewer on the record); this writes the column and nothing else, which makes it right for a stuck state and wrong for a decision. ⚠️ CLOSE ACCOUNT IS NOT A BAN AND NOT A DELETE — it releases the handle, email and phone so the person can register again, while every transaction, rating and complaint stays on the row; the confirm states all three. ⚠️ firstName AND lastName ARE DELIBERATELY NOT EDITABLE even though the DTO accepts them: they are the identity fields the KYC decision was made against. STILL LOST: the full inventory tables (counts plus newest five listings, three sales and three complaints, not every listing, offer, bid and rating), and four fields of the legacy closure table — the ID-hash-held flag, standing and trust score at closure, listings-cancelled count, and the link to a re-registered account.",
  },
  {
    legacy: '/admin/transactions',
    desk: '/admin/desk/ledger?view=sales',
    coverage: 'replaced',
    note: "THE SALES BOOK IS BUILT — a third Ledger lens beside the payout run and the order book, at ?view=sales. Status chips including Everything, paging with a real total, and every row opening the same Order drawer on the null-parent path a single sale has always used. 🚨 THE MAP CALLED THIS UNBUILDABLE AND IT WAS ONE WHERE-CLAUSE: getTransactions pinned paymentStatus on every call, defaulting to HELD with no way to ask for anything else as a set, so browsing sales by any other status was impossible and was recorded as a missing feature rather than a missing branch. An explicit ALL was added and the HELD default is unchanged, so nothing relying on it moved. ⚠️ AND THE ENDPOINT WAS LEAKING. Its include selected firstName, lastName and email for BOTH parties — for a legacy page that no longer exists — so every row of a sales list would have carried two people's real names and addresses into the browser to render a column the Desk's own rule forbids. Nothing else in the tree calls getTransactions, so the SELECT was corrected rather than the render filtered: data that never arrives cannot be rendered by accident. ⚠️ A PAYOUT HOLD IS NOT A PAYMENT STATUS AND THE ROW SAYS BOTH — a RELEASED sale with payoutHeldAt set is money the seller is owed and is not getting this run; showing only one of the two is wrong in either direction and looks entirely normal. The ?filter= deep links from the command centre and the health page are honoured, shown as a removable banner, and preserved by the URL writer.",
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
    coverage: 'replaced',
    note: "The Order drawer opened on the order's FIRST LINE, with an Order card carrying the order-level money split and the manual-EFT stamps, plus sibling lines that are clickable — which is what makes lines 2..N of a multi-seller order reachable at all. BUYER EMAIL AND PHONE STAY OUT, and that is settled rather than outstanding: the legacy page printed both under the buyer's name, neither is declared on OrderRow, OrderCard or OrderTransaction, and fetchOrderCard drops them before they reach state, so a future edit reaching for one is a type error. What WAS a real loss is the workflow — an operator who used to copy a phone number off the order page had nowhere to go. Both parties are now LINKS into the Member drawer on People, where identity sits behind its deliberate reveal. ⚠️ A LINK, NOT A NESTED DRAWER: Drawer binds Escape on document and defers only to a .dk-dialog above it, so two mounted at once both hear one keypress and both close — the failure this drawer's own header warns about. The Pile solves that with a stack; the Ledger has none. STILL LOST: per-sibling seller, payout and refund side by side. The Parcel fold is built from the TRANSACTION dossier, whose sibling select returns only id, paymentStatus, the shipping fields, buyerTotal and the listing title — so those three are visible one line at a time by stepping through siblings, not as a table. That needs a wider sibling select, not a frontend change.",
  },
  {
    legacy: '/admin/manual-payments',
    desk: '/admin/desk/ledger',
    coverage: 'replaced',
    note: "The run preview was already replaced — segments, totals, the hold and lift levers, and a confirm that restates the sales, the sellers and what is held back. 🚨 DISBURSEMENT IS WIRED, AND IT WAS THE ONE CALL THE DESK NEVER MADE. POST run-payouts existed with no caller anywhere, and the confirm dialog closed itself and reported \"not wired from the Desk yet\". The board could show what was owed and to whom, and could not pay any of it. ⚠️ IT STAYS GATED ON PAYMENTS_LIVE. The service throws in words rather than returning a shape, and the board renders the gated variant instead of firing and then explaining. Exactly-once is the server’s via paidOutAt; the button blocks re-entry while a batch is in flight. The result says ACCEPTED, never paid — Peach settles asynchronously and the payout webhook reconciles. THE OTHER TWO ENDPOINTS ON THIS CONTROLLER ARE NOW WIRED TOO, as the Ledger’s Books lens (?view=books): the client-funds position and the failed-Books-sync radar. ⚠️ A BUCKET THAT WAS NEVER MEASURED RENDERS AS AN EM DASH, NOT R0.00. getHeldFundsReport SKIPS the buyer-refunds query entirely unless PAYMENT_MODE is manual, because a card gateway reverses on the card — so a zero there was never measured, and the card names the mode instead. ⚠️ THE RADAR TOTAL IS A FLOOR. Each of its three arms is take:50 server-side, so 50 failures and 500 both report 50; the card says \"at least\" whenever an arm is at its cap. 🚨 AND THE THREE ARMS ARE NOT THE SAME KIND OF THING, established by reading the writers rather than the comments. TRANSACTIONS is real — zoho-books.service.ts writes zohoSyncStatus OK/PENDING/FAILED/SKIPPED, and it is the one arm with a repair, so its rows open the sale where the Books fold and its idempotent Retry live. SUBSCRIPTION CHARGES keys on zohoReceiptId IS NULL and NOTHING WRITES zohoReceiptId, so a row needs the receipt raised in Zoho by hand. SWAPS keys on two receipt-id columns nothing writes, and the service comment claimed they were \"re-fired by the hourly retryMissingSwapFeeReceipts cron\" — THAT CRON DOES NOT EXIST anywhere in the repo. A swap landing there is permanent until someone writes code. Both misleading comments are corrected in place, and the lens labels each arm with what can actually be done about it.",
  },
  {
    legacy: '/admin/analytics',
    desk: '/admin/desk/pulse',
    coverage: 'replaced',
    note: "Pulse reads the same AdminAnalyticsService methods over the same period vocabulary as the legacy page, with a bucket control beside it. 🚨 THE PERIOD GAP WAS A TYPE, NOT A FEATURE: the Period union stopped at 90d while the comment directly above it listed all five resolvePeriod() accepts, and every fetcher passes the value straight through — so 365d and all-time arrived by widening a union. TOP MAKES AND MODELS and TIME TO SALE are cards now, and were the same story: both endpoints had served since the legacy page was written and nothing called them. Makes rank by UNITS not rand, because a cheap item that moves often is a different fact from one expensive sale; time to sale is labelled MEDIAN on its face, because one listing that sat for a year makes a mean useless and an unlabelled median gets read as an average and argued with. CSV EXPORT IS THE LAST PIECE, AND IT IS THE ONE THING ON THIS WHOLE MAP THAT GENUINELY NEEDED BUILDING RATHER THAN CONNECTING — there was no analytics CSV endpoint at all, only the unrelated transactions export. GET /admin/analytics/export.csv now serves the series through the same two resolvers the chart uses, so the file is the window the operator was looking at. ⚠️ IT IS A GET, SO IT STAYS OPEN TO A MONITORING ADMIN — an export reads, and making it a POST to carry a body would have quietly made the report SUPERADMIN-only under the role guard. ⚠️ RAND, NOT CENTS, WITH THE UNIT IN THE COLUMN HEADER: a spreadsheet column of integers labelled gmv is read as rands by whoever opens it, and every figure would be a hundred times too big. 🚨 AND THE DOWNLOAD CANNOT BE A PLAIN LINK. The admin API is bearer-authenticated and a link navigation sends no Authorization header, so the browser would follow it, take a 401 and land the operator on a JSON error page having lost the board. It is fetched with the token, turned into a blob, handed to a synthetic link, and the object URL is revoked — otherwise every export pins a copy of the file in the tab for as long as it lives.",
  },
  {
    legacy: '/admin/analytics/insights',
    desk: '/admin/desk/pulse',
    coverage: 'replaced',
    note: "The funnel and categories carried over from the start. SEARCH INTEL and the DORMANT SEGMENT are now cards, and both were live GETs nothing called — the zero-result half of search intel gets its own list, because a popular term is a thing being found while a term returning nothing is demand the storefront cannot serve. ⚠️ DORMANT IS THE ONE FIGURE ON PULSE THAT IGNORES THE PERIOD CHIPS, and the card says so: dormantSegment() counts against a fixed 14-day window in the service, so unlabelled it reads as 'dormant in the last 7 days'. THE HEATMAPS ARE BUILT. This was the only item on the insights list that genuinely needed writing rather than calling — the endpoints existed and charts.tsx had no dow x hour primitive. ⚠️ ONE HUE VARIED BY OPACITY, like every other chart here: colour on this surface means 'something needs you', and a busy Saturday is not a problem. Sunday-first to match Postgres EXTRACT(DOW) — a Monday-first grid shifts every row and reports the busiest trading day as the day before. Keyed on dow*24+hour, because a string concat merges dow 1/hour 12 with dow 11/hour 2 and paints a real number onto the wrong square. ⚠️ AND THE SALES GRID SAYS WHAT IT ACTUALLY MEASURES: release time is an ADMIN action, so while payouts are released by hand it is largely a picture of the operator's own working day, not a buying pattern — left unsaid it would be planned against.",
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
    coverage: 'replaced',
    note: "⚠️ THIS NOTE WAS STALE — THE GAP IT DESCRIBED WAS ALREADY CLOSED. It said ops_alert_phone, ops_alert_types and ops_alert_quiet_hours 'were rendered with an edit pencil and no handler' and that 'the pencil is now a read-only tag'. Verified end to end: WardenService.settings() returns editable:true on all four rows, the panel renders a working pencil bound to onEdit, and the site board calls updateSetting -> PATCH /admin/settings, whose registry contains all three keys. All four are writable and audited. 🚨 ops_alert_quiet_hours IS A BOOLEAN AND MUST STAY ONE: the 22:00-06:00 SAST window is a constant in decideOpsAlert(), so an hours-range control would be a field whose edits silently do nothing — the backend comment says so at the point it would be tempting. ops_alert_types stays a free-form comma list because no canonical registry of AdminAlert type strings exists (52 call sites raise them ad hoc), so a multi-select would be inventing options; the hint warns that a type spelled wrong is a type that never alerts. Open, if ever wanted: a phone-format input and a real multi-select once a type registry exists. Neither is a gap in coverage.",
  },
  {
    legacy: '/admin/audit',
    desk: '/admin/desk/site',
    coverage: 'replaced',
    note: "The audit trail is a drawer on Site — read-only, newest first, the actor and the reason on every row. REACH BACKWARDS IS NOW CLOSED, which was the whole of this entry: it read the newest fifty, cached them forever and stopped, so 'who released that payout in July' was unanswerable on the one surface built to answer it. `offset` was accepted by the server the entire time and never sent, and `resourceType` was a declared parameter of fetchAudit that no caller passed. Both are now wired, with a chip row, Newer/Older paging and the range and total on screen. ⚠️ THE CACHE GUARD WAS PART OF THE BUG: the parent fetched behind `if (!audit)`, which is right for a list that never changes and wrong the moment a filter exists — the second chip press would have redrawn the first chip's rows. State moved into the drawer, keyed on the filter. ⚠️ THE CHIPS ARE TRANSCRIBED FROM THE resourceType LITERALS ACTUALLY WRITTEN IN backend/src, not guessed — the first draft was guessed and offered Complaint and AdminUser, neither of which any writer emits, so both would have returned an empty log reading as 'nothing has ever happened to a complaint'. Everything is always the default, so a type with no chip stays reachable. adminUserId filtering exists server-side and is deliberately not offered: nothing on the Desk resolves an admin identity to pick from.",
  },
  {
    legacy: '/admin/alerts',
    desk: '/admin/desk/site',
    coverage: 'replaced',
    note: "CORRECTED FROM replaced ON REVIEW ONCE, WHEN THE SECTION WAS FOUND SHOWING NOTHING AT ALL — GET /admin/alerts returns a bare array and lib/desk-site.ts typed it as an envelope and read .rows off it, so the inbox rendered '0 unresolved · Nothing unresolved' however many were waiting. Fixed then, and now pinned by a test that feeds it both shapes. THE REST OF THE LEGACY PAGE IS NOW HERE TOO: type chips built from the server's own facets (GET /admin/alerts/types), an urgent filter, cursor paging with Load more, and bulk resolve behind a confirm with a reason. ⚠️ urgent IS SENT ONLY WHEN NARROWING. The controller reads an explicit false as 'show me the NON-urgent ones', so a cleared toggle that sent urgent=false would have hidden every urgent alert — the exact rows this inbox exists for. Pinned by test. ⚠️ BULK RESOLVE RE-READS RATHER THAN SPLICING. The endpoint loops the single path and returns {resolved, skipped, failed} with skippedIds but no failedIds, so the client cannot work out which rows survived; removing every selected id on a 200 would hide rows still open and still needing somebody. The tally is reported and the list is re-read. The footer no longer points at 'the legacy alerts page', which was deleted in the cutover.",
  },
  {
    legacy: '/admin/complaints',
    desk: '/admin/desk',
    coverage: 'replaced',
    note: "THE REGISTER IS BUILT — it was the larger half of this page and the last thing missing. The pile still carries only OPEN and UNDER_REVIEW, oldest first, capped at 25, which is right for a daily loop; the register is the record behind it, at /admin/desk?view=cases: kind switch, per-kind state chips, paging with a real total, and every row opens the Case drawer that already existed. ⚠️ A LENS, NOT A SIXTH TAB — tabs.tsx calls its list 'the five surfaces... nothing configurable about this list', and the pile stays the default because a passive register is not what an operator should land on when the job is today's cards. BACKEND: adminList was UNBOUNDED (no take at all) and returned every complaint ever with each full body and every photo; it now pages and returns {rows,total,page,limit}, and selects updatedAt so 'last touched' is no longer blank on complaints while support has one. 🚨 AND GET /admin/complaints/:id NOW EXISTS. fetchCase used to pull the WHOLE register and filter client-side — desk-case.ts recorded that as a known privacy exposure, because adminList selects user.email on every row, so opening ONE complaint dragged every complainant's address into the browser. Paging turned it into a correctness bug as well (any complaint past page one would report 'no case in the register', which reads as deleted rather than unfetched), and the two were fixed by the same endpoint. It accepts a reference number as well as an id, because a reference is what a member quotes.",
  },
  {
    legacy: '/admin/support',
    desk: '/admin/desk',
    coverage: 'replaced',
    note: "Same shape as /admin/complaints and now with the same register — read that entry first. desk.service.ts emits the support card, the Case drawer opens with caseKind support (reply and resolve, each behind a confirm showing the operator the text going out), and the card prints no reference on purpose because a ticket carries only a cuid. 🚨 THE HOLE THIS CLOSES: the pile asks for status OPEN only, so every AWAITING_USER ticket was invisible on the Desk and a member who answered was waiting on nobody. The register carries all four states the table can hold — CASE_STATES is read per kind, so UNDER_REVIEW is offered for complaints and never for support, which has no such state. BACKEND: listForAdmin had take:200, which is a ceiling and not paging — the 201st ticket was simply unreachable and nothing on screen said the list had been cut. It now pages and returns a total, so the register says '1–50 of 431' instead of silently showing a prefix. ⚠️ fetchCasePage READS AN ENVELOPE AND TOLERATES A BARE ARRAY, deliberately: this rebuild already shipped the opposite mistake once, when a type claiming an envelope over a bare array rendered an empty alerts inbox with alerts waiting.",
  },
  {
    legacy: '/admin/dealers',
    desk: '/admin/desk/people',
    coverage: 'replaced',
    note: "The Dealers segment on People is the directory itself. All four legacy filter tabs are chips with the pending count on the chip, the search box covers name, licence and city, and every legacy write is here: review-and-activate, verify-but-keep-inactive, deactivate, reactivate, edit and add — each a confirm that restates what it does to DEALER_TRANSFER checkout, with a ticklist reason on the audit row. THE LAST GAP IS CLOSED: an auto-added dealer's 'Came from transfer' row is now a link into the sale that produced it. ⚠️ IT USES ?txn= AND NOT ?order= — the id on a DealerRow is a TRANSACTION id, and the Ledger resolves ?order= through fetchOrderCard, which wants an ORDER and would 404. The comment that sat here saying 'no click-through: the order dossier has no Desk home yet' stopped being true when the Order drawer landed and stayed in place afterwards, leaving the one piece of context that explains why a dealer appeared in the registry on screen as an unusable cuid.",
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
    coverage: 'replaced',
    note: "THE LEGACY PAGE WAS A REPORT WITH NO ACTIONS — it ranked dead ACTIVE listings by age x price and, in its own words, told the operator to 'click into a listing's dossier to delete it'; the nudge-seller feature it advertised never existed. The Desk beats it twice over. The pile emits a stale_listing card for the worst FIVE, which opens the Listing drawer where take-down with a reason lives — a worklist, not a report. And the FULL ranked list is now a Dead stock segment on the listings register, so the long tail the top five hid is reachable. ⚠️ A RANKING, NOT A STATUS: it is a different endpoint (/admin/freshness-graveyard) ordering ACTIVE listings server-side, which getListings cannot express — so it is fetched whole rather than paged, and the search box is HIDDEN on that segment rather than left present and inert. 🚨 TWO FIELDS ON THE WIRE ARE DELIBERATELY NOT DECLARED IN THE FRONTEND TYPE: sellerEmail, which the legacy report printed under every row and the Desk rule forbids; and staleScore, which is age x price in rands and reads as money — '412 000' beside a rifle is a number an operator would act on. Both are asserted absent from the mapped row, so no component can render them by reaching for what happens to be in the response.",
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
