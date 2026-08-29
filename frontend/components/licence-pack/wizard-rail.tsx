'use client';

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
  section?: string;
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
    key: 'section',
    name: 'Section',
    fills: 'fills section D',
    title: 'What you are applying for',
    blurb:
      'Everything else is checked against this — which documents SAPS asks for, which questions the form puts to you, and how many firearms you may hold under it.',
  },
  {
    key: 'firearm',
    name: 'The firearm',
    fills: 'fills section E',
    title: 'Start with the firearm itself',
    blurb:
      'Everything after this depends on it. The type tells us which competency to pull from your Document Centre, which endorsement your association has to give, and whether the seller is a dealer or a private owner.',
    section: 'The firearm',
  },
  {
    key: 'source',
    name: 'Where it is from',
    fills: 'fills section F',
    title: 'Where this firearm is coming from',
    blurb:
      'A dealer sale and a private transfer need different paperwork at the counter. On a private sale we send the current owner his own half of the form, and it runs while you carry on here.',
  },
  {
    key: 'competency',
    name: 'Competency',
    fills: 'fills G 1.5 – 1.7',
    title: 'Your competency',
    blurb:
      'Without competency for this type of firearm, SAPS cannot process the application at all. Most of this comes off the certificate already in your Document Centre.',
    section: 'Your competency',
  },
  {
    key: 'owned',
    name: 'What you own',
    fills: 'fills G item 2',
    title: 'The firearms you already hold',
    blurb:
      'Most of these come from your Document Centre. Check them against your licence cards — what SAPS holds is what the form must say.',
    section: 'Firearms you already own',
  },
  {
    key: 'about',
    name: 'About you',
    fills: 'fills G items 3 – 27',
    title: 'About you',
    blurb:
      'Your details as SAPS holds them. Anything we filled in came from a document you gave us, and all of it is yours to correct.',
    section: 'About you',
  },
  {
    key: 'dedicated',
    name: 'Dedicated status',
    fills: 'fills G items 55 – 60',
    title: 'Your association and your status',
    blurb:
      'A section 16 application rests on this: an accredited association, your membership, and a letter saying you are in good standing.',
    section: 'Dedicated status',
  },
  {
    key: 'storage',
    name: 'Storage',
    fills: 'fills the storage boxes',
    title: 'Where it will be kept',
    blurb:
      'The form asks what the safe is and how it is fixed; the DFO asks to see it. Photographs of the safe go in your pack as one annexure.',
    section: 'Storage and safety',
  },
  {
    key: 'declarations',
    name: 'Declarations',
    fills: 'fills section H',
    title: 'The questions only you can answer',
    blurb:
      'Nothing in your Document Centre can answer these and we will never guess at one. They are near the end on purpose — they are quick, and they should not be the first thing you meet.',
    section: 'History',
  },
  {
    key: 'pack',
    name: 'Your pack',
    fills: 'what you take to the counter',
    title: 'Your pack',
    blurb:
      'What we produce, what you gather, and what somebody else has to send. Everything stays here until you print it.',
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
            aria-current={now ? 'step' : undefined}
            className="flex shrink-0 items-center gap-[7px] rounded-md border-0 px-2 py-1"
            style={{
              background: now ? 'rgba(200,16,46,.05)' : 'none',
            }}
          >
            <span
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={
                done
                  ? { background: 'var(--success)', color: '#fff' }
                  : now
                    ? { background: 'var(--red)', color: '#fff' }
                    : {
                        border: '1px solid var(--border-hover)',
                        color: 'var(--text-tertiary)',
                        background: 'var(--bg-card)',
                      }
              }
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className="whitespace-nowrap text-[12px]"
              style={
                now
                  ? { fontWeight: 700, color: 'var(--text-primary)' }
                  : done
                    ? { fontWeight: 600, color: 'var(--text-secondary)' }
                    : { color: 'var(--text-tertiary)' }
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
