'use client';

// Floating "Report a bug" control.
//
// ⚠️ VISIBLE SIGNED OUT TOO (operator, 2026-11-24). It used to be a
// signed-in-only desktop control; now anyone can report a problem, and the
// public submission is protected server-side by a honeypot, a minimum fill time
// and a per-IP throttle. The button clears the bottom tab bar and the home
// indicator on phones/PWA (see .gg-bug-fab in globals.css).

import { usePathname } from 'next/navigation';
import { hasShell } from '@/lib/shell-routes';
import { isChromelessRoute } from '@/lib/chromeless-routes';
import { useBugReport } from './bug-report-context';

export function BugReportFab() {
  const pathname = usePathname();
  const { open } = useBugReport();

  // No public chrome on /admin, the statutory witness/consent pages, the auth
  // pages or /offline — a floating report control there would be the only piece
  // of marketplace furniture on a page that deliberately has none.
  if (!hasShell(pathname) || isChromelessRoute(pathname)) return null;

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Report a bug"
      title="Report a bug"
      className="gg-bug-fab gg-press"
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
