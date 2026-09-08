// backend/src/licence-centre/proficiency-sides.spec.ts
//
// Pairing the two sides of a proficiency: a training provider's certificate
// (the front) and the PFTC statement of results (the back) for the same
// course.
//
// ⚠️ REWRITTEN 2026-09-08, AWS TEXTRACT REMOVED PLATFORM-WIDE. This file used
// to read the operator's own real documents out of __fixtures__/textract via
// `extractDocument` and test TWO things at once: whether that Textract-specific
// OCR-to-field extraction got each of four real specimens right (front/back
// detection, the certificate number two lines from its label, "this 31 day of
// MARCH 2021", `parseLooseDate`'s four date shapes), and whether the ALREADY
// EXTRACTED fields then paired correctly via findOtherSide/findDuplicate/
// documentSide. The first half's subject is gone — Gemini reads the image
// directly and was never asked to parse "31 day of MARCH 2021" out of a line
// of OCR text, so there is nothing left in this codebase for those cases to
// exercise. The second half survives untouched in credential-duplicates.ts,
// which takes already-read `{details, issuedOn}` and does not care which
// reader produced them, so it is kept here with the same document-to-document
// relationships as before, now written by hand instead of read off a fixture
// file the parsing code no longer touches.
//
// The values below stand in for four of the operator's real documents (two
// One Shot courses, one Progun course, the matching PFTC statements) closely
// enough to reproduce the same matches and near-misses the real pairing once
// relied on — see credential-chain history for the real specimens if the
// shapes below ever need to be re-derived. `id_number` is an invented shared
// token, not a real ID number.

import { documentSide, findDuplicate, findOtherSide } from './credential-duplicates';

type Extracted = { details: Record<string, string>; issuedOn: string | null };

/** Two One Shot courses and one Progun course, each a training provider's own certificate. */
const FRONT: Record<string, Extracted> = {
  oneShotA: {
    details: {
      certificate_number: '19/2025',
      scv_number: '50BSR-A3597',
      unit_standard: '119650',
      document_side: 'front',
    },
    issuedOn: '2025-03-28',
  },
  oneShotB: {
    details: {
      scv_number: '52BS-A8041',
      unit_standard: '119652',
      document_side: 'front',
    },
    issuedOn: '2025-04-14',
  },
  // Progun prints the joining number as its OWN "certificate number" — the
  // PFTC statement behind it prints the same number as an "SCV number". The
  // two sides only meet because findOtherSide is label-blind about which
  // field name carried it.
  progun: {
    details: {
      certificate_number: 'K/10358-K919835',
      unit_standard: '119651',
      document_side: 'front',
      id_number: 'SAMEPERSON001',
    },
    issuedOn: '2021-03-31',
  },
};

/** The PFTC statements of results behind each front above, plus one unrelated distractor. */
const BACK: Record<string, Extracted> = {
  oneShotA: {
    details: {
      scv_number: '50BSR-A3597',
      unit_standard: '119650',
      document_side: 'back',
    },
    issuedOn: '2025-03-28',
  },
  oneShotB: {
    details: {
      scv_number: '52BS-A8041',
      unit_standard: '119652',
      document_side: 'back',
    },
    issuedOn: '2025-04-14',
  },
  progun: {
    details: {
      scv_number: 'K/10358-K919835',
      unit_standard: '119651',
      document_side: 'back',
      id_number: 'SAMEPERSON001',
    },
    issuedOn: '2021-03-31',
  },
  // A statement with no code in common with any front above and no shared ID
  // — must never be picked by accident.
  unrelated: {
    details: { unit_standard: '117705, 119649', document_side: 'back' },
    issuedOn: '2014-01-23',
  },
};

describe('documentSide', () => {
  it('reads the two literal answers and nothing else', () => {
    expect(documentSide(BACK.oneShotA.details)).toBe('back');
    expect(documentSide(FRONT.oneShotA.details)).toBe('front');
    expect(documentSide({})).toBeNull();
  });
});

describe('pairing the two sides', () => {
  const day = new Date('2026-09-06T21:00:00Z');
  const row = (
    id: string,
    r: Extracted,
    over: Partial<{ createdAt: Date; otherSideId: string | null }> = {},
  ) => ({
    id,
    title: id,
    createdAt: over.createdAt ?? day,
    kind: 'PROFICIENCY' as const,
    details: r.details,
    issuedOn: r.issuedOn,
    otherSideId: over.otherSideId ?? null,
  });
  const subject = (r: Extracted) => ({
    kind: 'PROFICIENCY' as const,
    details: r.details,
    issuedOn: r.issuedOn,
  });

  it('joins One Shot certificates and statements on the S/C/V number', () => {
    const vault = [
      row('back-b', BACK.oneShotB),
      row('back-a', BACK.oneShotA),
      row('back-progun', BACK.progun),
      row('back-unrelated', BACK.unrelated),
    ];
    expect(findOtherSide(subject(FRONT.oneShotB), vault)?.id).toBe('back-b');
    expect(findOtherSide(subject(FRONT.oneShotA), vault)?.id).toBe('back-a');
  });

  it('joins Progun on the number it prints as a certificate number and the PFTC prints as an SCV number', () => {
    const vault = [row('back-b', BACK.oneShotB), row('back-progun', BACK.progun)];
    expect(findOtherSide(subject(FRONT.progun), vault)?.id).toBe('back-progun');
  });

  it('works from either side', () => {
    const fronts = [
      row('front-a', FRONT.oneShotA),
      row('front-b', FRONT.oneShotB),
      row('front-progun', FRONT.progun),
    ];
    expect(findOtherSide(subject(BACK.oneShotA), fronts)?.id).toBe('front-a');
    expect(findOtherSide(subject(BACK.progun), fronts)?.id).toBe('front-progun');
  });

  it('never pairs a front with a front, or a row already paired', () => {
    expect(findOtherSide(subject(FRONT.oneShotA), [row('x', FRONT.oneShotB)])).toBeNull();
    expect(
      findOtherSide(subject(FRONT.oneShotA), [
        row('taken', BACK.oneShotA, { otherSideId: 'someone' }),
      ]),
    ).toBeNull();
  });

  it('does not call the other side a copy', () => {
    expect(findDuplicate(subject(FRONT.oneShotB), [row('back', BACK.oneShotB)])).toBeNull();
    // ...but a second scan of the same side still is one.
    expect(findDuplicate(subject(FRONT.oneShotB), [row('again', FRONT.oneShotB)])?.id).toBe(
      'again',
    );
  });

  it('falls back to the same codes for the same person within four months', () => {
    const front = subject(FRONT.progun);
    const back = row('back', BACK.progun);
    back.details = { ...back.details, scv_number: '', certificate_number: '', authentication_code: '' };
    expect(findOtherSide(front, [back])?.id).toBe('back');
    const late = { ...back, issuedOn: '2022-06-01' };
    expect(findOtherSide(front, [late])).toBeNull();
  });
});
