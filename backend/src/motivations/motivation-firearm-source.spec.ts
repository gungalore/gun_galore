import { MotivationLicenceType } from '@prisma/client';
import { documentStatus, sourceProofWhy } from './motivation-documents';
import { SOURCE_DEALER, SOURCE_PRIVATE, SOURCE_UNDECIDED } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// "FROM A DEALER" DID NOTHING AT ALL.
//
// Operator, item 3 of twelve, 2026-08-24: "Where the firearm is coming from
// should have a dealer option as well."
//
// The option was always there — SOURCE_DEALER is the FIRST choice in the list.
// But picking it was byte-identical to picking "Not decided yet" and to never
// answering: the only branch anywhere in the codebase on this answer added the
// seller's licence row for the PRIVATE route. The dealer buyer got no
// acknowledgement that they had answered, and guidance written for both routes
// at once.
//
// The document stays OPTIONAL on the dealer route, per the operator: "We can
// ask for the dealers invoice but it's not mandatory."
// ────────────────────────────────────────────────────────────────────

describe('the guidance follows the route', () => {
  it('⚠️ asks a dealer buyer for the INVOICE, and says it is not required', () => {
    const why = sourceProofWhy(SOURCE_DEALER);
    expect(why).toMatch(/invoice or quote/i);
    expect(why).toMatch(/not required/i);
    // And answers the question a DFO actually has about custody.
    expect(why).toMatch(/until your licence is granted/i);
  });

  it('asks a private buyer for the OWNER’S consent instead', () => {
    const why = sourceProofWhy(SOURCE_PRIVATE);
    expect(why).toMatch(/agree to you applying/i);
    expect(why).not.toMatch(/invoice/i);
  });

  it('keeps the both-routes wording for somebody who has not decided', () => {
    const why = sourceProofWhy(SOURCE_UNDECIDED);
    expect(why).toMatch(/invoice/i);
    expect(why).toMatch(/letter from the person/i);
  });

  it('⚠️ the three answers are genuinely different text', () => {
    // The defect was that they were identical in EFFECT. Asserting they differ
    // is the cheapest guard against it silently becoming true again.
    const seen = new Set([
      sourceProofWhy(SOURCE_DEALER),
      sourceProofWhy(SOURCE_PRIVATE),
      sourceProofWhy(SOURCE_UNDECIDED),
    ]);
    expect(seen.size).toBe(3);
  });
});

