import {
  INCOMPLETE,
  MUST_READ,
  incompleteNote,
  missingMustRead,
} from './credential-completeness';

// ────────────────────────────────────────────────────────────────────
// A SCAN THAT LOST A FIELD SAYS SO, AND SAYS WHICH.
//
// Operator, 2026-09-09: "If not all fields came through in a scan the scan
// must be rejected with the reason why everywhere on this website" — and, once
// the typed-in correction had shipped, "lets leave this option. they ,must
// just rescan." So the reason's only job is to make the SECOND photograph
// better than the first, which is why it names the fields.
//
// ⚠️ THE RULE RESTS ON AN INVARIANT THEY STATED, AND ONLY WHERE THEY STATED
// IT: "the license card will always have either a serial or say NONE for all
// fields. It will never ever have an emty field." So on a licence card an
// empty field is never the card being silent — it is our read losing a word
// the card definitely had.
// ────────────────────────────────────────────────────────────────────

const full: Record<string, string> = {
  licence_number: 'SAPS/2019/0004471',
  holder_name: 'A SHOOTER',
  firearm_type: 'RIFLE',
  make: 'MARLIN',
  model: 'NONE',
  calibre: '.45-70 GOVERNMENT',
  barrel_serial: 'NONE',
  frame_serial: 'NONE',
  receiver_serial: 'MR90189D',
  section: '16',
};

describe('what a firearm licence must give us', () => {
  it('is happy with a complete card', () => {
    expect(missingMustRead('FIREARM_LICENCE', full)).toEqual([]);
  });

  it('⚠️ COUNTS "NONE" AS READ, because that is the card answering', () => {
    // The operator's own Marlin: NONE against the barrel and the frame, a real
    // number on the receiver. Nothing is missing here — see card-placeholder.
    expect(
      missingMustRead('FIREARM_LICENCE', {
        ...full,
        barrel_serial: 'NONE',
        frame_serial: 'NONE',
      }),
    ).toEqual([]);
  });

  it('⚠️ NAMES EXACTLY WHAT DID NOT COME BACK', () => {
    const { barrel_serial, section, ...rest } = full;
    void barrel_serial;
    void section;
    expect(missingMustRead('FIREARM_LICENCE', rest)).toEqual([
      'barrel_serial',
      'section',
    ]);
  });

  it('treats whitespace as absent, because it is', () => {
    expect(
      missingMustRead('FIREARM_LICENCE', { ...full, receiver_serial: '   ' }),
    ).toEqual(['receiver_serial']);
  });

  it('says nothing at all about a kind with no stated invariant', () => {
    // ⚠️ EVERY OTHER KIND IS ABSENT ON PURPOSE. A proficiency carries a
    // certificate number OR an SCV number OR an authentication code, not all
    // three; an association certificate may print no dedicated-since date.
    // Rejecting those would refuse real paperwork.
    expect(missingMustRead('PROFICIENCY', {})).toEqual([]);
    expect(missingMustRead('DEDICATED_DISCIPLINE', {})).toEqual([]);
    expect(missingMustRead('ADDRESS_CONFIRMATION', {})).toEqual([]);
    expect(Object.keys(MUST_READ)).toEqual(['FIREARM_LICENCE']);
  });

  it('reads back as a sentence a member can act on', () => {
    const note = incompleteNote(['barrel_serial', 'section']);
    expect(note).toContain('the barrel serial number');
    expect(note).toContain('the section it is licensed under');
    // ⚠️ IT BLAMES US, NOT THEM. The card had the word; we lost it.
    expect(note).toContain('our reading and not your');
    // And it says what to do: photograph it again, with that part in frame.
    expect(note).toContain('Photograph it again');
  });

  it('joins one, two and three the way a person would', () => {
    expect(incompleteNote(['make'])).toContain('read the make off');
    expect(incompleteNote(['make', 'calibre'])).toContain(
      'the make and the calibre',
    );
    expect(incompleteNote(['make', 'calibre', 'section'])).toContain(
      'the make, the calibre and the section',
    );
  });

  it('the attention code is stable, because the UI keys on it', () => {
    expect(INCOMPLETE).toBe('incomplete-read');
  });
});
