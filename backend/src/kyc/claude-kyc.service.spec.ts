import { ClaudeKycService, type KycClaudeFindings } from './claude-kyc.service';
import type { CrossCheckResult } from './kyc-cross-check';

function findings(overrides: Partial<{
  same_person: number;
  selfie_live_capture: number;
  document_photo_visible: number;
  same_person_vs_ha_photo: number | undefined;
  looks_genuine_sa_id: number;
  legibility: number;
}> = {}): KycClaudeFindings {
  return {
    face_match: {
      same_person: overrides.same_person ?? 92,
      selfie_live_capture: overrides.selfie_live_capture ?? 90,
      document_photo_visible: overrides.document_photo_visible ?? 95,
      ...(overrides.same_person_vs_ha_photo !== undefined
        ? { same_person_vs_ha_photo: overrides.same_person_vs_ha_photo }
        : {}),
      issues: [],
    },
    document: {
      looks_genuine_sa_id: overrides.looks_genuine_sa_id ?? 88,
      document_type: 'SMART_ID_CARD',
      extracted_id_number: '8001015009087',
      extracted_surname: 'FOURIE',
      extracted_names: 'GERHARD',
      extracted_dob: '1980-01-01',
      legibility: overrides.legibility ?? 90,
      issues: [],
    },
    overall_confidence: 90,
    recommendation: 'APPROVE',
    recommendation_reason: 'test',
  };
}

const clean: CrossCheckResult = { pass: true, hardFails: [], softFails: [] };
const soft: CrossCheckResult = { pass: false, hardFails: [], softFails: ['doc-dob-mismatch'] };
const hard: CrossCheckResult = { pass: false, hardFails: ['dob-id-digit-mismatch'], softFails: [] };

// The scenario this exists for: a genuine seller whose green ID book photo
// is 20+ years old, or who has grown a beard since. Home Affairs confirms
// them from the government's own recent photograph, but the ancient card
// photo scores badly. Before this split that combination was REJECTED.
describe('age gap: the official record photo outranks an old document photo', () => {
  const svc = new ClaudeKycService();

  it('strong HA match + weak document photo → human review, NOT rejection', () => {
    expect(
      svc.statusFromFindings(
        findings({ same_person: 45, same_person_vs_ha_photo: 95 }),
        clean,
        'anchored',
      ),
    ).toBe('UNDER_REVIEW');
  });

  it('strong HA match + strong document photo still auto-verifies', () => {
    expect(
      svc.statusFromFindings(
        findings({ same_person: 88, same_person_vs_ha_photo: 95 }),
        clean,
        'anchored',
      ),
    ).toBe('VERIFIED');
  });

  it('a WEAK HA match still REJECTS — the authoritative photo governs', () => {
    // The protection that must survive: if Home Affairs' own photo says this
    // is not them, a flattering document-photo score cannot rescue it.
    expect(
      svc.statusFromFindings(
        findings({ same_person: 95, same_person_vs_ha_photo: 20 }),
        clean,
        'anchored',
      ),
    ).toBe('REJECTED');
  });

  it('in STANDARD mode the document photo still decides — nothing else to go on', () => {
    expect(
      svc.statusFromFindings(findings({ same_person: 45 }), clean, 'standard'),
    ).toBe('REJECTED');
  });

  it('a merely adequate HA match does not license a bad document photo', () => {
    // ha=65 is below the approve floor, so it has not established identity
    // confidently enough to override anything: the document photo still counts.
    expect(
      svc.statusFromFindings(
        findings({ same_person: 30, same_person_vs_ha_photo: 65 }),
        clean,
        'anchored',
      ),
    ).toBe('REJECTED');
  });

  it('a forged document still REJECTS even with a perfect HA match', () => {
    expect(
      svc.statusFromFindings(
        findings({ looks_genuine_sa_id: 15, same_person_vs_ha_photo: 98 }),
        clean,
        'anchored',
      ),
    ).toBe('REJECTED');
  });

  it('a spoofed selfie still REJECTS even with a perfect HA match', () => {
    expect(
      svc.statusFromFindings(
        findings({ selfie_live_capture: 10, same_person_vs_ha_photo: 98 }),
        clean,
        'anchored',
      ),
    ).toBe('REJECTED');
  });
});

