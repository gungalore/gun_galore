import { BadRequestException } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { BugsService, motivationIdFromUrl } from './bugs.service';

// The report is only as useful as the context that reaches the inbox.
// Operator, 2026-11-21: "in the report a bug we need the user name so we can go
// into the logs and pin point the exact issue along with their description."
// So these assert the HANDLE and the ACTIVITY TAIL, not just the text.

function makeService(
  opts: {
    user?: { username: string; email: string } | null;
    motivation?: { referenceNumber: string } | null;
    activity?: Array<Record<string, unknown>>;
  } = {},
) {
  const notifications = { bugReport: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    user: { findUnique: jest.fn(async () => opts.user ?? null) },
    motivation: { findFirst: jest.fn(async () => opts.motivation ?? null) },
  };
  const activity = {
    record: jest.fn(async () => undefined),
    forMotivation: jest.fn(async () => opts.activity ?? []),
    forUser: jest.fn(async () => opts.activity ?? []),
  };
  const service = new BugsService(
    notifications as unknown as NotificationsService,
    prisma as never,
    activity as never,
  );
  return { service, notifications, prisma, activity };
}

const MOTIVATION_URL = 'https://alloutdoor.co.za/licence-centre/cmwpa5msw000c7lvn77di56r4/pack';
const TIMELINE = [
  {
    id: 'a1',
    motivationId: 'cmwpa5msw000c7lvn77di56r4',
    motivationRef: 'MO000146',
    action: 'answer_saved',
    detail: { changed: ['firearm_make'] },
    path: null,
    createdAt: new Date('2026-11-21T08:00:00Z'),
  },
];

describe('BugsService', () => {
  it('carries the member handle, email, application and activity tail', async () => {
    const { service, notifications } = makeService({
      user: { username: 'turbosnail', email: 'member@example.co.za' },
      motivation: { referenceNumber: 'MO000146' },
      activity: TIMELINE,
    });

    await service.report({
      userId: 'u1',
      category: 'MOTIVATIONS',
      description: 'The write button did nothing at all.',
      url: MOTIVATION_URL,
    });

    const arg = notifications.bugReport.mock.calls[0][0];
    expect(arg.category).toBe('Motivations');
    // The handle is the lookup key support uses.
    expect(arg.reporterUsername).toBe('turbosnail');
    expect(arg.reporterEmail).toBe('member@example.co.za');
    expect(arg.motivationRef).toBe('MO000146');
    expect(arg.activity).toContain('answer_saved');
    expect(arg.activity).toContain('MO000146');
  });

  it('records the report itself on the application timeline', async () => {
    const { service, activity } = makeService({
      user: { username: 'turbosnail', email: 'member@example.co.za' },
      motivation: { referenceNumber: 'MO000146' },
      activity: TIMELINE,
    });
    await service.report({
      userId: 'u1',
      category: 'MOTIVATIONS',
      description: 'The write button did nothing at all.',
      url: MOTIVATION_URL,
    });
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'bug_reported', motivationRef: 'MO000146' }),
    );
  });

  it('does not read another member’s application', async () => {
    // findFirst is scoped by userId; a foreign id returns nothing, so no
    // activity is read and the report falls back to the member-level tail.
    const { service, notifications, activity } = makeService({
      user: { username: 'turbosnail', email: 'member@example.co.za' },
      motivation: null,
      activity: [],
    });
    await service.report({
      userId: 'u1',
      category: 'MOTIVATIONS',
      description: 'The write button did nothing at all.',
      url: MOTIVATION_URL,
    });
    expect(activity.forMotivation).not.toHaveBeenCalled();
    expect(notifications.bugReport.mock.calls[0][0].motivationRef).toBeNull();
  });

  it('emails the report with a mapped category label', async () => {
    const { service, notifications } = makeService();
    await service.report({
      userId: 'u1',
      category: 'buy_now',
      description: 'The checkout button does nothing at all.',
      url: 'https://alloutdoor.co.za/listings/abc',
    });

    expect(notifications.bugReport).toHaveBeenCalledTimes(1);
    const arg = notifications.bugReport.mock.calls[0][0];
    expect(arg.category).toBe('Buy Now');
    expect(arg.reporterId).toBe('u1');
    expect(arg.url).toBe('https://alloutdoor.co.za/listings/abc');
    expect(arg.screenshot).toBeNull();
  });

  it('drops a non-http page url', async () => {
    const { service, notifications } = makeService();
    await service.report({
      userId: 'u1',
      category: 'OTHER',
      description: 'Something is broken here.',
      url: 'javascript:alert(1)',
    });
    expect(notifications.bugReport.mock.calls[0][0].url).toBeNull();
  });

  it('attaches a screenshot with a derived filename', async () => {
    const { service, notifications } = makeService();
    await service.report({
      userId: 'u1',
      category: 'PAYMENT',
      description: 'Payment failed but I was charged twice.',
      screenshot: { buffer: Buffer.from('x'), mimetype: 'image/png' },
    });

    const arg = notifications.bugReport.mock.calls[0][0];
    expect(arg.screenshot.buffer).toBeInstanceOf(Buffer);
    expect(arg.screenshot.filename).toMatch(/^bug-\d+\.png$/);
  });

  it('rejects an unknown category', async () => {
    const { service, notifications } = makeService();
    await expect(
      service.report({
        userId: 'u1',
        category: 'NOPE',
        description: 'Something is broken here.',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.bugReport).not.toHaveBeenCalled();
  });

  it('rejects a too-short description', async () => {
    const { service } = makeService();
    await expect(
      service.report({ userId: 'u1', category: 'OTHER', description: 'oops' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('motivationIdFromUrl', () => {
  it('finds the application on the sheet, pack and start pages', () => {
    const id = 'cmwpa5msw000c7lvn77di56r4';
    expect(motivationIdFromUrl(`https://x.co.za/licence-centre/${id}`)).toBe(id);
    expect(
      motivationIdFromUrl(`https://x.co.za/licence-centre/${id}/pack?payment=return`),
    ).toBe(id);
    expect(
      motivationIdFromUrl(`https://x.co.za/licence-centre/${id}/interview`),
    ).toBe(id);
  });

  it('ignores everything else', () => {
    expect(motivationIdFromUrl('https://x.co.za/listings/abc')).toBeNull();
    expect(motivationIdFromUrl('https://x.co.za/licence-centre/')).toBeNull();
    expect(motivationIdFromUrl(null)).toBeNull();
  });
});
