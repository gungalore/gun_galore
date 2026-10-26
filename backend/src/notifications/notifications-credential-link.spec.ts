jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// A credential expiry reminder has to open THE DOCUMENT, not the front page of
// the Document Centre. The Centre opens folded and selects its first row, so
// `/documents` alone put the member beside the thing that needs attention.

function makeService() {
  const sent = {
    inbox: [] as Record<string, unknown>[],
    emails: [] as string[],
    sms: [] as string[],
  };

  const svc = Object.create(
    NotificationsService.prototype,
  ) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    appUrl: 'https://alloutdoor.co.za',
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    persist: jest.fn((opts: Record<string, unknown>) => {
      sent.inbox.push(opts);
    }),
    send: jest.fn((_to: string, _subject: string, html: string) => {
      sent.emails.push(html);
    }),
    sendSms: jest.fn(
      (_to: string | null, body: string, _ref: string) => {
        sent.sms.push(body);
      },
    ),
    email: (content: unknown) => JSON.stringify(content),
  });

  return { svc, sent };
}

const CREDENTIAL = 'ccred1234567890';
const DEEP_LINK = `/documents?doc=${CREDENTIAL}`;

describe('credentialExpiring — lands on the credential', () => {
  it('deep-links the inbox row, the email and the SMS', async () => {
    const { svc, sent } = makeService();

    await svc.credentialExpiring({
      userId: 'user_1',
      phone: '0820000000',
      name: 'Member',
      email: 'member@example.co.za',
      credentialId: CREDENTIAL,
      title: 'Proof of address',
      expiresOn: new Date('2027-01-31T00:00:00.000Z'),
      daysLeft: 100,
      stage: 'T100',
      smsEnabled: true,
      emailEnabled: true,
    });

    expect(sent.inbox[0].url).toBe(DEEP_LINK);
    expect(sent.sms[0]).toContain(`https://alloutdoor.co.za${DEEP_LINK}`);
    expect(sent.emails[0]).toContain(`https://alloutdoor.co.za${DEEP_LINK}`);
  });
});
