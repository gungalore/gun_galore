import { derivedCredentialTitle } from './licence-centre.service';

// ────────────────────────────────────────────────────────────────────
// WHAT A SHOOTER CALLS A FIREARM.
//
// Six rows all reading "Firearm licence" is a filing cabinet with no labels:
// the owner cannot tell which is which without opening each one, and every
// picker that offers them — the motivation's owned-firearms fill especially —
// offers six identical choices. Make and calibre is how people actually refer
// to a firearm: "Howa 6.5 Creedmoor", not "licence 3088".
//
// Operator, 2026-08-20.
// ────────────────────────────────────────────────────────────────────

describe('naming a licence from what we read off it', () => {
  const fa = (details: Record<string, string>) =>
    derivedCredentialTitle('FIREARM_LICENCE', details);

  it('is make then calibre', () => {
    expect(fa({ make: 'Howa', calibre: '6.5 Creedmoor' })).toBe(
      'Howa 6.5 Creedmoor',
    );
  });

  it('handles a real extraction off a South African licence', () => {
    // Block capitals and irregular spacing are what the OCR actually returns.
    expect(fa({ make: 'NORDISKE  PRECISION', calibre: '.223 REM' })).toBe(
      'NORDISKE PRECISION .223 REM',
    );
  });

  it('uses whichever half it has', () => {
    expect(fa({ make: 'Howa' })).toBe('Howa');
    expect(fa({ calibre: '6.5 Creedmoor' })).toBe('6.5 Creedmoor');
  });

  it('declines rather than inventing a name from nothing', () => {
    // null means "leave the existing title alone". Returning '' or a partial
    // would overwrite a perfectly good name with a worse one.
    expect(fa({})).toBeNull();
    expect(fa({ make: '   ', calibre: '' })).toBeNull();
    expect(fa({ licence_number: '3088', holder_name: 'A Shooter' })).toBeNull();
  });

  it('declines a scrap too short to be a name', () => {
    // A single stray character off a bad read is worse than the placeholder.
    expect(fa({ make: 'X' })).toBeNull();
  });

  it('names ONLY firearm licences', () => {
    // A competency certificate has nothing to distinguish it by, and every
    // other kind is already unique in a member's vault or close to it.
    for (const kind of [
      'COMPETENCY_CERTIFICATE',
      'DEDICATED_STATUS',
      'GOOD_STANDING',
      'PROFICIENCY',
      'DEDICATED_HUNTER',
      'PROFESSIONAL_HUNTER',
      'OTHER',
    ] as const) {
      expect(
        derivedCredentialTitle(kind, { make: 'Howa', calibre: '6.5' }),
      ).toBeNull();
    }
  });

  it('does not let a long field run away with the row', () => {
    const long = fa({ make: 'M'.repeat(200), calibre: 'C'.repeat(200) })!;
    expect(long.length).toBeLessThanOrEqual(120);
  });
});
