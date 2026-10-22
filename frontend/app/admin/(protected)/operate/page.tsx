'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionRow,
  EmptyState,
  Icon,
  NeonCard,
  Pill,
  SkeletonRows,
  useAdminToast,
  type AdminTone,
} from '@/components/admin/admin-ui';
import { AdminDrawer } from '@/components/admin/admin-drawer';
import { ReasonDialog } from '@/components/admin/admin-confirm';
import { useAdminSession } from '@/components/admin/admin-session';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminAlertTypes,
  adminAlerts,
  adminComplaint,
  adminComplaints,
  adminFetch,
  adminSupportTicket,
  adminSupportTickets,
  bulkResolveAdminAlerts,
  formatWhen,
  replySupportTicket,
  resolveAdminAlert,
  resolveSupportTicket,
  updateComplaint,
  type AdminAlertRow,
  type AlertTypeFacet,
  type ComplaintRow,
  type ListingRow,
  type ListingVideoRow,
  type Paginated,
  type PostRow,
  type SupportTicketRow,
} from '@/lib/admin-api';

type ReviewTarget =
  | { kind: 'listing'; id: string; action: 'APPROVE' | 'REJECT' }
  | { kind: 'post'; id: string; action: 'APPROVE' | 'REJECT' }
  | { kind: 'video'; id: string; action: 'APPROVE' | 'REJECT' };

/**
 * OPERATE — the human work queues.
 *
 * ⚠️ THE ALERTS INBOX IS THE POINT OF THIS PAGE, NOT AN EXTRA. The Warden board
 * counts unresolved AdminAlert rows and the tab bar badged Operate with them,
 * but this page used to render listings, videos, the feed, and two static
 * paragraphs about complaints and support — so the badge pointed at a screen
 * that could not show, let alone clear, a single alert. Every alert is now
 * resolvable in one click, and bulk-clear exists because one cron pass can
 * raise thirty rows.
 */
