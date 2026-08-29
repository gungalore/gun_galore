import { proficiencyCover } from './sa-proficiency-cover';

// ────────────────────────────────────────────────────────────────────
// DOES THIS MEMBER HOLD 117705, ANYWHERE?
//
// ⚠️ THE OPERATOR'S OWN CASE IS THE FIRST TEST, BECAUSE IT IS THE ONE A
// PER-DOCUMENT CHECK GETS WRONG. Operator, 2026-08-28: "I did my 117705 with
// my handgun. but i have to supply that statement of results along with the
// rifle statement of results if I apply for a rifle. So both codes needs to
// be visible."
//
// 117705 is on their 2014 handgun statement; the rifle unit is on a 2021 one.
// Looking at the rifle statement alone finds no 117705 and alerts a member who
// has held it for eleven years.
//
// Text below is boilerplate from their real statements — no names, no numbers.
// ────────────────────────────────────────────────────────────────────

/** 2014, NSN Shooting Academy — the knowledge unit and the handgun unit. */
const HANDGUN_2014 = `STATEMENT OF RESULTS
SOUTH AFRICAN PROFESSIONAL FIREARM TRAINERS COUNCIL
The Following Unit Standard/s Have Been Awarded
SAQAID   Description
117705   Knowledge of the Firearms Control Act, 2000 (Act No 60 of 2000)
119649   Handle and use a Handgun`;

/** 2021, North West Guns — the rifle unit alone. No 117705 on this page. */
const RIFLE_2021 = `STATEMENT OF RESULTS
SOUTH AFRICAN PROFESSIONAL FIREARM TRAINERS COUNCIL
The following Unit Standards have been awarded
SAQA ID   Unit Standards Title
119651    Handle and Use a Manually Operated Rifle or Carbine`;

/** 2025, One Shot — the shotgun unit alone. */
const SHOTGUN_2025 = `STATEMENT OF RESULTS
The following Unit Standards have been awarded
SAQA ID   Unit Standards Title
119652    Handle and Use a Shotgun`;

describe('⚠️ the question is about the member, not about a document', () => {
  it("reads the operator's own pack as covered", () => {
    // Three statements, eleven years apart, one of them carrying 117705.
    const cover = proficiencyCover([HANDGUN_2014, RIFLE_2021, SHOTGUN_2025]);
    expect(cover.state).toBe('CONFIRMED');
    expect(cover.alert).toBeNull();
  });

  it('⚠️ DOES NOT ALERT ON THE RIFLE PAGE BECAUSE 117705 IS ON THE OTHER ONE', () => {
    // The exact false alarm a per-document check produces. Asserted from both
    // ends so the merge cannot quietly stop happening.
    expect(proficiencyCover([RIFLE_2021]).state).toBe('MISSING');
    expect(proficiencyCover([RIFLE_2021, HANDGUN_2014]).state).toBe('CONFIRMED');
  });

  it('does not care which order the documents arrive in', () => {
    const a = proficiencyCover([HANDGUN_2014, RIFLE_2021]);
    const b = proficiencyCover([RIFLE_2021, HANDGUN_2014]);
    expect(a.held).toEqual(b.held);
    expect(a.state).toBe(b.state);
  });

  it('⚠️ SHOWS BOTH CODES, WHICH IS WHAT THE OPERATOR ASKED FOR', () => {
    // "So both codes needs to be visible" — the knowledge unit and the unit
    // for the firearm being applied for.
    const cover = proficiencyCover([HANDGUN_2014, RIFLE_2021]);
    expect(cover.held).toEqual(['117705', '119649', '119651']);
  });

  it('counts one code once, however many pages repeat it', () => {
    const cover = proficiencyCover([HANDGUN_2014, HANDGUN_2014]);
    expect(cover.held).toEqual(['117705', '119649']);
  });
});

