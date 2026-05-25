import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { MyTicket } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { PageReveal } from '@/components/page-reveal';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default async function MyTicketsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/tickets');

  const token = await getToken();
  const res = await fetch(`${API_URL}/raffles/me/tickets`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const tickets: MyTicket[] = res.ok ? await res.json() : [];

  // Group by raffle
  const byRaffle = tickets.reduce<Record<string, MyTicket[]>>((acc, t) => {
    (acc[t.raffle.id] ??= []).push(t);
    return acc;
  }, {});

  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <PageReveal variant="slide-up">
      <h1
        data-reveal
        className="text-xl mb-6"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        My competition tickets
      </h1>

      {Object.keys(byRaffle).length === 0 && (
        <div
          data-reveal
          className="rounded-[8px] py-12 px-6 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p
            className="text-base mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            No tickets yet
          </p>
          <p
            className="text-sm mb-5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Win firearms, optics, and accessories — answer a quick
            skill question, buy a ticket, and we&apos;ll notify you the
            moment the draw lands.
          </p>
          <Link
            href="/competitions"
            className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Browse live competitions →
          </Link>
        </div>
      )}

      <div data-reveal className="space-y-4">
        {Object.entries(byRaffle).map(([raffleId, group]) => {
          const raffle = group[0].raffle;
          const confirmed = group.filter((t) => t.status === 'CONFIRMED');
          const pending = group.filter((t) => t.status === 'PENDING_PAYMENT');
          return (
            <div
              key={raffleId}
              className="rounded-[8px] p-4"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              <div className="flex gap-3">
                {raffle.imageUrl ? (
                  <div className="relative w-16 h-16 flex-shrink-0 rounded-[4px] overflow-hidden">
                    <Image
                      src={raffle.imageUrl}
                      alt={raffle.title ?? 'Raffle'}
                      fill
                      className="object-cover"
                      sizes="64px"
                    />
                  </div>
                ) : (
                  <div
                    className="w-16 h-16 flex-shrink-0 rounded-[4px] flex items-center justify-center text-xs"
                    style={{
                      background: 'var(--bg-inset)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    No photo
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/competitions/${raffle.id}`}
                    className="text-sm font-medium leading-snug"
                    style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                  >
                    {raffle.title}
                  </Link>
                  <p
                    className="text-xs mt-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {confirmed.length} confirmed
                    {pending.length > 0
                      ? ` · ${pending.length} pending payment`
                      : ''}
                    {' · '}
                    Total paid {formatPrice(
                      confirmed.reduce((s, t) => s + t.amountCents, 0),
                    )}
                  </p>
                </div>
              </div>

              {/* Reference codes */}
              <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
                <p
                  className="text-xs uppercase mb-2"
                  style={{
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.05em',
                  }}
                >
                  Your tickets
                </p>
                <div className="flex flex-wrap gap-1">
                  {group.map((t) => (
                    <code
                      key={t.id}
                      className="text-xs px-2 py-1 rounded-[3px]"
                      style={{
                        background: 'var(--bg-inset)',
                        color: t.status === 'CONFIRMED'
                          ? 'var(--text-primary)'
                          : 'var(--text-tertiary)',
                        fontFamily: 'monospace',
                        border: '0.5px solid var(--border)',
                      }}
                      title={t.status}
                    >
                      #{t.ticketNumber} · {t.referenceCode}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </PageReveal>
    </main>
  );
}
