jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// The action events must use the SAME signed /a/<token> link and the same
// verbs on email, SMS and in-app. WhatsApp replaces the SMS when eligible, but
// the destination and the action set must not drift between channels.
const ACTION = 'https://alloutdoor.co.za/a/Q2x7Yk9mN4pR8sT2vW6zB';

function makeService() {
  const sent: {
    inbox: Record<string, unknown>[];
    emails: string[];
    sms: string[];
    subjects: string[];
  } = { inbox: [], emails: [], sms: [], subjects: [] };

  const svc = Object.create(
    NotificationsService.prototype,
  ) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    appUrl: 'https://alloutdoor.co.za',
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    persistByEmail: jest.fn(
      (_email: string, opts: Record<string, unknown>) => {
        void _email;
        sent.inbox.push(opts);
      },
    ),
    send: jest.fn((_to: string, subject: string, html: string) => {
      void _to;
      sent.subjects.push(subject);
      sent.emails.push(html);
    }),
    sendSms: jest.fn(
      (_to: string | null, body: string, _ref: string) => {
        void _to;
        void _ref;
        sent.sms.push(body);
      },
    ),
    email: (content: unknown) => JSON.stringify(content),
  });

  return { svc, sent };
}

const LISTING = {
  listingTitle: 'Camping lantern',
  listingId: 'clisting1234567890',
};

describe('action parity — signed links and labels', () => {
  it('offer received: the in-app row, email and SMS all use the action link', async () => {
    const { svc, sent } = makeService();
    await svc.offerReceived({
      sellerEmail: 's@x.co',
      sellerName: 'Seller',
      sellerPhone: '0820000000',
      buyerName: 'buyer',
      listingTitle: LISTING.listingTitle,
      listingId: LISTING.listingId,
      offerAmount: 10000,
      offerId: 'coffer1234567890',
      actionUrl: ACTION,
    });

    expect(sent.inbox[0].url).toBe(ACTION);
    expect(sent.sms[0]).toContain(ACTION);
    expect(sent.sms[0]).toContain('Accept/decline/counter');
    expect(sent.emails[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain('Review offer');
  });

  it('counter received: the same link and Accept/decline verbs', async () => {
    const { svc, sent } = makeService();
    await svc.offerCountered({
      buyerEmail: 'b@x.co',
      buyerName: 'buyer',
      buyerPhone: '0820000000',
      listingTitle: LISTING.listingTitle,
      listingId: LISTING.listingId,
      originalAmount: 9000,
      counterAmount: 10000,
      offerId: 'coffer1234567890',
      actionUrl: ACTION,
    });

    expect(sent.inbox[0].url).toBe(ACTION);
    expect(sent.sms[0]).toContain(ACTION);
    expect(sent.sms[0]).toContain('Accept/decline within 24h');
    expect(sent.emails[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain('Accept or decline');
  });

  it('outbid: Bid again on every channel, with the action link', async () => {
    const { svc, sent } = makeService();
    await svc.bidOutbid(
      'b@x.co',
      LISTING.listingTitle,
      10000,
      '0820000000',
      LISTING.listingId,
      ACTION,
    );

    expect(sent.inbox[0].url).toBe(ACTION);
    expect(sent.sms[0]).toContain(ACTION);
    expect(sent.sms[0]).toContain('Bid again');
    expect(sent.emails[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain('Bid again');
  });

  it('private-arrange seller handover uses the signed handover link', async () => {
    const { svc, sent } = makeService();
    await svc.privateArrangeSellerHandover({
      sellerEmail: 's@x.co',
      sellerName: 'Seller',
      sellerPhone: '0820000000',
      listingTitle: LISTING.listingTitle,
      transactionId: 'ctx1234567890',
      actionUrl: ACTION,
    });

    expect(sent.inbox[0].url).toBe(ACTION);
    expect(sent.sms[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain('Open handover');
  });

  it('private-arrange buyer confirmation uses the signed confirm/dispute link', async () => {
    const { svc, sent } = makeService();
    await svc.privateArrangeDeliveredNotify({
      buyerEmail: 'b@x.co',
      buyerName: 'Buyer',
      buyerPhone: '0820000000',
      listingTitle: LISTING.listingTitle,
      transactionId: 'ctx1234567890',
      actionUrl: ACTION,
    });

    expect(sent.inbox[0].url).toBe(ACTION);
    expect(sent.sms[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain('Confirm receipt or dispute');
  });

  it('private-arrange buyer reminder reuses the signed confirm link', async () => {
    const { svc, sent } = makeService();
    await svc.privateArrangeBuyerReminder({
      buyerEmail: 'b@x.co',
      buyerName: 'Buyer',
      buyerPhone: '0820000000',
      listingTitle: LISTING.listingTitle,
      transactionId: 'ctx1234567890',
      actionUrl: ACTION,
    });

    expect(sent.inbox[0].url).toBe(ACTION);
    expect(sent.sms[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain('Confirm receipt or dispute');
  });

  it('auction won: Pay now / Pay within 24h, with the action link', async () => {
    const { svc, sent } = makeService();
    await svc.auctionWon(
      'b@x.co',
      LISTING.listingTitle,
      10000,
      '0820000000',
      LISTING.listingId,
      ACTION,
    );

    expect(sent.inbox[0].url).toBe(ACTION);
    expect(sent.sms[0]).toContain(ACTION);
    expect(sent.sms[0]).toContain('Pay within 24h');
    expect(sent.emails[0]).toContain(ACTION);
    expect(sent.emails[0]).toContain('Pay now');
  });
});

describe('message notifications', () => {
  it('listing inquiry pushes and deep-links to the exact thread', async () => {
    const { svc, sent } = makeService();
    await svc.listingInquiryMessage({
      recipientEmail: 's@x.co',
      recipientName: 'Seller',
      listingTitle: LISTING.listingTitle,
      inquiryId: 'cinquiry1234567890',
      senderIsBuyer: true,
      preview: 'What material are they made of?',
    });

    expect(sent.inbox[0]).toMatchObject({
      type: 'listing_inquiry_message',
      url: '/messages?inquiry=cinquiry1234567890#inquiries',
      dismissible: true,
      forcePush: true,
    });
    expect(sent.emails[0]).toContain(
      '/messages?inquiry=cinquiry1234567890#inquiries',
    );
  });

  it('transaction message pushes even though the row is dismissible', async () => {
    const { svc, sent } = makeService();
    await svc.newMessage({
      recipientEmail: 'b@x.co',
      recipientName: 'Buyer',
      listingTitle: LISTING.listingTitle,
      transactionId: 'ctx1234567890',
      senderIsBuyer: false,
    });

    expect(sent.inbox[0]).toMatchObject({
      type: 'new_message',
      dismissible: true,
      forcePush: true,
    });
  });
});
