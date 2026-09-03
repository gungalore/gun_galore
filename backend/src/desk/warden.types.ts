/**
 * WARDEN — the wire contract between this API and the Site surface.
 *
 * ⚠️ WARDEN DOES NOT RUN IN THIS PROCESS AND CANNOT. Everything the Site
 * board wants from it — disk, SSL expiry, nginx 5xx, backup freshness, a pm2
 * reload — lives on the box, not in a Node request handler. DeskSiteService
 * already says so on its face and returns `known: false` rather than a
 * plausible zero. This module keeps that promise: it is the AUTHENTICATED
 * DOOR to a Warden daemon, never a second implementation of one.
 *
 * That split is not tidiness. "Approve the fix…" ends in a command running on
 * a production box. If this process held the command and the shell, an admin
 * JWT would be a remote shell for a firearms marketplace. Warden owns its own
 * safe list and runs inside it; this API can only ask, and only for a
 * proposal Warden itself raised.
 *
 * Mirrors what frontend/components/desk/chat.tsx already renders. The six
 * message kinds below are that component's `WardenKind` union verbatim — a
 * seventh kind invented here renders as `undefined` tag and throws in the
 * browser, with no error on either side of the wire.
 */

/** Verbatim from frontend/components/desk/chat.tsx KIND_TAG. Do not extend one side alone. */
export const WARDEN_MESSAGE_KINDS = [
  'finding',
  'fixed',
  'red-gate',
  'proposal',
  'ran',
  'note',
] as const;
export type WardenMessageKind = (typeof WARDEN_MESSAGE_KINDS)[number];

/**
 * A code block in the thread. `inset` is a proposal's dry run (what WOULD
 * happen); `ground` is the transcript of something that already ran. The
 * design gives them different grounds precisely so the two are never confused
 * at a glance.
 */
export interface WardenPre {
  tone: 'inset' | 'ground';
  lines: string[];
}

export interface WardenChatMessage {
  id: string;
  role: 'warden' | 'operator';
  kind: WardenMessageKind;
  /** ISO-8601. The client formats; the server never guesses a timezone. */
  at: string;
  /** Paragraphs, already split. Warden writes prose, not markdown. */
  body: string[];
  pre?: WardenPre;
  /** Set when this message carries the face of a proposal the operator can act on. */
  proposalId?: string;
  /** The "approved 08:53" line under a settled proposal. */
  footnote?: string;
}

/**
 * `red_gate` is a proposal only in the sense that it arrives on the same
 * thread. It has no command, cannot be approved, cannot be declined and
 * cannot be sunk — the only thing that clears it is the gate changing in
 * code. See WardenService.approve/decline, which refuse it by kind.
 */
export type WardenProposalKind = 'proposal' | 'red_gate';
export type WardenProposalStatus = 'pending' | 'approved' | 'declined' | 'acknowledged';

export interface WardenProposal {
  id: string;
  kind: WardenProposalKind;
  status: WardenProposalStatus;
  headline: string;
  diagnosis: string;
  /**
   * EXACTLY what "Approve the fix…" will run, as Warden will run it. The
   * money-grade confirm restates this string and the approve call echoes it
   * back for a compare-and-swap — see WardenService.approve. Null for a red
   * gate, which has nothing to run.
   */
  command: string | null;
  /** For a red gate: which config gate it mirrors, so the two agree. */
  gateKey: string | null;
  raisedAt: string;
}

export interface WardenChat {
  /**
   * False when WARDEN_BASE_URL / WARDEN_TOKEN are unset. The board draws the
   * "not deployed" state; it does NOT draw an empty, healthy-looking thread,
   * because a quiet Warden and an absent Warden look identical and mean
   * opposite things.
   */
  present: boolean;
  note?: string;
  /** When Warden last completed a sweep. Null while unknown — never `now`. */
  lastCheckAt: string | null;
  messages: WardenChatMessage[];
  proposals: WardenProposal[];
}

/**
 * A config gate with the one fact DeskSiteService does not carry: whether it
 * is red, and therefore deals a Warden card onto the Desk every day until it
 * changes. The gate values themselves still come from DeskSiteService so the
 * Site board and this endpoint can never disagree about what PAYMENTS_LIVE is.
 */
export interface WardenGate {
  key: string;
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
  note?: string;
  /** tone === 'bad'. A red gate nags daily and can never be sunk. */
  red: boolean;
}

export interface WardenGatesView {
  gates: WardenGate[];
  redCount: number;
}

/**
 * One row of the Settings panel — THE ONLY FOUR. `kind` tells the client
 * which widget to draw; nothing here is a generic settings editor.
 *
 * ⚠️ WRITES DO NOT COME BACK THROUGH THIS MODULE. PATCH /admin/settings is
 * the one write path, with its type validation, its danger-flag reason
 * minimum and its audit row. A second writer would be a second set of those
 * rules, and the one that drifted would be the one nobody was reading.
 */
export interface WardenSettingRow {
  key: string;
  label: string;
  kind: 'phone' | 'checkboxes' | 'toggle';
  /** Board-safe rendering. For the phone this is MASKED and there is no raw. */
  display: string;
  /** Present only where the value is not personal data: a flag, a type list. */
  raw?: string;
  items?: { value: string; label: string; checked: boolean }[];
  /** True when PATCH /admin/settings accepts it. Never a claim this panel writes it. */
  editable: boolean;
  note: string;
}

export interface WardenSettingsView {
  rows: WardenSettingRow[];
}
