/**
 * THE DESK — the WhatsApp reply thread.
 *
 * One inbound WhatsApp message from a buyer, the order it is about, and the
 * only thing the Desk may send back: a template that is already registered
 * with the provider. This module is the whole client contract for that card.
 *
 * 🚨 REGISTRY TEMPLATES ONLY, AND THE REGISTRY LIVES ON THE SERVER. There is
 * no template list in this file and there must never be one. A template name
 * typed here would be a name the provider has not approved — the send fails
 * at the API with a 132001 the operator cannot read, or worse, succeeds
 * against a template whose text nobody on this side has seen. The server
 * reads the registry from its own configuration (WHATSAPP_* env), renders
 * each body, and sends both down; the client picks one of what it was given
 * and posts the key back. `templates: []` therefore means "nothing may be
 * sent", not "the list is still loading" — see sendGate.
 *
 * 🚨 AND NO FREE TEXT, EVEN INSIDE THE 24-HOUR WINDOW. The window makes a
 * free-form reply *permissible* to Meta; it does not make it available here.
 * There is exactly one composer in the Desk and it talks to Warden. Nothing
 * in this module carries an operator-typed string to the provider, so a
 * later edit that wants one has to add a field, not just fill one in.
 *
 * ⚠️ FAIL CLOSED IS THE DEFAULT ON EVERY GATE BELOW. Channel flag missing,
 * window timestamp unparseable, template preview absent, registry empty — all
 * of them land on "cannot send" with the reason stated. The failure this
 * protects against is not a crash; it is a message leaving the building that
 * nobody chose, which is unrecallable.
 *
 * ⚠️ NO RAW MSISDN REACHES REACT STATE. The wire carries a phone number
 * because the provider addresses threads by one; `WhatsappThread` declares
 * only `phoneMasked`, and toThread masks at the boundary. The type stops the
 * JSX, the mapper stops the object — the same pair of guards lib/desk-orders
 * uses to keep buyer emails out of a devtools tree. Same reason usernames,
 * not names, are the only handle on this screen.
 *
 * ⚠️ THE ENDPOINTS BELOW ARE NOT BUILT YET. Nothing in backend/src answers
 * /admin/desk/whatsapp/* at the time of writing: the card type exists in the
 * DeskCardType union and nothing emits it. Every call here therefore fails
 * loudly through DeskFetchError into a FailedRegion, which is the honest
 * state — a drawer that renders a fake thread is how a card type stays
 * unreachable for another month without anyone noticing.
 */
import { deskFetch } from './desk-auth';
import type { Tone } from './desk-order';

/* ────────────────────────────────────────────────────────────────────────
 * The window
 * ──────────────────────────────────────────────────────────────────────── */

/** Meta's customer-service window: 24 hours from the buyer's last message. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Below this the countdown turns bad rather than warn.
 *
 * ⚠️ TWO HOURS IS A DEADLINE, NOT A DECORATION. When the window closes the
 * card resolves as unanswered and the buyer cannot be answered on this rail
 * at all until they write again — so the last stretch is the one colour step
 * the Desk has for "this expires whether or not you act".
 */
export const WINDOW_URGENT_MS = 2 * 60 * 60 * 1000;

/* ────────────────────────────────────────────────────────────────────────
 * Shapes
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * One registered template, as the server rendered it for THIS thread.
 *
 * `preview` is not a sample: it is the exact body that leaves, variables
 * already substituted, which is why it is what the radio row shows. A
 * template the server could not fill — no delivery date yet — comes back
 * `ready: false` with the reason in `blockedReason` ("needs a date"), and is
 * shown, unselectable, rather than hidden: an operator who knows the template
 * exists needs to see why it is not on offer.
 */
export interface WhatsappTemplate {
  /** The registry key posted back on send. Opaque here, by design. */
  key: string;
  /** The registered name, as the provider knows it. */
  label: string;
  /** The exact outgoing body, or null when the server could not render it. */
  preview: string | null;
  /** True only when this template can be sent right now. */
  ready: boolean;
  /** Why not, in the server's words. */
  blockedReason: string | null;
}

