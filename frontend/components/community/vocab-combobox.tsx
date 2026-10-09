'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { matchEntries, type VocabEntry } from '../../lib/post-vocab';
import { chipLabel } from '../../lib/post-fields';

/**
 * A type-to-search picker for a local vocabulary. Nothing is shown until the
 * member types — the list is a suggestion, never a wall of pills. Free text is
 * always accepted: `storeMode` decides whether the value is stored as a
 * normalised slug (species/flair/single-select) or verbatim (calibre/testResult).
 *
 * `multiple` renders chosen values as removable tokens (they must stay visible
 * so they can be undone); otherwise it is a single-value field.
 */
export function VocabCombobox({
  ariaLabel,
  entries,
  value,
  onChange,
  multiple = false,
  storeMode = 'slug',
  placeholder = 'Start typing…',
  disabled = false,
  maxLength = 32,
  maxSelections = 8,
}: {
  ariaLabel: string;
  entries: readonly VocabEntry[];
  value: string | number | string[] | undefined;
  onChange: (value: string | string[] | '') => void;
  multiple?: boolean;
  storeMode?: 'slug' | 'label';
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  maxSelections?: number;
}) {
  const inputId = useId();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const selected = multiple
    ? Array.isArray(value)
      ? value
      : []
    : typeof value === 'string' && value
      ? [value]
      : [];

  const byValue = useMemo(
    () => new Map(entries.map((x) => [x.value, x] as const)),
    [entries],
  );
  const pretty = (v: string) => byValue.get(v)?.label ?? (storeMode === 'slug' ? chipLabel(v) : v);

  const matches = useMemo(() => {
    const found = matchEntries(q, entries);
    // Don't offer something already selected (multi).
    return multiple ? found.filter((x) => !selected.includes(x.value)) : found;
  }, [q, entries, multiple, selected]);

  const normalise = (text: string) => {
    const t = text.trim();
    if (storeMode === 'label') return t.slice(0, maxLength);
    return t
      .toLowerCase()
      .replace(/\s+/g, '-')
      .slice(0, maxLength);
  };

  // Single: mirror the stored value into the box when the field is not focused.
  const focused = useRef(false);
  useEffect(() => {
    if (multiple || focused.current) return;
    setQ(typeof value === 'string' ? (value ? pretty(value) : '') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, multiple]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  function commit(entryValue: string, label: string) {
    if (multiple) {
      const next = selected.includes(entryValue) ? selected : [...selected, entryValue];
      onChange(next.slice(0, maxSelections));
      setQ('');
      setHighlight(-1);
      setOpen(false);
      inputRef.current?.focus();
    } else {
      onChange(entryValue);
      setQ(label);
      setOpen(false);
      setHighlight(-1);
    }
  }

  function commitFreeText() {
    const v = normalise(q);
    if (!v) return;
    if (multiple) {
      if (selected.includes(v)) {
        setQ('');
        return;
      }
      commit(v, storeMode === 'slug' ? chipLabel(v) : v);
    } else {
      commit(v, storeMode === 'label' ? v : chipLabel(v));
    }
  }

  function removeToken(v: string) {
    onChange(selected.filter((x) => x !== v));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && highlight >= 0 && matches[highlight]) {
        commit(matches[highlight].value, matches[highlight].label);
      } else {
        commitFreeText();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
    } else if (
      e.key === 'Backspace' &&
      multiple &&
      q === '' &&
      selected.length > 0
    ) {
      removeToken(selected[selected.length - 1]);
    }
  }

  const showList = open && q.trim().length > 0;
  const freeText = normalise(q);
  const showFreeRow = !!freeText && !matches.some((m) => m.value === freeText);

  return (
    <div ref={wrapRef} className="relative">
      <div
        className="flex flex-wrap gap-1.5 items-center px-2 py-1.5 rounded-[6px]"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
        }}
      >
        {multiple &&
          selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px]"
              style={{
                background: 'var(--red)',
                color: '#fff',
              }}
            >
              {pretty(v)}
              <button
                type="button"
                aria-label={`Remove ${pretty(v)}`}
                disabled={disabled}
                onClick={() => removeToken(v)}
                className="leading-none"
                style={{ color: '#fff' }}
              >
                ✕
              </button>
            </span>
          ))}
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && highlight >= 0 ? `${listId}-${highlight}` : undefined
          }
          value={q}
          disabled={disabled}
          placeholder={multiple && selected.length ? '' : placeholder}
          autoComplete="off"
          maxLength={maxLength + 8}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => {
            focused.current = true;
            inputRef.current?.select();
            if (q.trim()) setOpen(true);
          }}
          onBlur={() => {
            focused.current = false;
            // Single field: a blur with un-committed free text keeps it.
            if (!multiple && q.trim() && normalise(q) !== value) {
              const v = normalise(q);
              onChange(v);
              setQ(storeMode === 'label' ? v : pretty(v));
            }
          }}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-[8rem] bg-transparent outline-none text-[13px]"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${ariaLabel} suggestions`}
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-[6px] py-1"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          {matches.map((m, i) => (
            <li
              key={m.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={highlight === i}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(m.value, m.label);
              }}
              onMouseEnter={() => setHighlight(i)}
              className="px-3 py-1.5 text-[13px] cursor-pointer"
              style={{
                background: highlight === i ? 'var(--bg-inset)' : 'transparent',
                color: 'var(--text-primary)',
              }}
            >
              {m.label}
            </li>
          ))}
          {showFreeRow && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                commitFreeText();
              }}
              className="px-3 py-1.5 text-[13px] cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              Use “{freeText}”
            </li>
          )}
          {!matches.length && !showFreeRow && (
            <li
              className="px-3 py-1.5 text-[13px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Keep typing…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
