'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Category, CategoryAttributeDef } from '@/lib/types';
import { PROVINCE_LABELS, CONDITION_LABELS, formatPrice } from '@/lib/utils';
import { LiveSearch } from '@/components/live-search';
import { useScrollLock } from '@/lib/use-scroll-lock';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface FilterParams {
  q?: string;
  categoryId?: string;
  listingType?: string;
  condition?: string;
  province?: string;
  make?: string;
  // Price is carried in the URL as ZAR cents (matches the API); the inputs
  // below display Rands.
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
  // Per-category attribute filters (P4.3a) — URL-encoded JSON string.
  // Equality for SELECT/BOOLEAN ({ key: value }) and range for NUMBER
  // ({ key: { min, max } }), combined into one object.
  attrs?: string;
}

// A NUMBER attribute filter carries optional min/max bounds; SELECT/BOOLEAN
// filters carry a plain equality value.
type AttrRange = { min?: number; max?: number };
type AttrFilterValue = string | boolean | AttrRange;
type AttrFilters = Record<string, AttrFilterValue>;

// Parse the URL's `attrs` param (encoded JSON) into an object. Anything
// malformed collapses to {} so a bad URL never breaks the filter bar.
function parseAttrs(encoded?: string): AttrFilters {
  if (!encoded) return {};
  try {
    const decoded = JSON.parse(decodeURIComponent(encoded));
    return decoded && typeof decoded === 'object' ? (decoded as AttrFilters) : {};
  } catch {
    return {};
  }
}

// Serialize an attribute-filter object back to the encoded `attrs` param.
// Drops empty ranges / blank values so we never emit noise, and returns
// undefined when nothing is set (so push() strips the param entirely).
function serializeAttrs(filters: AttrFilters): string | undefined {
  const clean: AttrFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') {
      const range: AttrRange = {};
      if (typeof value.min === 'number' && Number.isFinite(value.min))
        range.min = value.min;
      if (typeof value.max === 'number' && Number.isFinite(value.max))
        range.max = value.max;
      if (range.min === undefined && range.max === undefined) continue;
      clean[key] = range;
    } else {
      clean[key] = value;
    }
  }
  if (Object.keys(clean).length === 0) return undefined;
  return encodeURIComponent(JSON.stringify(clean));
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-secondary)',
  borderRadius: '6px',
  padding: '7px 10px',
  fontSize: '13px',
  outline: 'none',
  cursor: 'pointer',
};

const priceInputStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-secondary)',
  borderRadius: '6px',
  padding: '7px 8px',
  fontSize: '13px',
  outline: 'none',
  width: '92px',
};

// Surface labels for the listingType control. Held in ONE place so the
// <select> options and the active-filter chips can never drift apart — a
// chip reading "TAKE_A_SHOT" would leak the raw enum onto a public surface.
// Insertion order IS the option order rendered in the select.
const LISTING_TYPE_LABELS: Record<string, string> = {
  BUY_NOW: 'Marketplace',
  AUCTION: 'Auction',
  TAKE_A_SHOT: 'Take a Shot',
};

// Active-filter chip pill (BIG-1). A chip is a real <button>: the WHOLE pill
// removes that one filter, so the tap target is the pill, not a 12px ×.
const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  maxWidth: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-secondary)',
  borderRadius: '999px',
  padding: '5px 10px',
  fontSize: '12px',
  lineHeight: 1.35,
  cursor: 'pointer',
};

// Shared focus ring. There is no global :focus-visible rule in this app and
// every control here is inline-styled, so keyboard users would otherwise get
// the UA outline suppressed by `outline: 'none'` on the selects.
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-0';

