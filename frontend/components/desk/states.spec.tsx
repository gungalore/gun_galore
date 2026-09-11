import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE DESK — the spec that keeps SkeletonCard's gap tied to DeskCard's.
 *
 * ⚠️ READ WHAT THIS DOES AND DOES NOT CLAIM, because the first version of this
 * file claimed the wrong thing confidently and the measurement disagreed.
 *
 * It does NOT claim the skeleton is the card's height, and no spec here could:
 * DeskCard renders between two and five children (the row and the headline are
 * unconditional; meta, note and the actions row are each conditional) while
 * SkeletonCard always draws four bars, and the bars are 14/15/12/34 against a
 * card whose children measure 22 / 20.25 / 18.125 / var(--dk-h-control). The
 * pile therefore DOES move when data lands, by an amount that depends on what
 * the cards turn out to contain. That is inherent to drawing a placeholder for
 * a variable-height thing, and pretending otherwise is how the original
 * "nothing moves when data lands" comment came to state a 6px gap delta as an
 * 18px height delta.
 *
 * What it DOES pin is narrower and actually true: the gap is a HAND MIRROR
 * across two files, so it must not become a SECOND, independent source of that
 * movement. `.dk-card dk-stack` gives both elements the surface, hairline,
 * radius and padding for free. The gap it does not, because DeskCard overrides
 * `.dk-stack`'s `gap: var(--dk-gap)` (10px) with an inline `gap: 8` and an
 * inline style beats a class. The skeleton did not copy that override and drew
 * 10px for three gaps against the card's 8.
 *
 * ⚠️ IT IS A .spec.tsx, WITH THE x, AND IT MUST STAY ONE. vitest.config.ts
 * includes `components/**\/*.spec.tsx` — a `.spec.ts` under components/ is
 * never collected: it reports nothing, fails nothing, and passes the deploy
 * gate BY NOT EXISTING.
 */

const STATES = readFileSync(new URL('./states.tsx', import.meta.url), 'utf8');
const CARD = readFileSync(new URL('./card.tsx', import.meta.url), 'utf8');

/**
 * The inline `gap` on the `dk-card dk-stack` element inside ONE named
 * component.
 *
 * ⚠️ ANCHORED ON THE COMPONENT, NOT ON THE FIRST MATCH IN THE FILE. states.tsx
 * has TWO elements wearing `dk-card dk-stack` — SkeletonCard and FailedRegion,
 * which has its own `gap: 12` — so a bare indexOf reads whichever is declared
 * first and would silently re-point at FailedRegion the day somebody adds a
 * card-shaped state above it. This file's whole job is holding several states,
 * so that reordering is a normal edit, not a freak one.
 *
 * ⚠️ AND THE WINDOW IS THE ELEMENT'S OWN STYLE OBJECT, BRACE-MATCHED. Reading
 * "the next `gap:` within N characters" is what the first version did, and the
 * very next gap in states.tsx is the INNER `<span className="dk-row"
 * style={{ gap: 8 }}>` about sixty characters later. So deleting the outer
 * inline gap — the exact bug this file exists to catch — left the suite green,
 * because it found the row's 8 and reported it as the card's. A spec that
 * passes on the bug it was written for is worse than no spec: it is a claim
 * the regression cannot happen.
 *
 * Read off source rather than a render on purpose: the failure being caught is
 * "somebody edited one of the two numbers", and a render would also pass if
 * BOTH silently fell back to the token.
 */
function cardGap(src: string, component: string, label: string): number {
  const start = src.indexOf(`export function ${component}`);
  expect(start, `${label}: no \`export function ${component}\` in this file`).toBeGreaterThan(-1);

  const at = src.indexOf('className="dk-card dk-stack"', start);
  expect(
    at,
    `${label}: ${component} no longer wears \`dk-card dk-stack\``,
  ).toBeGreaterThan(-1);

  // The element's own style object: from the `style={{` that follows the
  // className, to its matching close. Brace-matched rather than length-capped
  // because card.tsx's object carries an eight-line comment between the gap
  // and the end of the object.
  const styleAt = src.indexOf('style={{', at);
  expect(
    styleAt,
    `${label}: ${component}'s \`dk-card dk-stack\` element declares no inline ` +
      'style, so its gap is .dk-stack\'s var(--dk-gap) = 10px. If that is now ' +
      'deliberate for BOTH of them, delete this spec and say so.',
  ).toBeGreaterThan(-1);

  let depth = 0;
  let end = -1;
  for (let i = styleAt + 'style={'.length; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, `${label}: ${component}'s style object is not brace-balanced`).toBeGreaterThan(-1);

  const own = src.slice(styleAt, end);
  const m = /\bgap:\s*(\d+)\b/.exec(own);
  expect(
    m,
    `${label}: ${component}'s \`dk-card dk-stack\` element sets no \`gap\` in its ` +
      'own style object, so it takes .dk-stack\'s var(--dk-gap) = 10px while its ' +
      'twin keeps an inline 8. That is the original bug exactly.',
  ).not.toBeNull();

  return Number(m![1]);
}

describe('the skeleton mirrors the card\'s gap', () => {
  it('opens the same gap as DeskCard', () => {
    const skeleton = cardGap(STATES, 'SkeletonCard', 'states.tsx');
    const card = cardGap(CARD, 'DeskCard', 'card.tsx');

    expect(
      skeleton,
      `SkeletonCard's gap is ${skeleton}px and DeskCard's is ${card}px.\n` +
        'The skeleton draws four children, so three gaps; the difference is added to\n' +
        'every card in the pile on top of whatever the child heights already differ\n' +
        'by. The heights cannot be made equal — DeskCard renders 2-5 children — but\n' +
        'the gap is a hand mirror and can. Change both, or neither.',
    ).toBe(card);
  });

  it('does not silently fall back to --dk-gap', () => {
    // ⚠️ THE PAIR MUST STAY LITERAL, AND THAT IS NOT LAZINESS. Editing
    // --dk-gap in tokens.css moves `.dk-stack` everywhere and would move the
    // skeleton while leaving DeskCard's inline 8 behind — the mismatch
    // reappearing from a file that mentions neither component. Equal-and-
    // literal is the only shape where one edit cannot desynchronise them.
    expect(cardGap(STATES, 'SkeletonCard', 'states.tsx')).toBe(8);
  });
});
