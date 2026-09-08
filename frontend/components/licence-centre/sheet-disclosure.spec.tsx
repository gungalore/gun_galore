// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SheetDisclosure from './sheet-disclosure';

// ────────────────────────────────────────────────────────────────────
// THE FOLD. Three things can go wrong with it and all three are the same
// mistake: hiding work without saying so.
// ────────────────────────────────────────────────────────────────────

describe('SheetDisclosure', () => {
  it('⚠️ UNMOUNTS ITS CHILDREN WHEN CLOSED, RATHER THAN HIDING THEM', async () => {
    // The whole point is that a page with 351 controls stops mounting 351
    // controls. `hidden` would leave the renderer exactly as busy — and it was
    // busy enough that Chrome timed out screenshotting the live sheet.
    render(
      <SheetDisclosure summary="Barrel, frame and receiver">
        <input aria-label="Barrel serial number" />
      </SheetDisclosure>,
    );
    expect(screen.queryByLabelText('Barrel serial number')).toBeNull();

    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByLabelText('Barrel serial number')).toBeDefined();
  });

  it('⚠️ SAYS WHAT IS INSIDE WITHOUT BEING OPENED', () => {
    // A fold that hides a "Still needed" behind a chevron is a form lying
    // about how much is left.
    render(
      <SheetDisclosure
        summary="Your case"
        note="Tap what is true of you."
        meta={<span>3 still needed</span>}
      >
        <p>rows</p>
      </SheetDisclosure>,
    );
    expect(screen.getByText('3 still needed')).toBeDefined();
    expect(screen.getByText('Tap what is true of you.')).toBeDefined();
  });

  it('reports its state to a screen reader', async () => {
    render(
      <SheetDisclosure summary="Firearms you own">
        <p>rows</p>
      </SheetDisclosure>,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens closed by default, and honours defaultOpen', () => {
    const { unmount } = render(
      <SheetDisclosure summary="a">
        <p>inside</p>
      </SheetDisclosure>,
    );
    expect(screen.queryByText('inside')).toBeNull();
    unmount();

    render(
      <SheetDisclosure summary="a" defaultOpen>
        <p>inside</p>
      </SheetDisclosure>,
    );
    expect(screen.getByText('inside')).toBeDefined();
  });

  it('⚠️ CAN BE DRIVEN FROM OUTSIDE, which is what the section chips need', async () => {
    // A chip that scrolls you to a closed heading is worse than the scroll it
    // replaced, so the page owns the open state for sections.
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SheetDisclosure summary="a" open={false} onOpenChange={onOpenChange}>
        <p>inside</p>
      </SheetDisclosure>,
    );
    expect(screen.queryByText('inside')).toBeNull();

    // Its own click reports out and changes nothing by itself.
    await userEvent.click(screen.getByRole('button'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText('inside')).toBeNull();

    rerender(
      <SheetDisclosure summary="a" open onOpenChange={onOpenChange}>
        <p>inside</p>
      </SheetDisclosure>,
    );
    expect(screen.getByText('inside')).toBeDefined();
  });

  it('keeps a 44px target', () => {
    render(
      <SheetDisclosure summary="a">
        <p>inside</p>
      </SheetDisclosure>,
    );
    expect(screen.getByRole('button').className).toContain('min-h-[44px]');
  });
});
