import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { MotivationExtractService } from './motivation-extract.service';
import type { LlmResponse } from '../common/llm/llm.types';

/**
 * The read cache is not under test here: every lookup misses and every store
 * is dropped, so these specs exercise the reader exactly as they did before it
 * existed.
 */
const noReadCache = () =>
  ({
    key: () => 'test-key',
    get: async () => null,
    put: async () => undefined,
  }) as never;


// This reads someone's identity document and proposes what goes on a form they
// sign. So the tests are about what it REFUSES to do: invent a field, trust a
// digit it misread, or touch anything about their criminal record.

const T = MotivationLicenceType.S13_SELF_DEFENCE;
const MODEL = 'test-model-2.5';

/** One answer in the shape of the shared LLM contract. */
function llmReply(text: string): LlmResponse {
  return {
    text,
    parts: [{ type: 'text', text }],
    toolCalls: [],
    stopReason: 'end',
    usage: { inputTokens: 10, outputTokens: 10 },
    model: MODEL,
    provider: 'gemini',
    assistantMessage: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function build(reply: unknown, throws?: Error, configured = true) {
  const complete = jest.fn(async (_req?: any): Promise<LlmResponse> => {
    if (throws) throw throws;
    return llmReply(typeof reply === 'string' ? reply : JSON.stringify(reply));
  });
  const llm = {
    complete,
    stream: jest.fn(),
    isConfigured: () => configured,
    model: MODEL,
    provider: 'gemini' as const,
  };
  const svc = new MotivationExtractService(llm as never, noReadCache());
  (svc as unknown as { logger: unknown }).logger = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  };
  return { svc, complete };
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

describe('⚠️ READING THE SAME DOCUMENT TWICE', () => {
  // Operator, 2026-09-10: "every thing we generate that can be reused we
  // store in a database ... so it costs money and effort one time and never
  // again." The AiUsage ledger showed the same ten licences and four
  // proficiencies read SIX TIMES over three days against the same stored
  // files, because every pick of a vault document into a pack re-reads the
  // bytes. This is the test that the second read is free.

  /** A cache that actually remembers, unlike the no-op the other tests use. */
  function realish() {
    const store = new Map<string, unknown>();
    return {
      store,
      key: (a: { fileSha256: string; kind: string; licenceType: string; askedKeys: readonly string[] }) =>
        [a.fileSha256, a.kind, a.licenceType, [...a.askedKeys].sort().join(',')].join('|'),
      get: async (k: string) => (store.get(k) as never) ?? null,
      put: async (a: { cacheKey: string; fields: unknown[] }) => {
        if (a.fields.length) store.set(a.cacheKey, a.fields);
      },
    };
  }

  const reply = JSON.stringify({
    fields: [
      { key: 'full_name', value: 'Jan Pieter van der Merwe', confidence: 'high' },
      { key: 'id_number', value: '8001015009087', confidence: 'high' },
    ],
  });

  function withCache() {
    const complete = jest.fn(async (): Promise<LlmResponse> => llmReply(reply));
    const llm = {
      complete,
      stream: jest.fn(),
      isConfigured: () => true,
      model: MODEL,
      provider: 'gemini' as const,
    };
    const cache = realish();
    const svc = new MotivationExtractService(llm as never, cache as never);
    (svc as unknown as { logger: unknown }).logger = {
      warn: jest.fn(), error: jest.fn(), log: jest.fn(),
    };
    return { svc, complete, cache };
  }

  it('⚠️ COSTS ONE MODEL CALL, NOT TWO', async () => {
    const { svc, complete } = withCache();
    const first = await run(svc);
    const second = await run(svc);

    expect(first.length).toBeGreaterThan(0);
    // The same answer, and only one call paid for.
    expect(second).toEqual(first);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('⚠️ AND DIFFERENT BYTES STILL COST A CALL', async () => {
    // Content-addressed: a genuinely new photograph is genuinely new work.
    // If this ever passes on one call, the key has stopped reading the bytes.
    const { svc, complete } = withCache();
    await svc.extract({
      kind: MotivationUploadKind.IDENTITY_DOCUMENT,
      licenceType: T,
      bytes: Buffer.from('one photograph'),
      mimeType: 'image/jpeg',
    });
    await svc.extract({
      kind: MotivationUploadKind.IDENTITY_DOCUMENT,
      licenceType: T,
      bytes: Buffer.from('a different photograph'),
      mimeType: 'image/jpeg',
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('⚠️ AND A FAILED READ IS NOT REMEMBERED AS AN EMPTY ONE', async () => {
    // The extractor returns [] for a model outage and for a blank document
    // alike. Caching the first as the second would make a marginal document
    // permanently unreadable — so nothing is stored, and the next attempt
    // pays and succeeds.
    const store = new Map<string, unknown>();
    let fail = true;
    const complete = jest.fn(async (): Promise<LlmResponse> => {
      if (fail) throw new Error('provider down');
      return llmReply(reply);
    });
    const cache = {
      key: () => 'same-key',
      get: async () => (store.get('same-key') as never) ?? null,
      put: async (a: { fields: unknown[] }) => {
        if (a.fields.length) store.set('same-key', a.fields);
      },
    };
    const svc = new MotivationExtractService(
      { complete, stream: jest.fn(), isConfigured: () => true, model: MODEL, provider: 'gemini' as const } as never,
      cache as never,
    );
    (svc as unknown as { logger: unknown }).logger = {
      warn: jest.fn(), error: jest.fn(), log: jest.fn(),
    };

    await expect(run(svc)).resolves.toEqual([]);
    expect(store.size).toBe(0);

    fail = false;
    await expect(run(svc)).resolves.not.toEqual([]);
  });
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
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
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

  it('⚠️ KEEPS A CARD PLACEHOLDER, BECAUSE THE FORM WANTS IT', async () => {
    // ⚠️ THIS TEST WAS THE OPPOSITE UNTIL 2026-09-08, AND THE HISTORY MATTERS.
    //
    // It read "refuses a card placeholder as an answer, however faithfully it
    // was read", on the reasoning that "Firearm 6 — frame serial NONE · barrel
    // serial NONE" was a false statement on a SAPS 271. The operator, who takes
    // these packs to a DFO, ruled the other way: the card itself prints NONE in
    // a row that does not apply, so copying it is reproducing the document, and
    // an empty box does not say the same thing as a box reading NONE.
    //
    // Operator, 2026-09-08: "instruct gemini to read a NONE as NONE and not
    // leave it out. All those fields needs to be captured on a license card and
    // filled in on the form, especially on the 271 that requires it."
    //
    // The strip did not disappear — it MOVED, to the prose boundary in
    // renderFacts (motivation-prompts.ts). The writer must never see NONE; the
    // form must always see it. Before flipping this back, read that note and
    // ownedFirearmSerial(), which still falls THROUGH a NONE row on purpose
    // because a frame row reading NONE is not the firearm's serial number.
    const { svc } = build({
      fields: [
        { key: 'existing_firearm_1_make', value: 'MARLIN', confidence: 'high' },
        { key: 'existing_firearm_1_serial', value: 'NONE', confidence: 'high' },
        { key: 'existing_firearm_1_model', value: 'N/A', confidence: 'high' },
      ],
    });
    const out = await run(svc, MotivationUploadKind.CURRENT_LICENCE);
    expect(out.map((f) => f.key)).toEqual([
      'existing_firearm_1_make',
      'existing_firearm_1_serial',
      'existing_firearm_1_model',
    ]);
    expect(out.find((f) => f.key === 'existing_firearm_1_serial')?.value).toBe(
      'NONE',
    );
  });

  it('⚠️ STILL DROPS A GENUINELY EMPTY READ, which means something else', async () => {
    // NONE is the card saying "there is nothing here". Empty is US saying "we
    // could not make it out". licence-card-ocr.service.ts is told never to
    // substitute one for the other, and this is the half of that promise this
    // boundary owns.
    const { svc } = build({
      fields: [
        { key: 'existing_firearm_1_make', value: 'MARLIN', confidence: 'high' },
        { key: 'existing_firearm_1_serial', value: '   ', confidence: 'high' },
      ],
    });
    const out = await run(svc, MotivationUploadKind.CURRENT_LICENCE);
    expect(out.map((f) => f.key)).toEqual(['existing_firearm_1_make']);
  });

  it('⚠️ refuses a date that is not a date, rather than putting it in a date box', async () => {
    // ⚠️ RULE 4 OF THE PROMPT ASKS FOR YYYY-MM-DD AND A CARD DOES NOT PRINT IT
    // THAT WAY. A licence prints "2027/06/30" or "30 JUN 2027", and a
    // transcriber doing exactly as it is told hands one of those straight back.
    // `existing_firearm_N_expiry` is `kind: 'date'` and renders in a date
    // input, so a value that is not an ISO day is one the wizard cannot show
    // and the member cannot correct without first noticing it is wrong — the
    // same failure the vault side closed with DATE_DETAILS.
    //
    // Dropped, never coerced: 06/07 is two different days depending on which
    // side of the Atlantic printed the card, and picking one is inventing the
    // fact.
    const { svc } = build({
      fields: [
        { key: 'existing_firearm_1_make', value: 'MARLIN', confidence: 'high' },
        { key: 'existing_firearm_1_expiry', value: '2027/06/30', confidence: 'high' },
      ],
    });
    const out = await run(svc, MotivationUploadKind.CURRENT_LICENCE);
    expect(out.map((f) => f.key)).toEqual(['existing_firearm_1_make']);
  });

  it('⚠️ rejects an ISO-shaped day that does not exist', async () => {
    const { svc } = build({
      fields: [
        { key: 'existing_firearm_1_expiry', value: '2026-02-31', confidence: 'high' },
      ],
    });
    expect(await run(svc, MotivationUploadKind.CURRENT_LICENCE)).toEqual([]);
  });

  it('keeps a real ISO day', async () => {
    const { svc } = build({
      fields: [
        { key: 'existing_firearm_1_expiry', value: '2031-05-05', confidence: 'high' },
      ],
    });
    const out = await run(svc, MotivationUploadKind.CURRENT_LICENCE);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('2031-05-05');
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

describe('⚠️ what a licence photograph is asked for', () => {
  // ⚠️ THE FORM PROMISES THESE BOXES ARE FILLED FROM THE DOCUMENT. Every column
  // of an owned-firearm row except "what you use it for" is declared
  // `docSourced: 'CURRENT_LICENCE'` in the registry, which the wizard reads as
  // "a document answers this, stop asking" and read-result renders as "Not on
  // the document" against an empty one. A key the reader never asks for can
  // never fill, so the promise has to be kept here or withdrawn there.
  it('asks for the ONE serial, not the two retired keys', async () => {
    // ⚠️ THE TWO SERIAL BOXES COLLAPSED INTO ONE ON 2026-09-07 and this list
    // was not followed. sanitiseAnswers still ACCEPTS the retired keys, so
    // nothing failed and nothing said anything: the member was told we had read
    // their licence and the serial landed in a box no screen renders.
    const { svc, complete } = build({ fields: [] });
    await run(svc, MotivationUploadKind.CURRENT_LICENCE);
    const prompt = (complete.mock.calls[0][0] as any).messages[0].content
      .map((p: any) => p.text ?? '')
      .join(' ');
    expect(prompt).toContain('existing_firearm_1_serial');
    expect(prompt).not.toContain('existing_firearm_1_barrel_serial');
    expect(prompt).not.toContain('existing_firearm_1_frame_serial');
  });

  it('asks for the model and the expiry the form says it reads', async () => {
    // The operator was told the model box would stay empty until we asked for
    // it. A licence card prints both — their own reads "Model NONE", which is
    // the card saying this firearm has no model designation, and every card
    // carries a valid-until date.
    const { svc, complete } = build({ fields: [] });
    await run(svc, MotivationUploadKind.CURRENT_LICENCE);
    const prompt = (complete.mock.calls[0][0] as any).messages[0].content
      .map((p: any) => p.text ?? '')
      .join(' ');
    expect(prompt).toContain('existing_firearm_1_model');
    expect(prompt).toContain('existing_firearm_1_expiry');
  });

  it('writes into the first FREE row, by any column', async () => {
    // ⚠️ NOT BY THE CALIBRE. See nextOwnedSlot: a row holding a make and a
    // serial is in use, and proposing over it produces a form describing a
    // firearm that does not exist.
    const { svc, complete } = build({ fields: [] });
    await svc.extract({
      kind: MotivationUploadKind.CURRENT_LICENCE,
      licenceType: T,
      bytes: Buffer.from('x'),
      mimeType: 'image/jpeg',
      answers: {
        existing_firearm_1_make: 'Marlin',
        existing_firearm_1_serial: 'MR90189D',
      },
    });
    const prompt = (complete.mock.calls[0][0] as any).messages[0].content
      .map((p: any) => p.text ?? '')
      .join(' ');
    expect(prompt).toContain('existing_firearm_2_serial');
    expect(prompt).not.toContain('existing_firearm_1_serial');
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

  it('returns nothing when the AI service is not configured at all', async () => {
    const { svc, complete } = build({ fields: [] }, undefined, false);
    expect(await run(svc)).toEqual([]);
    // Answered in code, never by a request that will fail on the wire.
    expect(complete).not.toHaveBeenCalled();
  });

  it('sends NO sampling parameters', async () => {
    // This test used to assert `temperature: 0`, and that assertion is what
    // made the outage look fine from in here.
    //
    // temperature / top_p / top_k were removed from the Anthropic API on the
    // models this service ran on. Every call 400'd with "`temperature` is
    // deprecated for this model", the fail-soft catch swallowed it, and
    // extraction silently returned nothing for two days while the suite
    // stayed green.
    //
    // ⚠️ THE PARAMETER EXISTS AGAIN on the neutral contract, so leaving it
    // unset is a decision now rather than a workaround — and the decision is
    // recorded at the call site, along with what to do if a transcriber
    // starts giving different digits for the same photograph.
    const { svc, complete } = build({ fields: [] });
    await run(svc);
    const req = complete.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(req).toBeDefined();
    for (const param of ['temperature', 'top_p', 'top_k']) {
      expect(req[param]).toBeUndefined();
    }
  });

  it('spends its ceiling on the transcription, not on reasoning', async () => {
    // ⚠️ 1200 TOKENS IS A JSON OBJECT OF FIELDS. A thinking budget shares that
    // ceiling, and a truncated object parses to nothing — which reads exactly
    // like "we could not read anything on this document". The writer lost a
    // live document to that failure; this is the same trap, one file over.
    const { svc, complete } = build({ fields: [] });
    await run(svc);
    const req = complete.mock.calls[0][0] as any;
    expect(req.thinking).toEqual({ budgetTokens: 0 });
    expect(req.maxTokens).toBe(1200);
    // Spend is read per feature off the ledger, so every call says what it is
    // for — and this one says which KIND of document it was reading.
    expect(req.purpose).toBe('motivation.extract.identity_document');
  });

  it('sends the page as an image part, base64, with its type', async () => {
    // The SDK's nested `{ source: { type: 'base64', media_type } }` block is
    // gone; the contract takes the bytes and the type flat. A part the adapter
    // cannot read fails the whole read, silently, on the fail-soft catch.
    const { svc, complete } = build({ fields: [] });
    await run(svc);
    const req = complete.mock.calls[0][0] as any;
    const part = req.messages[0].content[0];
    expect(part.type).toBe('image');
    expect(part.mimeType).toBe('image/jpeg');
    expect(typeof part.data).toBe('string');
  });
});
