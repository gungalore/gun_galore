'use client';

// UX-5 — "Shop by Category" desktop nav flyout.
//
// Two-column overlay: left = root categories, right = the hovered/focused
// root's children + a "View all" link. Opens on click AND hover-intent
// (150 ms), closes on outside-click / Escape / mouse-leave. Desktop-only —
// it lives inside the nav's `hidden md:flex` row, so mobile (Shop sheet +
// hamburger drawer) is untouched. Navigation-only: zero cart/checkout/money
// involvement.
//
// Categories are lazy-loaded once (module cache) the first time the menu is
// opened or hovered, then shared across every Nav mount / route change — the
// same /categories/with-counts call the homepage curtain makes. A failed or
// empty load is never cached: the flyout shows a loading line, then a retry
// card, so the button is never a silent no-op.

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import type { CategoryWithCount } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

let cache: CategoryWithCount[] | null = null;
let inflight: Promise<CategoryWithCount[]> | null = null;

// Rejects on ANY unusable outcome so the caller can show a retry instead of a
// silent empty menu. Previously a 4xx/5xx resolved to `[]`, that `[]` was
// written to the module cache, and every later open short-circuited on it —
// one bad response left "Categories" permanently dead for the whole session.
async function loadCategories(): Promise<CategoryWithCount[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch(`${API_URL}/categories/with-counts`, { cache: 'force-cache' })
      .then((r) => {
        // Throw on HTTP errors: only the network-error path used to clear
        // `inflight`, so a 500 was never retried.
        if (!r.ok) throw new Error(`categories ${r.status}`);
        return r.json();
      })
      .then((data: CategoryWithCount[]) => {
        const list = Array.isArray(data) ? data : [];
        // Never cache an empty payload — on a seeded marketplace it means the
        // response was broken (or the taxonomy is mid-migration), and caching
        // it would freeze the flyout empty until a full page reload.
        if (list.length === 0) throw new Error('categories empty');
        cache = list;
        return list;
      })
      .catch((err) => {
        inflight = null; // let a later open retry
        throw err;
      });
  }
  return inflight;
}