/** What the reply is about. Everything here is already on the order. */
export interface WhatsappOrderContext {
  /** Opens the order drawer. Null when the thread is not tied to one. */
  transactionId: string | null;
  reference: string | null;
  title: string | null;
  /** "Bob Go BG-77402 · in transit · no scan since Sun 21:15" */
  courier: string | null;
  /** "Wed 2 Sep" — the server formats it; it is prose, not a timestamp. */
  due: string | null;
}

export interface WhatsappThread {
  id: string;
  /** The order reference, shown beside the drawer's type label. */
  reference: string | null;
  /** Masked here, never raw. See the header note. */
  phoneMasked: string;
  username: string | null;
  /** The buyer's message, verbatim — it is the headline on the card. */
  inboundText: string;
  inboundAt: string | null;
  windowOpenedAt: string | null;
  windowClosesAt: string | null;
  /**
   * The whatsapp_enabled kill switch, as the server sees it.
   *
   * ⚠️ READ, NEVER WRITTEN FROM HERE. The switch is one of the Site board's
   * four settings and it turns the whole channel off; this drawer only obeys
   * it. Absent on the wire means off — a channel we cannot prove is on is a
   * channel we do not send on.
   */
  channelEnabled: boolean;
  /** Set once someone has answered or closed the thread by hand. */
  handledAt: string | null;
  order: WhatsappOrderContext | null;
  /** The registry, rendered for this thread. Empty means nothing may go out. */
  templates: WhatsappTemplate[];
}

/* ────────────────────────────────────────────────────────────────────────
 * The wire
 * ──────────────────────────────────────────────────────────────────────── */

interface TemplateWire {
  key?: string | null;
  label?: string | null;
  preview?: string | null;
  ready?: boolean | null;
  blockedReason?: string | null;
}

interface ThreadWire {
  id?: string | null;
  reference?: string | null;
  /** The provider addresses by MSISDN; it is masked before it is stored. */
  phone?: string | null;
  username?: string | null;
  inboundText?: string | null;
  inboundAt?: string | null;
  windowOpenedAt?: string | null;
  windowClosesAt?: string | null;
  channelEnabled?: boolean | null;
  handledAt?: string | null;
  order?: {
    transactionId?: string | null;
    reference?: string | null;
    title?: string | null;
    courier?: string | null;
    due?: string | null;
  } | null;
  templates?: TemplateWire[] | null;
}

const DOT = '·';

/**
 * "+27 82 ··· ··41".
 *
 * ⚠️ THE DOTS ARE THE SAME MIDDLE DOT THE ARTBOARD DRAWS, not the bullet
 * lib/mask-sensitive uses for identity numbers on the storefront. Two
 * different surfaces, two different masks, and neither is imported into the
 * other: the storefront one keeps a *local* leading zero ("082 ••• ••21")
 * because that is how a member reads their own number back, and the Desk one
 * keeps the country code because a WhatsApp thread is addressed
 * internationally and an operator comparing two threads needs the +27 to
 * know it is not a foreign number.
 *
 * Anything it cannot parse comes back fully masked. A number we cannot read
 * is never printed raw as a fallback — that is the whole point of the mask.
 */
export function maskMsisdn(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 4) return `${DOT.repeat(3)} ${DOT.repeat(3)} ${DOT.repeat(2)}`;
  const last2 = digits.slice(-2);
  // A local 0XX number and its +27 form are the same subscriber; normalising
  // means two threads from one buyer do not look like two buyers.
  const national = digits.startsWith('27')
    ? digits.slice(2)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  const network = national.slice(0, 2);
  return `+27 ${network} ${DOT.repeat(3)} ${DOT.repeat(2)}${last2}`;
}

/**
 * A template is only usable when the server both flagged it ready AND sent
 * the body it would send.
 *
 * ⚠️ A MISSING PREVIEW IS A BLOCK, NOT A COSMETIC GAP. The preview is the
 * only place the operator sees what leaves; sending a key whose text never
 * rendered on this screen is sending blind, which is exactly what the
 * registry rule exists to prevent.
 */
function toTemplate(w: TemplateWire): WhatsappTemplate | null {
  const key = typeof w.key === 'string' ? w.key.trim() : '';
  if (!key) return null; // a template we cannot name is a template we cannot post
  const preview = typeof w.preview === 'string' && w.preview.trim() ? w.preview : null;
  return {
    key,
    label: typeof w.label === 'string' && w.label.trim() ? w.label : key,
    preview,
    ready: w.ready === true && preview !== null,
    blockedReason:
      typeof w.blockedReason === 'string' && w.blockedReason.trim()
        ? w.blockedReason
        : preview === null
          ? 'the server could not fill this template in yet'
          : null,
  };
}

