import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export type ModerationAction = 'APPROVE' | 'STRIP' | 'BLOCK';

export interface ModerationResult {
  action: ModerationAction;
  cleaned?: string; // present when action is STRIP
  reason?: string;  // present when action is BLOCK
}

const SYSTEM_PROMPT = `You are a content moderator for Gun Galore, a South African firearms and outdoor marketplace. You review messages sent between buyers and sellers about specific transactions.

Your job is to enforce two rules:
1. STRIP contact info: Remove phone numbers, email addresses, WhatsApp numbers, social media handles (@username), URLs, or any attempt to share personal contact details. Replace each redacted item with [REDACTED]. If the message still makes sense without the contact info, return action STRIP with the cleaned message.
2. BLOCK off-platform solicitation: If the message is clearly trying to move the transaction off the platform (e.g. "pay me via EFT directly", "meet me at [place] to pay cash", "pay via PayFast", "send money to my bank"), return action BLOCK with a brief reason.

For everything else — questions about the item, shipping logistics, condition queries, general chat — return APPROVE unchanged.

Respond with valid JSON only:
{ "action": "APPROVE" | "STRIP" | "BLOCK", "cleaned": "...", "reason": "..." }
- Include "cleaned" only when action is STRIP (the full message with contact info redacted).
- Include "reason" only when action is BLOCK (one short sentence for the user).
- Never include both.`;

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);
  private readonly client: Anthropic | null;

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
  }

  async moderate(content: string): Promise<ModerationResult> {
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY not set — skipping message moderation');
      return { action: 'APPROVE' };
    }

    try {
      const msg = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      });

      const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
      const parsed = JSON.parse(text) as ModerationResult;

      if (!['APPROVE', 'STRIP', 'BLOCK'].includes(parsed.action)) {
        return { action: 'APPROVE' };
      }
      return parsed;
    } catch (err) {
      // Never break messaging on moderation failure — fail open
      this.logger.error('Moderation API error, failing open', err);
      return { action: 'APPROVE' };
    }
  }
}
