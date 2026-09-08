'use client';

import { useState } from 'react';

// ────────────────────────────────────────────────────────────────────
// THE ONE RED BUTTON ON THE SHEET, AND THE DECLARATION IN FRONT OF IT.
//
// ⚠️ ONE NUMBER, THREE VIEWS, AND NEVER A FOURTH. The progress pill in the
// strip, the dot on each section chip and this footer all read the SAME
// `missing` list from the server. The screen this replaces had four separate
// progress systems — a rail that ticked steps, a footer that counted answers,
// a right-hand panel with per-letter percentages, and a chip cloud on the pack
// step — and they could and did contradict each other. The walkthrough caught
// a step showing a green tick while its own panel read "H Declarations 0%".
//
// ⚠️ RED IS FOR THIS BUTTON AND NOTHING ELSE ON THE PAGE. Everything else red
// is text. On the pack screen there is no red button at all — Print and
// Download are outlined — because by then the decision has been made.
//
// ⚠️ AND THE DECLARATION LIVES HERE BECAUSE IT HAD NOWHERE ELSE. `generate()`
// refuses with 409 "Please confirm the declaration before we prepare the
// document" — a gate that has always been there, behind a wizard screen Phase 4
// deleted. So every section read Done, the button was enabled, the click 409'd,
// and `onWrite` put the message in a state the render only shows when the sheet
// FAILED TO LOAD. Operator, 2026-09-08: "It wont create the motivation. Al
// sections says their done." It failed silently, every time.
//
// ⚠️ IT IS A TICK IN FRONT OF THE BUTTON, NOT A SCREEN. The decision it guards
// is real — the applicant signs and lodges this, and section 120(9)(f) makes a
// false statement an offence — but a separate step for one sentence is the
// confirm-guarding-a-value-we-already-hold shape the operator ruled out on
// 2026-08-25. The tick sits where the consequence is.
// ────────────────────────────────────────────────────────────────────

export interface SheetFooterProps {
  /** How many required items are still empty. */
  missingCount: number;
  /**
   * Has the applicant already confirmed the declaration?
   *
   * ⚠️ FROM THE SERVER, SO IT SURVIVES A RELOAD. `declarationAcceptedAt` is on
   * the row; asking somebody to re-tick on every visit is a confirm step
   * guarding a value we already hold.
   */
  declared?: boolean;
  /** Ticked, then Write. Sends the testimonial consent with it. */
  onWrite: (declaration: { testimonialConsent: boolean }) => void;
  busy?: boolean;
}

export default function SheetFooter({
  missingCount,
  declared = false,
  onWrite,
  busy = false,
}: SheetFooterProps) {
  const [agreed, setAgreed] = useState(declared);
  const [testimonial, setTestimonial] = useState(false);
  const blocked = missingCount > 0 || !agreed;

  return (
    <div className="sticky bottom-0 z-[3] border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3">
      {/*
        ⚠️ ONLY ONCE EVERYTHING ELSE IS ANSWERED. A declaration under a form
        with eleven blanks in it is asking somebody to swear to answers they
        have not given — and it would sit on screen for the whole of the time
        the sheet is being filled in, which is how a serious sentence stops
        being read.
      */}
      {missingCount === 0 && !declared ? (
        <label className="mb-3 flex cursor-pointer items-start gap-[10px]">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-[3px] h-[16px] w-[16px] flex-shrink-0 accent-[var(--red)]"
          />
          <span className="text-[12.5px] leading-[1.45] text-[var(--text-secondary)]">
            The answers above are true and complete as far as I know, and I
            understand this motivation is written from them. I will read it
            before I sign it, and giving false information on a firearm
            application is an offence under section 120(9)(f) of the Firearms
            Control Act.
          </span>
        </label>
      ) : null}

      {missingCount === 0 && !declared ? (
        <label className="mb-3 flex cursor-pointer items-start gap-[10px]">
          <input
            type="checkbox"
            checked={testimonial}
            onChange={(e) => setTestimonial(e.target.checked)}
            className="mt-[3px] h-[16px] w-[16px] flex-shrink-0 accent-[var(--red)]"
          />
          {/*
            ⚠️ OPTIONAL, AND IT NEVER BLOCKS THE BUTTON. It is a favour we are
            asking of them, on a screen where they are asking something of us.
          */}
          <span className="text-[12.5px] leading-[1.45] text-[var(--text-tertiary)]">
            Optional: you may use my application anonymously as an example, with
            my name, ID number, address and serial numbers removed.
          </span>
        </label>
      ) : null}

      <button
        type="button"
        disabled={blocked || busy}
        onClick={() => onWrite({ testimonialConsent: testimonial })}
        className={`flex min-h-[44px] w-full items-center justify-center rounded-[var(--r-sm)] bg-[var(--red)] px-4 text-[15px] font-medium text-white ${
          blocked || busy ? 'opacity-50' : 'hover:bg-[#A00D24]'
        }`}
      >
        {busy ? 'Writing your motivation…' : 'Write my motivation'}
      </button>
      {/*
        ⚠️ THE LINE APPEARS ONLY WHILE SOMETHING IS OUTSTANDING. A count of
        zero renders nothing rather than "0 things still needed" — a footer
        that congratulates you for finishing is noise, and the enabled button
        already says the same thing.
      */}
      {/*
        ⚠️ TWO REASONS THE BUTTON CAN BE OFF, AND THEY SAY DIFFERENT THINGS. A
        member with everything answered and no tick was told "0 things still
        needed above", which is true and explains nothing.
      */}
      {missingCount > 0 ? (
        <div className="mt-2 text-center text-[12px] text-[var(--text-tertiary)]">
          {missingCount} thing{missingCount === 1 ? '' : 's'} still needed above
        </div>
      ) : !agreed ? (
        <div className="mt-2 text-center text-[12px] text-[var(--text-tertiary)]">
          Tick the declaration above and we will write it
        </div>
      ) : null}
    </div>
  );
}