/**
 * ⚠️ REBUILT FIELD BY FIELD, NOT SPREAD. Spreading the body would carry
 * `phone` into React state under a name no type mentions — invisible in the
 * JSX and fully present in a devtools tree and any serialised error report.
 * Same discipline as fetchOrderBook in lib/desk-orders.
 */
function toThread(w: ThreadWire): WhatsappThread {
  return {
    id: typeof w.id === 'string' ? w.id : '',
    reference: w.reference ?? null,
    phoneMasked: maskMsisdn(w.phone),
    username: w.username ?? null,
    inboundText: typeof w.inboundText === 'string' ? w.inboundText : '',
    inboundAt: w.inboundAt ?? null,
    windowOpenedAt: w.windowOpenedAt ?? null,
    windowClosesAt: w.windowClosesAt ?? null,
    // Absent means off. See the field note.
    channelEnabled: w.channelEnabled === true,
    handledAt: w.handledAt ?? null,
    order: w.order
      ? {
          transactionId: w.order.transactionId ?? null,
          reference: w.order.reference ?? null,
          title: w.order.title ?? null,
          courier: w.order.courier ?? null,
          due: w.order.due ?? null,
        }
      : null,
    templates: (w.templates ?? []).map(toTemplate).filter((t): t is WhatsappTemplate => t !== null),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The calls
 * ──────────────────────────────────────────────────────────────────────── */

const BASE = '/admin/desk/whatsapp';

/** The thread, its order, and the registry rendered for it. */
export async function fetchWhatsappThread(id: string): Promise<WhatsappThread> {
  const body = await deskFetch<ThreadWire>(`${BASE}/${encodeURIComponent(id)}`);
  return toThread(body ?? {});
}

/**
 * Send one registered template.
 *
 * ⚠️ THE KEY IS THE ONLY THING THAT GOES UP. No body, no override, no
 * "personalised" suffix: the server renders from the registry and its render
 * is what the operator already read in the preview. A body parameter here
 * would be the free-text composer this card refuses to have, arriving by the
 * back door.
 *
 * ⚠️ RETURNS NOTHING, ON PURPOSE. The drawer reloads the thread afterwards
 * rather than trusting a shape from an endpoint that does not exist yet; a
 * declared return type would be a promise about a response nobody has
 * written. The reload also re-reads the window, which the send just consumed.
 */
export async function sendWhatsappTemplate(id: string, templateKey: string): Promise<void> {
  await deskFetch(`${BASE}/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ templateKey }),
  });
}

/** Close the thread without sending — someone answered on another rail. */
export async function markWhatsappHandled(id: string): Promise<void> {
  await deskFetch(`${BASE}/${encodeURIComponent(id)}/handled`, { method: 'POST' });
}

/* ────────────────────────────────────────────────────────────────────────
 * The countdown
 * ──────────────────────────────────────────────────────────────────────── */

export interface WindowState {
  /** True only when we can prove there is time left. */
  open: boolean;
  msLeft: number;
  tone: Tone;
  /** "6h 40m of window left" · "Window closed" */
  label: string;
}

/** "6h 40m" · "48m" · "under a minute". Never a bare "0m". */
export function formatWindowLeft(ms: number): string {
  if (ms <= 0) return 'none';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * How much of the 24 hours is left.
 *
 * ⚠️ AN UNREADABLE TIMESTAMP IS A CLOSED WINDOW. Treating a missing or
 * unparseable `windowClosesAt` as "probably still open" would send a template
 * the provider then rejects — or, if the clocks disagree the other way,
 * charge for a message that never reaches anyone. Closed is the recoverable
 * failure: the operator sees why and can answer on another rail.
 */
export function windowState(
  thread: Pick<WhatsappThread, 'windowClosesAt'> | null,
  now: number = Date.now(),
): WindowState {
  const closes = thread?.windowClosesAt ? Date.parse(thread.windowClosesAt) : Number.NaN;
  if (Number.isNaN(closes)) {
    return { open: false, msLeft: 0, tone: 'bad', label: 'Window state unknown' };
  }
  const msLeft = closes - now;
  if (msLeft <= 0) return { open: false, msLeft: 0, tone: 'bad', label: 'Window closed' };
  return {
    open: true,
    msLeft,
    tone: msLeft <= WINDOW_URGENT_MS ? 'bad' : 'warn',
    label: `${formatWindowLeft(msLeft)} of window left`,
  };
}

/**
 * "yesterday 15:54" · "today 15:54" · "Mon 1 Sep 15:54".
 *
 * Days, not hours: the operator's question about an inbound message is which
 * day it arrived, because that is what decides how much of the window is
 * gone. Compared on calendar days rather than on elapsed hours — 23:50 and
 * 00:10 are "yesterday" and "today" to a person, whatever the arithmetic says.
 */
export function describeWhen(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
  const startOfDay = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  if (days === -1) return `tomorrow ${time}`;
  return `${d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * May this send?
 * ──────────────────────────────────────────────────────────────────────── */

export type SendBlock =
  | 'loading'
  | 'channel_off'
  | 'window_closed'
  | 'no_registry'
  | 'nothing_selected'
  | 'not_ready';

export interface SendGate {
  can: boolean;
  block: SendBlock | null;
  /** What the primary button says. It states the blocker, never "Send" alone. */
  label: string;
  /** The sentence under the list. Null when the button can act. */
  why: string | null;
}

/**
 * The one place that decides whether a message may leave.
 *
 * ⚠️ ONE FUNCTION, NOT A CONDITION PER CONTROL. The button label, the
 * disabled state and the explanation all come from this call, so they cannot
 * drift into a screen that says "Window closed" over a button that still
 * posts. The order of the checks is the order the operator would ask them in:
 * is the channel on, is the window open, is there anything registered, did I
 * choose one, can that one actually be filled.
 */
export function sendGate(
  thread: WhatsappThread | null,
  selectedKey: string | null,
  now: number = Date.now(),
): SendGate {
  if (!thread) {
    return { can: false, block: 'loading', label: 'Send reply', why: null };
  }
  if (!thread.channelEnabled) {
    return {
      can: false,
      block: 'channel_off',
      label: 'Channel off',
      why: 'The WhatsApp kill switch is off on the Site board. No template can send while it is.',
    };
  }
  const win = windowState(thread, now);
  if (!win.open) {
    return {
      can: false,
      block: 'window_closed',
      label: win.label === 'Window state unknown' ? 'Window unknown' : 'Window closed',
      why:
        win.label === 'Window state unknown'
          ? 'The 24-hour window could not be read, so nothing may be sent. Answer on another rail.'
          : 'The 24-hour window has closed. This card resolves as unanswered; answer on another rail.',
    };
  }
  if (thread.templates.length === 0) {
    return {
      can: false,
      block: 'no_registry',
      label: 'No template registered',
      why: 'No approved template came back from the registry, so there is nothing this card may send.',
    };
  }
  if (!selectedKey) {
    return {
      can: false,
      block: 'nothing_selected',
      label: 'Send reply',
      why: 'Choose a registered template.',
    };
  }
  const chosen = thread.templates.find((t) => t.key === selectedKey);
  if (!chosen || !chosen.ready) {
    return {
      can: false,
      block: 'not_ready',
      label: 'Send reply',
      why: chosen?.blockedReason
        ? `That template cannot be sent: ${chosen.blockedReason}.`
        : 'That template cannot be sent yet.',
    };
  }
  return { can: true, block: null, label: 'Send reply', why: null };
}

/**
 * The template the drawer opens on.
 *
 * The first one the server could actually fill, because a radio list that
 * opens on nothing makes the operator click twice to do the obvious thing —
 * and the preview under the selection is what tells them whether the obvious
 * thing is right. Nothing is sent by opening the drawer.
 */
export function defaultTemplateKey(thread: WhatsappThread | null): string | null {
  return thread?.templates.find((t) => t.ready)?.key ?? null;
}

/** The exact body that would leave, for the key currently chosen. */
export function outgoingText(thread: WhatsappThread | null, selectedKey: string | null): string | null {
  if (!thread || !selectedKey) return null;
  return thread.templates.find((t) => t.key === selectedKey)?.preview ?? null;
}
