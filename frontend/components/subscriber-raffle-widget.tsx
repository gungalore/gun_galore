'use client';

// Phase E3 — Ask GG subscriber raffle widget.
//
// Renders on /ask-gg (and could be reused on /dashboard later). Shows:
//   - FREE users: "Subscribe to enter the weekly Ask GG raffle" upsell
//   - MEMBER users: their entry in the current Member raffle
//   - PRO users: their entry in BOTH the Member + Pro raffles (Pros get
//                more value — that's the upgrade ladder)
//
// For each raffle we surface:
//   - Prize title + cover photo + description (NO prize value — operator
//     sizes off-platform; hidePrizeValue=true forces this server-side)
//   - "Auto-entered ✓" confirmation with the user's ticket number
//   - Draw countdown ("Draws in 18h 24m") OR draw result ("Drawn —
//     you won! / @username won")

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth, useUser } from '@clerk/nextjs';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface SubscriberRaffleView {
  id: string;
  referenceNumber: string | null;
  title: string;
  description: string;
  status: string;
  subscriberDrawAt: string | null;
  drawnAt: string | null;
  coverImageUrl: string | null;
  isEntered: boolean;
  myTicket: {
    id: string;
    ticketNumber: number;
    referenceCode: string;
  } | null;
  didIWin: boolean;
}

interface ApiResponse {
  upsell: boolean;
  tier: 'FREE' | 'MEMBER' | 'PRO';
  memberRaffle: SubscriberRaffleView | null;
  proRaffle: SubscriberRaffleView | null;
}

function formatCountdown(targetIso: string | null): string {
  if (!targetIso) return '';
  const ms = new Date(targetIso).getTime() - Date.now();
  if (ms <= 0) return 'drawing now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function SubscriberRaffleWidget() {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [data, setData] = useState<ApiResponse | null>(null);
  // 1Hz tick so countdowns refresh.
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/raffles/me/subscriber`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        setData((await res.json()) as ApiResponse);
      } catch {
        // Silent — widget is decorative; never block the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  // Signed out users see nothing. The /ask-gg page already has a
  // sign-in CTA; we don't need a duplicate.
  if (!isLoaded || !isSignedIn || !data) return null;

  // FREE users see the upsell card.
  if (data.upsell) {
    return (
      <div
        className="rounded-[8px] p-4 mb-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid rgba(200,16,46,0.40)',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-[3px]"
            style={{
              background: 'rgba(200,16,46,0.10)',
              color: 'var(--red)',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            GG+ perk
          </span>
          <span
            className="text-sm"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            Weekly Ask GG raffle
          </span>
        </div>
        <p
          className="text-xs"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
        >
          Subscribers get auto-entered into a free weekly raffle —
          Members get the Member raffle, Pros get both Member + Pro
          raffles. Zero clicks, just upgrade.
        </p>
      </div>
    );
  }

  // Subscribers see one or two raffle cards.
  return (
    <div className="space-y-3 mb-4">
      {data.memberRaffle && (
        <RaffleCard raffle={data.memberRaffle} tierLabel="Member" />
      )}
      {data.proRaffle && (
        <RaffleCard raffle={data.proRaffle} tierLabel="Pro" />
      )}
      {!data.memberRaffle && !data.proRaffle && (
        <p
          className="text-xs px-3 py-2 rounded-[6px]"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          No Ask GG raffle live this week. The next one will be
          announced soon.
        </p>
      )}
    </div>
  );
}

function RaffleCard({
  raffle,
  tierLabel,
}: {
  raffle: SubscriberRaffleView;
  tierLabel: 'Member' | 'Pro';
}) {
  const isDrawn = raffle.status === 'DRAWN';
  const isClosing = raffle.status === 'CLOSED_AWAITING_DRAW';
  const countdown = formatCountdown(raffle.subscriberDrawAt);

  return (
    <Link
      href={`/competitions/${raffle.id}`}
      className="block rounded-[8px] p-3"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${
          raffle.didIWin ? '#22c55e' : 'rgba(200,16,46,0.40)'
        }`,
        textDecoration: 'none',
      }}
    >
      <div className="flex gap-3">
        {raffle.coverImageUrl ? (
          <div
            className="relative shrink-0 rounded-[4px] overflow-hidden"
            style={{
              width: 72,
              height: 72,
              background: 'var(--bg-inset)',
            }}
          >
            <Image
              src={raffle.coverImageUrl}
              alt=""
              fill
              className="object-cover"
              sizes="72px"
            />
          </div>
        ) : (
          <div
            className="shrink-0 rounded-[4px] flex items-center justify-center text-xs"
            style={{
              width: 72,
              height: 72,
              background: 'var(--bg-inset)',
              color: 'var(--text-tertiary)',
            }}
          >
            No image
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-[3px]"
              style={{
                background:
                  tierLabel === 'Pro'
                    ? 'var(--red)'
                    : 'rgba(200,16,46,0.10)',
                color: tierLabel === 'Pro' ? '#fff' : 'var(--red)',
                fontWeight: 600,
                letterSpacing: '0.04em',
              }}
            >
              GG+ {tierLabel}
            </span>
            {raffle.isEntered && !isDrawn && (
              <span
                className="text-[10px]"
                style={{ color: '#22c55e', fontWeight: 600 }}
              >
                ✓ Auto-entered
              </span>
            )}
          </div>
          <p
            className="text-sm leading-snug line-clamp-2 mb-1"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {raffle.title}
          </p>

          {isDrawn ? (
            <p
              className="text-xs"
              style={{
                color: raffle.didIWin ? '#22c55e' : 'var(--text-tertiary)',
                fontWeight: raffle.didIWin ? 600 : 400,
              }}
            >
              {raffle.didIWin
                ? '🎉 You won — check your notifications'
                : 'Drawn — see winner on the raffle page'}
            </p>
          ) : isClosing ? (
            <p
              className="text-xs"
              style={{ color: '#f59e0b', fontWeight: 500 }}
            >
              Drawing now…
            </p>
          ) : raffle.subscriberDrawAt ? (
            <p
              className="text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              Draws in {countdown}
              {raffle.myTicket && (
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {' '}
                  · ticket #{raffle.myTicket.ticketNumber}
                </span>
              )}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
