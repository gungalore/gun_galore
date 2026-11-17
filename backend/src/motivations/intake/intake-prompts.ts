import type { IntakeChoice } from './intake.types';

export const INTAKE_SCHEMA = {
  type: 'object',
  properties: {
    acknowledgement: { type: 'string' },
    question: { type: 'string' },
    /**
     * ⚠️ THE SPELLING CORRECTION BELONGS TO THE FAST PATH TOO. It used to come
     * from the tool-using agent's reply; when that turn became opt-in the
     * interview stopped correcting, and a stored `mosberg` / `12 gayge` was
     * then refused by validators that compare against the corrected prose.
     */
    correctedAnswer: { type: 'string' },
    choices: {
      type: 'array',
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
    '8. ALWAYS return 4 to 6 `choices` — the answers this applicant would plausibly give. They are rendered as buttons, so the member can tap instead of typing. One short first-person answer each, tailored to what is already known, no two meaning the same thing. Never invent a fact.',
    '9. If THEIR LAST ANSWER misspells a firearm make, model, calibre or action, also return `correctedAnswer` with only the corrected value ("mosberg" → "Mossberg", "12 gayge" → "12 Gauge"). Never use `correctedAnswer` to add, change or complete a fact — it is a spelling fix for what they wrote, nothing more. Omit it when the spelling is already right or when the answer is not about a firearm.',
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
      : 'NO PRESET CHOICES: a free-text answer, so propose 4 to 6 likely ones.',
    '',
    'Write the acknowledgement (if there is a previous answer) and the next question.',
    'The question must make sense on its own and must not repeat the whole list of choices.',
    'Return the 4 to 6 tappable answers in `choices`.',
    args.previousAnswer
      ? 'If that last answer misspells a make, model, calibre or action, return the spelling fixed in `correctedAnswer` — the value only, no explanation, and never a new fact.'
      : '',
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

// ────────────────────────────────────────────────────────────────────
// THE CARD TURN — one model call for every open question on a card.
//
// ⚠️ ONE CALL PER CARD, NOT ONE PER QUESTION. The grouped interview used to
// phrase each open field separately (up to four in flight), which is where the
// perceived delay between answers came from. The brief already phrases most
// fields; this call is for the ones it could not, and it returns them in one
// go so a card costs one round-trip at most.
//
// ⚠️ IT MAY ONLY WORD, NOT ASK. Every `fieldKey` comes from the server's plan;
// the model is told to word each question and nothing else. A reply that
// invents a key is dropped by the parser.
// ────────────────────────────────────────────────────────────────────

export const INTAKE_CARD_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fieldKey: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['fieldKey', 'question'],
      },
    },
    /**
     * ⚠️ THE SPELLING FIX TRAVELS WITH THE CARD TURN. The one-shot reply
     * carries it, and a card turn without it would stop correcting "mosberg"
     * the moment the grouped path became the only path.
     */
    correctedAnswer: { type: 'string' },
  },
  required: ['questions'],
} as const;

export function intakeCardSystemPrompt(): string {
  return [
    'You are a senior South African firearms-licence consultant, sitting with an applicant and working through their motivation.',
    'You have read their file, their documents and the published research. You are not a chatbot and not a form — you are the professional they would pay to sit with them.',
    '',
    'RULES',
    '1. Word each question you are given as ONE short, plain question. Use the reason to decide what the question must make clear.',
    '2. Never change the subject, add a question, skip one, or invent a fact, a figure or a legal rule.',
    '3. Carry the applicant’s own facts into the wording where it makes the question clearer: "What model is your Mauser?" rather than "What is the model?".',
    '4. Do not read out the answer list, do not give legal advice, never predict approval, and do not mention being an AI, a model or a system.',
    '5. South African English, short sentences, warm and direct. Never say "please provide".',
    '6. The question must make sense on its own and stay under 180 characters.',
    '7. If the previous answer misspells a firearm make, model, calibre or action, return `correctedAnswer` with the corrected value only — never a new fact.',
    '',
    'Return JSON only, matching the schema.',
  ].join('\n');
}

export function intakeCardUserPrompt(args: {
  licenceLabel: string;
  known: string[];
  previousAnswer?: string;
  previousField?: string;
  questions: { fieldKey: string; label: string; why?: string; help?: string }[];
}): string {
  const lines = args.questions.map(
    (question) =>
      `- ${question.fieldKey}: ${question.label}` +
      (question.why ? `\n    reason: ${question.why}` : '') +
      (question.help ? `\n    help: ${question.help}` : ''),
  );
  return [
    `APPLICATION: ${args.licenceLabel}`,
    `WHAT THE APPLICANT HAS ALREADY TOLD US: ${
      args.known.length ? args.known.join('; ') : '(nothing yet)'
    }`,
    args.previousAnswer
      ? `THEIR LAST ANSWER (${args.previousField ?? 'previous question'}): ${args.previousAnswer}`
      : '',
    '',
    'QUESTIONS TO WORD (return one entry per fieldKey, same keys):',
    ...lines,
    '',
    'Word each one as the interviewer would ask it. Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}
