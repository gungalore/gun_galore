import { ownedFirearmSections, sectionPhrase } from './owned-firearm-sections';

// ────────────────────────────────────────────────────────────────────
// THE SECTION THE PARAGRAPH INVENTED.
//
// Operator, 2026-09-08, reading his own generated motivation: "Howa in 6.5mm
// Creedmoor is section 15." The paragraph said "all licensed under section
// 16" — because the model was handed no sections at all and the prompt told
// it to name one for every firearm, so it reached for the section of the
// APPLICATION.
//
// ⚠️ EVERY ASSERTION HERE IS ABOUT REFUSING TO GUESS. A row we cannot prove a
// section for is absent, and rule 12 then forbids the claim. Absent is a
// different thing from wrong.
// ────────────────────────────────────────────────────────────────────

const card = (
  section: string,
  serial: string,
  extra: Record<string, string> = {},
) => ({ details: { section, frame_serial: serial, ...extra } });

const row = (n: number, serial: string) => ({
  [`existing_firearm_${n}_serial`]: serial,
});

describe('reading the section off the card', () => {
  it('matches an owned row to its licence by serial', () => {
    const out = ownedFirearmSections(
      { ...row(1, 'AB1234'), ...row(2, 'CD5678') },
      [card('SECTION 15', 'AB1234'), card('16', 'CD5678')],
    );
    expect(out).toEqual({ 1: 'section 15', 2: 'section 16' });
  });

  it('⚠️ IGNORES CASE AND PUNCTUATION, which is transcription noise', () => {
    const out = ownedFirearmSections(row(1, 'ab-1234'), [
      card('S15', 'AB 1234'),
    ]);
    expect(out).toEqual({ 1: 'section 15' });
  });

  it('reads the serial from whichever column the row holds it in', () => {
    // A draft saved before the two serial boxes collapsed carries
    // `_barrel_serial` and no `_serial`.
    const out = ownedFirearmSections(
      { existing_firearm_3_barrel_serial: 'ZZ99' },
      [card('Section 13', 'ZZ99')],
    );
    expect(out).toEqual({ 3: 'section 13' });
  });

  it('matches a card that prints the number in another column', () => {
    const out = ownedFirearmSections(row(1, 'QQ11'), [
      { details: { section: '16', barrel_serial: 'QQ11' } },
    ]);
    expect(out).toEqual({ 1: 'section 16' });
  });
});

describe('when it refuses to answer', () => {
  it('⚠️ NEVER MATCHES ON MAKE AND CALIBRE', () => {
    // Four 9mm handguns is an ordinary battery; picking the wrong one writes
    // the wrong section, which is the failure this module exists to stop.
    const out = ownedFirearmSections(
      { existing_firearm_1_make: 'CZ', existing_firearm_1_calibre: '9mm' },
      [card('16', 'AB1234', { make: 'CZ', calibre: '9mm' })],
    );
    expect(out).toEqual({});
  });

  it('says nothing for a row with no serial', () => {
    expect(
      ownedFirearmSections({ existing_firearm_1_make: 'Howa' }, [
        card('15', 'AB1234'),
      ]),
    ).toEqual({});
  });

  it('says nothing when no card matches', () => {
    expect(ownedFirearmSections(row(1, 'AB1234'), [card('15', 'ZZ9999')])).toEqual(
      {},
    );
  });

  it('⚠️ TREATS A CARD PLACEHOLDER AS NO SERIAL', () => {
    // A licence card prints "NONE" against a component that carries no
    // number. Matching a row's "NONE" to a card's "NONE" would join two
    // unrelated firearms and assert a section for both.
    expect(
      ownedFirearmSections(row(1, 'NONE'), [card('16', 'NONE')]),
    ).toEqual({});
  });

  it('⚠️ DROPS A CONFLICT RATHER THAN PICKING ONE', () => {
    // Two cards claiming different sections for one serial means one was
    // misread, and writing either is a coin toss on somebody's application.
    expect(
      ownedFirearmSections(row(1, 'AB1234'), [
        card('15', 'AB1234'),
        card('16', 'AB1234'),
      ]),
    ).toEqual({});
  });

  it('says nothing for a section it cannot read', () => {
    expect(
      ownedFirearmSections(row(1, 'AB1234'), [card('unreadable', 'AB1234')]),
    ).toEqual({});
  });
});

describe('how a section is written', () => {
  it('is the number, not the enum', () => {
    expect(sectionPhrase('S15')).toBe('section 15');
    expect(sectionPhrase('S16A')).toBe('section 16A');
  });

  it('⚠️ WRITES NOTHING FOR A SECTION 20 PERMIT, which is not a section', () => {
    expect(sectionPhrase('S20_HUNTING_OR_GAME_RANCHER')).toBe('');
  });
});
