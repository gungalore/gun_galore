import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupportService } from './support.service';

function make(opts: { userId?: string; ticketUserId?: string; ticketStatus?: string } = {}) {
  const ticket = {
    id: 'T1',
    userId: opts.ticketUserId ?? 'U1',
    subject: 'Help',
    status: opts.ticketStatus ?? 'OPEN',
    replies: [],
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: opts.userId ?? 'U1' }) },
    supportTicket: {
      create: jest.fn().mockResolvedValue({ ...ticket, replies: [{ id: 'r1' }] }),
      findUnique: jest.fn().mockResolvedValue(ticket),
      update: jest.fn().mockResolvedValue(ticket),
      findMany: jest.fn().mockResolvedValue([]),
    },
    supportTicketReply: { create: jest.fn().mockResolvedValue({}) },
    adminAlert: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const notifications = { persist: jest.fn().mockResolvedValue(undefined) };
  const service = new SupportService(prisma as never, notifications as never);
  return { service, prisma, notifications };
}

describe('SupportService', () => {
  it('creates a ticket + raises an admin alert', async () => {
    const { service, prisma } = make();
    await service.createTicket('clerk', { subject: 'Payment issue', body: 'It failed', category: 'payment' });
    expect(prisma.supportTicket.create).toHaveBeenCalled();
    const data = prisma.supportTicket.create.mock.calls[0][0].data;
    expect(data.category).toBe('payment');
    expect(data.replies.create.fromAdmin).toBe(false);
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'SUPPORT_TICKET_OPENED' }) }),
    );
  });

  it('rejects a too-short subject', async () => {
    const { service } = make();
    await expect(
      service.createTicket('clerk', { subject: 'hi', body: 'long enough body' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('defaults an unknown category to general', async () => {
    const { service, prisma } = make();
    await service.createTicket('clerk', { subject: 'Subject here', body: 'body here', category: 'nonsense' });
    expect(prisma.supportTicket.create.mock.calls[0][0].data.category).toBe('general');
  });

  it('user reply re-opens the ticket', async () => {
    const { service, prisma } = make({ ticketStatus: 'AWAITING_USER' });
    await service.replyAsUser('clerk', 'T1', 'still broken');
    expect(prisma.supportTicketReply.create).toHaveBeenCalled();
    expect(prisma.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'OPEN' } }),
    );
  });

  it('blocks a reply from a non-owner', async () => {
    const { service } = make({ userId: 'U2', ticketUserId: 'U1' });
    await expect(service.replyAsUser('clerk', 'T1', 'hi')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admin reply sets AWAITING_USER + notifies the user', async () => {
    const { service, prisma, notifications } = make();
    await service.replyAsAdmin('admin1', 'T1', 'Looking into it');
    expect(prisma.supportTicketReply.create.mock.calls[0][0].data.fromAdmin).toBe(true);
    expect(prisma.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'AWAITING_USER' } }),
    );
    expect(notifications.persist).toHaveBeenCalled();
  });

  it('resolve marks RESOLVED + clears the alert', async () => {
    const { service, prisma } = make();
    await service.resolve('admin1', 'T1');
    expect(prisma.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RESOLVED' }) }),
    );
    expect(prisma.adminAlert.updateMany).toHaveBeenCalled();
  });
});
