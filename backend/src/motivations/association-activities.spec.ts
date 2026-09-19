import { MotivationLicenceType } from '@prisma/client';
import {
  activitiesBlock,
  activitiesFor,
  activityTerms,
  arguesFromExercises,
  statusFor,
} from './association-activities';

/**
 * ⚠️ THE SAFETY PROPERTY IS THE FIRST TEST HERE. Every entry in this file is a
 * claim the applicant signs for and the pack annexes, so the thing that must
 * never break is that an association we hold nothing for gets NOTHING — not a
 * plausible exercise, not a remembered rule. `hasActivityRules` stays false and
 * the paragraph rests on type and section, which is the state the whole
 * codebase was in before this file existed.
 */
describe('the association activity library', () => {
  it('gives an association we hold nothing for exactly nothing', () => {
    expect(activitiesFor({ association: 'SAHGCA' })).toEqual([]);
    expect(activitiesFor({ association: 'Some Club' })).toEqual([]);
    expect(activitiesFor({ association: '' })).toEqual([]);
    expect(activitiesFor({})).toEqual([]);
  });

  it('finds an association by any name the applicant might type', () => {
    // One body, three spellings — the applicant types this by hand.
    for (const spelling of [
      'NHSA',
      'Natshoot',
      'National Hunting and Shooting Association',
      'nhsa',
    ]) {
      expect(activitiesFor({ association: spelling }).length).toBeGreaterThan(
        0,
      );
    }
  });

  it('does not match on a name that merely contains the letters', () => {
    // "nhsa" folded is a substring of nothing here, but a longer word must not
    // drag the list in by accident.
    expect(activitiesFor({ association: 'Not The N H S A Body' })).toEqual([]);
  });

  it('puts the exercises of the status being argued first, without dropping the rest', () => {
    const hunter = activitiesFor({ association: 'NHSA', status: 'hunter' });
    expect(hunter[0].status).toBe('hunter');
    // The sport exercises are still there for the model to reason with.
    expect(hunter.some((a) => a.status === 'sport')).toBe(true);

    const sport = activitiesFor({ association: 'NHSA', status: 'sport' });
    expect(sport[0].status).toBe('sport');
  });

  it('carries the rule, the distance and the source into the model input', () => {
    const block = activitiesBlock(activitiesFor({ association: 'NHSA' }));
    const two = block.find((b) => b.exercise === '7 m 2x5 shot');
    expect(two).toMatchObject({
      distance: '7 m',
      firearm_class: 'Handgun',
      eligibility_rule: 'only 9mmP pistols and larger',
      counts_toward: 'sport',
    });
    // ⚠️ THE SOURCE TRAVELS WITH THE RULE, so the operator can check it.
    expect(two?.source).toBeTruthy();
  });

  it('hands the validator the rule text, so a quoted distance is supplied material', () => {
    // validateReason refuses a distance "nothing supplied supports". The rule
    // the model was given IS supplied material, and it contains "7 m".
    const terms = activityTerms(activitiesFor({ association: 'NHSA' }));
    expect(terms).toContain('only 9mmP pistols and larger');
    expect(terms.some((t) => /\d+\s*m\b/i.test(t))).toBe(true);
  });
});

describe('which licence types argue from exercises', () => {
  it('is the two dedicated types and the section 15 that covers both', () => {
    expect(
      arguesFromExercises(MotivationLicenceType.S16_DEDICATED_HUNTER),
    ).toBe(true);
    expect(arguesFromExercises(MotivationLicenceType.S16_DEDICATED_SPORT)).toBe(
      true,
    );
    expect(
      arguesFromExercises(MotivationLicenceType.S15_OCCASIONAL_HUNTER),
    ).toBe(true);
  });

  it('is not the self-defence or renewal types, which have no such angle', () => {
    // REASON_ANGLES offers `exercise_eligibility` to neither, and supplying the
    // list would invite a sentence the validator refuses.
    expect(arguesFromExercises(MotivationLicenceType.S13_SELF_DEFENCE)).toBe(
      false,
    );
    expect(
      arguesFromExercises(MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE),
    ).toBe(false);
    expect(arguesFromExercises(MotivationLicenceType.S24_RENEWAL)).toBe(false);
  });

  it('argues a status only where the type argues one', () => {
    expect(statusFor(MotivationLicenceType.S16_DEDICATED_HUNTER)).toBe(
      'hunter',
    );
    expect(statusFor(MotivationLicenceType.S16_DEDICATED_SPORT)).toBe('sport');
    // ⚠️ S15 IS ONE VALUE COVERING BOTH, so ordering its list would pick an
    // argument the applicant never chose.
    expect(
      statusFor(MotivationLicenceType.S15_OCCASIONAL_HUNTER),
    ).toBeUndefined();
  });
});
