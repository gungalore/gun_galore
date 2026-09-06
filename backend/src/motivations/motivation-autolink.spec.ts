import { MotivationUploadKind } from '@prisma/client';
import {
  AUTOLINK_KINDS,
  AUTOLINK_MIN_DAYS,
  NEVER_AUTOLINK,
  type AutolinkCandidate,
  decideAutolink,
} from './motivation-autolink';

// ────────────────────────────────────────────────────────────────────
// Operator: "When I have all my documents already in the Document Centre, why
// can't the server add the relevant documents in place and mark them green?"
//
// It can. What makes it safe is the list of things it refuses to do, and every
// refusal below is a failure somebody would otherwise discover at a police
// station counter.
// ────────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-08-24T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) =>
  iso(new Date(TODAY.getTime() + n * 86_400_000));

const cand = (
  kind: MotivationUploadKind,
  over: Partial<AutolinkCandidate> = {},
): AutolinkCandidate => ({
  sourceId: `${kind}-1`,
  source: 'credential',
  kind,
  expiresOn: null,
  title: String(kind),
  ...over,
});

const WANTED = [
  MotivationUploadKind.IDENTITY_DOCUMENT,
  MotivationUploadKind.ADDRESS_CONFIRMATION,
  MotivationUploadKind.COMPETENCY_CERTIFICATE,
  MotivationUploadKind.SAFE_PHOTOGRAPHS,
  MotivationUploadKind.ASSOCIATION_ENDORSEMENT,
  MotivationUploadKind.CURRENT_LICENCE,
];

