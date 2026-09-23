// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 't' }),
}));

// ⚠️ .spec.tsx, WITH THE X. The Vitest include is
// ['lib/**/*.spec.ts', 'components/**/*.spec.tsx'] — a `.spec.ts` here is
// never collected and passes the gate by not existing.
const mocks = vi.hoisted(() => ({
  createPost: vi.fn(),
  deletePost: vi.fn(),
  submitPost: vi.fn(),
  uploadPostImage: vi.fn(),
  uploadPostVideo: vi.fn(),
}));

vi.mock('../../lib/community-api', async (orig) => {
  const actual = await orig<typeof import('../../lib/community-api')>();
  return { ...actual, ...mocks };
});

import { PostComposer, placeLabel } from './post-composer';
import { CommunityApiError } from '../../lib/community-api';

describe('placeLabel', () => {
  const comp = (long_name: string, ...types: string[]) => ({
    long_name,
    short_name: long_name,
    types,
  });

  it('keeps only the place name and its town', () => {
    expect(
      placeLabel({
        name: 'Hunting Lodge',
        address_components: [
          comp('Hunting Lodge', 'premise'),
          comp('Swartruggens', 'locality'),
          comp('2835', 'postal_code'),
          comp('South Africa', 'country'),
        ],
      }),
    ).toBe('Hunting Lodge, Swartruggens');
  });

  it('does not repeat the name when it is also the town', () => {
    expect(
      placeLabel({
        name: 'Swartruggens',
        address_components: [comp('Swartruggens', 'locality')],
      }),
    ).toBe('Swartruggens');
  });

  it('falls back to the area when the place has no name', () => {
    expect(
      placeLabel({
        address_components: [comp('North West', 'administrative_area_level_1')],
      }),
    ).toBe('North West');
  });
});

function openComposer() {
  const onPosted = vi.fn();
  render(<PostComposer open onPosted={onPosted} />);
  return onPosted;
}

function pickVideoFile(name = 'clip.mp4') {
  const input = document.querySelector(
    'input[type="file"][accept^="video"]',
  ) as HTMLInputElement;
  const file = new File(['x'], name, { type: 'video/mp4' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPost.mockResolvedValue({
    post: { id: 'p1' },
    moderation: { decision: 'PROCESSING', reasons: [] },
  });
  mocks.deletePost.mockResolvedValue({ deleted: true });
  mocks.submitPost.mockResolvedValue({
    post: { id: 'p1' },
    moderation: { decision: 'PROCESSING', reasons: [] },
  });
  mocks.uploadPostImage.mockResolvedValue({ image: { id: 'i1', url: 'u', order: 0 } });
  mocks.uploadPostVideo.mockResolvedValue({
    video: { id: 'v1', url: 'u', thumbnailUrl: null, durationSeconds: 1 },
  });
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('PostComposer', () => {
  it('no longer renders a group selector', () => {
    openComposer();
    expect(screen.queryByText('No group')).toBeNull();
    // Only the post-type selector remains.
    expect(document.querySelectorAll('select')).toHaveLength(1);
  });

  it('uses the themed file picker, not the browser’s raw Choose File widget', () => {
    openComposer();
    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(2);
    // Hidden and re-labelled, so the OS widget never paints its own colours.
    fileInputs.forEach((i) => expect(i.className).toContain('sr-only'));
    expect(screen.getByText('Choose photos')).toBeTruthy();
    expect(screen.getByText('Choose video')).toBeTruthy();
  });

  it('refuses an over-size video before it ever reaches the server', async () => {
    openComposer();
    await userEvent.type(
      screen.getByPlaceholderText("What's on your mind?"),
      'Hello',
    );
    const input = document.querySelector(
      'input[type="file"][accept^="video"]',
    ) as HTMLInputElement;
    const file = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 70 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/maximum is 64 MB/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(mocks.uploadPostVideo).not.toHaveBeenCalled();
  });

  it('deletes the half-created post when the video upload fails', async () => {
    mocks.uploadPostVideo.mockRejectedValueOnce(
      new CommunityApiError(
        400,
        '{"message":"Validation failed (current file size is 70000000, expected size is less than 67108864)"}',
      ),
    );
    const onPosted = openComposer();
    await userEvent.type(
      screen.getByPlaceholderText("What's on your mind?"),
      'Hello',
    );
    pickVideoFile();

    await userEvent.click(screen.getByRole('button', { name: 'Post' }));

    // The orphan is removed so the moderation sweep can never publish it
    // without the attached video.
    await waitFor(() =>
      expect(mocks.deletePost).toHaveBeenCalledWith('t', 'p1'),
    );
    expect(await screen.findByText(/too large/i)).toBeTruthy();
    expect(onPosted).not.toHaveBeenCalled();
  });

  it('posts normally when the video upload succeeds', async () => {
    const onPosted = openComposer();
    await userEvent.type(
      screen.getByPlaceholderText("What's on your mind?"),
      'Hello',
    );
    pickVideoFile();

    await userEvent.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() =>
      expect(mocks.uploadPostVideo).toHaveBeenCalledWith('t', 'p1', expect.any(File)),
    );
    expect(mocks.submitPost).toHaveBeenCalledWith('t', 'p1');
    expect(mocks.deletePost).not.toHaveBeenCalled();
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
  });
});
