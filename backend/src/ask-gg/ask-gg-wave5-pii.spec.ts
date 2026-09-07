// Ask GG Everywhere — Wave 5 PII GATE (BLOCKING).
//
// Every wrapped service is mocked to return rows POISONED with every
// category of sensitive data the real services can carry (emails,
// phones, real names, bank numbers, EFT references, carrier PINs,
// addresses, licence refs, counterparty free text). The serialized
// tool outputs must contain NONE of it — plus structural scans: no
// email-shaped strings, no 9+ digit runs, no forbidden key names.
// Cross-user probes must collapse to "not found on your account".
//
// If any assertion here fails, W5 does not deploy. No exceptions.

jest.mock('meilisearch', () => ({
  Meilisearch: class {},
  MeilisearchApiError: class extends Error {},
}));

import {
  AskGgAccountToolsService,
  AskGgAccount,
} from './ask-gg-account-tools.service';
import { AskGgModelService } from './ask-gg-model.service';
import {
  LlmError,
  type LlmRequest,
  type LlmResponse,
} from '../common/llm/llm.types';
import type { PrismaService } from '../prisma/prisma.service';

const ACCOUNT: AskGgAccount = { clerkId: 'clerk_me', userId: 'u_me' };

// ─── Poison markers — none may survive serialization ─────────────────
const POISON = {
  email: 'victim@leak-test.com',
  phone: '+27821234567',
  spacedPhone: '082 111 2223', // space-formatted — must still be caught
  firstName: 'Gerhardus',
  lastName: 'Fourie',
  bankAccount: '62899901234',
  spacedBank: '6289 9901-234', // space/dash-formatted bank number
  branchCode: '250655',
  pin: '9911',
  street: '12 Secret Street',
  licenceRef: 'LIC-778899',
  eftReference: 'GGSWAP991122334',
  clerkId: 'user_clerk_victim_2ab',
  locationText: 'Farm 7, Waterberg district',
  peachId: 'peach_889900112233',
  proofCode: 'PROOF-9Q2K',
  freeText: 'WhatsApp me on 082 111 2223 for a deal outside the platform',
};

const FORBIDDEN_SUBSTRINGS = [
  POISON.email,
  'leak-test',
  POISON.phone,
  POISON.spacedPhone,
  POISON.firstName,
  POISON.lastName,
  POISON.bankAccount,
  POISON.spacedBank,
  POISON.branchCode,
  POISON.pin,
  POISON.street,
  POISON.licenceRef,
  POISON.eftReference,
  POISON.clerkId,
  'clerk_victim',
  POISON.locationText,
  'Waterberg',
  POISON.peachId,
  POISON.proofCode,
  'WhatsApp me',
];

const FORBIDDEN_KEYS = [
  '"email"',
  '"phone"',
  '"firstName"',
  '"lastName"',
  '"deliveryAddress"',
  '"carrierDropoffPin"',
  '"bankDetails"',
  '"accountNumber"',
  '"branchCode"',
  '"myReference"',
  '"winnerLicenceRef"',
  '"buyerNote"',
  '"sellerNote"',
  '"idNumber"',
  '"clerkId"',
  '"locationText"',
  '"peachCheckoutId"',
  '"giveProofCode"',
];

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const LONG_DIGIT_RUN = /\d{9,}/;

function assertClean(serialized: string) {
  for (const s of FORBIDDEN_SUBSTRINGS) {
    expect(serialized).not.toContain(s);
  }
  for (const k of FORBIDDEN_KEYS) {
    expect(serialized).not.toContain(k);
  }
  expect(serialized).not.toMatch(EMAIL_RE);
  expect(serialized).not.toMatch(LONG_DIGIT_RUN);
  // Whitespace/dash-tolerant scan: a bank/phone number formatted
  // "6289 9901-234" must not slip the digit-run net.
  expect(serialized.replace(/[\s-]/g, '')).not.toMatch(LONG_DIGIT_RUN);
}

