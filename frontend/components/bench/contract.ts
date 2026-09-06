/**
 * THE BENCH — the component contract.
 *
 * Every component under components/bench/ implements its interface from this
 * file, and composes its children through these props only.
 *
 * ⚠️ THIS FILE IS THE REASON THE PIECES FIT. LoadCard renders CoalGauge and
 * LoadChart; SpecCard renders CartridgeDrawing2D and LatheView. Written
 * separately without a shared contract, each author invents a plausible prop
 * shape and the composition breaks in ways tsc reports as a wall of unrelated
 * errors. Change a shape HERE first, then the implementations.
 *
 * Data shapes come from lib/bench/api.ts (which mirrors the backend) and
 * geometry from lib/bench/geometry.ts. Nothing is redeclared here.
 */
import type {
  BenchView,
  BenchBulletOption,
  BenchCartridgeOption,
  BenchPowder,
  CartridgeSpec,
  LoadGroup,
  LoadRow,
  LoadsResponse,
  LogEntry,
} from '@/lib/bench/api';
import type { Dims, Units } from '@/lib/bench/geometry';

/* ── Finder state ───────────────────────────────────────────────────── */

/** The weight bands the finder offers. Values match the API's `weight` query. */
export type WeightBand = 'any' | 'lte100' | '100to150' | 'gte150';

export const WEIGHT_BANDS: { id: WeightBand; label: string }[] = [
  { id: 'any', label: 'Any gr' },
  { id: 'lte100', label: '≤ 100 gr' },
  { id: '100to150', label: '100–150 gr' },
  { id: 'gte150', label: '150 gr +' },
];

/**
 * What the member has switched OFF for this search.
 *
 * ⚠️ THIS IS NOT THEIR BENCH. Toggling a chip changes the current search only;
 * the saved bench is edited through the Add flows and through the × beside
 * each chip (BenchRailProps.onRemove), both of which PUT /bench/me. A
 * component that writes an `off` toggle back to the server has broken the
 * central promise of the finder.
 *
 * 🚨 AND THE IDS HERE ARE THE IDS THE REMOVE USES. onToggle and onRemove take
 * the same `(kind, id)` pair, so a key spelled one way for the toggle and
 * another for the removal would take the wrong entry off the bench for good.
 * Every one of them comes from the same place: `p.id`, `c.key`, bulletKey(b).
 */
export interface OffState {
  powderIds: string[];
  cartridgeKeys: string[];
  /**
   * bulletKey() — `${calibreIn}|${weightGr}`, with an EMPTY first part for a
   * bullet saved before calibres were recorded.
   *
   * ⚠️ WRITTEN OUT HERE ONLY AS A REMINDER; bulletKey() BELOW IS THE SPELLING,
   * and the backend's benchBulletKey() in bench.types.ts has to match it
   * character for character or `off` silently matches nothing — the chip stays
   * greyed on the screen and stays live in the query. An empty part is a part:
   * `|150` is the two-part form, not a one-part one.
   */
  bullets: string[];
}

export const EMPTY_OFF: OffState = { powderIds: [], cartridgeKeys: [], bullets: [] };

/**
 * A bullet's identity, in one string: calibre then weight, and nothing else.
 *
 * 🚨 THE CALIBRE IS HALF OF IT. Leave it out and a .277 and a .308 150 gr
 * collapse to one key again — which is the bug this whole field exists to fix.
 * The maker and the category are NOT in it, deliberately: a 150 gr .308 is the
 * same bullet whoever made it, which is the whole point of the Bench.
 *
 * ⚠️ A BULLET WITH NO CALIBRE KEYS AS `|150`, NOT AS `150`. Benches saved
 * before calibres were recorded have none, and the empty leading part is what
 * the backend's parseGuestBullet() counts to tell the new two-part form from
 * the legacy `maker|weight|category` one. Collapsing it away would make a
 * legacy shelf unreadable at the other end.
 */
