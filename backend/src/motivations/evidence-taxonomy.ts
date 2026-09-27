import { CredentialKind, MotivationUploadKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// WHAT AN EVIDENCE ITEM IS, AND HOW IT PRINTS.
//
// A motivation is mostly a written argument. Section 15 and 16 applicants
// strengthen it with things that have no document kind at all: a hunting
// photograph, a reloading bench, a range session, a score sheet, a farmer's
// written permission to hunt. `MotivationUploadKind` is document-shaped —
// nothing in it will hold "me and my son on a hunt in Limpopo" — and an
// arbitrary photograph filed under OTHER tells a DFO nothing about what they
// are looking at.
//
// So evidence is ONE kind (`MotivationUploadKind.EVIDENCE`) whose CONTAINER
// lives here, as data, in `evidenceType`. Not as forty new enum values:
// Postgres has no ALTER TYPE ... DROP VALUE, the list is expected to be
// revised as members bring things we did not think of, and the operator asked
// for a grown list rather than a swarm of new document types in the picker.
//
// ⚠️ PLACEMENT DECIDES THE PACK, AND IT IS THE ONLY DECISION THAT MATTERS.
// Operator, 2026-09-26: a printed document — a permission letter, an
// affidavit, a score sheet — "gets its own full page in the annexures"; an
// activity photograph is argument in the body, on one "My Activities /
// Evidence" page. A wrong container is therefore worse than no container: it
// moves a page and it ticks a DFO row. Which is why a low-confidence answer
// stores NO container at all (see licence-centre.service.ts).
//
// ⚠️ THE ID IS THE STORED VALUE AND MUST NEVER CHANGE. Rename a label freely
// — labels are shown, ids are kept. A renamed id orphans every row already
// written with the old one, and `containerById` returns null for it, which is
// "unknown container" and not an error, so the damage is silent.
//
// PURE — no Nest, no Prisma client, no clock. Ids are validated against the
// enum at module load below.
// ────────────────────────────────────────────────────────────────────

export type EvidenceGroup =
  | 'hunting'
  | 'sport'
  | 'reloading'
  | 'care'
  | 'storage'
  | 'personal'
  | 'legal'
  | 'organisational'
  | 'other';

/**
 * The groups in the order a member meets them, and what to call each.
 *
 * ⚠️ SERVED, NOT WRITTEN OUT AGAIN IN THE FRONTEND. The container list is
 * fetched from here, headings included, so a group added to the taxonomy
 * appears in the picker with a heading rather than under nothing.
 */
export const EVIDENCE_GROUP_ORDER: EvidenceGroup[] = [
  'hunting',
  'sport',
  'reloading',
  'care',
  'storage',
  'personal',
  'legal',
  'organisational',
  'other',
];

export const EVIDENCE_GROUP_LABELS: Record<EvidenceGroup, string> = {
  hunting: 'Hunting',
  sport: 'Sport shooting and the range',
  reloading: 'Reloading',
  care: 'Cleaning and maintenance',
  storage: 'Safe, security and storage',
  personal: 'About you and your circumstances',
  legal: 'Legal and official papers',
  organisational: 'Your association',
  other: 'Anything else',
};

export interface EvidenceContainer {
  /** Written to `evidenceType`. NEVER rename — see the header. */
  id: string;
  group: EvidenceGroup;
  /** Member-facing name. */
  label: string;
  /** The model's discriminator, and the member's help text. */
  hint: string;
  /**
   * How this prints. 'annexure' = a printed document taking its own letter and
   * its own full page; 'body' = an activity photograph on the one
   * "My Activities / Evidence" page.
   */
  placement: 'annexure' | 'body';
  /**
   * A checklist row this evidence genuinely answers, if any. Written to
   * `MotivationUpload.coversKinds`. Ticks the row ONLY — it does not create a
   * second annexure letter. Omitted unless certain: a wrong tick turns a row
   * green on a photograph that does not answer it.
   */
  satisfies?: MotivationUploadKind;
}

/**
 * Bumped whenever the registry below changes shape or meaning. It is part of
 * the classifier cache key, so a stale `{container}` is never served against a
 * container id that has since moved, been retired, or changed placement.
 */
export const CONTAINER_VERSION = '2026-09-26';

/** How many annexure-placed evidence files one motivation may carry. */
export const EVIDENCE_ANNEXURE_MAX = 2;
/** How many body-placed evidence files one motivation may carry. */
export const EVIDENCE_BODY_MAX = 4;
/** How many evidence items the vault holds, beside the document cap. */
export const EVIDENCE_VAULT_MAX = 30;

export const EVIDENCE_CONTAINERS: EvidenceContainer[] = [
  // ── hunting ────────────────────────────────────────────────────────
  {
    id: 'HUNTING_INVITATION',
    group: 'hunting',
    label: 'An invitation to hunt',
    hint: 'A written invitation from a farmer, landowner or hunting party asking the applicant to hunt, usually naming the farm and a date. Printed paper, not a photograph of an animal.',
    placement: 'annexure',
  },
  {
    id: 'FARM_PERMISSION_LETTER',
    group: 'hunting',
    label: "A farmer's permission to hunt on their land",
    hint: 'A landowner or farm manager writing to say the applicant may hunt on their property. Names the farm and the person granting permission. Printed paper with a signature. This is the letter the operator named as its own annexure page.',
    placement: 'annexure',
    satisfies: 'FIREARM_SOURCE_PROOF',
  },
  {
    id: 'HUNTING_PERMIT',
    group: 'hunting',
    label: 'A hunting permit or licence',
    hint: 'An official provincial hunting permit, a nature-conservation permit, a culling permit, or a provincial hunting licence. Issued by an authority, printed, and usually numbered.',
    placement: 'annexure',
  },
  {
    id: 'HUNTING_REGISTER_ENTRY',
    group: 'hunting',
    label: 'A page from a hunting register',
    hint: 'A farm or reserve hunting register showing the applicant signed in and out and what was taken. Handwritten columns and dates on paper.',
    placement: 'annexure',
  },
  {
    id: 'GAME_DONATION_RECEIPT',
    group: 'hunting',
    label: 'A receipt or record for donated game',
    hint: 'A document recording that the applicant donated, received or processed game — a butchery receipt, a donation certificate, a carcass register. Printed paper.',
    placement: 'annexure',
  },
  {
    id: 'HUNTING_PHOTO',
    group: 'hunting',
    label: 'A hunting photograph',
    hint: 'The applicant hunting — in the veld, carrying a rifle, with quarry, at a waterhole or hide. The central activity photograph.',
    placement: 'body',
  },
  {
    id: 'HUNTING_TROPHY_PHOTO',
    group: 'hunting',
    label: 'A photograph with a trophy animal',
    hint: 'The applicant posed with a hunted animal. The animal is the subject and it is dead or being posed as a trophy.',
    placement: 'body',
  },
  {
    id: 'HUNTING_CAMP_PHOTO',
    group: 'hunting',
    label: 'A hunting camp photograph',
    hint: 'A camp, a field kitchen, a bakkie loaded for the hunt, a fire at night, a hunting party around a vehicle. Shows the applicant hunts with others or over days.',
    placement: 'body',
  },
  {
    id: 'TRAIL_CAM_PHOTO',
    group: 'hunting',
    label: 'A trail-camera photograph',
    hint: 'A camera-trap image of game, usually with a timestamp and temperature burnt into the frame. Evidence of scouting and of time spent on the property.',
    placement: 'body',
  },
  {
    id: 'HUNTING_DOG_PHOTO',
    group: 'hunting',
    label: 'A photograph of hunting dogs',
    hint: 'The applicant with boerboels, pointers, hounds or other hunting dogs, with or without a camp or vehicle in frame.',
    placement: 'body',
  },
  {
    id: 'MEAT_PROCESSING_PHOTO',
    group: 'hunting',
    label: 'A photograph of processing game',
    hint: 'Skinning, butchering, hanging a carcass, a processing table or a cold room with game in it. Follows the hunt and consumes the venison.',
    placement: 'body',
  },
  {
    id: 'MOUNT_OR_SKIN_PHOTO',
    group: 'hunting',
    label: 'A photograph of a mount or a skin',
    hint: 'A taxidermy mount, a skull mount, a rug or a biltong rack at the applicant\u2019s home. Shows what hunting produced.',
    placement: 'body',
  },
  {
    id: 'HUNTING_CLUB_PHOTO',
    group: 'hunting',
    label: 'A photograph with a hunting club',
    hint: 'A hunting association or club gathering — a braai, a dinner, a prizegiving, a field day, members in club shirts.',
    placement: 'body',
  },

  // ── sport ──────────────────────────────────────────────────────────
  {
    id: 'SCORE_SHEET',
    group: 'sport',
    label: 'A score sheet',
    hint: 'A printed or handwritten target or match score sheet, usually with the applicant\u2019s name, the discipline and the scores. Range officials sign these.',
    placement: 'annexure',
    satisfies: 'SHOOTING_ACTIVITY_LOG',
  },
  {
    id: 'COMPETITION_RESULT',
    group: 'sport',
    label: 'A competition result sheet or log',
    hint: 'Official results from a match or league — placings, scores, divisions, a results printout or a log book page signed off by a range officer.',
    placement: 'annexure',
  },
  {
    id: 'RANGE_REGISTER',
    group: 'sport',
    label: 'A page from a range register',
    hint: 'The club\u2019s range attendance book showing the applicant signed in on dates. Columns of names, dates and disciplines.',
    placement: 'annexure',
  },
  {
    id: 'MATCH_PROGRAMME',
    group: 'sport',
    label: 'A match programme or entry form',
    hint: 'A printed programme or entry form for a competition, naming the applicant as an entrant or shooter. Shows a diary of shooting, not one session.',
    placement: 'annexure',
  },
  {
    id: 'RANGE_MEMBERSHIP_PROOF',
    group: 'sport',
    label: 'Proof of range or club membership',
    hint: 'A membership certificate, invoice or letter confirming the applicant belongs to a shooting range or club. Printed paper.',
    placement: 'annexure',
  },
  {
    id: 'RANGE_PHOTO',
    group: 'sport',
    label: 'A photograph at the shooting range',
    hint: 'The applicant on a firing line, at a bench, in a shooting bay, or beside targets. The essential shooting-activity photograph.',
    placement: 'body',
  },
  {
    id: 'TARGET_PHOTO',
    group: 'sport',
    label: 'A photograph of a target',
    hint: 'A shot-up paper target, sometimes with a group circled or a ruler for scale, held or pinned. Shows marksmanship and practice.',
    placement: 'body',
  },
  {
    id: 'CLUB_SHOOT_PHOTO',
    group: 'sport',
    label: 'A photograph at a club shoot',
    hint: 'A club day, a league shoot or a gong shoot — several shooters, gazebos, tables, a range busy with people.',
    placement: 'body',
  },
  {
    id: 'TROPHY_AWARD_PHOTO',
    group: 'sport',
    label: 'A photograph receiving a trophy or award',
    hint: 'The applicant being handed a trophy, a medal, a certificate or a floating trophy at a prizegiving.',
    placement: 'body',
  },
  {
    id: 'TEAM_PHOTO',
    group: 'sport',
    label: 'A photograph with a shooting team',
    hint: 'The applicant in a team photograph — provincial or national colours, a junior team, an inter-club side, a squad on a range.',
    placement: 'body',
  },
  {
    id: 'CLAY_PIGEON_PHOTO',
    group: 'sport',
    label: 'A photograph shooting clay targets or birds',
    hint: 'Shotgun shooting — clay pigeon traps, a shooting stand, a trap house, shotgun in use, or wingshooting over a field.',
    placement: 'body',
  },
  {
    id: 'DISCIPLINE_SPECIALITY',
    group: 'sport',
    label: 'A photograph of the applicant\u2019s discipline',
    hint: 'Something specific to a discipline that is not a plain range shot — a black-powder line, a bisley or long-range setup, a silhouette or falling-plate bay, a handgun-holster stage.',
    placement: 'body',
  },

  // ── reloading ──────────────────────────────────────────────────────
  {
    id: 'RELOADING_LOG',
    group: 'reloading',
    label: 'A reloading log or load data sheet',
    hint: 'Handwritten or printed load records — bullet, powder, charge, primer, cartridge-overall length, dates. Proves ongoing reloading.',
    placement: 'annexure',
  },
  {
    id: 'BALLISTIC_TABLE',
    group: 'reloading',
    label: 'A ballistic table or trajectory chart',
    hint: 'A printed drop or wind-drift table, chronograph output, or trajectory chart the applicant works from.',
    placement: 'annexure',
  },
  {
    id: 'CHRONOGRAPH_RESULT',
    group: 'reloading',
    label: 'A chronograph or pressure result',
    hint: 'A printed or photographed chronograph reading or pressure-test result for a developed load.',
    placement: 'annexure',
  },
  {
    id: 'RELOADING_BENCH_PHOTO',
    group: 'reloading',
    label: 'A photograph of a reloading bench',
    hint: 'A reloading bench or room with a press, powder measures, scales and components set up.',
    placement: 'body',
  },
  {
    id: 'RELOADING_PRESS_PHOTO',
    group: 'reloading',
    label: 'A photograph of a reloading press in use',
    hint: 'The applicant operating a single-stage or progressive press, seating a bullet, or holding finished rounds off the press.',
    placement: 'body',
  },
  {
    id: 'COMPONENTS_PHOTO',
    group: 'reloading',
    label: 'A photograph of reloading components',
    hint: 'Bullets, brass, primers, powder tins or boxes of components laid out. Shows scale of the hobby.',
    placement: 'body',
  },
  {
    id: 'LOAD_DEVELOPMENT_TARGET',
    group: 'reloading',
    label: 'A photograph of a load-development target',
    hint: 'A paper target with several marked groups from one rifle, often labelled per charge weight. The evidence of developing a load.',
    placement: 'body',
  },
  {
    id: 'CASE_PREP_PHOTO',
    group: 'reloading',
    label: 'A photograph of case preparation',
    hint: 'Tumblers, case gauges, trimming, ultrasonic cleaning, racks of prepped brass, annealing.',
    placement: 'body',
  },
  {
    id: 'AMMUNITION_STORAGE_PHOTO',
    group: 'reloading',
    label: 'A photograph of stored ammunition or reloads',
    hint: 'Boxes, ammo cans, a shelf or a locker of loaded rounds, labelled with the load. Stored, not being used.',
    placement: 'body',
  },

  // ── care ───────────────────────────────────────────────────────────
  {
    id: 'GUNSMITH_INVOICE',
    group: 'care',
    label: 'A gunsmith invoice or job card',
    hint: 'A printed invoice or job card from a gunsmith for work done on the applicant\u2019s firearm — a rebarrel, a trigger job, a repair, a service.',
    placement: 'annexure',
  },
  {
    id: 'CLEANING_SESSION_PHOTO',
    group: 'care',
    label: 'A photograph of cleaning a firearm',
    hint: 'The applicant cleaning a firearm \u2014 a rod in the bore, patches, a boresnake, action open on a mat.',
    placement: 'body',
  },
  {
    id: 'CLEANING_KIT_PHOTO',
    group: 'care',
    label: 'A photograph of a cleaning kit',
    hint: 'Cleaning equipment laid out \u2014 rods, brushes, jags, solvents, patches, a cleaning cradle.',
    placement: 'body',
  },
  {
    id: 'MAINTENANCE_PHOTO',
    group: 'care',
    label: 'A photograph of firearm maintenance',
    hint: 'Stripping, oiling, greasing, reassembling, or inspecting a firearm or its parts. Work, not storage.',
    placement: 'body',
  },
  {
    id: 'FIREARM_DISPLAY_PHOTO',
    group: 'care',
    label: 'A photograph of the applicant\u2019s firearm',
    hint: 'A portrait-style photograph of a firearm the applicant owns \u2014 on a stand, on a bench, whole-gun or detailed. No person necessarily in frame.',
    placement: 'body',
  },
  {
    id: 'COLLECTION_PHOTO',
    group: 'care',
    label: 'A photograph of a firearm collection',
    hint: 'Several firearms together \u2014 a rack, a display cabinet, a table, a wall of the applicant\u2019s own guns.',
    placement: 'body',
  },
  {
    id: 'ACCESSORY_PHOTO',
    group: 'care',
    label: 'A photograph of shooting equipment or accessories',
    hint: 'Optics, silencers, bipods, slings, holsters, bags, chronographs, spotting scopes, cases, reloading gear the applicant owns.',
    placement: 'body',
  },

  // ── storage ────────────────────────────────────────────────────────
  {
    id: 'SAFE_INVOICE',
    group: 'storage',
    label: 'A receipt or invoice for a safe',
    hint: 'A printed invoice or receipt for a gun safe or strongbox, usually naming the model and the SABS standard.',
    placement: 'annexure',
  },
  {
    id: 'SAFE_SPEC_SHEET',
    group: 'storage',
    label: 'A safe specification sheet or manual',
    hint: 'A manufacturer\u2019s specification sheet, datasheet or manual for the safe, showing the construction and often a standards mark.',
    placement: 'annexure',
  },
  {
    id: 'ALARM_CERTIFICATE',
    group: 'storage',
    label: 'An alarm or security certificate',
    hint: 'An installation certificate or service certificate from an armed-response or alarm company for the applicant\u2019s premises.',
    placement: 'annexure',
  },
  {
    id: 'SAFE_PHOTO_EXTRA',
    group: 'storage',
    label: 'Another photograph of your safe',
    hint: 'A photograph of a gun safe the applicant owns, beyond the shots the safe line already asks for. Prefer SAFE_PHOTOGRAPHS for the closed, half-open and bolts shots.',
    placement: 'body',
    satisfies: 'SAFE_PHOTOGRAPHS',
  },
  {
    id: 'SAFE_ANCHORING_PHOTO',
    group: 'storage',
    label: 'A photograph of how your safe is anchored',
    hint: 'Rawl bolts, a base plate, a bracket, or the safe fixed into a wall or a floor. Shows the safe cannot simply be carried off.',
    placement: 'body',
    satisfies: 'SAFE_PHOTOGRAPHS',
  },
  {
    id: 'KEY_HOLDER_PHOTO',
    group: 'storage',
    label: 'A photograph of the key holder',
    hint: 'The applicant holding the safe\u2019s key, or the key stored away from the safe. Shows control of the key.',
    placement: 'body',
  },
  {
    id: 'SECURITY_GATE_PHOTO',
    group: 'storage',
    label: 'A photograph of a security gate',
    hint: 'A burglar gate, a security door, or a barred window at the applicant\u2019s home.',
    placement: 'body',
  },
  {
    id: 'ELECTRIC_FENCE_PHOTO',
    group: 'storage',
    label: 'A photograph of perimeter security',
    hint: 'An electric fence, a palisade fence, a wall, a boom, or a perimeter sensor at the applicant\u2019s premises.',
    placement: 'body',
  },
  {
    id: 'RURAL_SECURITY_PHOTO',
    group: 'storage',
    label: 'A photograph of security on a farm',
    hint: 'Farm security \u2014 a security gate, a camera, a farm watch sign, a radio room, or the road into a rural property.',
    placement: 'body',
  },

  // ── personal ───────────────────────────────────────────────────────
  {
    id: 'EMPLOYMENT_LETTER_EXTRA',
    group: 'personal',
    label: 'Another letter about your work',
    hint: 'A letter from an employer or a business confirming the applicant\u2019s occupation, employment or income. Printed paper with a letterhead and a signature.',
    placement: 'annexure',
    satisfies: 'EMPLOYMENT_CONFIRMATION',
  },
  {
    id: 'BUSINESS_OWNERSHIP_DOC',
    group: 'personal',
    label: 'A document showing you own a business',
    hint: 'A CIPC registration, a business licence, a VAT registration, a letter from an accountant, or a company resolution naming the applicant.',
    placement: 'annexure',
  },
  {
    id: 'FARM_OWNERSHIP_DOC',
    group: 'personal',
    label: 'A document showing you own or work a farm',
    hint: 'A title deed, a lease, a permission to occupy, or a letter from a farm owner naming the applicant as resident or manager.',
    placement: 'annexure',
  },
  {
    id: 'MEDICAL_LETTER',
    group: 'personal',
    label: 'A medical or professional letter',
    hint: 'A letter from a doctor, optometrist, psychologist or other professional about the applicant\u2019s fitness, eyesight or circumstances.',
    placement: 'annexure',
  },
  {
    id: 'RETIREMENT_PROOF',
    group: 'personal',
    label: 'Proof of retirement or pension',
    hint: 'A pension statement, a retirement letter, or proof from a fund showing the applicant has retired.',
    placement: 'annexure',
  },
  {
    id: 'OCCUPATION_PROOF',
    group: 'personal',
    label: 'Other proof of what you do',
    hint: 'A certificate, a qualification, a registration, a professional membership, or a letter proving the applicant\u2019s occupation. Not a plain employment confirmation.',
    placement: 'annexure',
  },
  {
    id: 'RESIDENCE_PHOTO',
    group: 'personal',
    label: 'A photograph of where you live',
    hint: 'The applicant\u2019s house, flat or smallholding from outside, or a lifestyle-property view. Shows the premises the safe is in.',
    placement: 'body',
  },
  {
    id: 'FAMILY_PHOTO',
    group: 'personal',
    label: 'A photograph of you and your family',
    hint: 'The applicant with a partner, children, or grandchildren. Often used to show a lawful, settled household.',
    placement: 'body',
  },
  {
    id: 'VEHICLE_PHOTO',
    group: 'personal',
    label: 'A photograph of a hunting or off-road vehicle',
    hint: 'A bakkie, a 4x4, a quad bike, a boat or a caravan the applicant uses for hunting, shooting or the outdoors.',
    placement: 'body',
  },

  // ── legal ──────────────────────────────────────────────────────────
  {
    id: 'TRUST_DEED',
    group: 'legal',
    label: 'A trust deed',
    hint: 'A registered trust deed or a letter of authority naming the applicant as a trustee. Printed legal paper.',
    placement: 'annexure',
  },
  {
    id: 'INHERITANCE_DOCS',
    group: 'legal',
    label: 'Inheritance papers',
    hint: 'A will, a letter of executorship, or a section 18(3) appointment showing a firearm is inherited and who may deal with it.',
    placement: 'annexure',
    satisfies: 'EXECUTOR_APPOINTMENT',
  },
  {
    id: 'COURT_ORDER',
    group: 'legal',
    label: 'A court order',
    hint: 'Any court order concerning the applicant \u2014 a divorce order, a protection order, or an order about property or a firearm. Printed and stamped.',
    placement: 'annexure',
  },
  {
    id: 'PROTECTION_ORDER',
    group: 'legal',
    label: 'A protection order',
    hint: 'A domestic-violence protection order, whether the applicant applied for it or is named in one. Sensitive \u2014 handle as confidential.',
    placement: 'annexure',
  },
  {
    id: 'CRIME_STATEMENT',
    group: 'legal',
    label: 'A statement about a crime',
    hint: 'The applicant\u2019s own written statement about a theft, a burglary, an attack or another incident. Handwritten or typed, usually signed.',
    placement: 'annexure',
    satisfies: 'INCIDENT_REPORT',
  },
  {
    id: 'SAPS_CASE_DOC',
    group: 'legal',
    label: 'A SAPS case document',
    hint: 'A SAPS case number slip, an affidavit filed with SAPS, an occurrence-book extract, or a police letter about an incident.',
    placement: 'annexure',
    satisfies: 'INCIDENT_REPORT',
  },
  {
    id: 'INSURANCE_SCHEDULE',
    group: 'legal',
    label: 'An insurance schedule',
    hint: 'An insurance policy schedule or a letter from an insurer listing the applicant\u2019s firearms or a claim. Printed paper.',
    placement: 'annexure',
  },
  {
    id: 'AFFIDAVIT',
    group: 'legal',
    label: 'An affidavit',
    hint: 'A sworn statement, attested before a commissioner of oaths. Any subject \u2014 a character reference, a loss, an explanation. Printed, signed and stamped.',
    placement: 'annexure',
    satisfies: 'CHARACTER_REFERENCE',
  },
  {
    id: 'CERTIFIED_COPY',
    group: 'legal',
    label: 'A certified copy of something',
    hint: 'A photocopy with a certification stamp and a commissioner\u2019s signature. The thing copied is secondary to the certification.',
    placement: 'annexure',
  },
  {
    id: 'POWER_OF_ATTORNEY',
    group: 'legal',
    label: 'A power of attorney',
    hint: 'A signed power of attorney naming the applicant as agent for someone else, usually over a firearm or an estate.',
    placement: 'annexure',
  },

  // ── organisational ─────────────────────────────────────────────────
  {
    id: 'ASSOCIATION_LETTER',
    group: 'organisational',
    label: 'A letter from your association',
    hint: 'Any letter from a shooting or hunting association on its letterhead about the applicant. Printed paper with a signature.',
    placement: 'annexure',
    satisfies: 'GOOD_STANDING_LETTER',
  },
  {
    id: 'CHAIRPERSON_DECLARATION',
    group: 'organisational',
    label: 'A chairperson\u2019s declaration',
    hint: 'A sworn statement or solemn declaration by an association chairperson about the applicant\u2019s membership. Signed and often stamped.',
    placement: 'annexure',
    satisfies: 'GOOD_STANDING_LETTER',
  },
  {
    id: 'CLUB_MEMBERSHIP_CARD',
    group: 'organisational',
    label: 'A club or association membership card',
    hint: 'A membership card or certificate for a club, association or sports-shooting body, usually with a name and a year.',
    placement: 'annexure',
    satisfies: 'ASSOCIATION_CARD',
  },
  {
    id: 'DEDICATED_STATUS_CERT',
    group: 'organisational',
    label: 'A dedicated status certificate',
    hint: 'A dedicated-hunter or dedicated-sports-shooter certificate from an accredited association, carrying a dedicated number.',
    placement: 'annexure',
    satisfies: 'ASSOCIATION_CARD',
  },
  {
    id: 'ENDORSEMENT_LETTER',
    group: 'organisational',
    label: 'An association endorsement',
    hint: 'An association\u2019s endorsement of one specific firearm for one discipline, naming the type, calibre, make or serial.',
    placement: 'annexure',
    satisfies: 'ASSOCIATION_ENDORSEMENT',
  },
  {
    id: 'ACTIVITY_REPORT',
    group: 'organisational',
    label: 'An activity report',
    hint: 'A summary of the applicant\u2019s shooting or hunting over a period, produced by a club or association rather than the applicant.',
    placement: 'annexure',
    satisfies: 'SHOOTING_ACTIVITY_LOG',
  },
  {
    id: 'FEDERATION_LETTER',
    group: 'organisational',
    label: 'A letter from a federation or governing body',
    hint: 'Correspondence from a provincial or national federation, or a national governing body for a shooting sport.',
    placement: 'annexure',
  },

  // ── other ──────────────────────────────────────────────────────────
  {
    id: 'RECEIPT_OR_INVOICE',
    group: 'other',
    label: 'A receipt or invoice',
    hint: 'A printed proof of purchase for equipment, ammunition, a course or a service. The thing bought is not clear from the paper alone.',
    placement: 'annexure',
  },
  {
    id: 'CERTIFICATE_GENERIC',
    group: 'other',
    label: 'A certificate',
    hint: 'A certificate of attendance, completion, competence or training that does not fit a more specific container.',
    placement: 'annexure',
  },
  {
    id: 'OTHER_EVIDENCE',
    group: 'other',
    label: 'Other evidence',
    hint: 'Anything that genuinely does not fit any container above. Use last, and prefer a specific container whenever one fits.',
    placement: 'body',
  },
];

// ────────────────────────────────────────────────────────────────────
// THE SET OF IDS IS ALSO THE CLASSIFIER'S ANSWER SPACE, AND IT MUST NOT
// OVERLAP EITHER ENUM'S.
//
// The model returns one id, and a bad answer that happens to be a
// `MotivationUploadKind` would be indistinguishable from a container on every
// read — `annexureByKind` keys its map by both, so a page would be titled from
// the wrong namespace. Retiring a container is done by deleting it from the
// list above, and a spec asserts the namespaces stay disjoint.
//
// ⚠️ BOTH ENUMS, NOT JUST MotivationUploadKind. `CredentialKind` is a separate
// enum and only PARTLY overlaps it — seven of its values (DEDICATED_DISCIPLINE,
// DEDICATED_HUNTER, DEDICATED_STATUS, FIREARM_LICENCE, GOOD_STANDING,
// PROFESSIONAL_HUNTER, PROFICIENCY) have no MotivationUploadKind twin, so a
// container id such as `FIREARM_LICENCE` would slip past a one-enum guard while
// colliding with a vault document kind — the same ambiguity, on the vault side.
// ────────────────────────────────────────────────────────────────────
const ENUM_NAMES = new Set<string>([
  ...Object.values(MotivationUploadKind),
  ...Object.values(CredentialKind),
]);

for (const c of EVIDENCE_CONTAINERS) {
  if (ENUM_NAMES.has(c.id)) {
    throw new Error(
      `evidence container "${c.id}" collides with a document-kind enum value`,
    );
  }
}

const BY_ID = new Map(EVIDENCE_CONTAINERS.map((c) => [c.id, c]));

/** The container for a stored id, or null for unknown. Never throws. */
export function containerById(id: string | null | undefined): EvidenceContainer | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function isContainerId(id: string): boolean {
  return BY_ID.has(id);
}

/** Every container, optionally narrowed to one group. */
export function pickableContainers(group?: EvidenceGroup): EvidenceContainer[] {
  return group ? EVIDENCE_CONTAINERS.filter((c) => c.group === group) : EVIDENCE_CONTAINERS;
}

export function annexureContainers(): EvidenceContainer[] {
  return EVIDENCE_CONTAINERS.filter((c) => c.placement === 'annexure');
}

export function bodyContainers(): EvidenceContainer[] {
  return EVIDENCE_CONTAINERS.filter((c) => c.placement === 'body');
}

/**
 * Does this stored container print on its own annexure page?
 *
 * ⚠️ AN UNKNOWN ID IS NOT AN ANNEXURE. `evidenceType` is free text, and a row
 * written against a container we have since deleted must read as generic
 * evidence in the body rather than claim an annexure letter it cannot title.
 */
export function isAnnexureEvidence(id: string | null | undefined): boolean {
  return containerById(id)?.placement === 'annexure';
}

/** What a served evidence row carries, wherever it is served. */
export interface EvidenceBlock {
  container: string | null;
  label: string | null;
  group: EvidenceGroup | null;
  placement: 'annexure' | 'body' | null;
  confident: boolean;
  ask: string | null;
}

/**
 * The evidence block on a served row, built in ONE place.
 *
 * ⚠️ ONE BUILDER, THREE CALLERS — the vault, the motivation's upload list and
 * the application sheet. Each of those assembled this object itself at first,
 * and the moment one of them is corrected (a renamed group, a new placement)
 * the others keep serving the old answer: the same photograph then reads "on
 * your Activities page" on one screen and "annexure K" on the next. Build it
 * here and there is nothing to keep in step.
 *
 * ⚠️ `container: null` IS THE SIGNAL THE FRONTEND FLAGS ON, not `confident`.
 * A low-confidence answer stores no container at all, so the pair is redundant
 * by construction — and a row read back from the database can only ever tell
 * the UI what it is holding, which is the container or nothing.
 *
 * ⚠️ NO `description`, DELIBERATELY. The member's own words are POPIA data
 * encrypted at rest, and this module is pure — no crypto, no clock. A caller
 * that wants to show them decrypts and spreads the field on itself (see
 * licence-centre.service.ts), so this file never has to know the blob exists.
 */
export function evidenceRow(
  containerId: string | null | undefined,
  confident: boolean,
): EvidenceBlock {
  const c = containerById(containerId);
  return {
    container: c?.id ?? null,
    label: c?.label ?? null,
    group: c?.group ?? null,
    placement: c?.placement ?? null,
    confident,
    /** What the member is asked when we could not decide. */
    ask: c ? null : 'Tell us in a few words what this shows.',
  };
}

/**
 * The taxonomy as the classifier sees it, rendered ONCE at module load.
 *
 * ⚠️ BYTE-STABLE ON PURPOSE. DeepSeek caches the system block; interpolating
 * anything per-file into it (a date, the description) would miss the cache on
 * every call and turn a cheap classification into a full-price one. The member
 * description goes in the USER message, never here.
 */
export const EVIDENCE_CONTAINER_LIST = EVIDENCE_CONTAINERS.map(
  (c) =>
    `- ${c.id} [${c.placement}] ${c.label} \u2014 ${c.hint}`,
).join('\n');
