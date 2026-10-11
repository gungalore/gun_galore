// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeedPost } from '../../lib/community-api';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 't', userId: null }),
}));

import { PostCard } from './post-card';

const post: FeedPost = {
  id: 'p1',
  type: 'GENERAL',
  title: 'Hunting lodge',
  body: 'Best place to stay',
  tags: [],
  location: 'Hunting Lodge',
  locationPlaceId: 'ChIJtest123',
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
  commentCount: 0,
  createdAt: '2026-09-23T20:00:00.000Z',
  editedAt: null,
  author: { id: 'a1', username: 'turbosnail', avatarUrl: null },
  images: [],
  video: null,
  listing: null,
  liked: false,
};

function renderCard() {
  render(
    <PostCard
      post={post}
      onToggleLike={vi.fn()}
      onHideType={vi.fn()}
      onMuteAuthor={vi.fn()}
      onMuteTag={vi.fn()}
      onReport={vi.fn()}
    />,
  );
}

describe('PostCard — the ⋯ menu is never clipped by its own tile', () => {
  it('does not clip the card (no overflow-hidden on the tile)', () => {
    renderCard();
    const article = screen.getByRole('article');
    // The menu can extend past the card's bottom edge; overflow-hidden sliced
    // "Report post" off at the border.
    expect(article.className).not.toContain('overflow-hidden');
  });

  it('shows the full menu and raises the card above its neighbours when open', async () => {
    renderCard();
    const article = screen.getByRole('article');

    await userEvent.click(screen.getByRole('button', { name: 'Post options' }));

    expect(screen.getByText('Report post')).toBeTruthy();
    // Above the following card's stacking context (gg-tile-lift is z-index 0).
    expect(article.style.zIndex).toBe('30');
  });
});

const graphicPost: FeedPost = {
  ...post,
  graphicTier: 'FIELD',
  images: [{ id: 'i1', url: 'https://img/1', order: 0 }],
};

function renderGraphic(
  overrides: Partial<ComponentProps<typeof PostCard>>,
) {
  render(
    <PostCard
      post={graphicPost}
      onToggleLike={vi.fn()}
      onHideType={vi.fn()}
      onMuteAuthor={vi.fn()}
      onMuteTag={vi.fn()}
      {...overrides}
    />,
  );
}

describe('PostCard — the graphic-content gate follows the member preference', () => {
  it('skips the gate when the member chose to always show graphic content', () => {
    renderGraphic({ showGraphic: true });
    expect(screen.queryByText('Graphic content')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Tap to reveal' }),
    ).toBeNull();
  });

  it('gates graphic content when the member turned it off, and reveals on tap', async () => {
    renderGraphic({ showGraphic: false });
    expect(screen.getByText('Graphic content')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: 'Tap to reveal' }),
    );
    expect(screen.queryByText('Graphic content')).toBeNull();
  });

  it('force-hides extreme content with no reveal button', () => {
    renderGraphic({
      post: { ...graphicPost, graphicTier: 'EXTREME' },
      forceBlur: true,
      showGraphic: true,
    });
    expect(screen.getByText('Graphic content')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show image' })).toBeNull();
  });
});

describe('PostCard — the tagged place', () => {
  it('renders a link pinned to the exact place', () => {
    renderCard();
    const link = screen.getByRole('link', {
      name: /Open Hunting Lodge in maps/i,
    });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Hunting%20Lodge&query_place_id=ChIJtest123',
    );
  });

  it('falls back to a name search when the post has no place id', () => {
    render(
      <PostCard
        post={{ ...post, locationPlaceId: null }}
        onToggleLike={vi.fn()}
        onHideType={vi.fn()}
        onMuteAuthor={vi.fn()}
        onMuteTag={vi.fn()}
      />,
    );
    const link = screen.getByRole('link', {
      name: /Open Hunting Lodge in maps/i,
    });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Hunting%20Lodge',
    );
  });
});
