'use client';

/**
 * THE DESK — the Orders lens on the Ledger.
 *
 * The replacement for the legacy /admin/orders list. It lives on the Ledger
 * rather than on a sixth tab because an order and a payout are the same money
 * seen from two ends: the cart the buyer paid for, and the per-line payouts it
 * owes. One board, two lenses.
 *
 * ⚠️ IT IS A LENS, NOT A CHIP IN THE RUN'S CHIP ROW, AND THAT DISTINCTION IS
 * THE WHOLE DESIGN. The run's four chips (Needs attention / Payable / Held
 * back / Blocked) are synchronous re-slices of one PayoutRun already sitting
 * in the browser. Orders is a network fetch with its own status filter, its
 * own pager and its own URL contract. Putting the two kinds side by side in
 * one row would mean the same control did two different things depending on
 * which one you pressed, and the only tell would be how long a skeleton
 * lasted. So the view switch sits ABOVE, in the title row, exactly the way
 * People's Dealers chip picks a lens and then reveals its own chip row under
 * it — a grammar this surface already has.
 *
 * 🚨 NO ORDER-LEVEL MONEY BUTTON, EVER. A full refund of a consolidated
 * carrier line whose siblings are still HELD throws (admin.service.ts ~2233):
 * the siblings must be unwound first, in an order nobody can read off a list
 * row. An order-level Refund or Release would therefore be a control whose
 * outcome the operator cannot predict from what is on screen. Money stays per
 * line, in the Order drawer, where the five levers already live. That is also
 * why the whole row is one click target and there are no per-row buttons —
 * which is exactly the shape DeskTable was built for.
 *
 * ⚠️ NO SEARCH BOX. AdminService.getOrders builds `where = status ? {status} :
 * {}` and accepts nothing else. A box here would filter the twenty rows in the
 * browser while looking like it had searched all 1,204 — the same lie as
 * printing a bare total over a capped list.
 */
import * as React from 'react';
import {
  Amount,
  Button,
  Chip,
  DeskTable,
  FailedRegion,
  Ref,
  ResultBlock,
  SkeletonPile,
  Tag,
  formatRand,
  useIsPhone,
  type Column,
} from '@/components/desk';
import { formatWhen } from '@/lib/desk-order';
import {
  ORDER_PAGE_SIZE,
  ORDER_SEGMENTS,
  orderPageWindow,
  orderRowReference,
  orderSegmentLabel,
  orderStatusTone,
  type OrderBookPage,
  type OrderRow,
  type OrderSegment,
} from '@/lib/desk-orders';

export interface OrderBookProps {
  segment: OrderSegment;
  onSegment: (next: OrderSegment) => void;
  pageIndex: number;
  onPage: (next: number) => void;
  /** null means "still loading" — never "empty". The two read differently. */
  page: OrderBookPage | null;
  error: string | null;
  onRetry: () => void;
  onOpenRow: (row: OrderRow) => void;
  /** The order whose first line is being resolved, lit through DeskTable. */
  resolvingId: string | null;
  /** Why the last open attempt did not open anything. */
  openError: { tag: string; body: string } | null;
}

