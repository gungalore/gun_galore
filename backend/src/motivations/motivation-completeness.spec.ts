import { MotivationLicenceType } from '@prisma/client';
import {
  MIN_HISTORY_WORDS,
  missingDetail,
  missingDetailMessage,
} from './motivation-completeness';

const words = (n: number): string =>
  Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const HISTORY = words(MIN_HISTORY_WORDS);

/** A self-defence set with nothing missing — the control. */
function completeS13(): Record<string, string> {
  return {
    firearm_type: 'Handgun',
    firearm_action: 'Semi-automatic',
    firearm_make: 'Glock',
    firearm_model: '43X',
    firearm_calibre: '9mm Parabellum',
    firearm_serial: 'ABC123',
    competency_number: 'C10167347',
    competency_for: 'Handgun',
    competency_issued: '2022-01-01',
    shooting_history: HISTORY,
    alternative_considered: 'A CZ P10C, because it fits my hand better',
    safe_present: 'Yes',
    safe_type: 'Handgun safe',
    safe_mounted: 'Yes',
    safe_mounted_to: 'Wall',
    safe_key_holder: 'Only me',
    firearm_use_kind: 'self-defence',
  };
}

function codes(gaps: { code: string }[]): string[] {
  return gaps.map((gap) => gap.code);
}

describe('missingDetail', () => {
  it('reports the firearm first when nothing is answered', () => {
    const gaps = missingDetail({}, MotivationLicenceType.S13_SELF_DEFENCE);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].code).toBe('firearm:firearm_type');
    expect(codes(gaps)).toContain('history:shooting_history');
  });

  it('passes a complete self-defence application', () => {
    expect(
      missingDetail(completeS13(), MotivationLicenceType.S13_SELF_DEFENCE),
    ).toEqual([]);
  });

  // ⚠️ THE SMS THIS EXISTS FOR: a complete form with no history generated a
  // pack, and the member was told afterwards that it needed more detail.
  it('refuses a hunting application with no quarry named', () => {
    const answers = {
      ...completeS13(),
      association_name: 'NHSA',
      association_number: '9407315019081',
      association_joined: '2019-08-17',
      dedicated_since: '2019-09-01',
      firearm_use_kind: 'hunting',
    };
    const gaps = missingDetail(
      answers,
      MotivationLicenceType.S16_DEDICATED_HUNTER,
    );
    expect(codes(gaps)).toContain('purpose:intended_quarry');
    expect(codes(gaps)).not.toContain('association:association_name');
  });

  it('refuses dedicated sport without the exercise it is entered in', () => {
    const answers = {
      ...completeS13(),
      association_name: 'NHSA',
      association_number: '9407315019081',
      association_joined: '2019-08-17',
      dedicated_since: '2019-09-01',
      firearm_use_kind: 'sport',
    };
    const gaps = missingDetail(
      answers,
      MotivationLicenceType.S16_DEDICATED_SPORT,
    );
    expect(codes(gaps)).toContain('exercise:discipline_exercise');

    const done = missingDetail(
      { ...answers, discipline_exercise: '10m, Medium-Bore Centre-Fire Handgun Exercise' },
      MotivationLicenceType.S16_DEDICATED_SPORT,
    );
    expect(codes(done)).not.toContain('exercise:discipline_exercise');
  });

  it('requires the association facts on a dedicated application', () => {
    const gaps = missingDetail(
      { ...completeS13(), firearm_use_kind: 'sport' },
      MotivationLicenceType.S16_DEDICATED_SPORT,
    );
    expect(codes(gaps)).toContain('association:association_name');
    expect(codes(gaps)).toContain('association:dedicated_since');
  });

  // A 59-word history is a stub; 60 is the floor.
  it('measures the history in words, not in characters', () => {
    const short = missingDetail(
      { ...completeS13(), shooting_history: words(MIN_HISTORY_WORDS - 1) },
      MotivationLicenceType.S13_SELF_DEFENCE,
    );
    expect(codes(short)).toContain('history:shooting_history');

    const exact = missingDetail(
      { ...completeS13(), shooting_history: words(MIN_HISTORY_WORDS) },
      MotivationLicenceType.S13_SELF_DEFENCE,
    );
    expect(codes(exact)).not.toContain('history:shooting_history');
  });

  it('says what is missing in one sentence', () => {
    const gaps = missingDetail({}, MotivationLicenceType.S13_SELF_DEFENCE);
    const message = missingDetailMessage(gaps);
    expect(message).toContain('not ready to write yet');
    expect(message).toContain('the type of firearm');
    expect(missingDetailMessage([])).toBe('');
  });
});
