// ────────────────────────────────────────────────────────────────────
// THE SELLER'S LISTING ARCHIVE — removed + expired rows, kept for records.
//
// The working /my/listings page is only for listings a seller can still act
// on. Admin take-downs (status CANCELLED with an admin reason) and the 90-day
// stale sweep / ended auctions (status EXPIRED) are moved here so they no
// longer crowd the live cards.
//
// ⚠️ THIS IS A VIEW, NOT A DELETE. The rows stay in the DB for offer/bid/
// audit history; media may already have been retired by the retention sweep
// (mediaPurgedAt / a missing image), which is why every helper treats the
// image as optional.
// ────────────────────────────────────────────────────────────────────

export interface ArchivedListing {
  id: string;
  title: string;
  price: number | null;
  status: string;
  listingType: string;
  condition?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  endedAt?: string | null;
  auctionSettledAt?: string | null;
  archivedAt?: string | null;
  mediaPurgedAt?: string | null;
  adminOverrideReason?: string | null;
  images?: { url: string }[] | null;
  category?: { name: string } | null;
}

const REMOVED_STATUSES = new Set(['CANCELLED', 'EXPIRED']);

/** True when this row belongs in the archive rather than the working list. */
export function isArchivedListing(listing: {
  status?: string | null;
}): boolean {
  return REMOVED_STATUSES.has((listing.status ?? '').toUpperCase());
}

/** The human label for the archive pill. */
export function archiveStatusLabel(status: string | null | undefined): string {
  switch ((status ?? '').toUpperCase()) {
    case 'CANCELLED':
      return 'Removed';
    case 'EXPIRED':
      return 'Expired';
    default:
      return 'Archived';
  }
}

/**
 * Why the listing is in the archive. Admin take-downs carry the reason the
 * seller was emailed; seller cancellations and stale expiries do not carry a
 * free-text reason, so they get plain copy instead.
 */
export function archiveReason(listing: ArchivedListing): string {
  const reason = listing.adminOverrideReason?.trim();
  if (reason) return reason;
  if ((listing.status ?? '').toUpperCase() === 'CANCELLED') {
    return 'You cancelled this listing.';
  }
  return 'This listing expired after 90 days without selling.';
}

/**
 * Only an expired listing can be relisted from the archive. A removed
 * (cancelled) listing has to be re-created deliberately, and sold/money-in-
 * flight rows never enter the archive at all.
 */
export function canRelistFromArchive(listing: {
  status?: string | null;
}): boolean {
  return (listing.status ?? '').toUpperCase() === 'EXPIRED';
}

/** One date for the card: when it left the live catalogue. */
export function archiveDateLabel(listing: ArchivedListing): string | null {
  const raw =
    listing.archivedAt ??
    listing.endedAt ??
    listing.auctionSettledAt ??
    listing.updatedAt ??
    listing.createdAt ??
    null;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Archive entries whose media was retired still render a calm placeholder. */
export function archiveImageUrl(listing: ArchivedListing): string | null {
  return listing.images?.[0]?.url ?? null;
}
