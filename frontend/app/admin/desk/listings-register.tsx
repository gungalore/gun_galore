'use client';

/**
 * THE DESK — browsing listings.
 *
 * 🚨 REACH WAS ALREADY CLOSED; THIS IS BROWSE. Global search opens any listing
 * by id, reference, make or model, and the Listing drawer has always taken an
 * arbitrary id. What had no home was the operator who does not yet know which
 * listing they want — "everything pending in Optics", "what has this seller
 * got live" — because the PENDING_REVIEW queue is a card type on the pile,
 * which serves the daily loop and is not a register.
 *
 * ⚠️ A LENS, NOT A SIXTH TAB, for the same reason the case register is one.
 */

import * as React from 'react';
import {
  Button,
  Chip,
  FailedRegion,
  IconSearch,
  Input,
  SkeletonPile,
  Tag,
} from '@/components/desk';
import { formatRand } from '@/components/desk';
import {
  LISTINGS_PAGE_SIZE,
  LISTING_SEGMENTS,
  fetchListingPage,
  segmentLabel,
  statusLabel,
  type ListingRow,
  type ListingSegment,
} from '@/lib/desk-listings';
import { describeFailure } from '@/lib/desk-auth';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  PENDING_REVIEW: 'warn',
  ACTIVE: 'ok',
  PAYMENT_PENDING: 'info',
  SOLD: 'neutral',
  CANCELLED: 'bad',
  EXPIRED: 'neutral',
  DRAFT: 'neutral',
};

export function ListingsRegister({ onOpen }: { onOpen: (listingId: string) => void }) {
  const [segment, setSegment] = React.useState<ListingSegment>('PENDING_REVIEW');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<ListingRow[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [failure, setFailure] = React.useState<string | null>(null);

  /** Only the newest read may write — typing outruns the network. */
  const ticket = React.useRef(0);

  // ⚠️ THE DEBOUNCE STAGGERS THE CALLS; IT DOES NOT ORDER THE REPLIES. The
  // ticket does. People's board carries the same pair for the same reason.
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  // A new query starts on page one — in an effect here rather than the
  // handler, because nothing else on this board sets a page.
  React.useEffect(() => {
    setPage(1);
  }, [segment, debounced]);

  const load = React.useCallback(async () => {
    const mine = ++ticket.current;
    setRows(null);
    setFailure(null);
    try {
      const res = await fetchListingPage(segment, debounced, page);
      if (ticket.current !== mine) return;
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      if (ticket.current !== mine) return;
      setRows([]);
      setFailure(describeFailure(err));
    }
  }, [segment, debounced, page]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const from = rows && rows.length ? (page - 1) * LISTINGS_PAGE_SIZE + 1 : 0;
  const to = rows ? (page - 1) * LISTINGS_PAGE_SIZE + rows.length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {LISTING_SEGMENTS.map((s) => (
          <Chip key={s.value} active={segment === s.value} onClick={() => setSegment(s.value)}>
            {s.label}
          </Chip>
        ))}
      </div>

      <Input
        icon={IconSearch}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Title, reference, make or model"
        aria-label="Search listings"
      />

      <div style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
        {rows === null
          ? 'reading…'
          : rows.length === 0
            ? 'nothing here'
            : `${from}–${to} of ${total} · ${segmentLabel(segment).toLowerCase()}`}
      </div>

      {failure ? (
        <FailedRegion title="Couldn't read the listings" detail={failure} onRetry={() => void load()} />
      ) : rows === null ? (
        <SkeletonPile count={3} />
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--dk-ink-3)', padding: '18px 0' }}>
          {/* ⚠️ THREE DIFFERENT EMPTIES, THREE DIFFERENT SENTENCES. "No
              results" over a search reads as "this listing does not exist",
              which is a fact this board has not established. */}
          {debounced.trim().length >= 2
            ? `Nothing matching “${debounced.trim()}” in ${segmentLabel(segment).toLowerCase()}.`
            : `No listings are ${segmentLabel(segment).toLowerCase()}.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((l, i) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onOpen(l.id)}
              aria-haspopup="dialog"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                minHeight: 60,
                padding: '10px 4px',
                background: 'transparent',
                border: 'none',
                borderBottom: i === rows.length - 1 ? undefined : '1px solid var(--dk-line)',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {l.images?.[0]?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.images[0].url}
                  alt=""
                  style={{
                    width: 40,
                    height: 40,
                    flex: 'none',
                    objectFit: 'cover',
                    borderRadius: 4,
                    border: '1px solid var(--dk-line-2)',
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    flex: 'none',
                    borderRadius: 4,
                    background: 'var(--dk-inset)',
                    border: '1px solid var(--dk-line-2)',
                  }}
                />
              )}
              <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{l.title}</span>
                <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                  {l.referenceNumber ?? l.id.slice(0, 8)}
                  {l.seller?.username ? ` · ${l.seller.username}` : ''}
                  {l.category?.name ? ` · ${l.category.name}` : ''}
                </span>
              </span>
              {/* A firearm is the one attribute on this row that changes what
                  an operator may do next, so it is tagged and nothing else is. */}
              {l.category?.isFirearm ? <Tag kind="neutral">firearm</Tag> : null}
              <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
                {l.price === null ? '—' : formatRand(l.price)}
              </span>
              <Tag kind={STATUS_TONE[l.status] ?? 'neutral'}>{statusLabel(l.status)}</Tag>
            </button>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && total > LISTINGS_PAGE_SIZE ? (
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
