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
      {
        kind: "ASSOCIATION_CARD",
        title: "Your association membership",
        subtitle: "The card or certificate.",
      },
      {
        kind: "GOOD_STANDING_LETTER",
        title: "Your letter of good standing",
        subtitle: "We read the valid-until date off it.",
      },
      // ⚠️ EXPECTED ON BOTH SECTION 16 PATHS AND IT HAD NO DOOR. The pack
      // listed it on the final checklist and no step ever asked for it, so a
      // member was told the application wants an association endorsement and
      // given nowhere to attach one.
      {
        kind: "ASSOCIATION_ENDORSEMENT",
        title: "Your association's endorsement",
        subtitle:
          "The endorsement for THIS firearm — the sworn statement from the chairperson that section 16(2) asks for.",
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
    // ⚠️ THREE DOCUMENTS THAT ONLY EVER ARRIVE IF SOMEBODY ASKS. Nobody
    // attaches a shooting log or a character reference unprompted, and they
    // are exactly what separates a thin application from a good one. All
    // three were on the pack's checklist with no capture card anywhere in the
    // rail — the documents-side twin of the nineteen orphaned questions this
    // step was created to house.
    documents: [
      {
        kind: "SHOOTING_ACTIVITY_LOG",
        title: "Your record of hunts or competitions",
        subtitle:
          "Whatever you keep — a club printout, a logbook page, a score sheet. It is the evidence behind what you have just told us.",
      },
      {
        kind: "INCIDENT_REPORT",
        title: "An incident report or SAPS case number",
        subtitle:
          "Only if something has actually happened. Never invent one — an unsupported claim is worse than no claim.",
      },
      {
        kind: "CHARACTER_REFERENCE",
        title: "A character reference",
        subtitle:
          "Someone who will vouch for you. You can upload a signed letter here, or invite them to complete one.",
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

export default function WizardRail({
  steps,
  current,
  onGo,
}: {
  steps: WizardStep[];
  /** Zero-based. */
  current: number;
  onGo: (index: number) => void;
}) {
  return (
    <nav
      aria-label="Application steps"
      className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border)] px-4 py-[13px] sm:px-6"
    >
      {steps.map((step, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => onGo(i)}
            aria-current={now ? "step" : undefined}
            className="flex shrink-0 items-center gap-[7px] rounded-md border-0 px-2 py-1"
            style={{
              background: now ? "rgba(200,16,46,.05)" : "none",
            }}
          >
            <span
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
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
              style={
                now
                  ? { fontWeight: 700, color: "var(--text-primary)" }
                  : done
                    ? { fontWeight: 600, color: "var(--text-secondary)" }
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
