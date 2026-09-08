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
    sentence:
      'This one is my backup, so a breakage does not end my season or leave me without a firearm.',
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
];

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
  overlap_angle: OVERLAP_ANGLES,
};
