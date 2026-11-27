// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const geolocation = vi.hoisted(() => ({ getGrantedPosition: vi.fn() }));
vi.mock('@/lib/geolocation', () => ({
  getGrantedPosition: geolocation.getGrantedPosition,
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ getToken: async () => null }),
}));

import {
  DistanceProvider,
  distanceBatchKey,
  useDistanceKm,
} from '@/lib/distance-context';

function Probe({ id }: { id: string }) {
  const km = useDistanceKm(id);
  return <span data-testid={`d-${id}`}>{km == null ? 'none' : `${km}km`}</span>;
}

// ⚠️ ONE LOCATION READ, ONE BATCH REQUEST, MANY CARDS. This pins the batching
// contract every listing surface relies on: duplicates collapse, the ids go up
// in one POST, the response fills every badge, and a page with no cards makes no
// request at all.
describe('the distance provider', () => {
  beforeEach(() => {
    geolocation.getGrantedPosition.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reads the location once and batch-fetches every card id', async () => {
    geolocation.getGrantedPosition.mockResolvedValue({
      coords: { latitude: -33.9, longitude: 18.4 },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ distances: { a: 150, b: 10 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DistanceProvider ids={['a', 'a', 'b']}>
        <Probe id="a" />
        <Probe id="b" />
      </DistanceProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('d-a').textContent).toBe('150km'),
    );
    expect(screen.getByTestId('d-b').textContent).toBe('10km');
    expect(geolocation.getGrantedPosition).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/listings/distances');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      ids: ['a', 'b'],
      lat: -33.9,
      lng: 18.4,
    });
  });

  it('makes no request at all on a page with no cards', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DistanceProvider ids={[]}>
        <span>nothing here</span>
      </DistanceProvider>,
    );
    await Promise.resolve();

    expect(geolocation.getGrantedPosition).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides every badge when the endpoint is not live yet (404)', async () => {
    geolocation.getGrantedPosition.mockResolvedValue({
      coords: { latitude: -33.9, longitude: 18.4 },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    render(
      <DistanceProvider ids={['a']}>
        <Probe id="a" />
      </DistanceProvider>,
    );

    await waitFor(() =>
      expect(geolocation.getGrantedPosition).toHaveBeenCalled(),
    );
    // Nothing to resolve and nothing crashes: the badge self-hides.
    expect(screen.getByTestId('d-a').textContent).toBe('none');
  });
});

describe('distanceBatchKey', () => {
  it('de-duplicates, sorts and empties cleanly', () => {
    expect(distanceBatchKey(['b', 'a', 'b'])).toBe('a,b');
    expect(distanceBatchKey([])).toBe('');
    expect(distanceBatchKey(null)).toBe('');
    expect(distanceBatchKey(['', 'x'])).toBe('x');
  });
});
