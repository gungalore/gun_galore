import { CredentialKind } from '@prisma/client';
import { derivedCredentialTitle } from './licence-centre.service';
import { cleanAlsoCovers } from './licence-centre-extract.service';

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

// ────────────────────────────────────────────────────────────────────
// ONE DOCUMENT, SEVERAL ROLES.
//
// A SA Hunters membership certificate declares the member "in good standing",
// prints the dedicated sport-shooter number, and gives ONE validity date
// governing both. Filed under a single kind, two of those three roles are
// lost and the member is asked to upload papers they have already given us.
//
// The classifier now returns also_covers. What is pinned here is the
// FILTERING of that answer, because it lands in an enum array column: an
// unknown string would be a database error, and self or OTHER would double
// every checklist match.
// ────────────────────────────────────────────────────────────────────
describe('the roles a document also covers', () => {
  // THE REAL FILTER, not a copy of it. A test that reimplements the thing it
  // is testing passes whatever the production code happens to do.
  const clean = (kind: string, raw: unknown) =>
    cleanAlsoCovers(kind as CredentialKind, raw) as string[];

  it('keeps the real extra roles on the operator’s certificate', () => {
    expect(
      clean('DEDICATED_STATUS', ['GOOD_STANDING']),
    ).toEqual(['GOOD_STANDING']);
  });

  it('drops a category that is not a category', () => {
    // Straight into an enum[] column otherwise.
    expect(clean('DEDICATED_STATUS', ['MEMBERSHIP_CERTIFICATE'])).toEqual([]);
    expect(clean('DEDICATED_STATUS', ['', null, 42])).toEqual([]);
  });

  it('drops the document’s own kind', () => {
    // Covering what you already are would match the same checklist row twice.
    expect(clean('GOOD_STANDING', ['GOOD_STANDING', 'DEDICATED_STATUS'])).toEqual(
      ['DEDICATED_STATUS'],
    );
  });

  it('drops OTHER, which is not a role anything is satisfied by', () => {
    expect(clean('DEDICATED_STATUS', ['OTHER'])).toEqual([]);
  });

  it('dedupes', () => {
    expect(
      clean('DEDICATED_STATUS', ['GOOD_STANDING', 'GOOD_STANDING']),
    ).toEqual(['GOOD_STANDING']);
  });

  it('treats a missing or malformed answer as no extra roles', () => {
    expect(clean('DEDICATED_STATUS', undefined)).toEqual([]);
    expect(clean('DEDICATED_STATUS', 'GOOD_STANDING')).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────
// NAMING A COMPETENCY CERTIFICATE.
//
// Operator, 2026-08-25: "check the firearm codes the competency is for and
// list it as 'Competency - Semi-auto Rifle' if the code was S/L Rifle for
// example", and, sending photographs of their own three certificates: "Seems
// like sometimes they will add the full word too."
//
// A member holds ONE CERTIFICATE PER ENDORSEMENT GROUP — each its own SAPS
// 524, its own number, its own issue date. All three of the operator's were
// filed here as identical rows called "Competency certificate".
// ────────────────────────────────────────────────────────────────────

describe('naming a competency certificate', () => {
  it('⚠️ names the operator’s three real certificates', () => {
    // Verbatim from the "Type of competency certificate" box on each SAPS 524.
    expect(
      derivedCredentialTitle('COMPETENCY_CERTIFICATE', {
        covers: 'COMPETENCY TO POSSESS A FIREARM HANDGUN',
      }),
    ).toBe('Competency - Handgun');

    expect(
      derivedCredentialTitle('COMPETENCY_CERTIFICATE', {
        covers: 'COMPETENCY TO POSSESS A FIREARM MANUALLY OPERATED RIFLE',
      }),
    ).toBe('Competency - Manual Rifle');

    // One certificate, two endorsements — and this is the card that made the
    // one-expiry-column problem real: the rifle side and the shotgun side
    // derive their dates from different licences.
    expect(
      derivedCredentialTitle('COMPETENCY_CERTIFICATE', {
        covers:
          'COMPETENCY TO POSSESS A FIREARM S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN',
      }),
    ).toBe('Competency - Semi-auto Rifle + Shotgun');
  });

  it('takes the abbreviated card wording too', () => {
    expect(
      derivedCredentialTitle('COMPETENCY_CERTIFICATE', { covers: 'S/L RIFLE' }),
    ).toBe('Competency - Semi-auto Rifle');
    expect(
      derivedCredentialTitle('COMPETENCY_CERTIFICATE', { covers: 'M/O SG' }),
    ).toBe('Competency - Shotgun');
  });

  it('⚠️ leaves the plain name standing when it cannot read the card', () => {
    // Returning a title here would assert less than the certificate covers.
    // "RIFLE" alone does not say whether it is semi-automatic, and those are
    // different unit standards and different sections.
    expect(
      derivedCredentialTitle('COMPETENCY_CERTIFICATE', { covers: 'RIFLE' }),
    ).toBeNull();
    expect(derivedCredentialTitle('COMPETENCY_CERTIFICATE', {})).toBeNull();
  });
});

describe('derivedCredentialTitle: proficiency', () => {
  it('names a statement of results by the unit standards it awards', () => {
    expect(
      derivedCredentialTitle('PROFICIENCY', { unit_standard: '119649, 119651', certificate_number: 'X1' }),
    ).toBe('Proficiency - Handgun + Manual Rifle');
  });
  it('has no name for one with no readable unit standard', () => {
    expect(derivedCredentialTitle('PROFICIENCY', { certificate_number: 'X1' })).toBeNull();
  });
});
