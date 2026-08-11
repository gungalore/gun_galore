import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { AskGgLaneGuess } from './ask-gg-quota.service';

/**
 * W6 — the two-lane classifier. One tiny Haiku call per user turn
 * (~$0.0003) decides which METER the turn bills to. It never picks the
 * answering model and never blocks a send: any failure, timeout, or
 * unparseable output returns null and the quota service's fail-safe
 * branch takes over (advice-if-room, else support-restricted).
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

const LANE_MODEL =
  process.env.ANTHROPIC_MODEL_ASK_GG_LANE ?? 'claude-haiku-4-5-20251001';

const LANE_TIMEOUT_MS = 2_500;

const LANE_SYSTEM = `You classify one All Outdoor chat message into exactly one token.

SUPPORT = questions about the All Outdoor PLATFORM or the user's OWN account: how the site works, selling modes, fees/commission, payments and funds held, shipping/tracking, KYC/verification, payouts, their orders/sales/offers/bids/swaps, account settings, disputes/refunds, reporting problems, support tickets.
ADVICE = outdoor/hunting/fishing/camping/shooting expertise: gear advice or comparisons, what to buy, calibres, reloading or ballistics, species/animal ID, technique, "is this a fair price for X" product judgement.
MIXED = clearly both.

Reply with ONLY one word: SUPPORT or ADVICE or MIXED.`;

@Injectable()
export class AskGgLaneService {
  private readonly logger = new Logger(AskGgLaneService.name);
  private readonly client: Anthropic | null;

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
  }

  /** Classify a user turn. Photo-bearing turns are ADVICE by
   *  definition (photo ID is the advice product) — no API call. */
  async classify(
    content: string,
    hasPhotos: boolean,
  ): Promise<AskGgLaneGuess> {
    if (hasPhotos) return 'ADVICE';
    if (!this.client) return null;
    const text = content.trim().slice(0, 1_200);
    if (!text) return null;
    try {
      // AbortSignal timeout (audit fix 2026-07-20) — the previous
      // Promise.race left the losing request RUNNING (still billed, and
      // its eventual rejection was unhandled). Aborting cancels it.
      const res = await this.client.messages.create(
        {
          model: LANE_MODEL,
          max_tokens: 8,
          system: LANE_SYSTEM,
          messages: [{ role: 'user', content: text }],
        },
        { signal: AbortSignal.timeout(LANE_TIMEOUT_MS), maxRetries: 0 },
      );
      // STRICT single-token parse (audit fix 2026-07-20): `includes()` let
      // a reply that ECHOED the user's text steer the billing meter (write
      // "SUPPORT" in an advice question → free lane). Only an exact
      // first-token match counts; anything chattier fails safe to null.
      const out =
        res.content[0]?.type === 'text'
          ? res.content[0].text.trim().toUpperCase().split(/\s+/)[0]
          : '';
      if (out === 'SUPPORT') return 'SUPPORT';
      if (out === 'MIXED') return 'MIXED';
      if (out === 'ADVICE') return 'ADVICE';
      return null;
    } catch (err) {
      this.logger.warn(
        `lane classify failed (fail-safe → null): ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
