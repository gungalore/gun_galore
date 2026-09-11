/**
 * THE DESK — the Now board's pure decisions.
 *
 * 🚨 THIS FILE EXISTS BECAUSE app/ IS NOT TESTABLE. vitest.config.ts collects
 * `lib/**\/*.spec.ts` and `components/**\/*.spec.tsx` and nothing else, so a
 * spec written beside app/admin/desk/page.tsx is never collected: it reports
 * nothing, fails nothing, and passes the build gate BY NOT EXISTING. The card
 * →drawer mapping below is the one piece of this board where being wrong opens
 * a drawer on an id of the wrong kind — which 404s, and reads to the operator
 * as a missing record rather than a wiring bug. It has to be pinnable.
 *
 * Everything here is a pure function of its arguments. No fetch, no React, no
 * window — that is what lets the spec assert on it.
 */
import type { CaseKind } from './desk-case';
import type { DeskCardData } from './desk-feed';
import type { OrderCard } from './desk-orders';

/* ────────────────────────────────────────────────────────────────────────
 * The lenses
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Now's six lenses, in the order the chips are drawn.
 *
 * ⚠️ 'today' IS THE PILE AND MUST STAY THE DEFAULT. A passive register is never
 * what an operator should land on when the thing they came to do is work
 * today's cards. Everything after it is a record you visit with a question.
 *
 * ⚠️ THE NAMES ARE THE LEDGER'S OWN, on purpose. `orders`, `sales` and `books`
 * were already the Ledger's `?view=` values, so the redirect that replaced
 * /admin/desk/ledger is a path change and not a vocabulary change — an old
 * bookmark keeps meaning what it meant.
 */
export const NOW_VIEWS = ['today', 'cases', 'listings', 'orders', 'sales', 'books'] as const;
export type NowView = (typeof NOW_VIEWS)[number];

/**
 * The word on the chip, and the word a failure region uses for the same lens.
 *
 * ⚠️ ONE MAP, BECAUSE THE FAILURE REGION NAMES THE REGISTER IT IS NOT ABOUT.
 * feedFailure() below promises the operator that "the Sales register below is
 * unaffected", and the chip they pressed says "Sales". A second hard-coded list
 * in the page is how that region ends up naming a lens by one word while the
 * chip above it uses another — on the one board whose failure text is a claim
 * about what is still trustworthy.
 */
export const NOW_VIEW_LABEL: Record<NowView, string> = {
  today: 'Today',
  cases: 'Cases',
  listings: 'Listings',
  orders: 'Orders',
  sales: 'Sales',
  books: 'Books',
};

/** `?view=` → a lens. Anything unrecognised is the pile. */
export function parseNowView(raw: string | null | undefined): NowView {
  return (NOW_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as NowView) : 'today';
}

/**
 * Which of the five tabs lights for a lens.
 *
 * ⚠️ THE LEDGER TAB SURVIVED ITS PAGE. DESK_TABS still carries a Ledger entry
 * pointing at /admin/desk/ledger, which now redirects here — so without this
 * the operator would arrive on the order book with the Desk tab lit and the
 * tab they pressed dark. components/desk/tabs.tsx is not this track's to edit
 * and does not need to be: `active` is a prop, and the page knows which end of
 * the money it is showing.
 */
export function activeTabFor(view: NowView): 'desk' | 'ledger' {
  return view === 'orders' || view === 'sales' || view === 'books' ? 'ledger' : 'desk';
}

/**
 * Whether the pile's j/k/Enter/a/l keys are asleep.
 *
 * ⚠️ THE CURSOR IS ALWAYS A PILE CARD, WHATEVER IS ON SCREEN. usePileKeys is
 * mounted unconditionally and `selected` indexes the feed, so in a register
 * lens `a` fired the primary action on a card the operator could not see and
 * `l` sank one. The narrow rule: only four card types carry a `kind:'undo'`
 * primary (dispatch_check:nudge, unanswered_question:remind, and
 * warden:acknowledge on both Warden faces) and none of them moves money — but
 * `l` sinks ANY selected card and sinking has no undo window.
 *
 * The overlay half is older and unchanged: without it, "a" typed into a
 * rejection note inside a drawer fires the primary action on the card behind
 * it.
 */
export function pileKeysSuspended(state: { view: NowView; stackDepth: number }): boolean {
  return state.stackDepth > 0 || state.view !== 'today';
}

