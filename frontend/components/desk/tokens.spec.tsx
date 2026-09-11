import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE DESK — the spec that keeps the class layer CLOSED.
 *
 * ⚠️ THIS FILE EXISTS TO MAKE ADDING A CLASS AN ARGUMENT RATHER THAN A HABIT.
 *
 * Before Phase 2 the Desk had no shared style layer at all: 114 inline style
 * objects across seven files, 197 hard-coded font sizes in seventeen distinct
 * values against ONE font-size token, and `Chip` hard-coding 30px while Button
 * and Input beside it read `--dk-h-control` — because there was nowhere to put
 * "a control is --dk-h-control". A layer fixes that. A layer that grows fixes
 * nothing: it becomes a private Tailwind with no responsive variants, no state
 * variants and no documentation — and nothing mechanical would notice.
 * `scripts/desk-guard.cjs` does NOT keep Tailwind off this surface, whatever
 * an earlier draft of this comment said: it bans `shadow-*` and `ring-*`
 * only, and only because the global box-shadow kill switch already makes
 * those two do nothing. Ordinary utilities are allowed here. The cap is the
 * defence; believing the guard is one is how the cap gets argued away.
 *
 * So the cap is the mechanism and the list below is the ledger. Adding a class
 * fails this spec until somebody edits it, which is the conversation.
 *
 * ⚠️ IT IS A .spec.tsx, WITH THE x, AND IT MUST STAY ONE. vitest.config.ts
 * includes `components/**\/*.spec.tsx` — a `.spec.ts` under components/ is
 * never collected: it reports nothing, fails nothing, and passes the deploy
 * gate BY NOT EXISTING. There is no JSX in here and it is a .tsx anyway.
 */

const CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/**
 * ⚠️ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A DETAIL. The header of
 * tokens.css names the classes it DELIBERATELY DOES NOT HAVE — `.dk-t-title`,
 * `.dk-spacer`, `.dk-list-row`, `.dk-hscroll` — because recording the ones
 * that were refused is most of the value of writing the rule down. Counting
 * prose would make the file fail for explaining itself.
 */
function classesIn(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Set<string>();
  for (const m of code.matchAll(/\.(dk-[a-z0-9-]+)/g)) found.add(m[1]);
  return [...found].sort();
}

/**
 * ⚠️ THE ADMISSION RULE, QUOTED FROM tokens.css SO THE TWO CANNOT DRIFT:
 *
 *   "a class earns its place ONLY when the same declaration BLOCK is repeated
 *    in THREE OR MORE FILES. Not three uses of `font-size: 12.5` — three
 *    repetitions of the same set of declarations."
 *
 * And the second half, which is the one that actually binds here:
 *
 *   "the cap binds before the rule does. More blocks qualify than there are
 *    slots. The slots went to the blocks a RESTYLE touches: surfaces, control
 *    chrome, type, and the responsive geometry that cannot live in JavaScript.
 *    Layout plumbing that a restyle never changes stays inline."
 *
 * Under twenty. Nineteen today. A twentieth means one of the nineteen leaves,
 * or you make the case in writing here for why the rule changed.
 */
const MAX_DK_CLASSES = 20;

/**
 * The ledger. Grouped by what each one is FOR, because "nineteen classes" is
 * only a useful budget if you can see what the money went on.
 */
const EXPECTED = [
  // Pre-existing, and none of them a utility.
  'dk-mono', //    the data face — 52 call sites
  'dk-drawer', //  wins the shadow back from globals.css, plus the drawer's geometry
  'dk-dialog', //  the same, AND the marker DrawerBody's Escape handler queries
  'dk-reg-row', // the register row, at both breakpoints — see register-list.tsx
  'dk-reg-lead',
  'dk-reg-thumb',
  'dk-reg-main',
  'dk-reg-trail',

  // Layout — the two shapes the whole surface is made of, plus the ellipsis.
  'dk-stack',
  'dk-row',
  'dk-truncate',

  // Chrome — the two blocks a restyle actually rewrites.
  'dk-card',
  'dk-control',

  // Type.
  'dk-t-label',
  'dk-t-body',
  'dk-t-meta',

  // The breakpoint, as CSS rather than as `useIsPhone`.
  'dk-phone-only',
  'dk-desk-only',
  'dk-sheet',
].sort();

