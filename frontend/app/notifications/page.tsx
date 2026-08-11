'use client';

// Notifications inbox — three-tab feed reachable from the bottom tab
// bar's Alerts (bell) button.
//
// Tabs: Buyer / Seller / Account. URL-driven via ?tab=buyer|seller|account.
// Each tab fetches its category's active (unresolved) notifications by
// default; a "Show resolved" toggle flips the list to history.
//
// Per user spec: opening this page or tapping an item does NOT clear
// the notification — only acting on the linked entity (handled
// server-side via auto-resolve) or dismissing an informational item
// (× button on dismissible rows). The bell badge in the bottom tab
// bar polls /notifications/me/active-count every 60s.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import {
  fetchActiveCount,
  type ActiveCount,
  type NotificationCategory,
} from '@/lib/notifications';
import { NotificationsTabs } from '@/components/notifications-tabs';
import { NotificationsList } from '@/components/notifications-list';
import { PageReveal } from '@/components/page-reveal';
import { PushOptInBanner } from '@/components/push-opt-in-banner';

function tabFromParam(raw: string | null): NotificationCategory {
  if (raw === 'seller') return 'SELLER';
  if (raw === 'account') return 'ACCOUNT';
  return 'BUYER';
}

export default function NotificationsPage() {
  const search = useSearchParams();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const current = tabFromParam(search.get('tab'));
  const [activeCount, setActiveCount] = useState<ActiveCount>({
    buyer: 0,
    seller: 0,
    account: 0,
    total: 0,
  });
  const [showResolved, setShowResolved] = useState(false);

  // Pull per-tab counts on mount + whenever the tab changes (so newly
  // dismissed / resolved items decrement the tab badge immediately).
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    const refresh = async () => {
      const token = await getToken();
      if (!token) return;
      const c = await fetchActiveCount(token);
      if (!cancelled) setActiveCount(c);
    };
    void refresh();
    // Dismissing a row inside NotificationsList must decrement the tab badge
    // on THIS render, not on the next tab switch — the counts sit in a
    // sibling component, so the list broadcasts and we re-read.
    const onAlertsChanged = () => void refresh();
    window.addEventListener('gg:alerts-changed', onAlertsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('gg:alerts-changed', onAlertsChanged);
    };
  }, [isLoaded, isSignedIn, getToken, current, showResolved]);

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '20px 14px 40px',
      }}
    >
      <PageReveal variant="slide-up">
      <header
        data-reveal
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: 'var(--text-primary)',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Notifications
        </h1>
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          style={{
            background: 'transparent',
            color: showResolved ? 'var(--text-primary)' : 'var(--text-tertiary)',
            border: '0.5px solid var(--border)',
            padding: '5px 10px',
            borderRadius: 6,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {showResolved ? 'Showing resolved' : 'Show resolved'}
        </button>
      </header>

      <div data-reveal>
        <PushOptInBanner />
        <NotificationsTabs current={current} activeCount={activeCount} />
      </div>

      <div data-reveal>
        <NotificationsList category={current} showResolved={showResolved} />
      </div>
      </PageReveal>
    </main>
  );
}
