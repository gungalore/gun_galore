// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BenchRail, { BENCH_HINT, GUEST_BENCH_HINT } from './BenchRail';
import GuestPrompt, { GUEST_PROMPT, GUEST_SIGN_IN_HREF } from './GuestPrompt';
import { EMPTY_OFF } from './contract';
import type { BenchView } from '@/lib/bench/api';

/**
 * THE BENCH — what a signed-out visitor is told, and what is not drawn.
 *
 * 🚨 THE CONTROLS THAT WRITE ARE ABSENT, NOT DEAD. A declared visitor can use
 * the whole finder; the log, Copy link and "Log this load" all end in a
 * member-only call, so a signed-out control could only 401. The prompt says
 * where the shelf could live instead of leaving a button that fails.
 *
 * ⚠️ AND "SAVED" IS NEVER SAID TO SOMEONE WITH NOWHERE TO SAVE IT. The rail's
 * badge is a member's "this persisted on every change"; a guest's shelf is page
 * state, so the same slot carries the prompt.
 */

const SHELF: BenchView = {
  units: 'metric',
  powders: [{ id: 'p1', name: 'N550', maker: 'Vihtavuori' }],
  bullets: [{ weightGr: 150, calibreIn: 0.308 }],
  cartridges: [{ key: '308win', name: '.308 Winchester' }],
};

function rail(signedIn: boolean) {
  render(
    <BenchRail
      bench={SHELF}
      signedIn={signedIn}
      off={EMPTY_OFF}
      onToggle={vi.fn()}
      onRemove={vi.fn()}
      onAddPowder={vi.fn()}
      onAddBullet={vi.fn()}
      onAddCartridge={vi.fn()}
    />,
  );
}

describe('the sign-in prompt', () => {
  it('says what signing in is for, and links to it', () => {
    render(<GuestPrompt />);

    expect(screen.getByText(new RegExp(GUEST_PROMPT))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      GUEST_SIGN_IN_HREF,
    );
  });
});

describe('a guest rail is the same shelf without the save claim', () => {
  it('never says the shelf is saved', () => {
    rail(false);

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(GUEST_PROMPT))).toBeInTheDocument();
    expect(screen.getByText(GUEST_BENCH_HINT)).toBeInTheDocument();
  });

  it('still draws the shelf, so a guest can add and remove entries', () => {
    rail(false);

    expect(screen.getByRole('button', { name: /N550/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add powder' })).toBeInTheDocument();
  });

  it('keeps the member rail exactly as it was', () => {
    rail(true);

    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText(BENCH_HINT)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(GUEST_PROMPT))).not.toBeInTheDocument();
  });
});
