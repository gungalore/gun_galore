import { describe, expect, it } from 'vitest';
import type { MotivationField } from '@/lib/motivations-api';
import {
  emptyAnswerLabel,
  MEMBER_ANSWERS,
  NOT_ON_DOCUMENT,
  NOT_READ_YET,
} from './empty-answer';

const f = (docSourced?: string) =>
  ({ docSourced }) as Pick<MotivationField, 'docSourced'>;

describe('⚠️ the ten false sentences on the operator\'s section 16', () => {
  it('does not say a document lacks a value when no document is here', () => {
    // "Your hunting association" is answered by the association letter. No
    // letter was attached, and the row still read "Not on the document".
    expect(emptyAnswerLabel(f('ASSOCIATION_LETTER'), new Set())).toBe(
      NOT_READ_YET,
    );
  });

  it('still says so once that document is actually attached', () => {
    expect(
      emptyAnswerLabel(f('ASSOCIATION_LETTER'), new Set(['ASSOCIATION_LETTER'])),
    ).toBe(NOT_ON_DOCUMENT);
  });

  it('another document being attached does not answer for this one', () => {
    expect(
      emptyAnswerLabel(f('ASSOCIATION_LETTER'), new Set(['ID_DOCUMENT'])),
    ).toBe(NOT_READ_YET);
  });
});

describe('a row only the member can answer never blames a document', () => {
  it('says so whether or not the attached set is known', () => {
    expect(emptyAnswerLabel(f(), new Set())).toBe(MEMBER_ANSWERS);
    expect(emptyAnswerLabel(f(), undefined)).toBe(MEMBER_ANSWERS);
    expect(emptyAnswerLabel(f(), new Set(['ID_DOCUMENT']))).toBe(MEMBER_ANSWERS);
  });
});

describe('a caller that cannot know what is attached keeps the old wording', () => {
  it('falls back rather than claiming the document is missing', () => {
    expect(emptyAnswerLabel(f('ASSOCIATION_LETTER'))).toBe(NOT_ON_DOCUMENT);
  });
});
