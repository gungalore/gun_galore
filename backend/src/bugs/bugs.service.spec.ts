import { BadRequestException } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { BugsService } from './bugs.service';

function makeService() {
  const notifications = { bugReport: jest.fn().mockResolvedValue(undefined) };
  const service = new BugsService(
    notifications as unknown as NotificationsService,
  );
  return { service, notifications };
}

describe('BugsService', () => {
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
