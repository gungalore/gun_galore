import { Injectable, Logger } from '@nestjs/common';

export interface TcgAddress {
  streetAddress: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
}

export interface TcgParcel {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description?: string;
}

export interface TcgQuote {
  serviceCode: string;
  serviceName: string;
  priceZarCents: number;
  estimatedDays: number;
}

export interface TcgShipment {
  waybillNumber: string;
  collectionDate: string;
  trackingUrl: string;
}

@Injectable()
export class TcgService {
  private readonly logger = new Logger(TcgService.name);
  // TODO: verify base URL from TCG API documentation
  private readonly baseUrl = process.env.TCG_API_BASE_URL ?? 'https://api.thecourierguy.co.za';

  private get headers() {
    return {
      'Content-Type': 'application/json',
      apikey: process.env.TCG_API_KEY ?? '',
    };
  }

  async getQuote(
    from: Pick<TcgAddress, 'postalCode'>,
    to: Pick<TcgAddress, 'postalCode'>,
    parcels: TcgParcel[],
  ): Promise<TcgQuote[]> {
    if (!process.env.TCG_API_KEY) throw new Error('TCG_API_KEY not configured');

    // TODO: verify exact endpoint + request shape from TCG API docs
    const res = await fetch(`${this.baseUrl}/api/getQuote`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        collectionPostalCode: from.postalCode,
        deliveryPostalCode: to.postalCode,
        parcels: parcels.map((p) => ({
          weight: p.weightKg,
          length: p.lengthCm,
          width: p.widthCm,
          height: p.heightCm,
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TCG quote error ${res.status}: ${body}`);
    }

    const data = await res.json();
    // TODO: map response to TcgQuote[] — shape depends on TCG's actual response
    return (data.services ?? data).map((s: any) => ({
      serviceCode: s.serviceCode ?? s.code,
      serviceName: s.serviceName ?? s.name,
      priceZarCents: Math.round((s.price ?? s.amount) * 100),
      estimatedDays: s.transitDays ?? s.estimatedDays ?? 2,
    }));
  }

  async createShipment(data: {
    collection: TcgAddress;
    delivery: TcgAddress;
    parcels: TcgParcel[];
    serviceCode: string;
    reference: string;
    specialInstructions?: string;
  }): Promise<TcgShipment> {
    if (!process.env.TCG_API_KEY) throw new Error('TCG_API_KEY not configured');

    // TODO: verify exact endpoint + request shape from TCG API docs
    const res = await fetch(`${this.baseUrl}/api/shipment`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        serviceType: data.serviceCode,
        reference: data.reference,
        specialInstructions: data.specialInstructions,
        collectionAddress: this.mapAddress(data.collection),
        deliveryAddress: this.mapAddress(data.delivery),
        parcels: data.parcels.map((p) => ({
          weight: p.weightKg,
          length: p.lengthCm,
          width: p.widthCm,
          height: p.heightCm,
          description: p.description,
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TCG shipment error ${res.status}: ${body}`);
    }

    const json = await res.json();
    return {
      waybillNumber: json.waybillNumber ?? json.waybill,
      collectionDate: json.collectionDate,
      trackingUrl: json.trackingUrl ?? `https://www.thecourierguy.co.za/tracking?waybill=${json.waybillNumber}`,
    };
  }

  private mapAddress(a: TcgAddress) {
    return {
      streetAddress: a.streetAddress,
      suburb: a.suburb,
      city: a.city,
      province: a.province,
      postalCode: a.postalCode,
      contactName: a.contactName,
      contactNumber: a.contactPhone,
      contactEmail: a.contactEmail,
    };
  }
}
