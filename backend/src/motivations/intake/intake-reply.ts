/**
 * PARSING THE ONE-SHOT INTERVIEW REPLY, AND WHO MAY CORRECT A SPELLING.
 *
 * ⚠️ THE CORRECTION USED TO LIVE IN THE AGENT TURN ONLY. The tool-using agent
 * returned `correctedAnswer` alongside its question; when it became opt-in for
 * latency, the one-shot path kept answering but stopped correcting, so
 * MO000063 stored `mosberg`/`12 gayge`, the writer correctly wrote "Mossberg"
 * and "12 Gauge", and BOTH validators refused the corrected text because they
 * compared against the raw misspelling.
 *
 * Keeping the parse here rather than inline in the service is what makes the
 * behaviour testable: the whitelist, the reply shape and the gate are pure.
 */

/**
 * Only these fields may be rewritten.
 *
 * ⚠️ A MODEL SUGGESTION MUST NEVER CHANGE AN ADDRESS, AN ID NUMBER OR A
 * DECLARATION ANSWER. A make spelled three ways is a typo; an identity number
 * "corrected" by a language model is a false statement on a signed document.
 */
export const CORRECTABLE_FIELDS: ReadonlySet<string> = new Set([
  'firearm_type',
  'firearm_action',
  'firearm_make',
  'firearm_model',
  'firearm_calibre',
]);

export function isCorrectableField(
  fieldKey: string | null | undefined,
): boolean {
  return typeof fieldKey === 'string' && CORRECTABLE_FIELDS.has(fieldKey);
}

export interface ParsedIntakeReply {
  question: string;
  acknowledgement?: string;
  correctedAnswer?: string;
  /** Raw, unvalidated — the caller runs it through normaliseChoices(). */
  choices?: unknown;
}

/**
 * Read the JSON an interview turn returned.
 *
 * Tolerant of prose around the object, because the model has produced it, and
 * of a missing `correctedAnswer`, which is the normal case.
 */
export function parseIntakeReply(text: string): ParsedIntakeReply | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      question?: unknown;
      acknowledgement?: unknown;
      correctedAnswer?: unknown;
      choices?: unknown;
    };
    const question =
      typeof parsed.question === 'string' ? parsed.question.trim() : '';
    if (!question) return null;
    return {
      question,
      acknowledgement:
        typeof parsed.acknowledgement === 'string'
          ? parsed.acknowledgement.trim() || undefined
          : undefined,
      correctedAnswer:
        typeof parsed.correctedAnswer === 'string'
          ? parsed.correctedAnswer.trim() || undefined
          : undefined,
      choices: parsed.choices,
    };
  } catch {
    return null;
  }
}

/**
 * The correction this turn may act on, if any.
 *
 * ⚠️ THE FIELD IS THE PREVIOUS ANSWER'S, NOT THE NEXT QUESTION'S. The reply is
 * about the answer the member just typed, so the whitelist is checked against
 * `previousFieldKey`; anything else is dropped here rather than travelling
 * further into the save path.
 */
export function correctionFor(
  previousFieldKey: string | null | undefined,
  reply: { correctedAnswer?: string } | null,
): string | undefined {
  if (!reply?.correctedAnswer) return undefined;
  if (!isCorrectableField(previousFieldKey)) return undefined;
  return reply.correctedAnswer;
}

export interface ParsedIntakeCardReply {
  questions: { fieldKey: string; question: string }[];
  correctedAnswer?: string;
}

/**
 * Read the JSON a card turn returned.
 *
 * ⚠️ ONLY KEYS THE SERVER ASKED FOR SURVIVE. A model that invents a field, or
 * returns the same field twice, is ignored for that entry — the caller keeps
 * the server's own label for it. The turn may only WORD the plan, never extend
 * it.
 */
export function parseIntakeCardReply(
  text: string,
): ParsedIntakeCardReply | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      questions?: unknown;
      correctedAnswer?: unknown;
    };
    const seen = new Set<string>();
    const questions: { fieldKey: string; question: string }[] = [];
    if (Array.isArray(parsed.questions)) {
      for (const item of parsed.questions) {
        if (!item || typeof item !== 'object') continue;
        const record = item as { fieldKey?: unknown; question?: unknown };
        const fieldKey =
          typeof record.fieldKey === 'string' ? record.fieldKey.trim() : '';
        const question =
          typeof record.question === 'string' ? record.question.trim() : '';
        if (!fieldKey || !question || seen.has(fieldKey)) continue;
        seen.add(fieldKey);
        questions.push({ fieldKey, question: question.slice(0, 180) });
      }
    }
    if (!questions.length && typeof parsed.correctedAnswer !== 'string') {
      return null;
    }
    return {
      questions,
      correctedAnswer:
        typeof parsed.correctedAnswer === 'string'
          ? parsed.correctedAnswer.trim() || undefined
          : undefined,
    };
  } catch {
    return null;
  }
}