export function bulletKey(b: { weightGr: number; calibreIn?: number | null }): string {
  return `${b.calibreIn ?? ''}|${b.weightGr}`;
}

/**
 * Grain windows the finder offers, and the default.
 *
 * ⚠️ FIVE GRAINS IS INHERITED, NOT INVENTED — the retired Load Lab used the
 * same default, and the reloading-manual search auto-broadens by the same.
 *
 * ⚠️ IT WIDENS THE SEARCH, NEVER A CHARGE. Every load stays quoted at its
 * own bullet weight with its own start and max. Nothing on screen may
 * suggest a charge for a 145 gr bullet may be used with a 155 gr one.
 */
export const WEIGHT_TOLERANCES: { id: number; label: string }[] = [
  { id: 0, label: 'Exact' },
  { id: 5, label: '± 5 gr' },
  { id: 10, label: '± 10 gr' },
  { id: 15, label: '± 15 gr' },
];

export const DEFAULT_TOLERANCE = 5;

/* ── The overlay stack ──────────────────────────────────────────────── */

/**
 * Which surfaces open over the finder.
 *
 * ⚠️ 'bench' IS THE PHONE'S BENCH SHEET AND 'powders' IS THE POWDER PICKER —
 * two different surfaces. They shared one value once, and the "My bench"
 * button mounted both.
 */
export type OverlayKind =
  | 'bench'
  | 'load'
  | 'spec'
  | 'log'
  | 'logList'
  | 'powders'
  | 'bullets'
  | 'cartridges';

/**
 * The overlays that are open, bottom first.
 *
 * 🚨 A STACK, NOT AN ENUM, AND BEHAVIOUR.md §12 IS WHY: "the log sheet opens
 * over the load card. Escape closes only the top one, and closing returns
 * focus to whatever opened it." A single value cannot express that — the log
 * sheet REPLACED the card, so the card unmounted, its focus return fired into
 * a dialog that was still open, and closing the sheet had to guess whether to
 * put the card back.
 *
 * 🚨 AND THE STACK IS THE ONLY RECORD OF WHO OPENED WHAT. The spec card opened
 * from a load card must close back onto it; opened from a group header it must
 * close onto nothing. Held as a separate `openLoad` flag that was never
 * cleared, the second case brought back whichever load card had been looked at
 * last — a card for a cartridge the member was no longer reading about. Here
 * the answer is structural: `['load','spec']` closes to `['load']` and
 * `['spec']` closes to `[]`, with nothing to keep in step.
 *
 * OverlayShell's own module-level stack (primitives.tsx) is the DOM half of
 * this — mount order, which is stacking order. This is the state half.
 */
export type OverlayStack = readonly OverlayKind[];

export const NO_OVERLAY: OverlayStack = [];

/** The overlay that owns Escape, the dim and the focus. Null when none is open. */
export function topOverlay(stack: OverlayStack): OverlayKind | null {
  return stack.length ? stack[stack.length - 1] : null;
}

/** Is it open at all, at any depth? Both mounted means both drawn. */
export function hasOverlay(stack: OverlayStack, kind: OverlayKind): boolean {
  return stack.includes(kind);
}

/**
 * Open one ON TOP of what is already there — the log sheet over the load card.
 *
 * ⚠️ AN ALREADY-OPEN SURFACE MOVES RATHER THAN DOUBLING. Two entries for one
 * kind would mount two copies of the same dialog, and the second Escape would
 * close a dialog that was no longer on screen.
 */
export function pushOverlay(stack: OverlayStack, kind: OverlayKind): OverlayStack {
  return [...stack.filter((k) => k !== kind), kind];
}

/**
 * Open one INSTEAD of everything — the pickers, the bench sheet, a spec card
 * opened from a group header.
 */
export function onlyOverlay(kind: OverlayKind): OverlayStack {
  return [kind];
}

