import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUS,
  orderCanCancel,
  orderCanRemoveLines,
  orderCanResumePayment,
  orderIsPaid,
  orderIsPartiallyFulfilled,
  orderIsUnpaid,
  orderStatusEntry,
} from './order-status';

describe('order status labels', () => {
  it('labels every backend OrderStatus', () => {
    for (const code of [
      'AWAITING_PAYMENT',
      'PAID',
      'PARTIALLY_FULFILLED',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ]) {
      expect(ORDER_STATUS[code]).toBeDefined();
      expect(orderStatusEntry(code).label).not.toBe(code);
    }
  });

  it('names the partial-delivery state for the buyer', () => {
    expect(orderStatusEntry('PARTIALLY_FULFILLED').label).toBe(
      'Partly delivered',
    );
    expect(orderStatusEntry('COMPLETED').label).toBe('Completed');
  });

  it('humanises an unknown status instead of printing an enum', () => {
    expect(orderStatusEntry('SOMETHING_NEW').label).toBe('Something New');
    expect(orderStatusEntry(null).label).toBe('—');
  });
});

describe('order action gates', () => {
  it('separates unpaid from paid', () => {
    expect(orderIsUnpaid('AWAITING_PAYMENT')).toBe(true);
    expect(orderIsUnpaid('PAID')).toBe(false);
    expect(orderIsPaid('PAID')).toBe(true);
    expect(orderIsPaid('PARTIALLY_FULFILLED')).toBe(true);
    expect(orderIsPaid('COMPLETED')).toBe(true);
    expect(orderIsPaid('AWAITING_PAYMENT')).toBe(false);
    expect(orderIsPaid('CANCELLED')).toBe(false);
    expect(orderIsPartiallyFulfilled('PARTIALLY_FULFILLED')).toBe(true);
  });

  it('offers remove/resume/cancel only while unpaid', () => {
    for (const status of ['AWAITING_PAYMENT']) {
      expect(orderCanRemoveLines({ status })).toBe(true);
      expect(orderCanResumePayment({ status })).toBe(true);
      expect(orderCanCancel({ status })).toBe(true);
    }
    for (const status of [
      'PAID',
      'PARTIALLY_FULFILLED',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ]) {
      expect(orderCanRemoveLines({ status })).toBe(false);
      expect(orderCanResumePayment({ status })).toBe(false);
      expect(orderCanCancel({ status })).toBe(false);
    }
  });

  it('lets the backend canRemove flag win over the status fallback', () => {
    expect(
      orderCanRemoveLines({ status: 'AWAITING_PAYMENT', canRemove: false }),
    ).toBe(false);
    expect(orderCanRemoveLines({ status: 'PAID', canRemove: true })).toBe(true);
  });
});
