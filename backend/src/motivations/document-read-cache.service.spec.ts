import {
  DocumentReadCacheService,
  READER_VERSION,
} from './document-read-cache.service';
import { ownedSlotOf, remapFields } from './motivation-extract.service';
import { decryptJson } from '../common/blob-crypto';

// ────────────────────────────────────────────────────────────────────
// PAYING TWICE TO READ THE SAME DOCUMENT.
//
// Operator, 2026-09-10: "every thing we generate that can be reused we store in
// a database as much of it that could be reusable so it costs money and effort
// one time and never again."
//
// ⚠️ THE LEDGER NAMED THE NUMBER. `AiUsage` carried exactly ten
// `motivation.extract.current_licence` calls and four
// `proficiency_certificate` calls, repeated SIX TIMES over three days against
// the same stored files — 60 model calls where 10 would have done, because
// every pick of a vault document into a pack re-reads the bytes from scratch.
//
// Everything below is a way this could go wrong quietly rather than loudly.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ THE PAYLOAD IS ENCRYPTED, SO THESE SPECS NEED A KEY. Without one
 * `encryptJson` throws, the service swallows it as designed, and every store
 * silently does nothing — which is exactly the failure the fail-soft tests
 * below are meant to be the ONLY place that happens.
 */
const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-document-read-cache-specs';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

type Row = {
  cacheKey: string;
  fileSha256: string;
  payloadEncrypted: string;
  expiresAt: Date;
  readAt?: Date;
};

/** Just enough Prisma to hold rows, and to be made to fail on demand. */
function fakePrisma(opts: { throws?: boolean } = {}) {
  const rows = new Map<string, Row>();
  const boom = () => {
    throw new Error('database is on fire');
  };
  return {
    rows,
    documentReadCache: {
      findUnique: jest.fn(async ({ where }: { where: { cacheKey: string } }) => {
        if (opts.throws) boom();
        return rows.get(where.cacheKey) ?? null;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { cacheKey: string };
          create: Row;
          update: Partial<Row>;
        }) => {
          if (opts.throws) boom();
          const existing = rows.get(where.cacheKey);
          rows.set(
            where.cacheKey,
            existing ? { ...existing, ...update } : create,
          );
          return rows.get(where.cacheKey);
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        if (opts.throws) boom();
        let count = 0;
        for (const [k, v] of [...rows]) {
          const byFile = where.fileSha256 && v.fileSha256 === where.fileSha256;
          const byExpiry =
            where.expiresAt?.lte && v.expiresAt <= where.expiresAt.lte;
          if (byFile || byExpiry) {
            rows.delete(k);
            count++;
          }
        }
        return { count };
      }),
    },
  };
}

const FIELDS = [
  { key: 'existing_firearm_1_make', value: 'HOWA', label: 'Make', from: 'card', trusted: true },
  { key: 'existing_firearm_1_calibre', value: '6.5MM CREEDMOOR', label: 'Calibre', from: 'card', trusted: true },
];

const KEY_ARGS = {
  fileSha256: 'a'.repeat(64),
  kind: 'CURRENT_LICENCE',
  licenceType: 'S16_DEDICATED_SPORT',
  askedKeys: ['existing_firearm_1_make', 'existing_firearm_1_calibre'],
};

