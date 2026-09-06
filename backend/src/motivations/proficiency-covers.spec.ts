import { MotivationUploadKind } from '@prisma/client';
import { ENDORSEMENT_GATED, proficiencyCovers } from './motivation-upload-row';

describe('proficiencyCovers', () => {
  it('passes when nothing is needed or nothing is readable', () => {
    expect(proficiencyCovers('119649', null)).toBe(true);
    expect(proficiencyCovers('', 'handgun')).toBe(true);
    expect(proficiencyCovers('nonsense', 'handgun')).toBe(true);
  });
  it('passes the statement that awards the needed unit standard', () => {
    expect(proficiencyCovers('119649, 119651', 'handgun')).toBe(true);
    expect(proficiencyCovers('119649, 119651', 'rifle-mo')).toBe(true);
  });
  it('fails a readable statement for another firearm', () => {
    expect(proficiencyCovers('119649', 'shotgun')).toBe(false);
    expect(proficiencyCovers('119651', 'rifle-sl')).toBe(false);
  });
  it('is gated on the firearm like a competency', () => {
    expect(ENDORSEMENT_GATED.has(MotivationUploadKind.PROFICIENCY_CERTIFICATE)).toBe(true);
  });
});
