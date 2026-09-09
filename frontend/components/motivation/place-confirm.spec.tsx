// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PlaceConfirm from './place-confirm';

// ────────────────────────────────────────────────────────────────────
// THE ONE QUESTION ONLY THE MEMBER CAN ANSWER.
//
// The server holds photographs of a safe back from the automatic attach and
// reports `needsPlaceConfirm`, because a safe photograph does not go stale with
// time — it goes wrong when somebody moves house, and nothing on the file says
// so. The tick shipped, the server waited for it, and until this component was
// lifted out of the deleted wizard nothing put it in front of anybody.
// ────────────────────────────────────────────────────────────────────

describe('confirming the safe is at this address', () => {
  it('says WHY, not only what', () => {
    // A tick with no reason reads as a formality and gets tapped without
    // thought — and the whole point is that somebody who has moved should
    // stop and think.
    render(<PlaceConfirm onConfirm={vi.fn()} />);
    expect(screen.getByText(/if you have moved since/i)).toBeInTheDocument();
    expect(
      screen.getByText(/the safe at the address on this application/i),
    ).toBeInTheDocument();
  });

  it('confirms on the tick', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<PlaceConfirm onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('⚠️ DOES NOT FIRE AGAIN WHILE IT IS WORKING', async () => {
    // The confirm re-runs the attach, which copies files. A second click
    // before the first resolves would run it twice.
    let release: (() => void) | undefined;
    const onConfirm = vi.fn(
      () => new Promise<void>((r) => { release = r; }),
    );
    render(<PlaceConfirm onConfirm={onConfirm} />);
    const box = screen.getByRole('checkbox');
    await userEvent.click(box);
    expect(box).toBeDisabled();
    expect(screen.getByText(/adding your safe photographs/i)).toBeInTheDocument();
    release?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('⚠️ NEVER FIRES ON AN UNTICK', async () => {
    // Unticking cannot un-attach what the server has already copied, so it
    // must not look like it can. The member removes a document the way they
    // remove any other.
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<PlaceConfirm onConfirm={onConfirm} />);
    const box = screen.getByRole('checkbox');
    await userEvent.click(box);
    await userEvent.click(box);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
