import { MotivationLicenceType } from '@prisma/client';
import { readSaId, splitName } from './sa-id';
import type { Saps271FieldName } from './saps271-coords';

// ────────────────────────────────────────────────────────────────────
// ANSWERS → BOXES ON THE SAPS 271.
//
// Pure, so the whole mapping can be tested without a PDF anywhere near it. The
// service applies what this returns; it decides nothing.
//
// THREE PLACES WHERE OUR QUESTION AND THE FORM'S BOX DISAGREE, on purpose:
//
//   ACTION.   We ask for bolt / lever / pump / self-loading / revolver / break,
//             because a motivation can reason about "a bolt-action .308" and
//             cannot reason about "Manual". The form offers only Semi-automatic
//             / Automatic / Manual, so everything that is not self-loading maps
//             to Manual. Automatic is NEVER ticked: it is not licensable to a
//             private person and this form is signed by one.
//
//   SERIAL.   The form has no "serial number" box. It has barrel, frame and
//             receiver serials, because the frame or receiver IS the firearm in
//             law. One serial is what an applicant actually has, so it goes to
//             the frame box for a handgun and the receiver box otherwise.
//
//   WIDOWED.  The form splits Widow and Widower by gender. We do not make
//             someone pick a gendered word about themselves in a wizard, so
//             "Widowed" resolves from the gender the ID number already carries
//             — and where it cannot be read, NEITHER box is ticked and the
//             applicant marks it themselves. Guessing here writes something
//             untrue about a person onto a form they sign.
//
// ⚠️ NOTHING IS INVENTED. A missing answer leaves a box empty. An empty box is
// a nuisance; a wrong one is a false statement on a firearm licence
// application, and section 120(9)(f) of the Act makes that an offence.
//
// ⚠️ NO SIGNATURE, NO DATE OF SIGNING. The operator's own guidance: SAPS forms
// are signed in front of the DFO. Confirmed 2026-08-18.
//
// ⚠️ SECTIONS A, B, C AND K ARE OFFICIAL USE, and section F belongs to the
// CURRENT OWNER — the dealer or private seller fills and signs it. None of
// those field names exist in the coordinate map, so this cannot reach them.
// ────────────────────────────────────────────────────────────────────

/** What the service writes: a value per box, plus what it could not do. */
export interface Saps271Values {
  /** Text boxes and character rows. */
  text: Partial<Record<Saps271FieldName, string>>;
  /** Boxes to mark with an X. */
  ticks: Saps271FieldName[];
  /**
   * Boxes left deliberately blank, with the reason. Surfaced to the applicant
   * as "complete these by hand" rather than hidden.
   */
  leftBlank: { field: string; because: string }[];
}

export interface Saps271Input {
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;
  /** Account email — the form asks and we hold it. */
  email?: string;
  /** Reference printed into item 61 instead of the motivation itself. */
  motivationReference?: string;
  /** Injected so a re-render reproduces the age it was generated with. */
  asAt?: Date;
}

/** Licence types that appear in section D. A renewal is a different form. */
const SECTION_D: Partial<Record<MotivationLicenceType, Saps271FieldName>> = {
  S13_SELF_DEFENCE: 'd_section_13',
  S15_OCCASIONAL_HUNTER: 'd_section_15',
  S16_DEDICATED_HUNTER: 'd_section_16',
  S16_DEDICATED_SPORT: 'd_section_16',
};

const FIREARM_TYPE_TICK: Record<string, Saps271FieldName> = {
  Rifle: 'e_type_rifle',
  Shotgun: 'e_type_shotgun',
  Handgun: 'e_type_handgun',
  Combination: 'e_type_combination',
};

const SAFE_TYPE_TICK: Record<string, Saps271FieldName> = {
  'Handgun safe': 'safe_type_handgun',
  'Rifle safe': 'safe_type_rifle',
  Strongroom: 'safe_type_strongroom',
  'Other device': 'safe_type_device',
};

