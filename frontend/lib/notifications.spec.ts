import { describe, expect, it } from 'vitest';
import {
  notificationHref,
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
