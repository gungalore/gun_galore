// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 't' }),
}));

const fetchMyFollowers = vi.fn();
const fetchMyFollowing = vi.fn();
const removeFollower = vi.fn();
const unfollowUser = vi.fn();
vi.mock('../../lib/community-api', () => ({
  fetchMyFollowers: (...args: unknown[]) => fetchMyFollowers(...args),
  fetchMyFollowing: (...args: unknown[]) => fetchMyFollowing(...args),
  removeFollower: (...args: unknown[]) => removeFollower(...args),
  unfollowUser: (...args: unknown[]) => unfollowUser(...args),
}));

import { FollowsSheet } from './follows-sheet';

const user = {
  id: 'u2',
  username: 'jane',
  avatarUrl: null,
  sellerTier: null,
  isVerifiedExpert: true,
  isFollowing: false,
};

beforeEach(() => {
  fetchMyFollowers.mockReset();
  fetchMyFollowing.mockReset();
  removeFollower.mockReset();
  unfollowUser.mockReset();
});

describe('FollowsSheet', () => {
  it('lists followers and removes one', async () => {
    fetchMyFollowers.mockResolvedValue({ users: [user], nextBefore: null });
    removeFollower.mockResolvedValue({ removed: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onRemoved = vi.fn();

    render(<FollowsSheet mode="followers" onClose={vi.fn()} onRemoved={onRemoved} />);

    await waitFor(() => expect(screen.getByText('jane')).toBeTruthy());
    expect(screen.getByText('Expert')).toBeTruthy();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/community/u/jane');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(removeFollower).toHaveBeenCalledWith('t', 'u2'));
    expect(screen.queryByText('jane')).toBeNull();
    expect(onRemoved).toHaveBeenCalledWith('followers');
  });

  it('lists the members followed and unfollows one', async () => {
    fetchMyFollowing.mockResolvedValue({
      users: [{ ...user, isFollowing: true }],
      nextBefore: null,
    });
    unfollowUser.mockResolvedValue({ following: false });

    render(<FollowsSheet mode="following" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('jane')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Unfollow' }));

    await waitFor(() => expect(unfollowUser).toHaveBeenCalledWith('t', 'u2'));
    expect(screen.queryByText('jane')).toBeNull();
  });

  it('shows an empty state when there are no followers', async () => {
    fetchMyFollowers.mockResolvedValue({ users: [], nextBefore: null });

    render(<FollowsSheet mode="followers" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('No followers yet.')).toBeTruthy());
  });

  it('loads more with the cursor and appends the next page', async () => {
    fetchMyFollowers.mockImplementation((_token: string, before?: string) =>
      Promise.resolve(
        before
          ? { users: [{ ...user, id: 'u3', username: 'sipho' }], nextBefore: null }
          : { users: [user], nextBefore: 'cursor-1' },
      ),
    );

    render(<FollowsSheet mode="followers" onClose={vi.fn()} />);

    await userEvent.click(await screen.findByText('Load more'));

    await waitFor(() => expect(screen.getByText('sipho')).toBeTruthy());
    expect(screen.getByText('jane')).toBeTruthy();
    expect(fetchMyFollowers).toHaveBeenLastCalledWith('t', 'cursor-1');
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('closes on the Close button', async () => {
    fetchMyFollowers.mockResolvedValue({ users: [], nextBefore: null });
    const onClose = vi.fn();

    render(<FollowsSheet mode="followers" onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
