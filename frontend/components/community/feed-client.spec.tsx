// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeedPost } from '../../lib/community-api';

const mocks = vi.hoisted(() => ({
  fetchFeed: vi.fn(),
  searchFeed: vi.fn(),
  fetchConfig: vi.fn(),
  fetchPreferences: vi.fn(),
  deletePost: vi.fn(),
  likePost: vi.fn(),
  reportPost: vi.fn(),
  savePreferences: vi.fn(),
  unlikePost: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
}));
vi.mock('../../lib/community-api', () => ({
  CommunityApiError: class CommunityApiError extends Error {
    status = 500;
  },
  deletePost: mocks.deletePost,
  fetchConfig: mocks.fetchConfig,
  fetchFeed: mocks.fetchFeed,
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
  commentCount: 0,
  createdAt: '2026-09-24T12:00:00.000Z',
  editedAt: null,
  author: { id: 'author-1', username: 'outdoors', avatarUrl: null },
  images: [],
  video: null,
  listing: null,
  liked: false,
} satisfies FeedPost;

describe('Community feed search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchFeed.mockResolvedValue({ posts: [], ads: [], nextBefore: null });
    mocks.searchFeed.mockResolvedValue({ posts: [post], nextBefore: null });
    mocks.fetchConfig.mockResolvedValue({ graphicBlurForced: false });
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
});
