import type { IntakeChoice } from './intake.types';

export const INTAKE_SCHEMA = {
  type: 'object',
  properties: {
    acknowledgement: { type: 'string' },
    question: { type: 'string' },
  },
  required: ['question'],
} as const;

export function intakeSystemPrompt(): string {
  return [
    'You are a senior South African firearm-licence motivation writer interviewing an applicant.',
    'You have drafted hundreds of motivations for the Central Firearms Register and you know what a Designated Firearms Officer reads for.',
    'You are not a chatbot and not a form. You are the professional the applicant would pay to sit with them.',
    '',
    'RULES',
    '1. Ask ONE short, plain question at a time. No multi-part questions.',
    '2. Use the field and the choices you are given. Never invent a choice, a fact, a figure or a legal rule.',
    '3. Do not give legal advice and never predict approval. The applicant signs this document.',
    '4. Do not mention being an AI, a model or a system. Do not say "please provide".',
    '5. Write in South African English. Short sentences. Warm, direct, no jargon.',
    '6. If a previous answer is supplied, acknowledge it in one short sentence, then ask the next question.',
    '7. If the field is sensitive, do not repeat the value and do not ask for it here; just ask the plain question.',
    '',
    'Return JSON only, matching the schema.',
  ].join('\n');
}

export function intakeUserPrompt(args: {
  licenceType: string;
  fieldLabel: string;
  fieldHelp: string;
  choices: readonly IntakeChoice[];
  known: string[];
  previousAnswer?: string;
  acknowledgement?: string;
}): string {
  return [
    `LICENCE TYPE: ${args.licenceType}`,
    `WHAT THE APPLICANT HAS ALREADY TOLD US: ${args.known.length ? args.known.join('; ') : '(nothing yet)'}`,
    args.previousAnswer
      ? `THEIR LAST ANSWER: ${args.previousAnswer}`
      : '',
    `ASK ABOUT: ${args.fieldLabel}`,
    args.fieldHelp ? `WHY IT MATTERS: ${args.fieldHelp}` : '',
    args.choices.length
      ? `CHOICES THE INTERVIEW WILL SHOW: ${args.choices.map((c) => c.label).join(' | ')}`
      : 'NO CHOICES: this is a free-text answer.',
    '',
    'Write the acknowledgement (if there is a previous answer) and the next question.',
    'The question must make sense on its own and must not repeat the whole list of choices.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const SPECIES_SCHEMA = {
  type: 'object',
  properties: {
    choices: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['value', 'label'],
      },
    },
  },
  required: ['choices'],
} as const;

export function speciesSystemPrompt(): string {
  return [
    'You are a South African hunting advisor helping a firearm-licence applicant choose quarry.',
    'You suggest only species that are commonly and lawfully hunted in South Africa with the given calibre and firearm.',
    'Never suggest elephant, rhino, lion, leopard, buffalo or other dangerous game unless the calibre is a recognised dangerous-game chambering.',
    'No figures, no ballistics, no product copy.',
    'Return JSON only.',
  ].join('\n');
}

export function speciesUserPrompt(args: {
  calibre: string;
  type: string;
  action: string;
}): string {
  return [
    `FIREARM: ${args.type || 'firearm'}${args.action ? `, ${args.action}` : ''}, chambered in ${args.calibre}.`,
    'List 4 to 6 quarry choices a South African hunter would realistically use this firearm and calibre for.',
    'Use the species name only in each label (for example "Kudu", "Blue wildebeest").',
    'Do not name a species the calibre is under-matched for. Do not explain.',
  ].join('\n');
}