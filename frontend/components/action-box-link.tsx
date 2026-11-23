import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

export type ActionBoxTone = 'primary' | 'secondary' | 'accent';

export function actionBoxButtonStyle(tone: ActionBoxTone = 'primary'): CSSProperties {
  if (tone === 'primary') {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      width: '100%',
      padding: '8px 12px',
      borderRadius: 6,
      background: 'var(--red)',
      color: '#fff',
      fontSize: 13,
      fontWeight: 600,
      textDecoration: 'none',
      border: '1px solid transparent',
    };
  }
  if (tone === 'accent') {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      width: '100%',
      padding: '8px 12px',
      borderRadius: 6,
      background: 'var(--gold-wash)',
      color: 'var(--text-primary)',
      fontSize: 13,
      fontWeight: 600,
      textDecoration: 'none',
      border: '0.5px solid var(--gold)',
    };
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    background: 'var(--bg-inset)',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
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