/* ────────────────────────────────────────────────────────────────────────
 * What a failed feed read costs
 * ──────────────────────────────────────────────────────────────────────── */

/** The words a FailedRegion needs: what broke, and what it did NOT break. */
export interface FeedFailureNote {
  title: string;
  scopeNote: string;
}

/**
 * What a failed `fetchDeskFeed()` actually costs the operator, per lens.
 *
 * 🚨 THIS EXISTS BECAUSE THE FAILURE HAD NO SURFACE AT ALL OUTSIDE THE PILE.
 * The Now board renders the money line from `feed.money` and, until this pass,
 * drew it as `{feed ? <MoneyLine/> : null}` with the only FailedRegion sitting
 * INSIDE the `view === 'today'` branch. So a failed read on any register lens
 * blanked Held / Payable / Blocked / Refund pending and said nothing — and a
 * correct R0-blocked board and a board that could not ask look identical. The
 * figure that goes missing is how much money is stuck.
 *
 * ⚠️ THE TWO STATES ARE NOT THE SAME CLAIM, AND SAYING SO IS THE WHOLE JOB.
 * `stale: true` means a REFRESH failed over figures that loaded fine sixty
 * seconds ago; the numbers stay on screen (the Health board takes the same line
 * — a failed sweep leaves the previous reading up rather than blanking it) and
 * the region's job is to say they are no longer live. `stale: false` means
 * there is nothing on screen at all. A region that says "missing" over four
 * visible figures teaches the operator to disbelieve the region; one that says
 * "last good read" over an empty row teaches them to disbelieve the board.
 *
 * ⚠️ AND IT NAMES THE SIBLING IT DID NOT TOUCH. Every register owns its own
 * fetch and its own FailedRegion (cases-register.tsx and the four beside it),
 * so a dead feed leaves the list under it correct. Without that sentence the
 * operator has a red box above a list and no way to know whether the list is
 * suspect too — which costs more than the failure did.
 */
