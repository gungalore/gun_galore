import { Injectable, Logger, Optional } from '@nestjs/common';
import { LlmService } from '../../common/llm/llm.service';
import { JevAnswer, JevQuestion } from '../../common/llm/llm.types';
import { ItemSpec, ProductHit } from './types';

/** Above this many candidates, the remainder keeps the regex verdict. */
const MAX_CANDIDATES = 40;
const CACHE_MAX = 5000;

type Verdict = 'EXACT' | 'SIMILAR' | 'UNRELATED';

function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * JEV (TypeSafe System One) is the PRIMARY judge of whether an external listing
 * is the same product as the item. The adapters' regex match is only a cheap
 * PRE-FILTER: everything that reaches here has already passed it, and JEV makes
 * the real EXACT / SIMILAR / UNRELATED call per candidate.
 *
 * ⚠️ FAIL-SAFE, NOT FAIL-OPEN. If JEV is unconfigured or a batch errors, the
 * candidate list is returned UNCHANGED, so the regex pre-filter's decision
 * stands. A valuation must never fail because the judge is down.
 *
 * `off`    - no JEV call; the regex pre-filter alone decides (default).
 * `shadow` - call JEV and log, but keep every candidate (accuracy observation).
 * `live`   - drop candidates JEV marks UNRELATED.
 */
@Injectable()
export class JevMatchService {
  private readonly logger = new Logger(JevMatchService.name);
  private readonly cache = new Map<string, Verdict>();

  constructor(@Optional() private readonly llm?: LlmService) {}

  mode(): 'off' | 'shadow' | 'live' {
    const m = (process.env.VALUATION_JEV_MATCH ?? '').toLowerCase();
    return m === 'shadow' || m === 'live' ? m : 'off';
  }

  /**
   * Judge every candidate for one source in a SINGLE batched JEV request
   * (TypeSafe evaluates all questions against one `state`). Returns the hits to
   * keep; on any failure returns `hits` unchanged.
   */
  async judge(item: ItemSpec, hits: ProductHit[]): Promise<ProductHit[]> {
    const mode = this.mode();
    if (mode === 'off' || hits.length === 0 || !this.llm) return hits;

    const verdicts = await this.decide(item, hits);
    if (!verdicts) return hits;

    const kept = hits.filter((_, i) => verdicts.get(i) !== 'UNRELATED');
    if (mode === 'shadow') {
      const dropped = hits.length - kept.length;
      if (dropped > 0) this.logger.log(`jev shadow: would drop ${dropped}/${hits.length} candidates`);
      return hits;
    }
    return kept;
  }

  private async decide(item: ItemSpec, hits: ProductHit[]): Promise<Map<number, Verdict> | null> {
    const specKey = normalize([item.make, item.model, item.keySpec].filter(Boolean).join(' '));
    const map = new Map<number, Verdict>();
    const questions: Record<string, JevQuestion> = {};
    const pending: number[] = [];

    hits.forEach((h, i) => {
      if (i >= MAX_CANDIDATES) return;
      const cached = this.cache.get(`${specKey}|${normalize(h.title)}`);
      if (cached) {
        map.set(i, cached);
        return;
      }
      pending.push(i);
      questions[`c${i}`] = {
        type: 'choice',
        instructions: `Candidate listing title: "${h.title}". Is this candidate listing the same product as the target item?`,
        criteria: {
          EXACT: 'Identical make and model; any spec difference is minor.',
          SIMILAR: 'Same make and product family or model line, close enough to price as a comparable.',
          UNRELATED: 'A different make, or an accessory, part or product category that must not be compared.',
        },
      };
    });
    if (pending.length === 0) return map;

    try {
      const res = await this.llm!.decide({
        purpose: 'valuation.match',
        state: `Target item: make="${item.make ?? ''}", model="${item.model ?? ''}", key spec="${item.keySpec ?? ''}".`,
        questions,
      });
      for (const i of pending) {
        const v = this.readVerdict(res.answers[`c${i}`]);
        if (!v) return null; // an unusable answer fails the whole batch safe
        map.set(i, v);
        this.remember(`${specKey}|${normalize(hits[i].title)}`, v);
      }
      return map;
    } catch (e) {
      this.logger.warn(`jev match failed, keeping regex verdicts: ${(e as Error).message}`);
      return null;
    }
  }

  private readVerdict(answer: JevAnswer | undefined): Verdict | null {
    if (!answer || answer.type !== 'choice') return null;
    const c = answer.choice.toUpperCase();
    return c === 'EXACT' || c === 'SIMILAR' || c === 'UNRELATED' ? (c as Verdict) : null;
  }

  private remember(key: string, verdict: Verdict): void {
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(key, verdict);
  }
}
