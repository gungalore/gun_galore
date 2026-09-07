"use client";

// ────────────────────────────────────────────────────────────────────
// THE STEP RAIL, AND THE STEPS THEMSELVES.
//
// Built to the design mockup (Main.dc.html): a 22px round dot carrying either
// the step number or a tick, a label beside it, and a red-wash pill behind the
// one you are on. Done is green, current is red, ahead is an outlined circle.
//
// ⚠️ EVERY STEP IS CLICKABLE, INCLUDING THE ONES AHEAD. The mockup's rail
// calls go(n) unconditionally and that is right for this form: a member who
// remembers their competency number should not have to walk through four
// screens to type it. Nothing is validated by being visited.
// ────────────────────────────────────────────────────────────────────

export interface WizardStep {
  /** Stable key, used in the URL fragment and for the rail's React keys. */
  key: string;
  /** What the rail calls it. Short — it sits on one line. */
  name: string;
  /** The eyebrow above the panel: which part of the 271 this fills. */
  fills: string;
  /** The panel's own heading. */
  title: string;
  /** One paragraph under the heading, in the member's terms. */
  blurb: string;
  /**
   * The registry section this step asks, where it asks one.
   *
   * ⚠️ THE REGISTRY'S OWN NAME, NOT A DISPLAY STRING. It joins to
   * MotivationField.section, and the server groups by it — see PackSection.
   * Absent on the steps that are not a form section: the first, which only
   * restates what was chosen, and the last, which is the pack.
   */
  /**
   * The registry sections this step asks, where it asks any.
   *
   * ⚠️ AN ARRAY, BECAUSE THE ARTBOARD IS ONE LICENCE TYPE AND THE REGISTRY IS
   * FIVE. It was drawn for a section 16 dedicated sport shooter, so it never
   * shows the self-defence threat case, the renewal's existing-licence
   * details, or the hunting record — and a wizard built literally from it
   * asks none of them. `wizard-rail.spec.ts` fails if any registry section
   * for any licence type has no step.
   */
  sections?: string[];
  /**
   * Documents this step collects, in the order they are asked for.
   *
   * ⚠️ UPLOAD KINDS, not labels — they are the server's enum and the pack's
   * annexure lettering keys off them. The label beside each door comes from
   * the checklist so the two screens cannot describe one document differently.
   */
  documents?: { kind: string; title: string; subtitle?: string }[];
  /**
   * Individual registry keys this step exists for, where naming a whole
   * section would be wrong.
   *
   * ⚠️ WRITTEN FOR "WHERE IT IS FROM", WHICH A RENEWAL SHOULD NEVER SEE. That
   * step claims no section and no document — it is the seller's half of the
   * paperwork — so `stepAsks` kept it for every licence type, deliberately:
   * "a step that claims neither sections nor documents is a stage, not a
   * question set". On a section 24 that stage does not exist. The applicant
   * already holds the firearm, and the step told them "a dealer sale and a
   * private transfer need different paperwork at the counter" about a transfer
   * that is not happening. The backend has known this all along — the
   * checklist says in capitals that a renewal has no source document — and it
   * was only the two screens the member sees that were missed.
   *
   * A step with `keys` is filtered on them: if this application serves none of
   * them, the step is not on the rail. Its own question is what it claims.
   */
  keys?: string[];
}

/**
 * ⚠️ TEN STEPS, NOT THE MOCKUP'S NINE.
 *
 * The artboard starts at the firearm. Operator, 2026-08-29: "I added the
 * Section list as it is already there and obvious to have." So the licence
 * section leads — which is also what the plan settled at §3.0c, and it is
 * load-bearing rather than cosmetic: every later check, and every eligibility
 * warning, depends on which section is being applied for.
 *
 * The rest of the order is the mockup's, and it has a rule behind it: what
 * unlocks a lookup goes early, what nothing can help with goes late. The
 * firearm is second so we know which competency to pull and which endorsement
 * to ask the association for. The seller is third so his half runs in the
 * background instead of at the end. Declarations are ninth because meeting six
 * questions about convictions on screen one makes an application feel like a
 * charge sheet.
 */
