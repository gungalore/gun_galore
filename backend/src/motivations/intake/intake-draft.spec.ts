import { MotivationLicenceType } from '@prisma/client';
import {
  DRAFTED_KEYS,
  affectsDraftFacts,
  draftAllowTerms,
  draftFacts,
  draftTargets,
  draftedFields,
  fallbackDraft,
  validateDraft,
  type DraftFacts,
} from './intake-draft';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE NARRATIVE DRAFTER — the pure half.
 *
 * Operator decision 2026-11-26: intake asks only facts no document can supply.
 * The shooting history, the threat circumstances, the hunting/sport record and
 * the renewal's continued use are drafted from the file and reviewed by the
 * applicant. These specs pin WHAT is drafted, WHAT may reach the model, and the
 * deterministic rules that keep a plausible paragraph from becoming a checkable
 * lie.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ALL_TYPES = [
  MotivationLicenceType.S13_SELF_DEFENCE,
  MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
  MotivationLicenceType.S15_OCCASIONAL_HUNTER,
  MotivationLicenceType.S16_DEDICATED_HUNTER,
  MotivationLicenceType.S16_DEDICATED_SPORT,
  MotivationLicenceType.S24_RENEWAL,
] as const;

const factsFor = (
  type: MotivationLicenceType,
  purpose: 'hunting' | 'sport' | 'both' = 'hunting',
): DraftFacts =>
  ({
    licence_type: String(type),
    licence_type_key: type,
    purpose,
    firearm: {},
    association: {},
    held_firearms: [],
    premises: {},
    documents: [],
    narrative_so_far: {},
  }) as DraftFacts;

describe('the drafted narrative fields', () => {
  it('contains exactly the narrative keys the brief names', () => {
    expect([...DRAFTED_KEYS].sort()).toEqual(
      [
        'activity_record',
        'competition_record',
        'continued_use',
        'daily_movements',
        'hunt_game_class',
        'hunt_reasons',
        'hunt_terrain',
        'hunt_where',
        'hunting_history',
        'hunting_locations',
        's13_carry_style',
        's13_movements',
        'sport_formats',
        'sport_reasons',
        'shooting_history',
        'threat_circumstances',
        'training_history',
      ].sort(),
    );
  });
});

describe('affectsDraftFacts — the review-screen re-draft trigger', () => {
  it('fires only when a fact the drafter consumed moved', () => {
    for (const key of [
      'firearm_type',
      'firearm_calibre',
      'firearm_cartridge',
      'firearm_use_kind',
      'intended_quarry',
      'hunt_game_class',
      'discipline_exercise',
      'association_name',
      'association_joined',
      'dedicated_since',
      'occupation',
      'residence_type',
      'police_station_province',
      'premises_enclosure',
      'existing_firearm_1_calibre',
    ]) {
      expect({ key, changed: affectsDraftFacts([key]) }).toEqual({
        key,
        changed: true,
      });
    }
  });

  it('does NOT fire for an edit to a narrative answer, or to unrelated keys', () => {
    // ⚠️ Retrying a word in the paragraph itself must never pay for a whole
    // model pass over every other paragraph.
    for (const key of [
      'shooting_history',
      'threat_circumstances',
      'hunting_history',
      'sport_formats',
      'continued_use',
      'full_name',
      'id_number',
      'firearm_serial',
      'safe_present',
      'history_conviction',
      'not_a_key',
    ]) {
      expect({ key, changed: affectsDraftFacts([key]) }).toEqual({
        key,
        changed: false,
      });
    }
  });

  it('is false for an empty change list', () => {
    expect(affectsDraftFacts([])).toBe(false);
  });
});

