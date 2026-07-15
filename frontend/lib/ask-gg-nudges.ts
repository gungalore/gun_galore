import { derivePageContext, type AskGgPageKind } from './ask-gg-context';

// GG's proactive coaching (W5.5 → site-guide G1) — template-driven, page-kind
// keyed tips shown as a bubble when the user settles on a page. ZERO AI cost:
// the intelligence is the moment + curated copy, not a model call. Tapping a
// tip opens the panel with the question STAGED in the composer — never
// auto-sent, so no quota is spent until the user chooses to ask.
//
// Frequency (G1 — "a good guide, not naggy"): each page-KIND shows its tip at
// most ONCE PER SESSION. Revisit the same kind and GG falls back to a short
// hello (see the launcher) — present, but not repeating himself. A fresh
// session shows the tips again. Muting (lib/ask-gg-mute) silences all of it.
//
// Discipline (all client-side, enforced in the launcher):
//   - never while the panel is open, over the install card, tab hidden, or
//     the user is mid-form
//   - only after real dwell on the page; × dismisses instantly
//   - never auto-opens anything
//
// NOTE: richer, live-STATE-aware guidance (e.g. auction winning/outbid) lands
// in the server-driven Guide engine (waves G2–G4); this file stays the cheap
// client-only "headline tip per page kind".

export interface AskGgNudge {
  kind: AskGgPageKind;
  /** Bubble copy — one short, helpful sentence. */
  text: string;
  /** Question staged into the composer when tapped. A trailing space
   *  means "the user completes this" (composer gets focus). */
  prefill: string;
}

const NUDGES: Partial<Record<AskGgPageKind, Omit<AskGgNudge, 'kind'>>> = {
  listing: {
    text: 'Want me to check if this price is fair? I can also see what pairs well with it.',
    prefill:
      'Is this listing fairly priced? And what accessories or extras would pair well with it?',
  },
  browse: {
    text: "Hunting for something specific? Tell me what you're after and I'll search the marketplace.",
    prefill: 'Help me find ',
  },
  category: {
    text: 'Not sure what to pick here? I can compare options and find you the right fit.',
    prefill: 'What are good options in this category for ',
  },
  cart: {
    text: 'Any questions about shipping costs or how payment protection works before you check out?',
    prefill: 'How does the payment protection work when I buy, and what will shipping cost?',
  },
  'sell-form': {
    text: 'Want a hand with your listing? I can draft the description and suggest a price.',
    prefill: 'Help me write my listing title and description, and suggest an asking price.',
  },
  order: {
    text: 'Want me to check where this order is and what happens next?',
    prefill: 'What is the status of this order and what happens next?',
  },
  transaction: {
    text: 'Want me to check where this order is and what happens next?',
    prefill: 'What is the status of this order and what happens next?',
  },
  orders: {
    text: 'Need an update on any of your orders? Just ask.',
    prefill: 'Give me an update on my recent orders.',
  },
  wanted: {
    text: "Can't find it in the listings? I'll help you post a Wanted ad — it's free and sellers come to you.",
    prefill: 'Help me post a Wanted ad for the item I am looking for.',
  },
  wishlist: {
    text: 'Want me to compare your saved items and help you pick the best buy?',
    prefill: 'Help me compare the items on my wishlist and decide which is the best buy.',
  },
  subscribe: {
    text: 'Not sure GG+ is worth it? I can compare the tiers against what you actually use.',
    prefill: 'Compare the GG+ Member and Pro tiers and their perks — which suits me?',
  },
  dashboard: {
    text: 'Want to know exactly what lifts your seller tier and trust score? Ask me.',
    prefill: 'What do I need to do to reach the next seller tier?',
  },
  swaps: {
    text: 'New to swaps? I can walk you through how a trade completes safely, step by step.',
    prefill: 'Walk me through how a Swop works from proposal to completion.',
  },
  earnings: {
    text: 'Want me to check whether anything is holding up a payout, and how to clear it?',
    prefill: 'Is anything blocking my payouts right now, and how do I fix it?',
  },
  'saved-searches': {
    text: "I can set you up to be alerted the moment a matching item is listed. Want to?",
    prefill: 'How do saved-search alerts work, and how do I set one up?',
  },
};

// Per-KIND, per-SESSION — once shown, that kind is quiet until a new session.
const KIND_SESSION_KEY = (k: string) => `gg_coach_kind_${k}`;

/** The tip for this pathname, or null when the kind has none or its
 *  once-per-session slot is already spent. Storage errors → null. */
export function pickNudge(pathname: string | null): AskGgNudge | null {
  const { kind } = derivePageContext(pathname);
  const n = NUDGES[kind];
  if (!n) return null;
  try {
    if (sessionStorage.getItem(KIND_SESSION_KEY(kind))) return null;
  } catch {
    return null;
  }
  return { kind, ...n };
}

/** Spend this kind's once-per-session slot the moment its tip SHOWS
 *  (dismiss also spends it — same rule as the hello). */
export function markNudgeShown(kind: AskGgPageKind): void {
  try {
    sessionStorage.setItem(KIND_SESSION_KEY(kind), '1');
  } catch {
    /* storage unavailable — pickNudge already handles that path */
  }
}
