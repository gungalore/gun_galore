import { maskBadLanguage } from './bad-language';

describe('maskBadLanguage', () => {
  it('masks profanity but keeps the sentence readable', () => {
    expect(maskBadLanguage('This fucking rifle is shit.')).toBe(
      'This f****** rifle is s***.',
    );
  });

  it('leaves clean text, including similar-looking words, alone', () => {
    expect(maskBadLanguage('A class act with a classic rifle.')).toBe(
      'A class act with a classic rifle.',
    );
  });

  it('masks Afrikaans as well as English', () => {
    expect(maskBadLanguage('Die fokken ding is kak.')).toBe(
      'Die f***** ding is k**.',
    );
  });

  it('does not mask a sexual term — that is a block, not a mask', () => {
    expect(maskBadLanguage('explicit porn')).toBe('explicit porn');
  });
});
