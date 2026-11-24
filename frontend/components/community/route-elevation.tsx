'use client';

import { useId, useRef } from 'react';
import {
  NOT_IN_GPX,
  buildElevationGeometry,
  formatDistance,
  formatElevation,
  type ElevationGeometry,
} from '../../lib/feed-route';

export interface RouteElevationProps {
  /** Flattened route points in GPX order. */
  points: ReadonlyArray<{ distM: number; ele: number | null }>;
  /** Index into `points` of the inspected point. */
  selectedIndex: number;
  onSelect: (index: number) => void;
  hasElevation: boolean;
  /** Where the heights came from. Terrain is MapTiler's DEM, not the GPX. */
  source?: 'terrain' | 'gpx' | 'none';
}

function clampSelection(index: number, length: number): number {
  if (!Number.isFinite(index) || length === 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.trunc(index)));
}

/** The geometry point that best represents `selectedIndex`. */
function selectedGeometryPoint(
  geometry: ElevationGeometry,
  selectedIndex: number,
): ElevationGeometry['points'][number] | null {
  if (!geometry.points.length) return null;
  const exact = geometry.points.find((p) => p.index === selectedIndex);
  if (exact) return exact;
  // The selected point can have no elevation (a gap); stand on the closest
  // sample before it rather than leaving the crosshair off the chart.
  let best = geometry.points[0];
  let bestGap = Infinity;
  for (const point of geometry.points) {
    const gap = Math.abs(point.index - selectedIndex);
    if (gap < bestGap) {
      bestGap = gap;
      best = point;
    }
  }
  return best;
}

/**
 * The elevation profile under the map. An SVG area chart plus a range input:
 * the SVG gives the shape, the range input is the accessible control (keyboard
 * and screen readers have no way to drag an SVG path), and pointer events on
 * the chart select the nearest sample so tapping the profile does what it
 * looks like it should.
 */
