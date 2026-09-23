'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type AdminIconName } from '@/components/admin/admin-ui';
import { useAdminSession } from '@/components/admin/admin-session';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  type AlertCount,
  type AttentionQueue,
} from '@/lib/admin-api';

const TABS: Array<{
  href: string;
  label: string;
  icon: AdminIconName;
  badge?: 'kycStalled' | 'operate';
}> = [
  { href: '/admin/warden', label: 'Warden', icon: 'shield' },
  { href: '/admin/money', label: 'Money', icon: 'wallet' },
  { href: '/admin/people', label: 'People', icon: 'users', badge: 'kycStalled' },
  { href: '/admin/operate', label: 'Operate', icon: 'layers', badge: 'operate' },
  { href: '/admin/insights', label: 'Insights', icon: 'chart' },
];

export function AdminTabBar() {
  const pathname = usePathname();
  // One shared poll for both badges. 60s: the tab bar is chrome, not a board,
  // and a badge that lags half a minute is still a badge that is right.
  const { data } = useAdminPoll<AttentionQueue>(
    () => adminFetch<AttentionQueue>('/admin/command/attention-queue'),
    60_000,
  );
  const { data: alerts } = useAdminPoll<AlertCount>(
    () => adminFetch<AlertCount>('/admin/alerts/count'),
    60_000,
  );

  function badgeFor(tab: (typeof TABS)[number]): number {
    if (tab.badge === 'kycStalled') {
      return (data?.kycStalled ?? 0) + (data?.dealerVerificationsPendingReview ?? 0);
    }
    if (tab.badge === 'operate') {
      return (data?.pendingListings ?? 0) + (alerts?.urgent ?? 0);
    }
    return 0;
  }

  return (
    <nav className="adm-tabbar" aria-label="Admin sections">
      {TABS.map((tab) => {
        const active =
          pathname === tab.href || pathname?.startsWith(`${tab.href}/`) === true;
        const badge = badgeFor(tab);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="adm-tab"
            data-active={active}
            aria-current={active ? 'page' : undefined}
            style={{ textDecoration: 'none' }}
          >
            {badge > 0 ? (
              <span className="adm-tab-badge">{badge > 99 ? '99+' : badge}</span>
            ) : null}
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminHeader() {
  const { admin, isGod, signOut } = useAdminSession();
  const [clock, setClock] = useState('--:--');
  const [countdown, setCountdown] = useState(15);

  useEffect(() => {
    function update() {
      setClock(
        new Date().toLocaleTimeString('en-ZA', {
          timeZone: 'Africa/Johannesburg',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      );
    }
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setCountdown((c) => (c <= 1 ? 15 : c - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="adm-header">
      <div className="adm-brand">
        <span className="adm-brand-badge">
          <Icon name="shield" size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="adm-brand-title">All Outdoor</div>
          <div className="adm-brand-sub">
            WARDEN OS{admin?.email ? ` // ${admin.email.split('@')[0]}` : ''}
          </div>
        </div>
      </div>
      <div className="adm-header-actions">
        <span className="adm-live" title={clock}>
          <span className="adm-dot" />
          POLL {countdown}s
        </span>
        <span className="adm-god" data-role={admin?.role}>
          {isGod ? 'SUPERADMIN' : 'READ-ONLY'}
        </span>
        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          style={{ padding: 9, minWidth: 40 }}
          aria-label="Sign out"
          title="Sign out"
          onClick={() => void signOut()}
        >
          <Icon name="logout" size={16} />
        </button>
      </div>
    </header>
  );
}
