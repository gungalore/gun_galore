import * as React from 'react';

/**
 * One register row, at both breakpoints.
 *
 * ⚠️ THIS EXISTS BECAUSE THREE OF THE FOUR REGISTERS HAD NO PHONE LAYOUT.
 *
 * `order-book.tsx` got the full treatment — it branches to a stacked card
 * below 1024px, with a comment explaining that six fixed tracks totalling
 * 860px inside a 390px screen hid Status and Total behind a scroll nobody
 * signalled. Its three siblings never did: sales-book, cases-register and
 * listings-register are each a single `nowrap` flex row with a fixed 96px
 * lead, non-shrinking trailing Tags (`whiteSpace: nowrap`) and no
 * `overflowX` on the container. On a phone they simply overflow, silently.
 *
 * The reason they never got it is visible in the cost: order-book's fallback
 * is why that file is 432 lines. Writing that branch three more times was
 * never going to happen, so the fix is one component the fourth register
 * cannot ship without.
 *
 * ⚠️ AND THE RESPONSIVE PART IS CSS, NOT `useIsPhone`. A JS branch reads
 * `false` on the server and on the first client render, so every cold load
 * paints the desktop row and then relayouts — on every board, every time.
 * The classes live in tokens.css and are correct in the first frame.
 */

export interface RegisterRowSpec {
  /** React key, and what `onOpen` is called with. */
  id: string;
  /**
   * The narrow leading cell — a mono reference. Rendered as a fixed 96px
   * column at the desk and as auto-width text under the thumb, so a long
   * reference does not eat a 390px screen.
   */
  lead?: React.ReactNode;
  /** A 40px image instead of `lead`. Falsy renders the empty well. */
  thumb?: string | null;
  /** Whether to render the empty thumb well when `thumb` is absent. */
  hasThumb?: boolean;
  title: React.ReactNode;
  /** The quiet second line — parties, category, counts. */
  sub?: React.ReactNode;
  /** Mono, right-aligned at the desk. */
  amount?: React.ReactNode;
  /**
   * State tags, most significant FIRST — they are read left to right and the
   * first one is the one that changes what the operator does next. A frozen
   * payout outranks a case state; a firearm outranks an age.
   */
  tags?: React.ReactNode;
}

export function RegisterList({
  rows,
  onOpen,
  minHeight = 56,
}: {
  rows: RegisterRowSpec[];
  onOpen: (id: string) => void;
  /** listings-register uses 60 for the thumbnail. */
  minHeight?: number;
}) {
  return (
    // ⚠️ NOT `.dk-stack`. That class carries `gap: var(--dk-gap)`, and a
    // register is rows separated by a hairline, flush against each other — ten
    // pixels of air between them turns a ledger into a list of cards and puts
    // the separator in the middle of nothing.
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r.id)}
          aria-haspopup="dialog"
          className="dk-reg-row"
          style={{
            minHeight,
            borderBottom:
              i === rows.length - 1 ? undefined : '1px solid var(--dk-line)',
          }}
        >
          {r.hasThumb ? (
            r.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.thumb}
                alt=""
                className="dk-reg-thumb"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <span aria-hidden="true" className="dk-reg-thumb" />
            )
          ) : r.lead ? (
            <span className="dk-mono dk-reg-lead">{r.lead}</span>
          ) : null}

          <span className="dk-reg-main">
            {/* Body size, full ink — the title is the row. Not `.dk-t-body`:
                that is ink-2 prose ABOUT a thing, and this is the thing. */}
            <span style={{ fontSize: 'var(--dk-fs-body)', color: 'var(--dk-ink)' }}>
              {r.title}
            </span>
            {r.sub ? <span className="dk-t-meta">{r.sub}</span> : null}
          </span>

          <span className="dk-reg-trail">
            {r.tags}
            {r.amount ? (
              <span
                className="dk-mono"
                style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}
              >
                {r.amount}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
