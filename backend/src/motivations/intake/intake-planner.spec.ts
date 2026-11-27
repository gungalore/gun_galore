import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from '../motivation-sheet.service';
import {
  GROUP_CAP,
  navigationFor,
  pendingFields,
  planCard,
  planGroup,
  planQuestion,
  purposeForAnswers,
  questionForField,
} from './intake-planner';
import { fieldByKey, fieldsFor, requiredKeys } from '../motivation-fields';
import { sportingFields, strategyFor } from './intake-strategies';
import { topicForField, TOPIC_TITLES } from './intake-topics';
import { missingDetail, MIN_HISTORY_WORDS } from '../motivation-completeness';
import { huntGameClassOptions } from '../motivation-hunt-classes';
import { cartridgeSource } from '../motivation-cartridge';
import { DRAFTED_KEYS, fallbackDraft } from './intake-draft';
import type { InterviewBrief } from './intake-brief';
import type { MotivationField } from '../motivation-fields';

const EMPTY_SHEET = {
  application: {
    id: 'mo-1',
    referenceNumber: 'MO1',
    licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
    licenceTypeLabel: 'Section 16 â€” Dedicated hunting or sport-shooting',
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

const COMMON = {
  firearm_type: 'Rifle',
  firearm_action: 'Bolt action',
  firearm_make: 'Marlin',
  firearm_model: 'NONE',
  firearm_calibre: '.45-70 Government',
  firearm_serial: 'MR1',
  licence_holder_type: 'Main firearm licence holder',
  full_name: 'A B',
  id_number: '8001015009087',
  residential_address: '1 Main Road',
  occupation: 'Engineer',
  // Both are required and neither is form-only any more, so the interview asks
  // them in the identity and address blocks. Answering them here keeps these
  // order tests about the question they name.
  marital_status: 'Married',
  residence_type: 'Townhouse or complex',
  // Required, and asked before the firearm now - see SHOOTING_LIFE_FIELDS.
  // ⚠️ IT MUST CLEAR THE SIXTY-WORD FLOOR. The planner keeps a short history
  // pending (see isPending), so a stub here would sit in front of every order
  // test below and hide the question they actually name.
  shooting_history:
    'My father took me to the range from the age of ten and I have hunted every season since, mostly on a friend farm in the Eastern Cape where we walked and stalked rather than sat in a hide. I shot my first springbok at fourteen and have since taken kudu, impala and warthog with a borrowed .30-06. I joined the local club in my twenties and now shoot a postal target every month, which is how I keep my dedicated status and my marksmanship up between seasons.',
  alternative_considered:
    'A .308 Winchester, because the .45-70 suits the bushveld ranges I actually shoot at.',
  // Optional membership slots two and three: the single-question planner asks
  // them (the grouped card skips optional fields), so an order test that walks
  // past the association block answers them.
  association_2_name: 'Kraaifontein Sport Shooting Club',
  association_2_number: '#2980',
  association_2_joined: '2021-03-28',
  association_3_name: 'SA Hunters',
  association_3_number: 'M-1',
  association_3_joined: '2018-01-01',
  association_3_dedicated_since: '2018-02-01',
  competency_number: 'C1',
  competency_for: 'Manual rifle',
  competency_issued: '2020-01-01',
};

/** All six licence types, for the invariants that must hold for every one. */
const ALL_TYPES = [
  MotivationLicenceType.S13_SELF_DEFENCE,
  MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
  MotivationLicenceType.S15_OCCASIONAL_HUNTER,
  MotivationLicenceType.S16_DEDICATED_HUNTER,
  MotivationLicenceType.S16_DEDICATED_SPORT,
  MotivationLicenceType.S24_RENEWAL,
] as const;

describe('the intake planner', () => {
  it('⚠️ ASKS THE EXISTING-FIREARMS GATE ON A COLD START', () => {
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: COMMON,
      sheet: EMPTY_SHEET,
    });
    expect(pending.map((entry) => entry.key)).toContain(
      'has_existing_firearms',
    );
  });

  it('⚠️ ASKS ONE ROW PER FIREARM ONLY WHEN THE GATE SAYS YES', () => {
    const withTwo = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {
        ...COMMON,
        has_existing_firearms: 'Yes',
        existing_firearm_count: '2',
      },
      sheet: EMPTY_SHEET,
    }).map((entry) => entry.key);
    expect(withTwo).toContain('existing_firearm_1_make');
    expect(withTwo).toContain('existing_firearm_2_calibre');
    expect(withTwo).not.toContain('existing_firearm_3_make');

    const withNone = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: { ...COMMON, has_existing_firearms: 'No' },
      sheet: EMPTY_SHEET,
    }).map((entry) => entry.key);
    expect(withNone.some((key) => key.startsWith('existing_firearm_'))).toBe(
      false,
    );
  });

  it('⚠️ DOES NOT ASK THE GATE WHEN THE VAULT ALREADY FILLED A ROW', () => {
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: { ...COMMON, existing_firearm_1_make: 'Howa' },
      sheet: EMPTY_SHEET,
    }).map((entry) => entry.key);
    expect(pending).not.toContain('has_existing_firearms');
  });

  it('resolves the section 16 purpose from the firearm, not a router question', () => {
    // `firearm_use_kind` was retired as a question: a handgun is sport, and
    // the interview asks the sport branch directly.
    const q = planQuestion({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: COMMON,
      sheet: EMPTY_SHEET,
    });
    expect(q?.fieldKey).not.toBe('firearm_use_kind');
    expect(
      purposeForAnswers(MotivationLicenceType.S16_DEDICATED_HUNTER, COMMON),
    ).toBe('hunting');
  });

  it('filters the hunting branch out of a sport answer', () => {
    const strategy = strategyFor(MotivationLicenceType.S16_DEDICATED_HUNTER);
    expect(sportingFields(strategy, 'sport')).not.toContain('intended_quarry');
    expect(sportingFields(strategy, 'sport')).toContain('competition_record');
    expect(sportingFields(strategy, 'hunting')).toContain('intended_quarry');
    expect(sportingFields(strategy, 'hunting')).not.toContain('competition_record');
    expect(sportingFields(strategy, 'both')).toContain('intended_quarry');
    expect(sportingFields(strategy, 'both')).toContain('competition_record');
  });

  it('reads the stored router before the automatic fallback', () => {
    expect(
      purposeForAnswers(
        MotivationLicenceType.S16_DEDICATED_HUNTER,
        { ...COMMON, firearm_use_kind: 'sport' },
      ),
    ).toBe('sport');
    expect(
      purposeForAnswers(
        MotivationLicenceType.S13_SELF_DEFENCE,
        { ...COMMON, firearm_use_kind: 'hunting' },
      ),
    ).toBe('self-defence');
  });

  /**
   * ⚠️ THE DECLARATIONS ARE NO LONGER ASKED. 2026-11-05: the six history
   * questions existed to fill boxes G.62 to G.67 on a SAPS 271 we no longer
   * produce. They stay in the registry (a document can still raise one, and the
   * writer reads them when it does) but the interview never puts them in front
   * of the applicant.
   */
  it('never asks the declaration history, even with everything else answered', () => {
    const strategy = strategyFor(MotivationLicenceType.S15_OCCASIONAL_HUNTER);
    const answers: Record<string, string> = {};
    for (const key of strategy.fields) {
      if (key.startsWith('history_')) continue;
      const field = fieldByKey(MotivationLicenceType.S15_OCCASIONAL_HUNTER, key);
      if (!field) continue;
      if (field.kind === 'cards' && field.options?.length) {
        answers[key] = field.options[0].key;
      } else if (field.kind === 'choice' && field.choices?.length) {
        answers[key] = field.choices[0];
      } else if (field.kind === 'yesno') {
        answers[key] = 'No';
      } else if (field.kind === 'date') {
        answers[key] = '2020-01-01';
      } else {
        answers[key] = 'Test';
      }
    }
    const q = planQuestion({
      type: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      answers,
      sheet: EMPTY_SHEET,
    });
    // Whatever is left, it is never a declaration.
    expect(q?.fieldKey?.startsWith('history_') ?? false).toBe(false);
  });
});

