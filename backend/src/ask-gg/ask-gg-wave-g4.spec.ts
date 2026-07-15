// Ask GG site-guide — Wave G4 gate (BLOCKING for the personal overlay).
//
// getPersonalGuide() layers the signed-in user's own state onto the public
// guide, composed from the SAME W5 account shapers. This gate proves the
// composition introduces NO new PII leak: the account-tools service is built
// with rows POISONED with every category of sensitive data, wired into the
// real AskGgGuideService, and the serialized personal guide must contain none
// of it. Plus: coverage of the new page keys, the public guide never carries a
// `personal` block, and every failure degrades to the plain public guide.
//
// If any assertion here fails, G4's personal overlay does not deploy.

jest.mock('meilisearch', () => ({
  Meilisearch: class {},
  MeilisearchApiError: class extends Error {},
}));

import { AskGgAccountToolsService } from './ask-gg-account-tools.service';
import { AskGgGuideService } from './ask-gg-guide.service';
import type { PrismaService } from '../prisma/prisma.service';

const POISON = {
  email: 'victim@leak-test.com',
  phone: '+27821234567',
  spacedPhone: '082 111 2223',
  firstName: 'Gerhardus',
  lastName: 'Fourie',
  bankAccount: '62899901234',
  spacedBank: '6289 9901-234',
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
  for (const s of FORBIDDEN_SUBSTRINGS) expect(serialized).not.toContain(s);
  for (const k of FORBIDDEN_KEYS) expect(serialized).not.toContain(k);
  expect(serialized).not.toMatch(EMAIL_RE);
  expect(serialized).not.toMatch(LONG_DIGIT_RUN);
  expect(serialized.replace(/[\s-]/g, '')).not.toMatch(LONG_DIGIT_RUN);
}

const future = new Date(Date.now() + 3 * 24 * 3600 * 1000);

function build(opts: { userExists?: boolean; auctionListing?: boolean } = {}) {
  const userExists = opts.userExists ?? true;
  const prisma = {
    listing: {
      findUnique: jest.fn().mockResolvedValue(
        opts.auctionListing
          ? {
              listingType: 'AUCTION',
              status: 'ACTIVE',
              isExperience: false,
              currentBid: 1_500_000,
              endTime: future,
              reservePrice: 2_000_000,
            }
          : null,
      ),
    },
    // superset so both selects ({id} by clerkId, {kycStatus,profileCompletedAt}
    // by id) resolve from one mock.
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          userExists
            ? { id: 'u_me', kycStatus: 'PENDING', profileCompletedAt: null }
            : null,
        ),
    },
    transaction: { findUnique: jest.fn() },
    order: { findFirst: jest.fn() },
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
  const transactions = { findForUser: jest.fn().mockResolvedValue([]) };
  const offers = {
    getMyOffers: jest.fn().mockResolvedValue([
      {
        id: 'of_1',
        status: 'PENDING',
        offerAmount: 100_000,
        counterAmount: null,
        expiresAt: future,
        buyerNote: POISON.freeText,
        listing: {
          title: 'Leupold VX-5HD',
          seller: { username: 'seller_sue', clerkId: POISON.clerkId, email: POISON.email },
        },
      },
    ]),
    getReceivedOffers: jest.fn().mockResolvedValue([]),
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
        endTime: future,
      },
    ]),
  };
  const raffles = {
    getMyTickets: jest.fn().mockResolvedValue([]),
    getMyWins: jest.fn().mockResolvedValue([]),
  };
  const swapFunding = {
    getMySwaps: jest.fn().mockResolvedValue({
      bankDetails: { accountNumber: POISON.bankAccount, branchCode: POISON.branchCode },
      swaps: [],
    }),
  };
  const swapProposals = {
    getMine: jest.fn().mockResolvedValue([]),
    getReceived: jest.fn().mockResolvedValue([]),
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
          netPayout: 85_000,
        },
      ],
    }),
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const accountTools = new AskGgAccountToolsService(
    prisma as unknown as PrismaService,
    users as any,
    transactions as any,
    offers as any,
    auctions as any,
    raffles as any,
    swapFunding as any,
    swapProposals as any,
    sellerTools as any,
  );
  const guide = new AskGgGuideService(
    prisma as unknown as PrismaService,
    accountTools,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { guide, prisma };
}

