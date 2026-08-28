import { MotivationLicenceType } from '@prisma/client';
import { parseEndorsements } from '../common/sa-competency';
import {
  FIREARM_SOURCE_KEY,
  SOURCE_DEALER,
  SOURCE_ESTATE,
  SOURCE_PRIVATE,
} from './motivation-fields';
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

/**
 * What the CURRENT OWNER supplied, for section F.
 *
 * ⚠️ HIS, NOT THE APPLICANT'S — and it arrives by a different road. He fills
 * it in on his own phone through a consent link; the applicant never types it
 * and never holds a copy of his identity document. So it comes in as its own
 * input rather than through `answers`, which is the applicant's blob, and
 * nothing here may ever be defaulted from the applicant's own details.
 *
 * Every field is optional because he answers over time — the card first, the
 * declaration later — and a half-answered section F must print what it has and
 * say plainly what it has not.
 */
export interface Saps271Seller {
  /** Item 6, and item 82 on the declaration. As HE typed it. */
  fullName?: string;
  /** Items 7 and 83. */
  idNumber?: string;
  /** Item 4. Only when he gave it separately — never split from fullName. */
  surname?: string;
  /** Item 5. Same rule. */
  initials?: string;
  residentialAddress?: string;
  residentialPostalCode?: string;
  postalAddress?: string;
  postalPostalCode?: string;
  cellphone?: string;
  email?: string;
  /** Item 79 — where the firearm is kept TODAY, which is still his address. */
  firearmAddress?: string;
  firearmPostalCode?: string;
  /** Item 84 — "owner", "executor", "authorised person". */
  designation?: string;
  /** Item 86. */
  place?: string;
  /** Item 85, the date he signed. yyyy-mm-dd. */
  signedOn?: string;
  /** Items 12.1 and 12.2 — his landlines, if he has them. */
  homeTelephone?: string;
  workTelephone?: string;
  /**
   * Item 15 — is anyone else licensed to hold this firearm?
   *
   * Undefined means he has not been asked, and neither box is ticked. A
   * default of `false` would be us making a statement about his household.
   */
  additionalHolders?: boolean;
}

