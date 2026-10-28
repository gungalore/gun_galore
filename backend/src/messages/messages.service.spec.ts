// W4 — the buyer↔seller message channel. Locks the moderation contract:
// contact details are AUTO-STRIPPED (message still sends), abuse is BLOCKED.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('../moderation/jev-battery', () => ({
  jevLadder: jest.fn(),
  contactQuestions: () => ({}),
  conductQuestions: () => ({}),
  JEV_CATEGORY_REASONS: {},
}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { jevLadder } from '../moderation/jev-battery';

const jev = jevLadder as unknown as jest.Mock;

function makeService(over: {
  tx?: Record<string, unknown> | null;
  redact?: { text: string; categories: string[] };
} = {}) {
  const prisma = {
    transaction: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          over.tx === undefined
            ? { id: 'TX1', buyerId: 'B', sellerId: 'S', listing: { title: 'Scope' } }
            : over.tx,
        ),
    },
    message: {
      create: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'M1', ...a.data }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ email: 'r@x.co', firstName: 'R' }) },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const contactFilter = {
    redact: jest
      .fn()
      .mockReturnValue(over.redact ?? { text: 'hello there', categories: [] }),
  };
  const notifications = {
    newMessage: jest.fn().mockResolvedValue(undefined),
    resolveByEntity: jest.fn().mockResolvedValue(0),
  };
  const service = new MessagesService(
    prisma as never,
    contactFilter as never,
    {} as never,
    notifications as never,
  );
  return { service, prisma, contactFilter, notifications };
}

describe('MessagesService', () => {
  beforeEach(() => {
    jev.mockResolvedValue({ decision: 'PASS', category: null, reason: null });
  });

  it('rejects a sender who is not the buyer or seller', async () => {
    const { service } = makeService();
    await expect(service.send('TX1', 'X', 'hi')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('auto-strips contact details but still sends the message', async () => {
    const { service, prisma } = makeService({
      redact: { text: 'call [removed] please', categories: ['phone'] },
    });

    const msg = await service.send('TX1', 'B', 'call 0821234567 please');

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'call [removed] please',
          originalContent: 'call 0821234567 please',
          wasModerated: true,
        }),
      }),
    );
    expect((msg as { content: string }).content).toBe('call [removed] please');
    expect(prisma.adminAlert.create).toHaveBeenCalled();
  });

  it('blocks abuse outright (never stores/sends it)', async () => {
    jev.mockResolvedValue({ decision: 'BLOCK', category: 'abuse', reason: 'no' });
    const { service, prisma } = makeService();

    await expect(
      service.send('TX1', 'B', 'you are an idiot'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('sends a clean message unmodified', async () => {
    const { service, prisma } = makeService({
      redact: { text: 'Is the scope still available?', categories: [] },
    });
    await service.send('TX1', 'B', 'Is the scope still available?');
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'Is the scope still available?',
          wasModerated: false,
          originalContent: null,
        }),
      }),
    );
  });

  it('parks a Jev REVIEW for T&S but still sends', async () => {
    jev.mockResolvedValue({ decision: 'REVIEW', category: 'contact_details', reason: null });
    const { service, prisma } = makeService();
    await service.send('TX1', 'B', 'zero eight two one two three');
    expect(prisma.message.create).toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ urgent: true }),
      }),
    );
  });

  it('rejects an empty message', async () => {
    const { service } = makeService();
    await expect(service.send('TX1', 'B', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('clears the new-message alert when the thread is opened', async () => {
    const { service, notifications } = makeService();
    await service.list('TX1', 'B');

    expect(notifications.resolveByEntity).toHaveBeenCalledWith(
      'transaction',
      'TX1',
      { userId: 'B', types: ['new_message'] },
    );
  });

  it('clears the sender alert when replying', async () => {
    const { service, notifications } = makeService();
    await service.send('TX1', 'B', 'hello');

    expect(notifications.resolveByEntity).toHaveBeenCalledWith(
      'transaction',
      'TX1',
      { userId: 'B', types: ['new_message'] },
    );
  });
});
