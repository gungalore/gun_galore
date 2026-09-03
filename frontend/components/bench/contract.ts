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

export interface SpecCardProps extends UnitProps {
  spec: CartridgeSpec | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onUnitsChange: (u: Units) => void;
  onShowOnly: (cartridgeKey: string) => void;
}

export interface LatheViewProps {
  dims: Dims;
  /** Half section cuts the solid of revolution along the axis. */
  halfSection: boolean;
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
  entries: LogEntry[];
  loading: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
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
