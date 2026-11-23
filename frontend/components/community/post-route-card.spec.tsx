// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FeedRouteSummary } from '../../lib/community-api';
import { PostRouteCard } from './post-route-card';

function summary(overrides: Partial<FeedRouteSummary> = {}): FeedRouteSummary {
  return {
    distanceM: 12400,
    ascentM: 420,
    descentM: 310,
    minElevationM: 1000,
    maxElevationM: 1200,
    durationSeconds: 7800,
    pointCount: 600,
    segmentCount: 1,
    hasElevation: true,
    hasSpeed: true,
    gpxShared: false,
    profile: [1000, 1100, 1050, 1200],
    preview: [
      { lat: -30, lon: 18 },
      { lat: -30.01, lon: 18.01 },
      { lat: -30.02, lon: 18.02 },
    ],
    ...overrides,
  };
}

describe('PostRouteCard', () => {
  it('renders nothing for a post without a route', () => {
    const { container } = render(<PostRouteCard postId="p1" route={null} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the 2D route shape, distance, location and elevation', () => {
    render(
      <PostRouteCard
        postId="post-1"
        route={summary()}
        location="Central Park"
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/community/p/post-1/route');
    expect(link.textContent).toContain('12.4 km');
    expect(link.textContent).toContain('Central Park');
    expect(link.textContent).toContain('1000–1200 m');
    const svg = link.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 132 84');
    expect(link.querySelector('path[style*="red-500"]')).not.toBeNull();
  });

  it('says so when the post has no location', () => {
    render(<PostRouteCard postId="p1" route={summary()} location={null} />);
    expect(screen.getByText('Location not set')).toBeTruthy();
  });

  it('falls back to a GPX placeholder without a preview', () => {
    const { container } = render(
      <PostRouteCard
        postId="p1"
        route={summary({ preview: null })}
        location="Central Park"
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('GPX')).toBeTruthy();
  });

  it('uses a dash when the GPX carried no elevation', () => {
    const { container } = render(
      <PostRouteCard
        postId="p1"
        route={summary({
          hasElevation: false,
          ascentM: null,
          minElevationM: null,
          maxElevationM: null,
        })}
        location="Central Park"
      />,
    );
    expect(container.textContent).toContain('Elevation');
    expect(container.textContent).toContain('—');
  });

  it('says whether other members may download the GPX', () => {
    const { rerender } = render(<PostRouteCard postId="p1" route={summary()} />);
    expect(screen.getByText(/only available to the author/i)).toBeTruthy();

    rerender(<PostRouteCard postId="p1" route={summary({ gpxShared: true })} />);
    expect(screen.getByText(/available to members/i)).toBeTruthy();
  });
});