describe('draftTargets', () => {
  it('targets the self-defence narrative on S13 and S14, and no hunting/sport', () => {
    for (const type of [
      MotivationLicenceType.S13_SELF_DEFENCE,
      MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
    ]) {
      const keys = draftTargets(type, {}).map((target) => target.key);
      expect(keys).toEqual(
        expect.arrayContaining([
          'shooting_history',
          'threat_circumstances',
          'daily_movements',
          's13_movements',
          's13_carry_style',
        ]),
      );
      expect(keys).not.toContain('hunt_game_class');
      expect(keys).not.toContain('sport_formats');
      expect(keys).not.toContain('continued_use');
    }
  });

  it('targets the hunting branch on a hunting purpose and the sport branch on sport', () => {
    const hunting = draftTargets(MotivationLicenceType.S15_OCCASIONAL_HUNTER, {
      firearm_use_kind: 'hunting',
    }).map((target) => target.key);
    expect(hunting).toEqual(
      expect.arrayContaining([
        'hunt_game_class',
        'hunt_terrain',
        'hunt_where',
        'hunt_reasons',
        'hunting_history',
        'hunting_locations',
        'shooting_history',
      ]),
    );
    expect(hunting).not.toContain('sport_formats');
    expect(hunting).not.toContain('competition_record');

    const sport = draftTargets(MotivationLicenceType.S16_DEDICATED_SPORT, {
      firearm_use_kind: 'sport',
    }).map((target) => target.key);
    expect(sport).toEqual(
      expect.arrayContaining([
        'sport_reasons',
        'sport_formats',
        'competition_record',
        'shooting_history',
      ]),
    );
    expect(sport).not.toContain('hunt_game_class');
    expect(sport).not.toContain('hunting_locations');
  });

  it('targets both branches when the purpose is both', () => {
    const keys = draftTargets(MotivationLicenceType.S15_OCCASIONAL_HUNTER, {
      firearm_use_kind: 'both',
    }).map((target) => target.key);
    expect(keys).toEqual(
      expect.arrayContaining(['hunt_terrain', 'sport_formats', 'shooting_history']),
    );
  });

  it('uses resolveSportingPurpose, not a bare router answer, for a handgun', () => {
    // A handgun is argued as sport whatever `firearm_use_kind` says; a hunting
    // paragraph would contradict the document the writer is about to produce.
    const keys = draftTargets(MotivationLicenceType.S16_DEDICATED_SPORT, {
      firearm_use_kind: 'hunting',
      firearm_type: 'Handgun',
    }).map((target) => target.key);
    expect(keys).not.toContain('hunt_game_class');
    expect(keys).toContain('competition_record');
  });

  it('targets the renewal narrative on S24', () => {
    const keys = draftTargets(MotivationLicenceType.S24_RENEWAL, {}).map(
      (target) => target.key,
    );
    expect(keys).toContain('continued_use');
    expect(keys).toContain('shooting_history');
    expect(keys).not.toContain('threat_circumstances');
  });

  it('skips a field that already holds an answer', () => {
    const keys = draftTargets(MotivationLicenceType.S16_DEDICATED_HUNTER, {
      shooting_history: 'typed by the member',
      firearm_use_kind: 'hunting',
    }).map((target) => target.key);
    expect(keys).not.toContain('shooting_history');
    expect(keys).toContain('hunting_history');
  });

  it('carries the option keys a cards target may choose from', () => {
    const target = draftTargets(MotivationLicenceType.S16_DEDICATED_HUNTER, {
      firearm_use_kind: 'hunting',
    }).find((entry) => entry.key === 'hunt_terrain');
    expect(target?.kind).toBe('cards');
    expect(target?.options?.length).toBeGreaterThan(1);
    expect(target?.options?.[0]).toEqual(
      expect.objectContaining({ key: expect.any(String), label: expect.any(String) }),
    );
  });
});

