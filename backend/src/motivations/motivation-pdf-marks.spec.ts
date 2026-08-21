import { markForSection } from './motivation-pdf-marks';
import type { SectionId } from './motivation-structure';

// ────────────────────────────────────────────────────────────────────
// The drawing cannot really be unit-tested — a path either looks like a rifle
// or it does not, and that is settled by rendering it and looking. What CAN go
// wrong silently is the MAPPING: a mark against the wrong section is a small
// wrong claim on a document somebody signs, and it would never throw.
// ────────────────────────────────────────────────────────────────────

describe('markForSection', () => {
  it('takes the shape of the firearm actually applied for', () => {
    // The one section where the subject is known exactly. Drawing a rifle on
    // a handgun application would be a picture of the wrong thing, right
    // beside the paragraph describing the right one.
    expect(markForSection('the_firearm', 'Pistol')).toBe('pistol');
    expect(markForSection('the_firearm', 'self-loading handgun')).toBe('pistol');
    expect(markForSection('the_firearm', 'Revolver')).toBe('pistol');
    expect(markForSection('the_firearm', 'Shotgun')).toBe('shotgun');
    expect(markForSection('the_firearm', 'Bolt-action rifle')).toBe('rifle');
  });

  it('falls back to the rifle when the type is unknown', () => {
    // Not because a rifle is a safe default in general, but because this
    // catalogue's applications are overwhelmingly for long guns and the mark
    // sits beside a heading that names the firearm in words anyway.
    expect(markForSection('the_firearm', undefined)).toBe('rifle');
    expect(markForSection('the_firearm', '')).toBe('rifle');
  });

  it('never puts a hunting mark on a self-defence application', () => {
    // ⚠️ THE ONE THAT WOULD ACTUALLY EMBARRASS US. A trophy beside a section
    // arguing that somebody needs a firearm because of a threat to their life
    // is the kind of mistake a reviewer remembers.
    expect(markForSection('the_threat')).toBe('shield');
    expect(markForSection('the_quarry')).toBe('trophy');
    expect(markForSection('the_discipline')).toBe('activity');
  });

  it('leaves sections with no honest subject unmarked', () => {
    // A mark chosen to fill a gap is decoration, which is the thing these are
    // not. An argument about a person has no picture.
    for (const id of [
      'introduction',
      'personal_circumstances',
      'conclusion',
    ] as SectionId[]) {
      expect(markForSection(id)).toBeNull();
    }
  });

  it('marks the sections a reviewer actually checks', () => {
    expect(markForSection('storage_safety')).toBe('safe');
    expect(markForSection('compliance_history')).toBe('document');
    expect(markForSection('experience')).toBe('activity');
  });
});
