import { PriceEstimateService } from './price-estimate.service';
import type { LlmResponse } from '../common/llm/llm.types';

// Deterministic-core tests for the resale-value estimator: the comps range,
// the active-asks fallback, the condition depreciation on the web-retail path,
// and the not-enough-data case. The web-anchor's LlmService is stubbed so no
// network call happens. POPIA: assert the result NEVER carries comp rows.

function llmResponse(text: string): LlmResponse {
  return {
    text,
    parts: [{ type: 'text', text }],
    toolCalls: [],
    stopReason: 'end',
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    assistantMessage: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function makeService(overrides: {
  soldPerUnitCents?: number[];
  activeAskCents?: number[];
  webRetailZar?: number | null;
}) {
  const prisma = {
    transaction: {
      findMany: jest.fn().mockResolvedValue(
        (overrides.soldPerUnitCents ?? []).map((c) => ({
          listingPrice: c,
          quantity: 1,
        })),
      ),
    },
    listing: {
      findMany: jest.fn().mockResolvedValue(
        (overrides.activeAskCents ?? []).map((c) => ({ price: c })),
      ),
    },
  };
  // The anchor runs only when a key is configured; leaving it unconfigured is
  // how the tests that want no anchor at all get one.
  //
  // ⚠️ THE ANCHOR IS TWO CALLS NOW — a grounded prose search, then a json
  // extraction over that search's own text. The stub answers BOTH from the
  // same script: call 1 gets the prose, call 2 gets the JSON. A single
  // catch-all mock would have gone on passing against the one-call shape.
  const complete = jest.fn().mockImplementation((req: { json?: unknown }) =>
    req?.json
      ? llmResponse(
          JSON.stringify({ retailZar: overrides.webRetailZar ?? null }),
        )
      : llmResponse('Safari Outdoor lists it at about R10,000 new.'),
  );
  const llm = {
    complete,
    isConfigured: () => overrides.webRetailZar !== undefined,
    model: 'gemini-2.5-flash-lite',
  };
  const svc = new PriceEstimateService(prisma as never, llm as never);
  return { svc, prisma, complete };
}

describe('PriceEstimateService', () => {
  it('leads with sold comps when there are enough (bucketed IQR, aggregate only)', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [
        80000, 85000, 90000, 95000, 100000, 105000, 110000, 115000,
      ],
    });
    const r = await svc.estimate({
      categorySlug: 'camping-outdoor',
      make: 'Engel',
      condition: 'GOOD',
    });
    expect(r.available).toBe(true);
    expect(r.basis).toBe('sold-comps');
    expect(r.confidence).toBe('high'); // >= HIGH_CONFIDENCE_COMPS (8)
    expect(r.soldCount).toBe(8);
    expect(r.low).toBeLessThanOrEqual(r.midpoint!);
    expect(r.midpoint).toBeLessThanOrEqual(r.high!);
    // POPIA — outputs are coarse-bucketed (nearest R50) so no returned figure
    // is an exact realised price, and there are never individual comp rows.
    expect(r.low! % 5000).toBe(0);
    expect(r.midpoint! % 5000).toBe(0);
    expect(r.high! % 5000).toBe(0);
    expect(r).not.toHaveProperty('comps');
    expect(r).not.toHaveProperty('recent');
  });

  it('does NOT return sold comps below the min gate (POPIA — 3 is too few)', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [80000, 100000, 120000], // only 3
      webRetailZar: null,
    });
    const r = await svc.estimate({
      categorySlug: 'camping-outdoor',
      make: 'Engel',
      condition: 'GOOD',
    });
    // 3 comps < MIN_COMPS_FOR_PRIMARY (5) → must NOT surface those rows.
    expect(r.basis).not.toBe('sold-comps');
  });

  it('depreciates a web-anchored retail price by condition when comps are thin', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [], // no comps
      webRetailZar: 10000, // R10,000 new retail
    });
    const r = await svc.estimate({
      title: '45L camping fridge',
      categorySlug: 'camping-outdoor',
      make: 'Engel',
      condition: 'GOOD', // factor 0.58
    });
    expect(r.available).toBe(true);
    expect(r.basis).toBe('web-retail');
    expect(r.confidence).toBe('low');
    // 10000 * 100 * 0.58 = 580000c midpoint, ±12% band, then bucketed to R50.
    expect(r.midpoint).toBe(580000);
    expect(r.low).toBe(Math.round(Math.round(580000 * 0.88) / 5000) * 5000);
    expect(r.high).toBe(Math.round(Math.round(580000 * 1.12) / 5000) * 5000);
    expect(r.low! % 5000).toBe(0);
  });

  it('reaches sold comps via a title proxy when no make is given (sell-form path)', async () => {
    const { svc, prisma } = makeService({
      soldPerUnitCents: [90000, 95000, 100000, 105000, 110000],
    });
    const r = await svc.estimate({
      categorySlug: 'camping-outdoor',
      title: 'Engel MT45 camping fridge', // no make field, like the sell form
      condition: 'GOOD',
    });
    expect(r.available).toBe(true);
    expect(r.basis).toBe('sold-comps');
    // The comp query must have used a title CONTAINS filter (not a make match).
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.listing.title).toBeDefined();
    expect(where.listing.make).toBeUndefined();
  });

  it('falls back to discounted active asks when comps thin and no web anchor', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [],
      activeAskCents: [100000, 110000, 120000, 130000, 140000],
      webRetailZar: null, // web anchor found nothing
    });
    const r = await svc.estimate({
      categorySlug: 'fishing',
      make: 'Shimano',
      condition: 'GOOD',
    });
    expect(r.available).toBe(true);
    expect(r.basis).toBe('active-asks');
    expect(r.activeCount).toBe(5);
    // asks are nudged down by 0.9 before ranging.
    expect(r.midpoint).toBeLessThan(120000);
  });

  it('returns not-available when there is nothing to go on', async () => {
    const { svc } = makeService({ soldPerUnitCents: [], activeAskCents: [] });
    const r = await svc.estimate({
      categorySlug: 'optics',
      make: 'Vortex',
      condition: 'GOOD',
    });
    expect(r.available).toBe(false);
    expect(r.low).toBeUndefined();
    expect(r.disclaimer).toMatch(/guide only/i);
  });

  // ────────────────────────────────────────────────────────────────
  // THE WEB ANCHOR IS SEARCHED, AND IT TAKES TWO CALLS TO STAY THAT WAY.
  //
  // Gemini 2.5 refuses grounding beside json mode, and refuses it QUIETLY —
  // a search runs and is billed while the sources come back empty. So the
  // anchor grounds in prose first and extracts second, and the extraction
  // step is given the RESEARCH NOTE and not the item, so a failed search
  // cannot be laundered into a recalled price by the second turn.
  // ────────────────────────────────────────────────────────────────
  describe('the web retail anchor', () => {
    it('searches first, then extracts — never both in one call', async () => {
      const { svc, complete } = makeService({
        soldPerUnitCents: [],
        webRetailZar: 10000,
      });
      await svc.estimate({
        title: '45L camping fridge',
        categorySlug: 'camping-outdoor',
        make: 'Engel',
        condition: 'GOOD',
      });

      expect(complete).toHaveBeenCalledTimes(2);
      const [search, extract] = complete.mock.calls.map((c) => c[0]);

      // Step 1 grounds, and carries neither of the things Gemini 2.5
      // refuses to combine with grounding.
      expect(search.grounding).toEqual({ web: true });
      expect(search.json).toBeUndefined();
      expect(search.tools).toBeUndefined();

      // Step 2 is the cheap deterministic half: schema on, search off.
      expect(extract.json?.schema).toBeDefined();
      expect(extract.grounding).toBeUndefined();
      expect(extract.thinking).toEqual({ budgetTokens: 0 });
    });

    it('shows the extraction step the research note, not the item', async () => {
      const { svc, complete } = makeService({
        soldPerUnitCents: [],
        webRetailZar: 10000,
      });
      await svc.estimate({
        categorySlug: 'camping-outdoor',
        make: 'Engel',
        model: 'MT45',
        condition: 'GOOD',
      });

      const extract = complete.mock.calls[1][0];
      const sent = JSON.stringify(extract.messages);
      // ⚠️ THE DESCRIPTOR MUST NOT REACH THIS TURN. Give it the item and it
      // can answer from memory when the search found nothing — which is
      // exactly the recalled price the grounded step exists to replace.
      expect(sent).not.toContain('Engel');
      expect(sent).toContain('Safari Outdoor'); // step 1's own text
      expect(extract.system).toMatch(/never supply a price of your own/i);
    });

    it('keeps basis web-retail at low confidence — a searched retail price is still a rough resale guide', async () => {
      const { svc } = makeService({ soldPerUnitCents: [], webRetailZar: 10000 });
      const r = await svc.estimate({
        title: '45L camping fridge',
        categorySlug: 'camping-outdoor',
        make: 'Engel',
        condition: 'GOOD',
      });
      expect(r.basis).toBe('web-retail');
      expect(r.confidence).toBe('low');
    });

    it('falls through to active asks when the search step fails — never to a remembered price', async () => {
      const { svc, complete } = makeService({
        soldPerUnitCents: [],
        activeAskCents: [100000, 110000, 120000, 130000, 140000],
        webRetailZar: 10000, // the extraction WOULD answer, if it were reached
      });
      complete.mockImplementationOnce(() => {
        throw new Error('grounding unavailable');
      });

      const r = await svc.estimate({
        categorySlug: 'fishing',
        make: 'Shimano',
        condition: 'GOOD',
      });
      // Only the failed search ran; the extraction was never attempted, so
      // no ungrounded number could stand in for the searched one.
      expect(complete).toHaveBeenCalledTimes(1);
      expect(r.basis).toBe('active-asks');
    });
  });

  it('always carries the CPA indicative disclaimer', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [50000, 60000, 70000],
    });
    const r = await svc.estimate({ categorySlug: 'knives', make: 'Cold Steel' });
    expect(r.disclaimer).toContain('not a valuation');
  });
});
