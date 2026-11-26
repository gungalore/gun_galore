import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import {
  PUBLIC_LISTING_SELECT,
} from '../listings/listings.service';
import { PUBLICLY_VISIBLE_STATUSES } from '../listings/listing-visibility';

/**
 * Wishlist (Save-for-later) service.
 *
 * Backs the heart-icon on listing cards + the /wishlist page + the
 * Wishlist tab count badge. Sits on top of the WatchedListing Prisma
 * join model (user ↔ listing, compound-unique).
 *
 * Resilience:
 *   - `add` is upsert-style — idempotent. Adding an already-saved
 *     listing is a no-op (200 OK) so the client doesn't have to
 *     handle a 409 in the optimistic-toggle path.
 *   - `remove` is idempotent. Removing a not-saved listing is a no-op.
 *   - `list` filters out listings the user no longer has access to (
 *     CANCELLED self-listings stay visible; nothing is hidden because
 *     a listing went REMOVED — the /wishlist page renders those rows
 *     greyed-out so the user can see "this was removed by admin" and
 *     clear it themselves).
 */
@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** Resolve the platform user from the identity provider ID — every endpoint
   * needs this, so DRY it out. Throws if the user isn't provisioned
   * yet (very rare — would only hit during a identity-provider webhook race). */
  /**
   * Assert the caller's User row still exists, so a request carrying a valid
   * token for a deleted account gets a clean 404 rather than a foreign-key
   * error further down.
   *
   * This used to translate an identity provider subject into a User.id. There is only one
   * identifier now, so the translation is gone and the existence check is all
   * that remains — which is why it returns nothing and callers no longer
   * rebind the id.
   */
  private async assertUserExists(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('User not found');
  }

  /** Add a listing to the user's wishlist. Returns { added: boolean }
   * so the client knows whether this was a new save (for analytics /
   * the optimistic-toggle correctness check). */
  async add(userId: string, listingId: string): Promise<{ added: boolean }> {
    await this.assertUserExists(userId);

    // Don't let a user save their own listing. It's a wishlist —
    // the seller already owns it; saving it is meaningless and would
    // pollute the heart-state on /my/listings. Backend rejects with
    // 400 so the frontend can show "this is your own listing" copy.
    //
    // ⚠️ STATUS CHECK (2026-11 marketplace audit, CRITICAL): ids are public,
    // so without this any signed-in member could POST any listing id —
    // including DRAFT/PENDING_REVIEW/CANCELLED — then GET /wishlist and read a
    // row the PDP deliberately 404s. Save only what the public catalogue can
    // show, and use the SAME 404 as a missing listing so the endpoint cannot
    // confirm a hidden row exists.
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true },
    });
    if (!listing || !PUBLICLY_VISIBLE_STATUSES.includes(listing.status)) {
      throw new NotFoundException('Listing not found');
    }
    if (listing.sellerId === userId) {
      throw new BadRequestException("You can't save your own listing.");
    }

    // Compound-unique on (userId, listingId) means a duplicate insert
    // collides — use findUnique-then-create to distinguish "new save"
    // from "already saved" cleanly without a try/catch.
    const existing = await this.prisma.watchedListing.findUnique({
      where: { userId_listingId: { userId, listingId } },
      select: { id: true },
    });
    if (existing) return { added: false };
    await this.prisma.watchedListing.create({
      data: { userId, listingId },
    });
    this.activity.record({
      eventType: 'wishlist_add',
      actor: { userId },
      listingId,
    });
    return { added: true };
  }

  /** Remove a listing from the user's wishlist. Idempotent. */
  async remove(
    userId: string,
    listingId: string,
  ): Promise<{ removed: boolean }> {
    await this.assertUserExists(userId);
    const deleted = await this.prisma.watchedListing
      .delete({
        where: { userId_listingId: { userId, listingId } },
      })
      .catch(() => null);
    return { removed: !!deleted };
  }

  /** Lightweight "which listings have I saved" lookup. Returns just
   * the listing IDs so the client can hydrate heart-icon state across
   * a browse grid in one round-trip. Capped at 1000 ids to avoid
   * pathological response sizes — users with that many saves are an
   * extreme edge case we can handle if it ever comes up. */
  async listIds(userId: string): Promise<string[]> {
    await this.assertUserExists(userId);
    const rows = await this.prisma.watchedListing.findMany({
      where: { userId },
      select: { listingId: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return rows.map((r) => r.listingId);
  }

  /** Full saved-listings list with images + seller info — mirrors the
   * /listings endpoint shape so the frontend can reuse ListingCard
   * unchanged. Includes ALL statuses (incl. SOLD / cancelled tombstones) so
   * the /wishlist page can render greyed-out rows for removed listings
   * instead of silently dropping them.
   *
   * ⚠️ IT USED TO `include` THE WHOLE LISTING ROW (2026-11 marketplace audit,
   * CRITICAL). That returned every scalar column — firearm serial numbers,
   * the licence holder's real name, the seller's collection address and
   * coordinates, the hidden reserve/auto-accept thresholds — for any listing
   * a member had saved, defeating the PDP's field allow-list entirely. It now
   * uses the SAME PUBLIC_LISTING_SELECT the public PDP uses, and drops rows
   * whose status can never legitimately be saved. */
  async list(userId: string) {
    await this.assertUserExists(userId);
    const rows = await this.prisma.watchedListing.findMany({
      where: {
        userId,
        listing: { status: { notIn: ['DRAFT', 'PENDING_REVIEW'] } },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        listing: { select: PUBLIC_LISTING_SELECT },
      },
    });
    // Shape: { savedAt, listing } per row — keeps the listing object
    // identical to a /listings/[id] response so the frontend can pass
    // it straight into ListingCard.
    return rows.map((r) => ({
      savedAt: r.createdAt,
      listing: r.listing,
    }));
  }
}
