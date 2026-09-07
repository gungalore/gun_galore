import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { LlmError } from '../common/llm/llm.types';
import type { AskGgLaneGuess } from './ask-gg-quota.service';

/**
 * W6 — the two-lane classifier. One tiny model call per user turn
 * decides which METER the turn bills to. It never picks the answering
 * model and never blocks a send: any failure, timeout, or unparseable
 * output returns null and the quota service's fail-safe branch takes
 * over (advice-if-room, else support-restricted).
 *
 *   SUPPORT — how the platform works, fees, payments/funds held,
 *             shipping, KYC/payouts, the user's own orders/sales/
 *             offers/swaps, account settings, problems with a
 *             transaction, tickets.
 *   ADVICE  — outdoor/hunting/fishing/camping expertise, gear choice
 *             and comparisons, reloading/ballistics, species ID,
 *             product recommendations, price-fairness of an item.
 *   MIXED   — both in one message.
 */

// ⚠️ NO MODEL OF ITS OWN ANY MORE. This used to run on the cheapest
// model in the range (ANTHROPIC_MODEL_ASK_GG_LANE, a Haiku) precisely
// because it is a one-token classification and the answering model was
// expensive. The platform now has ONE model — LlmService.model — and the
// router rides it. What still keeps it cheap is the shape of the call,
// not the model id: 8 output tokens, no tools, no reasoning budget.
const LANE_TIMEOUT_MS = 2_500;

const LANE_SYSTEM = `You classify one All Outdoor chat message into exactly one token.

SUPPORT = questions about the All Outdoor PLATFORM or the user's OWN account: how the site works, selling modes, fees/commission, payments and funds held, shipping/tracking, KYC/verification, payouts, their orders/sales/offers/bids/swaps, account settings, disputes/refunds, reporting problems, support tickets.
ADVICE = outdoor/hunting/fishing/camping/shooting expertise: gear advice or comparisons, what to buy, calibres, reloading or ballistics, species/animal ID, technique, "is this a fair price for X" product judgement.
MIXED = clearly both.

Reply with ONLY one word: SUPPORT or ADVICE or MIXED.`;

@Injectable()
export class AskGgLaneService {
  private readonly logger = new Logger(AskGgLaneService.name);

  constructor(private readonly llm: LlmService) {}

  /** Classify a user turn. Photo-bearing turns are ADVICE by
   *  definition (photo ID is the advice product) — no model call. */
  async classify(
    content: string,
    hasPhotos: boolean,
  ): Promise<AskGgLaneGuess> {
    if (hasPhotos) return 'ADVICE';
    if (!this.llm.isConfigured()) return null;
    const text = content.trim().slice(0, 1_200);
    if (!text) return null;
    try {
      // AbortSignal timeout (audit fix 2026-07-20) — the previous
      // Promise.race left the losing request RUNNING (still billed, and
      // its eventual rejection was unhandled). Aborting cancels it.
      const res = await this.llm.complete({
        system: LANE_SYSTEM,
        messages: [{ role: 'user', content: text }],
        maxTokens: 8,
        // ⚠️ REASONING OFF, EXPLICITLY. The whole answer is 8 tokens, and
        // a thinking budget is spent from the same allowance — leave it
        // to the provider default and the router can burn its entire
        // output budget on reasoning and emit nothing.
        thinking: { budgetTokens: 0 },
        purpose: 'askgg.lane',
        timeoutMs: LANE_TIMEOUT_MS,
        signal: AbortSignal.timeout(LANE_TIMEOUT_MS),
      });
      // STRICT single-token parse (audit fix 2026-07-20): `includes()` let
      // a reply that ECHOED the user's text steer the billing meter (write
      // "SUPPORT" in an advice question → free lane). Only an exact
      // first-token match counts; anything chattier fails safe to null.
      const out = res.text.trim().toUpperCase().split(/\s+/)[0] ?? '';
      if (out === 'SUPPORT') return 'SUPPORT';
      if (out === 'MIXED') return 'MIXED';
      if (out === 'ADVICE') return 'ADVICE';
      return null;
    } catch (err) {
      // Fail-safe to null on EVERY failure, provider error code included
      // — the quota service's own branch decides the lane from there.
      const code = err instanceof LlmError ? ` [${err.code}]` : '';
      this.logger.warn(
        `lane classify failed${code} (fail-safe → null): ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
