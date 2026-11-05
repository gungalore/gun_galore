import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../common/llm/llm.service';
import type { LlmTool, LlmToolCall } from '../../common/llm/llm.types';
import type { IntakeChoice, IntakeQuestion, IntakeState } from './intake.types';
import {
  CHOICES_SCHEMA,
  FACT_SCHEMA,
  INTERVIEW_AGENT_SCHEMA,
  choicesSystemPrompt,
  choicesUserPrompt,
  factSystemPrompt,
  factUserPrompt,
  interviewAgentSystemPrompt,
  interviewAgentUserPrompt,
  type FactCandidate,
} from './intake-agent.prompts';
import { normaliseChoices } from './intake-choices';

const PURPOSE = 'motivation.interview.agent';

/**
 * What the agent may see. It is deliberately a projection: answers are already
 * reduced to non-sensitive facts, and no encrypted transcript or raw document
 * bytes go into the model turn.
 */
export interface InterviewAgentContext {
  licenceType: string;
  licenceLabel: string;
  summary: string;
  knownFacts: string[];
  question: IntakeQuestion | null;
  documents: IntakeState['documents'];
  evidence: IntakeState['evidence'];
  previousQuestion?: string;
  previousAnswer?: string;
  /** The field the previous answer belongs to, so a spelling fix can be saved. */
  previousFieldKey?: string;
}

export interface InterviewAgentReply {
  acknowledgement?: string;
  question: string;
  correctedAnswer?: string;
  choices?: IntakeChoice[];
  toolsUsed: string[];
}

