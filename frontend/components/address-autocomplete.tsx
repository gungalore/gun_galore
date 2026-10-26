'use client';

import { useEffect, useId, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Address autocomplete with OUR dropdown, fed by the backend.
//
// ⚠️ WHY NOT THE GOOGLE MAPS WIDGET. The browser Maps key's API restrictions
// block `places.googleapis.com` (`API_KEY_SERVICE_BLOCKED`), so the legacy
// `google.maps.places.Autocomplete` widget returned no predictions and the
// field stayed a plain text box. The backend key can call Places API (New),
// so we ask our own endpoint and render the list. The Maps JS library is now
// used only by "Use my current location" (Geocoder).

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
  /** Optional: choose a Places primary type for non-address place pickers. */
  placeTypes?: string[];
  /** Full selected place details for use cases such as a gunshop nomination. */
  onPlaceSelected?: (place: {
    name?: string;
    formattedAddress?: string;
    placeId?: string;
    components: ParsedAddressComponents;
  }) => void;
  placeholder?: string;
  /**
   * Hide "Use my current location".
   *
   * ⚠️ IT IS WRONG FOR SOMEBODY ELSE'S ADDRESS, AND IT APPEARED UNDER ONE. The
   * button offers the phone's GPS fix, which is where the MEMBER is standing —
   * useful for their own home, meaningless under "Employer's address", where
   * it invites a member sitting at their kitchen table to fill in their
   * employer's address with their house. An employer's address is typed, or
   * read off the employment letter.
   */
  hideLocate?: boolean;
}

type Suggestion = { placeId: string; text: string };

interface PlaceDetail {
  placeId: string;
  name: string | null;
  address: string | null;
  street: string | null;
  suburb: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
}

// ── Minimal Geocoder types (the Maps script still supplies this) ─────
interface AddressComponent {
  long_name: string;
  types: string[];
}
interface GGeometry {
  location?: { lat: () => number; lng: () => number };
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
  Geocoder?: new () => GGeocoder;
}
interface GWindow {
  google?: { maps?: GMapsLib };
}

// ── Singleton Maps loader, for the Geocoder only ─────────────────────
let mapsScriptPromise: Promise<void> | null = null;

let mapsAuthFailed = false;
const authFailureListeners = new Set<() => void>();

