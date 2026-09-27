import { MotivationRetentionService } from './motivation-retention.service';

// Every failure mode here is SILENT. A purge that deletes nothing looks exactly
// like a purge with nothing to do, and both log the same cheerful nothing — so
// the tests have to assert on what it actually touched, never on whether it
// threw.

type Upload = {
  id: string;
  storageKey: string | null;
  motivationId: string;
  sha256?: string;
};

function build(
  opts: {
    pages?: Upload[][];
    removeFails?: Set<string>;
    onDisk?: { key: string; modifiedMs: number }[];
  } = {},
) {
  const pages = opts.pages ?? [[]];
  const removeFails = opts.removeFails ?? new Set<string>();
  let call = 0;

  const updated: { id: string; data: Record<string, unknown> }[] = [];
  const removed: string[] = [];
  const queries: Record<string, unknown>[] = [];
  const readForgets: string[][] = [];
  const rasterForgets: string[][] = [];

  const prisma = {
    motivationUpload: {
      findMany: jest.fn(async (args: any): Promise<any> => {
        // ⚠️ TWO CALLERS, ONE TABLE. The purge sweeps pass a `take` (they read
        // a page of rows to purge); the orphan sweep reads every live key and
        // passes none. Branching on `take` keeps the paginated queue the
        // tests drive from being consumed by the reference query.
        if (args?.take) {
          queries.push(args.where);
          return pages[call++] ?? [];
        }
        return [];
      }),
      update: jest.fn(async (args: any): Promise<any> => {
        updated.push({ id: args.where.id, data: args.data });
        return {};
      }),
    },
    // Every other table the orphan sweep reads for live storage keys. Empty
    // here: these tests are about the motivation uploads and the artifacts.
    credential: { findMany: jest.fn(async (): Promise<any[]> => []) },
    documentPageImage: { findMany: jest.fn(async (): Promise<any[]> => []) },
    motivationWitness: { findMany: jest.fn(async (): Promise<any[]> => []) },
    motivationSellerConsent: { findMany: jest.fn(async (): Promise<any[]> => []) },
    motivationSellerConsentDocument: {
      findMany: jest.fn(async (): Promise<any[]> => []),
    },
    motivation: { findMany: jest.fn(async (): Promise<any[]> => []) },
    user: { findMany: jest.fn(async (): Promise<any[]> => []) },
    setting: {
      upsert: jest.fn(async (_a?: any): Promise<any> => ({})),
    },
  };

  const files = {
    remove: jest.fn(async (key: string): Promise<void> => {
      if (removeFails.has(key)) throw new Error('EACCES');
      removed.push(key);
    }),
    list: jest.fn(async (): Promise<any[]> => opts.onDisk ?? []),
  };

  const svc = new MotivationRetentionService(
    prisma as never,
    files as never,
    {
      purgeExpired: async () => 0,
      forgetMany: async (sha: string[]) => {
        readForgets.push(sha);
        return sha.length;
      },
    } as never,
    {
      purgeExpired: async () => 0,
      forgetMany: async (sha: string[]) => {
        rasterForgets.push(sha);
        return sha.length;
      },
    } as never,
  );
  return { svc, prisma, files, updated, removed, queries, readForgets, rasterForgets };
}