/**
 * Every selector prelude in the file, comments stripped, at-rules dropped.
 *
 * ⚠️ A SELECTOR IS EVERYTHING SINCE THE LAST BRACE — NOT THE TEXT ON THE `{`
 * LINE. Splitting on braces is what lets a grouped selector spread over two
 * lines be seen whole; a `^…$`-anchored line regex sees only the last line of
 * the group and waves the rest through. See the spec below for the exact case.
 *
 * At-rules are dropped by the leading `@`, which also drops the `@media`
 * preludes while leaving the rules nested INSIDE them to be checked — the
 * responsive `.dk-phone-only` / `.dk-desk-only` rules live nowhere else.
 *
 * 🚨 THE BRACE IS A LOOKAHEAD, AND IT HAS TO BE. Written `([^{}]*)\{` the
 * brace is CONSUMED, so after matching an `@media (…)` prelude the scan
 * resumes INSIDE the block with no delimiter left to re-enter on — and every
 * rule nested in an at-rule stops being checked. That is not a smaller net,
 * it is a hole in exactly the place this file says it is strongest: seven
 * `.dk-` rules live inside `@media` blocks, `.dk-phone-only` and
 * `.dk-desk-only` among them, and an unscoped `.dk-phone-only` is a global
 * `display: none !important` loose on the storefront. It shipped that way
 * once, green, with this very docblock naming those two classes as proof the
 * handling was safe. `(?=\{)` leaves the brace in the stream to serve as the
 * next match's delimiter.
 */
function selectorsIn(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|[{}])([^{}]*)(?=\{)/g)) {
    const selector = m[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    out.push(selector);
  }
  return out;
}

/** Throws (as a failed expectation) on the first Desk selector missing its scope. */
function assertScoped(css: string): void {
  for (const selector of selectorsIn(css)) {
    if (!selector.includes('.dk-')) continue;
    for (const part of selector.split(',')) {
      expect(part.trim(), `unscoped Desk selector: ${part.trim()}`).toMatch(/^\[data-desk\]/);
    }
  }
}

