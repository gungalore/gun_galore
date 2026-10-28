import { MotivationLicenceType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { isSportingLicence, resolveSportingPurpose } from './motivation-purpose';
import { fieldByKey } from './motivation-fields';
import { BLOCK_LABELS, sectionOf } from './motivation-research.service';
import type { ArsenalRow } from './motivation-arsenal';

// ────────────────────────────────────────────────────────────────────
// THE 5.2 SUITABILITY ARGUMENT.
//
// Operator, 2026-10-28: "we also need to get a smarter writer. it needs to
// give proper context to why a firearm and calibre is suited for the selected
// application. It literally should ask why is the glock 43 x that is chamered
// in 9mm suited for self defence insode my townhouse. explain in 400 words in
// bullet fact format for example."
//
// And: "velocity and spec does not full those. Stopping power does. Over over
// penatration concerns does. Those are real reasons."
//
// ⚠️ THIS IS THE ARGUMENT, NOT THE BROCHURE. It is written for the Registrar
// and the DFO, in the applicant's voice, from the applicant's own circumstances
// and the calibre research. It is the page after the dimension sheet: 12-16
// bullet facts, ~400 words.
//
// ⚠️ A FACT IS NOT A FIGURE. Stopping power and over-penetration are argued
// qualitatively. Velocity, muzzle energy, bullet weight, pressure, chamber
// dimensions and magazine capacity are refused: they describe the object, not
// why it suits this person in this place.
//
// PURE. No Nest, no Prisma, no model call. The service beside this file makes
// the call; everything here is testable without a provider.
// ────────────────────────────────────────────────────────────────────

/** Bump when the brief, the schema or the validation changes. */
export const SUITABILITY_VERSION = '2026-10-28a';

export interface SuitabilityBulletGroup {
  heading: string;
  bullets: string[];
}

export interface SuitabilityArgument {
  question: string;
  thesis: string;
  groups: SuitabilityBulletGroup[];
  /** Computed by us, never trusted from the model. */
  wordCount: number;
  version: string;
}

export interface SuitabilityInput {
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;
  /** The RAW research, before withoutRefusedCopy strips capability words. */
  research: string;
  /** The purpose exhibit titles, in print order. */
  exhibits: readonly string[];
  /** "Glock 43X · 9mm Parabellum", for the heading. */
  firearmLine: string;
  /** Every firearm the applicant already holds, for the alternatives. */
  arsenal: readonly ArsenalRow[];
}

type PurposeKind = 'self-defence' | 'hunting' | 'sport' | 'continued use';

/** Which purpose this application argues, in the page's own words. */
export function suitabilityPurpose(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
): PurposeKind {
  if (
    licenceType === MotivationLicenceType.S13_SELF_DEFENCE ||
    licenceType === MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE
  ) {
    return 'self-defence';
  }
  if (licenceType === MotivationLicenceType.S24_RENEWAL) return 'continued use';
  if (!isSportingLicence(licenceType)) return 'hunting';
  const purpose = resolveSportingPurpose(answers);
  if (purpose === 'sport') return 'sport';
  if (purpose === 'hunting') return 'hunting';
  return 'hunting';
}

function value(answers: Record<string, string>, key: string): string {
  return (answers[key] ?? '').trim();
}

function lowerFirst(text: string): string {
  if (!text) return text;
  // Keep acronyms and proper names (IPSC, SAHGCA, Glock) as printed.
  if (/^[A-Z]{2}/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function isPlaceholderModel(val: string | undefined | null): boolean {
  if (!val) return true;
  return /^(none|nil|n\/?a|-+|unknown)$/i.test(val.trim());
}

/**
 * The exact question this page answers.
 *
 * ⚠️ IT NAMES THE FIREARM, THE CALIBRE, THE PURPOSE AND THE APPLICANT'S OWN
 * SITUATION. "Why is 9mm suitable?" is a cartridge article. "Why is the Glock
 * 43X, chambered in 9mm, suited for self-defence inside a townhouse?" is a
 * motivation. Placeholder models ("NONE", "N/A") are filtered out so the title
 * reads naturally ("Why is the Nordiske Precision, chambered in .223...").
 */
export function buildSuitabilityQuestion(input: SuitabilityInput): string {
  const make = value(input.answers, 'firearm_make');
  const rawModel = value(input.answers, 'firearm_model');
  const model = isPlaceholderModel(rawModel) ? '' : rawModel;
  const calibre = value(input.answers, 'firearm_calibre');
  const firearm =
    [make, model].filter(Boolean).join(' ') || input.firearmLine || 'the firearm applied for';
  const purpose = suitabilityPurpose(input.licenceType, input.answers);
  const situation = suitabilitySituation(input, purpose);
  return `Why is the ${firearm}${
    calibre ? `, chambered in ${calibre},` : ''
  } suited for ${purpose}${situation ? ` ${situation}` : ''}?`;
}

/** The tail of the question: where the purpose happens. */
export function suitabilitySituation(
  input: SuitabilityInput,
  purpose: PurposeKind = suitabilityPurpose(input.licenceType, input.answers),
): string {
  const a = input.answers;
  if (purpose === 'self-defence') {
    const home = value(a, 'residence_type');
    const station = value(a, 'police_station');
    if (home) {
      const place = /^townhouse/i.test(home) ? 'a townhouse' : lowerFirst(home);
      return `inside ${place}${station ? ` in the ${station} area` : ''}`;
    }
    return station ? `in the ${station} area` : '';
  }
  if (purpose === 'hunting') {
    const quarry = value(a, 'intended_quarry');
    const where = value(a, 'hunting_locations');
    if (quarry && where) return `for ${quarry} in ${where}`;
    if (quarry) return `for ${quarry}`;
    if (where) return `in ${where}`;
    return input.exhibits.length ? `for ${input.exhibits.join(', ')}` : '';
  }
  if (purpose === 'sport') {
    const discipline = value(a, 'competition_record') || value(a, 'activity_record');
    return discipline ? `in ${lowerFirst(discipline)}` : '';
  }
  return '';
}

/**
 * The facts the writer may use. Nothing here is invented; every line is either
 * an answer or a supplied research line.
 */
export function buildSuitabilityFacts(input: SuitabilityInput): string[] {
  const a = input.answers;
  const facts: string[] = [];
  const add = (label: string, raw: string) => {
    const v = raw.trim();
    if (v) facts.push(`${label}: ${v}`);
  };

  add('Firearm applied for', input.firearmLine);
  add('Type', value(a, 'firearm_type'));
  add('Action', value(a, 'firearm_action'));
  add('Calibre', value(a, 'firearm_calibre'));

  const purposeKeys = [
    'residence_type',
    'police_station',
    'premises_enclosure',
    'premises_access_control',
    'alarm_present',
    'armed_response',
    'burglar_bars',
    'security_gates',
    'safe_present',
    'safe_type',
    'safe_mounted',
    'safe_mounted_to',
    'safe_key_holder',
    'safe_storage_detail',
    's13_movements',
    's13_carry_style',
    'threat_circumstances',
    'daily_movements',
    'intended_quarry',
    'hunting_locations',
    'hunting_history',
    'activity_record',
    'competition_record',
    'continued_use',
  ] as const;
  for (const key of purposeKeys) {
    const label = fieldByKey(input.licenceType, key)?.label ?? key;
    add(label, value(a, key));
  }

  if (input.exhibits.length) {
    add('Purpose exhibits', input.exhibits.join(', '));
  }

  if (input.arsenal.length) {
    const held = input.arsenal
      .map((r) =>
        [r.make, r.model, r.calibre, r.type, r.section, r.licensedFor]
          .filter(Boolean)
          .join(' · '),
      )
      .filter(Boolean);
    if (held.length) add('Firearms already held', held.join('; '));
  }

  return facts;
}

/**
 * The research the writer may argue from: the firearm and calibre blocks only.
 *
 * ⚠️ RAW, NOT `withoutRefusedCopy`. The suitability page is the one place
 * "stopping power" and "over-penetration" are allowed, and the stripped
 * research would remove exactly the facts this page exists to use.
 */
export function suitabilityResearch(research: string): string {
  const firearm = sectionOf(research, BLOCK_LABELS.firearm);
  const calibre = sectionOf(research, BLOCK_LABELS.calibre);
  const parts = [firearm, calibre].filter((x): x is string => Boolean(x?.trim()));
  if (parts.length) return parts.join('\n\n');
  // A stored block whose labels did not parse: hand it over whole, capped.
  return research.trim().slice(0, 12_000);
}

export function suitabilityHash(input: SuitabilityInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: SUITABILITY_VERSION,
        licenceType: input.licenceType,
        question: buildSuitabilityQuestion(input),
        facts: buildSuitabilityFacts(input),
        research: suitabilityResearch(input.research),
        exhibits: input.exhibits,
        arsenal: input.arsenal.map((r) => [r.make, r.model, r.calibre, r.section]),
      }),
    )
    .digest('hex');
}

