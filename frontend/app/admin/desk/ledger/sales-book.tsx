'use client';

/**
 * THE DESK — the sales book, the Ledger's third lens.
 *
 * 'run' is today's payout run, the one daily action. 'orders' is the cart
 * book, replacing /admin/orders. This is the SALE book — the Transaction as a
 * row, which is the unit a payout pays and a refund refunds.
 *
 * 🚨 THE MAP CALLED THIS UNBUILDABLE AND IT WAS ONE WHERE-CLAUSE. getTransactions
 * pinned paymentStatus on every call, defaulting to HELD with no way to ask for
 * anything else as a set — so browsing sales by any other status was impossible
 * and was recorded as a missing feature rather than a missing branch.
 */

import * as React from 'react';
import { Button, Chip, FailedRegion, SkeletonPile, Tag } from '@/components/desk';
import { formatRandCents } from '@/lib/desk-ledger';
import {
  SALES_PAGE_SIZE,
  SALE_FILTER_LABEL,
  SALE_SEGMENTS,
  fetchSalePage,
  saleStateWords,
  saleTone,
  type SaleFilter,
  type SaleRow,
  type SaleSegment,
} from '@/lib/desk-transactions';
import { describeFailure } from '@/lib/desk-auth';

export function SalesBook({
  onOpen,
  filter,
  onClearFilter,
}: {
  /** Opens the Order drawer on this sale — a Transaction id. */
  onOpen: (transactionId: string) => void;
  filter?: SaleFilter;
  onClearFilter?: () => void;
}) {
  const [segment, setSegment] = React.useState<SaleSegment>('HELD');
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<SaleRow[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [failure, setFailure] = React.useState<string | null>(null);
  const ticket = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++ticket.current;
    setRows(null);
    setFailure(null);
    try {
      const res = await fetchSalePage(segment, page, filter);
      if (ticket.current !== mine) return;
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      if (ticket.current !== mine) return;
      setRows([]);
      setFailure(describeFailure(err));
    }
  }, [segment, page, filter]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function choose(next: SaleSegment) {
    setSegment(next);
    setPage(1);
  }

  const from = rows && rows.length ? (page - 1) * SALES_PAGE_SIZE + 1 : 0;
  const to = rows ? (page - 1) * SALES_PAGE_SIZE + rows.length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SALE_SEGMENTS.map((s) => (
          <Chip key={s.value} active={segment === s.value} onClick={() => choose(s.value)}>
            {s.label}
          </Chip>
        ))}
      </div>

      {/* ⚠️ A DEEP-LINK FILTER MUST BE VISIBLE AND REMOVABLE. The command
          centre and the health page link here with ?filter=, and a narrowed
          list with nothing on screen to say so reads as "there are only four
          held sales" — a wrong fact about the whole marketplace. */}
      {filter ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 11px',
            borderRadius: 6,
            background: 'var(--dk-inset)',
            border: '1px solid var(--dk-line-2)',
            fontSize: 12,
            color: 'var(--dk-ink-2)',
          }}
        >
          <span style={{ flex: 1 }}>{`Filtered: ${SALE_FILTER_LABEL[filter]}`}</span>
          {onClearFilter ? (
            <Button variant="ghost" onClick={onClearFilter}>
              Show all
            </Button>
          ) : null}
        </div>
      ) : null}

      <div style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
        {rows === null ? 'reading…' : rows.length === 0 ? 'nothing here' : `${from}–${to} of ${total}`}
      </div>

      {failure ? (
        <FailedRegion title="Couldn't read the sales" detail={failure} onRetry={() => void load()} />
      ) : rows === null ? (
        <SkeletonPile count={3} />
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--dk-ink-3)', padding: '18px 0' }}>
          {filter
            ? 'No sales match that filter — which is the good outcome for both of them.'
            : `No sales are ${segment === 'ALL' ? 'recorded' : segment.toLowerCase()}.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpen(r.id)}
              aria-haspopup="dialog"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                minHeight: 56,
                padding: '10px 4px',
                background: 'transparent',
                border: 'none',
                borderBottom: i === rows.length - 1 ? undefined : '1px solid var(--dk-line)',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span
                className="dk-mono"
                style={{ fontSize: 11, color: 'var(--dk-ink-3)', width: 96, flex: 'none' }}
              >
                {r.listing?.referenceNumber ?? r.id.slice(0, 8)}
              </span>
              <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>
                  {r.listing?.title ?? 'listing since deleted'}
                </span>
                {/* 🚨 USERNAMES ONLY. The endpoint used to return both parties'
                    real names and email addresses for a page that no longer
                    exists; the select was corrected rather than filtered here,
                    so there is nothing to leak even by accident. */}
                <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                  {`${r.buyer?.username ?? 'no username'} → ${r.seller?.username ?? 'no username'}`}
                </span>
              </span>
              <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
                {r.buyerTotal === null ? '—' : formatRandCents(r.buyerTotal)}
              </span>
              <Tag kind={saleTone(r)}>{saleStateWords(r)}</Tag>
            </button>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && total > SALES_PAGE_SIZE ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
