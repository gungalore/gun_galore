import { MotivationLicenceType } from '@prisma/client';
import { buildSaps271 } from './saps271-map';
import { gateUserPrompt } from './motivation-prompts';
import { SAPS271_FILL, SAPS271_OPT_KEY } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// WHERE "NONE" IS KEPT, AND WHERE IT IS DROPPED.
//
// A South African firearm licence prints NONE in a row that does not apply to
// that firearm — a rifle with no separate frame serial reads "Frame Serial No
// NONE". That word is part of the record, and the two ends of this system want
// opposite things from it:
//
//   THE FORM WANTS IT. Operator, 2026-09-08: "instruct gemini to read a NONE as
//   NONE and not leave it out. All those fields needs to be captured on a
//   license card and filled in on the form, especially on the 271 that requires
//   it." An empty box does not say what a box reading NONE says.
//
//   THE WRITER MUST NEVER SEE IT. "Model NONE" handed to a language model is an
//   invitation to write a sentence about a firearm called None.
//
// ⚠️ SO THE STRIP SITS AT THE PROSE BOUNDARY, NOT THE ANSWER BOUNDARY. It used
// to sit between the card and the answer, which kept the writer clean and cost
// the form the value entirely. This file is the pair of assertions that keeps
// it where it is: move it back and one of these two goes red.
// ────────────────────────────────────────────────────────────────────

const S16 = MotivationLicenceType.S16_DEDICATED_SPORT;

const ANSWERS = {
  [SAPS271_OPT_KEY]: SAPS271_FILL,
  firearm_type: 'Rifle',
  firearm_make: 'MARLIN',
  firearm_model: 'NONE',
  firearm_calibre: '.45-70 GOVERNMENT',
  firearm_serial: 'MR90189D',
  barrel_serial: 'NONE',
  frame_serial: 'NONE',
  receiver_serial: 'MR90189D',
};

describe('the SAPS 271 prints what the card printed', () => {
  const built = () =>
    buildSaps271({ licenceType: S16, answers: ANSWERS }) as {
      text: Record<string, string>;
    };

  it('⚠️ PUTS "NONE" IN THE BOX RATHER THAN LEAVING IT BLANK', () => {
    expect(built().text.e_barrel_serial).toBe('NONE');
    expect(built().text.e_frame_serial).toBe('NONE');
  });

  it('still prints the real numbers beside them', () => {
    expect(built().text.e_receiver_serial).toBe('MR90189D');
  });
});

describe('the writer never sees a placeholder', () => {
  // gateUserPrompt rather than generationUserPrompt: both render the same fact
  // pack through renderFacts, and this one does not also need a StructurePlan.
  const text = () =>
    gateUserPrompt(
      { licenceType: S16, answers: ANSWERS, derived: {} } as never,
      'the drafted motivation',
    );

  it('⚠️ NO PLACEHOLDER ANSWER REACHES THE FACT PACK', () => {
    // renderFacts runs answerValue() over every answer. If this goes red the
    // strip has moved back to the answer boundary, or been dropped entirely.
    const t = text();
    expect(t).not.toContain('field="firearm_model"');
    expect(t).not.toContain('field="barrel_serial"');
    expect(t).not.toContain('field="frame_serial"');
  });

  it('keeps the answers that are real', () => {
    const t = text();
    expect(t).toContain('MARLIN');
    expect(t).toContain('.45-70 GOVERNMENT');
  });
});
