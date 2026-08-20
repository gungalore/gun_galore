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
import { expandFields } from './motivation-field-options';
import { SHOOTING_DISCIPLINES } from './shooting-disciplines';

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
        if (f.kind !== 'choice') continue;
        // A choice field carries its options EITHER inline, or by naming a
        // data module that supplies them. What it may never do is offer a
        // dropdown with nothing in it.
        if (f.optionSource) {
          expect(expandFields([f])[0].optionGroups?.length).toBeGreaterThan(0);
          continue;
        }
        expect(f.choices?.length).toBeGreaterThan(1);
      }
    }
  });

  it('gives every served option list real options, and an "other" escape where promised', () => {
    for (const t of ALL) {
      for (const f of expandFields(fieldsFor(t))) {
        if (!f.optionGroups) continue;
        const values = f.optionGroups.flatMap((g) => g.options.map((o) => o.value));
        expect(values.length).toBeGreaterThan(5);
        // Values are STORED ANSWERS. A duplicate would make one of them
        // unreachable in a <select> and silently change what was saved.
        expect(new Set(values).size).toBe(values.length);
        for (const v of values) expect(v.trim()).not.toBe('');
        if (f.allowOther) expect(values).toContain('other');
        // Anything that seeds another field must have text for every option
        // it offers, or picking one quietly does nothing.
        if (f.prefills) {
          for (const v of values) {
            if (v === 'other') continue;
            expect((f.prefillText?.[v] ?? '').length).toBeGreaterThan(40);
          }
        }
      }
    }
  });

  it('points every prefills at a field that exists in the same type', () => {
    for (const t of ALL) {
      const keys = new Set(fieldsFor(t).map((f) => f.key));
      for (const f of fieldsFor(t)) {
        if (f.prefills) expect(keys.has(f.prefills)).toBe(true);
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
        // A parent whose options are served rather than inline is checked
        // against the SERVED list — which is where 'other' comes from.
        const allowed = parent!.optionSource
          ? expandFields([parent!])[0].optionGroups!.flatMap((g) =>
              g.options.map((o) => o.value),
            )
          : (parent!.choices ?? YES_NO);
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

// ────────────────────────────────────────────────────────────────────
// THE REQUIRED SET GROWS AS THE FORM IS ANSWERED.
//
// This is the property that broke a live application. The wizard used to
// compute "what is still outstanding" by crossing filled answers off the list
// the server sent when the page loaded — a set that can only ever shrink. But
// requiredKeys() filters the registry through isVisible(), so answering a
// question can ADD requirements that were neither required nor visible at
// load. The wizard then showed nothing outstanding, enabled Generate, and the
// server refused with "Some required answers are still missing" and no field
// on screen to fix.
//
// Anything that makes the wizard's view of "required" static again puts that
// dead end back, so the growth is pinned here rather than left as a property
// the registry happens to have today.
// ────────────────────────────────────────────────────────────────────
describe('requirements that appear only once something is answered', () => {
  const married = (extra: Record<string, string> = {}) => ({
    [SAPS271_OPT_KEY]: SAPS271_FILL,
    marital_status: 'Married',
    ...extra,
  });

  it('asks nothing about a spouse until the applicant says they have one', () => {
    const single = { [SAPS271_OPT_KEY]: SAPS271_FILL, marital_status: 'Single' };
    const keys = requiredKeys(MotivationLicenceType.S16_DEDICATED_SPORT, single);
    expect(keys).not.toContain('spouse_name');
    expect(keys).not.toContain('spouse_id_type');
  });

  it('ADDS spouse questions the moment marital status becomes Married', () => {
    const before = requiredKeys(MotivationLicenceType.S16_DEDICATED_SPORT, {
      [SAPS271_OPT_KEY]: SAPS271_FILL,
      marital_status: 'Single',
    });
    const after = requiredKeys(MotivationLicenceType.S16_DEDICATED_SPORT, married());
    const added = after.filter((k) => !before.includes(k));
    // The exact list may grow; that it grows AT ALL is the point.
    expect(added.length).toBeGreaterThan(0);
    expect(added).toContain('spouse_name');
    expect(added).toContain('spouse_id_type');
  });

  it('reports those spouse fields as MISSING, so generate refuses', () => {
    // Exactly the shape of the live failure: every question the applicant
    // could see was answered, and the document still would not generate.
    const missing = missingRequired(MotivationLicenceType.S16_DEDICATED_SPORT, married());
    expect(missing).toContain('spouse_name');
    expect(missing).toContain('spouse_id_type');
  });

  it('keeps the spouse ID NUMBER behind the type it hangs off', () => {
    // A two-step chain: marital_status reveals spouse_id_type, and only
    // answering THAT reveals the number. A wizard that renders one step per
    // section, in dependency order, is what makes the chain reachable.
    const noType = requiredKeys(MotivationLicenceType.S16_DEDICATED_SPORT, married());
    expect(noType).not.toContain('spouse_id_number');

    const withType = requiredKeys(
      MotivationLicenceType.S16_DEDICATED_SPORT,
      married({ spouse_id_type: 'SA ID' }),
    );
    expect(withType).toContain('spouse_id_number');
  });

  it('asks no form-only spouse question at all on the dealer path', () => {
    // Without the 271 opt-in the whole form-only block is out of scope, so
    // marital status must not drag spouse fields in behind it.
    const keys = requiredKeys(MotivationLicenceType.S16_DEDICATED_SPORT, {
      marital_status: 'Married',
    });
    expect(keys).not.toContain('spouse_name');
    expect(keys).not.toContain('marital_status');
  });
});

// ────────────────────────────────────────────────────────────────────
// EVERY OPTION THE FORM OFFERS MUST SURVIVE THE SAVE.
//
// `discipline` draws its fifty-nine options from an optionSource, so it
// carries no `choices` — and the sanitiser's `field.choices ?? YES_NO`
// fallback therefore accepted exactly two values, "Yes" and "No", for a
// shooting-discipline dropdown. Every real answer was discarded.
//
// It failed silently at both ends. The PATCH returned 200 with the key under
// `ignored`, which nothing read, so the wizard said "Saved" and the select
// came back empty on the next load. The applicant saw a section that would
// not stay filled in, and a Generate that refused over a question they had
// answered. Live report: "the Experience keeps resetting".
//
// The general property — the offered set and the accepted set are the same
// set — is what is pinned here. A second optionSource added later inherits
// this test rather than the bug.
// ────────────────────────────────────────────────────────────────────
describe('the form and the validator agree on what a choice may be', () => {
  it('accepts EVERY option offered, for every option-sourced field', () => {
    for (const t of ALL) {
      for (const f of expandFields(fieldsFor(t))) {
        if (!f.optionGroups) continue;
        const offered = f.optionGroups.flatMap((g) =>
          g.options.map((o) => o.value),
        );
        expect(offered.length).toBeGreaterThan(1);
        for (const value of offered) {
          const { answers, refused } = sanitiseAnswers(t, { [f.key]: value });
          expect({ key: f.key, value, refused }).toEqual({
            key: f.key,
            value,
            refused: [],
          });
          expect(answers[f.key]).toBe(value);
        }
      }
    }
  });

  it('still refuses a value that is NOT on the list', () => {
    // The check above would pass trivially if validation had simply been
    // switched off, so the other half is pinned too.
    const t = MotivationLicenceType.S16_DEDICATED_SPORT;
    const { answers, refused } = sanitiseAnswers(t, {
      discipline: 'competitive napping',
    });
    expect(refused).toEqual(['discipline']);
    expect(answers.discipline).toBeUndefined();
  });

  it('accepts the "something else" sentinel, which a field hangs off', () => {
    // discipline_other is revealed by showIf discipline === 'other', so
    // refusing the sentinel would make that question permanently unreachable.
    const t = MotivationLicenceType.S16_DEDICATED_SPORT;
    const { answers, refused } = sanitiseAnswers(t, { discipline: 'other' });
    expect(refused).toEqual([]);
    expect(answers.discipline).toBe('other');
    expect(requiredKeys(t, answers)).toContain('discipline_other');
  });

  it('a HUNTER is not offered, and cannot store, a pure sport discipline', () => {
    // The scope filter feeds the dropdown and the validator from one
    // function; this is the check that they are still the same one.
    const t = MotivationLicenceType.S16_DEDICATED_HUNTER;
    const f = expandFields(fieldsFor(t)).find((x) => x.key === 'discipline');
    if (!f?.optionGroups) return; // hunter pack may not carry the field
    const offered = new Set(
      f.optionGroups.flatMap((g) => g.options.map((o) => o.value)),
    );
    const sportOnly = SHOOTING_DISCIPLINES.filter((d) => d.kind === 'sport');
    expect(sportOnly.length).toBeGreaterThan(0);
    for (const d of sportOnly) {
      expect(offered.has(d.value)).toBe(false);
      expect(sanitiseAnswers(t, { discipline: d.value }).refused).toEqual([
        'discipline',
      ]);
    }
  });

  it('separates a refused VALUE from an unknown KEY', () => {
    // They shared one list and one "ignored unregistered answer keys"
    // warning, so the discipline fault read as routine noise for as long as
    // it existed.
    const t = MotivationLicenceType.S16_DEDICATED_SPORT;
    const res = sanitiseAnswers(t, {
      no_such_field_at_all: 'x',
      discipline: 'competitive napping',
    });
    expect(res.rejected.sort()).toEqual(
      ['discipline', 'no_such_field_at_all'].sort(),
    );
    expect(res.refused).toEqual(['discipline']);
  });
});

// ────────────────────────────────────────────────────────────────────
// WHAT THE APPLICANT ALREADY OWNS IS ASKED ON BOTH PATHS.
//
// These six columns look like SAPS 271 boxes and were marked formOnly, so on
// the dealer path — where the dealer completes the form — the whole section
// disappeared. But motivation-overlap.ts reads the calibre, make and type off
// them, and its verdict goes into the writer's prompt: "does this applicant
// already hold something that does this job" is the objection the Registrar
// raises whether or not we filled in the form. Hidden, the overlap note came
// out empty and the document could not answer it.
// ────────────────────────────────────────────────────────────────────
describe('firearms the applicant already owns', () => {
  const dealerPath = { [SAPS271_OPT_KEY]: 'My dealer will fill it in' };
  const owned = (t: MotivationLicenceType) =>
    fieldsFor(t).filter((f) => /^existing_firearm_\d+_/.test(f.key));

  it('is visible when the dealer is filling the form in', () => {
    for (const t of ALL) {
      const rows = owned(t);
      if (!rows.length) continue;
      for (const f of rows) {
        expect({ key: f.key, visible: isVisible(f, dealerPath) }).toEqual({
          key: f.key,
          visible: true,
        });
      }
    }
  });

  it('is visible when we are filling the form in', () => {
    const both = { [SAPS271_OPT_KEY]: SAPS271_FILL };
    for (const t of ALL) {
      for (const f of owned(t)) {
        expect(isVisible(f, both)).toBe(true);
      }
    }
  });

  it('is never REQUIRED — plenty of applicants own nothing yet', () => {
    // A first-time applicant must not be blocked by a table of firearms they
    // do not have.
    for (const t of ALL) {
      for (const f of owned(t)) {
        expect({ key: f.key, required: !!f.required }).toEqual({
          key: f.key,
          required: false,
        });
      }
    }
  });
});
