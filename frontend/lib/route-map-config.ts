// MapTiler configuration for the community route map, kept out of the MapLibre
// component on purpose: `route-page-client` needs the key/style decisions
// BEFORE it decides whether to load the MapLibre chunk at all. Importing this
// helper must never pull `maplibre-gl` into a bundle.
//
// ⚠️ BOTH ENV VARS ARE `NEXT_PUBLIC_*`, so Next inlines them at BUILD time.
// Reading them through a function is still inlined (the expression is
// `process.env.NEXT_PUBLIC_MAPTILER_KEY`, not a dynamic lookup); adding a key
// to a running server without a rebuild does nothing. See docs/ENVIRONMENT.md.
//
// ⚠️ THE ROUTE LINE IS OUTDOOR RED (#E30613, --red-500), NOT --red. In the
// white theme --red is the veld-ochre UI accent; a route drawn in it would
// disappear against MapTiler's terrain at 2px. WebGL paint cannot read CSS
// custom properties, so the one data colour is named here rather than being
// scattered through the layer definitions. DOM surfaces use var(--red-500),
// which is the same value.

export const MAPTILER_STYLE_DEFAULT = 'outdoor-v2';

/** Brand Outdoor Red — matches globals.css --red-500. */
export const ROUTE_LINE_COLOR = '#E30613';

/** White casing under the red line, the usual map-route treatment. */
export const ROUTE_CASING_COLOR = '#FFFFFF';

/** ids shared by the map sources/layers and by the specs. */
export const ROUTE_SOURCE_ID = 'community-route';
export const ROUTE_HIT_LAYER_ID = 'community-route-hit';
export const ROUTE_CASING_LAYER_ID = 'community-route-casing';
export const ROUTE_LINE_LAYER_ID = 'community-route-line';
export const ROUTE_POINT_SOURCE_ID = 'community-route-selected';
export const ROUTE_POINT_LAYER_ID = 'community-route-selected-point';
export const TERRAIN_SOURCE_ID = 'maptiler-dem';
export const TERRAIN_EXAGGERATION = 1.2;

export function maptilerStyleUrl(key: string, style: string = MAPTILER_STYLE_DEFAULT): string {
  return `https://api.maptiler.com/maps/${style}/style.json?key=${key}`;
}

export function maptilerTerrainUrl(key: string): string {
  return `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${key}`;
}

export interface RouteMapConfig {
  /** The browser key, empty when unset. */
  key: string;
  /** False when the map (and its 3D toggle) must not be loaded at all. */
  hasKey: boolean;
  styleUrl: string;
  terrainUrl: string;
  style: string;
}

/** Read the build-time MapTiler env into the values the map needs. */
export function readRouteMapConfig(): RouteMapConfig {
  // Referenced literally so Next's build-time substitution sees them.
  const key = (process.env.NEXT_PUBLIC_MAPTILER_KEY ?? '').trim();
  const style =
    (process.env.NEXT_PUBLIC_MAPTILER_STYLE ?? '').trim() || MAPTILER_STYLE_DEFAULT;
  return {
    key,
    hasKey: key.length > 0,
    styleUrl: maptilerStyleUrl(key, style),
    terrainUrl: maptilerTerrainUrl(key),
    style,
  };
}

/** `prefers-reduced-motion` is honoured by the 3D camera moves. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
