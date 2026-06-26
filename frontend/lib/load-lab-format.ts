// Load Lab — display formatters. Every number shown in the Load Lab UI
// goes through one of these so rounding is consistent across the panel,
// the metric tiles, the charts, and the DOPE table.
//
// House rule (per spec): round every displayed number. Velocities and
// energies read as whole units; pressures to whole bar; angular drops to
// one decimal (MIL/MOA are read to 0.1 on a turret).

/** Speed of sound at sea level, ~15 °C, in fps — the divisor the spec
 *  fixes for the Mach readout. */
export const SPEED_OF_SOUND_FPS = 1116.4;

/** Mach number from a velocity in fps. */
export function machFromFps(v: number): number {
  return v / SPEED_OF_SOUND_FPS;
}

function round(n: number, decimals = 0): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Whole-number fps with a thousands separator + unit. */
export function fmtFps(v: number): string {
  return `${round(v).toLocaleString('en-ZA')} fps`;
}

/** Whole-number m/s + unit. */
export function fmtMps(v: number): string {
  return `${round(v).toLocaleString('en-ZA')} m/s`;
}

/** Whole-number bar + unit. */
export function fmtBar(v: number): string {
  return `${round(v).toLocaleString('en-ZA')} bar`;
}

/** Drop / windage in cm — one decimal under 10, whole above so the
 *  number stays compact at long range. */
export function fmtCm(v: number): string {
  const decimals = Math.abs(v) < 10 ? 1 : 0;
  return `${round(v, decimals).toLocaleString('en-ZA')} cm`;
}

/** Range in whole metres + unit. */
export function fmtMetres(v: number): string {
  return `${round(v).toLocaleString('en-ZA')} m`;
}

/** Angular value (MIL or MOA) to one decimal — turret-readable. */
export function fmtMil(v: number): string {
  return `${round(v, 1).toFixed(1)} mil`;
}

export function fmtMoa(v: number): string {
  return `${round(v, 1).toFixed(1)} MOA`;
}

/** Energy in whole joules with a thousands separator + unit. */
export function fmtJoules(v: number): string {
  return `${round(v).toLocaleString('en-ZA')} J`;
}

/** Whole-percentage string (no decimals — these are advisory). */
export function fmtPct(v: number): string {
  return `${round(v)}%`;
}

/** Milliseconds to two decimals — barrel time is sub-millisecond. */
export function fmtMs(v: number): string {
  return `${round(v, 2).toFixed(2)} ms`;
}

/** Mach to one decimal for chart/summary labels. */
export function fmtMach(v: number): string {
  return `Mach ${round(v, 1).toFixed(1)}`;
}

/** Bare rounded number (no unit) — for axis ticks / table cells that
 *  carry their unit in the column header. */
export function num(v: number, decimals = 0): string {
  return round(v, decimals).toLocaleString('en-ZA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
