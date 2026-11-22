import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from '../motivation-sheet.service';
import {
  pendingFields,
  planGroup,
  planQuestion,
  purposeForAnswers,
  questionForField,
} from './intake-planner';
import { fieldByKey } from '../motivation-fields';
import { sportingFields, strategyFor } from './intake-strategies';
import { topicForField } from './intake-topics';
import { missingDetail, MIN_HISTORY_WORDS } from '../motivation-completeness';
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
describe('shooting history stays pending until it is substantial', () => {
  const history = (words: number) =>
    Array.from({ length: words }, (_, i) => `word${i}`).join(' ');

  // ?? Operator, 2026-11-05: "I should not stop the interview until it has all
  // the required information." A one-line answer satisfied the planner, ended
  // the interview, and then the write step refused it.
  // ?? And 2026-11-06: the floor is a sentence or two, not sixty words - the
  // section is written from the facts, and chips count toward them.
  it('re-asks a history below the floor', () => {
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers: { shooting_history: history(4) },
      sheet: EMPTY_SHEET,
    }).map((p) => p.key);
    expect(pending).toContain('shooting_history');
  });

  it('moves on once it reaches the floor', () => {
    const group = planGroup({
      type: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers: { shooting_history: history(60) },
      sheet: EMPTY_SHEET,
    });
    expect(group!.questions.map((q) => q.key)).not.toContain('shooting_history');
  });

  it('accepts a history made of ticked statements', () => {
    // Two chips are the member's own words, so they settle the question.
    const group = planGroup({
      type: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers: {
        shooting_history:
          'I was taught to shoot by a family member, I shoot clay targets at a club',
      },
      sheet: EMPTY_SHEET,
    });
    expect(group!.questions.map((q) => q.key)).not.toContain('shooting_history');
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
   * ⚠️ AN ANSWERED HISTORY CAN STILL BE TOO THIN. A value saved elsewhere (the
   * review sheet has no word floor) at five words keeps the question pending,
   * so the interview puts it back — with the floor published, so the card can
   * ask for a sentence or more ticks instead of a dead "could not save".
   */
  it('re-asks a stored history below the floor, with the floor on the question', () => {
    const thin = filled(MotivationLicenceType.S13_SELF_DEFENCE);
    thin.shooting_history = 'At the range most weekends';

    const group = planGroup({
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers: thin,
      sheet: EMPTY_SHEET,
    });
    expect(group?.questions.map((q) => q.key)).toContain('shooting_history');
    const question = questionForField(
      {
        type: MotivationLicenceType.S13_SELF_DEFENCE,
        answers: thin,
        sheet: EMPTY_SHEET,
      },
      'shooting_history',
    );
    expect(question?.minWords).toBe(MIN_HISTORY_WORDS);

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

  it('offers the comparison as an optional case question', () => {
    const answers = filled(MotivationLicenceType.S13_SELF_DEFENCE);
    delete answers.alternative_considered;

    const input = {
      type: MotivationLicenceType.S13_SELF_DEFENCE,
      answers,
      sheet: EMPTY_SHEET,
    };
    const group = planGroup(input);
    expect(group?.questions.map((q) => q.key)).toContain(
      'alternative_considered',
    );
    const question = questionForField(input, 'alternative_considered');
    // Offered once, skippable — the card's red cross and "still to answer"
    // footer must not treat it as required.
    expect(question?.optional).toBe(true);
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
): { asked: string[]; answers: Record<string, string> } {
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
  }
  return { asked, answers };
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

  it('asks the premises block and the routine on a self-defence application', () => {
    const { asked } = walk(MotivationLicenceType.S13_SELF_DEFENCE);
    expect(asked).toEqual(
      expect.arrayContaining([
        'premises_enclosure',
        'premises_access_control',
        's13_movements',
        's13_carry_style',
      ]),
    );
  });

  it('asks how a renewal has kept using the firearm', () => {
    const { asked } = walk(MotivationLicenceType.S24_RENEWAL);
    expect(asked).toContain('continued_use');
  });

  it('asks the hunting ground and the sport formats', () => {
    expect(walk(MotivationLicenceType.S16_DEDICATED_HUNTER, { firearm_use_kind: 'hunting' }).asked)
      .toEqual(expect.arrayContaining(['hunt_game_class', 'hunt_terrain']));
    expect(walk(MotivationLicenceType.S16_DEDICATED_SPORT, { firearm_use_kind: 'sport' }).asked)
      .toEqual(expect.arrayContaining(['sport_formats', 'discipline_exercise']));
  });

  /**
   * ⚠️ THE DEAD-END INVARIANT. `missingDetail()` is the generation gate; every
   * gap it names must have a question in the walk, or the member is held on the
   * interview screen with nothing left to answer. This is the test that would
   * have caught `firearm_use_kind` on a section 13.
   */
  it('has a question for every gap the generation gate names', () => {
    for (const type of types) {
      const seed = seedFor(type);
      const gaps = missingDetail(seed, type).map((gap) =>
        gap.code.slice(gap.code.indexOf(':') + 1),
      );
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

  it('does not re-ask a question the member skipped', () => {
    const base = walk(MotivationLicenceType.S13_SELF_DEFENCE).answers;
    delete base.s13_movements;
    const withoutSkip = walk(MotivationLicenceType.S13_SELF_DEFENCE, base);
    expect(withoutSkip.asked).toContain('s13_movements');

    const afterSkip = walk(MotivationLicenceType.S13_SELF_DEFENCE, base, {
      s13_movements: { source: 'SKIPPED' },
    });
    expect(afterSkip.asked).not.toContain('s13_movements');
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

  it('publishes the history word floor to the card', () => {
    const answers = { ...COMMON };
    delete (answers as Record<string, string | undefined>).shooting_history;
    const question = questionForField(
      {
        type: MotivationLicenceType.S16_DEDICATED_HUNTER,
        answers,
        sheet: EMPTY_SHEET,
      },
      'shooting_history',
    );
    expect(question?.minWords).toBe(MIN_HISTORY_WORDS);
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
      alternative_considered: [
        { value: 'A .308 for the shorter action', label: 'A .308 for the shorter action' },
        { value: 'A 6.5 Creedmoor for the range', label: 'A 6.5 Creedmoor for the range' },
        { value: 'A .270 for the flatter trajectory', label: 'A .270 for the flatter trajectory' },
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
      'alternative_considered',
    );
    expect(question?.choices[0].value).toBe(
      'A .308 for the shorter action',
    );
  });

  it('keeps a required question ahead of a brief’s optional one', () => {
    // Fill the walk, then put the required safe type and the optional alarm
    // back as pending. The brief ranks the alarm first; the required question
    // must still be the one asked.
    const remaining = walk(MotivationLicenceType.S16_DEDICATED_HUNTER, {
      firearm_use_kind: 'hunting',
    }).answers;
    remaining.safe_present = 'Yes';
    delete remaining.safe_type;
    delete remaining.alarm_present;
    const ordered: InterviewBrief = {
      ...brief,
      questions: [
        {
          fieldKey: 'alarm_present',
          question: 'Is there an alarm?',
          why: 'The DFO reads the security measures.',
          priority: 0,
        },
      ],
    };
    const question = planQuestion({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: remaining,
      sheet: EMPTY_SHEET,
      brief: ordered,
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
  });
});
