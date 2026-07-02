jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { WishlistAlertsService } from './wishlist-alerts.service';

function makeService(over: {
  watchers?: { userId: string }[];
  listing?: Record<string, unknown> | null;
  buyerId?: string | null;
}) {
  const prisma = {
    watchedListing: {
      findMany: jest.fn().mockResolvedValue(over.watchers ?? []),
    },
    listing: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(over.listing ?? null),
    },
    transaction: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          over.buyerId === undefined ? null : { buyerId: over.buyerId },
        ),
    },
  };
  const notifications = { persist: jest.fn().mockResolvedValue(undefined) };
  const push = { sendToUser: jest.fn().mockResolvedValue(1) };
  const svc = new WishlistAlertsService(
    prisma as never,
    notifications as never,
    push as never,
  );
  return { svc, prisma, notifications, push };
}

describe('WishlistAlertsService', () => {
  describe('notifyPriceDrop', () => {
    it('notifies every wishlister except the seller and stamps the throttle cursor', async () => {
      const { svc, prisma, notifications, push } = makeService({
        watchers: [{ userId: 'w1' }, { userId: 'w2' }, { userId: 'seller' }],
      });
      await svc.notifyPriceDrop(
        { id: 'L1', title: 'Roof rack', price: 9000, sellerId: 'seller' },
        10000,
      );
      // seller excluded → 2 recipients, not 3.
      expect(notifications.persist).toHaveBeenCalledTimes(2);
      expect(push.sendToUser).toHaveBeenCalledTimes(2);
      expect(notifications.persist.mock.calls[0][0]).toMatchObject({
        type: 'price_dropped',
        dismissible: true,
        linkedType: 'listing',
        linkedId: 'L1',
      });
      // Throttle cursor stamped.
      expect(prisma.listing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'L1' },
          data: expect.objectContaining({
            priceDropNotifiedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('no-ops when the new price is not actually lower', async () => {
      const { svc, prisma, notifications } = makeService({
        watchers: [{ userId: 'w1' }],
      });
      await svc.notifyPriceDrop(
        { id: 'L1', title: 'Roof rack', price: 10000, sellerId: 'seller' },
        10000,
      );
      expect(notifications.persist).not.toHaveBeenCalled();
      expect(prisma.listing.update).not.toHaveBeenCalled();
    });
  });

  describe('notifyItemSold', () => {
    it('no-ops when the listing is not actually SOLD (multi-buy sale that kept stock)', async () => {
      const { svc, notifications } = makeService({
        listing: { id: 'L1', status: 'ACTIVE', sellerId: 'seller' },
      });
      await svc.notifyItemSold('L1', 'tx1');
      expect(notifications.persist).not.toHaveBeenCalled();
    });

    it('alerts wishlisters except the seller and the buyer, linking to similar listings', async () => {
      const { svc, notifications } = makeService({
        listing: {
          id: 'L1',
          title: 'Engel fridge',
          status: 'SOLD',
          sellerId: 'seller',
          make: 'Engel',
          categoryId: 'cat1',
        },
        buyerId: 'buyer',
        watchers: [
          { userId: 'buyer' },
          { userId: 'seller' },
          { userId: 'w1' },
        ],
      });
      await svc.notifyItemSold('L1', 'tx1');
      // buyer + seller excluded → only w1.
      expect(notifications.persist).toHaveBeenCalledTimes(1);
      const call = notifications.persist.mock.calls[0][0];
      expect(call).toMatchObject({
        userId: 'w1',
        type: 'wishlist_item_sold',
        linkedId: 'L1',
      });
      // Similar-items link carries the sold item's category + brand.
      expect(call.url).toContain('categoryId=cat1');
      expect(call.url).toContain('make=Engel');
    });
  });
});