// ─── Poisoned wrapped-service mocks ───────────────────────────────────
const txRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'tx_1',
  buyerId: 'u_me',
  sellerId: 'u_other',
  quantity: 1,
  listingPrice: 250_000,
  buyerTotal: 265_000,
  sellerPayout: 230_000,
  paymentStatus: 'HELD',
  shippingStatus: 'PENDING',
  trackingReference: 'PUD12345',
  paidAt: new Date('2026-07-01'),
  acceptedAt: null,
  dispatchedAt: null,
  deliveredAt: null,
  releasedAt: null,
  // Poison the raw row exactly like the real service can:
  deliveryAddress: { street: POISON.street, city: 'Pretoria' },
  carrierDropoffPin: POISON.pin,
  listing: { title: 'Vortex Viper 5-25x50', isFirearm: false },
  buyer: {
    username: 'buyer_bob',
    email: POISON.email,
    phone: POISON.phone,
    firstName: POISON.firstName,
    lastName: POISON.lastName,
  },
  seller: { username: 'seller_sue', email: POISON.email },
  dealer: { name: 'Dealer X', address: POISON.street },
  ...overrides,
});

function makeSvc() {
  const prisma = {
    transaction: { findUnique: jest.fn() },
    order: { findFirst: jest.fn() },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ kycStatus: 'PENDING', profileCompletedAt: null }),
    },
  };
  const users = {
    getUrgentSummary: jest.fn().mockResolvedValue({
      notifications: [
        {
          id: 'kyc-required',
          label: 'Verify identity to release payout',
          href: '/kyc/verify',
          severity: 'critical',
        },
      ],
    }),
  };
  const transactions = {
    findForUser: jest.fn().mockResolvedValue([txRow()]),
  };
  const offers = {
    getMyOffers: jest.fn().mockResolvedValue([
      {
        id: 'of_1',
        status: 'PENDING',
        offerAmount: 100_000,
        counterAmount: null,
        expiresAt: new Date('2026-07-20'),
        buyerNote: POISON.freeText,
        sellerNote: POISON.freeText,
        listing: {
          title: 'Leupold VX-5HD',
          // Real select is {username, clerkId} — poison both extras.
          seller: {
            username: 'seller_sue',
            clerkId: POISON.clerkId,
            email: POISON.email,
          },
        },
      },
    ]),
    getReceivedOffers: jest.fn().mockResolvedValue([
      {
        id: 'of_2',
        status: 'COUNTERED',
        offerAmount: 90_000,
        counterAmount: 95_000,
        expiresAt: new Date('2026-07-21'),
        buyerNote: POISON.freeText,
        listing: { title: 'Hunting knife' },
        // Real select is {username, clerkId, totalSales}.
        buyer: {
          username: 'buyer_bob',
          clerkId: POISON.clerkId,
          totalSales: 3,
          phone: POISON.phone,
        },
      },
    ]),
  };
  const auctions = {
    getMyBids: jest.fn().mockResolvedValue([
      {
        bidId: 'b1',
        listingId: 'l1',
        listingTitle: 'Tikka T3x',
        listingStatus: 'ACTIVE',
        myMaxAmount: 1_500_000,
        myLastBidAmount: 1_450_000,
        currentBid: 1_500_000,
        youAreHighBidder: true,
        isWinner: false,
        endTime: new Date('2026-08-01'),
      },
    ]),
  };
  const sellerTools = {
    payoutStatement: jest.fn().mockResolvedValue({
      period: { from: '2026-06-12', to: '2026-07-12' },
      summary: {
        orderCount: 3,
        grossSales: 2_500_000,
        totalCommission: 200_000,
        totalProcessingFees: 50_000,
        totalShipping: 30_000,
        netPayout: 2_250_000,
        refundedCount: 0,
      },
      orders: [
        {
          id: 't9',
          reference: 'GG-77',
          date: new Date('2026-07-02'),
          listingTitle: 'Rifle sling',
          buyerUsername: 'buyer_bob',
          status: 'RELEASED',
          listingPrice: 100_000,
          commission: 8_000,
          processingFee: 2_000,
          shipping: 5_000,
          netPayout: 85_000,
        },
      ],
    }),
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const svc = new AskGgAccountToolsService(
    prisma as unknown as PrismaService,
    users as any,
    transactions as any,
    offers as any,
    auctions as any,
    sellerTools as any,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { svc, prisma };
}

describe('W5 PII gate — every tool output is clean under poisoned inputs', () => {
  it('getMyAccountOverview', async () => {
    const { svc } = makeSvc();
    assertClean(JSON.stringify(await svc.getMyAccountOverview(ACCOUNT)));
  });

  it('getMyPurchases lifts usernames only, never address/PIN/party contact', async () => {
    const { svc } = makeSvc();
    const out = await svc.getMyPurchases(ACCOUNT);
    const s = JSON.stringify(out);
    assertClean(s);
    expect(s).toContain('seller_sue'); // username IS allowed
    expect(s).toContain('/transactions/tx_1'); // href present
  });

  it('getMySales never lifts carrierDropoffPin even for the seller', async () => {
    const { svc } = makeSvc();
    const s = JSON.stringify(await svc.getMySales(ACCOUNT));
    assertClean(s);
    expect(s).toContain('buyer_bob');
  });

  it('getOrderStatus — own transaction: clean + timeline + nextAction', async () => {
    const { svc, prisma } = makeSvc();
    (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
      id: 'tx_1',
      buyerId: 'u_me',
      sellerId: 'u_other',
      quantity: 1,
      listingPrice: 250_000,
      buyerTotal: 265_000,
      paymentStatus: 'HELD',
      shippingStatus: 'PENDING',
      shippingMethod: 'PUDO_L2L',
      trackingReference: 'PUD12345',
      paidAt: new Date('2026-07-01'),
      acceptedAt: null,
      dispatchedAt: null,
      deliveredAt: null,
      releasedAt: null,
      listing: { title: 'Vortex Viper', isFirearm: false },
    });
    const out = (await svc.getOrderStatus(ACCOUNT, 'tx_1')) as {
      found: boolean;
      nextAction?: string;
    };
    expect(out.found).toBe(true);
    expect(out.nextAction).toContain('seller');
    assertClean(JSON.stringify(out));
  });

  it("getOrderStatus — SOMEONE ELSE'S transaction: uniform not-found, zero leakage", async () => {
    const { svc, prisma } = makeSvc();
    (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
      id: 'tx_foreign',
      buyerId: 'u_alice',
      sellerId: 'u_bob',
      quantity: 1,
      listingPrice: 1,
      buyerTotal: 1,
      paymentStatus: 'HELD',
      shippingStatus: null,
      shippingMethod: null,
      trackingReference: 'SECRET999',
      paidAt: null,
      acceptedAt: null,
      dispatchedAt: null,
      deliveredAt: null,
      releasedAt: null,
      listing: { title: 'Foreign item', isFirearm: false },
    });
    (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);
    const out = await svc.getOrderStatus(ACCOUNT, 'tx_foreign');
    const s = JSON.stringify(out);
    expect(out).toEqual({ found: false, note: 'Not found on your account.' });
    expect(s).not.toContain('Foreign item');
    expect(s).not.toContain('SECRET999');
  });

  it('getOrderStatus — malformed / injection references collapse to not-found without touching the DB', async () => {
    const { svc, prisma } = makeSvc();
    for (const bad of ['', '../../etc/passwd', 'a b', 'x'.repeat(80)]) {
      const out = await svc.getOrderStatus(ACCOUNT, bad);
      expect(out).toEqual({ found: false, note: 'Not found on your account.' });
    }
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
  });

  it('getMyOffersAndBids drops counterparty notes + contact fields', async () => {
    const { svc } = makeSvc();
    const s = JSON.stringify(await svc.getMyOffersAndBids(ACCOUNT));
    assertClean(s);
    expect(s).toContain('Leupold');
    expect(s).toContain('buyer_bob');
  });


  it('getSellerEarnings surfaces blockers without any account numbers', async () => {
    const { svc } = makeSvc();
    const out = await svc.getSellerEarnings(ACCOUNT);
    const s = JSON.stringify(out);
    assertClean(s);
    expect(s).toContain('KYC');
    expect(s).toContain('/kyc/verify');
    expect(out.summary.netPayoutRand).toBe(22_500);
  });
});

