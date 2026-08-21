// ────────────────────────────────────────────────────────────────────
// "WHERE AM I", ANSWERED AS AN AREA.
//
// ⚠️ THE REST GEOCODING ENDPOINT DOES NOT WORK FROM A BROWSER KEY, and that is
// why the witness form kept saying "we could not name that place". Our
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is HTTP-referrer restricted — which is
// correct, it is a public key — and Google's REST Geocoding API rejects
// referrer-restricted keys outright. The Maps JS SDK's Geocoder accepts them,
// which is why address-autocomplete's "use my location" has always worked
// while a hand-rolled fetch to maps.googleapis.com/geocode/json never could.
//
// ⚠️ AND IT ASKS FOR AN AREA, NOT AN ADDRESS. Operator, 2026-08-21: "Use the
// area. For reference the user currently is in Kraaifontein." A statement's
// "signed at" line wants a suburb and a province — "Kraaifontein, Western
// Cape" — not a street number. The earlier version pinned result_type to
// locality, which for a Cape Town suburb returns nothing at all: Kraaifontein
// is a SUBLOCALITY of Cape Town, so restricting to localities asked Google a
// question whose only honest answer was "Cape Town", and it answered with
// silence instead.
// ────────────────────────────────────────────────────────────────────

interface GComponent {
  long_name: string;
  types: string[];
}
interface GResult {
  address_components: GComponent[];
  formatted_address: string;
}
interface GGeocoder {
  geocode: (req: {
    location: { lat: number; lng: number };
  }) => Promise<{ results: GResult[] }>;
}
type GWindow = Window & {
  google?: { maps?: { Geocoder?: new () => GGeocoder } };
};

let loading: Promise<void> | null = null;

/**
 * Load the Maps JS SDK, once.
 *
 * Reuses a tag another component already added — address-autocomplete loads
 * the same script, and two copies of the SDK on one page is a console full of
 * "You have included the Google Maps JavaScript API multiple times".
 */
function loadMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as GWindow).google?.maps?.Geocoder) return Promise.resolve();
  if (loading) return loading;

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src*="maps.googleapis.com/maps/api/js"]',
  );
  loading = new Promise<void>((resolve) => {
    if (existing) {
      const check = () => {
        if ((window as GWindow).google?.maps?.Geocoder) resolve();
        else setTimeout(check, 50);
      };
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => resolve());
      check();
      // Never hang the button on a script that will not arrive.
      setTimeout(resolve, 8000);
      return;
    }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
    setTimeout(resolve, 8000);
  });
  return loading;
}

/**
 * The area a pair of coordinates sits in, or null.
 *
 * Returns something like "Kraaifontein, Western Cape". Null means we could not
 * name it — the caller should let the person type it rather than guess.
 */
export async function reverseGeocodeArea(
  lat: number,
  lng: number,
): Promise<string | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key || key === 'placeholder') return null;

  await loadMaps(key);
  const Geocoder = (window as GWindow).google?.maps?.Geocoder;
  if (!Geocoder) return null;

  let results: GResult[];
  try {
    const res = await new Geocoder().geocode({ location: { lat, lng } });
    results = res.results ?? [];
  } catch {
    return null;
  }
  if (!results.length) return null;

  // ⚠️ SEARCH EVERY RESULT, NOT JUST THE FIRST. Google returns a ladder from
  // the most specific match to the least — a street address, then a suburb,
  // then a city, then a province. The first entry is usually the street, whose
  // components carry the suburb anyway; but where it does not, the answer is
  // one rung down rather than absent.
  const pick = (types: string[]): string => {
    for (const r of results) {
      for (const t of types) {
        const hit = r.address_components.find((c) => c.types.includes(t));
        if (hit?.long_name) return hit.long_name;
      }
    }
    return '';
  };

  const area = pick([
    'sublocality_level_1',
    'sublocality',
    'neighborhood',
    'locality',
    'administrative_area_level_2',
  ]);
  const province = pick(['administrative_area_level_1']);

  const joined = [area, province].filter(Boolean).join(', ');
  if (joined) return joined;

  // Last resort: whatever Google called the place, minus the country.
  const formatted = results[0]?.formatted_address ?? '';
  return formatted.replace(/,\s*South Africa$/i, '').trim() || null;
}
