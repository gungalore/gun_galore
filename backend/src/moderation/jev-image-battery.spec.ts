import { LlmError, type JevAnswer } from '../common/llm/llm.types';
import {
  evaluateFeedPhoto,
  evaluateListingPhoto,
  feedPhotoQuestions,
  listingPhotoQuestions,
} from './jev-image-battery';

function noul(value: number): JevAnswer {
  return { type: 'noul', noul: value };
}

function choice(value: string, confidence = 0.9): JevAnswer {
  return {
    type: 'choice',
    choice: value,
    probabilities: {},
    confidence,
  };
}

function listingAnswers(
  overrides: Partial<Record<string, number>> = {},
): Record<string, JevAnswer> {
  return {
    contact: noul(overrides.contact ?? 0.05),
    qr: noul(overrides.qr ?? 0.05),
    address: noul(overrides.address ?? 0.05),
    advertising: noul(overrides.advertising ?? 0.05),
    live_ammo: noul(overrides.live_ammo ?? 0.05),
  };
}

function feedAnswers(overrides: {
  promotional?: number;
  illegal?: number;
  other_violation?: number;
  graphic?: string;
  confidence?: number;
}): Record<string, JevAnswer> {
  return {
    promotional: noul(overrides.promotional ?? 0.05),
    illegal: noul(overrides.illegal ?? 0.05),
    other_violation: noul(overrides.other_violation ?? 0.05),
    graphic: choice(overrides.graphic ?? 'NONE', overrides.confidence ?? 0.9),
  };
}

describe('listing photo battery', () => {
  it('asks five atomic questions about the one asset', () => {
    const questions = listingPhotoQuestions(false);
    expect(Object.keys(questions).sort()).toEqual(
      ['address', 'advertising', 'contact', 'live_ammo', 'qr'].sort(),
    );
    for (const question of Object.values(questions)) {
      expect(question.type).toBe('noul');
      expect(JSON.stringify(question)).toContain('`photo`');
    }
  });

  it('adds the seller-redaction instruction only when redacted', () => {
    const clean = JSON.stringify(listingPhotoQuestions(false));
    const redacted = JSON.stringify(listingPhotoQuestions(true));

    expect(clean).not.toMatch(/intentionally blurred/i);
    expect(redacted).toMatch(/intentionally blurred or pixelated/i);
    expect(redacted).toMatch(/treat that area as removed/i);
  });

  it('splits block and review scores', () => {
    const verdict = evaluateListingPhoto(
      listingAnswers({ contact: 0.9, qr: 0.7, live_ammo: 0.85 }),
    );
    expect(verdict.blocks.sort()).toEqual(['contact', 'live_ammo'].sort());
    expect(verdict.reviews).toEqual(['qr']);
  });

  it('reads every category as clean below the review threshold', () => {
    expect(evaluateListingPhoto(listingAnswers())).toEqual({
      blocks: [],
      reviews: [],
    });
  });

  it('throws on a missing answer instead of reading it as clean', () => {
    const answers = listingAnswers();
    delete answers.contact;
    expect(() => evaluateListingPhoto(answers)).toThrow(LlmError);
  });

  it('throws on an out-of-range probability', () => {
    expect(() =>
      evaluateListingPhoto({ ...listingAnswers(), contact: noul(1.4) }),
    ).toThrow(LlmError);
  });
});

describe('feed photo battery', () => {
  it('asks three nouls and the graphic choice', () => {
    expect(Object.keys(feedPhotoQuestions()).sort()).toEqual(
      ['graphic', 'illegal', 'other_violation', 'promotional'].sort(),
    );
  });

  it('maps the flags and tier', () => {
    const v = evaluateFeedPhoto(
      feedAnswers({
        promotional: 0.9,
        illegal: 0.9,
        other_violation: 0.9,
        graphic: 'EXTREME',
      }),
    );
    expect(v.promoDetected).toBe(true);
    expect(v.illegalDetected).toBe(true);
    expect(v.otherViolation).toBe(true);
    expect(v.graphicTier).toBe('EXTREME');
    expect(v.uncertain).toBe(false);
  });

  it('marks the 60–80 % band uncertain', () => {
    const v = evaluateFeedPhoto(feedAnswers({ promotional: 0.7 }));
    expect(v.promoDetected).toBe(false);
    expect(v.uncertain).toBe(true);
  });

  it('marks a low-confidence graphic choice uncertain', () => {
    const v = evaluateFeedPhoto(
      feedAnswers({ graphic: 'FIELD', confidence: 0.4 }),
    );
    expect(v.graphicTier).toBe('FIELD');
    expect(v.uncertain).toBe(true);
  });

  it('throws when the graphic choice is outside the offered options', () => {
    expect(() => evaluateFeedPhoto(feedAnswers({ graphic: 'GORE' }))).toThrow(
      LlmError,
    );
  });
});