describe('draftFacts — the projection sent to the model', () => {
  const answers: Record<string, string> = {
    firearm_type: 'Rifle',
    firearm_action: 'Bolt action',
    firearm_make: 'Tikka',
    firearm_model: 'T3x',
    firearm_calibre: '6.5',
    firearm_cartridge: '6.5 PRC',
    firearm_serial: 'SECRET-SERIAL',
    id_number: '8001015009087',
    full_name: 'A B',
    residential_address: '1 Main Road',
    home_telephone: '011 555 1234',
    occupation: 'Engineer',
    residence_type: 'Townhouse or complex',
    police_station_province: 'Gauteng',
    intended_quarry: 'Kudu',
    hunt_game_class: 'plains_medium',
    discipline_exercise: '100m exercise',
    association_name: 'SA Hunters',
    association_joined: '2018-01-01',
    dedicated_since: '2019-01-01',
    association_number: 'M-1',
    premises_enclosure: 'Walled with an electric gate',
    alarm_present: 'Yes',
    history_conviction: 'No',
    history_conviction_detail: 'nothing to disclose',
    existing_firearm_1_type: 'Handgun',
    existing_firearm_1_make: 'Glock',
    existing_firearm_1_calibre: '9 mm Luger',
    existing_firearm_1_serial: 'SERIAL-2',
    existing_firearm_1_section_held: 'section_13',
    existing_firearm_1_use: 'Self-defence at home',
    shooting_history: 'A long narrative the model should not be handed? It is not sensitive.',
    threat_circumstances: 'Sensitive circumstances',
    firearm_use_kind: 'hunting',
  };
  const facts = draftFacts(
    MotivationLicenceType.S16_DEDICATED_HUNTER,
    answers,
    [{ kind: 'COMPETENCY_CERTIFICATE', label: 'My competency certificate' }],
  );

  it('carries the firearm and the cartridge, but never the serial', () => {
    expect(facts.firearm).toMatchObject({
      type: 'Rifle',
      action: 'Bolt action',
      make: 'Tikka',
      model: 'T3x',
      calibre: '6.5',
      cartridge: '6.5 PRC',
    });
    expect(JSON.stringify(facts)).not.toContain('SECRET-SERIAL');
  });

  it('carries none of the applicant identifiers, contact details or declarations', () => {
    const json = JSON.stringify(facts);
    expect(json).not.toContain('8001015009087');
    expect(json).not.toContain('A B');
    expect(json).not.toContain('1 Main Road');
    expect(json).not.toContain('011 555 1234');
    expect(json).not.toContain('nothing to disclose');
  });

  it('carries the purpose, quarry, exercise, association and premises taps', () => {
    expect(facts.purpose).toBe('hunting');
    expect(facts.intended_quarry).toBe('Kudu');
    expect(facts.discipline_exercise).toBe('100m exercise');
    expect(facts.association).toMatchObject({
      name: 'SA Hunters',
      joined: '2018-01-01',
      dedicated_since: '2019-01-01',
    });
    expect(JSON.stringify(facts.association)).not.toContain('M-1');
    expect(facts.premises.premises_enclosure).toBe('Walled with an electric gate');
    expect(facts.province).toBe('Gauteng');
    expect(facts.residence_type).toBe('Townhouse or complex');
    expect(facts.occupation).toBe('Engineer');
  });

  it('carries the battery as type/make/model/calibre/use rows, never serials or sections', () => {
    expect(facts.held_firearms).toEqual([
      {
        type: 'Handgun',
        make: 'Glock',
        calibre: '9 mm Luger',
        use: 'Self-defence at home',
      },
    ]);
    const json = JSON.stringify(facts);
    expect(json).not.toContain('SERIAL-2');
    expect(json).not.toContain('section_13');
  });

  it('carries the documents as kinds and labels only, and the narrative already present', () => {
    expect(facts.documents).toEqual([
      { kind: 'COMPETENCY_CERTIFICATE', label: 'My competency certificate' },
    ]);
    expect(facts.narrative_so_far.shooting_history).toContain('long narrative');
    // A sensitive narrative answer is never echoed to the model.
    expect(facts.narrative_so_far.threat_circumstances).toBeUndefined();
  });

  it('turns a saved cards answer into the sentences the model can read', () => {
    expect(facts.hunt_game_class).toBe('I hunt medium to large plains game.');
  });
});

