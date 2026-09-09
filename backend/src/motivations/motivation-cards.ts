import type { CardOption } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// THE REASON CARDS — every sentence an applicant can tap, in one file.
//
// ⚠️ THIS FILE IS THE OPERATOR'S REVIEW SURFACE AND HOLDS NOTHING ELSE.
// No logic, no ranking, no lookups — those live in motivation-overlap.ts and
// motivation-research.service.ts. Wording is reviewed here, in one sitting,
// before a set ships (MOTIVATION-REBUILD-BRIEF.md §9.2). A helper function
// creeping in is what turns a review into a code review.
//
// ⚠️ SELECTED MEANS TRUE. Every sentence is written in the FIRST PERSON and
// the applicant signs their name under the document it produces, so a tap is
// an assertion about themselves and only a tapped card reaches the writer.
// Section 120(9)(f) of the Firearms Control Act makes a false statement on an
// application an offence — that is why this is selection and never silent
// inclusion, and why no card is ever pre-ticked.
//
// ⚠️ WRITE WHAT IS TRUE OF THE APPLICANT, NEVER WHAT FOLLOWS FROM IT. "I live
// in a precinct with a high housebreaking rate" is a fact they can stand
// behind. "I therefore need a firearm" is the writer's argument to make, and a
// card that makes it puts the conclusion in the applicant's mouth before the
// document has earned it.
//
// ⚠️ `key` IS STORED, `sentence` IS READ. They are separate so a rewording
// never invalidates an answer somebody already gave — the same discipline as
// retiredChoices one level down. Change a sentence freely; changing a key is a
// data migration.
//
// House rules that apply to every line below: plain South African English,
// second person nowhere (these are the applicant speaking), no exclamation
// marks, no emoji, no legalese, no outcome language ("this will get me
// approved" is a prediction and we do not make those).
// ────────────────────────────────────────────────────────────────────

// ── SECTION 13 — SELF-DEFENCE ───────────────────────────────────────

/**
 * Why the applicant's own circumstances put them at risk.
 *
 * ⚠️ THE CRIME-STATISTICS CARD IS RANKED FIRST WHERE WE HAVE FIGURES, and its
 * sentence deliberately does NOT contain a number. The figure is annexed from
 * a named SAPS release (see crime-stats) and printed beside the card by the
 * sheet; baking one into the sentence would put a statistic in the applicant's
 * mouth that we, not they, are responsible for.
 *
 * ⚠️ `victim` IS NEVER RANKED AND NEVER SUGGESTED — only offered, at the
 * bottom. Ranking somebody's own experience of crime up a list because a
 * precinct figure is high would be the product guessing at the worst thing
 * that has happened to them.
 */
export const S13_REASONS: readonly CardOption[] = [
  {
    key: 'precinct_crime',
    sentence:
      'I live in a policing precinct with a documented housebreaking and robbery problem.',
    rankBy: 'precinct',
  },
  {
    key: 'night_travel',
    sentence: 'I regularly travel at night, or on roads where I would be on my own if I stopped.',
  },
  {
    key: 'cash_or_stock',
    sentence: 'My work means I carry cash, stock or valuable equipment.',
    rankBy: 'occupation',
  },
  {
    key: 'smallholding',
    sentence:
      'I live on a smallholding or plot where armed response cannot reach me quickly.',
  },
  {
    key: 'dependants',
    sentence: 'There are people at home who depend on me for their safety.',
  },
  {
    key: 'load_shedding',
    sentence: 'Load shedding leaves my gate, lights and electric fence without power.',
  },
  {
    key: 'rented',
    sentence: 'I rent, so I cannot make structural changes to secure the property further.',
  },
  {
    key: 'victim',
    sentence: 'I have been the victim of a crime in the last five years.',
  },
];

/**
 * Where the applicant actually goes.
 *
 * From the Engala questionnaire's movement list, which is what the approved
 * self-defence motivation on file writes its "daily movements" paragraph from.
 */
