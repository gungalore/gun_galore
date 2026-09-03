'use client';

/**
 * THE DESK — the Ledger, and the payout run inside it.
 *
 * ⚠️ WHILE PAYMENTS_LIVE IS OFF, EVERY MONEY CONTROL IS THE GATED VARIANT AND
 * DECLINES. It does not open a dialog, it does not error, and it does not
 * pretend to be disabled: it says which switch is off and what is queued
 * behind it. The balances above it are real — that money genuinely is held
 * and genuinely is owed — so the surface has to be honest about both halves
 * at once, or the operator learns to distrust the numbers.
 *
 * ⚠️ HOLD BACK IS NOT MONEY AND WORKS ANYWAY. It changes no balance; it only
 * decides whether a sale is offered to the next run. That is why it is the
 * one payout lever live today.
 */
import * as React from 'react';
import {
  Button,
  Chip,
  DeskShell,
  Drawer,
  FailedRegion,
  IconBanknote,
  IconCheck,
  IconLock,
  MoneyDialog,
  OrderDrawer,
  ResultBlock,
  Ribbon,
  Section,
  SkeletonPile,
  Tag,
  useIsPhone,
} from '@/components/desk';
import {
  fetchPayoutRun,
  formatRandCents,
  describePayoutRun,
  holdPayout,
  runDuePayouts,
  includePayout,
  type HeldPayoutRow,
  type PayoutRow,
  type PayoutRun,
} from '@/lib/desk-ledger';
import {
  fetchOrderBook,
  fetchOrderCard,
  orderRowReference,
  orderSub,
  parseOrderPage,
  parseOrderSegment,
  type OrderBookPage,
  type OrderCard,
  type OrderRow,
  type OrderSegment,
} from '@/lib/desk-orders';
import { describeFailure } from '@/lib/desk-auth';
import { OrderBook } from './order-book';
import { SalesBook } from './sales-book';
import { Books } from './books';
import type { SaleFilter } from '@/lib/desk-transactions';

/**
 * The two lenses this board has.
 *
 * 'run' is today's payout run — the one daily ACTION, and therefore the
 * default: a passive list must never be what an operator lands on when the
 * thing they came to do is pay sellers. 'orders' is the whole order book, the
 * replacement for /admin/orders.
 */
type LedgerView = 'run' | 'orders' | 'sales' | 'books';

/** Nothing to open, and why. Not a failure — a shape. */
const NO_LINES = {
  tag: 'nothing to open',
  body: 'This order has no lines. A dossier is a line’s dossier, so there is nothing to open.',
};