/**
 * Swap the top for another of the same depth — a shell-holder chip opening the
 * next cartridge's spec card. Replacing rather than stacking is deliberate:
 * six chips followed six deep is six Escapes back to the finder.
 */
export function replaceTop(stack: OverlayStack, kind: OverlayKind): OverlayStack {
  return [...stack.slice(0, -1), kind];
}

/**
 * Close one, and anything above it.
 *
 * ⚠️ BY KIND, NOT BY POPPING, because the caller is the overlay itself and it
 * knows what it is, not where it sits. Closing something buried would leave a
 * dialog on screen whose parent had gone; taking the ones above with it is the
 * only outcome that cannot.
 *
 * A kind that is not open returns the SAME reference, which is what lets a
 * late-resolving save ask "is the log sheet still open?" without reopening
 * anything: if the member closed everything, this is a no-op.
 */
export function closeOverlay(stack: OverlayStack, kind: OverlayKind): OverlayStack {
  const at = stack.indexOf(kind);
  return at < 0 ? stack : stack.slice(0, at);
}

/* ── URL state ──────────────────────────────────────────────────────── */

/**
 * The finder's controls, as the address bar carries them.
 *
 * 🚨 THE OVERLAYS ARE NOT IN HERE, AND MUST NOT BE. SPEC-BUILD §11: "every
 * overlay opens on top of the finder; the URL never changes except the `?s=`
 * permalink". A load card in the URL would put a modal into the back button,
 * and Escape and Back would then mean different things on the same screen.
 *
 * 🚨 AND NEITHER ARE UNITS. mm/inch is a preference stored on the member's
 * bench, not a description of this search — carried in the link it would
 * silently flip a reader's saved preference from a shared query.
 */
export interface BenchUrlState {
  off: OffState;
  cartridge: string;
  weight: WeightBand;
  tolerance: number;
}

export const DEFAULT_URL_STATE: BenchUrlState = {
  off: EMPTY_OFF,
  cartridge: 'all',
  weight: 'any',
  tolerance: DEFAULT_TOLERANCE,
};

/**
 * ⚠️ THREE PARAMETERS, ONE PER AXIS, BECAUSE `off` IS THREE LISTS AND THE API'S
 * FLAT ONE THROWS THE AXIS AWAY. lib/bench/api.ts joins all three for the
 * server, which matches every axis against the same set — but a link has to
 * come BACK, and a flat list cannot say whether `6-5-creedmoor` was a cartridge
 * the member switched off or a powder id that happened to look like one.
 *
 * No separator collides: powder ids are cuids, cartridge keys are alphanumeric,
 * and a bullet keys as `0.308|150`. None of the three contains a comma.
 */
const OFF_PARAM: Record<keyof OffState, string> = {
  powderIds: 'offp',
  bullets: 'offb',
  cartridgeKeys: 'offc',
};