const TOOLS: LlmTool[] = [
  {
    name: 'get_interview_context',
    description:
      'Read the next question the application needs, the known applicant facts, the document checklist and the evidence options.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_document_checklist',
    description:
      'Read which required documents are attached, which are missing, and whether the firearm source proof is present.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_evidence_options',
    description:
      'Read the evidence items already in the document centre that are relevant to this application.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

@Injectable()
export class MotivationIntakeAgentService {
  private readonly logger = new Logger(MotivationIntakeAgentService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Phrase the next interviewer turn, using the Interactions API tool loop.
   *
   * Returns null when Gemini is unavailable or the answer is unusable; the
   * caller keeps its deterministic one-shot phrasing as the fallback. This is
   * an enhancement, never a new failure mode for the interview.
   */
  async phrase(
    context: InterviewAgentContext,
  ): Promise<InterviewAgentReply | null> {
    if (!this.llm.isConfiguredFor(PURPOSE)) return null;

    try {
      const result = await this.llm.agent({
        system: interviewAgentSystemPrompt(),
        input: interviewAgentUserPrompt({
          licenceLabel: context.licenceLabel,
          previousQuestion: context.previousQuestion,
          previousAnswer: context.previousAnswer,
        }),
        tools: TOOLS,
        maxTokens: 500,
        purpose: PURPOSE,
        json: { schema: INTERVIEW_AGENT_SCHEMA },
        maxToolRounds: 3,
        timeoutMs: 25_000,
        executeTool: (call) => this.runTool(call, context),
      });

      const parsed = parseReply(result.text);
      if (!parsed?.question) return null;
      return {
        acknowledgement: parsed.acknowledgement,
        question: parsed.question,
        correctedAnswer: parsed.correctedAnswer,
        choices: parsed.choices,
        toolsUsed: result.toolCalls.map((call) => call.name),
      };
    } catch (err) {
      // No prompt content in this line: it can carry a member's address or the
      // facts of a self-defence application.
      this.logger.warn(
        `Interview agent turn failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * THE CHIPS, WHEN THE MAIN TURN FORGOT THEM.
   *
   * The interview agent is asked for 3-5 tap answers on every open question and
   * usually returns them. When it does not — a dropped field, a truncated JSON
   * reply, a model that wrote prose instead — the member is left with a blank
   * input after eight questions of tapping, which reads like the system broke.
   *
   * ⚠️ TWO IS THE FLOOR. One button is not a shortlist, it is a leading
   * question; the caller falls back to the ordinary text box instead.
   *
   * Fail-soft and cheap: no model, no question, or a bad reply returns [].
   */
  async choicesFor(args: {
    licenceLabel: string;
    question: string;
    help?: string;
    known: string[];
    previousAnswer?: string;
  }): Promise<IntakeChoice[]> {
    if (!this.llm.isConfiguredFor(PURPOSE)) return [];
    if (!args.question.trim()) return [];
    try {
      const res = await this.llm.complete({
        system: choicesSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: choicesUserPrompt({
              licenceLabel: args.licenceLabel,
              question: args.question,
              help: args.help,
              known: args.known,
              previousAnswer: args.previousAnswer,
            }),
          },
        ],
        maxTokens: 400,
        temperature: 0.4,
        purpose: PURPOSE,
        json: { schema: CHOICES_SCHEMA },
        timeoutMs: 12_000,
      });
      const parsed = JSON.parse(res.text) as { choices?: unknown };
      const choices = normaliseChoices(parsed.choices);
      return choices.length >= 2 ? choices : [];
    } catch (err) {
      this.logger.warn(
        `Interview choices turn failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Read every fact out of one free-text answer, not only the field the
   * interview happened to ask about.
   *
   * "Mauser M96 straight-pull in .30-06, hunted kudu in the Karoo" is one turn
   * to a person and six facts to this system. The caller still owns validation
   * and saving; this method only maps text to the candidate keys it was given,
   * and a fact outside those keys is dropped.
   */
  async extractFacts(args: {
    text: string;
    currentKey: string;
    candidates: FactCandidate[];
  }): Promise<Record<string, string>> {
    const text = args.text.trim();
    if (!text || !args.candidates.length) return {};
    if (!this.llm.isConfiguredFor('motivation.interview')) return {};

    try {
      const res = await this.llm.complete({
        system: factSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: factUserPrompt({
              text,
              currentKey: args.currentKey,
              candidates: args.candidates,
            }),
          },
        ],
        maxTokens: 700,
        temperature: 0,
        purpose: 'motivation.interview',
        json: { schema: FACT_SCHEMA },
        timeoutMs: 15_000,
      });
      const parsed = JSON.parse(res.text) as {
        answers?: Array<{ key?: unknown; value?: unknown }>;
      };
      const allowed = new Map(args.candidates.map((c) => [c.key, c]));
      const out: Record<string, string> = {};
      for (const raw of parsed.answers ?? []) {
        const key = typeof raw.key === 'string' ? raw.key.trim() : '';
        let value = typeof raw.value === 'string' ? raw.value.trim() : '';
        const candidate = allowed.get(key);
        if (!candidate || !value) continue;
        const maxLength = candidate.kind === 'long' ? 3000 : 200;
        if (value.length > maxLength) value = value.slice(0, maxLength).trim();

        if (candidate.choices?.length) {
          const hit = candidate.choices.find(
            (choice) =>
              choice.value.toLowerCase() === value.toLowerCase() ||
              choice.label.toLowerCase() === value.toLowerCase(),
          );
          if (!hit) {
            // A closed choice means closed. A custom answer to the CURRENT
            // question is the caller's job, not this extractor's.
            if (
              candidate.kind === 'choice' ||
              candidate.kind === 'yesno' ||
              candidate.kind === 'cards' ||
              candidate.kind === 'multi'
            ) {
              continue;
            }
          } else {
            value = hit.value;
          }
        }

        if (candidate.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          continue;
        }
        out[key] = value;
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `Interview fact extraction failed: ${(err as Error).message}`,
      );
      return {};
    }
  }

  private runTool(
    call: LlmToolCall,
    context: InterviewAgentContext,
  ): Record<string, unknown> {
    switch (call.name) {
      case 'get_interview_context':
        return {
          licenceType: context.licenceType,
          licenceLabel: context.licenceLabel,
          summary: context.summary,
          knownFacts: context.knownFacts,
          question: projectQuestion(context.question),
          documents: documentSummary(context.documents),
          evidence: evidenceSummary(context.evidence),
        };
      case 'get_document_checklist':
        return documentSummary(context.documents);
      case 'get_evidence_options':
        return evidenceSummary(context.evidence);
      default:
        return {
          error: `Unknown tool: ${call.name}`,
        };
    }
  }
}

function projectQuestion(question: IntakeQuestion | null) {
  if (!question) return null;
  return {
    fieldKey: question.fieldKey,
    label: question.label,
    help: question.help,
    kind: question.kind,
    choices: question.choices,
    multi: question.multi,
    sensitive: question.sensitive,
    customPlaceholder: question.customPlaceholder,
    optional: question.optional,
    progress: question.progress,
  };
}

function documentSummary(documents: IntakeState['documents']) {
  return {
    attached: documents.attached,
    required: documents.required,
    sourceProofAttached: documents.sourceProofAttached,
    missing: documents.missing,
  };
}

function evidenceSummary(evidence: IntakeState['evidence']) {
  return {
    ready: evidence.ready,
    groups: evidence.groups,
    note: evidence.note,
    items: evidence.items
      .filter((item) => !item.alreadyHere)
      .map((item) => ({
        title: item.title,
        kind: item.kind,
        reason: item.tickReason,
        evidenceType: item.evidenceType,
      })),
  };
}

function parseReply(
  text: string,
): {
  acknowledgement?: string;
  question: string;
  correctedAnswer?: string;
  choices?: IntakeChoice[];
} | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      acknowledgement?: unknown;
      question?: unknown;
      correctedAnswer?: unknown;
      choices?: unknown;
    };
    const question =
      typeof parsed.question === 'string' ? parsed.question.trim() : '';
    if (!question) return null;

    // ⚠️ THE SAME NORMALISER AS EVERY OTHER CHIP PATH. Duplicates, empty
    // strings and paragraph-length "answers" are dropped rather than rendered:
    // a button that stores nothing is worse than no button.
    const choices = normaliseChoices(parsed.choices);

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
      choices: choices.length ? choices : undefined,
    };
  } catch {
    return null;
  }
}