export function feedFailure(state: { view: NowView; stale: boolean }): FeedFailureNote {
  const sibling =
    state.view === 'today'
      ? ''
      : ` — the ${NOW_VIEW_LABEL[state.view]} register below reads its own endpoint and is unaffected`;

  if (state.stale) {
    return {
      title: 'Couldn’t refresh the board',
      scopeNote: `the figures on screen are the last good read, not a live one${sibling}`,
    };
  }

  return {
    title: state.view === 'today' ? 'Couldn’t load the board' : 'Couldn’t load the money line',
    scopeNote:
      (state.view === 'today'
        ? 'the money line and today’s cards'
        : 'the money line and the header counts') + sibling,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Cards → drawers
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * What a drawer-kind action opens.
 *
 * The listing target carries the card's own title and reference so the drawer
 * header is right in the frame before the dossier lands — the card already
 * knows them, and a header that says "Loading…" over a decision the operator
 * has already read on the card is a step backwards.
 */
export type DrawerTarget =
  | { sort: 'listing'; listingId: string; title: string; reference?: string; cardId: string }
  | { sort: 'case'; caseKind: CaseKind; caseId: string }
  | { sort: 'member'; userId: string; cardId: string }
  /** `card` is the cart parent when the board that opened this already had it. */
  | { sort: 'order'; transactionId: string; card?: OrderCard | null }
  | { sort: 'payout-run' };

/**
 * The entity behind a card id.
 *
 * ⚠️ THE SERVER MINTS CARD IDS AS `type:entityId` (see DeskService), and the
 * entity half is what every drawer wants. Stripping the card's own type is
 * safer than splitting on the first colon: a cuid never contains one today,
 * but a future reference format might, and a drawer opened on half an id 404s
 * in a way that looks like a missing record rather than a parsing bug.
 */
export function entityIdOf(card: Pick<DeskCardData, 'id' | 'type'>): string {
  const prefix = `${card.type}:`;
  return card.id.startsWith(prefix) ? card.id.slice(prefix.length) : card.id;
}

/**
 * Which drawer a card opens, or null when nothing is built for it.
 *
 * 🚨 EVERY ENTRY BELOW WAS CHECKED AGAINST THE `cards.push({ id: … })` LITERAL
 * THAT MINTS IT, not against the card's name. A Transaction id fed to a drawer
 * keyed on an Order — or the reverse — 404s, and a 404 on this board reads to
 * the operator as "that sale is gone", which is a far more expensive wrong
 * answer than a button that admits it does nothing. What the server sends
 * today (backend/src/desk/desk.service.ts):
 *
 *   firearm_transfer:<Transaction.id>   dealerVerificationStatus PENDING_ADMIN_REVIEW
 *   dispute:<Transaction.id>            paymentStatus DISPUTED
 *   dispatch_check:<Transaction.id>     HELD, paid, past the dispatch window
 *   payout_run:today                    a LITERAL — synthesised, no entity at all
 *   complaint:<Complaint.id>            support:<SupportTicket.id>
 *   listing_review:<Listing.id>         stale_listing:<Listing.id>
 *   seller_verification:<User.id>
 *   warden:<key|proposalId>             unanswered_question:<Question.id>
 *
 * ⚠️ NULL IS STILL A REAL ANSWER. `warden` and `unanswered_question` have no
 * drawer and ship no `drawer` action either, so the null is reached only by
 * pressing Enter on them — see the caller, which follows their `link` action
 * instead of swallowing the press.
 */
export function drawerTargetFor(card: DeskCardData): DrawerTarget | null {
  const id = entityIdOf(card);
  switch (card.type) {
    // ⚠️ THE SAME DRAWER AS listing_review, ON PURPOSE. A dead listing and a
    // listing awaiting review are the same object needing the same dossier;
    // what differs is why it is on the pile. Take-down wants an ACTIVE
    // listing, which until this card had no door into the Desk at all.
    case 'stale_listing':
    case 'listing_review':
      return {
        sort: 'listing',
        listingId: id,
        title: card.headline,
        reference: card.reference,
        // ⚠️ THE CARD ID, NOT A REBUILT ONE. Two card types open this drawer
        // and dropCard matches on the exact id, so reconstructing
        // `listing_review:<id>` silently no-ops for a stale_listing card and
        // leaves a taken-down listing sitting on the pile.
        cardId: card.id,
      };
    /**
     * 🚨 THIS CARD HAD NO DOOR, AND THE HOLE WAS OPENED BY CLOSING A WORSE ONE.
     * act() used to answer seller_verification:approve by writing
     * `kycStatus: 'VERIFIED'` straight onto the row — no UNDER_REVIEW guard, so
     * two tabs could both decide; no reviewer stamp; no reason; no audit row on
     * a firearms marketplace; the open KYC_REVIEW alerts left standing and the
     * seller never told. That refusal is correct and stays. But the card face
     * still offers "Approve selling…", and with no entry here it landed on the
     * null branch, which told the operator to "use the legacy admin panel" — a
     * panel CLAUDE.md records as deleted and desk-guard.cjs fails the build for
     * reintroducing. A removed bypass has to leave a route behind, or the
     * security fix reads to its only user as a broken button.
     *
     * MemberDrawer is that route: it already holds the KYC dossier, the
     * approve and reject reason lists, and it posts to
     * POST /admin/users/:id/kyc-review — the endpoint act() now names.
     */
    case 'seller_verification':
      return { sort: 'member', userId: id, cardId: card.id };
    case 'complaint':
      return { sort: 'case', caseKind: 'complaint', caseId: id };
    case 'support':
      return { sort: 'case', caseKind: 'support', caseId: id };
    /**
     * 🚨 THREE TRANSACTION-ID CARDS, ONE DRAWER, AND IT IS THE RIGHT ONE FOR
     * ALL THREE — but the fit is not equally good and the difference is worth
     * naming rather than smoothing over.
     *
     *   firearm_transfer — OrderDrawer's Dealer fold is literally this card's
     *     dossier, and order-actions.tsx carries the stock-in override
     *     (overrideDealerVerification, offered only while
     *     dealerVerificationStatus is set and not APPROVED). Exact fit.
     *   dispatch_check — the Parcel fold is the answer to "where is it". The
     *     card's own primary stays the undoable Nudge; this is the dossier
     *     behind it. It ships no `drawer` action, so this entry is reached by
     *     pressing Enter.
     *   dispute — the money levers are there (hold, lift, refund, release),
     *     but ⚠️ ORDER-DRAWER DECIDES "DISPUTED" FROM A COMPLAINT COUNT, NOT
     *     FROM paymentStatus: order-drawer.tsx passes
     *     `disputed={dossier.complaints.length > 0}`. Three writers set
     *     paymentStatus DISPUTED and two of them create no Complaint row
     *     (transactions.service.ts raiseDispute, and the chargeback webhook),
     *     so for those the drawer offers the plain "Release …" — which
     *     admin.service.ts refuses, because releaseTransaction's CAS pins
     *     paymentStatus HELD. It fails LOUDLY with "Transaction is no longer
     *     releasable", not silently, and the dossier itself is correct; but it
     *     is the wrong button on a money surface. The fix is one expression in
     *     components/desk/order-drawer.tsx, which is not this track's file.
     *     Routing the card here is still strictly better than the sentence it
     *     replaces, which sent the operator to a panel that does not exist.
     */
    case 'firearm_transfer':
    case 'dispute':
    case 'dispatch_check':
      return { sort: 'order', transactionId: id };
    /**
     * ⚠️ `payout_run:today` HAS NO ENTITY HALF — the tail is the literal word
     * "today", because the card is synthesised from moneySnapshot() whenever
     * payableCents > 0 rather than read off a row. entityIdOf therefore returns
     * the string "today", and any drawer keyed on an id would be handed it.
     * The run is a SET of sales, so the drawer it opens takes no id at all.
     */
    case 'payout_run':
      return { sort: 'payout-run' };
    default:
      return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Cards → links
 * ──────────────────────────────────────────────────────────────────────── */

/** The path the server still mints on all three Warden faces. */
const RETIRED_WARDEN_HREF = '/admin/desk/site';
/** Where the chat and the approval queue actually live now. */
const WARDEN_SURFACE = '/admin/desk/agent';

/**
 * Where a card's `link` action really goes.
 *
 * 🚨 EVERY WARDEN CARD SHIPS href '/admin/desk/site' AND THAT BOARD NO LONGER
 * EXISTS. backend/src/desk/desk.service.ts mints it three times — the red gate,
 * the proposal and the diagnosis — each on an action LABELLED "Open the chat".
 * app/admin/desk/site/route.ts is now a bare 307 onto /admin/desk/health, and
 * app/admin/desk/agent/page.tsx is where the conversation (thread.tsx) and the
 * proposal approval (queue.tsx, "THE PRIMARY CONTENT OF THIS SURFACE") went.
 * So the button said chat, the redirect said health, and the operator landed on
 * gates and vitals with no composer and no Approve anywhere on the page. A
 * button that opens the wrong board is worse than one that admits it is dead,
 * because the operator concludes the proposal is gone.
 *
 * ⚠️ THE OLD COMMENT IN page.tsx ASSERTED THE OPPOSITE — that /admin/desk/site
 * "IS that card's surface" — and a file already in this tree disproves it. Two
 * more callers went the same way: `fire()`'s link branch (the card's own button)
 * and its money/gated fallthrough, which answers "Approve the fix…" by
 * following the card's sibling `link` action. All three now come through here,
 * which is why this is a function and not three edited string literals.
 *
 * ⚠️ GATED ON THE CARD TYPE, NOT ON THE PATH ALONE. /admin/desk/site is also an
 * operator's health bookmark and the Desk manifest's "Site health" shortcut,
 * and those genuinely mean Health — which is exactly what the redirect gives
 * them. Only a `warden` card's link is about the chat. A non-Warden card
 * pointing there tomorrow keeps the redirect's answer.
 *
 * ⚠️ THE RED GATE GOES TO AGENT TOO, AND THAT IS A DECISION RATHER THAN AN
 * OVERSIGHT. Its SUBJECT (the config gate) is rendered on Health; its only
 * ACTION is "Open the chat", and the chat is on Agent. Following a button to
 * where its own label points beats following it to where its topic is filed.
 *
 * ⚠️ RESIDUAL GAP, NAMED: this rewrites the href on the way OUT of the pile.
 * The server still sends '/admin/desk/site' and every other consumer of that
 * field — a future card list, an email, anything outside this board — still
 * gets the retired path. Fixing it at source is three string literals in
 * desk.service.ts, which is not this track's file.
 */
export function linkHrefFor(card: Pick<DeskCardData, 'type'>, href: string): string {
  if (card.type !== 'warden') return href;
  // ⚠️ SPLIT BEFORE COMPARING, AND CARRY THE TAIL. The redirect this replaces
  // passes `nextUrl.search` across whole because two deep links are live on
  // that surface; a plain `href === path` test would miss a query'd href and a
  // plain replace() would corrupt one that contained the path twice.
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  if (path !== RETIRED_WARDEN_HREF) return href;
  return WARDEN_SURFACE + (cut === -1 ? '' : href.slice(cut));
}

/* ────────────────────────────────────────────────────────────────────────
 * /admin/desk/ledger → /admin/desk
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Translate a legacy Ledger URL onto the Now board.
 *
 * 🚨 THE PARAM NAMES ARE NOT NEGOTIABLE AND THAT IS THE WHOLE JOB OF THIS
 * FUNCTION. `?order=` and `?txn=` are minted by lib/desk-search.ts for every
 * order and transaction hit in the global palette; `?txn=` is also hand-written
 * in app/admin/desk/people/page.tsx; `?filter=dispatch-overdue` is emitted by
 * the backend health service and reaches the operator through the Site board;
 * and `?status=` / `?page=` are the legacy /admin/orders names kept through the
 * first cutover precisely so bookmarks and pasted links survive. A redirect
 * that dropped any of them would break links that already exist in the
 * operator's mail and in their browser history, silently, by landing on an
 * unfiltered page one that looks like it worked.
 *
 * ⚠️ THE PRECEDENCE IS THE OLD READER'S, LINE FOR LINE. filter wins and forces
 * the sales lens; then an explicit sales/books view; then `txn`, which returns
 * WITHOUT switching to orders (a single sale is not a cart, and moving the list
 * out from under the operator to a view that does not contain what they opened
 * would be its own small lie); then orders with status/page/order.
 *
 * ⚠️ status AND page TRAVEL VERBATIM, unparsed. The Now board runs them through
 * parseOrderSegment / parseOrderPage exactly as the Ledger did, and a second
 * copy of that parsing here is a second thing to drift.
 *
 * ⚠️ A BARE /admin/desk/ledger LANDS ON ORDERS, NOT ON THE PILE. It was the
 * Ledger tab's href and still is; the payout run that used to be its default
 * lens is now a drawer, and opening a drawer over a board somebody navigated to
 * by pressing a tab is not what pressing that tab used to do. Orders is the
 * Ledger's remaining list, and activeTabFor keeps the tab lit there.
 */
export function ledgerRedirect(search: string): string {
  const q = new URLSearchParams(search);
  const out = new URLSearchParams();

  const filter = q.get('filter');
  let view: NowView | null = null;
  if (filter === 'accept-stalled' || filter === 'dispatch-overdue') {
    view = 'sales';
    out.set('filter', filter);
  } else if (q.get('view') === 'sales') {
    view = 'sales';
  } else if (q.get('view') === 'books') {
    view = 'books';
  } else if (q.get('view') === 'orders') {
    view = 'orders';
  }

  const txn = q.get('txn');
  if (txn) {
    if (view) out.set('view', view);
    out.set('txn', txn);
    return withQuery(out);
  }

  const order = q.get('order');
  const status = q.get('status');
  const page = q.get('page');

  // ⚠️ ORDERS IS THE DEFAULT LENS, AND ITS PARAMS TRAVEL WITH IT. A URL that
  // named sales or books — through `view` or through a Health `filter` — keeps
  // that lens and leaves the orders params behind, because `status` and
  // `page` mean nothing there and forwarding them would hand a future sales
  // lens a filter nobody chose.
  if (view && view !== 'orders') {
    out.set('view', view);
    return withQuery(out);
  }

  // 🚨 AND EVERYTHING ELSE IS CARRIED. This branch used to be guarded by
  // `if (q.get('view') !== 'orders' && !order) { set view; return }`, so a URL
  // with neither a view nor an order — `?status=PAID&page=3`, the shape the
  // old page minted most — took the early return and arrived at an UNFILTERED
  // PAGE ONE. Measured against the running server, not reasoned:
  //   /admin/desk/ledger?status=PAID&page=3  ->  /admin/desk?view=orders
  // The route handler's header calls that exact string out as "the failure
  // nobody reports", because a filtered list and an unfiltered one look alike
  // until somebody acts on a row that should never have been on screen.
  out.set('view', 'orders');
  if (status) out.set('status', status);
  if (page) out.set('page', page);
  if (order) out.set('order', order);
  return withQuery(out);
}

function withQuery(q: URLSearchParams): string {
  const qs = q.toString();
  return qs ? `/admin/desk?${qs}` : '/admin/desk';
}