function splitCsv(v: string | null): string[] {
  return v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/**
 * The finder's state as a query string, with the DEFAULTS LEFT OUT.
 *
 * ⚠️ A DEFAULT WRITTEN OUT IS A DEFAULT THAT CANNOT MOVE. `?tol=5` in a
 * bookmark pins that member to five grains for ever, including the day the
 * default becomes ten — and it makes the ordinary, untouched bench carry a URL
 * full of parameters nobody chose, which is the state most links get copied
 * from.
 *
 * Returns the query WITHOUT the leading `?` — empty when nothing is set.
 */
export function benchUrlSearch(state: BenchUrlState): string {
  const p = new URLSearchParams();
  if (state.cartridge && state.cartridge !== 'all') p.set('cartridge', state.cartridge);
  if (state.weight && state.weight !== 'any') p.set('weight', state.weight);
  if (Number.isFinite(state.tolerance) && state.tolerance !== DEFAULT_TOLERANCE) {
    p.set('tol', String(state.tolerance));
  }
  // Sorted, so the same shelf in a different tapping order produces the same
  // link — otherwise `router.replace` fires on a string that says nothing new.
  for (const kind of ['powderIds', 'bullets', 'cartridgeKeys'] as (keyof OffState)[]) {
    const list = state.off[kind];
    if (list.length) p.set(OFF_PARAM[kind], [...list].sort().join(','));
  }
  return p.toString();
}

/**
 * The other direction.
 *
 * ⚠️ EVERY VALUE IS CHECKED AGAINST WHAT THE TOOLBAR ACTUALLY OFFERS. A URL is
 * typed by strangers and by our own older links: `?weight=heavy` would light no
 * pill while narrowing the search, and `?tol=999` would ask the server for a
 * width it clamps anyway — so the screen and the answer would disagree with
 * nothing on either saying why. An unrecognised value falls back to the
 * default, which is the state the pills can actually draw.
 *
 * Takes anything with a `get` — `URLSearchParams` and Next's `ReadonlyURL
 * SearchParams` both qualify — so the page hands its hook straight in.
 */
export function parseBenchUrl(params: { get(name: string): string | null }): BenchUrlState {
  const weightRaw = params.get('weight');
  const weight = WEIGHT_BANDS.some((b) => b.id === weightRaw)
    ? (weightRaw as WeightBand)
    : 'any';

  /**
   * 🚨 `Number(null)` IS 0, AND 0 IS A REAL WIDTH ON THIS TOOLBAR. Read
   * straight through Number(), a URL with no `tol` at all parsed as "Exact" —
   * so every plain `/bench` opened on the narrowest setting the finder has,
   * the pill lit accordingly, and the member saw a fraction of their loads
   * with nothing on screen saying why. The absence has to be tested before the
   * value is, which is the same trap setTolerance() in lib/bench/api.ts
   * documents from the other end.
   */
  const tolRaw = params.get('tol');
  const tolNum = tolRaw === null || tolRaw.trim() === '' ? NaN : Number(tolRaw);
  const tolerance = WEIGHT_TOLERANCES.some((t) => t.id === tolNum) ? tolNum : DEFAULT_TOLERANCE;

  return {
    off: {
      powderIds: splitCsv(params.get(OFF_PARAM.powderIds)),
      bullets: splitCsv(params.get(OFF_PARAM.bullets)),
      cartridgeKeys: splitCsv(params.get(OFF_PARAM.cartridgeKeys)),
    },
    cartridge: params.get('cartridge') || 'all',
    weight,
    tolerance,
  };
}

/**
 * A shared bench snapshot, applied to the READER's own shelf as switched-off
 * chips.
 *
 * 🚨 A LINK MAY NARROW MY SEARCH AND MAY NEVER TOUCH MY BENCH. The snapshot
 * describes the sender's shelf, and the only honest way to answer their
 * question on my screen is to mute everything of mine they did not have — the
 * same "off for this search" the chips already do, reversible with one tap and
 * saved nowhere. Writing their shelf into my bench through a URL would let a
 * link edit somebody's stored data, which is not a thing a link may do.
 *
 * ⚠️ AND ANYTHING OF MINE THEY DID NOT HAVE IS MUTED — never the other way
 * about. What they had and I do not is simply absent; there is no chip to
 * light, and adding one would be the link writing to my bench by another name.
 */
export function offFromSnapshot(
  mine: {
    powders: { id: string }[];
    bullets: { weightGr: number; calibreIn?: number | null }[];
    cartridges: { key: string }[];
  },
  theirs: {
    powders?: { id: string }[];
    bullets?: { weightGr: number; calibreIn?: number | null }[];
    cartridges?: { key: string }[];
  },
  alreadyOff: OffState = EMPTY_OFF,
): OffState {
  const theirPowders = new Set((theirs.powders ?? []).map((p) => p.id));
  const theirBullets = new Set((theirs.bullets ?? []).map(bulletKey));
  const theirCartridges = new Set((theirs.cartridges ?? []).map((c) => c.key));

  const union = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));

  return {
    powderIds: union(
      alreadyOff.powderIds,
      mine.powders.filter((p) => !theirPowders.has(p.id)).map((p) => p.id),
    ),
    bullets: union(
      alreadyOff.bullets,
      mine.bullets.map(bulletKey).filter((k) => !theirBullets.has(k)),
    ),
    cartridgeKeys: union(
      alreadyOff.cartridgeKeys,
      mine.cartridges.filter((c) => !theirCartridges.has(c.key)).map((c) => c.key),
    ),
  };
}