export const WIZARD_STEPS: WizardStep[] = [
  {
    key: "section",
    name: "Section",
    fills: "fills section D",
    title: "What you are applying for",
    blurb:
      "Everything else is checked against this — which documents SAPS asks for, which questions the form puts to you, and how many firearms you may hold under it.",
  },
  {
    key: "firearm",
    name: "The firearm",
    fills: "fills section E",
    title: "Start with the firearm itself",
    blurb:
      "Everything after this depends on it. The type tells us which competency to pull from your Document Centre, which endorsement your association has to give, and whether the seller is a dealer or a private owner.",
    sections: ["The firearm", "The SAPS 271 form"],
    // ⚠️ THE STEP THE MOCKUP LEADS WITH, AND IT LEADS WITH CAPTURE. Its own
    // words: "Give us anything that shows it — a licence card, a dealer
    // invoice, an advert, a half-filled 271." Section E is make, model,
    // calibre and three serials, and every one of them is printed on
    // something the member already has. Typing them is the fallback.
    //
    // ⚠️ AND IT IS THE SAME KIND THE SOURCE STEP USED TO CARRY, MOVED RATHER
    // THAN COPIED. Two capture cards for one document kind on two steps is
    // two places to upload the same page and two rows in the pack.
    documents: [
      {
        kind: "FIREARM_SOURCE_PROOF",
        title: "Anything that identifies this firearm",
        subtitle:
          "A licence card, a dealer invoice, an advert — we read the make, calibre and serials off it.",
      },
    ],
  },
  {
    key: "source",
    name: "Where it is from",
    fills: "fills section F",
    title: "Where this firearm is coming from",
    blurb:
      "A dealer sale and a private transfer need different paperwork at the counter. On a private sale we send the current owner his own half of the form, and it runs while you carry on here.",
    // The one question this stage exists for. A renewal is not served it, so
    // the stage goes with it rather than asking somebody where a firearm they
    // already own is coming from.
    keys: ["firearm_source"],
      },
  {
    key: "competency",
    name: "Competency",
    fills: "fills G 1.5 – 1.7",
    title: "Your competency",
    blurb:
      "Without competency for this type of firearm, SAPS cannot process the application at all. Most of this comes off the certificate already in your Document Centre.",
    sections: ["Your competency"],
    documents: [
      {
        kind: "COMPETENCY_CERTIFICATE",
        title: "Your competency certificate",
        subtitle:
          "The SAPS card, or the CFR printout — whichever you were issued.",
      },
      // ⚠️ THE STATEMENT OF RESULTS, WHICH THE STEP NEVER ASKED FOR.
      // Operator, 2026-08-28: "proficiency certificates come with codes on
      // their statement of result. That is the page we are looking for, not
      // the certificate itself." The competency certificate proves SAPS
      // issued competency; the statement of results is what carries 117705
      // and the code for the firearm type, and the step had no line for it —
      // so the alert beside it could name a document the member was never
      // given anywhere to attach.
      {
        kind: "PROFICIENCY_CERTIFICATE",
        title: "Your statements of results",
        subtitle:
          "The page listing the unit standard codes — 117705 plus the one for this firearm type. Add every statement you have; the codes are read off all of them together.",
      },
    ],
  },
  {
    key: "owned",
    name: "What you own",
    fills: "fills G item 2",
    title: "The firearms you already hold",
    blurb:
      "Most of these come from your Document Centre. Check them against your licence cards — what SAPS holds is what the form must say.",
    sections: ["Firearms you already own"],
    documents: [
      {
        kind: "CURRENT_LICENCE",
        title: "A firearm licence you already hold",
        subtitle:
          "Both sides of the card. We read the make, calibre and serials off it.",
      },
    ],
  },
  {
    key: "about",
    name: "About you",
    fills: "fills G items 3 – 27",
    title: "About you",
    blurb:
      "Your details as SAPS holds them. Anything we filled in came from a document you gave us, and all of it is yours to correct.",
    sections: ["About you"],
    documents: [
      {
        kind: "IDENTITY_DOCUMENT",
        title: "Your identity document",
        subtitle: "The page with your photograph.",
      },
      {
        kind: "ADDRESS_CONFIRMATION",
        title: "Proof of your address",
        subtitle: "Not older than three months, in your own name.",
      },
    ],
  },
  {
    key: "dedicated",
    name: "Dedicated status",
    fills: "fills G items 55 – 60",
    title: "Your association and your status",
    blurb:
      "A section 16 application rests on this: an accredited association, your membership, and a letter saying you are in good standing.",
    sections: ["Dedicated status"],
    documents: [
      // ⚠️ THE DEDICATED STATUS CERTIFICATE, NOT AN ORDINARY MEMBERSHIP CARD.
      // This read "Your association membership / The card or certificate", and
      // an association issues both: an ordinary membership card, and a separate
      // dedicated-status certificate carrying the dedicated number. Only the
      // second one evidences a section 16 application, and the checklist has
      // always said so — "Your dedicated status certificate … the one with your
      // dedicated number on it". A member photographing the wrong card at this
      // door has no way to know from the wording that it is the wrong one.
      {
        kind: "ASSOCIATION_CARD",
        title: "Your dedicated status certificate",
        subtitle:
          "The one with your dedicated number on it — not an ordinary membership card.",
      },
      // ⚠️ THIS IS THE DOCUMENT SECTION 16(2) ACTUALLY NAMES. The Act requires
      // "a sworn statement or solemn declaration from the chairperson … stating
      // that the applicant is a registered member" — a statement about
      // MEMBERSHIP, which is this letter. The sentence used to sit on the
      // endorsement card below, where it was untrue.
      {
        kind: "GOOD_STANDING_LETTER",
        title: "Your letter of good standing",
        subtitle:
          "The sworn statement from the chairperson that section 16(2) asks for. We read the valid-until date off it.",
      },
      // ⚠️ EXPECTED ON BOTH SECTION 16 PATHS AND IT HAD NO DOOR. The pack
      // listed it on the final checklist and no step ever asked for it, so a
      // member was told the application wants an association endorsement and
      // given nowhere to attach one.
      // ⚠️ NOT A REQUIREMENT OF THE ACT, AND THE COPY MUST NOT SAY IT IS.
      // This card claimed to be "the sworn statement from the chairperson that
      // section 16(2) asks for". It is not — that is the letter of good
      // standing above, and the backend says so in capitals in two files. The
      // endorsement comes from the Hunters Forum guidelines of 2 September
      // 2005. It matters and a DFO will insist on it; it is not the statutory
      // element, and an applicant who fetched this one and skipped the letter
      // had missed the thing section 16(2) actually requires.
      {
        kind: "ASSOCIATION_ENDORSEMENT",
        title: "Your association's endorsement",
        subtitle:
          "The association confirming THIS firearm suits your discipline. The Act does not list it; a DFO will still expect it.",
      },
    ],
  },
  {
    key: "case",
    name: "Your case",
    fills: "fills section G item 61",
    title: "Why you need this firearm",
    blurb:
      "The part only you can write, and the part a DFO actually reads. What you do with a firearm, where, and how often — we turn it into the motivation.",
    // ⚠️ THREE SECTIONS, ONE STEP, AND WHICH ONE APPEARS DEPENDS ON THE
    // LICENCE TYPE. Self-defence asks about the threat; a hunter or sport
    // shooter about what they hunt and shoot; a renewal about the licence
    // being renewed. `visibleFields` and the registry's own per-type lists
    // decide — this step just has to have a home for all three, and before
    // this step existed it had none for any of them.
    sections: ["Your circumstances", "Experience", "The existing licence"],
    // ⚠️ TWO DOCUMENTS THAT ONLY EVER ARRIVE IF SOMEBODY ASKS.
    // (A character reference was a third until 2026-08-29. Operator: "It
    // serves no purpose. Only time someone needs these is for the application
    // for a competency" — which is right: a reference speaks to whether a
    // person is FIT to hold a firearm, the section 9 enquiry, not to why THIS
    // firearm is needed for THIS purpose.) Nobody
    // attaches a shooting log or a character reference unprompted, and they
    // are exactly what separates a thin application from a good one. All
    // three were on the pack's checklist with no capture card anywhere in the
    // rail — the documents-side twin of the nineteen orphaned questions this
    // step was created to house.
    documents: [
      // ⚠️ NEUTRAL WORDING — the checklist's own, "Your record of shooting
      // activities". This said "hunts or competitions", which is put to a
      // dedicated SPORTS shooter on the one step their application turns on,
      // and rendered three times over: as the heading, lower-cased in the
      // library picker ("Reuse your record of hunts or competitions") and in
      // the file button's label.
      {
        kind: "SHOOTING_ACTIVITY_LOG",
        title: "Your record of shooting activities",
        subtitle:
          "Whatever you keep — a club printout, a logbook page, a score sheet. It is the evidence behind what you have just told us.",
      },
      {
        kind: "INCIDENT_REPORT",
        title: "An incident report or SAPS case number",
        subtitle:
          "Only if something has actually happened. Never invent one — an unsupported claim is worse than no claim.",
      },
    ],
  },
  {
    key: "storage",
    name: "Storage",
    fills: "fills the storage boxes",
    title: "Where it will be kept",
    blurb:
      "The form asks what the safe is and how it is fixed; the DFO asks to see it. Photographs of the safe go in your pack as one annexure.",
    sections: ["Storage and safety"],
    documents: [
      {
        kind: "SAFE_PHOTOGRAPHS",
        title: "Photographs of your safe",
        subtitle:
          "Three: closed with the key out, half open with the key in the door, and the bolts holding it to the wall.",
      },
    ],
  },
  {
    key: "declarations",
    name: "Declarations",
    fills: "fills section H",
    title: "The questions only you can answer",
    blurb:
      "Nothing in your Document Centre can answer these and we will never guess at one. They are near the end on purpose — they are quick, and they should not be the first thing you meet.",
    sections: ["History"],
  },
  {
    key: "pack",
    name: "Your pack",
    fills: "what you take to the counter",
    title: "Your pack",
    blurb:
      "What we produce, what you gather, and what somebody else has to send. Everything stays here until you print it.",
  },
];