export default function LedgerPage() {
  const [run, setRun] = React.useState<PayoutRun | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drawer, setDrawer] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  /** A batch is in flight — see the confirm's handler. */
  const [paying, setPaying] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; tag: string; body: string } | null>(null);
  const [payoutSegment, setPayoutSegment] = React.useState('attention');
  /** The sale whose Order drawer is open — a Transaction id. */
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const phone = useIsPhone();

  /* ── the Orders lens ─────────────────────────────────────────────────
   *
   * ⚠️ THE TWO LENSES KEEP SEPARATE FILTERS. Flipping the view never resets
   * the other lens's segment: an operator who was three pages into REFUNDED,
   * ducked into the run to hold a payout back, and came back expecting to
   * carry on should find their place — not page one of All.
   */
  const [view, setView] = React.useState<LedgerView>('run');
  /**
   * A deep-link narrowing on the sales lens.
   *
   * The command centre links with ?filter=accept-stalled and the health page
   * with ?filter=dispatch-overdue; both param names are the legacy page's, so
   * an old bookmark or a Slack link still lands on the rows it named.
   */
  const [saleFilter, setSaleFilter] = React.useState<SaleFilter | null>(null);
  const [orderSegment, setOrderSegment] = React.useState<OrderSegment>('ALL');
  const [orderPageIndex, setOrderPageIndex] = React.useState(1);
  const [orderPage, setOrderPage] = React.useState<OrderBookPage | null>(null);
  const [orderError, setOrderError] = React.useState<string | null>(null);
  /** The parent order behind the open drawer. Null in the run lens. */
  const [orderCard, setOrderCard] = React.useState<OrderCard | null>(null);
  const [openError, setOpenError] = React.useState<{ tag: string; body: string } | null>(null);
  const [resolvingOrderId, setResolvingOrderId] = React.useState<string | null>(null);

  /**
   * ⚠️ ONE DRAWER AT A TIME. Drawer binds Escape on `document` and defers only
   * to a `.dk-dialog` above it, so two mounted at once both hear one keypress
   * and both close. The run drawer and an order drawer are the same 480px
   * panel in the same place, so stacking them would also look like one drawer
   * that changed its mind. The run closes on the way in.
   */
  const openOrder = React.useCallback((transactionId: string) => {
    setDrawer(false);
    // ⚠️ AND THE ORDER CARD GOES WITH IT. A payout row is one sale; it carries
    // no cart parent, so any card still in state belongs to a DIFFERENT order.
    // The drawer refuses to draw a mismatched card anyway, but leaving one
    // here would mean the guard is the only thing standing between the two —
    // and a guard is a last line, not a plan.
    setOrderCard(null);
    setOrderId(transactionId);
  }, []);

  const load = React.useCallback(async () => {
    try {
      setRun(await fetchPayoutRun());
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /**
   * One page of the order book.
   *
   * ⚠️ EVERY READ TAKES A TICKET AND ONLY THE NEWEST MAY WRITE. Chips are
   * clicked faster than a list comes back, and nothing orders the replies —
   * the slow answer for CANCELLED landing after the fast one for REFUNDED
   * would paint cancelled orders under a chip that says Refunded, with the
   * right count in the header and no error anywhere. The drawer already keeps
   * a ticket for exactly this reason (order-drawer.tsx); a board that filters
   * server-side needs its own.
   *
   * ⚠️ AND IT IS LAZY. Nothing fetches until the Orders lens is first opened,
   * so the run — the reason the page exists — is never waiting behind a list
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
   * ⚠️ IN THE HANDLER, NOT IN AN EFFECT KEYED ON orderSegment — and that is
   * not a style choice. People resets its page in an effect because nothing
   * else on that board ever sets a page; here the URL reader does. An effect
   * would fire on the render AFTER the reader picked `?status=PAID&page=3` up,
   * see the segment change, and reset the page to 1 — so every deep link past
   * page one would silently land on page one and look like it had worked.
   *
   * Without the reset at all, clicking a chip while three pages deep asks for
   * rows 41–60 of an eleven-row set and draws an empty state the operator
   * reads as a fact about the filter. Both failures are real; only the handler
   * avoids both.
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
   * click fetches the order's dossier, takes its first line, and opens on
   * that. The cost is one round trip a payout row does not pay, and it is
   * visible (the row lights) rather than hidden.
   */
  /**
   * 🚨 THE TICKET IS WHAT KEEPS THE DRAWER ON THE ORDER THAT WAS CLICKED.
   * Every write below used to be unconditional, and `loadOrders` one function
   * above already takes a ticket for exactly this reason — this one was left
   * without. Nothing blocks a second click: DeskTable's row onClick fires
   * regardless of `resolvingOrderId`, which only lights a row. So two clicks
   * race, and the SLOWER reply landed last and won: the drawer silently
   * swapped to an order nobody asked for, with no error and nothing on screen
   * to say it had happened.
   *
   * That is a money bug, not a cosmetic one. order-actions.tsx wires five
   * levers — release, refund, hold — to the foot of this drawer, so an
   * operator reading order B could release order A.
   *
   * The ticket also survives a lens switch: `switchView` bumps it, because a
   * resolve that outlives the switch would otherwise mount the Order drawer
   * over the payout run — and if the run's own drawer were open, two Drawers
   * would bind Escape on `document` at once, which is the failure this file
   * documents elsewhere and must not reintroduce here.
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
        // ⚠️ ONE DRAWER AT A TIME, ACROSS THE LENSES TOO. The run's own drawer
        // and confirm bind Escape on `document`; two overlays mounted at once
        // both hear one keypress.
        setDrawer(false);
        setConfirm(false);
        // A deep link arrives with no list behind it. Filtering to the order's
        // own status means closing the drawer lands the operator among orders
        // like the one they were sent, rather than on an unrelated page one.
        // A ROW click never does this — moving the list out from under someone
        // who just clicked it is the same sin as a jumping form field.
        if (alignSegment) {
          setOrderSegment(card.status);
          setOrderPageIndex(1);
        }
        setOrderCard(card);
        setOrderId(card.firstTransactionId);
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
    [],
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

  /**
   * Switch lens, and take the leaving lens's overlays with you.
   *
   * ⚠️ THE STATE STACK CROSSES THE SWITCH. Leaving a lens with its drawer
   * still mounted is how two Drawers end up listening for the same Escape —
   * the failure the run drawer's own comment already warns about, one level
   * up.
   */
  const switchView = React.useCallback((next: LedgerView) => {
    setView(next);
    if (next !== 'run') {
      setDrawer(false);
      setConfirm(false);
    } else {
      // ⚠️ INVALIDATE, DO NOT JUST CLEAR. deskFetch issues a plain fetch with
      // no AbortController, so a resolve already in flight still lands — and
      // because <OrderDrawer open> is gated on `orderId` and not on `view`,
      // it would mount the Order drawer on top of the run the operator just
      // switched to. Bumping the ticket makes that reply a no-op.
      openTicket.current += 1;
      setResolvingOrderId(null);
      setOrderId(null);
      setOrderCard(null);
      setOpenError(null);
    }
  }, []);

  /**
   * `/admin/desk/ledger?view=orders&status=PAID&page=3` — and
   * `?order=<orderId>` opens straight onto one order's drawer.
   *
   * ⚠️ THE PARAM NAMES ARE LEGACY'S ON PURPOSE. /admin/orders used `status`
   * and `page`, so a bookmark, a Slack link or an old email survives the
   * cutover redirect intact instead of landing on an unfiltered page one.
   *
   * ⚠️ window.location, NOT useSearchParams — the same call the Site board
   * makes and for the same reason: reading the hook in a client board drags a
   * Suspense boundary around the whole page for a value that matters once.
   */
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const deepOrder = q.get('order');
    /**
     * `?txn=<transactionId>` opens ONE SALE, and is a different param from
     * `?order=` on purpose.
     *
     * ⚠️ THEY TAKE DIFFERENT IDS AND ARE NOT INTERCHANGEABLE. `?order=`
     * resolves through fetchOrderCard, which wants an ORDER id and looks up
     * that cart's first line; a transaction has no cart parent to resolve and
     * opens the drawer directly on the line — the null-card case openOrder
     * already exists for, and which the payout run has always used. Feeding a
     * transaction id to `?order=` would 404 against an order that does not
     * exist, and the failure would read as "this sale is missing" rather than
     * "wrong kind of id".
     *
     * This is where a raw transaction hit in the global search lands, which is
     * what makes an arbitrary sale reachable rather than only those in today's
     * payout run. It does NOT switch to the orders lens: a single sale is not
     * a cart, and moving the list out from under the operator to a view that
     * does not contain what they opened would be its own small lie.
     */
    const rawFilter = q.get('filter');
    if (rawFilter === 'accept-stalled' || rawFilter === 'dispatch-overdue') {
      setSaleFilter(rawFilter);
      setView('sales');
    } else if (q.get('view') === 'sales') {
      setView('sales');
    } else if (q.get('view') === 'books') {
      setView('books');
    }

    const deepTxn = q.get('txn');
    if (deepTxn) {
      openOrder(deepTxn);
      return;
    }
    if (q.get('view') !== 'orders' && !deepOrder) return;
    setView('orders');
    setOrderSegment(parseOrderSegment(q.get('status')));
    setOrderPageIndex(parseOrderPage(q.get('page')));
    if (deepOrder) void resolveAndOpen(deepOrder, deepOrder, true);
    // Mount only. A later render must not re-read a URL this page is writing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ⚠️ THE FIRST RUN IS SKIPPED, AND HAS TO BE. Both effects fire on the same
   * first commit, in declaration order: the reader above queues its state and
   * this writer would then run with the PREVIOUS render's state — view still
   * 'run' — and strip the very params the reader had just picked up. Skipping
   * one invocation means the URL is only ever written from state that came
   * from somewhere, and a plain visit with no params is left untouched.
   *
   * replaceState, not push: browsing chips must not fill the back button with
   * a filter history nobody wants to walk back through.
   */
  const urlPrimed = React.useRef(false);
  React.useEffect(() => {
    if (!urlPrimed.current) {
      urlPrimed.current = true;
      return;
    }
    const q = new URLSearchParams();
    if (view === 'orders') {
      q.set('view', 'orders');
      // Defaults are omitted so a plain visit keeps a clean URL.
      if (orderSegment !== 'ALL') q.set('status', orderSegment);
      if (orderPageIndex > 1) q.set('page', String(orderPageIndex));
      if (orderCard) q.set('order', orderCard.id);
    }
    /**
     * A sale open with no cart parent is `?txn=`, in every lens.
     *
     * ⚠️ WITHOUT THIS THE WRITER DELETES THE PARAM IT WAS JUST SENT. It
     * rebuilds the query from state, and a run-lens row has nothing to write,
     * so a `?txn=` arriving from search survived exactly until the next state
     * change and then vanished from the URL while its drawer stayed open —
     * the address bar and the screen disagreeing, which is the same failure
     * the `order` param is written here to avoid. Writing it also makes an
     * open sale a link an operator can paste, like an order already is.
     */
    if (view === 'books') q.set('view', 'books');
    if (view === 'sales') {
      q.set('view', 'sales');
      // ⚠️ THE FILTER SURVIVES THE WRITER TOO. It arrives from a command-centre
      // or health-page link, and the writer rebuilds the query from state — so
      // without this the narrowing vanishes from the URL on the next state
      // change while the banner on screen still says the list is filtered.
      if (saleFilter) q.set('filter', saleFilter);
    }
    if (orderId && !orderCard) q.set('txn', orderId);
    const qs = q.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    );
  }, [view, orderSegment, orderPageIndex, orderCard, orderId, saleFilter]);

  const gated = run?.gated ?? true;

  const strip = run
    ? [
        { label: 'Payable', value: run.totals.inRunLabel, sub: `${run.totals.saleCount} sales` },
        { label: 'Held back', value: run.totals.heldLabel, sub: `${run.held.length} by you` },
        { label: 'Blocked', value: run.totals.blockedLabel, sub: `${run.blocked.length} by a gate` },
        {
          label: 'Run',
          value: gated ? 'Gated' : 'Ready',
          sub: gated ? 'PAYMENTS_LIVE off' : `${run.totals.sellerCount} sellers`,
          dot: gated ? ('warn' as const) : ('ok' as const),
        },
      ]
    : [];

  return (
    <DeskShell
      active="ledger"
      title="Ledger"
      /* Two lenses, one board — so `active` stays "ledger" and DESK_TABS keeps
         its five entries. Orders is not a sixth tab. */
      sub={
        view === 'orders'
          ? orderPage
            ? orderSub(orderPage.total, orderSegment)
            : 'Loading…'
          : run
            ? `${run.totals.saleCount} sales payable`
            : 'Loading…'
      }
    >
      {/*
        ⚠️ NO "EXPORT CSV" BUTTON. One used to sit here with no onClick and no
        endpoint behind it — a secondary-variant control that looked exactly
        like Review the run and did nothing at all when pressed. There is no
        export route on the API, so the honest thing is an absent button rather
        than a present one that fails silently. Wire /admin/desk/payouts/export
        first, then put it back.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* One identity in both lenses. The page is the Ledger; the switch
            below only says which end of the money you are looking at. */}
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>Ledger</span>
        <span style={{ flex: 1 }} />
        {/*
          ⚠️ THIS ROW SITS OUTSIDE THE RUN'S ERROR GATE, DELIBERATELY. Everything
          below it used to live inside `error ? … : !run ? …`, so the day
          fetchPayoutRun 500s the operator would be stranded on a red region
          with no way to reach the order book — a second, unrelated surface
          made unreachable by the first one's outage. The switch is drawn
          before either lens is consulted.

          ⚠️ AND IT IS ABOVE THE RUN'S OWN CHIPS, NOT BESIDE THEM. Those four
          chips re-slice a PayoutRun already in memory; this pair changes the
          data source, the pager and the URL. Same control, two meanings, is
          exactly what the row separation prevents — the same shape People uses
          for its Dealers lens.
        */}
        <div role="group" aria-label="Ledger view" style={{ display: 'flex', gap: 8 }}>
          <Chip active={view === 'run'} onClick={() => switchView('run')}>
            Payout run
          </Chip>
          <Chip active={view === 'orders'} onClick={() => switchView('orders')}>
            Orders
          </Chip>
          {/* ⚠️ SALES, NOT "TRANSACTIONS". The row is one sale — what a payout
              pays and a refund refunds. An Order is the cart above it, and the
              two words are already one letter apart in the modules. */}
          <Chip active={view === 'sales'} onClick={() => switchView('sales')}>
            Sales
          </Chip>
          {/* The back-office lens: what of the bank balance is not ours, and
              what never reached Zoho Books. */}
          <Chip active={view === 'books'} onClick={() => switchView('books')}>
            Books
          </Chip>
        </div>
      </div>

      {view === 'books' ? (
        <Books onOpenSale={openOrder} />
      ) : view === 'sales' ? (
        <SalesBook
          filter={saleFilter ?? undefined}
          onClearFilter={() => setSaleFilter(null)}
          // Opens the same drawer the run and the order book open, on the
          // null-parent path a single sale has always used.
          onOpen={openOrder}
        />
      ) : view === 'orders' ? (
        <OrderBook
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
      ) : error ? (
        <FailedRegion title="Couldn't load the run" detail={error} onRetry={() => void load()} />
      ) : !run ? (
        <SkeletonPile count={2} />
      ) : (
        <>
          <Ribbon cells={strip} compact={phone} />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: 'var(--dk-surface)',
              border: '1px solid var(--dk-line)',
              borderRadius: 'var(--dk-radius-card)',
              flexWrap: 'wrap',
            }}
          >
            {gated ? (
              <Button variant="gated" onClick={() => setDrawer(true)}>
                Payouts are gated
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={IconBanknote}
                amount={run.totals.inRunLabel}
                disabled={paying}
                onClick={() => setConfirm(true)}
              >
                {paying ? 'Sending…' : 'Run payouts'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDrawer(true)}>
              Review the run
            </Button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: gated ? 'var(--dk-warn)' : 'var(--dk-ink-3)' }}>
              {gated
                ? `PAYMENTS_LIVE is off · ${run.totals.saleCount} sales (${run.totals.inRunLabel}) queued · ${run.held.length} held back`
                : `${run.totals.saleCount} sales · one payout per sale`}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', overflowX: 'auto' }}>
            {[
              ['attention', 'Needs attention', run.blocked.length + run.held.length],
              ['payable', 'Payable', run.totals.saleCount],
              ['held', 'Held back', run.held.length],
              ['blocked', 'Blocked', run.blocked.length],
            ].map(([key, label, count]) => (
              <Chip
                key={key as string}
                active={payoutSegment === key}
                count={count as number}
                onClick={() => setPayoutSegment(key as string)}
              >
                {label as string}
              </Chip>
            ))}
          </div>

          <PayoutList
            run={run}
            segment={payoutSegment}
            gated={gated}
            onChanged={load}
            onError={(m) => setError(m)}
            onOpenOrder={openOrder}
          />
        </>
      )}

      {view === 'run' && run ? (
        <Drawer
          open={drawer}
          onClose={() => setDrawer(false)}
          typeLabel="Payout run"
          icon={IconBanknote}
          title={
            <>
              Today&rsquo;s run · <span className="dk-mono">{run.totals.inRunLabel}</span> to{' '}
              {run.totals.sellerCount} {run.totals.sellerCount === 1 ? 'seller' : 'sellers'}
            </>
          }
          meta="One payout per sale · a held sale sits out until you include it"
          tags={
            <>
              <Tag kind="info">{`${run.totals.saleCount} due`}</Tag>
              {run.held.length ? <Tag kind="neutral">{`${run.held.length} held back`}</Tag> : null}
              {run.blocked.length ? <Tag kind="warn">{`${run.blocked.length} blocked`}</Tag> : null}
            </>
          }
          note={
            gated
              ? 'Drawn with payments gated. Hold back and Include work now; paying out waits for PAYMENTS_LIVE.'
              : 'Money never undoes. Each sale is a separate payout with its own result.'
          }
          footer={
            <>
              <span style={{ flex: 1 }} />
              {gated ? (
                <Button variant="gated">Payouts are gated</Button>
              ) : (
                <Button
                  variant="primary"
                  amount={run.totals.inRunLabel}
                  onClick={() => setConfirm(true)}
                >
                  Run payouts
                </Button>
              )}
            </>
          }
        >
          <Section label={`In the run · ${run.totals.saleCount} sales`}>
            {run.inRun.length === 0 ? (
              <Empty>Nothing is due.</Empty>
            ) : (
              run.inRun.map((r) => (
                <SaleRow
                  key={r.id}
                  row={r}
                  gated={gated}
                  onHold={async (reason) => {
                    await holdPayout(r.id, reason);
                    await load();
                  }}
                />
              ))
            )}
          </Section>

          {run.held.length ? (
            <Section label={`Held back · ${run.held.length}`}>
              {run.held.map((r) => (
                <HeldRow
                  key={r.id}
                  row={r}
                  onInclude={async () => {
                    await includePayout(r.id, 'Included in the run from the Desk');
                    await load();
                  }}
                />
              ))}
            </Section>
          ) : null}

          {run.blocked.length ? (
            <Section label={`Blocked · ${run.blocked.length}`} last>
              {run.blocked.map((r) => (
                <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
                  <RowHead row={r} />
                  {/* ⚠️ NO "OPEN MEMBER" BUTTON. It had no onClick, and it
                      cannot get one yet: a payout row carries the seller's
                      USERNAME, and MemberDrawer opens on a User id. A ghost
                      button that does nothing next to the reason a seller is
                      not being paid is the worst place on this surface to put
                      one. Carry sellerId on the run row, then wire it. */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <Tag kind="warn" icon={IconLock}>
                      {r.blockedReason ?? 'blocked'}
                    </Tag>
                  </span>
                </div>
              ))}
            </Section>
          ) : null}

          {result ? (
            <Section label="Result" last>
              <ResultBlock ok={result.ok} tag={result.tag} body={result.body} />
            </Section>
          ) : null}
        </Drawer>
      ) : null}

      {view === 'run' && run ? (
        <MoneyDialog
          open={confirm}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            // 🚨 THIS HANDLER WAS A STUB THAT ALWAYS REPORTED "not sent".
            //
            // runDuePayouts + describePayoutRun were written, tested and
            // imported at the top of this file, and a paying/setPaying pair was
            // scaffolded for exactly this call — but onConfirm still set a
            // hard-coded failure and never touched the network. So the Ledger
            // could say what was owed and to whom, and pressing the button paid
            // nobody, however many times it was pressed.
            //
            // ⚠️ ACCEPTED IS NOT PAID — Peach settles asynchronously and the
            // payout webhook reconciles, which is why describePayoutRun says
            // "accepted by the bank rail" and never "paid". Exactly-once is the
            // server's, via paidOutAt; setPaying only stops a second batch
            // being started while the first is in flight.
            setConfirm(false);
            setPaying(true);
            try {
              const r = await runDuePayouts();
              setResult({
                ok: r.failed === 0,
                tag: r.failed > 0 ? 'partly accepted' : 'accepted',
                body: describePayoutRun(r),
              });
              await load();
            } catch (err) {
              setResult({ ok: false, tag: 'failed', body: describeFailure(err) });
            } finally {
              setPaying(false);
            }
          }}
          title={
            <>
              Run payouts <span className="dk-mono">{run.totals.inRunLabel}</span>
            </>
          }
          rows={[
            { k: 'Sales', v: `${run.totals.saleCount}, one payout each` },
            { k: 'Sellers', v: String(run.totals.sellerCount) },
            { k: 'Held back', v: `${run.held.length} — not included` },
            { k: 'Then', v: 'Each sale gets its own result, verbatim' },
          ]}
          confirmLabel="Run payouts"
          amount={run.totals.inRunLabel}
        />
      ) : null}

      {/*
        The sale's dossier, opened over whichever lens the operator was in.
        ONE drawer for both — a payout row and an order row open the same panel
        on the same unit (a Transaction), and mounting a second copy per lens
        would put two Escape listeners on `document`.

        `orderCard` is null from the run lens, which is correct: a payout row
        is one sale and carries no cart parent to describe. From the Orders
        lens it is the card the row click already had to fetch, so the
        order-level money split and the manual-EFT stamps cost no extra
        request.

        `onOpenLine` is passed from BOTH lenses. It is what makes lines 2..N of
        a multi-seller order reachable at all — the reason this board was asked
        for — and it keeps `orderCard` because stepping between siblings never
        leaves the order.
      */}
      {orderId ? (
        <OrderDrawer
          open
          transactionId={orderId}
          orderCard={orderCard}
          onOpenLine={(id) => setOrderId(id)}
          onClose={() => {
            setOrderId(null);
            setOrderCard(null);
          }}
        />
      ) : null}
    </DeskShell>
  );
}

