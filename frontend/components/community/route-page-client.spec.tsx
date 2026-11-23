// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeedPost, FeedRoute } from '../../lib/community-api';
import { CommunityApiError } from '../../lib/community-api';

const auth = vi.hoisted(() => ({
  getToken: async () => 'test-token',
  userId: 'viewer-2' as string | null,
}));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ getToken: auth.getToken, userId: auth.userId }),
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
}));

// The real map is WebGL + a dynamic chunk; neither belongs in jsdom.
vi.mock('next/dynamic', () => ({
  default: () => {
    function RouteMapStub() {
      return <div data-testid="route-map-stub" />;
    }
    return RouteMapStub;
  },
}));
vi.mock('./route-map', () => ({
  default: () => <div data-testid="route-map-stub" />,
}));

const api = vi.hoisted(() => ({
  fetchPost: vi.fn(),
  fetchPostRoute: vi.fn(),
  downloadPostRouteGpx: vi.fn(),
  setRouteGpxShared: vi.fn(),
}));

vi.mock('../../lib/community-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/community-api')>();
  return {
    ...actual,
    fetchPost: api.fetchPost,
    fetchPostRoute: api.fetchPostRoute,
    downloadPostRouteGpx: api.downloadPostRouteGpx,
    setRouteGpxShared: api.setRouteGpxShared,
  };
});

import { RoutePageClient } from './route-page-client';

const route: FeedRoute = {
  distanceM: 12400,
  ascentM: 420,
  descentM: 310,
  durationSeconds: 7800,
  pointCount: 3,
  segmentCount: 1,
  hasElevation: true,
  hasSpeed: true,
  gpxShared: false,
  profile: [1000, 1100, 1050],
  segments: [
    [
      { lat: -30, lon: 18, ele: 1000, speedKph: 4.8, gradientPct: 6.3, distM: 0 },
      { lat: -30.01, lon: 18.01, ele: 1100, speedKph: 5.2, gradientPct: -2.1, distM: 6200 },
      { lat: -30.02, lon: 18.02, ele: 1050, speedKph: 6.0, gradientPct: 0, distM: 12400 },
    ],
  ],
  bounds: { south: -30.02, west: 18, north: -30, east: 18.02 },
};

const post: FeedPost = {
  id: 'p1',
  type: 'TRIP',
  title: 'Morning hike',
  body: 'A quiet ridge loop.',
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
  createdAt: '2026-11-01T06:00:00.000Z',
  editedAt: null,
  author: { id: 'author-1', username: 'turbosnail', avatarUrl: null },
  images: [],
  video: null,
  route: route,
  listing: null,
  liked: false,
  disliked: false,
};

async function renderClient() {
  render(<RoutePageClient postId="p1" />);
  // Every happy-path test starts by waiting past the loading state.
  return screen.findByText('Morning hike');
}