export default function OperatePage() {
  const { isGod } = useAdminSession();
  const { toast } = useAdminToast();

  const [listing, setListing] = useState<ListingRow | null>(null);
  const [post, setPost] = useState<PostRow | null>(null);
  const [video, setVideo] = useState<ListingVideoRow | null>(null);
  const [review, setReview] = useState<ReviewTarget | null>(null);

  const listings = useAdminPoll<Paginated<ListingRow>>(
    () =>
      adminFetch<Paginated<ListingRow>>(
        '/admin/listings?status=PENDING_REVIEW&limit=20',
      ),
    30_000,
  );
  const community = useAdminPoll<PostRow[]>(
    () => adminFetch<PostRow[]>('/admin/community/queue'),
    30_000,
  );
  const videos = useAdminPoll<ListingVideoRow[]>(
    () => adminFetch<ListingVideoRow[]>('/admin/listing-videos?limit=20'),
    30_000,
  );

  const listingRows: ListingRow[] =
    (listings.data?.listings as ListingRow[] | undefined) ??
    listings.data?.rows ??
    [];
  const postRows: PostRow[] = Array.isArray(community.data)
    ? community.data
    : ((community.data as unknown as Paginated<PostRow>)?.rows ?? []);
  const videoRows: ListingVideoRow[] = Array.isArray(videos.data)
    ? videos.data
    : [];

  const reviewCopy = useMemo(() => {
    if (!review) return null;
    const noun =
      review.kind === 'listing' ? 'listing' : review.kind === 'post' ? 'post' : 'video';
    return {
      title:
        review.action === 'APPROVE'
          ? `Approve this ${noun}?`
          : `Reject this ${noun}?`,
      body:
        review.kind === 'listing'
          ? 'Approving publishes it and re-indexes it in search. Rejecting notifies the seller with the reason.'
          : review.kind === 'post'
            ? 'Approving publishes it to the community feed. Rejecting hides it from the member.'
            : 'Approving makes the video visible on its live listing. Rejecting removes it and notifies the seller.',
      label: review.action === 'APPROVE' ? 'Approve' : 'Reject',
      danger: review.action === 'REJECT',
    };
  }, [review]);

  async function submitReview(reason: string) {
    if (!review) return;
    if (review.kind === 'listing') {
      await adminFetch(`/admin/listings/${review.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: review.action, reason }),
      });
      listings.refresh();
    } else if (review.kind === 'video') {
      await adminFetch(`/admin/listing-videos/${review.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: review.action, reason }),
      });
      videos.refresh();
    } else {
      await adminFetch(`/admin/community/posts/${review.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: review.action, reason }),
      });
      community.refresh();
    }
    toast(review.action === 'APPROVE' ? 'Approved.' : 'Rejected.');
    setListing(null);
    setPost(null);
    setVideo(null);
  }

  return (
    <>
      <div id="alerts" />
      <AlertsInbox isGod={isGod} />

      <div id="listings" />
      <NeonCard
        tone={listingRows.length > 0 ? 'amber' : undefined}
        title="Marketplace review queue"
        action={
          <Pill tone={listingRows.length > 0 ? 'amber' : 'green'}>
            {listingRows.length} PENDING
          </Pill>
        }
      >
        {listings.loading && !listings.data ? (
          <SkeletonRows rows={3} />
        ) : listings.error ? (
          <EmptyState icon="alert" title="Queue unavailable" caption={listings.error} />
        ) : listingRows.length === 0 ? (
          <EmptyState
            title="No listings waiting"
            caption="Flagged or regulated stock lands here before it goes live."
          />
        ) : (
          listingRows.map((row) => (
            <ActionRow
              key={row.id}
              icon="doc"
              tone="amber"
              title={row.title ?? `Listing ${row.id.slice(0, 8)}`}
              caption={
                <>
                  {row.category?.name ?? 'Uncategorised'}
                  {row.price != null ? ` · R${Math.round(row.price / 100).toLocaleString('en-ZA')}` : ''}
                </>
              }
              trailing={
                <>
                  {row.isFirearm ? <Pill tone="red">FIREARM</Pill> : null}
                  <Pill tone="amber">REVIEW</Pill>
                </>
              }
              onClick={() => setListing(row)}
            />
          ))
        )}
      </NeonCard>

      <NeonCard
        tone={videoRows.length > 0 ? 'amber' : undefined}
        title="Video review queue"
        action={
          <Pill tone={videoRows.length > 0 ? 'amber' : 'green'}>
            {videoRows.length} PENDING
          </Pill>
        }
      >
        {videos.loading && !videos.data ? (
          <SkeletonRows rows={2} />
        ) : videos.error ? (
          <EmptyState icon="alert" title="Video queue unavailable" caption={videos.error} />
        ) : videoRows.length === 0 ? (
          <EmptyState
            title="No videos waiting"
            caption="Clips a seller sent for review appear here; the listing itself can stay live."
          />
        ) : (
          videoRows.map((row) => (
            <ActionRow
              key={row.id}
              icon="eye"
              tone="amber"
              title={row.title}
              caption={`${row.referenceNumber ?? row.listingId.slice(0, 8)} · ${row.seller} · ${row.reasons[0] ?? 'flagged clip'}`}
              trailing={<Pill tone="amber">REVIEW</Pill>}
              onClick={() => setVideo(row)}
            />
          ))
        )}
      </NeonCard>

      <NeonCard
        tone={postRows.length > 0 ? 'purple' : undefined}
        title="Community moderation"
        action={
          <Pill tone={postRows.length > 0 ? 'purple' : 'green'}>
            {postRows.length} FLAGGED
          </Pill>
        }
      >
        {community.loading && !community.data ? (
          <SkeletonRows rows={3} />
        ) : community.error ? (
          <EmptyState icon="alert" title="Feed queue unavailable" caption={community.error} />
        ) : postRows.length === 0 ? (
          <EmptyState title="Feed is clean" caption="Reported and pending posts appear here." />
        ) : (
          postRows.map((row) => (
            <ActionRow
              key={row.id}
              icon="message"
              tone={row.graphicTier === 'EXTREME' ? 'red' : 'purple'}
              title={row.title ?? row.body?.slice(0, 60) ?? `Post ${row.id.slice(0, 8)}`}
              caption={`${row.type ?? 'GENERAL'} · ${row.graphicTier ?? 'NONE'}`}
              trailing={
                <Pill tone={row.graphicTier === 'EXTREME' ? 'red' : 'purple'}>
                  {row.status ?? 'PENDING'}
                </Pill>
              }
              onClick={() => setPost(row)}
            />
          ))
        )}
      </NeonCard>

      <div id="complaints" />
      <ComplaintsCard isGod={isGod} />

      <div id="support" />
      <SupportCard isGod={isGod} />

      {/* Listing drawer */}
      <AdminDrawer
        open={listing !== null}
        onClose={() => setListing(null)}
        title={listing?.title ?? 'Listing'}
        subtitle={listing ? `#${listing.id.slice(0, 10)}` : undefined}
        badge={listing?.isFirearm ? 'FIREARM' : 'REVIEW'}
        badgeTone={listing?.isFirearm ? 'red' : 'amber'}
      >
        <p className="adm-sub" style={{ margin: 0 }}>
          {listing?.description?.slice(0, 320) ??
            'No description on the record for this listing.'}
        </p>
        <div className="adm-grid-2">
          <button
            type="button"
            className="adm-btn"
            data-tone="green"
            disabled={!isGod || !listing}
            onClick={() =>
              listing && setReview({ kind: 'listing', id: listing.id, action: 'APPROVE' })
            }
          >
            Approve listing
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone="red"
            disabled={!isGod || !listing}
            onClick={() =>
              listing && setReview({ kind: 'listing', id: listing.id, action: 'REJECT' })
            }
          >
            Reject
          </button>
        </div>
        {!isGod ? (
          <p className="adm-sub">Read-only admin tier — no review controls.</p>
        ) : null}
      </AdminDrawer>

      {/* Community drawer */}
      <AdminDrawer
        open={post !== null}
        onClose={() => setPost(null)}
        title={post?.title ?? 'Community post'}
        subtitle={post ? `${post.type ?? 'GENERAL'} · ${formatWhen(post.createdAt)}` : undefined}
        badge={post?.graphicTier === 'EXTREME' ? 'GRAPHIC' : post?.status ?? 'PENDING'}
        badgeTone={post?.graphicTier === 'EXTREME' ? 'red' : 'purple'}
      >
        <p className="adm-sub" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {post?.body ?? 'No body on the record.'}
        </p>
        {post?.graphicTier && post.graphicTier !== 'NONE' ? (
          <NeonCard tone="red" title="Graphic tier">
            <p className="adm-sub" style={{ margin: 0 }}>
              Media is blurred for members. Check it before approving.
            </p>
          </NeonCard>
        ) : null}
        <div className="adm-grid-2">
          <button
            type="button"
            className="adm-btn"
            data-tone="green"
            disabled={!isGod || !post}
            onClick={() =>
              post && setReview({ kind: 'post', id: post.id, action: 'APPROVE' })
            }
          >
            Approve post
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone="red"
            disabled={!isGod || !post}
            onClick={() =>
              post && setReview({ kind: 'post', id: post.id, action: 'REJECT' })
            }
          >
            Reject
          </button>
        </div>
      </AdminDrawer>

      {/* Pending video drawer */}
      <AdminDrawer
        open={video !== null}
        onClose={() => setVideo(null)}
        title={video?.title ?? 'Video review'}
        subtitle={
          video
            ? `${video.referenceNumber ?? video.listingId.slice(0, 8)} · ${video.seller} · ${formatWhen(video.createdAt)}`
            : undefined
        }
        badge="VIDEO"
        badgeTone="amber"
      >
        {video ? (
          <video
            src={video.url}
            poster={video.thumbnailUrl}
            controls
            playsInline
            preload="metadata"
            style={{ width: '100%', maxHeight: 340, background: '#000', borderRadius: 6 }}
          />
        ) : null}
        <p className="adm-sub" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {video?.reasons?.join('\n') || 'No moderation reason stored.'}
        </p>
        <div className="adm-grid-2">
          <button
            type="button"
            className="adm-btn"
            data-tone="green"
            disabled={!isGod || !video}
            onClick={() =>
              video && setReview({ kind: 'video', id: video.id, action: 'APPROVE' })
            }
          >
            Approve video
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone="red"
            disabled={!isGod || !video}
            onClick={() =>
              video && setReview({ kind: 'video', id: video.id, action: 'REJECT' })
            }
          >
            Reject
          </button>
        </div>
        {!isGod ? (
          <p className="adm-sub">Read-only admin tier — no review controls.</p>
        ) : null}
      </AdminDrawer>

      {reviewCopy ? (
        <ReasonDialog
          open
          title={reviewCopy.title}
          body={reviewCopy.body}
          confirmLabel={reviewCopy.label}
          danger={reviewCopy.danger}
          minLength={3}
          onClose={() => setReview(null)}
          onConfirm={submitReview}
        />
      ) : null}
    </>
  );
}

