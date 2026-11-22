import type { Province } from '@prisma/client';
import type { CarrierAddress, CarrierContact } from '../shipping/carrier.types';
import type { ParcelDims } from '../shipping/shipping.types';

/**
 * Print-and-deliver constants and the fulfilment mode.
 *
 * ⚠️ THE PICKUP ADDRESS IS THE DESK'S, NOT A SELLER'S. Bob Go collects the
 * printed envelope from here and delivers it to the member. It is deliberately
 * a constant with env overrides rather than a database row: it is one address,
 * it must be the same on every waybill, and a typo in an admin field would send
 * a courier to the wrong door.
 *
 * ⚠️ THE CONTACT MOBILE HAS NO DEFAULT. Bob Go requires a reachable mobile for
 * the collection; inventing one would silently book a shipment nobody can
 * coordinate. Booking refuses until `MOTIVATION_PRINT_PHONE` is set.
 */

/** The second choice the member makes after the product mode. */
export type MotivationFulfilmentMode = 'DIGITAL' | 'DELIVER';

export function normaliseFulfilmentMode(value: unknown): MotivationFulfilmentMode {
  return value === 'DELIVER' ? 'DELIVER' : 'DIGITAL';
}

export function isPrintDelivery(value: unknown): boolean {
  return normaliseFulfilmentMode(value) === 'DELIVER';
}

/** Where the printed envelope is collected. */
export function printPickupAddress(): CarrierAddress {
  return {
    company: process.env.MOTIVATION_PRINT_PICKUP_NAME ?? 'ALL Outdoor',
    streetAddress:
      process.env.MOTIVATION_PRINT_PICKUP_STREET ??
      '36 Sterappel Crescent',
    suburb:
      process.env.MOTIVATION_PRINT_PICKUP_SUBURB ?? 'Langeberg Glen',
    city: process.env.MOTIVATION_PRINT_PICKUP_CITY ?? 'Kraaifontein',
    postalCode: process.env.MOTIVATION_PRINT_PICKUP_POSTAL ?? '7570',
    province: process.env.MOTIVATION_PRINT_PICKUP_PROVINCE ?? 'Western Cape',
    type: 'residential',
  };
}

/** Who the courier phones at the door. */
export function printPickupContact(): CarrierContact {
  return {
    name: process.env.MOTIVATION_PRINT_CONTACT_NAME ?? 'ALL Outdoor',
    mobile: (process.env.MOTIVATION_PRINT_PHONE ?? '').trim(),
    email:
      process.env.MOTIVATION_PRINT_EMAIL?.trim() ||
      'gerhard.fourie@alloutdoor.co.za',
  };
}

/** The desk that receives the PDF and prints it. */
export function printDeskEmail(): string {
  return (
    process.env.MOTIVATION_PRINT_EMAIL?.trim() ||
    'gerhard.fourie@alloutdoor.co.za'
  );
}

/**
 * An A4 envelope with a bound motivation inside. Under 1 kg by design; a
 * thicker Print-ready pack still fits, and a genuine re-weigh surfaces through
 * Bob Go's charge webhook like any other parcel.
 */
export function printParcel(): ParcelDims {
  return {
    lengthCm: Number(process.env.MOTIVATION_PRINT_PARCEL_LENGTH_CM ?? 35),
    widthCm: Number(process.env.MOTIVATION_PRINT_PARCEL_WIDTH_CM ?? 25),
    heightCm: Number(process.env.MOTIVATION_PRINT_PARCEL_HEIGHT_CM ?? 3),
    weightGrams: Number(process.env.MOTIVATION_PRINT_PARCEL_WEIGHT_G ?? 500),
  };
}

/** The delivery address as the member gave it, snapshotted on the order. */
export interface PrintDeliveryAddress {
  streetAddress: string;
  address2?: string;
  suburb: string;
  city: string;
  postalCode: string;
  province: Province;
  lat?: number;
  lng?: number;
}

/** One-line address for the operator email and the desk queue. */
export function formatPrintAddress(a: PrintDeliveryAddress): string {
  return [
    a.streetAddress,
    a.address2,
    a.suburb,
    a.city,
    a.postalCode,
    a.province,
  ]
    .filter((part) => Boolean(part && String(part).trim()))
    .join(', ');
}

/** Our own print reference, short enough for a waybill and unique per try. */
export function mintPrintReference(now = Date.now()): string {
  return `PR${now.toString(36).toUpperCase()}`;
}