const upload = (n: number): Upload => ({
  id: `up-${n}`,
  storageKey: `motivations/2026/08/key${n}.enc`,
  motivationId: `mo-${n}`,
  sha256: `sha-${n}`,
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

  it('⚠️ DELETES THE TRANSCRIPT WITH THE IMAGE', () => {
    // ocrTextEncrypted holds the FULL text Vision read off the page — name,
    // identity number, address, every serial on it. A sweep that removed the
    // photograph and kept a verbatim copy of everything printed on it would
    // retain precisely the half that carries the exposure, and would look
    // like a working purge from every angle: the bytes are gone, the row is
    // marked, the count of purged rows is right.
    return (async () => {
      const { svc, updated } = build({ pages: [[upload(1)], []] });
      await svc.purge();
      expect(updated[0].data.ocrTextEncrypted).toBeNull();
    })();
  });

  it('keeps the character count, which is not content', () => {
    // It records that the document HAD been read — something purgedAt alone
    // does not say — and it is a number, not a name. Same reasoning as
    // extractedFields, which also survives the sweep.
    return (async () => {
      const { svc, updated } = build({ pages: [[upload(1)], []] });
      await svc.purge();
      expect('ocrChars' in (updated[0].data as object)).toBe(false);
    })();
  });

  it('⚠️ DELETES THE EVIDENCE DESCRIPTION WITH THE PHOTOGRAPH', () => {
    // For an evidence item the description is the ONLY text on the row, and
    // it is the member's own words about a private photograph — "me and my
    // son on a hunt in Limpopo". It is POPIA data with the same exposure as
    // an OCR transcript and the same rule: it goes when the bytes go.
    return (async () => {
      const { svc, updated } = build({ pages: [[upload(1)], []] });
      await svc.purge();
      expect(updated[0].data.evidenceDescriptionEncrypted).toBeNull();
      // The container is an id, not content, and it stays — without it the
      // row would read as unplaceable rather than as purged.
      expect('evidenceType' in (updated[0].data as object)).toBe(false);
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

// ────────────────────────────────────────────────────────────────────
// SIGNATURES, WHICH THIS SERVICE USED TO WALK STRAIGHT PAST.
//
// ⚠️ A REAL LEAK, NOT A HYPOTHETICAL. purgeForUser selected `uploads` and
// nothing else, so a witness's drawn signature — and now a seller's consent
// signature — outlived the row that pointed at it. The cascade takes the
// record; the encrypted bytes stay in the tree with nothing referencing them,
// which means nobody could ever find them to remove by hand either. They are
// third parties' signatures, and this path is an ERASURE REQUEST.
describe('erasing an account', () => {
  function buildForUser(row: Record<string, unknown>) {
    const removed: string[] = [];
    const readForgets: string[][] = [];
    const rasterForgets: string[][] = [];
    const prisma = {
      motivation: {
        findMany: jest.fn(async (): Promise<any> => [row]),
        deleteMany: jest.fn(async (): Promise<any> => ({ count: 1 })),
      },
      motivationUpload: { findMany: jest.fn(async (): Promise<any> => []) },
      setting: { upsert: jest.fn(async (): Promise<any> => ({})) },
    };
    const files = {
      remove: jest.fn(async (k: string) => {
        removed.push(k);
      }),
    };
    const svc = new MotivationRetentionService(
      prisma as never,
      files as never,
      {
        purgeExpired: async () => 0,
        forgetMany: async (sha: string[]) => {
          readForgets.push(sha);
          return sha.length;
        },
      } as never,
      {
        purgeExpired: async () => 0,
        forgetMany: async (sha: string[]) => {
          rasterForgets.push(sha);
          return sha.length;
        },
      } as never,
    );
    return { svc, removed, prisma, readForgets, rasterForgets };
  }

  const ROW = {
    id: 'mo-1',
    uploads: [
      { id: 'up-1', storageKey: 'motivations/a.enc', sha256: 'sha-a' },
      { id: 'up-2', storageKey: 'motivations/b.enc', sha256: 'sha-b' },
    ],
    witnesses: [
      { id: 'w-1', signatureKey: 'motivations/w1.enc' },
      { id: 'w-2', signatureKey: 'motivations/w2.enc' },
    ],
    sellerConsent: { id: 'c-1', signatureKey: 'motivations/c1.enc' },
  };

  it('removes witness and seller-consent signatures, not just uploads', async () => {
    const { svc, removed } = buildForUser(ROW);
    const out = await svc.purgeForUser('u1');
    expect(removed.sort()).toEqual([
      'motivations/a.enc',
      'motivations/b.enc',
      'motivations/c1.enc',
      'motivations/w1.enc',
      'motivations/w2.enc',
    ]);
    expect(out.filesRemoved).toBe(5);
  });

  it('⚠️ FORGETS THE READINGS AND PAGE IMAGES TOO', async () => {
    // An erasure that deleted the licence but kept a transcription of its
    // serial numbers, and a picture of the page, is not an erasure. Both are
    // keyed by the plaintext sha256 — which lives on the upload row the
    // cascade is about to remove — so they must be gathered first.
    const { svc, readForgets, rasterForgets } = buildForUser(ROW);
    await svc.purgeForUser('u1');
    expect(readForgets).toEqual([['sha-a', 'sha-b']]);
    expect(rasterForgets).toEqual([['sha-a', 'sha-b']]);
  });

  it('copes with an application that has neither', async () => {
    const { svc, removed } = buildForUser({
      id: 'mo-2',
      uploads: [],
      witnesses: [],
      sellerConsent: null,
    });
    await expect(svc.purgeForUser('u1')).resolves.toMatchObject({
      filesRemoved: 0,
    });
    expect(removed).toEqual([]);
  });

  it('skips a signature that was never drawn', async () => {
    // An invited witness who never signed has a row and no key.
    const { svc, removed } = buildForUser({
      id: 'mo-3',
      uploads: [],
      witnesses: [{ id: 'w-9', signatureKey: null }],
      sellerConsent: { id: 'c-9', signatureKey: null },
    });
    await svc.purgeForUser('u1');
    expect(removed).toEqual([]);
  });

  it('still deletes the rows when a signature file will not go', async () => {
    // Same rule the uploads already follow: an erasure must not be stranded by
    // one unreadable key, and leaving the row would preserve a pointer to a
    // file we already failed to delete.
    const removed: string[] = [];
    const prisma = {
      motivation: {
        findMany: jest.fn(async (): Promise<any> => [ROW]),
        deleteMany: jest.fn(async (): Promise<any> => ({ count: 1 })),
      },
      motivationUpload: { findMany: jest.fn(async (): Promise<any> => []) },
      setting: { upsert: jest.fn(async (): Promise<any> => ({})) },
    };
    const files = {
      remove: jest.fn(async (k: string) => {
        if (k === 'motivations/w1.enc') throw new Error('EACCES');
        removed.push(k);
      }),
    };
    const svc = new MotivationRetentionService(
      prisma as never,
      files as never,
      { purgeExpired: async () => 0, forgetMany: async () => 0 } as never,
      { purgeExpired: async () => 0, forgetMany: async () => 0 } as never,
    );
    const out = await svc.purgeForUser('u1');
    expect(out.filesFailed).toBe(1);
    expect(out.filesRemoved).toBe(4);
    expect(prisma.motivation.deleteMany).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// ⚠️ THE DERIVED ARTIFACTS, WHICH THE SWEEP USED TO LEAVE BEHIND.
//
// Operator, 2026-09-26: "If a file is deleted it must be gone completely."
// The per-upload delete called forget(sha256) on the read cache and the page
// rasteriser; the retention sweep and the erasure did not, because they null
// rows in a batch and had no sha256 to hand either service. A page image IS
// the document and a reading IS its serial numbers, held thirty days — so the
// delete was a lie for a month.
describe('deleted means gone completely', () => {
  it('⚠️ FORGETS THE PAGE IMAGE AND THE READING WHEN THE BYTES GO', async () => {
    return (async () => {
      const { svc, readForgets, rasterForgets } = build({
        pages: [[upload(1), upload(2)], [], []],
      });
      await svc.purge();
      expect(readForgets).toEqual([['sha-1', 'sha-2']]);
      expect(rasterForgets).toEqual([['sha-1', 'sha-2']]);
    })();
  });

  it('does not forget anything when no bytes were removed', async () => {
    return (async () => {
      const { svc, readForgets, rasterForgets } = build({ pages: [[], []] });
      await svc.purge();
      expect(readForgets).toEqual([]);
      expect(rasterForgets).toEqual([]);
    })();
  });
});

// ────────────────────────────────────────────────────────────────────
// THE LAST LINE OF DEFENCE — bytes on disk that no row points at.
//
// Every other path to a file goes through a row, so when the row is taken by
// a cascade (account deletion, a deleteMany that swept a soft-deleted upload)
// nothing can ever see the bytes again. Nobody would find them to remove by
// hand. This sweep works the other way round: list the disk, keep only what
// the database still references.
describe('sweeping orphans off the disk', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const old = Date.now() - 2 * DAY;

  it('removes a file no row references', async () => {
    return (async () => {
      const { svc, removed } = build({
        pages: [[], []],
        onDisk: [{ key: 'motivations/2026/08/orphan.enc', modifiedMs: old }],
      });
      await svc.purge();
      expect(removed).toContain('motivations/2026/08/orphan.enc');
    })();
  });

  it('⚠️ NEVER TOUCHES A FILE YOUNGER THAN THE GRACE WINDOW', async () => {
    // A writer does files.write() and THEN the row create. Between the two the
    // file is on disk with no row — the normal middle of every upload. A sweep
    // that deleted it would turn a race into a lost document.
    return (async () => {
      const { svc, removed } = build({
        pages: [[], []],
        onDisk: [{ key: 'motivations/2026/08/fresh.enc', modifiedMs: Date.now() }],
      });
      await svc.purge();
      expect(removed).toEqual([]);
    })();
  });

  it('leaves a file the database still references', async () => {
    return (async () => {
      const { svc, removed, prisma } = build({
        pages: [[], []],
        onDisk: [{ key: 'motivations/2026/08/live.enc', modifiedMs: old }],
      });
      prisma.motivationUpload.findMany.mockImplementation(
        async (args: any): Promise<any> => {
          // The paginated purge queue is empty; the reference read (no `take`)
          // returns the live key, so the sweep must leave it alone.
          if (args?.take) return [];
          return [{ storageKey: 'motivations/2026/08/live.enc' }];
        },
      );
      await svc.purge();
      expect(removed).toEqual([]);
    })();
  });

  it('⚠️ DELETES NOTHING IF THE REFERENCE SET CANNOT BE BUILT', async () => {
    // An empty reference set and a failed one look identical to a naive sweep,
    // and one of them means "delete every file we hold". A query that throws
    // must stop the sweep, not clear the tree.
    return (async () => {
      const { svc, removed, prisma } = build({
        pages: [[], []],
        onDisk: [{ key: 'motivations/2026/08/orphan.enc', modifiedMs: old }],
      });
      prisma.credential.findMany.mockRejectedValue(new Error('database down'));
      await svc.purge();
      expect(removed).toEqual([]);
    })();
  });
});