// ────────────────────────────────────────────────────────────────────
// ELEVEN STEPS ON SCREEN, TEN AN APPLICATION WALKS.
//
// Operator, 2026-08-30: "make it a 10 step process, remove step1 out of the
// process and make it the form selection as it was but still keep the visuals
// a 11 step process… essentially Step2 on the frontend is step 1 in the
// backend."
//
// The section is chosen at /licence-services/new, BEFORE the application
// exists — see the note on that page for why it cannot be otherwise. Which
// left the first step of the real wizard restating a choice already printed in
// the chrome bar on every step, under the heading "Step 1 of 11" that the
// chooser had just used. Two screens, one number, nothing gained.
//
// So the rail keeps all eleven, because the member should see the whole
// journey and see that the first part of it is behind them. The application
// walks the other ten.
//
// ⚠️ ELEVEN IS THE TABLE, NOT THE JOURNEY ANY ONE MEMBER WALKS. A licence
// type that asks nothing on a step does not get that step — a section 13 has
// no dedicated-status step and counts to ten, not eleven. Run the table
// through `stepsFor` and number off the RESULT; see stepAsks below.
//
// ⚠️ THE TWO INDEXES ARE NOT INTERCHANGEABLE AND NOTHING IN THE TYPES SAYS SO
// — they are both `number`. Convert with the two functions below rather than
// adding or subtracting 1 at a call site: an off-by-one here does not throw,
// it silently renders the wrong step's questions under the right step's
// heading.
// ────────────────────────────────────────────────────────────────────

