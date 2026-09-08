// ────────────────────────────────────────────────────────────────────
// THE SHAPES THE REVIEW SHEET RENDERS.
//
// ⚠️ EVERY TYPE HERE IS A MIRROR, NEVER A DEFINITION. The server owns these:
// backend/src/motivations/motivation-sheet.service.ts and
// motivation-preview.ts. When one of them changes, this changes to match — it
// never leads. Same rule as the MotivationPack types in lib/motivations-api.ts,
// and for the same reason: two definitions of one shape drift, and the day
// they do, a screen renders a state the server cannot produce.
//
// ⚠️ CHANGE THIS FILE FIRST. Everything under components/licence-centre/ is
// presentational and implements it — the same rule The Bench works to. A
// component that grows a prop the contract does not carry is a component the
// page cannot feed.
//
// ⚠️ THE PAGE IS THE ONLY STATEFUL FILE. app/licence-centre/[id]/page.tsx owns
// the fetch, the autosave and the debounce; nothing below it holds state that
// outlives a keystroke. Anything here that looks like it wants a store belongs
// in the page.
// ────────────────────────────────────────────────────────────────────

/**
 * How one item renders.
 *
 * ⚠️ COMPUTED ON THE SERVER, AND ONLY THERE. The frontend used to carry
 * `visibleFields()`, a hand-written mirror of the registry's `isVisible()`,
 * kept in step with the backend by a comment asking the next reader to keep
 * them in step. A flag honoured by one side and not the other either puts a
 * question in front of somebody we have already answered, or hides one the
 * server insists on. That mirror is retired: the sheet endpoint says what
 * state each item is in and this screen renders what it is told.
 */
export type SheetItemState =
  /** A value we hold and are confident about. No task attached. */
  | 'filled'
  /** A value we INFERRED rather than read. The one state that asks. */
  | 'suggested'
  /** Nothing yet — the control renders open. */
  | 'needs_you'
  /** Does not apply to this applicant. Renders nothing at all. */
  | 'na';

/** The registry's field kinds, as the sheet receives them. */
export type SheetItemKind =
  | 'short'
  | 'long'
  | 'date'
  | 'choice'
  | 'multi'
  | 'yesno'
  | 'cards';

/**
 * One tile in a `cards` field.
 *
 * `key` is stored and matched; `sentence` is what the member reads and what
 * the writer may use verbatim. They are separate so the operator can reword a
 * card without invalidating a stored answer.
 */
export interface CardOption {
  key: string;
  sentence: string;
}

/** Where a value came from, for the source line under it. */
export interface SheetProvenance {
  source: string;
  /** Already in the member's language — "your licence card". Render as given. */
  from: string;
  at: string;
  sourceId?: string;
  /**
   * We worked this out rather than read it.
   *
   * ⚠️ THIS IS WHAT MAKES AN ITEM `suggested` RATHER THAN `filled`, and it is
   * the only thing on the sheet that asks the member to confirm anything. The
   * operator's standing rule (2026-08-25) is fill it in, arm it, let them
   * change it — so a value we READ carries no task, and only a value we
   * INFERRED earns one.
   */
  inferred?: boolean;
}

export interface SheetItem {
  key: string;
  label: string;
  kind: SheetItemKind;
  state: SheetItemState;
  /**
   * The value in full.
   *
   * ⚠️ NEVER MASKED ON THE MEMBER'S OWN SCREEN. The registry's `sensitive`
   * flag drives masking in logs, in admin views and anywhere another person
   * can see — never here. The live walkthrough of the old wizard found a full
   * name rendered "GE••••••••" and an ID as "8905 •••• •••" on the applicant's
   * own application, on values they were about to sign onto a police form and
   * could not read to check.
   */
  value: string;
  provenance: SheetProvenance | null;
  /** Which sheet section this belongs under. */
  section: string;
  scope: 'profile' | 'application';
  required: boolean;
  help?: string;
  /** Tiles, for `kind: 'cards'`. Ranked by the server where it can. */
  options?: CardOption[];
  /** Grouped options, where the list comes from a data module. */
  optionGroups?: { group: string; options: { value: string; label: string; hint?: string }[] }[];
  /** For `choice` / `yesno` / `multi`. */
  choices?: string[];
  /**
   * The optional "in your own words" box that belongs under this card grid.
   *
   * A pairing, not a field property: both halves are ordinary registry fields
   * and what makes them a pair is a rendering decision.
   */
  ownWordsKey?: string;
}

