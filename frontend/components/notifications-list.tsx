'use client';

// Client-rendered list of notifications for the active category.
//
// Fetches `/api/notifications/me?category=...&status=...` on mount and
// renders an item per row. "Load more" pages via the `before=<createdAt>`
// cursor. Resilient to the backend not being deployed yet — the helper
// in lib/notifications.ts swallows fetch errors and returns [], so the
// shell shows the empty state until the API lands.

import { useEffect, useState, useCallback } from 'react';
import { useAuth, SignInButton } from '@clerk/nextjs';
import {
  fetchFeed,
  dismissNotifications,
  type NotificationCategory,
  type NotificationItem as NItem,
} from '@/lib/notifications';
import { NotificationItem } from '@/components/notification-item';

export function NotificationsList({
  category,
  showResolved,
}: {
  category: NotificationCategory;
  showResolved: boolean;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [items, setItems] = useState<NItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const status = showResolved ? 'resolved' : 'active';

  // Initial load whenever category or status changes.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const data = await fetchFeed(token, category, status);
      if (cancelled) return;
      setItems(data);
      setHasMore(data.length >= 50);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [category, status, isLoaded, isSignedIn, getToken]);

  const handleDismiss = useCallback(
    async (id: string) => {
      // Optimistic: remove from list immediately.
      setItems((prev) => prev.filter((i) => i.id !== id));
      const token = await getToken();
      if (!token) return;
      const ok = await dismissNotifications(token, [id]);
      if (!ok) {
        // Rollback: refetch the list.
        const data = await fetchFeed(token, category, status);
        setItems(data);
      }
      // Tell every badge on screen to re-count, on BOTH paths. The tab
      // pills above this list and the bell badge in the bottom tab bar
      // otherwise keep their old numbers until the next 60s poll — you
      // clear your last alert and still read "Alerts (3)", which is
      // exactly the distrust the never-clears-on-open badge can't afford.
      // The rollback dispatch matters too: a failed dismiss must put the
      // count back rather than leave it optimistically low.
      window.dispatchEvent(new CustomEvent('gg:alerts-changed'));
    },
    [getToken, category, status],
  );

  const handleLoadMore = useCallback(async () => {
    if (items.length === 0) return;
    setLoadingMore(true);
    const token = await getToken();
    if (!token) {
      setLoadingMore(false);
      return;
    }
    const last = items[items.length - 1];
    const more = await fetchFeed(token, category, status, last.createdAt);
    setItems((prev) => [...prev, ...more]);
    setHasMore(more.length >= 50);
    setLoadingMore(false);
  }, [items, getToken, category, status]);

  if (!isLoaded || loading) {
    return (
      <div
        style={{
          padding: '40px 0',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!isSignedIn) {
    // Dead end without a CTA: in the installed app there is no top nav, so
    // the only other way back in is the sign-in pill buried in the More
    // sheet. Modal mode keeps this page mounted, matching that sheet's
    // signed-out pattern.
    return (
      <div
        style={{
          padding: '40px 16px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: 14,
        }}
      >
        <p style={{ margin: 0 }}>Sign in to view your notifications.</p>
        <SignInButton mode="modal">
          <button
            type="button"
            style={{
              marginTop: 14,
              padding: '10px 20px',
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Sign in
          </button>
        </SignInButton>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: '40px 16px',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 14,
        }}
      >
        {showResolved
          ? 'No resolved alerts.'
          : `No active ${category.toLowerCase()} alerts. You're all caught up.`}
      </div>
    );
  }

  return (
    <>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item) => (
          <NotificationItem
            key={item.id}
            item={item}
            onDismiss={handleDismiss}
          />
        ))}
      </ul>
      {hasMore && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              fontSize: 13,
              cursor: loadingMore ? 'wait' : 'pointer',
            }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </>
  );
}
