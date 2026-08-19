// THE single source of truth for what an AO PRO subscription actually unlocks.
//
// WHY THIS FILE EXISTS. The perk list used to be copy-pasted per page, and the
// copies had already drifted: /subscribe advertised 7 perks, the /ask-gg
// comparison table showed 6 different rows, and /fees described 4 in prose. A
// reader could get three different answers to "what do I get for R99".
//
// NO `'use client'` DIRECTIVE, deliberately. These are plain data values, and a
// Server Component that imports a value from a client module blows up at
// runtime with an opaque digest (`.map is not a function`). Keeping this a
// plain module means any page — server or client — can import it.
//
// ─── EVERY LINE HERE IS SERVER-ENFORCED TODAY ────────────────────────────────
// Verified against the actual gate, not against what marketing copy claimed.
// Three previously-advertised perks are DELIBERATELY ABSENT because a paying
// member would not receive them:
//
//   • "25% off swap service fees" — the discount only applies inside funding
//     setup, which sits behind assertPaymentsLive(); the negotiation-time quote
//     omits the PRO flag entirely, so a PRO member is quoted the full fee.
//   • "50% off featured-listing bids" — never actually charged (both collection
//     paths are behind assertPaymentsLive()), and mis-described: the discount
//     reduces the fee you pay IF YOU WIN, not your bid. The face bid is
//     deliberately undiscounted.
//   • "Ballistic calculator" — there is no calculator screen. It was retired on
//     2026-07-13; only the Ask Boet chat tool survives, which is why the line
//     below describes it as something you ask Boet for.
//
// Also absent: "unlimited messages" (60/hour is a hard cap that cannot be
// configured to unlimited) and prize-draw entry (see the note on
// PRO_PERKS_PUBLIC below — that omission is a legal one, not a factual one).
//
// If you add a line here, first find the code that enforces it.

/**
 * The full list. For AUTHENTICATED surfaces only (/subscribe, account screens).
 *
 * Names Load Lab, calibres and ballistics openly, which is correct behind the
 * login and NOT correct in front of it — see PRO_PERKS_PUBLIC.
 */
export const PRO_PERKS: string[] = [
  'Ask Boet: 60 questions an hour — free accounts get 5 every 30 days',
  'Photo identification with no monthly cap — up to 10 photos per question',
  'Every published load in the Load Lab, with source manual and page citations',
  'Recommended loads for your calibre and bullet weight, quoted from the manuals',
  'Drop, wind and retained-energy figures — just ask Boet in the chat',
  'Boet cross-references real-world results online, not only the manuals',
  'Unlimited open swap proposals — free accounts run one at a time',
  'The AO PRO badge on your profile, listings and questions',
];

/**
 * The PUBLIC-SAFE list, for surfaces a signed-out visitor or a crawler reaches.
 *
 * ⚠️ THIS IS NOT A SHORTER LIST — IT IS THE SAME PERKS, WORDED WITHOUT FIREARM
 * SIGNAL, and that is load-bearing. `/raffle(.*)` is in isPublicRoute
 * (middleware.ts:25). The whole reason regulated categories sit behind the auth
 * wall is that Meta was blocking the site and killing WhatsApp Business — so
 * publishing "calibre", "bullet weight", "reloading manuals" or "ballistics" on
 * a page anonymous visitors and crawlers can read would hand back exactly the
 * signal that gating cost us ~111 URLs to remove.
 *
 * Behind the login, use PRO_PERKS and name things properly.
 *
 * NOTE ON THE PRIZE DRAW: entry is deliberately NOT listed as a perk here. On
 * the draw page itself, a bullet reading "entry into the prize draw" inside a
 * list of things your money buys is the pay-to-enter framing the whole page is
 * carefully written to avoid. The page explains entry in prose instead.
 */
export const PRO_PERKS_PUBLIC: string[] = [
  'Ask Boet: 60 questions an hour — free accounts get 5 every 30 days',
  'Photo identification with no monthly cap — up to 10 photos per question',
  'Full access to the technical reference library, with source citations',
  'Boet cross-references real-world results online, not only the reference books',
  'Unlimited open swap proposals — free accounts run one at a time',
  'The AO PRO badge on your profile, listings and questions',
];

/**
 * Shown wherever we describe AO PRO while card payments are still switched off.
 *
 * `subscriptions.service.ts` calls assertPaymentsLive() as the FIRST statement
 * of checkout(), so every "subscribe" button on the site currently 503s and
 * lands the user on a "launching soon" screen AFTER they have clicked. Saying
 * it before the click is the honest ordering.
 */
export const PRO_LAUNCHING_SOON = 'Card payments are launching soon.';
