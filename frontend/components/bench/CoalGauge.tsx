'use client';

/**
 * THE BENCH — the COAL gauge.
 *
 * Ported from the load card's COAL block in the design prototype
 * (`Main.dc.html`). The track is a fixed 4 mm window that ENDS at the
 * cartridge's maximum length, so the eye reads "how close am I to the
 * ceiling" rather than "how long is this round" — the number that matters
 * when seating a bullet is the clearance, not the absolute.
 *
 * ⚠️ THE VERDICT AND THE AMBER ZONE MUST AGREE. Both come off the same
 * COAL_NEAR_MAX_MM constant in lib/bench/geometry; if the zone were written
 * as a literal 12.5% it would silently drift the day that threshold moves,
 * and the gauge would show a green pin sitting inside an amber band.
 */

import type { CSSProperties } from 'react';
import type { CoalGaugeProps } from '@/components/bench/contract';
import { COAL_NEAR_MAX_MM, coalCheck, type Units, MM_PER_INCH } from '@/lib/bench/geometry';

/** The visible run of the track, in millimetres: from L6 − 4 mm up to L6. */
const SPAN_MM = 4;

/** The last COAL_NEAR_MAX_MM of the track, as a percentage of the span. */
const ZONE_PCT = (COAL_NEAR_MAX_MM / SPAN_MM) * 100;


/**
 * A length with the member's preferred unit first.
 *
 * Metric keeps the prototype's bare `71.63 mm`: the row already carries two
 * figures and C.I.P. lengths are millimetre figures to begin with. Imperial
 * leads with inches and brackets the millimetres, per the units rule.
 */
function fmtLen(mm: number, units: Units): string {
  if (units === 'imperial') {
    return `${(mm / MM_PER_INCH).toFixed(3)}″ (${mm.toFixed(2)} mm)`;
  }
  return `${mm.toFixed(2)} mm`;
}

/** The same, for a load whose COAL is a band rather than one figure. */
function fmtBand(lo: number, hi: number, units: Units): string {
  if (units === 'imperial') {
    return `${(lo / MM_PER_INCH).toFixed(3)}–${(hi / MM_PER_INCH).toFixed(3)}″ (${lo.toFixed(2)}–${hi.toFixed(2)} mm)`;
  }
  return `${lo.toFixed(2)}–${hi.toFixed(2)} mm`;
}

const labelRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  marginBottom: 6,
};

const readoutRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  fontSize: 12,
  color: 'var(--text-secondary)',
};

