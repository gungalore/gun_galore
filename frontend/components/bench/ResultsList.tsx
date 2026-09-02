'use client';

/**
 * THE BENCH — the results list.
 *
 * The finder's answer: every load the member's shelf can build, grouped by
 * cartridge, then by bullet weight, then a row per load. Everything else on
 * the screen opens on top of this list.
 *
 * ⚠️ PRESENTATIONAL ONLY. It fetches nothing and owns no state; the page
 * hands it `result` and takes every action back through the callbacks in
 * ResultsListProps. The `off` chips live in the rail, not here.
 *
 * ⚠️ COPY. Operator ruling, 2026-09-02: nothing here may name where a figure
 * comes from. The two fixed strings are imported from contract.ts rather than
 * retyped, and the raw `error` message is deliberately NOT rendered — it is
 * uncontrolled text arriving from the network, and this surface has a hard
 * copy boundary (see the backend's leak spec).
 */

import type { CartridgeHead, LoadGroup, LoadRow } from '@/lib/bench/api';
import type { Dims, Units } from '@/lib/bench/geometry';
import { DIM_KEYS, coalCheck, fmtVelocity, MM_PER_INCH } from '@/lib/bench/geometry';

import { CartridgeThumb } from './CartridgeThumb';
import { BENCH_AXES, SAFETY_LINE, VELOCITY_NOTE } from './contract';
import type { BenchAxis, ResultsListProps } from './contract';
import { Btn, Tag } from './primitives';

/* ── Formatting ─────────────────────────────────────────────────────── */


/**
 * Thousands separated by a non-breaking space: `63 092 psi`.
 *
 * ⚠️ NOT toLocaleString('en-ZA'). Node and the browser disagree on which
 * space character en-ZA groups with, and the mismatch surfaces as a React
 * hydration error on a page that is otherwise perfectly fine. This is
 * deterministic in both.
 */