describe('the form-only retirement', () => {
  it('never asks a form-only field, in either mode', () => {
    const answers = {
      ...COMMON,
      firearm_use_kind: 'hunting',
      marital_status: 'Married',
      spouse_id_type: 'SA ID',
    };
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers,
      sheet: EMPTY_SHEET,
    });
    expect(pending.map((f) => f.key)).not.toContain('spouse_id_number');
  });
});

describe('the hunt intention question', () => {
  it('asks for intended quarry tailored to the calibre', () => {
    const q = planQuestion({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {
        ...COMMON,
        firearm_calibre: '.223 Remington',
        firearm_use_kind: 'hunting',
        // The exercise is asked with the association block, before the quarry.
        discipline_exercise: '100m, Small-Bore Centre-Fire Rifle Exercise',
        association_name: 'SA Hunters',
        association_number: 'M1',
        association_joined: '2020-01-01',
        association_expiry: '2027-01-01',
        dedicated_since: '2020-01-01',
      },
      sheet: EMPTY_SHEET,
    });
    expect(q?.fieldKey).toBe('intended_quarry');
    expect(q?.label).toBe('What game or species do you intend to hunt with this .223 Remington?');
  });
});


// ---------------------------------------------------------------------------
// THE GROUPED INTERVIEW. A cold applicant is asked a category at a time; these
// pin the order, the exclusions, the cap and that no question appears twice.
// ---------------------------------------------------------------------------
describe('planGroup', () => {
  const cold = () =>
    planGroup({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {},
      sheet: EMPTY_SHEET,
    });

  it('starts a cold application on identity', () => {
    expect(cold()?.id).toBe('identity');
    expect(cold()?.title).toBe('About you');
  });

  it('asks only identity questions in that first group', () => {
    for (const q of cold()?.questions ?? []) {
      expect(topicForField(q.key)).toBe('identity');
    }
  });

  it('never repeats a question inside a group', () => {
    const keys = (cold()?.questions ?? []).map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('caps the card and keeps the overflow for the next turn', () => {
    const group = planGroup(
      {
        type: MotivationLicenceType.S16_DEDICATED_HUNTER,
        answers: {},
        sheet: EMPTY_SHEET,
      },
      2,
    );
    expect(group?.questions).toHaveLength(2);
  });

  it('moves on once a group is answered', () => {
    const first = cold();
    const answers = Object.fromEntries(
      (first?.questions ?? []).map((q) => [q.key, 'x']),
    );
    const next = planGroup({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers,
      sheet: EMPTY_SHEET,
    });
    expect(next?.id).not.toBe('identity');
  });

  it('is null when nothing is left to ask', () => {
    const answers: Record<string, string> = {};
    for (const { key } of pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers,
      sheet: EMPTY_SHEET,
    })) {
      // ⚠️ THE HISTORY HAS A FLOOR. A one-character answer keeps it pending on
      // purpose (see isPending), so this test fills it properly rather than
      // pretending a stub settles it.
      answers[key] =
        key === 'shooting_history'
          ? Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
          : 'x';
    }
    expect(
      planGroup({
        type: MotivationLicenceType.S16_DEDICATED_HUNTER,
        answers,
        sheet: EMPTY_SHEET,
      }),
    ).toBeNull();
  });
});

describe('planGroup - optional questions', () => {
  /**
   * AN OPTIONAL QUESTION WOULD HOLD THE CARD HOSTAGE. The conversation asks
   * one question at a time and Continue needs an answer, so a question nobody
   * is obliged to answer would be re-served forever. Operator, 2026-11-05:
   * "It should keep things minimal."
   */
  it('never puts an optional question in a group', () => {
    const group = planGroup({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {},
      sheet: EMPTY_SHEET,
    });
    expect(group).not.toBeNull();
    expect(group!.questions.length).toBeGreaterThan(0);
    for (const question of group!.questions) {
      expect(question.field.required).toBe(true);
    }
  });

  it('counts only required questions in the group total', () => {
    const group = planGroup({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {},
      sheet: EMPTY_SHEET,
    });
    expect(group!.totalInGroup).toBe(group!.questions.length);
  });
});
/**
 * ⚠️ THE HISTORY IS DRAFTED NOW, SO IT IS NEVER A CARD.
 *
 * Operator decision 2026-11-26: intake asks only facts no document can supply.
 * The history used to keep itself pending below a twelve-word floor, which is
 * what served the identical card twice when a member tapped one short chip.
 * The floor still exists — in the generation gate, where it now means "the
 * drafter has not produced the paragraph yet" — but it can never put a question
 * in front of the member.
 */
describe('the shooting history is drafted, never asked', () => {
  const history = (words: number) =>
    Array.from({ length: words }, (_, i) => `word${i}`).join(' ');

  it('never puts the history on a card, however thin the stored answer', () => {
    for (const type of ALL_TYPES) {
      const thin = { shooting_history: history(4) };
      const pending = pendingFields({
        type,
        answers: thin,
        sheet: EMPTY_SHEET,
      }).map((entry) => entry.key);
      expect({ type, asked: pending.includes('shooting_history') }).toEqual({
        type,
        asked: false,
      });
      expect(
        planQuestion({ type, answers: thin, sheet: EMPTY_SHEET })?.fieldKey,
      ).not.toBe('shooting_history');
      expect(
        planGroup({ type, answers: thin, sheet: EMPTY_SHEET })?.questions.map(
          (question) => question.key,
        ) ?? [],
      ).not.toContain('shooting_history');
    }
  });

  it('keeps the generation gate floor, so a stub still cannot write', () => {
    // ⚠️ KEEP MIN_HISTORY_WORDS. The floor moved from the interview to the
    // gate: the drafter has to produce a substantial paragraph, and a member's
    // own short edit still has to be extended on the review screen.
    const thin = missingDetail(
      { shooting_history: history(4) },
      MotivationLicenceType.S13_SELF_DEFENCE,
    ).map((gap) => gap.code);
    expect(thin).toContain('history:shooting_history');
    expect(MIN_HISTORY_WORDS).toBeGreaterThan(4);

    const substantial = missingDetail(
      { shooting_history: history(60) },
      MotivationLicenceType.S13_SELF_DEFENCE,
    ).map((gap) => gap.code);
    expect(substantial).not.toContain('history:shooting_history');
  });
});

