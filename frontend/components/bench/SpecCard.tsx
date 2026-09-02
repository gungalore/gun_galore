'use client';

/**
 * THE BENCH — the cartridge spec card.
 *
 * Desktop: the 720px sheet from the right (`Main.dc.html`, "Spec card
 * slide-over"). Phone: the same content full-screen behind its own 54px
 * header (`Pwa.dc.html`, "Spec card, pushed in").
 *
 * Sections, in order: the view segmented control (2D · 3D lathe · Half
 * section), the drawing, Dimensions, For the reloader, Loads.
 *
 * ⚠️ NOTHING HERE NAMES WHERE A FIGURE COMES FROM. Operator ruling
 * 2026-09-02, restated at the foot of contract.ts. That is also why the two
 * chamber rows under "For the reloader" print a bracketed placeholder until
 * a chamber figure is actually in the payload: there is no arithmetic that
 * turns a cartridge maximum into a chamber minimum, and a plausible-looking
 * number in that row is the one thing on this card somebody could cut steel
 * against.
 */

import dynamic from 'next/dynamic';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import { DIM_KEYS, canDraw, type Dims, type Units, MM_PER_INCH } from '@/lib/bench/geometry';

import { CartridgeDrawing2D } from './CartridgeDrawing2D';
import type { LatheViewProps, SpecCardProps, SpecView } from './contract';
import { Btn, cx, IconX, OverlayShell, Seg, type BenchSize, usePhone } from './primitives';

/* ── Phone vs desktop ───────────────────────────────────────────────── */

/**
 * SPEC §5.4: the frame flips at 768, and the installed app is always the
 * phone frame whatever the window reports.
 *
 * ⚠️ COPIED FROM LoadCard.tsx, WHICH IS NOT EXPORTED. Two overlays now carry
 * the same twelve lines; the right home is primitives.tsx, next to
 * OverlayShell. Hoisting it is a one-file change and a note for whoever
 * touches the module next — it is duplicated here rather than reached into
 * LoadCard's private scope.
 */

/* ── The lathe, loaded on demand ────────────────────────────────────── */

/**
 * three.js is several hundred kilobytes. It must never ride in the bundle a
 * member downloads to read a table of figures, so the 3D views are the only
 * thing that pulls it and they pull it on the first switch. `ssr: false`
 * because there is no WebGL context on the server.
 *
 * ⚠️ NOT `import three` ANYWHERE AT MODULE SCOPE. A static import here would
 * put the whole renderer in the finder's first paint.
 */
const LatheView = dynamic<LatheViewProps>(
  () =>
    import('./LatheView').then((m: Record<string, unknown>) => {
      // The sibling is written against LatheViewProps, not against an export
      // style; taking either shape means a named-only export degrades to the
      // 2D fallback instead of an empty well.
      const C = (m.default ?? m.LatheView) as React.ComponentType<LatheViewProps> | undefined;
      if (!C) throw new Error('LatheView has no component export');
      return C;
    }),
  { ssr: false, loading: () => <ViewSkeleton /> },
);

/**
 * The 3D view's blast door.
 *
 * A chunk that fails to load — a flaky connection, a service worker holding a
 * stale manifest after a deploy — rejects inside render, and without a
 * boundary that takes the whole spec card down with it. Everything this card
 * is actually for is in the table below, so the failure costs the member the
 * 3D option and nothing else.
 */
