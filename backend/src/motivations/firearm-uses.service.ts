import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { MotivationLicenceType } from '@prisma/client';
import {
  sectionAllows,
  type CompetencyCategory,
  type LicenceSection,
} from '../common/sa-competency';
import { documentScope, southAfricanise } from './motivation-scope';

// ────────────────────────────────────────────────────────────────────
// WHAT A FIREARM OF THIS CLASS IS PLAUSIBLY USED FOR, IN SOUTH AFRICA.
//
// Operator, 2026-09-09: "send the calibre and which type of firearm and the
// section it is to gemini for each uploaded firearm and let it generate as much
// uses for that firearm it can and we can attach that. then when the time comes
// it can look at all the firearms and their uses and cherry pick each use case
// and generate a good motivation from there."
//
// And then, the same day: "we keep a small database with the calibre, Type (as
// its shown on the license) and section. then we build a general database for
// all calibers which we can grab from… it has to generate for all sections it
// can fall into respectively. and for section 15 it has to have for the
// occational hunter/sport shooter and for section 16 for the dedicated
// hunter/sportshooter. So it will suite like my own case where my 6.5 creed is
// section 15 and the rest is section 16."
//
// ⚠️ SO ONE GENERATION FILLS EVERY SECTION A CLASS CAN FALL INTO, AT ONCE.
// A .30-06 bolt rifle can be section 15 or section 16; a manual shotgun can be
// 13, 15 or 16. The classes repeat across members far more than the
// section-and-class pairs do, so generating every slice the first time a
// calibre appears is what turns this table into the general reference the
// operator asked for: the next applicant with a .30-06 pays nothing whatever
// section they hold it under.
//
// ⚠️ AND THE SLICES ARE WRITTEN AGAINST EACH OTHER, IN ONE CALL, ON PURPOSE.
// "Independent of each other" is a demand the model can only meet if it can
// see the alternatives — occasional hunting and dedicated hunting blur into
// one paragraph when they are written a week apart with no sight of the other.
//
// ⚠️ THIS IS A DELIBERATE OVERRIDE OF GUIDE-BOOK PART 1 RULE 7, WHICH SAYS A
// HELD FIREARM'S PURPOSE COMES FROM THE APPLICANT'S STATED USE OR AN
// ENDORSEMENT NAMING THAT SERIAL, AND OTHERWISE THE WRITER SAYS NOTHING ABOUT
// WHAT IT IS FOR. The operator overrode it on 2026-09-09 and the reasoning is
// theirs and is sound: "The use of the firearm I declare is not set in stone.
// If I state that I will be hunting a kudu with my 30-06 and decide I want to
// shoot tin cans with it, thats fine. Main thing is that I do it safely and
// legally."
//
// The Act agrees. Sections 13(4), 14(6), 15(4) and 16(3) each say a licensed
// firearm "may be used where it is safe to use the firearm and for a lawful
// purpose" — a permission attached to the licence, not a test, and not a
// commitment to the quarry anybody named. A stated use does not bind.
//
// ⚠️ WHAT IS *NOT* OVERRIDDEN, AND MUST NOT BE: THE SECTION. A held firearm's
// section comes off its licence card and is never generated — it only CHOOSES
// which slice of this table the writer is shown. That is what MO000071 got
// wrong: it wrote a section 16 Marlin as section 15, with the card sitting in
// Annexure G contradicting it. A section is checkable against a document in
// the same pack; a use is not. Different kind of claim, different rule.
//
// ⚠️ AND A ROW WITH NO SECTION GETS NOTHING. Where no card placed a firearm we
// do not know whether it is a self-defence pistol or a sporting one, and
// handing the writer both sets is how a self-defence firearm acquires a
// hunting sentence. Silence there is the old behaviour and it stays.
//
// ⚠️ NOTHING HERE IS ASKED OF THE MEMBER. "Automate it — do not ask":
// operator, 2026-09-09, "I don't want an applicant to sit and read and tick
// fucking boxes". This produces the material; the writer picks from it.
// ────────────────────────────────────────────────────────────────────

/**
 * One slice of the table: a section, and for 15 and 16 a discipline.
 *
 * ⚠️ 15 AND 16 SPLIT AND 13 AND 14 DO NOT, because the Act splits them.
 * Sections 15 and 16 each admit a hunter OR a sports shooter and the two
 * argue differently — an occasional hunter shoots a season, a dedicated sports
 * shooter shoots a calendar. Sections 13 and 14 have one purpose between them.
 */
export type UseSlice =
  | 's13'
  | 's14'
  | 's15_hunt'
  | 's15_sport'
  | 's16_hunt'
  | 's16_sport';

