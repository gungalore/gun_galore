import { FeedAwardReason } from '@prisma/client';
import {
  FEED_AWARD_POINTS,
  FEED_DAILY_CAP,
  FeedAwardsService,
  levelFor,
} from './feed-awards.service';

describe('levelFor', () => {
  it('starts at the lowest rank', () => {
    expect(levelFor(0).name).toBe('Groentjie');
  });
  it('promotes at each boundary', () => {
    expect(levelFor(100).name).toBe('Veldgids');
    expect(levelFor(300).name).toBe('Spoorsnyer');
    expect(levelFor(3000).name).toBe('Legende');
  });
  it('does not promote below a boundary', () => {
    expect(levelFor(99).name).toBe('Groentjie');
    expect(levelFor(299).name).toBe('Veldgids');
  });
});

function build(opts: { enabled?: boolean; todayPoints?: number } = {}) {
  const created: Array<{ data: { reason: FeedAwardReason; points: number } }> =
    [];
  const prisma = {
    feedAward: {
      findMany: async () =>
        opts.todayPoints ? [{ points: opts.todayPoints }] : [],
      create: async (a: { data: { reason: FeedAwardReason; points: number } }) => {
        created.push(a);
        return a;
      },
    },
    userSocialStats: { upsert: async () => ({}) },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  };
  const settings = { get: async () => opts.enabled ?? true };
  const svc = new FeedAwardsService(prisma as never, settings as never);
  return { svc, created };
}

describe('FeedAwardsService.award', () => {
  it('no-ops when awards are disabled', async () => {
    const { svc, created } = build({ enabled: false });
    await svc.award('u1', FeedAwardReason.POST, 'p1');
    expect(created).toHaveLength(0);
  });

  it('grants post points when enabled', async () => {
    const { svc, created } = build();
    await svc.award('u1', FeedAwardReason.POST, 'p1');
    expect(created[0].data).toMatchObject({
      reason: FeedAwardReason.POST,
      points: FEED_AWARD_POINTS.POST,
    });
  });

  it('caps authored points at the daily ceiling', async () => {
    const { svc, created } = build({ todayPoints: FEED_DAILY_CAP - 2 });
    await svc.award('u1', FeedAwardReason.POST, 'p1');
    expect(created[0].data.points).toBe(2);
  });

  it('stops granting authored points once the cap is reached', async () => {
    const { svc, created } = build({ todayPoints: FEED_DAILY_CAP });
    await svc.award('u1', FeedAwardReason.COMMENT, 'c1');
    expect(created).toHaveLength(0);
  });

  it('does not cap likes received (not self-farmable)', async () => {
    const { svc, created } = build({ todayPoints: FEED_DAILY_CAP });
    await svc.award('u1', FeedAwardReason.LIKE_RECEIVED, 'p1');
    expect(created).toHaveLength(1);
  });
});
