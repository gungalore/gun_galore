import { describe, expect, it } from 'vitest';
import {
  notificationActionLabel,
  notificationHref,
  preferredNotificationTab,
  type NotificationItem as N,
} from './notifications';

function item(over: Partial<N> = {}): N {
  return {
    id: 'n1',
    category: 'ACCOUNT',
    type: 'licence_centre_expiry_100',
    title: 'A document in your Document Centre is expiring',
    body: 'Proof of address expires on 2027-01-31 — 100 days away.',
    url: '/documents',
    iconKey: 'kyc',
    linkedType: 'credential',
    linkedId: 'ccred123',
    dismissible: false,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('notificationHref', () => {
  it('opens the credential a reminder was raised for', () => {
    expect(notificationHref(item())).toBe('/documents?doc=ccred123');
  });

  it('keeps a deep link the backend already wrote', () => {
    expect(
      notificationHref(item({ url: '/documents?doc=coriginal' })),
    ).toBe('/documents?doc=coriginal');
  });

  it('lifts a legacy licence-centre link too', () => {
    expect(
      notificationHref(item({ url: '/licence-centre' })),
    ).toBe('/licence-centre?doc=ccred123');
  });

  it('leaves every other notification and page alone', () => {
    expect(
      notificationHref(item({ linkedType: 'post', linkedId: '1', url: '/community/p/1' })),
    ).toBe('/community/p/1');
    expect(notificationHref(item({ linkedType: 'credential', linkedId: null }))).toBe(
      '/documents',
    );
    expect(notificationHref(item({ url: null }))).toBe('#');
  });
});

describe('notificationActionLabel', () => {
  it('names the action instead of saying "Act"', () => {
    expect(notificationActionLabel('offer_received')).toBe('Respond to offer');
    expect(notificationActionLabel('offer_accepted')).toBe('Pay now');
    expect(notificationActionLabel('bid_outbid')).toBe('Bid again');
    expect(notificationActionLabel('new_sale')).toBe('Accept sale');
    expect(notificationActionLabel('private_arrange_delivered')).toBe(
      'Confirm receipt',
    );
  });

  it('falls back to Open for informational types', () => {
    expect(notificationActionLabel('payout_released')).toBe('Open');
  });
});

describe('preferredNotificationTab', () => {
  it('opens the seller tab when that is the only unread', () => {
    expect(
      preferredNotificationTab({
        buyer: 0,
        seller: 1,
        account: 0,
        total: 1,
      }),
    ).toBe('SELLER');
  });

  it('opens the tab with the most unread rows', () => {
    expect(
      preferredNotificationTab({
        buyer: 1,
        seller: 3,
        account: 1,
        total: 5,
      }),
    ).toBe('SELLER');
    expect(
      preferredNotificationTab({
        buyer: 4,
        seller: 3,
        account: 1,
        total: 8,
      }),
    ).toBe('BUYER');
  });

  it('falls back to Buyer when everything is clear', () => {
    expect(
      preferredNotificationTab({
        buyer: 0,
        seller: 0,
        account: 0,
        total: 0,
      }),
    ).toBe('BUYER');
  });
});