export const S13_MOVEMENTS: readonly CardOption[] = [
  { key: 'restaurants', sentence: 'I go out to restaurants and public venues.' },
  { key: 'outdoor_events', sentence: 'I attend outdoor events and markets.' },
  { key: 'camping', sentence: 'I camp, often away from towns.' },
  { key: 'cycling', sentence: 'I cycle on public roads.' },
  { key: 'hiking', sentence: 'I hike, including on trails away from help.' },
  { key: 'fishing', sentence: 'I fish, often at remote spots.' },
  { key: 'hunting', sentence: 'I hunt, and travel to and from farms to do it.' },
  { key: 'golf', sentence: 'I play golf.' },
  { key: 'school_run', sentence: 'I do a regular school or lift run.' },
  { key: 'late_shifts', sentence: 'I come and go at hours when the street is empty.' },
];

/** How they would actually keep it. Multi-select: both is a real answer. */
export const S13_CARRY_STYLE: readonly CardOption[] = [
  {
    key: 'concealed',
    sentence: 'I would carry it concealed on my person when I am away from home.',
  },
  { key: 'home', sentence: 'I would keep it at home for the defence of my house.' },
  {
    key: 'vehicle',
    sentence: 'I would have it with me in my vehicle on the routes I travel.',
  },
];

// ── HUNTING — SECTIONS 15 AND 16 (DEDICATED HUNTER) ─────────────────

/**
 * What they hunt.
 *
 * ⚠️ CLASSES, NOT SPECIES, AND THE DIFFERENCE IS THE WHOLE POINT. The species
 * and the range bands that go with each class are researched and printed by
 * us (see motivation-research.service.ts); asking somebody to list species is
 * asking them to do the work the product exists to do. Ranked by whether the
 * calibre applied for actually suits the class.
 */
export const HUNT_GAME_CLASS: readonly CardOption[] = [
  {
    key: 'small',
    sentence: 'I hunt small game and varmints.',
    rankBy: 'calibre',
  },
  {
    key: 'plains_light',
    sentence: 'I hunt the lighter plains game.',
    rankBy: 'calibre',
  },
  {
    key: 'plains_medium',
    sentence: 'I hunt medium to large plains game.',
    rankBy: 'calibre',
  },
  {
    key: 'dangerous',
    sentence: 'I hunt dangerous game.',
    rankBy: 'calibre',
  },
  {
    key: 'wingshooting',
    sentence: 'I shoot birds — wingshooting and driven birds.',
    rankBy: 'calibre',
  },
];

/** The ground it happens on. Drives the range argument. */
export const HUNT_TERRAIN: readonly CardOption[] = [
  { key: 'bushveld', sentence: 'I hunt in thick bushveld, where shots are close.' },
  { key: 'open_plains', sentence: 'I hunt on open plains, where shots are long.' },
  { key: 'mountain', sentence: 'I hunt in mountainous country.' },
  { key: 'karoo', sentence: 'I hunt in the Karoo and other open, dry country.' },
  { key: 'coastal_thicket', sentence: 'I hunt in coastal thicket and dune bush.' },
  { key: 'farmland', sentence: 'I hunt on cultivated farmland.' },
];

/** Whose land. This is the access question a DFO asks. */
export const HUNT_WHERE: readonly CardOption[] = [
  { key: 'invitation', sentence: 'I hunt on farms where I am invited by the landowner.' },
  { key: 'own_land', sentence: 'I hunt on land my family or I own or lease.' },
  { key: 'outfitter', sentence: 'I book hunts through outfitters and game ranches.' },
  { key: 'culling', sentence: 'I am asked onto farms to help with culling and problem animals.' },
];

/** Why they hunt at all. Generic is correct here — every approved pack is. */
export const HUNT_REASONS: readonly CardOption[] = [
  { key: 'meat', sentence: 'I hunt for meat for my own household.' },
  {
    key: 'culling',
    sentence: 'I take part in culling and game management on the farms I hunt.',
  },
  {
    key: 'family',
    sentence: 'I am teaching my family to hunt safely and ethically.',
  },
  {
    key: 'own_rifle',
    sentence:
      'I want to hunt with my own rifle rather than borrow one I have not zeroed or practised with.',
  },
  {
    key: 'ethical_shot',
    sentence:
      'I want a rifle suited to the animals I hunt so that every shot is a clean, humane one.',
  },
];