class LatheBoundary extends React.Component<
  { onFail: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ── WebGL ──────────────────────────────────────────────────────────── */

/**
 * Does this browser hand out a WebGL context at all?
 *
 * ⚠️ THE PROBE CONTEXT IS GIVEN STRAIGHT BACK, AND THE ANSWER IS CACHED.
 * A probe that keeps its context is not free: the browser holds a small pool
 * (Chrome ~16) and silently force-loses the OLDEST live context when it runs
 * dry. Opening this card once per cartridge burns a slot each time, and the
 * oldest live context by then is the lathe's own renderer — which goes black
 * with no error anywhere and no way to tell it from a broken drawing.
 * WEBGL_lose_context returns the slot immediately; the module-level answer
 * means twenty openings probe once.
 */
let webglSupport: boolean | null = null;

function probeWebgl(): boolean {
  if (webglSupport !== null) return webglSupport;
  let ok = false;
  try {
    const c = document.createElement('canvas');
    // Structurally typed rather than as WebGL(2)RenderingContext: the two
    // contexts disagree about several overloads, and the only thing wanted
    // here is whether one exists and how to hand it back.
    const gl: { getExtension(name: string): unknown } | null =
      c.getContext('webgl2') ?? c.getContext('webgl');
    ok = Boolean(gl);
    const lose = gl?.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null;
    lose?.loseContext?.();
  } catch {
    ok = false;
  }
  webglSupport = ok;
  return ok;
}

/* ── Copy ───────────────────────────────────────────────────────────── */

const DRAW_NOTE =
  'Drawn to scale. The bullet ogive is illustrative: only the bullet diameter G1 and the overall length L6 are fixed.';

const LATHE_NOTE_DESKTOP =
  'Drag to spin, drag up or down to tilt. The ring snaps to each station and reads the diameter there; a snapped station lights up its row in the table. Half section shows the wall, the web and the seated bullet.';

const LATHE_NOTE_PHONE =
  'Drag to spin, up or down to tilt. Slide the calliper along the axis; it snaps to each station and reads the diameter there. Half section shows the wall, the web and the seated bullet.';

const SHELL_NOTE_DESKTOP =
  "Same shell holder as the cartridges above, grouped by rim R1, thickness R and groove E1. No manufacturer's number is claimed.";

const SHELL_NOTE_PHONE = "Same shell holder as the cartridges above. No manufacturer's number is claimed.";

/* ── Units ──────────────────────────────────────────────────────────── */


/** Primary unit with the other in brackets. House rule, SPEC §2. */
function both(v: number, units: Units): string {
  const mm = `${v.toFixed(2)} mm`;
  const inch = `${(v / MM_PER_INCH).toFixed(3)}″`;
  return units === 'imperial' ? `${inch} (${mm})` : `${mm} (${inch})`;
}

/**
 * 63092 → "63 092".
 *
 * Hand-rolled rather than toLocaleString, because this component renders on
 * the server and again on the client and the two ICU builds disagree about
 * the group separator (space vs non-breaking space). That disagreement is a
 * hydration mismatch on a pressure figure.
 */
function group(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Twist as the sheet reads it: 203 mm is 1:8″. */
function twistText(mm: number, units: Units): string {
  const turns = mm / MM_PER_INCH;
  const whole = Math.round(turns);
  const inch = `1:${Math.abs(turns - whole) < 0.05 ? whole : turns.toFixed(1)}″`;
  const metric = `${Math.round(mm)} mm`;
  return units === 'imperial' ? `${inch} (${metric})` : `${metric} (${inch})`;
}

/* ── The Dimensions table ───────────────────────────────────────────── */

/** In the order the drawing reads them; α is appended separately below. */
const DIM_ROWS: readonly { k: string; label: string }[] = [
  { k: 'R1', label: 'Rim diameter' },
  { k: 'R', label: 'Rim thickness' },
  { k: 'E1', label: 'Extractor groove diameter' },
  { k: 'E', label: 'Base to end of groove' },
  { k: 'P1', label: 'Body diameter at base' },
  { k: 'P2', label: 'Body diameter at shoulder' },
  { k: 'L1', label: 'Base to shoulder' },
  { k: 'L2', label: 'Base to neck' },
  { k: 'L3', label: 'Case length' },
  { k: 'H1', label: 'Neck diameter at shoulder' },
  { k: 'H2', label: 'Neck diameter at mouth' },
  { k: 'G1', label: 'Bullet diameter' },
  { k: 'L6', label: 'Max cartridge length' },
];

/* ── Small pieces ───────────────────────────────────────────────────── */

/** The 560×250 drawing well, held open while the figures are in flight. */
function ViewSkeleton() {
  return (
    <div
      className="gg-skeleton"
      style={{ width: '100%', aspectRatio: '560 / 250', borderRadius: 'var(--r-sm)' }}
      aria-hidden="true"
    />
  );
}

const PANEL: React.CSSProperties = {
  border: '0.5px solid var(--border)',
  borderRadius: 'var(--r-md)',
};

const NOTE: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--text-tertiary)',
  lineHeight: 1.4,
};

/**
 * The letter column.
 *
 * ⚠️ THE LIT COLOUR IS DECIDED HERE, NOT LEFT TO bench.css. An inline `color`
 * beats any stylesheet rule short of !important, so `.bench .kv.hot .k
 * { color: var(--red) }` can never win against this object: with a flat grey
 * written in, a hot row changed its wash and kept a grey letter. Both states
 * are tokens; neither is a colour written out.
 */
