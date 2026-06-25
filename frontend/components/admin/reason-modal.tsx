'use client';

import React, { useCallback, useRef, useState } from 'react';

// A branded reason/confirm modal that replaces the raw window.prompt() +
// window.confirm() flows scattered across the admin pages. Used via the
// useReasonModal() hook so a click handler can `await ask({...})` exactly
// like it used to read window.prompt's return — null = cancelled.

export interface ReasonAsk {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Red confirm button + extra "this is permanent" weight. */
  danger?: boolean;
  /** Minimum trimmed length before confirm is enabled. Default 3. */
  minLength?: number;
}

export function useReasonModal() {
  const [ask, setAsk] = useState<ReasonAsk | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const open = useCallback((opts: ReasonAsk) => {
    setValue(opts.defaultValue ?? '');
    setAsk(opts);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((result: string | null) => {
    resolver.current?.(result);
    resolver.current = null;
    setAsk(null);
    setValue('');
  }, []);

  const minLength = ask?.minLength ?? 3;
  const valid = value.trim().length >= minLength;

  const modal = ask ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ask.title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') settle(null);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) settle(null);
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: 20,
        }}
      >
        <p
          className="text-sm font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          {ask.title}
        </p>
        {ask.message && (
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {ask.message}
          </p>
        )}
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={ask.placeholder ?? 'Reason (appears in the audit log)…'}
          rows={3}
          className="w-full mt-3 text-sm"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            borderRadius: 6,
            padding: '8px 12px',
            outline: 'none',
            resize: 'vertical',
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {valid ? '' : `Min ${minLength} characters`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => settle(null)}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{
                background: 'transparent',
                border: '0.5px solid var(--border)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!valid}
              onClick={() => valid && settle(value.trim())}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{
                background: ask.danger ? 'var(--red)' : 'var(--text-primary)',
                color: ask.danger ? '#fff' : 'var(--bg-card)',
                border: 'none',
                cursor: valid ? 'pointer' : 'not-allowed',
                opacity: valid ? 1 : 0.5,
              }}
            >
              {ask.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { ask: open, modal };
}
