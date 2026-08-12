'use client';

// /raffle — the AO PRO prize draw. A marketing surface: the actual prize
// of the running cycle is displayed for the whole cycle; PRO members are
// entered automatically and free. Copy NEVER mentions how prizes are
// funded and never names prize categories — "amazing prizes" only.
// Winner banner shows for 48h after each draw (username only).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrowseRailShell } from '@/components/browse-rail-shell';
import { PRO_NAME } from '@/lib/brand';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface CurrentDraw {
  id: string;
  title: string;
  description: string;
  prizeValueCents: number;
  imageUrls: string[];
  drawAt: string;
}
interface WinnerRow {
  username: string;
  prizeTitle: string;
  prizeValueCents: number;
  drawnAt: string | null;
}
interface RaffleState {
  enabled: boolean;
  current?: CurrentDraw | null;
  recentWinner?: WinnerRow | null;
  pastWinners?: WinnerRow[];
}

function rand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA')}`;
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <span>Drawing now…</span>;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return (
    <span>
      {days > 0 ? `${days} day${days === 1 ? '' : 's'} ` : ''}
      {hours} hour{hours === 1 ? '' : 's'} to go
    </span>
  );
}

export default function RafflePage() {
  const [state, setState] = useState<RaffleState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/raffle`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: RaffleState | null) => (s ? setState(s) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="max-w-[var(--page-max)] mx-auto px-4 py-8 pb-24">
      <BrowseRailShell>
      <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        The {PRO_NAME} prize draw
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Every {PRO_NAME} member is entered automatically — free, no tickets, no
        entry steps. Amazing prizes, drawn on the date shown. The bigger the
        PRO club grows, the bigger the prizes get.
      </p>

      {failed && (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Couldn&apos;t load the draw right now — please refresh.
        </p>
      )}

      {state && !state.enabled && (
        <div
          className="rounded-[10px] p-6 text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Prize draws are coming with {PRO_NAME}
          </p>
          <p className="text-sm m-0" style={{ color: 'var(--text-secondary)' }}>
            Amazing prizes, on display right here before every draw. Watch this
            space.
          </p>
        </div>
      )}

      {state?.enabled && state.recentWinner && (
        <div
          className="rounded-[10px] px-4 py-3 mb-6"
          style={{
            background: 'rgba(200,16,46,0.06)',
            border: '0.5px solid rgba(200,16,46,0.40)',
          }}
        >
          <p className="text-sm m-0" style={{ color: 'var(--text-primary)' }}>
            🎉 <strong>{state.recentWinner.username}</strong> just won{' '}
            <strong>{state.recentWinner.prizeTitle}</strong> (value{' '}
            {rand(state.recentWinner.prizeValueCents)}). Congratulations!
          </p>
        </div>
      )}

      {state?.enabled && state.current && (
        <div
          className="rounded-[10px] overflow-hidden mb-6"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          {state.current.imageUrls[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.current.imageUrls[0]}
              alt={state.current.title}
              className="w-full object-cover"
              style={{ maxHeight: 340 }}
            />
          )}
          <div className="p-5">
            <p
              className="text-[11px] uppercase font-semibold mb-1"
              style={{ letterSpacing: 0.6, color: 'var(--red)' }}
            >
              This cycle&apos;s prize
            </p>
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              {state.current.title}
            </h2>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              {state.current.description}
            </p>
            <p className="text-sm mb-4" style={{ color: 'var(--text-primary)' }}>
              Value <strong>{rand(state.current.prizeValueCents)}</strong> ·{' '}
              <Countdown to={state.current.drawAt} />
            </p>
            <Link
              href="/subscribe"
              className="inline-block text-sm px-4 py-2.5 rounded-[6px]"
              style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
            >
              Get {PRO_NAME} — you&apos;re entered automatically
            </Link>
          </div>
        </div>
      )}

      {state?.enabled && !state.current && !state.recentWinner && (
        <div
          className="rounded-[10px] p-6 text-center mb-6"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-sm m-0" style={{ color: 'var(--text-secondary)' }}>
            The next prize is being lined up — it&apos;ll be on display right
            here. PRO members are entered automatically the moment it goes live.
          </p>
        </div>
      )}

      {state?.enabled && (state.pastWinners?.length ?? 0) > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            Past winners
          </h3>
          <ul className="m-0 p-0" style={{ listStyle: 'none', fontSize: 13, lineHeight: 1.9 }}>
            {state.pastWinners!.map((w, i) => (
              <li key={i} style={{ color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{w.username}</strong> —{' '}
                {w.prizeTitle} ({rand(w.prizeValueCents)})
                {w.drawnAt
                  ? ` · ${new Date(w.drawnAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        No purchase of entries — entry is an automatic, free benefit of an
        active {PRO_NAME} subscription. 18+.{' '}
        <Link href="/raffle/rules" style={{ color: 'var(--red)' }}>
          Competition rules
        </Link>
      </p>
      </div>
      </BrowseRailShell>
    </div>
  );
}