// In SA the Home Affairs record photo is the ISSUE-DAY photo — the same
// sitting as the one on the card. There is no fresher official image, so an
// old green book leaves face matching genuinely unreliable. The reject floor
// therefore relaxes with the age of the reference photo: a middling score on
// a 29-year-old photo goes to a human instead of being refused outright.
describe('age-relaxed face floor', () => {
  const svc = new ClaudeKycService();
  const greenBook = (o: Parameters<typeof findings>[0] = {}) => {
    const f = findings(o);
    f.document.document_type = 'GREEN_BOOK';
    return f;
  };

  it('a 45-year-old with a 29-year-old green book: 38 reviews, not rejects', () => {
    expect(svc.statusFromFindings(greenBook({ same_person: 38 }), clean, 'standard', 45)).toBe(
      'UNDER_REVIEW',
    );
  });

  it('the SAME score on a recent photo still rejects', () => {
    // 21-year-old: photo is ~5 years old, so no relief — 38 is a real fail.
    expect(svc.statusFromFindings(greenBook({ same_person: 38 }), clean, 'standard', 21)).toBe(
      'REJECTED',
    );
  });

  it('with no age known, the standard floor applies', () => {
    expect(svc.statusFromFindings(greenBook({ same_person: 38 }), clean, 'standard')).toBe(
      'REJECTED',
    );
  });

  it('relief is bounded — a clear mismatch still rejects however old the photo', () => {
    // 70-year-old, 54-year-old photo: maximum relief, floor bottoms at 30.
    expect(svc.statusFromFindings(greenBook({ same_person: 25 }), clean, 'standard', 70)).toBe(
      'REJECTED',
    );
  });

  it('a smart ID card gets less relief than a green book at the same age', () => {
    // Cards cannot predate 2013, so a 45-year-old's card photo is at most
    // ~13 years old, not 29 — less relief, so 38 still rejects.
    const smart = findings({ same_person: 38 });
    smart.document.document_type = 'SMART_ID_CARD';
    expect(svc.statusFromFindings(smart, clean, 'standard', 45)).toBe('REJECTED');
  });

  it('age relief NEVER applies to liveness — a screen re-shoot still rejects', () => {
    expect(
      svc.statusFromFindings(greenBook({ selfie_live_capture: 35 }), clean, 'standard', 60),
    ).toBe('REJECTED');
  });

  it('age relief NEVER applies to document authenticity — a forgery still rejects', () => {
    expect(
      svc.statusFromFindings(greenBook({ looks_genuine_sa_id: 35 }), clean, 'standard', 60),
    ).toBe('REJECTED');
  });

  it('age relief does not lower the bar for AUTO-APPROVAL', () => {
    // Deliberately asymmetric: an old photo buys review instead of refusal,
    // never an easier pass. 65 is below the approve floor either way.
    expect(svc.statusFromFindings(greenBook({ same_person: 65 }), clean, 'standard', 60)).toBe(
      'UNDER_REVIEW',
    );
  });
});