describe('the document gate decides what the conversation asks', () => {
  // ?? Operator, 2026-11-06: "It never asked these questions" - the completion
  // screen named the purpose and the quarry, and no card had ever shown them.
  const history = () =>
    Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');

  function filled(type: MotivationLicenceType): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const { key } of pendingFields({ type, answers, sheet: EMPTY_SHEET })) {
      answers[key] = key === 'shooting_history' ? history() : 'x';
    }
    return answers;
  }

  /**
   * ⚠️ A THIN STORED HISTORY IS THE DRAFTER'S PROBLEM NOW, NOT A CARD.
   *
   * This used to keep a five-word history pending so the interview re-asked it
   * with a word floor on the card — the "asked twice" screen the operator
   * reported. The card is gone; the gate still names the gap, the review sheet
   * lets the member extend their own words, and the drafter writes the
   * paragraph when the member has not.
   */
  it('never re-asks a stored history, however thin, but the gate still names it', () => {
    const thin = filled(MotivationLicenceType.S13_SELF_DEFENCE);
    thin.shooting_history = 'At the range most weekends';

    const group = planGroup({
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers: thin,
      sheet: EMPTY_SHEET,
    });
    expect(group?.questions.map((q) => q.key) ?? []).not.toContain(
      'shooting_history',
    );
    expect(questionForField(
      {
        type: MotivationLicenceType.S13_SELF_DEFENCE,
        answers: thin,
        sheet: EMPTY_SHEET,
      },
      'shooting_history',
    )).toBeNull();
    expect(
      missingDetail(thin, MotivationLicenceType.S13_SELF_DEFENCE).map(
        (gap) => gap.code,
      ),
    ).toContain('history:shooting_history');

    const long = { ...thin, shooting_history: history() };
    const next = planGroup({
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers: long,
      sheet: EMPTY_SHEET,
    });
    expect(next?.questions.map((q) => q.key) ?? []).not.toContain(
      'shooting_history',
    );
  });

  /**
   * ⚠️ THE "ASKED TWICE" REGRESSION. A card must never come back with the same
   * first field unless the previous submit stored nothing. The live cause was
   * the shooting history's word floor (now drafted, never asked), but the
   * invariant is about ANY short chip answer: answer a one-tap case question
   * and the walk moves on.
   */
  it('moves on after a single short chip answer instead of re-serving the card', () => {
    const answers = filled(MotivationLicenceType.S13_SELF_DEFENCE);
    delete answers.alarm_present;
    const input = {
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers,
      sheet: EMPTY_SHEET,
    };
    const group = planGroup(input);
    expect(group?.questions.map((q) => q.key)).toContain('alarm_present');

    const next = planGroup({
      ...input,
      answers: { ...answers, alarm_present: 'No' },
    });
    expect(next?.questions[0]?.key).not.toBe('alarm_present');
  });

  it('never asks the comparison — it is drafted from the battery', () => {
    // ⚠️ MOVED TO DRAFTED_KEYS (2026-11-27). "What else did you consider" is a
    // short narrative the drafter composes from the firearm applied for and the
    // battery rows; the applicant reviews it. It is not a question, so it can
    // never hold a card.
    const answers = filled(MotivationLicenceType.S13_SELF_DEFENCE);
    expect(answers.alternative_considered).toBeUndefined();
    const input = {
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers,
      sheet: EMPTY_SHEET,
    };
    expect(planGroup(input)?.questions.map((q) => q.key) ?? []).not.toContain(
      'alternative_considered',
    );
    expect(questionForField(input, 'alternative_considered')).toBeNull();
  });

  it('does not re-ask the comparison once the member answers None', () => {
    const answers = filled(MotivationLicenceType.S13_SELF_DEFENCE);
    answers.alternative_considered = 'None';
    /**
     * The real sheet blanks a member-typed "None" (answerValue) and leaves a
     * `needs_you` item behind. The stored answer must still settle it — this is
     * the "if I say None it comes up again" loop.
     */
    const sheet = {
      ...EMPTY_SHEET,
      items: [
        {
          key: 'alternative_considered',
          label: 'What else you considered, and why this one',
          kind: 'short',
          state: 'needs_you',
          value: '',
          provenance: null,
          section: 'case',
          scope: 'application',
          required: false,
        },
      ],
    } as unknown as SheetResponse;

    const pending = pendingFields({
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers,
      sheet,
    });
    expect(pending.map((entry) => entry.key)).not.toContain(
      'alternative_considered',
    );
  });

  it('asks the quarry even though the registry does not mark it required', () => {    const answers = filled(MotivationLicenceType.S15_OCCASIONAL_HUNTER);
    delete answers.intended_quarry;
    const group = planGroup({
      type: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      answers,
      sheet: EMPTY_SHEET,
    });
    expect(group!.questions.map((q) => q.key)).toContain('intended_quarry');
  });

  it('asks the exercise a dedicated sport application has to attach', () => {
    const answers = filled(MotivationLicenceType.S16_DEDICATED_SPORT);
    delete answers.discipline_exercise;
    const group = planGroup({
      type: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers,
      sheet: EMPTY_SHEET,
    });
    expect(group!.questions.map((q) => q.key)).toContain('discipline_exercise');
  });

  it('still ends when the gate has nothing left to name', () => {
    const answers = filled(MotivationLicenceType.S15_OCCASIONAL_HUNTER);
    expect(
      planGroup({
        type: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
        answers,
        sheet: EMPTY_SHEET,
      }),
    ).toBeNull();
  });
});

/**
 * Walk the whole interview the way the service serves it: ask, answer, ask.
 *
 * ⚠️ THIS IS THE ONLY HONEST WAY TO TEST "EVERY GATE GAP HAS A QUESTION". A
 * single `planGroup` call only sees the first topic; a gap in the last one can
 * be invisible there and still dead-end the member on the completion screen.
 */
function walk(
  type: MotivationLicenceType,
  seed: Record<string, string> = {},
  provenance: Record<string, { source?: string }> = {},
): {
  asked: string[];
  answers: Record<string, string>;
  provenance: Record<string, { source?: string }>;
} {
  const answers: Record<string, string> = { ...seed };
  const asked: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    const question = planQuestion({
      type,
      answers,
      sheet: EMPTY_SHEET,
      provenance,
    });
    if (!question) break;
    asked.push(question.fieldKey);
    answers[question.fieldKey] = answerFor(question.fieldKey, type);
    /**
     * ⚠️ AN ANSWER GIVEN IN THE WALK IS STAMPED MEMBER, LIKE A REAL SAVE.
     * `saveAnswers` marks every moved answer MEMBER, and the owned-firearms
     * count is only settled by a MEMBER confirmation once rows are visible —
     * without this the walk would sit on the count forever.
     */
    provenance[question.fieldKey] = { source: 'MEMBER' };
  }
  return { asked, answers, provenance };
}

function answerFor(key: string, type: MotivationLicenceType): string {
  const field = fieldByKey(type, key);
  if (key === 'shooting_history') {
    return Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
  }
  if (key === 'continued_use') {
    return Array.from({ length: 10 }, (_, i) => `used${i}`).join(' ');
  }
  if (!field) return 'x';
  switch (field.kind) {
    case 'date':
      return '2020-01-01';
    case 'yesno':
      // Yes only where it opens useful follow-ups; No elsewhere keeps the walk
      // out of declaration details.
      return key === 'safe_present' ? 'Yes' : 'No';
    case 'choice':
      return field.choices?.[0] ?? 'Other';
    case 'cards':
    case 'multi':
      return field.options?.[0]?.key ?? 'other';
    default:
      return 'A real answer';
  }
}

