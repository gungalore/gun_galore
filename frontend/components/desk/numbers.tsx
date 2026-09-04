'use client';

/**
 * THE DESK — the number surfaces: Ribbon, KPI, RailCard, Vital, Meter, Delta.
 *
 * One recipe shared by the Desk ribbon, the Pulse tiles and the rail: a label
 * in ink-3, a mono value, a quiet sub-line. Values are mono because the
 * operator reads them as data and sometimes copies them out.
 *
 * ⚠️ LABELS ARE NOT MONO. They used to be, on the reasoning that it kept a
 * label and its value in one visual family — which is the thing the
 * artboards reject. All five define .lbl in the sans face and reserve .mono
 * for data. A label is prose ABOUT a value, not another value.
 *
 * ⚠️ DELTAS ARE INK, NEVER GREEN OR RED. A month that is down 3% is not an
 * alarm and a month that is up 3% is not a success — they are numbers. The
 * four state colours are reserved for things that need the operator, and
 * spending them on a trend arrow is exactly how colour stops meaning anything.
 */
import * as React from 'react';

type StateTone = 'ok' | 'warn' | 'bad' | 'info' | 'unknown';

const TONE_INK: Record<StateTone, string> = {
  ok: 'var(--dk-ok)',
  warn: 'var(--dk-warn)',
  bad: 'var(--dk-bad)',
  info: 'var(--dk-info)',
  unknown: 'var(--dk-ink-4)',
};

/* ────────────────────────────────────────────────────────────────────────
 * Ribbon
 * ──────────────────────────────────────────────────────────────────────── */

export interface RibbonCell {
  label: string;
  /** Rendered in mono. Money arrives already formatted — see formatRand. */
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** A state dot before the value — the site cell, and nothing else so far. */
  dot?: StateTone;
}

export interface RibbonProps {
  cells: RibbonCell[];
  /** The phone ribbon — see the note on the scrolled strip below. */
  compact?: boolean;
}