/**
 * The steps an application walks, before the licence type is known. The
 * section is not one of them.
 *
 * ⚠️ THIS IS THE UNFILTERED TABLE AND IT IS NOT WHAT A MEMBER WALKS. It
 * exists so DISPLAY_OFFSET and the index conversions below have something
 * fixed to be defined against. A screen driving a real application must slice
 * `stepsFor(WIZARD_STEPS, plan)` instead, or it puts a section 16 step inside a
 * section 13 and numbers it "of 11".
 */
export const APPLICATION_STEPS: WizardStep[] = WIZARD_STEPS.slice(1);

/** How many display steps sit before the first one an application walks. */
export const DISPLAY_OFFSET = WIZARD_STEPS.length - APPLICATION_STEPS.length;

/** Where a walked step sits on the rail. */
export function toDisplayIndex(walked: number): number {
  return walked + DISPLAY_OFFSET;
}

/**
 * Which walked step a rail position means, or `null` for one that is not
 * walked at all.
 *
 * ⚠️ null RATHER THAN A CLAMP TO ZERO. Clamping would make a click on the
 * section step quietly select the firearm step — a control that appears to do
 * nothing, which is the failure this whole change exists to remove.
 */
export function toWalkedIndex(display: number): number | null {
  const n = display - DISPLAY_OFFSET;
  return n < 0 ? null : n;
}

