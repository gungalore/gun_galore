// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SheetSection from './sheet-section';

// ────────────────────────────────────────────────────────────────────
// THE SECTION FOLD.
//
// ⚠️ THE ONE WAY THIS GOES WRONG IS HIDING WORK WITHOUT SAYING SO. A closed
// section that does not carry its own count is a form claiming to be shorter
// than it is, which is worse than the 27-screen scroll it replaced.
// ────────────────────────────────────────────────────────────────────

const base = {
  id: 'own',
  title: 'Firearms you own',
  blurb: 'What you already hold.',
  missingCount: 0,
};

describe('SheetSection', () => {
  it('⚠️ SHOWS ITS OUTSTANDING COUNT WHILE CLOSED', () => {
    render(
      <SheetSection
        {...base}
        open={false}
        onOpenChange={vi.fn()}
        missingCount={3}
      >
        <input aria-label="Make" />
      </SheetSection>,
    );
    expect(screen.getByText('3 still needed')).toBeDefined();
    expect(screen.queryByLabelText('Make')).toBeNull();
  });

  it('⚠️ KEEPS THE HEADING A HEADING', () => {
    // The fold must not take the page's outline with it — that outline is how
    // a screen-reader user moves through eight sections without listening to
    // 351 controls.
    render(
      <SheetSection {...base} open={false} onOpenChange={vi.fn()}>
        <p>rows</p>
      </SheetSection>,
    );
    expect(
      screen.getByRole('heading', { name: /Firearms you own/ }),
    ).toBeDefined();
  });

  it('is controlled — its own click reports out and changes nothing', async () => {
    const onOpenChange = vi.fn();
    render(
      <SheetSection {...base} open={false} onOpenChange={onOpenChange}>
        <p>rows</p>
      </SheetSection>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText('rows')).toBeNull();
  });

  it('renders its rows when open, and reports the state', () => {
    render(
      <SheetSection {...base} open onOpenChange={vi.fn()}>
        <p>rows</p>
      </SheetSection>,
    );
    expect(screen.getByText('rows')).toBeDefined();
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('⚠️ KEEPS scroll-margin-top, WHICH IS WHY IT IS A COMPONENT', () => {
    // The chips are anchor links under a sticky strip. Without this every tap
    // lands the heading behind the strip.
    const { container } = render(
      <SheetSection {...base} open onOpenChange={vi.fn()}>
        <p>rows</p>
      </SheetSection>,
    );
    expect(container.querySelector('section')?.className).toContain(
      'scroll-mt-[120px]',
    );
  });

  it('keeps a 44px target on the heading', () => {
    render(
      <SheetSection {...base} open={false} onOpenChange={vi.fn()}>
        <p>rows</p>
      </SheetSection>,
    );
    expect(screen.getByRole('button').className).toContain('min-h-[44px]');
  });
});


describe('the state pill', () => {
  // ⚠️ ONE PILL VOCABULARY. It is the same shape, weight and tokens as the
  // progress figure in the sticky strip; a second vocabulary on one screen is a
  // second thing to learn. Operator, 2026-09-08: "Done should be in a green
  // pill and x still needed in an amber pill."
  it('reads Done in green when nothing is outstanding', () => {
    render(
      <SheetSection {...base} missingCount={0} open={false} onOpenChange={vi.fn()}>
        <p>rows</p>
      </SheetSection>,
    );
    const pill = screen.getByText('Done');
    expect(pill.className).toContain('--success-wash');
    expect(pill.className).toContain('rounded-full');
  });

  it('counts in amber when something is', () => {
    render(
      <SheetSection {...base} missingCount={4} open={false} onOpenChange={vi.fn()}>
        <p>rows</p>
      </SheetSection>,
    );
    const pill = screen.getByText('4 still needed');
    expect(pill.className).toContain('--warning');
    expect(pill.className).toContain('rounded-full');
  });

  it('⚠️ SAYS SO EVEN WHILE CLOSED, so a fold cannot hide outstanding work', () => {
    render(
      <SheetSection {...base} missingCount={2} open={false} onOpenChange={vi.fn()}>
        <input aria-label="Make" />
      </SheetSection>,
    );
    expect(screen.getByText('2 still needed')).toBeDefined();
    expect(screen.queryByLabelText('Make')).toBeNull();
  });

  it('⚠️ NEVER MIXES var(--warning) WITH AN ALPHA BY CONCATENATION', () => {
    // `var(--warning)18` is two tokens, not a colour, and it takes the whole
    // declaration down with it. color-mix or nothing — CLAUDE.md's CSS traps.
    render(
      <SheetSection {...base} missingCount={1} open={false} onOpenChange={vi.fn()}>
        <p>rows</p>
      </SheetSection>,
    );
    expect(screen.getByText('1 still needed').className).toContain('color-mix');
  });
});
