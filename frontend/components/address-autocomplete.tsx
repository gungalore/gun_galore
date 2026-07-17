'use client';

import { useEffect, useRef, useState } from 'react';

// Google Places Autocomplete wrapped to fit our dark design tokens.
//
// PORT NOTE: this file is a near-verbatim port of the OLD project's
// frontend/src/components/ui/AddressAutocomplete.tsx — only the styling
// is swapped for our CSS variables and we layer a gm_authFailure handler
// on top so a bad API key no longer crashes the Next.js dev overlay.
// Do NOT "improve" the script-load / cleanup logic without going back to
// the old script first — every clever tweak we tried (removing cleanup,
// switching clearInstanceListeners(instance → input), etc.) silently
// broke the Autocomplete binding under React 18 StrictMode in dev. The
// old version worked. Keep it that way.

export interface ParsedAddressComponents {
  street?: string;
  suburb?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
}

interface Props {
  value: string;
  onChange: (address: string, placeId?: string) => void;
  onComponents?: (components: ParsedAddressComponents) => void;
  placeholder?: string;
}

// Minimal local types — avoids requiring @types/google.maps at build time.
interface AddressComponent {
  long_name: string;
  types: string[];
}
interface GGeometry {
  location?: { lat: () => number; lng: () => number };
}
interface GPlace {
  formatted_address?: string;
  place_id?: string;
  address_components?: AddressComponent[];
  geometry?: GGeometry;
}
interface GAutocomplete {
  addListener: (event: string, handler: () => void) => void;
  getPlace: () => GPlace;
}
interface GMapsEvent {
  clearInstanceListeners: (instance: unknown) => void;
}
interface GPlacesLib {
  Autocomplete: new (
    input: HTMLInputElement,
    options?: object,
  ) => GAutocomplete;
}
interface GGeocoderResult {
  formatted_address?: string;
  place_id?: string;
  address_components?: AddressComponent[];
  geometry?: GGeometry;
}
interface GGeocoder {
  geocode: (request: {
    location: { lat: number; lng: number };
  }) => Promise<{ results: GGeocoderResult[] }>;
}
interface GMapsLib {
  places?: GPlacesLib;
  event?: GMapsEvent;
  Geocoder?: new () => GGeocoder;
}
interface GWindow {
  google?: { maps?: GMapsLib };
}

// ── Singleton script loader ──────────────────────────────────────────
// Avoids re-injecting the Maps script on every component remount, which
// used to leave behind orphaned <script> tags and stale .pac-container
// dropdowns.
let mapsScriptPromise: Promise<void> | null = null;

// Global flag flipped by gm_authFailure when the user's API key is bad /
// restricted / billing disabled. Lets every AddressAutocomplete instance
// fall back to "fill manually" without crashing the dev error overlay.
let mapsAuthFailed = false;
const authFailureListeners = new Set<() => void>();

function notifyAuthFailure() {
  mapsAuthFailed = true;
  for (const fn of authFailureListeners) {
    try { fn(); } catch { /* noop */ }
  }
}

let consoleErrorPatched = false;
function patchConsoleErrorOnce() {
  if (consoleErrorPatched || typeof window === 'undefined') return;
  consoleErrorPatched = true;
  const original = window.console.error;
  window.console.error = function (...args: unknown[]) {
    const first = args[0];
    const text = typeof first === 'string' ? first : '';
    // Match ONLY the specific fatal auth-error classes. The old code also
    // matched the bare phrase 'Google Maps JavaScript API', which Google
    // prints in benign console messages too (loading-pattern + deprecation
    // notices) — that false-matched and flipped the whole widget into
    // "auth failed", hiding suggestions and disabling "use my location"
    // even though the key works fine.
    if (
      text.includes('ApiTargetBlockedMapError') ||
      text.includes('InvalidKeyMapError') ||
      text.includes('RefererNotAllowedMapError') ||
      text.includes('BillingNotEnabledMapError')
    ) {
      if (!mapsAuthFailed) {
        original.call(
          window.console,
          '[AddressAutocomplete] Google Maps disabled — address autocomplete will be unavailable. Check that your NEXT_PUBLIC_GOOGLE_MAPS_API_KEY has Maps JS + Places APIs enabled.',
        );
        notifyAuthFailure();
      }
      return;
    }
    return original.apply(window.console, args);
  };
}

function loadMapsOnce(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const w = window as GWindow;
  if (w.google?.maps?.places) return Promise.resolve();
  if (mapsScriptPromise) return mapsScriptPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return Promise.resolve();

  patchConsoleErrorOnce();
  type GMWindow = Window & { gm_authFailure?: () => void };
  (window as GMWindow).gm_authFailure = () => notifyAuthFailure();

  // Reuse existing script tag if one is already on the page
  const existing = document.querySelector<HTMLScriptElement>(
    'script[src*="maps.googleapis.com/maps/api/js"]',
  );
  if (existing) {
    mapsScriptPromise = new Promise((resolve) => {
      const check = () => {
        if ((window as GWindow).google?.maps?.places) resolve();
        else if (mapsAuthFailed) resolve();
        else setTimeout(check, 50);
      };
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => {
        notifyAuthFailure();
        resolve();
      });
      check();
    });
    return mapsScriptPromise;
  }

  mapsScriptPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      notifyAuthFailure();
      resolve();
    };
    document.head.appendChild(s);
  });
  return mapsScriptPromise;
}

