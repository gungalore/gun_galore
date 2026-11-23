// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeedPost, FeedRouteSummary } from '../../lib/community-api';

// ────────────────────────────────────────────────────────────────────
// GETTING OUT OF THE FULLSCREEN PHOTO.
//
// Operator, 2026-11-21: "When opening a picture in the community, there is no
// way to go back that I can see on the pwa." In an installed PWA there is no
// browser chrome: an icon-only ✕ at a fixed 16px sat under the iOS status bar,
// and the system back gesture navigated the page away instead of closing the
// overlay. These pin the three ways out that do not depend on spotting an icon.
// ────────────────────────────────────────────────────────────────────

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 't', userId: null }),
}));

vi.mock('../../lib/use-scroll-lock', () => ({ useScrollLock: () => {} }));

vi.mock('./comment-thread', () => ({
  CommentThread: () => <div data-testid="comments" />,
}));

vi.mock('../verification-badges', () => ({
  VerificationBadges: () => null,
}));

// The route viewer's own card is tested in its own spec; here we pin only that
// the modal renders it (a link out) and does not embed a map or download.
vi.mock('./post-route-card', () => ({
  PostRouteCard: ({ postId }: { postId: string; route: unknown }) => (
    <a href={`/community/p/${postId}/route`} data-testid="route-card">
      View route &amp; elevation
    </a>
  ),
}));

const post: FeedPost = {
  id: 'p1',
  type: 'GENERAL',
  title: 'AR Shooting',
  body: 'Weekend fun testing the AR for the first time!',
  tags: [],
  location: null,
  locationPlaceId: null,
  flair: [],
  species: [],
  occurredAt: null,
  calibre: null,
  firearmType: null,
  firearmModel: null,
  bulletWeightGr: null,
  powderChargeGr: null,
  testResult: null,
  waterType: null,
  sizeCm: null,
  shotDistanceM: null,
  siteType: null,
  tripDays: null,
  gearCategory: null,
  gearRating: null,
  gearCondition: null,
  context: null,
  graphicTier: 'NONE',
  isOfficial: false,
  likeCount: 0,
  dislikeCount: 0,
  commentCount: 0,
  createdAt: '2026-11-21T11:00:00.000Z',
  editedAt: null,
  author: { id: 'a1', username: 'ruanda', avatarUrl: null },
  images: [
    { id: 'i1', url: 'https://example.test/one.jpg', order: 0 },
    { id: 'i2', url: 'https://example.test/two.jpg', order: 1 },
  ],
  video: null,
  route: null,
  listing: null,
  liked: false,
  disliked: false,
};

vi.mock('../../lib/community-api', () => ({
  fetchPost: vi.fn(async () => ({ post, comments: [] })),
  likePost: vi.fn(async () => undefined),
  unlikePost: vi.fn(async () => undefined),
  dislikePost: vi.fn(async () => undefined),
  undislikePost: vi.fn(async () => undefined),
}));

import { fetchPost } from '../../lib/community-api';
import { PostModal } from './post-modal';

const ROUTE: FeedRouteSummary = {
  distanceM: 5200,
  ascentM: 310,
  descentM: 290,
  durationSeconds: 5400,
  pointCount: 400,
  segmentCount: 1,
  hasElevation: true,
  hasSpeed: true,
  gpxShared: true,
  profile: [1, 2, 3],
};

async function openPhoto(onClose: () => void) {
  render(<PostModal postId="p1" photoIndex={0} onClose={onClose} />);
  // The modal fetches the post before it renders the stage.
  await waitFor(() => expect(screen.getByAltText('Photo 1 of 2')).toBeTruthy());
}

describe('community photo viewer — getting back', () => {
  beforeEach(() => {
    window.history.replaceState(null, '');
  });

  it('has a labelled Back control that closes the viewer', async () => {
    const onClose = vi.fn();
    await openPhoto(onClose);
    const back = screen.getByRole('button', { name: 'Close post' });
    // A word, not a lone glyph: visible on a status bar, findable by a reader.
    expect(back.textContent).toContain('Back');
    await userEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the system back gesture', async () => {
    const onClose = vi.fn();
    await openPhoto(onClose);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the dark stage is tapped, but not the photo itself', async () => {
    const onClose = vi.fn();
    await openPhoto(onClose);

    // The photo toggles zoom and must NOT close the viewer.
    await userEvent.click(screen.getByAltText('Photo 1 of 2'));
    expect(onClose).not.toHaveBeenCalled();

    // The stage around it does close.
    const stage = screen.getByAltText('Photo 1 of 2').closest('div')
      ?.parentElement as HTMLElement;
    await userEvent.click(stage);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('community post modal — the GPX route card', () => {
  const routePost: FeedPost = { ...post, type: 'HIKING', route: ROUTE };

  beforeEach(() => {
    window.history.replaceState(null, '');
    // Persistent, not `Once`: the modal's load effect can re-run, and a queue
    // would fall back to the route-less default post on the second fetch.
    vi.mocked(fetchPost).mockResolvedValue({
      post: routePost,
      comments: [],
    });
  });

  it('links to the route from the centred modal body, with no map embedded', async () => {
    render(<PostModal postId="p1" onClose={vi.fn()} />);

    const card = await screen.findByTestId('route-card');
    expect(card.getAttribute('href')).toBe('/community/p/p1/route');
    // One dialog — the post overlay itself. No nested map/modal.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    // The card links out to the route page; the modal embeds no downloader.
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  });

  it('links to the route from the photo-mode sidebar too', async () => {
    render(<PostModal postId="p1" photoIndex={0} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByAltText('Photo 1 of 2')).toBeTruthy(),
    );
    expect(screen.getByTestId('route-card').getAttribute('href')).toBe(
      '/community/p/p1/route',
    );
  });
});