// ── SPORT — SECTION 16 (DEDICATED SPORT) AND SECTION 15 ─────────────

/**
 * Why they need their own firearm for the sport.
 *
 * ⚠️ SHIPPED ON SECTION 15 AS WELL AS SECTION 16, DELIBERATELY. Section 15(2)
 * covers "an occasional hunter OR an occasional sports person", and until now
 * every question on the section 15 path was about hunting — `intended_quarry`
 * was even required, so somebody who shoots occasionally and holds no
 * dedicated status could not finish the form at all. See HANDOFF.md open
 * item 1.
 */
export const SPORT_REASONS: readonly CardOption[] = [
  {
    key: 'own_equipment',
    sentence:
      'I want to compete with my own firearm rather than borrow one that is set up for somebody else.',
  },
  {
    key: 'range_time',
    sentence: 'I need my own firearm to practise between matches, not only on match days.',
  },
  {
    key: 'discipline_spec',
    sentence:
      'The discipline I shoot has equipment requirements that the firearms I already hold do not meet.',
    rankBy: 'association',
  },
  {
    key: 'dedicated_status',
    sentence:
      'I have to shoot a minimum number of matches a year to keep my dedicated status.',
    rankBy: 'association',
  },
  {
    key: 'postal',
    sentence: 'I shoot postal exercises for my association through the year.',
    rankBy: 'association',
  },
  {
    key: 'progression',
    sentence: 'I am working towards competing at a higher level than club matches.',
  },
];

/** What they actually shoot, and how often. */
export const SPORT_FORMATS: readonly CardOption[] = [
  { key: 'club', sentence: 'I shoot club matches most months.' },
  { key: 'provincial', sentence: 'I shoot at provincial level.' },
  { key: 'national', sentence: 'I have shot at national level.' },
  { key: 'postal', sentence: 'I shoot postal matches.' },
  { key: 'practice', sentence: 'I train on the range between matches.' },
];

// ── WHAT AN OWNED FIREARM IS FOR ────────────────────────────────────

/**
 * `existing_firearm_N_primary_use` — asked once per firearm, ever.
 *
 * ⚠️ THE ONE FACT A LICENCE COPY CAN NEVER SUPPLY, and the one the whole
 * comparison rests on. The writer is asked to argue, per firearm, why the one
 * already held cannot do this job; without this it knows a .308 bolt-action
 * exists and nothing about what it does, so "it cannot serve this purpose" has
 * nothing to stand on but invention.
 *
 * ⚠️ PROFILE-SCOPED. Asked once and never again — a firearm's purpose does not
 * change because a second application was started. Suggestions are ranked from
 * the row's own calibre, which is why one list serves every row.
 */
/**
 * Which section a firearm the applicant ALREADY HOLDS is licensed under.
 *
 * ⚠️ IT SHIPPED WITHOUT THIS AND THE WRITER FILLED THE GAP. MO000071, section
 * 9: "a MARLIN rifle in .45-70 Government under section 15". The Marlin is a
 * section 16. The rows carried make, calibre, serial and expiry and no
 * section, the prompt asked for one per firearm, and the model supplied five —
 * three right by luck. A DFO holding the licence copies in Annexure G reads
 * the contradiction off the page.
 *
 * ⚠️ AND IT IS READ OFF THE CARD, NOT ASKED FIRST. Every licence card prints
 * it, `licence-card-ocr.service.ts` has always read it, and `credentialOffer`
 * now proposes it — so for a member whose licences are in the vault this
 * arrives already answered with vault provenance. The cards are for the member
 * who has not scanned that one yet, and for correcting a bad read.
 *
 * ⚠️ "I am not sure" IS AN ANSWER AND NOT A GAP. A member who taps it has told
 * us something true, and the document then says nothing about that firearm's
 * section — which is the correct output. Leaving the row blank instead invites
 * the same guess all over again.
 */
