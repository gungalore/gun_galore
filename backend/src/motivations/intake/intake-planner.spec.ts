import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from '../motivation-sheet.service';
import {
  pendingFields,
  planQuestion,
  purposeForAnswers,
} from './intake-planner';
import { fieldByKey } from '../motivation-fields';
import { sportingFields, strategyFor } from './intake-strategies';

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

  it('opens the declaration follow-ups when the answer is Yes', () => {
    const strategy = strategyFor(MotivationLicenceType.S15_OCCASIONAL_HUNTER);
    const answers: Record<string, string> = {};
    for (const key of strategy.fields) {
      if (key === 'history_conviction') continue;
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
    expect(q?.fieldKey).toBe('history_conviction');
    expect(q?.details?.map((d) => d.key)).toContain(
      'history_conviction_detail',
    );
    expect(q?.choices.map((c) => c.value)).toEqual(['Yes', 'No']);
  });});

describe('MOTIVATION_ONLY', () => {
  it('does not ask SAPS 271 form-only answers', () => {
    const answers = {
      ...COMMON,
      firearm_use_kind: 'hunting',
      marital_status: 'Married',
      spouse_id_type: 'SA ID',
    };
    const full = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers,
      sheet: EMPTY_SHEET,
    });
    const letter = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers,
      sheet: EMPTY_SHEET,
      outputMode: 'MOTIVATION_ONLY',
    });
    expect(full.map((f) => f.key)).toContain('spouse_id_number');
    expect(letter.map((f) => f.key)).not.toContain('spouse_id_number');
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

