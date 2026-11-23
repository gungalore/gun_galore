import Link from 'next/link';
import type { FeedRouteSummary } from '../../lib/community-api';
import { MISSING_VALUE, formatDistance, projectRoute } from '../../lib/feed-route';

export interface PostRouteCardProps {
  postId: string;
  /** The summary carried on the feed post. Null/undefined renders nothing. */
  route: FeedRouteSummary | null | undefined;
  /** The post's own place/area label, shown beside the route shape. */
  location?: string | null;
  className?: string;
}

/** The feed card shows a range when the route carried both ends. */
function elevationText(route: FeedRouteSummary): string {
  if (!route.hasElevation) return MISSING_VALUE;
  if (
    typeof route.minElevationM === 'number' &&
    typeof route.maxElevationM === 'number'
  ) {
    const low = Math.round(route.minElevationM);
    const high = Math.round(route.maxElevationM);
    return low === high ? `${low} m` : `${low}–${high} m`;
  }
  if (typeof route.ascentM === 'number') return `+${Math.round(route.ascentM)} m`;
  return MISSING_VALUE;
}

/**
 * The route teaser inside a community post. It shows a real 2D sketch of the
 * route from the summary's 60-point `preview` — not the full segments, and not
 * a map tile — beside the distance, the post's location and its elevation.
 *
 * ⚠️ IT RENDERS NULL WITHOUT A ROUTE. The feed is dense; an empty "no route"
 * tile would be noise on every non-GPX post.
 */
export function PostRouteCard({
  postId,
  route,
  location,
  className,
}: PostRouteCardProps) {
  if (!route) return null;

  const projected = route.preview?.length
    ? projectRoute([route.preview], { width: 132, height: 84, padding: 9 })
    : null;
  const locationText = location?.trim() || 'Location not set';

  const stats = [
    { label: 'Distance', value: formatDistance(route.distanceM) },
    { label: 'Location', value: locationText, title: locationText },
    { label: 'Elevation', value: elevationText(route) },
  ];

  return (
    <Link
      href={`/community/p/${encodeURIComponent(postId)}/route`}
      className={className}
      aria-label={`View the GPX route: ${formatDistance(route.distanceM)} at ${locationText}`}
      style={{
        display: 'block',
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '10px 12px',
        color: 'var(--text-primary)',
        textDecoration: 'none',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="text-[11px] font-medium uppercase tracking-[0.04em]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          GPX route
        </span>
        <span className="text-[12px] font-medium" style={{ color: 'var(--red)' }}>
          View route &amp; elevation →
        </span>
      </div>

      <div className="mt-2 flex items-start gap-3">
        <div
          aria-hidden="true"
          style={{
            width: 132,
            height: 84,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {projected ? (
            <svg
              viewBox={`0 0 ${projected.width} ${projected.height}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Route shape"
              style={{ display: 'block', width: '100%', height: '100%' }}
            >
              {projected.segments.map((segment) => (
                <path
                  key={`casing-${segment.segmentIndex}`}
                  d={segment.d}
                  fill="none"
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ stroke: 'var(--text-primary)', strokeOpacity: 0.18 }}
                />
              ))}
              {projected.segments.map((segment) => (
                <path
                  key={`line-${segment.segmentIndex}`}
                  d={segment.d}
                  fill="none"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ stroke: 'var(--red-500)' }}
                />
              ))}
            </svg>
          ) : (
            <span
              className="text-[11px] font-medium uppercase tracking-[0.04em]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              GPX
            </span>
          )}
        </div>

        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt
                className="text-[10px] uppercase tracking-[0.04em]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {stat.label}
              </dt>
              <dd
                className="num text-[13px] font-medium"
                title={stat.title}
                style={{
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        {route.gpxShared
          ? 'GPX download available to members.'
          : 'GPX download is only available to the author.'}
      </p>
    </Link>
  );
}

export default PostRouteCard;
