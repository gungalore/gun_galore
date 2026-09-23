'use client';

/**
 * Shared input primitive — consistent form controls per DESIGN.md v1.2 §8.
 * - Height 44px, --radius-sm fill, no border at rest
 * - Focus: fill turns --surface, 1px --accent border, --focus-ring
 * - Labels above fields, 13px/600 weight
 * - Errors below in --danger with icon plus text (never colour alone)
 */

import { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, className, style, ...props },
  ref,
) {
  const hasError = !!error;

  return (
    <div className={className ?? ''} style={{ width: props.fullWidth ? '100%' : undefined }}>
      {label && (
        <label htmlFor={props.id} className="block text-[13px] font-semibold mb-1.5" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        {...props}
        style={{
          height: '44px',
          borderRadius: 'var(--r-sm)',
          backgroundColor: 'var(--surface-sunken)',
          border: hasError ? '1px solid var(--danger)' : 'none',
          padding: '0 14px',
          fontFamily: 'var(--font-body)',
          fontSize: '0.9375rem',
          color: 'var(--text-primary)',
          transition: `border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)`,
          outline: 'none',
          ...style,
        }}
        onFocus={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--surface)';
          e.currentTarget.style.borderColor = hasError ? 'var(--danger)' : 'var(--accent)';
          e.currentTarget.style.boxShadow = 'var(--focus-ring)';
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          if (!hasError) {
            e.currentTarget.style.backgroundColor = 'var(--surface-sunken)';
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.boxShadow = 'none';
          } else {
            e.currentTarget.style.backgroundColor = 'var(--surface-sunken)';
            e.currentTarget.style.borderColor = 'var(--danger)';
            e.currentTarget.style.boxShadow = 'none';
          }
          props.onBlur?.(e);
        }}
      />
      {(hasError || helperText) && (
        <p style={{ fontSize: '0.8125rem', marginTop: '4px', color: hasError ? 'var(--danger)' : 'var(--text-secondary)' }} role={hasError ? 'alert' : undefined}>
          {error ?? helperText}
        </p>
      )}
    </div>
  );
});
