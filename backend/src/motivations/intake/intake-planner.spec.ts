import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from '../motivation-sheet.service';
import {
  pendingFields,
  planGroup,
  planQuestion,
  purposeForAnswers,
} from './intake-planner';
import { fieldByKey } from '../motivation-fields';
import { sportingFields, strategyFor } from './intake-strategies';
import { topicForField } from './intake-topics';

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
  it('asks the section 16 purpose router before the branch facts', () => {
    const q = planQuestion({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: COMMON,
      sheet: EMPTY_SHEET,
    });
    expect(q?.fieldKey).toBe('firearm_use_kind');
    expect(q?.choices.map((c) => c.value)).toEqual([
      'hunting',
      'sport',
      'both',
    ]);
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
      // ⚠️ THE HISTORY HAS A SIXTY-WORD FLOOR. A one-character answer keeps it
      // pending on purpose (see isPending), so this test fills it properly
      // rather than pretending a stub settles it.
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
  it('re-asks a history below the sixty-word floor', () => {
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers: { shooting_history: history(12) },
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
});
