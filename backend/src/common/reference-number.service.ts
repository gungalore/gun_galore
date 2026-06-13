import { Global, Injectable, Module } from '@nestjs/common';
import { ListingType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Atomic allocator for the human-trackable reference numbers shown on
// every listing + raffle (UM000123, AU000045, TS000007, RA000003).
// Backed by the ReferenceCounter table — Prisma's atomic increment
// inside an upsert means concurrent creates can't pick the same number.
//
// The prefix is derived from the listing type — keep the mapping in
// one place so a future "Used New" or rename of TAKE_A_SHOT doesn't
// silently produce wrong refs.

// UM/AU/TS = listings, RA = raffles, FS = featured-slot orders. Order
// references reuse these per-prefix counters, so every issued number is
// globally unique within its prefix whether it labels a listing or an
// order (no two things ever share UM000042).
export type ReferencePrefix = 'UM' | 'AU' | 'TS' | 'RA' | 'FS';

const LISTING_TYPE_TO_PREFIX: Record<ListingType, ReferencePrefix> = {
  BUY_NOW: 'UM',
  AUCTION: 'AU',
  TAKE_A_SHOT: 'TS',
};

// Per-order reference source — the thing being paid for. Drives the
// prefix the buyer sees as their EFT reference (e.g. UM000123).
export type OrderRefSource = ListingType | 'RAFFLE' | 'FEATURED';

const ORDER_SOURCE_TO_PREFIX: Record<OrderRefSource, ReferencePrefix> = {
  BUY_NOW: 'UM',
  AUCTION: 'AU',
  TAKE_A_SHOT: 'TS',
  RAFFLE: 'RA',
  FEATURED: 'FS',
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
   * store this directly on the Listing/Raffle row.
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

  /** Allocate for a Raffle (always RA). */
  allocateForRaffle(): Promise<string> {
    return this.allocate('RA');
  }

  /**
   * Allocate a per-ORDER reference the buyer uses as their manual-EFT
   * bank reference (e.g. UM000123). Unique per order; matched against
   * FNB inContact alerts + statement rows during reconciliation.
   */
  allocateOrderReference(source: OrderRefSource): Promise<string> {
    return this.allocate(ORDER_SOURCE_TO_PREFIX[source]);
  }
}

@Global()
@Module({
  providers: [ReferenceNumberService],
  exports: [ReferenceNumberService],
})
export class ReferenceNumberModule {}
