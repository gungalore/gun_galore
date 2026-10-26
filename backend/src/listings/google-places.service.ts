import { Injectable, Logger } from '@nestjs/common';

/**
 * Google Places API (New) — dealer lookup.
 *
 * ⚠️ PLACES API (NEW), NOT THE LEGACY WEB SERVICE. The listing's dealer
 * picker needs the place's address, phone and website; the legacy
 * `place/details/json` call is retired. The backend key is IP-restricted, so
 * the browser only ever sees the public Maps key used for autocomplete.
 *
 * ⚠️ NO EMAIL FROM GOOGLE. Place Details returns no email address at all.
 * `emailFromWebsite` is a best-effort fetch of the dealer's own site; a
 * failure is normal and must never block the listing. The seller can always
 * type the email.
 *
 * ⚠️ CACHE. Google's terms allow Place content to be cached for a limited
 * period (currently 30 days) other than the place id. This keeps a short
 * in-memory cache with `fetchedAt` and refetches after the window; nothing
 * here is written to the database.
 */

export interface DealerPlaceDetails {
  placeId: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  province: string | null;
  city: string | null;
}

export interface PlaceSuggestion {
  placeId: string;
  text: string;
}

export interface PlaceAddress {
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

interface CacheRow {
  at: number;
  value: DealerPlaceDetails;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const FIELD_MASK = [
  'displayName',
  'formattedAddress',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'location',
  'addressComponents',
  'businessStatus',
].join(',');
const ADDRESS_FIELD_MASK = [
  'displayName',
  'formattedAddress',
  'location',
  'addressComponents',
].join(',');

@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);
  private readonly cache = new Map<string, CacheRow>();
  private readonly addressCache = new Map<
    string,
    { at: number; value: PlaceAddress }
  >();

  /**
   * Autocomplete (New). The BROWSER key cannot use Places Autocomplete (its
   * API restrictions block `places.googleapis.com`), so the address fields
   * call this through the backend, whose key already serves Place Details.
   * Returns [] on any failure — the field stays a plain text input.
   */
  async autocomplete(
    input: string,
    type: 'address' | 'establishment' = 'address',
  ): Promise<PlaceSuggestion[]> {
    const q = (input ?? '').trim();
    if (q.length < 2) return [];

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      this.logger.warn('GOOGLE_MAPS_API_KEY is not set — autocomplete unavailable.');
      return [];
    }

