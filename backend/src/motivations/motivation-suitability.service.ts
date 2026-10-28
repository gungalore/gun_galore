import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import {
  SUITABILITY_SCHEMA,
  SUITABILITY_VERSION,
  type SuitabilityArgument,
  type SuitabilityInput,
  buildSuitabilityQuestion,
  suitabilityHash,
  suitabilitySystemPrompt,
  suitabilityUserPrompt,
  validateSuitability,
} from './motivation-suitability';

// ────────────────────────────────────────────────────────────────────
// THE 5.2 WRITER.
//
// One call, one page. The brief and every rule live in motivation-suitability.ts
// so they can be tested without a provider; this file only makes the request,
// retries once on our own validation findings, and hands back the argument.
//
// ⚠️ FAIL-SOFT. A provider outage costs the page its new argument, never the
// motivation: the renderer falls back to the stored research article and the
// contextual purpose fallback.
// ────────────────────────────────────────────────────────────────────

interface ParsedSuitability {
  question?: unknown;
  thesis?: unknown;
  groups?: unknown;
  wordCount?: unknown;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function cleanArgument(
  parsed: ParsedSuitability,
  input: SuitabilityInput,
): SuitabilityArgument {
  const groups = Array.isArray(parsed.groups)
    ? parsed.groups
        .map((g) => {
          const row = g as { heading?: unknown; bullets?: unknown };
          return {
            heading: text(row.heading),
            bullets: Array.isArray(row.bullets)
              ? row.bullets.map(text).filter(Boolean)
              : [],
          };
        })
        .filter((g) => g.heading && g.bullets.length)
    : [];
  const question = text(parsed.question) || buildSuitabilityQuestion(input);
  const thesis = text(parsed.thesis);
  const words = [thesis, ...groups.flatMap((g) => g.bullets)]
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return {
    question,
    thesis,
    groups,
    wordCount: words,
    version: SUITABILITY_VERSION,
  };
}

@Injectable()
export class MotivationSuitabilityService {
  private readonly logger = new Logger(MotivationSuitabilityService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Write the 5.2 argument, or return null.
   *
   * ⚠️ ONE RETRY, AND ONLY ON OUR OWN FINDINGS. A provider error is not
   * retried here — the generation pipeline already has a retry at the document
   * level, and a second paid call for the same outage is waste.
   */
  async build(
    input: SuitabilityInput,
  ): Promise<{ argument: SuitabilityArgument; hash: string } | null> {
    if (!this.llm.isConfigured()) return null;

    const hash = suitabilityHash(input);
    let issues: string[] = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      let raw = '';
      try {
        const res = await this.llm.complete({
          system: suitabilitySystemPrompt(),
          messages: [
            {
              role: 'user',
              content: [
                suitabilityUserPrompt(input),
                ...(issues.length
                  ? [
                      '',
                      'THE PREVIOUS DRAFT WAS REFUSED FOR THESE REASONS. FIX THEM IN THIS DRAFT:',
                      ...issues.map((i) => `- ${i}`),
                    ]
                  : []),
              ].join('\n'),
            },
          ],
          maxTokens: 12_000,
          temperature: 0.4,
          thinking: { budgetTokens: 2_048 },
          json: { schema: SUITABILITY_SCHEMA },
          purpose: 'motivation.suitability',
          timeoutMs: 120_000,
        });
        raw = res.text.trim();
      } catch (err) {
        this.logger.warn(
          `Suitability writer failed: ${(err as Error).message}`,
        );
        return null;
      }

      let parsed: ParsedSuitability;
      try {
        parsed = JSON.parse(raw) as ParsedSuitability;
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        try {
          parsed = JSON.parse(m ? m[0] : raw) as ParsedSuitability;
        } catch {
          issues = ['the reply was not parseable JSON'];
          continue;
        }
      }

      const argument = cleanArgument(parsed, input);
      issues = validateSuitability(argument, input);
      if (!issues.length) return { argument, hash };
      this.logger.warn(
        `Suitability draft ${attempt + 1} refused: ${issues.join('; ')}`,
      );
    }

    this.logger.warn(
      `Suitability writer gave no usable draft for ${input.firearmLine || 'this application'}: ${issues.join('; ')}`,
    );
    return null;
  }
}
