'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountdown } from '@/lib/use-countdown';

/**
 * The live auction price + countdown rings.
 *
 * This is the design pack's one piece of real interactivity. ListingAuction,
 * MobileListingAuction and AuctionBidModule each ship a working
 * `class Component extends DCLogic` with byte-identical logic — every OTHER
 * board's renderVals() is an empty stub — so this is deliberately ONE component
 * with three consumers rather than three implementations.
 *
 * ⚠️ THE DUPLICATED KEYFRAMES ARE LOAD-BEARING. rollA/rollB, flashA/flashB and
 * the rest are byte-identical PAIRS, and the pack alternates between them on
 * every bid (`flip % 2 === 0 ? 'rollA' : 'rollB'`). That is not redundancy: re-
 * adding the same animation class does not replay it, so alternating is the
 * retrigger. Collapsing each pair into one class kills the animation with no
 * error and no warning. Do not "tidy" them.
 *
 * ⚠️ ONE BUG FROM THE MOCK IS DELIBERATELY NOT COPIED. Its digit diff guards
 * with `p.length === c.length`, so a bid that changes the digit COUNT —
 * R 9,950 to R 10,000 — silently skips the roll entirely. That is precisely the
 * bid most worth animating. Both strings are padded to a common width here
 * before diffing, so the roll fires across the rollover.
 *
 * ⚠️ AND ONE GUARD THE MOCK DOES NOT HAVE. Its demo fires a bid every 7s while
 * the ghost runs 2100ms, so a busy auction would have the price area in motion
 * roughly a third of the time — on the one number a bidder is trying to READ.
 * Bids arriving inside an animation window coalesce: the digits still roll to
 * the new figure, but the ghost and the flash are skipped rather than stacked.
 */

/** The pack's ring maths, verbatim: span is 24h / 60m / 60s. */
function arcOffset(value: number, span: number): number {
  return 100 - (value / span) * 100;
}

type Digit = { ch: string; prev: string; changed: boolean };

/**
 * Per-character diff, padded to a common width first — see the bug note above.
 * Returns the incoming character, the one it replaces, and whether it moved.
 */
function diffDigits(cur: string, prev: string | null): Digit[] {
  if (prev === null) {
    return [...cur].map((ch) => ({ ch, prev: ch, changed: false }));
  }
  const width = Math.max(cur.length, prev.length);
  const c = cur.padStart(width, ' ');
  const p = prev.padStart(width, ' ');
  return [...c].map((ch, i) => ({
    ch,
    prev: p[i] ?? ch,
    changed: ch !== p[i],
  }));
}

