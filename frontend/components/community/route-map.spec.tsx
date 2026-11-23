// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeedRoute, FeedRoutePoint } from '../../lib/community-api';
import { maptilerStyleUrl, maptilerTerrainUrl } from '../../lib/route-map-config';

/**
 * ⚠️ NO REAL WEBGL IN JSDOM. The map module is replaced wholesale with a fake
 * that records construction, sources, layers, terrain and camera calls. The
 * assertions are about the arguments the component passes, which is where the
 * bugs live (wrong source id, terrain never set, click mapped to the wrong
 * point) — not about pixels.
 */
const fake = vi.hoisted(() => ({
  instances: [] as FakeMap[],
  throwOnConstruct: false,
}));

interface FakeMap {
  options: Record<string, unknown>;
  handlers: Map<string, Array<(event?: unknown) => void>>;
  sources: Map<string, { setData: ReturnType<typeof vi.fn> } & Record<string, unknown>>;
  layers: Array<Record<string, unknown>>;
  controls: Array<{ control: unknown; position?: string }>;
  terrainCalls: unknown[];
  easeCalls: Array<Record<string, unknown>>;
  removed: boolean;
  fire(type: string, event?: unknown): void;
}

vi.mock('maplibre-gl', () => {
  class MockMap {
    options: Record<string, unknown>;
    handlers: Map<string, Array<(event?: unknown) => void>> = new Map();
    sources: Map<string, { setData: ReturnType<typeof vi.fn> } & Record<string, unknown>> =
      new Map();
    layers: Array<Record<string, unknown>> = [];
    controls: Array<{ control: unknown; position?: string }> = [];
    terrainCalls: unknown[] = [];
    easeCalls: Array<Record<string, unknown>> = [];
    removed = false;

    constructor(options: Record<string, unknown>) {
      if (fake.throwOnConstruct) throw new Error('WebGL context unavailable');
      this.options = options;
      fake.instances.push(this as unknown as FakeMap);
    }

    on(type: string, handler: (event?: unknown) => void) {
      const list = this.handlers.get(type) ?? [];
      list.push(handler);
      this.handlers.set(type, list);
      return this;
    }

    once(type: string, handler: (event?: unknown) => void) {
      return this.on(type, handler);
    }

    off() {
      return this;
    }

    addControl(control: unknown, position?: string) {
      this.controls.push({ control, position });
      return this;
    }

    addSource(id: string, source: Record<string, unknown>) {
      this.sources.set(id, { ...source, setData: vi.fn() });
      return this;
    }

    addLayer(layer: Record<string, unknown>) {
      this.layers.push(layer);
      return this;
    }

    getSource(id: string) {
      return this.sources.get(id);
    }

    setTerrain(terrain: unknown) {
      this.terrainCalls.push(terrain);
      return this;
    }

    easeTo(options: Record<string, unknown>) {
      this.easeCalls.push(options);
      return this;
    }

    fitBounds() {
      return this;
    }

    isStyleLoaded() {
      return true;
    }

    remove() {
      this.removed = true;
      return this;
    }

    fire(type: string, event?: unknown) {
      for (const handler of this.handlers.get(type) ?? []) handler(event);
    }
  }

  class MockControl {
    constructor(readonly options?: unknown) {}
  }

  return {
    Map: MockMap,
    MapLibreMap: MockMap,
    NavigationControl: MockControl,
    ScaleControl: MockControl,
    AttributionControl: MockControl,
    LngLatBounds: class {},
  };
});

import { RouteMap } from './route-map';

const segments: FeedRoutePoint[][] = [
  [
    { lat: -30.0, lon: 18.0, ele: 100, speedKph: 4, gradientPct: 2, distM: 0 },
    { lat: -30.01, lon: 18.01, ele: 200, speedKph: 5, gradientPct: 4, distM: 1000 },
    { lat: -30.02, lon: 18.02, ele: 150, speedKph: 6, gradientPct: -3, distM: 2000 },
  ],
];
const bounds: FeedRoute['bounds'] = { south: -30.02, west: 18, north: -30, east: 18.02 };
const styleUrl = maptilerStyleUrl('test-key', 'bright-v2');
const terrainUrl = maptilerTerrainUrl('test-key');

function renderMap(overrides: Partial<ComponentProps<typeof RouteMap>> = {}) {
  const onSelect = vi.fn();
  render(
    <RouteMap
      segments={segments}
      bounds={bounds}
      selectedIndex={0}
      onSelect={onSelect}
      styleUrl={styleUrl}
      terrainUrl={terrainUrl}
      hasKey
      {...overrides}
    />,
  );
  return { onSelect };
}

