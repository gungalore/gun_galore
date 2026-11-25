// @vitest-environment jsdom
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * THE BENCH — the signed-out page.
 *
 * 🚨 THE WHOLE FINDER IS HERE, AND NO MEMBER DATA IS ASKED FOR. The page used
 * to draw a sign-in tile for a declared visitor; now it renders the tool
 * read-only, with the shelf held in page state and sent as the SPEC query
 * arrays. What this file pins is the two halves that can silently regress:
 *
 *   — the guest request really carries `powders[]` / `bullets[]` /
 *     `cartridges[]` (an empty shelf still asks, so the empty panel can draw);
 *   — GET /bench/me is never called, and the member-only controls (Copy link,
 *     Load log, "Log this load") are not drawn — the prompt is offered instead.
 */

/** ⚠️ ONE getToken, STABLE ACROSS RENDERS — see the same note in BulletPicker.spec. */
vi.mock('../../lib/auth', () => {
  const getToken = async () => null;
  return { useAuth: () => ({ getToken, isLoaded: true, isSignedIn: false }) };
});
vi.mock('@/lib/use-standalone', () => ({ useStandalone: () => false }));
vi.mock('next/navigation', () => {
  const params = new URLSearchParams();
  return {
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => '/bench',
    useSearchParams: () => params,
  };
});

import { benchApi } from '@/lib/bench/api';
import { GUEST_PROMPT } from '@/components/bench/GuestPrompt';
import BenchPage from '@/app/bench/page';

describe('a declared visitor gets the finder, read-only', () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(() => vi.restoreAllMocks());

  it('searches the guest shelf, never the member bench, and offers the prompt', async () => {
    const me = vi.spyOn(benchApi, 'me').mockResolvedValue({
      units: 'metric',
      powders: [],
      bullets: [],
      cartridges: [],
    });
    const loads = vi.spyOn(benchApi, 'loads').mockResolvedValue({ count: 0, groups: [] });

    render(<BenchPage />);

    // The empty answer draws the panel that explains it — not a skeleton.
    expect(await screen.findByText(/Nothing on the bench yet/)).toBeInTheDocument();

    // 🚨 THE GUEST QUERY SHELF RIDES ON EVERY SEARCH. Empty is still a shelf:
    // the server answers it with a valid empty payload, and that is what the
    // panel above is saying.
    await waitFor(() => expect(loads).toHaveBeenCalled());
    const query = loads.mock.calls[0][1];
    expect(query?.shelf).toEqual({ powderIds: [], bullets: [], cartridgeKeys: [] });

    // No member read at all: there is no row to fetch for a signed-out visitor.
    expect(me).not.toHaveBeenCalled();

    // The write controls are absent, and the prompt says where a shelf lives.
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load log/ })).not.toBeInTheDocument();
    // The tool bar and the rail both carry it — one sentence, not two spellings.
    expect(screen.getAllByText(new RegExp(GUEST_PROMPT)).length).toBeGreaterThan(0);
  });
});
