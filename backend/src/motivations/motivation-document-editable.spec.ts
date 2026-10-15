import { MotivationStatus } from '@prisma/client';
import { DOCUMENT_EDITABLE, EDITABLE } from './motivation-shared.service';

// ⚠️ THE FIX FOR MO000096, 2026-10-15: the association's endorsement was
// uploaded to a COMPLETED pack and answered 409 "can no longer be edited".
// Document edits are allowed wherever the pack can still be regenerated, so a
// late endorsement appears on the next download (the pack re-renders from the
// stored rows) without an admin.
describe('DOCUMENT_EDITABLE', () => {
  it('allows every editable draft', () => {
    for (const s of EDITABLE) expect(DOCUMENT_EDITABLE).toContain(s);
  });

  it('⚠️ ALLOWS A COMPLETED PACK, so a late document can still be added', () => {
    expect(DOCUMENT_EDITABLE).toContain(MotivationStatus.COMPLETED);
    // ...and a FAILED one, whose pack is unusable, so there is nothing to lock.
    expect(DOCUMENT_EDITABLE).toContain(MotivationStatus.FAILED);
  });

  it('does NOT open a pass in flight, or a pack somebody walked away from', () => {
    expect(DOCUMENT_EDITABLE).not.toContain(MotivationStatus.GENERATING);
    expect(DOCUMENT_EDITABLE).not.toContain(MotivationStatus.ABANDONED);
  });
});