/* ── Alerts inbox ──────────────────────────────────────────────────── */

const ALERT_TONE: Record<string, AdminTone> = {
  CRON_STALE: 'red',
  SUPPORT_TICKET_OPENED: 'cyan',
  COMPLAINT_LODGED: 'amber',
  BUYER_DISPUTE_RAISED: 'red',
  STUCK_HELD_FUNDS: 'amber',
  KYC_REVIEW: 'purple',
  KYC_REPEATED_FAILURE: 'amber',
  DEALER_VERIFICATION_NEEDS_REVIEW: 'red',
  DEALER_VERIFICATION_REVIEW_OVERDUE: 'red',
  ADMIN_REFUND_GATEWAY_FAILED: 'red',
  LISTING_REPORTED: 'amber',
  SELLER_REPORTED: 'amber',
};

function toneFor(type: string): AdminTone {
  if (ALERT_TONE[type]) return ALERT_TONE[type];
  if (type.startsWith('SELLER_REJECT')) return 'amber';
  if (type.startsWith('CREDIT')) return 'amber';
  return 'muted';
}

/**
 * Where an alert's subject can actually be worked. Only surfaces that exist —
 * a link to a page that cannot show the row is worse than plain text.
 */
function alertHref(alert: AdminAlertRow): string | undefined {
  const type = alert.type;
  if (type === 'CRON_STALE') return '/admin/warden';
  if (type.startsWith('SUPPORT')) return '#support';
  if (type === 'COMPLAINT_LODGED') return '#complaints';
  if (type.startsWith('KYC')) return '/admin/people?filter=kyc-stalled';
  if (type.includes('DEALER') || type.includes('FUND') || type.includes('DISPUTE') || type.includes('REFUND')) {
    return '/admin/money';
  }
  if (type.startsWith('LISTING') || type.startsWith('SELLER')) {
    return '/admin/operate#listings';
  }
  return undefined;
}

