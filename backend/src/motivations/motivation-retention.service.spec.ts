import { MotivationRetentionService } from './motivation-retention.service';

// Every failure mode here is SILENT. A purge that deletes nothing looks exactly
// like a purge with nothing to do, and both log the same cheerful nothing — so
// the tests have to assert on what it actually touched, never on whether it
// threw.

type Upload = {
  id: string;
  storageKey: string | null;
  motivationId: string;
};

function build(opts: { pages?: Upload[][]; removeFails?: Set<string> } = {}) {
  const pages = opts.pages ?? [[]];
  const removeFails = opts.removeFails ?? new Set<string>();
  let call = 0;

  const updated: { id: string; data: Record<string, unknown> }[] = [];
  const removed: string[] = [];
  const queries: Record<string, unknown>[] = [];

  const prisma = {
    motivationUpload: {
      findMany: jest.fn(async (args: any): Promise<any> => {
        queries.push(args.where);
        return pages[call++] ?? [];
      }),
      update: jest.fn(async (args: any): Promise<any> => {
        updated.push({ id: args.where.id, data: args.data });
        return {};
      }),
    },
    setting: {
      upsert: jest.fn(async (_a?: any): Promise<any> => ({})),
    },
  };

  const files = {
    remove: jest.fn(async (key: string): Promise<void> => {
      if (removeFails.has(key)) throw new Error('EACCES');
      removed.push(key);
    }),
  };

  const svc = new MotivationRetentionService(
    prisma as never,
    files as never,
  );
  return { svc, prisma, files, updated, removed, queries };
}

const upload = (n: number): Upload => ({
  id: `up-${n}`,
  storageKey: `motivations/2026/08/key${n}.enc`,
  motivationId: `mo-${n}`,
});

describe('what it deletes', () => {
  it('removes the bytes and marks the row, keeping the row itself', () => {
    // The row is the annexure record — what was submitted, and when. Only the
    // identity documents carry the exposure.
    return (async () => {
      const { svc, updated, removed } = build({ pages: [[upload(1)], []] });
      await svc.purge();
      expect(removed).toEqual(['motivations/2026/08/key1.enc']);
      expect(updated).toHaveLength(1);
      expect(updated[0].data.storageKey).toBeNull();
      expect(updated[0].data.purgedAt).toBeInstanceOf(Date);
    })();
  });

  it('looks for rows past their retention date AND rows that never got one', () => {
    return (async () => {
      const { svc, queries } = build({ pages: [[], []] });
      await svc.purge();

      // Two sweeps, and they ask different questions.
      expect(queries).toHaveLength(2);
      const [due, orphan] = queries as any[];
      expect(due.motivation.retentionPurgeAt).toEqual({ lte: expect.any(Date) });

      // The second must NOT trust the column: retentionPurgeAt is written only
      // on terminal transitions, so anything older, or written before that was
      // true, has no date at all.
      expect(orphan.motivation.retentionPurgeAt).toBeNull();
      expect(orphan.motivation.updatedAt).toEqual({ lt: expect.any(Date) });
      expect(orphan.motivation.status.in).toEqual(
        expect.arrayContaining(['ABANDONED', 'FAILED', 'DRAFT']),
      );
    })();
  });

  it('never re-purges something already purged', () => {
    return (async () => {
      const { svc, queries } = build({ pages: [[], []] });
      await svc.purge();
      for (const q of queries as any[]) {
        expect(q.purgedAt).toBeNull();
        expect(q.storageKey).toEqual({ not: null });
      }
    })();
  });
});

describe('when a file will not delete', () => {
  it('leaves the row UNMARKED so the next run tries again', () => {
    // Marking it purged while the bytes survive would hide the file from every
    // future sweep — the one outcome that turns a transient failure into a
    // permanent leak.
    return (async () => {
      const { svc, updated, removed } = build({
        pages: [[upload(1)], []],
        removeFails: new Set(['motivations/2026/08/key1.enc']),
      });
      await svc.purge();
      expect(removed).toEqual([]);
      expect(updated).toEqual([]);
    })();
  });

  it('keeps going past one bad key rather than stranding the rest', () => {
    return (async () => {
      const { svc, removed } = build({
        pages: [[upload(1), upload(2), upload(3)], []],
        removeFails: new Set(['motivations/2026/08/key2.enc']),
      });
      await svc.purge();
      expect(removed).toEqual([
        'motivations/2026/08/key1.enc',
        'motivations/2026/08/key3.enc',
      ]);
    })();
  });

  it('stops instead of spinning when an entire batch fails', () => {
    return (async () => {
      // Another pass would fetch the same rows and fail identically. Without
      // the guard this loops to the batch ceiling on every run, forever.
      const keys = [1, 2].map((n) => `motivations/2026/08/key${n}.enc`);
      const { svc, prisma } = build({
        pages: [[upload(1), upload(2)], [upload(1), upload(2)], []],
        removeFails: new Set(keys),
      });
      await svc.purge();
      // One fetch per sweep, then it gives up — not fifty.
      expect(prisma.motivationUpload.findMany.mock.calls.length).toBeLessThan(4);
    })();
  });
});

describe('how it behaves as a job', () => {
  it('records a heartbeat even when it fails', () => {
    // /admin/health reads this. A run that dies without stamping looks like a
    // cron that stopped, which is a different and less urgent alarm than one
    // that is running and erroring.
    return (async () => {
      const { svc, prisma } = build();
      prisma.motivationUpload.findMany.mockRejectedValueOnce(
        new Error('database is on fire'),
      );
      await expect(svc.purge()).resolves.toBeUndefined();
      expect(prisma.setting.upsert).toHaveBeenCalledTimes(1);
      const stamped = prisma.setting.upsert.mock.calls[0]?.[0] as any;
      expect(stamped.where.key).toBe('cron:lastrun:motivation-retention');
    })();
  });

  it('never throws out of the cron', () => {
    return (async () => {
      const { svc, files } = build({ pages: [[upload(1)], []] });
      files.remove.mockRejectedValue(new Error('boom'));
      await expect(svc.purge()).resolves.toBeUndefined();
    })();
  });

  it('does nothing at all when there is nothing due', () => {
    return (async () => {
      const { svc, files, updated } = build({ pages: [[], []] });
      await svc.purge();
      expect(files.remove).not.toHaveBeenCalled();
      expect(updated).toEqual([]);
    })();
  });

  it('does NOT consult the feature flag', () => {
    // motivation_writer_enabled defaults to false. Anything routed through
    // MotivationsService would assertEnabled(), throw on every row, swallow it,
    // delete nothing, and still stamp a healthy heartbeat — a retention job
    // reporting success while retaining everything.
    const raw = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'motivation-retention.service.ts'),
      'utf8',
    ) as string;
    // Comments stripped first: the file EXPLAINS at length why these names are
    // absent, and a naive scan would trip on the explanation.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toContain('assertEnabled');
    expect(code).not.toContain('MotivationsService');
    expect(code).not.toContain('MotivationQuotaService');
    // …and it reaches Prisma and the file store directly instead.
    expect(code).toContain('PrismaService');
    expect(code).toContain('SecureFileStorageService');
  });
});