function keyCell(phone: boolean, hot = false): React.CSSProperties {
  return {
    width: phone ? 40 : 44,
    flex: 'none',
    fontSize: 12,
    color: hot ? 'var(--red)' : 'var(--text-secondary)',
  };
}

const VALUE_CELL: React.CSSProperties = { fontWeight: 500, whiteSpace: 'nowrap' };

/**
 * One Dimensions row.
 *
 * A <button>, not a div: the link between table and drawing is the point of
 * this table, and a phone has no hover to make it with. Hover, focus and tap
 * all set the same letter, which is what lights the drawing.
 */
function DimRow({
  k,
  label,
  value,
  hot,
  onHot,
  phone,
}: {
  k: string;
  label: string;
  value: string;
  hot: boolean;
  onHot: (k: string | null) => void;
  phone: boolean;
}) {
  return (
    <button
      type="button"
      // `.kv.hot` paints the ROW from --red-wash. Tailwind's own background
      // utilities would lose to it on specificity anyway, so the class is left
      // to do that job; only the letter's own colour is set inline, and only
      // because an inline colour would otherwise beat the stylesheet's — see
      // keyCell().
      className={cx('kv', hot && 'hot', 'w-full cursor-pointer text-left')}
      style={{ fontFamily: 'inherit' }}
      // ⚠️ CLICK SETS THE LETTER, IT NEVER TOGGLES IT, AND THERE IS NO
      // aria-pressed. Hover and focus have already set the letter by the time
      // a click lands — a tap fires mouseenter before click, and a button
      // takes focus before it — so a toggle read the row as already lit and
      // turned it straight back off: the tap the drawing note promises lit
      // nothing at all, and a keyboard Enter darkened the row still focused.
      // aria-pressed went with it: it flipped true on mere hover or focus,
      // announcing every row a reader landed on as pressed.
      onMouseEnter={() => onHot(k)}
      onMouseLeave={() => onHot(null)}
      onFocus={() => onHot(k)}
      onBlur={() => onHot(null)}
      onClick={() => onHot(k)}
    >
      <span className="mono k" style={keyCell(phone, hot)}>
        {k}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      <span className="num" style={VALUE_CELL}>
        {value}
      </span>
    </button>
  );
}

/* ── The card ───────────────────────────────────────────────────────── */

