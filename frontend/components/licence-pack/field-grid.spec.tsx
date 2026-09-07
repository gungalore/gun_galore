// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FieldGrid from './field-grid';
import type { MotivationField } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// AN EMPTY ROW SAYS ITS STATUS ONCE.
//
// ⚠️ IT SAID IT TWICE, ON EVERY EMPTY ROW OF EVERY STEP THIS GRID DRAWS. The
// value column and the chip beside it both computed
// `missing.has(key) ? 'Still needed' : 'Not given'`, so the row rendered its
// own status and then rendered it again. On the operator's live section 16
// dedicated-hunter application, 2026-09-07:
//
//   Your hunting record                     Still needed   Still needed
//   Shooting disciplines you compete in     Not given      Not given
//   What the discipline requires            Not given      Not given
//
// ReadResult, two steps away in the same wizard, had already been fixed: its
// value column names WHOSE box it is ("Not on the document" for a field a
// document answers, "You may know it" for one only the member can) and lets
// the chip carry the status. This grid now does the same, and says "Optional"
// rather than "Not given" for an empty row nothing is waiting on, so the two
// panels use one vocabulary instead of two.
// ────────────────────────────────────────────────────────────────────

const f = (over: Partial<MotivationField> & { key: string }): MotivationField =>
  ({
    label: over.key,
    kind: 'short',
    section: 'G',
    ...over,
  }) as MotivationField;

const draw = (fields: MotivationField[], missing: string[] = []) =>
  render(
    <FieldGrid
      fields={fields}
      answers={{}}
      provenance={{}}
      missing={new Set(missing)}
      onChange={() => {}}
    />,
  );

describe('⚠️ the doubled status the operator photographed', () => {
  it('a required empty row says "Still needed" once, not twice', () => {
    draw([f({ key: 'hunting_record', label: 'Your hunting record' })], [
      'hunting_record',
    ]);
    expect(screen.getAllByText('Still needed')).toHaveLength(1);
  });

  it('an optional empty row does not print its status twice', () => {
    draw([f({ key: 'disciplines', label: 'Shooting disciplines' })]);
    // The old grid printed "Not given" in the value column AND in the chip.
    expect(screen.queryAllByText('Not given')).toHaveLength(0);
    expect(screen.getAllByText('Optional')).toHaveLength(1);
  });
});

describe('the value column says whose box it is', () => {
  it('a field a document answers reports the document, not the member', () => {
    draw([f({ key: 'id_number', label: 'Identity number', docSourced: 'ID' })]);
    expect(screen.getByText('Not on the document')).toBeTruthy();
  });

  it('a field only the member can answer does not blame a document', () => {
    draw([f({ key: 'disciplines', label: 'Shooting disciplines' })]);
    expect(screen.getByText('You may know it')).toBeTruthy();
    expect(screen.queryByText('Not on the document')).toBeNull();
  });

  it('a filled row shows the answer and never a placeholder', () => {
    render(
      <FieldGrid
        fields={[f({ key: 'club', label: 'Association' })]}
        answers={{ club: 'Namaqualand Hunting Association' }}
        provenance={{}}
        missing={new Set()}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Namaqualand Hunting Association')).toBeTruthy();
    expect(screen.queryByText('You may know it')).toBeNull();
    expect(screen.queryByText('Optional')).toBeNull();
  });
});


describe("a document that is not here is not blamed for what it does not carry", () => {
  // The rule itself is proved in empty-answer.spec.tsx. This asserts the grid
  // is actually wired to it — a prop declared and never passed down would let
  // the panel keep saying "Not on the document" over an empty step.
  const licence = f({
    key: 'existing_firearm_1_make',
    label: 'Make',
    docSourced: 'CURRENT_LICENCE',
  });

  it('says the document has not been read when none is attached', () => {
    render(
      <FieldGrid
        fields={[licence]}
        answers={{}}
        provenance={{}}
        missing={new Set()}
        onChange={() => {}}
        attachedKinds={new Set()}
      />,
    );
    expect(screen.getByText('Not read yet')).toBeTruthy();
    expect(screen.queryByText('Not on the document')).toBeNull();
  });

  it('says it is not on the document once that document is attached', () => {
    render(
      <FieldGrid
        fields={[licence]}
        answers={{}}
        provenance={{}}
        missing={new Set()}
        onChange={() => {}}
        attachedKinds={new Set(['CURRENT_LICENCE'])}
      />,
    );
    expect(screen.getByText('Not on the document')).toBeTruthy();
  });
});
