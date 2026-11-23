import type { FeedRoutePoint } from '../../lib/community-api';
import { projectRoute } from '../../lib/feed-route';

export type RouteFallbackReason = 'webgl' | 'style' | 'error' | null;

export interface RouteFallbackProps {
  /** GPX segments from the full route payload. */
  segments: FeedRoutePoint[][];
  /** Flattened route index to pin on the sketch, when one is selected. */
  selectedIndex?: number;
  /** Why the real map is not showing; only used for the note. */
  reason?: RouteFallbackReason;
  className?: string;
}

const REASON_COPY: Record<Exclude<RouteFallbackReason, null>, string> = {
  webgl:
    'This browser could not start WebGL, so the 3D map is unavailable. Enable hardware acceleration or try another browser.',
  style: 'The map style could not load. Please try again.',
  error: 'The map could not start. Please try again.',
};

/**
 * The route page's "no map" state: the same route, drawn from its own points
 * with an equirectangular projection into a static SVG. Server-safe on purpose
 * — no MapLibre, no DOM, no hooks — because it also renders when the MapTiler
 * key is missing (where the map chunk must not be loaded at all) and when the
 * map itself fails after loading.
 *
 * ⚠️ THE SELECTED POINT IS DRAWN ON THE SKETCH. The elevation scrubber is
 * useless if the member cannot see which part of the track it is pointing at;
 * MapLibre draws its own circle, so this sketch needs its own dot.
 */
export function RouteFallback({
  segments,
  selectedIndex,
  reason = null,
  className,
}: RouteFallbackProps) {
  const projected = projectRoute(segments);
  const selected =
    projected && selectedIndex !== undefined
      ? projected.segments
          .flatMap((segment) => segment.points)
          .find((point) => point.index === selectedIndex) ?? null
      : null;

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
          {selected && (
            <circle
              data-testid="route-fallback-selected"
              cx={selected.x}
              cy={selected.y}
              r={5}
              fill="var(--red-500)"
              stroke="var(--bg-card)"
              strokeWidth={2}
            />
          )}
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
        {reason ? REASON_COPY[reason] : 'Map unavailable — route shape only.'}
      </p>
    </section>
  );
}

export default RouteFallback;
