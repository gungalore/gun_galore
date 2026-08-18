import { ConflictException, NotFoundException } from '@nestjs/common';
import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { MotivationsService } from './motivations.service';
import { decryptJson } from '../common/blob-crypto';
import {
  sanitiseAnswers,
  missingRequired,
  fieldsFor,
  requiredKeys,
} from './motivation-fields';

// What matters here: the throttle produces a readable 409 rather than a raw
// Prisma error, ownership is enforced in the WHERE clause (so someone else's
// id is indistinguishable from a wrong one), answers round-trip encrypted, and
// erasure removes the FILES before the rows.

const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-motivation-service';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

function build(opts: { enabled?: boolean; canStart?: boolean } = {}) {
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    motivation: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({
        id: 'mo-1',
        referenceNumber: data.referenceNumber,
        status: data.status,
      })),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      delete: jest.fn(async () => ({})),
    },
  };
  const quota = {
    assertEnabled: jest.fn(async () => {
      if (opts.enabled === false) throw new NotFoundException('Not found');
    }),
    status: jest.fn(async () => ({
      enabled: opts.enabled ?? true,
      cap: 100,
      used: 0,
      freeRemaining: 100,
      priceCents: 19900,
      canStart: opts.canStart ?? true,
    })),
  };
  const refs = { allocate: jest.fn(async () => 'MO000123') };
  const files = { remove: jest.fn(async () => undefined) };

  const svc = new MotivationsService(
    prisma as never,
    quota as never,
    refs as never,
    files as never,
  );
  return { svc, prisma, quota, refs, files };
}