// ─────────────────────────────────────────────────────────────────
// WHAT THIS APPLICATION ACTUALLY ASKS, AND WHAT OF IT IS STILL OUTSTANDING.
//
// ⚠️ THE RAIL USED TO BE TOLD ONLY THE SECOND HALF, AND IT TICKED EVERYTHING.
// `stepDone` read `sections.every(s => !outstanding.has(s))`, so an EMPTY
// outstanding set — which is what "the application has not loaded yet" and
// "this member has answered nothing" both look like — ticked every step that
// claimed anything. On /licence-services/new, before a section is even chosen,
// eight of eleven steps showed a green tick; on the operator's live section 13,
// "Dedicated status" and "Declarations" were ticked before a single question
// was answered. The prop's own doc comment said "empty means we were told
// nothing, which ticks nothing" — and the function did the opposite.
//
// Operator, 2026-09-07: "check the green tick marks should only be green when
// the section is filled in enough to complete a full motivation."
//
// So the rail is now told BOTH halves. `asked*` is what this licence type
// serves: the registry sections behind its fields, and the document kinds its
// checklist asks for. Nothing known ticks nothing, and a step this licence type
// asks nothing for is not a finished step — it is not a step.
// ─────────────────────────────────────────────────────────────────

export interface StepProgress {
  /**
   * Every registry section this application serves a field for.
   *
   * ⚠️ THE WHOLE REGISTRY FOR THE LICENCE TYPE, NOT `visibleFields`. A section
   * gated behind a showIf would appear and vanish as answers are typed, and a
   * step must not leave the rail under somebody mid-sentence.
   */
  askedSections: ReadonlySet<string>;
  /** Every document kind this application asks for, at ANY tier. */
  askedKinds: ReadonlySet<string>;
  /**
   * Every registry key this application serves — for steps that claim a
   * question rather than a whole section. See WizardStep.keys.
   *
   * Optional: a caller that does not supply it leaves key-claiming steps
   * showing, which is the behaviour before this existed.
   */
  askedKeys?: ReadonlySet<string>;
  /** Sections still holding a required answer that is empty. */
  outstandingSections: ReadonlySet<string>;
  /** Documents still required and not usably attached. */
  outstandingKinds: ReadonlySet<string>;
}

/** Before the application has loaded. Ticks nothing, hides nothing. */
export const NOTHING_KNOWN: StepProgress = {
  askedSections: new Set(),
  askedKinds: new Set(),
  outstandingSections: new Set(),
  outstandingKinds: new Set(),
};

/** Have we been told what this application asks at all? */
function known(p: StepProgress): boolean {
  return p.askedSections.size > 0 || p.askedKinds.size > 0;
}

/** The sections and kinds this step claims that THIS licence type asks. */
function liveClaims(
  step: WizardStep,
  p: StepProgress,
): { sections: string[]; kinds: string[] } {
  return {
    sections: (step.sections ?? []).filter((s) => p.askedSections.has(s)),
    kinds: (step.documents ?? [])
      .map((d) => d.kind)
      .filter((k) => p.askedKinds.has(k)),
  };
}