export interface SheetSection {
  id: string;
  title: string;
  /** One sentence. The copy rules forbid a second. */
  blurb: string;
  /** Required keys in this section that are still empty. */
  missing: string[];
}

export interface SheetDocument {
  id: string;
  kind: string;
  /** Annexure letter, or null before the pack is lettered. */
  letter: string | null;
  label: string;
  mime: string | null;
  /**
   * `check` is GOLD, never red. A document we could not read is still
   * attached and still goes in the pack — it is a "look at this", not a
   * failure, and colouring it as one teaches members to re-upload things that
   * were fine.
   */
  state: 'read' | 'check';
  /**
   * Where this page came from.
   *
   * ⚠️ DERIVED FROM `sourceCredentialId` ON THE SERVER, not stored. A page
   * copied in from the Document Centre carries the credential it came from; one
   * the member scanned or uploaded here carries null.
   *
   * ⚠️ AND IT DECIDES WHO IS OFFERED THE SAVE. Only a `member` document can be
   * saved INTO the Centre; a `vault` one is already there.
   */
  origin: 'vault' | 'member';
}

/** One section of the live preview. See backend motivation-preview.ts. */
export interface PreviewSection {
  id: string;
  heading: string;
  paragraphs: string[];
  /** Rendered faint and italic when `paragraphs` is empty. Never blank. */
  placeholder: string;
  /**
   * Sentences that came from a card the member tapped.
   *
   * ⚠️ THE FEEDBACK LOOP THE PREVIEW EXISTS FOR. The drawer marks these, so a
   * member taps a tile and watches that exact sentence land in the document.
   * Without the marking the preview is a wall of text that happens to change.
   */
  fromCards: string[];
}

export interface SheetResponse {
  application: {
    id: string;
    referenceNumber: string;
    licenceType: string;
    licenceTypeLabel: string;
    label: string | null;
    status: string;
  };
  sections: SheetSection[];
  items: SheetItem[];
  documents: SheetDocument[];
  /** What the pack still wants, by tier. Separate from `documents`. */
  needs: {
    needs: { kind: string; label: string; tier: string; why: string; have: boolean }[];
  };
  coverage: unknown;
  overlap: {
    verdict: { kind: string; withCalibres?: string[]; withTypes?: string[] };
    prompt: string | null;
    suggestedAngle: CardOption[] | null;
  };
  preview: PreviewSection[];
  /**
   * Required keys still unanswered, across the whole sheet.
   *
   * ⚠️ ONE NUMBER, THREE VIEWS, AND NEVER A FOURTH. The progress pill, the dot
   * on each section chip and the footer's disabled button all read THIS and
   * nothing else. The live walkthrough of the old wizard found four separate
   * progress systems that could and did contradict each other — a step showing
   * a green tick while its own panel read 0%.
   */
  missing: string[];
  /**
   * The owned-firearm rows that actually hold a firearm, in order.
   *
   * ⚠️ THE SERVER DECIDES WHICH ROWS EXIST. The registry serves all fourteen
   * whatever a member owns; the page renders a fold per entry here and nothing
   * for the rest. Working it out in the browser would be a fourth reader of
   * "is this row in use", and the backend's ownedRowTaken carries the note
   * about what happened the last time readers of that disagreed.
   */
  ownedRows: SheetOwnedRow[];
}

/** One owned firearm, as its collapsed header reads. */
export interface SheetOwnedRow {
  /** 1-based, matching the `existing_firearm_N_` key prefix. */
  index: number;
  /** "MAUSER · .30-06 SPRINGFIELD", or "Firearm 3" when nothing names it. */
  summary: string;
  /** "96008993 · licence expires 2034-10-28", or null when neither is known. */
  note: string | null;
}
