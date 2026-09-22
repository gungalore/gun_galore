'use client';

/**
 * THE DESK — Community admin.
 *
 * Two jobs, one page:
 *   1. The feed moderation queue — posts held in PENDING_MODERATION (moderation
 *      is fail-closed, so anything the model could not confidently clear sits
 *      here until a human decides).
 *   2. Featured ads — the feed's only promotional surface. Members cannot
 *      advertise, so ads are admin-created.
 *
 * ⚠️ SELF-CONTAINED ON PURPOSE. The Desk's four tabs are fixed and pinned by
 * lib/desk-tabs-routes.spec.ts, so this is reached by URL
 * (/admin/desk/community) and renders inside the Desk layout's session gate
 * and token sheet. It uses deskFetch + the --dk-* tokens directly rather than
 * the kit, so adding it cannot disturb any existing board.
 */

import * as React from 'react';
import Link from 'next/link';
import { deskFetch, describeFailure } from '@/lib/desk-auth';

interface QueuePost {
  id: string;
  type: string;
  title: string | null;
  body: string;
  isOfficial: boolean;
  createdAt: string;
  moderationReason: string | null;
  disputedAt?: string | null;
  disputeNote?: string | null;
  author: { id: string; username: string } | null;
  images: { id: string; url: string }[];
}

interface ReportedAd {
  id: string;
  title: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
  advertiser: string | null;
  ctaUrl: string;
  impressionCount: number;
  clickCount: number;
  sortOrder: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--dk-surface)',
  border: '1px solid var(--dk-line)',
  borderRadius: 10,
  padding: 16,
};

const inputStyle: React.CSSProperties = {
  background: 'var(--dk-ground)',
  color: 'var(--dk-ink)',
  border: '1px solid var(--dk-line)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  width: '100%',
};

