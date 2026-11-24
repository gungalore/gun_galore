'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeedRoute, FeedRoutePoint } from '../../lib/community-api';
import {
  buildRouteGeoJSON,
  buildSelectedPointGeoJSON,
  flattenRoute,
  nearestPointIndex,
} from '../../lib/feed-route';
import {
  ROUTE_CASING_COLOR,
  ROUTE_CASING_LAYER_ID,
  ROUTE_HIT_LAYER_ID,
  ROUTE_LINE_COLOR,
  ROUTE_LINE_LAYER_ID,
  ROUTE_POINT_LAYER_ID,
  ROUTE_POINT_SOURCE_ID,
  ROUTE_SOURCE_ID,
  TERRAIN_EXAGGERATION,
  TERRAIN_SOURCE_ID,
  prefersReducedMotion,
  readRouteMapConfig,
} from '../../lib/route-map-config';
import { RouteFallback, type RouteFallbackReason } from './route-fallback';

export interface RouteMapProps {
  segments: FeedRoutePoint[][];
  bounds: FeedRoute['bounds'];
  /** Index into the flattened route. */
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** MapTiler style URL. Omitted -> read from the build-time env. */
  styleUrl?: string;
  /** MapTiler raster-dem template URL. Omitted -> read from the build-time env. */
  terrainUrl?: string;
  /** False when the MapTiler key is unset: render the static fallback, no GL. */
  hasKey?: boolean;
  className?: string;
}

/** 2D pitch. The reference view of a route is top-down. */
const PITCH_2D = 0;
/** 3D pitch. Enough tilt to read the terrain, not a bird's-eye floor plan. */
const PITCH_3D = 60;
const CAMERA_DURATION_MS = 900;

interface GeoJSONLikeSource {
  setData?: (data: unknown) => void;
}

interface MapClickEvent {
  lngLat?: { lat: number; lng: number };
}

interface MapErrorEvent {
  sourceId?: string;
  error?: unknown;
}

/**
 * MapLibre v5 puts `sourceId` on tile errors; v6 removed it from the typed
 * event, so the DEM URL/message is also checked. A `raster-dem` source only
 * requests tiles once 3D is switched on, which makes that marker unambiguous:
 * nothing else on this map ever touches a terrain-rgb tile.
 */
const TERRAIN_ERROR_PATTERN = /terrain-rgb/i;

/** How long to wait for the style before replacing a blank map with the sketch. */
const STYLE_TIMEOUT_MS = 12_000;

/**
 * The interactive route map. Client-only and loaded through `next/dynamic`
 * (ssr:false) by the viewer — MapLibre touches `window`/WebGL at import time
 * and must never reach a server component.
 *
 * Three failure paths all end in the static sketch rather than a blank box:
 * no MapTiler key (the chunk is not even loaded), the constructor throwing
 * (no WebGL / blocked context), and a style error before the style loads.
 * A TERRAIN tile error is narrower: the 2D map stays, 3D is disabled and says
 * so, because losing the DEM tiles should not cost the member the route.
 */
