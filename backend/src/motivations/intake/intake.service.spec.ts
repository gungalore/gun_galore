import { ConflictException } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from '../motivation-sheet.service';
import { fieldByKey } from '../motivation-fields';
import { missingDetail } from '../motivation-completeness';
import type { IntakeState } from './intake.types';
import { MotivationIntakeService } from './intake.service';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE INTAKE SERVICE'S NEW DOORS.
 *
 * The narrative is drafted, never asked; Back re-opens an earlier topic; the
 * review screen saves corrections and the narrative follows. These specs pin
 * the service half of that: the background trigger + `drafting` flag, `finish()`
 * drafting before it refuses, `cardForTopic`, and `patchAnswers`.
 * ────────────────────────────────────────────────────────────────────────────
 */

const SHEET = {
  application: {
    id: 'mo-1',
    referenceNumber: 'MO1',
    licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
    licenceTypeLabel: 'Section 16',
    label: null,
    title: 'MO1',
    status: 'DRAFT',
    declarationAcceptedAt: null,
    templateLayout: null,
    templateColourway: null,
  },
  sections: [],
  items: [],
  documents: [],
  needs: { needs: [], missingRequired: [] },
  credentials: {},
  coverage: {},
  overlap: { verdict: { kind: 'none' }, prompt: null, suggestedAngle: null },
  preview: [],
  missing: [],
  ownedRows: [],
} as unknown as SheetResponse;

const STATE = {
  motivationId: 'mo-1',
  referenceNumber: 'MO1',
  stage: 'INTERVIEW',
  group: null,
  question: null,
} as unknown as IntakeState;

const FACTUAL: Record<string, string> = {
  full_name: 'A B',
  id_number: '8001015009087',
  licence_holder_type: 'Main firearm licence holder',
  occupation: 'Engineer',
  marital_status: 'Married',
  spouse_name: 'C D',
  firearm_type: 'Rifle',
  firearm_action: 'Bolt action',
  firearm_make: 'Marlin',
  firearm_model: 'NONE',
  firearm_calibre: '.45-70 Government',
  firearm_serial: 'MR1',
  alternative_considered: 'A .308 Winchester',
  competency_number: 'C1',
  competency_for: 'Manual rifle',
  competency_issued: '2020-01-01',
  residential_address: '1 Main Road',
  residence_type: 'Townhouse or complex',
  has_existing_firearms: 'No',
  association_name: 'SA Hunters',
  association_number: 'M-1',
  association_joined: '2018-01-01',
  association_expiry: '2027-01-01',
  dedicated_since: '2019-01-01',
  discipline_exercise: '100m exercise',
  intended_quarry: 'Kudu',
  premises_enclosure: 'Walled with a gate',
  safe_present: 'No',
};

/** Every detail gap the generation gate can name, filled iteratively. */
function completeAnswers(
  type: MotivationLicenceType = MotivationLicenceType.S16_DEDICATED_HUNTER,
): Record<string, string> {
  const answers: Record<string, string> = { ...FACTUAL };
  for (let pass = 0; pass < 3; pass += 1) {
    for (const gap of missingDetail(answers, type)) {
      const key = gap.code.slice(gap.code.indexOf(':') + 1);
      if (answers[key]) continue;
      const field = fieldByKey(type, key);
      if (!field) continue;
      if (key === 'shooting_history') {
        answers[key] = Array.from({ length: 60 }, () => 'word').join(' ');
      } else if (key === 'continued_use') {
        answers[key] = Array.from({ length: 20 }, () => 'word').join(' ');
      } else if (field.kind === 'date') {
        answers[key] = '2020-01-01';
      } else if (field.kind === 'yesno') {
        answers[key] = 'No';
      } else if (field.kind === 'choice') {
        answers[key] = field.choices?.[0] ?? 'Other';
      } else if (field.kind === 'cards') {
        answers[key] = field.options?.[0]?.key ?? 'other';
      } else if (field.kind === 'multi') {
        answers[key] = field.choices?.[0] ?? 'Other';
      } else {
        answers[key] = 'A real answer';
      }
    }
  }
  return answers;
}

