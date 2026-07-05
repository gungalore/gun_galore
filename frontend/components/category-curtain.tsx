'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

// ─── CategoryCurtain ───────────────────────────────────────────────
//
// The homepage "Shop by category" grid, revealed on scroll as a
// curtain falling COLUMN BY COLUMN: as the grid enters the viewport
// each tile drops down into place (translateY -> 0 + fade), staggered
// so the left column lands first and the sweep runs left→right, with a
// small top→bottom cascade inside each column (the "falling" feel).
//
// Built on the same no-flash recipe as PageReveal: the from-state and
// the transition live in an inline <style> that ships with the SSR'd
// HTML (no window between paint and rules -> no flicker). The reveal
// is scroll-triggered via IntersectionObserver rather than time-based,
// so the curtain plays exactly when the section scrolls into view (or
// immediately, if it's already on-screen on load).
//
// Stagger is truly column-aware at every breakpoint: the grid is
// 2 cols (mobile) / 3 (sm) / 4 (lg) — matching the Tailwind classes —
// and the live column count is tracked with matchMedia so each tile's
// --cc-col / --cc-row reflect its real visual position.
//
// prefers-reduced-motion: reduce -> tiles are shown instantly, no
// transform, no observer. JS-off (motion allowed) -> <noscript>
// forces the to-state. Both keep the catalogue reachable.

const COL_STEP_MS = 130; // gap between columns — the curtain sweeps left→right
const ROW_STEP_MS = 42; //  gentle top→bottom cascade within a column (the fall)
const DURATION_MS = 440;
const EASE = 'cubic-bezier(0.22,1,0.36,1)';

export interface CurtainTile {
  id: string;
  name: string;
  slug: string;
  count: number;
}

function makeScope(rawId: string): string {
  return `cc-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function CategoryCurtain({ tiles }: { tiles: CurtainTile[] }) {
  const rawId = useId();
  const scope = makeScope(rawId);
  const ref = useRef<HTMLDivElement>(null);

  // SSR default = desktop (4 cols); corrected on mount. Tiles are
  // hidden until reveal, so a one-frame column-count correction is
  // invisible.
  const [cols, setCols] = useState(4);
  const [revealed, setRevealed] = useState(false);

  // Track the live column count so the stagger is column-by-column at
  // every breakpoint (mirrors grid-cols-2 / sm:3 / lg:4).
  useEffect(() => {
    const sm = window.matchMedia('(min-width: 640px)');
    const lg = window.matchMedia('(min-width: 1024px)');
    const compute = () => setCols(lg.matches ? 4 : sm.matches ? 3 : 2);
    compute();
    sm.addEventListener('change', compute);
    lg.addEventListener('change', compute);
    return () => {
      sm.removeEventListener('change', compute);
      lg.removeEventListener('change', compute);
    };
  }, []);

  // Reveal once, when the grid scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced-motion users: show instantly, skip the observer entirely.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Scoped, SSR-inline styles. Default (from) state hides each tile and
  // arms the transition + per-column/row delay; `.is-revealed` flips to
  // the to-state. Colour transitions are included so hover still feels
  // alive (our rule out-specifies Tailwind's transition-colors).
  const css =
    `.${scope}>[data-tile]{` +
    `opacity:0;transform:translateY(-14px);` +
    `transition:opacity ${DURATION_MS}ms ${EASE},transform ${DURATION_MS}ms ${EASE},` +
    `background-color 140ms ease,border-color 140ms ease;` +
    `transition-delay:calc((var(--cc-col,0) * ${COL_STEP_MS}ms) + (var(--cc-row,0) * ${ROW_STEP_MS}ms));` +
    `will-change:opacity,transform;` +
    `}` +
    `.${scope}.is-revealed>[data-tile]{opacity:1;transform:translateY(0);}` +
    `@media (prefers-reduced-motion:reduce){` +
    `.${scope}>[data-tile]{opacity:1;transform:none;transition:none;}` +
    `}`;

  return (
    <div
      ref={ref}
      className={
        `${scope}${revealed ? ' is-revealed' : ''} ` +
        'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3'
      }
    >
      {/* Inline <style> ships in the SSR HTML — no flash-of-visible. */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {/* JS-off + motion-allowed safety net: keep tiles reachable. */}
      <noscript>
        <style>{`.${scope}>[data-tile]{opacity:1;transform:none;}`}</style>
      </noscript>

      {tiles.map((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const style = {
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          textDecoration: 'none',
          ['--cc-col']: col,
          ['--cc-row']: row,
        } as CSSProperties;
        return (
          <Link
            key={c.id}
            data-tile
            href={`/category/${c.slug}`}
            className="block rounded-[8px] p-4"
            style={style}
          >
            <p
              className="text-sm leading-snug"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {c.name}
            </p>
            {/* Hide the count entirely when 0 — a "0 items" tile reads
                worse than no number at all. */}
            {c.count > 0 && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {c.count.toLocaleString('en-ZA')} item
                {c.count !== 1 ? 's' : ''}
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