export const USE_SLICES: readonly UseSlice[] = [
  's13',
  's14',
  's15_hunt',
  's15_sport',
  's16_hunt',
  's16_sport',
];

/** The section each slice sits under, for the eligibility test. */
const SLICE_SECTION: Record<UseSlice, LicenceSection> = {
  s13: 'S13',
  s14: 'S14',
  s15_hunt: 'S15',
  s15_sport: 'S15',
  s16_hunt: 'S16',
  s16_sport: 'S16',
};

/**
 * What each slice is CALLED on the row the writer reads.
 *
 * ⚠️ THE LABEL TRAVELS WITH THE SENTENCES, because the breakdown is the point.
 * Operator, 2026-09-09: "likethe 6.5 creedmore you shouldve asked for
 * occational hunting and occational sport shooting. that would give two lists
 * instead of one consolidated list". A section 15 row carries TWO labelled
 * lists and the writer picks a list first and a sentence second — merging them
 * loses exactly the distinction that was generated.
 */
const SLICE_TITLE: Record<UseSlice, string> = {
  s13: 'self-defence',
  s14: 'self-defence with a self-loading firearm',
  s15_hunt: 'occasional hunting',
  s15_sport: 'occasional sport shooting',
  s16_hunt: 'dedicated hunting',
  s16_sport: 'dedicated sport shooting',
};

/**
 * What the MODEL is asked for, and what it answers under.
 *
 * ⚠️ THE WORDS, NEVER THE SECTION. Operator, 2026-09-09: "you can keep the
 * section in you database, but what we serve gemini should be dedicated
 * hunter, dedicated sport shooter, occational hunter occational sport
 * shooter." So the slice ids and the `section` column stay as they are — a
 * section is how the Act files a purpose and it is what a licence card prints
 * — and nothing that crosses the wire mentions one. Asking in section numbers
 * gets prose about the Act; asking in words gets prose about hunting.
 *
 * These are also the JSON keys the response comes back under, for the same
 * reason: a schema property called `s15_hunt` is a section number by another
 * name.
 */
const SLICE_KEY: Record<UseSlice, string> = {
  s13: 'self_defence',
  s14: 'self_defence_self_loading',
  s15_hunt: 'occasional_hunter',
  s15_sport: 'occasional_sport_shooter',
  s16_hunt: 'dedicated_hunter',
  s16_sport: 'dedicated_sport_shooter',
};

/** How each purpose is put to the model, in words. */
const SLICE_LABEL: Record<UseSlice, string> = {
  s13: 'SELF-DEFENCE — kept to protect the applicant and their family',
  s14: 'SELF-DEFENCE with a self-loading rifle or shotgun — the same purpose, with a firearm the law treats more strictly',
  s15_hunt:
    'OCCASIONAL HUNTER — somebody who hunts a season or a few trips a year, belonging to no association',
  s15_sport:
    'OCCASIONAL SPORT SHOOTER — somebody who shoots at a club now and then, accredited to no body',
  s16_hunt:
    'DEDICATED HUNTER — an accredited member of a hunting association, hunting to that association’s calendar',
  s16_sport:
    'DEDICATED SPORT SHOOTER — an accredited member of a sport-shooting body, competing in a registered discipline',
};

/**
 * The licence type each slice's sentences are judged as.
 *
 * ⚠️ THE SAME GATE THAT WOULD REJECT THEM LATER, APPLIED BEFORE THEY ARE
 * STORED. `documentScope` refuses hunting words in a self-defence document and
 * self-defence words in a hunting one, and it refuses catalogue copy
 * everywhere. Offering the writer a sentence that the gate will then throw the
 * whole document out for is worse than offering nothing: it costs a
 * regeneration, and the applicant cannot fix it by answering anything.
 *
 * ⚠️ SO RULE 3 OF THE PROMPT IS ENFORCED, NOT TRUSTED. Section discipline is
 * the one thing that makes these sentences safe to put in a signed document,
 * and a rule the model is merely asked to follow is a rule that holds until
 * the day it does not.
 */
const SLICE_AS_TYPE: Record<UseSlice, MotivationLicenceType> = {
  s13: MotivationLicenceType.S13_SELF_DEFENCE,
  s14: MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
  s15_hunt: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
  s15_sport: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
  s16_hunt: MotivationLicenceType.S16_DEDICATED_HUNTER,
  s16_sport: MotivationLicenceType.S16_DEDICATED_SPORT,
};

/** Which slices a section on a licence card entitles the writer to see. */
const SLICES_FOR_SECTION: Record<string, readonly UseSlice[]> = {
  'section 13': ['s13'],
  'section 14': ['s14'],
  'section 15': ['s15_hunt', 's15_sport'],
  'section 16': ['s16_hunt', 's16_sport'],
};