function grouped(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * "a bullet", "a bullet and a cartridge" — the missing axes as prose.
 *
 * Two items get "and", never a comma-only list: the empty state is one
 * sentence a member reads once, and three items is the all-missing case, which
 * has its own sentence.
 */
function axisList(axes: readonly string[]): string {
  const a = axes.map((x) => `a ${x}`);
  if (a.length <= 1) return a[0] ?? '';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

/**
 * A length in the member's primary unit only.
 *
 * The bracketed both-units form (`48.77 mm (1.920″)`) is right for prose and
 * for the spec card's table; in a 0.8fr grid cell it wraps to three lines and
 * a COAL range doubles that. Same call the spec makes for the drawing labels:
 * primary only where space is the constraint.
 */
function fmtLen(mm: number, units: Units): string {
  return units === 'imperial'
    ? `${(mm / MM_PER_INCH).toFixed(3)}″`
    : `${mm.toFixed(2)} mm`;
}

/** Pressure, both units, member's first. */
function fmtPmax(bar: number | null, psi: number | null, units: Units): string | null {
  if (bar !== null && psi !== null) {
    return units === 'imperial'
      ? `Pmax ${grouped(psi)} psi (${grouped(bar)} bar)`
      : `Pmax ${grouped(bar)} bar (${grouped(psi)} psi)`;
  }
  if (bar !== null) return `Pmax ${grouped(bar)} bar`;
  if (psi !== null) return `Pmax ${grouped(psi)} psi`;
  return null;
}

/**
 * `12 loads from your bench · Pmax 4 350 bar (63 092 psi) · max COAL 71.12 mm`
 *
 * Each segment is dropped rather than faked when its figure is missing — a
 * cartridge whose sheet is incomplete shows a shorter line, never a zero.
 */
function groupMeta(head: CartridgeHead, loadCount: number, units: Units): string {
  const parts: string[] = [`${loadCount} load${loadCount === 1 ? '' : 's'} from your bench`];
  const pmax = fmtPmax(head.pmaxBar, head.pmaxPsi, units);
  if (pmax) parts.push(pmax);
  if (head.maxLengthMm !== null) parts.push(`max COAL ${fmtLen(head.maxLengthMm, units)}`);
  return parts.join(' · ');
}

/** The row's COAL cell: a range where the load prints one, else the single value. */
function coalText(row: LoadRow, units: Units): string {
  const lo = row.coalLoMm ?? row.coalMm;
  const hi = row.coalHiMm;
  if (lo !== null && hi !== null && hi > lo) {
    return units === 'imperial'
      ? `${(lo / MM_PER_INCH).toFixed(3)}–${(hi / MM_PER_INCH).toFixed(3)}″`
      : `${lo.toFixed(2)}–${hi.toFixed(2)} mm`;
  }
  const one = row.coalMm ?? lo ?? hi;
  return one === null ? '—' : fmtLen(one, units);
}

/** `35.6 gr · 732 m/s (2400 fps)`, velocity omitted where the load prints none. */
function chargeVelocity(fps: number | null, units: Units): string | null {
  return fps === null ? null : fmtVelocity(fps, units);
}

interface FlagTag {
  t: string;
  warn: boolean;
}

/**
 * The row's flags.
 *
 * ⚠️ THE SERVER DECIDES WHICH FLAGS EXIST; coalCheck only supplies the number
 * inside the label. Re-deriving the set here would let the list disagree with
 * the load card and the log over a rounding step.
 */
function tagsFor(row: LoadRow, maxLengthMm: number | null): FlagTag[] {
  const out: FlagTag[] = [];
  const over = row.flags.includes('COAL_OVER_MAX');
  const near = row.flags.includes('COAL_NEAR_MAX');

  if (over || near) {
    const fallback = over ? 'COAL OVER MAX' : 'COAL NEAR MAX';
    // The prototype measures the top of the range: a load printed 71.12–71.63
    // is judged on 71.63, the longest round it tells you to build.
    const coal = row.coalHiMm ?? row.coalMm;
    const text =
      coal !== null && maxLengthMm !== null ? coalCheck(coal, maxLengthMm).t : '';
    out.push({ t: text || fallback, warn: true });
  }
  if (row.flags.includes('COAL_RANGE')) out.push({ t: 'COAL RANGE', warn: false });
  return out;
}

/**
 * The head's thirteen figures, nulls dropped.
 *
 * `CartridgeHead.thumb` is a loose `Record<string, number | null>`; the
 * drawing wants `Partial<Dims>`, and `canDraw()` — not this — decides whether
 * a silhouette can be drawn at all. Dropping the nulls here is the whole
 * conversion: a missing figure must arrive as absent, not as null.
 */
function dimsOf(thumb: CartridgeHead['thumb']): Partial<Dims> | null {
  if (!thumb) return null;
  const out: Partial<Dims> = {};
  for (const k of DIM_KEYS) {
    const v = thumb[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/* ── Leaves ─────────────────────────────────────────────────────────── */

function Chev({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function Tags({ tags }: { tags: FlagTag[] }) {
  return (
    <>
      {tags.map((f) => (
        <Tag key={f.t} warn={f.warn}>
          {f.t}
        </Tag>
      ))}
    </>
  );
}

/**
 * A charge figure: the number, then `gr`, then the velocity.
 *
 * `weight` differs between the two tiles — start is 500, max is 600 — which
 * is the only thing that separates them at a glance on a dense row.
 */
function Charge({
  gr,
  velocity,
  weight,
}: {
  gr: number;
  velocity: string | null;
  weight: 500 | 600;
}) {
  return (
    <div className="num leading-tight">
      <span style={{ fontWeight: weight }}>{gr.toFixed(1)}</span>{' '}
      <span style={{ color: 'var(--text-tertiary)', fontSize: '11.5px' }}>gr</span>
      {velocity ? (
        <>
          {' '}
          <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
            · {velocity}
          </span>
        </>
      ) : null}
    </div>
  );
}

/* ── States ─────────────────────────────────────────────────────────── */

/**
 * Six skeleton rows.
 *
 * The desktop variant borrows `.cols` rather than restating the seven-column
 * template: bench.css warns that `.row` and `.cols` must stay in step, and a
 * third copy of that string is a third thing to forget.
 *
 * `.gg-skeleton` is built entirely from `--bg-card`, which is exactly the
 * panel behind it, so an un-touched bar is white on white and the panel just
 * looks empty while it loads.
 *
 * ⚠️ BOTH BACKGROUND LONGHANDS HAVE TO BE OVERRIDDEN, NOT JUST THE COLOUR.
 * At rest the class sets `background: var(--bg-card)` and an inline
 * background-color is enough. Under the default `prefers-reduced-motion:
 * no-preference` branch — which is most people — it instead sets an OPAQUE
 * linear-gradient, and a background-image paints over the background-color,
 * so a colour-only override is invisible to everyone who has not asked for
 * reduced motion. The gradient is therefore restated off the inset tokens.
 * `background-size` and the shimmer keyframes still come from the class, so
 * the sweep is unchanged.
 */
function SkeletonRows() {
  const bar: React.CSSProperties = {
    backgroundColor: 'var(--bg-inset)',
    backgroundImage:
      'linear-gradient(90deg, var(--bg-inset) 0%, var(--border-divider) 50%, var(--bg-inset) 100%)',
  };
  return (
    <div aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <div className="hidden md:block">
            <div className="cols">
              <div className="gg-skeleton h-[14px] w-[80%]" style={bar} />
              <div className="gg-skeleton h-[14px] w-[70%]" style={bar} />
              <div className="gg-skeleton h-[14px] w-[85%]" style={bar} />
              <div className="gg-skeleton h-[14px] w-[85%]" style={bar} />
              <div className="gg-skeleton h-[14px] w-[65%]" style={bar} />
              <div className="gg-skeleton h-[14px] w-[45%]" style={bar} />
              <div />
            </div>
          </div>
          <div
            className="md:hidden"
            style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--border-divider)' }}
          >
            <div className="gg-skeleton h-[13px] w-[62%]" style={bar} />
            <div className="mt-2 grid grid-cols-2 gap-[6px]">
              <div className="gg-skeleton h-[34px]" style={bar} />
              <div className="gg-skeleton h-[34px]" style={bar} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-[10px] p-6 text-center"
      style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}
    >
      {children}
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div className="head" style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
      {children}
    </div>
  );
}

/* ── The list ───────────────────────────────────────────────────────── */

export function ResultsList({
  units,
  result,
  loading,
  error,
  onOpenLoad,
  onOpenSpec,
  onRetry,
  gaps,
  onAddPowder,
  onAddBullet,
  onAddCartridge,
}: ResultsListProps) {
  const groups = result?.groups ?? [];
  const isEmpty = !loading && !error && groups.length === 0;

  // The bare axes, in the rail's order, so the sentence and the button below
  // always name the same one.
  const missing = BENCH_AXES.filter((a) => gaps[a]);
  const opener: Record<BenchAxis, () => void> = {
    powder: onAddPowder,
    bullet: onAddBullet,
    cartridge: onAddCartridge,
  };
  // Nothing missing means the filter is what is too narrow; the button is then
  // a fallback rather than the advice, and a powder is the cheapest thing to
  // widen a bench with.
  const cta: BenchAxis = missing[0] ?? 'powder';

  return (
    <section className="flex min-h-0 flex-1 flex-col md:gap-[10px] md:pb-4">
      {/* Count + the one velocity note on the screen. */}
      <div className="flex items-baseline gap-3 px-3 pb-2 md:items-center md:px-0 md:pb-0">
        <div className="text-[13px] md:text-[14px]">
          {result ? (
            <>
              <span className="num" style={{ fontWeight: 600 }}>
                {result.count}
              </span>
              <span className="md:hidden"> load{result.count === 1 ? '' : 's'} from your bench</span>
              <span className="hidden md:inline">
                {' '}
                load{result.count === 1 ? '' : 's'} can be built from your bench{' '}
              </span>
              <span className="hidden md:inline" style={{ color: 'var(--text-tertiary)' }}>
                · {groups.length} cartridge{groups.length === 1 ? '' : 's'}
              </span>
            </>
          ) : null}
        </div>
        <div
          className="ml-auto text-[11.5px] md:text-[12px]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {VELOCITY_NOTE}
        </div>
      </div>

      {/* The panel scrolls on its own; the page never scrolls under it. */}
      <div
        className="scroll mx-3 min-h-0 flex-1 md:mx-0"
        style={{
          border: '0.5px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--bg-card)',
        }}
      >
        {loading ? (
          <>
            <span className="sr-only" role="status">
              Loading loads
            </span>
            <SkeletonRows />
          </>
        ) : error ? (
          <div role="alert">
            <Centred>
              <Title>The bench could not load.</Title>
              {/* The raw message stays out of the DOM on purpose — see the file header. */}
              <div>Check your connection, then try again.</div>
              {/* size="mobile" at every width: this is the only control in an
                  otherwise empty panel, and §9's 44px tap target cannot be set
                  responsively — `.bench .btn`'s height outranks a utility. */}
              <Btn size="mobile" onClick={onRetry}>
                Try again
              </Btn>
            </Centred>
          </div>
        ) : isEmpty ? (
          <Centred>
            {/*
              ⚠️ THE BENCH IS AN *AND* ACROSS THREE AXES — powder, bullet AND
              cartridge — so a shelf holding two of the three yields nothing at
              all, and "Add a powder" is then actively wrong advice: it sends
              someone to the one axis they have already filled, where adding
              another changes nothing. Three states, not two, because the fix
              differs: no bench at all, a bench short of one axis, and a bench
              that can build things the current filter excludes.
            */}
            {missing.length === 3 ? (
              <>
                <Title>Nothing on the bench yet</Title>
                <div>
                  A load needs all three: a powder, a bullet and a cartridge. Add one of each and
                  what your shelf can build appears here.
                </div>
              </>
            ) : missing.length > 0 ? (
              <>
                <Title>Your bench is missing {axisList(missing)}</Title>
                <div>
                  A load needs all three: a powder, a bullet and a cartridge. Add {axisList(missing)}{' '}
                  and what your shelf can build appears here.
                </div>
              </>
            ) : (
              <>
                <Title>Nothing on the shelf builds this</Title>
                <div>Turn a chip back on, widen the weight range, or add another component.</div>
              </>
            )}
            {/* Opens the picker for the axis the sentence just named. */}
            <Btn size="mobile" onClick={opener[cta]}>
              Add a {cta}
            </Btn>
          </Centred>
        ) : (
          groups.map((group) => (
            <Group
              key={group.cartridge.key}
              group={group}
              units={units}
              onOpenLoad={onOpenLoad}
              onOpenSpec={onOpenSpec}
            />
          ))
        )}
      </div>

      <div
        className="px-3 pb-2.5 pt-2 text-[11px] leading-[1.4] md:p-0 md:text-[11.5px]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {SAFETY_LINE}
      </div>
    </section>
  );
}

/* ── A cartridge group ──────────────────────────────────────────────── */

function Group({
  group,
  units,
  onOpenLoad,
  onOpenSpec,
}: {
  group: LoadGroup;
  units: Units;
  onOpenLoad: ResultsListProps['onOpenLoad'];
  onOpenSpec: ResultsListProps['onOpenSpec'];
}) {
  const head = group.cartridge;
  const dims = dimsOf(head.thumb);
  const loadCount = group.weights.reduce((n, w) => n + w.rows.length, 0);
  const meta = groupMeta(head, loadCount, units);

  // The rise stagger counts rows across the whole group, restarting at each
  // cartridge — the prototype's `idx`, which is declared per group.
  let idx = 0;

  return (
    <>
      <button type="button" className="grp" onClick={() => onOpenSpec(head.key)}>
        {/* Mobile: thumb, stacked name + meta, a plain chevron. */}
        <span className="flex w-full items-center gap-[10px] md:hidden">
          <CartridgeThumb dims={dims} size="mobile" />
          <span className="min-w-0 flex-1 text-left">
            <span className="head block" style={{ fontSize: '15px' }}>
              {head.name}
            </span>
            <span
              className="num block truncate"
              style={{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}
            >
              {meta}
            </span>
          </span>
          <span className="sr-only">Spec card</span>
          <Chev color="var(--text-faint)" />
        </span>

        {/* Desktop: thumb slides, "Spec card ›" fades in on hover. */}
        <span className="hidden w-full items-center gap-[14px] md:flex">
          <CartridgeThumb dims={dims} size="desktop" className="thumb" />
          <span className="head" style={{ fontSize: '16px' }}>
            {head.name}
          </span>
          <span
            className="num min-w-0 truncate"
            style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}
          >
            {meta}
          </span>
          <span
            className="go ml-auto inline-flex items-center gap-1"
            style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--link)' }}
          >
            Spec card
            <Chev size={14} />
          </span>
        </span>
      </button>

      {/* The seven column headings; the mobile card labels its own tiles. */}
      <div className="hidden md:block">
        <div className="cols">
          <div>Bullet</div>
          <div>Powder</div>
          <div>Start charge</div>
          <div>Max charge</div>
          <div>COAL</div>
          <div>Flags</div>
          <div />
        </div>
      </div>

      {group.weights.map((w) => (
        <div key={w.weightGr}>
          <div className="wt num">{w.weightGr} gr</div>
          {w.rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              group={group}
              weightGr={w.weightGr}
              units={units}
              delayMs={idx++ * 35}
              onOpenLoad={onOpenLoad}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/* ── One load ───────────────────────────────────────────────────────── */

function Row({
  row,
  group,
  weightGr,
  units,
  delayMs,
  onOpenLoad,
}: {
  row: LoadRow;
  group: LoadGroup;
  weightGr: number;
  units: Units;
  delayMs: number;
  onOpenLoad: ResultsListProps['onOpenLoad'];
}) {
  const bullet = `${row.bulletMaker} ${row.bulletType} ${weightGr} gr`;
  const startV = chargeVelocity(row.startFps, units);
  const maxV = chargeVelocity(row.maxFps, units);
  const coal = coalText(row, units);
  const tags = tagsFor(row, group.cartridge.maxLengthMm);
  const open = () => onOpenLoad(row, group);

  const tile: React.CSSProperties = {
    padding: '6px 8px',
    borderRadius: 'var(--r-sm)',
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
  };
  const tileLabel: React.CSSProperties = {
    fontSize: '10px',
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  };

  return (
    <>
      {/* Two variants, one visible.
          ⚠️ THE WRAPPERS CARRY THE BREAKPOINT, NOT THE BUTTONS. `.bench .row`
          sets `display` at 0-2-0, which outranks Tailwind's `.hidden`, so
          `hidden md:grid` on the button itself silently does nothing. The
          mobile card overrides display inline, where nothing outranks it. */}
      <div className="hidden md:block">
        <button
          type="button"
          className="row"
          style={{ animationDelay: `${delayMs}ms` }}
          onClick={open}
        >
          <div>{bullet}</div>
          <div style={{ fontWeight: 500 }}>{row.powder}</div>
          <Charge gr={row.startGr} velocity={startV} weight={500} />
          <Charge gr={row.maxGr} velocity={maxV} weight={600} />
          <div className="num" style={{ fontSize: '12.5px' }}>
            {coal}
          </div>
          <div className="flex flex-wrap gap-1">
            <Tags tags={tags} />
          </div>
          <div className="chev">
            <Chev />
          </div>
        </button>
      </div>

      <div className="md:hidden">
        <button
          type="button"
          className="row"
          style={{ display: 'block', animationDelay: `${delayMs}ms` }}
          onClick={open}
        >
          <div className="flex items-baseline gap-2">
            <span style={{ fontSize: '14px', fontWeight: 500 }}>{row.powder}</span>
            <span
              className="truncate"
              style={{ fontSize: '12px', color: 'var(--text-secondary)' }}
            >
              {bullet}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-[6px]">
            <div style={tile}>
              <div style={tileLabel}>Start</div>
              <div className="num mt-px" style={{ fontSize: '15px', fontWeight: 500 }}>
                {row.startGr.toFixed(1)}{' '}
                <span
                  style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}
                >
                  gr{startV ? ` · ${startV}` : ''}
                </span>
              </div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Max</div>
              <div className="num mt-px" style={{ fontSize: '15px', fontWeight: 600 }}>
                {row.maxGr.toFixed(1)}{' '}
                <span
                  style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}
                >
                  gr{maxV ? ` · ${maxV}` : ''}
                </span>
              </div>
            </div>
          </div>

          <div
            className="mt-2 flex items-center gap-[6px]"
            style={{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}
          >
            <span className="num">COAL {coal}</span>
            <div className="ml-auto flex gap-1">
              <Tags tags={tags} />
            </div>
          </div>
        </button>
      </div>
    </>
  );
}
