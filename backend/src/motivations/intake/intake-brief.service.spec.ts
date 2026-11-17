import { MotivationLicenceType } from '@prisma/client';
import { decryptJson, encryptJson } from '../../common/blob-crypto';
import {
  MotivationIntakeBriefService,
  parseBriefPayload,
} from './intake-brief.service';
import { INTERVIEW_BRIEF_VERSION, briefHash } from './intake-brief';

const TYPE = MotivationLicenceType.S16_DEDICATED_HUNTER;
const ANSWERS = {
  firearm_type: 'Rifle',
  firearm_make: 'Tikka',
  firearm_model: 'T3x',
  firearm_calibre: '.30-06 Springfield',
  firearm_use_kind: 'hunting',
};

const PAYLOAD = JSON.stringify({
  questions: [
    {
      fieldKey: 'intended_quarry',
      question: 'What do you hunt with your Tikka .30-06?',
      why: 'The DFO reads the quarry against the cartridge.',
    },
  ],
  chips: [
    {
      fieldKey: 'intended_quarry',
      choices: [
        { value: 'Kudu', label: 'Kudu' },
        { value: 'Impala', label: 'Impala' },
        { value: 'Warthog', label: 'Warthog' },
      ],
    },
  ],
  facts: [{ label: 'Home province', value: 'Free State' }],
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeService(opts: {
  complete?: () => Promise<{ text: string }>;
  research?: () => Promise<unknown>;
  configured?: boolean;
} = {}) {
  const updates: { where: { id: string }; data: Record<string, unknown> }[] = [];
  const prisma = {
    motivation: {
      update: async (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        updates.push(args);
        return {};
      },
    },
  };
  const llm = {
    isConfiguredFor: () => opts.configured ?? true,
    complete: opts.complete ?? (async () => ({ text: PAYLOAD })),
  };
  const research = {
    researchFor: opts.research ?? (async () => ({})),
  };
  const service = new MotivationIntakeBriefService(
    prisma as never,
    llm as never,
    research as never,
  );
  return { service, updates };
}

const storedFrom = (
  data: Record<string, unknown>,
): {
  intakeBriefEncrypted: string | null;
  intakeBriefVersion: string | null;
  intakeBriefHash: string | null;
  intakeBriefAt: Date | null;
} => ({
  intakeBriefEncrypted: data.intakeBriefEncrypted as string,
  intakeBriefVersion: data.intakeBriefVersion as string,
  intakeBriefHash: data.intakeBriefHash as string,
  intakeBriefAt: data.intakeBriefAt as Date,
});

const EMPTY = {
  intakeBriefEncrypted: null,
  intakeBriefVersion: null,
  intakeBriefHash: null,
  intakeBriefAt: null,
};

describe('the brief service', () => {
  const originalSecret = process.env.ID_HASH_SECRET;
  beforeAll(() => {
    process.env.ID_HASH_SECRET = 'test-secret-for-the-interview-brief';
  });
  afterAll(() => {
    process.env.ID_HASH_SECRET = originalSecret;
  });

  it('ignores a stored brief built from different facts', () => {
    const { service } = makeService();
    const stored = {
      intakeBriefEncrypted: encryptJson({ hash: 'other' }),
      intakeBriefVersion: INTERVIEW_BRIEF_VERSION,
      intakeBriefHash: 'other',
      intakeBriefAt: new Date(),
    };
    expect(service.current(stored, briefHash(TYPE, ANSWERS))).toBeNull();
  });

  it('builds a researched brief from one model call', async () => {
    const { service } = makeService();
    const brief = await service.build(TYPE, ANSWERS, 'h');
    expect(brief.researched).toBe(true);
    expect(brief.questions[0].fieldKey).toBe('intended_quarry');
    expect(brief.chips.intended_quarry).toHaveLength(3);
  });

  it('falls back to the deterministic brief when the model fails', async () => {
    const { service } = makeService({
      complete: async () => {
        throw new Error('model is down');
      },
    });
    const brief = await service.build(TYPE, ANSWERS, 'h');
    expect(brief.researched).toBe(false);
    expect(brief.questions.length).toBeGreaterThan(0);
  });

  it('never calls the model when the purpose is not configured', async () => {
    let calls = 0;
    const { service } = makeService({
      configured: false,
      complete: async () => {
        calls += 1;
        return { text: PAYLOAD };
      },
    });
    const brief = await service.build(TYPE, ANSWERS, 'h');
    expect(calls).toBe(0);
    expect(brief.researched).toBe(false);
  });

  it('stores the brief encrypted, and serves it back for the same hash', async () => {
    const { service, updates } = makeService();
    service.ensure({
      motivationId: 'mo-1',
      licenceType: TYPE,
      answers: ANSWERS,
      stored: EMPTY,
    });
    await flush();
    await flush();
    expect(updates).toHaveLength(1);
    const data = updates[0].data;
    expect(String(data.intakeBriefEncrypted)).not.toContain('Tikka');

    const served = service.current(
      storedFrom(data),
      briefHash(TYPE, ANSWERS),
    );
    expect(served?.questions[0].fieldKey).toBe('intended_quarry');
    expect(served?.facts.map((f) => f.label)).toContain('Calibre');
  });

  it('builds once while a build is already in flight', async () => {
    let researchCalls = 0;
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { service } = makeService({
      research: async () => {
        researchCalls += 1;
        return gate;
      },
    });
    const args = {
      motivationId: 'mo-1',
      licenceType: TYPE,
      answers: ANSWERS,
      stored: EMPTY,
    };
    service.ensure(args);
    service.ensure(args);
    await flush();
    release({});
    await flush();
    await flush();
    expect(researchCalls).toBe(1);
  });

  it('does nothing when the feature is switched off', async () => {
    process.env.INTERVIEW_BRIEF = 'off';
    try {
      const { service, updates } = makeService();
      service.ensure({
        motivationId: 'mo-1',
        licenceType: TYPE,
        answers: ANSWERS,
        stored: EMPTY,
      });
      await flush();
      expect(updates).toHaveLength(0);
    } finally {
      delete process.env.INTERVIEW_BRIEF;
    }
  });

  it('parses a payload wrapped in prose', () => {
    expect(
      parseBriefPayload('Here you go:\n{"questions":[]}\nDone.'),
    ).toEqual({ questions: [] });
    expect(parseBriefPayload('no json here')).toBeNull();
  });
});