describe('MotivationsService', () => {
  describe('the flag gate', () => {
    it('every entry point asserts the flag before touching anything', async () => {
      const { svc, quota, prisma } = build({ enabled: false });
      const calls: Array<Promise<unknown>> = [
        svc.listMine('c1'),
        svc.create('c1', MotivationLicenceType.S16_DEDICATED_HUNTER),
        svc.findOne('c1', 'mo-1'),
        svc.saveAnswers('c1', 'mo-1', {}),
        svc.abandon('c1', 'mo-1'),
        svc.erase('c1', 'mo-1'),
      ];
      for (const c of calls) {
        await expect(c).rejects.toBeInstanceOf(NotFoundException);
      }
      expect(quota.assertEnabled).toHaveBeenCalledTimes(6);
      // Nothing reached the database.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('allocates an MO number and stores a variant seed', async () => {
      const { svc, prisma, refs } = build();
      const out = await svc.create('c1', MotivationLicenceType.S13_SELF_DEFENCE);
      expect(refs.allocate).toHaveBeenCalledWith('MO');
      expect(out.referenceNumber).toBe('MO000123');
      const data = prisma.motivation.create.mock.calls[0][0].data;
      // The seed is fixed at creation, not at generation, so a regeneration
      // can prove why two documents differ.
      expect(Number.isInteger(data.variantSeed)).toBe(true);
      expect(data.variantSeed).toBeGreaterThanOrEqual(0);
      expect(data.status).toBe(MotivationStatus.DRAFT);
    });

    it('translates the unique-constraint violation into a readable 409', async () => {
      // The throttle is the DATABASE. A check-then-insert would let two
      // simultaneous requests both pass; all this code does is make the
      // resulting error human.
      const { svc, prisma } = build();
      prisma.motivation.create.mockRejectedValueOnce({ code: 'P2002' });
      await expect(
        svc.create('c1', MotivationLicenceType.S16_DEDICATED_HUNTER),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows database errors that are not the throttle', async () => {
      const { svc, prisma } = build();
      prisma.motivation.create.mockRejectedValueOnce(new Error('connection lost'));
      await expect(
        svc.create('c1', MotivationLicenceType.S24_RENEWAL),
      ).rejects.toThrow('connection lost');
    });

    it('refuses when the beta is full, without burning an MO number', async () => {
      const { svc, refs, prisma } = build({ canStart: false });
      await expect(
        svc.create('c1', MotivationLicenceType.S13_SELF_DEFENCE),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(refs.allocate).not.toHaveBeenCalled();
      expect(prisma.motivation.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown licence type', async () => {
      const { svc } = build();
      await expect(
        svc.create('c1', 'S99_NONSENSE' as MotivationLicenceType),
      ).rejects.toThrow(/licence type/i);
    });

    it('404s when the user row is missing (stale dev-era rows did this in prod)', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        svc.create('c1', MotivationLicenceType.S24_RENEWAL),
      ).rejects.toThrow('User not found');
    });
  });

  describe('ownership', () => {
    it('scopes the fetch by userId in the WHERE clause, not an if afterwards', async () => {
      const { svc, prisma } = build();
      await expect(svc.findOne('c1', 'mo-9')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.motivation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mo-9', userId: 'user-1' },
        }),
      );
    });

    it('never selects storageKey into a client response', async () => {
      // The one value that addresses a file on our disk must not leave the
      // server.
      const { svc, prisma } = build();
      prisma.motivation.findFirst.mockResolvedValueOnce(null);
      await svc.findOne('c1', 'mo-1').catch(() => undefined);
      const args = prisma.motivation.findFirst.mock.calls[0][0];
      expect(args.include.uploads.select).not.toHaveProperty('storageKey');
    });
  });

  describe('answers', () => {
    const row = {
      id: 'mo-1',
      licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
      status: MotivationStatus.DRAFT,
      answersEncrypted: null,
    };

    it('encrypts the blob and drops unregistered keys', async () => {
      const { svc, prisma } = build();
      prisma.motivation.findFirst.mockResolvedValueOnce(row);
      const res = await svc.saveAnswers('c1', 'mo-1', {
        occupation: '  Farm manager  ',
        not_a_real_field: 'x',
      });

      expect(res.saved).toBe(1);
      expect(res.ignored).toEqual(['not_a_real_field']);

      const stored = prisma.motivation.update.mock.calls[0][0].data.answersEncrypted;
      // It is genuinely ciphertext, not JSON.
      expect(stored).not.toContain('Farm manager');
      expect(decryptJson(stored)).toEqual({ occupation: 'Farm manager' });
    });

    it('merges rather than replaces', async () => {
      const { svc, prisma } = build();
      prisma.motivation.findFirst.mockResolvedValueOnce(row);
      await svc.saveAnswers('c1', 'mo-1', { occupation: 'Farmer' });
      const first = prisma.motivation.update.mock.calls[0][0].data.answersEncrypted;

      prisma.motivation.findFirst.mockResolvedValueOnce({
        ...row,
        answersEncrypted: first,
      });
      // association_name belongs to DEDICATED_HUNTER. Using a sport-shooter
      // field here would be correctly REJECTED as unregistered for this
      // licence type — which is what the first draft of this test did, and the
      // registry caught it.
      await svc.saveAnswers('c1', 'mo-1', { association_name: 'SAHGCA' });
      const second = prisma.motivation.update.mock.calls[1][0].data.answersEncrypted;

      expect(decryptJson(second)).toEqual({
        occupation: 'Farmer',
        association_name: 'SAHGCA',
      });
    });

    it('rejects a field that belongs to a DIFFERENT licence type', async () => {
      // The registry is per-type, so a sport-shooter field on a hunter
      // motivation is not a valid answer — it would sit in the blob forever
      // with nothing knowing what to do with it.
      const { svc, prisma } = build();
      prisma.motivation.findFirst.mockResolvedValueOnce(row);
      const res = await svc.saveAnswers('c1', 'mo-1', {
        discipline: 'Precision rifle',
      });
      expect(res.saved).toBe(0);
      expect(res.ignored).toEqual(['discipline']);
    });

    it('refuses edits once generation has started', async () => {
      const { svc, prisma } = build();
      prisma.motivation.findFirst.mockResolvedValueOnce({
        ...row,
        status: MotivationStatus.GENERATING,
      });
      await expect(
        svc.saveAnswers('c1', 'mo-1', { occupation: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('survives an undecryptable blob instead of 500ing the wizard', async () => {
      const { svc, prisma } = build();
      prisma.motivation.findFirst.mockResolvedValueOnce({
        ...row,
        answersEncrypted: 'not-real-ciphertext',
      });
      const res = await svc.saveAnswers('c1', 'mo-1', { occupation: 'Farmer' });
      expect(res.saved).toBe(1);
    });
  });

  describe('erasure', () => {
    it('removes the FILES before the rows', async () => {
      // A cascade cannot reach the filesystem. Deleting rows first would orphan
      // the bytes with nothing pointing at them.
      const order: string[] = [];
      const { svc, prisma, files } = build();
      prisma.motivation.findFirst.mockResolvedValueOnce({
        id: 'mo-1',
        uploads: [
          { id: 'u1', storageKey: 'motivations/2026/08/aaa.enc' },
          { id: 'u2', storageKey: 'motivations/2026/08/bbb.enc' },
          { id: 'u3', storageKey: null },
        ],
      });
      files.remove.mockImplementation(async () => {
        order.push('file');
      });
      prisma.motivation.delete.mockImplementation(async () => {
        order.push('row');
        return {};
      });

      const res = await svc.erase('c1', 'mo-1');
      expect(res).toEqual({ erased: true, filesRemoved: 2 });
      expect(order).toEqual(['file', 'file', 'row']);
    });

    it('still deletes the record when one file cannot be removed', async () => {
      const { svc, prisma, files } = build();
      prisma.motivation.findFirst.mockResolvedValueOnce({
        id: 'mo-1',
        uploads: [{ id: 'u1', storageKey: 'motivations/2026/08/aaa.enc' }],
      });
      files.remove.mockRejectedValueOnce(new Error('disk gone'));
      const res = await svc.erase('c1', 'mo-1');
      expect(res.filesRemoved).toBe(0);
      expect(prisma.motivation.delete).toHaveBeenCalled();
    });
  });
});

describe('motivation field registry', () => {
  it('defines fields for every licence type', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      expect(fieldsFor(t).length).toBeGreaterThan(5);
      expect(requiredKeys(t).length).toBeGreaterThan(3);
    }
  });

  it('has unique keys within a type', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      const keys = fieldsFor(t).map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('caps long answers so one applicant cannot blow up token cost', () => {
    const long = 'x'.repeat(10_000);
    const { answers } = sanitiseAnswers(
      MotivationLicenceType.S13_SELF_DEFENCE,
      { threat_circumstances: long },
    );
    expect(answers.threat_circumstances.length).toBe(4000);
  });

  it('treats an explicit null as clearing the field, not as junk', () => {
    const { answers, rejected } = sanitiseAnswers(
      MotivationLicenceType.S24_RENEWAL,
      { occupation: null },
    );
    expect(answers.occupation).toBe('');
    expect(rejected).toEqual([]);
  });

  it('rejects non-string values', () => {
    const { rejected } = sanitiseAnswers(MotivationLicenceType.S24_RENEWAL, {
      occupation: { evil: true },
    });
    expect(rejected).toEqual(['occupation']);
  });

  it('reports what is still missing', () => {
    const t = MotivationLicenceType.S16_DEDICATED_SPORT;
    expect(missingRequired(t, {})).toEqual(requiredKeys(t));
    const whitespaceOnly = Object.fromEntries(
      requiredKeys(t).map((k) => [k, '   ']),
    );
    // Whitespace is not an answer.
    expect(missingRequired(t, whitespaceOnly)).toEqual(requiredKeys(t));
  });

  it('marks the fields that must never be logged', () => {
    const t = MotivationLicenceType.S13_SELF_DEFENCE;
    const sensitive = fieldsFor(t).filter((f) => f.sensitive).map((f) => f.key);
    expect(sensitive).toEqual(
      expect.arrayContaining([
        'id_number',
        'residential_address',
        'threat_circumstances',
      ]),
    );
  });
});
