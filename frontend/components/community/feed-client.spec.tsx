// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeedPost } from '../../lib/community-api';

// Signed-in by default; the guest test flips this to prove the declared
// signed-out read path (no token, no preferences, sign-in prompt).
const authState = vi.hoisted(() => ({ signedIn: true }));

const mocks = vi.hoisted(() => ({
  fetchFeed: vi.fn(),
  searchFeed: vi.fn(),
  fetchConfig: vi.fn(),
  fetchPostCounts: vi.fn(),
  fetchPreferences: vi.fn(),
  deletePost: vi.fn(),
  likePost: vi.fn(),
  reportPost: vi.fn(),
  savePreferences: vi.fn(),
  unlikePost: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    getToken: async () => (authState.signedIn ? 'test-token' : null),
  }),
  useUser: () => ({ isLoaded: true, isSignedIn: authState.signedIn }),
  SignInButton: ({ children }: { children?: ReactNode }) => (
    <a href="/sign-in">{children}</a>
  ),
}));
vi.mock('../../lib/community-api', () => ({
  CommunityApiError: class CommunityApiError extends Error {
    status = 500;
  },
  deletePost: mocks.deletePost,
  fetchConfig: mocks.fetchConfig,
  fetchFeed: mocks.fetchFeed,
  fetchPostCounts: mocks.fetchPostCounts,
  fetchPreferences: mocks.fetchPreferences,
  likePost: mocks.likePost,
  reportPost: mocks.reportPost,
  savePreferences: mocks.savePreferences,
  searchFeed: mocks.searchFeed,
  unlikePost: mocks.unlikePost,
}));
vi.mock('./post-card', () => ({
  PostCard: ({ post }: { post: FeedPost }) => <article>{post.title}</article>,
}));
vi.mock('./ad-card', () => ({ AdCard: () => null }));
vi.mock('../ui/ChipRail', () => ({
  ChipRail: () => <div aria-label="Community categories" />,
}));

import { FeedClient } from './feed-client';

const post = {
  id: 'post-1',
  type: 'GENERAL',
  title: 'Search result post',
  body: 'Post body',
  tags: ['camping'],
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
  createdAt: '2026-09-24T12:00:00.000Z',
  editedAt: null,
  author: { id: 'author-1', username: 'outdoors', avatarUrl: null },
  images: [],
  video: null,
  listing: null,
  liked: false,
  disliked: false,
} satisfies FeedPost;

describe('Community feed search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.signedIn = true;
    window.sessionStorage.clear();
    mocks.fetchFeed.mockResolvedValue({ posts: [], ads: [], nextBefore: null });
    mocks.searchFeed.mockResolvedValue({ posts: [post], nextBefore: null });
    mocks.fetchConfig.mockResolvedValue({ graphicBlurForced: false });
    mocks.fetchPostCounts.mockResolvedValue({ counts: [] });
    mocks.fetchPreferences.mockResolvedValue({
      feedMutedPostTypes: [],
      feedMutedAuthorIds: [],
      feedMutedTags: [],
      feedShowAvatar: true,
      feedShowGraphic: true,
    });
  });

  it('searches the feed after a short pause and shows matching results', async () => {
    render(<FeedClient />);
    const input = screen.getByRole('searchbox', { name: 'Search the community feed' });
    fireEvent.change(input, { target: { value: '  camping  ' } });

    await waitFor(() => {
      expect(mocks.searchFeed).toHaveBeenCalledWith('test-token', {
        type: undefined,
        includeFiltered: false,
        q: 'camping',
      });
    });
    expect(await screen.findByText('Search result post')).toBeTruthy();
  });

  it('re-fetches the first page when Refresh is clicked', async () => {
    mocks.fetchFeed.mockResolvedValue({
      posts: [post],
      ads: [],
      nextBefore: null,
    });
    render(<FeedClient />);
    await screen.findByText('Search result post');
    mocks.fetchFeed.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh the feed' }));

    await waitFor(() => expect(mocks.fetchFeed).toHaveBeenCalled());
  });

  it('polls like/comment counts for the posts on screen', async () => {
    mocks.fetchFeed.mockResolvedValue({
      posts: [post],
      ads: [],
      nextBefore: null,
    });
    render(<FeedClient />);
    await screen.findByText('Search result post');

    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() =>
      expect(mocks.fetchPostCounts).toHaveBeenCalledWith('test-token', [
        'post-1',
      ]),
    );
  });

  it('reads the feed for a declared signed-out visitor with no token, and prompts sign-in', async () => {
    authState.signedIn = false;
    mocks.fetchFeed.mockResolvedValue({
      posts: [post],
      ads: [],
      nextBefore: null,
    });

    render(<FeedClient />);

    // The published feed is CONTENT: it loads without a session…
    expect(await screen.findByText('Search result post')).toBeTruthy();
    expect(mocks.fetchFeed).toHaveBeenCalledWith(null, {
      type: undefined,
      includeFiltered: false,
    });
    expect(mocks.fetchConfig).toHaveBeenCalledWith(null);
    // …but the member's own preferences are never requested.
    expect(mocks.fetchPreferences).not.toHaveBeenCalled();
    // And the actions that need a session are replaced by a sign-in prompt.
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });
});