describe('the document tiers are unchanged by the wording', () => {
  const status = (source: string) =>
    documentStatus(MotivationLicenceType.S16_DEDICATED_HUNTER, [], {
      [`firearm_source`]: source,
    } as Record<string, string>);

  it('still only the PRIVATE route demands the seller’s licence', () => {
    const priv = status(SOURCE_PRIVATE).needs.map((n) => n.kind);
    const dealer = status(SOURCE_DEALER).needs.map((n) => n.kind);
    expect(priv).toContain('SELLER_LICENCE');
    expect(dealer).not.toContain('SELLER_LICENCE');
  });

  it('⚠️ the dealer route does not make the invoice REQUIRED', () => {
    // "We can ask for the dealers invoice but it's not mandatory."
    const row = status(SOURCE_DEALER).needs.find(
      (n) => n.kind === 'FIREARM_SOURCE_PROOF',
    );
    expect(row).toBeDefined();
    expect(row?.tier).not.toBe('required');
  });

  it('the source row is offered on every route, including undecided', () => {
    for (const s of [SOURCE_DEALER, SOURCE_PRIVATE, SOURCE_UNDECIDED, '']) {
      expect(
        status(s).needs.some((n) => n.kind === 'FIREARM_SOURCE_PROOF'),
      ).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// WHERE THE FIREARM IS UNTIL THE APPLICATION IS DECIDED.
//
// Operator: put the invoice in "as proof of purchase and also where the fire
// arm is currently stored until the application has reached it's outcome."
//
// A question every DFO has and almost no motivation answers. The applicant
// cannot lawfully hold the firearm before the licence is granted, so somebody
// else is holding it, and saying who closes the loop. Derived in CODE, never
// asked and never left to the writer — an invented custody arrangement would
// describe an offence.
// ────────────────────────────────────────────────────────────────────
describe('the custody fact handed to the writer', () => {
  // deriveFacts is private; this drives it the way the pack build does.
  const derive = (source: string): Record<string, string> => {
    const svc = Object.create(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('./motivations.service').MotivationsService.prototype,
    ) as { deriveFacts: (a: Record<string, string>, d?: Date) => Record<string, string> };
    return svc.deriveFacts({ firearm_source: source }, new Date('2026-08-24T00:00:00Z'));
  };

  it('⚠️ a DEALER holds it in stock until the licence is granted', () => {
    const d = derive(SOURCE_DEALER);
    expect(d.custody_pending_outcome).toMatch(/dealer holds the firearm/i);
    expect(d.custody_pending_outcome).toMatch(/until the licence is granted/i);
  });

  it('⚠️ a private SELLER keeps it, and the transfer goes through a dealer', () => {
    const d = derive(SOURCE_PRIVATE);
    expect(d.custody_pending_outcome).toMatch(/current licensed owner keeps/i);
    expect(d.custody_pending_outcome).toMatch(/through a licensed dealer/i);
  });

  it('⚠️ NEVER claims the applicant holds it, on any route', () => {
    // Possession before the licence is granted is an offence. The writer must
    // never be handed a fact that invites it to say otherwise.
    for (const s of [SOURCE_DEALER, SOURCE_PRIVATE, SOURCE_UNDECIDED, '']) {
      const text = derive(s).custody_pending_outcome ?? '';
      expect(text).not.toMatch(/in my possession|i (?:hold|have) the firearm/i);
      expect(text).not.toMatch(/collect(ed)? privately|private collection/i);
    }
  });

  it('says nothing at all when the route is not chosen', () => {
    expect(derive(SOURCE_UNDECIDED).custody_pending_outcome).toBeUndefined();
    expect(derive('').custody_pending_outcome).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// ITEM 5 — THE APPLIED-FOR FIREARM, FILLED FROM WHAT WE ALREADY HAVE.
//
// Operator: "Same for the firearm that's applied for, get the details from the
// consent or the upload and fill it."
//
// Two gaps closed. firearm_action was REQUIRED and unfillable from a licence
// card, because the card has no Action row — the only thing in the system that
// could supply it was an S16 association endorsement. And firearm_model was
// required and fillable by NOTHING at all.
// ────────────────────────────────────────────────────────────────────
describe('the action read off a licence card', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mapCardAction, cardToApplicationFirearm } = require('./motivation-seller-consent.service');

  it('⚠️ fills the action when the card says SELF-LOADING', () => {
    expect(mapCardAction('S/L: RIFLE CAL - RIFLE/CARBINE')).toBe(
      'Semi-automatic (self-loading)',
    );
    expect(mapCardAction('SELF-LOADING SHOTGUN')).toBe(
      'Semi-automatic (self-loading)',
    );
  });

  it('⚠️ REFUSES to pick one when the card says MANUALLY OPERATED', () => {
    // Our Action field is finer than SAPS's wording on purpose — bolt, lever,
    // pump, single shot and break are five different answers to "manually
    // operated". Choosing one would invent a fact about a firearm on a
    // document the applicant signs, and it is exactly what a DFO checks
    // against the card.
    expect(mapCardAction('MANUALLY OPERATED RIFLE')).toBeUndefined();
    expect(mapCardAction('N/S/L HG')).toBeUndefined();
  });

  it('says nothing about a card that does not state the action', () => {
    expect(mapCardAction('RIFLE')).toBeUndefined();
    expect(mapCardAction('')).toBeUndefined();
    expect(mapCardAction(undefined)).toBeUndefined();
  });

  it('carries the action through into the application answers', () => {
    const out = cardToApplicationFirearm({
      make: 'VEKTOR',
      type: 'S/L: RIFLE CAL - RIFLE/CARBINE',
      calibre: '5.56x45',
      serial: 'AB123',
    });
    expect(out.firearm_action).toBe('Semi-automatic (self-loading)');
    expect(out.firearm_type).toBe('Rifle');
  });

  it('leaves the action out where the card cannot settle it', () => {
    const out = cardToApplicationFirearm({
      make: 'HOWA',
      type: 'MANUALLY OPERATED RIFLE',
      calibre: '6.5MM CREEDMOOR',
      serial: 'B477423',
    });
    expect(out.firearm_action).toBeUndefined();
    expect(out.firearm_type).toBe('Rifle'); // the TYPE is still unambiguous
  });
});