describe('the case questions', () => {
  const types = [
    MotivationLicenceType.S13_SELF_DEFENCE,
    MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
    MotivationLicenceType.S15_OCCASIONAL_HUNTER,
    MotivationLicenceType.S16_DEDICATED_HUNTER,
    MotivationLicenceType.S16_DEDICATED_SPORT,
    MotivationLicenceType.S24_RENEWAL,
  ];

  const seedFor = (type: MotivationLicenceType): Record<string, string> =>
    sportingFields(strategyFor(type), 'both').includes('firearm_use_kind')
      ? {
          firearm_use_kind:
            type === MotivationLicenceType.S16_DEDICATED_SPORT
              ? 'sport'
              : 'hunting',
        }
      : {};

  it('never asks residence_type twice in a walk', () => {
    for (const type of types) {
      const { asked } = walk(type, seedFor(type));
      expect(asked.filter((key) => key === 'residence_type')).toHaveLength(1);
    }
  });

  it('asks the premises block on a self-defence application', () => {
    const { asked } = walk(MotivationLicenceType.S13_SELF_DEFENCE);
    expect(asked).toEqual(
      expect.arrayContaining([
        'premises_enclosure',
        'premises_access_control',
        'alarm_present',
        'armed_response',
      ]),
    );
    // ⚠️ The routine and the carry method are NARRATIVE now — the drafter
    // writes them from the premises and the case, and the card never asks.
    expect(asked).not.toContain('s13_movements');
    expect(asked).not.toContain('s13_carry_style');
    expect(asked).not.toContain('threat_circumstances');
  });

  it('asks the licence facts a renewal turns on, not its narrative', () => {
    const { asked } = walk(MotivationLicenceType.S24_RENEWAL);
    expect(asked).toEqual(
      expect.arrayContaining(['existing_licence_number', 'licence_expiry']),
    );
    // The "how have you kept using it" paragraph is drafted and reviewed.
    expect(asked).not.toContain('continued_use');
  });

  it('asks the factual hunting/sport questions, not the narrative cards', () => {
    const hunting = walk(MotivationLicenceType.S16_DEDICATED_HUNTER, {
      firearm_use_kind: 'hunting',
    }).asked;
    expect(hunting).toContain('intended_quarry');
    expect(hunting).not.toContain('hunt_game_class');
    expect(hunting).not.toContain('hunt_terrain');
    expect(hunting).not.toContain('hunt_reasons');
    expect(hunting).not.toContain('hunting_history');
    expect(hunting).not.toContain('hunting_locations');

    const sport = walk(MotivationLicenceType.S16_DEDICATED_SPORT, {
      firearm_use_kind: 'sport',
    }).asked;
    expect(sport).toContain('discipline_exercise');
    expect(sport).not.toContain('sport_formats');
    expect(sport).not.toContain('sport_reasons');
    expect(sport).not.toContain('competition_record');
    expect(sport).not.toContain('activity_record');
  });

  /**
   * ⚠️ THE DEAD-END INVARIANT. `missingDetail()` is the generation gate; every
   * gap it names must either have a question in the walk OR be one of the
   * narrative fields the drafter fills (and `finish()` falls back for), or the
   * member is held on the interview screen with nothing left to answer. This is
   * the test that would have caught `firearm_use_kind` on a section 13.
   */
  it('has a question for every factual gap the generation gate names', () => {
    for (const type of types) {
      const seed = seedFor(type);
      const gaps = missingDetail(seed, type)
        .map((gap) => gap.code.slice(gap.code.indexOf(':') + 1))
        .filter((key) => !DRAFTED_KEYS.has(key));
      const { asked } = walk(type, seed);
      for (const key of gaps) {
        expect({ type, key, asked: asked.includes(key) }).toEqual({
          type,
          key,
          asked: true,
        });
      }
    }
  });

  /**
   * ⚠️ AND THE NARRATIVE GAPS ARE NOT DEAD ENDS EITHER. Every DRAFTED key the
   * gate can name must have a deterministic fallback (so `finish()` can always
   * pass) — that pair of facts is what makes "never asked" safe.
   */
  it('falls back for every narrative gap the gate can name', () => {
    for (const type of types) {
      const gaps = missingDetail(seedFor(type), type)
        .map((gap) => gap.code.slice(gap.code.indexOf(':') + 1))
        .filter((key) => DRAFTED_KEYS.has(key));
      for (const key of gaps) {
        expect({
          type,
          key,
          fallback: Boolean(fallbackDraft(key, {} as never)),
        }).toEqual({
          type,
          key,
          fallback: true,
        });
      }
    }
  });

  it('does not re-ask a question the member skipped', () => {
    // premises_enclosure is a real CASE key that is still asked; the narrative
    // routine cards that used to hold this test are never asked at all now.
    const first = walk(MotivationLicenceType.S13_SELF_DEFENCE);
    const base = { ...first.answers };
    delete base.premises_enclosure;
    const withoutSkip = walk(
      MotivationLicenceType.S13_SELF_DEFENCE,
      base,
      { ...first.provenance },
    );
    expect(withoutSkip.asked).toContain('premises_enclosure');

    const afterSkip = walk(MotivationLicenceType.S13_SELF_DEFENCE, base, {
      ...first.provenance,
      premises_enclosure: { source: 'SKIPPED' },
    });
    expect(afterSkip.asked).not.toContain('premises_enclosure');
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE OWNED FIREARMS (operator, 2026-11-27).
 *
 * ⚠️ THEY WERE NEVER ASKED. The registry rows are neither required nor
 * detail-gated nor CASE_KEYS, so `asked()` filtered every one of them out of
 * the grouped interview: a cold applicant said Yes and was never asked which
 * firearms, and a vault application was never asked to confirm what we could
 * read. These specs walk the whole gate.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe('the owned firearms', () => {
  /** Every question answered EXCEPT the owned-firearms table. */
  function filledExceptOwned(): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const field of fieldsFor(MotivationLicenceType.S16_DEDICATED_HUNTER)) {
      if (
        field.key === 'has_existing_firearms' ||
        field.key === 'existing_firearm_count' ||
        /^existing_firearm_/.test(field.key)
      ) {
        continue;
      }
      answers[field.key] = 'x';
    }
    return answers;
  }
  const input = (answers: Record<string, string>, provenance = {}) => ({
    type: MotivationLicenceType.S16_DEDICATED_HUNTER,
    answers,
    sheet: EMPTY_SHEET,
    provenance,
  });

  it('asks the gate first for a cold applicant, and nothing else owned', () => {
    const answers = filledExceptOwned();
    const pending = pendingFields(input(answers)).map((entry) => entry.key);
    expect(pending).toContain('has_existing_firearms');
    expect(pending).not.toContain('existing_firearm_count');
    expect(pending.some((key) => /^existing_firearm_/.test(key))).toBe(false);

    const group = planGroup(input(answers));
    expect(group?.id).toBe('existing');
    expect(group?.title).toBe('Firearms you already hold');
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'has_existing_firearms',
    ]);
    expect(group?.ownedIndex).toBeUndefined();
  });

  it('asks the count after Yes, then the whole owned table on ONE card', () => {
    const answers = filledExceptOwned();
    answers.has_existing_firearms = 'Yes';
    let group = planGroup(input(answers));
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'existing_firearm_count',
    ]);
    const countQuestion = questionForField(input(answers), 'existing_firearm_count');
    expect(countQuestion?.label).toBe('How many firearms do you own?');
    expect(countQuestion?.value).toBeUndefined();

    answers.existing_firearm_count = '2';
    group = planGroup(input(answers));
    /**
     * ⚠️ NOT ONE FIREARM PER CARD (2026-11-27, MO000160). The pending row
     * questions arrive together, ordered by firearm index then column, and the
     * cap decides how many fit — 2 × 4 facts = 8, so the first card carries
     * row 1 and the first three facts of row 2.
     */
    expect(group?.title).toBe('Firearms you already hold');
    expect(group?.ownedIndex).toBeUndefined();
    expect(group?.ownedTotal).toBe(2);
    expect(group?.questions).toHaveLength(GROUP_CAP);
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'existing_firearm_1_make',
      'existing_firearm_1_model',
      'existing_firearm_1_calibre',
      'existing_firearm_1_serial',
      'existing_firearm_2_make',
      'existing_firearm_2_model',
      'existing_firearm_2_calibre',
    ]);
    // type and section_held are sheet/writer facts, never asked here.
    expect(group?.questions.map((entry) => entry.key)).not.toContain(
      'existing_firearm_1_type',
    );

    answers.existing_firearm_1_make = 'Marlin';
    answers.existing_firearm_1_model = '1895';
    answers.existing_firearm_1_calibre = '.45-70 Government';
    answers.existing_firearm_1_serial = 'MR90189D';
    /**
     * ⚠️ ONCE ROWS EXIST THE COUNT NEEDS ITS MEMBER CONFIRMATION. A real save
     * stamps the count MEMBER when the member answers it; the spec has to say so
     * or the card correctly asks the count again.
     */
    group = planGroup(
      input(answers, { existing_firearm_count: { source: 'MEMBER' } }),
    );
    // Row 1 is complete, so the card holds one firearm's facts and DOES name it.
    expect(group?.title).toBe('Firearm 2 of 2');
    expect(group?.ownedIndex).toBe(2);
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'existing_firearm_2_make',
      'existing_firearm_2_model',
      'existing_firearm_2_calibre',
      'existing_firearm_2_serial',
    ]);
  });

  /**
   * ⚠️ THE LIVE BUG THIS ROUND EXISTS FOR (MO000160, 2026-11-27). Six
   * vault-read firearms had make/calibre/serial and only the model missing, and
   * the one-firearm-per-card rule served six nearly identical Model cards.
   */
  it('puts six missing models on a single card', () => {
    const answers = filledExceptOwned();
    answers.has_existing_firearms = 'Yes';
    answers.existing_firearm_count = '6';
    for (let n = 1; n <= 6; n += 1) {
      answers[`existing_firearm_${n}_make`] = `Make${n}`;
      answers[`existing_firearm_${n}_calibre`] = '.308 Winchester';
      answers[`existing_firearm_${n}_serial`] = `SER${n}`;
    }
    const group = planGroup(
      input(answers, { existing_firearm_count: { source: 'MEMBER' } }),
    );
    expect(group?.title).toBe('Firearms you already hold');
    expect(group?.ownedIndex).toBeUndefined();
    expect(group?.ownedTotal).toBe(6);
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'existing_firearm_1_model',
      'existing_firearm_2_model',
      'existing_firearm_3_model',
      'existing_firearm_4_model',
      'existing_firearm_5_model',
      'existing_firearm_6_model',
    ]);
  });

  it('skips the gate for a vault applicant and asks the count as a prefilled confirmation', () => {
    const answers = filledExceptOwned();
    answers.existing_firearm_1_make = 'Marlin';
    answers.existing_firearm_1_calibre = '.45-70 Government';

    expect(pendingFields(input(answers)).map((entry) => entry.key)).not.toContain(
      'has_existing_firearms',
    );
    const group = planGroup(input(answers));
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'existing_firearm_count',
    ]);
    const countQuestion = questionForField(input(answers), 'existing_firearm_count');
    expect(countQuestion?.label).toBe(
      'We can see 1 firearm on your documents. How many firearms do you own in total?',
    );
    expect(countQuestion?.help).toBe(
      'Add every firearm you own — we will ask for the make, model, calibre and serial of any we could not find.',
    );
    // One tap confirms: the derived number is already in the control.
    expect(countQuestion?.value).toBe('1');
  });

  it('keeps the count pending until the member CONFIRMS it, then asks the row', () => {
    const answers = filledExceptOwned();
    answers.existing_firearm_1_make = 'Marlin';
    answers.existing_firearm_1_calibre = '.45-70 Government';

    // Answered by the member, but not yet stamped MEMBER: still a confirmation.
    answers.existing_firearm_count = '1';
    let group = planGroup(input(answers));
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'existing_firearm_count',
    ]);

    group = planGroup(
      input(answers, { existing_firearm_count: { source: 'MEMBER' } }),
    );
    expect(group?.title).toBe('Firearm 1 of 1');
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'existing_firearm_1_model',
      'existing_firearm_1_serial',
    ]);
  });

  it('an increased count adds the extra firearms; a decrease drops them', () => {
    const answers = filledExceptOwned();
    answers.existing_firearm_1_make = 'Marlin';
    answers.existing_firearm_1_model = '1895';
    answers.existing_firearm_1_calibre = '.45-70 Government';
    answers.existing_firearm_1_serial = 'MR90189D';
    answers.existing_firearm_count = '3';
    const provenance = { existing_firearm_count: { source: 'MEMBER' } };

    let group = planGroup(input(answers, provenance));
    // Rows 2 and 3 are new, so the card spans more than one firearm and carries
    // no per-firearm title — but the total is still served.
    expect(group?.title).toBe('Firearms you already hold');
    expect(group?.ownedIndex).toBeUndefined();
    expect(group?.ownedTotal).toBe(3);
    expect(group?.questions[0].key).toBe('existing_firearm_2_make');

    answers.existing_firearm_count = '1';
    group = planGroup(input(answers, provenance));
    // Row 1 is complete and the count now covers only it, so the table is done.
    expect(group?.id).not.toBe('existing');
  });

  it('puts every incomplete firearm’s remaining facts on one card, in order', () => {
    const answers = filledExceptOwned();
    for (const column of ['make', 'model', 'calibre', 'serial']) {
      answers[`existing_firearm_1_${column}`] = 'filled';
    }
    answers.existing_firearm_2_make = 'Howa';
    answers.existing_firearm_count = '3';
    const group = planGroup(
      input(answers, { existing_firearm_count: { source: 'MEMBER' } }),
    );
    // Row 1 is complete; row 2 is partial and row 3 untouched — all of their
    // remaining facts share one card, still ordered by firearm then column.
    expect(group?.title).toBe('Firearms you already hold');
    expect(group?.ownedIndex).toBeUndefined();
    expect(group?.ownedTotal).toBe(3);
    expect(group?.questions.map((entry) => entry.key)).toEqual([
      'existing_firearm_2_model',
      'existing_firearm_2_calibre',
      'existing_firearm_2_serial',
      'existing_firearm_3_make',
      'existing_firearm_3_model',
      'existing_firearm_3_calibre',
      'existing_firearm_3_serial',
    ]);
  });

  /**
   * ⚠️ "NONE" IS A REAL ANSWER FOR A MODEL. A licence card prints NONE in a row
   * that does not apply, and the operator's six vault-read rifles had no way to
   * say so except Skip on every card.
   */
  it('offers None for an owned model, and keeps the free-text box', () => {
    const answers = filledExceptOwned();
    answers.has_existing_firearms = 'Yes';
    answers.existing_firearm_count = '1';
    const question = questionForField(input(answers), 'existing_firearm_1_model');
    expect(question?.kind).toBe('short');
    expect(question?.choices[0]).toEqual({
      value: 'None',
      label: 'None — the licence prints NONE',
    });
    expect(question?.customPlaceholder).toContain('type your own');
    // ...and it is not offered on the other owned facts.
    expect(
      questionForField(input(answers), 'existing_firearm_1_serial')?.choices ?? [],
    ).not.toContainEqual(expect.objectContaining({ value: 'None' }));
  });

  it('gives every owned fact honest help, not the sensitive-field warning', () => {
    const answers = filledExceptOwned();
    answers.has_existing_firearms = 'Yes';
    answers.existing_firearm_count = '1';
    for (const column of ['make', 'model', 'calibre', 'serial']) {
      const key = `existing_firearm_1_${column}`;
      const question = questionForField(input(answers), key);
      expect({ key, help: question?.help }).not.toEqual({
        key,
        help: expect.stringContaining('never sent to the writing assistant'),
      });
      // The registry's own guidance wins where it exists; the generic licence
      // line is the fallback (make and model carry no help of their own).
      expect(question?.help).toBe(
        fieldByKey(MotivationLicenceType.S16_DEDICATED_HUNTER, key)?.help ??
          'Exactly as it appears on your licence card.',
      );
    }
  });
});

