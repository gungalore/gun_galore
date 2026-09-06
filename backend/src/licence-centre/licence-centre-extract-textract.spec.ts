// backend/src/licence-centre/licence-centre-extract-textract.spec.ts
//
// The ORDER of the two readers, which is the whole point of the change.
//
// Textract first; Claude only when Textract cannot answer. Classification
// itself is common/document-markers.ts — this pins the ORDER and the seam,
// not the marker table. A regression here
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

  // 🚨 EVERY MARKER HIT USED TO COME BACK `confident: true`, INCLUDING THE
  // FUZZY ONES. readMarkers grades its own answer — and it also DOWNGRADES a
  // definitive marker to 'strong' when it had to match loosely on a smudged
  // page — so the one signal saying "look at this one" was thrown away at the
  // point it mattered. `confident: false` is what puts the correction dropdown
  // in front of the member, and filing an association certificate as the wrong
  // status once put the operator's SPORT-shooter status on a section 16
  // application.
  it('⚠️ is confident only on a DEFINITIVE marker', async () => {
    const { service } = serving('doc03');
    const out = await service.classify({ bytes: BYTES, mimeType: 'image/jpeg' });
    // doc03 heads with "Licence To Possess a Firearm" — the form itself.
    expect(out).toEqual({
      kind: 'FIREARM_LICENCE',
      confident: true,
      alsoCovers: [],
    });
  });

  it('⚠️ asks the member when the marker was only STRONG', async () => {
    // The green book's identity-page field labels, without the authority line
    // a cropped photograph loses — strong evidence of an ID, and not the
    // document declaring itself.
    const textract = new LicenceCentreTextractService();
    jest.spyOn(textract, 'analyse').mockResolvedValue({
      Blocks: [
        { BlockType: 'LINE', Text: 'SURNAME' },
        { BlockType: 'LINE', Text: 'FORENAMES' },
        { BlockType: 'LINE', Text: 'S.A.CITIZEN' },
      ],
    });
    const out = await new LicenceCentreExtractService(textract).classify({
      bytes: BYTES,
      mimeType: 'image/jpeg',
    });
    expect(out?.kind).toBe('IDENTITY_DOCUMENT');
    expect(out?.confident).toBe(false);
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
      // Normalised by the reader — see textract-document-extract.spec.ts.
      section: 'S15',
    });
    expect(r.issuedOn).toBe('2022-11-29');
    expect(r.expiresOn).toBe('2032-11-28');
  });

  // 🚨 `autoFillable` WAS COMPUTED AND THROWN AWAY. extractDocument scores
  // every material field and knows when one the kind cannot do without came
  // back empty — and read() spread `got.reading`, which does not carry it. So
  // the only reader that measures its own work had no way to tell
  // mayArmReadExpiry not to act, and that guard was left checking a
  // `lowConfidence` list which on this path can never name a date: `expiresOn`
  // is its own field and is never a key in `details`.
  it('⚠️ carries the reader own auto-fill verdict through', async () => {
    const { service } = serving('doc03');
    const r = await service.read({
      kind: 'FIREARM_LICENCE',
      bytes: BYTES,
      mimeType: 'image/jpeg',
      alsoCovers: [],
    });
    expect(typeof r.autoFillable).toBe('boolean');
  });

  it('⚠️ says NOT auto-fillable when a date the kind needs is missing', async () => {
    // A licence with a make and no validity range: readable enough to store,
    // nowhere near safe enough to arm a reminder from.
    const textract = new LicenceCentreTextractService();
    jest.spyOn(textract, 'analyse').mockResolvedValue({
      Blocks: [
        { BlockType: 'LINE', Text: 'MAKE' },
        {
          BlockType: 'KEY_VALUE_SET',
          EntityTypes: ['KEY'],
          Confidence: 99,
          Relationships: [
            { Type: 'VALUE', Ids: ['v1'] },
            { Type: 'CHILD', Ids: ['k1'] },
          ],
          Id: 'k0',
        },
      ],
    });
    const r = await new LicenceCentreExtractService(textract).read({
      kind: 'FIREARM_LICENCE',
      bytes: BYTES,
      mimeType: 'image/jpeg',
      alsoCovers: [],
    });
    // Either the Textract path answered and said no, or it fell through to the
    // model (no API key in tests) and expressed no opinion at all. What must
    // never happen is a confident `true` off a card carrying no dates.
    expect(r.autoFillable).not.toBe(true);
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
