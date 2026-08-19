import { ConflictException, NotFoundException } from '@nestjs/common';
import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { MotivationsService, estimateCostUsd } from './motivations.service';
import { decryptJson, encryptJson, encryptText } from '../common/blob-crypto';
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

function build(
  opts: {
    enabled?: boolean;
    canStart?: boolean;
    settings?: Record<string, unknown>;
  } = {},
) {
  const prisma = {
    user: { findUnique: jest.fn(async (_a?: any): Promise<any> => ({ id: 'user-1' })) },
    motivation: {
      findMany: jest.fn(async (_a?: any): Promise<any> => []),
      findFirst: jest.fn(async (_a?: any): Promise<any> => null),
      create: jest.fn(async ({ data }: any) => ({
        id: 'mo-1',
        referenceNumber: data.referenceNumber,
        status: data.status,
      })),
      update: jest.fn(async (_a?: any): Promise<any> => ({})),
      updateMany: jest.fn(async (_a?: any): Promise<any> => ({ count: 1 })),
      delete: jest.fn(async (_a?: any): Promise<any> => ({})),
    },
    motivationMessage: {
      create: jest.fn(async (_a?: any): Promise<any> => ({})),
    },
    adminAlert: { create: jest.fn(async (_a?: any): Promise<any> => ({})) },
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
    claimBetaSeat: jest.fn(async (_cap?: any): Promise<number | null> => 1),
    releaseBetaSeat: jest.fn(async (): Promise<any> => undefined),
  };
  const refs = { allocate: jest.fn(async () => 'MO000123') };
  const files = { remove: jest.fn(async (_a?: any): Promise<any> => undefined) };

  const claude = {
    // A COMPLIANT model: it writes the headings it was told to, in order.
    // The first draft of this mock used generic headings and the pipeline
    // correctly regenerated (structureOk=false) — proving followsPlan() works,
    // but making the default path cost two generations.
    generate: jest.fn(async (_p?: any, plan?: any): Promise<any> => ({
      text: (plan?.sections ?? [])
        .map((sec: any) => sec.heading + '\n\nA paragraph of body text here.')
        .join('\n\n'),
      usage: { model: 'claude-opus-5', promptTokens: 900, completionTokens: 700 },
    })),
    grade: jest.fn(async (_p?: any, _t?: any): Promise<any> => ({
      verdict: {
        completeness: 90,
        specificity: 88,
        consistency: 90,
        groundedness: 92,
        overall: 90,
        thinFields: [],
        issues: [],
        passed: true,
      },
      usage: { model: 'claude-sonnet-5', promptTokens: 400, completionTokens: 80 },
      parsed: true,
    })),
    askFollowUpBatch: jest.fn(async (_a?: any): Promise<any> => ({
      questions: { hunting_history: 'What do you hunt, and how often?' },
      usage: { model: 'f', promptTokens: 10, completionTokens: 5 },
    })),
    askFollowUp: jest.fn(async (_a?: any): Promise<any> => ({
      question: 'Which association are you with?',
      usage: { model: 'haiku', promptTokens: 10, completionTokens: 10 },
    })),
  };
  const pdf = { render: jest.fn(async (_a?: any): Promise<any> => ({ pdf: Buffer.from('%PDF-'), filename: 'x.pdf' })) };
  const settings = {
    get: jest.fn(async (flag: { key: string; default: unknown }) =>
      opts.settings && flag.key in opts.settings
        ? (opts.settings as any)[flag.key]
        : flag.default,
    ),
  };

  const svc = new MotivationsService(
    prisma as never,
    quota as never,
    refs as never,
    files as never,
    claude as never,
    pdf as never,
    settings as never,
      // Extraction proposes values off an uploaded document; nothing in
      // these tests uploads one, so a stub is enough.
      { extract: jest.fn(async () => []) } as never,
  );
  return { svc, prisma, quota, refs, files, claude, pdf, settings };
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

describe('MotivationsService.generate', () => {
  const READY = {
    id: 'mo-1',
    licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
    status: MotivationStatus.DRAFT,
    answersEncrypted: null as string | null,
    declarationAcceptedAt: new Date() as Date | null,
    variantSeed: 4242,
    gateCycles: 0,
    betaSeatNo: null as number | null,
    promptTokens: null as number | null,
    completionTokens: null as number | null,
  };

  /** A row whose encrypted answers satisfy every required field. */
  function readyRow(over: Partial<typeof READY> = {}) {
    const answers: Record<string, string> = {};
    for (const k of requiredKeys(MotivationLicenceType.S16_DEDICATED_HUNTER)) {
      answers[k] = 'A sufficient answer for testing purposes.';
    }
    return { ...READY, answersEncrypted: encryptJson(answers), ...over };
  }

  it('refuses without the declaration — they are signing this', async () => {
    const { svc, prisma, claude } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(
      readyRow({ declarationAcceptedAt: null }),
    );
    await expect(svc.generate('c1', 'mo-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(claude.generate).not.toHaveBeenCalled();
  });

  it('refuses while required answers are missing, and says which', async () => {
    const { svc, prisma, claude } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce({
      ...READY,
      answersEncrypted: encryptJson({ occupation: 'Farmer' }),
    });
    await expect(svc.generate('c1', 'mo-1')).rejects.toMatchObject({
      response: { code: 'motivation-incomplete' },
    });
    expect(claude.generate).not.toHaveBeenCalled();
  });

  it('CAS: a second concurrent click does not spend money twice', async () => {
    const { svc, prisma, claude } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(readyRow());
    prisma.motivation.updateMany.mockResolvedValueOnce({ count: 0 }); // lost the race
    await expect(svc.generate('c1', 'mo-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(claude.generate).not.toHaveBeenCalled();
  });

  it('claims a beta seat BEFORE calling Claude', async () => {
    const order: string[] = [];
    const { svc, prisma, quota, claude } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(readyRow());
    quota.claimBetaSeat = jest.fn(async () => {
      order.push('seat');
      return 7;
    });
    claude.generate.mockImplementation(async () => {
      order.push('claude');
      return {
        text: 'Introduction:\n\nBody text that is long enough.',
        usage: { model: 'claude-opus-5', promptTokens: 1, completionTokens: 1 },
      };
    });
    await svc.generate('c1', 'mo-1');
    expect(order[0]).toBe('seat');
    expect(order).toContain('claude');
  });

  it('stores the document encrypted and completes when the gate passes', async () => {
    const { svc, prisma } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(readyRow());
    const res = await svc.generate('c1', 'mo-1');
    expect(res.status).toBe(MotivationStatus.COMPLETED);

    const data = prisma.motivation.update.mock.calls.at(-1)![0].data;
    expect(data.status).toBe(MotivationStatus.COMPLETED);
    expect(data.documentTextEncrypted).not.toContain('Introduction');
    expect(data.templateVersion).toBeTruthy();
    expect(data.retentionPurgeAt).toBeInstanceOf(Date);
    // Token spend is accumulated across every pass, not just the last one.
    expect(data.promptTokens).toBe(900 + 400);
  });

  it('sends it back for more detail when the gate fails, and asks questions', async () => {
    const { svc, prisma, claude } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(readyRow());
    claude.grade.mockResolvedValueOnce({
      verdict: {
        completeness: 40, specificity: 30, consistency: 60, groundedness: 80,
        overall: 52, thinFields: ['hunting_history'], issues: ['Too general'],
        passed: false,
      },
      usage: { model: 'g', promptTokens: 1, completionTokens: 1 },
      parsed: true,
    });
    const res = await svc.generate('c1', 'mo-1');
    expect(res.status).toBe(MotivationStatus.NEEDS_MORE_INFO);

    // ONE Claude call for the whole batch, not one per field. This used to loop
    // and send the entire system prompt three times to produce three sentences.
    expect(claude.askFollowUpBatch).toHaveBeenCalledTimes(1);
    expect(claude.askFollowUp).not.toHaveBeenCalled();

    // …and the questions still land, one message per gap.
    const asked = claude.askFollowUpBatch.mock.calls[0][0];
    expect(asked.gaps).toHaveLength(3);

    // What blocks generation is asked FIRST. Only the two reasons that stop a
    // document being produced reach a three-question batch on this fixture;
    // the merely-nice-to-have fields never get a look in.
    for (const g of asked.gaps) {
      expect(['missing_required', 'thin']).toContain(g.reason);
    }
    // …and they arrive in priority order, not registry order.
    const ranks = asked.gaps.map((g: any) => g.reason === 'missing_required' ? 0 : 1);
    expect([...ranks].sort()).toEqual(ranks);

    // The brief carries a label and a word count, never the applicant's prose.
    const brief = JSON.stringify(asked.gaps);
    expect(brief).not.toMatch(/Rifle for kudu|Farm manager/);
    expect(asked.gaps[0]).toHaveProperty('wordsSoFar');
    expect(prisma.motivationMessage.create).toHaveBeenCalled();
  });

  it('gives up to an admin once the retry ceiling is hit', async () => {
    const { svc, prisma, claude } = build({ settings: { motivation_max_gate_cycles: 1 } });
    prisma.motivation.findFirst.mockResolvedValueOnce(readyRow({ gateCycles: 1 }));
    claude.grade.mockResolvedValueOnce({
      verdict: {
        completeness: 10, specificity: 10, consistency: 10, groundedness: 10,
        overall: 10, thinFields: [], issues: ['Still thin'], passed: false,
      },
      usage: { model: 'g', promptTokens: 1, completionTokens: 1 },
      parsed: true,
    });
    const res = await svc.generate('c1', 'mo-1');
    expect(res.status).toBe(MotivationStatus.FAILED);
    expect(prisma.adminAlert.create).toHaveBeenCalled();
  });

  it('regenerates with a fresh seed when the model ignored the plan', async () => {
    const { svc, prisma, claude } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(readyRow());
    // First attempt has no planned headings at all.
    claude.generate
      .mockResolvedValueOnce({
        text: 'Just some prose with no headings whatsoever, going on at length.',
        usage: { model: 'm', promptTokens: 10, completionTokens: 10 },
      })
      .mockResolvedValueOnce({
        text: 'Introduction:\n\nProper document this time around.',
        usage: { model: 'm', promptTokens: 10, completionTokens: 10 },
      });
    await svc.generate('c1', 'mo-1');
    expect(claude.generate).toHaveBeenCalledTimes(2);
    // The second call used a DIFFERENT plan than the first.
    const firstPlan = claude.generate.mock.calls[0][1];
    const secondPlan = claude.generate.mock.calls[1][1];
    expect(secondPlan.seed).not.toBe(firstPlan.seed);
  });

  it('releases the row when generation throws — never stranded in GENERATING', async () => {
    // Without this a failed generation leaves the motivation uneditable AND
    // un-regenerable, which is the worst possible end state.
    const { svc, prisma, claude } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(readyRow());
    claude.generate.mockRejectedValueOnce(new Error('overloaded'));
    await expect(svc.generate('c1', 'mo-1')).rejects.toThrow('overloaded');
    const release = prisma.motivation.updateMany.mock.calls.at(-1)![0];
    expect(release.where.status).toBe(MotivationStatus.GENERATING);
    expect(release.data.status).toBe(MotivationStatus.NEEDS_MORE_INFO);
  });

  it('does not claim a second seat on a retry', async () => {
    const { svc, prisma, quota } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(readyRow({ betaSeatNo: 12 }));
    quota.claimBetaSeat = jest.fn();
    await svc.generate('c1', 'mo-1');
    expect(quota.claimBetaSeat).not.toHaveBeenCalled();
  });
});

describe('MotivationsService.renderPdf', () => {
  it('refuses until the document is complete', async () => {
    const { svc, prisma } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce({
      referenceNumber: 'MO1', licenceType: MotivationLicenceType.S24_RENEWAL,
      status: MotivationStatus.DRAFT, documentTextEncrypted: null,
      templateVersion: null, answersEncrypted: null, completedAt: null,
      uploads: [],
    });
    await expect(svc.renderPdf('c1', 'mo-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('renders with the applicant REAL name, not a username', async () => {
    const { svc, prisma, pdf } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce({
      referenceNumber: 'MO000123',
      licenceType: MotivationLicenceType.S24_RENEWAL,
      status: MotivationStatus.COMPLETED,
      documentTextEncrypted: encryptText('Introduction:\n\nBody.'),
      templateVersion: 'tpl-x',
      answersEncrypted: encryptJson({ full_name: 'Jan Pietersen' }),
      completedAt: new Date('2026-08-18T00:00:00Z'),
      uploads: [{ kind: 'IDENTITY_DOCUMENT' }],
    });
    await svc.renderPdf('c1', 'mo-1');
    const args = pdf.render.mock.calls[0][0];
    expect(args.applicantName).toBe('Jan Pietersen');
    expect(args.templateVersion).toBe('tpl-x');
  });
});

describe('MotivationsService — beta seat accounting and cost', () => {
  const READY2 = {
    id: 'mo-1',
    licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
    status: MotivationStatus.DRAFT,
    answersEncrypted: null as string | null,
    declarationAcceptedAt: new Date() as Date | null,
    variantSeed: 99,
    gateCycles: 0,
    betaSeatNo: null as number | null,
    promptTokens: null as number | null,
    completionTokens: null as number | null,
  };

  function ready2(over: Partial<typeof READY2> = {}) {
    const answers: Record<string, string> = {};
    for (const k of requiredKeys(MotivationLicenceType.S16_DEDICATED_HUNTER)) {
      answers[k] = 'A sufficient answer for testing purposes.';
    }
    return { ...READY2, answersEncrypted: encryptJson(answers), ...over };
  }

  it('GIVES THE SEAT BACK when generation fails', async () => {
    // The seat is claimed before the first Claude call so we never spend money
    // unaccounted for. That means an outage would otherwise consume a free-beta
    // seat and produce nothing — the applicant loses their place because WE
    // failed. This test is the whole reason releaseBetaSeat exists.
    const { svc, prisma, claude, quota } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(ready2());
    claude.generate.mockRejectedValueOnce(new Error('overloaded'));
    await expect(svc.generate('c1', 'mo-1')).rejects.toThrow('overloaded');
    expect(quota.releaseBetaSeat).toHaveBeenCalledTimes(1);
  });

  it('does NOT give back a seat it did not claim', async () => {
    // A retry on a motivation that already held a seat must never decrement
    // someone else's.
    const { svc, prisma, claude, quota } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(ready2({ betaSeatNo: 12 }));
    claude.generate.mockRejectedValueOnce(new Error('overloaded'));
    await expect(svc.generate('c1', 'mo-1')).rejects.toThrow('overloaded');
    expect(quota.releaseBetaSeat).not.toHaveBeenCalled();
  });

  it('does not release the seat on a successful generation', async () => {
    const { svc, prisma, quota } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(ready2());
    await svc.generate('c1', 'mo-1');
    expect(quota.releaseBetaSeat).not.toHaveBeenCalled();
  });

  it('records a cost — the only per-document spend signal we have', async () => {
    // Org-level spend alerting does not work on this box (the admin key is a
    // regular key), so this column is it.
    const { svc, prisma } = build();
    prisma.motivation.findFirst.mockResolvedValueOnce(ready2());
    await svc.generate('c1', 'mo-1');
    const data = prisma.motivation.update.mock.calls.at(-1)![0].data;
    expect(typeof data.costUsd).toBe('number');
    expect(data.costUsd).toBeGreaterThan(0);
  });
});

describe('estimateCostUsd', () => {
  it('prices the flagship above the cheap tier', () => {
    const opus = estimateCostUsd('claude-opus-5', 1_000_000, 1_000_000);
    const haiku = estimateCostUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    expect(opus).toBeGreaterThan(haiku);
  });

  it('falls back to the flagship rate for an unknown model', () => {
    // Over-estimating spend is the safe direction: an unknown model that
    // silently priced at zero would hide a runaway.
    expect(estimateCostUsd('some-future-model', 1_000_000, 0)).toBe(
      estimateCostUsd('claude-opus-5', 1_000_000, 0),
    );
  });

  it('rounds to the six decimals the column stores', () => {
    const v = estimateCostUsd('claude-sonnet-5', 1234, 567);
    expect(v).toBe(Math.round(v * 1_000_000) / 1_000_000);
  });

  it('is zero for zero tokens', () => {
    expect(estimateCostUsd('claude-opus-5', 0, 0)).toBe(0);
  });
});
