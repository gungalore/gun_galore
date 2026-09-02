// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BenchView } from '@/lib/bench/api';
import { CALIBRE_UNKNOWN, CALIBRE_UNKNOWN_SHORT, formatCalibre } from '@/lib/bench/calibre';
import { BulletPicker, haystack, matches } from './BulletPicker';
import { BenchSections } from './BenchRail';
import { EMPTY_OFF, bulletKey } from './contract';
import type { BenchBulletOption } from './contract';

/**
 * THE BENCH — the bullet picker's calibre.
 *
 * 🚨 THIS IS THE FILE THAT SAYS THE MEMBER CAN TELL TWO ROWS APART. "Hornady
 * 150gr SP" names four different projectiles — .277" for .270 Win, .308" for
 * .308 Win, .311" for .303 British, .323" for 8x57 IS — and they are not
 * interchangeable: three thou over will not chamber, or will chamber and spike
 * pressure. The picker filters in the browser, so nothing on the server can
 * rescue a search that cannot separate them.
 *
 * ⚠️ AND NOTHING HERE MAY ROUND, BUCKET OR CHAIN BY TOLERANCE. A thou of
 * spread inside one calibre is the same size as the gap between neighbouring
 * ones (.311" and .312" are both bullets you can buy), so the picker matches
 * on the figure it was handed and nothing else. The neighbour cases below are
 * the guard on that.
 */

/** As the endpoint returns them: the same three words, four different bullets. */
function bullet(calibreIn: number | null, over: Partial<BenchBulletOption> = {}): BenchBulletOption {
  return { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn, loads: 12, ...over };
}

/** Exactly what the component does: fold the term, look for every word in the hay. */
function finds(b: BenchBulletOption, typed: string): boolean {
  const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return matches(haystack(b), words);
}

const TWO_SEVEN_SEVEN = bullet(0.277); // .270 Win
const THREE_OH_EIGHT = bullet(0.308); // .308 Win
const THREE_ELEVEN = bullet(0.311); // .303 British
const THREE_TWELVE = bullet(0.312); // its immediate neighbour on the shelf
const NO_CALIBRE = bullet(null); // one of the five cartridges with no figure

describe('the calibre is written the way the box is', () => {
  it.each([
    [0.308, '.308"'],
    [0.277, '.277"'],
    [0.311, '.311"'],
    [0.323, '.323"'],
    // Three digits even when the standard diameter has fewer — .40 is `.400"`
    // on the box, not `.4"`.
    [0.4, '.400"'],
  ])('%s is written %s', (inches, written) => {
    expect(formatCalibre(inches)).toBe(written);
  });

  it('has nothing to write when the cartridge gives no figure', () => {
    expect(formatCalibre(null)).toBe('');
    expect(formatCalibre(undefined)).toBe('');
  });

  it('names no source when there is no figure — operator ruling 2026-09-02', () => {
    expect(CALIBRE_UNKNOWN.toLowerCase()).not.toMatch(/published|manual|c\.?i\.?p|saami|source/);
  });
});

describe('typing a calibre narrows to that calibre', () => {
  it.each(['308', '.308', '0.308'])('%s finds the .308 bullet', (typed) => {
    expect(finds(THREE_OH_EIGHT, typed)).toBe(true);
  });

  it.each(['308', '.308', '0.308'])('%s does NOT find the .277 bullet of the same name', (typed) => {
    expect(finds(TWO_SEVEN_SEVEN, typed)).toBe(false);
  });

  it('separates neighbouring calibres, which are one thou apart', () => {
    expect(finds(THREE_ELEVEN, '311')).toBe(true);
    expect(finds(THREE_ELEVEN, '312')).toBe(false);
    expect(finds(THREE_TWELVE, '312')).toBe(true);
    expect(finds(THREE_TWELVE, '311')).toBe(false);
  });

  it('still finds a bullet by maker, weight and type, in any order', () => {
    for (const typed of ['hornady 150', '150 sp', 'sp 150', '150gr']) {
      expect(finds(THREE_OH_EIGHT, typed)).toBe(true);
      expect(finds(TWO_SEVEN_SEVEN, typed)).toBe(true);
    }
  });

  it('takes calibre and the rest of the row together', () => {
    expect(finds(THREE_OH_EIGHT, '308 hornady 150')).toBe(true);
    expect(finds(TWO_SEVEN_SEVEN, '308 hornady 150')).toBe(false);
  });

  it('does not match a calibre search to a bullet that has no calibre', () => {
    expect(finds(NO_CALIBRE, '308')).toBe(false);
    expect(finds(NO_CALIBRE, '150 sp')).toBe(true);
  });
});

describe('two calibres are never one row', () => {
  it('keys four same-named bullets apart', () => {
    const keys = [0.277, 0.308, 0.311, 0.323].map((c) => bulletKey(bullet(c)));
    expect(new Set(keys).size).toBe(4);
  });

  it('keeps the pre-calibre key for a bench saved before calibres existed', () => {
    expect(bulletKey({ maker: 'Hornady', weightGr: 150, category: 'SP' })).toBe('Hornady|150|SP');
    expect(bulletKey(THREE_OH_EIGHT)).toBe('Hornady|150|SP|0.308');
  });
});

/* ── On screen ──────────────────────────────────────────────────────── */

/**
 * ⚠️ THE POINT IS THAT IT IS VISIBLE, NOT THAT IT IS IN THE OBJECT. The bug
 * being fixed was a member reading two identical rows and picking one; a
 * calibre that reaches the component and is never drawn fixes nothing they can
 * see. So these render.
 */
describe('the calibre is on screen wherever a bullet is named', () => {
  it('leads every row of the picker, once per calibre', () => {
    render(
      <BulletPicker
        open
        loading={false}
        bullets={[TWO_SEVEN_SEVEN, THREE_OH_EIGHT, NO_CALIBRE]}
        onBench={[]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByText('.277"')).toBeInTheDocument();
    expect(screen.getByText('.308"')).toBeInTheDocument();
    // Said, not left blank, where the cartridge gives no figure.
    expect(screen.getByText(CALIBRE_UNKNOWN)).toBeInTheDocument();

    // The three rows read the same but for that: three Hornadys, one each.
    expect(screen.getAllByText(/Hornady/)).toHaveLength(3);
  });

  it('is on the bench chip too, which is where the member reads their own shelf', () => {
    const bench: BenchView = {
      powders: [],
      cartridges: [],
      units: 'metric',
      bullets: [
        { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.277 },
        { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
        { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: null },
      ],
    };

    render(
      <BenchSections
        bench={bench}
        off={EMPTY_OFF}
        onToggle={vi.fn()}
        onAddPowder={vi.fn()}
        onAddBullet={vi.fn()}
        onAddCartridge={vi.fn()}
      />,
    );

    expect(screen.getByText('.277"')).toBeInTheDocument();
    expect(screen.getByText('.308"')).toBeInTheDocument();
    expect(screen.getByText(CALIBRE_UNKNOWN_SHORT)).toBeInTheDocument();
  });

  it('shows a bullet already on the bench as added only when the calibre matches too', () => {
    render(
      <BulletPicker
        open
        loading={false}
        bullets={[TWO_SEVEN_SEVEN, THREE_OH_EIGHT]}
        onBench={[bulletKey(THREE_OH_EIGHT)]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    // One row is a statement of fact, the other is still a button to press —
    // adding the .308 must not mark the .277 of the same name as owned.
    expect(screen.getAllByText('On your bench')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /\.277/ })).toBeInTheDocument();
  });
});
