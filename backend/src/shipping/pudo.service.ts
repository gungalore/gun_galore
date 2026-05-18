import { Injectable, Logger } from '@nestjs/common';

export interface PudoLocker {
  lockerId: string;
  name: string;
  address: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  lat: number;
  lng: number;
  distanceKm?: number;
}

@Injectable()
export class PudoService {
  private readonly logger = new Logger(PudoService.name);
  private cache: PudoLocker[] | null = null;
  private cacheAt = 0;
  private readonly TTL_MS = 24 * 60 * 60 * 1000;

  async getNearbyLockers(
    lat?: number,
    lng?: number,
    radiusKm = 30,
    limit = 20,
  ): Promise<PudoLocker[]> {
    const all = await this.getAll();
    if (!lat || !lng) return all.slice(0, limit);

    return all
      .map((l) => ({ ...l, distanceKm: this.haversine(lat, lng, l.lat, l.lng) }))
      .filter((l) => l.distanceKm! <= radiusKm)
      .sort((a, b) => a.distanceKm! - b.distanceKm!)
      .slice(0, limit);
  }

  async createShipment(data: {
    fromLockerId: string;
    toLockerId: string;
    weightKg: number;
    parcels: number;
    reference: string;
    senderName: string;
    recipientName: string;
    recipientPhone: string;
  }): Promise<{ trackingCode: string }> {
    if (!process.env.PUDO_API_KEY) throw new Error('PUDO_API_KEY not configured');
    // TODO: verify exact endpoint + request shape from Pudo API docs
    // POST https://api.pudo.co.za/v2/shipments (approximate)
    const res = await fetch('https://api.pudo.co.za/v2/shipments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PUDO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromLockerCode: data.fromLockerId,
        toLockerCode: data.toLockerId,
        weight: data.weightKg,
        pieces: data.parcels,
        reference: data.reference,
        senderName: data.senderName,
        recipientName: data.recipientName,
        recipientMobile: data.recipientPhone,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Pudo shipment error ${res.status}: ${body}`);
    }
    const json = await res.json();
    return { trackingCode: json.trackingCode ?? json.waybill };
  }

  // Invalidate cache manually (useful after admin override)
  invalidateCache(): void {
    this.cache = null;
    this.cacheAt = 0;
  }

  private async getAll(): Promise<PudoLocker[]> {
    if (this.cache && Date.now() - this.cacheAt < this.TTL_MS) return this.cache;

    if (!process.env.PUDO_API_KEY) {
      this.logger.warn('PUDO_API_KEY not set — locker list unavailable');
      return [];
    }

    try {
      // TODO: verify exact endpoint from Pudo API documentation
      const res = await fetch('https://api.pudo.co.za/v2/lockers', {
        headers: { Authorization: `Bearer ${process.env.PUDO_API_KEY}` },
      });
      if (!res.ok) throw new Error(`Pudo API ${res.status}`);

      const raw = await res.json();
      // TODO: confirm response shape. Common patterns: raw array or { lockers: [...] }
      const list: unknown[] = Array.isArray(raw) ? raw : (raw.lockers ?? []);

      this.cache = list.map((l: any) => ({
        lockerId: l.lockerCode ?? l.id ?? l.lockerId,
        name: l.name,
        address: l.address ?? l.streetAddress,
        suburb: l.suburb ?? '',
        city: l.city,
        province: l.province,
        postalCode: l.postalCode ?? '',
        lat: parseFloat(l.latitude ?? l.lat),
        lng: parseFloat(l.longitude ?? l.lng),
      }));

      this.cacheAt = Date.now();
      this.logger.log(`Pudo locker cache refreshed: ${this.cache.length} lockers`);
    } catch (err) {
      this.logger.error('Failed to fetch Pudo lockers', err);
      if (this.cache) {
        this.logger.warn('Serving stale Pudo locker cache');
        return this.cache;
      }
    }

    return this.cache ?? [];
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
