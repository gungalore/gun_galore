'use client';

import { useCountdown, formatCountdown } from '@/lib/use-countdown';

// Daily Deals countdown (DD-3). Reuses the shared 1-Hz useCountdown primitive
// (same one the auction AuctionTimeChip uses) so a deal's "ends in" stays live
// on long-open storefront/PDP pages instead of going stale at the server
// snapshot. Two variants:
//   - "chip"   compact pill for the DealCard grid ("Ends in 3h 14m")
//   - "banner" the OneDayOnly-style urgency strip for the deal PDP, ticking
//              down H:M:S so the buyer feels the clock.
// Renders nothing once the deal has ended (the card/PDP shows its own ended
// state) or when there's no endsAt (a deal with no scheduled close).

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Live H:M:S (or Dd HH:MM:SS) for the banner.
function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days >= 1) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function DealCountdown({
  endsAt,
  variant = 'chip',
  label = 'Ends in',
}: {
  endsAt: string | null | undefined;
  variant?: 'chip' | 'banner';
  label?: string;
}) {
  const ms = useCountdown(endsAt ?? null);
  if (!endsAt || ms <= 0) return null;
  // <1h → urgent styling to draw the eye for last-minute browsers.
  const urgent = ms < 3600_000;

  if (variant === 'banner') {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-[6px] px-3 py-2 mb-4"
        style={{
          background: urgent ? 'rgba(200,16,46,0.08)' : 'var(--bg-inset)',
          border: `0.5px solid ${urgent ? 'var(--red)' : 'var(--border)'}`,
        }}
        aria-live="off"
      >
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <span
          className="text-sm"
          style={{
            color: urgent ? 'var(--red)' : 'var(--text-primary)',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatClock(ms)}
        </span>
      </div>
    );
  }

  return (
    <span
      className="px-1.5 py-0.5 rounded-[3px]"
      style={{
        background: urgent ? 'rgba(200,16,46,0.10)' : 'var(--bg-inset)',
        color: urgent ? 'var(--red)' : 'var(--text-secondary)',
        fontWeight: urgent ? 500 : 400,
        border: `0.5px solid ${urgent ? 'var(--red)' : 'var(--border)'}`,
      }}
    >
      {label} {formatCountdown(ms)}
    </span>
  );
}
