import { describe, expect, it } from 'vitest';
import {
  LISTING_REJECT_REASONS,
  LISTING_TAKEDOWN_REASONS,
  REASON_MAX_CHARS,
  REASON_MIN_CHARS,
  canReview,
  canTakeDown,
  composeSellerReason,
  licenceNeedsSaying,
  licenceStanding,
  modelVerdict,
  regulatedFlags,
  sellerTake,
  type DossierListing,
} from './desk-listing';

/**
 * The listing module's dangerous jobs, tested because being wrong at any of
 * them puts something regulated on a public shop front:
 *
 *   · WHETHER THE OPERATOR IS TOLD THIS IS REGULATED. regulatedFlags is what
 *     the uncollapsible band renders. An empty array is a silent drawer, and
 *     a silent drawer is a firearm approved as if it were a camp chair.
 *
 *   · WHETHER THE LICENCE STILL HAS ROAD LEFT. Inside thirty days the backend
 *     cron delists the listing again within the day, so an approval there is
 *     a promise we break the same afternoon.
 *
 *   · WHETHER A REJECTION CARRIES WORDS THE SELLER CAN ACT ON. The reason is
 *     the entire content of the email, and the server refuses one under five
 *     characters — so an empty compose is a 400 at best and a bare "rejected"
 *     at worst.
 *
 *   · WHETHER THE BUTTONS MATCH WHAT THE SERVER WILL ACCEPT. Only
 *     PENDING_REVIEW can be reviewed; offering it anywhere else spends the
 *     operator's confidence on a 400.
 */

const BASE: DossierListing = {
  id: 'lst_1',
  referenceNumber: 'UM000598',
  title: 'Camp chair',
  description: 'A chair.',
  status: 'PENDING_REVIEW',
  listingType: 'BUY_NOW',
  condition: 'GOOD',
  createdAt: '2026-09-01T08:00:00.000Z',
  price: 45000,
  sellerAskCents: null,
  province: 'GAUTENG',
  publicLocality: 'Centurion',
  isFirearm: false,
  publicVisible: true,
  collectionOnly: false,
  requiresPapers: false,
  papersAttestedAt: null,
  isExperience: false,
  make: null,
  model: null,
  calibre: null,
  firearmType: null,
  serialNumber: null,
  serialPhotoUrl: null,
  licencePhotoUrl: null,
  licenceExpiresAt: null,
  plannedDealerLocation: null,
  privateArrangeConsentAt: null,
  shippingMethods: ['PUDO'],
  claudeDecision: null,
  claudeConfidence: null,
  claudeReasons: [],
  claudeReviewedAt: null,
  claudeOriginalDescription: null,
  claudeAutoFixApplied: false,
  adminReviewedAt: null,
  adminOverrideReason: null,
  seller: { id: 'usr_1', username: 'boetie', sellerTier: 'NEW', kycStatus: 'VERIFIED', trustScore: 80 },
  category: { id: 'cat_1', name: 'Camping chairs', isFirearm: false },
  images: [],
  _count: { offers: 0, bids: 0, watchers: 0 },
};

