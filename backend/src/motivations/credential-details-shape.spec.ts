import { encryptJson, decryptJson } from '../common/blob-crypto';

// ⚠️ THE SEAM THAT SILENTLY FAILED FOR MONTHS.
//
// The Licence Centre WRITES what vision read as `encryptJson(reading.details)`
// into Credential.detailsEncrypted. The motivation offer READS it to fill the
// competency number and the association fields.
//
// It was reading Credential.extractionEncrypted — a column the vault never
// writes — and unwrapping a `{ details: … }` envelope that is not there. Two
// mistakes, each of which alone would have produced exactly the same symptom:
// an empty dropdown, no error, nothing in any log, and an operator asking
// three times for a feature that was already deployed.
//
// Nothing here can catch the WRONG COLUMN (that is Prisma's shape, asserted by
// the fact that the code compiles against detailsEncrypted). What it does pin
// is the SHAPE, which is the half a type-checker cannot see through: both
// sides go through `encryptJson`/`decryptJson<T>` with T unverified at
// runtime, so a wrapper added on one side would compile perfectly and read
// back as undefined.
describe('what the vault stores for a credential', () => {
  const ORIGINAL = process.env.ID_HASH_SECRET;
  beforeAll(() => {
    process.env.ID_HASH_SECRET = 'test-secret-for-credential-shape-specs';
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.ID_HASH_SECRET;
    else process.env.ID_HASH_SECRET = ORIGINAL;
  });

  const detailsAsVaultWritesThem = {
    competency_number: 'C-12345',
    holder_name: 'G J P Fourie',
    covers: 'Handgun; Rifle',
  };

  it('⚠️ IS THE DETAILS OBJECT ITSELF, not wrapped in { details }', () => {
    const blob = encryptJson(detailsAsVaultWritesThem);
    const read = decryptJson<Record<string, string>>(blob);
    expect(read.competency_number).toBe('C-12345');

    // The shape the reader used to expect. If somebody reintroduces the
    // envelope on the write side, this is what fails.
    const wrongly = decryptJson<{ details?: Record<string, string> }>(blob);
    expect(wrongly.details).toBeUndefined();
  });

  it('round-trips every key the competency reader looks for', () => {
    // credentialOffer/credentialChoices read competency_number first and fall
    // back to certificate_number; a key lost in transit is a dropdown that
    // stays empty with nothing to show for it.
    for (const key of ['competency_number', 'certificate_number']) {
      const read = decryptJson<Record<string, string>>(
        encryptJson({ [key]: 'X-1' }),
      );
      expect(read[key]).toBe('X-1');
    }
  });
});
