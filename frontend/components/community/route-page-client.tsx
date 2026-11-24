'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import {
  CommunityApiError,
  downloadPostRouteGpx,
  fetchPost,
  fetchPostRoute,
  setRouteGpxShared,
  type FeedPost,
  type FeedRoute,
  type FeedRoutePoint,
} from '../../lib/community-api';
import {
  NOT_IN_GPX,
  densifyRoute,
  flattenRoute,
  formatAscent,
  formatDescent,
  formatDistance,
  formatDuration,
  formatElevation,
  formatGradient,
  formatSpeed,
} from '../../lib/feed-route';
import { readRouteMapConfig } from '../../lib/route-map-config';
import {
  applyTerrainElevations,
  fetchTerrainElevations,
  sampleRouteForTerrain,
  terrainElevationStats,
  type TerrainElevationStats,
} from '../../lib/terrain-elevation';
import { RouteElevation } from './route-elevation';
import { RouteFallback } from './route-fallback';

/**
 * ⚠️ MAPLIBRE IS NEVER IN THE SERVER BUNDLE. `ssr:false` means this chunk is
 * fetched only in the browser, and the viewer renders it only when a MapTiler
 * key exists — with no key the fallback sketch is all that is ever requested.
 */
const RouteMap = dynamic(() => import('./route-map'), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-[8px] px-4 py-10 text-center text-[13px]"
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        color: 'var(--text-tertiary)',
      }}
    >
      Loading map…
    </div>
  ),
});

export interface RoutePageClientProps {
  postId: string;
}

/**
 * The full GPX viewer: summary stats, download permission, the map (or its
 * static sketch), the elevation profile and the inspected point.
 *
 * The server page has already passed the CommunityGate; this component still
 * reads the session because every API call carries the member's token.
 */
