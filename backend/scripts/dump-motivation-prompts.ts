/* eslint-disable no-console */
import { writeFileSync } from 'node:fs';
import { MotivationLicenceType } from '@prisma/client';
import {
  gateSystemPrompt,
  gateUserPrompt,
  generationSystemPrompt,
  generationUserPrompt,
  type FactPack,
} from '../src/motivations/motivation-prompts';
import { planFor } from '../src/motivations/motivation-structure';
import { reasonSystemPrompt } from '../src/motivations/motivation-reason';

// ────────────────────────────────────────────────────────────────────
// PRINT WHAT WE ACTUALLY SEND TO THE MODEL.
//
// Operator, 2026-09-09: "give me the exact prompts the server gives to gemini
// in a text file for the motivation creation."
//
// ⚠️ IT CALLS THE REAL BUILDERS RATHER THAN DESCRIBING THEM. Every string
// below is produced by the same functions motivation-model.service.ts passes
// to LlmService — so this file cannot drift from what is sent without the
// build failing, and nothing here is my transcription of the prompt.
//
// The FACT PACK is a worked example, not a real applicant: the user prompt is
// a template around applicant data, and printing a member's own answers into a
// file that gets read and shared is not something to do casually. Where a
// value is the example's rather than the prompt's, it is obvious from context.
//
//   npx ts-node --compilerOptions '{"module":"commonjs"}' \
//     scripts/dump-motivation-prompts.ts > /dev/null
// ────────────────────────────────────────────────────────────────────

const TYPE = (process.argv[2] as MotivationLicenceType) ??
  MotivationLicenceType.S13_SELF_DEFENCE;

/**
 * A worked example, in the shape a real pack has.
 *
 * ⚠️ THE APPLICANT VALUES ARE INVENTED. What matters here is the PROMPT — the
 * instructions, the structure plan, the annexure and research blocks and the
 * rules. Printing a live member's answers into a file that gets read and
 * passed around is not something to do to make an example look real.
 */
const pack: FactPack = {
  licenceType: TYPE,
  answers: {
    full_name: 'A B EXAMPLE',
    id_number: '0000000000000',
    residential_address: '1 Example Street, Example, Cape Town',
    occupation: 'electrician',
    home_type: 'House',
    firearm_make: 'EXAMPLE',
    firearm_type: 'Handgun',
    firearm_action: 'Semi-automatic (self-loading)',
    firearm_calibre: '9MM PAR ( 9X19MM )',
    firearm_serial: 'EX000000',
    s13_reasons: 'precinct_crime, night_travel, dependants',
    safe_present: 'Yes',
  },
  derived: {
    age: '37',
    'firearms already held': '5',
  },
  overlapNote:
    'The applicant already holds a handgun. Meet that head on: say what this one does that the one held does not.',
  research:
    '<THE RESEARCH BLOCK GOES HERE — precinct crime figures, the firearm’s role, the calibre. See motivation-research.service.ts.>',
  annexures: [
    { letter: 'A', label: 'Copy of your ID' },
    { letter: 'B', label: 'Proficiency / training certificate' },
    { letter: 'C', label: 'SAPS competency certificate or printout' },
    { letter: 'D', label: 'Proof of residential address' },
    { letter: 'E', label: 'Photographs of your safe' },
  ],
};

// The same builder the service uses; the seed only picks between heading
// alternates, so any fixed value gives a representative plan.
const plan = planFor(TYPE, 1);

const rule = (t: string) =>
  `\n\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}\n\n`;

const out: string[] = [
  'THE PROMPTS THE SERVER SENDS TO GEMINI',
  '',
  `Licence type: ${TYPE}`,
  `Generated:    ${new Date().toISOString()}`,
  '',
  'Every string below is produced by the same functions',
  'motivation-model.service.ts hands to LlmService. Nothing here is a',
  'paraphrase. Applicant values are a worked example, not a real member.',
  '',
  'Four model calls touch a motivation, in this order:',
  '',
  '  motivation.reason    — earlier, on the review sheet: writes the',
  '                         "why this firearm" paragraph. Printed below.',
  '  motivation.generate  — writes the document. Printed below.',
  '  motivation.verify    — reads it back for invented facts. NOT printed:',
  '                         its prompt is built inline in',
  '                         motivation-model.service.ts (search for "the final',
  '                         check on a firearm licence motivation"), and this',
  '                         file only prints prompts it can CALL, so that it',
  '                         can never drift from what is sent.',
  '  motivation.gate      — scores it and can send it round again. Printed',
  '                         below.',
  '',
  'Run it for another licence type: pass the type as the first argument,',
  'e.g. S16_DEDICATED_SPORT — see scripts/dump-motivation-prompts.ts.',
];

out.push(rule('1. motivation.generate — SYSTEM'));
out.push(generationSystemPrompt(TYPE));

out.push(rule('1. motivation.generate — USER'));
out.push(generationUserPrompt(pack, plan));

out.push(rule('3. motivation.gate — SYSTEM'));
out.push(gateSystemPrompt());

out.push(rule('3. motivation.gate — USER'));
out.push(gateUserPrompt(pack, '<THE DRAFTED DOCUMENT GOES HERE>'));

out.push(rule('4. motivation.reason — SYSTEM (runs on the review sheet)'));
out.push(reasonSystemPrompt(TYPE));

const path = process.argv[3] ?? 'motivation-prompts.txt';
writeFileSync(path, out.join('\n'), 'utf8');
console.error(`wrote ${path}`);
