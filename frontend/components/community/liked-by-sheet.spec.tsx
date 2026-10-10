// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 't' }),
}));

const fetchPostLikes = vi.fn();
vi.mock('../../lib/community-api', () => ({
  fetchPostLikes: (...args: unknown[]) => fetchPostLikes(...args),
}));

import { LikedBySheet } from './liked-by-sheet';

const liker = {
  id: 'u2',
  username: 'jane',
  avatarUrl: null,
  sellerTier: null,
  isVerifiedExpert: true,
};

beforeEach(() => {
  fetchPostLikes.mockReset();
});

describe('LikedBySheet', () => {
  it('lists the members who liked the post', async () => {
    fetchPostLikes.mockResolvedValue({ likers: [liker], nextBefore: null });
    render(<LikedBySheet postId="p1" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('jane')).toBeTruthy());
    expect(screen.getByText('Expert')).toBeTruthy();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/community/u/jane',
    );
  });

  it('shows an empty state when nobody has liked the post', async () => {
    fetchPostLikes.mockResolvedValue({ likers: [], nextBefore: null });
    render(<LikedBySheet postId="p1" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('No likes yet.')).toBeTruthy());
  });

  it('loads more with the cursor and appends the next page', async () => {
    fetchPostLikes.mockImplementation(
      (_token: string, _postId: string, before?: string) =>
        Promise.resolve(
          before
            ? {
                likers: [
                  { ...liker, id: 'u3', username: 'sipho', isVerifiedExpert: false },
                ],
                nextBefore: null,
              }
            : { likers: [liker], nextBefore: 'cursor-1' },
        ),
    );
    render(<LikedBySheet postId="p1" onClose={vi.fn()} />);

    await userEvent.click(await screen.findByText('Load more'));

    await waitFor(() => expect(screen.getByText('sipho')).toBeTruthy());
    expect(screen.getByText('jane')).toBeTruthy();
    expect(fetchPostLikes).toHaveBeenLastCalledWith('t', 'p1', 'cursor-1');
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('closes on the Close button', async () => {
    fetchPostLikes.mockResolvedValue({ likers: [], nextBefore: null });
    const onClose = vi.fn();
    render(<LikedBySheet postId="p1" onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
