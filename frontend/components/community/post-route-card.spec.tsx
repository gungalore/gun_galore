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
    durationSeconds: 7800,
    pointCount: 600,
    segmentCount: 1,
    hasElevation: true,
    hasSpeed: true,
    gpxShared: false,
    profile: [1000, 1100, 1050, 1200],
    ...overrides,
  };
}

describe('PostRouteCard', () => {
  it('renders nothing for a post without a route', () => {
    const { container } = render(<PostRouteCard postId="p1" route={null} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links to the route viewer and shows the summary stats', () => {
    render(<PostRouteCard postId="post-1" route={summary()} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/community/p/post-1/route');
    expect(link.textContent).toContain('12.4 km');
    expect(link.textContent).toContain('420 m');
    expect(link.textContent).toContain('2 h 10 m');
  });

  it('says whether other members may download the GPX', () => {
    const { rerender } = render(<PostRouteCard postId="p1" route={summary()} />);
    expect(screen.getByText(/only available to the author/i)).toBeTruthy();

    rerender(<PostRouteCard postId="p1" route={summary({ gpxShared: true })} />);
    expect(screen.getByText(/available to members/i)).toBeTruthy();
  });

  it('skips the sparkline and the time stat when the GPX carried neither', () => {
    const { container } = render(
      <PostRouteCard
        postId="p1"
        route={summary({ profile: null, durationSeconds: null, hasElevation: false, ascentM: null })}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText('Time')).toBeNull();
    // "Ascent" stays, with the missing dash.
    expect(container.textContent).toContain('Ascent');
    expect(container.textContent).toContain('—');
  });

  it('draws the elevation sparkline from the summary profile', () => {
    const { container } = render(<PostRouteCard postId="p1" route={summary()} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 32');
    expect(container.querySelector('path[style*="red-wash"]')).not.toBeNull();
  });
});
