import { Global, Injectable, Module } from '@nestjs/common';
import { ListingType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Atomic allocator for the human-trackable reference numbers shown on
// every listing (UM000123, AU000045, TS000007). Backed by the
// ReferenceCounter table — Prisma's atomic increment inside an upsert
// means concurrent creates can't pick the same number.
//
// The prefix is derived from the listing type — keep the mapping in
// one place so a future "Used New" or rename of TAKE_A_SHOT doesn't
// silently produce wrong refs.

// UM/AU/TS = listings, FS = featured-slot orders, SB = subscription
// purchases (P1.1), HP = hunting-package / experience ORDER references
// (EXP-E1). Order references reuse these per-prefix counters, so every
// issued number is globally unique within its prefix whether it labels
// a listing or an order (no two things ever share UM000042). NOTE: HP is an
// ORDER-ref prefix only — an experience LISTING reuses the BUY_NOW (UM) /
// AUCTION (AU) listing prefix, because an experience is still fundamentally a
// BUY_NOW or AUCTION listing; HP only distinguishes the buyer's per-booking
// EFT reference so hunting bookings reconcile / report separately.
export type ReferencePrefix =
  | 'UM'
  | 'AU'
  | 'TS'
  | 'FS'
  | 'SW'
  | 'SB'
  | 'HP'
  | 'CO' // CO — formal complaint case number (Complaint.referenceNumber)
  | 'MO'; // MO — firearm-licence motivation document number
  //        (Motivation.referenceNumber). Printed on the PDF the applicant
  //        hands to the DFO, so it must be short and quotable over the phone.

const LISTING_TYPE_TO_PREFIX: Record<ListingType, ReferencePrefix> = {
  BUY_NOW: 'UM',
  AUCTION: 'AU',
  TAKE_A_SHOT: 'TS',
  SWOP: 'SW', // Swop/Trade listing (SWOP) — used by the swap funding EFT memo
};

const PAD_WIDTH = 6;

export function prefixForListingType(type: ListingType): ReferencePrefix {
  return LISTING_TYPE_TO_PREFIX[type];
}

/** Format a count + prefix into the human-readable form, e.g. UM000042. */
export function formatReference(prefix: ReferencePrefix, count: number): string {
  return `${prefix}${String(count).padStart(PAD_WIDTH, '0')}`;
}

@Injectable()
export class ReferenceNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically allocate the next reference number for the given prefix.
   * Safe under concurrent inserts — the database increments the counter
   * row in a single statement, so two callers never observe the same
   * value.
   *
   * Returns the formatted string (e.g. "UM000123"). Callers should
   * store this directly on the Listing row.
   */
  async allocate(prefix: ReferencePrefix): Promise<string> {
    const row = await this.prisma.referenceCounter.upsert({
      where: { prefix },
      create: { prefix, count: 1 },
      update: { count: { increment: 1 } },
    });
    return formatReference(prefix, row.count);
  }

  /** Allocate for a Listing based on its listingType. */
  allocateForListing(type: ListingType): Promise<string> {
    return this.allocate(prefixForListingType(type));
  }
}

@Global()
@Module({
  providers: [ReferenceNumberService],
  exports: [ReferenceNumberService],
})
export class ReferenceNumberModule {}
