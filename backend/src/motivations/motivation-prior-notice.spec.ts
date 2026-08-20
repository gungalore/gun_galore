import {
  PRIOR_NOTICE_VERSION,
  buildPriorNoticeRequest,
} from './motivation-prior-notice';
import { buildAnnexures } from './motivation-checklist';
import { MotivationUploadKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// THE REQUEST FOR PRIOR NOTICE.
//
// It existed as a tick box and nothing else: motivation-checklist.ts listed
// it under "Your pack", owned by US, ticking itself green the moment the
// motivation was written — and no code anywhere produced the document. These
// tests exist so it cannot go back to being a promise.
// ────────────────────────────────────────────────────────────────────

const INPUT = {
  applicantName: 'Gerhard Fourie',
  idNumber: '8203155041083',
  referenceNumber: 'MO000123',
  licenceTypeLabel: 'section 16 (dedicated hunter)',
  firearmLine: 'a Howa 1500 in 6.5 Creedmoor, serial B742119',
};

describe('the prior-notice request', () => {
  it('names the applicant, the firearm and the reference', () => {
    // The page is filed loose in a folder with forty others. If it cannot say
    // which application it belongs to, it is a sheet of paper.
    const { body } = buildPriorNoticeRequest(INPUT);
    expect(body).toContain('Gerhard Fourie');
    expect(body).toContain('8203155041083');
    expect(body).toContain('MO000123');
    expect(body).toContain('Howa 1500');
  });

  it('cites the three provisions it actually rests on', () => {
    // ⚠️ THESE ARE REGULATIONS, NOT SECTIONS, and conflating the two is the
    // single easiest mistake to make with this pair of instruments.
    //   reg 89      — the official must record and give written reasons
    //   reg 91(1)(a)— 90 days, running from the DATE OF THE DECISION
    //   reg 91(4)   — the reg 89(c) notification must be attached to an appeal
    // Take any one away and the page stops explaining why it is filed with
    // the application rather than after a refusal.
    const { body } = buildPriorNoticeRequest(INPUT);
    expect(body).toContain('Regulation 89');
    expect(body).toContain('regulation 91(1)(a)');
    expect(body).toContain('regulation 91(4)');
    expect(body).toContain('90 days');
    expect(body).toContain(
      'Promotion of Administrative Justice Act 3 of 2000',
    );
    // Named as regulations throughout — never "section 89".
    expect(body).not.toMatch(/section 89/i);
    expect(body).not.toMatch(/section 91/i);
  });

  it('reads as a request and never as a threat', () => {
    // ⚠️ TONE IS LOAD-BEARING HERE. It is filed BEFORE anyone has decided
    // anything, addressed to an official who has done nothing wrong. A page
    // that reads as pre-emptively litigious against the person about to
    // consider the application is worse than no page at all.
    const body = buildPriorNoticeRequest(INPUT).body.toLowerCase();
    for (const word of [
      'unlawful',
      'litigation',
      'attorney',
      'court',
      'review application',
      'failure to comply',
      'we demand',
      'i demand',
    ]) {
      expect(body).not.toContain(word);
    }
    // And it says so in terms.
    expect(body).toContain('is not an objection');
    expect(body).toContain('not made in anticipation of a refusal');
  });

  it('makes no claim about the outcome', () => {
    // The standing rule on every surface of this product.
    const body = buildPriorNoticeRequest(INPUT).body.toLowerCase();
    for (const phrase of [
      'chances',
      'likely',
      'success',
      'guarantee',
      'will be approved',
      'improves',
    ]) {
      expect(body).not.toContain(phrase);
    }
  });

  it('carries the draft marker until an attorney has read it', () => {
    // The suffix is the only thing on the page that records whether the
    // wording was reviewed. Removing it as a tidy-up would silently promote
    // an unreviewed legal text to a reviewed one.
    expect(PRIOR_NOTICE_VERSION).toContain('-draft');
    expect(buildPriorNoticeRequest(INPUT).version).toBe(PRIOR_NOTICE_VERSION);
  });

  it('is deterministic — no clock, no randomness', () => {
    // The whole pack is re-rendered from stored text on every download rather
    // than stored as bytes, so a page that varied between renders would make
    // two downloads of one motivation different documents.
    expect(buildPriorNoticeRequest(INPUT)).toEqual(
      buildPriorNoticeRequest(INPUT),
    );
  });

  it('drops the identifiers it does not have rather than printing a gap', () => {
    const { body } = buildPriorNoticeRequest({
      ...INPUT,
      idNumber: undefined,
      firearmLine: undefined,
    });
    expect(body).toContain('Gerhard Fourie');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('identity number ,');
    expect(body).toContain('MO000123');
  });
});

describe('lettering a document we generate', () => {
  it('gives the prior-notice request a letter of its own', () => {
    const entries = buildAnnexures(
      [MotivationUploadKind.IDENTITY_DOCUMENT],
      ['PRIOR_NOTICE_REQUEST'],
    );
    const pn = entries.find((e) => e.kind === 'PRIOR_NOTICE_REQUEST');
    expect(pn).toBeDefined();
    expect(pn?.generated).toBe(true);
    expect(pn?.count).toBe(1);
    expect(pn?.certification).toBe('none');
  });

  it('letters it in reading order, not at the end', () => {
    // ⚠️ THE POSITION IS COPIED FROM A REAL PACK. The operator's reference
    // list has it at G — after the safe photographs, before the existing
    // licences — and an index whose letters run in a different order from the
    // one a DFO is used to costs attention that should go to the argument.
    const entries = buildAnnexures(
      [
        MotivationUploadKind.IDENTITY_DOCUMENT,
        MotivationUploadKind.SAFE_PHOTO_CLOSED,
        MotivationUploadKind.CURRENT_LICENCE,
      ],
      ['PRIOR_NOTICE_REQUEST'],
    );
    const at = (kind: string) => entries.findIndex((e) => e.kind === kind);
    expect(at('SAFE_PHOTO_CLOSED')).toBeLessThan(at('PRIOR_NOTICE_REQUEST'));
    expect(at('PRIOR_NOTICE_REQUEST')).toBeLessThan(at('CURRENT_LICENCE'));
    // Letters stay a contiguous A, B, C… run with no gap where an unbuilt
    // document would otherwise have sat.
    expect(entries.map((e) => e.letter)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('omits it entirely when it has not been built', () => {
    // A lettered gap is worse than an absent annexure: a reviewer goes looking
    // for the missing letter.
    const entries = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.CURRENT_LICENCE,
    ]);
    expect(entries.some((e) => e.generated)).toBe(false);
    expect(entries.map((e) => e.letter)).toEqual(['A', 'B']);
  });
});
