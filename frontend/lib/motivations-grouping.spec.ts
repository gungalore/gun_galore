import { describe, expect, it } from 'vitest';
import {
  groupBySection,
  orderByDependency,
  type MotivationField,
} from './motivations-api';

const f = (
  key: string,
  section: string,
  extra: Partial<MotivationField> = {},
): MotivationField =>
  ({
    key,
    label: key,
    kind: 'short',
    section,
    ...extra,
  }) as MotivationField;

describe('groupBySection', () => {
  it('⚠️ MERGES RUNS OF THE SAME SECTION, which blocked a real application', () => {
    // The registry visits "About you" three times. Grouping consecutive runs
    // made three steps sharing one React key, and the third held
    // spouse_id_type — REQUIRED for a married applicant, and unreachable. The
    // member filled every field they could see and was told on generate that
    // required answers were missing, with nothing on screen to fix.
    const out = groupBySection([
      f('full_name', 'About you'),
      f('firearm_make', 'The firearm'),
      f('cellphone', 'About you'),
      f('spouse_id_type', 'About you'),
    ]);
    expect(out.map((s) => s.section)).toEqual(['About you', 'The firearm']);
    expect(out[0].fields.map((x) => x.key)).toEqual([
      'full_name',
      'cellphone',
      'spouse_id_type',
    ]);
  });

  it('keeps first-appearance order of the sections themselves', () => {
    const out = groupBySection([
      f('a', 'History'),
      f('b', 'About you'),
      f('c', 'History'),
    ]);
    expect(out.map((s) => s.section)).toEqual(['History', 'About you']);
  });

  it('handles an empty list', () => {
    expect(groupBySection([])).toEqual([]);
  });
});

describe('orderByDependency', () => {
  it('⚠️ PUTS THE QUESTION BEFORE THE ONE THAT DEPENDS ON IT', () => {
    // The real pair: spouse_id_number is declared BEFORE the spouse_id_type
    // it hangs off. Pages apart that was invisible; in one merged step it
    // means answering near the bottom makes a field appear near the TOP,
    // above where the member is looking.
    const out = orderByDependency([
      f('spouse_id_number', 'About you', {
        showIf: { key: 'spouse_id_type', equals: 'SA ID' },
      }),
      f('marital_status', 'About you'),
      f('spouse_id_type', 'About you', {
        showIf: { key: 'marital_status', equals: 'Married' },
      }),
    ]);
    const at = (k: string) => out.findIndex((x) => x.key === k);
    expect(at('marital_status')).toBeLessThan(at('spouse_id_type'));
    expect(at('spouse_id_type')).toBeLessThan(at('spouse_id_number'));
  });

  it('leaves an already-ordered section exactly as it is', () => {
    // Stability matters: the registry's order is deliberate everywhere else,
    // and a reshuffle would move questions somebody is used to.
    const fields = [
      f('a', 'S'),
      f('b', 'S', { showIf: { key: 'a', equals: 'Yes' } }),
      f('c', 'S'),
    ];
    expect(orderByDependency(fields).map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });

  it('⚠️ IGNORES A DEPENDENCY IN ANOTHER SECTION', () => {
    // It is already on an earlier step; dragging it in would move a question
    // out of the section it belongs to.
    const out = orderByDependency([
      f('here', 'S', { showIf: { key: 'elsewhere', equals: 'Yes' } }),
    ]);
    expect(out.map((x) => x.key)).toEqual(['here']);
  });

  it('never drops or duplicates a field', () => {
    const fields = [
      f('c', 'S', { showIf: { key: 'b', equals: 'x' } }),
      f('b', 'S', { showIf: { key: 'a', equals: 'x' } }),
      f('a', 'S'),
      f('d', 'S'),
    ];
    const out = orderByDependency(fields);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((x) => x.key)).size).toBe(4);
    expect(out.map((x) => x.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('survives a field pointing at itself', () => {
    // Not expressible through the admin surface, but a registry edit could
    // write it, and an infinite loop here would white-screen the wizard.
    const out = orderByDependency([
      f('a', 'S', { showIf: { key: 'a', equals: 'x' } }),
      f('b', 'S'),
    ]);
    expect(out.map((x) => x.key)).toEqual(['a', 'b']);
  });
});
