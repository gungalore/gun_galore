import { MotivationLicenceType } from '@prisma/client';
import {
  factPackFields,
  fieldsFor,
  isVisible,
  missingRequired,
  requiredKeys,
  sanitiseAnswers,
  SAPS271_FILL,
  SAPS271_OPT_KEY,
  YES_NO,
} from './motivation-fields';

// The registry is the contract between the wizard, the SAPS 271, the prompt and
// the quality gate. Everything here guards a way that contract can be broken
// silently — a value that ends up in a box on a form the applicant signs, or a
// value that reaches a model when it should never have left our database.

const ALL = Object.values(MotivationLicenceType);
const T = MotivationLicenceType.S13_SELF_DEFENCE;

// The SAPS 271 is opt-in (operator, 2026-08-19). Tests about form-tier fields
// must opt in first, exactly as an applicant would.
const WITH_FORM = { [SAPS271_OPT_KEY]: SAPS271_FILL };

describe('field registry integrity', () => {
  it('has no duplicate keys within a licence type', () => {
    for (const t of ALL) {
      const keys = fieldsFor(t).map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('gives every choice field its choices', () => {
    for (const t of ALL) {
      for (const f of fieldsFor(t)) {
        if (f.kind === 'choice') expect(f.choices?.length).toBeGreaterThan(1);
      }
    }
  });

  it('points every showIf at a field that exists, with a value it can hold', () => {
    // A typo here would hide a field forever, and nobody would notice until an
    // applicant reached the station with a blank box.
    for (const t of ALL) {
      const fields = fieldsFor(t);
      const byKey = new Map(fields.map((f) => [f.key, f]));
      for (const f of fields) {
        if (!f.showIf) continue;
        const parent = byKey.get(f.showIf.key);
        expect(parent).toBeDefined();
        const allowed = parent!.choices ?? YES_NO;
        expect(allowed).toContain(f.showIf.equals);
      }
    }
  });

  it('never offers fully automatic as an action', () => {
    // Not licensable to a private person, so it must not be selectable on a
    // form we help someone sign.
    const action = fieldsFor(T).find((f) => f.key === 'firearm_action')!;
    expect(action.choices!.join(' ').toLowerCase()).not.toMatch(
      /fully automatic|^automatic/,
    );
    expect(action.choices).toContain('Semi-automatic (self-loading)');
  });

  it('does not ask for anything the ID number already carries', () => {
    // Two boxes on one signed form that disagree is exactly what a DFO notices.
    const keys = ALL.flatMap((t) => fieldsFor(t).map((f) => f.key));
    for (const derived of [
      'date_of_birth',
      'age',
      'gender',
      'citizenship',
      'dob',
    ]) {
      expect(keys).not.toContain(derived);
    }
  });
});

describe('the firearm in its own boxes', () => {
  it('replaced the single free-text description', () => {
    const keys = fieldsFor(T).map((f) => f.key);
    expect(keys).not.toContain('firearm_description');
    for (const k of [
      'firearm_type',
      'firearm_action',
      'firearm_make',
      'firearm_model',
      'firearm_calibre',
      'firearm_serial',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('does not force a serial number', () => {
    // On a new application the dealer holds the firearm; demanding a serial
    // would block anyone who has not chosen the exact one yet.
    const serial = fieldsFor(T).find((f) => f.key === 'firearm_serial')!;
    expect(serial.required).toBeUndefined();
  });
});

describe('the six history questions', () => {
  const HISTORY = [
    'history_conviction',
    'history_pending_case',
    'history_lost_stolen',
    'history_negligence',
    'history_declared_unfit',
    'history_confiscated',
  ];

  it('asks all six, on every licence type', () => {
    for (const t of ALL) {
      const keys = fieldsFor(t).map((f) => f.key);
      for (const h of HISTORY) expect(keys).toContain(h);
    }
  });

  it('never defaults to "No" — each is required and unanswered until asked', () => {
    // We do not answer a question about someone's criminal record on their
    // behalf, on a form they sign.
    const fields = fieldsFor(T);
    for (const h of HISTORY) {
      const f = fields.find((x) => x.key === h)!;
      expect(f.kind).toBe('yesno');
      expect(f.required).toBe(true);
    }
    // All but the negligence question, which is chained to the loss question
    // and so does not apply until something has been lost. The history
    // questions are form-tier, so the applicant must have opted into the 271.
    const asked = HISTORY.filter((h) => h !== 'history_negligence');
    expect(missingRequired(T, WITH_FORM)).toEqual(expect.arrayContaining(asked));
    expect(missingRequired(T, WITH_FORM)).not.toContain('history_negligence');

    // …and on the dealer path NONE of them are asked at all.
    expect(missingRequired(T, {})).not.toEqual(
      expect.arrayContaining(['history_conviction']),
    );
  });

  it('asks for detail only once something is disclosed', () => {
    const clean = missingRequired(T, { history_conviction: 'No' });
    expect(clean).not.toContain('history_conviction');
    expect(clean).not.toContain('history_conviction_detail');

    const disclosed = missingRequired(T, { history_conviction: 'Yes' });
    expect(disclosed).toContain('history_conviction_detail');
  });

  it('only asks about a negligence case if something was lost', () => {
    expect(
      missingRequired(T, { ...WITH_FORM, history_lost_stolen: 'No' }),
    ).not.toContain('history_negligence');
    expect(
      missingRequired(T, { ...WITH_FORM, history_lost_stolen: 'Yes' }),
    ).toContain('history_negligence');
  });
});

describe('what reaches the writer', () => {
  it('withholds contact details and a spouse ID from the fact pack', () => {
    const packKeys = factPackFields(T).map((f) => f.key);
    for (const pii of [
      'home_telephone',
      'work_telephone',
      'postal_address',
      'spouse_name',
      'spouse_id_number',
      'firearm_serial',
    ]) {
      expect(packKeys).not.toContain(pii);
    }
  });

  it('withholds a clean history but not a disclosure', () => {
    // Six "No" answers in the pack is an invitation to pad the document with
    // "the applicant has no convictions, no pending cases…". The DETAIL of a
    // disclosure is the opposite: it is the thing that must be met head-on.
    const packKeys = factPackFields(T).map((f) => f.key);
    expect(packKeys).not.toContain('history_conviction');
    expect(packKeys).toContain('history_conviction_detail');
  });

  it('still passes the substance through', () => {
    const packKeys = factPackFields(T).map((f) => f.key);
    for (const k of [
      'firearm_fit_reason',
      'safe_storage_detail',
      'threat_circumstances',
      'firearm_calibre',
    ]) {
      expect(packKeys).toContain(k);
    }
  });
});

describe('sanitiseAnswers', () => {
  it('rejects a choice that is not on the list', () => {
    // These values are printed into boxes on a signed form, so an arbitrary
    // string from a hand-rolled request would become a false statement.
    const { answers, rejected } = sanitiseAnswers(T, {
      firearm_type: 'Rocket launcher',
      firearm_action: 'Bolt action',
    });
    expect(rejected).toEqual(['firearm_type']);
    expect(answers.firearm_action).toBe('Bolt action');
    expect(answers.firearm_type).toBeUndefined();
  });

  it('rejects anything but Yes or No on a history question', () => {
    expect(sanitiseAnswers(T, { history_conviction: 'maybe' }).rejected).toEqual(
      ['history_conviction'],
    );
    expect(sanitiseAnswers(T, { history_conviction: 'Yes' }).answers).toEqual({
      history_conviction: 'Yes',
    });
  });

  it('still allows a choice to be cleared', () => {
    expect(sanitiseAnswers(T, { firearm_type: '' }).answers).toEqual({
      firearm_type: '',
    });
    expect(sanitiseAnswers(T, { firearm_type: null }).answers).toEqual({
      firearm_type: '',
    });
  });

  it('caps a long answer without rejecting it', () => {
    const { answers, rejected } = sanitiseAnswers(T, {
      threat_circumstances: 'x'.repeat(9000),
    });
    expect(rejected).toEqual([]);
    expect(answers.threat_circumstances).toHaveLength(4000);
  });
});

describe('isVisible', () => {
  it('is true for an unconditional field whatever the answers are', () => {
    const f = fieldsFor(T).find((x) => x.key === 'occupation')!;
    expect(isVisible(f, {})).toBe(true);
  });

  it('matches on the exact value, not merely on being answered', () => {
    const spouse = fieldsFor(T).find((x) => x.key === 'spouse_name')!;
    // Form-tier, so the opt-in comes first; then the marital condition.
    expect(isVisible(spouse, { ...WITH_FORM, marital_status: 'Single' })).toBe(false);
    expect(isVisible(spouse, { ...WITH_FORM, marital_status: 'Married' })).toBe(true);
    // Married but NOT opted in: still hidden — the field only exists for the form.
    expect(isVisible(spouse, { marital_status: 'Married' })).toBe(false);
    expect(isVisible(spouse, {})).toBe(false);
  });
});

describe('requiredKeys', () => {
  it('returns the unconditional set when no answers are supplied', () => {
    // The wizard needs a denominator before anything has been typed.
    const bare = requiredKeys(T);
    expect(bare).not.toContain('spouse_name');
    expect(bare).toContain('firearm_make');
  });

  it('grows as conditions come true', () => {
    const single = requiredKeys(T, { ...WITH_FORM, marital_status: 'Single' });
    const married = requiredKeys(T, { ...WITH_FORM, marital_status: 'Married' });
    // Married adds the spouse's name and the ID-TYPE question. The SA ID
    // number itself only becomes required once the type says SA ID — a spouse
    // with a passport must not be asked for an ID that does not exist.
    expect(married.length).toBe(single.length + 2);
    expect(married).toEqual(expect.arrayContaining(['spouse_name', 'spouse_id_type']));
    expect(married).not.toContain('spouse_id_number');

    const saId = requiredKeys(T, {
      ...WITH_FORM,
      marital_status: 'Married',
      spouse_id_type: 'SA ID',
    });
    expect(saId).toContain('spouse_id_number');
    const passport = requiredKeys(T, {
      ...WITH_FORM,
      marital_status: 'Married',
      spouse_id_type: 'Passport',
    });
    expect(passport).not.toContain('spouse_id_number');
  });
});


// ── the SAPS 271 opt-in (operator, 2026-08-19) ──────────────────────
//
// "The 271 form is an addition. The motivation is the big cookie. The user
// must have the option not to have the 271 filled in — most of the time the
// dealer will fill in the form for them already."

describe('the SAPS 271 opt-in', () => {
  it('asks the question first, and requires a deliberate answer', () => {
    const first = fieldsFor(T)[0];
    expect(first.key).toBe(SAPS271_OPT_KEY);
    expect(first.required).toBe(true);
    expect(first.choices).toContain(SAPS271_FILL);
  });

  it('hides EVERY form-only field on the dealer path', () => {
    // This is the effort collapse: say the dealer does the form and phones,
    // postal codes, marital status, the spouse, the firearms table and the six
    // history questions simply never appear.
    const hidden = fieldsFor(T).filter(
      (f) => f.formOnly && f.key !== SAPS271_OPT_KEY && isVisible(f, {}),
    );
    expect(hidden).toEqual([]);
  });

  it('keeps the motivation path down to the answers the document needs', () => {
    const required = requiredKeys(T, {});
    // The opt-in itself plus the document tier — nothing form-only.
    expect(required.length).toBeLessThanOrEqual(16);
    for (const k of required) {
      const f = fieldsFor(T).find((x) => x.key === k)!;
      if (k !== SAPS271_OPT_KEY) expect(f.formOnly).toBeUndefined();
    }
  });

  it('restores the full set when the applicant opts in', () => {
    const dealer = requiredKeys(T, {});
    const filled = requiredKeys(T, WITH_FORM);
    expect(filled.length).toBeGreaterThan(dealer.length + 5);
    expect(filled).toEqual(expect.arrayContaining(['marital_status', 'safe_present']));
  });

  it('never deletes form answers when someone switches to the dealer path', () => {
    // Hidden is not erased: switching back restores everything they typed.
    const { answers } = sanitiseAnswers(T, { home_telephone: '0111234567' });
    expect(answers.home_telephone).toBe('0111234567');
  });
});

describe('ID numbers typed like a human types them', () => {
  it('survives spaces, which used to truncate the last digits off', () => {
    // "8001 0150 0908 7" hit the 13-character cap four digits early, failed
    // the Luhn check, and silently lost DOB, age, gender and citizenship.
    const { answers } = sanitiseAnswers(T, { id_number: '8001 0150 0908 7' });
    expect(answers.id_number).toBe('8001015009087');
  });

  it('strips dashes and stray characters too', () => {
    const { answers } = sanitiseAnswers(T, {
      spouse_id_number: '820302-0082-088',
    });
    expect(answers.spouse_id_number).toBe('8203020082088');
  });

  it('leaves the passport field alone — passports are alphanumeric', () => {
    const { answers } = sanitiseAnswers(T, {
      spouse_passport_number: 'A1234 567',
    });
    expect(answers.spouse_passport_number).toBe('A1234 567');
  });
});
