'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useMotivationBusy } from '@/lib/motivation-busy';

/**
 * The always-on Shop/Community switch.
 *
 * It lives in the global chrome (the nav on every page, plus the PWA root
 * header) — NOT just the homepage — and it NAVIGATES: Shop → `/`, Community →
 * `/community`. The active tab follows the pathname.
 *
 * ⚠️ HIDDEN ONLY while a motivation is busy (saving/generating). Switching
 * views mid-save would drop the member out of an in-flight action; see
 * lib/motivation-busy.ts.
 */
export function ViewModeToggle({
  full = false,
  size = 'md',
}: {
  full?: boolean;
  /** `sm` is the tighter variant for the installed-PWA shell header. */
  size?: 'md' | 'sm';
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const busy = useMotivationBusy();

  if (busy) return null;

  const community =
    pathname === '/community' || pathname.startsWith('/community/');

  const tabStyle = (active: boolean) => ({
    background: active ? 'var(--red)' : 'transparent',
    color: active ? '#fff' : 'var(--text-tertiary)',
  });
  const tabClass = full
    ? 'gg-press flex-1 rounded-full text-[13px] font-medium py-2'
    : `gg-press rounded-full font-medium ${
        size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]'
      }`;

  return (
    <div
      role="tablist"
      aria-label="Shop or community"
      className={full ? 'flex w-full' : 'inline-flex'}
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 999,
        padding: size === 'sm' && !full ? 2 : 3,
        gap: 2,
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={!community}
        onClick={() => router.push('/')}
        className={tabClass}
        style={tabStyle(!community)}
      >
        Shop
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={community}
        onClick={() => router.push('/community')}
        className={tabClass}
        style={tabStyle(community)}
      >
        Community
      </button>
    </div>
  );
}
