import { Injectable, Logger } from '@nestjs/common';
import type { MotivationLicenceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../common/llm/llm.service';
import { LlmError } from '../../common/llm/llm.types';
import { decryptJson, encryptJson } from '../../common/blob-crypto';
import { MotivationResearchService } from '../motivation-research.service';
import { missingDetail } from '../motivation-completeness';
import { LICENCE_TYPE_LABELS } from '../motivation-fields';
import {
  INTERVIEW_BRIEF_TTL_DAYS,
  INTERVIEW_BRIEF_VERSION,
  askableFields,
  answersDigest,
  briefFacts,
  briefHash,
  deterministicBrief,
  forbiddenValues,
  validateBrief,
  type InterviewBrief,
} from './intake-brief';
import {
  INTERVIEW_BRIEF_SCHEMA,
  briefSystemPrompt,
  briefUserPrompt,
} from './intake-brief.prompts';

// ────────────────────────────────────────────────────────────────────
// THE BRIEF'S LIFECYCLE.
//
// ⚠️ IT NEVER BLOCKS A SCREEN. Building a brief needs the shared research
// (possibly a grounded web call) and one model turn, so it runs in the
// background: `ensure()` is fire-and-forget, the interview serves the
// deterministic labels until it lands, and the next card is the enriched one.
// A member never waits on research to answer a question.
//
// ⚠️ ONE BUILD PER FACT-HASH, AND A COOLDOWN ON FAILURE. The hash changes only
// when the facts that change the questions change (calibre, purpose,
// association, section). A failed or local-only brief is retried after ten
// minutes rather than on every keystroke, and never twice at once.
// ────────────────────────────────────────────────────────────────────

/** How long a local-only brief is served before the model is tried again. */
const UNRESEARCHED_RETRY_MS = 10 * 60 * 1000;

const BRIEF_PURPOSE = 'motivation.interview.brief';
const BRIEF_TIMEOUT_MS = 25_000;
const BRIEF_MAX_TOKENS = 3_000;

export interface StoredBriefColumns {
  intakeBriefEncrypted: string | null;
  intakeBriefVersion: string | null;
  intakeBriefHash: string | null;
  intakeBriefAt: Date | null;
}

export interface EnsureBriefArgs {
  motivationId: string;
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;
  stored: StoredBriefColumns;
}

/**
 * Read the JSON a model returned, tolerating prose around it.
 *
 * The brief is a large object, so the same tolerant slice the interview reply
 * uses applies: take from the first `{` to the last `}`.
 */
export function parseBriefPayload(text: string): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

@Injectable()
export class MotivationIntakeBriefService {
  private readonly logger = new Logger(MotivationIntakeBriefService.name);
  /** One build at a time per application, across every tab and request. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly research: MotivationResearchService,
  ) {}

  /** True when the feature is switched off for the box (env + reload). */
  isEnabled(): boolean {
    return process.env.INTERVIEW_BRIEF !== 'off';
  }

  /**
   * The brief this application should be served, or null.
   *
   * ⚠️ VERSION, HASH AND AGE ARE ALL CHECKED. A brief written before a wording
   * change, or against a different calibre, is not this application's brief —
   * serving it would put another firearm's species on the buttons.
   */
  current(
    stored: StoredBriefColumns,
    expectedHash: string,
    now: Date = new Date(),
  ): InterviewBrief | null {
    if (!stored.intakeBriefEncrypted) return null;
    if (stored.intakeBriefVersion !== INTERVIEW_BRIEF_VERSION) return null;
    if (stored.intakeBriefHash !== expectedHash) return null;
    const at = stored.intakeBriefAt?.getTime() ?? 0;
    if (!at || now.getTime() - at > INTERVIEW_BRIEF_TTL_DAYS * 86_400_000) {
      return null;
    }
    try {
      const brief = decryptJson<InterviewBrief>(stored.intakeBriefEncrypted);
      if (!brief || brief.hash !== expectedHash) return null;
      return brief;
    } catch {
      // A blob that cannot be read costs the brief, never the interview.
      return null;
    }
  }

  /**
   * Start a build if this application needs one. Never throws, never awaits.
   *
   * ⚠️ IT WAITS FOR A FIREARM. A brief built from an empty application can only
   * say generic things; the first card (identity) does not need it, and the
   * build after the firearm card has the calibre the research hangs off. If the
   * firearm is already known from the vault, the first card arrives enriched.
   */
  ensure(args: EnsureBriefArgs): void {
    if (!this.isEnabled()) return;
    if (!(args.answers.firearm_type ?? '').trim()) return;
    const hash = briefHash(args.licenceType, args.answers);
    const existing = this.current(args.stored, hash);
    if (existing) {
      if (existing.researched) return;
      const at = args.stored.intakeBriefAt?.getTime() ?? 0;
      if (Date.now() - at < UNRESEARCHED_RETRY_MS) return;
    }
    if (this.inFlight.has(args.motivationId)) return;
    this.inFlight.add(args.motivationId);
    void this.buildAndStore(args, hash)
      .catch((err: unknown) => {
        this.logger.warn(
          `Interview brief failed for ${args.motivationId}: ${
            (err as Error).message
          }`,
        );
      })
      .finally(() => {
        this.inFlight.delete(args.motivationId);
      });
  }

  /**
   * Rebuild the brief and WAIT for it.
   *
   * ⚠️ PER-ANSWER REBRIEFING. After an answer the hash no longer matches, so
   * the next card would otherwise be served label-only while a background
   * build catches up. The card after an answer awaits this instead: the brief
   * sees the answer, and the question that comes next is a reaction to it.
   * The cost is one model call per answered card (~3 seconds); the first card
   * of a session still uses the fire-and-forget door.
   */
  async ensureNow(
    args: EnsureBriefArgs,
  ): Promise<InterviewBrief | null> {
    if (!this.isEnabled()) return null;
    if (!(args.answers.firearm_type ?? '').trim()) return null;
    const hash = briefHash(args.licenceType, args.answers);
    const existing = this.current(args.stored, hash);
    if (existing) return existing;
    if (this.inFlight.has(args.motivationId)) return null;
    this.inFlight.add(args.motivationId);
    try {
      return await this.buildAndStore(args, hash);
    } catch (err) {
      this.logger.warn(
        `Interview brief (awaited) failed for ${args.motivationId}: ${
          (err as Error).message
        }`,
      );
      return null;
    } finally {
      this.inFlight.delete(args.motivationId);
    }
  }

  private async buildAndStore(
    args: EnsureBriefArgs,
    hash: string,
  ): Promise<InterviewBrief> {
    const brief = await this.build(args.licenceType, args.answers, hash);
    await this.prisma.motivation.update({
      where: { id: args.motivationId },
      data: {
        intakeBriefEncrypted: encryptJson(brief),
        intakeBriefVersion: brief.version,
        intakeBriefHash: brief.hash,
        intakeBriefAt: new Date(brief.at),
      },
    });
    this.logger.log(
      `Interview brief ${brief.researched ? 'built' : 'local only'} ` +
        `(${brief.questions.length} questions, ${Object.keys(brief.chips).length} chipped fields)`,
    );
    return brief;
  }

  /**
   * Build one brief. Fails soft to the deterministic half.
   *
   * ⚠️ THE RESEARCH IS NOT ALLOWED TO COST THE BRIEF. A grounded call that
   * times out returns nothing; the questions are still chosen from the gate's
   * gaps and the facts the file holds.
   */
  async build(
    licenceType: MotivationLicenceType,
    answers: Record<string, string>,
    hash: string,
  ): Promise<InterviewBrief> {
    const facts = briefFacts(licenceType, answers);
    const forbidden = forbiddenValues(licenceType, answers);
    const gaps = missingDetail(answers, licenceType);
    const fields = askableFields(licenceType).map((field) => ({
      key: field.key,
      label: field.label,
      help: field.help,
      kind: field.kind,
    }));

    if (!this.llm.isConfiguredFor(BRIEF_PURPOSE)) {
      return deterministicBrief({ type: licenceType, answers, hash });
    }

    let researchBlock = '';
    try {
      const pack = await this.research.researchFor(licenceType, answers);
      researchBlock = MotivationResearchService.toBlock(pack);
    } catch (err) {
      // Research is seasoning; the brief still has the facts and the gaps.
      this.logger.warn(
        `Interview brief research unavailable — the questions use the facts only: ${
          (err as Error).message
        }`,
      );
    }

    try {
      const res = await this.llm.complete({
        system: briefSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: briefUserPrompt({
              licenceLabel:
                LICENCE_TYPE_LABELS[licenceType] ?? String(licenceType),
              facts,
              research: researchBlock,
              gaps: gaps.map((gap) => ({
                code: gap.code,
                label: gap.label,
                hint: gap.hint,
              })),
              fields,
              answers: answersDigest(licenceType, answers),
            }),
          },
        ],
        maxTokens: BRIEF_MAX_TOKENS,
        temperature: 0.3,
        purpose: BRIEF_PURPOSE,
        json: { schema: INTERVIEW_BRIEF_SCHEMA },
        timeoutMs: BRIEF_TIMEOUT_MS,
      });

      const brief = validateBrief({
        type: licenceType,
        raw: parseBriefPayload(res.text),
        facts,
        hash,
        forbidden,
        researched: true,
      });
      /**
       * ⚠️ A MODEL THAT RETURNED NO USABLE QUESTION IS A LOCAL BRIEF, NOT AN
       * EMPTY ONE. The validator drops confidently; if it dropped everything,
       * the gate's own gaps are a better interview than nothing.
       */
      if (!brief.questions.length) {
        return deterministicBrief({ type: licenceType, answers, hash });
      }
      return brief;
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'unknown';
      this.logger.warn(
        `Interview brief model failed [${code}] — serving the deterministic brief.`,
      );
      return deterministicBrief({ type: licenceType, answers, hash });
    }
  }
}
