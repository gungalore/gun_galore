'use client';

// ────────────────────────────────────────────────────────────────────
// THE POLICE STATION FIELD — a search-as-you-type combobox, not a plain
// text box.
//
// `police_station` is prefilled server-side from the applicant's address
// (see the provenance line this renders), but it stays fully editable —
// unlike a doc-sourced field, there is no grey/locked state here. Selecting
// a suggestion writes BOTH `police_station` and the hidden
// `police_station_province` through the page's normal answer-change path, so
// draft persistence and autosave behave exactly as for any other field.
// Free-typing without picking a suggestion clears the province — an
// unverified name is not a verified match, and the precinct lookup keys off
// the province to disambiguate stations that share a name.
// ────────────────────────────────────────────────────────────────────

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { ProvenanceNote } from '@/components/motivation/provenance';
import { stationLabel } from '@/lib/crime-stats';
import {
  crimeStatsApi,
  type AnswerProvenance,
  type CrimeStatsStation,
  type TokenGetter,
} from '@/lib/motivations-api';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

const srOnlyStyle: CSSProperties = {
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

function makeIdBase(rawId: string): string {
  return `station-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function StationPicker({
  id,
  label,
  help,
  required,
  value,
  missing,
  provenance,
  getToken,
  onChangeText,
  onSelectStation,
}: {
  /** The field key — used as the input's own id, so the label stays wired to it. */
  id: string;
  label: string;
  help?: string;
  required?: boolean;
  /** The current `police_station` answer. */
  value: string;
  missing: boolean;
  /** Set only when the server filled this in — renders the "from …" line. */
  provenance?: AnswerProvenance;
  getToken: TokenGetter;
  /** Free typing. Callers should also clear `police_station_province`. */
  onChangeText: (text: string) => void;
  /** A suggestion was picked — the whole station, so the caller can write both keys. */
  onSelectStation: (station: CrimeStatsStation) => void;
}) {
  const [results, setResults] = useState<CrimeStatsStation[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const optionRefs = useRef<(HTMLElement | null)[]>([]);

  const idBase = makeIdBase(useId());
  const listboxId = `${idBase}-listbox`;
  const optionId = (i: number) => `${idBase}-opt-${i}`;

  // Outside-click closes the panel without touching the typed value.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced search, min MIN_CHARS. Every keystroke cancels the previous
  // in-flight request so a slower older query can never overwrite a newer one.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = value.trim();
    if (term.length < MIN_CHARS) {
      setResults(null);
      setBusy(false);
      abortRef.current?.abort();
      return;
    }
    setBusy(true);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const data = await crimeStatsApi.stations(getToken, term, ctrl.signal);
        setResults(data.stations ?? []);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, getToken]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  useEffect(() => {
    if (activeIndex < 0) return;
    // Optional call, not just optional chaining on the ref: jsdom (the test
    // environment) does not implement scrollIntoView at all.
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const hitCount = results?.length ?? 0;
  const panelOpen = open && results !== null;

  const closePanel = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const selectStation = useCallback(
    (station: CrimeStatsStation) => {
      onSelectStation(station);
      closePanel();
    },
    [onSelectStation, closePanel],
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hitCount === 0) return;
      if (!panelOpen) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((i) => (i + 1) % hitCount);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hitCount === 0) return;
      if (!panelOpen) {
        setOpen(true);
        setActiveIndex(hitCount - 1);
        return;
      }
      setActiveIndex((i) => (i <= 0 ? hitCount - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      if (!panelOpen || activeIndex < 0) return;
      e.preventDefault();
      const hit = results?.[activeIndex];
      if (hit) selectStation(hit);
      return;
    }
    if (e.key === 'Escape') {
      closePanel();
      return;
    }
    if (e.key === 'Tab') {
      closePanel();
    }
  }

  // "Not my station" — focuses the box and selects its text so the next
  // keystroke replaces it, without clearing anything until they actually type.
  function focusSearch() {
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  const base =
    'mt-1 w-full rounded border px-3 py-2 text-sm ' +
    'bg-[var(--bg-inset)] text-[var(--text-primary)] ' +
    'focus:border-[var(--border-hover)] focus:outline-none ' +
    (missing ? 'border-[var(--warning)]' : 'border-[var(--border)]');

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      {help && (
        <p className="mt-0.5 text-xs text-[var(--text-tertiary-on-card)]">
          {help}
        </p>
      )}

      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={panelOpen}
        aria-controls={panelOpen && hitCount > 0 ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          panelOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        autoComplete="off"
        className={base}
        placeholder="Start typing a station name…"
        value={value}
        onChange={(e) => onChangeText(e.target.value)}
        onFocus={() => {
          if (results && results.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />

      {/* Where this came from — the server's own words, never a local label. */}
      {provenance && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <ProvenanceNote provenance={provenance} className="mt-0" />
          <button
            type="button"
            onClick={focusSearch}
            className="text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            Not my station
          </button>
        </div>
      )}

      <span role="status" aria-live="polite" style={srOnlyStyle}>
        {!panelOpen
          ? ''
          : hitCount === 0
            ? busy
              ? ''
              : `No stations match “${value}”`
            : `${hitCount} station${hitCount === 1 ? '' : 's'} found. Use the up and down arrow keys to review.`}
      </span>

      {panelOpen && results !== null && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Matching SAPS stations"
          // ⚠️ NO box-shadow. globals.css kills every raw box-shadow with
          // `* { box-shadow: none !important }` unless the element carries
          // `.gg-tile` — a plain border does the separating job here instead.
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border)',
          }}
        >
          {hitCount === 0 ? (
            <li className="px-3 py-2.5 text-sm text-[var(--text-tertiary)]">
              {busy ? 'Searching…' : `No stations match “${value}”`}
            </li>
          ) : (
            // role="presentation" on the <li> so the option role lands on the
            // actually-clickable <button> — matching live-search.tsx's
            // combobox. A role/aria-selected pair on the <li> with the click
            // handler nested inside the button never fires: a click event
            // dispatched at an ancestor does not run a descendant's handler.
            results.map((s, i) => (
              <li key={`${s.name}-${s.district}-${s.province}`} role="presentation">
                <button
                  type="button"
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  className="block w-full min-h-[44px] px-3 py-2 text-left text-sm"
                  style={{
                    background:
                      i === activeIndex ? 'var(--bg-card-hover)' : 'transparent',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => selectStation(s)}
                >
                  {stationLabel(s)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
