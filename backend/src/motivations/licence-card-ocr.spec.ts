import { LicenceCardOcrService } from './licence-card-ocr.service';
import type { LlmService } from '../common/llm/llm.service';

// ────────────────────────────────────────────────────────────────────
// READING A LICENCE CARD THROUGH THE MODEL.
//
// ⚠️ WHAT IS BEING PROTECTED IS A SIGNED STATEMENT. Every value here lands in
// a consent the seller signs and a DFO checks. Two properties matter more than
// extraction quality:
//
//   1. A value the card asserts as NONE is kept as NONE.
//   2. A value the read could NOT establish is dropped, never written as NONE.
//
// Those two mean opposite things on the form, and the code that keeps them
// apart is what these fixtures pin.
// ────────────────────────────────────────────────────────────────────

function make(complete: jest.Mock, configured = true) {
  const llm = {
    isConfigured: () => configured,
    complete,
  } as unknown as LlmService;
  return new LicenceCardOcrService(llm);
}

/** A `complete` that answers with one JSON document. */
function reply(obj: unknown): jest.Mock {
  return jest.fn(async () => ({ text: JSON.stringify(obj) }));
}

const GLOCK = {
  make: 'GLOCK',
  model: 'NONE',
  type: 'HANDGUN',
  calibre: '9MM PAR (9X19MM)',
  serial: 'ZABA01892',
  barrelSerial: 'ZABA01892',
  barrelMake: 'GLOCK',
  receiverSerial: 'ZABA01892',
  receiverMake: 'GLOCK',
  frameSerial: 'ZABA01892',
  frameMake: 'GLOCK',
  section: 'SECTION 16',
  holder_id_number: '8001015009087',
  holder_name: 'GJP FOURIE',
};

describe('LicenceCardOcrService', () => {
  it('⚠️ FAILS SOFT WITH NO MODEL CONFIGURED, and does not call out', async () => {
    const complete = jest.fn();
    const r = await make(complete, false).read(
      Buffer.from('x'),
      'image/jpeg',
    );
    expect(r.ok).toBe(false);
    expect(r.fields).toEqual({});
    expect(complete).not.toHaveBeenCalled();
  });

  it('⚠️ FAILS SOFT WHEN THE PROVIDER THROWS', async () => {
    const complete = jest.fn(async () => {
      throw new Error('provider down');
    });
    const r = await make(complete).read(Buffer.from('x'), 'image/jpeg');
    expect(r.ok).toBe(false);
    expect(r.fields).toEqual({});
  });

  it('⚠️ FAILS SOFT ON UNPARSEABLE JSON', async () => {
    const complete = jest.fn(async () => ({ text: 'not json at all' }));
    const r = await make(complete).read(Buffer.from('x'), 'image/jpeg');
    expect(r.ok).toBe(false);
    expect(r.fields).toEqual({});
  });

  it('reads the firearm, its components, the section and the holder', async () => {
    const r = await make(reply(GLOCK)).read(Buffer.from('x'), 'image/jpeg');
    expect(r.ok).toBe(true);
    expect(r.fields.make).toBe('GLOCK');
    expect(r.fields.serial).toBe('ZABA01892');
    expect(r.fields.barrelSerial).toBe('ZABA01892');
    expect(r.fields.barrelMake).toBe('GLOCK');
    expect(r.fields.receiverMake).toBe('GLOCK');
    expect(r.fields.frameMake).toBe('GLOCK');
    expect(r.fields.section).toBe('SECTION 16');
    expect(r.holderIdNumber).toBe('8001015009087');
    expect(r.holderNameOnCard).toBe('GJP FOURIE');
  });

  it('⚠️ KEEPS A "NONE" THE CARD ASSERTS', async () => {
    // A real card: barrel CZ, receiver NONE, frame NONE. NONE is the card
    // being complete about a component with no number, and it must survive.
    const r = await make(
      reply({
        ...GLOCK,
        barrelSerial: '81815',
        barrelMake: 'CZ',
        receiverSerial: 'NONE',
        receiverMake: 'NONE',
        frameSerial: 'NONE',
        frameMake: 'NONE',
      }),
    ).read(Buffer.from('x'), 'image/jpeg');
    expect(r.fields.receiverSerial).toBe('NONE');
    expect(r.fields.receiverMake).toBe('NONE');
    expect(r.fields.frameSerial).toBe('NONE');
    expect(r.fields.barrelMake).toBe('CZ');
  });

  it('⚠️ DROPS A BLANK RATHER THAN CALLING IT NONE', async () => {
    // The whole safety property. A field the read could not establish is
    // UNDEFINED, not NONE — writing NONE would be a false statement on a
    // signed consent and the seller loses the chance to correct it because
    // the form looks filled in.
    const r = await make(
      reply({
        ...GLOCK,
        calibre: '',
        model: '',
        frameSerial: '',
        frameMake: '',
      }),
    ).read(Buffer.from('x'), 'image/jpeg');
    expect(r.fields.make).toBe('GLOCK');
    expect(r.fields.calibre).toBeUndefined();
    expect(r.fields.model).toBeUndefined();
    expect(r.fields.frameSerial).toBeUndefined();
    expect(Object.values(r.fields)).not.toContain('');
  });

  it('⚠️ ONLY ACCEPTS A 13-DIGIT ID', async () => {
    const short = await make(
      reply({ ...GLOCK, holder_id_number: '12345' }),
    ).read(Buffer.from('x'), 'image/jpeg');
    expect(short.holderIdNumber).toBeUndefined();

    const spaced = await make(
      reply({ ...GLOCK, holder_id_number: '800101 5009 087' }),
    ).read(Buffer.from('x'), 'image/jpeg');
    expect(spaced.holderIdNumber).toBe('8001015009087');
  });

  it('asks the model with the image, a schema and its own purpose', async () => {
    const complete = reply(GLOCK);
    await make(complete).read(Buffer.from('abc'), 'image/png');
    const req = complete.mock.calls[0][0];
    expect(req.purpose).toBe('licence.card.read');
    expect(req.json?.schema).toBeDefined();
    expect(req.messages[0].content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
    });
  });
});
