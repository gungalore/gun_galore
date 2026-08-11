'use client';

import { useCallback, useEffect, useRef } from 'react';

// House-style number input with our own + / − buttons. The browser
// default spinner arrows on <input type="number"> are hidden globally
// in globals.css; this component is what we use when a stepper UI is
// genuinely wanted (parcel weight, quantity, ticket count, etc).
//
// Behaviour:
//   - Click − or + to step by `step` (default 1)
//   - Hold the button to repeat (50ms cadence after 400ms initial delay)
//   - Manual typing in the input still works; we coerce on blur to
//     clamp into [min, max] if either is provided.
//   - Empty string is a valid in-progress state — onChange fires with
//     '' so the parent's controlled state stays accurate while the
//     user is mid-edit.
//   - Decimal step values (0.5, 0.1 etc) preserved at the precision
//     of `step` to avoid floating-point junk like 0.1+0.2=0.30000004.
//
// Why a custom widget rather than just hide the arrows:
//   - Native steppers fire at the browser's repeat rate (sluggish on
//     Windows, fast on macOS) — inconsistent.
//   - Touch users have no spinner at all on mobile browsers; they
//     have to use the keyboard. Our buttons are tap-friendly.
//   - Matches the rest of All Outdoor's hand-rolled controls.
export interface NumberStepperProps {
  /** Controlled value. Use empty string for "in progress / cleared". */
  value: string;
  /** Called with the new value. Parent must hold + pass back. */
  onChange: (next: string) => void;
  /** Step size for + / − buttons. Decimals supported (0.5, 0.1). Default 1. */
  step?: number;
  /** Hard minimum — value is clamped on blur. */
  min?: number;
  /** Hard maximum — value is clamped on blur. */
  max?: number;
  /** Placeholder for the bare input. */
  placeholder?: string;
  /** Disable the whole control. */
  disabled?: boolean;
  /** Suffix shown inside the input (e.g. "kg", "cm"). Cosmetic only — not part of the value. */
  suffix?: string;
  /** Extra width control if the default 100% is wrong. */
  className?: string;
  /** Aria label for the input. */
  'aria-label'?: string;
}

export function NumberStepper(props: NumberStepperProps) {
  const {
    value,
    onChange,
    step = 1,
    min,
    max,
    placeholder,
    disabled = false,
    suffix,
    className,
  } = props;

  // Press-and-hold repeat — same pattern macOS / iOS use. After a
  // 400ms initial delay, the button repeats every 50ms while held.
  const repeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRepeat = useCallback(() => {
    if (repeatTimer.current) clearTimeout(repeatTimer.current);
    if (repeatInterval.current) clearInterval(repeatInterval.current);
    repeatTimer.current = null;
    repeatInterval.current = null;
  }, []);
  useEffect(() => () => stopRepeat(), [stopRepeat]);

  // Latest committed value, readable from inside a long-lived interval
  // closure. Press-and-hold was dead without this: startRepeat's interval
  // captured applyDelta from press time, so every tick recomputed
  // `value_at_press + delta` and the number stuck at ±1 no matter how long
  // you held. Reading through a ref keeps applyDelta stable AND current.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Apply a delta to the current value, clamped to [min, max] and
  // rounded to the precision of `step`. Empty current is treated as
  // min (or 0 if min isn't set) so the first + click does something
  // reasonable.
  const applyDelta = useCallback(
    (delta: number) => {
      const value = valueRef.current;
      const cur =
        value === '' || value == null
          ? min ?? 0
          : Number.parseFloat(value);
      const raw = Number.isFinite(cur) ? cur + delta : delta;
      const clamped =
        min != null && raw < min
          ? min
          : max != null && raw > max
            ? max
            : raw;
      // Match the precision of step so 0.1+0.2 doesn't render as
      // "0.30000000000000004".
      const decimals = decimalPlaces(step);
      onChange(roundTo(clamped, decimals).toString());
    },
    // Deliberately NOT dependent on `value` — it is read from valueRef, which
    // is what makes the repeat interval keep working across renders.
    [onChange, step, min, max],
  );

  const startRepeat = useCallback(
    (delta: number) => {
      applyDelta(delta);
      // Hold: 400ms delay → 50ms cadence
      repeatTimer.current = setTimeout(() => {
        repeatInterval.current = setInterval(() => applyDelta(delta), 50);
      }, 400);
    },
    [applyDelta],
  );

  const onBlur = useCallback(() => {
    // Clamp on blur if min/max set + value is parseable.
    if (value === '') return;
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n)) {
      onChange('');
      return;
    }
    let next = n;
    if (min != null && next < min) next = min;
    if (max != null && next > max) next = max;
    const decimals = decimalPlaces(step);
    const rounded = roundTo(next, decimals);
    if (rounded !== n) onChange(rounded.toString());
  }, [value, onChange, min, max, step]);

  const canDecrement = !disabled && (min == null || numericValue(value, min) > min);
  const canIncrement = !disabled && (max == null || numericValue(value, min) < max);

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        width: '100%',
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <StepperButton
        side="left"
        label="Decrease"
        symbol="−"
        disabled={!canDecrement}
        onPress={() => startRepeat(-step)}
        onRelease={stopRepeat}
      />
      <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
        <input
          type="text"
          inputMode="decimal"
          aria-label={props['aria-label']}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            // Strip anything that isn't digit / decimal-point /
            // leading minus. Allow empty for in-progress edits.
            const cleaned = e.target.value
              .replace(/[^0-9.\-]/g, '')
              // Only one decimal
              .replace(/(\..*)\./g, '$1')
              // Only leading minus
              .replace(/(.)-/g, '$1');
            onChange(cleaned);
          }}
          onBlur={onBlur}
          style={{
            flex: 1,
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: 14,
            padding: suffix ? '6px 36px 6px 10px' : '6px 10px',
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        {suffix && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              color: 'var(--text-tertiary)',
              pointerEvents: 'none',
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      <StepperButton
        side="right"
        label="Increase"
        symbol="+"
        disabled={!canIncrement}
        onPress={() => startRepeat(step)}
        onRelease={stopRepeat}
      />
    </div>
  );
}

// ──────────────────────── sub-components ─────────────────────────────

function StepperButton({
  side,
  label,
  symbol,
  disabled,
  onPress,
  onRelease,
}: {
  side: 'left' | 'right';
  label: string;
  symbol: string;
  disabled: boolean;
  onPress: () => void;
  onRelease: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      // Pointer events cover mouse + touch + pen. Up/leave/cancel
      // all stop the repeat so we never get a stuck increment when
      // the user drags off the button.
      onPointerDown={(e) => {
        e.preventDefault(); // don't steal focus from the input
        if (!disabled) onPress();
      }}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      onPointerCancel={onRelease}
      style={{
        width: 32,
        background: 'transparent',
        border: 'none',
        borderLeft:
          side === 'right' ? '0.5px solid var(--border)' : undefined,
        borderRight:
          side === 'left' ? '0.5px solid var(--border)' : undefined,
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        fontSize: 18,
        lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
        padding: 0,
      }}
    >
      {symbol}
    </button>
  );
}

// ──────────────────────── helpers ────────────────────────────────────

function numericValue(v: string, min?: number): number {
  if (v === '' || v == null) return min ?? 0;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : (min ?? 0);
}

function decimalPlaces(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = n.toString();
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