interface HarnessOptions {
  answers?: Record<string, string>;
  provenance?: Record<string, unknown>;
  intakeCompletedAt?: Date | null;
  drafting?: boolean;
}

function harness(options: HarnessOptions = {}) {
  let answers: Record<string, string> = { ...(options.answers ?? {}) };
  const ROW = {
    id: 'mo-1',
    referenceNumber: 'MO1',
    licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
    answersEncrypted: null,
    intakeMode: 'INTERVIEW',
    outputMode: 'MOTIVATION_ONLY',
    intakeStartedAt: new Date(),
    intakeDocumentsAt: new Date(),
    intakeCompletedAt:
      options.intakeCompletedAt === undefined
        ? null
        : options.intakeCompletedAt,
    interviewEncrypted: null,
    answerProvenance: (options.provenance ?? {}) as unknown,
    status: 'DRAFT',
    intakeBriefEncrypted: null,
    intakeBriefVersion: null,
    intakeBriefHash: null,
    intakeBriefAt: null,
  };
  const saves: Record<string, string>[] = [];
  const updates: Record<string, unknown>[] = [];
  const ensureCalls: { id: string; force?: boolean }[] = [];
  const ensureDeterministicCalls: string[] = [];

  const svc = Object.create(
    MotivationIntakeService.prototype,
  ) as MotivationIntakeService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    // Class field initialisers do not run through Object.create.
    speciesCache: new Map(),
    prisma: {
      motivation: {
        findFirst: async () => ROW,
        findUnique: async () => ROW,
        update: async (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return ROW;
        },
      },
    },
    sheets: { sheetFor: async () => SHEET },
    shared: {
      requireUser: async () => ({ id: 'user-1' }),
      answersFor: async () => ({ ...answers }),
    },
    documents: { library: async () => ({ items: [], suggested: [] }) },
    motivations: {
      saveAnswers: async (
        _u: string,
        _i: string,
        patch: Record<string, string>,
      ) => {
        saves.push(patch);
        answers = { ...answers, ...patch };
        return { refused: [] as string[], changed: Object.keys(patch) };
      },
      confirmAnswer: async () => undefined,
      autolink: async () => undefined,
    },
    agent: {
      phrase: async () => null,
      choicesFor: async () => [],
      extractFacts: async () => ({}),
    },
    briefs: {
      current: () => null,
      ensure: () => undefined,
      ensureNow: async () => null,
    },
    drafts: {
      ensure: async (idOrUser: string, motivationId?: string, opts?: { force?: boolean }) => {
        ensureCalls.push({
          id: motivationId ?? idOrUser,
          force: opts?.force,
        });
        return { drafted: 0, failed: 0 };
      },
      ensureDeterministic: async (motivationId: string) => {
        ensureDeterministicCalls.push(motivationId);
        return { drafted: 0, failed: 0 };
      },
      isDrafting: () => options.drafting === true,
      ensureIfDrafted: async () => undefined,
    },
    llm: {
      isConfigured: () => false,
      isConfiguredFor: () => false,
      complete: async () => ({ text: '{}' }),
    },
    logger: { warn: () => undefined, log: () => undefined },
    documentState: () => ({
      items: [],
      missing: [],
      needs: [],
      attached: 0,
      required: 0,
      sourceProofAttached: false,
      firearmKnown: false,
    }),
    evidenceState: () => ({
      items: [],
      groups: [],
      note: '',
      ready: true,
    }),
    topicState: () => null,
    phrasedGroup: async () => ({
      group: {
        id: 'identity' as const,
        title: 'About you',
        index: 1,
        total: 3,
        answered: 0,
        totalInGroup: 4,
      },
      questions: [],
      acknowledgement: undefined,
      correction: undefined,
    }),
    state: async () => STATE,
  });

  return {
    svc,
    ensureCalls,
    ensureDeterministicCalls,
    saves,
    updates,
    row: ROW,
    answers: () => ({ ...answers }),
    setAnswers: (next: Record<string, string>) => {
      answers = next;
    },
  };
}

