import { ListingStatus } from '@prisma/client';

// Statuses whose detail page is visible to the public. DRAFT /
// PENDING_REVIEW / CANCELLED are visible ONLY to the owner; this stops
// anonymous callers probing not-yet-approved or withdrawn listings by id.
// PAYMENT_PENDING is public: a single-item listing sits here while a buyer
// completes checkout and the "sale pending" PDP must still load.
//
// EXPIRED is deliberately NOT here. An expired auction (or a listing delisted
// because the seller's licence lapsed) is dead inventory: the public PDP must
// 404, not stay crawlable. The seller still sees it via the owner branch.
//
// Lives in its own module so a public sub-resource (the listing FAQ) can apply
// the SAME gate as the detail page without importing the whole ListingsService.
export const PUBLICLY_VISIBLE_STATUSES: ListingStatus[] = [
  ListingStatus.ACTIVE,
  ListingStatus.PAYMENT_PENDING,
  ListingStatus.SOLD,
];