export const OWNED_SECTION_HELD: readonly CardOption[] = [
  { key: 'section_13', sentence: 'I hold it under section 13, for self-defence.' },
  { key: 'section_15', sentence: 'I hold it under section 15, as an occasional hunter or sports shooter.' },
  { key: 'section_16', sentence: 'I hold it under section 16, as a dedicated hunter or dedicated sports shooter.' },
  { key: 'section_17', sentence: 'I hold it under section 17, as part of a private collection.' },
  { key: 'section_20', sentence: 'I hold it on a section 20 permit, in the course of a business.' },
  { key: 'unsure', sentence: 'I am not sure which section it is licensed under.' },
];

export const PRIMARY_USE: readonly CardOption[] = [
  { key: 'self_defence_carry', sentence: 'I carry it for self-defence.', rankBy: 'calibre' },
  { key: 'home_defence', sentence: 'I keep it at home for defence of the house.', rankBy: 'calibre' },
  { key: 'small_game', sentence: 'I use it for small game and varmints.', rankBy: 'calibre' },
  { key: 'plains_game', sentence: 'I use it for plains game.', rankBy: 'calibre' },
  { key: 'dangerous_game', sentence: 'I use it for dangerous game.', rankBy: 'calibre' },
  { key: 'wingshooting', sentence: 'I use it for birds.', rankBy: 'calibre' },
  { key: 'clays', sentence: 'I use it for clay targets.', rankBy: 'calibre' },
  { key: 'sport_competition', sentence: 'I compete with it.', rankBy: 'calibre' },
  { key: 'sport_practice', sentence: 'I practise with it between matches.', rankBy: 'calibre' },
  { key: 'collection', sentence: 'I hold it as part of a collection.', rankBy: 'calibre' },
  { key: 'unused', sentence: 'I no longer use it.', rankBy: 'calibre' },
  { key: 'culling', sentence: 'I use it for culling and problem animals on the farms I hunt.', rankBy: 'calibre' },
  { key: 'livestock_protection', sentence: 'I use it to protect livestock from predators.', rankBy: 'calibre' },
  { key: 'training_others', sentence: 'I use it to teach family or new shooters to shoot safely.', rankBy: 'calibre' },
  { key: 'range_practice', sentence: 'I use it for range practice and keeping my shooting in.', rankBy: 'calibre' },
  { key: 'dedicated_status', sentence: 'I use it for the activities my dedicated status is assessed on.', rankBy: 'calibre' },
  { key: 'business_use', sentence: 'I use it in the course of my work.', rankBy: 'calibre' },
  { key: 'inherited', sentence: 'I hold it because it came to me from family.', rankBy: 'calibre' },
  { key: 'spare_for_repair', sentence: 'I keep it as the spare for when another is with a gunsmith.', rankBy: 'calibre' },
];

// ── THE OVERLAP ANGLE ───────────────────────────────────────────────

/**
 * "You already hold a 9mm. This one will be my ___".
 *
 * ⚠️ THE SINGLE HIGHEST-VALUE ANSWER IN THE PRODUCT, and it used to arrive as
 * an empty textarea labelled "overlap justification" on step 3. "Do you
 * already hold something that does this job" is the question that gets a
 * second medium-game rifle refused, and the Registrar asks it whether or not
 * we raised it first.
 *
 * ⚠️ THE VOCABULARY IS FIXED HERE; THE RANKING IS NOT. motivation-overlap.ts
 * decides WHICH of these it offers and in what order, from the type, action,
 * calibre class and section of what is already held. A fixed vocabulary is
 * what lets allowedValues() validate a stored answer at all — a set computed
 * per applicant could not be checked on save.
 */