export function SpecCard({
  spec,
  loading,
  error,
  units,
  onClose,
  onUnitsChange,
  onShowOnly,
}: SpecCardProps) {
  const titleId = useId();
  const phone = usePhone();
  const size: BenchSize = phone ? 'mobile' : 'desktop';

  const [view, setView] = useState<SpecView>('2d');
  const [hot, setHot] = useState<string | null>(null);
  const [webgl, setWebgl] = useState(false);
  const [latheFailed, setLatheFailed] = useState(false);

  /* WebGL is probed after mount, never during render — render also runs on
     the server. No context means the 3D options are not offered at all
     rather than offered and broken (§7). */
  useEffect(() => {
    setWebgl(probeWebgl());
  }, []);

  const cartridge = spec?.cartridge ?? null;
  const raw = spec?.dims ?? null;

  /** A figure counts only when it arrived as a finite number. */
  const num = React.useCallback(
    (k: string): number | null => {
      const v = raw?.[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    },
    [raw],
  );

  /**
   * The thirteen figures the silhouette needs, or null.
   *
   * ⚠️ STRINGS ARE NOT COERCED TO NUMBERS. A numeric field that came back as
   * text means the figure was not read cleanly, and parseFloat-ing it feeds
   * the profile a number nobody vouched for. canDraw() is all-or-nothing for
   * the same reason — see its comment in lib/bench/geometry.ts: a partial set
   * does not fail visibly, it draws a smooth, confident, wrong shape.
   */
  const dims = useMemo<Dims | null>(() => {
    if (!raw) return null;
    const out: Partial<Dims> = {};
    for (const k of DIM_KEYS) {
      const v = raw[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return canDraw(out) ? out : null;
  }, [raw]);

  const canLathe = Boolean(dims) && webgl && !latheFailed;

  /* If the 3D option goes away under a view that is using it — no WebGL, a
     chunk that would not load, a cartridge whose set is incomplete — fall
     back rather than show an empty well. */
  useEffect(() => {
    if (!canLathe && view !== '2d') setView('2d');
  }, [canLathe, view]);

  /* The draw-in plays when a cartridge is first shown, not on every render —
     hovering a table row is a render, and a silhouette that redraws itself
     under the cursor is a distraction. */
  const drawnFor = useRef<string | null>(null);
  const cartridgeKey = cartridge?.key ?? null;
  const animate = drawnFor.current !== cartridgeKey;
  useEffect(() => {
    drawnFor.current = cartridgeKey;
  }, [cartridgeKey]);

  const name = cartridge?.name ?? '';
  const meta = cartridge
    ? [cartridge.type, cartridge.origin, cartridge.year].filter(Boolean).join(' · ')
    : '';

  /* ── Rows ────────────────────────────────────────────────────────── */

  const tableRows = DIM_ROWS.map((r) => ({ ...r, v: num(r.k) })).filter(
    (r): r is { k: string; label: string; v: number } => r.v !== null,
  );

  /* α arrives as printed text ("30", "30°"): it is an angle, so it neither
     converts with the mm/inch control nor gets recomputed. The degree sign is
     added only when it is not already there. */
  const alphaRaw = raw?.alpha;
  const alphaText =
    typeof alphaRaw === 'number'
      ? `${alphaRaw}°`
      : typeof alphaRaw === 'string' && alphaRaw.trim() !== ''
        ? alphaRaw.trim().endsWith('°')
          ? alphaRaw.trim()
          : `${alphaRaw.trim()}°`
        : null;

  const reloader: { k: string; label: string; v: string }[] = [];

  if (cartridge && (cartridge.pmaxBar !== null || cartridge.pmaxPsi !== null)) {
    const bar = cartridge.pmaxBar !== null ? `${group(cartridge.pmaxBar)} bar` : null;
    const psi = cartridge.pmaxPsi !== null ? `${group(cartridge.pmaxPsi)} psi` : null;
    const [first, second] = units === 'imperial' ? [psi, bar] : [bar, psi];
    reloader.push({
      k: 'Pmax',
      label: 'Maximum average pressure',
      v: first && second ? `${first} (${second})` : (first ?? second ?? ''),
    });
  }

  const twist = num('bU');
  if (twist !== null) {
    reloader.push({ k: 'u', label: 'Proof-barrel twist', v: twistText(twist, units) });
  }

  /**
   * ⚠️ THE BRACKET IS THE HONEST ANSWER, AND IT STAYS UNTIL A REAL CHAMBER
   * FIGURE ARRIVES. `cL2` / `cH1` are read straight out of the payload when
   * they are there; when they are not, the row prints "[chamber L2]" against
   * the cartridge figure exactly as the prototype does. Nothing here derives
   * one from the other.
   */
  const l2 = num('L2');
  if (l2 !== null) {
    const chamber = num('cL2');
    reloader.push({
      k: 'L2',
      label: 'Shoulder headspace band, chamber min over cartridge max',
      v: `${chamber !== null ? both(chamber, units) : '[chamber L2]'} vs ${both(l2, units)}`,
    });
  }

  const h1 = num('H1');
  if (h1 !== null) {
    const chamber = num('cH1');
    reloader.push({
      k: 'H1',
      label: 'Neck clearance, chamber against cartridge',
      v: `${chamber !== null ? both(chamber, units) : '[chamber H1]'} vs ${both(h1, units)}`,
    });
  }

  /* ── The pieces both frames share ────────────────────────────────── */

  const unitSeg = (
    <Seg<Units>
      label="Units"
      size={size}
      value={units}
      options={[
        { id: 'metric', label: 'mm' },
        { id: 'imperial', label: 'inch' },
      ]}
      onChange={onUnitsChange}
    />
  );

  const viewSeg = (
    <Seg<SpecView>
      label="Cartridge view"
      size={size}
      value={view}
      options={
        canLathe
          ? [
              { id: '2d', label: '2D' },
              { id: 'lathe', label: '3D lathe' },
              { id: 'half', label: 'Half section' },
            ]
          : [{ id: '2d', label: '2D' }]
      }
      onChange={setView}
    />
  );

  let viewBody: React.ReactNode;
  if (loading && !spec) {
    viewBody = <ViewSkeleton />;
    // `canLathe`, not just `dims`: the fall-back to 2D below is an effect, so
    // the render in which WebGL or the chunk goes away still mounts the lathe
    // once. Reading the live value here means it never mounts at all.
  } else if (dims && canLathe && view !== '2d') {
    viewBody = (
      <>
        <LatheBoundary onFail={() => setLatheFailed(true)}>
          <LatheView dims={dims} halfSection={view === 'half'} />
        </LatheBoundary>
        <div style={{ ...NOTE, fontSize: phone ? 11 : 11.5, padding: phone ? '8px 6px 0' : '8px 4px 0' }}>
          {phone ? LATHE_NOTE_PHONE : LATHE_NOTE_DESKTOP}
        </div>
      </>
    );
  } else if (dims) {
    viewBody = (
      <>
        <CartridgeDrawing2D
          dims={dims}
          units={units}
          hot={hot}
          onHotChange={setHot}
          animate={animate}
        />
        <div style={{ ...NOTE, fontSize: phone ? 11 : 11.5, padding: phone ? '4px 6px 0' : '0 4px' }}>
          {DRAW_NOTE}
          {phone ? ' Tap a dimension or a row to link them.' : null}
        </div>
      </>
    );
  } else {
    /* Not every figure is present, so nothing is drawn — see the note on
       canDraw(). The two lengths a reloader actually sets a die by are on the
       cartridge record itself, so they are shown instead of an empty box. */
    viewBody = (
      <div style={{ padding: '6px 6px 2px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          This cartridge is not drawn: the full set of figures is not available.
        </div>
        {cartridge?.caseLengthMm != null ? (
          <div className="kv" style={{ marginTop: 8, cursor: 'default' }}>
            <span className="mono k" style={keyCell(phone)}>
              L3
            </span>
            <span style={{ flex: 1 }}>Case length</span>
            <span className="num" style={VALUE_CELL}>
              {both(cartridge.caseLengthMm, units)}
            </span>
          </div>
        ) : null}
        {cartridge?.maxLengthMm != null ? (
          <div className="kv" style={{ cursor: 'default' }}>
            <span className="mono k" style={keyCell(phone)}>
              L6
            </span>
            <span style={{ flex: 1 }}>Max cartridge length</span>
            <span className="num" style={VALUE_CELL}>
              {both(cartridge.maxLengthMm, units)}
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  const drawingBox = (
    <div
      style={{
        ...PANEL,
        background: 'var(--bg-card)',
        padding: phone ? '8px 6px 6px' : '12px 12px 8px',
      }}
    >
      {/* The pill row scrolls sideways rather than wrapping: three options at
          a 44px tap height would otherwise stack into two rows on a 320px
          phone and push the drawing under the fold. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, overflowX: 'auto' }}>
        {viewSeg}
      </div>
      {viewBody}
    </div>
  );

  const dimensionsSection = (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <div className="head" style={{ fontSize: 15 }}>
          Dimensions
        </div>
        {!phone && <div style={NOTE}>hover a row to find it in the drawing</div>}
      </div>

      {loading && !spec ? (
        <div className="gg-skeleton" style={{ height: 240, borderRadius: 'var(--r-sm)' }} aria-hidden="true" />
      ) : (
        /* On the phone the rows sit in their own bordered card. The 8px
           horizontal padding is on the CARD, not the row: `.kv.hot` bleeds its
           highlight 8px either side, and putting the padding on the row would
           either clip that bleed or fight `.bench .kv` on specificity. */
        <div
          style={
            phone
              ? { ...PANEL, overflow: 'hidden', paddingLeft: 12, paddingRight: 12 }
              : undefined
          }
        >
          {tableRows.map((r) => (
            <DimRow
              key={r.k}
              k={r.k}
              label={r.label}
              value={both(r.v, units)}
              hot={hot === r.k}
              onHot={setHot}
              phone={phone}
            />
          ))}
          {alphaText ? (
            /* CartridgeDrawing2D lights its shoulder arc on 'α' or 'alpha',
               so the angle links to the drawing like every other row. */
            <DimRow
              k="α"
              label="Shoulder angle"
              value={alphaText}
              hot={hot === 'α' || hot === 'alpha'}
              onHot={setHot}
              phone={phone}
            />
          ) : null}
        </div>
      )}
    </div>
  );

  const reloaderSection =
    reloader.length > 0 ? (
      <div style={{ ...PANEL, padding: 14 }}>
        <div className="head" style={{ fontSize: 15, marginBottom: 2 }}>
          For the reloader
        </div>
        <div style={{ ...NOTE, marginBottom: 6 }}>The cartridge standard, not your rifle.</div>
        {reloader.map((r) => (
          <div key={r.k} className="kv" style={{ cursor: 'default' }}>
            <span className="mono" style={keyCell(phone)}>
              {r.k}
            </span>
            <span style={{ flex: 1 }}>{r.label}</span>
            <span className="num" style={VALUE_CELL}>
              {r.v}
            </span>
          </div>
        ))}
      </div>
    ) : null;

  const loadsSection = spec ? (
    <div style={{ ...PANEL, padding: 14 }}>
      {!phone && (
        <div className="head" style={{ fontSize: 15, marginBottom: 8 }}>
          Loads
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="num head" style={{ fontSize: phone ? 26 : 28, lineHeight: 1 }}>
          {spec.loadsOnBench}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>loads from your bench</span>
      </div>

      {spec.shellHolderGroup.length > 0 ? (
        <>
          {/* Plain spans, not the shared Chip: these are labels, and Chip
              carries the green/grey dot that means "on your bench" — a
              meaning these do not have. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0 12px' }}>
            {spec.shellHolderGroup.map((c) => (
              <span
                key={c.key}
                className="chip"
                style={
                  phone
                    ? { cursor: 'default', height: 30, fontSize: 12.5 }
                    : { cursor: 'default' }
                }
              >
                {c.name}
              </span>
            ))}
          </div>
          <div style={{ ...NOTE, marginBottom: 12 }}>
            {phone ? SHELL_NOTE_PHONE : SHELL_NOTE_DESKTOP}
          </div>
        </>
      ) : (
        <div style={{ height: 12 }} />
      )}

      <Btn
        red
        size={size}
        style={phone ? { width: '100%' } : undefined}
        onClick={() => onShowOnly(spec.cartridge.key)}
      >
        {phone ? `Show only ${name}` : `Show only ${name} in the finder`}
      </Btn>
    </div>
  ) : null;

  const errorSection = (
    <div style={{ ...PANEL, padding: 16 }}>
      <div className="head" style={{ fontSize: 15, marginBottom: 4 }}>
        This cartridge could not load
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{error}</div>
      <Btn size={size} style={{ marginTop: 12 }} onClick={onClose}>
        Close
      </Btn>
    </div>
  );

  const failed = Boolean(error) && !spec;

  /* ── Phone: the pushed-in screen ─────────────────────────────────── */

  if (phone) {
    return (
      <>
        <OverlayShell
          variant="sheet"
          labelledBy={titleId}
          onClose={onClose}
          // The header is pinned and the body scrolls under it, so the panel
          // itself must not scroll — `.bench-sheet` sets overflow-y: auto.
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <div
            style={{
              height: 54,
              flex: 'none',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '0 8px',
            }}
          >
            <IconX
              onClick={onClose}
              label="Back"
              size="mobile"
              glyph={24}
              style={{ color: 'var(--text-primary)' }}
            />
            <span
              id={titleId}
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'var(--font-head)',
                fontWeight: 700,
                fontSize: 16,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {name}
            </span>
            <div style={{ marginRight: 4 }}>{unitSeg}</div>
          </div>

          <div className="scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 24 }}>
            <div style={{ padding: '12px 12px 0' }}>
              {meta ? <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{meta}</div> : null}
              <div style={{ marginTop: meta ? 10 : 0 }}>{failed ? errorSection : drawingBox}</div>
            </div>

            {failed ? null : (
              <>
                <div style={{ padding: '14px 12px 0' }}>{dimensionsSection}</div>
                {reloaderSection ? <div style={{ padding: '14px 12px 0' }}>{reloaderSection}</div> : null}
                {loadsSection ? <div style={{ padding: '14px 12px 0' }}>{loadsSection}</div> : null}
              </>
            )}
          </div>
        </OverlayShell>
      </>
    );
  }

  /* ── Desktop: the right-hand sheet ───────────────────────────────── */

  return (
    <>
      <OverlayShell variant="sheet" labelledBy={titleId} onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 24px 14px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Reloading · Cartridges</div>
            <div
              id={titleId}
              className="head"
              style={{ fontSize: 28, letterSpacing: '-0.035em', marginTop: 2, lineHeight: 1.05 }}
            >
              {name || (
                <span
                  className="gg-skeleton"
                  style={{ display: 'inline-block', width: 220, height: 28, borderRadius: 'var(--r-sm)' }}
                />
              )}
            </div>
            {meta ? (
              <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>{meta}</div>
            ) : null}
          </div>
          {unitSeg}
          <IconX onClick={onClose} label="Close" />
        </div>

        <div style={{ padding: '0 24px' }}>{failed ? errorSection : drawingBox}</div>

        {failed ? null : (
          <div
            style={{
              padding: '16px 24px',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 16,
              alignItems: 'start',
            }}
          >
            {dimensionsSection}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {reloaderSection}
              {loadsSection}
            </div>
          </div>
        )}
      </OverlayShell>
    </>
  );
}

export default SpecCard;