describe('⚠️ "we have not read it" is not "it is missing"', () => {
  // A phone photograph at an angle, a PDF, a Vision outage, or a document
  // uploaded before we started keeping OCR text all yield no codes. Reporting
  // that as an absent statutory requirement sends somebody back to a training
  // provider for a reprint of a course they already passed.

  it('reports UNREAD, not MISSING, when there is nothing to read', () => {
    expect(proficiencyCover([]).state).toBe('UNREAD');
    expect(proficiencyCover([null, undefined, '']).state).toBe('UNREAD');
  });

  it('reports UNREAD when the page had words but no unit standard', () => {
    // A certificate photographed so the table is cut off.
    expect(proficiencyCover(['STATEMENT OF RESULTS\nAwarded to']).state).toBe(
      'UNREAD',
    );
  });

  it('⚠️ NEVER ACCUSES ON AN UNREAD PACK', () => {
    // Both states produce a prompt; only MISSING is allowed to say we looked
    // and it was not there.
    const unread = proficiencyCover([''])!;
    expect(unread.alert).toMatch(/could not read/i);
    expect(unread.alert).not.toMatch(/but not 117705/i);

    const missing = proficiencyCover([RIFLE_2021])!;
    expect(missing.alert).toMatch(/but not 117705/i);
  });

  it('still alerts on an unread pack rather than going quiet', () => {
    // Operator: "the 117705 must always be requested by the system". Silence
    // on a pack we could not read would be a pack that never gets asked for.
    expect(proficiencyCover([]).alert).toBeTruthy();
  });

  it('counts the documents it could not read', () => {
    expect(proficiencyCover([HANDGUN_2014, '', null]).unreadable).toBe(2);
  });
});

describe('what the member is told', () => {
  it('names the code AND what it is', () => {
    // "117705" alone means nothing to somebody holding a folder of
    // certificates; the title is what is printed beside it on the page.
    const alert = proficiencyCover([RIFLE_2021]).alert!;
    expect(alert).toContain('117705');
    expect(alert).toContain('Knowledge of the Firearms Control Act');
  });

  it('names what they DO hold, so they can see what we saw', () => {
    const alert = proficiencyCover([RIFLE_2021]).alert!;
    expect(alert).toContain('119651');
  });

  it('points at the earlier statement, which is where it usually is', () => {
    expect(proficiencyCover([RIFLE_2021]).alert).toMatch(/earlier statement/i);
  });

  it('⚠️ PROMISES NOTHING ABOUT THE OUTCOME', () => {
    // It says what SAPS asks for, never what SAPS will decide.
    for (const texts of [[RIFLE_2021], [], ['']]) {
      const alert = proficiencyCover(texts).alert ?? '';
      expect(alert).not.toMatch(/\b(approve|approved|guarantee|will be granted|succeed)\b/i);
    }
  });

  it('says nothing at all once 117705 is in the pack', () => {
    expect(proficiencyCover([HANDGUN_2014]).alert).toBeNull();
  });
});

describe('the codes themselves', () => {
  it('resolves what the training lets them apply for', () => {
    const cover = proficiencyCover([HANDGUN_2014, RIFLE_2021]);
    expect(cover.endorsements.length).toBeGreaterThan(0);
  });

  it('surfaces an unrecognised code rather than dropping it', () => {
    // A code we do not carry is a gap in OUR list, not a fault in their
    // paperwork, and it must be visible to whoever fixes the list.
    const cover = proficiencyCover([
      `The following Unit Standards have been awarded
SAQA ID  Unit Standards Title
123456   Handle and Use a Trebuchet`,
    ]);
    expect(cover.unknown).toEqual(['123456']);
  });

  it('⚠️ AN UNRECOGNISED CODE DOES NOT SATISFY 117705', () => {
    // It proves a statement was read, so the state is MISSING rather than
    // UNREAD — but it must never stand in for the mandatory unit.
    const cover = proficiencyCover([
      `The following Unit Standards have been awarded
SAQA ID  Unit Standards Title
123456   Handle and Use a Trebuchet`,
    ]);
    expect(cover.state).toBe('MISSING');
    expect(cover.held).not.toContain('117705');
  });

  it('does not read a six-digit number that is not a unit standard', () => {
    // The SCV number and company registration false positives.
    const cover = proficiencyCover(['SCV Number: K/00000 -K900001\nReg.No. 2017/510807/07']);
    expect(cover.state).toBe('UNREAD');
  });
});