/** The six history questions, in the order the form asks them. */
const HISTORY: {
  answer: string;
  yes: Saps271FieldName;
  no: Saps271FieldName;
  detail: { from: string; to: Saps271FieldName }[];
}[] = [
  {
    answer: 'history_conviction',
    yes: 'h_conviction_yes',
    no: 'h_conviction_no',
    detail: [
      { from: 'history_conviction_station', to: 'h_conviction_station' },
      { from: 'history_conviction_case_number', to: 'h_conviction_case' },
      { from: 'history_conviction_charge', to: 'h_conviction_charge' },
      { from: 'history_conviction_outcome', to: 'h_conviction_outcome' },
    ],
  },
  {
    answer: 'history_pending_case',
    yes: 'h_pending_yes',
    no: 'h_pending_no',
    detail: [
      { from: 'history_pending_case_station', to: 'h_pending_station' },
      { from: 'history_pending_case_case_number', to: 'h_pending_case' },
      { from: 'history_pending_case_charge', to: 'h_pending_offence' },
    ],
  },
  {
    answer: 'history_lost_stolen',
    yes: 'h_lost_stolen_yes',
    no: 'h_lost_stolen_no',
    detail: [
      { from: 'history_lost_stolen_station', to: 'h_lost_stolen_station' },
      { from: 'history_lost_stolen_case_number', to: 'h_lost_stolen_case' },
      {
        from: 'history_lost_stolen_circumstances',
        to: 'h_lost_stolen_circumstances',
      },
      { from: 'history_lost_stolen_firearm', to: 'h_lost_stolen_firearm' },
    ],
  },
  {
    answer: 'history_negligence',
    yes: 'h_negligence_yes',
    no: 'h_negligence_no',
    detail: [
      { from: 'history_negligence_station', to: 'h_negligence_station' },
      { from: 'history_negligence_case_number', to: 'h_negligence_case' },
      { from: 'history_negligence_charge', to: 'h_negligence_charge' },
      { from: 'history_negligence_outcome', to: 'h_negligence_outcome' },
    ],
  },
  {
    answer: 'history_declared_unfit',
    yes: 'h_unfit_yes',
    no: 'h_unfit_no',
    detail: [
      { from: 'history_declared_unfit_station', to: 'h_unfit_station' },
      { from: 'history_declared_unfit_case_number', to: 'h_unfit_case' },
      { from: 'history_declared_unfit_charge', to: 'h_unfit_charge' },
      { from: 'history_declared_unfit_period', to: 'h_unfit_period' },
    ],
  },
  {
    answer: 'history_confiscated',
    yes: 'h_confiscated_yes',
    no: 'h_confiscated_no',
    detail: [
      { from: 'history_confiscated_station', to: 'h_confiscated_station' },
      { from: 'history_confiscated_case_number', to: 'h_confiscated_case' },
      {
        from: 'history_confiscated_circumstances',
        to: 'h_confiscated_circumstances',
      },
      { from: 'history_confiscated_outcome', to: 'h_confiscated_outcome' },
    ],
  },
];

