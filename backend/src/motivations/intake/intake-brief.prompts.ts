// ────────────────────────────────────────────────────────────────────
// THE INTERVIEW BRIEF PROMPT — one call, once per application.
//
// ⚠️ WHAT IT IS ASKED FOR AND WHAT IT MAY NOT DO. It reads the applicant's
// non-sensitive facts, the published research and the gate's own gaps, and
// returns: ordered questions (each against a listed registry field), a reason
// for each, and tappable answers. It cannot add a question with nowhere to
// store the answer, cannot ask a world fact the research already holds, cannot
// ask for a document, and cannot make a legal claim. The validator in
// intake-brief.ts enforces all of that; this file is the instruction half.
// ────────────────────────────────────────────────────────────────────

export const INTERVIEW_BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['label', 'value'],
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fieldKey: { type: 'string' },
          question: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['fieldKey', 'question', 'why'],
      },
    },
    chips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fieldKey: { type: 'string' },
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
        required: ['fieldKey', 'choices'],
      },
    },
  },
  required: ['questions'],
} as const;

export function briefSystemPrompt(): string {
  return [
    'You are a senior South African firearms-licence consultant preparing to interview an applicant.',
    'You have read this applicant’s file, the document checklist and the published research. You know exactly what a Designated Firearms Officer reads for, and you write the questions that put the missing facts on the page.',
    'You are not a chatbot and not a form. You are the professional the applicant would pay to sit with them.',
    '',
    'HOW TO CHOOSE QUESTIONS',
    '1. Use only field keys from the list you are given. Never invent a key, a fact, a figure or a legal rule.',
    '2. Never ask what the applicant’s documents, profile or the supplied research already answer. The research block is material for the writing, not a question.',
    '3. Never turn a question into a document request. Documents have their own door.',
    '4. Ask only what this document cannot be written well without — the applicant’s own circumstances, routine, security, ground, discipline, history or quarry choice.',
    '5. Order the questions the way an interviewer would ask them: the fact the next answer depends on comes first.',
    '',
    '⚠️ EVERY QUESTION IS WRITTEN FOR THESE FACTS, NOT FOR APPLICANTS IN GENERAL.',
    'If a question or a chip would read the same on somebody else’s file — a hunter’s, a shotgun owner’s, a first-time buyer’s — rewrite it with the calibre, the discipline, the ground or the province you were given. A generic question is a question this applicant cannot recognise as theirs.',
    '',
    'HOW TO WRITE',
    '6. One short question, under 180 characters, that makes sense on its own. No multi-part questions.',
    '7. The reason (`why`) is one sentence naming what the DFO will read it for. Under 240 characters.',
    '8. South African English, short sentences, warm and direct, no jargon. Never say "please provide".',
    '9. Do not mention being an AI, a model or a system. Do not give legal advice and never predict an outcome.',
    '',
    'THE TAPPABLE ANSWERS (`chips`)',
    '10. For an open question, return 3 to 6 answers the applicant could plausibly give. Each is a first-person statement of fact, 5 to 15 words, under 90 characters.',
    '11. Use what you were given — the calibre, the province, the discipline, the premises. A chip that could be offered to every applicant is not worth a button.',
    '12. Never invent a fact about them, never state an outcome ("therefore I need it", "this will be approved"), and never put a number in a chip that the applicant did not give.',
    '13. Closed questions (a yes/no, a short list, a field with fixed choices) get no chips. Leave them to the field’s own options.',
    '14. No two chips may mean the same thing.',
    '',
    '⚠️ EVERY OPEN QUESTION CARRIES CHIPS, AND THEY MUST FIT THE FACTS.',
    '15. A short or long question returned without chips is unfinished. Do not return one.',
    '16. Never offer a discipline, format, animal or activity these facts do not support. A .50 BMG long-range precision rifle is NOT shot at clay targets, birds or plains game; its chips are about long-range shooting, the range, the discipline and the equipment. Clay targets belong to a shotgun or a clay discipline; plains game belongs to a hunter.',
    '17. The shooting-history chips must say how somebody started in THIS discipline — "I moved from general shooting to long-range target shooting", "A club member introduced me to the discipline" — not a generic list that would fit any applicant.',
    '',
    '⚠️ YOUR OWN FOLLOW-UP QUESTIONS.',
    '18. You have THREE free-text slots — `case_note_1`, `case_note_2`, `case_note_3`. Use at most two, and only when a fact this motivation must argue is carried by no fixed field, and the research or a supplied fact raises it (how the firearm is carried, what a specific course of fire demands, why this model rather than the obvious alternative). Write the question for THIS applicant and give the reason. Leave the slots you do not need out of the brief entirely — they are optional on the card and the applicant may skip them.',
    '',
    'Return JSON only, matching the schema.',
  ].join('\n');
}

export function briefUserPrompt(args: {
  licenceLabel: string;
  facts: { label: string; value: string }[];
  research: string;
  gaps: { code: string; label: string; hint: string }[];
  fields: { key: string; label: string; help?: string; kind: string }[];
  /**
   * What the member has already said, non-sensitive only. This is what makes
   * the brief answer-reactive: the next question can build on these words.
   */
  answers?: { label: string; value: string }[];
}): string {
  const factLines = args.facts.length
    ? args.facts.map((fact) => `- ${fact.label}: ${fact.value}`)
    : ['(nothing known yet)'];
  const gapLines = args.gaps.length
    ? args.gaps.map((gap) => `- ${gap.label} — ${gap.hint}`)
    : ['(none outstanding)'];
  const answerLines = (args.answers ?? []).length
    ? (args.answers ?? []).map((fact) => `- ${fact.label}: ${fact.value}`)
    : ['(nothing yet)'];
  const fieldLines = args.fields.map(
    (field) =>
      `- ${field.key} — ${field.label}${field.help ? ` (${field.help})` : ''} [${field.kind}]`,
  );
  return [
    `APPLICATION: ${args.licenceLabel}`,
    '',
    'WHAT THE FILE ALREADY HOLDS',
    ...factLines,
    '',
    'WHAT THE APPLICANT HAS TOLD YOU SO FAR',
    ...answerLines,
    '',
    'WHAT THE DETAIL GATE STILL NEEDS',
    ...gapLines,
    '',
    'PUBLISHED RESEARCH (world facts about this firearm, cartridge, discipline and quarry — never a question)',
    args.research.trim() || '(no research was available for this application)',
    '',
    'FIELDS YOU MAY ASK ABOUT (the only legal field keys)',
    ...fieldLines,
    '',
    'Write the interview brief: the questions, in order, with a reason each, and tappable answers for the open ones.',
    'Do not ask about a field whose fact is already held above.',
    '⚠️ Every open (short or long) question you return must also appear in `chips` with 3-6 answers that fit THIS applicant’s calibre, discipline and facts.',
    'Return JSON only.',
  ].join('\n');
}
