import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import type { LlmResponse } from '../common/llm/llm.types';
import { renderStatute } from './motivation-statute';
import {
  writerAgentSectionSystemPrompt,
  writerAgentSectionUserPrompt,
  type FactPack,
} from './motivation-prompts';
import type { SectionPlan, StructurePlan } from './motivation-structure';
import type {
  GenerationResult,
  ModelUsage,
} from './motivation-model.service';

const SECTION_TIMEOUT_MS = 120_000;
const SECTION_MAX_TOKENS = 2_500;
const SECTION_THINKING = { budgetTokens: 1_024 } as const;

/**
 * The new writer brain: one focused pass per section, over the same facts,
 * plan and gates the old writer used.
 *
 * ⚠️ THIS IS NOT A SECOND SOURCE OF TRUTH. It receives the same FactPack and
 * StructurePlan and returns one joined document. The existing mechanical checks,
 * quality gate, verifier, annexures and PDF renderer stay exactly where they
 * are. Turning it on is an env flag (`MOTIVATION_WRITER_AGENT=1`), so the old
 * single-call writer remains the rollback.
 *
 * ⚠️ WHY SECTION BY SECTION. A 12-heading, 1 500-word document in one call
 * makes the model spend its attention on headings it has already written and
 * on the ending before it has done the battery or the statutory application.
 * One section per call gives each argument its own context window, and the
 * caller can see exactly which section failed.
 */
@Injectable()
export class MotivationWriterAgentService {
  private readonly logger = new Logger(MotivationWriterAgentService.name);

  constructor(private readonly llm: LlmService) {}

  async generate(
    pack: FactPack,
    plan: StructurePlan,
    retryIssues?: readonly string[],
  ): Promise<GenerationResult> {
    if (!this.llm.isConfigured()) {
      throw new Error('Document generation is not available right now.');
    }

    const body: string[] = [];
    const previousHeadings: string[] = [];
    let usage: ModelUsage = {
      model: this.llm.model,
      promptTokens: 0,
      completionTokens: 0,
    };

    for (const section of plan.sections) {
      const response = await this.section(pack, plan, section, {
        previousHeadings,
        retryIssues,
      });
      body.push(this.ensureHeading(response.text, section));
      previousHeadings.push(section.heading);
      usage = {
        model: response.model,
        promptTokens: usage.promptTokens + response.usage.inputTokens,
        completionTokens:
          usage.completionTokens + response.usage.outputTokens,
      };
    }

    const text = body.join('\n\n').trim();
    if (text.length < 200) {
      throw new Error('Generated document was too short to be usable');
    }
    return { text, usage };
  }

  private async section(
    pack: FactPack,
    plan: StructurePlan,
    section: SectionPlan,
    options: {
      previousHeadings: readonly string[];
      retryIssues?: readonly string[];
    },
  ): Promise<LlmResponse> {
    const legalText =
      section.id === 'statutory_application'
        ? renderStatute(pack.licenceType)
        : undefined;

    const res = await this.llm.complete({
      maxTokens: SECTION_MAX_TOKENS,
      thinking: SECTION_THINKING,
      temperature: 0.4,
      system: writerAgentSectionSystemPrompt(pack.licenceType),
      messages: [
        {
          role: 'user',
          content: writerAgentSectionUserPrompt(pack, plan, section, {
            legalText,
            previousHeadings: options.previousHeadings,
            retryIssues: options.retryIssues,
          }),
        },
      ],
      purpose: 'motivation.generate.section',
      timeoutMs: SECTION_TIMEOUT_MS,
    });

    if (!res.text.trim()) {
      throw new Error(`The writer returned no text for ${section.id}.`);
    }
    return res;
  }

  /**
   * The heading is a fixed string from the plan. If the model omits it, add it;
   * if the model repeats it, leave one. Never let a model invent a number.
   */
  private ensureHeading(text: string, section: SectionPlan): string {
    const body = text.trim();
    const firstLine = body.split('\n', 1)[0]?.trim() ?? '';
    if (firstLine.toLowerCase() === section.heading.toLowerCase()) {
      return body;
    }
    if (/^\d+[A-Z]?\.\s/.test(firstLine)) {
      // The model wrote a different heading/number. Replace that first line.
      const rest = body.slice(firstLine.length).trimStart();
      return `${section.heading}\n\n${rest}`;
    }
    return `${section.heading}\n\n${body}`;
  }
}
