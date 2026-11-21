// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeedPost } from '../../lib/community-api';

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

import { PostModal } from './post-modal';

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
