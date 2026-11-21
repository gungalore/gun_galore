jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { AdminMotivationsController } from './admin.controller';

// The support lookup the bug-report email points at. Three shapes — @handle,
// MO reference, motivation id — and the one that matters most is the last:
// a DELETED application still has its timeline, and that is exactly when
// support needs it.

function build(
  opts: {
    user?: { id: string; username: string } | null;
    motivation?: Record<string, unknown> | null;
    motivations?: Array<Record<string, unknown>>;
  } = {},
) {
  const prisma = {
    user: { findUnique: jest.fn(async () => opts.user ?? null) },
    motivation: {
      findUnique: jest.fn(async () => opts.motivation ?? null),
      findMany: jest.fn(async () => opts.motivations ?? []),
    },
  };
  const activity = {
    forUser: jest.fn(async () => [{ id: 'a1', action: 'answer_saved' }]),
    forMotivation: jest.fn(async () => [{ id: 'a2', action: 'created' }]),
    forReference: jest.fn(async () => [{ id: 'a3', action: 'erased' }]),
  };
  const controller = new AdminMotivationsController(
    prisma as never,
    activity as never,
  );
  return { controller, prisma, activity };
}

describe('AdminMotivationsController', () => {
  it('finds a member by @handle and lists their applications', async () => {
    const { controller, activity } = build({
      user: { id: 'u1', username: 'turbosnail' },
      motivations: [
        { id: 'mo1', referenceNumber: 'MO000146', status: 'DRAFT' },
      ],
    });
    const res = await controller.timeline('@turbosnail');

    expect(res.found).toBe(true);
    expect(res.member).toBe('turbosnail');
    expect(res.motivations).toHaveLength(1);
    expect(activity.forUser).toHaveBeenCalledWith('u1', 300);
  });

  it('finds an application by MO reference', async () => {
    const { controller, activity } = build({
      motivation: {
        id: 'mo1',
        referenceNumber: 'MO000146',
        status: 'COMPLETED',
        user: { username: 'turbosnail' },
      },
    });
    const res = await controller.timeline(undefined, 'mo000146');
    expect(res.member).toBe('turbosnail');
    expect(activity.forMotivation).toHaveBeenCalledWith('mo1', 300);
  });

  it('still answers from the trail after the application is erased', async () => {
    // motivation.findUnique returns null: the row is gone, the reference is
    // all that is left, and the activity rows survive by design.
    const { controller, activity } = build({ motivation: null });
    const res = await controller.timeline(undefined, 'MO000146');
    expect(res.found).toBe(false);
    expect(activity.forReference).toHaveBeenCalledWith('MO000146', 300);
    expect(res.activity).toHaveLength(1);
  });

  it('reports an unknown handle rather than throwing', async () => {
    const { controller } = build({ user: null });
    await expect(controller.timeline('ghost')).resolves.toEqual({
      found: false,
      member: null,
      motivations: [],
      activity: [],
    });
  });

  it('refuses an empty lookup', async () => {
    const { controller } = build();
    await expect(controller.timeline()).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
