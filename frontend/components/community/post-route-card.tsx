import Link from 'next/link';
import type { FeedRouteSummary } from '../../lib/community-api';
import {
  MISSING_VALUE,
  buildProfileGeometry,
  formatAscent,
  formatDistance,
  formatDuration,
} from '../../lib/feed-route';

export interface PostRouteCardProps {
  postId: string;
  /** The summary carried on the feed post. Null/undefined renders nothing. */
  route: FeedRouteSummary | null | undefined;
  className?: string;
}

/**
 * The route teaser shown inside a community post card. It is a LINK to the
 * route viewer, not the viewer itself: the feed never loads full GPX points,
 * and this card does not either — everything it shows is already on the post
 * summary (`route`).
 *
 * ⚠️ IT RENDERS NULL WITHOUT A ROUTE. The feed cards are dense enough that an
 * empty "no route" tile would be noise on every non-GPX post; the caller can
 * therefore render it unconditionally.
 */
export function PostRouteCard({ postId, route, className }: PostRouteCardProps) {
  if (!route) return null;

  const profile = route.profile?.length
    ? buildProfileGeometry(route.profile, { width: 100, height: 32, padY: 2 })
    : null;

  const stats: Array<{ label: string; value: string }> = [
    { label: 'Distance', value: formatDistance(route.distanceM) },
    {
      label: 'Ascent',
      value: route.hasElevation ? formatAscent(route.ascentM) : MISSING_VALUE,
    },
  ];
  if (route.durationSeconds !== null) {
    stats.push({ label: 'Time', value: formatDuration(route.durationSeconds) });
  }

  return (
    <Link
      href={`/community/p/${encodeURIComponent(postId)}/route`}
      className={className}
      aria-label={`View the GPX route: ${formatDistance(route.distanceM)}`}
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

      {profile && (
        <svg
          viewBox={`0 0 ${profile.width} ${profile.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ display: 'block', width: '100%', height: 36, marginTop: 6 }}
        >
          <path d={profile.areaPath} style={{ fill: 'var(--red-wash)' }} />
          <path
            d={profile.linePath}
            fill="none"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ stroke: 'var(--red-500)' }}
          />
        </svg>
      )}

      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt
              className="text-[10px] uppercase tracking-[0.04em]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {stat.label}
            </dt>
            <dd className="num text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        {route.gpxShared
          ? 'GPX download available to members.'
          : 'GPX download is only available to the author.'}
      </p>
    </Link>
  );
}

export default PostRouteCard;
