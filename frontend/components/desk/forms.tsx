'use client';

/**
 * THE DESK — Toggle, Checkbox, Radio.
 *
 * ⚠️ THE TOGGLE IS THE ONLY FILLED STATE COLOUR THE OPERATOR AIMS AT. An "on"
 * switch is ok-green because on/off is genuinely a state, and because the
 * four settings on the Site board — the WhatsApp kill switch among them —
 * have to read as on or off from across a desk. Everything else that is
 * green on this surface is a tag or a swipe reveal.
 */
import * as React from 'react';
import { IconCheck } from './icons';

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 40,
        height: 24,
        flex: 'none',
        position: 'relative',
        padding: 0,
        borderRadius: 'var(--dk-radius-pill)',
        border: 'none',
        background: checked ? 'var(--dk-ok)' : 'var(--dk-line-2)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 120ms ease-out',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--dk-ground)',
          transition: 'left 120ms ease-out',
        }}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        cursor: 'pointer',
        fontSize: 12.5,
        color: 'var(--dk-ink)',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          background: checked ? 'var(--dk-ink)' : 'transparent',
          border: `1px solid ${checked ? 'var(--dk-ink)' : 'var(--dk-line-2)'}`,
          color: 'var(--dk-ground)',
        }}
      >
        {checked ? <IconCheck size={12} /> : null}
      </span>
      {label}
    </label>
  );
}

/**
 * A radio as a full-width row.
 *
 * ⚠️ THE WHOLE ROW IS THE TARGET, not a 16px circle. This is what the reject
 * dialog is made of, and a mis-click there sends the wrong reason to a
 * seller — and, on the offer-reject flow, a reason that carries a strike.
 */
export function RadioRow({
  checked,
  onChange,
  label,
  sub,
  name,
}: {
  checked: boolean;
  onChange: () => void;
  label: React.ReactNode;
  sub?: React.ReactNode;
  name: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 'var(--dk-radius-control)',
        border: `1px solid ${checked ? 'var(--dk-ink-2)' : 'var(--dk-line-2)'}`,
        background: checked ? 'var(--dk-inset)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 120ms ease-out, border-color 120ms ease-out',
      }}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          flex: 'none',
          marginTop: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          border: `1px solid ${checked ? 'var(--dk-ink-2)' : 'var(--dk-line-2)'}`,
        }}
      >
        {checked ? (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--dk-ink)' }} />
        ) : null}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{label}</span>
        {sub ? <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{sub}</span> : null}
      </span>
    </label>
  );
}
