import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { MotivationLicenceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FactPack,
  gateSystemPrompt,
  gateUserPrompt,
  generationSystemPrompt,
  generationUserPrompt,
  followUpBatchSystemPrompt,
  followUpBatchUserPrompt,
  followUpSystemPrompt,
  followUpUserPrompt,
} from './motivation-prompts';
import type { StructurePlan } from './motivation-structure';

// ────────────────────────────────────────────────────────────────────
// Every Anthropic call the motivation writer makes.
//
// Its own client, like every other AI surface here — there is no shared
// Anthropic module in this codebase, and each service picks its own model and
// timeout for its own reasons.
//
// THE FAIL DIRECTIONS ARE DELIBERATELY OPPOSITE, and getting them the wrong way
// round is the expensive mistake:
//   • GENERATION fails SOFT. An outage means "try again in a minute", not a
//     dead motivation — and critically it must not burn the applicant's free
//     beta seat.
//   • THE GATE fails CLOSED. A malformed, refused or unparseable verdict must
//     never read as "passed". A thin motivation reaching the Registrar is
//     worse than an annoyed applicant.
// ────────────────────────────────────────────────────────────────────

// Long-form output needs a longer timeout than the 60s the vision verifiers
// use. Still well inside nginx's 90s and Cloudflare's ~100s — a call that
// outlives those returns a gateway error the user cannot act on.
const GENERATE_TIMEOUT_MS = 85_000;
const GRADE_TIMEOUT_MS = 60_000;

// MODEL CHOICE — operator: "whatever produces the best possible document."
//
// Cost is genuinely not the constraint. At R199 a motivation, flagship tokens
// are low single-digit percent of revenue, and the whole free beta costs less
// than one document from a fly-by-night writer. The cost columns on the row
// will report the real figure per document rather than anyone's estimate.
//
// WRITER — Opus, the strongest reasoning tier. The hard part of this job is
// not prose flourish, it is obeying a constraint while writing persuasively:
// "make the best possible case AND never add a fact the applicant did not
// give you." That is instruction-following under pressure, which is exactly
// where the flagship earns its keep.
//
// GATE — DELIBERATELY A DIFFERENT MODEL, and this is the important one. A
// model grading its own output shares its own blind spots: if the writer
// invents a detail that feels plausible, the same model is the one most likely
// to wave it through on review. Groundedness is the score that vetoes
// everything, so the checker must fail differently from the writer. Sonnet 5
// at temperature 0 is an independent judge, not a rubber stamp.
//
// FOLLOW-UPS — Haiku. One short question in Boet's voice; the flagship would
// be paying Rolls-Royce prices to ask "which association are you with?".
//
// All three are env-overridable. To A/B a writer model over the beta, set
// ANTHROPIC_MODEL_MOTIVATION and restart — the gate scores and the sameness
// detector then answer the question with measurements instead of opinions.
const MODEL_WRITE = process.env.ANTHROPIC_MODEL_MOTIVATION ?? 'claude-opus-5';
const MODEL_GATE =
  process.env.ANTHROPIC_MODEL_MOTIVATION_GATE ?? 'claude-sonnet-5';
const MODEL_FOLLOWUP =
  process.env.ANTHROPIC_MODEL_MOTIVATION_FOLLOWUP ??
  'claude-haiku-4-5-20251001';

/** Below this the document goes back for more detail. */
export const QUALITY_FLOOR = 65;
/**
 * Groundedness is judged separately and harder. A beautifully written document
 * containing a fact the applicant never supplied is the worst thing we can
 * produce — they would be signing it.
 */
export const GROUNDEDNESS_FLOOR = 70;

export interface GateVerdict {
  completeness: number;
  specificity: number;
  consistency: number;
  groundedness: number;
  overall: number;
  thinFields: string[];
  issues: string[];
  passed: boolean;
}

export interface ClaudeUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface GenerationResult {
  text: string;
  usage: ClaudeUsage;
}

@Injectable()
export class MotivationClaudeService {
  private readonly logger = new Logger(MotivationClaudeService.name);
  private readonly client: Anthropic | null;