/**
 * Does this step's own question exist for this application?
 *
 * True for every step that claims no keys, so nothing changes for the nine
 * that do not — and true when the caller supplied no key set at all, because
 * "we were told nothing" must never delete a step.
 */
function keysAsked(step: WizardStep, p: StepProgress): boolean {
  const keys = step.keys ?? [];
  if (!keys.length || !p.askedKeys) return true;
  return keys.some((k) => p.askedKeys!.has(k));
}

/**
 * Does this step ask this applicant anything?
 *
 * ⚠️ A SECTION 16 STEP WAS RENDERING INSIDE A SECTION 13. Step 7 of the
 * operator's self-defence application was "Your association and your status",
 * whose own blurb reads "A section 16 application rests on this: an accredited
 * association, your membership, and a letter saying you are in good standing."
 * Dedicated status has nothing to do with a self-defence licence: the registry
 * serves no field for it and the checklist asks for none of its three
 * documents. It drew three capture pairs, asked nothing, and was ticked green.
 *
 * ⚠️ A STEP THAT CLAIMS NEITHER SECTIONS NOR DOCUMENTS IS A STAGE, NOT A
 * QUESTION SET, and always shows: the section chosen before this screen, the
 * seller's half of the paperwork, and the pack itself. Filtering those out
 * would delete the beginning and the end of the journey.
 */
export function stepAsks(step: WizardStep, p: StepProgress): boolean {
  // A step that names its own question is filtered on it, whether or not it
  // claims a section — see WizardStep.keys and the renewal's "Where it is from".
  if (!keysAsked(step, p)) return false;
  const claims =
    (step.sections ?? []).length + (step.documents ?? []).length > 0;
  if (!claims) return true;
  // Nothing known yet — draw the whole journey rather than flicker it in.
  if (!known(p)) return true;
  const live = liveClaims(step, p);
  return live.sections.length > 0 || live.kinds.length > 0;
}

/**
 * The steps this licence type actually has, in rail order.
 *
 * ⚠️ THE CALLER MUST RENUMBER OFF THIS LIST, never off the full table. "Step
 * 7 of 11" has to count the steps that exist, or the member is being told about
 * a screen they will never see.
 */
export function stepsFor(
  steps: readonly WizardStep[],
  p: StepProgress,
): WizardStep[] {
  return steps.filter((s) => stepAsks(s, p));
}

/**
 * Is this step finished?
 *
 * ⚠️ NOT `i < current`, WHICH IS WHAT IT USED TO BE. Position ticked a step
 * green for having been WALKED PAST — so somebody who clicked ahead to type a
 * competency number came back to four green ticks over four empty steps, and
 * the one honest signal on the rail said the opposite of the truth. Worse, the
 * step they were actually on could never go green however much they filled in.
 *
 * A step is done when everything it asks THIS applicant is in: every registry
 * section it covers holds all of its required answers, and every document it
 * asks for that is required is usably attached.
 *
 * Three things are never ticked, and each silence is deliberate:
 *   · nothing known yet — the rail has been told nothing, so it says nothing;
 *   · a step that claims nothing — the pack, and the seller's half on "Where
 *     it is from" — because nothing here knows whether it is finished;
 *   · a step this licence type asks nothing for — it should not be on the rail
 *     at all (see stepAsks), and a tick would dress that bug up as progress.
 */
export function stepDone(step: WizardStep, p: StepProgress): boolean {
  if (!known(p)) return false;
  const live = liveClaims(step, p);
  if (!live.sections.length && !live.kinds.length) return false;
  return (
    live.sections.every((s) => !p.outstandingSections.has(s)) &&
    live.kinds.every((k) => !p.outstandingKinds.has(k))
  );
}

