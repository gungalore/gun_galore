'use client';

/**
 * THE DESK — Now.
 *
 * One board, and it answers ONE question: is there anything I have to do, and
 * is any of it late? Everything that needs the operator is a card; acting on it
 * makes it leave. The registers beside it — cases, listings, orders, sales,
 * books — are the record you consult with a question, not somewhere you live.
 *
 * 🚨 THE RIBBON IS GONE, AND THAT WAS THE POINT OF THIS PASS. Five figures sat
 * across the top of this board and four of them never changed what the operator
 * did next. It was the first thing the eye landed on, it was a dashboard
 * pretending to be a worklist, and on a phone it pushed the first card below
 * the fold. `DeskFeed.ribbon` is still sent by the server and, as of this pass,
 * `grep -rn '\.ribbon\b' app lib components` finds no reader anywhere in this
 * frontend — deliberately, and worth deleting on the server side rather than
 * re-rendering on this one. The Ribbon COMPONENT is alive and is not what
 * went: OrderDrawer and the kit fixture still draw one.
 *
 * 🚨 AND THE MONEY LINE CAME UP FROM THE RAIL. Held / Payable / Blocked /
 * Refund pending lived in a 340px desktop-only <aside>; on a phone DeskShell
 * renders that rail INSIDE <main> AFTER {children} (shell.tsx — a structural
 * choice, not a hidden copy), so the one figure that says whether money is
 * stuck sat below every band and every card. Fourteen cards is a long scroll to
 * learn that R0 is blocked. It is now the first block on the board in both
 * layouts, and the rail no longer carries it at all.
 *
 * ⚠️ THE SERVER OWNS THE ORDER. This file renders bands in a fixed sequence and
 * cards in the order they arrived. It never sorts, never re-bands and never
 * decides what is overdue. See lib/desk-feed.ts.
 *
 * ⚠️ ONE DRAWER IS MOUNTED AT A TIME, AND THAT IS WHAT MAKES ESCAPE WORK.
 * Drawer binds a capture-phase keydown on `document` and defers only to a
 * `.dk-dialog` above it — it knows nothing about a second drawer. Two mounted
 * at once therefore both hear one Escape and both close, so an operator who
 * stepped from a complaint into the order holding its money would lose the
 * complaint as well on the way back. The open drawers are a stack in state and
 * only the top of it is rendered; closing pops one level and re-opens the one
 * beneath, which is the behaviour the single Escape listener already describes.
 * See components/desk/overlays.tsx.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AllClear,
  Band,
  CaseDrawer,
  Chip,
  DeskCard,
  DeskShell,
  FailedRegion,
  IconAlert,
  IconBolt,
  IconCheck,
  IconClock,
  IconInfo,
  IconLock,
  Kv,
  ListingDrawer,
  MemberDrawer,
  OrderDrawer,
  RailCard,
  ShortcutFooter,
  SkeletonPile,
  UndoToast,
  useSwipe,
  usePileKeys,
  useIsPhone,
  useUndo,
} from '@/components/desk';
import {
  BAND_LABEL,
  BAND_ORDER,
  actBeacon,
  actOnCard,
  fetchDeskFeed,
  formatReturnTime,
  sinkCard,
  type DeskCardData,
  type DeskFeed,
  type FeedAction,
} from '@/lib/desk-feed';
import {
  NOW_VIEWS,
  NOW_VIEW_LABEL,
  activeTabFor,
  drawerTargetFor,
  feedFailure,
  linkHrefFor,
  parseNowView,
  pileKeysSuspended,
  type DrawerTarget,
  type NowView,
} from '@/lib/desk-pile';
import {
  fetchOrderBook,
  fetchOrderCard,
  orderRowReference,
  parseOrderPage,
  parseOrderSegment,
  type OrderBookPage,
  type OrderRow,
  type OrderSegment,
} from '@/lib/desk-orders';
import { describeFailure } from '@/lib/desk-auth';
import type { SaleFilter } from '@/lib/desk-transactions';
import { CasesRegister } from './cases-register';
import { ListingsRegister } from './listings-register';
import { OrdersRegister } from './orders-register';
import { SalesRegister } from './sales-register';
import { BooksRegister } from './books-register';
import { PayoutRunDrawer } from './payout-run-register';

/** How often the pile refreshes itself. */
const REFRESH_MS = 60_000;

const TAG_ICON = {
  clock: IconClock,
  alert: IconAlert,
  lock: IconLock,
  check: IconCheck,
  info: IconInfo,
  bolt: IconBolt,
} as const;

/**
 * The chips, in the order they are drawn.
 *
 * ⚠️ THE ORDER AND THE WORDS BOTH COME FROM lib/desk-pile.ts NOW. NOW_VIEWS is
 * already the order the chips are drawn in, and NOW_VIEW_LABEL is the word a
 * failure region uses when it promises "the Sales register below is
 * unaffected". A second list here is how the chip and the region that names it
 * drift apart — and the region's sentence is a claim about what the operator
 * can still trust.
 */
const LENSES: { key: NowView; label: string }[] = NOW_VIEWS.map((key) => ({
  key,
  label: NOW_VIEW_LABEL[key],
}));

interface Trouble {
  title: string;
  detail: string;
  scopeNote?: string;
}

/**
 * A cardId no card can have. See the ?listing= effect: a listing opened from
 * search has no card behind it, and dropCard must therefore match nothing.
 */
const DEEP_LINK_CARD_ID = 'deep-link:no-card';

/** Nothing to open, and why. Not a failure — a shape. */
const NO_LINES = {
  tag: 'nothing to open',
  body: 'This order has no lines. A dossier is a line’s dossier, so there is nothing to open.',
};

