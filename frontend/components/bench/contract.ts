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
 * the saved bench is edited through the Add flows, which PUT /bench/me. A
 * component that writes an `off` toggle back to the server has broken the
 * central promise of the finder.
 */
export interface OffState {
  powderIds: string[];
  cartridgeKeys: string[];
  /** `${maker}|${weightGr}|${category}` — the bullet's identity on the bench. */
  bullets: string[];
}

export const EMPTY_OFF: OffState = { powderIds: [], cartridgeKeys: [], bullets: [] };

export function bulletKey(b: { maker: string; weightGr: number; category: string }): string {
  return `${b.maker}|${b.weightGr}|${b.category}`;
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
  onAddPowder: () => void;
  onAddBullet: () => void;
  onAddCartridge: () => void;
}

export interface BenchSheetProps extends BenchRailProps {
  open: boolean;
  onClose: () => void;
}

export interface ResultsListProps extends UnitProps {
  result: LoadsResponse | null;
  loading: boolean;
  error: string | null;
  onOpenLoad: (row: LoadRow, group: LoadGroup) => void;
  onOpenSpec: (cartridgeKey: string) => void;
  onRetry: () => void;
  /** Shown by the empty state when the bench is empty rather than the filter too narrow. */
  benchIsEmpty: boolean;
  onAddPowder: () => void;
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
