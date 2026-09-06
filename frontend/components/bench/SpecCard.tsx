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

import {
  DIM_KEYS,
  DRAWN_LETTERS_2D,
  DRAWN_LETTERS_3D,
  canDraw,
  type Dims,
  type Units,
  MM_PER_INCH,
} from '@/lib/bench/geometry';
import { headerMeta, isBeltedType, tolerancesOf, withTolerance } from '@/lib/bench/spec-text';

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

/**
 * ⚠️ ON ALL THREE VIEWS, NOT JUST THE 2D ONE.
 *
 * It was printed under the drawing and dropped the moment the member switched
 * to 3D — where the same invented ogive is revolved into a solid that looks a
 * great deal more authoritative than a line drawing does. The caveat has to
 * follow the thing it is a caveat about.
 */
const DRAW_NOTE =
  'Drawn to scale. The bullet ogive is illustrative: only the bullet diameter G1 and the overall length L6 are fixed.';

/**
 * The half section's extra caveat.
 *
 * The web, the primer pocket, the flash hole, the wall taper and the seating
 * depth are all drawn so the cut reads as a case rather than a tube. Not one of
 * them is a figure anybody published, and the section is the one view that
 * looks like it is telling you about the inside.
 */
const INTERIOR_NOTE = 'The interior is illustrative.';

/**
 * ⚠️ THE BELT IS NOT DRAWN, SO THE NOTE SAYS SO.
 *
 * A belted case's belt sits about 5 mm ahead of the head at the rim's own
 * diameter, and no letter in the thirteen locates it — neither its position
 * nor its length. Drawing it from the rim diameter alone would invent a
 * feature at the exact point of the case a reloader measures against a shell
 * holder, so the silhouette shows the head as it shows a rimless one and this
 * sentence is the honest difference.
 */
const BELT_NOTE = 'The belt is not drawn: its position is not one of the figures shown.';

const LATHE_NOTE_DESKTOP =
  'Drag to spin, drag up or down to tilt. The ring snaps to each station and reads the diameter there; a snapped station lights up its row in the table. Half section shows the wall, the web and the seated bullet.';

/**
 * ⚠️ NO "up or down to tilt" ON THE PHONE ANY MORE. The canvas is
 * `touch-action: pan-y` so a vertical drag scrolls the page — the alternative
 * was a half-screen canvas the page could not be scrolled past. An instruction
 * for a gesture the browser has taken is worse than no instruction.
 */
const LATHE_NOTE_PHONE =
  'Drag sideways to spin. Slide the calliper along the axis; it snaps to each station and reads the diameter there. Half section shows the wall, the web and the seated bullet.';

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

/**
 * ⚠️ NO `white-space: nowrap` HERE, AND THAT IS THE WHOLE OF A2.
 *
 * These values are long — `[chamber L2] vs 41.52 mm (1.635″)` is fifty
 * characters — and pinned to one line they pushed the 720px sheet to a
 * scrollWidth of 760. The sheet then had a horizontal scrollbar, and because a
 * focused control gets scrolled into view, clicking the **inch** tab slid the
 * whole card sideways: the title read "5 Creedmoor" and the calliper's label
 * read "LLIPER". Nothing was broken; the words had simply gone off the left
 * edge.
 *
 * `anywhere` rather than `break-word`: these strings have long unbroken runs
 * (`41.52 mm (1.635″)`) that `break-word` will not split until the line is
 * already overflowing, which is one frame too late for a flex row.
 */
