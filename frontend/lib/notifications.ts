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
  // Mirrors NotificationLinkedType in
  // backend/src/notifications/notifications.service.ts — keep in sync.
  linkedType:
    | 'offer'
    | 'transaction'
    | 'bid'
    | 'listing'
    | 'bank'
    | 'complaint'
    | 'credential'
    | 'motivation'
    | 'post'
    | 'comment'
    | 'tracked_application'
    | null;
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

/**
 * The tab to open when /notifications is entered without an explicit ?tab.
 *
 * Opening on Buyer by default hid the only alert from a seller (and vice
 * versa). Pick the category with the most unresolved rows; ties prefer the
 * seller perspective because that is where an unanswered buyer message
 * usually lands. With nothing unread, keep the familiar Buyer default.
 */
export function preferredNotificationTab(
  counts: ActiveCount,
): NotificationCategory {
  if (
    counts.seller > 0 &&
    counts.seller >= counts.buyer &&
    counts.seller >= counts.account
  ) {
    return 'SELLER';
  }
  if (counts.buyer > 0 && counts.buyer >= counts.account) return 'BUYER';
  if (counts.account > 0) return 'ACCOUNT';
  return 'BUYER';
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
  beforeId?: string,
  limit = 50,
): Promise<NotificationItem[]> {
  try {
    const qs = new URLSearchParams({
      category,
      status,
      limit: String(limit),
    });
    if (before) {
      qs.set('before', before);
      // Tiebreaker for rows sharing the boundary millisecond — see the
      // backend cursor. Sent only alongside `before`.
      if (beforeId) qs.set('beforeId', beforeId);
    }
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

/**
 * Strip the origin from an absolute link that points at this app.
 *
 * Notifications are written with an absolute URL because email needs one.
 * That URL is baked at send time, so a tunnel or deploy hostname that later
 * dies leaves the in-app row pointing at a dead origin. Notification rows
 * belong to the app, so resolve them against the host the member is already
 * on. Genuinely external links are left untouched.
 */
export function appRelativeUrl(url: string): string {
  if (!url || url.startsWith('/') || url.startsWith('#')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
    const host = parsed.hostname.toLowerCase();
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const appHost =
      host === 'alloutdoor.co.za' ||
      host.endsWith('.alloutdoor.co.za') ||
      host === 'gungalore.co.za' ||
      host.endsWith('.gungalore.co.za') ||
      host === 'trycloudflare.com' ||
      host.endsWith('.trycloudflare.com');
    const sameOrigin =
      typeof window !== 'undefined' && parsed.origin === window.location.origin;
    if (!local && !appHost && !sameOrigin) return url;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/**
 * The page an inbox row opens.
 *
 * ⚠️ A CREDENTIAL REMINDER MUST OPEN THE CREDENTIAL, NOT THE ROOT OF THE CENTRE.
 * The expiry sweep and the confirm-date nudge both set `url: '/documents'` and
 * carry the credential's id in `linkedId`; the Document Centre opens on its
 * first row, so tapping "Act" landed beside the document the reminder was
 * about. The backend now writes `/documents?doc=<id>`, and legacy rows — which
 * are already sitting in members' inboxes — get the same target from the
 * `linkedId` they already carry.
 */
export function notificationHref(item: NotificationItem): string {
  const url = appRelativeUrl(item.url ?? '#');
  if (item.linkedType !== 'credential' || !item.linkedId) return url;

  const [path, query = ''] = url.split('?');
  if (path !== '/documents' && path !== '/licence-centre') return url;

  const params = new URLSearchParams(query);
  if (params.has('doc')) return url;
  params.set('doc', item.linkedId);
  return `${path}?${params.toString()}`;
}

/**
 * The verb on an actionable inbox row. "Act" told the member that something
 * was needed but not what, so the Account hub and the inbox now say what the
 * tap will do.
 */
export function notificationActionLabel(type: string): string {
  switch (type) {
    case 'offer_received':
      return 'Respond to offer';
    case 'offer_accepted':
    case 'offer_pay_reminder':
      return 'Pay now';
    case 'offer_countered':
      return 'Respond to counter';
    case 'bid_outbid':
      return 'Bid again';
    case 'auction_won':
    case 'auction_pay_reminder':
      return 'Pay now';
    case 'new_sale':
    case 'sale_accept_escalated':
      return 'Accept sale';
    case 'private_arrange_payment_held':
      return 'Open sale';
    case 'private_arrange_handover':
      return 'Arrange handover';
    case 'private_arrange_delivered':
    case 'private_arrange_reminder':
      return 'Confirm receipt';
    case 'dispatch_nudge':
    case 'order_dispatched':
      return 'View dispatch';
    default:
      return 'Open';
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
