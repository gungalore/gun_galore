import { describe, it, expect } from 'vitest';
import {
  ASSOCIATION_SECTION,
  OWNED_SECTION,
  isRepeatingSection,
  nameKeyFor,
  slotOfKey,
  summaryKeysFor,
} from './motivation-item-groups';

describe('slotOfKey — owned firearms', () => {
  it('puts each firearm’s fields in its own item', () => {
    for (const suffix of [
      'type',
      'calibre',
      'make',
      'use',
      'barrel_serial',
      'frame_serial',
      'licence_no',
    ]) {
      expect(slotOfKey(OWNED_SECTION, `existing_firearm_3_${suffix}`)).toBe('3');
    }
  });

  it('keeps the six firearms apart', () => {
    const slots = [1, 2, 3, 4, 5, 6].map((n) =>
      slotOfKey(OWNED_SECTION, `existing_firearm_${n}_make`),
    );
    expect(slots).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('leaves the overlap question loose', () => {
    // It is about the whole set, not any one firearm — collapsing it under
    // "Firearm 1" would hide the question behind an unrelated heading.
    expect(slotOfKey(OWNED_SECTION, 'overlap_justification')).toBeNull();
  });
});

describe('slotOfKey — associations', () => {
  // ⚠️ THE CASE THIS FILE EXISTS FOR. Association 1's keys carry no number.
  it('⚠️ groups association 1, whose keys have NO number', () => {
    expect(slotOfKey(ASSOCIATION_SECTION, 'association_name')).toBe('1');
    expect(slotOfKey(ASSOCIATION_SECTION, 'association_number')).toBe('1');
    expect(slotOfKey(ASSOCIATION_SECTION, 'dedicated_since')).toBe('1');
  });

  it('groups the numbered associations', () => {
    expect(slotOfKey(ASSOCIATION_SECTION, 'association_2_name')).toBe('2');
    expect(slotOfKey(ASSOCIATION_SECTION, 'association_3_joined')).toBe('3');
  });

  it('never puts association 1’s fields in with association 2', () => {
    const first = ['association_name', 'association_number', 'dedicated_since']
      .map((k) => slotOfKey(ASSOCIATION_SECTION, k));
    expect(new Set(first)).toEqual(new Set(['1']));
  });
});

describe('a section that does not repeat', () => {
  it('returns null so its fields render exactly as before', () => {
    expect(slotOfKey('About you', 'full_name')).toBeNull();
    expect(slotOfKey('The firearm', 'firearm_make')).toBeNull();
    expect(isRepeatingSection('About you')).toBe(false);
    expect(isRepeatingSection(OWNED_SECTION)).toBe(true);
    expect(isRepeatingSection(ASSOCIATION_SECTION)).toBe(true);
  });
});

describe('the header of a collapsed item', () => {
  it('names a firearm by its make and summarises by calibre', () => {
    expect(nameKeyFor(OWNED_SECTION, '2')).toBe('existing_firearm_2_make');
    expect(summaryKeysFor(OWNED_SECTION, '2')).toEqual([
      'existing_firearm_2_calibre',
      'existing_firearm_2_type',
    ]);
  });

  it('handles the unnumbered first association here too', () => {
    expect(nameKeyFor(ASSOCIATION_SECTION, '1')).toBe('association_name');
    expect(nameKeyFor(ASSOCIATION_SECTION, '2')).toBe('association_2_name');
    expect(summaryKeysFor(ASSOCIATION_SECTION, '1')).toEqual([
      'association_number',
    ]);
  });

  it('⚠️ every header key resolves to a real item', () => {
    // A name key that did not itself belong to the slot it names would put a
    // heading on the wrong item — the failure would read as a display bug and
    // be hunted in CSS.
    for (const slot of ['1', '2', '3']) {
      const k = nameKeyFor(ASSOCIATION_SECTION, slot)!;
      expect(slotOfKey(ASSOCIATION_SECTION, k)).toBe(slot);
    }
    for (const slot of ['1', '4', '6']) {
      const k = nameKeyFor(OWNED_SECTION, slot)!;
      expect(slotOfKey(OWNED_SECTION, k)).toBe(slot);
    }
  });
});
