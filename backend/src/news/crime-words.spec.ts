import { looksLikeCrime } from './crime-words';

describe('looksLikeCrime — the pre-filter that decides what costs a model call', () => {
  it.each([
    'Two arrested after Norkem Park house robbery',
    'Hijacking on the R40 near White River',
    'Man shot dead outside Brakpan tavern',
    'Rapist father jailed for life',
    'ATM bombing accused appear in Evander Regional Court',
    'West Rand targeted in major Shanela crackdown by SAPS',
  ])('passes %s', (headline) => {
    expect(looksLikeCrime(headline)).toBe(true);
  });

  it.each([
    'Adopt a Pet: give these lovable pets a second chance',
    'Note date change for East Rand Business Women golf day',
    'Prepaid power vending system still down in eThekwini',
    'Explore your own country: Tourism Month puts local businesses first',
  ])('rejects %s', (headline) => {
    expect(looksLikeCrime(headline)).toBe(false);
  });

  // ⚠️ THE REGISTRY CARRIES SIX AFRIKAANS AND isiZULU TITLES. An English-only
  // list makes them poll perfectly and contribute nothing.
  it.each([
    'Man vermoor tydens rooftog in Vanderbijlpark',
    'Verdagte in hof ná inbraak by skool',
    'Amaphoyisa aboshe abasolwa ababulele indoda',
  ])('passes the non-English headline %s', (headline) => {
    expect(looksLikeCrime(headline)).toBe(true);
  });

  it('reads the standfirst too, not only the headline', () => {
    expect(
      looksLikeCrime('Quiet night in the village', 'Until two men were robbed at the taxi rank.'),
    ).toBe(true);
  });

  // ⚠️ WORD BOUNDARIES, NOT SUBSTRINGS. "grapes" contains "rape" and this
  // filter feeds a self-defence motivation; a wine harvest is not evidence.
  it('does not fire inside a longer word', () => {
    expect(looksLikeCrime('Record grapes harvested in Paarl this season')).toBe(false);
    expect(looksLikeCrime('Bodybuilding championship comes to Benoni')).toBe(false);
  });

  // The other half of that rule: a word may grow a tail.
  it('fires on an inflection of a listed word', () => {
    expect(looksLikeCrime('Shop robbed in broad daylight')).toBe(true);
    expect(looksLikeCrime('Robbers flee with cash')).toBe(true);
  });
});