/**
 * One labelled list of uses, as the writer is offered it.
 *
 * ⚠️ NEVER FLATTENED. See SLICE_TITLE: a section 15 firearm gets an occasional
 * HUNTING list and an occasional SPORT list, and the writer chooses which
 * argument it is making before it chooses a sentence.
 */
export interface CandidateUses {
  /** "occasional hunting", "dedicated sport shooting", "self-defence". */
  label: string;
  uses: string[];
}

/**
 * Storage and carry claims, which are not this table's to make.
 *
 * ⚠️ THE PROMPT ASKS AND THE MODEL STILL OBLIGES. Rule 7 forbids these and a
 * live run produced "I keep it loaded with appropriate defensive loads for the
 * protection of my family inside the home", "I keep it accessible in my
 * bedroom" and "I stage the firearm securely inside my commercial retail
 * office" anyway — three sentences about where a shotgun lives, generated for
 * a table that knows nothing about anybody's premises.
 *
 * The pack answers storage from the applicant's own answers, in its own
 * numbered heading, with photographs of the safe annexed. A sentence here that
 * contradicts that heading is a contradiction inside one signed document, and
 * a firearm "kept loaded and accessible" is the specific contradiction a DFO
 * is looking for. `documentScope` does not police it because nothing else in
 * the pipeline invents storage facts.
 */
const STORAGE_CLAIMS = [
  'keep it loaded',
  'kept loaded',
  'loaded and ready',
  'keep it accessible',
  'kept accessible',
  'keep it within',
  'stage the firearm',
  'staged',
  'in my safe',
  'in a safe',
  'in the safe',
  'my gun safe',
  'bedside',
  'under my bed',
  'in my bedroom',
  'stored',
  'store it',
  'storage',
  'unlocked',
  'locked away',
] as const;

/** The four axes a use depends on. Nothing here identifies anybody. */
export interface FirearmClass {
  calibre: string;
  /** Handgun, Rifle, Shotgun, Combination — the form's own words. */
  type: string;
  /** 'Self-loading', 'Manual', or '' where no card said. */
  action: string;
  /** "section 16", or blank where no card established one. */
  section: string;
}

/**
 * Self-loading, manual, or nothing, off a licence card's Type row.
 *
 * ⚠️ THE FORM'S OWN TYPE BOX CANNOT SAY THIS. Its choices are Rifle, Shotgun,
 * Handgun and Combination; the card prints "S/L RIFLE" and
 * licence-centre-extract keeps the S/L verbatim. A self-loading rifle is a
 * different firearm to a bolt-action one — section 14 rather than 15, and a
 * different set of lawful uses — so it is worth one axis of the class.
 *
 * ⚠️ '' AND 'Manual' ARE DIFFERENT ANSWERS, AND sectionAllows TURNS ON IT. A
 * card that prints "RIFLE" is SAYING the rifle is not self-loading; no card at
 * all says nothing, and an unstated action is never a reason to rule a section
 * out. That distinction is why this returns three values and not two.
 *
 * ⚠️ IT REDUCES TO ONE WORD ON PURPOSE. Feeding the card's own text into the
 * key would give "S/L RIFLE", "S/L  RIFLE" and "SELF-LOADING RIFLE" three
 * cache rows and three paid generations for one firearm. This IS the card's
 * Type row — spelt the one way, so the table can be shared.
 */
export function actionFromCardType(cardType: string): string {
  const t = (cardType ?? '').trim();
  if (!t) return '';
  return /\bs\s*\/?\s*l\b|self[-\s]?load|semi[-\s]?auto/i.test(t)
    ? 'Self-loading'
    : 'Manual';
}

/** The form's type word as the Act's own category, or null for neither. */
function categoryOf(type: string): CompetencyCategory | null {
  const t = (type ?? '').trim().toLowerCase();
  if (t === 'handgun') return 'handgun';
  if (t === 'shotgun') return 'shotgun';
  if (t === 'rifle' || t === 'carbine') return 'rifle-carbine';
  // ⚠️ A COMBINATION GUN IS BOTH, so no single category covers it and we must
  // not pick one — the same call firearmShape makes, for the same reason.
  return null;
}

