// Node environment, deliberately: this spec reads the Desk's source text off
// disk and never mounts anything, so it does not opt into jsdom.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE DESK — every env() safe-area inset is clamped.
 *
 * ⚠️ CHROME FOR iOS OVER-REPORTS safe-area-inset-bottom, far larger than the
 * ~34pt home indicator it describes. Nothing errors and nothing is hidden by
 * it; the element simply floats up the screen, away from the bar it was
 * positioned to clear, leaving a band of dead ground beneath it. That reads as
 * "the board ends here" on the pile, and as a composer sitting in the middle
 * of a thread on the Site board.
 *
 * ⚠️ THIS TEST EXISTS BECAUSE THE COMMENT SAYING IT WAS ALREADY TRUE WAS
 * FALSE. tokens.css asserted the cap held across the whole surface while the
 * UndoToast (overlays.tsx) and the Site composer (app/admin/desk/site/page.tsx)
 * still used a bare env(safe-area-inset-bottom) — three call sites doing the
 * same lift, two of them opted out, and the same phone getting two different
 * answers about where the bottom of the screen is. A comment is not an
 * invariant; this is.
 *
 * The caps are two DIFFERENT numbers and both are asserted: bottom 34px (the
 * home indicator), top 60px (the notch / dynamic island). A clamp to some
 * other figure is a surface where the padding and the bar disagree, so
 * "clamped at all" is not the rule being pinned.
 */

const ROOT = path.resolve(__dirname, '..', '..');

const TREES = ['components/desk', 'app/admin'];

/**
 * Global chrome that is mounted in the ROOT layout with no path check, so it
 * renders over the Desk as well as the shop.
 *
 * ⚠️ SCANNING THE TREES ALONE LET TWO BARE INSETS THROUGH, AND THE COMMENT IN
 * tokens.css CITED THIS SPEC AS THE REASON THAT COULD NOT HAPPEN. Both of
 * these live in components/, outside components/desk, and both are fixed,
 * high-z elements positioned against the Desk's own 78px tab bar —
 * sw-update-banner even has globals.css retuning --sw-banner-lift to 88px
 * specifically for `[data-desk]`. "Not in the Desk folder" is not the same
 * thing as "not on the Desk".
 *
 * ⚠️ AND THIS IS A LIST, NOT A TREE, ON PURPOSE. The rest of components/ is
 * the storefront, which has its own chrome and its own numbers, and
 * lib/scan-v3 is a VENDORED COPY that CLAUDE.md forbids editing here — the
 * next sync silently reverts it. Widening this to all of components/ would
 * fail on files nobody in this repo may fix. Add a file here when something
 * new is mounted in the root layout and positions itself against the Desk.
 */
const GLOBAL_CHROME_OVER_DESK = [
  'components/sw-update-banner.tsx',
  'components/connection-status-banner.tsx',
];

/** Bottom insets clear the tab bar / home indicator; top clears the notch. */
const CAP = { top: '60px', bottom: '34px' } as const;

/**
 * ⚠️ COMMENTS ARE STRIPPED BEFORE SCANNING, AND THAT IS NOT TIDINESS. This
 * codebase writes the rule out longhand next to the code that obeys it, so
 * tabs.tsx names `env(safe-area-inset-bottom)` in prose directly above the
 * clamped declaration. Scanning raw text fails on the explanation of the rule.
 *
 * ⚠️ A BLOCK COMMENT IS REPLACED BY ITS OWN NEWLINES, NOT BY NOTHING. These
 * files are 30-40% comment, so collapsing them reported overlays.tsx:638 for a
 * line that is at 733 — a failure message that sends the reader to the wrong
 * place is worse than one that only names the file.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(entry.name)) continue;
      // A spec quoting the pattern it polices is not a call site.
      if (/\.spec\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  for (const tree of TREES) walk(path.join(ROOT, tree));
  for (const f of GLOBAL_CHROME_OVER_DESK) out.push(path.join(ROOT, f));
  return out;
}

const ENV_INSET = /env\(\s*safe-area-inset-(top|bottom|left|right)\s*(?:,[^)]*)?\)/g;

type Use = { file: string; line: number; side: string; text: string; capped: boolean; clamped: boolean };

function uses(): Use[] {
  const found: Use[] = [];
  for (const file of sourceFiles()) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    const lines = src.split('\n');
    lines.forEach((text, i) => {
      ENV_INSET.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ENV_INSET.exec(text))) {
        // The clamp is `min(env(...), Npx)`, so the four characters in front
        // of the env() are the whole test for the opening half.
        const before = text.slice(Math.max(0, m.index - 4), m.index);
        const after = text.slice(m.index + m[0].length);
        // ⚠️ A SIDE WITH NO AGREED CAP IS ITS OWN FAILURE, NOT AN UNCLAMPED
        // ONE. CAP covers top and bottom because they are the only sides the
        // Desk uses. A left or right inset used to fall through `?? ''` and
        // build `^\s*,\s*\s*\)` — a regex no real clamp can satisfy — so a
        // correctly written `min(env(safe-area-inset-left, 0px), 12px)` was
        // reported as bare, and the message told the reader to wrap it in the
        // BOTTOM cap. Right verdict by accident, wrong instruction, on a
        // failure somebody acts on at speed. `capped` separates the two.
        const cap = (CAP as Record<string, string | undefined>)[m[1]];
        const closing = new RegExp(`^\\s*,\\s*${cap ?? '(?!)'}\\s*\\)`);
        found.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          line: i + 1,
          side: m[1],
          text: text.trim(),
          capped: cap !== undefined,
          clamped: before.endsWith('min(') && closing.test(after),
        });
      }
    });
  }
  return found;
}

describe('Desk safe-area insets', () => {
  it('finds the call sites at all — a passing scan over nothing proves nothing', () => {
    // If a refactor moves the Desk out from under these trees, the grep goes
    // quiet and every assertion below passes vacuously. Nine live uses at the
    // time of writing; the floor only has to be high enough that an empty
    // sweep cannot masquerade as a clean one.
    expect(uses().length).toBeGreaterThanOrEqual(8);
  });

  it('has an agreed maximum for every side it finds', () => {
    // Reported separately from "unclamped" because the fix is different: this
    // one is a decision nobody has taken yet, not a wrapper somebody forgot.
    const unknown = uses().filter((u) => !u.capped);
    expect(
      unknown.map((u) => `${u.file}:${u.line} (${u.side})`),
      'A safe-area side with no entry in CAP. Decide the maximum for it and add ' +
        'it there, beside top (60px, the notch) and bottom (34px, the home ' +
        'indicator) — do not reach for one of theirs because it is nearby.',
    ).toEqual([]);
  });

  it('clamps every one — bottom to 34px, top to 60px', () => {
    const bare = uses().filter((u) => u.capped && !u.clamped);
    expect(
      bare.map((u) => `${u.file}:${u.line} (${u.side}) ${u.text}`),
      'Wrap it as min(env(safe-area-inset-bottom, 0px), 34px) — top takes 60px. ' +
        'Unclamped, Chrome for iOS lifts the element off the bar it is clearing ' +
        'and leaves dead ground under it.',
    ).toEqual([]);
  });
});
