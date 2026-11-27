import type { MotivationLicenceType } from '@prisma/client';
import type { CardOption, MotivationField } from '../motivation-fields';
import { classifyCalibre, type QuarryClass } from '../motivation-overlap';
import { resolveAssociation } from '../association-rules';
import { strategyFor } from './intake-strategies';
import { resolveSportingPurpose } from '../motivation-purpose';
import { cartridgeSource } from '../motivation-cartridge';
import type { InterviewBrief } from './intake-brief';

// ────────────────────────────────────────────────────────────────────
// THE CHIPS, IN ONE PLACE.
//
// ⚠️ THE PROBLEM THIS SOLVES. Every applicant used to see the same list:
// "Kudu / Blue wildebeest / Red hartebeest / Impala / Warthog / Springbok" on
// every hunting question, "Late-night returns / Cash, stock or tools" on every
// self-defence one. The cards carry `rankBy` metadata that says how they should
// be ordered for a given applicant, and until now nothing read it.
//
// Precedence, best evidence first:
//   1. the documents, the profile and earlier answers (already in `answers`);
//   2. the research brief — species for this cartridge and province, the
//      discipline, the ground;
//   3. the catalogue below — calibre, occupation, association and station;
//   4. the strategy's static suggestions (the old generic list);
//   5. the model, only when nothing above produced three viable answers.
//
// ⚠️ A CHIP IS ONLY EVER A PROPOSAL. Tapping is what writes; nothing here
// inserts an answer, and a chip is never a legal conclusion (see isSafeChip).
// ────────────────────────────────────────────────────────────────────

export interface ChipContext {
  type: MotivationLicenceType;
  answers: Record<string, string>;
  brief?: InterviewBrief | null;
}

/**
 * ⚠️ OCCUPATION IS A HINT, NOT A VERDICT. These are the trades whose work
 * actually puts cash, stock or tools on the road; anything else keeps the card
 * unranked rather than guessing a risk somebody does not have.
 */
const CASH_OR_STOCK =
  /\b(cash|retail|shop|store|sales|rep|driver|deliver|transport|contractor|builder|artisan|plumber|electrician|mechanic|farmer|farm|security|guard|cashier|manager|owner)\b/i;

/** Which use cards a cartridge actually supports. */
const CALIBRE_CARDS: Record<QuarryClass, readonly string[]> = {
  rimfire: ['small_game', 'range_practice', 'training_others'],
  varmint: ['small_game', 'culling', 'range_practice'],
  medium_game: ['plains_game', 'range_practice'],
  large_game: ['plains_game', 'dangerous_game'],
  dangerous_game: ['dangerous_game'],
  shotgun: ['wingshooting', 'clays'],
  handgun: ['self_defence_carry', 'home_defence', 'sport_competition'],
};

/**
 * Order a card set for THIS applicant.
 *
 * ⚠️ RANKING ONLY EVER MOVES AN OPTION TO THE FRONT. It never hides one. The
 * operator's rule is that viable answers are shown; the order is what makes the
 * list feel like it was written for the member. A tie keeps registry order.
 */
export function rankCardOptions(
  options: readonly CardOption[],
  ctx: ChipContext,
): CardOption[] {
  const policeStation = (ctx.answers.police_station ?? '').trim();
  const occupation = (ctx.answers.occupation ?? '').trim();
  const association = (ctx.answers.association_name ?? '').trim();
  // ⚠️ The cartridge when one was chosen: "6.5" classifies nowhere, while
  // "6,5 Creedmoor" selects the cards that round actually supports.
  const quarry = classifyCalibre(cartridgeSource(ctx.answers));

  const preferred = (option: CardOption): boolean => {
    switch (option.rankBy) {
      case 'precinct':
        // We hold a station, so the precinct card is the one the pack can
        // actually annex figures for.
        return Boolean(policeStation);
      case 'occupation':
        return CASH_OR_STOCK.test(occupation);
      case 'association':
        return Boolean(resolveAssociation(association));
      case 'calibre':
        return quarry ? CALIBRE_CARDS[quarry].includes(option.key) : false;
      default:
        return false;
    }
  };

  const first: CardOption[] = [];
  const rest: CardOption[] = [];
  for (const option of options) {
    (preferred(option) ? first : rest).push(option);
  }
  return [...first, ...rest];
}

