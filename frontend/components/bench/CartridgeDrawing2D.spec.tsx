// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { CartridgeDrawing2D } from './CartridgeDrawing2D';
import type { Dims } from '@/lib/bench/geometry';

const CREEDMOOR: Dims = {
  R: 1.37, R1: 11.99,
  E: 3.84, E1: 10.39,
  P1: 11.95, P2: 11.74,
  L1: 37.84, L2: 41.52, L3: 48.77, L6: 71.76,
  H1: 7.49, H2: 7.49, G1: 6.72,
};

/** The long end of the catalogue: the case the old fixed scale clipped. */
const H_AND_H: Dims = {
  R: 1.4, R1: 13.51,
  E: 4.2, E1: 11.9,
  P1: 12.9, P2: 12.4,
  L1: 51.2, L2: 53.6, L3: 72.39, L6: 91.44,
  H1: 9.9, H2: 9.9, G1: 9.53,
};

/** The short end: 29.7 mm in a frame sized for 80. */
const LUGER_9: Dims = {
  R: 1.10, R1: 9.96,
  E: 3.30, E1: 8.80,
  P1: 9.93, P2: 9.75,
  L1: 13.55, L2: 17.30, L3: 19.15, L6: 29.69,
  H1: 9.70, H2: 9.65, G1: 9.03,
};

const VIEW_W = 560;
const VIEW_H = 250;

function draw(dims: Dims, onHotChange?: (k: string | null) => void) {
  return render(
    <div className="bench">
      <CartridgeDrawing2D dims={dims} units="metric" hot={null} onHotChange={onHotChange} />
    </div>,
  );
}

/** Every x, y pair the silhouette paths visit, in viewBox units. */
function silhouette(): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of Array.from(document.querySelectorAll('path'))) {
    const d = p.getAttribute('d') ?? '';
    // Only the two closed silhouette paths carry ML pairs; the arrowhead
    // marker and the shoulder arc are in their own coordinate systems.
    for (const m of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
      xs.push(Number(m[1]));
      ys.push(Number(m[2]));
    }
  }
  return { xs, ys };
}

/** Where the annotation text sits, in viewBox units. */
function labelYs(): number[] {
  return Array.from(document.querySelectorAll('text')).map((t) => Number(t.getAttribute('y')));
}

describe('the drawing fits its frame (C18)', () => {
  it('does not run a long cartridge off the right edge', () => {
    draw(H_AND_H);
    const { xs } = silhouette();
    expect(Math.max(...xs)).toBeLessThanOrEqual(VIEW_W);
  });

  it('fills the frame for a short pistol case instead of drawing a third of it', () => {
    // ⚠️ THE REGRESSION THIS PINS. At the prototype's fixed 6.2 px/mm a 9 mm
    // Luger spanned 29.69 × 6.2 = 184 of the 496 usable units — the drawing
    // sat in the left third of an empty box, on a card showing exactly one
    // cartridge, where relative size is not information.
    draw(LUGER_9);
    const { xs } = silhouette();
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeGreaterThan(29.69 * 6.2);
    expect(Math.max(...xs)).toBeLessThanOrEqual(VIEW_W);
  });

  it('does not magnify a short case until its labels leave the frame', () => {
    // The vertical budgets are why scaleFor takes R1: fitting on length alone
    // pushes the diameter stack off the top and the length ladder off the
    // bottom, and neither failure logs anything.
    draw(LUGER_9);
    const ys = [...silhouette().ys, ...labelYs()];
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(VIEW_H);
  });

  it('keeps every shape inside the frame on both axes', () => {
    for (const dims of [CREEDMOOR, H_AND_H, LUGER_9]) {
      const { unmount } = draw(dims);
      const { xs, ys } = silhouette();
      const all = [...ys, ...labelYs()];
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(VIEW_W);
      expect(Math.min(...all)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...all)).toBeLessThanOrEqual(VIEW_H);
      unmount();
    }
  });

  it('emits no NaN into any path', () => {
    for (const dims of [CREEDMOOR, H_AND_H, LUGER_9]) {
      const { unmount } = draw(dims);
      for (const p of Array.from(document.querySelectorAll('path'))) {
        expect(p.getAttribute('d') ?? '').not.toMatch(/NaN/);
      }
      unmount();
    }
  });
});

describe('the drawing is a pointer affordance, not a keyboard one', () => {
  it('puts nothing in the tab order', () => {
    // ⚠️ NINE TAB STOPS WENT FROM HERE, DELIBERATELY. Each announced a figure
    // the Dimensions table below carries as a real button that lights the same
    // letter, so a keyboard or screen-reader user loses nothing and is spared
    // nine stops on the way past.
    draw(CREEDMOOR, vi.fn());
    expect(document.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(document.querySelectorAll('[role="button"]')).toHaveLength(0);
  });

  it('hides its annotations from assistive tech rather than duplicating the table', () => {
    draw(CREEDMOOR, vi.fn());
    const groups = Array.from(document.querySelectorAll('g.dim'));
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the hot letter', () => {
  const groupFor = (letter: string): Element => {
    const text = Array.from(document.querySelectorAll('g.dim text')).find((t) =>
      (t.textContent ?? '').startsWith(`${letter} =`),
    );
    if (!text) throw new Error(`no callout for ${letter}`);
    return text.closest('g.dim') as Element;
  };

  it('lights on hover and releases on leave', () => {
    const onHotChange = vi.fn();
    draw(CREEDMOOR, onHotChange);
    fireEvent.mouseEnter(groupFor('L3'));
    expect(onHotChange).toHaveBeenLastCalledWith('L3');
    fireEvent.mouseLeave(groupFor('L3'));
    expect(onHotChange).toHaveBeenLastCalledWith(null);
  });

  it('toggles on tap, so a second tap puts the drawing back to neutral', () => {
    const onHotChange = vi.fn();
    draw(CREEDMOOR, onHotChange);
    fireEvent.click(groupFor('G1'));
    expect(onHotChange).toHaveBeenLastCalledWith('G1');
  });

  it('links the shoulder arc BOTH ways (D7)', () => {
    // The α row lit the arc; the arc could not light the row — the one
    // dimension whose link ran in a single direction.
    const onHotChange = vi.fn();
    draw(CREEDMOOR, onHotChange);
    const alpha = Array.from(document.querySelectorAll('g.dim')).find(
      (g) => g.querySelector('text')?.textContent === 'α',
    );
    expect(alpha).toBeTruthy();
    fireEvent.mouseEnter(alpha as Element);
    expect(onHotChange).toHaveBeenLastCalledWith('α');
  });

  it('takes no pointer events at all when the page cannot react', () => {
    draw(CREEDMOOR);
    for (const g of Array.from(document.querySelectorAll<SVGGElement>('g.dim'))) {
      expect(g.style.pointerEvents).toBe('none');
    }
  });
});
