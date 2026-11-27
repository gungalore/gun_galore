process.env.ID_HASH_SECRET = 'test-secret-for-the-narrative-drafter';

import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { decryptJson, encryptJson } from '../../common/blob-crypto';
import type { AnswerProvenance, ProvenanceMap } from '../../common/answer-provenance';
import { fallbackDraft, type DraftFacts } from './intake-draft';
import {
  MotivationNarrativeDraftService,
  parseDraftReply,
} from './intake-draft.service';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE NARRATIVE DRAFTER — the service half.
 *
 * The model is a stub here on purpose: what is under test is the contract
 * around it — never overwrite a MEMBER answer, re-draft only our own DRAFTED
 * values, one call per application, fail into the deterministic fallback, and
 * never loop on a polled GET.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TYPE = MotivationLicenceType.S16_DEDICATED_HUNTER;
const FACTS = {
  licence_type: 'Section 16',
  licence_type_key: TYPE,
  purpose: 'hunting',
  firearm: {},
  association: {},
  held_firearms: [],
  premises: {},
  documents: [],
  narrative_so_far: {},
} as DraftFacts;

/** A paragraph that passes validateDraft, so a model reply can be accepted. */
const VALID_HISTORY = `${fallbackDraft('shooting_history', FACTS)} I keep a written record of my practice.`;
const VALID_CONTINUED = fallbackDraft('continued_use', {
  ...FACTS,
  licence_type_key: MotivationLicenceType.S24_RENEWAL,
} as DraftFacts)!;

const draftStamp = (): AnswerProvenance => ({
  source: 'DRAFTED',
  from: 'your documents and your application',
  at: new Date().toISOString(),
  inferred: true,
});

const memberStamp = (): AnswerProvenance => ({
  source: 'MEMBER',
  from: 'You entered this',
  at: new Date().toISOString(),
});

interface HarnessOptions {
  type?: MotivationLicenceType;
  answers?: Record<string, string>;
  provenance?: ProvenanceMap;
  /** Model replies, in order. A string is returned as-is, an Error is thrown. */
  replies?: (string | Error)[];
  configured?: boolean;
  status?: MotivationStatus;
}

function harness(options: HarnessOptions = {}) {
  const type = options.type ?? TYPE;
  const row = {
    id: 'mo-1',
    licenceType: type,
    status: options.status ?? MotivationStatus.DRAFT,
    answersEncrypted: encryptJson({ ...(options.answers ?? {}) }),
    answerProvenance: (options.provenance ?? {}) as unknown,
  };
  const updates: Record<string, unknown>[] = [];
  const calls: Record<string, unknown>[] = [];
  const replies = [...(options.replies ?? [])];

  const svc = Object.create(
    MotivationNarrativeDraftService.prototype,
  ) as MotivationNarrativeDraftService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    // Class field initialisers do not run through Object.create; the in-process
    // guards are the point of several of these specs, so they are created here.
    inFlight: new Map(),
    lastAttemptAt: new Map(),
    stalled: new Map(),
    prisma: {
      motivation: {
        findFirst: async () => ({ ...row }),
        update: async (args: {
          data: { answersEncrypted?: string; answerProvenance?: unknown };
        }) => {
          updates.push(args.data);
          if (args.data.answersEncrypted !== undefined) {
            row.answersEncrypted = args.data.answersEncrypted;
          }
          if (args.data.answerProvenance !== undefined) {
            row.answerProvenance = args.data.answerProvenance;
          }
          return { ...row };
        },
      },
      motivationUpload: { findMany: async () => [] },
    },
    shared: {
      requireUser: async () => ({ id: 'user-1' }),
      answersFor: async (_u: string, blob: string | null) => ({
        ...decryptJson<Record<string, string>>(blob ?? ''),
      }),
      readAnswers: (blob: string | null) => ({
        ...decryptJson<Record<string, string>>(blob ?? ''),
      }),
    },
    llm: {
      isConfiguredFor: () => options.configured !== false,
      complete: async (req: Record<string, unknown>) => {
        calls.push(req);
        const reply = replies.length ? replies.shift()! : '{}';
        if (reply instanceof Error) throw reply;
        return { text: reply };
      },
    },
    logger: { warn: () => undefined, log: () => undefined },
  });

  return {
    svc,
    calls,
    updates,
    row,
    answers: () =>
      decryptJson<Record<string, string>>(row.answersEncrypted ?? ''),
    provenance: () =>
      (row.answerProvenance ?? {}) as ProvenanceMap,
    /** A full answer set leaves no narrative target: nothing to do. */
    filledAnswers: (overrides: Record<string, string> = {}) => ({
      shooting_history: VALID_HISTORY,
      training_history: 'Some training.',
      hunt_game_class: 'plains_medium',
      hunt_terrain: 'bushveld',
      hunt_where: 'bushveld',
      hunt_reasons: 'I hunt for the meat.',
      hunting_history: 'A record.',
      ...overrides,
    }),
  };
}