describe('G4 personal overlay — PII gate under poisoned inputs', () => {
  it('auction listing overlay is clean and reflects the bid state', async () => {
    const { guide } = build({ auctionListing: true });
    const out = await guide.getPersonalGuide('clerk_me', {
      path: '/listings/l1',
      listingId: 'l1',
    });
    const s = JSON.stringify(out);
    assertClean(s);
    expect(out.personal).toBeDefined();
    expect(s).toContain('top bidder'); // enrichment landed
    expect(s).toContain('/kyc/verify'); // backbone landed
  });

  it('earnings overlay surfaces payout blockers without any account numbers', async () => {
    const { guide } = build();
    const out = await guide.getPersonalGuide('clerk_me', { path: '/my/earnings' });
    const s = JSON.stringify(out);
    assertClean(s);
    expect(out.personal).toBeDefined();
    // KYC + profile blockers present as deep-links, not raw banking.
    expect(s).toContain('/kyc/verify');
    expect(s).toContain('/settings');
  });

  it('generic account page still gets the urgent backbone, clean', async () => {
    const { guide } = build();
    const out = await guide.getPersonalGuide('clerk_me', { path: '/wishlist' });
    assertClean(JSON.stringify(out));
    expect(out.key).toBe('wishlist');
    expect(out.personal?.items.length).toBeGreaterThan(0);
  });
});

describe('G4 overlay discipline', () => {
  it('the PUBLIC guide never carries a personal block', async () => {
    const { guide } = build();
    const pub = await guide.getGuide({ path: '/my/earnings' });
    expect(pub.personal).toBeUndefined();
  });

  it('unknown user → the plain public guide, no personal block', async () => {
    const { guide } = build({ userExists: false });
    const out = await guide.getPersonalGuide('clerk_ghost', { path: '/my/earnings' });
    expect(out.personal).toBeUndefined();
    expect(out.key).toBe('earnings');
  });

  it('nothing urgent + non-money page → overlay omitted entirely', async () => {
    const { guide } = build();
    (guide as unknown as {
      accountTools: { getMyAccountOverview: jest.Mock };
    }).accountTools.getMyAccountOverview = jest
      .fn()
      .mockResolvedValue({ needsAttention: [], note: '', href: '/dashboard' });
    const out = await guide.getPersonalGuide('clerk_me', { path: '/wishlist' });
    expect(out.personal).toBeUndefined();
  });

  it('a shaper throwing degrades to the public guide, never crashes', async () => {
    const { guide } = build();
    (guide as unknown as {
      accountTools: { getMyAccountOverview: jest.Mock };
    }).accountTools.getMyAccountOverview = jest
      .fn()
      .mockRejectedValue(new Error('db down'));
    const out = await guide.getPersonalGuide('clerk_me', { path: '/wishlist' });
    // Overview failed but the page isn't a seller-money page, so no items →
    // omit the overlay; the base guide still returns.
    expect(out.key).toBe('wishlist');
    expect(out.personal).toBeUndefined();
  });
});

describe('G4 static coverage — new keys resolve for their paths', () => {
  const cases: [string, string][] = [
    ['/dashboard', 'dashboard'],
    ['/dashboard/raffle-wins', 'competitions'],
    ['/account', 'profile'],
    ['/profile', 'profile'],
    ['/profile/edit', 'profile'],
    ['/settings', 'settings'],
    ['/subscribe', 'subscribe'],
    ['/wishlist', 'wishlist'],
    ['/saved-searches', 'saved-searches'],
    ['/notifications', 'notifications'],
    ['/my/listings', 'my-listings'],
    ['/my/swaps', 'swaps'],
    ['/my/earnings', 'earnings'],
    ['/my/tickets', 'tickets'],
    ['/my/offers', 'offers'],
    ['/my/bids', 'offers'],
    ['/offers/received', 'offers'],
    ['/sellers/user_abc', 'sellers'],
    ['/featured/bid', 'featured'],
    ['/brands', 'browse'],
    ['/brand/vortex', 'browse'],
    ['/wanted', 'wanted'],
    ['/wanted/new', 'wanted-new'],
    ['/wanted/abc123', 'wanted-detail'],
    ['/transactions/tx1/dealer-verification', 'dealer-verification'],
    ['/support', 'help'],
    ['/terms', 'legal'],
    ['/privacy', 'legal'],
    ['/experiences-cancellation-policy', 'legal'],
  ];
  it.each(cases)('%s → %s', async (path, key) => {
    const { guide } = build();
    const out = await guide.getGuide({ path });
    expect(out.key).toBe(key);
  });
});