export default function WizardRail({
  steps,
  current,
  onGo,
  interactive = true,
  lockedBefore = 0,
  askedSections = [],
  askedKinds = [],
  askedKeys,
  outstandingSections = [],
  outstandingKinds = [],
}: {
  steps: WizardStep[];
  /** Zero-based. */
  current: number;
  onGo: (index: number) => void;
  /**
   * What this application asks: the registry sections behind its fields, and
   * the document kinds its checklist asks for at any tier.
   *
   * ⚠️ BOTH EMPTY MEANS "WE WERE TOLD NOTHING", WHICH TICKS NOTHING — see
   * stepDone. That is the state on /licence-services/new, where the rail is
   * drawn over a section nobody has chosen yet, and the state for the first
   * moment of every application, before the fields and checklist have loaded.
   */
  askedSections?: readonly string[];
  askedKinds?: readonly string[];
  /**
   * Every registry key this application serves, for steps that claim a
   * question rather than a section. See WizardStep.keys.
   *
   * ⚠️ UNDEFINED, NOT EMPTY, WHEN UNKNOWN. An empty set would mean "this
   * application serves no keys at all" and would delete every key-claiming
   * step; undefined means nobody has said, and those steps stay.
   */
  askedKeys?: ReadonlySet<string>;
  /**
   * Registry sections still holding a required answer, and document kinds
   * still required and unattached.
   */
  outstandingSections?: readonly string[];
  outstandingKinds?: readonly string[];
  /**
   * Whether the rail can be navigated.
   *
   * ⚠️ FALSE ON THE CHOOSER AT /licence-services/new, WHERE THERE IS NO
   * APPLICATION TO NAVIGATE. The rail is drawn there so somebody choosing a
   * section can see they are at the start of eleven steps rather than in a
   * menu — but every step beyond the first belongs to a row that does not
   * exist yet. Rendering the buttons live would put ten controls on screen
   * that silently do nothing, which is worse than not drawing the rail at all.
   *
   * `disabled` rather than a no-op handler, so the browser and a screen reader
   * both say so instead of only the mouse finding out.
   */
  interactive?: boolean;
  /**
   * Display steps before this index are shown but cannot be gone to.
   *
   * ⚠️ THE SECTION STEP, ON A REAL APPLICATION. It is drawn — ticked, so the
   * member can see the journey started before this screen and that part of it
   * is done — but there is nothing to return to: the choice it recorded cannot
   * be changed, and the panel that used to restate it said only what the chrome
   * bar already says on every step.
   */
  lockedBefore?: number;
}) {
  const progress: StepProgress = {
    askedSections: new Set(askedSections),
    askedKinds: new Set(askedKinds),
    askedKeys,
    outstandingSections: new Set(outstandingSections),
    outstandingKinds: new Set(outstandingKinds),
  };
  return (
    <nav
      aria-label="Application steps"
      className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border)] px-4 py-[7px] sm:px-6"
    >
      {steps.map((step, i) => {
        // A step before the walk began was completed before this screen: the
        // member chose their section to get here, and the tick is the point.
        const done = i < lockedBefore || stepDone(step, progress);
        const now = i === current;
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => onGo(i)}
            disabled={!interactive || i < lockedBefore}
            aria-current={now ? "step" : undefined}
            // ⚠️ 44px TALL, NOT 30. It was a 22px dot with 4px of padding —
            // under half the minimum target on the one control a member uses
            // on every step, and the steps sit 6px apart on a phone.
            className="flex min-h-[44px] shrink-0 items-center gap-[7px] rounded-[8px] border-0 px-2 py-1 disabled:cursor-default"
            style={{
              background: now ? "var(--red-wash)" : "none",
            }}
          >
            <span
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
              style={
                done
                  ? { background: "var(--success)", color: "#fff" }
                  : now
                    ? { background: "var(--red)", color: "#fff" }
                    : {
                        border: "1px solid var(--border-hover)",
                        color: "var(--text-tertiary)",
                        background: "var(--bg-card)",
                      }
              }
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className="whitespace-nowrap text-[12px]"
              // 500 is the heaviest weight this site has — see CLAUDE.md, "400
              // and 500 ONLY". 700 and 600 rendered as 500 anyway on a system
              // stack with no bold face loaded, so this is what was shipping.
              style={
                now
                  ? { fontWeight: 500, color: "var(--text-primary)" }
                  : done
                    ? { fontWeight: 500, color: "var(--text-secondary)" }
                    : { color: "var(--text-tertiary)" }
              }
            >
              {step.name}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