describe('validateDraft — what may be stored as a suggestion', () => {
  const long = (text: string) => ({ kind: 'long' as const, allowTerms: [] });

  it('accepts the deterministic fallbacks for every type and purpose', () => {
    for (const type of ALL_TYPES) {
      for (const purpose of ['hunting', 'sport', 'both'] as const) {
        const facts = factsFor(type, purpose);
        for (const key of ['shooting_history', 'continued_use']) {
          const draft = fallbackDraft(key, facts);
          if (!draft) continue;
          const issues = validateDraft(key, draft, long(draft));
          expect({ type, purpose, key, issues }).toEqual({
            type,
            purpose,
            key,
            issues: [],
          });
        }
      }
    }
  });

  it('requires the long word band, and a shorter floor for continued_use', () => {
    const words = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        String.fromCharCode(97 + (i % 26)).repeat(3),
      ).join(' ');
    expect(validateDraft('shooting_history', 'Too short.', long(''))).toEqual(
      expect.arrayContaining([expect.stringContaining('words')]),
    );
    expect(validateDraft('continued_use', words(45), long(''))).toEqual([]);
    expect(validateDraft('shooting_history', words(45), long(''))).toEqual(
      expect.arrayContaining([expect.stringContaining('words')]),
    );
    expect(validateDraft('shooting_history', words(250), long(''))).toEqual(
      expect.arrayContaining([expect.stringContaining('words')]),
    );
  });

  it('refuses digits, dates, measurements and approximations', () => {
    const base = Array.from({ length: 70 }, () => 'ok').join(' ');
    expect(validateDraft('shooting_history', `${base} in 2019`, long(''))).toEqual(
      expect.arrayContaining([expect.stringContaining('digit')]),
    );
    expect(
      validateDraft('shooting_history', `${base} in June`, long('')),
    ).toEqual(expect.arrayContaining([expect.stringContaining('month')]));
    expect(
      validateDraft('shooting_history', `${base} at five metres`, long('')),
    ).toEqual(expect.arrayContaining([expect.stringContaining('measurement')]));
    expect(
      validateDraft('shooting_history', `${base} about twenty`, long('')),
    ).toEqual(expect.arrayContaining([expect.stringContaining('approximate')]));
  });

  it('refuses second person, but allows it inside a supplied quote', () => {
    const base = Array.from({ length: 70 }, () => 'ok').join(' ');
    expect(
      validateDraft('shooting_history', `${base} you must practise`, long('')),
    ).toEqual(expect.arrayContaining([expect.stringContaining('first person')]));
    expect(
      validateDraft(
        'shooting_history',
        `${base} as they put it "you must practise", which I did`,
        long(''),
      ),
    ).toEqual([]);
  });

  it('refuses claims a signed motivation must not make', () => {
    const base = Array.from({ length: 70 }, () => 'ok').join(' ');
    for (const claim of [
      'no criminal record',
      'guaranteed',
      'will be approved',
      'stopping power',
      'as an AI',
    ]) {
      expect(
        validateDraft('shooting_history', `${base} ${claim}`, long('')),
      ).toEqual(expect.arrayContaining([expect.any(String)]));
    }
  });

  it('refuses an invented proper noun but allows a supplied one', () => {
    const base = Array.from({ length: 70 }, () => 'ok').join(' ');
    expect(
      validateDraft('shooting_history', `${base} I shoot a Tikka rifle`, long('')),
    ).toEqual(expect.arrayContaining([expect.stringContaining('Tikka')]));
    expect(
      validateDraft(
        'shooting_history',
        `${base} I shoot a Tikka rifle`,
        { kind: 'long', allowTerms: ['Tikka T3x'] },
      ),
    ).toEqual([]);
  });

  it('folds spelling before it judges, so an Americanism is not a refusal', () => {
    const text =
      'I have organised my practice around the centre-fire rifle and my defense of the licence conditions. ' +
      Array.from({ length: 60 }, () => 'ok').join(' ');
    expect(validateDraft('shooting_history', text, long(''))).toEqual([]);
  });

  it('validates a cards answer by option key, 1–4 values', () => {
    const opts = { kind: 'cards' as const, optionKeys: ['a', 'b', 'c'] };
    expect(validateDraft('hunt_terrain', 'a', opts)).toEqual([]);
    expect(validateDraft('hunt_terrain', ' a , b ', opts)).toEqual([]);
    expect(validateDraft('hunt_terrain', '', opts)).toEqual([
      'the answer is empty',
    ]);
    expect(validateDraft('hunt_terrain', 'a, b, c, a ', { ...opts, optionKeys: ['a', 'b', 'c', 'd'] })).toEqual([]);
    expect(validateDraft('hunt_terrain', 'z', opts)).toEqual(
      expect.arrayContaining([expect.stringContaining('option keys')]),
    );
    expect(
      validateDraft('hunt_terrain', 'a, b, c, a, b', opts),
    ).toEqual(expect.arrayContaining([expect.stringContaining('four')]));
    // The model may return whitespace around an option key; it is trimmed.
    expect(validateDraft('hunt_terrain', ' a ', { ...opts, optionKeys: [' a '] })).toEqual([]);
  });

  it('honours maxLength on a short answer', () => {
    expect(
      validateDraft('intended_quarry', 'Kudu and impala', {
        kind: 'short',
        maxLength: 20,
      }),
    ).toEqual([]);
    expect(
      validateDraft('intended_quarry', 'Kudu and impala and more', {
        kind: 'short',
        maxLength: 5,
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('characters')]));
  });
});

describe('fallbackDraft', () => {
  it('only covers the two gated narrative fields', () => {
    expect(fallbackDraft('shooting_history', factsFor(MotivationLicenceType.S13_SELF_DEFENCE))).toBeTruthy();
    expect(fallbackDraft('continued_use', factsFor(MotivationLicenceType.S24_RENEWAL))).toBeTruthy();
    expect(fallbackDraft('hunt_terrain', factsFor(MotivationLicenceType.S16_DEDICATED_HUNTER))).toBeNull();
    expect(fallbackDraft('training_history', factsFor(MotivationLicenceType.S13_SELF_DEFENCE))).toBeNull();
  });

  it('writes no hunting vocabulary into a self-defence fallback', () => {
    for (const type of [
      MotivationLicenceType.S13_SELF_DEFENCE,
      MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
    ]) {
      const draft = fallbackDraft('shooting_history', factsFor(type, 'sport'))!;
      expect(draft.toLowerCase()).not.toMatch(/\bhunt/);
      expect(draft.toLowerCase()).not.toMatch(/\bgame\b/);
      expect(draft.toLowerCase()).not.toMatch(/\bquarry\b/);
    }
  });

  it('makes no checkable claim — no digits, no firsts, no named people', () => {
    for (const type of ALL_TYPES) {
      for (const purpose of ['hunting', 'sport', 'both'] as const) {
        for (const key of ['shooting_history', 'continued_use']) {
          const draft = fallbackDraft(key, factsFor(type, purpose));
          if (!draft) continue;
          expect(draft).not.toMatch(/\d/);
          expect(draft.toLowerCase()).not.toMatch(/\bmetre|\bkilometre|\bpercent/);
          expect(draft.toLowerCase()).not.toMatch(/\bfirst firearm\b/);
          expect(draft.toLowerCase()).not.toMatch(/\bno criminal record\b/);
        }
      }
    }
  });
});