/**
 * Every section this class of firearm can lawfully fall into.
 *
 * ⚠️ THE ACT DECIDES THIS, NOT THE MODEL, and `sectionAllows` is where the Act
 * already lives — including the two directions it was got wrong in once
 * before. A semi-automatic shotgun cannot be section 13; a handgun cannot be
 * section 14 however it cycles; a semi-automatic rifle cannot be section 15.
 * Generating a slice the law does not admit would put a section on a page that
 * a DFO can refuse on sight.
 *
 * ⚠️ AN UNKNOWN TYPE GETS EVERYTHING. A combination gun, or a type this
 * registry does not recognise, is not a reason to withhold material: the row's
 * own section still chooses one slice out of what comes back, and that section
 * came off a card.
 */
export function eligibleSlices(type: string, action: string): UseSlice[] {
  const category = categoryOf(type);
  if (!category) return [...USE_SLICES];
  const selfLoading =
    action === 'Self-loading' ? true : action === 'Manual' ? false : null;
  return USE_SLICES.filter(
    (s) => sectionAllows(SLICE_SECTION[s], category, selfLoading).ok,
  );
}

/**
 * The cache key — one row per class AND SLICE.
 *
 * ⚠️ NORMALISED HARD, BECAUSE THE SAME FIREARM ARRIVES SPELT SIX WAYS. A card
 * reader gives "9MM PAR ( 9X19MM )", a member types "9mm Parabellum", the
 * overlap table knows "9x19". Keyed on the raw strings this table would fill
 * with near-duplicates and every one of them would cost its own generation.
 */
