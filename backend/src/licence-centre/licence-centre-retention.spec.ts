import { LicenceCentreRetentionService } from './licence-centre-retention.service';

// ⚠️ THE TWO THINGS THIS JOB CAN GET WRONG ARE BOTH SILENT.
//
// A POPIA purge that deletes too much looks exactly like one that works, and
// a purge that deletes nothing but stamps a green heartbeat looks like one
// that works too. So the assertions below are mostly about what must NOT be
// deleted: an ACTIVE tracker, and a tracker deactivated inside the window.
//
// The tracker step swallows its own failure on purpose (one POPIA obligation
// must not starve the other), so the fake also proves a throw is contained
// rather than escaping into the sweep.

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

interface DeleteManyArgs {
  where?: Record<string, unknown>;
}

class FakePrisma {
  /** Every deleteMany the service issued, in order. */
  calls: Array<{ model: string; where: Record<string, unknown> }> = [];

  /** Rows the fake pretends exist, keyed by model. */
  rows: Record<string, Array<Record<string, unknown>>> = {
    credential: [],
    trackedApplication: [],
  };

  private matches(
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond && typeof cond === 'object' && 'lt' in (cond as object)) {
        const lt = (cond as { lt: Date }).lt;
        return value instanceof Date && value.getTime() < lt.getTime();
      }
      if (cond === null) return value === null;
      return value === cond;
    });
  }

  private deleteMany(model: string) {
    return async ({ where = {} }: DeleteManyArgs) => {
      this.calls.push({ model, where });
      const before = this.rows[model] ?? [];
      const kept = before.filter((r) => !this.matches(r, where));
      const removed = before.length - kept.length;
      this.rows[model] = kept;
      return { count: removed };
    };
  }

  credential = {
    findMany: async () => this.rows.credential,
    deleteMany: this.deleteMany('credential'),
    update: async () => ({}),
  };

  trackedApplication = {
    deleteMany: this.deleteMany('trackedApplication'),
  };

  setting = {
    upsert: async () => ({}),
  };
}

function build() {
  const prisma = new FakePrisma();
  const files = { remove: async () => undefined };
  const svc = new LicenceCentreRetentionService(
    prisma as never,
    files as never,
    // The identify store, swept alongside the rest — see sweep(). Its own
    // behaviour is covered by document-identify.spec.ts.
    { purgeExpired: jest.fn(async () => 0) } as never,
  );
  return { svc, prisma, files };
}

describe('LicenceCentreRetentionService — tracker retention', () => {
  it('hard-deletes a tracker deactivated beyond the window, events included', async () => {
    const { svc, prisma } = build();
    prisma.rows.trackedApplication = [
      { id: 'old', active: false, updatedAt: daysAgo(400) },
    ];

    await svc.sweep();

    expect(prisma.rows.trackedApplication).toEqual([]);
    // ⚠️ The events table is never named: `onDelete: Cascade` is what takes
    // them, and asserting we deleted them by hand would cement the wrong
    // design if the relation ever changed.
    expect(prisma.calls.map((c) => c.model)).not.toContain(
      'trackedApplicationEvent',
    );
  });

  it('leaves an ACTIVE tracker alone however old it is', async () => {
    const { svc, prisma } = build();
    prisma.rows.trackedApplication = [
      { id: 'live', active: true, updatedAt: daysAgo(4000) },
    ];

    await svc.sweep();

    expect(prisma.rows.trackedApplication).toHaveLength(1);
  });

  it('leaves a tracker deactivated inside the window alone', async () => {
    const { svc, prisma } = build();
    prisma.rows.trackedApplication = [
      { id: 'recent', active: false, updatedAt: daysAgo(30) },
    ];

    await svc.sweep();

    expect(prisma.rows.trackedApplication).toHaveLength(1);
  });

  it('still stamps the heartbeat when the tracker purge throws', async () => {
    const { svc, prisma } = build();
    let heartbeat = false;
    prisma.setting.upsert = async () => {
      heartbeat = true;
      return {};
    };
    prisma.trackedApplication.deleteMany = async () => {
      throw new Error('database is down');
    };

    await svc.sweep();

    expect(heartbeat).toBe(true);
  });
});

describe('LicenceCentreRetentionService — erasure', () => {
  it('takes every tracker the member owns, active ones included', async () => {
    const { svc, prisma } = build();
    prisma.rows.trackedApplication = [
      { id: 'a', userId: 'u1', active: true },
      { id: 'b', userId: 'u1', active: false },
      { id: 'c', userId: 'u2', active: true },
    ];

    const out = await svc.purgeForUser('u1');

    expect(out.trackers).toBe(2);
    expect(prisma.rows.trackedApplication).toEqual([
      { id: 'c', userId: 'u2', active: true },
    ]);
  });

  it('still reports the count when there are no credential rows to purge', async () => {
    const { svc, prisma } = build();
    prisma.rows.trackedApplication = [{ id: 'a', userId: 'u1', active: true }];

    const out = await svc.purgeForUser('u1');

    // The early return for an empty credential list must not skip the trackers
    // or lose their count — a silent zero here reads as "nothing to erase".
    expect(out.trackers).toBe(1);
    expect(out.credentials).toBe(0);
  });

  it('does not throw when a delete fails', async () => {
    const { svc, prisma } = build();
    prisma.trackedApplication.deleteMany = async () => {
      throw new Error('foreign key');
    };

    await expect(svc.purgeForUser('u1')).resolves.toBeDefined();
  });
});