export interface Saps271Input {
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;
  /** Section F. Absent on a dealer or estate route, and on an unstarted one. */
  seller?: Saps271Seller;
  /** Account email — the form asks and we hold it. */
  email?: string;
  /** Reference printed into item 61 instead of the motivation itself. */
  motivationReference?: string;
  /** Injected so a re-render reproduces the age it was generated with. */
  asAt?: Date;
  /**
   * The annexure letter carrying the photographs of the safe.
   *
   * ⚠️ UNDEFINED WHEN NOTHING WAS UPLOADED, AND THAT IS LOAD-BEARING. Items
   * 68.1 and 69.1 are answered by pointing at those photographs; pointing at
   * an annexure that is not in the pack is a false statement on a form signed
   * under section 120(9)(f). Absent here means the boxes stay empty and the
   * applicant is told why.
   */
  safeAnnexureLetter?: string;
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

/**
 * WHERE THE SHORT DESCRIPTION GOES, PER TYPE OF SAFE.
 *
 * Item 68.1 is three printed rows, not one box: Handgun and Rifle share a row
 * and its 212.9pt band, Strongroom has its own row and a 422.6pt band, Device
 * likewise. The description belongs beside the type it describes, so the tick
 * chooses the band.
 */
const SAFE_DETAIL_BOX: Record<string, Saps271FieldName> = {
  'Handgun safe': 'safe_detail_handgun_rifle',
  'Rifle safe': 'safe_detail_handgun_rifle',
  Strongroom: 'safe_detail_strongroom',
  'Other device': 'safe_detail_device',
};

/**
 * What items 68.1 and 69.1 are answered with.
 *
 * Operator, 2026-08-28: "on the safe questions, Add see annexure(whatever the
 * safe pictures are) for the submit full details."
 *
 * The right answer to "submit full details" about a safe is the photographs of
 * it, and they are already in the pack under their own letter. A cross
 * reference is what a reviewer expects to find and what fits the band; the
 * applicant's own `safe_storage_detail` prose runs to 2000 characters and
 * would be shrunk to nothing or dropped by the fitter.
 */
const seeSafeAnnexure = (letter: string) =>
  `See Annexure ${letter} (photographs of the safe)`;

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
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  const dmy = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}${dmy[2].padStart(2, '0')}${dmy[1].padStart(2, '0')}`;
  // Anything else is left alone rather than guessed at — a date written into
  // the wrong cells reads as a different date entirely.
  return '';
}


/**
 * A South African landline, split into its dialling code and the rest.
 *
 * ⚠️ SPLIT ONLY WHERE IT IS UNAMBIGUOUS. The form prints "( )" for the code and
 * a box after it for the number. A plain ten-digit local number beginning 0 —
 * 0211234567 — splits cleanly at three. Anything else (international, short,
 * carrying an extension) goes whole into the number box with the code left
 * empty: a wrongly split telephone number is a wrong telephone number, and the
 * code box is not worth guessing at.
 */
function splitTelephone(raw: string): { code: string; number: string } {
  const digits = (raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return { code: '', number: '' };
  if (digits.length === 10 && digits.startsWith('0')) {
    return { code: digits.slice(0, 3), number: digits.slice(3) };
  }
  return { code: '', number: (raw ?? '').trim() };
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
  } else {
    // ⚠️ REPORTED, NOT GUESSED, AND NOT SILENT EITHER. Section D asks whether
    // this is a main or an additional licence and both boxes were going in
    // blank on every application, because nothing said so. Defaulting to
    // "main" would be right most of the time and a false statement the rest —
    // an additional licence under section 12(1) is a real status of a person
    // living at the holder's premises. So it joins the history questions in
    // leftBlank, where the applicant is told to mark it themselves.
    leftBlank.push({
      field: 'licence_holder_type',
      because:
        'you have not said whether this is your main licence or an additional one',
    });
  }

  // ── section E — the firearm ──
  tick(FIREARM_TYPE_TICK[a('firearm_type')]);

  const action = a('firearm_action');
  if (action) {
    // The form calls this "Semi-automatic". Everything
    // else we offer is manually operated — and Automatic is never ticked.
    tick(
      action === 'Semi-automatic (self-loading)'
        ? 'e_action_semi_auto'
        : 'e_action_manual',
    );
  }
  put('e_calibre', a('firearm_calibre'));
  put('e_make', a('firearm_make'));
  put('e_model', a('firearm_model'));

  // ⚠️ THREE SERIAL ROWS, EACH WITH ITS OWN MAKE — items 1.7 to 1.12. Four of
  // these six boxes had no coordinate until section F was measured, so the
  // barrel serial and all three makes were read off the card and then thrown
  // away at print time.
  //
  // Written VERBATIM, "NONE" included. Operator, 2026-08-23: "You insert
  // exactly what is on the license card, as that is what is registered with
  // the SAPS system. if it says NONE, you put NONE." A real card reads barrel
  // NONE / receiver MR90189D, and tidying the NONE to blank would make our
  // form disagree with the register it exists to match.
  put('e_barrel_serial', a('barrel_serial'));
  put('e_barrel_make', a('barrel_make'));
  put('e_frame_serial', a('frame_serial'));
  put('e_frame_make', a('frame_make'));
  put('e_receiver_serial', a('receiver_serial'));
  put('e_receiver_make', a('receiver_make'));

  // FALLBACK, for an application captured before the component fields existed
  // or typed in by hand: one serial, placed on the row that IS the firearm in
  // law — the frame on a handgun, the receiver on everything else.
  //
  // ⚠️ ONLY WHERE THE ROW IS STILL EMPTY. A card that gave us its own receiver
  // serial must not have it overwritten by a heuristic.
  const serial = a('firearm_serial');
  if (serial) {
    const box =
      a('firearm_type') === 'Handgun' ? 'e_frame_serial' : 'e_receiver_serial';
    if (!text[box]) put(box, serial);
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
      // ⚠️ YYYYMMDD — see dateDigits. This built DDMMYYYY and printed a date
      // of birth that read 1205-19-89.
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`,
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
  // ⚠️ THE POSTAL CODES HAD BOXES AND NOTHING WROTE THEM. All three were
  // measured, all three sat empty on every form we produced, and only the
  // SELLER's equivalents were ever filled — so an applicant's own address went
  // in without its code while the current owner's did not.
  put('g_residential_postal_code', a('residential_postal_code'));
  put('g_postal_postal_code', a('postal_postal_code'));
  put('g_business_postal_code', a('employer_postal_code'));
  put('g_postal_address', a('postal_address'));
  put('g_residence_type', a('residence_type'));
  put('g_occupation', a('occupation'));
  put('g_employer', a('employer_name'));
  put('g_business_address', a('employer_address'));
  put('g_cellphone', a('cellphone'));
  put('g_email', input.email);

  // ⚠️ WHICH COMPETENCY, AND FOR WHAT. The whole of item 1 went in blank: only
  // the number and the two dates were ever written, so a DFO read a
  // certificate number against four unmarked boxes and three unmarked firearm
  // types. Operator, 2026-08-28: "G. 1 Needs a tick on the type of competency
  // and which firearm directly below it."
  //
  // ⚠️ D IS THE ONLY ONE THIS PIPELINE CAN TICK, and it is a fact rather than
  // a guess: every licence type this form is generated for is a section 13, 15
  // or 16 POSSESSION licence (see SECTION_D above, which has no other keys), and
  // possession rests on a category-D competency. A competency to trade, to
  // manufacture or to work as a gunsmith is a different certificate for a
  // different purpose and could never be what one of these applications rests
  // on. A, B and C stay unticked because they would be untrue, not because
  // they are unknown.
  if (SECTION_D[input.licenceType]) tick('g_competency_type_d');

  // The three firearm boxes under 1.4, from the endorsements the certificate
  // actually carries. The registry has held this answer for this box all
  // along — competency_for's own comment says "Item 1.4 lets you mark more
  // than one" — and nothing was reading it.
  //
  // A muzzle-loader endorsement has no box on the form; it is left unticked
  // rather than folded into rifle or shotgun.
  const endorsed = parseEndorsements(a('competency_for'));
  if (endorsed.includes('handgun')) tick('g_competency_for_handgun');
  if (endorsed.includes('rifle-mo') || endorsed.includes('rifle-sl')) {
    tick('g_competency_for_rifle');
  }
  if (endorsed.includes('shotgun')) tick('g_competency_for_shotgun');

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
    if (a('spouse_id_type') === 'Passport') {
      // ⚠️ THE BRANCH THAT WAS NEVER WRITTEN. A spouse identified by passport
      // got NEITHER box: not the passport tick, not the number, not even the
      // SA one. Their identification vanished off the form, while the registry
      // collected `spouse_passport_number` the whole time.
      tick('g_spouse_id_type_passport');
      put('g_spouse_passport', a('spouse_passport_number').replace(/\s/g, ''));
    } else if (a('spouse_id_type')) {
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
  //
  // Both 68.1 and 69.1 say SUBMIT FULL DETAILS, and both are answered by
  // pointing at the photographs — see seeSafeAnnexure above. The pointer is
  // only written where there is something to point at.
  const safeLetter = input.safeAnnexureLetter;
  const pointAtSafe = (box: Saps271FieldName | undefined, item: string) => {
    if (!box) return;
    if (safeLetter) {
      put(box, seeSafeAnnexure(safeLetter));
      return;
    }
    leftBlank.push({
      field: `saps271_item_${item}`,
      because:
        'item ' +
        item +
        ' asks you to submit full details of the safe, and we answer it by pointing at your photographs of it — upload those and this fills in',
    });
  };

  if (a('safe_present') === 'Yes') {
    tick('safe_yes');
    const type = a('safe_type');
    tick(SAFE_TYPE_TICK[type]);
    // ⚠️ ONLY WHERE A TYPE WAS TICKED. Writing the description into a row
    // whose tick box is empty describes a safe the form does not say they
    // have, and picking a row for them would be inventing the answer.
    if (SAFE_TYPE_TICK[type]) pointAtSafe(SAFE_DETAIL_BOX[type], '68.1');
    if (a('safe_mounted') === 'Yes') {
      tick('safe_mounted_yes');
      if (a('safe_mounted_to') === 'Wall') tick('safe_mounted_wall');
      else if (a('safe_mounted_to') === 'Floor') tick('safe_mounted_floor');
      // 69.1 is "IF YES", so it is answered only on a mounted safe — and the
      // bolts fixing it down are in the same annexure.
      pointAtSafe('safe_detail_mounted', '69.1');
    } else if (a('safe_mounted') === 'No') {
      tick('safe_mounted_no');
    }
  } else if (a('safe_present') === 'No') {
    tick('safe_no');
  }

  // ── SECTION F — WHO CURRENTLY OWNS THE FIREARM ──────────────────
  //
  // Item 1.2 routes the whole section: five tick boxes, A to E, and each one
  // sends the reader to a different block of the form.
  //
  // ⚠️ THE TICK COMES FROM THE APPLICANT'S STATED ROUTE, NOT FROM WHETHER WE
  // HAPPEN TO HOLD A SELLER. It used to tick A — "Private owner" —
  // unconditionally, the moment an `input.seller` object existed, because the
  // presence of that object was mistaken for the answer to this question. A
  // dealer purchase would have printed "private owner", and an inherited
  // firearm would have printed it too: a false statement about who owns the
  // firearm, on a form signed under section 120(9)(f) of the Firearms Control
  // Act. Nothing had reached paper yet — renderSaps271 does not pass a seller —
  // so it was fixed before the wiring landed rather than after.
  //
  // ⚠️ AND THE BLOCK IS STILL TYPE A ONLY. Ticking B is a true statement; it
  // is also the whole of what we may say on that route. Operator, 2026-08-28:
  // "F. Type B and SAP 350 can be left alone, a dealer needs to fill in
  // those." A part-filled block reads as complete and is not.
  const source = a(FIREARM_SOURCE_KEY);
  const ownerTypeTick: Record<string, Saps271FieldName> = {
    [SOURCE_PRIVATE]: 'f_owner_type_a',
    [SOURCE_DEALER]: 'f_owner_type_b',
    // Retired as a CHOICE — operator, 2026-08-28: "lets keep the options
    // between Individual and dealer for now" — but still read, because an
    // application written before that decision carries the answer and would
    // otherwise be routed to the wrong block entirely.
    [SOURCE_ESTATE]: 'f_owner_type_e',
  };

  // ⚠️ NO TICK FOR C AND D. The platform offers neither the company route nor
  // the imported-firearm route, so nothing may ever tick them; the boxes are
  // measured so that the day either is built the geometry is derived from the
  // form rather than guessed at.
  //
  // ⚠️ AND NOTHING IS INFERRED. There is no fallback onto the private route
  // from the mere existence of a seller. Operator, 2026-08-28: "the tick
  // should be either dealer or private. not default to fucking private. We
  // have a option to select where this firearm is coming from." The form asks
  // the question and so do we; answering it on the applicant's behalf, from a
  // side effect of some other part of the flow, is exactly how "A. Private
  // owner" ended up printed on every application in the first place.
  //
  // Unanswered means unticked. The DFO sees an empty box and the applicant is
  // told which question closes it.
  const routed = ownerTypeTick[source];
  if (routed) tick(routed);

  const seller = source === SOURCE_PRIVATE ? input.seller : undefined;
  if (input.seller && !seller) {
    // We hold a current owner's details and are deliberately not printing
    // them, so say which it is rather than leaving a silent blank.
    const because =
      source === SOURCE_DEALER
        ? 'your dealer completes section F — we tick that the current owner is a firearm dealer and leave the rest of that section blank for them. Upload their invoice or quote if you have one; it is not required'
        : source === SOURCE_ESTATE
          ? 'an estate firearm uses its own block on the form, which the executor completes by hand'
          : 'you have not told us where this firearm is coming from, so we do not know which of the form’s five owner blocks is yours';
    leftBlank.push({ field: FIREARM_SOURCE_KEY, because });
  }
  if (seller) {
    put('f_full_names', seller.fullName);
    put('f_id_number', seller.idNumber);
    put('f_residential_address', seller.residentialAddress);
    put('f_residential_postal_code', seller.residentialPostalCode);
    put('f_postal_address', seller.postalAddress);
    put('f_postal_postal_code', seller.postalPostalCode);
    put('f_cellphone', seller.cellphone);
    put('f_email', seller.email);
    const sellerHome = splitTelephone(seller.homeTelephone ?? '');
    put('f_home_dialling_code', sellerHome.code);
    put('f_home_telephone', sellerHome.number);
    const sellerWork = splitTelephone(seller.workTelephone ?? '');
    put('f_work_dialling_code', sellerWork.code);
    put('f_work_telephone', sellerWork.number);

    // Item 15 — "Are there any additional firearm licence holders for this
    // firearm?" His answer, not the applicant's, and it had no box until now.
    // Unanswered stays unticked: a NO we invented would be a statement about
    // somebody else's household.
    if (seller.additionalHolders === true) tick('f_additional_holders_yes');
    else if (seller.additionalHolders === false) tick('f_additional_holders_no');

    // ⚠️ THE FORM ASKS FOR A SURNAME AND INITIALS SEPARATELY, AND WE DO NOT
    // SPLIT A NAME TO GET THEM. "van der Merwe", "du Toit", "Ntuli Khumalo" —
    // there is no rule that gets these right, and a wrong surname on a
    // declaration somebody signs under section 120(9)(f) is not a cosmetic
    // error. He gives them separately or they stay blank and are written in
    // by hand.
    put('f_surname', seller.surname);
    put('f_initials', seller.initials);
    if (seller.fullName && !seller.surname) {
      leftBlank.push({
        field: 'f_surname',
        because:
          'the seller gave one full name and we will not guess which part of it is the surname',
      });
    }

    // ── items 79 and 80 — WHERE THE FIREARM IS KEPT MEANWHILE ──
    //
    // Operator, 2026-08-28: "79 and 80 is the address where the firearm is
    // kept while this application is in progress."
    //
    // ⚠️ ITEMS 79 TO 87 ARE DELIBERATELY NOT WRITTEN, ON ANY ROUTE.
    //
    // They were filled from the seller until 2026-08-28. Operator, on why they
    // belong to TYPE E: "the declaration is there because of the nature of
    // Type E, because there is no living person the license could belong too.
    // Someone has to keep the firearms. If it is Type A, the license will be
    // in a living persons name and they will need to have it in a safe at
    // their house of residence according to law. So no need to declare you are
    // keeping it safe in Type A's case or Type B as a dealer."
    //
    // That is the reasoning the boxes turn on. On a private sale the current
    // owner is a living licence holder whose own licence already obliges him
    // to keep the firearm in a compliant safe at his residence — regulation
    // 86 and section 83 — so item 79 asks him to state a fact the law has
    // already settled. On a deceased estate there is no such person, and
    // somebody has to say where the firearms are and that they hold them
    // lawfully.
    //
    // ⚠️ AND THE CONSENT IS NOT LOST BY LEAVING THEM BLANK. It is captured on
    // OUR OWN signed annexure — his two declarations, his signature, and both
    // sides of his licence card — which goes into the pack. See
    // motivation-seller-consent.service.ts.
    //
    // NOTE FOR WHOEVER REVISITS THIS. Item 81's printed text reads "I hereby
    // declare that the above firearm(s) is/are legally in my possession and
    // that I propose to sell or supply it to the applicant once the necessary
    // licence(s) has/have been obtained", and item 82 is headed "current
    // owner/authorized person". Section F's numbering also runs 1 to 87
    // unbroken, with no TYPE heading before 79. Both readings have support;
    // the operator's is the one in force, and this is the single place to
    // change it back.

    // ⚠️ ITEM 87, HIS SIGNATURE, IS NOT PRINTED BY US AND HAS NO COORDINATE.
    // He signs the paper in ink. A captured signature is enough for us to fill
    // the form and check the details agree; it is not what a DFO accepts.
    leftBlank.push({
      field: 'f_signature',
      because: 'the current owner signs the printed form himself, in black ink',
    });
  }

  // ── items 55-60 — the accredited association ──
  //
  // ⚠️ SEVEN BOXES, ALL MEASURED, NONE EVER WRITTEN. The word "association" did
  // not appear anywhere in this file. For a section 16 application that is the
  // block the whole section rests on: the Act requires a sworn statement from
  // the chairperson of an ACCREDITED association, and the form asks which one,
  // its FAR number, the membership number and the dates — and it went in blank
  // while we held most of the answers.
  const associationName = a('association_name');
  if (associationName) {
    tick('g_association_yes');
    put('g_association_name', associationName);
    put('g_association_number', a('association_number'));
    put('g_association_joined', dateDigits(a('dedicated_since')));
    // Item 60 — off the letter of good standing's "valid until" date.
    put('g_association_expiry', dateDigits(a('association_expiry')));
  } else if (
    input.licenceType === 'S16_DEDICATED_HUNTER' ||
    input.licenceType === 'S16_DEDICATED_SPORT'
  ) {
    // ⚠️ NO 'NO' TICK. An unanswered question is not a "no": an applicant who
    // has not filled this in is not declaring they belong to no association,
    // and on a section 16 that would contradict the rest of their own pack.
    leftBlank.push({
      field: 'association_name',
      because:
        'you have not told us which accredited association you belong to, and a section 16 application rests on it',
    });
  }
  // g_association_far stays empty: the registry asks for the association's own
  // FAR number nowhere, so there is nothing honest to put in it. The expiry
  // beside it is filled above, off the letter of good standing.

  // ── the applicant's telephone numbers ──
  //
  // Measured and never written, exactly like the postal codes.
  const homeTel = splitTelephone(a('home_telephone'));
  put('g_home_dialling_code', homeTel.code);
  put('g_home_telephone', homeTel.number);
  const workTel = splitTelephone(a('work_telephone'));
  put('g_work_dialling_code', workTel.code);
  put('g_work_telephone', workTel.number);

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
