import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

export type ActionBoxTone = 'primary' | 'secondary' | 'accent';

export function actionBoxButtonStyle(tone: ActionBoxTone = 'primary'): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: '7px 11px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    border: '1px solid transparent',
  };
  if (tone === 'primary') {
    return { ...base, background: 'var(--red)', color: '#fff' };
  }
  if (tone === 'accent') {
    return {
      ...base,
      background: 'var(--gold-wash)',
      color: 'var(--text-primary)',
      border: '0.5px solid var(--gold)',
    };
  }
  return {
    ...base,
    background: 'var(--bg-inset)',
    color: 'var(--text-primary)',
    border: '0.5px solid var(--border)',
  };
}

/** The explicit action for an ActionBox that navigates. */
export function ActionBoxLink({
  href,
  children,
  tone = 'primary',
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  tone?: ActionBoxTone;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="gg-press"
      style={actionBoxButtonStyle(tone)}
    >
      {children}
    </Link>
  );
}

export default ActionBoxLink;
