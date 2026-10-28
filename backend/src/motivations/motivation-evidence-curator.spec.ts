import { MotivationLicenceType } from '@prisma/client';
import {
  EVIDENCE_BODY_SLOTS,
  curateEvidence,
  evidenceSelectionHash,
  selectedEvidenceIds,
} from './motivation-evidence-curator';

function upload(
  id: string,
  evidenceType: string | null,
  description?: string,
) {
  return {
    id,
    kind: evidenceType ? 'EVIDENCE' : 'SHOOTING_ACTIVITY_LOG',
    evidenceType,
    description: description ?? null,
    mimeType: 'image/jpeg',
  };
}

const selfDefence = {
  licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
  answers: {
    residence_type: 'Townhouse or complex',
    safe_key_holder: 'Only me',
  },
};

describe('the evidence curator', () => {
  it('chooses the break-in evidence for a self-defence application', () => {
    const selection = curateEvidence({
      ...selfDefence,
      uploads: [
        upload('hunt', 'HUNTING_PHOTO'),
        upload('reload', 'RELOADING_BENCH_PHOTO'),
        upload('break', 'BREAK_IN_PHOTO', 'the forced gate'),
        upload('cctv', 'CCTV_STILL', 'the intruder at the gate'),
        upload('range', 'RANGE_PHOTO'),
      ],
    });
    const ids = selectedEvidenceIds(selection);
    expect(ids).toContain('break');
    expect(ids).toContain('cctv');
    expect(ids).not.toContain('hunt');
    expect(ids.length).toBeLessThanOrEqual(EVIDENCE_BODY_SLOTS);
  });

  it('chooses hunting evidence for a dedicated hunter', () => {
    const selection = curateEvidence({
      licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {
        firearm_type: 'Rifle',
        firearm_action: 'Bolt-action',
        firearm_calibre: '.308 Winchester',
        intended_quarry: 'kudu',
        hunting_locations: 'the Eastern Cape',
      },
      uploads: [
        upload('hunt', 'HUNTING_PHOTO', 'kudu in the Eastern Cape'),
        upload('trophy', 'HUNTING_TROPHY_PHOTO', 'kudu trophy'),
        upload('range', 'RANGE_PHOTO'),
        upload('break', 'BREAK_IN_PHOTO'),
        upload('reload', 'RELOADING_BENCH_PHOTO'),
      ],
    });
    const ids = selectedEvidenceIds(selection);
    expect(ids).toContain('hunt');
    expect(ids).toContain('trophy');
    expect(ids).not.toContain('break');
  });

  it('never picks more than four, and never more than two of one group', () => {
    const selection = curateEvidence({
      ...selfDefence,
      uploads: [
        upload('h1', 'HUNTING_PHOTO'),
        upload('h2', 'HUNTING_TROPHY_PHOTO'),
        upload('h3', 'HUNTING_CAMP_PHOTO'),
        upload('h4', 'TRAIL_CAM_PHOTO'),
        upload('b1', 'BREAK_IN_PHOTO'),
        upload('b2', 'DAMAGE_PHOTO'),
        upload('b3', 'CCTV_STILL'),
        upload('b4', 'ARMED_RESPONSE_REPORT'),
      ],
    });
    expect(selection.selected.length).toBeLessThanOrEqual(EVIDENCE_BODY_SLOTS);
    const chosenHunting = selection.selected.filter((s) =>
      ['h1', 'h2', 'h3', 'h4'].includes(s.id),
    );
    expect(chosenHunting.length).toBeLessThanOrEqual(2);
  });

  it('accounts for every upload, chosen or left out', () => {
    const selection = curateEvidence({
      ...selfDefence,
      uploads: [
        upload('a', 'HUNTING_PHOTO'),
        upload('b', 'BREAK_IN_PHOTO'),
        upload('c', 'RANGE_PHOTO'),
        upload('d', 'RELOADING_BENCH_PHOTO'),
        upload('e', 'CCTV_STILL'),
      ],
    });
    const ids = [
      ...selection.selected.map((s) => s.id),
      ...selection.leftOut.map((s) => s.id),
    ].sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('changes its hash when the selected set changes', () => {
    const a = curateEvidence({
      ...selfDefence,
      uploads: [
        upload('b', 'BREAK_IN_PHOTO'),
        upload('c', 'CCTV_STILL'),
      ],
    });
    const b = curateEvidence({
      ...selfDefence,
      uploads: [upload('b', 'BREAK_IN_PHOTO')],
    });
    expect(evidenceSelectionHash(a)).not.toBe(evidenceSelectionHash(b));
  });
});