function lastMap(): FakeMap {
  return fake.instances[fake.instances.length - 1];
}

/**
 * MapLibre fires `load` asynchronously in the real world; here the fake is
 * driven by hand, so the state update it causes must be wrapped in act() or
 * the next click sees the pre-load (not ready) callback.
 */
function loadMap() {
  act(() => {
    lastMap().fire('load');
  });
}

beforeEach(() => {
  fake.instances.length = 0;
  fake.throwOnConstruct = false;
});

describe('RouteMap', () => {
  it('renders the static fallback, and never constructs a map, without a key', () => {
    renderMap({ hasKey: false, styleUrl: undefined, terrainUrl: undefined });
    expect(screen.getByText('Map unavailable — route shape only.')).toBeTruthy();
    expect(fake.instances).toHaveLength(0);
  });

  it('hands MapLibre the style URL carrying the MapTiler key and style', () => {
    renderMap();
    expect(fake.instances).toHaveLength(1);
    const style = String(lastMap().options.style);
    expect(style).toContain('api.maptiler.com/maps/bright-v2/style.json');
    expect(style).toContain('key=test-key');
    // Not a scrolling page trap, and pitched views allowed for 3D.
    expect(lastMap().options.scrollZoom).toBe(false);
    expect(lastMap().options.maxPitch).toBe(85);
  });

  it('adds the route sources and the white casing + red line layers on load', () => {
    renderMap();
    loadMap();
    const map = lastMap();
    expect(map.sources.has('community-route')).toBe(true);
    const layerIds = map.layers.map((layer) => layer.id);
    expect(layerIds).toContain('community-route-hit');
    expect(layerIds).toContain('community-route-casing');
    expect(layerIds).toContain('community-route-line');
    expect(layerIds).toContain('community-route-selected-point');
    const line = map.layers.find((layer) => layer.id === 'community-route-line');
    expect(
      (line?.paint as Record<string, unknown>)['line-color'],
    ).toBe('#E30613');
    const casing = map.layers.find((layer) => layer.id === 'community-route-casing');
    expect((casing?.paint as Record<string, unknown>)['line-color']).toBe('#FFFFFF');
    expect(map.sources.has('maptiler-dem')).toBe(true);
  });

  it('toggles 3D terrain on and off through MapLibre terrain and camera', async () => {
    renderMap();
    loadMap();

    fireEvent.click(screen.getByRole('button', { name: '3D terrain' }));
    expect(lastMap().terrainCalls).toContainEqual({
      source: 'maptiler-dem',
      exaggeration: 1.2,
    });
    expect(lastMap().easeCalls.at(-1)).toMatchObject({ pitch: 60, bearing: 0 });

    fireEvent.click(screen.getByRole('button', { name: '2D map' }));
    expect(lastMap().terrainCalls.at(-1)).toBeNull();
    expect(lastMap().easeCalls.at(-1)).toMatchObject({ pitch: 0, bearing: 0 });
  });

  it('selects the nearest route point when the map is clicked', () => {
    const { onSelect } = renderMap();
    loadMap();
    lastMap().fire('click', { lngLat: { lat: -30.019, lng: 18.019 } });
    expect(onSelect).toHaveBeenCalledWith(2);
    lastMap().fire('click', { lngLat: { lat: -30.009, lng: 18.009 } });
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });

  it('falls back when the MapLibre constructor throws (no WebGL)', async () => {
    fake.throwOnConstruct = true;
    renderMap();
    await waitFor(() =>
      expect(
        screen.getByText(
          'This browser could not start WebGL, so the 3D map is unavailable. Enable hardware acceleration or try another browser.',
        ),
      ).toBeTruthy(),
    );
    // The sketch still shows where the selected point is.
    expect(screen.getByTestId('route-fallback-selected')).toBeTruthy();
  });

  it('keeps 2D, disables 3D and says so when the terrain tiles fail', async () => {
    renderMap();
    loadMap();
    lastMap().fire('error', {
      error: {
        message: 'Failed to load tile',
        url: 'https://api.maptiler.com/tiles/terrain-rgb-v2/12/2048/2048.webp?key=test-key',
      },
    });

    await waitFor(() =>
      expect(screen.getByText('3D terrain unavailable.')).toBeTruthy(),
    );
    expect((screen.getByRole('button', { name: '3D terrain' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // The 2D map is still there.
    expect(screen.getByTestId('route-map-canvas')).toBeTruthy();
  });
});