export default function CoalGauge({
  units,
  coalMm,
  maxLengthMm,
  coalLoMm,
  coalHiMm,
}: CoalGaugeProps) {
  // The two ends of the band, when the load's COALs spread far enough for
  // the backend to have set them. Both optional AND nullable on the wire, so
  // they are narrowed once here rather than at every use.
  const bandLo = coalLoMm ?? null;
  const bandHi = coalHiMm ?? null;
  const hasBand = bandLo !== null && bandHi !== null;

  // The HIGHEST COAL in the group is what gets checked and where the pin
  // sits: it is the end of the band nearest the ceiling, and the one that
  // decides whether the load needs a second look.
  const hi = bandHi ?? coalMm;

  // ⚠️ ONE READING, BOTH BRANCHES. Built before the no-maximum bail-out so a
  // banded load reads as a band whether or not the cartridge has an L6.
  // Reading `coalMm` alone in the fallback silently collapsed 70.40–71.60 mm
  // to the single representative figure, and the same load then said two
  // different things depending on a field it does not depend on.
  const reading =
    hi === null
      ? 'No COAL for this load.'
      : hasBand
        ? `COAL ${fmtBand(bandLo, bandHi, units)}`
        : `COAL ${fmtLen(hi, units)}`;

  // Without the maximum there is no scale at all, so the gauge is not drawn
  // half-built — a track with no ceiling invites the eye to read a position
  // that means nothing.
  if (maxLengthMm === null) {
    return (
      <div>
        <div style={labelRow}>
          <span>COAL against the maximum</span>
        </div>
        <div style={readoutRow}>
          <span className="num">{reading}</span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            The maximum is not available for this cartridge.
          </span>
        </div>
      </div>
    );
  }

  const pctOf = (mm: number) =>
    Math.max(0, Math.min(100, (1 - (maxLengthMm - mm) / SPAN_MM) * 100));

  const check = hi === null ? null : coalCheck(hi, maxLengthMm);
  const ink = check?.bad ? 'var(--warning)' : 'var(--success)';

  // The clearance stays in millimetres in both unit modes. A 0.13 mm margin
  // rendered as 0.005″ reads as noise, and this line is the one a reloader
  // acts on.
  // ⚠️ `check.over`, NEVER `check.diff < 0`. A round a hair past the maximum
  // rounds to -0, and -0 < 0 is false — so the sign test printed "0.00 mm
  // under the maximum · check" for a round that is over it. coalCheck takes
  // that decision on the unrounded difference and says so here.
  const verdict =
    check === null
      ? ''
      : check.over
        ? `${Math.abs(check.diff).toFixed(2)} mm over the maximum`
        : `${check.diff.toFixed(2)} mm under the maximum${check.bad ? ' · check' : ''}`;

  return (
    <div>
      <div style={labelRow}>
        <span>COAL against the maximum</span>
        <span className="num" style={{ textTransform: 'none', letterSpacing: 0 }}>
          max {fmtLen(maxLengthMm, units)}
        </span>
      </div>

      {/* Decorative: every figure it draws is spelled out in the readout row
          below, so a screen reader gains nothing from the geometry. */}
      <div style={{ position: 'relative', height: 26 }} aria-hidden="true">
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 11,
            height: 4,
            borderRadius: 2,
            background: 'var(--border-divider)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 11,
            width: `${ZONE_PCT}%`,
            height: 4,
            borderRadius: '0 2px 2px 0',
            background: 'var(--gold-line)',
          }}
        />
        {hasBand && (
          <div
            style={{
              position: 'absolute',
              left: `${pctOf(bandLo)}%`,
              width: `${Math.max(0, pctOf(bandHi) - pctOf(bandLo))}%`,
              top: 11,
              height: 4,
              borderRadius: 2,
              // color-mix rather than an alpha suffix: `var(--success)55` is
              // an invalid colour and computes to transparent.
              background: `color-mix(in srgb, ${ink} 38%, transparent)`,
            }}
          />
        )}
        <div
          style={{
            position: 'absolute',
            right: -1,
            top: 4,
            width: 2,
            height: 18,
            background: 'var(--text-primary)',
          }}
        />
        {hi !== null && (
          <div
            className="coalpin"
            style={{
              position: 'absolute',
              left: `${pctOf(hi)}%`,
              top: 7,
              width: 12,
              height: 12,
              marginLeft: -6,
              borderRadius: 6,
              background: ink,
              border: '2px solid var(--bg-card)',
              // The prototype rings the pin with `box-shadow: 0 0 0 1px`.
              // globals.css kills every box-shadow, so the ring is an
              // outline — same 1px, drawn outside the white border.
              outline: `1px solid ${ink}`,
            }}
          />
        )}
      </div>

      <div style={readoutRow}>
        <span className="num">{reading}</span>
        {verdict && (
          <span className="num" style={{ color: ink, fontWeight: 500 }}>
            {verdict}
          </span>
        )}
      </div>

      {/* ⚠️ SAID ONCE, WHERE THE COMPARISON IS MADE. The gauge measures against
          the cartridge's own maximum and nothing else — it knows nothing about
          the throat this round will be chambered in or the magazine it has to
          fit. The spec card carries the same caution as "The cartridge
          standard, not your rifle."; the load card had no counterpart, so a
          green pin read as "this length is fine in your rifle". */}
      <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
        Measured against the cartridge maximum. Your chamber and magazine decide the usable
        length.
      </p>
    </div>
  );
}
