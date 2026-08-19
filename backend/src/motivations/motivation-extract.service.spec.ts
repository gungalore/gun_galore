import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { MotivationExtractService } from './motivation-extract.service';

// This reads someone's identity document and proposes what goes on a form they
// sign. So the tests are about what it REFUSES to do: invent a field, trust a
// digit it misread, or touch anything about their criminal record.

const T = MotivationLicenceType.S13_SELF_DEFENCE;

function build(reply: unknown, throws?: Error) {
  const create = jest.fn(async (_args?: any): Promise<any> => {
    if (throws) throw throws;
    return {
      content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    };
  });
  const svc = new MotivationExtractService();
  (svc as unknown as { client: unknown }).client = { messages: { create } };
  (svc as unknown as { logger: unknown }).logger = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  };
  return { svc, create };
}

const run = (
  svc: MotivationExtractService,
  kind: MotivationUploadKind = MotivationUploadKind.IDENTITY_DOCUMENT,
) =>
  svc.extract({
    kind,
    licenceType: T,
    bytes: Buffer.from('not-really-an-image'),
    mimeType: 'image/jpeg',
  });

describe('which documents are worth reading', () => {
  it('reads the ones that carry form data', () => {
    for (const k of [
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
      MotivationUploadKind.CURRENT_LICENCE,
      MotivationUploadKind.ADDRESS_CONFIRMATION,
    ]) {
      expect(MotivationExtractService.canExtract(k)).toBe(true);
    }
  });

  it('does not bother with the ones that do not', () => {
    // A photograph of a safe carries no transcribable field, and paying a model
    // to look at one is spend for nothing.
    for (const k of [
      MotivationUploadKind.SAFE_PHOTO,
      MotivationUploadKind.SAFE_INSTALLATION,
      MotivationUploadKind.CHARACTER_REFERENCE,
      MotivationUploadKind.OTHER,
    ]) {
      expect(MotivationExtractService.canExtract(k)).toBe(false);
    }
  });
});

describe('what it accepts', () => {
  it('returns a field it could read, with where it came from', async () => {
    const { svc } = build({
      fields: [
        { key: 'full_name', value: 'Jan Pieter van der Merwe', confidence: 'high' },
        { key: 'id_number', value: '8001015009087', confidence: 'high' },
      ],
    });
    const out = await run(svc);
    expect(out.map((f) => f.key).sort()).toEqual(['full_name', 'id_number']);
    expect(out[0].from).toMatch(/your ID/i);
    expect(out.every((f) => f.trusted)).toBe(true);
  });

  it('marks a low-confidence read for checking rather than dropping it', async () => {
    const { svc } = build({
      fields: [{ key: 'full_name', value: 'J P v.d. Merwe', confidence: 'low' }],
    });
    const [f] = await run(svc);
    expect(f.trusted).toBe(false);
    expect(f.note).toMatch(/not certain/i);
  });
});

describe('what it refuses', () => {
  it('drops a field it was never asked for', async () => {
    // A model inventing a key would otherwise propose a value against a field
    // that does not exist, which nothing could render or clear.
    const { svc } = build({
      fields: [
        { key: 'full_name', value: 'Jan Botha', confidence: 'high' },
        { key: 'bank_account_number', value: '1234567890', confidence: 'high' },
        { key: 'made_up_field', value: 'x', confidence: 'high' },
      ],
    });
    const out = await run(svc);
    expect(out.map((f) => f.key)).toEqual(['full_name']);
  });

  it('never reads anything about a criminal record', async () => {
    // Nothing about convictions is extractable from a photograph, and a model
    // guessing at someone's record is not a feature.
    const { svc } = build({
      fields: [
        { key: 'history_conviction', value: 'No', confidence: 'high' },
        { key: 'history_conviction_detail', value: 'none', confidence: 'high' },
      ],
    });
    expect(await run(svc)).toEqual([]);
  });

  it('does not let one document propose fields from a different document', async () => {
    // An ID card cannot yield a competency number, whatever the model says.
    const { svc } = build({
      fields: [{ key: 'competency_number', value: 'C123', confidence: 'high' }],
    });
    expect(await run(svc, MotivationUploadKind.IDENTITY_DOCUMENT)).toEqual([]);
  });

  it('rejects a choice value that is not one of the choices', async () => {
    const { svc } = build({
      fields: [
        { key: 'existing_firearm_1_type', value: 'Rocket launcher', confidence: 'high' },
      ],
    });
    expect(await run(svc, MotivationUploadKind.CURRENT_LICENCE)).toEqual([]);
  });
});

describe('the ID number is checked in CODE, not trusted', () => {
  it('distrusts an ID that fails its own check digit, however confident the model was', async () => {
    // A misread digit becomes a false statement on a firearm licence
    // application. Confidence from a model is not evidence.
    const { svc } = build({
      fields: [{ key: 'id_number', value: '8001015009088', confidence: 'high' }],
    });
    const [f] = await run(svc);
    expect(f.trusted).toBe(false);
    expect(f.note).toMatch(/valid SA ID/i);
  });

  it('distrusts an impossible date of birth', async () => {
    const { svc } = build({
      fields: [{ key: 'id_number', value: '8002315009087', confidence: 'high' }],
    });
    const [f] = await run(svc);
    expect(f.trusted).toBe(false);
  });

  it('trusts one that passes', async () => {
    const { svc } = build({
      fields: [{ key: 'id_number', value: '8001015009087', confidence: 'high' }],
    });
    expect((await run(svc))[0].trusted).toBe(true);
  });
});

describe('failing softly', () => {
  it('returns nothing when the model call throws', async () => {
    // The bytes are already stored and the row exists. An outage costs a
    // convenience, not the upload.
    const { svc } = build(null, new Error('529 overloaded'));
    expect(await run(svc)).toEqual([]);
  });

  it('returns nothing on unparseable output', async () => {
    const { svc } = build('I had a look and honestly could not tell');
    expect(await run(svc)).toEqual([]);
  });

  it('returns nothing when there is no API key at all', async () => {
    const svc = new MotivationExtractService();
    (svc as unknown as { client: unknown }).client = null;
    expect(await run(svc)).toEqual([]);
  });

  it('sends NO sampling parameters — they are a 400 on our models', async () => {
    // This test used to assert `temperature: 0`, and that assertion is what
    // made the outage look fine from in here.
    //
    // temperature / top_p / top_k were removed from the API on Opus 4.7 and
    // later, and on Sonnet 5 — the model this service actually runs on in
    // production. Every call 400'd with "`temperature` is deprecated for this
    // model", the fail-soft catch swallowed it, and extraction silently
    // returned nothing for two days while the suite stayed green.
    //
    // Deterministic transcription is the default now; there is no parameter
    // to ask for it.
    const { svc, create } = build({ fields: [] });
    await run(svc);
    const body = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toBeDefined();
    for (const param of ['temperature', 'top_p', 'top_k']) {
      expect(body[param]).toBeUndefined();
    }
  });
});
