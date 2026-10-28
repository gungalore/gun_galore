// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentPosition,
  getGeolocationPermission,
  getGrantedPosition,
} from './geolocation';

function installGeolocation(
  state: PermissionState | 'unsupported',
  getCurrentPosition = vi.fn(),
) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value:
      state === 'unsupported'
        ? undefined
        : {
            query: vi.fn().mockResolvedValue({ state }),
          },
  });
  return getCurrentPosition;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('geolocation permission helpers', () => {
  it('reports unsupported when the device has no geolocation API', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });
    expect(await getGeolocationPermission()).toBe('unsupported');
  });

  it('reports the browser permission state', async () => {
    installGeolocation('granted');
    expect(await getGeolocationPermission()).toBe('granted');
  });

  it('does not call getCurrentPosition while permission is still prompt', async () => {
    const get = installGeolocation('prompt');

    await expect(getGrantedPosition()).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('does not call getCurrentPosition after a denial', async () => {
    const get = installGeolocation('denied');

    await expect(getGrantedPosition()).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('reuses an already-granted permission without prompting', async () => {
    const position = {
      coords: { latitude: -26, longitude: 28 },
    } as GeolocationPosition;
    const get = installGeolocation('granted');
    get.mockImplementation((ok: PositionCallback) => ok(position));

    await expect(getGrantedPosition()).resolves.toBe(position);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('treats an unavailable Permissions API as unknown, not granted', async () => {
    const get = installGeolocation('unsupported');

    await expect(getGrantedPosition()).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('resolves null instead of throwing when the position lookup fails', async () => {
    const get = installGeolocation('granted');
    get.mockImplementation(
      (_ok: PositionCallback, fail?: PositionErrorCallback) =>
        fail?.({ code: 3 } as GeolocationPositionError),
    );

    await expect(getCurrentPosition()).resolves.toBeNull();
  });
});
