import Link from 'next/link';
import Image from 'next/image';
import { Raffle } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { FeaturedRail } from '@/components/featured-rail';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Raffles no longer have an endTime — they run until sold out. The
// status badge now shows tickets-remaining (or "Sold out" / "Drawn" /
// "Closed" depending on the lifecycle stage).
function statusBadge(r: Raffle): string {
  if (r.status === 'DRAWN') return 'Winner drawn';
  if (r.status === 'CLOSED_AWAITING_DRAW') return 'Draw pending';
  if (r.status === 'CLAIMED') return 'Prize claimed';
  if (r.status === 'CANCELLED_BY_ADMIN' || r.status === 'CANCELLED_MIN_NOT_MET') return 'Cancelled';
  if (r.status === 'EXPIRED_UNCLAIMED') return 'Expired';
  const sold = r.ticketsSoldPaid + r.ticketsSoldPostal;
  const remaining = Math.max(0, r.targetTicketCount - sold);
  if (remaining === 0) return 'Sold out';
  return `${remaining} left`;
}

export const metadata = {
  title: 'Competitions — Gun Galore',
  description: 'Small shot, BIG target. Live competitions on Gun Galore.',
};

export default async function CompetitionsPage() {
  const res = await fetch(`${API_URL}/raffles`, { cache: 'no-store' }).catch(() => null);
  const raffles: Raffle[] = res?.ok ? await res.json() : [];

  return (
    <main
      className="relative max-w-[1280px] mx-auto px-4 py-8"
      style={{ zIndex: 1 }}
    >
      {/* Trophy / prize scenery behind the cards. Same PageBackground
          component as the Sell page + auctions surface. */}
      <PageBackground imageSrc="/competition.jpg" opacity={0.18} />

      {/* Layout: <FeaturedRail> + competition grid side-by-side on
          desktop, stacked on mobile. The rail is outside PageReveal
          (no data-reveal on it) so it shows instantly while the
          competition cards run through the blur-in stagger. */}
      <div className="flex flex-col lg:flex-row gap-6">
        <FeaturedRail />
        <div className="flex-1 min-w-0">

      {/* Blur-in keyframe so the prize feels like it's coming into
          focus. Timing (0.5s delay + 1s duration) is locked at the
          PageReveal component level — same cadence as every other
          page on Gun Galore. */}
      <PageReveal variant="blur-in">
        <header data-reveal className="mb-8">
          <h1
            className="text-2xl mb-1"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            Gun Galore Competitions
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Small shot, BIG target.
          </p>
        </header>

        {raffles.length === 0 ? (
        <div
          data-reveal
          className="rounded-[6px] px-4 py-12 text-center text-sm"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          No competitions running right now — check back soon.
        </div>
      ) : (
        <div
          data-reveal
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {raffles.map((r) => (
            <Link
              key={r.id}
              href={`/competitions/${r.id}`}
              className="block group"
              style={{ textDecoration: 'none' }}
            >
              <div
                className="rounded-[6px] overflow-hidden"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                }}
              >
                {/* 4:3 image */}
                <div className="relative" style={{ paddingBottom: '75%' }}>
                  {r.imageUrl ? (
                    <Image
                      src={r.imageUrl}
                      alt={r.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  ) : (
                    <div
                      className="absolute inset-0 flex items-center justify-center text-xs"
                      style={{
                        background: 'var(--bg-inset)',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      No image
                    </div>
                  )}
                  <span
                    className="absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px]"
                    style={{
                      background: 'rgba(0,0,0,0.72)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Competition
                  </span>
                  <span
                    className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-[4px]"
                    style={{
                      background: 'var(--red)',
                      color: '#fff',
                    }}
                  >
                    {statusBadge(r)}
                  </span>
                </div>

                <div className="p-3">
                  <p
                    className="text-sm leading-snug line-clamp-2 mb-2"
                    style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                  >
                    {r.title}
                  </p>
                  <div className="flex items-baseline justify-between">
                    <span
                      className="text-base"
                      style={{ color: 'var(--red)', fontWeight: 500 }}
                    >
                      {formatPrice(r.ticketPriceCents)}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      per ticket
                    </span>
                  </div>
                  <p
                    className="text-xs mt-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {r.ticketsSoldPaid + r.ticketsSoldPostal} / {r.targetTicketCount} tickets sold
                  </p>
                  {r.itemValueCents != null && (
                    <p
                      className="text-xs mt-1"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      Prize value: {formatPrice(r.itemValueCents)}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      </PageReveal>
        </div>
      </div>
    </main>
  );
}
