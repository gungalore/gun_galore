// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingOrder,
  getPendingOrder,
  setPendingOrder,
  syncPendingOrderListingIds,
} from './pending-order';

// The marker is what makes "Remove" hit the backend instead of a local delete
// after checkout was pressed, and what lets the complete page find the order
// when the gateway does not echo its id. It must never throw on bad storage.
describe('the unpaid order marker', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores the order id and the listing ids it was created with', () => {
    setPendingOrder({ orderId: 'order-1', listingIds: ['l-1', 'l-2'] });
    expect(getPendingOrder()).toEqual({
      orderId: 'order-1',
      listingIds: ['l-1', 'l-2'],
    });
  });

  it('deduplicates listing ids and drops empty ones', () => {
    setPendingOrder({
      orderId: 'order-1',
      listingIds: ['l-1', 'l-1', '', 'l-2'],
    });
    expect(getPendingOrder()?.listingIds).toEqual(['l-1', 'l-2']);
  });

  it('clears the marker on payment success / cancel', () => {
    setPendingOrder({ orderId: 'order-1' });
    clearPendingOrder();
    expect(getPendingOrder()).toBeNull();
  });

  it('refreshes the line snapshot without losing the order id', () => {
    setPendingOrder({ orderId: 'order-1', listingIds: ['l-1', 'l-2'] });
    syncPendingOrderListingIds(['l-1']);
    expect(getPendingOrder()).toEqual({
      orderId: 'order-1',
      listingIds: ['l-1'],
    });
  });

  it('ignores an unsafe stored payload instead of trusting it', () => {
    window.localStorage.setItem('gg:pendingOrder', '{"orderId":""}');
    expect(getPendingOrder()).toBeNull();
    window.localStorage.setItem('gg:pendingOrder', 'not json');
    expect(getPendingOrder()).toBeNull();
    window.localStorage.setItem(
      'gg:pendingOrder',
      '{"orderId":"o","listingIds":[1]}',
    );
    expect(getPendingOrder()).toBeNull();
  });
});
