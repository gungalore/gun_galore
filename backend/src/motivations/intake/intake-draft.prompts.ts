// ────────────────────────────────────────────────────────────────────
// THE DRAFTING PROMPT — the one place a narrative may be composed.
//
// ⚠️ THIS IS NOT THE WRITER. The writer turns a fact pack into the finished
// document and has never been allowed to invent a fact. This call is earlier:
// it composes the four or five NARRATIVE ANSWERS an applicant cannot reasonably
// be asked to write (shooting history, the threat circumstances, the hunting
// record, the renewal's continued use), from the facts they have already given,
// for THEM to read, edit and approve. Every draft is stamped DRAFTED + inferred
// and renders as "Drafted for you — check it" on the review sheet.
//
// ⚠️ SO THE BAN LIST IS THE POINT OF THE PROMPT. A believable paragraph is
// allowed; a checkable one is not. No dates, years, counts, distances, serials,
// farm or club names, match results, credentials or names of people — every one
// of those is something a DFO can check against a document, and a wrong one on
// a signed application is the failure mode this whole file exists to prevent.
//
// The rules are also enforced deterministically in intake-draft.ts; the prompt
// is asked, the validator is what decides.
// ────────────────────────────────────────────────────────────────────

import type { DraftFacts, DraftedTarget } from './intake-draft';

/** What the model must return: one draft per target key. */
export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          text: { type: 'string' },
          choices: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['key'],
      },
    },
  },
  required: ['drafts'],
} as const;

export function draftSystemPrompt(): string {
  return [
    'You draft narrative answers for a South African firearm-licence motivation.',
    'The applicant reviews and approves every sentence before it reaches the pack, so write it in their voice and make it easy for them to correct.',
    '',
    'WHO IS SPEAKING',
    'You write in the FIRST PERSON, as the applicant. The applicant is "I", never "you".',
    'You are not their adviser. You are drafting the personal-history paragraphs an applicant cannot reasonably be asked to compose unaided.',
    '',
    'WHAT "DRAFT" MEANS HERE',
    'The applicant has NOT written this paragraph and is not going to. Compose a believable, calm, first-person account from what the file shows.',
    'General statements that are not checkable facts are allowed and expected: "I was introduced to shooting through people already involved", "I practise whenever my work and family allow", "I keep my skills current".',
    'Checkable specifics are never allowed: a date, a year, a count, a distance, a place name, a club or farm name, a person\'s name, a match result, a credential, an incident number.',
    'Prefer a general, true-sounding sentence to a padded one. The paragraph must read like the applicant\'s own plain account — not an AI summary and not a marketing paragraph.',
    'This text is stored as a SUGGESTED answer, rendered as "Drafted for you — check it", and confirmed or edited by the applicant.',
    '',
    'ALLOWED vs FORBIDDEN — the shape of the difference',
    'ALLOWED: "I was introduced to shooting through people already involved, and I have practised under their guidance since."',
    'FORBIDDEN: "My father took me to the range at the age of ten." — invents a person, an age and a year.',
    'ALLOWED: "I keep my skills current and take part in the shooting my association offers where my firearm suits it."',
    'FORBIDDEN: "I placed second at the provincial championships in Bloemfontein." — invents a result, a place and a credential.',
    'ALLOWED: "I have hunted within the seasons and the rules that apply to me."',
    'FORBIDDEN: "I hunt kudu every June on a farm near Thabazimbi." — invents a species count, a month and places.',
    '',
    'WHAT YOU MAY USE',
    '1. The FACTS and TARGETS supplied below, and nothing else.',
    '2. Only the applicant\'s own facts: their firearm, their purpose, their association, their premises, their existing narrative answers.',
    '3. Do not fill a gap with a checkable specific. Write a general sentence instead — the applicant will correct it if it is not quite their story.',
    '',
    'WHAT YOU MUST NEVER WRITE',
    '4. No digits at all — no dates, years, ages, counts, distances, scores or percentages.',
    '5. No measurement of any kind, and no "approximately", "about", "around" or "roughly" before a number.',
    '6. No incident, case, reference, serial or licence numbers.',
    '7. No farm, club, range, town, suburb, employer or association name, and no person\'s name, unless it is written in the FACTS.',
    '8. No match results, scores, qualifications, unit standards or credentials.',
    '9. No promises or predictions: never "guaranteed", "will be approved", "will succeed".',
    '10. No record claims: never "no criminal record", "clean record" or "no previous convictions".',
    '11. No product copy or ballistics: never "stopping power", "terminal ballistics", "platform" or "high capacity".',
    '12. Never mention being an AI, a model, a system or an assistant.',
    '13. No second person anywhere: every sentence is "I", "my", "me".',
    '14. No proper noun that is not in the FACTS and is not simply the first word of a sentence.',
    '',
    'HOW TO WRITE',
    '15. Plain South African English — licence (noun), calibre, centre-fire, self-defence, organisation.',
    '16. A long target is one paragraph of 60 to 190 words; continued_use is 40 to 190 words.',
    '17. Make the paragraph specific to THIS firearm and THIS purpose, using only the supplied facts. It must read as one person\'s own account, not as a template.',
    '18. Stay calm and factual. No drama, no excuses, no praise for the applicant.',
    '19. A cards target returns `choices`: one to four option keys taken EXACTLY from that target\'s own option list. Never invent an option key. A long target returns `text` and no choices. A short target returns ONE plain sentence in `text`, within the stated character limit, and no choices — for the comparison target, name what else was considered and why this firearm won, using the battery in FACTS and the firearm applied for.',
    '20. Return exactly one draft per target key, and no keys that were not asked for.',
    '',
    'Return JSON only, matching the schema.',
  ].join('\n');
}

/**
 * The user turn: the facts, the targets, and — on the retry — what the
 * validator refused. The rejections are written for a person and are therefore
 * already the right feedback; see validateDraft.
 */
export function draftUserPrompt(args: {
  licenceLabel: string;
  facts: DraftFacts;
  targets: readonly DraftedTarget[];
  rejections?: readonly string[];
}): string {
  const lines = [
    `APPLICATION: ${args.licenceLabel}`,
    '',
    'FACTS — the only material you may use:',
    JSON.stringify(args.facts, null, 2),
    '',
    'TARGETS — draft exactly these keys:',
    ...args.targets.map((target) => {
      const words =
        target.key === 'continued_use' ? '40 to 190 words' : '60 to 190 words';
      const parts = [`- ${target.key} (${target.kind}): ${target.label}`];
      if (target.kind === 'long') parts.push(`  Length: ${words}.`);
      if (target.kind === 'short') {
        parts.push('  One plain first-person sentence in `text`; no choices.');
      }
      if (target.options?.length) {
        parts.push(
          `  Option keys (choices must be taken from these): ${target.options
            .map((option) => option.key)
            .join(' | ')}`,
        );
      }
      if (target.maxLength) parts.push(`  Maximum ${target.maxLength} characters.`);
      return parts.join('\n');
    }),
  ];
  if (args.rejections?.length) {
    lines.push(
      '',
      'Your previous answer was rejected for these reasons.',
      'Fix every one of them and return the whole JSON again:',
      ...args.rejections.map((rejection) => `- ${rejection}`),
    );
  }
  lines.push(
    '',
    'Return JSON only: { "drafts": [ { "key": "...", "text": "...", "choices": ["..."] } ] }',
  );
  return lines.filter((line) => line !== undefined).join('\n');
}
