'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Category, CategoryAttributeDef } from '@/lib/types';
import { PROVINCE_LABELS, CONDITION_LABELS } from '@/lib/utils';
import { LiveSearch } from '@/components/live-search';

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

export function FilterBar({
  categories,
  currentParams,
  brands = [],
  facets = {},
}: {
  categories: Category[];
  currentParams: FilterParams;
  brands?: string[];
  // Facet counts from GET /listings/facets, keyed field → value → count
  // (e.g. { make: { Toyota: 12 }, attr_cab_type: { 'Double Cab': 5 } }).
  // AND-consistent with the current filter set. Empty when a category isn't
  // scoped or Meili is down → options render without counts (graceful).
  facets?: Record<string, Record<string, number>>;
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
    router.push(`/?${next}`);
  }

  function applyPrice() {
    const toCents = (r: string): string | undefined => {
      const n = parseFloat(r);
      return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100)) : undefined;
    };
    push({ minPrice: toCents(minR), maxPrice: toCents(maxR) });
  }

  return (
    <div className="flex flex-col gap-3">
    <div className="flex flex-wrap gap-2 items-center">
      {/* Live typeahead — talks to /listings?q=…, Meilisearch handles
          typo tolerance (1 typo for 5–8 char terms, 2 for ≥9). Selecting
          a hit navigates to its listing; pressing Enter falls through to
          the full results page at /?q=…, same as the old input. */}
      <LiveSearch
        placeholder="Search listings…"
        className="flex-1 min-w-[200px]"
      />

      {/* Hunting Packages / Experiences (Phase E) — a one-tap "Experiences"
          chip that scopes browse to the experience category. Only rendered
          when an experience category exists in the taxonomy; toggles the
          categoryId param on/off. */}
      {(() => {
        const experienceCat = categories.find((c) => c.isExperience);
        if (!experienceCat) return null;
        const active = currentParams.categoryId === experienceCat.id;
        return (
          <button
            type="button"
            aria-pressed={active}
            onClick={() => {
              setAttrFilters({});
              setNumBuf({});
              push({
                categoryId: active ? undefined : experienceCat.id,
                attrs: undefined,
              });
            }}
            className="text-[13px] px-3 py-[7px] rounded-[6px]"
            style={{
              background: active ? 'rgba(232,181,58,0.85)' : 'var(--bg-inset)',
              color: active ? '#1a1206' : 'var(--text-secondary)',
              border: `0.5px solid ${active ? 'rgba(232,181,58,0.85)' : 'var(--border)'}`,
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Experiences
          </button>
        );
      })()}

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
        style={selectStyle}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {brands.length > 0 && (
        <select
          aria-label="Filter by brand"
          value={currentParams.make ?? ''}
          onChange={(e) => push({ make: e.target.value || undefined })}
          style={selectStyle}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
              {facetCount('make', b, currentParams.make ? 'make' : undefined)}
            </option>
          ))}
        </select>
      )}

      <select
        aria-label="Filter by province"
        value={currentParams.province ?? ''}
        onChange={(e) => push({ province: e.target.value || undefined })}
        style={selectStyle}
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
      </select>

      <select
        aria-label="Filter by condition"
        value={currentParams.condition ?? ''}
        onChange={(e) => push({ condition: e.target.value || undefined })}
        style={selectStyle}
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
      </select>

      <select
        aria-label="Filter by listing type"
        value={currentParams.listingType ?? ''}
        onChange={(e) => push({ listingType: e.target.value || undefined })}
        style={selectStyle}
      >
        {(() => {
          // Suppress listingType counts when a surface (listingType) is already
          // selected — the distribution collapses to that one type otherwise.
          const af = currentParams.listingType ? 'listingType' : undefined;
          return (
            <>
              <option value="">All types</option>
              <option value="BUY_NOW">
                Marketplace{facetCount('listingType', 'BUY_NOW', af)}
              </option>
              <option value="AUCTION">
                Auction{facetCount('listingType', 'AUCTION', af)}
              </option>
              <option value="TAKE_A_SHOT">
                Take a Shot{facetCount('listingType', 'TAKE_A_SHOT', af)}
              </option>
              <option value="SWOP">
                Swop / Trade{facetCount('listingType', 'SWOP', af)}
              </option>
            </>
          );
        })()}
      </select>

      {/* Price range (Rands). Applies on blur or Enter so we don't navigate
          on every keystroke. */}
      <div className="flex items-center gap-1">
        <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>R</span>
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
          style={priceInputStyle}
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
          style={priceInputStyle}
        />
      </div>

      <select
        aria-label="Sort results"
        value={currentParams.sort ?? ''}
        onChange={(e) => push({ sort: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">Newest first</option>
        <option value="price_asc">Price: low → high</option>
        <option value="price_desc">Price: high → low</option>
      </select>
    </div>

    {/* ─── Per-category specifications filters (P4.3a) ───
        Only rendered when a single category is in scope AND that category
        has filterable SELECT/BOOLEAN/NUMBER attributes. On any other surface
        (no category selected, fetch failed, or no filterable attrs) this
        block collapses to nothing and browse is unchanged. */}
    {scopedCategoryId && attrDefs.length > 0 && (
      <div
        className="flex flex-col gap-2 pt-1"
        style={{ borderTop: '0.5px solid var(--border)' }}
      >
        <span
          className="text-xs uppercase"
          style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}
        >
          Specifications
        </span>
        <div className="flex flex-wrap gap-2 items-center">
          {attrDefs.map((def) => {
            const current = attrFilters[def.key];

            if (def.type === 'SELECT') {
              return (
                <select
                  key={def.id}
                  aria-label={`Filter by ${def.label}`}
                  value={typeof current === 'string' ? current : ''}
                  onChange={(e) =>
                    setEquality(def.key, e.target.value || undefined)
                  }
                  style={selectStyle}
                >
                  <option value="">{`All ${def.label.toLowerCase()}`}</option>
                  {def.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                      {facetCount(
                        `attr_${def.key}`,
                        opt,
                        typeof current === 'string'
                          ? `attr_${def.key}`
                          : undefined,
                      )}
                    </option>
                  ))}
                </select>
              );
            }

            if (def.type === 'BOOLEAN') {
              return (
                <label
                  key={def.id}
                  className="flex items-center gap-1.5 cursor-pointer"
                  style={{
                    ...selectStyle,
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
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
                  <span className="text-[13px]">{def.label}</span>
                </label>
              );
            }

            // NUMBER — a min/max pair. Buffered locally; applied on blur /
            // Enter (like the price inputs) so we don't navigate per keystroke.
            // Only filled bounds end up in the `attrs` param.
            const setBuf = (bound: 'min' | 'max', v: string) =>
              setNumBuf((prev) => ({ ...prev, [`${def.key}:${bound}`]: v }));
            return (
              <div key={def.id} className="flex items-center gap-1">
                <span
                  style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}
                >
                  {def.label}
                </span>
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
                  style={priceInputStyle}
                />
                <span
                  style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}
                >
                  –
                </span>
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
                  style={priceInputStyle}
                />
                {def.unit && (
                  <span
                    style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}
                  >
                    {def.unit}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    )}
    </div>
  );
}