export function CategoryMenu({ variant = 'nav' }: { variant?: 'nav' | 'search' }) {
  const isSearch = variant === 'search';
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<CategoryWithCount[]>(cache ?? []);
  // Tells "still fetching" apart from "fetch failed" — without it an open
  // flyout with no categories renders nothing at all and the button reads as
  // broken (the exact bug on a cold cache / slow network).
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ensureLoaded = useCallback(() => {
    if (cats.length > 0) return;
    setLoadState('loading');
    // Concurrent calls (hover-intent then click) share the module `inflight`
    // promise, so re-entry costs no extra request; after a failure `inflight`
    // is cleared, which is what makes the retry button actually re-fetch.
    loadCategories().then(
      (list) => {
        setCats(list);
        setLoadState('idle');
      },
      () => setLoadState('error'),
    );
  }, [cats.length]);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const roots = cats
    .filter((c) => c.parentId === null && c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const activeRootObj = roots.find((r) => r.id === activeRoot) ?? roots[0] ?? null;
  const children = activeRootObj
    ? cats
        .filter((c) => c.parentId === activeRootObj.id && c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  function onEnter() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    ensureLoaded();
    hoverTimer.current = setTimeout(() => setOpen(true), 150);
  }
  function onLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(false), 150);
  }
  function focusFirstRoot() {
    setTimeout(() => {
      wrapRef.current?.querySelector<HTMLElement>('[data-cat-root]')?.focus();
    }, 0);
  }
  function onRootsKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(
      wrapRef.current?.querySelectorAll<HTMLElement>('[data-cat-root]') ?? [],
    );
    if (!items.length) return;
    e.preventDefault();
    const idx = items.findIndex((el) => el === document.activeElement);
    const next =
      e.key === 'ArrowDown'
        ? (idx + 1) % items.length
        : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', display: isSearch ? 'flex' : undefined }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            ensureLoaded();
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            ensureLoaded();
            setOpen(true);
            focusFirstRoot();
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Shop by category"
        className={
          isSearch
            ? 'flex items-center gap-1 shrink-0 hover:text-[#f5f5f5] transition-colors'
            : 'flex items-center gap-1 hover:text-[#f5f5f5] transition-colors'
        }
        style={
          isSearch
            ? {
                // Left segment fused into the search control: transparent so
                // the shared bordered wrapper shows through, a single divider
                // on the right against the input, full-height via stretch.
                color: 'var(--text-secondary)',
                background: 'transparent',
                border: 'none',
                borderRight: '0.5px solid var(--border)',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 13,
                padding: '0 12px',
                whiteSpace: 'nowrap',
              }
            : {
                color: 'var(--text-secondary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                font: 'inherit',
                padding: 0,
              }
        }
      >
        {isSearch ? 'Categories' : 'Shop by Category'}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Nothing to render in the grid yet. Previously the panel was gated on
          `roots.length > 0`, so a cold cache / slow network / failed fetch
          drew NOTHING and the button read as broken. Same retry-card idiom as
          the browse surface (app/page.tsx), at flyout scale. */}
      {open && roots.length === 0 && (
        <div
          role="status"
          aria-live="polite"
          className="absolute left-0 mt-2 rounded-[8px] z-50"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            padding: '14px 16px',
            minWidth: 240,
          }}
        >
          {loadState === 'error' ? (
            <>
              <p
                className="m-0 mb-2.5"
                style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}
              >
                We couldn&apos;t load categories
              </p>
              <button
                type="button"
                onClick={() => ensureLoaded()}
                className="rounded-[6px]"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 13,
                  padding: '6px 12px',
                }}
              >
                Try again
              </button>
            </>
          ) : (
            <p className="m-0" style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              {loadState === 'loading'
                ? 'Loading categories…'
                : /* Loaded fine but every root is inactive — rare, still not a
                     reason to render a blank box. */
                  'No categories to show right now.'}
            </p>
          )}
        </div>
      )}

      {open && roots.length > 0 && (
        <div
          role="menu"
          aria-label="Shop by category"
          onKeyDown={onRootsKey}
          className="absolute left-0 mt-2 rounded-[8px] z-50 overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: '220px 260px',
            // Cap the single grid row at 72vh. Without this the row auto-sizes to
            // max-content, the columns stretch to fit ALL children, their own
            // overflowY never engages, and the container's max-height silently
            // CLIPS the last sub-menu items (incl. "View all") with no scrollbar.
            gridTemplateRows: 'minmax(0, 72vh)',
            minWidth: 480,
            maxHeight: '72vh',
          }}
        >
          {/* Left column — root categories */}
          <div className="gg-menu-scroll" style={{ borderRight: '0.5px solid var(--border)', overflowY: 'auto', minHeight: 0, padding: '6px 0' }}>
            {roots.map((r) => {
              const active = activeRootObj?.id === r.id;
              return (
                <Link
                  key={r.id}
                  href={`/category/${r.slug}`}
                  role="menuitem"
                  data-cat-root
                  onMouseEnter={() => setActiveRoot(r.id)}
                  onFocus={() => setActiveRoot(r.id)}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between"
                  style={{
                    padding: '8px 14px',
                    fontSize: 13,
                    textDecoration: 'none',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    background: active ? 'rgba(200,16,46,0.12)' : 'transparent',
                    borderLeft: active ? '2px solid var(--red)' : '2px solid transparent',
                  }}
                >
                  <span>{r.name}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{r.count}</span>
                </Link>
              );
            })}
          </div>
          {/* Right column — children of the active root */}
          <div className="gg-menu-scroll" style={{ overflowY: 'auto', minHeight: 0, padding: '8px 0' }}>
            {activeRootObj && (
              <>
                {children.map((c) => (
                  <Link
                    key={c.id}
                    href={`/category/${c.slug}`}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="cat-submenu-item flex items-center justify-between"
                    style={{
                      padding: '7px 16px',
                      fontSize: 13,
                      textDecoration: 'none',
                    }}
                  >
                    <span>{c.name}</span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{c.count}</span>
                  </Link>
                ))}
                <Link
                  href={`/category/${activeRootObj.slug}`}
                  onClick={() => setOpen(false)}
                  style={{
                    display: 'block',
                    padding: '8px 16px',
                    marginTop: 4,
                    fontSize: 12,
                    color: 'var(--red)',
                    textDecoration: 'none',
                    borderTop: children.length ? '0.5px solid var(--border)' : undefined,
                  }}
                >
                  View all in {activeRootObj.name} →
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
