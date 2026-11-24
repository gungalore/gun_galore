import { LlmError, type JevAnswer } from '../common/llm/llm.types';
import {
  askPhotoQuestions,
  evaluateFeedPhoto,
  evaluateListingPhoto,
  evaluateListingPhotoBoxes,
  feedPhotoQuestions,
  isJevMaxTokensError,
  listingPhotoBoxQuestions,
  listingPhotoQuestions,
  maskablePhotoCategories,
  PHOTO_SCREEN_MAX_SIDES,
} from './jev-image-battery';
import sharp from 'sharp';

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
    sexual: noul(overrides.sexual ?? 0.05),
  };
}

function feedAnswers(overrides: {
  promotional?: number;
  illegal?: number;
  other_violation?: number;
  sexual_explicit?: number;
  graphic?: string;
  confidence?: number;
}): Record<string, JevAnswer> {
  return {
    promotional: noul(overrides.promotional ?? 0.05),
    illegal: noul(overrides.illegal ?? 0.05),
    other_violation: noul(overrides.other_violation ?? 0.05),
    sexual_explicit: noul(overrides.sexual_explicit ?? 0.05),
    graphic: choice(overrides.graphic ?? 'NONE', overrides.confidence ?? 0.9),
  };
}

describe('listing photo battery', () => {
  it('asks six atomic questions about the one asset', () => {
    const questions = listingPhotoQuestions(false);
    expect(Object.keys(questions).sort()).toEqual(
      ['address', 'advertising', 'contact', 'live_ammo', 'qr', 'sexual'].sort(),
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

describe('feed photo battery', () => {  it('asks four nouls and the graphic choice', () => {
    expect(Object.keys(feedPhotoQuestions()).sort()).toEqual(
      [
        'graphic',
        'illegal',
        'other_violation',
        'promotional',
        'sexual_explicit',
      ].sort(),
    );
  });

  it('⚠️ BLOCKS FULL NUDITY BUT LEAVES SWIMWEAR TO THE QUESTION', () => {
    const v = evaluateFeedPhoto(feedAnswers({ sexual_explicit: 0.94 }));
    expect(v.sexualExplicit).toBe(true);
    expect(v.uncertain).toBe(false);
    expect(JSON.stringify(feedPhotoQuestions())).toMatch(/bikini/i);
    expect(JSON.stringify(feedPhotoQuestions())).toMatch(/swimwear/i);
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

describe('listing photo boxes', () => {
  it('maps flag names to the maskable categories', () => {
    expect(
      maskablePhotoCategories([
        'photo-contact-info',
        'qr-code',
        'live-ammo',
        'advertising',
      ]),
    ).toEqual(['contact', 'qr', 'advertising']);
  });

  it('asks three boxes per requested category', () => {
    const questions = listingPhotoBoxQuestions(['contact']);
    expect(Object.keys(questions).sort()).toEqual([
      'mask_contact_1',
      'mask_contact_2',
      'mask_contact_3',
    ]);
    for (const question of Object.values(questions)) {
      expect(question.type).toBe('box');
    }
  });

  it('asks for a tight contact box that excludes a brand wordmark above it', () => {
    const question = listingPhotoBoxQuestions(['contact'])
      .mask_contact_1 as { instructions: string };
    expect(question.instructions).toMatch(/top edge at the top/i);
    expect(question.instructions).toMatch(/brand wordmark/i);
    expect(question.instructions).toMatch(/start below it/i);
  });

  it('only asks about the categories that tripped', () => {
    const questions = listingPhotoBoxQuestions(['qr']);
    expect(Object.keys(questions)).toHaveLength(3);
    expect(
      Object.keys(questions).every((key) => key.startsWith('mask_qr_')),
    ).toBe(true);
  });

  it('filters bad boxes and dedupes a repeated ordinal', () => {
    const box = (
      left: number,
      right: number,
      top: number,
      bottom: number,
      confidence: number | null,
    ) =>
      ({
        type: 'box',
        box: { left, right, top, bottom },
        confidence,
      }) as JevAnswer;

    const out = evaluateListingPhotoBoxes({
      mask_contact_1: box(0.1, 0.4, 0.1, 0.2, 0.9),
      mask_contact_2: box(0.11, 0.39, 0.11, 0.19, 0.8),
      mask_contact_3: box(0.5, 0.6, 0.5, 0.6, 0.2),
      mask_qr_1: box(0.7, 0.99, 0.7, 0.9, null),
    });

    expect(out).toEqual([
      expect.objectContaining({ category: 'contact', confidence: 0.9 }),
    ]);
  });
});

// 2026-11-24: every listing photo upload was failing with
// "max_tokens_exceeded" because the screen sent the photo at the 1568px
// document default plus the six-question battery, which is over JEV's 32k
// state budget (a 1280px preview passed at ~29.8k). These lock the fallback.
describe('askPhotoQuestions — JEV token-budget fallback', () => {
  async function photoPart() {
    const width = 1600;
    const height = 1200;
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < raw.length; i += 997) raw[i] = (i * 37) % 255;
    const buf = await sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
    return {
      type: 'image' as const,
      mimeType: 'image/jpeg',
      data: buf.toString('base64'),
    };
  }

  it('shrinks the image and retries when JEV reports max_tokens_exceeded', async () => {
    const part = await photoPart();
    const assetSizes: number[] = [];
    let calls = 0;
    const decide = jest.fn(async (req: any) => {
      calls += 1;
      assetSizes.push(String(req.assets.photo.data_base64).length);
      if (calls === 1) {
        throw new LlmError(
          'unknown',
          'typesafe 400: {"detail":{"error_type":"max_tokens_exceeded"}}',
          400,
        );
      }
      return {
        model: 'jev-1.14.0',
        answers: {},
        usage: { inputTokens: 1, outputTokens: 0 },
        provider: 'typesafe' as const,
      };
    });

    await askPhotoQuestions(
      { decide },
      {
        part,
        state: { photo: 'photo' },
        questions: { contact: listingPhotoQuestions(false).contact },
        purpose: 'moderation.listing.images',
      },
    );

    expect(decide).toHaveBeenCalledTimes(2);
    // The retry must send a SMALLER payload than the one that was refused.
    expect(assetSizes[1]).toBeLessThan(assetSizes[0]);
  });

  it('rethrows any other provider error without retrying', async () => {
    const part = await photoPart();
    const decide = jest.fn(async () => {
      throw new LlmError('rate_limited', 'typesafe 429: slow down', 429);
    });
    await expect(
      askPhotoQuestions(
        { decide },
        {
          part,
          state: { photo: 'photo' },
          questions: {},
          purpose: 'moderation.listing.images',
        },
      ),
    ).rejects.toThrow(/slow down/);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('classifies only the provider over-budget response as retryable-smaller', () => {
    expect(
      isJevMaxTokensError(
        new LlmError(
          'unknown',
          'typesafe 400: {"detail":{"error_type":"max_tokens_exceeded"}}',
          400,
        ),
      ),
    ).toBe(true);
    expect(isJevMaxTokensError(new LlmError('bad_request', 'nope', 422))).toBe(
      false,
    );
    expect(isJevMaxTokensError(new Error('max_tokens_exceeded'))).toBe(false);
  });

  it('tries 1280 first, then 1152 and 1024', () => {
    expect([...PHOTO_SCREEN_MAX_SIDES]).toEqual([1280, 1152, 1024]);
  });
});
