'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Live-search typeahead for the marketplace. Talks to the existing
// /listings?q=… endpoint which is already Meilisearch-backed when a `q`
// is present — Meilisearch's default typo tolerance (1 typo for 5-8
// char words, 2 for ≥9) handles bad spelling for us, so "glok" still
// finds "Glock".
//
// Behaviour:
//   - debounce input by 180ms so we don't fire on every keystroke
//   - show top 6 matches in a dropdown panel
//   - clicking a hit navigates to /listings/[id]
//   - ↑/↓ move the highlight through the hits (last stop = "See all results")
//   - Enter opens the highlighted hit, or — with nothing highlighted — the
//     full results page at /?q=...
//   - Esc closes the dropdown
//   - clicking outside closes the dropdown
//
// Accessibility: this is a WAI-ARIA 1.2 combobox. The input owns the
// popup (role=combobox + aria-expanded/aria-controls/aria-activedescendant),
// the panel is a listbox whose rows are options, and focus NEVER leaves the
// input — the arrow keys only move `activeIndex`, which is the pattern
// screen readers expect and which keeps typing uninterrupted. Before this,
// hits were mouse-only and a screen reader was never told they appeared.

interface SearchHit {
  id: string;
  referenceNumber: string | null;
  title: string;
  price: number | null;
  listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT';
  images: { url: string; isPrimary: boolean }[];
  category: { name: string };
}

// The /listings browse endpoint returns paginated data shape. We only
// care about the first few hits.
interface BrowseResponse {
  listings: SearchHit[];
  total: number;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
};

// Visually hidden but still read by screen readers — used for the polite
// live region that announces how many suggestions appeared. Clipped rather
// than display:none because hidden nodes are dropped from the a11y tree and
// would never be announced.
const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