export default function DeskPage() {
  const [feed, setFeed] = React.useState<DeskFeed | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState(0);
  const [trouble, setTrouble] = React.useState<Trouble | null>(null);
  /** Open drawers, innermost last. Only the last one is rendered. */
  const [stack, setStack] = React.useState<DrawerTarget[]>([]);
  const phone = useIsPhone();
  const router = useRouter();
  /**
   * The pile is the worklist; the registers are the record.
   *
   * ⚠️ LENSES, NOT SIX TABS — components/desk/tabs.tsx calls its list "the five
   * surfaces... nothing configurable about this list", and a register is
   * somewhere an operator goes with a question rather than somewhere they live.
   * Orders, Sales and Books arrived here when the Ledger page was replaced by a
   * redirect; they keep the Ledger's own `?view=` values so a bookmark survives.
   */
  const [view, setView] = React.useState<NowView>('today');
  /** Bumped after a case decision so the register re-reads. */
  const [casesNonce, setCasesNonce] = React.useState(0);

  /* ── the Orders lens ──────────────────────────────────────────────────
   *
   * ⚠️ EVERY LENS KEEPS ITS OWN FILTER. Flipping the view never resets another
   * lens's segment: an operator who was three pages into REFUNDED, ducked back
   * to the pile to take a card, and came back expecting to carry on should find
   * their place — not page one of All.
   */
  const [orderSegment, setOrderSegment] = React.useState<OrderSegment>('ALL');
  const [orderPageIndex, setOrderPageIndex] = React.useState(1);
  const [orderPage, setOrderPage] = React.useState<OrderBookPage | null>(null);
  const [orderError, setOrderError] = React.useState<string | null>(null);
  const [openError, setOpenError] = React.useState<{ tag: string; body: string } | null>(null);
  const [resolvingOrderId, setResolvingOrderId] = React.useState<string | null>(null);
  /**
   * A deep-link narrowing on the sales lens.
   *
   * ⚠️ THE PARAM IS REACHABLE AND THE READER IS CORRECT; ITS TWO DESCRIBED
   * PRODUCERS ARE NOT. See the note in sales-register.tsx — nothing in this
   * repo emits ?filter=accept-stalled today, and the one live
   * ?filter=dispatch-overdue producer emits a legacy /admin/transactions path
   * that lib/desk-site.ts does not translate. A pasted link still works.
   */
  const [saleFilter, setSaleFilter] = React.useState<SaleFilter | null>(null);

  const undo = useUndo({
    onError: (err, action) =>
      setTrouble({
        title: 'That action did not go through',
        detail: `${action.message} — ${describeFailure(err)}`,
        scopeNote: 'the card is back in the pile',
      }),
  });

  const load = React.useCallback(async () => {
    try {
      setFeed(await fetchDeskFeed());
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Refresh on a timer and whenever the tab comes back. An operator who has
  // been in their email for ten minutes should not act on a stale pile.
  React.useEffect(() => {
    const id = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const openDrawer = React.useCallback((target: DrawerTarget) => {
    setStack((s) => [...s, target]);
  }, []);

  /** Close the top drawer, revealing whatever it was opened over. */
  const closeTop = React.useCallback(() => {
    setStack((s) => s.slice(0, -1));
  }, []);

  const top = stack.length > 0 ? stack[stack.length - 1] : null;

  /** Open one sale's dossier. No cart parent — the null-card case. */
  const openSale = React.useCallback(
    (transactionId: string) => {
      openDrawer({ sort: 'order', transactionId });
    },
    [openDrawer],
  );

  /* ── the Orders lens: reads ───────────────────────────────────────────
   *
   * ⚠️ EVERY READ TAKES A TICKET AND ONLY THE NEWEST MAY WRITE. Chips are
   * clicked faster than a list comes back, and nothing orders the replies — the
   * slow answer for CANCELLED landing after the fast one for REFUNDED would
   * paint cancelled orders under a chip that says Refunded, with the right
   * count in the header and no error anywhere.
   *
   * ⚠️ AND IT IS LAZY. Nothing fetches until the Orders lens is first opened,
   * so the pile — the reason the board exists — is never waiting behind a list
   * nobody has asked to see.
   */
  const orderTicket = React.useRef(0);
  const loadOrders = React.useCallback(async () => {
    const ticket = ++orderTicket.current;
    setOrderError(null);
    setOrderPage(null);
    // A stale "couldn't open GG-ORD-0042" hanging over a list that no longer
    // contains that order is a report about nothing on screen.
    setOpenError(null);
    try {
      const next = await fetchOrderBook(orderSegment, orderPageIndex);
      if (orderTicket.current === ticket) setOrderPage(next);
    } catch (err) {
      if (orderTicket.current === ticket) setOrderError(describeFailure(err));
    }
  }, [orderSegment, orderPageIndex]);

  React.useEffect(() => {
    if (view === 'orders') void loadOrders();
  }, [view, loadOrders]);

  /**
   * A new query starts on page one.
   *
   * ⚠️ IN THE HANDLER, NOT IN AN EFFECT KEYED ON orderSegment — and that is not
   * a style choice. People resets its page in an effect because nothing else on
   * that board ever sets a page; here the URL reader does. An effect would fire
   * on the render AFTER the reader picked `?status=PAID&page=3` up, see the
   * segment change, and reset the page to 1 — so every deep link past page one
   * would silently land on page one and look like it had worked.
   *
   * Without the reset at all, clicking a chip while three pages deep asks for
   * rows 41–60 of an eleven-row set and draws an empty state the operator reads
   * as a fact about the filter. Both failures are real; only the handler avoids
   * both.
   */
  const chooseSegment = React.useCallback((next: OrderSegment) => {
    setOrderSegment(next);
    setOrderPageIndex(1);
  }, []);

  /**
   * Open an order's dossier.
   *
   * ⚠️ TWO HOPS, BECAUSE getOrders CARRIES NO TRANSACTION ID. OrderDrawer is
   * keyed on a Transaction — a cart parent is reached THROUGH one of its lines
   * — and the list endpoint returns only `_count.transactions`. So the row
   * click fetches the order's dossier, takes its first line, and opens on that.
   * The cost is one round trip a payout row does not pay, and it is visible
   * (the row lights) rather than hidden.
   *
   * 🚨 THE TICKET IS WHAT KEEPS THE DRAWER ON THE ORDER THAT WAS CLICKED.
   * Nothing blocks a second click: DeskTable's row onClick fires regardless of
   * `resolvingOrderId`, which only lights a row. So two clicks race, and the
   * SLOWER reply landed last and won: the drawer silently swapped to an order
   * nobody asked for, with no error and nothing on screen to say it had
   * happened. That is a money bug — order-actions.tsx wires five levers to the
   * foot of this drawer, so an operator reading order B could release order A.
   */
  const openTicket = React.useRef(0);
  const resolveAndOpen = React.useCallback(
    async (id: string, label: string, alignSegment: boolean) => {
      const ticket = ++openTicket.current;
      setResolvingOrderId(id);
      setOpenError(null);
      try {
        const card = await fetchOrderCard(id);
        if (openTicket.current !== ticket) return;
        if (!card.firstTransactionId) {
          setOpenError(NO_LINES);
          return;
        }
        // A deep link arrives with no list behind it. Filtering to the order's
        // own status means closing the drawer lands the operator among orders
        // like the one they were sent, rather than on an unrelated page one.
        // A ROW click never does this — moving the list out from under someone
        // who just clicked it is the same sin as a jumping form field.
        if (alignSegment) {
          setOrderSegment(card.status);
          setOrderPageIndex(1);
        }
        openDrawer({ sort: 'order', transactionId: card.firstTransactionId, card });
      } catch (err) {
        // A failure for an order the operator has already navigated past would
        // post "couldn't open GG-ORD-0042" over a drawer that is open and
        // correct.
        if (openTicket.current !== ticket) return;
        setOpenError({
          tag: "couldn't open",
          body: `Order ${label}\n${describeFailure(err)}`,
        });
      } finally {
        // Only the newest resolve owns the spinner; a stale one clearing it
        // would un-light the row that is still genuinely resolving.
        if (openTicket.current === ticket) setResolvingOrderId(null);
      }
    },
    [openDrawer],
  );

  const openOrderRow = React.useCallback(
    (row: OrderRow) => {
      // ⚠️ NO NETWORK CALL FOR AN ORDER WITH NOTHING IN IT. An AWAITING_PAYMENT
      // order whose lines were all cancelled is a real shape, and a dossier is
      // a LINE's dossier — so there is nothing behind the click and the honest
      // answer is to say so rather than to spin and then fail.
      if (row._count.transactions === 0) {
        setOpenError(NO_LINES);
        return;
      }
      void resolveAndOpen(row.id, orderRowReference(row), false);
    },
    [resolveAndOpen],
  );

  /* ── the URL ──────────────────────────────────────────────────────────
   *
   * ⚠️ window.location, NOT useSearchParams — the same call the Site board
   * makes and for the same reason: reading the hook in a client board drags a
   * Suspense boundary around the whole page for a value that matters once.
   *
   * ⚠️ THE PARAM NAMES ARE LEGACY'S, TWICE OVER. `status` and `page` were
   * /admin/orders'; `order`, `txn` and `filter` were the Ledger's, and
   * lib/desk-search.ts mints two of them for every palette hit. The Ledger's
   * page is now a redirect into this reader (see ledger/page.tsx), so this is
   * the only place those names are understood.
   */
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);

    const rawFilter = q.get('filter');
    if (rawFilter === 'accept-stalled' || rawFilter === 'dispatch-overdue') {
      setSaleFilter(rawFilter);
      setView('sales');
    } else {
      setView(parseNowView(q.get('view')));
    }
    setOrderSegment(parseOrderSegment(q.get('status')));
    setOrderPageIndex(parseOrderPage(q.get('page')));

    /**
     * `?listing=<listingId>` opens straight onto one listing's drawer.
     *
     * Where a Listings hit in the global search lands. The drawer fetches its
     * own dossier from the id and decides its own actions from the loaded
     * status — review on PENDING_REVIEW, take down on ACTIVE or
     * PAYMENT_PENDING — so an arbitrary listing opens correctly whether or not
     * it is anywhere in today's pile.
     *
     * ⚠️ cardId IS THE DEEP-LINK SENTINEL, NOT A CARD. onDecided drops the
     * decided card from the pile by id; a listing opened from search has no
     * card, and passing a real-looking id would drop an unrelated one. A value
     * no card can carry drops nothing, which is correct — the feed reload after
     * a decision brings the board back in line.
     */
    const deepListing = q.get('listing');
    if (deepListing) {
      openDrawer({
        sort: 'listing',
        listingId: deepListing,
        title: 'Opening…',
        cardId: DEEP_LINK_CARD_ID,
      });
      return;
    }

    /**
     * `?txn=` opens ONE SALE and `?order=` opens a CART, and they are not
     * interchangeable.
     *
     * ⚠️ THEY TAKE DIFFERENT IDS. `?order=` resolves through fetchOrderCard,
     * which wants an ORDER id and looks up that cart's first line; a
     * transaction has no cart parent to resolve and opens the drawer directly
     * on the line — the null-card case the payout run has always used. Feeding
     * a transaction id to `?order=` would 404 against an order that does not
     * exist, and the failure would read as "this sale is missing" rather than
     * "wrong kind of id".
     */
    const deepTxn = q.get('txn');
    if (deepTxn) {
      openSale(deepTxn);
      return;
    }
    const deepOrder = q.get('order');
    if (deepOrder) {
      setView('orders');
      void resolveAndOpen(deepOrder, deepOrder, true);
    }
    // Mount only. A later render must not re-read a URL this page is writing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ⚠️ THE FIRST RUN IS SKIPPED, AND HAS TO BE. Both effects fire on the same
   * first commit, in declaration order: the reader above queues its state and
   * this writer would then run with the PREVIOUS render's state — view still
   * 'today' — and strip the very params the reader had just picked up. Skipping
   * one invocation means the URL is only ever written from state that came from
   * somewhere, and a plain visit with no params is left untouched.
   *
   * replaceState, not push: browsing chips must not fill the back button with a
   * filter history nobody wants to walk back through.
   */
  const urlPrimed = React.useRef(false);
  /**
   * The open sale, if any, so the address bar and the screen agree.
   *
   * ⚠️ IT IS READ OFF THE DRAWER STACK, NOT A SECOND PIECE OF STATE. The stack
   * is where "which sale is open" now lives; a mirror of it would be a second
   * thing to keep in step, and the two disagreeing is exactly how a `?txn=`
   * survived until the next state change and then vanished while its drawer
   * stayed open.
   */
  const openOrderTarget = top?.sort === 'order' ? top : null;
  /**
   * ⚠️ AND THE OPEN LISTING, BECAUSE THIS BOARD DID NOT USED TO HAVE A WRITER.
   * The pile read `?listing=` and wrote nothing at all, so a pasted listing
   * link simply stayed in the address bar. This board writes the query from
   * state, so without this line the writer would DELETE the param it was just
   * sent — the drawer open on screen and the URL no longer saying so, which is
   * the exact failure the `?txn=` note below describes.
   *
   * ⚠️ CASE AND MEMBER DRAWERS ARE STILL NOT IN THE URL, and that asymmetry is
   * real rather than an oversight: neither has ever had a param, so there is
   * nothing to preserve and nothing to break. A `?case=` is worth having and is
   * not this pass.
   */
  const openListingId = top?.sort === 'listing' ? top.listingId : null;
  React.useEffect(() => {
    if (!urlPrimed.current) {
      urlPrimed.current = true;
      return;
    }
    const q = new URLSearchParams();
    if (view !== 'today') q.set('view', view);
    if (view === 'orders') {
      // Defaults are omitted so a plain visit keeps a clean URL.
      if (orderSegment !== 'ALL') q.set('status', orderSegment);
      if (orderPageIndex > 1) q.set('page', String(orderPageIndex));
    }
    // ⚠️ THE FILTER SURVIVES THE WRITER TOO. It arrives from a pasted link, and
    // the writer rebuilds the query from state — so without this the narrowing
    // vanishes from the URL on the next state change while the banner on screen
    // still says the list is filtered.
    if (view === 'sales' && saleFilter) q.set('filter', saleFilter);
    if (openListingId) q.set('listing', openListingId);
    if (openOrderTarget) {
      if (openOrderTarget.card) q.set('order', openOrderTarget.card.id);
      else q.set('txn', openOrderTarget.transactionId);
    }
    const qs = q.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    );
  }, [view, orderSegment, orderPageIndex, saleFilter, openOrderTarget, openListingId]);

  /**
   * Switch lens, and invalidate anything the leaving lens still had in flight.
   *
   * ⚠️ INVALIDATE, DO NOT JUST CLEAR. deskFetch issues a plain fetch with no
   * AbortController, so a resolve already in the air still lands — and because
   * the Order drawer is gated on the stack rather than on `view`, it would open
   * over whatever lens the operator switched to. Bumping the ticket makes that
   * reply a no-op.
   */
  const switchView = React.useCallback((next: NowView) => {
    setView(next);
    openTicket.current += 1;
    setResolvingOrderId(null);
    setOpenError(null);
  }, []);

  /**
   * Take a decided card off the board without re-reading the whole feed.
   *
   * ⚠️ THE COUNTS COME OFF WITH IT. The band tallies and the overdue number are
   * rendered from the same feed object, so dropping only the card leaves the
   * rail insisting there are four listing reviews above a band showing three —
   * and that count is what an operator glances at to decide whether they are
   * finished.
   */
  const dropCard = React.useCallback((cardId: string) => {
    setFeed((f) => {
      if (!f) return f;
      const gone = f.cards.find((c) => c.id === cardId);
      if (!gone) return f;
      return {
        ...f,
        cards: f.cards.filter((c) => c.id !== cardId),
        bands: f.bands.map((b) =>
          b.key === gone.band ? { ...b, count: Math.max(0, b.count - 1) } : b,
        ),
        pile: gone.overdueSince
          ? { ...f.pile, overdue: Math.max(0, f.pile.overdue - 1) }
          : f.pile,
      };
    });
  }, []);

  // Cards still on screen: the one counting down under an undo window is
  // already gone as far as the operator is concerned.
  const visible = React.useMemo(
    () => (feed?.cards ?? []).filter((c) => !undo.isPending(c.id)),
    [feed, undo],
  );

  const selected = visible[cursor];

  /**
   * Follow a card's `link` action.
   *
   * ⚠️ SAME TAB FOR A DESK PATH. Every `href` the server mints today is
   * '/admin/desk/site' — the three Warden faces and nothing else
   * (desk.service.ts) — and window.open('_blank') on those started a SECOND
   * Desk tab with its own session read and its own 60s pollers, from a button
   * whose label is "Open the chat". A new tab is right for a surface that is
   * not this app; it is wrong for a room down the corridor. Anything that is
   * not an /admin/ path keeps the new tab, because leaving the Desk to look at
   * something external should not close the Desk.
   *
   * 🚨 AND THAT PATH IS NO LONGER A BOARD. Every caller below hands the href
   * through linkHrefFor(card, …) first, which sends a Warden card's "Open the
   * chat" to /admin/desk/agent — where thread.tsx and queue.tsx actually live —
   * instead of to /admin/desk/site, which is now a 307 onto Health. This
   * function stays href-only on purpose: it is also what a non-card link would
   * use, and the rewrite is a decision about a CARD.
   */
  const follow = React.useCallback(
    (href: string) => {
      if (href.startsWith('/admin/')) router.push(href);
      else window.open(href, '_blank', 'noopener');
    },
    [router],
  );

  const fire = React.useCallback(
    (card: DeskCardData, action: FeedAction) => {
      if (action.kind === 'link' && action.href) {
        follow(linkHrefFor(card, action.href));
        return;
      }
      if (action.kind === 'drawer') {
        const target = drawerTargetFor(card);
        if (target) {
          openDrawer(target);
          return;
        }
        /*
         * ⚠️ THE SENTENCE THAT USED TO BE HERE SENT THE OPERATOR TO A PANEL
         * THAT DOES NOT EXIST — "Use the legacy admin panel for this one until
         * its drawer ships", about a tree CLAUDE.md records as deleted at
         * cutover and desk-guard.cjs fails the build for reintroducing. With
         * the three Transaction cards and the payout run now routed
         * (lib/desk-pile.ts), no card type the server emits with a `drawer`
         * action reaches this branch. It stays because a type added server-side
         * tomorrow will, and a swallowed press is how an operator concludes the
         * panel is broken and stops trusting the rest of it.
         */
        setTrouble({
          title: 'Nothing to open yet',
          detail:
            `“${action.label}” on a ${card.typeLabel} card has no drawer on the Desk.\n` +
            `Card ${card.id}. Nothing else here opens it either — this is a gap, not a ` +
            `place you have not looked.`,
          scopeNote: 'nothing was sent — the card is untouched',
        });
        return;
      }
      /*
       * 🚨 MONEY HAS ONE PATH AND IT IS NOT THIS ONE — but it must not die
       * SILENTLY here, which is what it did. The Warden proposal card carries
       * "Approve the fix…" (kind 'money'); fire() handled link, then drawer,
       * then returned for everything else, so the operator pressed the button
       * on the pile and nothing happened at all. A dead control is worse than a
       * missing one because it is trusted.
       *
       * It is NOT reimplemented here. A second approval surface means a second
       * copy of the compare-and-swap that makes the confirm honest, and the
       * drifted copy is the one nobody reads. So the press takes the operator
       * to the card's own surface and says so when it cannot.
       */
      if (action.kind === 'money' || action.kind === 'gated') {
        /*
         * 🚨 THE PAYOUT RUN CARD REPORTED A BUG ON EVERY PRESS, IN BOTH GATE
         * STATES. The generic rule below looks for a sibling `kind:'link'`
         * action to navigate to, and `payout_run:today` carries none — its two
         * actions are the money/gated primary and a `drawer` secondary — so
         * both branches of the server's gate fell through to "…carries no link
         * to that surface, which is a bug." The card's surface is a drawer, not
         * a link, and the drawer is where the confirm restates the command.
         */
        const target = drawerTargetFor(card);
        if (target?.sort === 'payout-run') {
          openDrawer(target);
          return;
        }
        /*
         * 🚨 AND THIS IS THE OTHER HALF OF THE WARDEN REPOINT. "Approve the
         * fix…" is the proposal card's money action; it is answered by
         * following the card's sibling `link`, which is the same
         * '/admin/desk/site' the Enter key follows. Sending the operator to
         * Health to approve a proposal puts them on a board with no approval
         * queue on it at all — see app/admin/desk/agent/queue.tsx, which is the
         * surface that has one.
         */
        const home = card.actions.find((x) => x.kind === 'link' && x.href);
        if (home?.href) {
          follow(linkHrefFor(card, home.href));
          return;
        }
        setTrouble({
          title: 'Approve it on its own surface',
          detail:
            `"${action.label}" moves money, and money is confirmed where the\n` +
            `exact command can be restated — not from the pile.\n` +
            `Card ${card.id} carries no link to that surface, which is a bug.`,
          scopeNote: 'nothing was sent — the card is untouched',
        });
        return;
      }
      // Anything left is a kind this board does not dispatch. Say so rather
      // than returning quietly — that silence is the bug above.
      if (action.kind !== 'undo') {
        setTrouble({
          title: 'That button is not wired here',
          detail: `"${action.label}" is a ${action.kind} action on ${card.id}.`,
          scopeNote: 'nothing was sent — the card is untouched',
        });
        return;
      }
      undo.run({
        cardId: card.id,
        message: action.doneMessage ?? `${action.label} ${card.reference ?? ''}`.trim(),
        commit: () => actOnCard(card.id, action.key),
        beacon: actBeacon(card.id, action.key),
      });
    },
    [follow, openDrawer, undo],
  );

  const sink = React.useCallback(
    (card: DeskCardData) => {
      // Later is not undoable — it is already reversible by acting on the card
      // when it comes back — so it commits immediately.
      void sinkCard(card.id)
        .then(load)
        .catch((err) =>
          setTrouble({
            title: 'That action did not go through',
            detail: describeFailure(err),
            scopeNote: 'the card is back in the pile',
          }),
        );
    },
    [load],
  );

  usePileKeys({
    onMove: (d) => setCursor((c) => Math.max(0, Math.min(visible.length - 1, c + d))),
    onOpen: () => {
      if (!selected) return;
      const target = drawerTargetFor(selected);
      if (target) {
        openDrawer(target);
        return;
      }
      /*
       * ⚠️ ENTER ON A CARD WITH NO DRAWER USED TO DO NOTHING AT ALL — a silent
       * key on a board whose whole promise is that every card leads somewhere.
       * The two types that reach here (warden and unanswered_question) ship no
       * `drawer` action, but every Warden face carries a `link` one.
       * unanswered_question carries only its undoable Remind, so Enter there
       * still does nothing; that is a real remaining gap and not worth a red
       * region over.
       *
       * 🚨 THE SENTENCE THAT USED TO END THIS NOTE WAS FALSE, AND A FILE IN
       * THIS TREE DISPROVED IT. It said the card's href /admin/desk/site "IS
       * that card's surface". That board split: app/admin/desk/site/route.ts is
       * a 307 onto /admin/desk/health, which kept the gates and the vitals,
       * while the chat and the proposal approval are app/admin/desk/agent —
       * thread.tsx and queue.tsx. So Enter on a proposal landed the operator on
       * a page carrying neither the conversation nor an Approve button.
       * linkHrefFor is where that is corrected, once, for all three callers.
       */
      const home = selected.actions.find((a) => a.kind === 'link' && a.href);
      if (home?.href) follow(linkHrefFor(selected, home.href));
    },
    onPrimary: () => {
      if (!selected) return;
      const primary = selected.actions.find((a) => a.kind === 'undo');
      if (primary) fire(selected, primary);
    },
    onLater: () => {
      if (selected?.canLater) sink(selected);
    },
    /**
     * ⚠️ DELIBERATELY EMPTY — THE SHELL OWNS CTRL+K NOW, and this page sits
     * OUTSIDE the shell it renders, so it cannot reach the shell's opener
     * through context. Both listeners are on `document` and both fire; the
     * shell's opens the palette, and anything here would be a second opener
     * racing the first.
     */
    onSearch: () => undefined,
    // Escape belongs to the drawer on top; the pile does not compete for it.
    onEscape: () => undefined,
    // See pileKeysSuspended: a register lens has no pile card on screen, but
    // the cursor still points at one, so `l` would sink something invisible.
    overlayOpen: pileKeysSuspended({ view, stackDepth: stack.length }),
  });

  const rail = feed ? <DeskRail feed={feed} /> : null;
  const overdue = feed?.pile.overdue ?? 0;
  /**
   * ⚠️ THE OVERDUE FIGURE IS BAD-RED, THE REST IS NOT.
   *
   * The artboard paints it that way (Main.dc.html: `14 cards ·
   * <span style="color:#FF6B5E">3 overdue</span>`) and it is the one number in
   * the header worth a colour — it is the sole reason to open the app before
   * you meant to. As one flat string it rendered uniformly ink-3, so the thing
   * that was late looked exactly like the count of things that were not.
   *
   * Nothing is coloured when the count is zero: there is no overdue segment at
   * all, rather than a red nought.
   */
  const sub = feed ? (
    <>
      {`${visible.length} ${visible.length === 1 ? 'thing needs' : 'things need'} you`}
      {overdue ? (
        <>
          {' · '}
          <span style={{ color: 'var(--dk-bad)' }}>{`${overdue} overdue`}</span>
        </>
      ) : null}
    </>
  ) : (
    'Loading…'
  );

  return (
    <DeskShell active={activeTabFor(view)} title="The Desk" sub={sub} rail={rail}>
      {/*
        🚨 THE FEED'S FAILURE, IN EVERY LENS — AND UNTIL THIS PASS IT HAD NO
        SURFACE OUTSIDE THE PILE. The money line was drawn as `{feed ? … :
        null}` and the only FailedRegion for `error` lived inside the
        `view === 'today'` branch below. So a failed read on Cases, Listings,
        Orders, Sales or Books blanked Held / Payable / Blocked / Refund
        pending and said NOTHING: the operator saw a register that had loaded
        correctly with no money row above it, which is exactly what a board
        with no money stuck looks like.

        ⚠️ THE REGION IS ABOVE THE FIGURES AND DOES NOT REPLACE THEM. `stale`
        is `Boolean(feed)` — a failed 60-second refresh over figures that
        loaded fine keeps the figures and says they are no longer live, the
        same line the Health board takes on a failed sweep. Only a read that
        never landed leaves the row empty. feedFailure() writes both sentences
        so the claim and the screen can never disagree.

        ⚠️ ONE FAILED SOURCE, ONE REGION. The register below this reads its own
        endpoint and draws its own FailedRegion (cases-register.tsx and the
        four beside it), so it stays on screen and correct — and the scope note
        names it by the word on its own chip rather than leaving the operator
        to guess whether the list is suspect too.
      */}
      {error ? (
        <FailedRegion
          {...feedFailure({ view, stale: Boolean(feed) })}
          detail={error}
          onRetry={() => void load()}
        />
      ) : null}

      {/* ⚠️ ABOVE THE CHIPS, NOT INSIDE THE PILE LENS. It is the first thing on
          the board in every lens, because Orders, Sales and Books are money
          lenses too and the question "is any of it stuck" does not stop being
          the question when you go looking for one order. */}
      {feed ? (
        <MoneyLine money={feed.money} onOpenRun={() => openDrawer({ sort: 'payout-run' })} />
      ) : null}

      {/* ⚠️ THE PILE IS THE DEFAULT AND MUST STAY ONE. A passive register is
          never what an operator should land on when the thing they came to do
          is work today's cards. */}
      <div
        role="group"
        aria-label="Desk lens"
        style={{
          display: 'flex',
          gap: 8,
          // ⚠️ ONE SCROLLING LINE, NOT A WRAPPING BLOCK. Six chips wrap to two
          // or three rows on a 390px screen and push the first card below the
          // fold — which is the Ribbon's failure, reintroduced by the thing
          // that replaced it. flexWrap and overflowX contradict each other and
          // wrap wins, so there is no 'wrap' here at all.
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          margin: '0 -14px',
          padding: '0 14px 2px',
        }}
      >
        {LENSES.map((l) => (
          <Chip key={l.key} active={view === l.key} onClick={() => switchView(l.key)}>
            {l.label}
          </Chip>
        ))}
      </div>

      {/*
        🚨 AN ACTION THAT FAILED, IN EVERY LENS — IT USED TO REPORT NOTHING
        FROM FIVE OF THE SIX. This region was inside the `view === 'today'`
        branch, and the writes that set it do not finish on the lens they were
        fired from: useUndo commits after its window expires, so an operator
        who presses `a` on a dispatch nudge and then clicks the Orders chip
        inside those seconds gets the failure raised into state that nothing
        renders. `sink()` is the same shape. The toast had already gone, the
        card was already back in the pile, and the only thing that would ever
        show them what happened was switching back to Today.

        ⚠️ IT SITS UNDER THE CHIPS, where it sat for the pile, rather than at
        the top: the feed's own failure is about the figures above and belongs
        beside them; this is about a card and belongs with the work.
      */}
      {trouble ? (
        <FailedRegion
          title={trouble.title}
          detail={trouble.detail}
          onRetry={() => {
            setTrouble(null);
            void load();
          }}
          scopeNote={trouble.scopeNote}
        />
      ) : null}

      {view === 'cases' ? (
        <CasesRegister
          refreshKey={casesNonce}
          onOpen={(kind, id) => openDrawer({ sort: 'case', caseKind: kind, caseId: id })}
        />
      ) : view === 'listings' ? (
        <ListingsRegister
          onOpen={(listingId) =>
            openDrawer({
              sort: 'listing',
              listingId,
              title: 'Opening…',
              // No card behind it — see DEEP_LINK_CARD_ID.
              cardId: DEEP_LINK_CARD_ID,
            })
          }
        />
      ) : view === 'orders' ? (
        <OrdersRegister
          segment={orderSegment}
          onSegment={chooseSegment}
          pageIndex={orderPageIndex}
          onPage={setOrderPageIndex}
          page={orderPage}
          error={orderError}
          onRetry={() => void loadOrders()}
          onOpenRow={openOrderRow}
          resolvingId={resolvingOrderId}
          openError={openError}
        />
      ) : view === 'sales' ? (
        <SalesRegister
          filter={saleFilter ?? undefined}
          onClearFilter={() => setSaleFilter(null)}
          onOpen={openSale}
        />
      ) : view === 'books' ? (
        <BooksRegister onOpenSale={openSale} />
      ) : (
        <>
          {/*
            ⚠️ NO SECOND FailedRegion FOR `error` HERE. It moved above the
            chips, where it covers the money line as well, and rendering it in
            both places would put two red boxes on the pile for one failed
            read — which reads as two things being broken.

            ⚠️ AND NO SKELETON UNDER A FAILURE. `!feed` is true both while the
            first read is in flight and after it failed; a skeleton in the
            second case is three grey cards promising work that is not coming,
            directly under a region saying the read did not happen.
          */}
          {!feed ? (
            error ? null : (
              <SkeletonPile count={3} />
            )
          ) : visible.length === 0 ? (
            <AllClear next="New work lands here the moment it appears — a listing to review, a dealer transfer, a dispute, or Warden with something it cannot fix alone." />
          ) : (
            <>
              {BAND_ORDER.map((key) => {
                const cards = visible.filter((c) => c.band === key);
                return (
                  <Band key={key} label={BAND_LABEL[key]} count={cards.length}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {cards.map((card) => (
                        <PileCard
                          key={card.id}
                          card={card}
                          phone={phone}
                          selected={selected?.id === card.id}
                          onSelect={() => setCursor(visible.findIndex((c) => c.id === card.id))}
                          onAction={(a) => fire(card, a)}
                          onLater={() => sink(card)}
                        />
                      ))}
                    </div>
                  </Band>
                );
              })}
              {!phone ? <ShortcutFooter /> : null}
            </>
          )}
        </>
      )}

      {/* ⚠️ THE DRAWERS SIT OUTSIDE THE LENS BRANCH. Every register opens one,
          so mounting them inside the pile branch would make a row in a register
          press-and-do-nothing. */}
      {undo.pending ? (
        <UndoToast message={undo.pending.message} seconds={undo.seconds} onUndo={undo.undo} />
      ) : null}

      {/* ── The drawers. Only the top of the stack is mounted. ────────── */}

      <ListingDrawer
        listingId={top?.sort === 'listing' ? top.listingId : null}
        onClose={closeTop}
        // The server has already moved the listing out of PENDING_REVIEW by the
        // time this fires, so the card is gone whichever way it went.
        onDecided={() => {
          if (top?.sort === 'listing') dropCard(top.cardId);
        }}
        fallbackTitle={top?.sort === 'listing' ? top.title : undefined}
        fallbackReference={top?.sort === 'listing' ? top.reference : undefined}
      />

      {top?.sort === 'case' ? (
        <CaseDrawer
          open
          caseKind={top.caseKind}
          caseId={top.caseId}
          onClose={closeTop}
          // ⚠️ A REPLY LEAVES THE CASE OPEN AND A RESOLUTION CLOSES IT, and
          // onChanged cannot say which — it carries no outcome. So this is the
          // one place the board re-reads itself rather than editing a card in
          // place: guessing would either strand a resolved case on the pile or
          // hide one that is still waiting on the member.
          onChanged={() => {
            void load();
            // The register is a separate read; without this a case decided from
            // it keeps its old state until the operator reloads.
            setCasesNonce((n) => n + 1);
          }}
          /*
           * ⚠️ STEPPING INTO THE ORDER COSTS AN UNSENT DRAFT. CaseDrawer clears
           * its reply box on every open by design — "a fresh case is a fresh
           * draft" — so coming back from the order starts the message again.
           * The button that leads here sits in the money section at the top of
           * the drawer, above the reply box, so the usual order of work is
           * check-then-type; but an operator who types first and then goes to
           * look at a figure loses what they wrote. Worth solving with a draft
           * that survives the round trip, not by mounting both drawers: two
           * Drawers share one Escape and one Tab trap.
           */
          onOpenOrder={openSale}
        />
      ) : null}

      {top?.sort === 'member' ? (
        <MemberDrawer
          open
          userId={top.userId}
          onClose={closeTop}
          // ⚠️ RE-READ, DO NOT DROP THE CARD. onChanged fires for every write
          // this drawer makes — a note, a strike, a tier change — and only one
          // of them (the verification decision) retires the card. Dropping it
          // here would clear a seller off the pile because somebody edited their
          // phone number, and the decision they were queued for would never be
          // made. The server rebuilds the band, so a real decision removes the
          // card on the next read and nothing else does.
          onChanged={() => {
            void load();
          }}
        />
      ) : null}

      {/*
        The sale's dossier, opened over whichever lens the operator was in. ONE
        drawer for every door — a pile card, a payout row, an order row, a sale
        row and a Books row all open the same panel on the same unit (a
        Transaction), and mounting a second copy per lens would put two Escape
        listeners on `document`.

        `card` is undefined from every door but the Orders lens, which is
        correct: a payout row is one sale and carries no cart parent to
        describe. From the Orders lens it is the card the row click already had
        to fetch, so the order-level money split and the manual-EFT stamps cost
        no extra request.

        `onOpenLine` is what makes lines 2..N of a multi-seller order reachable
        at all. It REPLACES the top of the stack rather than pushing: stepping
        between siblings never leaves the order, so it must not deepen the stack
        or Escape would walk back through every line the operator looked at.
      */}
      {top?.sort === 'order' ? (
        <OrderDrawer
          open
          transactionId={top.transactionId}
          orderCard={top.card ?? null}
          onOpenLine={(id) =>
            setStack((s) => [
              ...s.slice(0, -1),
              { sort: 'order', transactionId: id, card: top.card },
            ])
          }
          onClose={closeTop}
        />
      ) : null}

      <PayoutRunDrawer
        open={top?.sort === 'payout-run'}
        onClose={closeTop}
        onOpenSale={openSale}
        onChanged={() => void load()}
      />
    </DeskShell>
  );
}

/**
 * Held · Payable · Blocked · Refund pending, above everything.
 *
 * ⚠️ NO NEW `.dk-` CLASS, AND NONE IS AVAILABLE. desk-guard.cjs caps
 * components/desk/tokens.css at 19 and it is at 19, so this is inline styles
 * over the existing `dk-card` — adding a class means arguing which of the
 * nineteen leaves.
 *
 * ⚠️ PAYABLE IS A BUTTON AND THE OTHER THREE ARE NOT. It is the only figure
 * with an action behind it — the run drawer — and the run is otherwise
 * reachable only from a `payout_run` card, which the server deals only while
 * payableCents > 0. Without this, an operator who held every sale back could
 * not get to the run that would let them include one again.
 */
function MoneyLine({
  money,
  onOpenRun,
}: {
  money: DeskFeed['money'];
  onOpenRun: () => void;
}) {
  return (
    <div
      className="dk-card"
      style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 10,
          // Four figures fit a laptop and do not fit a 390px screen. One
          // scrolling line rather than a wrap, for the reason on the lens
          // chips: a block that grows downwards pushes the first card off.
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        <Figure label="Held" value={money.held} sub={money.heldSub} />
        <Figure
          label="Payable"
          value={money.payable}
          sub={money.payableSub}
          onClick={onOpenRun}
          actionLabel="Open today's payout run"
        />
        {/* Amber only when something IS blocked. The tone was hard-coded, so R0
            — nothing blocked, the state you want — was painted as a warning on
            every load, next to three plain rows reading R0. */}
        <Figure
          label="Blocked"
          value={money.blocked}
          sub={money.blockedSub}
          tone={(money.blockedCents ?? 0) > 0 ? 'warn' : undefined}
        />
        {/*
          ⚠️ NOTHING COMPUTES THIS FIGURE. moneySnapshot() in
          backend/src/desk/desk.service.ts returns `refundCents: 0` as a
          literal — there is no query behind it — so a rendered "R 0.00" is a
          measured-looking zero that was never measured, on the one board whose
          job is to say whether money is stuck.

          ⚠️ IT IS THE ZERO THAT IS SUSPECT, NOT THE ROW. Only the formatted
          amount travels, so the client cannot tell the literal from a real
          zero; the day something does compute it, a non-zero figure prints
          normally and only a true zero reads as not-counted. Narrow, and the
          honest half of the two.
        */}
        <Figure
          label="Refund pending"
          value={isZeroAmount(money.refundPending) ? '—' : money.refundPending}
          sub={isZeroAmount(money.refundPending) ? 'not counted' : money.refundSub}
        />
      </div>
      {money.gateNote ? (
        <span style={{ fontSize: 11.5, color: 'var(--dk-warn)', lineHeight: 1.45 }}>
          {money.gateNote}
        </span>
      ) : null}
    </div>
  );
}

/**
 * ⚠️ STRING MATCHING, BECAUSE THE CENTS DO NOT TRAVEL. `DeskFeed.money` carries
 * a raw figure for `blocked` alone (`blockedCents`); every other row arrives
 * pre-formatted by the server's `rand()`. This asks the narrowest possible
 * question — "are all the digits in this string zero?" — so "R 0.00" and
 * "R0.00" both answer yes and "R 10.00" answers no. It is used for exactly one
 * row; if a second row ever needs it, send the cents instead.
 */
function isZeroAmount(v: string | undefined): boolean {
  if (!v) return true;
  const digits = v.replace(/\D/g, '');
  return digits.length > 0 && /^0+$/.test(digits);
}

function Figure({
  label,
  value,
  sub,
  tone,
  onClick,
  actionLabel,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'warn';
  onClick?: () => void;
  actionLabel?: string;
}) {
  const body = (
    <>
      <span style={{ fontSize: 11, color: 'var(--dk-ink-3)', whiteSpace: 'nowrap' }}>{label}</span>
      <span
        className="dk-mono"
        style={{
          fontSize: 15,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          color: tone === 'warn' ? 'var(--dk-warn)' : 'var(--dk-ink)',
        }}
      >
        {value}
      </span>
      {sub ? (
        <span style={{ fontSize: 11, color: 'var(--dk-ink-4)', whiteSpace: 'nowrap' }}>{sub}</span>
      ) : null}
    </>
  );

  const frame: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: '1 0 auto',
    minWidth: 92,
    textAlign: 'left',
  };

  if (!onClick) return <div style={frame}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={actionLabel}
      aria-haspopup="dialog"
      style={{
        ...frame,
        padding: 0,
        margin: 0,
        background: 'transparent',
        border: 'none',
        font: 'inherit',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      {body}
    </button>
  );
}

/**
 * One card, plus the phone's swipe behaviour.
 *
 * ⚠️ THE REVEAL SITS BEHIND THE CARD AND THE CARD FACE NEVER CHANGES WHILE
 * SWIPING. A face that morphs mid-gesture means the operator is aiming at a
 * moving target with their thumb, and the whole point of swipe-to-approve is
 * that it can be done without looking carefully.
 */
function PileCard({
  card,
  phone,
  selected,
  onSelect,
  onAction,
  onLater,
}: {
  card: DeskCardData;
  phone: boolean;
  selected: boolean;
  onSelect: () => void;
  onAction: (a: FeedAction) => void;
  onLater: () => void;
}) {
  const primary = card.actions.find((a) => a.kind === 'undo');
  // Swipe is offered only where the primary action is undoable — never on a
  // money card. See useSwipe.
  const swipeable = phone && Boolean(primary);

  const swipe = useSwipe({
    enabled: swipeable,
    onSwipeRight: primary ? () => onAction(primary) : undefined,
    onSwipeLeft: card.canLater ? onLater : undefined,
  });

  const inner = (
    <DeskCard
      type={card.type}
      typeLabel={card.typeLabel}
      reference={card.reference}
      headline={card.headline}
      meta={card.meta}
      note={card.note}
      selected={selected}
      canLater={card.canLater}
      laterUntil={card.laterUntil ? formatReturnTime(card.laterUntil) : undefined}
      onLater={onLater}
      onSelect={onSelect}
      /* ⚠️ THE RED GATE AND THE PROPOSAL ARE BOTH type 'warden', so one icon
         per TYPE drew a bolt on both — where the catalogue draws a padlock on
         the gate. The server says which; this is the only place that can
         honour it. */
      iconOverride={card.icon ? TAG_ICON[card.icon] : undefined}
      tags={card.tags.map((t) => ({
        kind: t.kind,
        label: t.label,
        icon: t.icon ? TAG_ICON[t.icon] : undefined,
      }))}
      actions={card.actions.map((a) => ({
        label: a.label,
        variant: a.kind === 'gated' ? 'gated' : a.variant,
        amount: a.amount,
        onClick: () => onAction(a),
      }))}
    />
  );

  if (!swipeable) return inner;

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--dk-radius-card)' }}>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: swipe.dx >= 0 ? 'flex-start' : 'flex-end',
          padding: '0 20px',
          background: swipe.dx >= 0 ? 'var(--dk-ok)' : 'var(--dk-inset)',
          color: swipe.dx >= 0 ? 'var(--dk-ground)' : 'var(--dk-ink-2)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {swipe.dx >= 0 ? primary?.label ?? '' : 'Later'}
      </div>
      <div
        {...swipe.handlers}
        style={{
          transform: `translateX(${swipe.dx}px)`,
          transition: swipe.dragging ? 'none' : 'transform 160ms ease-out',
          touchAction: 'pan-y',
        }}
      >
        {inner}
      </div>
    </div>
  );
}

/**
 * The rail — what is beside the pile on a laptop and under it on a phone.
 *
 * ⚠️ NO MONEY CARD HERE ANY MORE. It is the block at the top of the board, and
 * a second copy in the rail would be the same four figures twice on a desktop
 * and twice down one column on a phone. What is left is context you read when
 * you have a moment, not the answer to "is any of it stuck".
 */
function DeskRail({ feed }: { feed: DeskFeed }) {
  return (
    <>
      <RailCard label="The pile">
        {feed.bands.map((b, i) => (
          <Kv key={b.key} k={BAND_LABEL[b.key]} v={b.count} last={i === feed.bands.length - 1} />
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {feed.pile.overdue > 0 ? (
            <span style={{ fontSize: 11.5, color: 'var(--dk-bad)' }}>
              {feed.pile.overdue} overdue
            </span>
          ) : null}
          {feed.pile.sunk > 0 ? (
            <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
              {feed.pile.sunk} sunk with Later
              {feed.pile.sunkReturnsAt ? ` · back ${formatReturnTime(feed.pile.sunkReturnsAt)}` : ''}
            </span>
          ) : null}
        </div>
      </RailCard>

      <RailCard label="Just happened">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {feed.activity.map((a, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                padding: '7px 0',
                borderBottom:
                  i === feed.activity.length - 1 ? undefined : '1px solid var(--dk-line)',
              }}
            >
              <span
                className="dk-mono"
                style={{ fontSize: 11, color: 'var(--dk-ink-4)', flex: 'none' }}
              >
                {a.time}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)', lineHeight: 1.45 }}>
                {a.text}
              </span>
            </div>
          ))}
        </div>
      </RailCard>
    </>
  );
}
