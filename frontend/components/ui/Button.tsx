'use client';

/**
 * Shared button primitive — all primary/secondary/ghost/icon/destructive buttons
 * on the site render through this for visual consistency per DESIGN.md v1.2 §8.
 *
 * Primary: pill, --red bg, white text, 44px height (40px in header), padding 0 22px
 * Hover: --accent-hover, --shadow-red, translateY(-1px) [pointer devices only]
 * Press: scale(0.97) 120ms
 * Loading: keep width, swap label for 16px spinner, disable pointer events
 * Focus-visible: box-shadow: var(--focus-ring)
 * Min touch target: 44x44px
 */

import { forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'rounded-pill h-[44px] px-5 py-2.5 bg-[var(--red)] text-white font-semibold transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--accent-hover)] active:scale-[0.97] focus-visible:[box-shadow:var(--focus-ring)] disabled:opacity-50 disabled:pointer-events-none',
  secondary: 'rounded-pill h-[44px] px-5 py-2.5 bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] font-semibold transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--surface-sunken)] focus-visible:[box-shadow:var(--focus-ring)] disabled:opacity-50 disabled:pointer-events-none',
  ghost: 'rounded-pill h-[40px] px-4 py-1.5 text-[var(--text)] font-semibold transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--surface-sunken)]/80 focus-visible:[box-shadow:var(--focus-ring)] disabled:opacity-50 disabled:pointer-events-none',
  destructive: 'rounded-pill h-[44px] px-5 py-2.5 bg-transparent text-[var(--danger)] border border-[var(--border)] font-semibold transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--danger-bg)] focus-visible:[box-shadow:var(--focus-ring)] disabled:opacity-50 disabled:pointer-events-none',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, children, loading, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={loading || disabled}
      className={`${VARIANTS[variant]} ${className ?? ''}`.trim()}
      {...props}
    >
      {loading ? (
        <>
          <span aria-hidden="true" className="invisible">{children}</span>
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
        </>
      ) : (
        children
      )}
    </button>
  );
});
