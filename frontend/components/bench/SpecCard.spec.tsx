// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { SpecCard } from './SpecCard';
import type { SpecCardSpec } from './contract';

/*
 * ⚠️ jsdom DOES NOT LAY ANYTHING OUT. Every element it renders is 0 × 0, so
 * the audit's actual measurement — scrollWidth 760 against a clientWidth of
 * 702 — cannot be reproduced here at any width. What CAN be pinned is the two
 * things that produced it:
 *
 *   1. no rendered cell carries an inline `white-space: nowrap`, which is
 *      what stopped the values wrapping (an inline style beats the
 *      stylesheet, so this is the half that a CSS rule cannot fix); and
 *   2. bench.css actually declares the wrap and the overflow-x guard, since a
 *      class name on an element that no rule matches is the same as no fix.
 *
 * Both are asserted in mm AND inch, because the inch strings are the longer
 * ones and inch is the mode the audit found the sheet scrolling in.
 */

const DIMS: Record<string, number | string | null> = {
  R: 1.37,
  R1: 11.99,
  E: 3.84,
  E1: 10.39,
  P1: 11.95,
  P2: 11.74,
  L1: 37.84,
  L2: 41.52,
  L3: 48.77,
  L6: 71.76,
  H1: 7.49,
  H2: 7.49,
  G1: 6.72,
  bU: 203,
  alpha: '30',
};

function specOf(over: Partial<SpecCardSpec> = {}): SpecCardSpec {
  return {
    cartridge: {
      key: '65creedmoor',
      name: '6,5 Creedmoor',
      slug: '6-5-creedmoor',
      type: '1 rimless',
      origin: 'US',
      year: 2012,
      caseLengthMm: 48.77,
      maxLengthMm: 71.76,
      pmaxPsi: 63092,
      pmaxBar: 4350,
    },
    dims: DIMS,
    loadsForBench: 26,
    loadCount: 761,
    shellHolderGroup: [
      { key: '308win', name: '308 Win.' },
      { key: '243win', name: '243 Win.' },
    ],
    ...over,
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof SpecCard>> = {}) {
  const onClose = vi.fn();
  const onUnitsChange = vi.fn();
  const onShowOnly = vi.fn();
  const utils = render(
    <div className="bench">
      <SpecCard
        spec={specOf()}
        loading={false}
        error={null}
        units="metric"
        onClose={onClose}
        onUnitsChange={onUnitsChange}
        onShowOnly={onShowOnly}
        {...props}
      />
    </div>,
  );
  return { ...utils, onClose, onUnitsChange, onShowOnly };
}

/** Every element the card rendered, so nothing can hide in a nested span. */
function allElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('*'));
}

describe('the sheet cannot overflow sideways (A2)', () => {
  for (const units of ['metric', 'imperial'] as const) {
    it(`writes no inline white-space: nowrap on any value cell — ${units}`, () => {
      renderCard({ units });
      const offenders = allElements().filter(
        (el) =>
          el.style.whiteSpace === 'nowrap' &&
          // The phone header's title is deliberately one line with an
          // ellipsis, and it is not rendered on desktop; the 3D view's own
          // labels are absolutely positioned out of flow. Nothing in the
          // Dimensions table or the reloader grid may be here.
          (el.classList.contains('kv-v') || el.closest('.kv') !== null),
      );
      expect(offenders).toEqual([]);
    });

    it(`gives every value cell somewhere to wrap to — ${units}`, () => {
      renderCard({ units });
      const cells = Array.from(document.querySelectorAll<HTMLElement>('.kv-v'));
      expect(cells.length).toBeGreaterThan(10);
      for (const cell of cells) {
        expect(cell.style.overflowWrap).toBe('anywhere');
        expect(cell.style.minWidth).toBe('0px');
      }
    });

    it(`marks every row as wrappable — ${units}`, () => {
      renderCard({ units });
      for (const row of Array.from(document.querySelectorAll('.kv'))) {
        expect(row.classList.contains('kv-wrap')).toBe(true);
      }
    });
  }

  it('backs the classes with rules that actually exist in bench.css', () => {
    // ⚠️ THE HALF jsdom CANNOT SEE. A `kv-wrap` on every row is worth nothing
    // if the stylesheet never declares it, and no component test would notice.
    /* process.cwd(), not import.meta.url: under the jsdom environment the
       module URL is not a file: URL and fileURLToPath throws. Vitest runs from
       the frontend root. */
    const css = readFileSync(join(process.cwd(), 'components/bench/bench.css'), 'utf8');
    expect(css).toMatch(/\.bench \.kv-wrap\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.bench \.kv-wrap \.kv-v\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.bench-sheet\s*\{[^}]*overflow-x:\s*hidden/);
  });
});

describe('the header speaks English (A3)', () => {
  it('expands the case type and the origin code', () => {
    renderCard();
    expect(screen.getByText('Rimless · United States · 2012')).toBeInTheDocument();
    expect(screen.queryByText(/1 rimless/)).toBeNull();
  });

  it('uses the hints from the group while the fetch is in flight (C17)', () => {
    renderCard({
      spec: null,
      loading: true,
      name: '308 Win.',
      type: '1 rimless',
      origin: 'US',
      year: 1952,
    });
    expect(screen.getByText('308 Win.')).toBeInTheDocument();
    expect(screen.getByText('Rimless · United States · 1952')).toBeInTheDocument();
  });

  it('never leaves the dialog without an accessible name', () => {
    renderCard({ spec: null, loading: true });
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent?.trim()).not.toBe('');
  });
});