const VALUE_CELL: React.CSSProperties = {
  fontWeight: 500,
  minWidth: 0,
  overflowWrap: 'anywhere',
  textAlign: 'right',
};

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
  linked,
}: {
  k: string;
  label: string;
  value: string;
  hot: boolean;
  onHot: (k: string | null) => void;
  phone: boolean;
  /** Whether the current view carries this letter. See the note below. */
  linked: boolean;
}) {
  /**
   * ⚠️ A ROW THE PICTURE DOES NOT CARRY IS NOT A BUTTON.
   *
   * The table lists thirteen letters; the 2D drawing annotates nine, and R, E,
   * E1 and H2 have no callout on it at all. As buttons they took the hover,
   * lit their own row, and pointed at nothing — which reads as a drawing that
   * failed to respond rather than as a figure with no leader, and the header
   * beside them promises "hover a row to find it in the drawing". The 3D views
   * carry two more (E1 and H2 have calliper stations), so the set is decided
   * per view, not once.
   *
   * The alternative was to add leaders for the missing four. Rejected: R and E
   * are a rim thickness and a groove length measured along an axis at the case
   * head, where the drawing is already three overlapping annotations deep, and
   * a fifth leader into that corner would cost more than it explains.
   */
  if (!linked) {
    return (
      <div className="kv kv-wrap" style={{ cursor: 'default' }}>
        <span className="mono k" style={keyCell(phone)}>
          {k}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
        <span className="num kv-v" style={VALUE_CELL}>
          {value}
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      // `.kv.hot` paints the ROW from --red-wash. Tailwind's own background
      // utilities would lose to it on specificity anyway, so the class is left
      // to do that job; only the letter's own colour is set inline, and only
      // because an inline colour would otherwise beat the stylesheet's — see
      // keyCell().
      className={cx('kv', 'kv-wrap', hot && 'hot', 'w-full cursor-pointer text-left')}
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
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <span className="num kv-v" style={VALUE_CELL}>
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
  name: nameHint,
  type: typeHint,
  origin: originHint,
  year: yearHint,
  onClose,
  onUnitsChange,
  onShowOnly,
  onOpenCartridge,
  onRetry,
  onToast,
}: SpecCardProps) {
  const titleId = useId();
  const phone = usePhone();
  const size: BenchSize = phone ? 'mobile' : 'desktop';

  const [view, setView] = useState<SpecView>('2d');
  const [hot, setHot] = useState<string | null>(null);
  /**
   * The letter the calliper is snapped to, which OWNS the hot letter.
   *
   * ⚠️ HOVER RELEASES BACK TO THIS, NOT TO NULL. A member measures to P2 in
   * 3D, the P2 row lights, they run the pointer down the table to read the
   * rest — and every row they cross used to put their measurement out, with
   * the last one leaving nothing lit at all. The snap is a state they set on
   * purpose; a hover is a glance.
   */
  const [snapLetter, setSnapLetter] = useState<string | null>(null);
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

  /**
   * ⚠️ THE CARD IS RESET ON THE CARTRIDGE, NOT ON MOUNT.
   *
   * The page keeps one SpecCard mounted and swaps `spec` underneath it, so a
   * letter left hot, a view left on Half section and — worst — a `latheFailed`
   * latched by one bad chunk load all carried over to the next cartridge. The
   * latch is the sharp one: once set, 3D was hidden for the rest of the
   * session with nothing on screen to explain why.
   */
  const resetFor = useRef<string | null>(null);
  useEffect(() => {
    if (resetFor.current === cartridgeKey) return;
    resetFor.current = cartridgeKey;
    setHot(null);
    setSnapLetter(null);
    setView('2d');
    setLatheFailed(false);
  }, [cartridgeKey]);

  /* Leaving 3D takes the calliper with it, so the letter it was holding must
     go too: a lit row in the 2D drawing with no ring on screen to explain it
     is a highlight the member cannot account for or clear. */
  useEffect(() => {
    if (view === '2d') {
      setSnapLetter(null);
      setHot(null);
    }
  }, [view]);

  /** A table row or a drawing callout, hovered. Releasing goes back to the snap. */
  const setHotRow = React.useCallback(
    (k: string | null) => {
      setHot(k ?? snapLetter);
    },
    [snapLetter],
  );

  /** The calliper snapped (or was cleared). This is the letter that persists. */
  const onCalliperHot = React.useCallback((k: string | null) => {
    setSnapLetter(k);
    setHot(k);
  }, []);

  /**
   * The header, from the group the card was opened from until the fetch lands.
   *
   * ⚠️ AND THE TITLE IS NEVER EMPTY. `spec` is null for the length of a round
   * trip and the title was a skeleton bar, which carries no text — so the
   * dialog's `aria-labelledby` pointed at nothing and the overlay announced
   * itself with no name at all. The hint fills that gap in the ordinary case;
   * "Cartridge" fills it when the card is opened without one.
   */
  const name = cartridge?.name ?? nameHint ?? '';
  const meta = headerMeta(
    cartridge ?? { type: typeHint, origin: originHint, year: yearHint },
  );
  const belted = isBeltedType(cartridge?.type ?? typeHint);

  /* ── Rows ────────────────────────────────────────────────────────── */

  /** The printed tolerances, shown beside the figure and never parsed. */
  const tolerances = useMemo(() => tolerancesOf(raw), [raw]);

  /**
   * Which letters the picture currently on screen actually carries — see the
   * note on DimRow. The 3D views add E1 and H2 (calliper stations) and drop α
   * (there is no arc in 3D).
   */
  const drawn = useMemo(
    () => new Set(view === '2d' ? DRAWN_LETTERS_2D : DRAWN_LETTERS_3D),
    [view],
  );

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
          <LatheView
            dims={dims}
            halfSection={view === 'half'}
            units={units}
            hot={hot}
            onHotChange={onCalliperHot}
            name={name || null}
            slug={cartridge?.slug ?? null}
            onToast={onToast}
          />
        </LatheBoundary>
        <div style={{ ...NOTE, fontSize: phone ? 11 : 11.5, padding: phone ? '8px 6px 0' : '8px 4px 0' }}>
          {phone ? LATHE_NOTE_PHONE : LATHE_NOTE_DESKTOP} {DRAW_NOTE}
          {view === 'half' ? ` ${INTERIOR_NOTE}` : null}
          {belted ? ` ${BELT_NOTE}` : null}
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
          onHotChange={setHotRow}
          animate={animate}
        />
        <div style={{ ...NOTE, fontSize: phone ? 11 : 11.5, padding: phone ? '4px 6px 0' : '0 4px' }}>
          {DRAW_NOTE}
          {belted ? ` ${BELT_NOTE}` : null}
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
          <div className="kv kv-wrap" style={{ marginTop: 8, cursor: 'default' }}>
            <span className="mono k" style={keyCell(phone)}>
              L3
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>Case length</span>
            <span className="num kv-v" style={VALUE_CELL}>
              {both(cartridge.caseLengthMm, units)}
            </span>
          </div>
        ) : null}
        {cartridge?.maxLengthMm != null ? (
          <div className="kv kv-wrap" style={{ cursor: 'default' }}>
            <span className="mono k" style={keyCell(phone)}>
              L6
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>Max cartridge length</span>
            <span className="num kv-v" style={VALUE_CELL}>
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
              /* The printed tolerance rides beside the figure, verbatim —
                 "37.84 mm (1.490″) −0.20". It is the difference between the
                 nominal and what a case may actually measure, so a reloader
                 comparing a fired case against this table needs it on the row
                 rather than as something the card knows and does not say. */
              value={withTolerance(both(r.v, units), tolerances[r.k])}
              hot={hot === r.k}
              onHot={setHotRow}
              phone={phone}
              linked={drawn.has(r.k)}
            />
          ))}
          {alphaText ? (
            /* CartridgeDrawing2D lights its shoulder arc on 'α' or 'alpha',
               so the angle links to the drawing like every other row — in 2D.
               There is no arc in the 3D views, so the link goes with them. */
            <DimRow
              k="α"
              label="Shoulder angle"
              value={withTolerance(alphaText, tolerances.alpha ?? tolerances['α'])}
              hot={hot === 'α' || hot === 'alpha'}
              onHot={setHotRow}
              phone={phone}
              linked={drawn.has('α')}
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
          <div key={r.k} className="kv kv-wrap" style={{ cursor: 'default' }}>
            <span className="mono" style={keyCell(phone)}>
              {r.k}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>{r.label}</span>
            <span className="num kv-v" style={VALUE_CELL}>
              {r.v}
            </span>
          </div>
        ))}
      </div>
    ) : null;

  const shellMore = spec?.shellHolderMore ?? 0;

  const loadsSection = spec ? (
    <div style={{ ...PANEL, padding: 14 }}>
      {/* ⚠️ THE HEADING STAYS ON THE PHONE TOO. It was dropped there to save a
          line, which left a bare "761" under the drawing note with nothing
          saying what had been counted. */}
      <div className="head" style={{ fontSize: 15, marginBottom: 8 }}>
        Loads
      </div>
      {/**
       * ⚠️ THE CARTRIDGE'S OWN TOTAL IS THE HEADLINE, THE BENCH IS THE
       * QUALIFIER. This box read "26 loads from your bench" — 26 for a
       * cartridge with 761, with no hint that the other 735 exist. A reloader
       * who reads 26 as the whole of what is known for a 6,5 Creedmoor is
       * being told something false by omission, and the figure was in the
       * payload all along.
       */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="num head" style={{ fontSize: phone ? 26 : 28, lineHeight: 1 }}>
          {spec.loadCount}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          {spec.loadCount === 1 ? 'load' : 'loads'}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', minWidth: 0 }}>
          {/* Zero is a state worth naming: "0 from your bench" reads like a
              failure, "none yet" reads like an invitation. */}
          {spec.loadsForBench > 0
            ? `${spec.loadsForBench} from your bench`
            : 'none from your bench yet'}
        </span>
      </div>

      {spec.shellHolderGroup.length > 0 ? (
        <>
          {/* ⚠️ BUTTONS, NOT LABELS, AND STILL NOT THE SHARED Chip. Chip
              carries the green/grey dot that means "on your bench" — a meaning
              these do not have. What they DO have is a destination: the whole
              point of the group is "these three take the same shell holder",
              and the obvious next move is to go and look at one. Without
              `onOpenCartridge` they fall back to plain labels rather than
              offering a button that does nothing. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0 12px' }}>
            {spec.shellHolderGroup.map((c) =>
              onOpenCartridge ? (
                <button
                  key={c.key}
                  type="button"
                  className="chip"
                  style={phone ? { height: 40, fontSize: 12.5 } : undefined}
                  onClick={() => onOpenCartridge(c.key)}
                >
                  {c.name}
                </button>
              ) : (
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
              ),
            )}
            {shellMore > 0 ? (
              /* The server caps the group at twelve. Without this the card
                 would quietly present twelve as the whole list. */
              <span
                className="chip"
                style={
                  phone
                    ? { cursor: 'default', height: 30, fontSize: 12.5, color: 'var(--text-tertiary)' }
                    : { cursor: 'default', color: 'var(--text-tertiary)' }
                }
              >
                +{shellMore} more
              </span>
            ) : null}
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
      {/* ⚠️ A RETRY, BECAUSE THE COMMON CAUSE IS A DROPPED REQUEST. The only
          way out of this state was Close, which threw away the card and made
          the member find the cartridge in the list again to try the same
          request a second time. Retry is offered first and Close stays beside
          it; without `onRetry` the card is exactly as it was. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {onRetry ? (
          <Btn red size={size} onClick={onRetry}>
            Try again
          </Btn>
        ) : null}
        <Btn size={size} onClick={onClose}>
          Close
        </Btn>
      </div>
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
              {/* Never empty: the dialog is labelled by this element. */}
              {name || 'Cartridge'}
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
                <>
                  <span
                    className="gg-skeleton"
                    style={{ display: 'inline-block', width: 220, height: 28, borderRadius: 'var(--r-sm)' }}
                    aria-hidden="true"
                  />
                  {/* ⚠️ THE SKELETON HAS NO TEXT, AND THIS ELEMENT IS THE
                      DIALOG'S accessible name. Without a word in here the
                      overlay opened announcing nothing at all — the header
                      hints normally fill the gap, this covers the card being
                      opened without one. */}
                  <span className="sr-only">Cartridge</span>
                </>
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