describe('the Desk class layer', () => {
  it('stays under the cap', () => {
    const classes = classesIn(CSS);
    expect(
      classes.length,
      `tokens.css defines ${classes.length} .dk-* classes:\n  ${classes.join('\n  ')}\n\n` +
        'A class earns its place only when the same declaration BLOCK is repeated in\n' +
        'three or more files — and the cap binds before that rule does. Adding one\n' +
        'means removing one, or arguing here that the rule has changed.',
    ).toBeLessThan(MAX_DK_CLASSES);
  });

  it('defines exactly the classes on the ledger, and no others', () => {
    // ⚠️ NOT JUST A COUNT. A count alone is satisfied by swapping a class out
    // for a different one, which is the same erosion arriving sideways — the
    // layer stays at nineteen while nobody notices `.dk-card` became
    // `.dk-panel` and half the tree still asks for the old name.
    expect(classesIn(CSS)).toEqual(EXPECTED);
  });

  it('hides with !important and never tries to show', () => {
    /**
     * ⚠️ BOTH HALVES OF THIS ARE BUGS THAT WOULD NOT ANNOUNCE THEMSELVES.
     *
     * Without `!important`, an element carrying an inline `display: flex`
     * beats the class and renders on the breakpoint where it is wrong —
     * inline wins over a class, always. And a matching `display: revert` or
     * `display: block` "show" rule would flatten a flex row to a block on the
     * breakpoint it was supposed to be showing normally on. The correct shape
     * is: contribute `display: none !important` inside one media query, and
     * contribute NOTHING outside it.
     */
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

    for (const name of ['dk-phone-only', 'dk-desk-only']) {
      const rules = [...code.matchAll(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`, 'g'))].map(
        (m) => m[1],
      );
      expect(rules, `${name} must be declared exactly once`).toHaveLength(1);
      expect(rules[0].replace(/\s+/g, ' ').trim()).toBe('display: none !important;');
    }

    // And each sits inside a media query — a bare rule would hide its element
    // at every width, which is the loudest possible version of this bug and
    // therefore the one least likely to ship. Named here anyway, because the
    // quiet version is someone "simplifying" the media blocks away.
    expect(code).toMatch(/@media \(min-width: 1024px\)\s*\{\s*\[data-desk\] \.dk-phone-only/);
    expect(code).toMatch(/@media \(max-width: 1023\.98px\)\s*\{\s*\[data-desk\] \.dk-desk-only/);
  });

  it('keeps the one breakpoint spelled one way', () => {
    /**
     * ⚠️ 1023.98, NOT 1024, AND NOT 1023. The pair `max-width: 1023.98px` /
     * `min-width: 1024px` is the only spelling that leaves no gap and no
     * overlap on a fractional-pixel viewport — a laptop at 1023.5 CSS pixels
     * would otherwise match both rules or neither. `useIsPhone` matches the
     * same string in interactions.ts; three literals, no shared constant, and
     * this at least makes the ones in here agree with each other.
     */
    const widths = [...CSS.matchAll(/@media \((min|max)-width: ([\d.]+)px\)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(new Set(widths)).toEqual(new Set(['max:1023.98', 'min:1024']));
  });

  it('scopes every rule under [data-desk]', () => {
    /**
     * ⚠️ NOTHING HERE MAY LEAK TO :root. The storefront is a white retail skin
     * and the Desk is a near-black control room; they share a stylesheet, a
     * build and a browser tab, and this attribute is the ONLY thing keeping
     * them apart. A `.dk-card` without the scope would paint a #171B1A panel
     * into the shop the first time a class name collided.
     */
    assertScoped(CSS);
  });

  it('sees the first line of a grouped multi-line selector', () => {
    /**
     * ⚠️ THIS IS THE HOLE THE TEST ABOVE SHIPPED WITH, PINNED SO IT CANNOT BE
     * REOPENED BY "SIMPLIFYING" selectorsIn BACK TO A LINE REGEX. The old
     * extractor was `/^\s*([^@{}\n][^{}\n]*)\{/gm`: `[^{}\n]*` cannot cross a
     * newline, so a match had to BEGIN and END on the line carrying the `{`.
     * tokens.css folds `.dk-truncate` and `.dk-reg-main > span` onto one block
     * across two lines, and only the second line was ever examined — an
     * unscoped `.dk-truncate,` on the first would have leaked the Desk's
     * ellipsis rule to the shop with this file green. The real CSS is scoped
     * correctly today; the guard was simply not looking.
     */
    const leak = '.dk-truncate,\n[data-desk] .dk-reg-main > span {\n  min-width: 0;\n}\n';
    expect(() => assertScoped(leak)).toThrow(/unscoped Desk selector: \.dk-truncate/);

    // Both lines scoped: the same shape must still pass, or the fix above is
    // just a broken guard in the other direction.
    const fine = '[data-desk] .dk-truncate,\n[data-desk] .dk-reg-main > span {\n  min-width: 0;\n}\n';
    expect(() => assertScoped(fine)).not.toThrow();

    // And the file's real grouped rule is the one that proves the extractor
    // reaches it at all — both parts, not just the one wearing the brace.
    expect(selectorsIn(CSS)).toContainEqual(
      expect.stringContaining('.dk-truncate,'),
    );
  });
});
