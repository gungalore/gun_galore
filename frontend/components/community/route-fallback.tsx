import type { FeedRoutePoint } from '../../lib/community-api';
import { projectRoute } from '../../lib/feed-route';

export interface RouteFallbackProps {
  /** GPX segments from the full route payload. */
  segments: FeedRoutePoint[][];
  className?: string;
}

/**
 * The route page's "no map" state: the same route, drawn from its own points
 * with an equirectangular projection into a static SVG. Server-safe on purpose
 * — no MapLibre, no DOM, no hooks — because it also renders when the MapTiler
 * key is missing (where the map chunk must not be loaded at all) and when the
 * map itself fails after loading.
 *
 * Deliberately NOT a fake map: there is no imagery, no grid of streets and no
 * pin, so nobody mistakes it for a tile map that failed to paint. The note says
 * what it is.
 */
export function RouteFallback({ segments, className }: RouteFallbackProps) {
  const projected = projectRoute(segments);

  return (
    <section
      className={className}
      aria-label="Route map unavailable"
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 12,
      }}
    >
      {projected ? (
        <svg
          viewBox={`0 0 ${projected.width} ${projected.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Static sketch of the route shape"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        >
          {projected.segments.map((segment) => (
            <path
              key={`casing-${segment.segmentIndex}`}
              d={segment.d}
              fill="none"
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ stroke: 'var(--bg-card)' }}
            />
          ))}
          {projected.segments.map((segment) => (
            <path
              key={`line-${segment.segmentIndex}`}
              d={segment.d}
              fill="none"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ stroke: 'var(--red-500)' }}
            />
          ))}
        </svg>
      ) : (
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          There are no route points to sketch.
        </p>
      )}

      <p
        className="mt-2 text-[12px] text-center"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Map unavailable — route shape only.
      </p>
    </section>
  );
}

export default RouteFallback;