function notifyAuthFailure() {
  mapsAuthFailed = true;
  for (const fn of authFailureListeners) {
    try {
      fn();
    } catch {
      /* noop */
    }
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
    if (
      text.includes('ApiTargetBlockedMapError') ||
      text.includes('InvalidKeyMapError') ||
      text.includes('RefererNotAllowedMapError') ||
      text.includes('BillingNotEnabledMapError') ||
      text.includes('ApiNotActivatedMapError')
    ) {
      if (!mapsAuthFailed) {
        original.call(
          window.console,
          '[AddressAutocomplete] Google Maps disabled — "use my location" is unavailable. Address suggestions come from our server and still work.',
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
  if (w.google?.maps?.Geocoder) return Promise.resolve();
  if (mapsScriptPromise) return mapsScriptPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return Promise.resolve();

  patchConsoleErrorOnce();
  type GMWindow = Window & { gm_authFailure?: () => void };
  (window as GMWindow).gm_authFailure = () => notifyAuthFailure();

  const waitForGeocoder = (resolve: () => void) => {
    const deadline = Date.now() + 10_000;
    const check = () => {
      if (w.google?.maps?.Geocoder || mapsAuthFailed || Date.now() > deadline) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  };

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src*="maps.googleapis.com/maps/api/js"]',
  );
  if (existing) {
    mapsScriptPromise = new Promise((resolve) => {
      existing.addEventListener('error', () => {
        notifyAuthFailure();
        resolve();
      });
      waitForGeocoder(resolve);
    });
    return mapsScriptPromise;
  }

  mapsScriptPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    s.async = true;
    s.onload = () => waitForGeocoder(resolve);
    s.onerror = () => {
      notifyAuthFailure();
      resolve();
    };
    document.head.appendChild(s);
  });
  return mapsScriptPromise;
}

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
  placeTypes,
  onPlaceSelected,
  placeholder = 'Search for address…',
  hideLocate = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const onComponentsRef = useRef(onComponents);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  const abortRef = useRef<AbortController | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  const [authFailed, setAuthFailed] = useState(mapsAuthFailed);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);

  const typeKey = placeTypes?.join(',') ?? '';

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onComponentsRef.current = onComponents;
  }, [onComponents]);
  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected;
  }, [onPlaceSelected]);

  // Uncontrolled input — the parent's value is written straight to the DOM
  // node. Only when the field is NOT focused, so typing is never overwritten.
  useEffect(() => {
    if (!inputRef.current) return;
    if (document.activeElement === inputRef.current) return;
    if (inputRef.current.value !== value) {
      inputRef.current.value = value;
    }
  }, [value]);

  // Subscribe to the Maps auth flag — only the locate button depends on it.
  useEffect(() => {
    if (mapsAuthFailed) setAuthFailed(true);
    const fn = () => setAuthFailed(true);
    authFailureListeners.add(fn);
    return () => {
      authFailureListeners.delete(fn);
    };
  }, []);

  // Debounced server-side autocomplete. Every address field uses this, so it
  // does not depend on the browser key or the Maps Places library.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const type = typeKey.split(',').includes('establishment')
          ? 'establishment'
          : 'address';
        const res = await fetch(
          `${API_URL}/listings/place-autocomplete?input=${encodeURIComponent(q)}&types=${type}`,
          { signal: ctrl.signal, cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions?: Suggestion[] };
        if (ctrl.signal.aborted) return;
        const list = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        setOpen(list.length > 0);
        setActive(-1);
      } catch {
        /* aborted or offline — leave the typed value */
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query, typeKey]);

  async function choose(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
    setQuery('');
    if (blurTimer.current) clearTimeout(blurTimer.current);

    try {
      const res = await fetch(
        `${API_URL}/listings/place/${encodeURIComponent(s.placeId)}`,
        { cache: 'no-store' },
      );
      const data = res.ok
        ? ((await res.json()) as { place?: PlaceDetail | null })
        : { place: null };
      const p = data.place;
      if (!p) {
        // Details failed — keep the label Google gave, with its place id.
        if (inputRef.current) inputRef.current.value = s.text;
        onChangeRef.current(s.text, s.placeId);
        return;
      }

      const address = p.address || s.text;
      if (inputRef.current) inputRef.current.value = address;
      onChangeRef.current(address, p.placeId);

      const components: ParsedAddressComponents = {
        street: p.street ?? undefined,
        suburb: p.suburb ?? undefined,
        city: p.city ?? undefined,
        province: p.province ?? undefined,
        postalCode: p.postalCode ?? undefined,
        lat: p.lat ?? undefined,
        lng: p.lng ?? undefined,
      };
      onComponentsRef.current?.(components);
      onPlaceSelectedRef.current?.({
        name: p.name ?? undefined,
        formattedAddress: address,
        placeId: p.placeId,
        components,
      });
    } catch {
      if (inputRef.current) inputRef.current.value = s.text;
      onChangeRef.current(s.text, s.placeId);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (active >= 0) {
        e.preventDefault();
        void choose(suggestions[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // "Use my current location" — GPS fix, then reverse-geocode via the Maps
  // Geocoder. Suggestions no longer depend on Maps, so a broken key only
  // affects this button.
  async function useMyLocation() {
    setGeoError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Location isn’t available on this device — please type your address.');
      return;
    }
    setLocating(true);

    let lat: number;
    let lng: number;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 0,
        });
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch (err) {
      const code = (err as GeolocationPositionError | undefined)?.code;
      if (code === 1) {
        setGeoError('Location permission denied — allow location access or type your address.');
      } else if (code === 3) {
        setGeoError('Location timed out — try again or type your address.');
      } else {
        setGeoError('Couldn’t get your location — please type your address.');
      }
      setLocating(false);
      return;
    }

    try {
      await loadMapsOnce();
      const Geocoder = (window as GWindow).google?.maps?.Geocoder;
      if (!Geocoder) throw new Error('geocoder-not-ready');
      const { results } = await new Geocoder().geocode({ location: { lat, lng } });
      const best = results?.[0];
      if (!best?.formatted_address) throw new Error('no-result');
      if (inputRef.current) inputRef.current.value = best.formatted_address;
      onChangeRef.current(best.formatted_address, best.place_id);
      if (onComponentsRef.current && best.address_components) {
        onComponentsRef.current(
          parseAddressComponents(best.address_components, best.geometry, lat, lng),
        );
      }
    } catch {
      if (onComponentsRef.current) onComponentsRef.current({ lat, lng });
      setGeoError(
        'Got your location, but address lookup isn’t available right now — please fill in the street below.',
      );
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
          // Uncontrolled — see the ref-sync effect above.
          defaultValue={value}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            setOpen(true);
            onChange(v);
            if (geoError) setGeoError(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
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

        {open && (
          <ul
            id={listId}
            role="listbox"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 80,
              margin: 0,
              padding: 4,
              listStyle: 'none',
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 10px 28px rgba(0,0,0,0.22)',
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: '8px 10px',
                  fontSize: 13,
                  lineHeight: 1.35,
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  background:
                    i === active ? 'var(--bg-inset)' : 'transparent',
                }}
              >
                {s.text}
              </li>
            ))}
            {suggestions.length === 0 && searching && (
              <li
                style={{
                  padding: '8px 10px',
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                }}
              >
                Searching…
              </li>
            )}
          </ul>
        )}
      </div>

      {!noKey && !hideLocate && (
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
        <p className="mt-1" style={{ fontSize: 11, color: 'var(--warning)' }}>
          {geoError}
        </p>
      )}
      {authFailed && !hideLocate && !noKey && (
        <p
          className="mt-1"
          style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
        >
          Location lookup is unavailable — address suggestions still work.
        </p>
      )}
    </div>
  );
}