/** The ground a province actually offers, for the location answer. */
const PROVINCE_TERRAIN: Record<string, string> = {
  limpopo: 'Limpopo bushveld',
  mpumalanga: 'Mpumalanga bushveld',
  'north west': 'North West bushveld',
  gauteng: 'Gauteng highveld',
  'free state': 'Free State plains',
  'kwazulu-natal': 'KwaZulu-Natal riverine bush',
  'eastern cape': 'Eastern Cape thicket',
  'western cape': 'Western Cape mountains',
  'northern cape': 'Karoo scrub',
};

/**
 * Catalogue chips for the open questions the brief may not cover.
 *
 * ⚠️ EACH ONE NAMES SOMETHING THE APPLICANT ALREADY TOLD US. The discipline
 * chips use the exercise they chose, the terrain chips use their province, the
 * renewal chips use the section they are renewing. A chip that could be offered
 * to anybody is not worth a button and is not produced here.
 */
export function catalogueChips(
  field: MotivationField,
  ctx: ChipContext,
): { value: string; label: string }[] {
  const answers = ctx.answers;

  if (field.key === 'hunting_locations') {
    const province = (answers.police_station_province ?? '')
      .trim()
      .toLowerCase();
    const terrain = PROVINCE_TERRAIN[province];
    return terrain ? [{ value: terrain, label: terrain }] : [];
  }

  if (field.key === 'competition_record') {
    const exercise = (answers.discipline_exercise ?? '').trim();
    if (!exercise) return [];
    return [
      `${exercise} — club league`,
      `${exercise} — provincial match`,
      `${exercise} — postal exercise`,
    ].map((text) => ({ value: text, label: text }));
  }

  if (field.key === 'continued_use') {
    const purpose = strategyFor(ctx.type).purpose;
    /**
     * ⚠️ A RENEWAL KNOWS ONLY THAT IT IS A RENEWAL. The section being renewed
     * says nothing about hunting or sport, so the branch is read from the
     * firearm — the cartridge's class is enough to tell a hunting rifle from a
     * competition one.
     */
    const inferred =
      purpose === 'sporting' || purpose === 'renewal'
        ? resolveSportingPurpose(answers)
        : 'self-defence';
    if (inferred !== 'self-defence') {
      const hunting = inferred !== 'sport';
      return hunting
        ? [
            'I have hunted with it every season since it was issued',
            'It is still the rifle I take on every hunt',
            'I still practise with it between seasons',
          ].map((text) => ({ value: text, label: text }))
        : [
            'I have shot it at club matches every year since it was issued',
            'It is still my competition firearm',
            'I still practise with it between matches',
          ].map((text) => ({ value: text, label: text }));
    }
    return [
      'It has stayed my household defence firearm',
      'I still keep and use it for the same purpose',
      'Nothing about how I use it has changed',
    ].map((text) => ({ value: text, label: text }));
  }

  return [];
}

/**
 * Everything the open question should offer, in precedence order.
 *
 * The planner merges this over the field's static suggestions; the brief's own
 * chips come first because they were written against the research.
 */
export function chipsFor(
  field: MotivationField,
  ctx: ChipContext,
): { value: string; label: string }[] {
  const briefChips = ctx.brief?.chips[field.key] ?? [];
  const catalogue = catalogueChips(field, ctx);
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const chip of [...briefChips, ...catalogue]) {
    const value = chip.value.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push({ value, label: chip.label.trim() || value });
    if (out.length >= 6) break;
  }
  return out;
}
