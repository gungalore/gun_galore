/**
 * THE DESK — the icon set.
 *
 * ⚠️ ONE FILE, ON PURPOSE. Not an icon font, not a package, not a component
 * per file. Every glyph here is drawn on the same 24 grid with the same
 * stroke language, and the only way that stays true is if adding one means
 * looking at the others. A per-icon package import would also drag a second
 * stroke style onto the surface within a week.
 *
 * Every path is `fill="none"` with `stroke="currentColor"`, so an icon takes
 * the colour of whatever it sits in — a tag's state ink, a button's label
 * colour, a ghost's ink-2 — without a single colour prop anywhere.
 *
 * Stroke weight rises as the icon shrinks, because a 1.6 hairline disappears
 * at 12px on this ground: 1.6 at 20–24, 1.8–1.9 at 14–16, 2.2 inside tags
 * and toasts. Derived from the size below rather than passed at each call.
 */
import * as React from 'react';

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  /** Rendered size in px. Defaults to 16 — the in-line size. */
  size?: number;
  /** Override the size-derived stroke weight. Rarely the right call. */
  strokeWidth?: number;
}

/** Stroke weight for a given rendered size — see the note above. */
function strokeFor(size: number): number {
  if (size <= 12) return 2.2;
  if (size <= 14) return 1.9;
  if (size <= 16) return 1.8;
  return 1.6;
}

function Glyph({
  size = 16,
  strokeWidth,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── Card types ─────────────────────────────────────────────────────────
 * One glyph per card type in the catalogue. The type icon is the fastest
 * read on a card face — it lands before the label does — so these are the
 * ones worth being literal about: a shield for a firearm transfer, scales
 * for a dispute, a banknote for the payout run. */

export const IconShield = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </Glyph>
);

export const IconBanknote = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="3" />
    <path d="M6 12h.01M18 12h.01" />
  </Glyph>
);

export const IconScale = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 3v18M5 21h14M3 7h18" />
    <path d="M6 7l-3 7a3 3 0 0 0 6 0L6 7zM18 7l-3 7a3 3 0 0 0 6 0l-3-7z" />
  </Glyph>
);

export const IconImage = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </Glyph>
);

export const IconUserCheck = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="m16 11 2 2 4-4" />
  </Glyph>
);

export const IconTruck = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M1 3h15v13H1z" />
    <path d="M16 8h4l3 3v5h-7V8z" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </Glyph>
);

export const IconMessage = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Glyph>
);

export const IconBubble = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z" />
  </Glyph>
);

export const IconHelp = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
  </Glyph>
);

export const IconBolt = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </Glyph>
);

/* ── State and status ───────────────────────────────────────────────────
 * ⚠️ EVERY WARN AND BAD TAG CARRIES ONE OF THESE. Colour is never the only
 * signal on this surface: a red pill with no icon and no warning word is
 * invisible to a colour-blind operator and ambiguous to everyone else. */

export const IconClock = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Glyph>
);

export const IconAlert = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Glyph>
);

export const IconInfo = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </Glyph>
);

export const IconCheck = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Glyph>
);

export const IconLock = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Glyph>
);

/* ── Navigation and actions ─────────────────────────────────────────── */

export const IconChevronRight = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m9 18 6-6-6-6" />
  </Glyph>
);

/** Later. The card sinks; the arrow points the way it goes. */
export const IconArrowDown = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Glyph>
);

/** The trailing mark on any control that leaves the Desk. */
export const IconExternal = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Glyph>
);

export const IconClose = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Glyph>
);

export const IconSearch = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Glyph>
);

export const IconUndo = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
  </Glyph>
);

export const IconRefresh = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </Glyph>
);

export const IconPause = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Glyph>
);

export const IconSend = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m22 2-7 20-4-9-9-4z" />
    <path d="M22 2 11 13" />
  </Glyph>
);

export const IconPencil = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Glyph>
);

export const IconUser = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Glyph>
);

/* ── Channels, for the Site board's outbound row ────────────────────── */

export const IconMail = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Glyph>
);

export const IconPhone = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z" />
  </Glyph>
);

export const IconBell = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
  </Glyph>
);

/* ── The five surfaces ──────────────────────────────────────────────────
 * Only the phone wears these. The desktop tab row is text pills, because at
 * 1440 a word is faster to hit and to read than a glyph. */

export const IconDesk = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 13h5l2 3h4l2-3h5" />
    <path d="M5 5h14l2 8v6H3v-6z" />
  </Glyph>
);

export const IconLedger = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6" />
  </Glyph>
);

export const IconPeople = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
    <circle cx="9.5" cy="7" r="4" />
    <path d="M21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
  </Glyph>
);

export const IconPulse = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M22 12h-4l-3 8-6-16-3 8H2" />
  </Glyph>
);

export const IconSite = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="4" y="4" width="16" height="6" rx="1" />
    <rect x="4" y="14" width="16" height="6" rx="1" />
    <path d="M8 7h.01M8 17h.01" />
  </Glyph>
);

/**
 * The card-type glyphs, keyed by the type string the desk feed sends.
 *
 * ⚠️ KEYED BY THE SERVER'S TYPE so a card type nobody has drawn yet shows up
 * as a missing icon in review, rather than silently borrowing another type's
 * glyph and reading as the wrong kind of work.
 */
export const CARD_TYPE_ICON = {
  firearm_transfer: IconShield,
  payout_run: IconBanknote,
  dispute: IconScale,
  listing_review: IconImage,
  seller_verification: IconUserCheck,
  dispatch_check: IconTruck,
  complaint: IconMessage,
  support: IconMessage,
  whatsapp_reply: IconBubble,
  stale_listing: IconClock,
  unanswered_question: IconHelp,
  warden: IconBolt,
} as const;

export type DeskCardType = keyof typeof CARD_TYPE_ICON;