  // One alert per window, not one per affected applicant. A silently broken
  // writer during a free beta is exactly the failure that goes unnoticed for a
  // week.
  private lastOutageAlertAt = 0;
  private static readonly OUTAGE_ALERT_GAP_MS = 6 * 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key
      ? new Anthropic({ apiKey: key, timeout: GENERATE_TIMEOUT_MS, maxRetries: 1 })
      : null;
    if (!key) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — the motivation writer cannot generate anything',
      );
    }
  }

  get configured(): boolean {
    return !!this.client;
  }

  private raiseOutageAlert(detail: string): void {
    const now = Date.now();
    if (
      now - this.lastOutageAlertAt <
      MotivationClaudeService.OUTAGE_ALERT_GAP_MS
    ) {
      return;
    }
    this.lastOutageAlertAt = now;
    void this.prisma.adminAlert
      .create({
        data: {
          type: 'motivation-writer-down',
          urgent: true,
          context:
            `The licence motivation writer is failing (${detail.slice(0, 200)}). ` +
            `Applicants cannot generate documents. Check the Anthropic key/status on /admin/health.`,
        },
      })
      .catch(() => undefined);
  }

  private usageOf(msg: {
    usage?: { input_tokens?: number; output_tokens?: number };
  }, model: string): ClaudeUsage {
    return {
      model,
      promptTokens: msg.usage?.input_tokens ?? 0,
      completionTokens: msg.usage?.output_tokens ?? 0,
    };
  }

  /**
   * Draft the document.
   *
   * The system prompt is split so the licence-type rules — byte-identical for
   * every applicant of that type — can be cached, while the applicant's facts
   * and structure plan go in the uncached user turn.
   *
   * Default temperature: variation is wanted here, and the structure plan
   * already constrains the shape.
   */
  async generate(
    pack: FactPack,
    plan: StructurePlan,
  ): Promise<GenerationResult> {
    if (!this.client) {
      throw new Error('Document generation is not available right now.');
    }
    try {
      const msg = await this.client.messages.create({
        model: MODEL_WRITE,
        // 4000 was sized for the 2-4 page document the plan originally assumed.
        // The operator's real samples run 11-40 pages of compiled submission
        // (MOTIVATION-DOCUMENT-STRUCTURE.md), so 4000 would truncate mid-
        // argument — and a motivation that stops halfway is worse than none.
        //
        // NOT raised further without measurement: output tokens are the wall
        // clock, and this route is synchronous under an 85s client timeout,
        // nginx 90s and Cloudflare ~100s. If beta timings show generations
        // running close to that, the answer is async generation with polling,
        // not a bigger number here.
        max_tokens: 8000,
        system: [
          {
            type: 'text',
            text: generationSystemPrompt(pack.licenceType),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          { role: 'user', content: generationUserPrompt(pack, plan) },
        ],
      });

      const block = msg.content.find((b) => b.type === 'text');
      const text = ((block as { text?: string } | undefined)?.text ?? '').trim();
      if (text.length < 200) {
        // Too short to be a motivation. Treat as a failed attempt rather than
        // storing something the applicant would have to throw away.
        throw new Error('Generated document was too short to be usable');
      }
      return { text, usage: this.usageOf(msg, MODEL_WRITE) };
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`Motivation generation failed: ${detail}`);
      this.raiseOutageAlert(detail);
      // SOFT failure — the caller must not consume a beta seat for this.
      throw new Error(
        'We could not draft the document just now. Please try again in a minute.',
      );
    }
  }

  /**
   * Grade the draft.
   *
   * temperature 0: a score sitting near the pass line must not flip between
   * runs, or the same document passes on one attempt and fails on the next.
   *
   * FAILS CLOSED, three ways:
   *   • a shape that is not an object at all → fail
   *   • any score that is not a finite number → coerced to 0, so a malformed
   *     reply cannot sail past a `>= floor` comparison
   *   • unparseable output → fail with a marker issue, NOT a low score, so the
   *     caller can tell "the grader broke" from "the document is weak" and does
   *     not buy an expensive regeneration on a formatting regression
   */
  async grade(pack: FactPack, documentText: string): Promise<{
    verdict: GateVerdict;
    usage: ClaudeUsage;
    parsed: boolean;
  }> {
    if (!this.client) {
      return {
        verdict: this.failedVerdict('The reviewer is unavailable.'),
        usage: { model: MODEL_GATE, promptTokens: 0, completionTokens: 0 },
        parsed: false,
      };
    }

    let raw = '';
    let usage: ClaudeUsage = {
      model: MODEL_GATE,
      promptTokens: 0,
      completionTokens: 0,
    };

    try {
      const msg = await this.client.messages.create(
        {
          model: MODEL_GATE,
          max_tokens: 1200,
          temperature: 0,
          system: gateSystemPrompt(),
          messages: [
            { role: 'user', content: gateUserPrompt(pack, documentText) },
          ],
        },
        { timeout: GRADE_TIMEOUT_MS },
      );
      const block = msg.content.find((b) => b.type === 'text');
      raw = (block as { text?: string } | undefined)?.text ?? '';
      usage = this.usageOf(msg, MODEL_GATE);
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`Motivation quality gate failed: ${detail}`);
      this.raiseOutageAlert(detail);
      return {
        verdict: this.failedVerdict('The reviewer could not be reached.'),
        usage,
        parsed: false,
      };
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        verdict: this.failedVerdict('The reviewer did not return a usable verdict.'),
        usage,
        parsed: false,
      };
    }

    let obj: unknown;
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return {
        verdict: this.failedVerdict('The reviewer verdict could not be read.'),
        usage,
        parsed: false,
      };
    }

    // Shape guard BEFORE touching nested fields — a refusal object must produce
    // a clean fail rather than a 500.
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return {
        verdict: this.failedVerdict('The reviewer verdict was malformed.'),
        usage,
        parsed: false,
      };
    }

    const o = obj as Record<string, unknown>;
    const toScore = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    };

    const completeness = toScore(o.completeness);
    const specificity = toScore(o.specificity);
    const consistency = toScore(o.consistency);
    const groundedness = toScore(o.groundedness);
    const overall = Math.round(
      (completeness + specificity + consistency + groundedness) / 4,
    );

    const thinFields = Array.isArray(o.thin_fields)
      ? o.thin_fields.filter((x): x is string => typeof x === 'string').slice(0, 20)
      : [];
    const issues = Array.isArray(o.issues)
      ? o.issues
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.slice(0, 300))
          .slice(0, 20)
      : [];

    // Written as "below the floor fails", never "above the floor passes", so a
    // zero from a malformed field can only ever fail.
    const passed = overall >= QUALITY_FLOOR && groundedness >= GROUNDEDNESS_FLOOR;

    return {
      verdict: {
        completeness,
        specificity,
        consistency,
        groundedness,
        overall,
        thinFields,
        issues,
        passed,
      },
      usage,
      parsed: true,
    };
  }

  /** A verdict that cannot pass, for every path where grading did not happen. */
  private failedVerdict(reason: string): GateVerdict {
    return {
      completeness: 0,
      specificity: 0,
      consistency: 0,
      groundedness: 0,
      overall: 0,
      thinFields: [],
      issues: [reason],
      passed: false,
    };
  }

  /**
   * Phrase one follow-up question. WE pick the field (the gate named it);
   * Claude only asks it nicely. A failure here is not fatal — the caller falls
   * back to the field's own help text, because a plain question beats no
   * question.
   */
  /**
   * Ask for a batch of follow-ups in ONE request.
   *
   * Replaces a loop that called askFollowUp once per field. Same output, a
   * third of the requests, and the model can vary its phrasing because it sees
   * the whole batch.
   *
   * Returns a key→question map with only the entries it could parse. A missing
   * key is not an error: the caller has a free fallback question for every
   * field, so a partial answer degrades to plain wording rather than to
   * silence.
   */
  async askFollowUpBatch(args: {
    licenceType: MotivationLicenceType;
    gaps: {
      key: string;
      label: string;
      help?: string;
      reason: string;
      wordsSoFar: number;
    }[];
  }): Promise<{ questions: Record<string, string>; usage: ClaudeUsage }> {
    const empty = {
      questions: {} as Record<string, string>,
      usage: { model: MODEL_FOLLOWUP, promptTokens: 0, completionTokens: 0 },
    };
    if (!args.gaps.length) return empty;

    const client = this.client;
    if (!client) return empty;

    let text: string;
    let usage: ClaudeUsage;
    try {
      const res = await client.messages.create({
        model: MODEL_FOLLOWUP,
        max_tokens: 900,
        temperature: 0.7,
        system: followUpBatchSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: followUpBatchUserPrompt(args.licenceType, args.gaps),
          },
        ],
      });
      const block = res.content.find((b) => b.type === 'text');
      text = block && 'text' in block ? block.text.trim() : '';
      usage = this.usageOf(res, MODEL_FOLLOWUP);
    } catch (err) {
      this.logger.warn(
        `Follow-up batch failed, falling back to plain questions: ${(err as Error).message}`,
      );
      return empty;
    }

    const questions: Record<string, string> = {};
    try {
      const json = text.startsWith('{') ? text : text.slice(text.indexOf('{'));
      const parsed = JSON.parse(json) as {
        questions?: { key?: unknown; question?: unknown }[];
      };
      const wanted = new Set(args.gaps.map((g) => g.key));
      for (const q of parsed.questions ?? []) {
        // Only keys WE asked about. A model that invents a field key would
        // otherwise have a question stored against a field that does not exist,
        // which the wizard could never render or clear.
        if (typeof q?.key !== 'string' || !wanted.has(q.key)) continue;
        if (typeof q?.question !== 'string') continue;
        const cleaned = q.question.trim();
        if (cleaned) questions[q.key] = cleaned.slice(0, 400);
      }
    } catch {
      this.logger.warn('Follow-up batch returned unparseable JSON; using fallbacks');
    }

    return { questions, usage };
  }

  async askFollowUp(args: {
    licenceType: MotivationLicenceType;
    fieldKey: string;
    fieldLabel: string;
    fieldHelp?: string;
    currentAnswer: string;
  }): Promise<{ question: string | null; usage: ClaudeUsage }> {
    const usage: ClaudeUsage = {
      model: MODEL_FOLLOWUP,
      promptTokens: 0,
      completionTokens: 0,
    };
    if (!this.client) return { question: null, usage };

    try {
      const msg = await this.client.messages.create(
        {
          model: MODEL_FOLLOWUP,
          max_tokens: 300,
          system: followUpSystemPrompt(),
          messages: [{ role: 'user', content: followUpUserPrompt(args) }],
        },
        { timeout: GRADE_TIMEOUT_MS },
      );
      const block = msg.content.find((b) => b.type === 'text');
      const q = ((block as { text?: string } | undefined)?.text ?? '').trim();
      return {
        question: q || null,
        usage: this.usageOf(msg, MODEL_FOLLOWUP),
      };
    } catch (err) {
      this.logger.warn(
        `Follow-up question generation failed: ${(err as Error).message}`,
      );
      return { question: null, usage };
    }
  }
}