// ─── The LlmService double ───────────────────────────────────────────
// Ask GG speaks the provider-neutral contract now, so the spec's job is
// to hand it LlmResponse objects, not an SDK-shaped mock. `complete` is
// a jest.fn the test scripts turn by turn; `stream` replays the same
// scripted responses as text deltas + a done event.
function llmResponse(over: Partial<LlmResponse> = {}): LlmResponse {
  const parts = over.parts ?? [{ type: 'text' as const, text: over.text ?? '' }];
  return {
    text: over.text ?? '',
    parts,
    toolCalls: over.toolCalls ?? [],
    stopReason: over.stopReason ?? 'end',
    usage: over.usage ?? { inputTokens: 10, outputTokens: 5 },
    model: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    assistantMessage: over.assistantMessage ?? {
      role: 'assistant',
      content: parts,
    },
    // Grounding is optional on the contract and absent unless a test asks
    // for it — undefined means "this call was not grounded".
    ...(over.groundingSources ? { groundingSources: over.groundingSources } : {}),
    ...(over.webSearchQueries ? { webSearchQueries: over.webSearchQueries } : {}),
  };
}

function fakeLlm(script: LlmResponse[] = []) {
  const queue = [...script];
  const next = () => queue.shift() ?? llmResponse({ text: 'done' });
  const complete = jest.fn(async (_req: LlmRequest) => next());
  return {
    provider: 'gemini' as const,
    model: 'gemini-2.5-flash-lite',
    isConfigured: () => true,
    complete,
    // eslint-disable-next-line @typescript-eslint/require-await
    stream: jest.fn(async function* () {
      const r = next();
      if (r.text) yield { type: 'text' as const, delta: r.text };
      yield { type: 'done' as const, response: r };
    }),
    ping: jest.fn(),
  };
}