/* ── Shared leaf props ──────────────────────────────────────────────── */

export interface UnitProps {
  units: Units;
}

export interface CartridgeThumbProps {
  dims: Partial<Dims> | null;
  /** 128×30 in lists, 96×24 on mobile. */
  size?: 'desktop' | 'mobile';
  className?: string;
}

/**
 * ⚠️ EXTENDS UnitProps. The drawing sits inside the spec card, whose header
 * carries an mm/inch toggle — a drawing still printing millimetres beside a
 * table showing inches is one screen contradicting itself.
 */
export interface CartridgeDrawing2DProps extends UnitProps {
  dims: Dims;
  /** The dimension letter currently lit, e.g. "L3". Null when nothing is hovered. */
  hot: string | null;
  onHotChange?: (letter: string | null) => void;
  /** Suppresses the draw-in animation when the card re-renders. */
  animate?: boolean;
}

export interface CoalGaugeProps extends UnitProps {
  /** The load's COAL. Null when no manual printed one. */
  coalMm: number | null;
  /** Maximum cartridge length (C.I.P. L6) — the gauge's upper bound. */
  maxLengthMm: number | null;
  coalLoMm?: number | null;
  coalHiMm?: number | null;
}

export interface LoadChartProps extends UnitProps {
  startGr: number;
  startFps: number | null;
  maxGr: number;
  maxFps: number | null;
  animate?: boolean;
}

/* ── Finder ─────────────────────────────────────────────────────────── */

export interface BenchRailProps {
  bench: BenchView;
  off: OffState;
  onToggle: (kind: keyof OffState, id: string) => void;
  /**
   * ⚠️ TOGGLING AND REMOVING ARE DIFFERENT ACTS, AND THE RAIL MUST OFFER BOTH.
   * onToggle takes something off the shelf for THIS SEARCH and saves nothing;
   * onRemove takes it off the bench for good and writes. Until this existed a
   * member who added a bullet they did not own had no way to take it back —
   * the chip greyed out and stayed there for ever.
   */
  onRemove: (kind: keyof OffState, id: string) => void;
  onAddPowder: () => void;
  onAddBullet: () => void;
  onAddCartridge: () => void;
}

export interface BenchSheetProps extends BenchRailProps {
  open: boolean;
  onClose: () => void;
}

/** The three axes a load needs, in the order the empty state offers them. */
export type BenchAxis = 'powder' | 'bullet' | 'cartridge';

export const BENCH_AXES: BenchAxis[] = ['powder', 'bullet', 'cartridge'];

/**
 * Which axes the bench has NOTHING on.
 *
 * ⚠️ THIS IS NOT "THE BENCH IS EMPTY", AND THE DIFFERENCE IS THE WHOLE POINT.
 * Results are an AND across powder, bullet and cartridge, so one missing axis
 * empties the screen while the other two may be full. A single boolean forced
 * the empty state to guess, and it guessed "add a powder" — sending a member
 * who owns six powders and no cartridge to the one axis they had already
 * filled, where adding a seventh powder changes nothing. Naming the axis is
 * what makes the empty state actionable.
 *
 * All three false means the bench can build something and the FILTER is what
 * is too narrow — a different sentence and a different fix.
 */
export type BenchGaps = Record<BenchAxis, boolean>;

