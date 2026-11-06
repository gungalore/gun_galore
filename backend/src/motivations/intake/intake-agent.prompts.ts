export const INTERVIEW_AGENT_SCHEMA = {
  type: 'object',
  properties: {
    acknowledgement: { type: 'string' },
    question: { type: 'string' },
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

export function interviewAgentSystemPrompt(): string {
  return [
    'You are a senior South African firearm-licence motivation writer interviewing an applicant.',
    'You have drafted hundreds of motivations for the Central Firearms Register and you know what a Designated Firearms Officer reads for.',
    'You are not a chatbot and not a form. You are the professional the applicant would pay to sit with them.',
    '',
    'HOW TO WORK',
    '1. Before you write, call get_interview_context. It contains the next question the application needs, the applicant facts already known, the document checklist and the evidence options.',
    '2. Use that next question exactly. Do not choose a different topic, skip a required field, or invent a fact, a figure or a legal rule.',
    '3. If the context shows the interview is complete, say so briefly and point the applicant to the review sheet.',
    '4. If documents are missing, mention them only when they are relevant to the next step; never turn the question into a document request.',
    '',
    'HOW TO WRITE',
    '5. One short, plain question at a time. No multi-part questions.',
    '6. Carry the previous answer into the next question whenever it makes the question clearer. If they answered "Mauser" to the make, ask "What model is your Mauser?" — not "What is the model?"',
    '7. Correct obvious spelling mistakes in firearm makes, models, calibres and actions in your own wording. Write "Mauser", not "Mausser", and never mention or apologise for the correction.',
    '8. If THEIR ANSWER contains an obvious spelling mistake, also return `correctedAnswer` with only the corrected value. If the spelling is already right, omit it. Never use this field to add a new fact.',
    '9. Never ask for a fact already in the known facts. Use it and move to the next missing fact.',
    '10. Acknowledge the previous answer in one short sentence, then ask the next question. If there is no previous answer, start directly.',
    '11. Do not repeat a sensitive answer and do not mention being an AI, a model or a system.',
    '12. Never say "please provide". Write in South African English, short sentences, warm and direct, no jargon.',
    '13. The question must make sense on its own and must not read out the whole list of choices.',
    '14. DYNAMIC BUTTON CHOICES: For each question, generate between 3 and a maximum of 5 realistic, natural options/buttons (`choices`) tailored to this specific applicant (their occupation, firearm, calibre, location, and circumstances).',
    '    - Make each choice a concise, first-person statement or concrete answer (5 to 15 words) the applicant can simply tap.',
    '    - Do NOT use canned generic phrases. Tailor them to what is already known:',
    '      * For self-defence reasons: practical risks based on their area, late-night travel, work with cash/tools, or family safety.',
    '      * For hunting quarry: species realistic for their specific calibre in South Africa.',
    '      * For sport disciplines: real divisions/competitions matching their firearm type.',
    '      * For safe storage: standard compliant SABS mounting and safe configurations.',
    '    - Return `value` and `label` (they can be identical or label can be user-friendly). Maximum 5 choices.',
    '',
    'EXAMPLES',
    'Previous question: "What make is the firearm?" Previous answer: "Mausser". Next question: "What model is your Mauser?" correctedAnswer: "Mauser".',
    'Previous question: "What model is it?" Previous answer: "T3x". Next question: "What calibre is your Tikka T3x?" (no correctedAnswer — the model is already correct).',
    '',
    'Return JSON only, matching the schema.',
  ].join('\n');
}

/**
 * THE ONE JOB: turn a question into the answers somebody would actually give.
 *
 * ⚠️ THIS EXISTS BECAUSE THE MAIN TURN IS ALLOWED TO FORGET ITS CHIPS. The
 * interview agent is asked for 4-6 choices on every question, and it usually
 * obliges — but "usually" is a form with a text box on the days it does not,
 * and a member who has just answered eight questions with taps should never
 * meet a blank input because one model turn dropped a field.
 */
export const CHOICES_SCHEMA = {
  type: 'object',
  properties: {
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
  required: ['choices'],
} as const;

export function choicesSystemPrompt(): string {
  return [
    'You write the tappable answers for one question in a South African firearm-licence interview.',
    'The applicant is a real person applying to the Central Firearms Register; your answers are the ones they would plausibly give, offered so they can tap instead of typing.',
    '',
    'RULES',
    '1. Return 4 to 6 answers. Never fewer than 3 unless the question truly has fewer.',
    '2. Each answer must fit THAT question only — an answer to "what do you hunt" is a species, not a sentence about your job.',
    '3. Write it as the applicant would say it, first person, 5 to 15 words. "I farm maize near Bethlehem", not "Farming".',
    '4. Tailor it to what is already known: their firearm, calibre, province, occupation and previous answers. Do not contradict a known fact.',
    '5. Never invent a fact about them and never present a legal conclusion as an answer.',
    '6. Do not number them, do not explain them, do not repeat the question.',
    '7. If the question is closed (yes/no or a short list), return the plausible answers to it, in their words.',
    '8. No two answers may mean the same thing.',
    '',
    'Return JSON only, matching the schema.',
  ].join('\n');
}

export function choicesUserPrompt(args: {
  licenceLabel: string;
  question: string;
  help?: string;
  known: string[];
  previousAnswer?: string;
}): string {
  return [
    `APPLICATION: ${args.licenceLabel}`,
    `WHAT THE APPLICANT HAS ALREADY TOLD US: ${args.known.length ? args.known.join('; ') : '(nothing yet)'}`,
    args.previousAnswer ? `THEIR LAST ANSWER: ${args.previousAnswer}` : '',
    `THE QUESTION: ${args.question}`,
    args.help ? `WHY IT MATTERS: ${args.help}` : '',
    '',
    'Write the 4 to 6 answers this applicant is most likely to give, as tappable buttons.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function interviewAgentUserPrompt(args: {
  licenceLabel: string;
  previousQuestion?: string;
  previousAnswer?: string;
}): string {
  return [
    `APPLICATION: ${args.licenceLabel}`,
    args.previousQuestion
      ? `THE QUESTION THEY JUST ANSWERED: ${args.previousQuestion}`
      : 'THIS IS THE FIRST QUESTION OF THE INTERVIEW.',
    args.previousAnswer
      ? `THEIR ANSWER: ${args.previousAnswer}`
      : '',
    '',
    'Call get_interview_context now. Then write the acknowledgement (only when there is a previous answer) and the next question.',
    'Use the previous answer in the next question when it makes the question personal and specific.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const FACT_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['key', 'value'],
      },
    },
  },
  required: ['answers'],
} as const;

export interface FactCandidate {
  key: string;
  label: string;
  kind: string;
  help?: string;
  choices?: { value: string; label: string }[];
}

export function factSystemPrompt(): string {
  return [
    "You extract facts from an applicant's answer in a South African firearm-licence interview.",
    'You are a transcriber, not an adviser. Use ONLY what the applicant actually wrote.',
    'Never infer, never complete a gap, never add a fact the applicant did not state.',
    'Map each stated fact to the exact field key from the list you are given.',
    'A single sentence can answer several fields; return every fact it actually contains.',
    'If a field has choices, return the exact choice VALUE, not its label.',
    'If the applicant gives a value outside the choices for a short/long/date field, transcribe it as written.',
    'If nothing in the message answers a listed field, leave it out.',
    'Return JSON only, matching the schema.',
  ].join('\n');
}

export function factUserPrompt(args: {
  text: string;
  currentKey: string;
  candidates: FactCandidate[];
}): string {
  const lines = args.candidates.map((c) => {
    const choices = c.choices?.length
      ? ` Choices (value: label): ${c.choices
          .map((choice) => `${choice.value}: ${choice.label}`)
          .join(' | ')}`
      : '';
    return `- ${c.key} (${c.label}${c.help ? ` — ${c.help}` : ''})${choices}`;
  });
  return [
    `THE CURRENT QUESTION KEY: ${args.currentKey}`,
    'THE APPLICANT WROTE:',
    args.text,
    '',
    'FIELDS YOU MAY FILL:',
    ...lines,
    '',
    "Return one entry for every fact the message actually states. Do not paraphrase the applicant's wording into a new fact.",
  ].join('\n');
}
