// Frontend helpers for the in-app Notifications inbox.
//
// Until the backend Drop ships the /notifications/me endpoints, every
// fetch resolves gracefully to an empty result so the UI shell renders
// without errors. Once the backend is live the same helpers populate
// the inbox without any frontend change.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type NotificationCategory = 'BUYER' | 'SELLER' | 'ACCOUNT';

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  url: string | null;
  iconKey: string | null;
  linkedType: 'offer' | 'transaction' | 'bid' | 'listing' | 'raffle' | null;
  linkedId: string | null;
  dismissible: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export interface ActiveCount {
  buyer: number;
  seller: number;
  account: number;
  total: number;
}

// Resilient fetch — silently returns empty results when the backend
// endpoints aren't deployed yet (Drop 1 ships the UI before the
// backend lands). Once the backend exists, these populate normally.

export async function fetchActiveCount(token: string): Promise<ActiveCount> {
  try {
    const r = await fetch(`${API_URL}/notifications/me/active-count`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!r.ok) return { buyer: 0, seller: 0, account: 0, total: 0 };
    return (await r.json()) as ActiveCount;
  } catch {
    return { buyer: 0, seller: 0, account: 0, total: 0 };
  }
}

export async function fetchFeed(
  token: string,
  category: NotificationCategory,
  status: 'active' | 'resolved' = 'active',
  before?: string,
  limit = 50,
): Promise<NotificationItem[]> {
  try {
    const qs = new URLSearchParams({
      category,
      status,
      limit: String(limit),
    });
    if (before) qs.set('before', before);
    const r = await fetch(`${API_URL}/notifications/me?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!r.ok) return [];
    return (await r.json()) as NotificationItem[];
  } catch {
    return [];
  }
}

export async function dismissNotifications(
  token: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    const r = await fetch(`${API_URL}/notifications/me/dismiss`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Lightweight "x ago" formatter for the inbox row timestamps.
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