beforeEach(() => {
  auth.userId = 'viewer-2';
  api.fetchPost.mockReset();
  api.fetchPostRoute.mockReset();
  api.downloadPostRouteGpx.mockReset();
  api.setRouteGpxShared.mockReset();
  api.fetchPost.mockResolvedValue({ post, comments: [] });
  api.fetchPostRoute.mockResolvedValue({ route });
  // No MapTiler key by default: the fallback is the default state under test.
  vi.stubEnv('NEXT_PUBLIC_MAPTILER_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('RoutePageClient', () => {
  it('shows a loading state before the route arrives', async () => {
    api.fetchPost.mockImplementation(() => new Promise(() => {}));
    render(<RoutePageClient postId="p1" />);
    expect(screen.getByText('Loading route…')).toBeTruthy();
  });

  it('reports a missing post', async () => {
    api.fetchPost.mockRejectedValue(new CommunityApiError(404, 'gone'));
    render(<RoutePageClient postId="p1" />);
    expect(await screen.findByText('This post is not available.')).toBeTruthy();
  });

  it('reports a post that has no GPX route', async () => {
    api.fetchPostRoute.mockRejectedValue(new CommunityApiError(404, 'no route'));
    render(<RoutePageClient postId="p1" />);
    expect(
      await screen.findByText('This post does not have a GPX route.'),
    ).toBeTruthy();
  });

  it('renders the title, route stats, elevation and the no-key fallback', async () => {
    await renderClient();
    expect(screen.getByText('12.4 km')).toBeTruthy();
    expect(screen.getByText('420 m')).toBeTruthy();
    expect(screen.getByText('310 m')).toBeTruthy();
    expect(screen.getByText('2 h 10 m')).toBeTruthy();
    expect(screen.getByText('5.7 km/h')).toBeTruthy();
    expect(screen.getByText('Map unavailable — route shape only.')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Route point' })).toBeTruthy();
    expect(
      screen.getByText('Tap the map or drag the chart to inspect a point.'),
    ).toBeTruthy();
  });

  it('hides the download for a non-author when the author did not share it', async () => {
    await renderClient();
    expect(screen.queryByRole('button', { name: 'Download .gpx' })).toBeNull();
    expect(
      screen.getByText('The author has not enabled GPX download.'),
    ).toBeTruthy();
  });

  it('shows the download to a non-author when the GPX is shared', async () => {
    api.fetchPostRoute.mockResolvedValue({ route: { ...route, gpxShared: true } });
    await renderClient();
    expect(screen.getByRole('button', { name: 'Download .gpx' })).toBeTruthy();
  });

  it('always shows the download to the author', async () => {
    auth.userId = 'author-1';
    await renderClient();
    expect(screen.getByRole('button', { name: 'Download .gpx' })).toBeTruthy();
  });

  it('lets the author turn sharing on, optimistically, through setRouteGpxShared', async () => {
    auth.userId = 'author-1';
    api.setRouteGpxShared.mockResolvedValue({ gpxShared: true });
    await renderClient();

    const toggle = screen.getByRole('checkbox', {
      name: 'Allow other members to download this GPX',
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await userEvent.click(toggle);
    expect(api.setRouteGpxShared).toHaveBeenCalledWith('test-token', 'p1', true);
    await waitFor(() => expect(toggle.checked).toBe(true));
  });

  it('reverts the author toggle when saving fails', async () => {
    auth.userId = 'author-1';
    api.setRouteGpxShared.mockRejectedValue(new Error('offline'));
    await renderClient();

    const toggle = screen.getByRole('checkbox', {
      name: 'Allow other members to download this GPX',
    }) as HTMLInputElement;
    await userEvent.click(toggle);

    expect(
      await screen.findByText('Could not update the download setting. Please try again.'),
    ).toBeTruthy();
    expect(toggle.checked).toBe(false);
  });

  it('downloads through downloadPostRouteGpx and revokes the object URL', async () => {
    api.fetchPostRoute.mockResolvedValue({ route: { ...route, gpxShared: true } });
    const blob = new Blob(['<gpx/>']);
    api.downloadPostRouteGpx.mockResolvedValue({ blob, filename: 'route.gpx' });
    const createObjectURL = vi.fn(() => 'blob:route');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', {
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      writable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    await renderClient();
    await userEvent.click(screen.getByRole('button', { name: 'Download .gpx' }));

    expect(api.downloadPostRouteGpx).toHaveBeenCalledWith('test-token', 'p1');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalled();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:route'));
    click.mockRestore();
  });

  it('offers a retry when loading fails, and recovers', async () => {
    api.fetchPost.mockRejectedValueOnce(new Error('network'));
    render(<RoutePageClient postId="p1" />);
    expect(
      await screen.findByText('Could not load this route. Please try again.'),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Morning hike')).toBeTruthy();
  });

  it('renders the map component when a MapTiler key exists', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAPTILER_KEY', 'test-key');
    await renderClient();
    expect(await screen.findByTestId('route-map-stub')).toBeTruthy();
    expect(screen.queryByText('Map unavailable — route shape only.')).toBeNull();
  });

  it('says "not in this GPX" for fields the file did not carry', async () => {
    api.fetchPostRoute.mockResolvedValue({
      route: {
        ...route,
        hasElevation: false,
        hasSpeed: false,
        ascentM: null,
        descentM: null,
        durationSeconds: null,
        profile: null,
        segments: [
          [
            { lat: -30, lon: 18, ele: null, speedKph: null, gradientPct: null, distM: 0 },
            { lat: -30.01, lon: 18.01, ele: null, speedKph: null, gradientPct: null, distM: 500 },
          ],
        ],
      },
    });
    render(<RoutePageClient postId="p1" />);
    expect(await screen.findByText('Morning hike')).toBeTruthy();
    expect(screen.getByText('No elevation data in this GPX.')).toBeTruthy();
    // elevation, speed and gradient on the point detail line.
    const occurrences =
      document.body.textContent?.match(/not in this GPX/g)?.length ?? 0;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
