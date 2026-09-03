/**
 * THE DESK — the feed contract.
 *
 * ⚠️ THE SERVER OWNS THE PILE. Priority, banding, overdue and the sunk state
 * are all decided in one place on the backend and sent down already sorted;
 * the client renders what it is given and never re-sorts. The alternative —
 * every surface deriving urgency from raw rows — is how the phone and the
 * desktop end up disagreeing about what matters most, and how a new card
 * type silently lands in the wrong band.
 */
import { deskFetch } from './desk-auth';
import type { DeskCardType } from '../components/desk/icons';

/**
 * The four bands, in the only order they ever appear.
 *
 * Fixed, not configurable. An operator who can reorder their own priorities
 * will eventually put money below housekeeping on a bad morning.
 */
export const BAND_ORDER = ['money_firearms', 'disputes', 'reviews_cases', 'housekeeping'] as const;
export type BandKey = (typeof BAND_ORDER)[number];

export const BAND_LABEL: Record<BandKey, string> = {
  money_firearms: 'Money & firearms',
  disputes: 'Disputes',
  reviews_cases: 'Reviews & cases',
  housekeeping: 'Housekeeping',
};

export type TagKindWire = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'ink';

export interface FeedTag {
  kind: TagKindWire;
  label: string;
  /** Names a glyph in the kit; the client maps it. Warn/bad get one anyway. */
  icon?: 'clock' | 'alert' | 'lock' | 'check' | 'info' | 'bolt';
}

/**
 * What an action does, which decides how the client treats it.
 *
 * ⚠️ 'money' NEVER TAKES THE UNDO PATH. The kind is sent by the server rather
 * than inferred from the label, so a new money action cannot accidentally
 * inherit a ten-second window because someone called it "Release".
 */
export type ActionKind = 'undo' | 'money' | 'drawer' | 'link' | 'gated';

export interface FeedAction {
  key: string;
  label: string;
  kind: ActionKind;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'gated';
  /** For 'link' — an external surface, opened in a new tab. */
  href?: string;
  /** For 'money' — the amount the confirm button carries, pre-formatted. */
  amount?: string;
  /** Past tense, for the undo toast: "Approved UM000598". */
  doneMessage?: string;
}

export interface DeskCardData {
  id: string;
  type: DeskCardType;
  /** Overrides the per-type header glyph. Two Warden faces share one type. */
  icon?: 'clock' | 'alert' | 'lock' | 'check' | 'info' | 'bolt';
  /** "Firearm transfer" — what the operator reads, not the enum. */
  typeLabel: string;
  band: BandKey;
  reference?: string;
  headline: string;
  meta?: string;
  note?: string;
  tags: FeedTag[];
  actions: FeedAction[];
  /** ISO. Present when the card is past its SLA; the client floats it. */
  overdueSince?: string;
  /** False on a red gate: it must stay visible. */
  canLater: boolean;
  /** ISO — set while sunk. The card renders dimmed with its return time. */
  laterUntil?: string;
}

export interface RibbonCellData {
  label: string;
  value: string;
  sub?: string;
  dot?: 'ok' | 'warn' | 'bad' | 'info' | 'unknown';
}

export interface ActivityEntry {
  time: string;
  text: string;
  reference?: string;
}

export interface DeskFeed {
  /** Server-sorted: band order, then overdue first, then oldest. */
  cards: DeskCardData[];
  bands: { key: BandKey; count: number }[];
  ribbon: RibbonCellData[];
  money: {
    held: string;
    payable: string;
    blocked: string;
    /** The raw figure behind `blocked`, so the row can be coloured by
     *  VALUE rather than by which row it is. R0 blocked is the good
     *  state and must not read as a warning. */
    blockedCents?: number;
    refundPending: string;
    heldSub?: string;
    payableSub?: string;
    blockedSub?: string;
    refundSub?: string;
    /** The gate line under the money card, when payouts cannot run. */
    gateNote?: string;
  };
  pile: {
    overdue: number;
    sunk: number;
    sunkReturnsAt?: string;
  };
  activity: ActivityEntry[];
}

/** GET admin/desk — the whole surface in one request. */
export function fetchDeskFeed(): Promise<DeskFeed> {
  return deskFetch<DeskFeed>('/admin/desk');
}

/**
 * POST admin/desk/:id/act — the undoable actions, and only those.
 *
 * ⚠️ MONEY CARD TYPES ARE EXCLUDED SERVER-SIDE. They keep their own explicit
 * endpoints so that a bug in this generic dispatcher can never move money:
 * the worst it can do is approve a listing twice.
 */
export function actOnCard(cardId: string, actionKey: string): Promise<unknown> {
  return deskFetch(`/admin/desk/${encodeURIComponent(cardId)}/act`, {
    method: 'POST',
    body: JSON.stringify({ action: actionKey }),
  });
}

/** The same call, shaped for sendBeacon when the tab is closing. */
export function actBeacon(cardId: string, actionKey: string): { url: string; body: string } {
  return {
    url: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'}/admin/desk/${encodeURIComponent(cardId)}/act`,
    body: JSON.stringify({ action: actionKey }),
  };
}

/** POST admin/desk/:id/later — sink a card for four hours. */
export function sinkCard(cardId: string): Promise<unknown> {
  return deskFetch(`/admin/desk/${encodeURIComponent(cardId)}/later`, { method: 'POST' });
}

/**
 * Group the server's already-sorted cards into their bands.
 *
 * ⚠️ THIS PRESERVES SERVER ORDER AND DOES NOT SORT. The server has already
 * floated overdue cards to the top of their band and sunk the Later ones to
 * the bottom; re-sorting here would silently override it.
 */
export function groupIntoBands(
  cards: DeskCardData[],
): { key: BandKey; label: string; cards: DeskCardData[] }[] {
  return BAND_ORDER.map((key) => ({
    key,
    label: BAND_LABEL[key],
    cards: cards.filter((c) => c.band === key),
  })).filter((b) => b.cards.length > 0);
}

/** "12:40" in SAST, for a sunk card's return time. */
export function formatReturnTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Johannesburg',
  });
}
