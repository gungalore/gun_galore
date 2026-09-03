import type { PrismaService } from '../prisma/prisma.service';

/**
 * DEAD INVENTORY — one query, two callers.
 *
 * ⚠️ THIS LIVES ON ITS OWN BECAUSE TWO SURFACES RANK THE SAME LISTINGS AND
 * MUST NOT DISAGREE ABOUT WHICH IS WORST. /admin/freshness-graveyard prints
 * the ranked report; the Desk puts the top few on the pile as work. If each
 * wrote its own SQL, the drift would be invisible: both would look right on
 * their own page, and an operator comparing them would find the graveyard's
 * worst listing missing from the Desk with nothing to explain it. Same reason
 * payments/fee-presentation.ts exists — one builder, never re-derived.
 *
 * Anything that needs these rows calls this. Nothing re-implements the score.
 */

export interface FreshnessGraveyardRow {
  id: string;
  referenceNumber: string | null;
  title: string;
  priceCents: number | null;
  ageDays: number;
  /**
   * Higher = more dead inventory weight. age × price proxies for "the value
   * sitting unsold the longest". Sellers with multiple entries surface near
   * the top because each listing scores independently.
   */
  staleScore: number;
  sellerId: string;
  sellerUsername: string | null;
  sellerEmail: string;
  categoryName: string;
  listingType: string;
}

/**
 * ACTIVE listings older than `minAgeDays` with zero engagement — no bids, no
 * offers, no watchers — ranked by age × price.
 *
 * ⚠️ ZERO ENGAGEMENT IS ALL THREE, NOT ANY ONE. A listing with a single
 * watcher is not dead: somebody is waiting on it, and telling a seller to take
 * it down would be wrong. The three NOT EXISTS clauses are the definition.
 */
export async function queryFreshnessGraveyard(
  prisma: PrismaService,
  opts: { minAgeDays?: number; limit?: number } = {},
): Promise<FreshnessGraveyardRow[]> {
  const minAgeDays = opts.minAgeDays ?? 30;
  const limit = opts.limit ?? 50;
  const cutoff = new Date(Date.now() - minAgeDays * 24 * 3600 * 1000);

  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      referenceNumber: string | null;
      title: string;
      priceCents: number | null;
      ageDays: number;
      staleScore: number;
      sellerId: string;
      sellerUsername: string | null;
      sellerEmail: string;
      categoryName: string;
      listingType: string;
    }[]
  >(
    `
      SELECT
        l.id,
        l."referenceNumber",
        l.title,
        l.price AS "priceCents",
        EXTRACT(EPOCH FROM (NOW() - l."createdAt"))/86400 AS "ageDays",
        (EXTRACT(EPOCH FROM (NOW() - l."createdAt"))/86400) * (COALESCE(l.price, 0) / 100.0) AS "staleScore",
        u.id AS "sellerId",
        u.username AS "sellerUsername",
        u.email AS "sellerEmail",
        c.name AS "categoryName",
        l."listingType"::text AS "listingType"
      FROM "Listing" l
      JOIN "User"     u ON u.id = l."sellerId"
      JOIN "Category" c ON c.id = l."categoryId"
      WHERE l.status = 'ACTIVE'
        AND l."createdAt" < $1
        AND l."bidCount" = 0
        AND NOT EXISTS (SELECT 1 FROM "Offer"        o WHERE o."listingId" = l.id)
        AND NOT EXISTS (SELECT 1 FROM "AuctionWatch" w WHERE w."listingId" = l.id)
      ORDER BY "staleScore" DESC NULLS LAST
      LIMIT $2
      `,
    cutoff,
    limit,
  );

  return rows.map((r) => ({
    ...r,
    ageDays: Math.round(Number(r.ageDays) * 10) / 10,
    priceCents: r.priceCents !== null ? Number(r.priceCents) : null,
    staleScore: Math.round(Number(r.staleScore)),
  }));
}