describe('ClaudeKycService borderline consensus', () => {
  const svc = new ClaudeKycService();

  // Only knife-edge scans pay for three readings. Clear-cut ones must stay
  // at one call, or the cost of the whole flow triples for no benefit.
  it('a confident pass is NOT borderline (stays a single call)', () => {
    expect(svc.isBorderline(findings(), 'standard')).toBe(false);
  });

  it('a confident fail is NOT borderline', () => {
    expect(svc.isBorderline(findings({ same_person: 5 }), 'standard')).toBe(false);
  });

  it.each([
    ['just under the reject line', 48],
    ['mid uncertain band', 60],
    ['just over the approve line', 72],
    ['at the lower margin edge', 40],
    ['at the upper margin edge', 80],
  ])('borderline: %s (%i)', (_label, score) => {
    expect(svc.isBorderline(findings({ same_person: score }), 'standard')).toBe(true);
  });

  it('a borderline anchored score triggers consensus only in anchored mode', () => {
    const f = findings({ same_person_vs_ha_photo: 62 });
    expect(svc.isBorderline(f, 'anchored')).toBe(true);
    // In standard mode the HA gate is not consulted, so it must not drag an
    // otherwise-clear scan into a needless second and third call.
    expect(svc.isBorderline(f, 'standard')).toBe(false);
  });

  // The median is the point: it discards a single wild reading rather than
  // averaging it in, so one outlying lens cannot move the verdict.
  it('median of three ignores a lone outlier', async () => {
    const svcM = new ClaudeKycService();
    const scores = [55, 58, 5]; // charitable/skeptical agree; one wild low
    let i = 0;
    jest
      .spyOn(svcM, 'scan')
      .mockImplementation(async () =>
        findings({ same_person: scores[i++] ?? 55 }),
      );
    const out = await svcM.scanWithConsensus({
      selfieBase64: 'x',
      documentUrl: 'u',
      mode: 'standard',
    });
    expect(out.samples).toBe(3);
    expect(out.findings.face_match.same_person).toBe(55);
    // 55 would have been UNDER_REVIEW; the outlying 5 would have REJECTED.
    expect(svcM.statusFromFindings(out.findings, clean, 'standard')).toBe(
      'UNDER_REVIEW',
    );
  });

  it('a failing lens degrades to the surviving readings, never to an error', async () => {
    const svcM = new ClaudeKycService();
    let call = 0;
    jest.spyOn(svcM, 'scan').mockImplementation(async () => {
      call += 1;
      if (call === 1) return findings({ same_person: 60 });
      if (call === 2) throw new Error('lens timeout');
      return findings({ same_person: 64 });
    });
    const out = await svcM.scanWithConsensus({
      selfieBase64: 'x',
      documentUrl: 'u',
      mode: 'standard',
    });
    expect(out.samples).toBe(2);
    expect(out.findings.face_match.same_person).toBe(62); // median of 2 = mean
  });

  it('all extra lenses failing falls back to the baseline reading alone', async () => {
    const svcM = new ClaudeKycService();
    let call = 0;
    jest.spyOn(svcM, 'scan').mockImplementation(async () => {
      call += 1;
      if (call === 1) return findings({ same_person: 60 });
      throw new Error('down');
    });
    const out = await svcM.scanWithConsensus({
      selfieBase64: 'x',
      documentUrl: 'u',
      mode: 'standard',
    });
    expect(out.samples).toBe(1);
    expect(out.findings.face_match.same_person).toBe(60);
  });

  it('OCR takes a majority vote — two lenses outvote one misread digit', async () => {
    const svcM = new ClaudeKycService();
    const ids = ['8001015009087', '8001015009087', '8OO1015009087'];
    let i = 0;
    jest.spyOn(svcM, 'scan').mockImplementation(async () => {
      const f = findings({ same_person: 60 });
      f.document.extracted_id_number = ids[i++] ?? ids[0];
      return f;
    });
    const out = await svcM.scanWithConsensus({
      selfieBase64: 'x',
      documentUrl: 'u',
      mode: 'standard',
    });
    expect(out.findings.document.extracted_id_number).toBe('8001015009087');
  });

  it('three disagreeing OCR reads keep the deterministic baseline, not an arbitrary pick', async () => {
    const svcM = new ClaudeKycService();
    const ids = ['8001015009087', '9001015009087', '7001015009087'];
    let i = 0;
    jest.spyOn(svcM, 'scan').mockImplementation(async () => {
      const f = findings({ same_person: 60 });
      f.document.extracted_id_number = ids[i++] ?? ids[0];
      return f;
    });
    const out = await svcM.scanWithConsensus({
      selfieBase64: 'x',
      documentUrl: 'u',
      mode: 'standard',
    });
    expect(out.findings.document.extracted_id_number).toBe(ids[0]);
  });

  it('never synthesises an anchored score that no lens produced', async () => {
    const svcM = new ClaudeKycService();
    jest
      .spyOn(svcM, 'scan')
      .mockImplementation(async () => findings({ same_person: 60 }));
    const out = await svcM.scanWithConsensus({
      selfieBase64: 'x',
      documentUrl: 'u',
      mode: 'standard',
    });
    expect(out.findings.face_match.same_person_vs_ha_photo).toBeUndefined();
  });
});

