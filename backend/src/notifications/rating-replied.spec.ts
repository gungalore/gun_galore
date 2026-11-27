jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

/**
 * ⚠️ THE BUYER HAD NO WAY TO KNOW THE SELLER HAD REPLIED (operator,
 * 2026-11-27). The reply was public on the seller's page but the person who
 * wrote the review was never told, so a considered response could sit unseen.
 * The inbox row and the email both have to name the seller, the review and the
 * reply.
 */
function makeService() {
  const sent = {
    inbox: [] as Record<string, unknown>[],
    emails: [] as { to: string; subject: string; html: string }[],
  };

  const svc = Object.create(
    NotificationsService.prototype,
  ) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    appUrl: 'https://alloutdoor.co.za',
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    persistByEmail: jest.fn((email: string, opts: Record<string, unknown>) => {
      sent.inbox.push({ email, ...opts });
    }),
    persist: jest.fn(),
    send: jest.fn((to: string, subject: string, html: string) => {
      sent.emails.push({ to, subject, html });
    }),
    email: (content: unknown) => JSON.stringify(content),
  });

  return { svc, sent };
}

describe('ratingReplied', () => {
  it('persists a BUYER inbox row linking to the seller page, quoting the reply', async () => {
    const { svc, sent } = makeService();

    await svc.ratingReplied({
      email: 'buyer@example.co.za',
      name: 'Buyer',
      sellerUsername: 'karoo_kudu',
      stars: 4,
      response: 'Thank you — the rifle was as described and shipped quickly.',
      sellerId: 'seller_1',
    });

    expect(sent.inbox).toHaveLength(1);
    expect(sent.inbox[0]).toMatchObject({
      email: 'buyer@example.co.za',
      category: 'BUYER',
      type: 'rating_reply',
      title: 'Seller replied to your review',
      url: '/sellers/seller_1',
      dismissible: true,
    });
    expect(String(sent.inbox[0].body)).toContain('karoo_kudu');
    expect(String(sent.inbox[0].body)).toContain('4★');
    expect(String(sent.inbox[0].body)).toContain('shipped quickly');
  });

  it('emails the buyer with the seller handle, the review and the reply', async () => {
    const { svc, sent } = makeService();

    await svc.ratingReplied({
      email: 'buyer@example.co.za',
      name: 'Buyer',
      sellerUsername: 'karoo_kudu',
      stars: 5,
      response: 'Glad it arrived safely.',
      sellerId: 'seller_1',
    });

    expect(sent.emails).toHaveLength(1);
    expect(sent.emails[0].to).toBe('buyer@example.co.za');
    expect(sent.emails[0].subject).toContain('karoo_kudu');
    expect(sent.emails[0].html).toContain('karoo_kudu');
    expect(sent.emails[0].html).toContain('Glad it arrived safely.');
    expect(sent.emails[0].html).toContain(
      'https://alloutdoor.co.za/sellers/seller_1',
    );
  });
});
