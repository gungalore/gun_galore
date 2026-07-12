'use client';

import { useEffect, useState } from 'react';
import type { AskGgFairUseCoolOff, AskGgQuota } from '@/lib/use-ask-gg';
import { IconClock } from './icons';

/** Pill rendered above the composer for FREE users. Pure counter —
 *  no CTA — so it doesn't fight with the composer for attention.
 *  Turns warm-coloured at ≤2 remaining so the cap doesn't surprise. */
export function QuotaPill({ quota }: { quota: AskGgQuota }) {
  const warm = quota.remaining <= 2;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '4px 0',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          background: warm
            ? 'rgba(200,16,46,0.10)'
            : 'var(--bg-inset)',
          border: `0.5px solid ${warm ? 'rgba(200,16,46,0.40)' : 'var(--border)'}`,
          color: warm ? 'var(--red)' : 'var(--text-tertiary)',
          fontSize: 11,
          lineHeight: 1.2,
        }}
        aria-label={`${quota.remaining} of ${quota.cap} free messages remaining this month`}
      >
        {quota.remaining} / {quota.cap} free messages this month
      </span>
    </div>
  );
}

/** Inline upgrade nudge that takes the QuotaPill slot once the
 *  FREE user has used their last message — but kept compact so the
 *  composer (disabled) still shows below for context. */
export function UpgradeInlineNudge() {
  return (
    <div
      style={{
        marginTop: 8,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'rgba(200,16,46,0.08)',
        border: '0.5px solid rgba(200,16,46,0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      role="status"
    >
      <span
        style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          lineHeight: 1.4,
        }}
      >
        You&rsquo;ve used your 5 free messages this month. Upgrade to
        Member or Pro for unlimited firearms questions, photo
        identification, and more.
      </span>
      <span
        style={{
          padding: '8px 14px',
          background: 'var(--bg-inset)',
          color: 'var(--text-secondary)',
          border: '0.5px solid var(--border-hover)',
          borderRadius: 8,
          fontSize: 12,
          alignSelf: 'flex-start',
        }}
      >
        Subscription launching soon — we&rsquo;ll email you when it&rsquo;s live.
      </span>
    </div>
  );
}

/** Replaces the composer when a MEMBER / PRO user has hit their
 *  hourly fair-use cap. Live-countdown so the wait is honest, not
 *  vague. Composer is disabled while this is on-screen. */
export function FairUseCard({ coolOff }: { coolOff: AskGgFairUseCoolOff }) {
  const [remainingSec, setRemainingSec] = useState(() =>
    secondsUntil(coolOff.windowResetsAt),
  );
  useEffect(() => {
    const t = setInterval(() => {
      setRemainingSec(secondsUntil(coolOff.windowResetsAt));
    }, 1000);
    return () => clearInterval(t);
  }, [coolOff.windowResetsAt]);

  const min = Math.floor(remainingSec / 60);
  const sec = remainingSec % 60;
  return (
    <div
      style={{
        marginTop: 8,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
      role="status"
      aria-live="polite"
    >
      <span style={{ color: 'var(--text-tertiary)' }}>
        <IconClock />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
          }}
        >
          Quick break — fair-use cap hit
        </p>
        <p
          style={{
            margin: '2px 0 0',
            fontSize: 11,
            color: 'var(--text-tertiary)',
          }}
        >
          Back in {min}:{sec.toString().padStart(2, '0')}
        </p>
      </div>
    </div>
  );
}

function secondsUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 1000));
}