export function Ribbon({ cells, compact = false }: RibbonProps) {
  /**
   * 🚨 ON A PHONE THE RIBBON SCROLLS SIDEWAYS. IT DOES NOT DIVIDE.
   *
   * The artboard (docs/design/desk-pwa/Main.dc.html) draws this as `.hs` — a
   * flex strip of `.stat` cards, each `min-width: 104px; flex: 0 0 auto`,
   * overflowing horizontally — and its comment says why: "Five figures,
   * scrolled sideways rather than stacked: they are a glance, not a screen."
   *
   * The grid below is right on a desktop and wrong on a phone. Five columns of
   * `minmax(0, 1fr)` across 390px is 78px each, and the value carries
   * overflow:hidden + text-overflow:ellipsis — so "R 191 400" renders as
   * "R 191…". A money figure truncated to look like a smaller money figure is
   * the worst thing this surface can do, and it does it silently.
   */
  if (compact) {
    return (
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          // The strip bleeds to both screen edges so the last cell is visibly
          // cut off — that is the affordance telling the operator it scrolls.
          margin: '0 -14px',
          padding: '0 14px',
          scrollbarWidth: 'none',
        }}
      >
        {cells.map((c, i) => (
          <div
            key={i}
            style={{
              minWidth: 104,
              flex: '0 0 auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '8px 10px',
              background: 'var(--dk-surface)',
              border: '1px solid var(--dk-line)',
              borderRadius: 'var(--dk-radius-control)',
            }}
          >
            {/* .stat .k in the artboard — sans, like every other label. */}
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--dk-ink-3)',
                whiteSpace: 'nowrap',
              }}
            >
              {c.label}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {c.dot ? <Dot tone={c.dot} /> : null}
              {/* No ellipsis here, deliberately — the cell grows to its number
                  and the strip scrolls, rather than the number being clipped
                  to fit a cell. */}
              <span
                className="dk-mono"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.1,
                  letterSpacing: '-0.01em',
                  color: 'var(--dk-ink)',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.value}
              </span>
            </span>
            {c.sub ? (
              <span style={{ fontSize: 10.5, color: 'var(--dk-ink-4)', whiteSpace: 'nowrap' }}>
                {c.sub}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
        // The cells are divided by their own left borders; clipping here is
        // what keeps the first and last from poking past the rounded corner.
        overflow: 'hidden',
      }}
    >
      {cells.map((c, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '14px 18px',
            minWidth: 0,
            borderLeft: i === 0 ? undefined : '1px solid var(--dk-line)',
          }}
        >
          <Label>{c.label}</Label>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {c.dot ? <Dot tone={c.dot} /> : null}
            <span
              className="dk-mono"
              style={{
                fontSize: 22,
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: '-0.01em',
                color: 'var(--dk-ink)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {c.value}
            </span>
          </span>
          {c.sub ? <Sub>{c.sub}</Sub> : null}
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * KPI — a Pulse tile
 * ──────────────────────────────────────────────────────────────────────── */

export interface KpiProps {
  label: string;
  value: React.ReactNode;
  /** "12%" — rendered in mono beside an arrow, in ink. */
  delta?: string;
  deltaDirection?: 'up' | 'down';
  /** "vs prior 30 days" */
  deltaContext?: string;
}

export function Kpi({ label, value, delta, deltaDirection = 'up', deltaContext }: KpiProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '14px 16px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
        minWidth: 0,
      }}
    >
      <Label>{label}</Label>
      <span
        className="dk-mono"
        style={{
          fontSize: 24,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: '-0.01em',
          color: 'var(--dk-ink)',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
      {delta ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Arrow direction={deltaDirection} />
          <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
            {delta}
          </span>
          {deltaContext ? <Sub>{deltaContext}</Sub> : null}
        </span>
      ) : null}
    </div>
  );
}

function Arrow({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--dk-ink-2)"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none', display: 'block' }}
    >
      {direction === 'up' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * RailCard — the desktop context rail
 * ──────────────────────────────────────────────────────────────────────── */

export function RailCard({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        // Raised, not surface: the rail sits beside the pile rather than in
        // it, and the one step of lightness is what says so without a rule.
        background: 'var(--dk-raised)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Label>{label}</Label>
        <span style={{ flex: 1 }} />
        {action}
      </div>
      {children}
    </div>
  );
}

/** A key/value row inside a rail card or a drawer section. */
export function Kv({
  k,
  v,
  mono = true,
  tone,
  last = false,
}: {
  k: React.ReactNode;
  v: React.ReactNode;
  /** Values that are data are mono; values that are prose are not. */
  mono?: boolean;
  tone?: StateTone;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '7px 0',
        borderBottom: last ? undefined : '1px solid var(--dk-line)',
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--dk-ink-3)', minWidth: 0 }}>{k}</span>
      <span style={{ flex: 1 }} />
      <span
        className={mono ? 'dk-mono' : undefined}
        style={{
          color: tone ? TONE_INK[tone] : 'var(--dk-ink)',
          fontWeight: 500,
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        {v}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Vital — one server measurement on the Site board
 * ──────────────────────────────────────────────────────────────────────── */

export interface VitalProps {
  label: string;
  value: React.ReactNode;
  tone?: StateTone;
  /** 0–1. Draws the meter instead of a sub-line. */
  fill?: number;
  sub?: React.ReactNode;
}

export function Vital({ label, value, tone = 'ok', fill, sub }: VitalProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 10,
        minWidth: 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <Dot tone={tone} />
        <Label>{label}</Label>
      </span>
      <span
        className="dk-mono"
        style={{ fontSize: 16, fontWeight: 500, lineHeight: 1, color: 'var(--dk-ink)' }}
      >
        {/* An unknown check reads as an em dash, never as a zero: "0% disk
            used" and "we could not measure the disk" are different facts. */}
        {tone === 'unknown' ? '—' : value}
      </span>
      {fill !== undefined ? <Meter value={fill} tone={tone} /> : sub ? <Sub>{sub}</Sub> : null}
    </div>
  );
}

export function Meter({ value, tone = 'ok' }: { value: number; tone?: StateTone }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: 4,
        borderRadius: 'var(--dk-radius-pill)',
        background: 'var(--dk-inset)',
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: TONE_INK[tone] }} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Shared bits
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A field label.
 *
 * ⚠️ THE SANS FACE, NOT MONO — and this reverses what the note at the top
 * of this file used to argue. All five artboards define .lbl identically
 * and none of them is mono: `font-size: 11px; letter-spacing: 0.07em;
 * text-transform: uppercase; color: #7F8885; font-weight: 500`. Mono is
 * `.mono`, and the artboards spend it on DATA — references, counts, money,
 * the things an operator reads as figures or copies out.
 *
 * The old reasoning ("it keeps the label and its value in one visual
 * family") is exactly what the artboards reject: the label is prose about
 * the value, not another value, and setting both in mono flattens the two
 * into one column of typewriter text.
 */
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--dk-ink-3)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  /**
   * ⚠️ TWO LINES, NOT ONE, AND THE WHOLE THING ON HOVER. This was
   * `whiteSpace: nowrap` with an ellipsis, which was right while the only
   * sub-label a vitals tile ever carried was the fixed "needs Warden on the
   * box". Now an unmeasured tile carries the REASON it is unmeasured —
   * "cannot read the access log — tail exited 1: … Permission denied" — and
   * one clipped line showed "Not measured — …", which is the half that says
   * nothing. The reason is the entire value of the tile when there is no
   * number in it.
   */
  const text = typeof children === 'string' ? children : undefined;
  return (
    <span
      title={text}
      style={{
        fontSize: 12,
        color: 'var(--dk-ink-3)',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        lineHeight: 1.35,
        minWidth: 0,
      }}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: StateTone }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 7,
        height: 7,
        flex: 'none',
        borderRadius: '50%',
        background: TONE_INK[tone],
      }}
    />
  );
}

/**
 * Money, the one way it is ever written on this surface: R12,480.
 *
 * ⚠️ TAKES INTEGER CENTS. Every amount on the Desk comes off the wire in
 * cents and stays an integer until this function; formatting a rand float is
 * how a ledger ends up 1c out on a row and nobody can say why.
 */
export function formatRand(cents: number): string {
  const whole = Math.round(cents / 100);
  return `R${whole.toLocaleString('en-ZA')}`;
}
