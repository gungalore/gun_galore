import { MotivationUploadKind } from '@prisma/client';
import { MotivationExtractService } from './motivation-extract.service';

// ────────────────────────────────────────────────────────────────────
// READING THE FIREARM OFF ANYTHING.
//
// Operator, 2026-08-28: "Can we write the ai to accepts any kind of document
// and process the information on it? As we need the firearm details and not
// the details of the owner for this part of the exercise?"
//
// The glue in addUpload is a few lines; the DECISIONS are here — which kinds
// get a second read, and where each value lands. Both are worth pinning,
// because both are silent when wrong: a kind left off the list simply never
// fills anything, and a mis-mapped serial puts the wrong number on a signed
// application while looking entirely plausible.
// ────────────────────────────────────────────────────────────────────

function build(reply: unknown, throws?: Error) {
  const create = jest.fn(async (_args?: any): Promise<any> => {
    if (throws) throw throws;
    return {
      content: [
        {
          type: 'text',
          text: typeof reply === 'string' ? reply : JSON.stringify(reply),
        },
      ],
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

const fields = (f: { key: string; value: string }[]) => ({ fields: f });
const bytes = Buffer.from('x');

describe('which kinds get a firearm read', () => {
  it('reads the kinds that could describe a firearm', () => {
    for (const k of [
      'FIREARM_SOURCE_PROOF',
      'SELLER_LICENCE',
      'CURRENT_LICENCE',
      'ASSOCIATION_ENDORSEMENT',
      'OTHER',
    ]) {
      expect(
        MotivationExtractService.readsFirearm(k as MotivationUploadKind),
      ).toBe(true);
    }
  });

  it('⚠️ does NOT read a safe photograph, an ID or a proof of address', () => {
    // A second vision call on these spends money to find nothing — and, worse,
    // hands a model the chance to invent a firearm out of a stray number on
    // the page. SELLER_LICENCE is on the list above precisely because it is a
    // firearm licence and today extracts NOTHING at all.
    for (const k of [
      'SAFE_PHOTOGRAPHS',
      'IDENTITY_DOCUMENT',
      'ADDRESS_CONFIRMATION',
      'COMPETENCY_CERTIFICATE',
      'EMPLOYMENT_CONFIRMATION',
    ]) {
      expect(
        MotivationExtractService.readsFirearm(k as MotivationUploadKind),
      ).toBe(false);
    }
  });
});

describe('what a firearm read lands on', () => {
  it('maps the HEADLINE serial onto the form’s serial field', async () => {
    // Operator: "Serial number is the number which will always be used to
    // identify the firearm. Even when the DFO asks what is the serial number
    // of the firearm, that is the number you will give him."
    const { svc } = build(
      fields([
        { key: 'firearm_make', value: 'CZ' },
        { key: 'firearm_model', value: '457' },
        { key: 'firearm_serial', value: 'MR90189D' },
      ]),
    );
    const out = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    expect(out).toEqual({
      firearm_make: 'CZ',
      firearm_model: '457',
      firearm_serial: 'MR90189D',
    });
  });

  it('⚠️ READS THE OPERATOR’S OWN CARD CORRECTLY', async () => {
    // The card that corrected this design:
    //
    //   Serial Number       MR90189D      Type  MANUALLY OPERATED RIFLE
    //   Make                MARLIN        Model NONE
    //   Barrel Serial No    NONE          Make  NONE
    //   Receiver Serial No  MR90189D      Make  MARLIN
    //   Frame Serial No     NONE          Make  NONE
    //
    // The headline serial matches the RECEIVER row and the barrel row is
    // empty. An earlier build mapped the motivation's serial from
    // barrel_serial, which on this card would have written NOTHING into the
    // one field a DFO asks about.
    const { svc } = build(
      fields([
        { key: 'firearm_serial', value: 'MR90189D' },
        { key: 'firearm_make', value: 'MARLIN' },
        { key: 'firearm_calibre', value: '.45-70 GOVERNMENT' },
        { key: 'firearm_type', value: 'MANUALLY OPERATED RIFLE' },
        { key: 'receiver_serial', value: 'MR90189D' },
        { key: 'receiver_make', value: 'MARLIN' },
        // The card prints NONE against these; the parser treats that as
        // absence rather than writing "NONE" into a box.
        { key: 'barrel_serial', value: 'NONE' },
        { key: 'frame_serial', value: 'NONE' },
      ]),
    );
    const out = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    expect(out.firearm_serial).toBe('MR90189D');
    expect(out.firearm_make).toBe('MARLIN');
    expect(out.firearm_calibre).toBe('.45-70 GOVERNMENT');
    // NONE never becomes a value.
    expect(Object.values(out)).not.toContain('NONE');
  });

  it('carries every component row to its OWN field, conflating none', async () => {
    // ✅ These used to be dropped: the registry had one serial field, and
    // forcing a component number into it would have put the wrong number on a
    // signed application. It carries all six now (SAPS 271 section E
    // 1.7–1.12), so the map is one-to-one.
    //
    // The values are deliberately all different. A mapping that crossed two
    // wires — receiver into frame, say — would still produce a full-looking
    // object, so the test names which number must land where.
    const { svc } = build(
      fields([
        { key: 'firearm_serial', value: 'S-1' },
        { key: 'barrel_serial', value: 'B-1' },
        { key: 'barrel_make', value: 'CZ' },
        { key: 'frame_serial', value: 'F-9' },
        { key: 'frame_make', value: 'GLOCK' },
        { key: 'receiver_serial', value: 'R-9' },
        { key: 'receiver_make', value: 'MARLIN' },
      ]),
    );
    const out = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    expect(out).toEqual({
      firearm_serial: 'S-1',
      barrel_serial: 'B-1',
      barrel_make: 'CZ',
      frame_serial: 'F-9',
      frame_make: 'GLOCK',
      receiver_serial: 'R-9',
      receiver_make: 'MARLIN',
    });
  });

  it('never returns anything about a person', async () => {
    // The prompt asks for none and the parser drops the rest; this is the
    // end-to-end proof through the service.
    const { svc } = build(
      fields([
        { key: 'firearm_make', value: 'Beretta' },
        { key: 'holder_name', value: 'A Person' },
        { key: 'id_number', value: '8001015009087' },
      ]),
    );
    const out = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    expect(out).toEqual({ firearm_make: 'Beretta' });
  });

  it('survives a fenced or prefaced answer', async () => {
    const { svc } = build(
      '```json\n{"fields":[{"key":"firearm_make","value":"Howa"}]}\n```',
    );
    const out = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    expect(out).toEqual({ firearm_make: 'Howa' });
  });

  it('fails soft when the model call throws', async () => {
    // Same rule as every other model call here: a failed read costs the
    // convenience, never the upload.
    const { svc } = build(null, new Error('529 overloaded'));
    await expect(
      svc.readFirearm({ bytes, mimeType: 'image/jpeg' }),
    ).resolves.toEqual({});
  });

  it('returns nothing when there is no client at all', async () => {
    const bare = new MotivationExtractService();
    await expect(
      bare.readFirearm({ bytes, mimeType: 'image/jpeg' }),
    ).resolves.toEqual({});
  });
});
