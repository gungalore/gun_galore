import { scoreMotivation, sentencesOf, summarise } from './motivation-quality';

/**
 * ⚠️ THE POINT OF THESE TESTS IS THE DISTINCTION THE SCORECARD EXISTS TO DRAW:
 * a longer document is not a richer one. Every case below is written so that
 * "more words" and "more specifics" pull in OPPOSITE directions, because a
 * metric that cannot tell them apart is worse than no metric.
 */
describe('measuring a motivation', () => {
  it('counts the species by their QUARRY spelling, once each, aliases included', () => {
    const q = scoreMotivation(
      'I hunt impala and greater kudu in the bushveld. ' +
        'The kudu bull is the quarry, and impala are common.',
    );
    // "kudu" and "greater kudu" are one animal, not two.
    expect(q.species).toEqual(['Impala', 'Kudu']);
  });

  it('does not count a species name that only appears inside another word', () => {
    const q = scoreMotivation('My kuduberry tree is in the garden.');
    expect(q.species).toEqual([]);
  });

  it('counts distances, annexures and terrain', () => {
    const q = scoreMotivation(
      'Shots are taken at 150 m and occasionally to 300 metres. ' +
        'My competency is at Annexure C and my licence at Annexure F. ' +
        'I hunt in the Karoo and on open plains.',
    );
    expect(q.distances).toEqual(['150 m', '300 metres']);
    expect(q.annexures).toEqual(['C', 'F']);
    expect(q.terrain).toEqual(expect.arrayContaining(['karoo', 'plains']));
  });

  it('flags the catalogue phrases the gate refuses on', () => {
    const q = scoreMotivation(
      'The pistol has a polymer frame and excellent stopping power.',
    );
    expect(q.banned).toEqual(
      expect.arrayContaining(['polymer frame', 'stopping power']),
    );
  });

  it('⚠️ REWARDS SPECIFICS AND PUNISHES PADDING, at the same word count', () => {
    // The same length. One names animals, distances and a citation; the other
    // says nothing checkable. This is the whole reason the metric exists.
    const specific =
      'I hunt impala and blesbok at 150 m in the Karoo. ' +
      'My competency is at Annexure C. I also take kudu at 200 m. ' +
      'The rifle suits springbok on open plains.';
    const padded =
      'I have always been interested in hunting and the outdoors. ' +
      'It is something I enjoy doing whenever I have the opportunity. ' +
      'I believe it is important to do things properly and safely. ' +
      'I would very much like to continue doing this in future.';

    const a = scoreMotivation(specific);
    const b = scoreMotivation(padded);

    expect(a.words).toBeGreaterThan(0);
    expect(a.specificity).toBeGreaterThan(b.specificity);
    expect(a.longestGenericRun).toBeLessThan(b.longestGenericRun);
    // The padded one carries no species, no distance and no citation at all.
    expect(b.species).toEqual([]);
    expect(b.distances).toEqual([]);
    expect(b.annexures).toEqual([]);
  });

  it('measures the longest unbroken run of sentences with nothing concrete', () => {
    const q = scoreMotivation(
      'I enjoy the outdoors. It is a good pastime. It keeps me active. ' +
        'I hunt impala at 150 m. ' +
        'I also enjoy the social side. It is good for me.',
    );
    // Three generic sentences, then the specific one breaks the run, then two.
    expect(q.longestGenericRun).toBe(3);
  });

  it('handles an empty body without dividing by zero', () => {
    const q = scoreMotivation('');
    expect(q).toMatchObject({ words: 0, sentences: 0, specificity: 0 });
    expect(Number.isNaN(q.specificity)).toBe(false);
  });

  it('splits sentences on terminal punctuation, including question marks', () => {
    expect(sentencesOf('One. Two! Three? Four')).toHaveLength(4);
  });

  it('summarises specificity before the word count', () => {
    // The order is the argument: a longer, less specific document must not read
    // as an improvement in the one line a human actually looks at.
    const line = summarise(scoreMotivation('I hunt impala at 150 m.'));
    expect(line.startsWith('spec ')).toBe(true);
    // The word count is still there, just not leading.
    expect(line).toMatch(/\d+w/);
  });
});
