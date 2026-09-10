import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

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

  /** Resolve the platform user from the Clerk ID — every endpoint
   * needs this, so DRY it out. Throws if the user isn't provisioned
   * yet (very rare — would only hit during a Clerk webhook race). */
  /**
   * Assert the caller's User row still exists, so a request carrying a valid
   * token for a deleted account gets a clean 404 rather than a foreign-key
   * error further down.
   *
   * This used to translate a Clerk subject into a User.id. There is only one
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
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
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
   * unchanged. Includes ALL statuses (incl. SOLD / REMOVED) so the
   * /wishlist page can render greyed-out tombstones for removed
   * listings instead of silently dropping them. */
  async list(userId: string) {
    await this.assertUserExists(userId);
    const rows = await this.prisma.watchedListing.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: {
          include: {
            images: { orderBy: { order: 'asc' } },
            category: true,
            seller: {
              select: {
                id: true,
                username: true,
                sellerTier: true,
                averageRating: true,
              },
            },
          },
        },
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