/** dd-mm-yyyy → the 8 digits the form's cells expect. */
function dateDigits(raw: string): string {
  const s = (raw ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[3]}${iso[2]}${iso[1]}`;
  const dmy = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/.exec(s);
  if (dmy) return `${dmy[1].padStart(2, '0')}${dmy[2].padStart(2, '0')}${dmy[3]}`;
  // Anything else is left alone rather than guessed at — a date written into
  // the wrong cells reads as a different date entirely.
  return '';
}

/**
 * Build every value the form needs.
 *
 * Throws for a section 24 renewal, which is NOT this form: section D lists
 * sections 13 to 20 only. Producing a 271 for a renewal would have someone
 * queue at a police station with the wrong paperwork.
 */
export function buildSaps271(input: Saps271Input): Saps271Values {
  const { licenceType, answers, asAt = new Date() } = input;

  const sectionD = SECTION_D[licenceType];
  if (!sectionD) {
    throw new Error(
      'The SAPS 271 is an application for a new licence (sections 13-20). A section 24 renewal uses a different form.',
    );
  }

  const text: Partial<Record<Saps271FieldName, string>> = {};
  const ticks: Saps271FieldName[] = [];
  const leftBlank: { field: string; because: string }[] = [];

  const put = (field: Saps271FieldName, value: string | undefined | null) => {
    const v = (value ?? '').trim();
    if (v) text[field] = v;
  };
  const tick = (field: Saps271FieldName | undefined) => {
    if (field) ticks.push(field);
  };
  const a = (key: string) => (answers[key] ?? '').trim();

  // ── section D ──
  tick(sectionD);
  if (a('licence_holder_type') === 'Additional firearm licence holder') {
    tick('d_holder_additional');
  } else if (a('licence_holder_type')) {
    tick('d_holder_main');
  }

  // ── section E — the firearm ──
  tick(FIREARM_TYPE_TICK[a('firearm_type')]);

  const action = a('firearm_action');
  if (action) {
    // Self-loading is the only thing the form calls semi-automatic. Everything
    // else we offer is manually operated — and Automatic is never ticked.
    tick(
      action === 'Self-loading (semi-automatic)'
        ? 'e_action_semi_auto'
        : 'e_action_manual',
    );
  }
  put('e_calibre', a('firearm_calibre'));
  put('e_make', a('firearm_make'));
  put('e_model', a('firearm_model'));

  const serial = a('firearm_serial');
  if (serial) {
    // The frame is the firearm on a handgun; the receiver on everything else.
    put(
      a('firearm_type') === 'Handgun' ? 'e_frame_serial' : 'e_receiver_serial',
      serial,
    );
  }

  // ── section G — the applicant ──
  const id = readSaId(a('id_number'), asAt);
  const name = splitName(a('full_name'));

  put('g_surname', name.surname);
  put('g_initials', name.initials);
  put('g_full_names', name.firstNames || a('full_name'));
  put('g_id_number', a('id_number').replace(/\s/g, ''));

  if (id.dateOfBirth) {
    const d = id.dateOfBirth;
    put(
      'g_date_of_birth',
      `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${d.getUTCFullYear()}`,
    );
  }
  if (id.age !== null) put('g_age', String(id.age));

  if (id.gender === 'male') tick('g_gender_male');
  else if (id.gender === 'female') tick('g_gender_female');
  else {
    leftBlank.push({
      field: 'Gender',
      because: 'we could not read it from the ID number',
    });
  }

  if (id.citizenship === 'sa_citizen') tick('g_citizen_sa');
  else if (id.citizenship === 'permanent_resident') tick('g_citizen_pr');

  put('g_residential_address', a('residential_address'));
  put('g_postal_address', a('postal_address'));
  put('g_residence_type', a('residence_type'));
  put('g_occupation', a('occupation'));
  put('g_employer', a('employer_name'));
  put('g_business_address', a('employer_address'));
  put('g_cellphone', a('cellphone'));
  put('g_email', input.email);

  put('g_competency_number', a('competency_number'));
  put('g_competency_issued', dateDigits(a('competency_issued')));
  put('g_competency_expiry', dateDigits(a('competency_expiry')));

  // ── marital status ──
  const marital = a('marital_status');
  if (marital === 'Single') tick('g_marital_single');
  else if (marital === 'Married') tick('g_marital_married');
  else if (marital === 'Divorced') tick('g_marital_divorced');
  else if (marital === 'Widowed') {
    if (id.gender === 'female') tick('g_marital_widow');
    else if (id.gender === 'male') tick('g_marital_widower');
    else {
      // The form has no ungendered box, and writing the wrong one is a false
      // statement about a person. They mark it themselves.
      leftBlank.push({
        field: 'Marital status',
        because:
          'the form separates Widow and Widower, and we could not read gender from the ID number',
      });
    }
  } else if (marital === 'Life partner') {
    leftBlank.push({
      field: 'Marital status',
      because:
        'the form has no "life partner" box — mark Other and write it in',
    });
  }

  if (marital === 'Married') {
    put('g_spouse_name', a('spouse_name'));
    if (a('spouse_id_type') !== 'Passport') {
      tick('g_spouse_id_type_sa');
      put('g_spouse_id_number', a('spouse_id_number').replace(/\s/g, ''));
    }
  }

  // ── firearms already owned ──
  for (let n = 1; n <= 6; n++) {
    const p = `existing_firearm_${n}_`;
    put(`g_owned_${n}_type` as Saps271FieldName, a(`${p}type`));
    put(`g_owned_${n}_calibre` as Saps271FieldName, a(`${p}calibre`));
    put(`g_owned_${n}_make` as Saps271FieldName, a(`${p}make`));
    put(`g_owned_${n}_barrel_serial` as Saps271FieldName, a(`${p}barrel_serial`));
    put(`g_owned_${n}_frame_serial` as Saps271FieldName, a(`${p}frame_serial`));
    put(`g_owned_${n}_licence` as Saps271FieldName, a(`${p}licence_no`));
  }

  // ── the six history questions ──
  for (const q of HISTORY) {
    const said = a(q.answer);
    if (said === 'Yes') {
      tick(q.yes);
      for (const d of q.detail) put(d.to, a(d.from));
    } else if (said === 'No') {
      tick(q.no);
    } else {
      leftBlank.push({
        field: q.answer,
        because: 'you have not answered this question yet',
      });
    }
  }

  // ── the safe ──
  if (a('safe_present') === 'Yes') {
    tick('safe_yes');
    tick(SAFE_TYPE_TICK[a('safe_type')]);
    if (a('safe_mounted') === 'Yes') {
      tick('safe_mounted_yes');
      if (a('safe_mounted_to') === 'Wall') tick('safe_mounted_wall');
      else if (a('safe_mounted_to') === 'Floor') tick('safe_mounted_floor');
    } else if (a('safe_mounted') === 'No') {
      tick('safe_mounted_no');
    }
  } else if (a('safe_present') === 'No') {
    tick('safe_no');
  }

  // ── item 61 — the motivation reference, never the motivation ──
  if (input.motivationReference) {
    put('g_motivation_reference', motivationReferenceLine(input.motivationReference));
  }

  return { text, ticks, leftBlank };
}

/**
 * What goes in item 61, "Motivation of purpose for which the firearm is
 * required".
 *
 * A REFERENCE, never the motivation. Operator, 2026-08-18. It is also the only
 * thing that fits — the box is a few lines and the document runs to several
 * pages — and it is how a reviewer expects to find an annexure.
 */
export function motivationReferenceLine(
  reference: string,
  annexureLetter?: string,
): string {
  const annexure = annexureLetter ? ` (Annexure ${annexureLetter})` : '';
  return `Please see the attached motivation${annexure}, reference ${reference}, which is submitted with this application and forms part of it.`;
}