export const OVERLAP_ANGLES: readonly CardOption[] = [
  {
    key: 'different_division',
    sentence:
      'This one is for a different division of the sport from the one I already shoot.',
  },
  {
    key: 'backup',
    // ⚠️ THE WORDING WAS SPORT-ONLY AND THE CARD WAS OFFERED TO EVERYBODY.
    // "does not end my season" was being shown to self-defence applicants,
    // which is what the operator meant by "the reasons underneath this Why
    // this one as well as the ones you hold does not even make sense".
    sentence:
      'This one is my backup, so a breakage or a repair does not leave me without a firearm.',
  },
  {
    key: 'match_and_practice',
    sentence:
      'I would keep this one for matches and use the one I already hold for practice.',
  },
  {
    key: 'different_quarry',
    sentence:
      'This one is for game the firearm I already hold is not suited to.',
  },
  {
    key: 'different_range',
    sentence:
      'This one is for the ranges the firearm I already hold cannot cover.',
  },
  {
    key: 'different_format',
    sentence:
      'This one is a different kind of firearm altogether from the one I already hold.',
  },
  {
    key: 'different_purpose',
    sentence:
      'The firearm I already hold is for a different purpose and would not be used for this one.',
  },
  {
    /**
     * ⚠️ THE STRONGEST ANSWER THERE IS TO AN OVERLAP, AND IT WAS NOT ON OFFER.
     * Operator, 2026-09-09: "If someone owns a handgun and its on section 16.
     * Then the new applicant is allowed to apply for a section 13 of that
     * firearm if they do meet all the other conditions."
     *
     * `different_purpose` above says the held firearm WOULD NOT be used for
     * this one, which is a statement about the applicant's intentions. This
     * says the licence does not cover it, which is a statement about the
     * licence — and a reviewer can check it against the card in Annexure G
     * without taking anybody's word for anything.
     *
     * ⚠️ IT DOES NOT SAY THE FIREARM MAY NOT BE USED. It says the LICENCE is
     * not a licence for this purpose, which is what the card actually
     * establishes. The stronger claim is a proposition about the Act, and this
     * sentence goes verbatim into a document somebody signs.
     */
    key: 'different_section',
    sentence:
      'The firearm I already hold is licensed under a different section of the Act, for a different purpose, and that licence does not cover the purpose I am applying for now.',
  },
  {
    key: 'different_calibre',
    sentence:
      'This one is a different calibre, and the one I hold is the wrong cartridge for what I need it for.',
  },
  {
    key: 'different_action',
    sentence:
      'This one has a different action, and the one I hold cannot be worked quickly enough for it.',
  },
  {
    key: 'ammunition_cost',
    sentence:
      'This one shoots a cartridge I can afford to practise with often, which the one I hold does not.',
  },
  {
    key: 'recoil_or_fit',
    sentence:
      'This one fits me and recoils in a way I can shoot accurately, which the one I hold does not.',
  },
  {
    key: 'terrain_reach',
    sentence:
      'This one reaches across the open country I hunt, where the one I hold is a close-range firearm.',
  },
  {
    key: 'close_cover',
    sentence:
      'This one handles in thick bush and close cover, where the one I hold is too long to bring up.',
  },
  {
    key: 'teaching',
    sentence:
      'This one is the firearm I would put in a new shooter’s hands, which the one I hold is not.',
  },
  {
    key: 'travel_and_wear',
    sentence:
      'This one takes the weather and the travel of the hunting I do, and I would not expose the one I hold to it.',
  },
  {
    key: 'in_for_repair',
    sentence:
      'A firearm away at a gunsmith leaves me with nothing, and this one means I am not without one while it is gone.',
  },
  // ── the two a self-defence applicant needs, and had nowhere to say ──
  //
  // ⚠️ WITHOUT THESE, S13 HAD NOTHING TRUTHFUL TO TAP. Of the sixteen angles
  // above, five argued the sport and four argued hunting; what was left was
  // generic. The commonest real reason somebody licensed for self-defence
  // applies for a second is exactly this pair, and neither could be said.
  {
    key: 'concealable',
    sentence:
      'This one I can carry concealed on me; the one I already hold is too large to carry.',
  },
  {
    key: 'home_and_carry',
    sentence:
      'I would keep the one I already hold at home and carry this one when I am out.',
  },
];