describe('the Loads box (A5)', () => {
  it('leads with the cartridge total and qualifies it with the bench', () => {
    renderCard();
    expect(screen.getByText('761')).toBeInTheDocument();
    expect(screen.getByText('26 from your bench')).toBeInTheDocument();
  });

  it('says "none yet" rather than counting zero', () => {
    renderCard({ spec: specOf({ loadsForBench: 0 }) });
    expect(screen.getByText('none from your bench yet')).toBeInTheDocument();
    expect(screen.queryByText('0 from your bench')).toBeNull();
  });

  it('keeps the heading (the phone dropped it)', () => {
    renderCard();
    expect(screen.getByText('Loads')).toBeInTheDocument();
  });

  it('says how many shell-holder mates were not listed', () => {
    renderCard({ spec: specOf({ shellHolderMore: 7 }) });
    expect(screen.getByText('+7 more')).toBeInTheDocument();
  });

  it('opens a shell-holder mate when the card is given somewhere to send it', () => {
    const onOpenCartridge = vi.fn();
    renderCard({ onOpenCartridge });
    fireEvent.click(screen.getByRole('button', { name: '243 Win.' }));
    expect(onOpenCartridge).toHaveBeenCalledWith('243win');
  });

  it('falls back to plain labels when there is nowhere to send it', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: '243 Win.' })).toBeNull();
    expect(screen.getByText('243 Win.')).toBeInTheDocument();
  });
});

describe('the Dimensions table', () => {
  /** Rows the 2D drawing carries a callout for. */
  const LINKED = ['L1', 'L2', 'L3', 'L6', 'R1', 'P1', 'P2', 'H1', 'G1', 'α'];
  /** Rows it does not (D7). */
  const UNLINKED = ['R', 'E', 'E1', 'H2'];

  const rowFor = (letter: string): HTMLElement => {
    const cell = Array.from(document.querySelectorAll<HTMLElement>('.kv .k')).find(
      (el) => el.textContent === letter,
    );
    if (!cell) throw new Error(`no Dimensions row for ${letter}`);
    return cell.closest('.kv') as HTMLElement;
  };

  it('offers the drawing link only on the rows the drawing carries', () => {
    renderCard();
    for (const k of LINKED) expect(rowFor(k).tagName).toBe('BUTTON');
    for (const k of UNLINKED) expect(rowFor(k).tagName).toBe('DIV');
  });

  it('shows the printed tolerance beside the figure, verbatim (D7)', () => {
    /* ⚠️ THE CAST IS THE WIRE TYPE BEING WRONG, NOT THE TEST CHEATING.
       `CartridgeSpec.dims` is declared `Record<string, number | string | null>`
       and `tolerances` is a JSON OBJECT keyed by letter, which that type
       cannot express — which is why `tolerancesOf` reads it defensively rather
       than indexing it. lib/bench/api.ts belongs to another change in flight. */
    const dims = { ...DIMS, tolerances: { L1: '-0.20' } } as unknown as typeof DIMS;
    renderCard({ spec: specOf({ dims }) });
    expect(within(rowFor('L1')).getByText(/37\.84 mm \(1\.490″\) −0\.20/)).toBeInTheDocument();
    // Not on the rows that have none.
    expect(within(rowFor('L2')).getByText('41.52 mm (1.635″)')).toBeInTheDocument();
  });

  it('leads with inches when the member asked for inches', () => {
    renderCard({ units: 'imperial' });
    expect(within(rowFor('L3')).getByText('1.920″ (48.77 mm)')).toBeInTheDocument();
  });
});

describe('the error state (D7)', () => {
  it('offers a retry when the page can run one', () => {
    const onRetry = vi.fn();
    renderCard({ spec: null, loading: false, error: 'Load failed', onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('still closes, and offers no dead button when there is no retry', () => {
    const { onClose } = renderCard({ spec: null, loading: false, error: 'Load failed' });
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    /* The header's × is also named "Close"; this is the one in the panel. */
    const panel = screen.getByText('This cartridge could not load').parentElement as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('copy rules', () => {
  it('names no source anywhere on the card', () => {
    renderCard();
    const text = document.body.textContent ?? '';
    for (const banned of ['manual', 'CIP', 'C.I.P', 'SAAMI', 'published', 'TDCC', 'escrow']) {
      expect(text).not.toContain(banned);
    }
  });

  it('keeps the ogive caveat and adds the belt one only for a belted case', () => {
    const { unmount } = renderCard();
    expect(screen.getByText(/The bullet ogive is illustrative/)).toBeInTheDocument();
    expect(screen.queryByText(/The belt is not drawn/)).toBeNull();
    unmount();

    renderCard({
      spec: specOf({
        cartridge: { ...specOf().cartridge, type: '3 belted', name: '375 H&H Mag.' },
      }),
    });
    expect(screen.getByText(/The belt is not drawn/)).toBeInTheDocument();
  });
});
