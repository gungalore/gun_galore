import { ValuationCostMeter } from './cost-meter';

describe('ValuationCostMeter', () => {
  beforeEach(() => {
    process.env.SERPER_USD_PER_CALL = '0.001';
    process.env.VALUATION_USD_ZAR = '18';
    process.env.VALUATION_SOFT_COST_CENTS = '500';
  });

  it('adds Serper calls and converts to rand', () => {
    const m = new ValuationCostMeter();
    m.recordSerper(10);
    expect(m.serperCount()).toBe(10);
    expect(m.usd()).toBeCloseTo(0.01, 5);
    expect(m.zar()).toBeCloseTo(0.18, 2);
    expect(m.overSoftGuide()).toBe(false);
  });

  it('adds LLM usage priced by model', () => {
    const m = new ValuationCostMeter();
    m.recordLlm({ inputTokens: 90_000, outputTokens: 9_000 }, 'qwen3.8-flash');
    expect(m.usd()).toBeGreaterThan(0);
    expect(m.zar()).toBeGreaterThan(0);
  });

  it('reports over the soft guide when spend passes it', () => {
    const m = new ValuationCostMeter();
    m.recordSerper(1_000_000); // absurd volume to force the guide
    expect(m.overSoftGuide()).toBe(true);
    expect(m.summary().overGuide).toBe(true);
  });
});
