import { describe, expect, it } from 'vitest';
import { parseDescriptionBlocks } from './listing-description';

describe('parseDescriptionBlocks', () => {
  it('turns a hand-typed run of sentences into bullets', () => {
    expect(
      parseDescriptionBlocks(
        'Distance markers from 25m to 1km. Water resistant. UV resistant.',
      ),
    ).toEqual([
      {
        kind: 'bullets',
        items: [
          'Distance markers from 25m to 1km.',
          'Water resistant.',
          'UV resistant.',
        ],
      },
    ]);
  });

  it('keeps explicit bullets and headings as authored', () => {
    expect(
      parseDescriptionBlocks('Intro line\n\n- One fact\n- Another fact'),
    ).toEqual([
      { kind: 'para', text: 'Intro line' },
      { kind: 'bullets', items: ['One fact', 'Another fact'] },
    ]);
  });

  it('keeps a single sentence as a paragraph', () => {
    expect(parseDescriptionBlocks('Only one owner.')).toEqual([
      { kind: 'para', text: 'Only one owner.' },
    ]);
  });
});
