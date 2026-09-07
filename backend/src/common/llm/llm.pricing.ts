// ────────────────────────────────────────────────────────────────────
// WHAT A CALL COSTS. One place, so the ledger's money column has one
// author and a price change is one edit.
//
// ⚠️ READ FROM https://ai.google.dev/gemini-api/docs/pricing ON 2026-09-07,
// PAID TIER. Re-read it before trusting an old number — Google has repriced
// this family before, and a stale constant does not fail, it just quietly
// reports the wrong spend on /admin/credits.
//
//   gemini-2.5-flash-lite    input  $0.10 / 1M  (text, image, video)
//                            output $0.40 / 1M
//                            cached $0.01 / 1M  (context caching)
//   gemini-3.5-flash-lite    input  $0.30 / 1M  (text, image, video, audio)
//                            output $2.50 / 1M
//                            cached $0.03 / 1M
//
// ⚠️ 3.5 IS HERE BECAUSE 2.5 MAY NOT BE REACHABLE. On 2026-09-07 a freshly
// created key was refused 2.5-flash-lite with "no longer available to new
// users" while the public pages still list it as stable; the API told us to
// use 3.5-flash-lite. Whichever LLM_MODEL names is what the ledger prices.
// Grounding with Google Search is separate: 1,500 grounded prompts a day
// free, then $35 per 1,000 — not tokens, so not in this table.
//
// Audio input is $0.30/1M. We do not send audio anywhere on this platform,
// so the ledger prices every input token at the text rate; if an audio call
// site ever appears, this comment is the thing that has to change with it.
// ────────────────────────────────────────────────────────────────────

/** USD per million tokens, by model id. */
interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  /** Cache-hit input tokens, billed cheaper than fresh input. */
  cachedInputPerMillion: number;
}

const PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash-lite': {
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    cachedInputPerMillion: 0.01,
  },
  'gemini-3.5-flash-lite': {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
    cachedInputPerMillion: 0.03,
  },
};

/**
 * Micro-dollars (USD × 1 000 000) for one call.
 *
 * PURE. Spec:
 *  - Returns an integer; fractions of a micro-dollar are rounded to
 *    nearest. A flash-lite call is often worth a few hundred micros, so
 *    integer micros is the smallest unit that never rounds a real call to
 *    zero while still fitting an `Int` column for any plausible volume.
 *  - `cachedInputTokens` are billed at the cache rate and are assumed to
 *    be INCLUDED in `inputTokens` — that is how `usageMetadata` reports
 *    them (promptTokenCount counts the cached tokens too), so they are
 *    subtracted from the full-rate input before pricing. Guarded at zero
 *    so a provider that ever reports them separately cannot go negative.
 *  - `thinkingTokens` are billed as OUTPUT by Gemini, and are likewise
 *    already inside `candidatesTokenCount`, so they are not added again.
 *  - An unpriced model returns 0. ⚠️ Anthropic rows are deliberately 0:
 *    that path is rollback insurance, its spend is visible in Anthropic's
 *    own console, and carrying a second price table that nobody checks is
 *    a worse lie than an honest zero. `/admin/credits` reads Gemini.
 */
export function costUsdMicros(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): number {
  const price = PRICES[args.model];
  if (!price) return 0;

  const cached = Math.max(0, args.cachedInputTokens ?? 0);
  const freshInput = Math.max(0, args.inputTokens - cached);

  const usd =
    (freshInput / 1_000_000) * price.inputPerMillion +
    (cached / 1_000_000) * price.cachedInputPerMillion +
    (Math.max(0, args.outputTokens) / 1_000_000) * price.outputPerMillion;

  return Math.round(usd * 1_000_000);
}

/** True when we can put a real number on this model's spend. */
export function isPricedModel(model: string): boolean {
  return model in PRICES;
}
