// BobGoWebhookService -> ShippingService -> PudoService -> SearchService ->
// ESM-only meilisearch.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BobGoWebhookService } from './bobgo-webhook.service';

function makeService(over: { tx?: unknown } = {}) {
  const created: unknown[] = [];
  const prisma = {
    bobGoWebhookEvent: {
      create: jest.fn((args: { data: unknown }) => {
        created.push(args.data);
        return Promise.resolve({});
      }),
    },
    transaction: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.tx === undefined ? { id: 'TX9' } : over.tx),
    },
  };
  const shipping = { applyShippingUpdate: jest.fn().mockResolvedValue('COLLECTED') };
  return {
    svc: new BobGoWebhookService(prisma as never, shipping as never),
    prisma,
    shipping,
    created,
  };
}

// Flush the fire-and-forget record() write.
const settle = () => new Promise((r) => setImmediate(r));

describe('BobGoWebhookService', () => {
  it('handles every topic Bob Go says it can send', async () => {
    // Taken verbatim from the API's own error message when given a bad topic.
    const TOPICS = [
      'fulfillment/created',
      'shipment_submission_status/updated',
      'tracking/updated',
      'shipment_charged_amount/updated',
      'shipment_charged_weight/updated',
      'shipment_health_status/updated',
      'order/updated',
    ];
    const { svc } = makeService();
    for (const t of TOPICS) {
      await expect(svc.handle(t, { id: 16625 })).resolves.toBeDefined();
    }
  });

  it('records an unknown topic instead of dropping it', async () => {
    const { svc, created } = makeService();
    const res = await svc.handle('something/new', { id: 1, mystery: 'value' });
    await settle();
    expect(res.handled).toBe(false);
    expect(created).toHaveLength(1);
  });

  describe('tracking/updated', () => {
    it('accepts a status we have actually observed', async () => {
      const { svc } = makeService();
      const res = await svc.handle('tracking/updated', {
        id: 16625,
        status: 'pending-collection',
      });
      expect(res.handled).toBe(true);
    });

    it('refuses to apply a status it has never seen', async () => {
      // status-map.ts collapses by substring, so an unseen "ready_for_pickup"
      // would otherwise be read as OUT_FOR_DELIVERY and the buyer told their
      // parcel is coming while it sits in a locker. Bob Go's own lifecycle has
      // no ready-for-pickup step for a DOOR shipment, and we have never seen a
      // successful locker booking — so this stays unmapped until we do.
      const { svc } = makeService();
      const res = await svc.handle('tracking/updated', {
        id: 16625,
        status: 'ready_for_pickup',
      });
      expect(res.handled).toBe(false);
    });

    it('accepts the lifecycle Bob Go documents in tracking_steps', async () => {
      // created 1 -> collected 2 -> in-transit 3 -> out-for-delivery 4 ->
      // delivered 5, read straight off a real tracking payload.
      const { svc } = makeService();
      for (const s of ['created', 'collected', 'in-transit', 'out-for-delivery', 'delivered']) {
        const res = await svc.handle('tracking/updated', { id: 'UASSW3HJ', status: s });
        expect(res.handled).toBe(true);
      }
    });

    it('keys a tracking event on the tracking reference, not a numeric id', async () => {
      // On this topic alone, `id` is the tracking reference.
      const { svc, created } = makeService();
      await svc.handle('tracking/updated', { id: 'UASSW3HJ', status: 'pending-collection' });
      await settle();
      expect((created[0] as { shipmentId: string }).shipmentId).toBe('UASSW3HJ');
    });

    it('advances the order through the SHARED update path', async () => {
      // Not a Bob Go-specific shortcut: the poll and both legacy webhooks use
      // applyShippingUpdate too, so all three share one decision about
      // backward transitions, notifications and the delivered/payout gate.
      const { svc, shipping } = makeService();
      await svc.handle('tracking/updated', { id: 'UASSW3HJ', status: 'collected' });
      expect(shipping.applyShippingUpdate).toHaveBeenCalledWith('TX9', 'COLLECTED');
    });

    it('does NOT advance the order on a status it cannot map', async () => {
      const { svc, shipping } = makeService();
      await svc.handle('tracking/updated', { id: 'UASSW3HJ', status: 'expired' });
      expect(shipping.applyShippingUpdate).not.toHaveBeenCalled();
    });

    it('ignores a reference that is not one of ours', async () => {
      const { svc, shipping } = makeService({ tx: null });
      const res = await svc.handle('tracking/updated', {
        id: 'NOTOURS1',
        status: 'delivered',
      });
      expect(res.handled).toBe(false);
      expect(shipping.applyShippingUpdate).not.toHaveBeenCalled();
    });

    it('keeps the raw payload of an unmapped status for review', async () => {
      const { svc, created } = makeService();
      await svc.handle('tracking/updated', { id: 16625, status: 'expired' });
      await settle();
      expect(created).toHaveLength(1);
      expect((created[0] as { shipmentId: string }).shipmentId).toBe('16625');
    });
  });

  describe('shipment_submission_status/updated', () => {
    it('records the answer and identifies the shipment', async () => {
      const { svc, created } = makeService();
      const res = await svc.handle('shipment_submission_status/updated', {
        id: 16625,
        submission_status: 'success',
      });
      await settle();
      expect(res.handled).toBe(true);
      expect((created[0] as { shipmentId: string }).shipmentId).toBe('16625');
    });

    it('does not finish the booking itself', async () => {
      // Completing a booking sends a critical:true SMS that bypasses the
      // seller's mute. That belongs in exactly one place — ShippingService —
      // or a webhook racing the sweep sends it twice.
      const { svc, shipping } = makeService();
      await svc.handle('shipment_submission_status/updated', {
        id: 16625,
        submission_status: 'success',
      });
      await settle();
      expect(shipping.applyShippingUpdate).not.toHaveBeenCalled();
    });

    it('copes with a payload carrying no shipment id', async () => {
      const { svc } = makeService();
      const res = await svc.handle('shipment_submission_status/updated', {
        submission_status: 'success',
      });
      expect(res.handled).toBe(false);
    });
  });

  it('reads the shipment id under any of its spellings', async () => {
    const { svc, created } = makeService();
    await svc.handle('tracking/updated', { shipment_id: 777, status: 'pending-collection' });
    await settle();
    expect((created[0] as { shipmentId: string }).shipmentId).toBe('777');
  });

  it('never throws, whatever arrives', async () => {
    // Bob Go retries on non-2xx; a handler bug must not cause a retry storm.
    const { svc } = makeService();
    await expect(svc.handle('tracking/updated', null as never)).resolves.toEqual({
      handled: false,
    });
    await expect(svc.handle('', {})).resolves.toEqual({ handled: false });
  });

  it('survives the audit write failing', async () => {
    const prisma = {
      bobGoWebhookEvent: {
        create: jest.fn().mockRejectedValue(new Error('db down')),
      },
      transaction: { findFirst: jest.fn().mockResolvedValue({ id: 'TX9' }) },
    };
    const svc = new BobGoWebhookService(prisma as never, {
      applyShippingUpdate: jest.fn(),
    } as never);
    await expect(
      svc.handle('tracking/updated', { id: 1, status: 'pending-collection' }),
    ).resolves.toEqual({ handled: true });
    await settle();
  });
});