function daysOut(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe('regulatedFlags', () => {
  it('says nothing about an ordinary item', () => {
    expect(regulatedFlags(BASE)).toEqual([]);
  });

  it('leads with the firearm, in bad, and never quietly', () => {
    const flags = regulatedFlags({ ...BASE, isFirearm: true });
    expect(flags[0].key).toBe('firearm');
    expect(flags[0].tone).toBe('bad');
    expect(flags[0].label).toMatch(/firearm/i);
  });

  it('reads the listing’s own snapshot, not the category’s flag', () => {
    // The listing was created under the rules it carries. A category
    // re-flagged yesterday must not retro-regulate a row from last week, and
    // must not un-regulate one either.
    const relaxedCategory = {
      ...BASE,
      isFirearm: true,
      category: { ...BASE.category, isFirearm: false },
    };
    expect(regulatedFlags(relaxedCategory).some((f) => f.key === 'firearm')).toBe(true);
  });

  it('warns when a papers category has no attestation, and only informs when it has one', () => {
    expect(regulatedFlags({ ...BASE, requiresPapers: true })[0].tone).toBe('warn');
    expect(
      regulatedFlags({ ...BASE, requiresPapers: true, papersAttestedAt: '2026-08-01T00:00:00Z' })[0]
        .tone,
    ).toBe('info');
  });

  it('flags a members-only listing, because the gate is why Meta stopped blocking us', () => {
    const flags = regulatedFlags({ ...BASE, publicVisible: false });
    expect(flags.map((f) => f.key)).toContain('members-only');
  });
});

describe('licenceStanding', () => {
  it('is not applicable to a listing that is not a firearm', () => {
    expect(licenceStanding(BASE).state).toBe('none');
  });

  it('warns loudly when a firearm carries no expiry at all', () => {
    expect(licenceStanding({ ...BASE, isFirearm: true }).tone).toBe('warn');
  });

  it('does not file a missing expiry under the same state as "not a firearm"', () => {
    // These shared 'none' once, and the compliance band read `state !== 'none'`
    // as "this is not a firearm" — so the loudest case, a licence-controlled
    // item with no expiry on the row at all, was the one case the band said
    // nothing about.
    expect(licenceStanding({ ...BASE, isFirearm: true }).state).toBe('unknown');
    expect(licenceStanding(BASE).state).toBe('none');
  });

  it('treats thirty days out as unlistable, not merely soon', () => {
    // The backend cron delists at ≤30 days. Anything softer here invites an
    // approval the site reverses within the day.
    const s = licenceStanding({ ...BASE, isFirearm: true, licenceExpiresAt: daysOut(20) });
    expect(s.state).toBe('blocked');
    expect(s.tone).toBe('bad');
  });

  it('warns between ninety and thirty days, and clears beyond that', () => {
    expect(licenceStanding({ ...BASE, isFirearm: true, licenceExpiresAt: daysOut(60) }).state).toBe(
      'warning',
    );
    expect(licenceStanding({ ...BASE, isFirearm: true, licenceExpiresAt: daysOut(200) }).state).toBe(
      'ok',
    );
  });

  it('says how long ago an expired licence lapsed', () => {
    const s = licenceStanding({ ...BASE, isFirearm: true, licenceExpiresAt: daysOut(-5) });
    expect(s.state).toBe('expired');
    expect(s.label).toMatch(/ago/);
  });
});

describe('licenceNeedsSaying', () => {
  it('says nothing about a listing that is not a firearm', () => {
    expect(licenceNeedsSaying(licenceStanding(BASE))).toBe(false);
    expect(licenceNeedsSaying(null)).toBe(false);
  });

  it('stays quiet on a firearm whose licence has years left', () => {
    expect(
      licenceNeedsSaying(licenceStanding({ ...BASE, isFirearm: true, licenceExpiresAt: daysOut(400) })),
    ).toBe(false);
  });

  it('speaks for every firearm the operator could get wrong', () => {
    // The band and the approve confirm both ask this one function, so a case
    // that reaches the uncollapsible strip at the top reaches the line under
    // the cursor too. They asked two different questions once and disagreed.
    for (const expiry of [null, daysOut(-5), daysOut(10), daysOut(60)]) {
      expect(
        licenceNeedsSaying(licenceStanding({ ...BASE, isFirearm: true, licenceExpiresAt: expiry })),
      ).toBe(true);
    }
  });
});

describe('sellerTake', () => {
  it('shows nothing when there is no seller figure on the row', () => {
    // Auctions, swaps and any BUY_NOW from before the markup model.
    expect(sellerTake(BASE)).toBeNull();
  });

  it('calls the ask a payout on an ordinary marked-up BUY_NOW', () => {
    const take = sellerTake({ ...BASE, sellerAskCents: 40000 });
    expect(take?.label).toBe('Seller receives');
    expect(take?.cents).toBe(40000);
    expect(take?.tone).toBeUndefined();
    // The two figures differ by our markup, and a screen that does not say so
    // reads as a deduction off the seller.
    expect(take?.note).toMatch(/inside the buyer/i);
  });

  it('refuses to call an experience’s ask a payout', () => {
    // priceFieldsFor marks experiences up and stores sellerAskCents like any
    // other BUY_NOW, but feeModelFor sends them down SELLER_DEDUCT, so
    // checkout takes commission off the marked-up price and never pays this
    // number to anyone. Presenting it as "Seller receives" is the guess this
    // platform already made on eight other surfaces.
    const take = sellerTake({ ...BASE, isExperience: true, sellerAskCents: 40000 });
    expect(take?.label).not.toMatch(/receives/i);
    expect(take?.tone).toBe('warn');
    expect(take?.note).toMatch(/not a payout/i);
  });

  it('never does arithmetic — the cents are the column, untouched', () => {
    for (const listing of [
      { ...BASE, sellerAskCents: 123_45 },
      { ...BASE, isExperience: true, sellerAskCents: 123_45 },
    ]) {
      expect(sellerTake(listing)?.cents).toBe(123_45);
    }
  });
});

describe('modelVerdict', () => {
  it('is absent when the model never scored the listing', () => {
    expect(modelVerdict(BASE)).toBeNull();
  });

  it('words every decision conditionally — it is an opinion, not a fact', () => {
    // "Would reject", never "Rejected". The operator's call overrides it, and
    // a label in the past tense turns the review into a rubber stamp.
    for (const decision of ['APPROVE', 'AUTO_FIX_AND_APPROVE', 'REJECT', 'HUMAN_REVIEW'] as const) {
      const v = modelVerdict({ ...BASE, claudeDecision: decision });
      expect(v?.label.toLowerCase()).toMatch(/^would |^wants /);
    }
  });

  it('carries confidence as whole percent, and null when the model recorded none', () => {
    expect(
      modelVerdict({ ...BASE, claudeDecision: 'APPROVE', claudeConfidence: 0.837 })?.confidencePct,
    ).toBe(84);
    expect(modelVerdict({ ...BASE, claudeDecision: 'APPROVE' })?.confidencePct).toBeNull();
  });
});

describe('composeSellerReason', () => {
  it('always produces something the server will accept', () => {
    for (const options of [LISTING_REJECT_REASONS, LISTING_TAKEDOWN_REASONS]) {
      for (const o of options) {
        const text = composeSellerReason(options, o.value, '');
        expect(text.trim().length).toBeGreaterThanOrEqual(REASON_MIN_CHARS);
        expect(text.length).toBeLessThanOrEqual(REASON_MAX_CHARS);
      }
    }
  });

  it('appends the operator’s note rather than replacing the sentence', () => {
    const text = composeSellerReason(LISTING_REJECT_REASONS, 'PHOTOS', 'Only the box is shown.');
    expect(text).toContain('photos');
    expect(text).toContain('Only the box is shown.');
  });

  it('clips to the column width so a long note cannot 400 the decision', () => {
    const text = composeSellerReason(LISTING_REJECT_REASONS, 'OTHER', 'x'.repeat(900));
    expect(text.length).toBe(REASON_MAX_CHARS);
  });

  it('gives nothing back for a reason nobody ticked', () => {
    // The dialog will not fire without a tick; this is the belt to that
    // brace — an empty string fails the length check at the call site rather
    // than mailing a seller a blank explanation.
    expect(composeSellerReason(LISTING_REJECT_REASONS, '', '')).toBe('');
  });
});

describe('which decision is on offer', () => {
  it('only offers review on PENDING_REVIEW', () => {
    expect(canReview('PENDING_REVIEW')).toBe(true);
    for (const s of ['DRAFT', 'ACTIVE', 'SOLD', 'CANCELLED', 'EXPIRED'] as const) {
      expect(canReview(s)).toBe(false);
    }
  });

  it('only offers take-down on a listing that actually went live', () => {
    expect(canTakeDown('ACTIVE')).toBe(true);
    expect(canTakeDown('PAYMENT_PENDING')).toBe(true);
    expect(canTakeDown('PENDING_REVIEW')).toBe(false);
    expect(canTakeDown('CANCELLED')).toBe(false);
  });
});