export function OrderBook({
  segment,
  onSegment,
  pageIndex,
  onPage,
  page,
  error,
  onRetry,
  onOpenRow,
  resolvingId,
  openError,
}: OrderBookProps) {
  const rows = page?.orders ?? [];
  const bounds = page ? orderPageWindow(page.total, pageIndex) : null;
  const phone = useIsPhone();

  /**
   * ⚠️ 860, NOT DeskTable's 1100 DEFAULT. That default exists to stop a wide
   * Item column collapsing to two words; this board has no Item column at all,
   * so six narrow columns at 1100 would leave a dead strip and force a
   * sideways scroll on a laptop that has room for every one of them.
   */
  const columns: Column<OrderRow>[] = [
    {
      key: 'ref',
      header: 'Reference',
      width: '160px',
      render: (r) => <Ref>{orderRowReference(r)}</Ref>,
    },
    {
      key: 'buyer',
      header: 'Buyer',
      width: 'minmax(0, 1fr)',
      // 🚨 THE HANDLE, NEVER A NAME OR AN EMAIL. The endpoint sends the
      // buyer's email; lib/desk-orders.ts drops it before it reaches here, and
      // OrderRow does not declare it, so there is nothing to reach for.
      render: (r) => `@${r.buyer.username ?? 'anon'}`,
    },
    {
      key: 'lines',
      header: 'Lines',
      width: '70px',
      align: 'right',
      render: (r) => <Amount>{r._count.transactions}</Amount>,
    },
    {
      key: 'total',
      header: 'Total',
      width: '130px',
      align: 'right',
      render: (r) => <Amount>{formatRand(r.buyerTotal)}</Amount>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '170px',
      render: (r) => <Tag kind={orderStatusTone(r.status)}>{orderSegmentLabel(r.status)}</Tag>,
    },
    {
      key: 'date',
      header: 'Date',
      width: '130px',
      // ⚠️ ALWAYS createdAt. Swapping in paidAt on the rows that have one
      // would make a sorted column mean two different things down its length,
      // and the list is ordered by createdAt server-side regardless.
      render: (r) => formatWhen(r.createdAt),
    },
  ];

  return (
    <>
      {/* ⚠️ ONE SCROLLING LINE, NOT A WRAPPING BLOCK. flexWrap:'wrap' beat
          the overflowX beside it — they contradict each other and wrap wins
          — so seven segments stacked two or three rows deep on a 390px
          screen and pushed the list itself below the fold. The artboard's
          `.hs` is a single hidden-scrollbar line (Ledger.dc.html). */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          margin: '0 -14px',
          padding: '0 14px',
        }}
      >
        {/* No counts on these chips, unlike the run's. A count per status
            would be six more fetches or a backend aggregate that does not
            exist; a wrong-but-confident number beside a filter is worse than
            no number. People's segment chips are label-only for the same
            reason. */}
        {ORDER_SEGMENTS.map((s) => (
          <Chip key={s.key} active={segment === s.key} onClick={() => onSegment(s.key)}>
            {s.label}
          </Chip>
        ))}
      </div>

      {/* ⚠️ AN OPEN FAILURE IS A STRIP, NOT A FailedRegion. The list loaded
          fine; it was the one drawer that did not open. Replacing the pile
          with a red region would take away the rows the operator is standing
          in to report a failure about one of them. */}
      {openError ? <ResultBlock ok={false} tag={openError.tag} body={openError.body} /> : null}

      {error ? (
        <FailedRegion title="Couldn't load the orders" detail={error} onRetry={onRetry} />
      ) : !page ? (
        <SkeletonPile count={3} />
      ) : (
        <>
          {/* 🚨 A TABLE IS THE WRONG SHAPE ON A PHONE, AND THIS ONE WAS THE
              LAST BOARD STILL USING IT THERE. DeskTable wraps itself in an
              overflowX:auto div, so the PAGE never scrolled sideways — the
              card did, silently: six fixed tracks totalling 860px inside a
              390px screen, so more than half of every row, including Status
              and Total, sat off-screen behind a scroll nobody signals.
              The stack below is the same data with the same single click
              target, wrapped instead of scrolled. */}
          {phone ? (
            <OrderCards
              rows={rows}
              onOpen={onOpenRow}
              resolvingId={resolvingId}
              empty={<EmptyCopy segment={segment} pageIndex={pageIndex} />}
            />
          ) : (
            <DeskTable
              minWidth={860}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onOpen={onOpenRow}
              /* An order's first line has to be fetched before the drawer can
                 open, so the row lights while that hop is in the air — using
                 DeskTable's existing selection, not a new spinner. */
              selectedKey={resolvingId ?? undefined}
              empty={<EmptyCopy segment={segment} pageIndex={pageIndex} />}
            />
          )}
          {bounds ? (
            <Pager bounds={bounds} pageIndex={pageIndex} total={page.total} onPage={onPage} />
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * The Orders lens on a phone: one card per order, nothing sideways.
 *
 * The shape is the one the phone artboards specify — reference and status on
 * the first line, who and how much on the second, the date last. Same reading
 * order as the table's columns, so an operator who knows one knows the other.
 *
 * ⚠️ THE WHOLE CARD IS THE CLICK TARGET AND THERE ARE NO BUTTONS ON IT — the
 * same rule the table row follows, and for the reason at the top of this file:
 * money on this board is per LINE, so an order-level control would promise an
 * outcome the operator cannot predict. The card opens the drawer; the drawer
 * holds the levers.
 */
function OrderCards({
  rows,
  onOpen,
  resolvingId,
  empty,
}: {
  rows: OrderRow[];
  onOpen: (row: OrderRow) => void;
  resolvingId: string | null;
  empty: React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: '32px 16px',
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--dk-ink-3)',
          background: 'var(--dk-surface)',
          border: '1px solid var(--dk-line)',
          borderRadius: 'var(--dk-radius-card)',
        }}
      >
        {empty}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => {
        const resolving = resolvingId === r.id;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              width: '100%',
              textAlign: 'left',
              padding: '12px 14px',
              background: resolving ? 'var(--dk-inset)' : 'var(--dk-surface)',
              border: '1px solid var(--dk-line)',
              borderRadius: 'var(--dk-radius-card)',
              color: 'var(--dk-ink)',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Ref>{orderRowReference(r)}</Ref>
              <span style={{ flex: 1 }} />
              <Tag kind={orderStatusTone(r.status)}>{orderSegmentLabel(r.status)}</Tag>
            </span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              {/* The handle, never a name or an email — see the Buyer column. */}
              <span
                style={{
                  fontSize: 13,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                @{r.buyer.username ?? 'anon'}
              </span>
              {/* ⚠️ THE LINE COUNT LIVES HERE, NOT ON THE DATE LINE. The
                  artboard's baseline row reads "@boet · 3 lines … R 18
                  500.00" (Ledger.dc.html); the date gets its own line below,
                  alone. This card had the two swapped. */}
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)', flex: 'none', whiteSpace: 'nowrap' }}>
                · {r._count.transactions} {r._count.transactions === 1 ? 'line' : 'lines'}
              </span>
              <span style={{ flex: 1 }} />
              <Amount>{formatRand(r.buyerTotal)}</Amount>
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{formatWhen(r.createdAt)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Three different silences, and they are not interchangeable.
 *
 * ⚠️ "NOTHING HERE" ON PAGE 4 IS A LIE AN OPERATOR ACTS ON. A list that got
 * shorter while it was being read leaves the pager pointing past the end, and
 * a generic empty state reads as "this filter has no orders" — so the operator
 * concludes something about the whole table from an artefact of their own
 * scroll position. Same words People uses, because it is the same event.
 */
function EmptyCopy({ segment, pageIndex }: { segment: OrderSegment; pageIndex: number }) {
  if (pageIndex > 1) {
    return <>Nothing on this page — the list got shorter while you were reading it.</>;
  }
  if (segment !== 'ALL') {
    return <>No orders are {orderSegmentLabel(segment).toLowerCase()} right now.</>;
  }
  return <>No orders yet.</>;
}

/**
 * The window, in words.
 *
 * ⚠️ NEVER A BARE TOTAL OVER TWENTY ROWS. The legacy page printed "1,204
 * total" under a list of twenty and left the operator to work out that the
 * other 1,184 were never fetched. "1–20 of 1,204" is the difference between
 * someone who knows to keep paging and someone who reads the bottom of the
 * list as the end of the table. Gated on ORDER_PAGE_SIZE and not on People's
 * PEOPLE_PAGE_SIZE — at 50 this sentence would claim "all of them shown" over
 * a list that is missing thirty.
 */
function Pager({
  bounds,
  pageIndex,
  total,
  onPage,
}: {
  bounds: ReturnType<typeof orderPageWindow>;
  pageIndex: number;
  total: number;
  onPage: (next: number) => void;
}) {
  if (total <= ORDER_PAGE_SIZE) {
    return (
      <span style={{ fontSize: 12, color: 'var(--dk-ink-3)', padding: '2px 2px 0' }}>
        {total} {total === 1 ? 'order' : 'orders'}, all of them shown.
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 2px 0' }}>
      <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
        {bounds.beyondEnd
          ? `That page is past the end · ${total} ${total === 1 ? 'order' : 'orders'}`
          : `${bounds.first}–${bounds.last} of ${total}`}
      </span>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" disabled={!bounds.hasPrev} onClick={() => onPage(pageIndex - 1)}>
        Previous
      </Button>
      <Button variant="secondary" disabled={!bounds.hasNext} onClick={() => onPage(pageIndex + 1)}>
        Next
      </Button>
    </div>
  );
}