/**
 * Which angles each section may be offered.
 *
 * ⚠️ THE SAME MISTAKE AS THE REASON GENERATOR'S ANGLES, ONE LAYER DOWN. There
 * the model was shown every angle and argued the wrong case; here the MEMBER
 * is shown every angle and taps one. The operator's own section 13 carries
 * `overlap_angle: "different_division"` — "a different division of the sport"
 * — because that sentence was on the screen of a self-defence application.
 *
 * ⚠️ AND THE TAPPED SENTENCE GOES INTO THE DOCUMENT VERBATIM. This is worse
 * than showing the model a bad option: a sport reason on a section 13 is a
 * refusal trigger, and the applicant put it there themselves because we
 * offered it.
 *
 * ⚠️ OFFERED, NEVER ACCEPTED — the retiredChoices rule. `allowedValues` still
 * takes the whole set, so a draft holding a now-unoffered angle keeps saving
 * instead of failing on every keystroke. Filtering what is ACCEPTED is how a
 * member ends up with "we could not store your answer" for ever.
 */
export const OVERLAP_ANGLES_BY_SECTION: Readonly<
  Record<'selfDefence' | 'hunting' | 'sport', readonly string[]>
> = {
  selfDefence: [
    // ⚠️ FIRST, BECAUSE ON A SELF-DEFENCE APPLICATION IT IS USUALLY THE WHOLE
    // ANSWER. A member holding a section 15 or 16 handgun holds it under a
    // licence issued for hunting or sport; that licence does not cover keeping
    // or carrying it for defence, so the overlap a reviewer sees in the
    // register is disposed of in one sentence they can check.
    'different_section',
    'concealable',
    'home_and_carry',
    'different_purpose',
    'different_format',
    'recoil_or_fit',
    'different_action',
    'backup',
    'in_for_repair',
  ],
  hunting: [
    'different_section',
    'different_quarry',
    'different_range',
    'terrain_reach',
    'close_cover',
    'different_calibre',
    'different_format',
    'travel_and_wear',
    'teaching',
    'backup',
    'in_for_repair',
  ],
  sport: [
    'different_section',
    'different_division',
    'match_and_practice',
    'different_format',
    'different_action',
    'ammunition_cost',
    'recoil_or_fit',
    'backup',
    'in_for_repair',
  ],
};

/**
 * The angles to OFFER on this application, in the section's own order.
 *
 * A licence type we do not recognise gets the whole set rather than none — the
 * safe direction, and the same posture every other "list of what to drop"
 * in this codebase takes.
 */
export function overlapAnglesFor(
  licenceType: string,
): readonly CardOption[] {
  const group =
    licenceType === 'S13_SELF_DEFENCE' ||
    licenceType === 'S14_RESTRICTED_SELF_DEFENCE'
      ? 'selfDefence'
      : licenceType === 'S16_DEDICATED_SPORT'
        ? 'sport'
        : licenceType === 'S15_OCCASIONAL_HUNTER' ||
            licenceType === 'S16_DEDICATED_HUNTER'
          ? 'hunting'
          : null;
  if (!group) return OVERLAP_ANGLES;
  const wanted = OVERLAP_ANGLES_BY_SECTION[group];
  return wanted
    .map((k) => OVERLAP_ANGLES.find((o) => o.key === k))
    .filter((o): o is CardOption => !!o);
}

/**
 * Every set, for the registry-integrity suite and for the options attacher.
 *
 * ⚠️ ADD A SET HERE OR NOTHING CHECKS ITS WORDING. motivation-cards.spec.ts
 * walks this map, so a set that is not on it ships unreviewed by the one thing
 * that reads every sentence.
 */
export const CARD_SETS: Readonly<Record<string, readonly CardOption[]>> = {
  s13_reasons: S13_REASONS,
  s13_movements: S13_MOVEMENTS,
  s13_carry_style: S13_CARRY_STYLE,
  hunt_game_class: HUNT_GAME_CLASS,
  hunt_terrain: HUNT_TERRAIN,
  hunt_where: HUNT_WHERE,
  hunt_reasons: HUNT_REASONS,
  sport_reasons: SPORT_REASONS,
  sport_formats: SPORT_FORMATS,
  primary_use: PRIMARY_USE,
  section_held: OWNED_SECTION_HELD,
  overlap_angle: OVERLAP_ANGLES,
};