describe('what it attaches', () => {
  it('attaches the person-describing documents', () => {
    const out = decideAutolink(
      [
        cand(MotivationUploadKind.IDENTITY_DOCUMENT),
        cand(MotivationUploadKind.ADDRESS_CONFIRMATION),
      ],
      WANTED,
      [],
      TODAY,
    );
    expect(out.attach.map((a) => a.kind).sort()).toEqual(
      [
        MotivationUploadKind.ADDRESS_CONFIRMATION,
        MotivationUploadKind.IDENTITY_DOCUMENT,
      ].sort(),
    );
  });

  it('⚠️ NEVER attaches safe photographs unasked — it asks instead', () => {
    // They look like a person-document, and addFromLibrary already demands an
    // explicit "these are the safe at the address on THIS application" for
    // them: somebody who has moved house and reuses last year's shots ships a
    // pack showing the wrong premises. Only they can answer that.
    //
    // M6 — the refusal is now a QUESTION, and the reason says so. It used to
    // come back as 'not-a-person-document', which is both untrue and a dead
    // end: it told the member there was nothing they could do about it.
    const out = decideAutolink(
      [cand(MotivationUploadKind.SAFE_PHOTOGRAPHS)],
      [MotivationUploadKind.SAFE_PHOTOGRAPHS],
      [],
      TODAY,
    );
    expect(out.attach).toEqual([]);
    expect(out.skipped[0].why).toBe('needs-place-confirm');
    expect(out.needsPlaceConfirm).toBe(true);
  });

  it('M6 — attaches the safe photographs once the member confirms the place', () => {
    const out = decideAutolink(
      [cand(MotivationUploadKind.SAFE_PHOTOGRAPHS)],
      [MotivationUploadKind.SAFE_PHOTOGRAPHS],
      [],
      TODAY,
      { placeConfirmed: true },
    );
    expect(out.attach.map((a) => a.kind)).toEqual([
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
    ]);
    // Nothing left to ask: the question has been answered.
    expect(out.needsPlaceConfirm).toBe(false);
  });

  it('M6 — confirming the place does not open the door to anything else', () => {
    // The tick answers ONE question, about ONE kind. An association endorsement
    // still names the wrong firearm whatever the member says about their safe.
    const out = decideAutolink(
      [cand(MotivationUploadKind.ASSOCIATION_ENDORSEMENT)],
      [MotivationUploadKind.ASSOCIATION_ENDORSEMENT],
      [],
      TODAY,
      { placeConfirmed: true },
    );
    expect(out.attach).toEqual([]);
    expect(out.skipped[0].why).toBe('not-a-person-document');
  });

  // ── H10 — the competency has to cover the firearm ────────────────
  //
  // Grouping by KIND alone attached a handgun-only competency to a rifle
  // application. A licence application in a firearm type the competency does
  // not cover is refused before it is considered, so the pack we assembled is
  // the thing that says so.

  it('H10 — skips a competency whose endorsements do not cover the firearm', () => {
    const out = decideAutolink(
      [
        cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, {
          covers: 'HANDGUN',
        }),
      ],
      [MotivationUploadKind.COMPETENCY_CERTIFICATE],
      [],
      TODAY,
      { needed: 'rifle-mo' },
    );
    expect(out.attach).toEqual([]);
    expect(out.skipped[0].why).toBe('endorsement-mismatch');
  });

  it('H10 — picks the ONE certificate that covers it, out of two', () => {
    // ⚠️ AND THIS IS WHY THE TEST RUNS BEFORE THE COUNT. Two competency
    // candidates would otherwise trip the several-candidates refusal — an
    // ambiguity that does not exist, because only one of them can lawfully back
    // this application.
    const out = decideAutolink(
      [
        cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, {
          sourceId: 'handgun',
          covers: 'HANDGUN',
        }),
        cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, {
          sourceId: 'rifle',
          covers: 'N/S/L RIFLE/CARBINE',
        }),
      ],
      [MotivationUploadKind.COMPETENCY_CERTIFICATE],
      [],
      TODAY,
      { needed: 'rifle-mo' },
    );
    expect(out.attach.map((a) => a.sourceId)).toEqual(['rifle']);
  });

  it('H10 — an UNREAD covers line is not a refusal', () => {
    // Three different things are unknown here — the certificate was never read,
    // the wording did not parse, or the applicant has not described the firearm
    // — and in none of them do we KNOW the certificate is wrong. Refusing on a
    // fact we do not hold would withhold the member's own document from their
    // own application on a guess.
    const unread = decideAutolink(
      [cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, { covers: '' })],
      [MotivationUploadKind.COMPETENCY_CERTIFICATE],
      [],
      TODAY,
      { needed: 'rifle-mo' },
    );
    expect(unread.attach).toHaveLength(1);

    const noFirearmYet = decideAutolink(
      [cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, { covers: 'HANDGUN' })],
      [MotivationUploadKind.COMPETENCY_CERTIFICATE],
      [],
      TODAY,
      { needed: null },
    );
    expect(noFirearmYet.attach).toHaveLength(1);
  });

  it('⚠️ NEVER attaches a document that names a firearm', () => {
    // An endorsement names ONE firearm, so a previous application's endorsement
    // describes the wrong gun — in front of a DFO, on a signed pack.
    const out = decideAutolink(
      [
        cand(MotivationUploadKind.ASSOCIATION_ENDORSEMENT),
        cand(MotivationUploadKind.CURRENT_LICENCE),
      ],
      WANTED,
      [],
      TODAY,
    );
    expect(out.attach).toEqual([]);
    expect(out.skipped.map((s) => s.why)).toEqual([
      'not-a-person-document',
      'not-a-person-document',
    ]);
  });

  it('⚠️ REFUSES TO CHOOSE between two candidates of the same kind', () => {
    // Two valid competency certificates is a question for the member. A coin
    // toss that lands wrong is exactly what makes automation untrustworthy.
    const out = decideAutolink(
      [
        cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, { sourceId: 'a' }),
        cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, { sourceId: 'b' }),
      ],
      WANTED,
      [],
      TODAY,
    );
    expect(out.attach).toEqual([]);
    expect(out.skipped.every((s) => s.why === 'several-candidates')).toBe(true);
  });

  it('attaches when only ONE of several is still fresh', () => {
    // The ambiguity resolves itself: an expired one is not a candidate, so
    // there is nothing left to choose between.
    const out = decideAutolink(
      [
        cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, {
          sourceId: 'old',
          expiresOn: inDays(10),
        }),
        cand(MotivationUploadKind.COMPETENCY_CERTIFICATE, {
          sourceId: 'good',
          expiresOn: inDays(400),
        }),
      ],
      WANTED,
      [],
      TODAY,
    );
    expect(out.attach.map((a) => a.sourceId)).toEqual(['good']);
  });
});