describe('W5 fail-closed + budget gates (handleToolCall)', () => {
  function makeModelSvc(accountTools: unknown, llm = fakeLlm()) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return new AskGgModelService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      accountTools as any,
      llm as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
  // An LlmToolCall, not an SDK tool_use block. handleToolCall never
  // reaches the model, so the double only has to exist.
  const call = { id: 'toolu_1', name: 'getMyPurchases', input: {} };

  it('no authenticated account → isError, tool never invoked', async () => {
    const accountTools = { getMyPurchases: jest.fn() };
    const svc = makeModelSvc(accountTools);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const out = await (svc as any).handleToolCall(
      call,
      [],
      [],
      { marketplace: 0, platform: 0, account: 0 },
      'FREE',
      false,
      undefined, // ← no account
    );
    expect(out[0].isError).toBe(true);
    // Every result names its own tool — Gemini keys results by name, so a
    // nameless tool_result is silently unmatched rather than an error.
    expect(out[0].name).toBe('getMyPurchases');
    expect(out[0].toolCallId).toBe('toolu_1');
    expect(accountTools.getMyPurchases).not.toHaveBeenCalled();
  });

  it('account budget exhausts at 4 calls', async () => {
    const accountTools = {
      getMyPurchases: jest.fn().mockResolvedValue({ purchases: [] }),
    };
    const svc = makeModelSvc(accountTools);
    const budget = { marketplace: 0, platform: 0, account: 4 };
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const out = await (svc as any).handleToolCall(
      call,
      [],
      [],
      budget,
      'FREE',
      false,
      ACCOUNT,
    );
    expect(out[0].isError).toBe(true);
    expect(accountTools.getMyPurchases).not.toHaveBeenCalled();
  });

  it('a tool result is echoed back as a user turn of tool_result parts', async () => {
    const accountTools = {
      getMyPurchases: jest.fn().mockResolvedValue({ purchases: [] }),
    };
    const llm = fakeLlm([
      llmResponse({
        toolCalls: [{ id: 'toolu_1', name: 'getMyPurchases', input: {} }],
        stopReason: 'tool_use',
        parts: [
          { type: 'tool_call', id: 'toolu_1', name: 'getMyPurchases', input: {} },
        ],
      }),
      llmResponse({ text: 'Nothing on your account yet.' }),
    ]);
    const svc = makeModelSvc(accountTools, llm);
    const out = await svc.complete([{ role: 'user', content: 'my orders?' }], {
      account: ACCOUNT,
    });

    expect(out.content).toBe('Nothing on your account yet.');
    expect(accountTools.getMyPurchases).toHaveBeenCalled();
    expect(llm.complete).toHaveBeenCalledTimes(2);
    // Turn 2 carries: the assistant turn verbatim, then a user turn whose
    // content is the tool_result parts.
    const second = llm.complete.mock.calls[1][0];
    expect(second.purpose).toBe('askgg.tool-turn');
    const last = second.messages[second.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'toolu_1',
        name: 'getMyPurchases',
      }),
    ]);
    expect(second.messages[second.messages.length - 2].role).toBe('assistant');
    // ⚠️ THE TOOL SET STILL DOES NOT VARY BY TIER, AND GROUNDING NEVER RIDES
    // AN ANSWER TURN. Web search came back on 2026-09-07 — but Gemini 2.5
    // refuses grounding beside function declarations, so it runs as its own
    // turn afterwards. A `grounding` flag here would be a bad_request at the
    // adapter, and a `web_search` in this array would be the old shape.
    expect((second.tools ?? []).some((t) => t.name === 'web_search')).toBe(
      false,
    );
    expect(second.grounding).toBeUndefined();
  });

  it('streaming pushes every delta and persists the same text', async () => {
    const llm = fakeLlm([llmResponse({ text: 'Streamed answer.' })]);
    const svc = makeModelSvc({}, llm);
    const deltas: string[] = [];
    const out = await svc.complete([{ role: 'user', content: 'hi' }], {
      onText: (d) => deltas.push(d),
    });
    expect(deltas.join('')).toBe('Streamed answer.');
    expect(out.content).toBe('Streamed answer.');
    expect(llm.stream).toHaveBeenCalled();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('a provider failure is fail-open: the canned reply, never a throw', async () => {
    const llm = fakeLlm();
    llm.complete.mockRejectedValue(
      new LlmError('rate_limited', 'slow down', 429),
    );
    const svc = makeModelSvc({}, llm);
    const out = await svc.complete([{ role: 'user', content: 'hi' }]);
    expect(out.content).toContain('temporary problem');
    expect(out.model).toBe('gemini-2.5-flash-lite');
  });

  it('an unconfigured provider returns the offline placeholder', async () => {
    const llm = fakeLlm();
    llm.isConfigured = () => false;
    const svc = makeModelSvc({}, llm);
    const out = await svc.complete([{ role: 'user', content: 'hi' }]);
    expect(out.content).toContain('temporarily offline');
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// THE GROUNDED SOURCES TURN, END TO END.
//
// Web search returned on 2026-09-07 as a SEPARATE FINAL TURN — Gemini 2.5
// refuses grounding beside function declarations, and every answer turn
// carries eleven. What has to hold:
//   • the answer turn is untouched (no grounding, tools intact);
//   • the sourced section only ever APPENDS, which is what makes it safe to
//     run after the member has already read the answer;
//   • a section with no sources behind it is DROPPED, because "what the
//     sources say" with nothing behind it is the fabrication this feature
//     was rebuilt to avoid;
//   • nothing it does can cost the member their answer.
// ────────────────────────────────────────────────────────────────────
describe('Ask GG — the grounded sources turn', () => {
  function makeSvc(llm: ReturnType<typeof fakeLlm>) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return new AskGgModelService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      llm as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  const PRO = { subscriptionTier: 'PRO' as const, lane: 'ADVICE' as const };

  const sourced = (text: string) =>
    llmResponse({
      text,
      groundingSources: [
        { uri: 'https://hodgdon.com/p', title: 'Hodgdon' },
        { uri: 'https://6mmbr.com/t' },
      ],
    });

  it('appends the section and cites the pages, without a second answer turn', async () => {
    const llm = fakeLlm([
      llmResponse({ text: 'Start at the published start charge.' }),
      sourced('**🌐 What the sources say**\nHodgdon note a mild pressure curve.'),
    ]);
    const out = await makeSvc(llm).complete(
      [{ role: 'user', content: 'is H4350 nice to work with?' }],
      PRO,
    );

    expect(out.content).toBe(
      'Start at the published start charge.\n\n**🌐 What the sources say**\nHodgdon note a mild pressure curve.',
    );
    expect(out.citations).toEqual([
      { sourceType: 'web', title: 'Hodgdon', url: 'https://hodgdon.com/p' },
      // ⚠️ A chip with no title falls back to the host. A bare uri is ugly;
      // an empty label is a dead pixel the member cannot click.
      { sourceType: 'web', title: '6mmbr.com', url: 'https://6mmbr.com/t' },
    ]);

    // The answer turn carried tools and no grounding; the sources turn is
    // the exact inverse. Both halves matter: either one wrong is a
    // bad_request at the adapter.
    const [answer, sources] = llm.complete.mock.calls.map((c) => c[0]);
    expect(answer.grounding).toBeUndefined();
    expect((answer.tools ?? []).length).toBeGreaterThan(0);
    expect(sources.grounding).toEqual({ web: true });
    expect(sources.tools).toBeUndefined();
    expect(sources.json).toBeUndefined();
    expect(sources.purpose).toBe('askgg.web-sources');
  });

  it('bills the sources turn into the same rollup', async () => {
    const llm = fakeLlm([
      llmResponse({ text: 'Answer.', usage: { inputTokens: 100, outputTokens: 20 } }),
      llmResponse({
        text: '**🌐 What the sources say**\nSomething sourced.',
        usage: { inputTokens: 40, outputTokens: 10 },
        groundingSources: [{ uri: 'https://a.co' }],
      }),
    ]);
    const out = await makeSvc(llm).complete(
      [{ role: 'user', content: 'q' }],
      PRO,
    );
    expect(out.promptTokens).toBe(140);
    expect(out.completionTokens).toBe(30);
  });

  it('does not run for FREE, for support-restricted, or on the SUPPORT lane', async () => {
    for (const opts of [
      { lane: 'ADVICE' as const }, // no tier → FREE
      { subscriptionTier: 'PRO' as const, restricted: true },
      { subscriptionTier: 'PRO' as const, lane: 'SUPPORT' as const },
    ]) {
      const llm = fakeLlm([llmResponse({ text: 'Answer.' })]);
      const out = await makeSvc(llm).complete(
        [{ role: 'user', content: 'q' }],
        opts,
      );
      expect(llm.complete).toHaveBeenCalledTimes(1);
      expect(out.content).toBe('Answer.');
      expect(out.citations).toEqual([]);
    }
  });

  it('adds nothing on NONE — the honest outcome of a search that found nothing', async () => {
    const llm = fakeLlm([
      llmResponse({ text: 'Answer.' }),
      llmResponse({ text: 'NONE' }),
    ]);
    const out = await makeSvc(llm).complete(
      [{ role: 'user', content: 'q' }],
      PRO,
    );
    expect(out.content).toBe('Answer.');
    expect(out.citations).toEqual([]);
  });

  // ⚠️ THE ONE THAT MATTERS. A "what the sources say" section with an empty
  // source list reads exactly like sourced experience and is not — the same
  // fabrication the FREE-tier rule has always forbidden. Drop the text.
  it('drops a sources section that has no sources behind it', async () => {
    const llm = fakeLlm([
      llmResponse({ text: 'Answer.' }),
      llmResponse({
        text: '**🌐 What the sources say**\nShooters widely report…',
        groundingSources: [],
      }),
    ]);
    const out = await makeSvc(llm).complete(
      [{ role: 'user', content: 'q' }],
      PRO,
    );
    expect(out.content).toBe('Answer.');
    expect(out.citations).toEqual([]);
  });

  it('never costs the member their answer when the search fails', async () => {
    const llm = fakeLlm([llmResponse({ text: 'Answer.' })]);
    llm.complete
      .mockResolvedValueOnce(llmResponse({ text: 'Answer.' }))
      .mockRejectedValueOnce(new LlmError('timeout', 'no answer'));
    const out = await makeSvc(llm).complete(
      [{ role: 'user', content: 'q' }],
      PRO,
    );
    expect(out.content).toBe('Answer.');
    expect(out.citations).toEqual([]);
  });

  // The member has already read the answer by the time this arrives, so it
  // is pushed as a continuation — never a rewrite of what is on screen.
  it('streams the section as a continuation of what the member already read', async () => {
    const llm = fakeLlm([llmResponse({ text: 'Streamed answer.' })]);
    // The sources turn always goes through complete(), never stream() —
    // there is no member watching a postscript arrive word by word.
    llm.complete.mockResolvedValue(
      sourced('**🌐 What the sources say**\nSourced bit.'),
    );
    const deltas: string[] = [];
    const out = await makeSvc(llm).complete(
      [{ role: 'user', content: 'q' }],
      { ...PRO, onText: (d) => deltas.push(d) },
    );
    expect(deltas.join('')).toBe(
      'Streamed answer.\n\n**🌐 What the sources say**\nSourced bit.',
    );
    expect(out.content).toBe(deltas.join(''));
  });

  // ⚠️ THE SEARCH TURN SEES THE QUESTION AND OUR DRAFT, AND NOTHING ELSE.
  // Not the tool results, not the account rows — the query leaves for
  // Google, and a member's own order has no business shaping it.
  it('sends only the question and the draft answer to the search', async () => {
    const llm = fakeLlm([
      llmResponse({ text: 'The draft answer.' }),
      sourced('**🌐 What the sources say**\nx'),
    ]);
    await makeSvc(llm).complete(
      [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'earlier reply' },
        { role: 'user', content: 'what powder for .308?' },
      ],
      PRO,
    );
    const sent = JSON.stringify(llm.complete.mock.calls[1][0].messages);
    expect(sent).toContain('what powder for .308?');
    expect(sent).toContain('The draft answer.');
    expect(sent).not.toContain('earlier reply');
  });

  // A charge weight read off a forum, printed under an All Outdoor answer,
  // reads as though we checked it. Precision forums share over-book loads as
  // a point of pride. The manuals stay the only source for a load.
  it('forbids the search turn from publishing a charge weight', async () => {
    const llm = fakeLlm([
      llmResponse({ text: 'Answer.' }),
      sourced('**🌐 What the sources say**\nx'),
    ]);
    await makeSvc(llm).complete([{ role: 'user', content: 'q' }], PRO);
    const system = String(llm.complete.mock.calls[1][0].system);
    expect(system).toMatch(/NEVER PUBLISH A CHARGE WEIGHT/i);
    expect(system).toContain('hodgdon.com');
  });
});
