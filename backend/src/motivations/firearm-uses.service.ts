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

/** How each slice is described to the model. */
const SLICE_LABEL: Record<UseSlice, string> = {
  s13: 'section 13 — licensed for SELF-DEFENCE',
  s14: 'section 14 — licensed for SELF-DEFENCE as a restricted firearm (a semi-automatic rifle or shotgun)',
  s15_hunt: 'section 15 — licensed to an OCCASIONAL HUNTER',
  s15_sport: 'section 15 — licensed to an OCCASIONAL SPORTS SHOOTER',
  s16_hunt:
    'section 16 — licensed to a DEDICATED HUNTER, accredited to a hunting association',
  s16_sport:
    'section 16 — licensed to a DEDICATED SPORTS SHOOTER, accredited to a sport-shooting body',
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
 * How many sentences one firearm is offered.
 *
 * ⚠️ A CAP, BECAUSE A SECTION 15 OR 16 ROW READS TWO SLICES. Five firearms at
 * eight sentences each is already a page of prompt; sixteen each is a fact
 * pack in which the facts are outnumbered by suggestions.
 */
const PER_ROW = 8;
const PER_SLICE = 8;

const SYSTEM = `
You describe what a class of firearm is lawfully and ordinarily used for in
SOUTH AFRICA, for a licence application under the Firearms Control Act 60 of
2000.

You are given a CLASS of firearm — a calibre, a type and an action — and a list
of the sections of the Act that class can be licensed under. You are NOT given
a person, and you must not invent one: no names, no places, no farms, no clubs,
no dates, no counts, no "I have been hunting for eleven years".

For EACH section listed, return the uses that a firearm of this class is
genuinely suited to and that somebody licensed under THAT section could
lawfully put it to. Cover the range: the obvious one, the ordinary ones, and
the honest edge cases.

RULES
1. Each use is ONE short sentence in the first person, present tense, ending in
   a full stop. "I use it for plains game at moderate ranges."
2. Plain South African English. Licence, calibre, centre-fire, metres.
3. THE SECTIONS ARE ANSWERED INDEPENDENTLY OF EACH OTHER. A use written under
   section 13 is a self-defence use and must not mention hunting or sport; a
   use written under section 15 or 16 is a hunting or sport use and must not
   mention self-defence, carrying, home defence or a "backup". This is section
   discipline and it is the one thing that makes these uses safe to put in a
   document.
4. AND SECTION 15 IS NOT SECTION 16. Section 15 is the OCCASIONAL hunter or
   sports shooter: a season, a few weekends, a club they belong to. Section 16
   is the DEDICATED hunter or sports shooter, accredited to an association,
   shooting to a calendar and a discipline. Write them differently, because
   they are different applicants. Likewise a hunter is not a sports shooter:
   do not give a hunting sentence under a sport slice.
5. NO PRODUCT COPY. No ballistics tables, no muzzle energy, no stopping power,
   no magazine capacity, no "platform", no manufacturer history, no marketing.
6. Nothing unlawful or unsafe: no carrying a rifle in public, no hunting with a
   firearm the Act does not permit for it, no night hunting except where it is
   genuinely lawful vermin control on land.
7. NOTHING ABOUT STORAGE OR CARRYING. Not where it is kept, not whether it is
   loaded, not what safe it lives in. The application has its own storage
   section answered from the applicant's own premises, and a sentence here that
   contradicts it is a fault on a signed document.
8. If the calibre is plainly unsuited to a section, return FEWER sentences for
   it, or none at all. A 6.35 mm pocket pistol is not a plains-game cartridge
   and a .458 is not a small-game one. An honest short list beats a padded one,
   and an empty list beats a dishonest one.
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
  async forClass(c: FirearmClass): Promise<string[]> {
    // Nothing to key on. A row with no calibre and no type is not a firearm.
    if (!c.calibre?.trim() && !c.type?.trim()) return [];

    // ⚠️ NO SECTION, NO USES. See the banner: we do not know whether this is a
    // self-defence firearm or a sporting one, and guessing writes the wrong
    // sentence onto a signed document.
    const wanted = SLICES_FOR_SECTION[(c.section ?? '').trim().toLowerCase()];
    if (!wanted?.length) return [];

    const hit = await this.read(c, wanted);
    if (hit === null) return [];
    if (hit.length) return trim(hit);

    const generated = await this.generate(c);
    if (!generated) return [];
    return trim(wanted.map((s) => generated[s] ?? []));
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

  /** Every eligible slice for this class, in one call, then stored. */
  private async generate(
    c: FirearmClass,
  ): Promise<Partial<Record<UseSlice, string[]>> | null> {
    if (!this.llm.isConfigured()) return null;

    const slices = eligibleSlices(c.type, c.action);
    if (!slices.length) return null;

    let out: Partial<Record<UseSlice, string[]>> = {};
    let model = '';
    try {
      const res = await this.llm.complete({
        maxTokens: 3000,
        timeoutMs: 90_000,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  'Firearm class:',
                  `  calibre: ${c.calibre || 'not stated'}`,
                  `  type: ${c.type || 'not stated'}`,
                  `  action: ${c.action || 'not stated'}`,
                  '',
                  'Answer each of these sections separately:',
                  ...slices.map((s) => `  ${s}: ${SLICE_LABEL[s]}`),
                ].join('\n'),
              },
            ],
          },
        ],
        json: { schema: schemaFor(slices) },
        purpose: 'motivation.firearm-uses',
      });
      model = res.model;
      const raw = JSON.parse(res.text) as Record<string, unknown>;
      // ⚠️ FILTERED TO THE SLICES WE ASKED FOR. A key we did not offer is a
      // section this class cannot fall into, whatever the model called it.
      out = Object.fromEntries(
        slices.map((s) => [s, this.clean(raw[s], s, c)]),
      ) as Partial<Record<UseSlice, string[]>>;
    } catch (err) {
      this.logger.warn(
        `Use profile generation failed for ${c.calibre}/${c.type}: ${(err as Error).message}`,
      );
      return null;
    }

    await this.store(c, slices, out, model);
    return out;
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
      out.push(u);
      if (out.length >= PER_SLICE) break;
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
    properties[s] = {
      type: 'array',
      items: { type: 'string' },
      maxItems: PER_SLICE,
    };
  }
  // Every eligible slice is REQUIRED, so "nothing fits here" comes back as an
  // empty array we can store rather than as a key we cannot tell from a
  // truncated response.
  return { type: 'object', properties, required: [...slices] };
}



/**
 * Two slices down to one offering, taking from each in turn.
 *
 * ⚠️ INTERLEAVED, NOT CONCATENATED. A section 16 row is offered hunting AND
 * sport because the card does not say which — and a straight concatenation cut
 * at eight would show the writer eight hunting sentences and no sport one,
 * which is the same as not asking.
 */
function trim(slices: readonly string[][]): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < PER_ROW; i++) {
    const before = out.length;
    for (const s of slices) {
      if (i < s.length && out.length < PER_ROW) out.push(s[i]);
    }
    if (out.length === before) break;
  }
  return out;
}