describe('the species advisory follows the chosen cartridge', () => {
  it('asks about the cartridge, not the typed family, and caches under it', async () => {
    const h = harness({});
    const calls: Record<string, unknown>[] = [];
    Object.assign(
      (h.svc as unknown as { llm: Record<string, unknown> }).llm,
      {
        isConfigured: () => true,
        complete: async (req: Record<string, unknown>) => {
          calls.push(req);
          return {
            text: JSON.stringify({
              choices: [{ value: 'Kudu', label: 'Kudu' }],
            }),
          };
        },
      },
    );
    const speciesChoices = (
      h.svc as unknown as {
        speciesChoices: (
          answers: Record<string, string>,
        ) => Promise<{ value: string }[]>;
      }
    ).speciesChoices.bind(h.svc);

    const answers = {
      firearm_type: 'Rifle',
      firearm_action: 'Bolt action',
      firearm_calibre: '6.5',
      firearm_cartridge: '6,5 Creedmoor',
    };
    const choices = await speciesChoices(answers);
    expect(choices[0].value).toBe('Kudu');
    expect(JSON.stringify(calls[0])).toContain('6,5 Creedmoor');

    // The cache key includes the cartridge: a second call is free.
    await speciesChoices(answers);
    expect(calls).toHaveLength(1);
  });

  it('falls back to the typed calibre when no cartridge was chosen', async () => {
    const h = harness({});
    const calls: Record<string, unknown>[] = [];
    Object.assign(
      (h.svc as unknown as { llm: Record<string, unknown> }).llm,
      {
        isConfigured: () => true,
        complete: async (req: Record<string, unknown>) => {
          calls.push(req);
          return { text: JSON.stringify({ choices: [] }) };
        },
      },
    );
    await (
      h.svc as unknown as {
        speciesChoices: (answers: Record<string, string>) => Promise<unknown>;
      }
    ).speciesChoices({ firearm_calibre: '6.5', firearm_type: 'Rifle' });
    expect(JSON.stringify(calls[0])).toContain('6.5');
  });
});