    try {
      const res = await fetch(
        'https://places.googleapis.com/v1/places:autocomplete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
          },
          body: JSON.stringify({
            input: q.slice(0, 120),
            includedRegionCodes: ['za'],
            ...(type === 'establishment'
              ? { includedPrimaryTypes: ['establishment'] }
              : {}),
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Places autocomplete ${res.status}.`);
        return [];
      }
      const body = (await res.json()) as {
        suggestions?: {
          placePrediction?: {
            placeId?: string;
            text?: { text?: string };
          };
        }[];
      };
      const out: PlaceSuggestion[] = [];
      for (const s of body.suggestions ?? []) {
        const p = s.placePrediction;
        if (!p?.placeId || !p.text?.text) continue;
        out.push({ placeId: p.placeId, text: p.text.text });
        if (out.length >= 8) break;
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `Places autocomplete failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Address-shaped Place Details (New): no phone/website/email, so a typed
   * address lookup stays cheap and carries nothing the address field needs.
   */
  async address(placeId: string): Promise<PlaceAddress | null> {
    const id = (placeId ?? '').trim();
    if (!id) return null;

    const hit = this.addressCache.get(id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return null;

    try {
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
        {
          headers: {
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': ADDRESS_FIELD_MASK,
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Places address ${res.status}.`);
        return null;
      }
      const body = (await res.json()) as {
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        addressComponents?: {
          longText?: string;
          shortText?: string;
          types?: string[];
        }[];
      };
      const comp = (type: string) =>
        body.addressComponents?.find((c) => c.types?.includes(type))?.longText ??
        null;
      const street = [
        comp('street_number'),
        comp('route'),
      ]
        .filter(Boolean)
        .join(' ');

      const value: PlaceAddress = {
        placeId: id,
        name: body.displayName?.text ?? null,
        address: body.formattedAddress ?? null,
        street: street || null,
        suburb:
          comp('sublocality_level_1') ??
          comp('sublocality') ??
          comp('neighborhood'),
        city: comp('locality') ?? comp('administrative_area_level_2'),
        province: comp('administrative_area_level_1'),
        postalCode: comp('postal_code'),
        lat: body.location?.latitude ?? null,
        lng: body.location?.longitude ?? null,
      };
      this.addressCache.set(id, { at: Date.now(), value });
      return value;
    } catch (err) {
      this.logger.warn(
        `Places address failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Place Details (New). Returns null when the key is absent, the place is
   * unknown, or Google is unreachable — callers fall back to manual entry.
   */
  async details(placeId: string): Promise<DealerPlaceDetails | null> {
    const id = (placeId ?? '').trim();
    if (!id) return null;

    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      this.logger.warn('GOOGLE_MAPS_API_KEY is not set — dealer lookup unavailable.');
      return null;
    }

    try {
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
        {
          headers: {
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': FIELD_MASK,
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Places details ${res.status} for a dealer lookup.`);
        return null;
      }
      const body = (await res.json()) as {
        displayName?: { text?: string };
        formattedAddress?: string;
        nationalPhoneNumber?: string;
        internationalPhoneNumber?: string;
        websiteUri?: string;
        location?: { latitude?: number; longitude?: number };
        addressComponents?: {
          longText?: string;
          shortText?: string;
          types?: string[];
        }[];
      };

      const comp = (type: string) =>
        body.addressComponents?.find((c) => c.types?.includes(type))?.longText ??
        null;

      const website = body.websiteUri ?? null;
      const value: DealerPlaceDetails = {
        placeId: id,
        name: body.displayName?.text ?? null,
        address: body.formattedAddress ?? null,
        phone:
          body.nationalPhoneNumber ??
          body.internationalPhoneNumber ??
          null,
        website,
        email: website ? await this.emailFromWebsite(website) : null,
        lat: body.location?.latitude ?? null,
        lng: body.location?.longitude ?? null,
        province: comp('administrative_area_level_1'),
        city: comp('locality') ?? comp('administrative_area_level_2'),
      };
      this.cache.set(id, { at: Date.now(), value });
      return value;
    } catch (err) {
      this.logger.warn(
        `Places details failed for a dealer lookup: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Find one public business email on the dealer's site. Deliberately tiny:
   * one request to the site, one to /contact if the first finds nothing.
   * Never throws, never blocks, never logs the address.
   */
  private async emailFromWebsite(website: string): Promise<string | null> {
    let base: URL;
    try {
      base = new URL(website);
    } catch {
      return null;
    }
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;

    const pages = [base.toString()];
    try {
      pages.push(new URL('/contact', base).toString());
      pages.push(new URL('/contact-us', base).toString());
    } catch {
      /* ignore */
    }

    for (const url of pages) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'AllOutdoorDealerLookup/1.0' },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) continue;
        const html = (await res.text()).slice(0, 400_000);
        const mailto = html.match(/mailto:([^"'?>\s]+)/i)?.[1];
        const plain = html.match(
          /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
        )?.[0];
        const candidate = (mailto ?? plain ?? '').replace(/^mailto:/i, '');
        if (
          candidate &&
          !/\.(png|jpe?g|gif|webp|svg)$/i.test(candidate) &&
          !/example\.(com|org)$/i.test(candidate)
        ) {
          return candidate.slice(0, 200);
        }
      } catch {
        /* next page */
      }
    }
    return null;
  }
}
