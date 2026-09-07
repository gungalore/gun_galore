import { MotivationLicenceType } from '@prisma/client';
import { FactPack, generationUserPrompt } from './motivation-prompts';
import { planFor } from './motivation-structure';

// ────────────────────────────────────────────────────────────────────
// THE WRITER IS TOLD WHAT THE APPLICANT SHOOTS, IN WORDS.
//
// ⚠️ IT WAS HANDED SLUGS. `discipline` is a multi field storing VALUES from the
// dropdown, comma-joined in the registry's own order, so the prompt carried
//
//   <answer field="discipline">ipsc-practical-pistol-handgun, other</answer>
//
// and a bare `other` wherever the applicant chose Something Else and typed what
// they actually shoot into `discipline_other`. The brief for the case section
// orders the model to "ADDRESS EVERY DISCIPLINE NAMED" — so on the one section
// a section 16 sport application turns on, it was being told to argue from a
// token nobody outside this codebase has ever seen.
//
// `disciplineLabel` existed for exactly this, with an `otherText` parameter,
// and had no callers anywhere in the repo.
// ────────────────────────────────────────────────────────────────────

const SPORT = MotivationLicenceType.S16_DEDICATED_SPORT;

const pack = (answers: Record<string, string>): FactPack => ({
  licenceType: SPORT,
  answers: {
    full_name: 'Thandi Mokoena',
    firearm_type: 'Handgun',
    firearm_make: 'CZ',
    firearm_calibre: '9mm',
    ...answers,
  },
  derived: {},

});

const promptFor = (answers: Record<string, string>) =>
  generationUserPrompt(pack(answers), planFor(SPORT, 7));

describe('⚠️ the discipline reaches the writer as prose', () => {
  it('names the discipline instead of its dropdown value', () => {
    const p = promptFor({ discipline: 'ipsc-practical-pistol-handgun' });
    expect(p).not.toContain('ipsc-practical-pistol-handgun');
    // Whatever the option list calls it, it is not a slug.
    const line = p
      .split('\n')
      .find((l) => l.includes('field="discipline"'));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/>[a-z0-9]+(-[a-z0-9]+)+</);
  });

  it('expands every discipline in a multi answer, not only the first', () => {
    const p = promptFor({
      discipline: 'ipsc-practical-pistol-handgun, vlakteskiet-chasa',
    });
    const line = p.split('\n').find((l) => l.includes('field="discipline"'))!;
    expect(line).toContain(', ');
    expect(line).not.toContain('vlakteskiet-chasa');
  });

  it('⚠️ writes what they typed, not the bare token "other"', () => {
    const p = promptFor({
      discipline: 'other',
      discipline_other: 'Precision rifle series',
    });
    const line = p.split('\n').find((l) => l.includes('field="discipline"'))!;
    expect(line).toContain('Precision rifle series');
    expect(line).not.toMatch(/>other</);
  });

  it('expands "other" even when it rides beside a listed discipline', () => {
    const p = promptFor({
      discipline: 'ipsc-practical-pistol-handgun, other',
      discipline_other: 'Precision rifle series',
    });
    const line = p.split('\n').find((l) => l.includes('field="discipline"'))!;
    expect(line).toContain('Precision rifle series');
    expect(line).not.toContain('ipsc-practical-pistol-handgun');
  });

  it('leaves an unrecognised stored answer as the applicant wrote it', () => {
    // The field was a free-text box before it was a dropdown. Showing their
    // own words back is right; showing a blank is not.
    const p = promptFor({ discipline: 'Bisley, prone' });
    expect(p).toContain('Bisley');
  });
});
