import type { PlatePurpose } from './motivation-plates';

// ────────────────────────────────────────────────────────────────────
// THE 5.2 SHEET WHEN THE RESEARCH ARTICLE IS ABSENT.
//
// Operator, 2026-10-24: "that calibre needs to be matched to suit the purpose.
// I don't care about the specs and velocity. We need to explain to the CFR and
// DFO why this calibre and gun is perfect for the purpose we are getting it
// for." So these bullets argue the MATCH — the situations, the space, the way
// the firearm is carried or hunted — and print no dimension, velocity, energy
// or availability claim.
//
// ⚠️ FIRST PERSON, LIKE EVERY OTHER WORD ON THE PAGE. It used to read "the
// applicant is alone", "during the applicant's work", "a combination he can
// keep" — third person, in a letter the applicant signs as their own, on the
// page immediately after the motivation has been speaking in the first person
// for eight sections. A reviewer does not need to be told somebody else wrote
// it, and the voice is a rule (MOTIVATION-GUIDE-BOOK Part 1 rule 2).
//
// ⚠️ AND IT IS LONG ENOUGH TO CLOSE THE SHEET. The page is two columns to the
// foot; five bullets filled one column and a third of the other, which reads as
// a page that ran out of things to say. Every bullet here is RATIONALE — the
// case for the choice — which the writer is allowed to supply; none is a claim
// about the applicant's history, and none carries a figure the facts did not.
//
// PURE. No Nest, no clock, no model.
// ────────────────────────────────────────────────────────────────────

export interface SuitabilityFallbackInput {
  /** Which purpose the pack argues — the same answer the exhibits use. */
  purposeKind?: PlatePurpose;
  /** The exhibit captions, as printed under heading 3. */
  purposeNotes?: string[];
  /** "Why 6.35mm Browning suits this purpose", for the calibre name. */
  suitabilityLabel?: string;
  /** "CZ 6.35mm Browning, serial 81815" — how the firearm is named. */
  firearmLine?: string;
}

/** The exhibits named in this pack, in the order they print. */
function exhibitTitles(notes: readonly string[] | undefined): string[] {
  return (notes ?? [])
    .map((n) => n.split(':')[0]?.trim())
    .filter((t): t is string => Boolean(t));
}

/**
 * The cartridge's own name, off the sheet's heading.
 *
 * ⚠️ THE HEADING IS THE ONE PLACE THE NAME IS ALREADY RENDERED, and it is
 * built from the same softened calibre string as every other surface. Stripping
 * the wrapper rather than re-reading `firearm_calibre` keeps this page and the
 * heading above it saying the same thing.
 */
function calibreFromLabel(label: string | undefined): string {
  const raw = (label ?? '')
    .replace(/^Why\s+/i, '')
    .replace(/\s+suits this purpose\.?$/i, '')
    .trim();
  return raw || 'the cartridge applied for';
}

export function purposeFallback(input: SuitabilityFallbackInput): string[] {
  const titles = exhibitTitles(input.purposeNotes);
  const calibre = calibreFromLabel(input.suitabilityLabel);
  const purpose = input.purposeKind;
  const exhibits = titles.length
    ? `- The purpose is the one the exhibits set out: ${titles.join(', ')}.`
    : '';

  if (purpose === 'self_defence') {
    /**
     * ⚠️ THE ARGUMENT FOLLOWS THE CLASS ON THE COVER. Section 13 admits a
     * handgun or a non-semi-automatic shotgun; "a handgun can be carried on the
     * person" is the strongest sentence for one and false for the other.
     */
    const carries = /handgun|pistol|revolver/i.test(input.firearmLine ?? '');
    return [
      exhibits,
      '- Each of those is a sudden encounter at close quarters in which I am alone and cannot withdraw — at a vehicle door, a gate, a passage or inside my home.',
      carries
        ? `- The firearm applied for is a handgun in ${calibre}. A handgun is the class of firearm I can carry on my person through the working day and bring into use in the confined space where those encounters happen.`
        : `- The firearm applied for is chambered in ${calibre}. It is the class of firearm kept at hand at the place the risk occurs, and it is used at the short distance at which those encounters happen.`,
      ...(carries
        ? [
            '- A rifle or a shotgun cannot be carried on my person during my work and cannot be brought to bear in a vehicle, a doorway or a passage. It does not meet this purpose, however capable it is at distance.',
          ]
        : [
            '- A firearm that has to be fetched from another room, or that is too long to work in a doorway, is not available at the moment the risk is on me.',
          ]),
      `- The calibre is the round the firearm is chambered for. I have chosen the firearm and calibre together for the use described: a combination I can keep secure and bring into use at the moment the need arises.`,
      '- The firearm has to be kept ready without being a hazard to the people I live with. That is a question of how it is stored and handled, and the storage section answers it.',
      '- Practice is what makes the firearm usable under pressure, so the choice is also the one I will actually shoot: a firearm I can afford to practise with regularly is worth more in the moment than one I cannot.',
      '- I do not ask for it to be carried anywhere the Act does not allow, and I do not ask to use it except where it is safe to use and for a lawful purpose.',
      '- The choice is therefore the fit between the risk described above, the space it happens in, and the firearm I can keep and use lawfully — not a preference for a particular model.',
    ].filter(Boolean);
  }

  if (purpose === 'hunting') {
    return [
      exhibits,
      `- The cartridge applied for, ${calibre}, is matched to that class of game and to the ranges and conditions at which it is taken. The rifle is the firearm I will carry in that terrain.`,
      '- The choice is the fit between the quarry, the range and the conditions — not a general-purpose calibre used for everything.',
      '- Hunting is done on foot, often after a long walk, and the rifle has to be carried all day and brought up quickly when the animal appears. Weight and handling matter to that as much as the chambering does.',
      '- The shot has to be placed well and it has to be humane. That is the whole reason the cartridge is matched to the size of the animal and to the distance it is usually taken at, rather than chosen for the largest thing it might ever meet.',
      '- Where I hunt is the ground described above, and the ranges the animals are usually taken at there are the ranges this rifle and cartridge are for.',
      '- The firearm and calibre are the combination I will use for this hunting, and the purpose exhibits are the quarry that use is for.',
      '- Nothing in this choice is a claim about what I have already hunted. It is the firearm I am asking to use for the hunting described.',
    ].filter(Boolean);
  }

  if (purpose === 'sport') {
    return [
      exhibits,
      `- The firearm applied for, chambered in ${calibre}, is the combination I will use in those courses of fire.`,
      '- The choice is the fit between the course of fire, the firearm the rules admit and the way I will shoot it — not a general-purpose firearm used for everything.',
      '- A course of fire is a defined test: the distances, the positions, the time limits and the target are set, and the firearm has to suit that test rather than a preference.',
      '- Most of the sport is practice. A firearm I can shoot regularly, and afford to feed, is what turns an entry into a score, so the choice is also about the practice behind the competition.',
      '- The class or division the firearm competes in is part of the choice: I am asking for a firearm that fits the discipline I shoot, and the discipline the exhibits set out is the one this application is for.',
      '- The purpose exhibits are the courses that use is for, and the firearm and calibre are chosen to match them.',
    ].filter(Boolean);
  }

  return [
    exhibits,
    '- The firearm and calibre applied for are chosen for the purpose set out above, and the pages that follow explain that use.',
    `- The cartridge applied for is ${calibre}; it is the round the firearm is chambered for, and I have chosen the two together for the use described.`,
    '- The choice is the fit between that use and the firearm, and not a preference for a particular model.',
  ].filter(Boolean);
}