const btnStyle: React.CSSProperties = {
  background: 'var(--dk-ink)',
  color: 'var(--dk-ground)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--dk-ink-2)',
  border: '1px solid var(--dk-line)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

export default function CommunityAdminPage() {
  const [queue, setQueue] = React.useState<QueuePost[]>([]);
  const [disputed, setDisputed] = React.useState<QueuePost[]>([]);
  const [ads, setAds] = React.useState<ReportedAd[]>([]);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [adForm, setAdForm] = React.useState({
    title: '',
    body: '',
    ctaUrl: '/',
    ctaLabel: 'Shop now',
    advertiser: 'All Outdoor',
  });

  const load = React.useCallback(async () => {
    setFailure(null);
    try {
      const [q, a, d] = await Promise.all([
        deskFetch<QueuePost[]>('/admin/community/queue?status=PENDING_MODERATION'),
        deskFetch<ReportedAd[]>('/admin/community/ads'),
        deskFetch<QueuePost[]>('/admin/community/disputed'),
      ]);
      setQueue(q);
      setAds(a);
      setDisputed(d);
    } catch (err) {
      setFailure(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, action: 'APPROVE' | 'REJECT') {
    let reason: string | undefined;
    if (action === 'REJECT') {
      reason = window.prompt('Why is this post being rejected?') ?? undefined;
      if (!reason) return;
    }
    setBusy(id);
    try {
      await deskFetch(`/admin/community/posts/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
      });
      await load();
    } catch (err) {
      setFailure(describeFailure(err));
    } finally {
      setBusy(null);
    }
  }

  async function createAd(e: React.FormEvent) {
    e.preventDefault();
    if (!adForm.title.trim()) return;
    setBusy('new-ad');
    try {
      await deskFetch('/admin/community/ads', {
        method: 'POST',
        body: JSON.stringify({
          title: adForm.title.trim(),
          body: adForm.body.trim() || undefined,
          ctaUrl: adForm.ctaUrl.trim() || '/',
          ctaLabel: adForm.ctaLabel.trim() || undefined,
          advertiser: adForm.advertiser.trim() || undefined,
          status: 'ACTIVE',
        }),
      });
      setAdForm({ title: '', body: '', ctaUrl: '/', ctaLabel: 'Shop now', advertiser: 'All Outdoor' });
      await load();
    } catch (err) {
      setFailure(describeFailure(err));
    } finally {
      setBusy(null);
    }
  }

  async function setAdStatus(id: string, status: ReportedAd['status']) {
    setBusy(id);
    try {
      await deskFetch(`/admin/community/ads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setFailure(describeFailure(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAd(id: string) {
    if (!window.confirm('Delete this ad?')) return;
    setBusy(id);
    try {
      await deskFetch(`/admin/community/ads/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setFailure(describeFailure(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--dk-ground)',
        color: 'var(--dk-ink)',
        padding: '24px 16px 120px',
        fontFamily: 'var(--font-desk, system-ui)',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Community</h1>
          <Link href="/admin/desk/health" style={{ color: 'var(--dk-ink-3)', fontSize: 13 }}>
            ← Health
          </Link>
        </div>

        {failure && (
          <div style={{ ...cardStyle, borderColor: 'var(--dk-bad)', color: 'var(--dk-bad)' }}>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{failure}</pre>
          </div>
        )}

        {/* Disputes */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            Disputed ({disputed.length})
          </h2>
          {disputed.length === 0 && (
            <p style={{ color: 'var(--dk-ink-3)', fontSize: 13, margin: 0 }}>
              No disputes.
            </p>
          )}
          {disputed.map((p) => (
            <div key={p.id} style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--dk-ink-3)', marginBottom: 6 }}>
                @{p.author?.username ?? 'unknown'} · disputed{' '}
                {p.disputedAt ? new Date(p.disputedAt).toLocaleString('en-ZA') : ''}
              </div>
              {p.title && (
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--dk-ink-2)', whiteSpace: 'pre-wrap' }}>
                {p.body}
              </div>
              {p.disputeNote && (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--dk-ink-2)',
                    marginTop: 8,
                    borderLeft: '2px solid var(--dk-line-2)',
                    paddingLeft: 8,
                  }}
                >
                  <strong>Author:</strong> {p.disputeNote}
                </div>
              )}
              {p.moderationReason && (
                <div style={{ fontSize: 12, color: 'var(--dk-ink-3)', marginTop: 8 }}>
                  Flagged: {p.moderationReason}
                </div>
              )}
              {p.images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {p.images.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={img.id}
                      src={img.url}
                      alt=""
                      style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }}
                    />
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  style={btnStyle}
                  disabled={busy === p.id}
                  onClick={() => void review(p.id, 'APPROVE')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  style={ghostBtnStyle}
                  disabled={busy === p.id}
                  onClick={() => void review(p.id, 'REJECT')}
                >
                  Keep blocked
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* Moderation queue */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            Awaiting review ({queue.length})
          </h2>
          {queue.length === 0 && (
            <p style={{ color: 'var(--dk-ink-3)', fontSize: 13, margin: 0 }}>Nothing waiting.</p>
          )}
          {queue.map((p) => (
            <div key={p.id} style={cardStyle}>
              <div style={{ fontSize: 12, color: 'var(--dk-ink-3)', marginBottom: 6 }}>
                {p.type} · @{p.author?.username ?? 'unknown'} ·{' '}
                {new Date(p.createdAt).toLocaleString('en-ZA')}
                {p.isOfficial ? ' · OFFICIAL' : ''}
              </div>
              {p.title && (
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--dk-ink-2)', whiteSpace: 'pre-wrap' }}>
                {p.body}
              </div>
              {p.moderationReason && (
                <div style={{ fontSize: 12, color: 'var(--dk-ink-3)', marginTop: 8 }}>
                  Flagged: {p.moderationReason}
                </div>
              )}
              {p.images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {p.images.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={img.id}
                      src={img.url}
                      alt=""
                      style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }}
                    />
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  style={btnStyle}
                  disabled={busy === p.id}
                  onClick={() => void review(p.id, 'APPROVE')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  style={ghostBtnStyle}
                  disabled={busy === p.id}
                  onClick={() => void review(p.id, 'REJECT')}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* Ads */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Featured ads</h2>
          <p style={{ color: 'var(--dk-ink-3)', fontSize: 12, margin: 0 }}>
            Shown in the feed only when <code>feed_ads_enabled</code> is on. Members cannot post
            ads; these are the feed&apos;s only promotional surface.
          </p>

          {ads.map((a) => (
            <div key={a.id} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
                    {a.advertiser ?? '—'} · {a.ctaUrl} · {a.impressionCount} views ·{' '}
                    {a.clickCount} clicks
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: a.status === 'ACTIVE' ? 'var(--dk-ok)' : 'var(--dk-ink-3)',
                  }}
                >
                  {a.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['ACTIVE', 'PAUSED', 'ENDED'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    style={ghostBtnStyle}
                    disabled={busy === a.id || a.status === s}
                    onClick={() => void setAdStatus(a.id, s)}
                  >
                    {s}
                  </button>
                ))}
                <button
                  type="button"
                  style={{ ...ghostBtnStyle, color: 'var(--dk-bad)', borderColor: 'var(--dk-bad)' }}
                  disabled={busy === a.id}
                  onClick={() => void deleteAd(a.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}

          <form onSubmit={createAd} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>New ad (created ACTIVE)</div>
            <input
              style={inputStyle}
              placeholder="Title"
              value={adForm.title}
              onChange={(e) => setAdForm({ ...adForm, title: e.target.value })}
            />
            <textarea
              style={{ ...inputStyle, minHeight: 60 }}
              placeholder="Body (optional)"
              value={adForm.body}
              onChange={(e) => setAdForm({ ...adForm, body: e.target.value })}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                placeholder="Destination (/path or https://…)"
                value={adForm.ctaUrl}
                onChange={(e) => setAdForm({ ...adForm, ctaUrl: e.target.value })}
              />
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 140 }}
                placeholder="CTA label"
                value={adForm.ctaLabel}
                onChange={(e) => setAdForm({ ...adForm, ctaLabel: e.target.value })}
              />
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 140 }}
                placeholder="Advertiser"
                value={adForm.advertiser}
                onChange={(e) => setAdForm({ ...adForm, advertiser: e.target.value })}
              />
            </div>
            <div>
              <button type="submit" style={btnStyle} disabled={busy === 'new-ad'}>
                Create ad
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