describe('the narrative drafter fills the answers the interview never asks', () => {
  it('writes a validated draft as DRAFTED + inferred', async () => {
    const h = harness({
      replies: [JSON.stringify({ drafts: [{ key: 'shooting_history', text: VALID_HISTORY }] })],
    });

    const result = await h.svc.ensure('user-1', 'mo-1');

    expect(result.drafted).toBe(1);
    expect(h.calls).toHaveLength(1);
    expect(h.updates).toHaveLength(1);
    const provenance = h.provenance();
    expect(provenance.shooting_history).toMatchObject({
      source: 'DRAFTED',
      inferred: true,
      from: 'your documents and your application',
    });
    expect(h.answers().shooting_history).toBe(VALID_HISTORY);
  });

  it('never overwrites a MEMBER answer — including one the member cleared', async () => {
    for (const value of ['My own words about the shooting I do.', '']) {
      const h = harness({
        answers: { shooting_history: value },
        provenance: { shooting_history: memberStamp() },
        configured: false,
      });
      const result = await h.svc.ensure('user-1', 'mo-1');
      expect(result.drafted).toBe(0);
      expect(h.updates).toHaveLength(0);
      expect(h.answers().shooting_history ?? '').toBe(value);
      expect(h.provenance().shooting_history?.source).toBe('MEMBER');
    }
  });

  it('does nothing at all when every narrative field is answered', async () => {
    const h = harness({
      answers: {
        firearm_use_kind: 'hunting',
        shooting_history: VALID_HISTORY,
        training_history: 'Training.',
        hunt_game_class: 'plains_medium',
        hunt_terrain: 'bushveld',
        hunt_where: 'bushveld',
        hunt_reasons: 'I hunt for the meat.',
        hunting_history: 'A record.',
      },
    });
    const result = await h.svc.ensure('user-1', 'mo-1');
    expect(result).toEqual({ drafted: 0, failed: 0 });
    expect(h.calls).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it('re-drafts ONLY values it wrote itself when forced', async () => {
    const h = harness({
      answers: {
        firearm_use_kind: 'hunting',
        shooting_history: VALID_HISTORY,
        training_history: 'MEMBER TRAINING WORDS',
        hunt_game_class: 'plains_medium',
        hunt_terrain: 'bushveld',
        hunt_where: 'bushveld',
        hunt_reasons: 'I hunt for the meat.',
        hunting_history: 'A record.',
      },
      provenance: {
        shooting_history: draftStamp(),
        training_history: memberStamp(),
      },
      replies: [
        JSON.stringify({
          drafts: [{ key: 'shooting_history', text: `${VALID_HISTORY} I still practise.` }],
        }),
      ],
    });

    // Not forced: a filled DRAFTED value is not a target.
    expect(await h.svc.ensure('user-1', 'mo-1')).toEqual({ drafted: 0, failed: 0 });
    expect(h.calls).toHaveLength(0);

    const forced = await h.svc.ensure('user-1', 'mo-1', { force: true });
    expect(forced.drafted).toBe(1);
    expect(h.answers().shooting_history).toContain('I still practise');
    // The member's own training history was not a target and is untouched.
    expect(h.answers().training_history).toBe('MEMBER TRAINING WORDS');
    expect(h.provenance().training_history?.source).toBe('MEMBER');
  });

  it('falls back deterministically when the model is not configured', async () => {
    const h = harness({ configured: false, type: MotivationLicenceType.S13_SELF_DEFENCE });
    const result = await h.svc.ensure('user-1', 'mo-1');
    expect(h.calls).toHaveLength(0);
    expect(result.drafted).toBe(1);
    expect(h.answers().shooting_history).toBe(
      fallbackDraft('shooting_history', {
        ...FACTS,
        licence_type_key: MotivationLicenceType.S13_SELF_DEFENCE,
      } as DraftFacts),
    );
    expect(h.provenance().shooting_history?.source).toBe('DRAFTED');
  });

  it('falls back when the model call throws, and never throws at the caller', async () => {
    const h = harness({
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      replies: [new Error('provider down')],
    });
    const result = await h.svc.ensure('user-1', 'mo-1');
    expect(result.drafted).toBe(1);
    expect(h.answers().shooting_history).toBeTruthy();
  });

  it('retries once and tells the model what the validator refused', async () => {
    const h = harness({
      replies: [
        JSON.stringify({ drafts: [{ key: 'shooting_history', text: 'At the range in 2019.' }] }),
        JSON.stringify({ drafts: [{ key: 'shooting_history', text: VALID_HISTORY }] }),
      ],
    });
    const result = await h.svc.ensure('user-1', 'mo-1');
    expect(result.drafted).toBe(1);
    expect(h.calls).toHaveLength(2);
    const retryPrompt = JSON.stringify(h.calls[1]);
    expect(retryPrompt).toContain('rejected');
    expect(retryPrompt).toContain('digit');
    expect(h.answers().shooting_history).toBe(VALID_HISTORY);
  });

  it('never writes a key that was not a target', async () => {
    const h = harness({
      replies: [
        JSON.stringify({
          drafts: [
            { key: 'shooting_history', text: VALID_HISTORY },
            { key: 'id_number', text: '8001015009087' },
          ],
        }),
      ],
    });
    await h.svc.ensure('user-1', 'mo-1');
    expect(h.answers()).not.toHaveProperty('id_number');
  });
});

describe('the narrative drafter does not loop', () => {
  it('returns the same in-flight promise, so two callers cost one call', async () => {
    let release: (value: { text: string }) => void = () => undefined;
    const pending = new Promise<{ text: string }>((resolve) => {
      release = resolve;
    });
    const h = harness();
    (h.svc as unknown as { llm: { complete: () => Promise<{ text: string }> } }).llm.complete =
      () => {
        h.calls.push({});
        return pending;
      };

    const first = h.svc.ensure('user-1', 'mo-1');
    const second = h.svc.ensure('user-1', 'mo-1');
    expect(second).toBe(first);
    expect(h.svc.isDrafting('mo-1')).toBe(true);
    release({ text: '{}' });
    await first;
    expect(h.calls).toHaveLength(1);
    expect(h.svc.isDrafting('mo-1')).toBe(false);
  });

  it('does not re-attempt a failed target set on every poll', async () => {
    const h = harness({ replies: ['{}', '{}'] });
    const first = await h.svc.ensure('user-1', 'mo-1');
    expect(first.drafted).toBe(1); // the deterministic shooting history
    const updatesAfterFirst = h.updates.length;

    // Same facts, still nothing usable from the model for the remaining keys:
    // the stalled guard must stop a second paid call.
    await h.svc.ensure('user-1', 'mo-1');
    expect(h.updates.length).toBe(updatesAfterFirst);
  });

  it('does not re-draft inside the background cooldown', async () => {
    const h = harness({
      answers: { firearm_calibre: '6.5' },
      replies: ['{}', '{}'],
    });
    // A first run with no DRAFTED value in provenance and nothing accepted
    // records the attempt; the immediate second call is inside the cooldown.
    await h.svc.ensure('user-1', 'mo-1');
    await h.svc.ensure('user-1', 'mo-1');
    expect(h.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('the review-screen re-draft trigger', () => {
  it('does nothing when no drafted value exists', async () => {
    const h = harness({ answers: { shooting_history: 'member words' } });
    await h.svc.ensureIfDrafted('user-1', 'mo-1', ['firearm_calibre']);
    expect(h.calls).toHaveLength(0);
  });

  it('does not re-draft when the edit was to a drafted paragraph itself', async () => {
    const h = harness({
      answers: {
        shooting_history: VALID_HISTORY,
        hunt_game_class: 'plains_medium',
      },
      provenance: { shooting_history: draftStamp() },
      replies: ['{}'],
    });
    // A member correcting a typo in the paragraph: not a draftFacts key.
    await h.svc.ensureIfDrafted('user-1', 'mo-1', ['shooting_history']);
    expect(h.calls).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it('re-drafts when a fact the drafter consumed changed', async () => {
    const h = harness({
      answers: {
        shooting_history: VALID_HISTORY,
        hunt_game_class: 'plains_medium',
      },
      provenance: { shooting_history: draftStamp() },
      replies: [
        JSON.stringify({
          drafts: [{ key: 'shooting_history', text: `${VALID_HISTORY} I still practise.` }],
        }),
      ],
    });
    await h.svc.ensureIfDrafted('user-1', 'mo-1', ['firearm_calibre']);
    // The trigger registers the run without waiting for the model (an autosave
    // must not block a minute); awaiting the same in-flight promise lets the
    // spec observe the result.
    await h.svc.ensure('user-1', 'mo-1');
    expect(h.calls).toHaveLength(1);
    expect(h.answers().shooting_history).toContain('I still practise');
  });
});

describe('ensureDeterministic — the finish() backstop', () => {
  it('fills a gated narrative gap without a model call', async () => {
    const h = harness({ configured: false });
    const result = await h.svc.ensureDeterministic('user-1', 'mo-1');
    expect(h.calls).toHaveLength(0);
    expect(result.drafted).toBeGreaterThanOrEqual(1);
    expect(h.answers().shooting_history).toContain('I was introduced to');
  });

  it('never replaces the member’s own short answer', async () => {
    const h = harness({
      answers: { shooting_history: 'At the range most weekends' },
      provenance: { shooting_history: memberStamp() },
      configured: false,
    });
    const result = await h.svc.ensureDeterministic('user-1', 'mo-1');
    expect(result.drafted).toBe(0);
    expect(h.answers().shooting_history).toBe('At the range most weekends');
    expect(h.provenance().shooting_history?.source).toBe('MEMBER');
  });
});

describe('parseDraftReply', () => {
  it('reads text and choices, trimming what the model returned', () => {
    expect(
      parseDraftReply(
        JSON.stringify({
          drafts: [
            { key: 'shooting_history', text: ' A paragraph. ' },
            { key: 'hunt_terrain', choices: [' bushveld ', 'karoo'] },
          ],
        }),
      ),
    ).toEqual({
      shooting_history: 'A paragraph.',
      hunt_terrain: 'bushveld, karoo',
    });
  });

  it('tolerates prose around the JSON and returns {} on nonsense', () => {
    expect(
      parseDraftReply('Here you go:\n{"drafts":[{"key":"k","text":"v"}]}\nDone.'),
    ).toEqual({ k: 'v' });
    expect(parseDraftReply('not json at all')).toEqual({});
    expect(parseDraftReply('')).toEqual({});
  });
});