function PayoutList({
  run,
  segment,
  gated,
  onChanged,
  onError,
  onOpenOrder,
}: {
  run: PayoutRun;
  segment: string;
  gated: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
  onOpenOrder: (transactionId: string) => void;
}) {
  const rows =
    segment === 'held'
      ? run.held
      : segment === 'blocked'
        ? run.blocked
        : segment === 'payable'
          ? run.inRun
          : [...run.blocked, ...run.held];

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: '40px 20px',
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--dk-ink-3)',
          background: 'var(--dk-surface)',
          border: '1px solid var(--dk-line)',
          borderRadius: 'var(--dk-radius-card)',
        }}
      >
        {segment === 'attention' ? 'No sales need attention' : 'Nothing here'}
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
        padding: '4px 16px',
      }}
    >
      {rows.map((r) => (
        <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--dk-line)' }}>
          {/*
            ⚠️ A ROW IS A BUTTON, NOT A DIV WITH AN onClick. The row is the way
            into the sale's dossier, and it has to be reachable by Tab and
            announced as a control. The Hold back / Include buttons stay
            OUTSIDE it — a button inside a button is invalid markup and the
            inner one stops being operable in some browsers, which on this
            surface means Hold back silently opening a drawer instead.
          */}
          <button
            type="button"
            onClick={() => onOpenOrder(r.id)}
            aria-haspopup="dialog"
            style={{
              display: 'block',
              width: '100%',
              padding: 0,
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            <RowHead row={r} />
          </button>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {'reason' in r && (r as HeldPayoutRow).reason ? (
              <Tag kind="neutral">{`held · ${(r as HeldPayoutRow).reason}`}</Tag>
            ) : null}
            {r.blockedReason ? (
              <Tag kind="warn" icon={IconLock}>
                {r.blockedReason}
              </Tag>
            ) : null}
            <PayOutButton gated={gated} />
            <Button
              variant="ghost"
              onClick={() => {
                const fn =
                  'reason' in r
                    ? includePayout(r.id, 'Included from the Ledger')
                    : holdPayout(r.id, 'Held from the Ledger');
                void fn.then(onChanged).catch((e) => onError(describeFailure(e)));
              }}
            >
              {'reason' in r ? 'Include' : 'Hold back'}
            </Button>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The per-sale pay-out control, and why it never becomes a live button here.
 *
 * 🚨 TWO SEPARATE THINGS STOP A PAYOUT AND ONLY ONE OF THEM IS THE GATE.
 * PAYMENTS_LIVE being off is the first. The second is that single-sale
 * disbursement is not wired from the Desk at all — the same gap the run
 * dialog already admits to in words. The rows used to branch on `gated`
 * alone, which meant the day PAYMENTS_LIVE flips on, every row would grow a
 * confident secondary "Pay out… R3,150" with no onClick behind it: a money
 * button that no-ops, discovered by an operator who thinks they have paid a
 * seller. So the control is gated either way and says which of the two is in
 * the way. Delete this component when the disbursement call lands.
 */
function PayOutButton({ gated, amount }: { gated: boolean; amount?: string }) {
  return (
    <Button variant="gated" amount={gated ? undefined : amount}>
      {gated ? 'Pay out is gated' : 'Pay out not wired'}
    </Button>
  );
}

function RowHead({ row }: { row: PayoutRow }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)', flex: 'none' }}>
        {row.reference}
      </span>
      <span
        style={{
          fontSize: 13,
          color: 'var(--dk-ink)',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.item}
      </span>
      {row.seller ? (
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)', flex: 'none' }}>@{row.seller}</span>
      ) : null}
      {row.bankVerified ? <Tag kind="ok" icon={IconCheck}>bank</Tag> : null}
      <span style={{ flex: 1 }} />
      <span
        className="dk-mono"
        style={{ fontSize: 13, fontWeight: 500, color: 'var(--dk-ink)', flex: 'none' }}
      >
        {formatRandCents(row.amountCents)}
      </span>
    </span>
  );
}

function SaleRow({
  row,
  gated,
  onHold,
}: {
  row: PayoutRow;
  gated: boolean;
  onHold: (reason: string) => Promise<void>;
}) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
      <RowHead row={row} />
      <span style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <PayOutButton gated={gated} amount={formatRandCents(row.amountCents)} />
        <Button variant="ghost" onClick={() => void onHold('Held from the run drawer')}>
          Hold back
        </Button>
      </span>
    </div>
  );
}

function HeldRow({ row, onInclude }: { row: HeldPayoutRow; onInclude: () => Promise<void> }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
      <RowHead row={row} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <Tag kind="neutral">
          {`by you${row.heldAt ? ` · ${new Date(row.heldAt).toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}${row.reason ? ` · ${row.reason}` : ''}`}
        </Tag>
        <Button variant="secondary" onClick={() => void onInclude()}>
          Include
        </Button>
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>{children}</span>;
}
