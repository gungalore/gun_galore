'use client';

import { useMemo, useState } from 'react';
import {
  ActionRow,
  EmptyState,
  NeonCard,
  Pill,
  SkeletonRows,
  useAdminToast,
} from '@/components/admin/admin-ui';
import { AdminDrawer } from '@/components/admin/admin-drawer';
import { ReasonDialog } from '@/components/admin/admin-confirm';
import { useAdminSession } from '@/components/admin/admin-session';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  formatWhen,
  type ListingRow,
  type ListingVideoRow,
  type Paginated,
  type PostRow,
} from '@/lib/admin-api';

export default function OperatePage() {
  const { isGod } = useAdminSession();
  const { toast } = useAdminToast();

  const [listing, setListing] = useState<ListingRow | null>(null);
  const [post, setPost] = useState<PostRow | null>(null);
  const [video, setVideo] = useState<ListingVideoRow | null>(null);
  const [review, setReview] = useState<
    | { kind: 'listing'; id: string; action: 'APPROVE' | 'REJECT' }
    | { kind: 'post'; id: string; action: 'APPROVE' | 'REJECT' }
    | { kind: 'video'; id: string; action: 'APPROVE' | 'REJECT' }
    | null
  >(null);

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
  const complaints = useAdminPoll<Paginated<Record<string, unknown>>>(
    () => adminFetch<Paginated<Record<string, unknown>>>('/admin/complaints?limit=10'),
    60_000,
  );
  const support = useAdminPoll<Paginated<Record<string, unknown>>>(
    () => adminFetch<Paginated<Record<string, unknown>>>('/admin/support?limit=10'),
    60_000,
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
  const complaintTotal = (complaints.data?.total as number | undefined) ?? 0;
  const supportTotal = (support.data?.total as number | undefined) ?? 0;

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

      <div className="adm-grid-2">
        <NeonCard
          title="Complaints"
          action={
            <Pill tone={complaintTotal > 0 ? 'amber' : 'green'}>
              {complaintTotal}
            </Pill>
          }
        >
          <p className="adm-sub" style={{ margin: 0 }}>
            Statutory register. Three categories hold the seller’s money until
            resolved — handle those first.
          </p>
        </NeonCard>
        <NeonCard
          title="Support"
          action={
            <Pill tone={supportTotal > 0 ? 'amber' : 'green'}>
              {supportTotal}
            </Pill>
          }
        >
          <p className="adm-sub" style={{ margin: 0 }}>
            Buyer and seller tickets. Replies are emailed and shown in the
            member’s inbox.
          </p>
        </NeonCard>
      </div>

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
