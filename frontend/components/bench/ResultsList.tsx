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
 * ⚠️ AND AN EMPTY PANEL EXPLAINS ITSELF. A full bench whose three axes have no
 * load in common is a correct empty screen, and a correct empty screen that
 * says nothing is indistinguishable from a broken one — which is exactly how
 * it was reported. `LoadsResponse.why` names the starving axis and `shelf`
 * names what is on the other two; explainEmpty turns the pair into a sentence.
 *
 * ⚠️ COPY. Operator ruling, 2026-09-02: nothing here may name where a figure
 * comes from. The two fixed strings are imported from contract.ts rather than
 * retyped, and the raw `error` message is deliberately NOT rendered — it is
 * uncontrolled text arriving from the network, and this surface has a hard
 * copy boundary (see the backend's leak spec).
 */

import type { CartridgeHead, LoadGroup, LoadRow, LoadsWhy } from '@/lib/bench/api';
import type { Dims, Units } from '@/lib/bench/geometry';
import { DIM_KEYS, coalCheck, fmtVelocity, MM_PER_INCH } from '@/lib/bench/geometry';

import { CartridgeThumb } from './CartridgeThumb';
import { BENCH_AXES, SAFETY_LINE, VELOCITY_NOTE, bulletLabel } from './contract';
import type { BenchAxis, ResultsListProps, ShelfNames } from './contract';
import { Btn, Tag, usePhone } from './primitives';

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

/* ── Why a full bench came back empty ───────────────────────────────── */

/** The plural noun each axis is spoken of by. */
const AXIS_PLURAL: Record<BenchAxis, string> = {
  powder: 'powders',
  bullet: 'bullets',
  cartridge: 'cartridges',
};

/**
 * How a load relates to each axis: it is built FOR a bullet, WITH a powder,
 * IN a cartridge. One preposition doing all three ("none for the powders") is
 * the difference between a sentence a reloader wrote and one a form did.
 */
const AXIS_PREP: Record<BenchAxis, string> = {
  powder: 'with the powders',
  bullet: 'for the bullets',
  cartridge: 'in the cartridges',
};

/** The order the two surviving axes read best in: the cartridge leads. */
const PAIR_ORDER: BenchAxis[] = ['cartridge', 'powder', 'bullet'];

function shelfOf(shelf: ShelfNames, axis: BenchAxis): string[] {
  if (axis === 'powder') return shelf.powders;
  if (axis === 'bullet') return shelf.bullets;
  return shelf.cartridges;
}

/**
 * `.30-06 Springfield` or `your 2 cartridges`.
 *
 * ⚠️ ONE NAME OR A COUNT, NEVER A LIST. The sentence names TWO axes and joins
 * them with "and", so an inner list makes ".30-06 and .308 Win and N550 and
 * N140" — a line whose own grammar hides which name belongs to which shelf.
 * The count keeps it one clause per axis and stays true at any size.
 *
 * An empty list can only reach here if the caller skipped the panel's own
 * check; it degrades to the plural rather than to a hole in the middle of the
 * line.
 */
function axisNames(shelf: ShelfNames, axis: BenchAxis): string {
  const list = shelfOf(shelf, axis);
  const plural = AXIS_PLURAL[axis];
  if (list.length === 0) return `your ${plural}`;
  if (list.length === 1) return list[0];
  return `your ${list.length} ${plural}`;
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * `.30-06 Springfield and N550 have 70 loads together — but none for the
 * bullets on your bench.`
 *
 * The two axes that DO join are named with the member's own products; the one
 * that starves is named by its plural, because the point is that nothing they
 * own is on that side.
 */
function pairSentence(axis: BenchAxis, n: number, shelf: ShelfNames): string {
  const [a, b] = PAIR_ORDER.filter((x) => x !== axis);
  const head = `${axisNames(shelf, a)} and ${axisNames(shelf, b)}`;
  const loads = `${grouped(n)} load${n === 1 ? '' : 's'}`;
  return `${upperFirst(head)} have ${loads} together — but none ${AXIS_PREP[axis]} on your bench.`;
}

/** What the panel says, and which Add buttons it offers under it. */
export interface EmptyExplanation {
  title: string;
  lines: string[];
  /**
   * The axes worth widening, biggest opening first. Empty — deliberately —
   * when widening any single one provably cannot help.
   */
  offer: BenchAxis[];
}

/**
 * The empty panel's whole reason for existing.
 *
 * 🚨 A CORRECT EMPTY SCREEN AND A BROKEN ONE LOOK IDENTICAL. Results are an
 * AND across powder, bullet and cartridge, so a member holding N550, a .30-06
 * and two bullets that no .30-06 N550 load uses gets a blank panel — and every
 * word on it was true. The operator reported that as "nothing resolves", which
 * is the only reading available when the screen says nothing.
 *
 * `why` is the counts with each axis relaxed in turn, so a non-zero one names
 * an axis the member could widen and says how much is behind it. All three
 * zero is the case that must NOT offer a door: result ⊆ each relaxed set, so
 * if every relaxed set is empty then adding one more of any single thing
 * provably changes nothing, and pointing at a picker would be a lie.
 */
export function explainEmpty(why: LoadsWhy, shelf: ShelfNames): EmptyExplanation {
  const counts: Record<BenchAxis, number> = {
    powder: why.ignoringPowders,
    bullet: why.ignoringBullets,
    cartridge: why.ignoringCartridges,
  };
  /*
   * Biggest opening first, ties in the rail's order.
   *
   * Sort is stable, so two axes hiding the same number of loads stay in the
   * order the chips are in — and the sentences and the Add buttons are both
   * built from THIS array, so they can never name the axes in two different
   * orders.
   */
  const starving = BENCH_AXES.filter((a) => counts[a] > 0).sort((a, b) => counts[b] - counts[a]);

  if (starving.length === 0) {
    return {
      title: 'Nothing joins these three',
      lines: [
        'No load uses one of your powders with one of your bullets in one of your cartridges.',
        'Adding one more of any single thing will not change that — turn a chip back on, widen the weight band or the ± gr window, or swap out what is on the bench.',
      ],
      offer: [],
    };
  }

  if (starving.length === 1) {
    const axis = starving[0];
    const n = counts[axis];
    return {
      title: `${grouped(n)} load${n === 1 ? '' : 's'} — but not for your ${AXIS_PLURAL[axis]}`,
      lines: [
        pairSentence(axis, n, shelf),
        `Add a ${axis} that suits them and those loads appear here.`,
      ],
      offer: [axis],
    };
  }

  return {
    title: `${starving.length === 3 ? 'Three' : 'Two'} ways to open this up`,
    lines: [
      ...starving.map((a) => pairSentence(a, counts[a], shelf)),
      'Widen whichever is easiest — each one opens loads the others still block.',
    ],
    offer: starving,
  };
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
 * `12 loads matching your bench · Pmax 4 350 bar (63 092 psi) · max COAL 71.12 mm`
 *
 * Each segment is dropped rather than faked when its figure is missing — a
 * cartridge whose sheet is incomplete shows a shorter line, never a zero.
 *
 * ⚠️ "MATCHING", FOR THE REASON THE COUNT ABOVE THE LIST SAYS "MATCH". The ± gr
 * window puts loads in here that were worked up with bullets the member does
 * not own, each under its own weight heading. They matched the shelf; they are
 * not all buildable from it.
 */
function groupMeta(head: CartridgeHead, loadCount: number, units: Units): string {
  const parts: string[] = [`${loadCount} load${loadCount === 1 ? '' : 's'} matching your bench`];
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

export interface FlagTag {
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
export function tagsFor(row: LoadRow, maxLengthMm: number | null): FlagTag[] {
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
  label,
}: {
  gr: number;
  velocity: string | null;
  weight: 500 | 600;
  /**
   * "Start charge" / "Max charge", for a reader.
   *
   * ⚠️ THE COLUMN HEADING IS NOT ENOUGH HERE. The row is a single <button>, so
   * a screen reader reads it as one run of text — "35.6 gr · 732 m/s 41.5 gr ·
   * 810 m/s" — with nothing to say which of the two is the ceiling. The
   * heading row above is a separate element and is never read alongside it.
   */
  label: string;
}) {
  return (
    <div className="num leading-tight">
      <span className="sr-only">{label} </span>
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
  shelf,
  onAddPowder,
  onAddBullet,
  onAddCartridge,
  onReset,
}: ResultsListProps) {
  const groups = result?.groups ?? [];
  const isEmpty = !loading && !error && groups.length === 0;
  /**
   * ⚠️ ONE ROW PER LOAD, NOT TWO.
   *
   * Every row used to mount BOTH variants and hide one with `md:` — so 300
   * loads built 600 buttons, 600 tag strips and 600 silhouette-free grids, and
   * the half that could never be seen still cost the same layout and the same
   * memory. `usePhone` is the same signal every overlay in the module already
   * flips on (and it answers correctly in the FIRST render, so there is no
   * frame of the wrong variant to catch).
   */
  const phone = usePhone();

  // The bare axes, in the rail's order, so the sentence and the button below
  // always name the same one.
  const missing = BENCH_AXES.filter((a) => gaps[a]);
  const opener: Record<BenchAxis, () => void> = {
    powder: onAddPowder,
    bullet: onAddBullet,
    cartridge: onAddCartridge,
  };
  // The bare axis the sentence above names, and the door it opens. Only ever
  // read when there IS one — see `offer` below.
  const cta: BenchAxis | undefined = missing[0];

  /*
   * ⚠️ THREE THINGS HAVE TO BE TRUE BEFORE THE SENTENCE CAN BE WRITTEN, and
   * each guards a different lie:
   *   · `missing.length === 0` — a bare axis has its own, better state above.
   *   · `why` — the server only sends the counts for a full bench that found
   *     nothing; without them nothing here knows which axis starved.
   *   · every shelf list non-empty — a member who has switched every bullet
   *     off for this search has bullets, so `gaps` is false and `why` may well
   *     arrive, but "none for the bullets on your bench" would be describing a
   *     shelf they can see is switched off. That case falls through to the
   *     filter state, which says to turn a chip back on.
   */
  const why = result?.why ?? null;
  const shelfIsWhole =
    shelf.powders.length > 0 && shelf.bullets.length > 0 && shelf.cartridges.length > 0;
  const explained =
    isEmpty && missing.length === 0 && why && shelfIsWhole ? explainEmpty(why, shelf) : null;

  /*
   * One button per axis the sentence just named, and NOT ONE MORE.
   *
   * 🚨 THE FILTER STATE OFFERS NOTHING, WHICH IS THE WHOLE POINT OF THIS LINE.
   * It used to fall back to "Add a powder" whenever nothing else applied — and
   * "nothing else applied" means a bench that already holds all three axes,
   * whose chips are switched off or whose weight band is too narrow. Sending
   * that member to the powder picker is the exact advice this file's header
   * calls actively wrong: it points at the shelf they have already filled,
   * where adding another changes nothing. The copy beside it already names the
   * three things that do work — turn a chip back on, widen the band, add a
   * component — and a door that leads nowhere is worse than no door.
   *
   * `explained.offer` is likewise empty on purpose when nothing joins the
   * three; see explainEmpty.
   */
  const offer: BenchAxis[] = cta ? [cta] : (explained?.offer ?? []);

  return (
    <section className="flex min-h-0 flex-1 flex-col md:gap-[10px] md:pb-4">
      {/* Count + the one velocity note on the screen. */}
      <div className="flex items-baseline gap-3 px-3 pb-2 md:items-center md:px-0 md:pb-0">
        <div className="text-[13px] md:text-[14px]">
          {/*
            🚨 "MATCH", NOT "CAN BE BUILT". The finder matches a bench bullet
            over a ± gr window — five grains by default — so this list
            routinely holds loads worked up with bullets the member does NOT
            own: a 150 gr .308 on the shelf brings back 145 and 155 gr loads.
            "N loads can be built from your bench" told them those were theirs
            to load, which is one weight's charge offered for another. The
            window decides what is SHOWN; every row still carries its own
            bullet weight, and the member loads the one whose bullet they
            actually have.

            ⚠️ ZERO IS SPELLED OUT, NOT COUNTED. "0 loads match your bench ·
            0 cartridges" is the same figure said twice with a false second
            clause — the member HAS cartridges, and the panel below is already
            explaining which axis starved. A count of nothing is a sentence,
            not an arithmetic.
          */}
          {result && result.count === 0 ? (
            <span>No loads match your bench</span>
          ) : result ? (
            <>
              <span className="num" style={{ fontWeight: 600 }}>
                {result.count}
              </span>
              <span className="md:hidden"> load{result.count === 1 ? '' : 's'} match your bench</span>
              <span className="hidden md:inline">
                {' '}
                load{result.count === 1 ? '' : 's'} match your bench{' '}
              </span>
              {groups.length > 0 ? (
                <span className="hidden md:inline" style={{ color: 'var(--text-tertiary)' }}>
                  · {groups.length} cartridge{groups.length === 1 ? '' : 's'}
                </span>
              ) : null}
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

      {/*
        ⚠️ A CAP THE SCREEN DOES NOT MENTION IS THE SCREEN LYING ABOUT THE
        SHELF. The server stops at 600 rows and says so; without this line the
        member reads a count, scrolls to the end, and believes that is
        everything their bench can build. It names the two controls that
        actually narrow it — the cartridge tab and the weight band — rather
        than saying "refine your search", which is advice with no door.
      */}
      {result?.truncated ? (
        <div
          className="px-3 pb-1 text-[11.5px] md:px-0 md:pb-0 md:text-[12px]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Showing the first {result.count} loads — narrow the cartridge or weight to see the rest.
        </div>
      ) : null}

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
              another changes nothing. Four states, not one, because the fix
              differs every time: no bench at all; a bench short of one axis; a
              FULL bench whose three axes have no load in common, which is the
              one the counts explain; and a bench that can build things this
              filter excludes.
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
            ) : explained ? (
              <>
                {/*
                  🚨 THE BENCH HOLDS ALL THREE AND STILL BUILDS NOTHING. This
                  is the state the operator hit: powder, bullet and cartridge
                  all present, the AND across them empty, and a screen that
                  said only "check you have a powder, a bullet and a
                  cartridge" — advice for a bench they did not have. The
                  counts name the starving axis, so the panel names it too.
                */}
                <Title>{explained.title}</Title>
                {/* A measure, because these are sentences rather than the one
                    short line the other states carry: the panel is the full
                    width of the results column on a desktop, and a 120-column
                    line of prose centred in it is read twice. */}
                {explained.lines.map((line) => (
                  <div key={line} style={{ maxWidth: '54ch' }}>
                    {line}
                  </div>
                ))}
              </>
            ) : (
              <>
                {/*
                  ⚠️ THE TOOLBAR'S TWO WEIGHT CONTROLS ARE NAMED SEPARATELY,
                  because they are two different narrowings and a member who
                  has already set the band to "Any gr" would read a single
                  "widen the weight range" as advice they have taken. The
                  window is the ± gr one beside it.

                  ⚠️ AND BOTH SENTENCES ARE ABOUT THE SEARCH. Widening shows
                  more loads; it never changes a charge. Every load below is
                  printed under its own bullet weight with its own start and
                  max, and nothing here may suggest one weight's charge
                  carries to another.
                */}
                <Title>Nothing on the shelf builds this</Title>
                <div>
                  Turn a chip back on, widen the weight band or the ± gr window, or add another
                  component.
                </div>
              </>
            )}
            {/* Opens the picker for each axis the sentence just named. Nothing
                is offered when no single addition could help — a door that
                leads nowhere is worse than no door. */}
            {offer.length > 0 || onReset ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {offer.map((axis) => (
                  <Btn key={axis} size="mobile" onClick={opener[axis]}>
                    Add a {axis}
                  </Btn>
                ))}
                {/*
                  ⚠️ OFFERED IN EVERY EMPTY STATE, INCLUDING THE ONES THAT
                  OFFER NO PICKER. The filter state is exactly the one where a
                  member has switched chips off or narrowed the band and cannot
                  remember which — and it is the state that deliberately offers
                  no Add, because adding another powder to a full shelf changes
                  nothing. Without this it offers nothing at all.

                  ⚠️ AND IT SAYS FILTERS, NOT "bench" OR "search". It puts the
                  chips back on and the pills back to their defaults; it never
                  removes anything from the saved bench, and the word has to
                  keep those two apart.
                */}
                {onReset ? (
                  <Btn size="mobile" onClick={onReset}>
                    Reset filters
                  </Btn>
                ) : null}
              </div>
            ) : null}
          </Centred>
        ) : (
          groups.map((group) => (
            <Group
              key={group.cartridge.key}
              group={group}
              units={units}
              phone={phone}
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
  phone,
  onOpenLoad,
  onOpenSpec,
}: {
  group: LoadGroup;
  units: Units;
  phone: boolean;
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

      {/*
        🚨 ONE HEADING PER BULLET WEIGHT, AND IT IS THE LOAD'S OWN WEIGHT.
        The finder matches a bench bullet within a ± gr window, so a bench
        holding a 150 gr .308 can bring back 145, 150 and 155 gr loads at
        once — and each one arrives in the group for the weight IT was worked
        up at, with its own start and max charge underneath. That separation
        is the whole safety of the wider search: the window decides what is
        shown, never what may be loaded. Never fold these groups together, and
        never label a row with the bench bullet's weight instead of its own.
      */}
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
              phone={phone}
              /* ⚠️ CAPPED AT TWELVE ROWS OF STAGGER. Uncapped, the prototype's
                 35 ms per row is a courtesy at 8 rows and a fault at 300: the
                 last one arrives 10.5 seconds after the first, and the member
                 is looking at a list that is still filling in long after it
                 finished loading. Twelve rows is roughly one screen, which is
                 all the stagger anyone can see. */
              delayMs={Math.min(idx++, 12) * 35}
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
  phone,
  delayMs,
  onOpenLoad,
}: {
  row: LoadRow;
  group: LoadGroup;
  weightGr: number;
  units: Units;
  /**
   * ⚠️ ONE VARIANT IS RENDERED, AND THE BREAKPOINT CLASSES ARE GONE WITH THE
   * OTHER. `md:hidden` could not carry this decision on its own: `usePhone` is
   * also true for the INSTALLED app at any width, and a `md:hidden` wrapper
   * round the phone card would have hidden the whole list on an installed
   * tablet. The wrappers are now plain; `.bench .row` still supplies the
   * desktop grid and the phone card still overrides display inline.
   */
  phone: boolean;
  delayMs: number;
  onOpenLoad: ResultsListProps['onOpenLoad'];
}) {
  /**
   * `Sierra 150 gr HP` — the load's own bullet, in full.
   *
   * 🚨 THE MAKER AND THE TYPE STAY HERE. They were dropped from the MATCH —
   * a 150 gr .308 is a 150 gr .308 whoever made it, which is why the bench
   * finds these loads at all — but they are exactly the detail a member needs
   * once a row is in front of them: it names the projectile this charge was
   * worked up with. Stripping them from the results would leave three
   * indistinguishable "150 gr" rows and hide the one fact that separates them.
   *
   * `weightGr` is the group's — that is, this load's own weight, never the
   * bench bullet's. See the note above the weight groups.
   */
  const bullet = bulletLabel(row, weightGr);
  const startV = chargeVelocity(row.startFps, units);
  const maxV = chargeVelocity(row.maxFps, units);
  const coal = coalText(row, units);
  const tags = tagsFor(row, group.cartridge.maxLengthMm);
  // The group's weight travels with the row — see ResultsListProps.onOpenLoad.
  // It is what the card and the log sheet print beside this charge, so it is
  // handed over rather than searched for at the other end.
  const open = () => onOpenLoad(row, group, weightGr);

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

  if (!phone) {
    return (
      <div>
        <button
          type="button"
          className="row"
          style={{ animationDelay: `${delayMs}ms` }}
          onClick={open}
        >
          <div>{bullet}</div>
          <div style={{ fontWeight: 500 }}>{row.powder}</div>
          <Charge gr={row.startGr} velocity={startV} weight={500} label="Start charge" />
          <Charge gr={row.maxGr} velocity={maxV} weight={600} label="Max charge" />
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
    );
  }

  return (
    <>
      <div>
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