export function RoutePageClient({ postId }: RoutePageClientProps) {
  const { getToken, userId } = useAuth();
  const { isLoaded, isSignedIn } = useUser();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [route, setRoute] = useState<FeedRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [postMissing, setPostMissing] = useState(false);
  const [routeMissing, setRouteMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [gpxShared, setGpxShared] = useState(false);
  const [savingShare, setSavingShare] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [terrainSegments, setTerrainSegments] = useState<FeedRoutePoint[][] | null>(null);
  const [terrainStats, setTerrainStats] = useState<TerrainElevationStats | null>(null);
  const [terrainStatus, setTerrainStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >('idle');

  // Read once: NEXT_PUBLIC_* values are fixed for the life of the build.
  const mapConfig = useMemo(() => readRouteMapConfig(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setPostMissing(false);
    setRouteMissing(false);
    try {
      const token = await getToken();
      if (!token) {
        setLoadError(true);
        return;
      }
      const postData = await fetchPost(token, postId);
      setPost(postData.post);

      try {
        const routeData = await fetchPostRoute(token, postId);
        setRoute(routeData.route);
        setGpxShared(routeData.route.gpxShared);
        setSelectedIndex(0);
      } catch (routeError) {
        if (routeError instanceof CommunityApiError && routeError.status === 404) {
          setRouteMissing(true);
        } else {
          throw routeError;
        }
      }
    } catch (error) {
      if (error instanceof CommunityApiError && error.status === 404) {
        setPostMissing(true);
      } else {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [getToken, postId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void load();
  }, [isLoaded, isSignedIn, load]);

  // The stored route stays simplified; densify a display copy only for the
  // map/chart/slider so the inspector moves at ~5 m instead of stepping between
  // the handful of simplified vertices.
  const baseDisplay = useMemo(
    () =>
      route
        ? { ...route, segments: densifyRoute(route.segments) }
        : null,
    [route],
  );

  // Elevation is MapTiler's terrain, not the GPX's `<ele>`: a planned or
  // synthetic GPX can be metres out of step with the 3D map. One Elevation API
  // call supplies up to 50 samples; the dense display series interpolates them.
  // If the key/host/API refuses, the GPX elevation remains the fallback.
  useEffect(() => {
    setTerrainSegments(null);
    setTerrainStats(null);
    if (!route || !baseDisplay) {
      setTerrainStatus('idle');
      return;
    }
    if (!mapConfig.hasKey) {
      setTerrainStatus('unavailable');
      return;
    }
    const samples = sampleRouteForTerrain(baseDisplay.segments);
    if (!samples.length) {
      setTerrainStatus('unavailable');
      return;
    }
    let cancelled = false;
    setTerrainStatus('loading');
    fetchTerrainElevations(samples, mapConfig.key)
      .then((elevations) => {
        if (cancelled) return;
        if (!elevations) {
          setTerrainStatus('unavailable');
          return;
        }
        const applied = applyTerrainElevations(
          baseDisplay.segments,
          samples,
          elevations,
        );
        if (!applied.length) {
          setTerrainStatus('unavailable');
          return;
        }
        setTerrainSegments(applied);
        setTerrainStats(terrainElevationStats(applied));
        setTerrainStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setTerrainStatus('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [route, baseDisplay, mapConfig.hasKey, mapConfig.key]);

  const displayRoute = useMemo(
    () =>
      route
        ? {
            ...route,
            segments: terrainSegments ?? baseDisplay?.segments ?? [],
            hasElevation: terrainSegments ? true : route.hasElevation,
          }
        : null,
    [route, terrainSegments, baseDisplay],
  );
  const elevationSource: 'terrain' | 'gpx' =
    terrainStatus === 'ready' ? 'terrain' : 'gpx';
  const flatPoints = useMemo(
    () => (displayRoute ? flattenRoute(displayRoute) : []),
    [displayRoute],
  );
  const selectedPoint = flatPoints[selectedIndex] ?? null;

  const isAuthor = !!post && !!userId && post.author.id === userId;
  const canDownload = !!route && (route.gpxShared || isAuthor);
  const averageSpeedKph =
    route && route.durationSeconds && route.durationSeconds > 0
      ? (route.distanceM / route.durationSeconds) * 3.6
      : null;

  async function handleDownload() {
    if (!route || downloading) return;
    setActionError(null);
    setDownloading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      const { blob, filename } = await downloadPostRouteGpx(token, postId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoke on the next tick — revoking synchronously can cancel the
      // download in some browsers before it reads the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setActionError('Could not download the GPX. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleShareToggle(next: boolean) {
    if (!route || savingShare) return;
    const previous = gpxShared;
    setGpxShared(next);
    setSavingShare(true);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      const result = await setRouteGpxShared(token, postId, next);
      setGpxShared(result.gpxShared);
    } catch {
      setGpxShared(previous);
      setActionError('Could not update the download setting. Please try again.');
    } finally {
      setSavingShare(false);
    }
  }

  if (!isLoaded || loading) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        Loading route…
      </p>
    );
  }
  if (!isSignedIn) {
    // The server page renders CommunityGate; this is the client-session-lost
    // case (an expired refresh token while the page sat open).
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        Please sign in to view this route.
      </p>
    );
  }
  if (postMissing) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        This post is not available.
      </p>
    );
  }
  if (loadError) {
    return (
      <div className="text-center">
        <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
          Could not load this route. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="gg-press mt-3 rounded-[6px] px-4 py-2 text-[13px] font-medium"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (routeMissing) {
    return (
      <div className="text-center">
        <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
          This post does not have a GPX route.
        </p>
        <Link
          href={`/community/p/${postId}`}
          className="gg-press mt-3 inline-block text-[13px]"
          style={{ color: 'var(--red)' }}
        >
          ← Back to the post
        </Link>
      </div>
    );
  }
  if (!post || !route || !displayRoute) return null;

  const ascentM = terrainStats?.ascentM ?? route.ascentM;
  const descentM = terrainStats?.descentM ?? route.descentM;
  const title = post.title?.trim() || 'GPX route';
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Distance', value: formatDistance(route.distanceM) },
    {
      label: terrainStats ? 'Ascent · terrain' : 'Ascent',
      value: formatAscent(ascentM),
    },
    {
      label: terrainStats ? 'Descent · terrain' : 'Descent',
      value: formatDescent(descentM),
    },
  ];
  if (route.durationSeconds !== null) {
    stats.push({ label: 'Duration', value: formatDuration(route.durationSeconds) });
  }
  if (averageSpeedKph !== null) {
    stats.push({ label: 'Avg speed', value: formatSpeed(averageSpeedKph) });
  }

  const cardStyle = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 8,
  } as const;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div>
          <p
            className="text-[11px] font-medium uppercase tracking-[0.04em]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            GPX route
          </p>
          <h1
            className="mt-1 text-xl sm:text-2xl font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </h1>
        </div>

        <dl
          className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-3"
          style={cardStyle}
        >
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt
                className="text-[11px] uppercase tracking-[0.04em]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {stat.label}
              </dt>
              <dd
                className="num text-[15px] font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={cardStyle}
        >
          {canDownload ? (
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="gg-press rounded-[6px] px-4 py-2 text-[13px] font-medium disabled:opacity-60"
              style={{ background: 'var(--action-primary-bg)', color: '#fff' }}
            >
              {downloading ? 'Preparing…' : 'Download .gpx'}
            </button>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
              The author has not enabled GPX download.
            </p>
          )}

          {isAuthor && (
            <label
              className="flex items-center gap-2 text-[13px]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={gpxShared}
                disabled={savingShare}
                onChange={(event) => void handleShareToggle(event.target.checked)}
                style={{ accentColor: 'var(--red)' }}
              />
              Allow other members to download this GPX
            </label>
          )}
        </div>

        {actionError && (
          <p className="text-[13px]" style={{ color: 'var(--red)' }} role="status">
            {actionError}
          </p>
        )}
      </header>

      {mapConfig.hasKey ? (
        <RouteMap
          segments={displayRoute.segments}
          bounds={route.bounds}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          styleUrl={mapConfig.styleUrl}
          terrainUrl={mapConfig.terrainUrl}
          hasKey={mapConfig.hasKey}
        />
      ) : (
        <RouteFallback
          segments={displayRoute.segments}
          selectedIndex={selectedIndex}
        />
      )}

      <RouteElevation
        points={flatPoints}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        hasElevation={displayRoute.hasElevation}
        source={elevationSource}
      />

      <p className="text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
        Tap the map or drag the chart to inspect a point.
      </p>

      {selectedPoint && (
        <section
          className="px-4 py-3"
          style={cardStyle}
          aria-label="Selected point"
        >
          <h2
            className="text-[11px] font-medium uppercase tracking-[0.04em]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Selected point · At {formatDistance(selectedPoint.distM)}
          </h2>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            {[
              {
                label: 'Elevation',
                value:
                  selectedPoint.ele !== null
                    ? formatElevation(selectedPoint.ele)
                    : NOT_IN_GPX,
              },
              {
                label: 'Speed',
                value:
                  selectedPoint.speedKph !== null
                    ? formatSpeed(selectedPoint.speedKph)
                    : NOT_IN_GPX,
              },
              {
                label: 'Gradient',
                value:
                  selectedPoint.gradientPct !== null
                    ? formatGradient(selectedPoint.gradientPct)
                    : NOT_IN_GPX,
              },
            ].map((entry) => (
              <div key={entry.label}>
                <dt
                  className="text-[11px] uppercase tracking-[0.04em]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {entry.label}
                </dt>
                <dd
                  className="num text-[14px] font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

export default RoutePageClient;