function AlertsInbox({ isGod }: { isGod: boolean }) {
  const { toast } = useAdminToast();
  const [type, setType] = useState<string | null>(null);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const alerts = useAdminPoll<AdminAlertRow[]>(
    () =>
      adminAlerts({
        resolved: false,
        limit: 100,
        ...(type ? { type } : {}),
        ...(urgentOnly ? { urgent: true } : {}),
      }),
    20_000,
    [type, urgentOnly],
  );
  const facets = useAdminPoll<AlertTypeFacet[]>(() => adminAlertTypes(), 60_000);

  const rows = alerts.data ?? [];
  const urgentCount = rows.filter((r) => r.urgent).length;

  async function resolveOne(alert: AdminAlertRow) {
    if (!isGod || busyId) return;
    setBusyId(alert.id);
    try {
      await resolveAdminAlert(alert.id);
      alerts.refresh();
      facets.refresh();
      toast('Alert cleared.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not clear that alert', 'red');
    } finally {
      setBusyId(null);
    }
  }

  async function clearAll() {
    if (!isGod || clearing || rows.length === 0) return;
    setClearing(true);
    try {
      const result = await bulkResolveAdminAlerts(rows.map((r) => r.id));
      alerts.refresh();
      facets.refresh();
      toast(
        result.failed.length > 0
          ? `Cleared ${result.resolved}; ${result.failed.length} failed`
          : `Cleared ${result.resolved} alert${result.resolved === 1 ? '' : 's'}.`,
        result.failed.length > 0 ? 'red' : 'cyan',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not clear the inbox', 'red');
    } finally {
      setClearing(false);
    }
  }

  const facetList = (facets.data ?? []).filter((f) => f.unresolved > 0);

  return (
    <NeonCard
      tone={urgentCount > 0 ? 'red' : rows.length > 0 ? 'amber' : undefined}
      title={
        <>
          <span style={{ color: urgentCount > 0 ? 'var(--adm-red)' : 'var(--adm-cyan)' }}>◆</span>{' '}
          Ops alerts
        </>
      }
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Pill tone={urgentCount > 0 ? 'red' : rows.length > 0 ? 'amber' : 'green'}>
            {rows.length === 0
              ? 'CLEAR'
              : `${rows.length} OPEN${urgentCount > 0 ? ` · ${urgentCount} URGENT` : ''}`}
          </Pill>
          {isGod && rows.length > 0 ? (
            <button
              type="button"
              className="adm-btn"
              data-tone="ghost"
              style={{ padding: '6px 10px', fontSize: 11 }}
              disabled={clearing}
              onClick={() => void clearAll()}
            >
              {clearing ? 'Clearing…' : `Clear all (${rows.length})`}
            </button>
          ) : null}
        </div>
      }
    >
      <p className="adm-sub" style={{ margin: 0 }}>
        Raised by crons, webhooks, payments and members. One press clears a row; a
        cron sweep can raise thirty, so Clear all resolves exactly what is shown.
      </p>

      <div className="adm-scroll-x">
        <button
          type="button"
          className="adm-chip"
          data-active={type === null && !urgentOnly}
          onClick={() => {
            setType(null);
            setUrgentOnly(false);
          }}
        >
          All
        </button>
        <button
          type="button"
          className="adm-chip"
          data-active={urgentOnly}
          onClick={() => setUrgentOnly((v) => !v)}
        >
          Urgent
        </button>
        {facetList.map((facet) => (
          <button
            key={facet.type}
            type="button"
            className="adm-chip"
            data-active={type === facet.type}
            onClick={() => setType((current) => (current === facet.type ? null : facet.type))}
          >
            {facet.type.replace(/_/g, ' ').toLowerCase()} · {facet.unresolved}
          </button>
        ))}
      </div>

      {alerts.loading && !alerts.data ? (
        <SkeletonRows rows={4} />
      ) : alerts.error ? (
        <EmptyState icon="alert" title="Alerts unavailable" caption={alerts.error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={type || urgentOnly ? 'Nothing matches this filter' : 'Inbox is clear'}
          caption={
            type || urgentOnly
              ? 'Clear the filter to see every open alert.'
              : 'New alerts appear the moment a job, payment or member raises one.'
          }
        />
      ) : (
        rows.map((alert) => {
          const tone = alert.urgent ? 'red' : toneFor(alert.type);
          const href = alertHref(alert);
          return (
            <div key={alert.id} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-left">
                <span className="adm-icon" data-tone={tone} style={{ width: 30, height: 30 }}>
                  <Icon name={alert.urgent ? 'alert' : 'flag'} size={14} />
                </span>
                <span className="adm-row-text">
                  <span className="adm-row-title">
                    {alert.type.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  <span className="adm-row-caption" style={{ whiteSpace: 'normal' }}>
                    {alert.context ?? 'No context recorded.'}
                  </span>
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span className="adm-mono" style={{ fontSize: 10.5, color: 'var(--adm-ink-2)' }}>
                  {formatWhen(alert.createdAt)}
                </span>
                {href ? (
                  <a
                    href={href}
                    className="adm-btn"
                    data-tone="ghost"
                    style={{ padding: '6px 10px', fontSize: 11, textDecoration: 'none' }}
                  >
                    Go
                  </a>
                ) : null}
                {isGod ? (
                  <button
                    type="button"
                    className="adm-btn"
                    data-tone="ghost"
                    style={{ padding: '6px 10px', fontSize: 11 }}
                    disabled={busyId === alert.id}
                    onClick={() => void resolveOne(alert)}
                  >
                    {busyId === alert.id ? '…' : 'Clear'}
                  </button>
                ) : null}
              </span>
            </div>
          );
        })
      )}
    </NeonCard>
  );
}

/* ── Complaints ────────────────────────────────────────────────────── */

const COMPLAINT_FILTERS = [
  { id: 'OPEN', label: 'Open' },
  { id: 'UNDER_REVIEW', label: 'Under review' },
  { id: 'AWAITING_USER', label: 'Awaiting member' },
  { id: 'RESOLVED', label: 'Resolved' },
  { id: '', label: 'All' },
];

const COMPLAINT_TONE: Record<string, AdminTone> = {
  OPEN: 'amber',
  UNDER_REVIEW: 'cyan',
  AWAITING_USER: 'purple',
  RESOLVED: 'green',
  CLOSED: 'muted',
};

function ComplaintsCard({ isGod }: { isGod: boolean }) {
  const [status, setStatus] = useState('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useAdminPoll<Paginated<ComplaintRow>>(
    () => adminComplaints(status, 1, 8),
    60_000,
    [status],
  );
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? rows.length;

  return (
    <>
      <NeonCard
        tone={rows.length > 0 && status === 'OPEN' ? 'amber' : undefined}
        title="Complaints register"
        action={<Pill tone={total > 0 ? 'amber' : 'green'}>{total}</Pill>}
      >
        <p className="adm-sub" style={{ margin: 0 }}>
          Statutory register. Cases that froze a payout are marked HELD — work those first.
        </p>
        <div className="adm-scroll-x">
          {COMPLAINT_FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              className="adm-chip"
              data-active={status === f.id}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {list.loading && !list.data ? (
          <SkeletonRows rows={3} />
        ) : list.error ? (
          <EmptyState icon="alert" title="Complaints unavailable" caption={list.error} />
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing in this queue" caption="Change the filter to widen the view." />
        ) : (
          rows.map((row) => (
            <ActionRow
              key={row.id}
              icon="doc"
              tone={COMPLAINT_TONE[row.status] ?? 'muted'}
              title={
                <>
                  {row.subject}{' '}
                  <span className="adm-mono" style={{ color: 'var(--adm-ink-3)', fontSize: 10.5 }}>
                    {row.referenceNumber}
                  </span>
                </>
              }
              caption={`${row.category.replace(/_/g, ' ').toLowerCase()} · @${row.user?.username ?? 'unknown'} · ${formatWhen(row.createdAt)}`}
              trailing={
                <>
                  {row.drovePayoutHold ? <Pill tone="red">HELD</Pill> : null}
                  <Pill tone={COMPLAINT_TONE[row.status] ?? 'muted'}>{row.status}</Pill>
                </>
              }
              onClick={() => setOpenId(row.id)}
            />
          ))
        )}
        {total > 8 ? (
          <p className="adm-sub" style={{ margin: 0 }}>
            Showing the newest 8 of {total}. Narrow the filter to find an older case by
            its CO reference in the search bar.
          </p>
        ) : null}
      </NeonCard>

      {openId ? (
        <ComplaintDrawer
          id={openId}
          isGod={isGod}
          onClose={() => setOpenId(null)}
          onChanged={() => list.refresh()}
        />
      ) : null}
    </>
  );
}

function ComplaintDrawer({
  id,
  isGod,
  onClose,
  onChanged,
}: {
  id: string;
  isGod: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useAdminToast();
  const [row, setRow] = useState<ComplaintRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await adminComplaint(id);
      setRow(detail);
      setOutcome(detail.outcome ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the case');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(next: string, withOutcome = false) {
    if (!isGod || busy) return;
    setBusy(next);
    try {
      await updateComplaint(id, {
        status: next,
        ...(withOutcome && outcome.trim() ? { outcome: outcome.trim() } : {}),
      });
      toast(`Case moved to ${next.replace(/_/g, ' ').toLowerCase()}.`);
      await load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the case', 'red');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminDrawer
      open
      onClose={onClose}
      title={row?.subject ?? 'Complaint'}
      subtitle={row ? `${row.referenceNumber} · ${formatWhen(row.createdAt)}` : id}
      badge={row?.status ?? '…'}
      badgeTone={row ? (COMPLAINT_TONE[row.status] ?? 'muted') : 'muted'}
    >
      {error ? (
        <EmptyState icon="alert" title="Case unavailable" caption={error} />
      ) : !row ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          <div className="adm-card" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="adm-spread">
              <span className="adm-sub">Complainant</span>
              <span className="adm-mono">@{row.user?.username ?? 'unknown'}</span>
            </div>
            <div className="adm-spread">
              <span className="adm-sub">Category</span>
              <span className="adm-mono">{row.category.replace(/_/g, ' ')}</span>
            </div>
            <div className="adm-spread">
              <span className="adm-sub">Payout held</span>
              <Pill tone={row.drovePayoutHold ? 'red' : 'muted'}>
                {row.drovePayoutHold ? 'HELD' : 'NO'}
              </Pill>
            </div>
            {row.transaction ? (
              <div className="adm-spread">
                <span className="adm-sub">Order</span>
                <span className="adm-mono" style={{ fontSize: 11 }}>
                  {row.transaction.listing?.referenceNumber ?? row.transaction.id.slice(0, 10)}
                </span>
              </div>
            ) : null}
          </div>

          <p className="adm-sub" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {row.body}
          </p>

          {(row.photos ?? []).length > 0 ? (
            <div className="adm-label">Evidence</div>
          ) : null}
          {(row.photos ?? []).map((photo) =>
            photo.mediaType === 'VIDEO' ? (
              <video
                key={photo.id}
                src={photo.url}
                poster={photo.thumbnailUrl ?? undefined}
                controls
                playsInline
                style={{ width: '100%', borderRadius: 10, background: '#000' }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={photo.id}
                src={photo.url}
                alt="Complaint evidence"
                style={{ width: '100%', borderRadius: 10, border: '1px solid var(--adm-line)' }}
              />
            ),
          )}

          <div className="adm-label" style={{ color: isGod ? 'var(--adm-cyan)' : 'var(--adm-ink-2)' }}>
            {isGod ? 'Case decision' : 'Read-only admin tier — no controls'}
          </div>
          <textarea
            className="adm-textarea"
            rows={2}
            value={outcome}
            disabled={!isGod || busy !== null}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="Outcome note — sent to the member when the case closes"
          />
          <div className="adm-grid-2">
            <button
              type="button"
              className="adm-btn"
              data-tone="ghost"
              disabled={!isGod || busy !== null || row.status === 'UNDER_REVIEW'}
              onClick={() => void move('UNDER_REVIEW')}
            >
              {busy === 'UNDER_REVIEW' ? 'Working…' : 'Take case'}
            </button>
            <button
              type="button"
              className="adm-btn"
              data-tone="ghost"
              disabled={!isGod || busy !== null || row.status === 'AWAITING_USER'}
              onClick={() => void move('AWAITING_USER', true)}
            >
              {busy === 'AWAITING_USER' ? 'Working…' : 'Ask member'}
            </button>
          </div>
          <button
            type="button"
            className="adm-btn"
            data-tone="green"
            disabled={!isGod || busy !== null || row.status === 'RESOLVED'}
            onClick={() => void move('RESOLVED', true)}
          >
            {busy === 'RESOLVED' ? 'Working…' : 'Resolve case'}
          </button>
        </>
      )}
    </AdminDrawer>
  );
}

/* ── Support ───────────────────────────────────────────────────────── */

const SUPPORT_FILTERS = [
  { id: 'OPEN', label: 'Open' },
  { id: 'AWAITING_USER', label: 'Awaiting member' },
  { id: 'RESOLVED', label: 'Resolved' },
  { id: '', label: 'All' },
];

const SUPPORT_TONE: Record<string, AdminTone> = {
  OPEN: 'amber',
  AWAITING_USER: 'purple',
  RESOLVED: 'green',
  CLOSED: 'muted',
};

function SupportCard({ isGod }: { isGod: boolean }) {
  const [status, setStatus] = useState('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useAdminPoll<Paginated<SupportTicketRow>>(
    () => adminSupportTickets(status, 1, 8),
    60_000,
    [status],
  );
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? rows.length;

  return (
    <>
      <NeonCard
        tone={rows.length > 0 && status === 'OPEN' ? 'amber' : undefined}
        title="Support tickets"
        action={<Pill tone={total > 0 ? 'amber' : 'green'}>{total}</Pill>}
      >
        <p className="adm-sub" style={{ margin: 0 }}>
          Buyer and seller tickets. Replies are emailed and shown in the member&apos;s inbox.
        </p>
        <div className="adm-scroll-x">
          {SUPPORT_FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              className="adm-chip"
              data-active={status === f.id}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {list.loading && !list.data ? (
          <SkeletonRows rows={3} />
        ) : list.error ? (
          <EmptyState icon="alert" title="Support unavailable" caption={list.error} />
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing in this queue" caption="Change the filter to widen the view." />
        ) : (
          rows.map((row) => {
            return (
              <ActionRow
                key={row.id}
                icon="message"
                tone={SUPPORT_TONE[row.status] ?? 'muted'}
                title={row.subject}
                caption={`${row.category} · @${row.user?.username ?? 'unknown'} · ${replyCountLabel(row)} · updated ${formatWhen(row.updatedAt)}`}
                trailing={
                  <Pill tone={SUPPORT_TONE[row.status] ?? 'muted'}>{row.status}</Pill>
                }
                onClick={() => setOpenId(row.id)}
              />
            );
          })
        )}
        {total > 8 ? (
          <p className="adm-sub" style={{ margin: 0 }}>
            Showing the newest 8 of {total}. Narrow the filter, or search the member and
            open their dossier.
          </p>
        ) : null}
      </NeonCard>

      {openId ? (
        <SupportDrawer
          id={openId}
          isGod={isGod}
          onClose={() => setOpenId(null)}
          onChanged={() => list.refresh()}
        />
      ) : null}
    </>
  );
}

function replyCountLabel(row: SupportTicketRow): string {
  const count = row._count?.replies;
  if (typeof count !== 'number') return 'thread';
  return `${count} ${count === 1 ? 'message' : 'messages'}`;
}

function SupportDrawer({
  id,
  isGod,
  onClose,
  onChanged,
}: {
  id: string;
  isGod: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useAdminToast();
  const [row, setRow] = useState<SupportTicketRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'reply' | 'resolve' | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await adminSupportTicket(id);
      setRow(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the ticket');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendReply() {
    const body = draft.trim();
    if (!body || !isGod || busy) return;
    setBusy('reply');
    try {
      const updated = await replySupportTicket(id, body);
      setRow(updated);
      setDraft('');
      toast('Reply sent — waiting on the member.');
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send the reply', 'red');
    } finally {
      setBusy(null);
    }
  }

  async function resolve() {
    if (!isGod || busy) return;
    setBusy('resolve');
    try {
      await resolveSupportTicket(id);
      toast('Ticket resolved.');
      await load();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not resolve the ticket', 'red');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminDrawer
      open
      onClose={onClose}
      title={row?.subject ?? 'Support ticket'}
      subtitle={row ? `${row.category} · @${row.user?.username ?? 'unknown'} · ${formatWhen(row.createdAt)}` : id}
      badge={row?.status ?? '…'}
      badgeTone={row ? (SUPPORT_TONE[row.status] ?? 'muted') : 'muted'}
    >
      {error ? (
        <EmptyState icon="alert" title="Ticket unavailable" caption={error} />
      ) : !row ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          {(row.replies ?? []).map((reply) => (
            <article
              key={reply.id}
              className="adm-msg"
              data-role={reply.fromAdmin ? 'warden' : 'operator'}
            >
              <header className="adm-msg-head">
                <Pill tone={reply.fromAdmin ? 'cyan' : 'green'}>
                  {reply.fromAdmin ? 'SUPPORT' : 'MEMBER'}
                </Pill>
                <span className="adm-mono" style={{ fontSize: 10, color: 'var(--adm-ink-3)' }}>
                  {formatWhen(reply.createdAt)}
                </span>
              </header>
              <p className="adm-msg-body" style={{ whiteSpace: 'pre-wrap' }}>
                {reply.body}
              </p>
            </article>
          ))}

          {isGod ? (
            <>
              <textarea
                className="adm-textarea"
                rows={3}
                value={draft}
                disabled={busy !== null}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Reply to the member — emailed and shown in their inbox"
              />
              <div className="adm-grid-2">
                <button
                  type="button"
                  className="adm-btn"
                  data-tone="green"
                  disabled={busy !== null || row.status === 'RESOLVED'}
                  onClick={() => void resolve()}
                >
                  {busy === 'resolve' ? 'Working…' : 'Resolve'}
                </button>
                <button
                  type="button"
                  className="adm-btn"
                  data-tone="cyan"
                  disabled={busy !== null || draft.trim().length === 0}
                  onClick={() => void sendReply()}
                >
                  {busy === 'reply' ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </>
          ) : (
            <p className="adm-sub" style={{ margin: 0 }}>
              Read-only admin tier — replying and resolving need the Full admin role.
            </p>
          )}
        </>
      )}
    </AdminDrawer>
  );
}
