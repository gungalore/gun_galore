'use client';

import * as React from 'react';
import type { SearchResult } from './dialogs';
import { IconImage, IconLedger, IconUser } from './icons';
import { describeFailure } from '../../lib/desk-auth';
import {
  SEARCH_MIN_CHARS,
  emptySearch,
  fetchDeskSearch,
  memberContext,
  memberLabel,
  orderContext,
  searchHref,
  shortRef,
  type SearchWire,
} from '../../lib/desk-search';

/**
 * The Desk's global search, owned by the shell.
 *
 * ⚠️ THE NAVIGATION IS A FULL PAGE LOAD (window.location.assign), NOT A
 * ROUTER PUSH. Every target page reads its deep-link param ONCE, in a
 * mount-only effect, because the alternative — useSearchParams — drags a
 * Suspense boundary around a whole client board for a value that matters
 * once. That is a deliberate decision those pages document. A client-side
 * push would change the URL without remounting, the mount-only effect would
 * never re-run, and the drawer would silently not open: the URL would say one
 * thing and the screen another. Assigning guarantees the read.
 */

const DEBOUNCE_MS = 180;

export interface DeskSearch {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
  loading: boolean;
  failure: string | null;
}

export function useDeskSearch(): DeskSearch {
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [wire, setWire] = React.useState<SearchWire>(emptySearch);
  const [loading, setLoading] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  /**
   * ⚠️ ONE TICKET PER REQUEST. Typing "rifle" fires five overlapping requests
   * and they do not come back in order; without this, a slow response for
   * "rif" lands after "rifle" and the operator reads results for a query they
   * have already finished typing. The same guard the Ledger uses when
   * resolving an order.
   */
  const ticket = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < SEARCH_MIN_CHARS) {
      // Not a failure and not a result: below the floor the server returns
      // nothing by design, so say nothing rather than "no matches", which
      // would read as "this member does not exist".
      ticket.current += 1;
      setWire(emptySearch());
      setLoading(false);
      setFailure(null);
      return;
    }
    const mine = ++ticket.current;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchDeskSearch(q)
        .then((w) => {
          if (ticket.current !== mine) return;
          setWire(w);
          setFailure(null);
        })
        .catch((err) => {
          if (ticket.current !== mine) return;
          // ⚠️ CLEAR THE RESULTS ON FAILURE. Leaving the previous query's hits
          // under a new query is how an operator opens the wrong member.
          setWire(emptySearch());
          setFailure(describeFailure(err));
        })
        .finally(() => {
          if (ticket.current === mine) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const close = React.useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setWire(emptySearch());
    setFailure(null);
    ticket.current += 1;
  }, []);

  const open = React.useCallback(() => setIsOpen(true), []);

  /**
   * Ctrl/Cmd+K from anywhere on the Desk.
   *
   * ⚠️ IT MUST NOT OPEN OVER A DRAWER OR A CONFIRM. usePileKeys already
   * refuses this keystroke while an overlay is open — an operator part-way
   * through a rejection reason pressing Ctrl+K wants nothing to happen — and
   * a second, shell-level binding that ignored that would reintroduce exactly
   * what the Pile guards against, on all five surfaces instead of one. The
   * shell cannot see the Pile's state, so it asks the DOM, which is the same
   * question Drawer's own Escape handler asks of `.dk-dialog`.
   *
   * ⚠️ AND THE PALETTE IS ITSELF A .dk-dialog, so the guard is only applied
   * when OPENING. Applying it both ways would make Ctrl+K unable to close the
   * very thing it opened.
   */
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'k' && e.key !== 'K')) return;
      setIsOpen((wasOpen) => {
        if (wasOpen) return false;
        if (document.querySelector('.dk-drawer, .dk-dialog')) return false;
        return true;
      });
      e.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = React.useCallback((href: string) => {
    window.location.assign(href);
  }, []);

  const results = React.useMemo<SearchResult[]>(() => {
    const out: SearchResult[] = [];

    // ⚠️ ORDERS BEFORE THEIR OWN LINES. An order and its transactions can both
    // match one reference; the order is the row that carries the whole cart,
    // so it is listed first and the line rows read as the detail beneath it.
    for (const o of wire.orders) {
      out.push({
        group: 'Orders',
        ref: shortRef(o.orderReference, o.id),
        title: o.buyer?.username ?? 'no username',
        context: orderContext(o),
        icon: IconLedger,
        onOpen: () => go(searchHref('order', o.id)),
      });
    }
    for (const t of wire.transactions) {
      out.push({
        group: 'Orders',
        ref: shortRef(t.listing?.referenceNumber, t.id),
        title: t.listing?.title ?? 'listing since deleted',
        context: `one line · ${t.paymentStatus.replace(/_/g, ' ').toLowerCase()}`,
        icon: IconLedger,
        onOpen: () => go(searchHref('transaction', t.id)),
      });
    }
    for (const u of wire.users) {
      out.push({
        group: 'Members',
        ref: shortRef(null, u.id),
        title: memberLabel(u),
        context: memberContext(u) || undefined,
        icon: IconUser,
        onOpen: () => go(searchHref('member', u.id)),
      });
    }
    for (const l of wire.listings) {
      out.push({
        group: 'Listings',
        ref: shortRef(l.referenceNumber, l.id),
        title: l.title,
        context: `${l.status.replace(/_/g, ' ').toLowerCase()}${
          l.seller?.username ? ` · ${l.seller.username}` : ''
        }`,
        icon: IconImage,
        onOpen: () => go(searchHref('listing', l.id)),
      });
    }
    return out;
  }, [wire, go]);

  return { isOpen, open, close, query, setQuery, results, loading, failure };
}
