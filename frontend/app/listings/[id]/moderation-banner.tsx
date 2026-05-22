'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';

// Shows only to the seller of the listing — never to buyers.
// Surfaces what Claude decided so the seller knows why their listing is
// pending review, was rejected, or had its description auto-edited.
//
// For REJECTED listings: surfaces an "Edit & resubmit" CTA that
// reopens the edit page pre-filled with the prior data. Editing a
// rejected listing re-runs Claude moderation (backend update path
// already wired). Without this button, sellers had only delete-or-
// recreate as options, losing structured data along the way.
//
// For PENDING_REVIEW listings: notes that editing triggers a fresh
// moderation re-audit, so the seller knows what to expect.
export default function ModerationBanner({
  listingId,
  sellerClerkId,
  status,
  decision,
  reasons,
  autoFixApplied,
}: {
  listingId: string;
  sellerClerkId: string;
  status: string;
  decision:
    | 'APPROVE'
    | 'AUTO_FIX_AND_APPROVE'
    | 'REJECT'
    | 'HUMAN_REVIEW'
    | null;
  reasons: string[];
  autoFixApplied: boolean;
}) {
  const { user, isLoaded } = useUser();
  if (!isLoaded || !user || user.id !== sellerClerkId) return null;

  // Only show a banner for non-active states or auto-fix events.
  const showAutoFix = decision === 'AUTO_FIX_AND_APPROVE' && autoFixApplied;
  const showPending = status === 'PENDING_REVIEW';
  const showRejected = status === 'CANCELLED' && decision === 'REJECT';

  if (!showAutoFix && !showPending && !showRejected) return null;

  let color = 'var(--text-tertiary)';
  let title = '';
  let body = '';
  if (showPending) {
    color = '#f59e0b';
    title = 'Pending review';
    body =
      'Your listing has been flagged for human review and will go live once an admin approves it. Editing it now will trigger a fresh moderation review and pause the current one.';
  } else if (showRejected) {
    color = '#ef4444';
    title = 'Listing rejected';
    body =
      'This listing did not pass our content review. Fix the issues below and resubmit — editing re-runs the moderation check.';
  } else if (showAutoFix) {
    color = '#3b82f6';
    title = 'Description edited';
    body =
      'We removed contact details (phone, email, URLs, social handles) from your description so buyers always use the platform.';
  }

  return (
    <div
      className="mb-5 rounded-[6px] px-4 py-3"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${color}`,
      }}
    >
      <p
        className="text-sm font-medium mb-1"
        style={{ color }}
      >
        {title}
      </p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </p>
      {reasons.length > 0 && (
        <ul
          className="mt-2 text-xs leading-relaxed"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {reasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      )}
      {(showRejected || showPending) && (
        <Link
          href={`/listings/${listingId}/edit`}
          className="inline-block mt-3 text-xs px-3 py-1.5 rounded-[6px]"
          style={{
            background: showRejected ? 'var(--red)' : 'var(--bg-inset)',
            color: showRejected ? '#fff' : 'var(--text-primary)',
            border: showRejected ? 'none' : '0.5px solid var(--border)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          {showRejected ? 'Edit & resubmit →' : 'Edit listing →'}
        </Link>
      )}
    </div>
  );
}
