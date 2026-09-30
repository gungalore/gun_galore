// ────────────────────────────────────────────────────────────────────
// THE JEV CONTACT-MONITORING BATTERY AND ITS CONFIDENCE LADDER.
//
// Operator decision, 2026-10-01: Jev monitors every user-to-user TEXT
// surface — listings, listing Q&A, offer notes, rating comments, feed posts
// and comments — for anything that lets one user reach another off-platform:
// contact details, NAME AND SURNAME sharing, social handles, third-party
// advertising, off-platform coordination, a physical address.
//
// ⚠️ ONE CALL, EVERY QUESTION. Jev evaluates all questions in parallel
// against one `state`; TypeSafe's own cookbook measures a batched request as
// ~12× cheaper and ~10× faster than one call per question. So a surface asks
// the whole battery at once and reads the probabilities back.
//
// ⚠️ THE LADDER IS THE OPERATOR'S, VERBATIM (2026-10-01):
//   - Jev ≥ 80 % sure  -> BLOCK and notify the user with a reason.
//   - 60–80 %          -> appeal to admin, but first ask DeepSeek for a
//                         second opinion; DeepSeek sure -> follow it, DeepSeek
//                         unsure -> admin review.
//   - < 60 %           -> pass.
// "Admin review" is the surface's own holding state (listing HUMAN_REVIEW,
// feed PENDING_MODERATION, conversation T&S queue). The thresholds are env
// overridable so they can be tuned without a deploy.
//
// ⚠️ THE MODEL NEVER DECIDES ALONE. Every branch here is code reading a
// number Jev or DeepSeek returned — see how-to-build-with-system-one. That
// is also why a Jev failure does not silently pass: the caller names its
// fail posture (`onError`) and this honors it.
// ────────────────────────────────────────────────────────────────────

import type { LlmService } from '../common/llm/llm.service';
import { LlmError, type JevQuestion } from '../common/llm/llm.types';

