'use client';

// Desktop-only hovering "Report a bug" button. Mobile/PWA gets the same
// action from the bottom tray tab instead, so this hides itself under 768px
// via the .gg-bug-fab rule in globals.css.

import { usePathname } from 'next/navigation';
import { useUser } from '@/lib/auth';
import { hasShell } from '@/lib/shell-routes';
import { isChromelessRoute } from '@/lib/chromeless-routes';
import { useBugReport } from './bug-report-context';

export function BugReportFab() {
  const pathname = usePathname();
  const { isSignedIn } = useUser();
  const { open } = useBugReport();

  if (!isSignedIn) return null;
  if (!hasShell(pathname) || isChromelessRoute(pathname)) return null;

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Report a bug"
      title="Report a bug"
      className="gg-bug-fab fixed items-center gap-2"
      style={{
        right: 20,
        // Clear the connection banner (top) and the install bar (bottom).
        bottom: 24,
        zIndex: 60,
        padding: '9px 14px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        color: 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9 8a3 3 0 0 1 6 0" />
        <rect x="8" y="8" width="8" height="9" rx="4" />
        <path d="M12 8v9M8 11H4M8 15l-3 2M16 11h4M16 15l3 2M8 11l-3-2M16 11l3-2" />
      </svg>
      <span>Report a bug</span>
    </button>
  );
}
