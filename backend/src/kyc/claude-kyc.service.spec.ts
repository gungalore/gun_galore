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