/** Jev probability at or above which a category is a BLOCK. */
export function blockThreshold(): number {
  const raw = Number(process.env.JEV_BLOCK_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.8;
}

/** Jev probability at or above which a category is escalated for a second
 *  opinion (and, if that is unsure, sent to admin). */
export function reviewThreshold(): number {
  const raw = Number(process.env.JEV_REVIEW_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : 0.6;
}

/** The model that answers the second opinion. `deepseek-flash` is the only
 *  vision-capable DeepSeek id and is pinned per-purpose in LlmService; named
 *  explicitly here so a global LLM_MODEL cannot redirect it. */
export const ESCALATION_MODEL = 'deepseek-flash';
export const ESCALATION_PURPOSE = 'moderation.escalation';

export type JevCategory =
  | 'contact_details'
  | 'social_handles'
  | 'real_name'
  | 'physical_address'
  | 'offplatform_coordination'
  | 'third_party_advertising'
  /** Abusive/threatening/harassing/hateful/sexual language directed at a
   *  person. Not a contact vector, but asked in the same battery because
   *  every user-to-user surface polices it too. */
  | 'abuse';

/** User-facing copy for a block on each category. The conversations path
 *  returns these verbatim; listings/feed pass their own reasons in. */
export const JEV_CATEGORY_REASONS: Record<JevCategory, string> = {
  contact_details:
    'No phone numbers, email addresses or links in messages — keep everything on ALL Outdoor. Once payment goes through, the platform handles the handoff.',
  social_handles:
    'No WhatsApp / social handles in messages — keep everything on ALL Outdoor.',
  real_name:
    'Please keep to usernames — do not share your own or anyone else\u2019s full name in messages.',
  physical_address:
    'No street addresses in messages — physical handoff happens through the courier flow after payment.',
  offplatform_coordination:
    'Keep the conversation on ALL Outdoor — once payment goes through, the platform handles direct contact for delivery.',
  third_party_advertising:
    'No advertising other businesses or services on ALL Outdoor — promotions are not permitted in messages.',
  abuse:
    'Please keep this respectful — abusive, threatening, harassing or sexual language is not allowed on ALL Outdoor.',
};

/**
 * The contact battery. Six atomic nouls, each asking ONE gut-check question
 * (TypeSafe: atomic questions are where a System One model is reliable).
 *
 * ⚠️ `instructions` DESCRIBE INTENT, NOT KEYWORDS. Jev judges whether the
 * text is TRYING to route a deal off-platform; a brand domain in passing, a
 * model name, or a serial number is not contact detail. The criteria make
 * that boundary explicit, which is what keeps false positives down.
 */
export function contactQuestions(): Record<string, JevQuestion> {
  return {
    contact_details: {
      type: 'noul',
      instructions:
        'Does this text give, request or try to hide a phone number, an email address, or a URL/domain that lets the reader contact a person off this platform? Count obfuscation in ANY language — spelled-out digits ("nul sewe vier drie", "zero seven four three"), "name at gmail dot com", digits split by dots or asterisks, leetspeak. This platform is South African: Afrikaans, isiZulu, Sesotho and English are all in scope, and a mixture of them counts. A manufacturer or brand website mentioned in passing, a model name, a calibre or a serial number is NOT this.',
      criteria: {
        true: 'A phone/email/link is present or being conveyed, however disguised',
        false: 'No way to contact a person is offered',
      },
    },
    social_handles: {
      type: 'noul',
      instructions:
        'Does this text name a social or messaging platform (WhatsApp, Telegram, Signal, Instagram, Facebook, TikTok, Snapchat, X/Twitter, YouTube, Reddit) or a handle/profile on one, for the purpose of continuing there? A platform name used as a plain noun without intent to make contact is NOT this.',
      criteria: {
        true: 'A handle or an invitation to a messaging/social platform',
        false: 'No handle and no invitation',
      },
    },
    real_name: {
      type: 'noul',
      instructions:
        'Does this text share a person\u2019s real first name together with a surname (the writer\u2019s own, or someone else\u2019s) in a way that identifies them for contact? A username, a made-up handle, a brand name, a place name or a single first name alone is NOT this.',
      criteria: {
        true: 'A full identifying name (first + surname) is given',
        false: 'Only a username, a single first name, or a brand/place name',
      },
    },
    physical_address: {
      type: 'noul',
      instructions:
        'Does this text give a street address or a meeting location precise enough to physically find a person (a street number and street, a farm name with a district, a shop address)? A suburb, town or city name alone is NOT this.',
      criteria: {
        true: 'A precise address or meeting spot is given',
        false: 'At most a broad area (suburb/town/city)',
      },
    },
    offplatform_coordination: {
      type: 'noul',
      instructions:
        'Is this text trying to move the conversation or the deal off this platform, in ANY language — "DM me", "call me", "let\u2019s chat directly", "pay me directly", "outside the platform", "bypass the fee"; Afrikaans "bel my", "stuur my jou nommer", "buite die platform", "betaal my direk"? Legitimate shipping/collection logistics after a sale, phrased on-platform, is NOT this.',
      criteria: {
        true: 'An attempt to continue or settle off-platform',
        false: 'Normal on-platform negotiation or logistics',
      },
    },
    third_party_advertising: {
      type: 'noul',
      instructions:
        'Is this text advertising, promoting or driving traffic to a third party\u2019s business, shop, service or channel (not the writer\u2019s own ALL Outdoor listing)? Mentioning a brand as part of a product description, or discussing one\u2019s own listing, is NOT this.',
      criteria: {
        true: 'A third party\u2019s business/service/channel is being promoted',
        false: 'Product discussion or one\u2019s own listing only',
      },
    },
  };
}

/**
 * Conduct questions — abuse and harassment, asked alongside the contact
 * battery on every user-to-user surface.
 *
 * ⚠️ DIRECTED AT A PERSON, NOT A RULE ABOUT WORDS. A calm, even harsh,
 * product complaint ("this seller is dishonest, avoid") is NOT abuse; a mild
 * oath ("this damn rifle") is NOT abuse. The question trips only when a
 * person is insulted, threatened, slurred or sexually propositioned, in any
 * language. Probed live 2026-10-01: EN abuse 0.98, AF abuse 0.98, AF sexual
 * 0.94, against 0.01 / 0.31 / 0.34 on the mild and civil controls.
 */
export function conductQuestions(): Record<string, JevQuestion> {
  return {
    abuse: {
      type: 'noul',
      instructions:
        'Does this text contain abusive, threatening, harassing, hateful or sexual language DIRECTED AT A PERSON — swearing/insults, slurs, threats, or a sexual proposition — in ANY language (including Afrikaans)? A calm or even harsh complaint about a product or a seller\u2019s conduct, strong but civil disagreement, mechanical/technical terms, or a mild oath ("this damn rifle") is NOT this. Criticism of an item or a transaction is NOT abuse.',
      criteria: {
        true: 'A person is insulted, threatened, slurred or sexually propositioned',
        false: 'Civil text, even if blunt or negative about an item or a deal',
      },
    },
  };
}

export type JevLadderDecision = 'PASS' | 'BLOCK' | 'REVIEW';

export interface JevTextVerdict {
  decision: JevLadderDecision;
  /** The category that drove the decision, where there is one. */
  category: string | null;
  /** User-facing reason, ready to return on a BLOCK. */
  reason: string | null;
  /** Per-category probability Jev returned, for the audit trail. */
  scores: Record<string, number>;
  /** True when the 60–80 % band sent the text to DeepSeek. */
  escalated: boolean;
  /** Which model produced the deciding answer. */
  source: 'jev' | 'deepseek' | 'none';
}

export interface JevLadderInput {
  /** The user text to judge. */
  state: string;
  /** The full question map — the contact battery plus any surface extras. */
  questions: Record<string, JevQuestion>;
  /** question id -> user-facing reason used when that question blocks. */
  reasons: Record<string, string>;
  /** Ledger label, e.g. 'moderation.contact-filter'. */
  purpose: string;
  /**
   * What to do when Jev errors or is not configured.
   *  - 'pass'   fail-open (conversations today; regex layer remains.)
   *  - 'review' fail-closed to a human (listings, feed.)
   *  - 'block'  fail-closed to a rejection.
   */
  onError: 'pass' | 'review' | 'block';
  timeoutMs?: number;
}

/**
 * Run the battery and apply the operator's ladder.
 *
 * Never throws: an error becomes the caller's chosen fail posture, because a
 * moderation gate that throws takes down the write it was protecting.
 */
export async function jevLadder(
  llm: LlmService,
  input: JevLadderInput,
): Promise<JevTextVerdict> {
  const fail = (): JevTextVerdict => ({
    decision:
      input.onError === 'block'
        ? 'BLOCK'
        : input.onError === 'review'
          ? 'REVIEW'
          : 'PASS',
    category: input.onError === 'pass' ? null : 'moderation_unavailable',
    reason:
      input.onError === 'pass'
        ? null
        : 'We could not check this automatically — it has been sent for review.',
    scores: {},
    escalated: false,
    source: 'none',
  });

  let answers: Record<string, { type: string; noul?: number }>;
  try {
    const res = await llm.decide({
      state: input.state,
      questions: input.questions,
      purpose: input.purpose,
      timeoutMs: input.timeoutMs ?? 10_000,
    });
    answers = res.answers as Record<string, { type: string; noul?: number }>;
  } catch (err) {
    if (err instanceof LlmError) {
      // A refusal to answer is not a finding either — same posture as an error.
    }
    return fail();
  }

  const scores: Record<string, number> = {};
  let topId: string | null = null;
  let topProb = 0;
  for (const [id, answer] of Object.entries(answers)) {
    if (answer?.type !== 'noul') continue;
    const p = typeof answer.noul === 'number' ? answer.noul : 0;
    scores[id] = p;
    if (p > topProb) {
      topProb = p;
      topId = id;
    }
  }

  const block = blockThreshold();
  const review = reviewThreshold();

  if (topId && topProb >= block) {
    return {
      decision: 'BLOCK',
      category: topId,
      reason: input.reasons[topId] ?? JEV_CATEGORY_REASONS[
        topId as JevCategory
      ] ?? 'This message is not allowed on ALL Outdoor.',
      scores,
      escalated: false,
      source: 'jev',
    };
  }

  if (topId && topProb >= review) {
    // 60–80 %: ask DeepSeek before troubling an admin.
    const second = await deepseekOpinion(llm, input.state, topId).catch(
      () => 'UNSURE' as const,
    );
    if (second === 'VIOLATION') {
      return {
        decision: 'BLOCK',
        category: topId,
        reason: input.reasons[topId] ?? JEV_CATEGORY_REASONS[
          topId as JevCategory
        ] ?? 'This message is not allowed on ALL Outdoor.',
        scores,
        escalated: true,
        source: 'deepseek',
      };
    }
    if (second === 'CLEAN') {
      return { decision: 'PASS', category: null, reason: null, scores, escalated: true, source: 'deepseek' };
    }
    // UNSURE (or the call failed) -> admin.
    return {
      decision: 'REVIEW',
      category: topId,
      reason: null,
      scores,
      escalated: true,
      source: 'deepseek',
    };
  }

  return {
    decision: 'PASS',
    category: null,
    reason: null,
    scores,
    escalated: false,
    source: 'jev',
  };
}

/**
 * The 60–80 % second opinion. Returns the model's confidence-limited
 * decision: VIOLATION, CLEAN, or UNSURE (which includes an unparseable
 * answer — "we could not tell" routes to a human, never to a block or a
 * pass). Throws only on a transport error; the caller maps that to UNSURE.
 */
async function deepseekOpinion(
  llm: LlmService,
  state: string,
  category: string,
): Promise<'VIOLATION' | 'CLEAN' | 'UNSURE'> {
  const system = `You are the second-opinion reviewer for ALL Outdoor, a South African outdoor and firearms marketplace. A first model was 60–80% sure the message below violates the platform's no-off-platform-contact rule for the category "${category}".

Reply with JSON ONLY, no prose:
{"decision":"VIOLATION"|"CLEAN"|"UNSURE","category":"<one of: contact_details, social_handles, real_name, physical_address, offplatform_coordination, third_party_advertising>"}

VIOLATION means the message plainly gives, requests or invites a way to contact a person off-platform (a number, email, link, social handle, a full name, a precise address, or "contact me directly"). CLEAN means it is normal on-platform negotiation, product talk, or legitimate post-sale logistics. UNSURE means you genuinely cannot tell. Do not explain.`;
  const msg = await llm.complete({
    system,
    messages: [{ role: 'user', content: state }],
    maxTokens: 100,
    temperature: 0,
    json: {},
    thinking: { budgetTokens: 0 },
    purpose: ESCALATION_PURPOSE,
    model: ESCALATION_MODEL,
    timeoutMs: 15_000,
  });
  const match = msg.text.match(/\{[\s\S]*\}/);
  if (!match) return 'UNSURE';
  try {
    const parsed = JSON.parse(match[0]) as { decision?: string };
    if (parsed.decision === 'VIOLATION') return 'VIOLATION';
    if (parsed.decision === 'CLEAN') return 'CLEAN';
    return 'UNSURE';
  } catch {
    return 'UNSURE';
  }
}