describe('state() drafts the narrative in the background', () => {
  it('fires the drafter and reports the drafting flag', async () => {
    // Only the narrative is missing: every factual gap the gate names is
    // filled, which is the condition that makes the draft specific to this
    // application rather than a generic paragraph.
    const answers = completeAnswers();
    delete answers.shooting_history;
    const h = harness({ drafting: true, answers });
    // stateInternal is the implementation behind GET :id/intake; calling it
    // directly keeps the harness's `state` stub out of the way.
    const state = await (
      h.svc as unknown as {
        stateInternal: (u: string, i: string) => Promise<IntakeState>;
      }
    ).stateInternal('user-1', 'mo-1');

    expect(h.ensureCalls.length).toBeGreaterThanOrEqual(1);
    // Background: no force (the explicit button is what forces).
    expect(h.ensureCalls[0].force).toBeFalsy();
    expect(state.drafting).toBe(true);
    // The navigation target is computed server-side, not from browser state.
    expect(state.navigation).toBeDefined();
  });

  it('does not fire while a factual answer is still missing', async () => {
    const answers = completeAnswers();
    delete answers.shooting_history;
    delete answers.firearm_make;
    const h = harness({ answers });
    await (
      h.svc as unknown as {
        stateInternal: (u: string, i: string) => Promise<IntakeState>;
      }
    ).stateInternal('user-1', 'mo-1');
    // Drafting before the firearm is described is how the first cut produced a
    // paragraph that was not about the application.
    expect(h.ensureCalls).toHaveLength(0);
  });

  it('fires for a REVIEW-stage application whose intake is already complete', async () => {
    // The operator's own MO000158: intakeCompletedAt set, status DRAFT, sitting
    // at REVIEW. The review screen needs the drafted rows to appear there.
    const answers = completeAnswers();
    delete answers.shooting_history;
    const h = harness({
      answers,
      intakeCompletedAt: new Date(),
      drafting: true,
    });
    const state = await (
      h.svc as unknown as {
        stateInternal: (u: string, i: string) => Promise<IntakeState>;
      }
    ).stateInternal('user-1', 'mo-1');
    expect(state.drafting).toBe(true);
    expect(h.ensureCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not fire when nothing is left to draft', async () => {
    const h = harness({
      answers: {
        ...completeAnswers(),
        shooting_history: Array.from({ length: 60 }, () => 'word').join(' '),
        training_history: 'Training.',
        hunt_game_class: 'plains_medium',
        hunt_terrain: 'bushveld',
        hunt_where: 'bushveld',
        hunt_reasons: 'I hunt for the meat.',
        hunting_history: 'A record.',
        sport_reasons: 'Club shooting.',
        sport_formats: 'Postal.',
        competition_record: 'A record.',
        activity_record: 'A record.',
        alternative_considered: 'I considered a .308, and chose this one.',
        firearm_use_kind: 'both',
      },
    });
    await (
      h.svc as unknown as {
        stateInternal: (u: string, i: string) => Promise<IntakeState>;
      }
    ).stateInternal('user-1', 'mo-1');
    expect(h.ensureCalls).toHaveLength(0);
  });
});

describe('finish() drafts before it refuses', () => {
  it('waits for the draft and then closes the interview', async () => {
    const answers = completeAnswers();
    delete answers.shooting_history;
    const h = harness({ answers });
    // The drafter lands the paragraph while finish() waits on it.
    (h.svc as unknown as { drafts: { ensure: unknown } }).drafts.ensure = async () => {
      h.setAnswers({
        ...answers,
        shooting_history: Array.from({ length: 60 }, () => 'word').join(' '),
      });
      return { drafted: 1, failed: 0 };
    };

    const state = await h.svc.finish('user-1', 'mo-1');

    expect(state).toBe(STATE);
    expect(h.updates.some((update) => update.intakeCompletedAt instanceof Date)).toBe(
      true,
    );
    expect(h.ensureDeterministicCalls).toHaveLength(0);
  });

  it('uses the deterministic fallback when the model produced nothing', async () => {
    const answers = completeAnswers();
    delete answers.shooting_history;
    const h = harness({ answers });
    let deterministicCalls = 0;
    (h.svc as unknown as { drafts: { ensureDeterministic: unknown } }).drafts.ensureDeterministic =
      async () => {
        deterministicCalls += 1;
        h.setAnswers({
          ...answers,
          shooting_history: Array.from({ length: 60 }, () => 'word').join(' '),
        });
        return { drafted: 1, failed: 0 };
      };

    const state = await h.svc.finish('user-1', 'mo-1');
    expect(state).toBe(STATE);
    expect(deterministicCalls).toBe(1);
  });

  it('still refuses a real non-narrative gap with the existing message', async () => {
    const answers = completeAnswers();
    // Fill the narrative so the fallback is not the reason for the refusal.
    answers.shooting_history = Array.from({ length: 60 }, () => 'word').join(' ');
    delete answers.firearm_make;
    const h = harness({ answers });

    let error: ConflictException | undefined;
    try {
      await h.svc.finish('user-1', 'mo-1');
    } catch (err) {
      error = err as ConflictException;
    }
    expect(error).toBeInstanceOf(ConflictException);
    const body = error!.getResponse() as {
      code: string;
      missingDetail: { code: string }[];
    };
    expect(body.code).toBe('motivation-needs-detail');
    expect(body.missingDetail.map((gap) => gap.code)).toContain(
      'firearm:firearm_make',
    );
    // The narrative path was not consulted — a factual gap is not a fallback.
    expect(h.ensureDeterministicCalls).toHaveLength(0);
  });
});

describe('cardForTopic — Back re-opens an earlier card with its answers', () => {
  it('serves the topic’s card and the navigation target', async () => {
    const answers = {
      ...FACTUAL,
      firearm_use_kind: 'hunting',
    };
    // Leave the safe-storage question outstanding so a topic before it has a
    // Back target. (The premises block is no longer asked on S16, so it cannot
    // serve as that pending topic any more.)
    delete (answers as Record<string, string | undefined>).safe_present;
    const h = harness({ answers });
    Object.assign(h.svc as unknown as Record<string, unknown>, {
      phrasedCard: async (
        _row: unknown,
        _answers: unknown,
        _previousAnswer: unknown,
        _previousFieldKey: unknown,
        _brief: unknown,
        bases: { fieldKey: string }[],
      ) => ({ questions: bases }),
    });

    const card = await h.svc.cardForTopic('user-1', 'mo-1', 'identity');

    expect(card.group?.id).toBe('identity');
    expect(card.group?.questions.map((question) => question.fieldKey)).toEqual(
      expect.arrayContaining(['full_name', 'id_number']),
    );
    // The questions arrive built by the one builder, so the saved answers are
    // already on them.
    const fullName = card.group?.questions.find(
      (question) => question.fieldKey === 'full_name',
    );
    expect(fullName?.value).toBe('A B');
    expect(card.navigation).toEqual(
      expect.objectContaining({ back: expect.anything() }),
    );
  });

  it('falls back to the normal next card for a topic with no questions', async () => {
    const h = harness({ answers: {} });
    Object.assign(h.svc as unknown as Record<string, unknown>, {
      stateInternal: async () => ({
        ...STATE,
        group: { id: 'identity', questions: [] },
        navigation: { back: null },
      }),
    });
    const card = await h.svc.cardForTopic('user-1', 'mo-1', 'not-a-topic');
    expect(card.group?.id).toBe('identity');
    expect(card.navigation).toEqual({ back: null });
  });
});

describe('patchAnswers — the review screen saves corrections', () => {
  it('saves only clean, visible answers, then re-drafts in the background', async () => {
    // Every factual answer is in and only the narrative is missing, so the
    // edit to a draft fact must queue the re-draft.
    const answers = completeAnswers();
    delete answers.shooting_history;
    const h = harness({
      answers,
      provenance: {
        shooting_history: {
          source: 'DRAFTED',
          from: 'your documents and your application',
          at: new Date().toISOString(),
          inferred: true,
        },
      },
    });
    const state = await h.svc.patchAnswers('user-1', 'mo-1', {
      full_name: 'A B',
      occupation: 'Farmer',
      // formOnly (a SAPS 271 box we no longer ask) — dropped.
      competency_expires: '2030-01-01',
      not_a_key: 'x',
      bad: 42 as unknown as string,
    } as Record<string, string>);

    expect(state).toBe(STATE);
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]).toEqual({ full_name: 'A B', occupation: 'Farmer' });
    // A DRAFTED value exists, so the narrative follows the changed fact in the
    // background (the caller does not wait on the model).
    expect(h.ensureCalls.some((call) => call.force === true)).toBe(true);
  });

  it('refuses an empty or entirely invalid patch', async () => {
    const h = harness({ answers: {} });
    await expect(
      h.svc.patchAnswers('user-1', 'mo-1', { not_a_key: 'x' }),
    ).rejects.toThrow(/nothing on that card/i);
    expect(h.saves).toHaveLength(0);
  });

  it('does not start a model call when nothing was drafted', async () => {
    const h = harness({ answers: {} });
    await h.svc.patchAnswers('user-1', 'mo-1', { occupation: 'Farmer' });
    expect(h.ensureCalls).toHaveLength(0);
  });

  it('drops a hidden conditional field', async () => {
    const h = harness({ answers: { safe_present: 'No' } });
    await h.svc.patchAnswers('user-1', 'mo-1', {
      // safe_type only shows when safe_present = Yes.
      safe_type: 'Rifle safe',
      occupation: 'Farmer',
    });
    expect(h.saves[0]).toEqual({ occupation: 'Farmer' });
  });
});
