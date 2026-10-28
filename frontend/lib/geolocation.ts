'use client';

// Geolocation helpers.
//
// The browser owns the permission record: once a member taps Allow, the
// origin is remembered and `getCurrentPosition` no longer prompts. The site
// cannot make that permanent itself.
//
// What we can do is stop *asking passively*. `ListingDistance` runs on every
// listing page, and calling `getCurrentPosition` while the permission is still
// `prompt` makes the browser show the "Share my location?" bubble again on
// every visit. Passive callers must use `getGrantedPosition`: it reads the
// Permissions API first and does nothing unless the browser already says
// granted. Explicit "use my current location" buttons keep calling
// `getCurrentPosition` directly, because that is a user gesture and a prompt
// there is expected.

export type GeolocationPermission = PermissionState | 'unsupported';

export async function getGeolocationPermission(): Promise<GeolocationPermission> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'unsupported';
  }
  try {
    if (!navigator.permissions?.query) return 'unsupported';
    const status = await navigator.permissions.query({
      name: 'geolocation',
    });
    return status.state;
  } catch {
    // Safari has historically thrown for the geolocation descriptor. Treat it
    // as unknown rather than risking a passive prompt.
    return 'unsupported';
  }
}

export function getCurrentPosition(
  options?: PositionOptions,
): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      () => resolve(null),
      options,
    );
  });
}

/**
 * Passive lookup. Never prompts: returns null unless permission is already
 * granted. Use this for background/enrichment reads such as the listing
 * distance chip.
 */
export async function getGrantedPosition(
  options?: PositionOptions,
): Promise<GeolocationPosition | null> {
  const permission = await getGeolocationPermission();
  if (permission !== 'granted') return null;
  return getCurrentPosition(options);
}