describe('the freshness rule', () => {
  it(`⚠️ refuses anything with under ${AUTOLINK_MIN_DAYS} days left`, () => {
    // SAPS takes months. A letter of good standing with three weeks on it is
    // one the DFO rejects long before a decision, and attaching it silently
    // hands somebody a pack that looks complete and is already stale.
    const out = decideAutolink(
      [
        cand(MotivationUploadKind.ASSOCIATION_CARD, { expiresOn: inDays(30) }),
      ],
      [MotivationUploadKind.ASSOCIATION_CARD],
      [],
      TODAY,
    );
    expect(out.attach).toEqual([]);
    expect(out.skipped[0].why).toBe('expiring-too-soon');
  });

  it('accepts one comfortably inside the window', () => {
    const out = decideAutolink(
      [cand(MotivationUploadKind.ASSOCIATION_CARD, { expiresOn: inDays(200) })],
      [MotivationUploadKind.ASSOCIATION_CARD],
      [],
      TODAY,
    );
    expect(out.attach).toHaveLength(1);
  });

  it('⚠️ treats NO EXPIRY as valid, not as stale', () => {
    // An ID copy carries no expiry. Reading absence as "expired" would refuse
    // the single most reusable document there is.
    const out = decideAutolink(
      [cand(MotivationUploadKind.IDENTITY_DOCUMENT, { expiresOn: null })],
      [MotivationUploadKind.IDENTITY_DOCUMENT],
      [],
      TODAY,
    );
    expect(out.attach).toHaveLength(1);
  });

  it('treats an unparseable date as no date rather than throwing', () => {
    const out = decideAutolink(
      [cand(MotivationUploadKind.IDENTITY_DOCUMENT, { expiresOn: 'not-a-date' })],
      [MotivationUploadKind.IDENTITY_DOCUMENT],
      [],
      TODAY,
    );
    expect(out.attach).toHaveLength(1);
  });
});

describe('what this application actually wants', () => {
  it('⚠️ never attaches a document the licence type does not ask for', () => {
    // A pack padded with documents nobody asked for is a pack a DFO has to
    // read through to find the ones that matter.
    const out = decideAutolink(
      [cand(MotivationUploadKind.ASSOCIATION_CARD)],
      [MotivationUploadKind.IDENTITY_DOCUMENT],
      [],
      TODAY,
    );
    expect(out.attach).toEqual([]);
    expect(out.skipped).toEqual([]); // not even considered
  });

  it('leaves a slot alone once something is already on it', () => {
    const out = decideAutolink(
      [cand(MotivationUploadKind.IDENTITY_DOCUMENT)],
      [MotivationUploadKind.IDENTITY_DOCUMENT],
      [MotivationUploadKind.IDENTITY_DOCUMENT],
      TODAY,
    );
    expect(out.attach).toEqual([]);
    expect(out.skipped[0].why).toBe('already-attached');
  });
});

describe('the two lists stay honest', () => {
  it('⚠️ no kind is on BOTH lists', () => {
    for (const k of AUTOLINK_KINDS) {
      expect(NEVER_AUTOLINK[k]).toBeUndefined();
    }
  });

  it('⚠️ every upload kind has been decided about, one way or the other', () => {
    // The point of an explicit refusal list: adding a new kind forces a
    // decision instead of defaulting into either behaviour.
    const undecided = Object.values(MotivationUploadKind).filter(
      (k) =>
        !AUTOLINK_KINDS.includes(k) &&
        NEVER_AUTOLINK[k] === undefined &&
        // The retired safe kinds fold into SAFE_PHOTOGRAPHS and never arrive.
        !k.startsWith('SAFE_PHOTO_') &&
        k !== 'SAFE_INSTALLATION' &&
        k !== 'SAFE_PHOTO',
    );
    expect(undecided).toEqual([]);
  });

  it('every refusal says WHY, for the member and for the next reader', () => {
    for (const [, why] of Object.entries(NEVER_AUTOLINK)) {
      expect((why ?? '').length).toBeGreaterThan(20);
    }
  });
});
