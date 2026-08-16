import { Province } from '@prisma/client';

/**
 * Human-readable province names.
 *
 * Shared because two very different things need the same strings and must not
 * disagree: the courier collection/delivery address handed to a carrier, and
 * the vicinity shown to a buyer (and snapshotted onto
 * Transaction.buyerLocationShown as evidence of what they were told before
 * they paid). A second copy that drifted would mean the address on the waybill
 * and the location in the dispute record name different places.
 */
export const PROVINCE_LONG: Record<Province, string> = {
  EASTERN_CAPE: 'Eastern Cape',
  FREE_STATE: 'Free State',
  GAUTENG: 'Gauteng',
  KWAZULU_NATAL: 'KwaZulu-Natal',
  LIMPOPO: 'Limpopo',
  MPUMALANGA: 'Mpumalanga',
  NORTH_WEST: 'North West',
  NORTHERN_CAPE: 'Northern Cape',
  WESTERN_CAPE: 'Western Cape',
};

/**
 * The vicinity string a buyer is shown before paying, and the exact text
 * snapshotted onto the transaction.
 *
 * A firearm never moves from a seller's address — it goes to a licensed dealer
 * — so for those the meaningful location is the planned dealer, which is
 * already composed as "Dealer Name — Centurion, Gauteng". Everything else
 * resolves to town + province, falling back to the province alone if a listing
 * predates publicLocality.
 */
export function vicinityLabel(listing: {
  isFirearm: boolean;
  plannedDealerLocation?: string | null;
  publicLocality?: string | null;
  province: Province;
}): string {
  if (listing.isFirearm && listing.plannedDealerLocation) {
    return listing.plannedDealerLocation;
  }
  const province = PROVINCE_LONG[listing.province];
  return listing.publicLocality
    ? `${listing.publicLocality}, ${province}`
    : province;
}