export function useClassKey(
  c: Pick<FirearmClass, 'calibre' | 'type' | 'action'>,
  slice: UseSlice,
): string {
  const norm = (v: string) =>
    (v ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  return [norm(c.calibre), norm(c.type), norm(c.action), slice].join('|');
}

/**
 * How many times the model is asked, and how much it may give each time.
 *
 * ⚠️ THE ROUNDS ARE WHERE THE VOLUME COMES FROM, NOT THE CAP. Asked once, the
 * model answers with two to five and stops however high `maxItems` is set;
 * asked again with its own previous answer in front of it and told not to
 * repeat, it goes and finds more. Operator, 2026-09-09: "We need a huge list
 * of reasons."
 *
 * ⚠️ PER LIST, NOT PER FIREARM. An earlier version capped the firearm at eight
 * across both disciplines, which is how one consolidated list appeared where
 * two were generated. A section 15 rifle may now hold forty hunting sentences
 * AND forty sport ones.
 */
const ROUNDS = 3;
const PER_ROUND = 12;
const PER_SLICE = 40;

/**
 * How many of a list actually reach the writer.
 *
 * ⚠️ THE TABLE HOLDS EVERYTHING; THE PROMPT DOES NOT. Forty sentences per list
 * × two lists × five held firearms is four hundred suggestions wrapped around
 * a handful of facts, and the writer's job is to argue from the FACTS. It
 * needs a varied menu, not the whole cookbook.
 *
 * ⚠️ AND THE WINDOW MOVES PER FIREARM, so two applicants holding the same
 * calibre are not handed the same ten sentences — which is what
 * `motivation-sameness` exists to catch.
 */
const OFFER_PER_LIST = 10;

const SYSTEM = `
You describe what a class of firearm is lawfully and ordinarily used for in
SOUTH AFRICA, for a licence application under the Firearms Control Act 60 of
2000.

You are given a CLASS of firearm — a calibre, a type and an action — and a list
of the KINDS OF SHOOTER who may lawfully hold one. You are NOT given a person,
and you must not invent one: no names, no places, no farms, no clubs, no dates,
no counts, no "I have been hunting for eleven years".

For EACH kind of shooter listed, return the uses that a firearm of this class
is genuinely suited to and that THAT shooter could lawfully put it to. Give AS
MANY AS YOU CAN, up to twelve per shooter. Two or three is a failed answer.

WORK THROUGH IT SYSTEMATICALLY RATHER THAN LISTING WHAT COMES TO MIND FIRST.
Walk the axes, and take a use from each:

- QUARRY. Every species this calibre honestly suits, from the smallest it is
  not wasteful on to the largest it is adequate for. Name them.
- TERRAIN AND REGION. Bushveld, thornveld, Karoo scrub, highveld grassland,
  mountain, coastal thicket, farmland, open plains, inland pans.
- METHOD. Walk-and-stalk, a hide or blind, over water, over bait where lawful,
  a driven bird shoot, from a vehicle where lawful, lawful problem-animal and
  vermin control for a landowner.
- DISTANCE. What it is used for close in, at middle distance, and far out.
- SEASON AND OCCASION. Opening weekend, a winter biltong trip, a culling
  contract, a club day, a league round, a provincial shoot.
- FORMAT, AND BE SPECIFIC. Name the disciplines this class is genuinely shot
  in IN SOUTH AFRICA, and the formats, positions, distances and target types
  inside them — precision rifle matches shot from improvised positions against
  reactive steel; F-Class prone at fixed distances; metal silhouette against
  animal-shaped steel; benchrest grouping on paper; veld-shooting and
  hunting-rifle exercises shot standing off sticks, sitting, kneeling and
  prone; postal shoots; club league rounds. "I shoot competitions" is a wasted
  sentence. "I shoot F-Class prone at six hundred metres" is a use.
- PREPARATION. Zeroing, load development, practice that keeps the skill and
  the shot placement honest — these are real uses of the firearm.

For self-defence, walk the equivalent: the home, a vehicle, business premises,
travelling, and the range practice that keeps it competent.

RULES
1. Each use is ONE short sentence in the first person, present tense, ending in
   a full stop. "I use it for plains game at moderate ranges."
2. Plain South African English. Licence, calibre, centre-fire, metres.
3. THE LISTS ARE WRITTEN INDEPENDENTLY OF EACH OTHER. A use for self-defence
   must not mention hunting or sport; a use for a hunter or a sports shooter
   must not mention self-defence, carrying, home defence or a "backup". This is
   the one thing that makes these sentences safe to put in a document.
4. AND OCCASIONAL IS NOT DEDICATED. The occasional hunter or sports shooter
   goes out a season or a few weekends and belongs to no association. The
   dedicated hunter or sports shooter is accredited, shoots to a calendar and
   competes in a registered discipline. Write them differently, because they
   are different people. Likewise a hunter is not a sports shooter: never give
   a hunting sentence under a sport-shooting list, or the other way round.
5. NAME THE DISCIPLINE, NEVER THE BODY. No association, federation, club or
   range by name — say "my association", "my sport-shooting body", "the club
   range". The discipline is a fact about the SPORT and you should name it
   precisely; which association somebody belongs to is a fact about THEM.
   ⚠️ This is not because the association may not be named in the finished
   document — a section 16 applicant IS an accredited member and the pack
   carries which body, so the writer substitutes the real name when it uses
   one of these sentences. It is because THIS list is written once for a class
   of firearm and served to every applicant who ever holds one, and a name
   baked in here would be served to the members of every other association.
6. NO PRODUCT COPY, AND A CARTRIDGE'S VIRTUES ARE NOT USES. No ballistic
   coefficients, no recoil, no barrel life, no muzzle energy, no stopping
   power, no magazine capacity, no "platform", no "tactical", no component
   availability, no manufacturer history, no marketing. "It is accurate and
   recoils lightly" says nothing about what somebody does with it, and a
   Registrar reads it as an appetite rather than a need.
7. Nothing unlawful or unsafe: no carrying a rifle in public, no hunting with a
   firearm the law does not permit for it, no night hunting except where it is
   genuinely lawful vermin control on land.
8. NOTHING ABOUT STORAGE OR CARRYING. Not where it is kept, not whether it is
   loaded, not what safe it lives in. The application answers that from the
   applicant's own premises, and a sentence here that contradicts it is a fault
   on a signed document.
9. NEVER CITE THE LAW. No section numbers, no "in terms of the Act", no
   statute. These are sentences about shooting, not about legislation.
10. NO TWO SENTENCES IN ONE LIST MAY SAY THE SAME THING. "I hunt impala in the
   bushveld" and "I use it for impala in thick bush" are one use written twice.
   A long list is wanted; a padded one is not.
11. EVERY SENTENCE MUST BE TRUE OF THIS CLASS. Length never excuses invention:
   a 6.35 mm pocket pistol is not a plains-game cartridge and a .458 is not a
   small-game one. Where a shooter genuinely has little use for this class,
   give the few that are real and stop — an empty list beats a dishonest one.
`.trim();

@Injectable()
export class FirearmUsesService {
  private readonly logger = new Logger(FirearmUsesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /**
   * The uses to offer one held firearm, generated once per class and reused.
   *
   * ⚠️ NEVER THROWS. A firearm with no uses is the state this feature replaces,
   * not a failure: the writer already knows how to name a firearm and its
   * section and stop. A model outage must not fail somebody's application, and
   * `documentScope` only relaxes its invented-purpose rule for a row that
   * actually came back with something.
   */
  async forClass(c: FirearmClass, seed = ''): Promise<CandidateUses[]> {
    // Nothing to key on. A row with no calibre and no type is not a firearm.
    if (!c.calibre?.trim() && !c.type?.trim()) return [];

    // ⚠️ NO SECTION, NO USES. See the banner: we do not know whether this is a
    // self-defence firearm or a sporting one, and guessing writes the wrong
    // sentence onto a signed document.
    const wanted = SLICES_FOR_SECTION[(c.section ?? '').trim().toLowerCase()];
    if (!wanted?.length) return [];

    const hit = await this.read(c, wanted);
    if (hit === null) return [];
    if (hit.length) return label(wanted, hit, seed);

    const generated = await this.generate(c);
    if (!generated) return [];
    return label(
      wanted,
      wanted.map((s) => generated[s] ?? []),
      seed,
    );
  }

  /**
   * The rows we already hold for the slices this firearm needs.
   *
   * @returns null where the READ ITSELF failed — a database we cannot trust is
   *   not a cache miss, and spending money on it would double the fault. An
   *   empty inner array is an honest miss.
   */
  private async read(
    c: FirearmClass,
    wanted: readonly UseSlice[],
  ): Promise<string[][] | null> {
    try {
      const rows = await this.prisma.firearmUseProfile.findMany({
        where: { classKey: { in: wanted.map((s) => useClassKey(c, s)) } },
        select: { classKey: true, uses: true },
      });
      const bySlice = new Map(rows.map((r) => [r.classKey, r.uses]));
      // ⚠️ ALL OR NOTHING. A section 16 row wants two slices and one
      // generation writes both, so holding one and not the other means the
      // write was interrupted — regenerating both is cheaper than reasoning
      // about which half is stale.
      if (rows.length !== wanted.length) return [];
      return wanted.map((s) => bySlice.get(useClassKey(c, s)) ?? []);
    } catch (err) {
      this.logger.warn(`Use profile read failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Every eligible list for this class, over several rounds, then stored.
   *
   * ⚠️ ONE CALL WAS NEVER GOING TO PRODUCE A BIG LIST, whatever the cap said.
   * Asked once, the model gives its best two to five and stops — that is what
   * "list the uses" means to it, and raising `maxItems` from 8 to 12 changed
   * nothing. Operator, 2026-09-09: "what can we querry it to give more
   * reasons? We need a huge list of reasons."
   *
   * So it is asked REPEATEDLY, and each round after the first is shown
   * everything already collected and told to give only what is not there. That
   * is the lever: a model that cannot see its previous answer rewords it, and
   * a model that can see it goes looking for new ground — different species,
   * different terrain, a different method, a different season.
   *
   * ⚠️ AND THE ROUNDS ARE SMALL ON PURPOSE. Twelve sentences × five lists is
   * already 2,000 tokens of JSON; asking for forty in one response invites a
   * truncated body, and a truncated body is a `JSON.parse` throw that costs
   * the whole class. Three modest rounds are safer than one enormous one.
   *
   * ⚠️ THE COST IS PAID ONCE, EVER, PER CLASS. Three calls the first time
   * anybody holds a .30-06; nothing for every applicant after them.
   */
  private async generate(
    c: FirearmClass,
  ): Promise<Partial<Record<UseSlice, string[]>> | null> {
    if (!this.llm.isConfigured()) return null;

    const slices = eligibleSlices(c.type, c.action);
    if (!slices.length) return null;

    const out: Record<string, string[]> = Object.fromEntries(
      slices.map((s) => [s, [] as string[]]),
    );
    let model = '';
    let rounds = 0;

    for (let round = 0; round < ROUNDS; round++) {
      // Nothing left to ask for — every list is full.
      if (slices.every((s) => out[s].length >= PER_SLICE)) break;
      let raw: Record<string, unknown>;
      try {
        const res = await this.llm.complete({
          maxTokens: 4000,
          timeoutMs: 90_000,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: this.ask(c, slices, out, round) }],
            },
          ],
          json: { schema: schemaFor(slices) },
          purpose: 'motivation.firearm-uses',
        });
        model = res.model;
        raw = JSON.parse(res.text) as Record<string, unknown>;
      } catch (err) {
        this.logger.warn(
          `Use profile round ${round + 1} failed for ${c.calibre}/${c.type}: ${(err as Error).message}`,
        );
        // ⚠️ A LATER ROUND THAT FAILS KEEPS THE EARLIER ONES. Round 1 is the
        // one that matters; rounds 2 and 3 are enrichment, and losing them
        // must not lose the class.
        break;
      }
      rounds++;
      for (const s of slices) {
        // ⚠️ FILTERED TO THE LISTS WE ASKED FOR. A key we did not offer is a
        // purpose this class cannot hold, whatever the model called it.
        out[s] = merge(out[s], this.clean(raw[SLICE_KEY[s]], s, c));
      }
    }

    if (!rounds) return null;
    const result = Object.fromEntries(
      slices.map((s) => [s, out[s]]),
    ) as Partial<Record<UseSlice, string[]>>;
    this.logger.log(
      `Use profile ${c.calibre}/${c.type}: ${rounds} round(s), ` +
        slices.map((s) => `${s}=${out[s].length}`).join(' '),
    );
    await this.store(c, slices, result, model);
    return result;
  }

  /** One round's question, carrying everything the earlier rounds produced. */
  private ask(
    c: FirearmClass,
    slices: readonly UseSlice[],
    have: Record<string, string[]>,
    round: number,
  ): string {
    const lines = [
      'Firearm class:',
      `  calibre: ${c.calibre || 'not stated'}`,
      `  type: ${c.type || 'not stated'}`,
      `  action: ${c.action || 'not stated'}`,
      '',
      'Answer for each of these shooters separately:',
      ...slices.map((s) => `  ${SLICE_KEY[s]}: ${SLICE_LABEL[s]}`),
    ];
    if (round === 0) return lines.join('\n');

    /**
     * ⚠️ THE WHOLE POINT OF A SECOND ROUND IS THIS BLOCK. Without it the model
     * returns its first answer in new words and the union grows by nothing.
     */
    lines.push(
      '',
      'YOU HAVE ALREADY GIVEN THESE. Do not repeat any of them, and do not',
      'reword them:',
    );
    for (const s of slices) {
      lines.push(`  ${SLICE_KEY[s]}:`);
      if (!have[s].length) lines.push('    (nothing yet)');
      for (const u of have[s]) lines.push(`    - ${u}`);
    }
    lines.push(
      '',
      'Now give FURTHER uses, genuinely different from those: a different',
      'species or quarry, a different terrain or province, a different method,',
      'a different distance, a different time of year, a different format of',
      'competition, or the preparation and practice that surrounds the main',
      'use. If you genuinely have nothing further for one of these shooters,',
      'return an empty list for them rather than rewording what is above.',
    );
    return lines.join('\n');
  }

  /**
   * One slice's sentences: spelling folded, then screened, then capped.
   *
   * ⚠️ SCREENED AGAINST THE GATE THAT WOULD REJECT THEM LATER. See
   * SLICE_AS_TYPE. A sentence that trips `documentScope` is dropped here,
   * where it costs nothing, rather than in the writer's draft, where it costs
   * a regeneration and can fail the run to an admin.
   */
  private clean(v: unknown, slice: UseSlice, c: FirearmClass): string[] {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    let refused = 0;
    for (const raw of v) {
      // Fold the spelling BEFORE judging it — "caliber" is a spelling to fix,
      // not a sentence to throw away.
      const u = southAfricanise(String(raw ?? '').trim());
      if (u.length <= 3 || u.length > 200) continue;
      const faults = documentScope(u, {
        licenceType: SLICE_AS_TYPE[slice],
        arsenal: [],
      });
      if (faults.length) {
        refused++;
        continue;
      }
      // See STORAGE_CLAIMS: the pack answers storage from the applicant's own
      // premises, and this table knows nothing about them.
      if (STORAGE_CLAIMS.some((w) => u.toLowerCase().includes(w))) {
        refused++;
        continue;
      }
      /**
       * ⚠️ A DOUBLED WORD, WHICH IS A TYPO ON A SIGNED DOCUMENT. A live run
       * produced "in thick coastal coastal thickets". Nothing downstream
       * proofreads these — the writer lifts a sentence whole — so the one
       * class of model typo that can be caught without a dictionary is caught
       * here. Cheap, and it cannot refuse a well-formed sentence.
       */
      if (/\b(\w+)\s+\1\b/i.test(u)) {
        refused++;
        continue;
      }
      out.push(u);
      if (out.length >= PER_ROUND) break;
    }
    if (refused) {
      // Not an error — the screen is doing its job — but a class that loses
      // most of a slice every time is a prompt fault worth seeing.
      this.logger.log(
        `Use profile ${c.calibre}/${c.type} ${slice}: dropped ${refused} of ${v.length}`,
      );
    }
    return out;
  }

  /** One row per slice, so a bad batch can be found and cleared by class. */
  private async store(
    c: FirearmClass,
    slices: readonly UseSlice[],
    out: Partial<Record<UseSlice, string[]>>,
    model: string,
  ): Promise<void> {
    for (const slice of slices) {
      const uses = out[slice] ?? [];
      try {
        // ⚠️ upsert, NOT create. Two applications on the same calibre race
        // here, and losing that race must cost the second one its write, never
        // its answer.
        await this.prisma.firearmUseProfile.upsert({
          where: { classKey: useClassKey(c, slice) },
          create: {
            classKey: useClassKey(c, slice),
            calibre: c.calibre ?? '',
            type: c.type ?? '',
            action: c.action ?? '',
            slice,
            uses,
            model,
          },
          update: { uses, model },
        });
      } catch (err) {
        this.logger.warn(`Use profile write failed: ${(err as Error).message}`);
      }
    }
  }
}

/** The response shape, built from exactly the slices this class can hold. */
function schemaFor(slices: readonly UseSlice[]) {
  const properties: Record<string, unknown> = {};
  for (const s of slices) {
    // ⚠️ NAMED IN WORDS, LIKE EVERYTHING ELSE THAT CROSSES THE WIRE. See
    // SLICE_KEY: a schema property called `s15_hunt` is a section number by
    // another name, and the operator asked for the words.
    properties[SLICE_KEY[s]] = {
      type: 'array',
      items: { type: 'string' },
      maxItems: PER_SLICE,
    };
  }
  // Every eligible list is REQUIRED, so "nothing fits here" comes back as an
  // empty array we can store rather than as a key we cannot tell from a
  // truncated response.
  return {
    type: 'object',
    properties,
    required: slices.map((s) => SLICE_KEY[s]),
  };
}



/**
 * A later round folded into what we already hold, without the repeats.
 *
 * ⚠️ THE MODEL REWORDS RATHER THAN REFUSES. Told not to repeat itself it
 * mostly obliges, but "I hunt impala in the bushveld" comes back as "I use it
 * for impala in thick bush" often enough that an exact-match check catches
 * almost nothing. So the comparison is on the CONTENT WORDS — the sentence
 * stripped of its punctuation and of the scaffolding every one of these
 * sentences shares — and two sentences sharing most of theirs are one use.
 */
function merge(have: readonly string[], added: readonly string[]): string[] {
  const out = [...have];
  const seen = have.map(contentWords);
  for (const u of added) {
    if (out.length >= PER_SLICE) break;
    const words = contentWords(u);
    if (!words.size) continue;
    if (seen.some((s) => overlaps(s, words))) continue;
    out.push(u);
    seen.push(words);
  }
  return out;
}

/** Everything every one of these sentences says, so it distinguishes nothing. */
const SCAFFOLDING = new Set([
  'i',
  'it',
  'for',
  'the',
  'a',
  'an',
  'my',
  'and',
  'or',
  'of',
  'on',
  'in',
  'at',
  'to',
  'with',
  'use',
  'uses',
  'used',
  'using',
  'this',
  'that',
  'firearm',
  'rifle',
  'shotgun',
  'handgun',
  'where',
  'when',
  'during',
  'from',
  'its',
  'as',
  'by',
  'is',
  'are',
  'be',
]);

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !SCAFFOLDING.has(w)),
  );
}

/**
 * Two sentences saying the same thing.
 *
 * ⚠️ MEASURED AGAINST THE SHORTER ONE. "I hunt impala" against "I hunt impala
 * in the bushveld in winter" shares everything the short one has, and calling
 * that 40% similar because the long one has more words would let a sentence
 * back in by padding it.
 */
function overlaps(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (!small.size) return false;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / small.size >= 0.7;
}

/**
 * The window of a list that reaches the writer, rotated per firearm.
 *
 * ⚠️ NOT THE HEAD OF THE LIST. Everybody holding a .30-06 would be handed the
 * same ten sentences in the same order, which is how a battery of documents
 * starts to look like one document. `offset` comes from the firearm's own
 * serial, so it is stable for a member across regenerations and different
 * between members.
 */
export function offerFrom(uses: readonly string[], offset: number): string[] {
  if (uses.length <= OFFER_PER_LIST) return [...uses];
  const start = ((offset % uses.length) + uses.length) % uses.length;
  return Array.from(
    { length: OFFER_PER_LIST },
    (_, i) => uses[(start + i) % uses.length],
  );
}

/** A small stable number off a serial, for the window above. */
export function offsetFor(seed: string): number {
  let h = 0;
  for (const ch of seed ?? '') h = (h * 31 + ch.charCodeAt(0)) % 100_000;
  return h;
}

/**
 * The slices, named, with the empty ones dropped.
 *
 * ⚠️ ONE ENTRY PER DISCIPLINE, NEVER MERGED. A section 16 row comes back as a
 * dedicated-hunting list AND a dedicated-sport list because the licence card
 * does not say which the applicant holds it for, and the writer needs to see
 * that it is choosing between two arguments.
 */
function label(
  slices: readonly UseSlice[],
  uses: readonly string[][],
  seed: string,
): CandidateUses[] {
  const offset = offsetFor(seed);
  return slices
    .map((s, i) => ({
      label: SLICE_TITLE[s],
      uses: offerFrom(uses[i] ?? [], offset),
    }))
    .filter((g) => g.uses.length);
}
