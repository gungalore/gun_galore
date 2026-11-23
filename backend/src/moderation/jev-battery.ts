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
// ⚠️ THE LADDER IS THE OPERATOR'S, EXCEPT THE 60–80 % SECOND OPINION (removed
// 2026-11: "let Jev do everything, keep videos with Gemini"). The band now goes
// straight to the surface's human-review state:
//   - Jev ≥ 80 % sure  -> BLOCK and notify the user with a reason.
//    - 60–80 %          -> admin review (no second model).
//    - < 60 %           -> pass.
// "Admin review" is the surface's own holding state (listing HUMAN_REVIEW,
// feed PENDING_MODERATION, conversation T&S queue). The thresholds are env
// overridable so they can be tuned without a deploy.
//
// ⚠️ THE MODEL NEVER DECIDES ALONE. Every branch here is code reading a
// number Jev returned — see how-to-build-with-system-one. That is also why a
// Jev failure does not silently pass: the caller names its fail posture
// (`onError`) and this honors it.
// ────────────────────────────────────────────────────────────────────

import type { LlmService } from '../common/llm/llm.service';
import type { JevQuestion } from '../common/llm/llm.types';

/** Jev probability at or above which a category is a BLOCK. */
export function blockThreshold(): number {
  const raw = Number(process.env.JEV_BLOCK_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.8;
}

/** Jev probability at or above which a category is held for human review
 *  (the 60–80 % band; there is no second model any more). */
export function reviewThreshold(): number {
  const raw = Number(process.env.JEV_REVIEW_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : 0.6;
}

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

/**
 * FAQ duplicate question — asked on the FIRST buyer message in a listing
 * inquiry, with the listing's published Q&A entries in the same state string.
 *
 * ⚠️ SAME QUESTION, NOT THE SAME TOPIC. Jev is judging whether the seller has
 * already answered the exact thing this buyer needs, so the platform can point
 * them at the public answer instead of creating another thread. A different
 * accessory, spec, condition aspect, size or model variant is NOT a duplicate —
 * the cost of asking the seller is one message; the cost of a wrong "already
 * answered" is a buyer who leaves.
 *
 * High precision is the whole point, so the caller treats only the BLOCK band
 * (>= blockThreshold) as a duplicate and falls through to the seller otherwise.
 */
export function faqQuestions(): Record<string, JevQuestion> {
  return {
    faq_duplicate: {
      type: 'noul',
      instructions:
        'You are given a listing\u2019s published FAQ entries and a new buyer question. Does at least one FAQ entry FULLY answer the new question for the same item, so that asking the seller again would add nothing? Judge the product substance: a different accessory, specification, condition aspect, size, model variant, or a broader/different request is NOT the same question. A question that is merely on the same topic, or that asks something no entry covers, is NOT this.',
      criteria: {
        true: 'An FAQ entry already answers it for the same item',
        false: 'No FAQ entry answers that question',
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
  /** Which model produced the deciding answer. */
  source: 'jev' | 'none';
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
  /**
   * Categories that are reported in `scores` but never drive the ladder.
   * Bad language is the first one: it is MASKED, not blocked, so a high
   * probability on it must not turn a post into a rejection or a human hold.
   */
  nonBlocking?: readonly string[];
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
  } catch {
    return fail();
  }

  const scores: Record<string, number> = {};
  const nonBlocking = new Set(input.nonBlocking ?? []);
  let topId: string | null = null;
  let topProb = 0;
  for (const [id, answer] of Object.entries(answers)) {
    if (answer?.type !== 'noul') continue;
    const p = typeof answer.noul === 'number' ? answer.noul : 0;
    scores[id] = p;
    if (!nonBlocking.has(id) && p > topProb) {
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
      source: 'jev',
    };
  }

  if (topId && topProb >= review) {
    // 60–80 %: a human looks. There is no second model any more (see the
    // ladder note at the top of the file) — asking Jev again is not a second
    // opinion, and a Gemini call here would leave Gemini judging text.
    return {
      decision: 'REVIEW',
      category: topId,
      reason: null,
      scores,
      source: 'jev',
    };
  }

  return {
    decision: 'PASS',
    category: null,
    reason: null,
    scores,
    source: 'jev',
  };
}
