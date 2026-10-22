// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeedComment } from '../../lib/community-api';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 't' }),
}));

const api = vi.hoisted(() => ({
  addComment: vi.fn(),
  likeComment: vi.fn(),
  unlikeComment: vi.fn(),
  dislikeComment: vi.fn(),
  undislikeComment: vi.fn(),
  reportComment: vi.fn(),
}));

vi.mock('../../lib/community-api', () => ({
  addComment: api.addComment,
  likeComment: api.likeComment,
  unlikeComment: api.unlikeComment,
  dislikeComment: api.dislikeComment,
  undislikeComment: api.undislikeComment,
  reportComment: api.reportComment,
}));

import { CommentThread } from './comment-thread';

const comment: FeedComment = {
  id: 'c1',
  parentId: null,
  body: 'Nice loads',
  likeCount: 2,
  dislikeCount: 0,
  createdAt: '2026-10-20T10:00:00.000Z',
  liked: false,
  disliked: false,
  author: { id: 'u2', username: 'jane', avatarUrl: null },
};

function renderThread(comments: FeedComment[] = [comment]) {
  const onRefresh = vi.fn();
  render(
    <CommentThread postId="p1" comments={comments} onRefresh={onRefresh} />,
  );
  return { onRefresh };
}

describe('CommentThread — reactions', () => {
  it('dislikes a comment and flips the button state', async () => {
    api.dislikeComment.mockResolvedValue({ liked: false, disliked: true });
    renderThread();

    const dislike = screen.getByRole('button', { name: 'Dislike comment' });
    await userEvent.click(dislike);

    expect(api.dislikeComment).toHaveBeenCalledWith('t', 'c1');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove dislike' }).getAttribute(
          'aria-pressed',
        ),
      ).toBe('true'),
    );
  });

  it('likes a comment and shows the updated count', async () => {
    api.likeComment.mockResolvedValue({ liked: true, disliked: false });
    renderThread();

    await userEvent.click(screen.getByRole('button', { name: 'Like comment' }));

    expect(api.likeComment).toHaveBeenCalledWith('t', 'c1');
    expect(await screen.findByText('3')).toBeTruthy();
  });

  it('removes an existing like', async () => {
    api.unlikeComment.mockResolvedValue({ liked: false, disliked: false });
    renderThread([{ ...comment, liked: true, likeCount: 3 }]);

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove like' }),
    );

    expect(api.unlikeComment).toHaveBeenCalledWith('t', 'c1');
  });
});

describe('CommentThread — replies', () => {
  it('prefills the composer with the author when Reply is clicked', async () => {
    renderThread();

    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));

    const box = screen.getByLabelText('Write a comment') as HTMLTextAreaElement;
    expect(box.value).toBe('@jane ');
    expect(screen.getByText('Replying to jane')).toBeTruthy();
  });

  it('posts a reply against the root comment', async () => {
    api.addComment.mockResolvedValue({
      comment: { ...comment, id: 'c2', parentId: 'c1' },
      moderation: { decision: 'PUBLISHED', reasons: [] },
    });
    renderThread();

    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const box = screen.getByLabelText('Write a comment');
    await userEvent.type(box, 'Thanks');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(api.addComment).toHaveBeenCalledWith('t', 'p1', '@jane Thanks', 'c1');
  });
});

describe('CommentThread — sorting and rendering', () => {
  it('renders replies under their parent and sorts roots', async () => {
    const older = {
      ...comment,
      id: 'c0',
      body: 'Older',
      createdAt: '2026-10-19T10:00:00.000Z',
    };
    const reply = {
      ...comment,
      id: 'c2',
      parentId: 'c1',
      body: 'A reply',
      createdAt: '2026-10-20T11:00:00.000Z',
    };
    renderThread([older, comment, reply]);

    expect(screen.getByText('A reply')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Sort comments'), 'oldest');
    const bodies = screen.getAllByText(/Older|Nice loads/).map((el) => el.textContent);
    expect(bodies[0]).toBe('Older');
  });

  it('shows the empty state', () => {
    renderThread([]);
    expect(screen.getByText('No comments yet.')).toBeTruthy();
  });
});