export const SUITABILITY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    thesis: { type: 'string' },
    groups: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          bullets: {
            type: 'array',
            minItems: 2,
            maxItems: 8,
            items: { type: 'string' },
          },
        },
        required: ['heading', 'bullets'],
      },
    },
    wordCount: { type: 'number' },
  },
  required: ['question', 'thesis', 'groups', 'wordCount'],
};

const FORBIDDEN =
  /\b(velocity|muzzle energy|foot.?pound|bullet weight|grains?|chamber pressure|saami pressure|cip pressure|capacity|barrel length|chamber length|overall length|dimensions?|platform|tactical|battle.?proven|proven track record|state.?of.?the.?art|cutting.?edge|readily available|in stock|availability)\b/i;

function words(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * What makes the page unacceptable. A non-empty list is a failed draft, not a
 * warning: the caller retries once with these issues and then falls back.
 */
export function validateSuitability(
  arg: SuitabilityArgument,
  input: SuitabilityInput,
): string[] {
  const issues: string[] = [];
  const all = [arg.question, arg.thesis, ...arg.groups.flatMap((g) => g.bullets)]
    .join(' ')
    .trim();

  if (!arg.question.trim()) issues.push('the page has no question');
  const make = value(input.answers, 'firearm_make');
  const model = value(input.answers, 'firearm_model');
  const calibre = value(input.answers, 'firearm_calibre');
  for (const part of [make, model, calibre]) {
    if (part && !arg.question.toLowerCase().includes(part.toLowerCase())) {
      issues.push(`the question does not name "${part}"`);
    }
  }
  if (!/\b(i|my|me)\b/i.test(all)) {
    issues.push('the page is not written in the first person');
  }
  if (arg.groups.length < 3) issues.push('the page has fewer than three groups');
  const bullets = arg.groups.flatMap((g) => g.bullets);
  if (bullets.length < 10) issues.push('the page has fewer than ten bullets');
  if (bullets.length > 18) issues.push('the page has more than eighteen bullets');
  const total = words([arg.thesis, ...bullets].join(' '));
  if (total < 340) issues.push(`the page is ${total} words; it needs at least 340`);
  if (total > 460) issues.push(`the page is ${total} words; it must stay under 460`);
  if (FORBIDDEN.test(all)) {
    issues.push(
      'the page uses a specification or product phrase; velocity, energy, bullet weight, dimensions, capacity, availability and brochure copy are refused',
    );
  }

  const purpose = suitabilityPurpose(input.licenceType, input.answers);
  if (purpose === 'self-defence') {
    if (
      !/\b(stopping power|stop(ping)? (the|a) threat|incapacitat|stopping a threat)\b/i.test(
        all,
      )
    ) {
      issues.push('a self-defence page must argue stopping power');
    }
    if (
      !/\b(over.?penetrat|through the wall|shared wall|neighbour|beyond the target|collateral)/i.test(
        all,
      )
    ) {
      issues.push('a self-defence page must address over-penetration');
    }
  }
  if (purpose === 'hunting') {
    if (!/\b(stopping power|humane|clean kill|kill)\b/i.test(all)) {
      issues.push('a hunting page must argue stopping power / a humane kill');
    }
    if (!/\b(over.?penetrat|background|beyond the target|collateral)/i.test(all)) {
      issues.push('a hunting page must address background safety / over-penetration');
    }
  }

  return issues;
}

/** The page's own lines, in the order the PDF prints them. */
export function suitabilityPageLines(arg: SuitabilityArgument): string[] {
  const lines: string[] = [];
  if (arg.thesis.trim()) lines.push(arg.thesis.trim());
  for (const group of arg.groups) {
    const heading = group.heading.trim();
    if (heading) lines.push(`**${heading}**`);
    for (const bullet of group.bullets) {
      const text = bullet.trim();
      if (text) lines.push(`- ${text}`);
    }
  }
  return lines;
}

export function suitabilitySystemPrompt(): string {
  return [
    'You are a professional South African firearm-licence motivation writer.',
    'You are writing the 5.2 suitability page of a motivation that the applicant will sign and hand to the Registrar of Firearms and a Designated Firearms Officer.',
    'Your job is to answer one question: why is THIS firearm, chambered in THIS calibre, suited to THIS applicant, THIS purpose and THIS situation?',
    '',
    '⚠️ THE APPLICANT IS A REAL PERSON IN A REAL PLACE. Use the circumstances supplied. A townhouse shares walls; a flat has one door; a farm is remote; a hunting rifle is carried all day; a sport firearm is shot at a stated course of fire. Do not write generic brochure copy.',
    '',
    '⚠️ THE REASONS THAT MATTER ARE OPERATIONAL: stopping power at the ranges involved, over-penetration and what lies beyond the target, whether the firearm can be brought into use in the space, recoil and follow-up, practice, humane kill for hunting, and why the alternatives fall short. Velocity figures and specification sheets do not motivate; they describe an object.',
    '',
    '⚠️ YOU MAY ONLY USE THE SUPPLIED FACTS AND RESEARCH. Do not invent a model fact, a capacity, a reliability claim, a manufacturer history, an incident, a family member, a room layout or a number. If the research does not establish a model-specific fact, argue from the class and the calibre.',
    '',
    '⚠️ FIRST PERSON, SOUTH AFRICAN ENGLISH. No "the applicant". No product copy, no marketing adjectives, no "platform", "tactical", "battle-proven", "proven track record".',
  ].join('\n');
}

export function suitabilityUserPrompt(input: SuitabilityInput): string {
  const question = buildSuitabilityQuestion(input);
  const facts = buildSuitabilityFacts(input);
  const research = suitabilityResearch(input.research);
  const purpose = suitabilityPurpose(input.licenceType, input.answers);
  const situation = suitabilitySituation(input, purpose);
  return [
    `THE QUESTION THIS PAGE MUST ANSWER: ${question}`,
    '',
    'THE APPLICANT AND THE APPLICATION:',
    ...facts.map((f) => `- ${f}`),
    '',
    `THE PURPOSE: ${purpose}${situation ? ` — ${situation}` : ''}.`,
    '',
    'THE RESEARCH WE HOLD (raw material, never a script):',
    research || '(no research arrived; argue only from the facts above)',
    '',
    'WHAT TO ARGUE:',
    '- stopping power at the ranges this purpose involves;',
    '- over-penetration and what lies beyond the target (shared walls, neighbours, family, the background behind the animal);',
    '- whether the firearm can be brought into use in the space and carried the way the applicant says;',
    '- recoil, follow-up and practice; a humane kill for hunting; the course of fire for sport;',
    '- why the alternatives fall short: a long gun indoors, a calibre with too little stopping power, a calibre with too much over-penetration.',
    '',
    'WHAT TO REFUSE:',
    '- velocity, muzzle energy, foot-pounds, bullet weight, grains, pressure, chamber or overall dimensions, barrel length, magazine capacity;',
    '- manufacturer history, product copy, "platform", "tactical", "battle-proven", "proven track record";',
    '- ammunition availability or price claims.',
    'No figure at all unless a supplied fact makes it necessary to the suitability point; prefer qualitative reasons.',
    '',
    'OUTPUT:',
    '- a one-sentence thesis, then 12-16 bullets of 20-30 words each, ~400 words total;',
    '- four groups, in this order: "The firearm", "The calibre", "The situation" (use the actual place or discipline, e.g. "The townhouse and my routine"), "Why the alternatives fall short";',
    '- every bullet is a fact or a reason, in my voice, about THIS firearm, THIS calibre, THIS place and THIS use;',
    '- no markdown other than the group headings and the bullet marker.',
  ].join('\n');
}