describe('ClaudeKycService.statusFromFindings', () => {
  const svc = new ClaudeKycService();

  it('VERIFIED when all gates ≥70 and cross-check clean', () => {
    expect(svc.statusFromFindings(findings(), clean, 'standard')).toBe('VERIFIED');
  });

  // ── Capture quality vs identity ────────────────────────────────────
  // These encode the rule that an unreadable photo is a camera problem,
  // not an accusation. Before this split, every case below returned
  // REJECTED — costing the seller a strike and a failure SMS, and the
  // admin an urgent review item, for a photo that was merely too dark.
  describe('quality failures ask for a retake instead of rejecting', () => {
    it('unreadable document → RETAKE, not REJECTED', () => {
      expect(
        svc.statusFromFindings(findings({ legibility: 20 }), clean, 'standard'),
      ).toBe('RETAKE');
    });

    it('ID photo not clear enough → RETAKE, not REJECTED', () => {
      expect(
        svc.statusFromFindings(
          findings({ document_photo_visible: 15 }),
          clean,
          'standard',
        ),
      ).toBe('RETAKE');
    });

    it('a real identity failure OUTRANKS poor quality — still REJECTED', () => {
      // Both bad: we could see enough to know it is the wrong person, so a
      // blurry capture must not launder that into a polite "try again".
      expect(
        svc.statusFromFindings(
          findings({ same_person: 10, legibility: 20 }),
          clean,
          'standard',
        ),
      ).toBe('REJECTED');
    });

    it('a forged document OUTRANKS poor quality — still REJECTED', () => {
      expect(
        svc.statusFromFindings(
          findings({ looks_genuine_sa_id: 12, legibility: 20 }),
          clean,
          'standard',
        ),
      ).toBe('REJECTED');
    });

    it('anti-spoofing survives: screen re-shoot REJECTS even with clean quality', () => {
      expect(
        svc.statusFromFindings(
          findings({ selfie_live_capture: 20 }),
          clean,
          'standard',
        ),
      ).toBe('REJECTED');
    });

    it('a hard cross-check lie REJECTS even when the only score issue is quality', () => {
      expect(
        svc.statusFromFindings(findings({ legibility: 20 }), hard, 'standard'),
      ).toBe('REJECTED');
    });

    it('anchored: a failed HA-photo match REJECTS, never downgraded to RETAKE', () => {
      expect(
        svc.statusFromFindings(
          findings({ same_person_vs_ha_photo: 10, legibility: 20 }),
          clean,
          'anchored',
        ),
      ).toBe('REJECTED');
    });

    it('merely mediocre quality (50-69) still routes to a human, not a retake', () => {
      expect(
        svc.statusFromFindings(findings({ legibility: 60 }), clean, 'standard'),
      ).toBe('UNDER_REVIEW');
    });

    it('retakeReason names what to fix rather than saying "failed"', () => {
      const msg = svc.retakeReason(findings({ legibility: 20 }));
      expect(msg).toMatch(/not readable/i);
      expect(msg).toMatch(/good light/i);
      expect(msg).not.toMatch(/reject|fail/i);
    });
  });

  it('REJECTED when any gate <50', () => {
    expect(
      svc.statusFromFindings(findings({ same_person: 30 }), clean, 'standard'),
    ).toBe('REJECTED');
    expect(
      svc.statusFromFindings(findings({ looks_genuine_sa_id: 10 }), clean, 'standard'),
    ).toBe('REJECTED');
  });

  it('UNDER_REVIEW in the 50-69 band', () => {
    expect(
      svc.statusFromFindings(findings({ same_person: 65 }), clean, 'standard'),
    ).toBe('UNDER_REVIEW');
  });

  it('boundary: 70 → VERIFIED, 69 → UNDER_REVIEW, 50 → UNDER_REVIEW, 49 → REJECTED', () => {
    expect(svc.statusFromFindings(findings({ same_person: 70 }), clean, 'standard')).toBe('VERIFIED');
    expect(svc.statusFromFindings(findings({ same_person: 69 }), clean, 'standard')).toBe('UNDER_REVIEW');
    expect(svc.statusFromFindings(findings({ same_person: 50 }), clean, 'standard')).toBe('UNDER_REVIEW');
    expect(svc.statusFromFindings(findings({ same_person: 49 }), clean, 'standard')).toBe('REJECTED');
  });

  it('soft cross-check fails cap the verdict at UNDER_REVIEW even at perfect scores', () => {
    expect(svc.statusFromFindings(findings(), soft, 'standard')).toBe('UNDER_REVIEW');
  });

  it('hard cross-check fails REJECT regardless of scores', () => {
    expect(svc.statusFromFindings(findings(), hard, 'standard')).toBe('REJECTED');
  });

  it('anchored mode: missing HA-photo score counts as 0 → REJECTED, never a silent pass', () => {
    expect(
      svc.statusFromFindings(findings({ same_person_vs_ha_photo: undefined }), clean, 'anchored'),
    ).toBe('REJECTED');
  });

  it('anchored mode: strong HA-photo match verifies; weak one reviews', () => {
    expect(
      svc.statusFromFindings(findings({ same_person_vs_ha_photo: 90 }), clean, 'anchored'),
    ).toBe('VERIFIED');
    expect(
      svc.statusFromFindings(findings({ same_person_vs_ha_photo: 60 }), clean, 'anchored'),
    ).toBe('UNDER_REVIEW');
  });
});

describe('ClaudeKycService.scan failure modes', () => {
  const OLD_KEY = process.env.ANTHROPIC_API_KEY;
  afterAll(() => {
    if (OLD_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = OLD_KEY;
  });

  it('throws when no API key is configured (caller maps to UNDER_REVIEW)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const svc = new ClaudeKycService();
    await expect(
      svc.scan({ selfieBase64: 'x', documentUrl: 'https://res.cloudinary.com/x/image/upload/doc.jpg', mode: 'standard' }),
    ).rejects.toThrow('no API key');
  });

  it('throws when called without any document', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const svc = new ClaudeKycService();
    await expect(
      svc.scan({ selfieBase64: 'x', mode: 'standard' }),
    ).rejects.toThrow('without a document');
  });
});
