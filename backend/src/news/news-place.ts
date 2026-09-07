import type { PrismaService } from '../prisma/prisma.service';
import { geocodeZa } from './news-geo';

// ────────────────────────────────────────────────────────────────────
// ONE PLACE NAME, GEOCODED ONCE, EVER.
//
// Both the poll (a place printed in a headline) and the read path (a police
// station) resolve names through here, because both are billed Google calls
// against the same key and both see the same names over and over — "Kempton
// Park" appears in a hundred headlines a year and "Brooklyn police station"
// in every Brooklyn motivation.
//
// ⚠️ A FAILED LOOKUP IS CACHED TOO, as a row with null coordinates. Names
// Google cannot find do not start being findable, and a retry loop over
// "Ext 7" is a bill with no answer at the end of it.
// ────────────────────────────────────────────────────────────────────

export async function cachedPlace(
  prisma: PrismaService,
  query: string,
  cacheName: string,
): Promise<{ lat: number; lng: number } | null> {
  const name = cacheName.trim().toLowerCase().slice(0, 180);
  if (!name) return null;

  const held = await prisma.newsPlace.findUnique({ where: { name } });
  if (held) {
    return held.lat !== null && held.lng !== null
      ? { lat: held.lat, lng: held.lng }
      : null;
  }

  const at = await geocodeZa(query);
  // ⚠️ create().catch() rather than upsert: two workers can look up the same
  // town in the same second, and losing that race is not an error — the
  // winner's row is the answer either way.
  await prisma.newsPlace
    .create({ data: { name, lat: at?.lat ?? null, lng: at?.lng ?? null } })
    .catch(() => undefined);
  return at;
}