export function FilterBar({
  categories,
  currentParams,
  brands = [],
  facets = {},
  basePath = '/',
  hideProvinceFilter = false,
  hideSearch = false,
}: {
  categories: Category[];
  currentParams: FilterParams;
  brands?: string[];
  // Facet counts from GET /listings/facets, keyed field → value → count
  // (e.g. { make: { Toyota: 12 }, attr_cab_type: { 'Double Cab': 5 } }).
  // AND-consistent with the current filter set. Empty when a category isn't
  // scoped or Meili is down → options render without counts (graceful).
  facets?: Record<string, Record<string, number>>;
  // Path filter changes navigate to. Defaults to the homepage grid ('/');
  // the seller storefront (UX-6) passes '/sellers/[clerkId]' so filtering
  // stays scoped to that seller instead of jumping home.
  basePath?: string;
  // Seller storefront hides the province filter — one seller ≈ one location,
  // so the facet adds no value.
  hideProvinceFilter?: boolean;
  // Seller storefront hides the global search box (Enter would jump to
  // site-wide results, breaking the seller scope).
  hideSearch?: boolean;
}) {
  const router = useRouter();

  // Format a facet count as a " (n)" suffix for an option label. Returns ''
  // when the facet field/value has no count. We SUPPRESS counts on the facet
  // the user is actively filtering, because Meili's distribution collapses that
  // facet to just the selected value — showing "(0)" on every other option
  // would be misleading. `activeField` is the field currently constrained.
  const facetCount = (
    field: string,
    value: string,
    activeField: string | undefined,
  ): string => {
    if (activeField && field === activeField) return '';
    const n = facets[field]?.[value];
    return typeof n === 'number' ? ` (${n})` : '';
  };

  // Price is held locally (in Rands) so typing doesn't fire a navigation per
  // keystroke; we apply on blur / Enter. Seed from the URL's cents value.
  const centsToRand = (c?: string) =>
    c && Number.isFinite(Number(c)) ? String(Number(c) / 100) : '';
  const [minR, setMinR] = useState(centsToRand(currentParams.minPrice));
  const [maxR, setMaxR] = useState(centsToRand(currentParams.maxPrice));

  // ─── Per-category attribute filters (P4.3a) ───
  // Attribute filters only make sense when exactly ONE category is in scope.
  // On "/" that's a selected categoryId; there is no category context
  // otherwise (a search across all categories can't offer per-category specs).
  const scopedCategoryId = currentParams.categoryId || undefined;

  // Filterable SELECT/BOOLEAN/NUMBER defs for the in-scope category. Empty
  // until (and unless) we successfully load them — a fetch failure or a
  // category with no filterable attrs leaves this empty and renders nothing,
  // so browse behaves exactly as before.
  const [attrDefs, setAttrDefs] = useState<CategoryAttributeDef[]>([]);

  // The active attribute filters, seeded from the URL and mutated locally.
  // SELECT/BOOLEAN equality + NUMBER ranges are stored here; this object is
  // what gets serialized into the `attrs` param.
  const [attrFilters, setAttrFilters] = useState<AttrFilters>(() =>
    parseAttrs(currentParams.attrs),
  );

  // NUMBER inputs are buffered locally (as strings, keyed "<key>:min" /
  // "<key>:max") so typing doesn't fire a navigation per keystroke — we apply
  // on blur / Enter, exactly like the price inputs. Seeded from the URL's
  // ranges.
  const numBufFrom = (filters: AttrFilters): Record<string, string> => {
    const buf: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value && typeof value === 'object') {
        const r = value as AttrRange;
        if (typeof r.min === 'number') buf[`${key}:min`] = String(r.min);
        if (typeof r.max === 'number') buf[`${key}:max`] = String(r.max);
      }
    }
    return buf;
  };
  const [numBuf, setNumBuf] = useState<Record<string, string>>(() =>
    numBufFrom(parseAttrs(currentParams.attrs)),
  );

  // Re-seed both the active filters and the NUMBER buffers whenever the URL's
  // attrs param changes (e.g. back/forward navigation) so every control
  // reflects the live query string.
  useEffect(() => {
    const parsed = parseAttrs(currentParams.attrs);
    setAttrFilters(parsed);
    setNumBuf(numBufFrom(parsed));
  }, [currentParams.attrs]);

  // Load the attribute definitions for the in-scope category. When no single
  // category is selected we clear them (and never fetch). Progressive: any
  // failure leaves attrDefs empty and the Specifications block is skipped.
  useEffect(() => {
    if (!scopedCategoryId) {
      setAttrDefs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/categories/${scopedCategoryId}/attributes`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (cancelled) return;
        if (Array.isArray(data)) {
          setAttrDefs(
            (data as CategoryAttributeDef[]).filter(
              // Only active, filterable, filter-friendly types. TEXT is
              // filterable-in-name only — free text is a poor filter, so we
              // skip it per the P4.3a contract.
              (d) =>
                d.isActive &&
                d.filterable &&
                (d.type === 'SELECT' ||
                  d.type === 'BOOLEAN' ||
                  d.type === 'NUMBER'),
            ),
          );
        }
      } catch {
        // Non-fatal — leave the block empty; browse is unaffected.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopedCategoryId]);

  // Apply the current attribute-filter object to the URL. Serializes to the
  // encoded `attrs` param (undefined when nothing set → param dropped).
  function applyAttrs(next: AttrFilters) {
    setAttrFilters(next);
    push({ attrs: serializeAttrs(next) });
  }

  // Equality set/clear for SELECT + BOOLEAN.
  function setEquality(key: string, value: string | boolean | undefined) {
    const next = { ...attrFilters };
    if (value === undefined || value === '' || value === false) {
      delete next[key];
    } else {
      next[key] = value;
    }
    applyAttrs(next);
  }

  // Apply a NUMBER attribute's buffered min/max to the URL. Called on blur /
  // Enter (not per keystroke). A blank bound is omitted; when both bounds are
  // blank the key is dropped entirely.
  function applyRange(key: string) {
    const parse = (raw?: string): number | undefined => {
      if (raw === undefined || raw.trim() === '') return undefined;
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const min = parse(numBuf[`${key}:min`]);
    const max = parse(numBuf[`${key}:max`]);
    const next = { ...attrFilters };
    if (min === undefined && max === undefined) {
      delete next[key];
    } else {
      const range: AttrRange = {};
      if (min !== undefined) range.min = min;
      if (max !== undefined) range.max = max;
      next[key] = range;
    }
    applyAttrs(next);
  }

  function push(updates: Partial<FilterParams>) {
    const merged = { ...currentParams, ...updates };
    // Any filter change returns to page 1 — otherwise a narrower result set
    // can land the user on an empty deep page. (Explicit page changes pass
    // `page` in updates and are respected.)
    if (!('page' in updates)) delete merged.page;
    const next = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v) next.set(k, String(v));
    });
    router.push(`${basePath}?${next}`);
  }

  function applyPrice() {
    const toCents = (r: string): string | undefined => {
      const n = parseFloat(r);
      return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100)) : undefined;
    };
    push({ minPrice: toCents(minR), maxPrice: toCents(maxR) });
  }

  // ─── BIG-1: mobile filter sheet ───
  // Below `sm` the nine wrapped controls pushed the first listing a full
  // viewport down. They now live behind a "Filters (n)" button that opens a
  // bottom sheet; the desktop row is untouched (see `hidden sm:contents`).
  const [sheetOpen, setSheetOpen] = useState(false);
  // Portals need document.body, which doesn't exist during SSR. Same guard
  // the listing image-gallery lightbox uses.
  const [portalReady, setPortalReady] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => setPortalReady(true), []);

  // Lock the page behind the sheet while it's open.
  useScrollLock(sheetOpen);

  useEffect(() => {
    if (!sheetOpen) return;
    // Close on Escape, and drop focus onto the close button so keyboard/
    // screen-reader users land inside the dialog rather than continuing down
    // the page underneath it.
    closeBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSheetOpen(false);
    }
    // Rotating a phone into landscape (or resizing a desktop window that was
    // narrow) crosses the `sm` breakpoint — the trigger button disappears, so
    // the sheet has to go with it or it strands the user in a modal with no
    // matching affordance.
    const mq = window.matchMedia('(min-width: 640px)');
    function onWide(e: MediaQueryListEvent) {
      if (e.matches) setSheetOpen(false);
    }
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onWide);
    };
  }, [sheetOpen]);

  // ─── Active-filter chips (BIG-1) ───
  // Derived PURELY from currentParams (plus the categories/brands lookups
  // already in this component) so a chip can never disagree with the URL —
  // including on the seller storefront, which passes a subset of params.
  // `attrs` is re-parsed from the URL here rather than read off attrFilters
  // state: the state is synced by an effect, so on the first render after a
  // back/forward navigation it can still be one step behind.
  const urlAttrs = parseAttrs(currentParams.attrs);

  type ActiveChip = { id: string; label: string; remove: () => void };
  const chips: ActiveChip[] = [];

  // Search term. Suppressed on the seller storefront, which hides the search
  // box entirely (hideSearch) and never puts `q` in the URL.
  if (!hideSearch && currentParams.q) {
    chips.push({
      id: 'q',
      label: `Search: “${currentParams.q}”`,
      remove: () => push({ q: undefined }),
    });
  }

  if (currentParams.listingType) {
    chips.push({
      id: 'listingType',
      label:
        LISTING_TYPE_LABELS[currentParams.listingType] ??
        currentParams.listingType,
      remove: () =>
        push({
          listingType: undefined,
          // "Ending soonest" is offered on the auction surface only (M-26).
          // Carrying it off-surface would leave the sort <select> pointing at
          // a value it no longer renders an <option> for.
          sort: currentParams.sort === 'ending_soon' ? undefined : currentParams.sort,
        }),
    });
  }

  if (currentParams.categoryId) {
    const cat = categories.find((c) => c.id === currentParams.categoryId);
    chips.push({
      id: 'categoryId',
      // Fall back to a generic word rather than the raw id — a cuid in a chip
      // is worse than no chip.
      label: cat ? cat.name : 'Category',
      remove: () => {
        // Same rule as the category <select>: a different category has a
        // different attribute set, so the spec filters go with it.
        setAttrFilters({});
        setNumBuf({});
        push({ categoryId: undefined, attrs: undefined });
      },
    });
  }

  if (currentParams.make) {
    chips.push({
      id: 'make',
      label: currentParams.make,
      remove: () => push({ make: undefined }),
    });
  }

  if (!hideProvinceFilter && currentParams.province) {
    chips.push({
      id: 'province',
      label: PROVINCE_LABELS[currentParams.province] ?? currentParams.province,
      remove: () => push({ province: undefined }),
    });
  }

  if (currentParams.condition) {
    chips.push({
      id: 'condition',
      label:
        CONDITION_LABELS[currentParams.condition] ?? currentParams.condition,
      remove: () => push({ condition: undefined }),
    });
  }

  // Price is ONE chip covering both bounds — users think of it as a single
  // "price range" filter, and two chips for one control reads as noise.
  {
    const minC = currentParams.minPrice ? Number(currentParams.minPrice) : NaN;
    const maxC = currentParams.maxPrice ? Number(currentParams.maxPrice) : NaN;
    const hasMin = Number.isFinite(minC);
    const hasMax = Number.isFinite(maxC);
    if (hasMin || hasMax) {
      chips.push({
        id: 'price',
        label:
          hasMin && hasMax
            ? `${formatPrice(minC)} – ${formatPrice(maxC)}`
            : hasMin
              ? `From ${formatPrice(minC)}`
              : `Up to ${formatPrice(maxC)}`,
        remove: () => {
          // Clear the buffered Rand inputs too, or the boxes would still show
          // the old numbers after the URL dropped them.
          setMinR('');
          setMaxR('');
          push({ minPrice: undefined, maxPrice: undefined });
        },
      });
    }
  }

  // Per-category spec filters. Labels/units come from attrDefs when loaded;
  // before that (or if the fetch failed) we fall back to the raw key rather
  // than hiding the chip — an invisible active filter is the exact bug BIG-1
  // exists to kill.
  for (const [key, value] of Object.entries(urlAttrs)) {
    if (value === false) continue; // never written by setEquality; belt-and-braces
    const def = attrDefs.find((d) => d.key === key);
    const name = def?.label ?? key;
    const unit = def?.unit ? ` ${def.unit}` : '';
    let label: string;
    if (value && typeof value === 'object') {
      const r = value as AttrRange;
      label =
        r.min !== undefined && r.max !== undefined
          ? `${name}: ${r.min}–${r.max}${unit}`
          : r.min !== undefined
            ? `${name}: from ${r.min}${unit}`
            : `${name}: up to ${r.max}${unit}`;
    } else if (typeof value === 'boolean') {
      label = name; // a true BOOLEAN filter reads as its own label
    } else {
      label = `${name}: ${value}`;
    }
    chips.push({
      id: `attr:${key}`,
      label,
      remove: () => {
        const next = { ...urlAttrs };
        delete next[key];
        setNumBuf((prev) => {
          const copy = { ...prev };
          delete copy[`${key}:min`];
          delete copy[`${key}:max`];
          return copy;
        });
        applyAttrs(next);
      },
    });
  }

  // The "Filters (n)" badge counts the controls hidden INSIDE the sheet. The
  // search box stays visible on mobile, so counting `q` there would promise a
  // filter the sheet can't show.
  const activeCount = chips.filter((c) => c.id !== 'q').length;

  // Clear all — removes exactly what the chips row displays, nothing more and
  // nothing less. (The zero-results "Clear filters" button on the homepage
  // deliberately KEEPS the surface + query; here the chips make the full
  // scope visible, so a "Clear all" that left chips standing would be a lie.)
  function clearAll() {
    setMinR('');
    setMaxR('');
    setAttrFilters({});
    setNumBuf({});
    push({
      q: undefined,
      categoryId: undefined,
      listingType: undefined,
      condition: undefined,
      province: undefined,
      make: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      attrs: undefined,
      // Auction-only sort can't survive dropping the auction surface.
      sort: currentParams.sort === 'ending_soon' ? undefined : currentParams.sort,
    });
  }

  // ─── Shared control renderer ───
  // Rendered twice: once inline for ≥sm (`row`) and once inside the sheet
  // (`sheet`, mobile only, and only while the sheet is open). Both read
  // straight from currentParams, so there is no state to keep in sync. The
  // `row` branch emits byte-identical markup to the pre-BIG-1 bar.
  function renderControls(variant: 'row' | 'sheet') {
    const sheet = variant === 'sheet';
    const ctlStyle: React.CSSProperties = sheet
      ? { ...selectStyle, width: '100%', padding: '10px 12px', fontSize: '14px' }
      : selectStyle;
    // In the sheet the two price boxes share a row, so they flex instead of
    // carrying the fixed 92px width the compact bar uses.
    const numStyle: React.CSSProperties = sheet
      ? {
          ...priceInputStyle,
          width: 'auto',
          flex: 1,
          minWidth: 0,
          padding: '10px 12px',
          fontSize: '14px',
        }
      : priceInputStyle;
    // Sheet controls get a visible label above them (the bar relies on the
    // option text + aria-label alone, which is fine when they're side by side
    // but unreadable in a stacked list).
    const field = (label: string, control: React.ReactNode) =>
      sheet ? (
        <div className="flex flex-col gap-1.5">
          <span
            className="text-xs uppercase"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}
          >
            {label}
          </span>
          {control}
        </div>
      ) : (
        <>{control}</>
      );

    // "Ending soonest" (M-26) is an auction-surface sort — nothing else has an
    // endTime worth ordering by. We also keep the option mounted when the URL
    // already carries sort=ending_soon (a shared/bookmarked link), otherwise
    // the select would render with no matching option and show blank.
    const showEndingSoon =
      currentParams.listingType === 'AUCTION' ||
      currentParams.sort === 'ending_soon';

    return (
      <>
        {field(
          'Category',
          <select
            aria-label="Filter by category"
            value={currentParams.categoryId ?? ''}
            onChange={(e) => {
              // A different category has a different attribute set, so the old
              // per-attribute filters no longer apply — drop them on switch.
              setAttrFilters({});
              setNumBuf({});
              push({ categoryId: e.target.value || undefined, attrs: undefined });
            }}
            className={FOCUS_RING}
            style={ctlStyle}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>,
        )}

        {brands.length > 0 &&
          field(
            'Brand',
            <select
              aria-label="Filter by brand"
              value={currentParams.make ?? ''}
              onChange={(e) => push({ make: e.target.value || undefined })}
              className={FOCUS_RING}
              style={ctlStyle}
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {facetCount('make', b, currentParams.make ? 'make' : undefined)}
                </option>
              ))}
            </select>,
          )}

        {!hideProvinceFilter &&
          field(
            'Province',
            <select
              aria-label="Filter by province"
              value={currentParams.province ?? ''}
              onChange={(e) => push({ province: e.target.value || undefined })}
              className={FOCUS_RING}
              style={ctlStyle}
            >
              <option value="">All provinces</option>
              {Object.entries(PROVINCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                  {facetCount(
                    'province',
                    k,
                    currentParams.province ? 'province' : undefined,
                  )}
                </option>
              ))}
            </select>,
          )}

        {field(
          'Condition',
          <select
            aria-label="Filter by condition"
            value={currentParams.condition ?? ''}
            onChange={(e) => push({ condition: e.target.value || undefined })}
            className={FOCUS_RING}
            style={ctlStyle}
          >
            <option value="">All conditions</option>
            {Object.entries(CONDITION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
                {facetCount(
                  'condition',
                  k,
                  currentParams.condition ? 'condition' : undefined,
                )}
              </option>
            ))}
          </select>,
        )}

        {field(
          'Listing type',
          <select
            aria-label="Filter by listing type"
            value={currentParams.listingType ?? ''}
            onChange={(e) => {
              const nextType = e.target.value || undefined;
              push({
                listingType: nextType,
                // M-26 — "Ending soonest" only exists while the auction
                // surface is selected; leaving it behind would strand the sort
                // select on an option it no longer renders.
                sort:
                  currentParams.sort === 'ending_soon' && nextType !== 'AUCTION'
                    ? undefined
                    : currentParams.sort,
              });
            }}
            className={FOCUS_RING}
            style={ctlStyle}
          >
            {(() => {
              // Suppress listingType counts when a surface (listingType) is
              // already selected — the distribution collapses to that one
              // type otherwise.
              const af = currentParams.listingType ? 'listingType' : undefined;
              return (
                <>
                  <option value="">All types</option>
                  {Object.entries(LISTING_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                      {facetCount('listingType', value, af)}
                    </option>
                  ))}
                </>
              );
            })()}
          </select>,
        )}

        {/* Price range (Rands). Applies on blur or Enter so we don't navigate
            on every keystroke. */}
        {field(
          'Price (Rands)',
          <div className={sheet ? 'flex items-center gap-2' : 'flex items-center gap-1'}>
            {!sheet && (
              <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                R
              </span>
            )}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              aria-label="Minimum price (Rands)"
              placeholder="Min"
              value={minR}
              onChange={(e) => setMinR(e.target.value)}
              onBlur={applyPrice}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyPrice();
              }}
              className={FOCUS_RING}
              style={numStyle}
            />
            <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>–</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              aria-label="Maximum price (Rands)"
              placeholder="Max"
              value={maxR}
              onChange={(e) => setMaxR(e.target.value)}
              onBlur={applyPrice}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyPrice();
              }}
              className={FOCUS_RING}
              style={numStyle}
            />
          </div>,
        )}

        {field(
          'Sort',
          <select
            aria-label="Sort results"
            value={currentParams.sort ?? ''}
            onChange={(e) => push({ sort: e.target.value || undefined })}
            className={FOCUS_RING}
            style={ctlStyle}
          >
            <option value="">Newest first</option>
            {/* M-26 — backend: sort=ending_soon orders endTime ASC nulls-last
                (Prisma) / endTimeTs ASC (Meili, q-path). Auction surface only. */}
            {showEndingSoon && <option value="ending_soon">Ending soonest</option>}
            <option value="price_asc">Price: low → high</option>
            <option value="price_desc">Price: high → low</option>
          </select>,
        )}
      </>
    );
  }

  // ─── Shared per-category spec renderer (P4.3a controls) ───
  // Same two-variant trick as renderControls: inline for ≥sm, stacked inside
  // the sheet on mobile.
  function renderSpecControls(variant: 'row' | 'sheet') {
    const sheet = variant === 'sheet';
    const ctlStyle: React.CSSProperties = sheet
      ? { ...selectStyle, width: '100%', padding: '10px 12px', fontSize: '14px' }
      : selectStyle;
    const numStyle: React.CSSProperties = sheet
      ? {
          ...priceInputStyle,
          width: 'auto',
          flex: 1,
          minWidth: 0,
          padding: '10px 12px',
          fontSize: '14px',
        }
      : priceInputStyle;

    return attrDefs.map((def) => {
      const current = attrFilters[def.key];

      if (def.type === 'SELECT') {
        const control = (
          <select
            aria-label={`Filter by ${def.label}`}
            value={typeof current === 'string' ? current : ''}
            onChange={(e) => setEquality(def.key, e.target.value || undefined)}
            className={FOCUS_RING}
            style={ctlStyle}
          >
            <option value="">{`All ${def.label.toLowerCase()}`}</option>
            {def.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
                {facetCount(
                  `attr_${def.key}`,
                  opt,
                  typeof current === 'string' ? `attr_${def.key}` : undefined,
                )}
              </option>
            ))}
          </select>
        );
        return sheet ? (
          <div key={def.id} className="flex flex-col gap-1.5">
            <span
              className="text-xs uppercase"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}
            >
              {def.label}
            </span>
            {control}
          </div>
        ) : (
          // Fragment (not a wrapper div) so the ≥sm row keeps the exact flex
          // children it had before BIG-1.
          <Fragment key={def.id}>{control}</Fragment>
        );
      }

      if (def.type === 'BOOLEAN') {
        return (
          <label
            key={def.id}
            className={`flex items-center gap-1.5 cursor-pointer ${FOCUS_RING}`}
            style={{
              ...selectStyle,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              ...(sheet ? { width: '100%', padding: '10px 12px' } : null),
            }}
          >
            <input
              type="checkbox"
              checked={current === true}
              onChange={(e) =>
                setEquality(def.key, e.target.checked ? true : undefined)
              }
              style={{ accentColor: 'var(--red)' }}
            />
            <span className={sheet ? 'text-[14px]' : 'text-[13px]'}>
              {def.label}
            </span>
          </label>
        );
      }

      // NUMBER — a min/max pair. Buffered locally; applied on blur /
      // Enter (like the price inputs) so we don't navigate per keystroke.
      // Only filled bounds end up in the `attrs` param.
      const setBuf = (bound: 'min' | 'max', v: string) =>
        setNumBuf((prev) => ({ ...prev, [`${def.key}:${bound}`]: v }));
      const pair = (
        <div className={sheet ? 'flex items-center gap-2' : 'flex items-center gap-1'}>
          {!sheet && (
            <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
              {def.label}
            </span>
          )}
          <input
            type="number"
            inputMode="decimal"
            aria-label={`Minimum ${def.label}`}
            placeholder="Min"
            value={numBuf[`${def.key}:min`] ?? ''}
            onChange={(e) => setBuf('min', e.target.value)}
            onBlur={() => applyRange(def.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyRange(def.key);
            }}
            className={FOCUS_RING}
            style={numStyle}
          />
          <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>–</span>
          <input
            type="number"
            inputMode="decimal"
            aria-label={`Maximum ${def.label}`}
            placeholder="Max"
            value={numBuf[`${def.key}:max`] ?? ''}
            onChange={(e) => setBuf('max', e.target.value)}
            onBlur={() => applyRange(def.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyRange(def.key);
            }}
            className={FOCUS_RING}
            style={numStyle}
          />
          {!sheet && def.unit && (
            <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
              {def.unit}
            </span>
          )}
        </div>
      );
      return sheet ? (
        <div key={def.id} className="flex flex-col gap-1.5">
          <span
            className="text-xs uppercase"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}
          >
            {def.label}
            {def.unit ? ` (${def.unit})` : ''}
          </span>
          {pair}
        </div>
      ) : (
        <Fragment key={def.id}>{pair}</Fragment>
      );
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ─── Control row ───
          Below `sm` this is just the search box + a "Filters (n)" trigger, so
          the first listing sits near the top of the phone viewport instead of
          a screen-and-a-half down (BIG-1). At ≥sm every control renders inline
          exactly as before: the wrapper uses `display: contents`, so the
          selects stay DIRECT flex children of this row and no desktop
          measurement changes. */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Live typeahead — talks to /listings?q=…, Meilisearch handles
            typo tolerance (1 typo for 5–8 char terms, 2 for ≥9). Selecting
            a hit navigates to its listing; pressing Enter falls through to
            the full results page at /?q=…, same as the old input.
            Hidden on the seller storefront (UX-6): the browse is scoped to
            one seller via the Prisma path, which doesn't do text search, and
            Enter would jump the user to global results. */}
        {!hideSearch && (
          <LiveSearch
            // Remount whenever the URL's q changes. LiveSearch seeds its input
            // from defaultValue exactly ONCE (plain useState), so without this
            // key, removing the "Search: …" chip would strip q from the URL
            // and still leave the old term sitting in the box.
            key={currentParams.q ?? ''}
            placeholder="Search listings…"
            // `min-w-0` below sm lets the box shrink next to the Filters
            // button on a 375px phone; the ≥sm floor is unchanged at 200px.
            className="flex-1 min-w-0 sm:min-w-[200px]"
            // Show the active query so the user sees what they searched and
            // can edit it in place.
            defaultValue={currentParams.q}
            // Keep the active surface + filters when submitting a new search —
            // searching from the Auctions view stays within Auctions. `page`
            // is deliberately excluded (a new search restarts at page 1).
            preserveParams={Object.fromEntries(
              Object.entries({
                listingType: currentParams.listingType,
                categoryId: currentParams.categoryId,
                condition: currentParams.condition,
                province: currentParams.province,
                make: currentParams.make,
                minPrice: currentParams.minPrice,
                maxPrice: currentParams.maxPrice,
                sort: currentParams.sort,
                attrs: currentParams.attrs,
              }).filter(([, v]) => !!v),
            ) as Record<string, string>}
          />
        )}

        {/* Mobile-only sheet trigger. Goes solid red once something is on, so
            the count is readable at a glance while scrolling results. */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={`sm:hidden shrink-0 rounded-[6px] ${FOCUS_RING}`}
          style={{
            background: activeCount > 0 ? 'var(--red)' : 'var(--bg-inset)',
            color: activeCount > 0 ? '#fff' : 'var(--text-secondary)',
            border: `0.5px solid ${activeCount > 0 ? 'var(--red)' : 'var(--border)'}`,
            padding: '9px 14px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>

        {/* ≥sm: the original inline control row, unchanged. */}
        <div className="hidden sm:contents">{renderControls('row')}</div>
      </div>

      {/* ─── Active-filter chips (BIG-1) ───
          Rendered at every breakpoint, but ONLY when something is actually
          filtered — with no filters on, this row collapses to nothing and the
          desktop bar looks exactly as it did before. Before this, the only
          way to see or drop a filter once results existed was to hunt through
          nine selects (the Clear-filters button lived in the zero-results
          state, which by definition you can't reach while you have results). */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.remove}
              // The visible label is the filter, so the accessible name has to
              // say what the click DOES — otherwise a screen reader announces
              // "Gauteng, button" with no hint that it removes it.
              aria-label={`Remove filter: ${chip.label}`}
              className={FOCUS_RING}
              style={chipStyle}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '190px',
                }}
              >
                {chip.label}
              </span>
              <span
                aria-hidden
                style={{
                  color: 'var(--text-tertiary)',
                  fontSize: '14px',
                  lineHeight: 1,
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className={FOCUS_RING}
            style={{
              ...chipStyle,
              background: 'transparent',
              border: '0.5px solid transparent',
              color: 'var(--red)',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* ─── Per-category specifications filters (P4.3a) ───
          Only rendered when a single category is in scope AND that category
          has filterable SELECT/BOOLEAN/NUMBER attributes. On any other surface
          (no category selected, fetch failed, or no filterable attrs) this
          block collapses to nothing and browse is unchanged.
          Below `sm` it moves into the filter sheet with everything else — this
          copy is the ≥sm one. */}
      {scopedCategoryId && attrDefs.length > 0 && (
        <div
          className="hidden sm:flex flex-col gap-2 pt-1"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <span
            className="text-xs uppercase"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}
          >
            Specifications
          </span>
          <div className="flex flex-wrap gap-2 items-center">
            {renderSpecControls('row')}
          </div>
        </div>
      )}

      {/* ─── Mobile filter sheet (BIG-1) ───
          Portalled to document.body on purpose: FilterBar renders inside a
          <PageReveal> `data-reveal` child, which keeps a non-none `transform`
          even after its keyframe settles. A transformed ancestor becomes the
          containing block for position:fixed, so an in-place sheet would be
          clipped to the filter bar's own box instead of the viewport. Same
          trick the listing image-gallery lightbox uses.
          z-index 70/71 clears the installed-PWA bottom tab bar (fixed, z55)
          and its sheets (z56). */}
      {sheetOpen &&
        portalReady &&
        createPortal(
          <>
            <div
              onClick={() => setSheetOpen(false)}
              aria-hidden
              className="fixed inset-0"
              style={{ background: 'rgba(0,0,0,0.55)', zIndex: 70 }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              className="fixed left-0 right-0 bottom-0 flex flex-col rounded-t-[16px]"
              style={{
                zIndex: 71,
                background: 'var(--bg-card)',
                borderTop: '0.5px solid var(--border)',
                maxHeight: '85vh',
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ borderBottom: '0.5px solid var(--border)' }}
              >
                <span
                  className="text-sm"
                  style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                >
                  Filters{activeCount > 0 ? ` (${activeCount})` : ''}
                </span>
                <button
                  type="button"
                  ref={closeBtnRef}
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close filters"
                  className={`rounded-[6px] ${FOCUS_RING}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-tertiary)',
                    fontSize: 22,
                    lineHeight: 1,
                    padding: '4px 8px',
                  }}
                >
                  ×
                </button>
              </div>

              {/* Scrollable body — every control the ≥sm row shows, stacked
                  and labelled. Each one still applies IMMEDIATELY (router
                  push under the sheet), so the sheet is a container, not a
                  form to submit. */}
              <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
                {renderControls('sheet')}

                {scopedCategoryId && attrDefs.length > 0 && (
                  <div
                    className="flex flex-col gap-4 pt-4"
                    style={{ borderTop: '0.5px solid var(--border)' }}
                  >
                    <span
                      className="text-xs uppercase"
                      style={{
                        color: 'var(--text-tertiary)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      Specifications
                    </span>
                    {renderSpecControls('sheet')}
                  </div>
                )}
              </div>

              {/* Footer — safe-area padding so the buttons clear the home
                  indicator on a notched phone. */}
              <div
                className="flex gap-2 px-4 pt-3 shrink-0"
                style={{
                  borderTop: '0.5px solid var(--border)',
                  paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
                }}
              >
                {activeCount > 0 && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className={`flex-1 py-3 rounded-[6px] text-sm ${FOCUS_RING}`}
                    style={{
                      background: 'transparent',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className={`flex-1 py-3 rounded-[6px] text-sm ${FOCUS_RING}`}
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Show results
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
