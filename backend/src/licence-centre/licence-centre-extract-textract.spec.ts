// backend/src/licence-centre/licence-centre-extract-textract.spec.ts
//
// The ORDER of the two readers, which is the whole point of the change.
//
// Textract first; Claude only when Textract cannot answer. A regression here
// is invisible in every other test — the Claude path still works, so nothing
// fails — it just quietly goes back to paying a model to read a document that
// says what it is across the top.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LicenceCentreExtractService } from './licence-centre-extract.service';
import { LicenceCentreTextractService } from './licence-centre-textract.service';

const DIR = join(__dirname, '__fixtures__', 'textract');
const fx = (doc: string) =>
  JSON.parse(readFileSync(join(DIR, `${doc}.json`), 'utf8'));

/** A Textract service that answers from a fixture instead of the network. */
function serving(doc: string | null) {
  const textract = new LicenceCentreTextractService();
  const analyse = jest
    .spyOn(textract, 'analyse')
    .mockResolvedValue(doc ? fx(doc) : null);
  return { service: new LicenceCentreExtractService(textract), analyse };
}

const BYTES = Buffer.from('not really a jpeg');

describe('classify', () => {
  it('answers from the markers without calling a model', async () => {
    const { service, analyse } = serving('doc03');
    const out = await service.classify({
      bytes: BYTES,
      mimeType: 'image/jpeg',
    });
    expect(out).toEqual({
      kind: 'FIREARM_LICENCE',
      confident: true,
      alsoCovers: [],
    });
    expect(analyse).toHaveBeenCalled();
  });

  it('recognises a competency certificate', async () => {
    const { service } = serving('doc12');
    const out = await service.classify({
      bytes: BYTES,
      mimeType: 'image/jpeg',
    });
    expect(out?.kind).toBe('COMPETENCY_CERTIFICATE');
  });

  // ⚠️ THE FALLBACK IS THE FEATURE, NOT A SAFETY NET NOBODY EXPECTS TO HIT.
  // Proof of address, employment letters and every association certificate
  // whose letterhead is not in the table yet reach Claude by this route.
  // Without an API key configured the Claude path returns null, which is what
  // this asserts: markers declined, and it did NOT invent a kind.
  it('falls through when Textract returns nothing', async () => {
    const { service } = serving(null);
    expect(
      await service.classify({ bytes: BYTES, mimeType: 'image/jpeg' }),
    ).toBeNull();
  });

  it('falls through on a document the table does not describe', async () => {
    const textract = new LicenceCentreTextractService();
    jest.spyOn(textract, 'analyse').mockResolvedValue({
      Blocks: [
        { BlockType: 'LINE', Text: 'CITY OF JOHANNESBURG' },
        { BlockType: 'LINE', Text: 'MUNICIPAL ACCOUNT' },
      ],
    });
    const service = new LicenceCentreExtractService(textract);
    expect(
      await service.classify({ bytes: BYTES, mimeType: 'image/jpeg' }),
    ).toBeNull();
  });
});

describe('read', () => {
  it('returns the Textract reading for a document it can read', async () => {
    const { service } = serving('doc03');
    const r = await service.read({
      kind: 'FIREARM_LICENCE',
      bytes: BYTES,
      mimeType: 'image/jpeg',
      alsoCovers: [],
    });
    expect(r.details).toMatchObject({
      make: 'HOWA',
      calibre: '6.5MM CREEDMOOR',
      section: '15',
    });
    expect(r.issuedOn).toBe('2022-11-29');
    expect(r.expiresOn).toBe('2032-11-28');
  });

  // Textract will return a street address and a printer's imprint off a
  // certificate whose real fields it could not resolve. Counting those as a
  // successful read would skip the fallback on exactly the documents that
  // need it most.
  it('falls back when nothing storable came out', async () => {
    const textract = new LicenceCentreTextractService();
    jest.spyOn(textract, 'analyse').mockResolvedValue({
      Blocks: [{ BlockType: 'LINE', Text: 'SOMETHING ILLEGIBLE' }],
    });
    const service = new LicenceCentreExtractService(textract);
    const r = await service.read({
      kind: 'FIREARM_LICENCE',
      bytes: BYTES,
      mimeType: 'image/jpeg',
      alsoCovers: [],
    });
    // No API key in tests, so the fallback yields the empty reading — the
    // point is that it did NOT return a "successful" read built from a
    // street address.
    expect(r.details).toEqual({});
  });
});
