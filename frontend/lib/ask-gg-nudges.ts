import { derivePageContext, type AskGgPageKind } from './ask-gg-context';

// Sparkie's proactive nudges (W5.5) — template-driven suggestion
// bubbles keyed on what the user is doing RIGHT NOW (page kind + dwell
// time). Zero AI cost: the intelligence is the moment, not a model
// call. Clicking a nudge opens the panel with the question STAGED in
// the composer — never auto-sent, so the user stays in control and no
// quota is spent until they choose to ask.
//
// Tone rule (operator brief): the aim is to sell, but never obviously —
// every nudge is phrased as help. The actual selling happens inside the
// assistant's ANSWER (fair-price grounding, recommend-complements),
// not in the bubble.
//
// Anti-Clippy discipline (hard caps, all client-side):
//   - max ONE nudge per browser session
//   - min 4h between nudges across sessions
//   - 24h cooldown per page-kind (dismiss also spends it)
//   - never while the panel is open/armed, over the install card, or
//     when the daily hello already fired this page load
//   - only in a visible tab, only after real dwell on the page
//   - never auto-opens anything; × dismisses instantly

export interface AskGgNudge {
  kind: AskGgPageKind;
  /** Bubble copy — one short, helpful sentence. */
  text: string;
  /** Question staged into the composer when tapped. A trailing space
   *  means "the user completes this" (composer gets focus). */
  prefill: string;
  /** Dwell before the bubble may appear, ms. */
  delayMs: number;
}

const NUDGES: Partial<Record<AskGgPageKind, Omit<AskGgNudge, 'kind'>>> = {
  listing: {
    text: 'Want me to check if this price is fair? I can also see what pairs well with it.',
    prefill:
      'Is this listing fairly priced? And what accessories or extras would pair well with it?',
    delayMs: 20_000,
  },
  browse: {
    text: "Hunting for something specific? Tell me what you're after and I'll search the marketplace.",
    prefill: 'Help me find ',
    delayMs: 25_000,
  },
  category: {
    text: 'Not sure what to pick here? I can compare options and find you the right fit.',
    prefill: 'What are good options in this category for ',
    delayMs: 25_000,
  },
  cart: {
    text: 'Any questions about shipping costs or how payment protection works before you check out?',
    prefill: 'How does the payment protection work when I buy, and what will shipping cost?',
    delayMs: 30_000,
  },
  'sell-form': {
    text: 'Want a hand with your listing? I can draft the description and suggest a price.',
    prefill: 'Help me write my listing title and description, and suggest an asking price.',
    delayMs: 15_000,
  },
  order: {
    text: 'Want me to check where this order is and what happens next?',
    prefill: 'What is the status of this order and what happens next?',
    delayMs: 15_000,
  },
  transaction: {
    text: 'Want me to check where this order is and what happens next?',
    prefill: 'What is the status of this order and what happens next?',
    delayMs: 15_000,
  },
  orders: {
    text: 'Need an update on any of your orders? Just ask.',
    prefill: 'Give me an update on my recent orders.',
    delayMs: 20_000,
  },
};

const LAST_NUDGE_KEY = 'gg_askgg_nudge_last';
const KIND_KEY = (k: string) => `gg_askgg_nudge_kind_${k}`;
const SESSION_KEY = 'gg_askgg_nudge_session';
const MIN_GAP_MS = 4 * 3_600_000; // 4h between any two nudges
const KIND_COOLDOWN_MS = 24 * 3_600_000; // 24h per page-kind

/** The nudge for this pathname, or null when the kind has none or a
 *  frequency cap says no. Storage errors → null (never nudge). */
export function pickNudge(pathname: string | null): AskGgNudge | null {
  const { kind } = derivePageContext(pathname);
  const n = NUDGES[kind];
  if (!n) return null;
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return null;
    const now = Date.now();
    const last = Number(localStorage.getItem(LAST_NUDGE_KEY) ?? 0);
    if (now - last < MIN_GAP_MS) return null;
    const kindLast = Number(localStorage.getItem(KIND_KEY(kind)) ?? 0);
    if (now - kindLast < KIND_COOLDOWN_MS) return null;
  } catch {
    return null;
  }
  return { kind, ...n };
}

/** Spend the caps the moment a nudge SHOWS (ignored = still spent —
 *  same rule as the daily hello). */
export function markNudgeShown(kind: AskGgPageKind): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
    localStorage.setItem(LAST_NUDGE_KEY, String(Date.now()));
    localStorage.setItem(KIND_KEY(kind), String(Date.now()));
  } catch {
    /* storage unavailable — caps already made pickNudge return null */
  }
}
