import { MotivationUploadKind } from '@prisma/client';
import { MotivationExtractService } from './motivation-extract.service';
import type { LlmResponse } from '../common/llm/llm.types';
import { answerValue } from '../common/card-placeholder';

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

function build(reply: unknown, throws?: Error, configured = true) {
  const complete = jest.fn(async (_req?: any): Promise<LlmResponse> => {
    if (throws) throw throws;
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return {
      text,
      parts: [{ type: 'text', text }],
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 10 },
      model: 'test-model-2.5',
      provider: 'gemini',
      assistantMessage: { role: 'assistant', content: [{ type: 'text', text }] },
    };
  });
  const llm = {
    complete,
    stream: jest.fn(),
    isConfigured: () => configured,
    model: 'test-model-2.5',
    provider: 'gemini' as const,
  };
  const svc = new MotivationExtractService(llm as never);
  (svc as unknown as { logger: unknown }).logger = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  };
  return { svc, complete };
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

  it('⚠️ IS A READER, so it hands back what the page said', async () => {
    // ⚠️ THE PLACEHOLDER RULE DOES NOT LIVE HERE, AND THE FILE IT IMPORTS SAYS
    // SO IN CAPITALS: "THE READERS AND THE VAULT KEEP THE CARD VERBATIM"
    // (common/card-placeholder.ts). readFirearm reads a document; the ANSWER
    // boundary is its one consumer, motivation-documents.service.ts, which
    // runs answerValue() over every pair before any of it is proposed as an
    // answer. A guard here is a duplicate, and a reader that quietly edits the
    // page is the thing the seller-consent declaration cannot use.
    //
    // Two rules, one job, and the INNER one is narrower on purpose:
    // firearm-identity's parser already drops none / n/a / unknown before a
    // value is written, so NONE never reaches this map at all. What survives
    // to here is the wordings that rule does not know — NIL, a bare dash,
    // "Not applicable" — and they are stopped at the boundary with everything
    // else.
    const { svc } = build(
      fields([
        { key: 'firearm_make', value: 'MARLIN' },
        { key: 'firearm_model', value: 'NIL' },
        { key: 'frame_serial', value: '-' },
        { key: 'barrel_make', value: 'Not applicable' },
        { key: 'receiver_serial', value: 'MR90189D' },
      ]),
    );
    const out = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    expect(out).toEqual({
      firearm_make: 'MARLIN',
      firearm_model: 'NIL',
      frame_serial: '-',
      barrel_make: 'Not applicable',
      receiver_serial: 'MR90189D',
    });
  });

  it('⚠️ and the boundary is what turns that into nothing', async () => {
    // The other half of the same rule, pinned here so the two halves cannot
    // drift apart unnoticed: everything the reader hands back goes through
    // answerValue before it can become a proposed answer, and what is left is
    // the firearm.
    const { svc } = build(
      fields([
        { key: 'firearm_make', value: 'MARLIN' },
        { key: 'firearm_model', value: 'NIL' },
        { key: 'frame_serial', value: '-' },
        { key: 'barrel_make', value: 'Not applicable' },
        { key: 'receiver_serial', value: 'MR90189D' },
      ]),
    );
    const read = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    const asAnswers = Object.fromEntries(
      Object.entries(read)
        .map(([k, v]) => [k, answerValue(v)] as const)
        .filter(([, v]) => v),
    );
    expect(asAnswers).toEqual({
      firearm_make: 'MARLIN',
      receiver_serial: 'MR90189D',
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

  it('retries once when the first attempt reads nothing, same as extract()', async () => {
    // A licence card that plainly prints Make, Calibre, Type AND Serial Number
    // came back with only the first three live, on the one call this used to
    // make. extract()'s attemptRead already retries because a single vision
    // pass is inconsistent; this reader had no second chance at all.
    const { svc, complete } = build(fields([]));
    const reply = (f: { key: string; value: string }[]): LlmResponse => ({
      text: JSON.stringify(fields(f)),
      parts: [],
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 10 },
      model: 'test-model-2.5',
      provider: 'gemini',
      assistantMessage: { role: 'assistant', content: [] },
    });
    complete.mockResolvedValueOnce(reply([]));
    complete.mockResolvedValueOnce(
      reply([
        { key: 'firearm_make', value: 'GLOCK' },
        { key: 'firearm_calibre', value: '9MM PAR (9X19MM)' },
        { key: 'firearm_type', value: 'HANDGUN' },
        { key: 'firearm_serial', value: 'ZABA01892' },
      ]),
    );
    const out = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(out).toEqual({
      firearm_make: 'GLOCK',
      firearm_calibre: '9MM PAR (9X19MM)',
      firearm_type: 'HANDGUN',
      firearm_serial: 'ZABA01892',
    });
  });

  it('returns nothing when the AI service is not configured at all', async () => {
    const { svc, complete } = build(fields([]), undefined, false);
    await expect(
      svc.readFirearm({ bytes, mimeType: 'image/jpeg' }),
    ).resolves.toEqual({});
    expect(complete).not.toHaveBeenCalled();
  });

  it('asks for the firearm under its own purpose, with no room for reasoning', async () => {
    // The ledger reads spend per feature, so a second read on the same upload
    // has to be tellable from the first. And 800 tokens is a JSON object:
    // a thinking budget sharing it truncates the answer into nothing.
    const { svc, complete } = build(fields([{ key: 'firearm_make', value: 'CZ' }]));
    await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    const req = complete.mock.calls[0][0] as any;
    expect(req.purpose).toBe('motivation.extract.firearm');
    expect(req.thinking).toEqual({ budgetTokens: 0 });
    expect(req.messages[0].content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/jpeg',
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// ⚠️ THE "reading via Textract first" BLOCK STOOD HERE — 2026-09-08.
//
// Four cases, and their subject is gone: the operator dropped AWS Textract in
// favour of Gemini alone. What each one was protecting, and where it lives now:
//
//   "reads a real licence card off Textract and never calls Gemini" — the
//     COST argument for reading a form deterministically. Genuinely gone with
//     the reader. Its replacement is the two-attempt loop plus a
//     provider-enforced schema; see the note in readFirearm().
//
//   "never carries the holder's name, ID or the licence section across" — a
//     PRIVACY rule, and it survives untouched. It is proven end-to-end on the
//     surviving path by 'never returns anything about a person' above, which
//     feeds holder_name and id_number through the service and asserts only
//     the firearm comes back. Checked before this block was deleted; that
//     check is the reason it could be.
//
//   the two "falls through to Gemini when..." cases — there is nothing left to
//     fall through FROM. Gemini is the only reader.
//
// ⚠️ THE TEXTRACT FIXTURES IN `__fixtures__/textract` GO WITH
// textract-document-extract.spec.ts, which owns them. Nothing here reads them
// any more.
// ────────────────────────────────────────────────────────────────────

describe('the shape is the provider’s job', () => {
  it('asks for schema-enforced JSON, not prose it has to hunt through', () => {
    // ⚠️ THE REPLACEMENT FOR THE TEXTRACT PASS, in part. Textract was put
    // first because a single vision call on a real photograph is inconsistent;
    // the two-attempt loop and this schema are what carry that load now.
    const { svc, complete } = build(fields([{ key: 'firearm_make', value: 'CZ' }]));
    return svc.readFirearm({ bytes, mimeType: 'image/jpeg' }).then(() => {
      const req = complete.mock.calls[0][0] as any;
      expect(req.json?.schema).toBeDefined();
      expect(req.json.schema.properties.fields).toBeDefined();
      // The budget must be text, not reasoning — this is transcription.
      expect(req.thinking).toEqual({ budgetTokens: 0 });
    });
  });

  it('⚠️ STILL SURVIVES A FENCED ANSWER, schema or no schema', async () => {
    // A provider constraint is not a guarantee we control: a provider
    // fallback, a future model, or the Anthropic rollback path (which is more
    // permissive) can all still preface the JSON. Two lines of defence cost
    // nothing; removing the regex would cost a read.
    const { svc } = build(
      '```json\n{"fields":[{"key":"firearm_make","value":"Howa"}]}\n```',
    );
    const out = await svc.readFirearm({ bytes, mimeType: 'image/jpeg' });
    expect(out).toEqual({ firearm_make: 'Howa' });
  });
});