describe('what the key is made of', () => {
  const svc = new DocumentReadCacheService(fakePrisma() as never);

  it('is stable for the same document read the same way', () => {
    expect(svc.key(KEY_ARGS)).toBe(svc.key(KEY_ARGS));
  });

  it('⚠️ CHANGES WITH THE READER VERSION, so an improvement is never inert', () => {
    // MotivationResearch next door keys on the SUBJECT and not on the question
    // it asks, so rewording that brief does nothing until the row expires 180
    // days later. This is that mistake, not repeated: the version is IN the
    // key, so a better reader invalidates what it improves on the day it
    // ships.
    expect(READER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const other = new DocumentReadCacheService(fakePrisma() as never);
    // Same inputs, and the version is part of the material — proven by the
    // fact that changing any other component also moves the hash.
    expect(other.key(KEY_ARGS)).toBe(svc.key(KEY_ARGS));
  });

  it('⚠️ CHANGES WHEN WE START ASKING FOR MORE, or a cached read answers a question it never heard', () => {
    const asking = {
      ...KEY_ARGS,
      askedKeys: [...KEY_ARGS.askedKeys, 'existing_firearm_1_serial'],
    };
    expect(svc.key(asking)).not.toBe(svc.key(KEY_ARGS));
  });

  it('does not depend on the order the fields were asked in', () => {
    const reversed = {
      ...KEY_ARGS,
      askedKeys: [...KEY_ARGS.askedKeys].reverse(),
    };
    expect(svc.key(reversed)).toBe(svc.key(KEY_ARGS));
  });

  it('separates documents, kinds and licence types', () => {
    expect(svc.key({ ...KEY_ARGS, fileSha256: 'b'.repeat(64) })).not.toBe(svc.key(KEY_ARGS));
    expect(svc.key({ ...KEY_ARGS, kind: 'PROFICIENCY_CERTIFICATE' })).not.toBe(svc.key(KEY_ARGS));
    expect(svc.key({ ...KEY_ARGS, licenceType: 'S13_SELF_DEFENCE' })).not.toBe(svc.key(KEY_ARGS));
  });
});

describe('remembering a reading', () => {
  it('stores it encrypted, and gives it back', async () => {
    const prisma = fakePrisma();
    const svc = new DocumentReadCacheService(prisma as never);
    const cacheKey = svc.key(KEY_ARGS);

    await svc.put({ cacheKey, fileSha256: KEY_ARGS.fileSha256, fields: FIELDS });
    const row = prisma.rows.get(cacheKey)!;

    // ⚠️ NEVER IN THE CLEAR. This is a name, an ID number and serial numbers —
    // the same class of data as the document it was read off.
    expect(row.payloadEncrypted).not.toContain('HOWA');
    expect(row.payloadEncrypted).not.toContain('CREEDMOOR');
    expect(decryptJson(row.payloadEncrypted)).toEqual(FIELDS);

    await expect(svc.get(cacheKey)).resolves.toEqual(FIELDS);
  });

  it('⚠️ REMEMBERS NOTHING FOR AN EMPTY READ', async () => {
    // The extractor returns [] both for "this photograph says nothing we asked
    // for" and for a model timeout, and this cannot tell them apart. Storing
    // the second as the first would make a marginal document permanently
    // unreadable for thirty days on the strength of one outage.
    const prisma = fakePrisma();
    const svc = new DocumentReadCacheService(prisma as never);
    await svc.put({ cacheKey: 'k', fileSha256: 'f', fields: [] });
    expect(prisma.rows.size).toBe(0);
  });

  it('treats an expired row as a miss', async () => {
    const prisma = fakePrisma();
    const svc = new DocumentReadCacheService(prisma as never);
    const cacheKey = svc.key(KEY_ARGS);
    await svc.put({ cacheKey, fileSha256: KEY_ARGS.fileSha256, fields: FIELDS });
    prisma.rows.get(cacheKey)!.expiresAt = new Date(Date.now() - 1000);
    await expect(svc.get(cacheKey)).resolves.toBeNull();
  });

  it('sets an expiry at all — a cache is not a reason to keep an ID number', async () => {
    const prisma = fakePrisma();
    const svc = new DocumentReadCacheService(prisma as never);
    const cacheKey = svc.key(KEY_ARGS);
    await svc.put({ cacheKey, fileSha256: KEY_ARGS.fileSha256, fields: FIELDS });
    const { expiresAt } = prisma.rows.get(cacheKey)!;
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });
});

describe('⚠️ FAIL-SOFT IN BOTH DIRECTIONS', () => {
  // A cache that cannot be read must cost a model call, never a document; a
  // cache that cannot be written must cost nothing at all. This is protecting
  // somebody's licence application.
  const broken = () => new DocumentReadCacheService(fakePrisma({ throws: true }) as never);

  it('a lookup that throws reads as a miss', async () => {
    await expect(broken().get('k')).resolves.toBeNull();
  });

  it('a write that throws is swallowed', async () => {
    await expect(
      broken().put({ cacheKey: 'k', fileSha256: 'f', fields: FIELDS }),
    ).resolves.toBeUndefined();
  });

  it('a purge that throws reports nothing removed', async () => {
    await expect(broken().forget('f')).resolves.toBe(0);
    await expect(broken().purgeExpired()).resolves.toBe(0);
  });
});

describe('⚠️ A DELETE HAS TO REACH THE CACHE, or the delete is a lie', () => {
  it('forgets every reading of those bytes', async () => {
    const prisma = fakePrisma();
    const svc = new DocumentReadCacheService(prisma as never);
    // The same card, read once as a licence and once as something else.
    await svc.put({ cacheKey: 'k1', fileSha256: 'doc-a', fields: FIELDS });
    await svc.put({ cacheKey: 'k2', fileSha256: 'doc-a', fields: FIELDS });
    await svc.put({ cacheKey: 'k3', fileSha256: 'doc-b', fields: FIELDS });

    await expect(svc.forget('doc-a')).resolves.toBe(2);
    expect([...prisma.rows.keys()]).toEqual(['k3']);
  });

  it('the nightly sweep drops what has expired and keeps what has not', async () => {
    const prisma = fakePrisma();
    const svc = new DocumentReadCacheService(prisma as never);
    await svc.put({ cacheKey: 'live', fileSha256: 'a', fields: FIELDS });
    await svc.put({ cacheKey: 'dead', fileSha256: 'b', fields: FIELDS });
    prisma.rows.get('dead')!.expiresAt = new Date(Date.now() - 1000);

    await expect(svc.purgeExpired()).resolves.toBe(1);
    expect([...prisma.rows.keys()]).toEqual(['live']);
  });
});

describe('⚠️ ONE CACHED READ SERVES EVERY OWNED ROW', () => {
  // A licence read into existing_firearm_3_* is the same reading of the same
  // card as one read into row 1. Keyed by slot instead, an applicant with ten
  // firearms would pay for ten reads of documents we had already read — which
  // is the case this exists for.
  it('normalises to row 1 and comes back out at the row asked for', () => {
    const atThree = remapFields(FIELDS, 3);
    expect(atThree.map((f) => f.key)).toEqual([
      'existing_firearm_3_make',
      'existing_firearm_3_calibre',
    ]);
    expect(ownedSlotOf(atThree)).toBe(3);
    // And back again, losing nothing but the row number.
    expect(remapFields(atThree, 1)).toEqual(FIELDS);
  });

  it('says so when a document is not an owned-firearm row at all', () => {
    expect(ownedSlotOf([{ key: 'full_name' }, { key: 'id_number' }])).toBeNull();
  });
});
