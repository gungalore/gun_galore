'use client';

import { useRef } from 'react';
import { clickPulse } from '@/lib/anim';

// Reusable Pill button — used by the category picker, listing-type selector,
// and condition selector on /listings/new. Single source of truth for the
// dark-mode pill visual: lowercase grey when idle, brand-red filled when
// selected.
//
// GSAP micro-bounce on click gives every selection a small tactile
// confirmation — premium feel without overdoing it.

export function Pill({
  label,
  selected,
  onClick,
  size = 'md',
  disabled = false,
  fullWidth = false,
}: {
  label: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Stretch the pill to fill its parent's column. Pairs with
   * PillGroup's `equalCols` prop so all pills in a 3-column grid
   * have identical widths (no wrap, no jagged edges). */
  fullWidth?: boolean;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const padding = size === 'sm' ? '6px 12px' : '8px 16px';
  const fontSize = size === 'sm' ? 12 : 14;
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        clickPulse(ref.current);
        onClick();
      }}
      className="rounded-full"
      style={{
        padding,
        fontSize,
        background: selected ? 'var(--red)' : 'var(--bg-inset)',
        color: selected ? '#fff' : 'var(--text-secondary)',
        border: selected
          ? '0.5px solid var(--red)'
          : '0.5px solid var(--border)',
        fontWeight: selected ? 500 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        lineHeight: 1.2,
        width: fullWidth ? '100%' : undefined,
        textAlign: fullWidth ? 'center' : undefined,
        transition:
          'background-color 220ms ease, color 220ms ease, border-color 220ms ease, opacity 220ms ease',
        willChange: 'transform',
      }}
    >
      {label}
    </button>
  );
}

// Single-select group — pass `options` and the current `value`; calls
// `onChange` with the chosen value.
//
// `equalCols`: when true, render as a grid with one column per option
// and stretch each pill to fill its column. Use this for option sets
// where every choice deserves equal visual weight (e.g. the Sell-
// form listing-type selector — Marketplace / Auction / Take a Shot)
// and you want all options on a single row regardless of label
// length. Default behaviour is `flex-wrap` which suits long
// taxonomies (category picker, etc.).
export function PillGroup<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  equalCols = false,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
  size?: 'sm' | 'md';
  equalCols?: boolean;
}) {
  if (equalCols) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
          gap: 8,
        }}
      >
        {options.map((opt) => (
          <Pill
            key={opt.value}
            label={opt.label}
            selected={value === opt.value}
            onClick={() => onChange(opt.value)}
            size={size}
            fullWidth
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <Pill
          key={opt.value}
          label={opt.label}
          selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          size={size}
        />
      ))}
    </div>
  );
}

// Multi-select group — pass `options` and the current `value` array.
// Clicking a pill toggles it in/out of the selection. Used for shipping
// methods where the seller can offer multiple options at once.
export function MultiSelectPillGroup<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: {
    value: T;
    label: string;
    description?: string;
    /** Greys the pill and blocks clicks. Used by the Sell form to hide
     *  PUDO when the parcel exceeds locker box limits. */
    disabled?: boolean;
  }[];
  value: T[];
  onChange: (next: T[]) => void;
  size?: 'sm' | 'md';
}) {
  function toggle(opt: T) {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <Pill
          key={opt.value}
          label={opt.label}
          selected={value.includes(opt.value)}
          onClick={() => toggle(opt.value)}
          size={size}
          disabled={opt.disabled}
        />
      ))}
    </div>
  );
}
