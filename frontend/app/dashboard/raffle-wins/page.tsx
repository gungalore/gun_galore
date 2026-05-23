import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { MyWin } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import ClaimButton from './claim-button';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default async function RaffleWinsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/dashboard/raffle-wins');

  const token = await getToken();
  const res = await fetch(`${API_URL}/raffles/me/wins`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const wins: MyWin[] = res.ok ? await res.json() : [];

  const open = wins.filter((w) => !w.claimedAt && !w.forfeitedAt);
  const closed = wins.filter((w) => w.claimedAt || w.forfeitedAt);

  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <h1
        className="text-xl mb-6"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Competition wins
      </h1>

      {wins.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          You haven&apos;t won anything yet. Browse{' '}
          <Link href="/competitions" style={{ color: 'var(--red)' }}>
            live competitions
          </Link>
          .
        </p>
      )}

      {open.length > 0 && (
        <section className="mb-8">
          <h2
            className="text-xs uppercase mb-3"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
          >
            To claim
          </h2>
          <div className="space-y-3">
            {open.map((w) => (
              <WinCard key={w.id} win={w} canClaim />
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <section>
          <h2
            className="text-xs uppercase mb-3"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
          >
            History
          </h2>
          <div className="space-y-3">
            {closed.map((w) => (
              <WinCard key={w.id} win={w} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function WinCard({ win, canClaim }: { win: MyWin; canClaim?: boolean }) {
  const positionLabel =
    win.position === 1
      ? 'WINNER'
      : `Backup #${win.position - 1}`;
  const statusLabel = win.claimedAt
    ? 'Claimed'
    : win.forfeitedAt
      ? 'Claim window expired'
      : `${positionLabel} — claim by ${new Date(win.claimDeadline).toLocaleString('en-ZA')}`;
  const statusColor = win.claimedAt
    ? '#22c55e'
    : win.forfeitedAt
      ? 'var(--text-tertiary)'
      : win.position === 1
        ? '#22c55e'
        : '#f59e0b';

  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex gap-3">
        {win.raffle.imageUrl ? (
          <div className="relative w-20 h-20 flex-shrink-0 rounded-[4px] overflow-hidden">
            <Image
              src={win.raffle.imageUrl}
              alt=""
              fill
              className="object-cover"
              sizes="80px"
            />
          </div>
        ) : (
          <div
            className="w-20 h-20 flex-shrink-0 rounded-[4px] flex items-center justify-center text-xs"
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
            href={`/competitions/${win.raffle.id}`}
            className="text-sm font-medium leading-snug line-clamp-1"
            style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {win.raffle.title}
          </Link>
          <p className="text-xs mt-1" style={{ color: statusColor }}>
            {statusLabel}
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Prize value {formatPrice(win.raffle.itemValueCents)}
          </p>
        </div>
      </div>
      {canClaim && (
        <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          <ClaimButton winnerId={win.id} />
        </div>
      )}
    </div>
  );
}