export function RouteElevation({
  points,
  selectedIndex,
  onSelect,
  hasElevation,
  source = 'none',
}: RouteElevationProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rangeId = `route-elevation-${useId().replace(/:/g, '')}`;

  const geometry = hasElevation ? buildElevationGeometry(points) : null;
  const selected = clampSelection(selectedIndex, points.length);
  const selectedPoint = points[selected] ?? null;
  const marker = geometry ? selectedGeometryPoint(geometry, selected) : null;

  const valueText = selectedPoint
    ? [
        formatDistance(selectedPoint.distM),
        selectedPoint.ele === null
          ? `${NOT_IN_GPX} (elevation)`
          : formatElevation(selectedPoint.ele),
      ].join(' · ')
    : '';
  const totalDistanceM = points[points.length - 1]?.distM ?? 0;
  const selectedDistanceM = selectedPoint?.distM ?? 0;

  // ⚠️ THE SLIDER IS DISTANCE-BASED, NOT INDEX-BASED. The chart's crosshair is
  // placed by cumulative distance; an index-valued range input puts its thumb
  // by point count, so on an unevenly spaced track the thumb and the crosshair
  // visibly disagree. Moving in metres makes the two agree.
  function selectNearestDistance(targetM: number) {
    if (!points.length) return;
    let best = points[0];
    let bestGap = Infinity;
    for (const point of points) {
      const gap = Math.abs(point.distM - targetM);
      if (gap < bestGap) {
        bestGap = gap;
        best = point;
      }
    }
    onSelect(points.indexOf(best));
  }

  // The range input is the accessible way to move along the route and it must
  // survive a GPX with no elevation: speed and gradient can still be inspected
  // there, and the map-fallback view may have no other selection control.
  //
  // ⚠️ THE VALUE TEXT IS NOT BESIDE THE INPUT. It used to share a flex row, so
  // the input was narrower than the chart above it while the chart crosshair
  // still used the full width — the thumb and dot drifted apart the further
  // along the route you went. The text now sits on its own row, leaving the
  // range input exactly as wide as the chart.
  const rangeControl = points.length > 0 && (
    <>
      <label htmlFor={rangeId} className="sr-only">
        Route point
      </label>
      <input
        id={rangeId}
        type="range"
        min={0}
        max={Math.max(1, Math.round(totalDistanceM))}
        step={1}
        value={Math.round(selectedDistanceM)}
        onChange={(event) => selectNearestDistance(Number(event.target.value))}
        aria-label="Route point"
        aria-valuetext={valueText}
        className="mt-2 block w-full"
        style={{ accentColor: 'var(--red)', margin: 0, padding: 0 }}
      />
      <div className="mt-1 flex justify-end">
        <p
          className="num text-[11px]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Selected: {formatDistance(selectedPoint?.distM ?? 0)}
          {' · '}
          {selectedPoint && selectedPoint.ele !== null
            ? formatElevation(selectedPoint.ele)
            : NOT_IN_GPX}
        </p>
      </div>
    </>
  );

  if (!hasElevation || !geometry) {
    return (
      <section
        className="gg-tile rounded-[8px] px-4 py-3"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
        aria-label="Elevation profile"
      >
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          {source === 'gpx'
            ? 'No elevation data in this GPX.'
            : 'No elevation data for this route.'}
        </p>
        {rangeControl}
      </section>
    );
  }

  const markerLeftPct = marker ? (marker.x / geometry.width) * 100 : 0;
  const markerTopPct = marker ? (marker.y / geometry.height) * 100 : 50;

  function selectNearest(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const targetX = fraction * geometry!.width;
    let best = geometry!.points[0];
    let bestGap = Infinity;
    for (const point of geometry!.points) {
      const gap = Math.abs(point.x - targetX);
      if (gap < bestGap) {
        bestGap = gap;
        best = point;
      }
    }
    if (best) onSelect(best.index);
  }

  return (
    <section
      className="gg-tile rounded-[8px] px-4 py-3"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
      aria-label="Elevation profile"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="text-[11px] font-medium uppercase tracking-[0.04em]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Elevation
          {source === 'terrain'
            ? ' · MapTiler terrain'
            : source === 'gpx'
              ? ' · GPX'
              : ''}
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          max <span style={{ color: 'var(--text-secondary)' }}>{formatElevation(geometry.maxEle)}</span>
          {' · '}
          min <span style={{ color: 'var(--text-secondary)' }}>{formatElevation(geometry.minEle)}</span>
        </p>
      </div>

      <div
        className="relative mt-2"
        style={{ height: 140 }}
        // The whole strip is the hit target, not just the 1.5px line.
        data-testid="route-elevation-chart"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Route elevation profile: ${formatElevation(
            geometry.minEle,
          )} to ${formatElevation(geometry.maxEle)} over ${formatDistance(
            points[points.length - 1]?.distM ?? 0,
          )}.`}
          style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            selectNearest(event.clientX);
          }}
          onPointerMove={(event) => {
            // Hover (mouse) and drag (touch/pen) both inspect; a drag on a
            // touch profile is the only way to move along it.
            if (event.pointerType === 'mouse' || event.buttons > 0) {
              selectNearest(event.clientX);
            }
          }}
        >
          {[25, 50, 75].map((pct) => (
            <line
              key={pct}
              x1={0}
              x2={geometry.width}
              y1={(pct / 100) * geometry.height}
              y2={(pct / 100) * geometry.height}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: 'var(--border-divider)' }}
            />
          ))}
          <path d={geometry.areaPath} style={{ fill: 'var(--red-wash)' }} />
          <path
            d={geometry.linePath}
            fill="none"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ stroke: 'var(--red)' }}
          />
        </svg>

        {/* Crosshair and dot are HTML so they stay round and crisp even though
            the SVG stretches its viewBox to the strip's real aspect ratio. */}
        {marker && (
          <>
            <div
              aria-hidden="true"
              data-testid="route-elevation-crosshair"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${markerLeftPct}%`,
                width: 1,
                background: 'var(--border-hover)',
              }}
            />
            <div
              aria-hidden="true"
              data-testid="route-elevation-dot"
              style={{
                position: 'absolute',
                left: `${markerLeftPct}%`,
                top: `${markerTopPct}%`,
                width: 9,
                height: 9,
                borderRadius: 9999,
                background: 'var(--action-primary-bg)',
                border: '2px solid var(--bg-card)',
                transform: 'translate(-50%, -50%)',
              }}
            />
          </>
        )}
      </div>

      {rangeControl}
    </section>
  );
}

export default RouteElevation;