export function RouteMap({
  segments,
  bounds,
  selectedIndex,
  onSelect,
  styleUrl,
  terrainUrl,
  hasKey,
  className,
}: RouteMapProps) {
  const envConfig = useMemo(() => readRouteMapConfig(), []);
  const resolvedHasKey = hasKey ?? envConfig.hasKey;
  const resolvedStyleUrl = styleUrl ?? envConfig.styleUrl;
  const resolvedTerrainUrl = terrainUrl ?? envConfig.terrainUrl;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleReadyRef = useRef(false);
  const selectedRef = useRef(selectedIndex);
  const flatPoints = useMemo(() => flattenRoute({ segments }), [segments]);
  const flatRef = useRef(flatPoints);
  const onSelectRef = useRef(onSelect);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<RouteFallbackReason>(null);
  const [terrainUnavailable, setTerrainUnavailable] = useState(false);
  const [is3D, setIs3D] = useState(false);

  useEffect(() => {
    flatRef.current = flatPoints;
  }, [flatPoints]);

  useEffect(() => {
    selectedRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!resolvedHasKey) return;
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let removed = false;
    let map: MapLibreMap | null = null;
    let styleTimer: number | null = null;

    const clearStyleTimer = () => {
      if (styleTimer !== null) {
        window.clearTimeout(styleTimer);
        styleTimer = null;
      }
    };

    const fail = (reason: Exclude<RouteFallbackReason, null> = 'error') => {
      if (disposed) return;
      disposed = true;
      clearStyleTimer();
      const current = map;
      map = null;
      mapRef.current = null;
      styleReadyRef.current = false;
      if (current) {
        removed = true;
        try {
          current.remove();
        } catch {
          // Nothing else to do: the map is unusable either way.
        }
      }
      setFailureReason(reason);
      setFailed(true);
    };

    // MapLibre v6 requires WebGL2; v5 also works on WebGL1. Probe before
    // constructing so a browser without any WebGL gets a clear reason instead
    // of a blank card (and so the sketch is selected without a 12 s wait).
    // jsdom defines neither constructor, so tests skip the probe and exercise
    // the mocked Map instead.
    const hasWebGL =
      typeof WebGL2RenderingContext !== 'undefined' ||
      typeof WebGLRenderingContext !== 'undefined';
    if (hasWebGL) {
      try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
        if (!gl) {
          fail('webgl');
          return;
        }
      } catch {
        fail('webgl');
        return;
      }
    }

    try {
      map = new MapLibreMap({
        container,
        style: resolvedStyleUrl,
        bounds: [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        fitBoundsOptions: { padding: 32, duration: 0 },
        attributionControl: false,
        scrollZoom: false,
        maxPitch: 85,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      fail(/webgl|gpu/i.test(message) ? 'webgl' : 'error');
      return;
    }

    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 100 }), 'bottom-left');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    // A style that never finishes (worker boot failure, a hung request) must
    // not leave a blank 360 px box forever. Tile/glyph errors are ignored; only
    // a style failure or this timeout replaces the map.
    styleTimer = window.setTimeout(() => {
      if (!styleReadyRef.current) fail('error');
    }, STYLE_TIMEOUT_MS);

    const onLoad = () => {
      if (disposed || !map) return;
      clearStyleTimer();
      try {
        map.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: buildRouteGeoJSON(segments),
        });
        map.addSource(ROUTE_POINT_SOURCE_ID, {
          type: 'geojson',
          data: buildSelectedPointGeoJSON(
            flatRef.current[selectedRef.current] ?? null,
            selectedRef.current,
          ),
        });

        // ⚠️ WIDER-THAN-THE-LINE HIT LAYER, transparent on purpose. The route
        // is 2px; asking a thumb to hit 2px is not a hit test, it is luck. The
        // click handler measures to the nearest POINT rather than querying this
        // layer, so the layer only widens the visual hover target.
        map.addLayer({
          id: ROUTE_HIT_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#000000', 'line-width': 24, 'line-opacity': 0.001 },
        });
        // Casing first (4px white), then the 2px Outdoor Red line on top.
        map.addLayer({
          id: ROUTE_CASING_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ROUTE_CASING_COLOR,
            'line-width': 4,
            'line-opacity': 0.85,
          },
        });
        map.addLayer({
          id: ROUTE_LINE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ROUTE_LINE_COLOR, 'line-width': 2 },
        });
        map.addLayer({
          id: ROUTE_POINT_LAYER_ID,
          type: 'circle',
          source: ROUTE_POINT_SOURCE_ID,
          paint: {
            'circle-radius': 5,
            'circle-color': ROUTE_LINE_COLOR,
            'circle-stroke-color': ROUTE_CASING_COLOR,
            'circle-stroke-width': 2,
          },
        });

        // The DEM is a source, not a terrain: `setTerrain` is only called by
        // the toggle, so the default view stays 2D and no DEM tiles are
        // fetched until somebody asks for 3D.
        map.addSource(TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          tiles: [resolvedTerrainUrl],
          encoding: 'mapbox',
          tileSize: 256,
          maxzoom: 12,
        });

        styleReadyRef.current = true;
        setReady(true);
      } catch {
        fail();
      }
    };

    const onClick = (event: MapClickEvent) => {
      if (disposed || !event?.lngLat) return;
      const index = nearestPointIndex(
        flatRef.current,
        event.lngLat.lat,
        event.lngLat.lng,
      );
      if (index >= 0) onSelectRef.current(index);
    };

    const onError = (event: MapErrorEvent) => {
      if (disposed) return;
      const error =
        typeof event?.error === 'object' && event.error !== null
          ? (event.error as {
              message?: unknown;
              url?: unknown;
              status?: unknown;
            })
          : {};
      const detail = `${String(error.message ?? '')} ${String(error.url ?? '')}`;
      if (event?.sourceId === TERRAIN_SOURCE_ID || TERRAIN_ERROR_PATTERN.test(detail)) {
        // DEM unavailable: keep the 2D map, disable the toggle, tell the
        // member. Losing hills should not lose the route.
        setTerrainUnavailable(true);
        setIs3D(false);
        try {
          map?.setTerrain(null);
        } catch {
          // Already 2D.
        }
        return;
      }

      // Log enough to diagnose a failed map, but never the browser key.
      const safeDetail = detail.replace(/([?&]key=)[^&\s]+/g, '$1REDACTED');
      console.error('[community-route-map]', safeDetail);
      if (styleReadyRef.current) return; // A tile/sprite/glyph miss is not fatal.

      const status = typeof error.status === 'number' ? error.status : null;
      if (
        /style\.json/i.test(detail) ||
        status === 401 ||
        status === 403 ||
        /webgl|gpu|worker/i.test(detail)
      ) {
        fail(/webgl|gpu|worker/i.test(detail) ? 'webgl' : 'style');
      }
      // Anything else is left to the style timeout, so one missing tile cannot
      // replace a working 2D map with the sketch.
    };

    map.on('load', onLoad);
    map.on('click', onClick);
    map.on('error', onError);

    return () => {
      disposed = true;
      clearStyleTimer();
      const current = map;
      map = null;
      mapRef.current = null;
      styleReadyRef.current = false;
      if (current && !removed) {
        removed = true;
        try {
          current.remove();
        } catch {
          // Unmount cleanup must never throw.
        }
      }
    };
    // `segments` is intentionally NOT a dependency: the source is created once
    // on load, and re-adding it on every parent render would leak layers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resolvedHasKey,
    resolvedStyleUrl,
    resolvedTerrainUrl,
    bounds.south,
    bounds.west,
    bounds.north,
    bounds.east,
  ]);

  // Move the selected marker without rebuilding the map.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource(ROUTE_POINT_SOURCE_ID) as GeoJSONLikeSource | undefined;
    source?.setData?.(
      buildSelectedPointGeoJSON(flatPoints[selectedIndex] ?? null, selectedIndex),
    );
  }, [ready, selectedIndex, flatPoints]);

  const toggle3D = useCallback(() => {
    const map = mapRef.current;
    if (!map || !ready || terrainUnavailable) return;
    const next = !is3D;
    const duration = prefersReducedMotion() ? 0 : CAMERA_DURATION_MS;
    try {
      if (next) {
        map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
        map.easeTo({ pitch: PITCH_3D, bearing: 0, duration });
      } else {
        map.setTerrain(null);
        map.easeTo({ pitch: PITCH_2D, bearing: 0, duration });
      }
      setIs3D(next);
    } catch {
      setTerrainUnavailable(true);
      setIs3D(false);
      try {
        map.setTerrain(null);
      } catch {
        // Already 2D.
      }
    }
  }, [is3D, ready, terrainUnavailable]);

  if (!resolvedHasKey || failed || flatPoints.length === 0) {
    return (
      <RouteFallback
        segments={segments}
        selectedIndex={selectedIndex}
        reason={failed ? failureReason : null}
        className={className}
      />
    );
  }

  return (
    <section
      className={className}
      aria-label="Route map"
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <h2
          className="text-[11px] font-medium uppercase tracking-[0.04em]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Route map
        </h2>
        <div className="flex items-center gap-2">
          {terrainUnavailable && (
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              3D terrain unavailable.
            </span>
          )}
          <button
            type="button"
            onClick={toggle3D}
            disabled={!ready || terrainUnavailable}
            aria-pressed={is3D}
            className="gg-press rounded-[6px] px-3 py-1 text-[12px] font-medium disabled:opacity-50"
            style={{
              background: is3D ? 'var(--action-primary-bg)' : 'var(--bg-card)',
              color: is3D ? '#fff' : 'var(--text-primary)',
              border: '1px solid var(--border-visible)',
            }}
          >
            {is3D ? '2D map' : '3D terrain'}
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        data-testid="route-map-canvas"
        style={{ height: 360, width: '100%' }}
      />
    </section>
  );
}

export default RouteMap;
