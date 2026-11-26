// ⚠️ 2026-11 MARKETPLACE audit: POST /shipping/quote, /shipping/delivery-options
// and /shipping/delivery-options/cart are UNAUTHENTICATED proxies that each make
// a PAID third-party Bob Go rate call. The global bucket alone let a script
// burn the carrier's rate limit and our wallet, so each route now carries a
// per-IP 30/min throttle. This test reads the throttler decorator metadata, so
// removing or loosening a limit fails here.
import 'reflect-metadata';
import { ShippingController } from './shipping.controller';

const LIMIT = 'THROTTLER:LIMITdefault';
const TTL = 'THROTTLER:TTLdefault';
const MINUTE = 60_000;

function throttleOf(fn: unknown) {
  return {
    limit: Reflect.getMetadata(LIMIT, fn as object),
    ttl: Reflect.getMetadata(TTL, fn as object),
  };
}

describe('ShippingController — paid public quote routes are throttled', () => {
  const proto = ShippingController.prototype;

  it('POST /shipping/quote — 30/min', () => {
    expect(throttleOf(proto.quote)).toEqual({ limit: 30, ttl: MINUTE });
  });

  it('POST /shipping/delivery-options — 30/min', () => {
    expect(throttleOf(proto.deliveryOptions)).toEqual({ limit: 30, ttl: MINUTE });
  });

  it('POST /shipping/delivery-options/cart — 30/min', () => {
    expect(throttleOf(proto.cartDeliveryOptions)).toEqual({
      limit: 30,
      ttl: MINUTE,
    });
  });
});