describe('the question placeholder', () => {
  it('is clean text, not mis-decoded UTF-8', () => {
    const question = planQuestion({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {},
      sheet: EMPTY_SHEET,
    });
    expect(question?.customPlaceholder).toBe('Or type your own answer…');
    expect(question?.customPlaceholder).not.toContain('â');
  });

  it('never builds a question for a drafted narrative field', () => {
    // questionForField is the single builder behind every card; a drafted field
    // must not resolve through it at all, so no caller can serve one by name.
    for (const key of DRAFTED_KEYS) {
      for (const type of ALL_TYPES) {
        expect(
          questionForField({ type, answers: {}, sheet: EMPTY_SHEET }, key),
        ).toBeNull();
      }
    }
  });
});

/**
 * ⚠️ THE FLAT INVARIANT FROM THE SPEC. Narrative fields are drafted by
 * IntakeDraftService, never asked — for EVERY licence type, in the single-question
 * path and the grouped one. This is the test that stops a future strategy edit
 * putting `shooting_history` back on a card.
 */
describe('the narrative fields are never interview questions', () => {
  it('excludes every DRAFTED key from every type’s pending list', () => {
    for (const type of ALL_TYPES) {
      const pending = pendingFields({
        type,
        answers: {},
        sheet: EMPTY_SHEET,
      }).map((entry) => entry.key);
      for (const key of DRAFTED_KEYS) {
        expect({ type, key, asked: pending.includes(key) }).toEqual({
          type,
          key,
          asked: false,
        });
      }
    }
  });

  it('excludes every DRAFTED key from every type’s grouped card', () => {
    for (const type of ALL_TYPES) {
      const group = planGroup({ type, answers: {}, sheet: EMPTY_SHEET });
      const asked = (group?.questions ?? []).map((entry) => entry.key);
      for (const key of DRAFTED_KEYS) {
        expect({ type, key, asked: asked.includes(key) }).toEqual({
          type,
          key,
          asked: false,
        });
      }
    }
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT MUST NEVER BE ON A CARD AGAIN (operator, live S16 test MO000159):
 *  - the SAPS 271 form boxes (main licence holder, marital status, spouse), and
 *  - the home-security paragraph on a hunting/sport/renewal application.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe('the SAPS 271-only boxes are never interview questions', () => {
  const FORM_ONLY_271 = [
    'licence_holder_type',
    'marital_status',
    'spouse_name',
    'spouse_id_type',
    'spouse_id_number',
  ];

  it('for all six licence types, no path serves one of them', () => {
    for (const type of ALL_TYPES) {
      const pending = pendingFields({
        type,
        answers: {},
        sheet: EMPTY_SHEET,
      }).map((entry) => entry.key);
      const grouped =
        planGroup({ type, answers: {}, sheet: EMPTY_SHEET })?.questions.map(
          (entry) => entry.key,
        ) ?? [];
      for (const key of FORM_ONLY_271) {
        expect({ type, key, asked: pending.includes(key) }).toEqual({
          type,
          key,
          asked: false,
        });
        expect({ type, key, grouped: grouped.includes(key) }).toEqual({
          type,
          key,
          grouped: false,
        });
        // And the single-question builder refuses it by name.
        expect(
          questionForField({ type, answers: {}, sheet: EMPTY_SHEET }, key),
        ).toBeNull();
      }
    }
  });

  it('leaves them accepted, so a stored 271 value still saves and shows', () => {
    // formOnly is a HIDE flag, never a delete: an uploaded 271 that filled one
    // of these keeps its value, and the review sheet's collapsed block edits it.
    const type = MotivationLicenceType.S16_DEDICATED_HUNTER;
    const field = fieldByKey(type, 'marital_status');
    expect(field?.formOnly).toBe(true);
    expect(requiredKeys(type, { marital_status: 'Married' })).not.toContain(
      'marital_status',
    );
  });
});

describe('the security paragraph is self-defence only', () => {
  const SECURITY_KEYS = [
    'premises_enclosure',
    'premises_access_control',
    'alarm_present',
    'armed_response',
    'burglar_bars',
    'security_gates',
    'travelled_areas_text',
  ];

  it('is never on a hunting, sport or renewal card', () => {
    for (const type of [
      MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      MotivationLicenceType.S16_DEDICATED_SPORT,
      MotivationLicenceType.S24_RENEWAL,
    ]) {
      const asked = pendingFields({
        type,
        answers: {
          firearm_use_kind: 'both',
          has_existing_firearms: 'Yes',
          existing_firearm_count: '2',
          safe_present: 'Yes',
        },
        sheet: EMPTY_SHEET,
      }).map((entry) => entry.key);
      for (const key of SECURITY_KEYS) {
        expect({ type, key, asked: asked.includes(key) }).toEqual({
          type,
          key,
          asked: false,
        });
      }
    }
  });

  it('is still asked on a self-defence application', () => {
    for (const type of [
      MotivationLicenceType.S13_SELF_DEFENCE,
      MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
    ]) {
      const asked = pendingFields({ type, answers: {}, sheet: EMPTY_SHEET }).map(
        (entry) => entry.key,
      );
      expect(asked).toEqual(
        expect.arrayContaining([
          'premises_enclosure',
          'alarm_present',
          'burglar_bars',
          'security_gates',
        ]),
      );
    }
  });
});

describe('the chosen cartridge drives the labels and the hunt classes', () => {
  const input = {
    type: MotivationLicenceType.S16_DEDICATED_HUNTER,
    answers: {
      ...COMMON,
      firearm_use_kind: 'hunting',
      firearm_calibre: '6.5',
      firearm_cartridge: '6,5 Creedmoor',
    },
    sheet: EMPTY_SHEET,
  };

  it('names the exact cartridge in the quarry question', () => {
    // The quarry is still asked; the hunt-class cards are drafted now, so this
    // is the observable label that proves buildQuestion reads the cartridge.
    expect(questionForField(input, 'intended_quarry')?.label).toBe(
      'What game or species do you intend to hunt with this 6,5 Creedmoor?',
    );
  });

  it('keeps the typed calibre when no cartridge was chosen', () => {
    const familyOnly = {
      ...input,
      answers: {
        ...input.answers,
        firearm_cartridge: '',
      },
    };
    expect(questionForField(familyOnly, 'intended_quarry')?.label).toBe(
      'What game or species do you intend to hunt with this 6.5?',
    );
  });

  it('offers only the game classes the chosen cartridge supports', () => {
    // `huntGameClassOptions` is the menu `choicesFor` builds for the class
    // cards (currently drafted, so reached through the same helper rather than
    // a card). "6,5 Creedmoor" is medium game; the bare family classifies
    // nowhere and would offer the whole national menu.
    const fromCartridge = huntGameClassOptions(
      cartridgeSource(input.answers),
    ).map((option) => option.key);
    expect(fromCartridge).toEqual(
      expect.arrayContaining(['plains_light', 'plains_medium']),
    );
    expect(fromCartridge).not.toContain('dangerous');

    const fromFamily = huntGameClassOptions('6.5').map(
      (option) => option.key,
    );
    expect(fromFamily.length).toBeGreaterThan(fromCartridge.length);
  });
});


/**
 * ────────────────────────────────────────────────────────────────────────────
 * EDITING AN EARLIER TOPIC. Back is stateless: the page names a topic, the
 * server rebuilds that card from the saved answers, and the controls are
 * prefilled from `value`/`values`. Nothing is stored between screens.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe('editing an earlier topic (Back)', () => {
  const base = { ...COMMON };

  it('serves the topic’s card with the saved answers prefilled', () => {
    const input = {
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: base,
      sheet: EMPTY_SHEET,
    };
    const card = planCard(input, 'identity');
    expect(card?.id).toBe('identity');
    expect(card?.title).toBe('About you');
    // A card is a list of fields; the grouped service builds each question
    // through the one builder, which is where the prefill lives.
    const byKey = new Map(
      (card?.questions ?? []).map((entry) => [
        entry.key,
        questionForField(input, entry.key),
      ]),
    );
    // Single-value questions carry what was saved, so an edit does not open a
    // blank form that looks like the answer was lost.
    expect(byKey.get('full_name')?.value).toBe('A B');
    expect(byKey.get('id_number')?.value).toBe('8001015009087');
    expect(byKey.get('occupation')?.value).toBe('Engineer');
    // ⚠️ marital_status / spouse_name are formOnly now — not on any card.
    expect(byKey.has('marital_status')).toBe(false);
    expect(byKey.has('spouse_name')).toBe(false);
  });

  it('splits a saved multi answer into values, matched against the current choices', () => {
    const field = fieldByKey(
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      'competency_for',
    );
    const chosen = (field?.choices ?? []).slice(0, 2) as string[];
    expect(chosen).toHaveLength(2);
    const input = {
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: { ...base, competency_for: chosen.join(', ') },
      sheet: EMPTY_SHEET,
    };
    const question = questionForField(input, 'competency_for');
    expect(question?.values).toEqual(chosen);
    expect(question?.value).toBeUndefined();
  });

  it('keeps a retired stored option as free text instead of dropping it', () => {
    // A stored option the current choices no longer offer must not vanish: the
    // member editing the card sees it in `value` and can decide what to do.
    const input = {
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: { ...base, competency_for: 'Not a listed endorsement' },
      sheet: EMPTY_SHEET,
    };
    const question = questionForField(input, 'competency_for');
    expect(question?.values).toBeUndefined();
    expect(question?.value).toBe('Not a listed endorsement');
  });

  it('returns null for a topic this application has no question for', () => {
    expect(
      planCard(
        {
          type: MotivationLicenceType.S16_DEDICATED_HUNTER,
          answers: {},
          sheet: EMPTY_SHEET,
        },
        'declarations',
      ),
    ).toBeNull();
  });

  it('counts topics with askable fields, not only pending ones, in the header', () => {
    // Editing the first topic of an almost-finished application must not read
    // "Step 0 of 1" — the index is over topics that have questions at all.
    const card = planCard(
      {
        type: MotivationLicenceType.S16_DEDICATED_HUNTER,
        answers: base,
        sheet: EMPTY_SHEET,
      },
      'identity',
    );
    expect(card?.index).toBeGreaterThanOrEqual(1);
    expect(card?.total).toBeGreaterThanOrEqual(card?.index ?? 1);
  });

  it('sends Back to the topic just before the first topic with pending work', () => {
    const input = {
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: base,
      sheet: EMPTY_SHEET,
    };
    const plan = planGroup(input);
    expect(plan).not.toBeNull();
    // A topic is askable iff planCard serves it; recompute that order here so
    // the assertion is the invariant, not a hard-coded topic list.
    const askableTopics = (
      [
        'identity',
        'firearm',
        'credentials',
        'existing',
        'address',
        'association',
        'activities',
        'safe',
        'declarations',
        'other',
      ] as const
    ).filter((topic) => planCard(input, topic) !== null);
    const at = askableTopics.indexOf(plan!.id);
    const navigation = navigationFor(input);
    if (at <= 0) {
      expect(navigation.back).toBeNull();
    } else {
      expect(navigation.back).toEqual({
        id: askableTopics[at - 1],
        title: TOPIC_TITLES[askableTopics[at - 1]],
      });
    }
  });

  it('has no Back target on the first topic of a cold application', () => {
    const input = {
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {},
      sheet: EMPTY_SHEET,
    };
    expect(planGroup(input)?.id).toBe('identity');
    expect(navigationFor(input)).toEqual({ back: null });
  });
});

describe('the brief guides the walk', () => {
  const brief: InterviewBrief = {
    version: 'test',
    hash: 'h',
    at: new Date().toISOString(),
    facts: [],
    questions: [
      {
        fieldKey: 'firearm_make',
        question: 'Which make is your rifle?',
        why: 'The card prints the make.',
        priority: 0,
      },
      {
        fieldKey: 'firearm_action',
        question: 'Which action is it?',
        why: 'The DFO reads the action against the competency.',
        priority: 1,
      },
    ],
    chips: {
      // ⚠️ A FIELD THAT IS STILL ASKED. `alternative_considered` is drafted now,
      // so it can never carry chips into the interview.
      firearm_make: [
        { value: 'Tikka', label: 'Tikka' },
        { value: 'Mauser', label: 'Mauser' },
        { value: 'Howa', label: 'Howa' },
      ],
    },
    sources: [],
    researched: true,
  };

  const answers = {
    ...COMMON,
    firearm_use_kind: 'hunting',
  };
  delete (answers as Record<string, string | undefined>).firearm_make;
  delete (answers as Record<string, string | undefined>).firearm_action;
  delete (answers as Record<string, string | undefined>).alternative_considered;

  it('asks the brief’s first question, in the brief’s words, with its reason', () => {
    const question = planQuestion({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers,
      sheet: EMPTY_SHEET,
      brief,
    });
    expect(question?.fieldKey).toBe('firearm_make');
    expect(question?.label).toBe('Which make is your rifle?');
    expect(question?.why).toBe('The card prints the make.');
  });

  it('offers the researched chips on an open question', () => {
    const question = questionForField(
      {
        type: MotivationLicenceType.S16_DEDICATED_HUNTER,
        answers,
        sheet: EMPTY_SHEET,
        brief,
      },
      'firearm_make',
    );
    expect(question?.choices[0].value).toBe('Tikka');
  });

  it('keeps a required question ahead of a brief’s optional one', () => {
    // Fill the walk, then put the required safe type back as pending. The brief
    // ranks another question first; the required question must still be asked.
    const walked = walk(MotivationLicenceType.S16_DEDICATED_HUNTER, {
      firearm_use_kind: 'hunting',
    });
    const remaining = { ...walked.answers };
    remaining.safe_present = 'Yes';
    delete remaining.safe_type;
    const ordered: InterviewBrief = {
      ...brief,
      questions: [
        {
          fieldKey: 'intended_quarry',
          question: 'What do you hunt?',
          why: 'The DFO reads the quarry against the calibre.',
          priority: 0,
        },
      ],
    };
    const question = planQuestion({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: remaining,
      sheet: EMPTY_SHEET,
      brief: ordered,
      provenance: walked.provenance,
    });
    expect(question?.fieldKey).toBe('safe_type');
  });
});

describe('the researcher follow-up slots', () => {
  function filledS13(): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const { key } of pendingFields({
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers,
      sheet: EMPTY_SHEET,
    })) {
      answers[key] =
        key === 'shooting_history' ? 'word '.repeat(20).trim() : 'x';
    }
    return answers;
  }

  const followUp: InterviewBrief = {
    version: 'test',
    hash: 'h',
    at: new Date().toISOString(),
    facts: [],
    sources: [],
    researched: true,
    questions: [
      {
        fieldKey: 'case_note_1',
        question: 'Where on your person do you carry it, and in what holster?',
        why: 'The DFO reads how the firearm is actually carried.',
        priority: 0,
      },
    ],
    chips: {},
  };

  it('asks a slot only when the brief wrote a question for it', () => {
    const answers = filledS13();
    expect(
      planGroup({
        type: MotivationLicenceType.S13_SELF_DEFENCE,
        answers,
        sheet: EMPTY_SHEET,
      }),
    ).toBeNull();

    const group = planGroup({
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers,
      sheet: EMPTY_SHEET,
      brief: followUp,
    });
    expect(group?.questions.map((q) => q.key)).toContain('case_note_1');
    expect(
      questionForField(
        {
          type: MotivationLicenceType.S13_SELF_DEFENCE,
          answers,
          sheet: EMPTY_SHEET,
          brief: followUp,
        },
        'case_note_1',
      )?.optional,
    ).toBe(true);
  });
});

describe('the cartridge follow-up', () => {
  const CARTRIDGE_ITEM = {
    key: 'firearm_cartridge',
    label: 'Which cartridge is it?',
    kind: 'short' as const,
    state: 'needs_you' as const,
    value: '',
    provenance: null,
    section: 'firearm',
    scope: 'application' as const,
    required: false,
    choices: ['9 mm Luger', '9 mm Makarov'],
  };

  it('offers it as a pending question with the candidate buttons', () => {
    const input = {
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: { ...COMMON, firearm_calibre: '9mm' },
      sheet: { ...EMPTY_SHEET, items: [CARTRIDGE_ITEM] } as SheetResponse,
    };
    const pending = pendingFields(input).map((entry) => entry.key);
    expect(pending).toContain('firearm_cartridge');

    const q = questionForField(input, 'firearm_cartridge');
    expect(q?.kind).toBe('short');
    expect(q?.choices?.map((c) => c.value)).toEqual([
      '9 mm Luger',
      '9 mm Makarov',
    ]);
  });

  it('never asks it when the sheet has no cartridge item', () => {
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: { ...COMMON, firearm_calibre: '9mm Luger' },
      sheet: EMPTY_SHEET,
    }).map((entry) => entry.key);
    expect(pending).not.toContain('firearm_cartridge');
    expect(
      planGroup({
        type: MotivationLicenceType.S16_DEDICATED_HUNTER,
        answers: { ...COMMON, firearm_calibre: '9mm Luger' },
        sheet: EMPTY_SHEET,
      })?.questions.map((q) => q.key) ?? [],
    ).not.toContain('firearm_cartridge');
  });

  /**
   * ⚠️ THE GROUPED INTERVIEW MUST ASK IT. The sheet showed "Which cartridge is
   * it?" and `planGroup().asked()` filtered it out because it is optional and
   * not a detail-gate key — the operator's own MO000158 typed "6.5", the Bench
   * held 12+ 6.5 cartridges, and no card ever asked which one. It is CASE_KEYS
   * now: offered once, only when the sheet says `needs_you`, skippable.
   */
  it('asks it on a grouped card when the calibre is an ambiguous family', () => {
    const SIX_FIVE_ITEM = {
      ...CARTRIDGE_ITEM,
      choices: ['6,5 Creedmoor', '6.5x55 Swedish', '6.5 PRC', '6.5 Grendel'],
    };
    const group = planGroup({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      // marital_status opens spouse_name in the identity topic; filling it keeps
      // the first card from being identity and this assertion about the firearm.
      answers: { ...COMMON, firearm_calibre: '6.5', spouse_name: 'C D' },
      sheet: { ...EMPTY_SHEET, items: [SIX_FIVE_ITEM] } as SheetResponse,
    });
    const question = (() => {
      const entry = group?.questions.find((q) => q.key === 'firearm_cartridge');
      if (!entry) return undefined;
      return questionForField(
        {
          type: MotivationLicenceType.S16_DEDICATED_HUNTER,
          answers: { ...COMMON, firearm_calibre: '6.5', spouse_name: 'C D' },
          sheet: { ...EMPTY_SHEET, items: [SIX_FIVE_ITEM] } as SheetResponse,
        },
        entry.key,
      );
    })();
    expect(question).toBeDefined();
    expect(question?.optional).toBe(true);
    expect(question?.choices.map((choice) => choice.value)).toEqual([
      '6,5 Creedmoor',
      '6.5x55 Swedish',
      '6.5 PRC',
      '6.5 Grendel',
    ]);
  });

  it('stops asking it once the member has chosen a cartridge', () => {
    const CHOSEN_ITEM = {
      ...CARTRIDGE_ITEM,
      state: 'filled' as const,
      value: '6.5 PRC',
    };
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {
        ...COMMON,
        firearm_calibre: '6.5',
        firearm_cartridge: '6.5 PRC',
      },
      sheet: { ...EMPTY_SHEET, items: [CHOSEN_ITEM] } as SheetResponse,
    }).map((entry) => entry.key);
    expect(pending).not.toContain('firearm_cartridge');
  });

  it('stops asking it when the member skips it', () => {
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: { ...COMMON, firearm_calibre: '6.5' },
      sheet: { ...EMPTY_SHEET, items: [CARTRIDGE_ITEM] } as SheetResponse,
      provenance: { firearm_cartridge: { source: 'SKIPPED' } },
    }).map((entry) => entry.key);
    expect(pending).not.toContain('firearm_cartridge');
  });
});
