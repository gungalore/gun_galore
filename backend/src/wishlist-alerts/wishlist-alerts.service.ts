import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';

// Cap the fan-out per event so a hugely-wishlisted listing can't blow up a
// single request/transaction's tail work. Well above any realistic save count
// for this marketplace; if a listing ever exceeds it, the overflow simply
// isn't alerted (logged), never an error.
const MAX_WISHLISTERS_PER_EVENT = 500;

/**
 * P5.2 — wishlist alerts. Fans out an in-app + push alert to everyone who
 * saved a listing when (a) the seller drops its price, or (b) the item sells.
 * Centralised here so both ListingsService (price drop) and TransactionsService
 * (item sold) share one tested fan-out. Every public method is fail-open and
 * meant to be called fire-and-forget by the caller (never blocks the seller's
 * edit or the buyer's sale).
 */
@Injectable()
export class WishlistAlertsService {
  private readonly logger = new Logger(WishlistAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  private rand(cents: number): string {
    return 'R' + Math.round(cents / 100).toLocaleString('en-ZA');
  }

  /** Wishlisters of a listing, minus a set of excluded user ids (seller/buyer).
   * Cheap — WatchedListing is indexed on listingId. */
  private async watcherIds(
    listingId: string,
    exclude: (string | null | undefined)[],
  ): Promise<string[]> {
    const rows = await this.prisma.watchedListing.findMany({
      where: { listingId },
      select: { userId: true },
      take: MAX_WISHLISTERS_PER_EVENT,
    });
    const ex = new Set(exclude.filter((x): x is string => !!x));
    return rows.map((r) => r.userId).filter((id) => !ex.has(id));
  }

  private async fanOut(
    userIds: string[],
    payload: {
      type: string;
      title: string;
      body: string;
      url: string;
      iconKey: string;
      linkedId: string;
      tag: string;
    },
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        // Informational + swipe-dismissible (so auto-push is skipped), then an
        // explicit push so the user still gets the ping.
        await this.notifications.persist({
          userId,
          category: 'BUYER',
          type: payload.type,
          title: payload.title,
          body: payload.body,
          url: payload.url,
          iconKey: payload.iconKey,
          linkedType: 'listing',
          linkedId: payload.linkedId,
          dismissible: true,
        });
        await this.push
          .sendToUser(userId, 'BUYER', {
            title: payload.title,
            body: payload.body,
            url: payload.url,
            tag: payload.tag,
          })
          .catch(() => {});
      } catch (err) {
        // One bad recipient must not stop the fan-out.
        this.logger.warn(
          `wishlist alert to ${userId} failed: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * A saved listing's price dropped. Alerts every wishlister and stamps
   * priceDropNotifiedAt so the caller's throttle window advances. The caller
   * (ListingsService.update) already checked the throttle + that this is a real
   * decrease on an ACTIVE listing.
   */
  async notifyPriceDrop(
    listing: {
      id: string;
      title: string;
      price: number | null;
      sellerId: string;
    },
    oldPriceCents: number,
  ): Promise<void> {
    const newPrice = listing.price;
    if (newPrice == null || newPrice >= oldPriceCents) return;

    const userIds = await this.watcherIds(listing.id, [listing.sellerId]);
    // Stamp the throttle cursor regardless of whether anyone is watching, so a
    // stream of small drops with no watchers still advances the window.
    await this.prisma.listing
      .update({
        where: { id: listing.id },
        data: { priceDropNotifiedAt: new Date() },
      })
      .catch(() => {});

    if (userIds.length === 0) return;

    const body = `${listing.title} dropped from ${this.rand(
      oldPriceCents,
    )} to ${this.rand(newPrice)}.`;
    await this.fanOut(userIds, {
      type: 'price_dropped',
      title: 'Price drop on a saved item',
      body,
      url: `/listings/${listing.id}`,
      iconKey: 'price',
      linkedId: listing.id,
      tag: `listing:${listing.id}`,
    });
  }

  /**
   * A saved listing sold. Alerts every wishlister (except the seller + the
   * buyer) with a link to similar ACTIVE listings. Re-reads the listing and
   * no-ops unless it is genuinely SOLD — the caller fires this on every paid
   * sale, including a multi-buy sale that did NOT exhaust stock (listing stays
   * ACTIVE), which must not tell wishlisters "it sold". The buyer is resolved
   * from the paying transaction so a buyer who had wishlisted the item they
   * just bought isn't told it "sold".
   */
  async notifyItemSold(listingId: string, txId?: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        status: true,
        sellerId: true,
        make: true,
        categoryId: true,
      },
    });
    if (!listing || listing.status !== 'SOLD') return;

    let buyerId: string | undefined;
    if (txId) {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        select: { buyerId: true },
      });
      buyerId = tx?.buyerId ?? undefined;
    }

    const userIds = await this.watcherIds(listing.id, [
      listing.sellerId,
      buyerId,
    ]);
    if (userIds.length === 0) return;

    // Land the user on a browse pre-filtered to the same category (+ brand) so
    // they immediately see similar ACTIVE stock.
    const params = new URLSearchParams();
    if (listing.categoryId) params.set('categoryId', listing.categoryId);
    if (listing.make) params.set('make', listing.make);
    const qs = params.toString();
    const url = qs ? `/?${qs}` : '/';

    await this.fanOut(userIds, {
      type: 'wishlist_item_sold',
      title: 'A saved item just sold',
      body: `${listing.title} has sold. Tap to see similar listings.`,
      url,
      iconKey: 'sold',
      linkedId: listing.id,
      tag: `listing-sold:${listing.id}`,
    });
  }
}