/**
 * The three axes as the search actually ran them, each item named the way the
 * rail names it: a powder by its name, a cartridge by its name, a bullet as
 * calibre-maker-weight.
 *
 * ⚠️ THE ACTIVE SHELF, NOT THE SAVED BENCH. `off` chips narrow the search
 * without touching the bench, so a list built from BenchView alone would name
 * a powder the member had just switched off — and the sentence it feeds is a
 * statement about the search it is explaining, not about the shelf.
 *
 * ⚠️ NAMES, NOT ROWS. The empty state only ever prints these; handing it
 * BenchView instead would let it re-derive a bullet's label a second way and
 * disagree with the chip the member is looking at.
 */
export interface ShelfNames {
  powders: string[];
  bullets: string[];
  cartridges: string[];
}

export interface ResultsListProps extends UnitProps {
  result: LoadsResponse | null;
  loading: boolean;
  error: string | null;
  /**
   * 🚨 THE WEIGHT IS PASSED, NOT LOOKED UP AGAIN. It is the LOAD'S OWN bullet
   * weight — the weight group the row was drawn under — and it is the number
   * the load card and the log sheet print beside the charge. Since the finder
   * matches a bench bullet over a ± gr window, one cartridge now draws several
   * weight groups, and a caller that re-derived this by searching the group
   * for the row would have a miss to handle: a fallback of 0, or of the bench
   * bullet's weight, prints a charge under a weight it was never worked up at.
   * The row already knows; it says so.
   */
  onOpenLoad: (row: LoadRow, group: LoadGroup, weightGr: number) => void;
  onOpenSpec: (cartridgeKey: string) => void;
  onRetry: () => void;
  /** Which axes are bare. See BenchGaps — not a "bench is empty" flag. */
  gaps: BenchGaps;
  /**
   * What this search ran against, named.
   *
   * ⚠️ THE OTHER HALF OF LoadsResponse.why. The counts say WHICH axis starved;
   * these say WHAT the member has on the two that did not, so the empty state
   * can read "Your .30-06 and N550 have 70 loads together — but none for the
   * bullets on your bench" instead of a shrug. Counts without names is a
   * sentence about nobody's bench.
   */
  shelf: ShelfNames;
  /**
   * ⚠️ ALL THREE, NOT JUST THE POWDER ONE. The empty state opens the picker
   * for the axis it just named; with only `onAddPowder` to hand it could not.
   */
  onAddPowder: () => void;
  onAddBullet: () => void;
  onAddCartridge: () => void;
  /**
   * Put every control back where it started — chips on, cartridge All, weight
   * Any, the grain window back to its default. SPEC-BUILD §6.1 lists it in the
   * empty state and it was never built.
   *
   * ⚠️ THE FILTERS ONLY. It never touches the saved bench, so a member who has
   * muted five chips gets them back with one tap and a member who removed one
   * does not get it back at all — two different acts, as everywhere else in
   * this module.
   *
   * Optional: without it the empty state is exactly as it was.
   */
  onReset?: () => void;
}

/* ── Load card ──────────────────────────────────────────────────────── */

export interface LoadCardProps extends UnitProps {
  row: LoadRow;
  cartridge: LoadGroup['cartridge'];
  weightGr: number;
  onClose: () => void;
  onLog: () => void;
  onSpec: () => void;
}

/* ── Spec card ──────────────────────────────────────────────────────── */

export type SpecView = '2d' | 'lathe' | 'half';

/**
 * The spec response as the card reads it.
 *
 * ⚠️ `shellHolderMore` IS SERVED BUT NOT YET DECLARED ON `CartridgeSpec`.
 * The backend caps `shellHolderGroup` at twelve and reports the remainder, so
 * the card can print "+7 more" instead of silently claiming that twelve is all
 * of them. `lib/bench/api.ts` is owned by another change in flight; widening
 * the wire type there is the right home for this field and this intersection
 * goes when it lands. Optional, so the page keeps passing a plain
 * `CartridgeSpec` with no cast.
 */
