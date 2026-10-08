import { costUsdMicros } from '../common/llm/llm.pricing';

/**
 * Per-valuation spend estimate. A plain class (not a singleton) so state never
 * leaks between valuations. It drives the convergence/stop logic and the soft
 * cost guide; it is not a hard cap and has no UI.
 *
 * Serper per-call cost is a guide (SERPER_USD_PER_CALL); LLM cost comes from
 * the real token usage priced by llm.pricing. Both are converted at
 * VALUATION_USD_ZAR.
 */
export class ValuationCostMeter {
  private usdMicros = 0;
  private serperCalls = 0;

  recordSerper(calls = 1): void {
    this.serperCalls += calls;
    const perCall = Number(process.env.SERPER_USD_PER_CALL ?? 0.001);
    this.usdMicros += Math.round(perCall * 1_000_000) * calls;
  }

  recordLlm(usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } | undefined, model: string): void {
    if (!usage) return;
    this.usdMicros += costUsdMicros({
      model,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens,
    });
  }

  usd(): number {
    return this.usdMicros / 1_000_000;
  }

  zar(): number {
    const rate = Number(process.env.VALUATION_USD_ZAR ?? 18);
    return this.usd() * rate;
  }

  serperCount(): number {
    return this.serperCalls;
  }

  /** True once spend has passed the soft guide. A signal, never a hard stop. */
  overSoftGuide(): boolean {
    const guideCents = Number(process.env.VALUATION_SOFT_COST_CENTS ?? 500);
    return this.zar() * 100 >= guideCents;
  }

  summary(): { usd: number; zar: number; serperCalls: number; overGuide: boolean } {
    return {
      usd: Number(this.usd().toFixed(4)),
      zar: Number(this.zar().toFixed(2)),
      serperCalls: this.serperCalls,
      overGuide: this.overSoftGuide(),
    };
  }
}