function removeStalePacContainers() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.pac-container').forEach((el) => el.remove());
}

// Parse Google address_components (same shape from Places AND the Geocoder)
// into our flat ParsedAddressComponents. Shared by autocomplete-pick and
// reverse-geocode-from-GPS so both fill the form identically.
function parseAddressComponents(
  comps: AddressComponent[],
  geometry?: GGeometry,
  fallbackLat?: number,
  fallbackLng?: number,
): ParsedAddressComponents {
  const get = (type: string) =>
    comps.find((c) => c.types.includes(type))?.long_name ?? '';
  return {
    street: [get('street_number'), get('route')].filter(Boolean).join(' '),
    suburb:
      get('sublocality_level_1') || get('sublocality') || get('neighborhood'),
    city: get('locality') || get('administrative_area_level_2'),
    province: get('administrative_area_level_1'),
    postalCode: get('postal_code'),
    lat: geometry?.location?.lat() ?? fallbackLat,
    lng: geometry?.location?.lng() ?? fallbackLng,
  };
}

export function AddressAutocomplete({
  value,
  onChange,
  onComponents,
  placeholder = 'Search for address…',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<GAutocomplete | null>(null);
  const onChangeRef = useRef(onChange);
  const onComponentsRef = useRef(onComponents);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [authFailed, setAuthFailed] = useState(mapsAuthFailed);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onComponentsRef.current = onComponents; }, [onComponents]);

  // UNCONTROLLED input — sync parent's value into input.value via the
  // ref instead of through React's controlled-input value prop. React's
  // controlled-input mechanism patches the input's value getter/setter
  // to track changes, which fights Google's autocomplete listener: the
  // listener fires but reads a stale value because React's tracker is
  // ahead of the DOM. Going uncontrolled means Google sees real
  // input.value on every keystroke and fires its prediction query. We
  // still sync programmatic parent changes (e.g. after picking a
  // suggestion) by writing directly to the DOM node.
  //
  // CRITICAL — only sync when the input is NOT focused. Otherwise
  // every keystroke triggers a parent re-render → this effect →
  // overwrite of what the user is mid-typing. Symptom: the box
  // freezes after the first character, Google Places never gets
  // enough chars to fire a request, and no dropdown appears. The
  // focus check lets programmatic updates (post-pick, initial mount)
  // still flow through while keeping the user's typing untouched.
  useEffect(() => {
    if (!inputRef.current) return;
    if (document.activeElement === inputRef.current) return;
    if (inputRef.current.value !== value) {
      inputRef.current.value = value;
    }
  }, [value]);

  // Subscribe to the global auth-failure flag so we re-render to "fill
  // manually" mode the moment Maps fails.
  useEffect(() => {
    if (mapsAuthFailed) setAuthFailed(true);
    const fn = () => setAuthFailed(true);
    authFailureListeners.add(fn);
    return () => { authFailureListeners.delete(fn); };
  }, []);

  // Load the Google Maps script (once, globally)
  useEffect(() => {
    let cancelled = false;
    loadMapsOnce().then(() => {
      if (!cancelled) setScriptLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Wire up the Autocomplete widget once the script is ready.
  // VERBATIM from the old project — including the cleanup. Do not edit.
  useEffect(() => {
    if (authFailed) return;
    if (!scriptLoaded || !inputRef.current || autocompleteRef.current) return;

    const w = window as GWindow;
    const PlacesLib = w.google?.maps?.places;
    if (!PlacesLib) return;

    let autocompleteInstance: GAutocomplete | null = null;
    try {
      autocompleteInstance = new PlacesLib.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'za' },
        fields: ['formatted_address', 'place_id', 'address_components', 'geometry'],
        types: ['address'],
      });

      autocompleteInstance.addListener('place_changed', () => {
        try {
          const place = autocompleteInstance!.getPlace();
          if (place.formatted_address) {
            // Write the picked address straight to the DOM (uncontrolled
            // input) AND tell the parent via onChange. The parent's
            // value prop will follow on next render and the ref-sync
            // effect will no-op because the values match.
            if (inputRef.current) {
              inputRef.current.value = place.formatted_address;
            }
            onChangeRef.current(place.formatted_address, place.place_id);

            if (onComponentsRef.current && place.address_components) {
              onComponentsRef.current(
                parseAddressComponents(place.address_components, place.geometry),
              );
            }
          }
        } catch {
          // place_changed handler failed — ignore silently
        }
      });

      autocompleteRef.current = autocompleteInstance;
    } catch {
      setScriptLoaded(false);
    }

    // ── Cleanup on unmount ────────────────────────────────────────────
    // Without this, .pac-container dropdowns get orphaned on document.body
    // (e.g. when the user switches tabs inside the Clerk UserProfile modal)
    // and float visibly over the next view at their last computed position.
    return () => {
      const w2 = window as GWindow;
      if (autocompleteInstance && w2.google?.maps?.event) {
        try { w2.google.maps.event.clearInstanceListeners(autocompleteInstance); } catch { /* noop */ }
      }
      autocompleteRef.current = null;
      removeStalePacContainers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptLoaded, authFailed]);

  // Also sweep stale dropdowns when the input itself is hidden by a parent
  // (e.g. switching from Physical address → Security inside Clerk's modal)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !inputRef.current) return;
    const node = inputRef.current;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        // Sweep orphaned dropdowns ONLY when the field is not the active
        // input. Google's predictions dropdown appearing (and its layout
        // shift) can momentarily flip the field out of the viewport
        // intersection — sweeping then removes the very dropdown the user
        // is typing into, which reads as "autocomplete never proposes
        // addresses". Guarding on activeElement keeps the fix for the
        // real case (field hidden by a parent, e.g. Clerk modal tab
        // switch) while never nuking a live, in-use dropdown.
        if (!e.isIntersecting && document.activeElement !== node) {
          removeStalePacContainers();
        }
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // "Use my current location" — ask the browser for a GPS fix, then reverse-
  // geocode it to a street address via the already-loaded Google Geocoder and
  // fill the same fields an autocomplete pick would. Works in any HTTPS context
  // incl. the installed PWA. Every failure path degrades to a typed-address
  // hint (incl. a Geocoder REQUEST_DENIED when the Geocoding API isn't enabled).
  async function useMyLocation() {
    setGeoError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Location isn’t available on this device — please type your address.');
      return;
    }
    if (authFailed) {
      setGeoError('Address lookup is unavailable — please type your address.');
      return;
    }
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 0,
        });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const Geocoder = (window as GWindow).google?.maps?.Geocoder;
      if (!Geocoder) {
        setGeoError('Address lookup isn’t ready yet — please type your address.');
        return;
      }
      const { results } = await new Geocoder().geocode({ location: { lat, lng } });
      const best = results?.[0];
      if (!best?.formatted_address) {
        setGeoError('Couldn’t find an address for your location — please type it in.');
        return;
      }
      if (inputRef.current) inputRef.current.value = best.formatted_address;
      onChangeRef.current(best.formatted_address, best.place_id);
      if (onComponentsRef.current && best.address_components) {
        onComponentsRef.current(
          parseAddressComponents(best.address_components, best.geometry, lat, lng),
        );
      }
    } catch (err) {
      const code = (err as GeolocationPositionError | undefined)?.code;
      if (code === 1) {
        setGeoError('Location permission denied — allow location access or type your address.');
      } else if (code === 3) {
        setGeoError('Location timed out — try again or type your address.');
      } else {
        setGeoError('Couldn’t get your location — please type your address.');
      }
    } finally {
      setLocating(false);
    }
  }

  const noKey =
    !process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY === 'placeholder';

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          // Uncontrolled — see useEffect above for the ref-sync rationale.
          // defaultValue runs once on mount; programmatic updates from
          // the parent come through the ref-write in the effect, never
          // through a value prop.
          defaultValue={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (geoError) setGeoError(null);
          }}
          onBlur={() => {
            // Give Google's place_changed click a tick to fire, then sweep.
            setTimeout(removeStalePacContainers, 250);
          }}
          placeholder={placeholder}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            padding: '10px 12px 10px 36px',
            fontSize: 14,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--text-tertiary)"
          strokeWidth="1.5"
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}
          aria-hidden
        >
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10.5 10.5l3 3" strokeLinecap="round" />
        </svg>
      </div>
      {!noKey && !authFailed && scriptLoaded && (
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="mt-1.5"
          aria-label="Use my current location to fill in the address"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--red)',
            cursor: locating ? 'wait' : 'pointer',
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10Z" />
            <circle cx="12" cy="11" r="2.5" />
          </svg>
          {locating ? 'Locating…' : 'Use my current location'}
        </button>
      )}
      {geoError && (
        <p className="mt-1" style={{ fontSize: 11, color: '#f59e0b' }}>
          {geoError}
        </p>
      )}
      {(authFailed || noKey || !scriptLoaded) && (
        <p
          className="mt-1.5"
          style={{
            fontSize: 11,
            color: authFailed ? '#f59e0b' : 'var(--text-tertiary)',
          }}
        >
          {authFailed
            ? '⚠ Address suggestions unavailable — enable Maps JavaScript + Places APIs on your key. Fill in the fields below in the meantime.'
            : noKey
              ? '⚠ Autocomplete not configured — fill in the fields below'
              : 'Loading address suggestions…'}
        </p>
      )}
    </div>
  );
}
