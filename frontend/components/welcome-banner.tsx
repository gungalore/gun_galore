'use client';

// SMS-arrival welcome banner. Shows once per browser session when a visitor
// lands from a marketing SMS link carrying an active campaign key
// (gungalore.co.za/?c=KEY). Plain visits never trigger it. The key is
// validated + hit-counted server-side, then stripped from the address bar so
// it doesn't linger or get shared onward.
//
// Ported from the Claude Design source gg-welcome-banner.html — same staged
// entrance, ember particles, headline sheen, magnetic CTA, and full
// prefers-reduced-motion support. Scoped under #ggw-root so nothing leaks.

import { useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const DEFAULT_HEADLINE = 'Buying gear just stopped being a gamble.';

const POINTS: { text: React.ReactNode }[] = [
  { text: <>Your payment is held until delivery is confirmed. <em>Not a cent sooner.</em></> },
  { text: <>Every seller is ID-verified before they&apos;re ever paid.</> },
  { text: <>Couriered &amp; tracked to your door. <em>No parking-lot meetups.</em></> },
  { text: <>Buy now, bid, make an offer — or swap your gear for theirs, ± cash.</> },
  { text: <>Listing is free. <em>No upfront fees to advertise.</em></> },
];

export function WelcomeBanner() {
  const [headline, setHeadline] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

  // Resolve the ?c= key on mount, once. Strips the param from the URL either
  // way (valid or not) so it never lingers or gets shared onward.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('c');
    if (!key) return;

    // Always clean the URL — no campaign key should survive in the address bar.
    const strip = () => {
      params.delete('c');
      const qs = params.toString();
      const url =
        window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState({}, '', url);
    };

    const seenKey = `gg-campaign-seen:${key}`;
    if (sessionStorage.getItem(seenKey)) {
      strip();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${API_URL}/marketing/campaign/${encodeURIComponent(key)}`,
          { cache: 'no-store' },
        );
        const data = (await r.json().catch(() => null)) as {
          campaign: { headline: string | null } | null;
        } | null;
        if (!cancelled && data?.campaign) {
          sessionStorage.setItem(seenKey, '1');
          setHeadline(data.campaign.headline || DEFAULT_HEADLINE);
          setVisible(true);
        }
      } catch {
        /* banner is non-critical — fail silent */
      } finally {
        strip();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lock body scroll + wire Escape while visible.
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Magnetic CTA (pointer + motion-allowed only).
  useEffect(() => {
    if (!visible) return;
    const card = cardRef.current;
    const cta = ctaRef.current;
    if (!card || !cta) return;
    if (
      !window.matchMedia('(hover: hover)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const move = (e: MouseEvent) => {
      const rect = cta.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = 110;
      if (dist < reach) {
        const pull = (1 - dist / reach) * 6;
        cta.style.transform = `translate(${((dx / dist) * pull).toFixed(2)}px,${((dy / dist) * pull).toFixed(2)}px)`;
      } else {
        cta.style.transform = '';
      }
    };
    const leave = () => {
      cta.style.transform = '';
    };
    card.addEventListener('mousemove', move);
    card.addEventListener('mouseleave', leave);
    return () => {
      card.removeEventListener('mousemove', move);
      card.removeEventListener('mouseleave', leave);
    };
  }, [visible]);

  function dismiss() {
    if (leaving) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLeaving(true);
    window.setTimeout(() => setVisible(false), reduce ? 0 : 380);
  }

  if (!visible) return null;

  return (
    <div
      id="ggw-root"
      className={leaving ? 'ggw-out' : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ggw-headline"
    >
      <div
        className="ggw-dim"
        onClick={dismiss}
        aria-hidden="true"
      />
      <div className="ggw-embers" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <i key={i} />
        ))}
      </div>

      <div className="ggw-card" ref={cardRef}>
        <button
          className="ggw-close"
          type="button"
          aria-label="Close welcome message"
          onClick={dismiss}
        >
          ✕
        </button>

        <p className="ggw-eyebrow ggw-stage">Welcome to Gun Galore</p>

        <h2 className="ggw-headline ggw-stage ggw-sheen" id="ggw-headline">
          {headline}
        </h2>

        <ul className="ggw-list">
          {POINTS.map((p, i) => (
            <li className="ggw-stage" key={i}>
              <svg className="ggw-check" viewBox="0 0 22 22" aria-hidden="true">
                <circle cx="11" cy="11" r="10.5" />
                <path d="M6.5 11.4l3.1 3.1 5.9-6.6" />
              </svg>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>

        <button
          className="ggw-cta ggw-stage ggw-glow"
          type="button"
          ref={ctaRef}
          onClick={dismiss}
        >
          <span>Have a look around&nbsp;→</span>
        </button>

        <p className="ggw-foot ggw-stage">
          ID-verified sellers · payment held until delivery · couriered &amp; tracked
        </p>
      </div>
    </div>
  );
}