// useId() emits characters that are legal in an id attribute but illegal in
// a CSS selector (React 19 wraps ids in «»). We only ever reference these
// ids from ARIA attributes, but strip them anyway so nothing downstream is
// tempted to querySelector them. Mirrors makeScope() in category-curtain.
function makeIdBase(rawId: string): string {
  return `ls-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

function typeLabel(t: SearchHit['listingType']): string {
  if (t === 'BUY_NOW') return 'Buy Now';
  if (t === 'AUCTION') return 'Auction';
  return 'Take a Shot';
}

// Each module gets a small colour accent so the user can scan results
// and tell at a glance which buying surface they belong to.
function typeColor(t: SearchHit['listingType']): string {
  if (t === 'AUCTION') return '#f59e0b'; // amber — time-sensitive
  if (t === 'TAKE_A_SHOT') return '#a78bfa'; // violet — offer-based
  return 'var(--text-secondary)'; // BUY_NOW — neutral
}

export function LiveSearch({
  placeholder = 'Search listings…',
  className,
  style,
  variant,
  onNavigate,
  defaultValue,
  preserveParams,
}: {
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  // 'attached' — strips the input's own border/background/radius so it can
  // sit flush inside a shared bordered control (the nav's Categories+search
  // unit). Default keeps the standalone bordered box.
  variant?: 'attached';
  // Fired whenever this search navigates. Containers that overlay the page
  // (the mobile burger drawer) use it to close themselves — they can't rely
  // on a route-change effect because search pushes "/?q=…", a query-only
  // change that leaves usePathname() untouched.
  onNavigate?: () => void;
  // Seed the box with the CURRENT query (results page) so the user sees
  // what they searched and can edit it. The component remounts on
  // server-rendered navigations, so a plain initial state is enough.
  defaultValue?: string;
  // Extra query params to KEEP when submitting a search — the FilterBar
  // passes the active surface/filters (listingType, categoryId, …) so
  // searching within Auctions stays within Auctions. Global boxes (nav,
  // drawer) pass nothing and search site-wide. `page` is intentionally
  // never preserved (a new search restarts at page 1).
  preserveParams?: Record<string, string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState(defaultValue ?? '');

  // Build the full-results URL, carrying any preserved filters.
  function resultsHref(term: string): string {
    const params = new URLSearchParams(preserveParams ?? {});
    params.set('q', term);
    return `/?${params.toString()}`;
  }
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ─── Combobox keyboard state ───
  // -1 = nothing highlighted (Enter then falls through to "search for what I
  // typed"). 0..hits.length-1 are the hits; hits.length is the trailing
  // "See all results" row, which is a real option so arrowing past the last
  // hit lands somewhere useful instead of dead-ending.
  const [activeIndex, setActiveIndex] = useState(-1);
  const idBase = makeIdBase(useId());
  const listboxId = `${idBase}-listbox`;
  const optionId = (i: number) => `${idBase}-opt-${i}`;
  // Option DOM nodes, so the highlighted row can be scrolled into view
  // (the panel is maxHeight 420 + overflowY auto, so with 6 hits + the
  // footer row the bottom options can sit below the fold).
  const optionRefs = useRef<(HTMLElement | null)[]>([]);

  // Outside-click + Esc handler.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Debounced fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      setBusy(false);
      // Cancel any in-flight request from a longer previous query.
      abortRef.current?.abort();
      return;
    }
    setBusy(true);
    debounceRef.current = setTimeout(async () => {
      // Cancel previous request — otherwise an older slower response
      // could overwrite the newer query's results.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const url = `${API_URL}/listings?q=${encodeURIComponent(term)}&limit=6`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          setHits([]);
          return;
        }
        const data = (await res.json()) as BrowseResponse;
        setHits(data.listings ?? []);
        setOpen(true);
      } catch (err) {
        // Aborted by a newer search — silent.
        if ((err as Error).name === 'AbortError') return;
        setHits([]);
      } finally {
        setBusy(false);
      }
    }, 180);
  }, [q]);

  // A new result set invalidates the old highlight — index 2 of the previous
  // query is a different listing now, and a shrinking list could leave
  // activeIndex pointing past the end.
  useEffect(() => {
    setActiveIndex(-1);
  }, [hits]);

  // Keep the highlighted option visible inside the scrolling panel. 'nearest'
  // so it never yanks the page around when the panel already shows the row.
  useEffect(() => {
    if (activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Rows the arrow keys can reach: every hit plus the trailing "See all
  // results" row. Zero when there's nothing to show (no results / no query),
  // which is what makes the arrow handlers no-ops in that state.
  const hitCount = hits?.length ?? 0;
  const optionCount = hitCount > 0 ? hitCount + 1 : 0;
  // aria-expanded must describe the panel the user can actually see, not the
  // `open` flag on its own (which stays true while hits is null between
  // queries).
  const panelOpen = open && hits !== null;

  function closePanel() {
    setOpen(false);
    setActiveIndex(-1);
  }

  // Navigate to a hit — shared by mouse click and Enter-on-highlight so the
  // two paths can't drift (both clear the box and tell the container to close).
  function goToHit(hit: SearchHit) {
    closePanel();
    setQ('');
    onNavigate?.();
    router.push(`/listings/${hit.id}`);
  }

  function goToAllResults() {
    const term = q.trim();
    if (!term) return;
    closePanel();
    onNavigate?.();
    router.push(resultsHref(term));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Same destination as the "See all results" option — one code path so
    // Enter-with-no-highlight and clicking the footer row can't diverge.
    goToAllResults();
  }

  // Combobox keys. Focus stays in the input throughout — only the highlight
  // moves — so the user can keep typing to refine at any point.
  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      // preventDefault stops the caret jumping to the end of the input, which
      // would silently rewrite where the next keystroke lands.
      e.preventDefault();
      if (optionCount === 0) return;
      if (!panelOpen) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((i) => (i + 1) % optionCount);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (optionCount === 0) return;
      if (!panelOpen) {
        setOpen(true);
        setActiveIndex(optionCount - 1);
        return;
      }
      setActiveIndex((i) => (i <= 0 ? optionCount - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      // With nothing highlighted we let the form submit as before ("search
      // for exactly what I typed") — only a live highlight overrides it.
      if (!panelOpen || activeIndex < 0) return;
      e.preventDefault();
      if (activeIndex < hitCount) {
        const hit = hits?.[activeIndex];
        if (hit) goToHit(hit);
      } else {
        goToAllResults();
      }
      return;
    }
    if (e.key === 'Escape') {
      closePanel();
      return;
    }
    if (e.key === 'Tab') {
      // Tabbing away must dismiss the popup, otherwise it hangs over whatever
      // the user moved on to.
      closePanel();
    }
  }

  const finalInputStyle: React.CSSProperties =
    variant === 'attached'
      ? {
          ...inputStyle,
          border: 'none',
          background: 'transparent',
          borderRadius: 0,
        }
      : inputStyle;

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: 'relative',
        ...(variant === 'attached' ? { display: 'flex' } : {}),
        ...style,
      }}
    >
      <form onSubmit={onSubmit} style={variant === 'attached' ? { flex: 1 } : undefined}>
        <input
          type="search"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            if (hits && hits.length > 0) setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
          style={finalInputStyle}
          aria-label="Search listings"
          autoComplete="off"
          // ARIA 1.2 combobox: the input owns the popup, and the highlighted
          // row is pointed at by id rather than by moving DOM focus.
          role="combobox"
          aria-expanded={panelOpen}
          // Only advertise the listbox while it is actually mounted — an
          // aria-controls pointing at a missing id is an a11y-audit failure.
          aria-controls={panelOpen && hitCount > 0 ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            panelOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
        />
      </form>

      {/* Polite live region — the only way a screen-reader user learns that
          suggestions appeared, since focus never moves into the panel. Must
          stay mounted (an element added at the same moment its text changes
          is often not announced). */}
      <span role="status" aria-live="polite" style={srOnlyStyle}>
        {!panelOpen
          ? ''
          : hitCount === 0
            ? busy
              ? ''
              : `No results for ${q}`
            : `${hitCount} suggestion${hitCount === 1 ? '' : 's'} available. Use the up and down arrow keys to review.`}
      </span>

      {/* `hits !== null` is already folded into panelOpen; repeated here so
          TypeScript narrows hits inside the branch. */}
      {panelOpen && hits !== null && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 60,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            maxHeight: 420,
            overflowY: 'auto',
          }}
        >
          {hits.length === 0 ? (
            <div
              style={{
                padding: '14px 16px',
                fontSize: 13,
                color: 'var(--text-tertiary)',
              }}
            >
              {busy ? 'Searching…' : `No results for “${q}”`}
            </div>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Search suggestions"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {hits.map((h, i) => {
                const img =
                  h.images.find((i2) => i2.isPrimary)?.url ?? h.images[0]?.url;
                const active = i === activeIndex;
                return (
                  // role=presentation on the <li> so the option role lands on
                  // the link itself — a listbox may only own options, and the
                  // link is the thing that acts.
                  <li key={h.id} role="presentation">
                    <Link
                      href={`/listings/${h.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={active}
                      // The input keeps DOM focus (aria-activedescendant
                      // pattern), so options must not be tab stops.
                      tabIndex={-1}
                      ref={(el) => {
                        optionRefs.current[i] = el;
                      }}
                      // Hovering moves the highlight so mouse and keyboard
                      // never disagree about which row is "current".
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => {
                        closePanel();
                        setQ('');
                        onNavigate?.();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 14px',
                        textDecoration: 'none',
                        background: active
                          ? 'var(--bg-card-hover)'
                          : 'transparent',
                        borderBottom:
                          '0.5px solid var(--border-divider, var(--border))',
                      }}
                    >
                      {/* Cover image — square thumbnail, left */}
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          flexShrink: 0,
                          borderRadius: 6,
                          background: 'var(--bg-inset)',
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img}
                            alt=""
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--text-tertiary)',
                            }}
                          >
                            —
                          </span>
                        )}
                      </div>

                      {/* Right column — title on top, module type below */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            color: 'var(--text-primary)',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginBottom: 3,
                          }}
                        >
                          {h.title}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: typeColor(h.listingType),
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>
                            {typeLabel(h.listingType)}
                          </span>
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            · {h.category.name}
                          </span>
                        </div>
                      </div>

                      {/* Price — right edge, small + muted so the title
                          stays dominant. */}
                      {h.price && (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--text-secondary)',
                            fontWeight: 500,
                            flexShrink: 0,
                          }}
                        >
                          {formatPrice(h.price)}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
              {/* Footer row — "see all" link to the full results page. It is
                  the LAST option (index hits.length) rather than a separate
                  control, so ArrowDown past the final hit lands here instead
                  of dead-ending. */}
              <li role="presentation">
                <button
                  type="button"
                  id={optionId(hitCount)}
                  role="option"
                  aria-selected={activeIndex === hitCount}
                  tabIndex={-1}
                  ref={(el) => {
                    optionRefs.current[hitCount] = el;
                  }}
                  onMouseEnter={() => setActiveIndex(hitCount)}
                  onClick={goToAllResults}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background:
                      activeIndex === hitCount
                        ? 'var(--bg-card-hover)'
                        : 'var(--bg-inset)',
                    border: 'none',
                    borderTop: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                    fontSize: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  See all results for &ldquo;{q}&rdquo; →
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
