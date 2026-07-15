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
import { AskGgClaudeService } from './ask-gg-claude.service';
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
  const swapFunding = {
    getMySwaps: jest.fn().mockResolvedValue({
      bankDetails: {
        accountNumber: POISON.bankAccount,
        branchCode: POISON.branchCode,
        bank: 'FNB',
      },
      swaps: [
        {
          swapId: 'sw1',
          status: 'LOCKED',
          side: 'INITIATOR',
          fundingSetUp: true,
          myFunded: true,
          counterpartyFunded: false,
          payByAt: new Date('2026-07-18'),
          myAmountCents: 5_000,
          myReference: POISON.eftReference,
          giveProofCode: POISON.proofCode,
          give: { title: 'Buck knife' },
          get: { title: 'Binoculars' },
          giveIsFirearm: false,
          getIsFirearm: false,
          giveTracking: { status: 'IN_TRANSIT', waybill: 'TCG777' },
          getTracking: null,
        },
      ],
    }),
  };
  const swapProposals = {
    getMine: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
    getReceived: jest.fn().mockResolvedValue([{ id: 'p3' }]),
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
    swapFunding as any,
    swapProposals as any,
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

  it('getMySwaps drops the banking block and EFT references entirely', async () => {
    const { svc } = makeSvc();
    const s = JSON.stringify(await svc.getMySwaps(ACCOUNT));
    assertClean(s);
    expect(s).toContain('Buck knife');
    expect(s).not.toContain('FNB');
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

describe('W5 fail-closed + budget gates (handleToolCall)', () => {
  function makeClaude(accountTools: unknown) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return new AskGgClaudeService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      accountTools as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
  const block = {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'getMyPurchases',
    input: {},
  };

  it('no authenticated account → is_error, tool never invoked', async () => {
    const accountTools = { getMyPurchases: jest.fn() };
    const svc = makeClaude(accountTools);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const out = await (svc as any).handleToolCall(
      block,
      [],
      [],
      { marketplace: 0, platform: 0, account: 0 },
      'FREE',
      false,
      undefined, // ← no account
    );
    expect(out[0].is_error).toBe(true);
    expect(accountTools.getMyPurchases).not.toHaveBeenCalled();
  });

  it('account budget exhausts at 4 calls', async () => {
    const accountTools = {
      getMyPurchases: jest.fn().mockResolvedValue({ purchases: [] }),
    };
    const svc = makeClaude(accountTools);
    const budget = { marketplace: 0, platform: 0, account: 4 };
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const out = await (svc as any).handleToolCall(
      block,
      [],
      [],
      budget,
      'FREE',
      false,
      ACCOUNT,
    );
    expect(out[0].is_error).toBe(true);
    expect(accountTools.getMyPurchases).not.toHaveBeenCalled();
  });
});