export type SpecCardSpec = CartridgeSpec & { shellHolderMore?: number };

export interface SpecCardProps extends UnitProps {
  spec: SpecCardSpec | null;
  loading: boolean;
  error: string | null;
  /**
   * ⚠️ THE HEADER FROM THE GROUP THAT OPENED THE CARD, SHOWN BEFORE THE FETCH.
   * SPEC §7: "header immediately from the group data; drawing skeleton until
   * `/bench/cartridges/:key` returns". Without these the title is a skeleton
   * bar for the length of a round trip — and a skeleton has no text, so the
   * dialog opens with an EMPTY accessible name and a screen reader announces
   * nothing at all. `spec` wins the moment it arrives.
   */
  name?: string | null;
  type?: string | null;
  origin?: string | null;
  year?: number | null;
  onClose: () => void;
  onUnitsChange: (u: Units) => void;
  onShowOnly: (cartridgeKey: string) => void;
  /** A same-shell-holder chip opens that cartridge's card. Optional: without it the chips are labels. */
  onOpenCartridge?: (cartridgeKey: string) => void;
  /** Retry the fetch behind the error state. Optional: without it the card only offers Close. */
  onRetry?: () => void;
  /** Raised by the 3D view's snapshot export. */
  onToast?: (message: string) => void;
}

/**
 * ⚠️ EXTENDS UnitProps, for the reason CartridgeDrawing2DProps does. The
 * calliper readout and every 3D label were hard-coded to millimetres while the
 * table beside them followed the card's mm/inch control.
 */
export interface LatheViewProps extends UnitProps {
  dims: Dims;
  /** Half section cuts the solid of revolution along the axis. */
  halfSection: boolean;
  /**
   * The dimension letter lit in the table, so a hovered row lights the model.
   *
   * ⚠️ THE CALLIPER OWNS THIS LETTER AND THE TABLE BORROWS IT. A snap calls
   * `onHotChange`; the card holds the result and hands it straight back. Table
   * hover overrides it while the pointer is on the row and RELEASES BACK to
   * the snapped letter on leave — releasing to null instead would put the
   * calliper's own reading out every time the pointer crossed the table.
   */
  hot?: string | null;
  onHotChange?: (letter: string | null) => void;
  /** For the canvas label and the corner of the exported snapshot. */
  name?: string | null;
  /** Names the exported file: `<slug>-dimensions.png`. */
  slug?: string | null;
  /** Raised with "Snapshot saved" once the PNG is handed to the browser. */
  onToast?: (message: string) => void;
}

/* ── Log ────────────────────────────────────────────────────────────── */

export interface LogSheetProps extends UnitProps {
  row: LoadRow;
  cartridge: LoadGroup['cartridge'];
  weightGr: number;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (entry: LogDraft) => void;
}

/** Exactly the body POST /bench/log accepts — see BenchService.addLog. */
export interface LogDraft {
  cartridgeKey: string;
  bulletLabel: string;
  powderName: string;
  chargeGr: number;
  coalMm: number | null;
  primer: string | null;
  caseLabel: string | null;
  loadId: string | null;
  velocityMs: number | null;
  groupMm: number | null;
  notes: string | null;
  /** yyyy-mm-dd from geometry.today(); the server honours it. */
  shotAt: string;
}