export function AuctionOdometer({
  /** Current bid in cents. */
  amountCents,
  bidCount,
  endTime,
  /** Rendered under the price — "Next bid R 12,450", the seller's own view, etc. */
  footnote,
}: {
  amountCents: number;
  bidCount: number;
  endTime: string | null | undefined;
  footnote?: React.ReactNode;
}) {
  const ms = useCountdown(endTime);
  const ended = !endTime || ms <= 0;

  const totalSeconds = Math.floor(ms / 1000);
  // ⚠️ DAYS ARE A DEPARTURE FROM THE PACK, AND A NECESSARY ONE. Its rings are
  // hrs/min/sec only, which silently assumes every auction closes inside a day.
  // These do not — the listing cards already say things like "Ends in 2d". With
  // three rings a three-day auction would have shown "72" hours, or worse, an
  // hours ring capped at 24 that stopped moving. The days ring renders ONLY
  // when there is at least one, so the common case is the design's three.
  const dd = Math.floor(totalSeconds / 86400);
  const hh = Math.floor((totalSeconds % 86400) / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;

  // The pack's threshold: under a minute the SECONDS ring is always hot, the
  // MINUTES ring joins it, and the hours ring never changes at all.
  const lastMinute = !ended && totalSeconds < 60;
  // --red, not --hot: the panel is white now, and #F07087 is 2.9:1 against
  // it. The pack's escalation is unchanged, only the pigment carrying it.
  const hot = 'var(--red)';
  const gold = 'var(--gold)';

  const formatted = new Intl.NumberFormat('en-ZA').format(
    Math.round(amountCents / 100),
  );

  // ── Roll bookkeeping ────────────────────────────────────────────────
  const prevRef = useRef<string | null>(null);
  const [flip, setFlip] = useState(0);
  // True while a roll is still on screen; a bid landing now rolls the digits
  // but skips the decoration.
  const animatingRef = useRef(false);
  const [decorate, setDecorate] = useState(true);
  const [digits, setDigits] = useState<Digit[]>(() =>
    diffDigits(formatted, null),
  );
  const [ghost, setGhost] = useState<string | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === formatted) return;

    const next = diffDigits(formatted, prev);
    setDigits(next);
    setGhost(prev);
    setDecorate(!animatingRef.current);
    setFlip((f) => f + 1);
    prevRef.current = formatted;

    animatingRef.current = true;
    // 2100ms is the longest of the pack's animations (the ghost); once it has
    // cleared, the next bid is allowed its full treatment again.
    const t = setTimeout(() => {
      animatingRef.current = false;
      setGhost(null);
    }, 2100);
    return () => clearTimeout(t);
  }, [formatted]);

  // The retrigger: two identical classes, alternated. See the note above.
  const rollClass = flip === 0 ? '' : flip % 2 === 0 ? 'rollA' : 'rollB';
  const decorClass = decorate ? '' : 'odo-quiet';

  const rings: Array<{ label: string; value: number; span: number; colour: string }> = [
    // A week is an arbitrary span for the days arc — days have no natural
    // wrap — but it makes the ring read as "filling up" over a normal listing
    // run rather than sitting at nothing.
    ...(dd > 0
      ? [{ label: 'days', value: Math.min(dd, 7), span: 7, colour: gold }]
      : []),
    { label: 'hrs', value: hh, span: 24, colour: gold },
    { label: 'min', value: mm, span: 60, colour: lastMinute ? hot : gold },
    { label: 'sec', value: ss, span: 60, colour: hot },
  ];

  return (
    <div className={`odo-panel ${rollClass} ${decorClass}`}>
      <div className="odo-head">
        <span className="odo-livewrap">
          <span className="odo-live" aria-hidden />
          LIVE
        </span>
        <span className="odo-count" key={bidCount}>
          {bidCount} bid{bidCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* The price. aria-live is polite and the value is announced as one
          number — a per-digit roll must never be read out digit by digit. */}
      <div className="odo-priceline">
        <span className="odo-price" aria-live="polite" aria-atomic="true">
          <span className="sr-only">Current bid </span>
          <span aria-hidden>R&nbsp;</span>
          {digits.map((d, i) => (
            <span className="odo-slot" key={`${i}-${d.ch}`}>
              {d.changed ? (
                <span className="odo-col" aria-hidden>
                  <span className="odo-cell">{d.prev}</span>
                  <span className="odo-cell">{d.ch}</span>
                </span>
              ) : (
                <span className="odo-static" aria-hidden>
                  {d.ch}
                </span>
              )}
            </span>
          ))}
          <span className="sr-only">rand</span>
        </span>
        {ghost && decorate && (
          <span className="odo-ghost" aria-hidden>
            R&nbsp;{ghost}
          </span>
        )}
      </div>

      {footnote && <div className="odo-step">{footnote}</div>}

      {/* Countdown rings. The numbers are the accessible content; the arcs are
          decoration and are hidden. */}
      <div className="odo-rings" role="timer" aria-live="off">
        <span className="sr-only">
          {ended
            ? 'Auction ended'
            : `${dd > 0 ? `${dd} days ` : ''}${hh} hours ${mm} minutes ${ss} seconds remaining`}
        </span>
        {rings.map((r) => (
          <span className="odo-ring" key={r.label} aria-hidden>
            <svg viewBox="0 0 44 44" width="44" height="44">
              <circle
                cx="22"
                cy="22"
                r="19"
                fill="none"
                stroke="var(--border)"
                strokeWidth="3"
              />
              <circle
                className="odo-arc"
                cx="22"
                cy="22"
                r="19"
                fill="none"
                stroke={r.colour}
                strokeWidth="3"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="100"
                strokeDashoffset={ended ? 100 : arcOffset(r.value, r.span)}
                transform="rotate(-90 22 22)"
              />
              {r.label === 'sec' && !ended && (
                <line
                  className="odo-sweep"
                  x1="22"
                  y1="22"
                  x2="22"
                  y2="7"
                  stroke={hot}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  opacity="0.5"
                />
              )}
            </svg>
            <span className={`odo-num ${lastMinute && r.label !== 'hrs' ? 'odo-urgent' : ''}`}>
              {String(r.value).padStart(2, '0')}
            </span>
            <span className="odo-lbl">{r.label}</span>
          </span>
        ))}
      </div>

      <style>{`
        .odo-panel {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--r-md);
          padding: 16px 18px;
          color: var(--text-primary);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .odo-head {
          display: flex; align-items: center; justify-content: space-between;
          font-family: var(--font-head); font-size: 10.5px;
          letter-spacing: 1.2px; text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .odo-livewrap { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
        .odo-live {
          width: 7px; height: 7px; border-radius: 999px;
          background: var(--red); display: inline-block;
        }
        .odo-priceline { position: relative; display: flex; align-items: baseline; gap: 10px; }
        .odo-price {
          font-family: var(--font-head); font-weight: 700;
          font-size: 34px; letter-spacing: -0.5px;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          display: inline-flex; align-items: baseline;
        }
        /* Each changed character is a two-cell column that slides up by half
           its own height. The slot clips it. */
        .odo-slot { display: inline-block; overflow: hidden; height: 1em; line-height: 1; }
        .odo-col { display: flex; flex-direction: column; }
        .odo-cell { height: 1em; line-height: 1; }
        .odo-static { display: inline-block; height: 1em; line-height: 1; }
        .odo-ghost {
          position: absolute; left: 0; top: -2px;
          font-family: var(--font-head); font-size: 15px;
          color: var(--text-faint); pointer-events: none;
        }
        .odo-step { font-size: 12.5px; color: var(--text-secondary); }
        .odo-count { font-variant-numeric: tabular-nums; }
        .odo-rings { display: flex; gap: 14px; }
        .odo-ring {
          position: relative; width: 44px;
          display: inline-flex; flex-direction: column; align-items: center;
        }
        .odo-num {
          position: absolute; top: 12px; left: 0; right: 0; text-align: center;
          font-family: var(--font-head); font-weight: 700; font-size: 13px;
          font-variant-numeric: tabular-nums;
        }
        .odo-lbl {
          margin-top: 2px; font-size: 9px; letter-spacing: 1px;
          text-transform: uppercase; color: var(--text-tertiary);
        }

        .odo-arc { transition: stroke-dashoffset 900ms linear; }
        .odo-sweep {
          transform-box: view-box; transform-origin: 50% 50%;
          animation: sweep 60s linear infinite;
        }
        .odo-live { animation: livedot 1.6s ease-in-out infinite; }
        .odo-urgent { animation: urgent 1s ease-in-out infinite; }

        @keyframes sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes livedot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }
        @keyframes urgent { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }

        /* ⚠️ A AND B ARE IDENTICAL ON PURPOSE. Alternating between them is what
           retriggers the animation on each bid; one class would only ever play
           once. See the component doc-block. */
        @keyframes rollA { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes rollB { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes flashA { 0% { color: var(--gold-tag-fill); } 55% { color: var(--gold-tag-fill); } 100% { color: var(--text-primary); } }
        @keyframes flashB { 0% { color: var(--gold-tag-fill); } 55% { color: var(--gold-tag-fill); } 100% { color: var(--text-primary); } }
        @keyframes ghostA { 0% { opacity: 0; transform: translateY(6px); } 22% { opacity: 1; transform: translateY(0); } 72% { opacity: 1; } 100% { opacity: 0; transform: translateY(-5px); } }
        @keyframes ghostB { 0% { opacity: 0; transform: translateY(6px); } 22% { opacity: 1; transform: translateY(0); } 72% { opacity: 1; } 100% { opacity: 0; transform: translateY(-5px); } }
        @keyframes edgeA { 0% { border-color: var(--gold-tag-fill); } 100% { border-color: var(--border); } }
        @keyframes edgeB { 0% { border-color: var(--gold-tag-fill); } 100% { border-color: var(--border); } }
        @keyframes stepA { 0% { transform: translateY(7px); opacity: 0.2; } 100% { transform: translateY(0); opacity: 1; } }
        @keyframes stepB { 0% { transform: translateY(7px); opacity: 0.2; } 100% { transform: translateY(0); opacity: 1; } }
        @keyframes countA { 0% { transform: scale(1.35); color: var(--gold-tag-fill); } 100% { transform: scale(1); color: var(--text-tertiary); } }
        @keyframes countB { 0% { transform: scale(1.35); color: var(--gold-tag-fill); } 100% { transform: scale(1); color: var(--text-tertiary); } }

        .rollA .odo-col   { animation: rollA 600ms var(--ease-odo) both; }
        .rollB .odo-col   { animation: rollB 600ms var(--ease-odo) both; }
        .rollA .odo-step  { animation: stepA 620ms var(--ease-odo) both; }
        .rollB .odo-step  { animation: stepB 620ms var(--ease-odo) both; }
        .rollA .odo-count { animation: countA 900ms ease-out both; display: inline-block; }
        .rollB .odo-count { animation: countB 900ms ease-out both; display: inline-block; }

        /* The decoration — flash, ghost and the panel edge — is what gets
           dropped when bids arrive faster than the animation. The digits still
           roll; the price just stops strobing. */
        .rollA:not(.odo-quiet) .odo-price { animation: flashA 1100ms ease-out both; }
        .rollB:not(.odo-quiet) .odo-price { animation: flashB 1100ms ease-out both; }
        .rollA:not(.odo-quiet) .odo-ghost { animation: ghostA 2100ms ease-out both; }
        .rollB:not(.odo-quiet) .odo-ghost { animation: ghostB 2100ms ease-out both; }
        .rollA:not(.odo-quiet) { animation: edgeA 1200ms ease-out both; }
        .rollB:not(.odo-quiet) { animation: edgeB 1200ms ease-out both; }

        /* Gentler, not zero. The NUMBERS still update every second — only the
           movement stops. Losing the countdown itself would be losing
           information, not motion. */
        @media (prefers-reduced-motion: reduce) {
          .odo-arc { transition: none; }
          .odo-sweep, .odo-live, .odo-urgent { animation: none; }
          .rollA .odo-col, .rollB .odo-col,
          .rollA .odo-step, .rollB .odo-step,
          .rollA .odo-count, .rollB .odo-count,
          .rollA .odo-price, .rollB .odo-price,
          .rollA .odo-ghost, .rollB .odo-ghost,
          .rollA, .rollB { animation: none; }
          .odo-col { transform: translateY(-50%); }
        }
      `}</style>
    </div>
  );
}
