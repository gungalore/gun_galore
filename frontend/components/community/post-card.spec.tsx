// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeedPost } from '../../lib/community-api';

// Signed-in by default: the member controls below (⋯ menu, reactions) are
// what these tests were written against. The guest cases flip `auth.userId`.
const auth = vi.hoisted(() => ({ userId: 'member-1' as string | null }));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 't', userId: auth.userId }),
}));

// The real card is the route-viewer agent's component; this stub pins the
// CONTRACT (postId + route in, stats + link out) so the card integration can be
// tested without pulling a map renderer into jsdom.
vi.mock('./post-route-card', () => ({
  PostRouteCard: ({
    postId,
    route,
  }: {
    postId: string;
    route: { distanceM: number; ascentM: number | null };
  }) => (
    <div data-testid="route-card">
      <span>
        {(route.distanceM / 1000).toFixed(1)} km · {route.ascentM ?? 0} m ascent
      </span>
      <a href={`/community/p/${postId}/route`}>View route &amp; elevation</a>
    </div>
  ),
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
  dislikeCount: 0,
  commentCount: 0,
  createdAt: '2026-09-23T20:00:00.000Z',
  editedAt: null,
  author: { id: 'a1', username: 'turbosnail', avatarUrl: null },
  images: [],
  video: null,
  route: null,
  listing: null,
  liked: false,
  disliked: false,
};

function renderCard() {
  render(
    <PostCard
      post={post}
      onToggleLike={vi.fn()}
      onToggleDislike={vi.fn()}
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
      onToggleDislike={vi.fn()}
      onHideType={vi.fn()}
      onMuteAuthor={vi.fn()}
      onMuteTag={vi.fn()}
      {...overrides}
    />,
  );
}

describe('PostCard — graphic media is always blurred, always revealable', () => {
  it('gates FIELD content even when the member pref says show graphic', async () => {
    // Operator 2026-11-25: blur must always be active in the feed; the member
    // preference no longer skips it.
    renderGraphic({ showGraphic: true });
    expect(screen.getByText('Graphic content')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: 'Tap to reveal' }),
    );
    expect(screen.queryByText('Graphic content')).toBeNull();
  });

  it('gates EXTREME content and still offers reveal', async () => {
    renderGraphic({
      post: { ...graphicPost, graphicTier: 'EXTREME' },
      forceBlur: true,
      showGraphic: true,
    });
    expect(screen.getByText('Graphic content')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show image' }));
    expect(screen.queryByText('Graphic content')).toBeNull();
  });

  it('does not gate a non-graphic post', () => {
    renderCard();
    expect(screen.queryByText('Graphic content')).toBeNull();
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
        onToggleDislike={vi.fn()}
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

describe('PostCard — a photo post can also carry a GPX route', () => {
  const routePost: FeedPost = {
    ...post,
    type: 'HIKING',
    images: [{ id: 'i1', url: 'https://img/valley.jpg', order: 0 }],
    route: {
      distanceM: 5200,
      ascentM: 310,
      descentM: 290,
      durationSeconds: 5400,
      pointCount: 400,
      segmentCount: 1,
      hasElevation: true,
      hasSpeed: true,
      gpxShared: true,
      profile: [0, 10, 30, 20, 0],
    },
  };

  it('renders the photo collage and the route summary together', () => {
    render(
      <PostCard
        post={routePost}
        onToggleLike={vi.fn()}
        onToggleDislike={vi.fn()}
        onHideType={vi.fn()}
        onMuteAuthor={vi.fn()}
        onMuteTag={vi.fn()}
      />,
    );

    // The photos are still the collage…
    expect(screen.getByRole('button', { name: 'Open photo 1' })).toBeTruthy();
    // …and the route card is additive, with its stats and route-page link.
    const card = screen.getByTestId('route-card');
    expect(card.textContent).toContain('5.2 km');
    expect(card.textContent).toContain('310 m ascent');
    const link = screen.getByRole('link', { name: /View route/i });
    expect(link.getAttribute('href')).toBe('/community/p/p1/route');
  });

  it('renders no route card when the post has no route', () => {
    renderCard();
    expect(screen.queryByTestId('route-card')).toBeNull();
  });
});

describe('PostCard — a declared signed-out guest', () => {
  beforeEach(() => {
    auth.userId = null;
  });
  afterEach(() => {
    auth.userId = 'member-1';
  });

  it('hides the member-only ⋯ menu', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: 'Post options' })).toBeNull();
    expect(screen.queryByText('Report post')).toBeNull();
  });

  it('disables the reactions and says sign-in is needed', () => {
    renderCard();
    expect(
      screen.getByRole('button', { name: 'Like' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Dislike' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText('Sign in to react, comment or follow.')).toBeTruthy();
  });
});