export interface LogListProps extends UnitProps {
  /**
   * ⚠️ IN THE SERVER'S ORDER, NEWEST FIRST, AND THE LIST DOES NOT RE-SORT.
   * `GET /bench/log` orders by `shotAt` desc — the day the round was fired,
   * which is the only date shown — so a client sort could only disagree with
   * it, and a back-dated entry would sit in a different place on the two.
   */
  entries: LogEntry[];
  loading: boolean;
  onClose: () => void;
  /**
   * ⚠️ MAY RETURN A PROMISE, AND SHOULD. A caller that hands one back lets the
   * list say so when the delete fails; a caller that returns void leaves the
   * row gone from the screen and present on the server, which is the state the
   * audit found.
   */
  onDelete: (id: string) => void | Promise<unknown>;
  /**
   * Told when the member's after-the-range figures have been saved, so the
   * page's copy of the entry matches what the server now holds.
   *
   * Optional: the list writes the change itself (the same exception the CSV
   * export takes, and for the same reason — see the note at the top of
   * LogList.tsx) and shows the new figures whether or not anyone is listening.
   */
  onUpdated?: (entry: LogEntry) => void;
  /**
   * Somewhere to say that a write failed. The list draws its own inline
   * message either way; this is what puts it in the page's toast as well.
   */
  onError?: (message: string) => void;
}

/* ── Pickers and toast ──────────────────────────────────────────────── */

export interface PowderPickerProps {
  open: boolean;
  powders: BenchPowder[];
  loading: boolean;
  /** Ids already on the bench, so they can be shown as added rather than offered twice. */
  onBench: string[];
  onClose: () => void;
  onAdd: (p: BenchPowder) => void;
}

export interface ToastProps {
  message: string | null;
  onDone: () => void;
  /**
   * A failure routed through the toast used to be confirmed with a green
   * tick. `error` swaps the glyph and the plate's accent; default `ok`.
   */
  tone?: 'ok' | 'error';
}

/**
 * ⚠️ VERBATIM, AND NOT NEGOTIABLE. Operator ruling, 2026-09-02: nothing on any
 * Bench surface may name where a figure comes from — no "manual", no "CIP", no
 * "SAAMI", no "published", no source counts. The backend already strips those
 * fields (see bench.leak.spec.ts); this is the same boundary in the UI, and it
 * is the reason these two strings are constants rather than copy each
 * component writes for itself.
 *
 * The vocabulary elsewhere: start charge / max charge, Dimensions, Pmax, and
 * "the maximum" for COAL. Powder and bullet MAKER names (Hodgdon, Hornady,
 * Somchem, PMP) are product facts and stay.
 */
export const SAFETY_LINE =
  'Work every load up from the start charge while watching for pressure signs.';

/** Shown once on the results screen, not on each card. */
export const VELOCITY_NOTE = 'Velocities are indicative only.';

/* ── Bullet and cartridge pickers ───────────────────────────────────── */

/**
 * ⚠️ THESE TWO PICKERS EXIST BECAUSE THE BENCH IS AN *AND* ACROSS THREE AXES.
 * A load shows only when the member has the powder AND a matching bullet AND
 * the cartridge, so a bench with powders but no bullets and no cartridges
 * returns nothing, for ever. The rail has always drawn three Add buttons; for
 * a while all three opened the powder picker, which made the other two axes
 * unreachable and the whole screen permanently empty.
 *
 * ⚠️ THE ROW SHAPES ARE RE-EXPORTED FROM lib/bench/api.ts, NOT REDECLARED.
 * They are wire shapes, and this file's header says so: data shapes come from
 * api.ts (which mirrors the backend) and nothing is redeclared here. They had
 * drifted into two declarations — one here, one inline on benchApi.bullets —
 * which is exactly how a field added at one end stops being read at the other.
 */
export type { BenchBulletOption, BenchCartridgeOption };

export interface BulletPickerProps {
  open: boolean;
  bullets: BenchBulletOption[];
  loading: boolean;
  /** bulletKey() values already on the bench. */
  onBench: string[];
  onClose: () => void;
  onAdd: (b: BenchBulletOption) => void;
}

export interface CartridgePickerProps {
  open: boolean;
  cartridges: BenchCartridgeOption[];
  loading: boolean;
  /** Cartridge keys already on the bench. */
  onBench: string[];
  onClose: () => void;
  onAdd: (c: BenchCartridgeOption) => void;
}
