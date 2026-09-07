import { MotivationUploadKind } from '@prisma/client';
import { MotivationExtractService } from './motivation-extract.service';
import { RETIRED } from './motivation-documents';
import type { LlmResponse } from '../common/llm/llm.types';

// Sorting a pack of documents automatically is only safe because of what the
// classifier REFUSES to do. The required-documents list counts the TYPE of an
// upload, not its contents — so a confident wrong answer here shows a
// requirement satisfied while the pack is actually missing it.

/** A fake of the shared LLM adapter — one answer, or one failure. */
const fakeLlm = (reply: string | Error, configured = true) => ({
  complete: jest.fn().mockImplementation((): Promise<LlmResponse> => {
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve({
      text: reply,
      parts: [{ type: 'text', text: reply }],
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 10 },
      model: 'test-model-2.5',
      provider: 'gemini',
      assistantMessage: { role: 'assistant', content: reply },
    } as LlmResponse);
  }),
  stream: jest.fn(),
  isConfigured: () => configured,
  model: 'test-model-2.5',
  provider: 'gemini' as const,
});

function svcWith(reply: string | Error): MotivationExtractService {
  return new MotivationExtractService(fakeLlm(reply) as never);
}

const png = { bytes: Buffer.from('x'), mimeType: 'image/png' };

describe('naming a document from its contents', () => {
  it('returns the kind it read, with its confidence', async () => {
    const svc = svcWith('{"kind":"ADDRESS_CONFIRMATION","confidence":"high"}');
    await expect(svc.classify(png)).resolves.toEqual({
      kind: 'ADDRESS_CONFIRMATION',
      confident: true,
    });
  });

  it('passes low confidence through rather than hiding it', async () => {
    // The wizard puts a "not sure" marker on these, which is the whole point:
    // the member's eye is the check on ours.
    const svc = svcWith('{"kind":"INCIDENT_REPORT","confidence":"low"}');
    await expect(svc.classify(png)).resolves.toEqual({
      kind: 'INCIDENT_REPORT',
      confident: false,
    });
  });

  it('refuses a kind that is not on the list', async () => {
    // A model that invents a category, or is talked into one by text on the
    // page, must not be able to write it into the database.
    const svc = svcWith('{"kind":"DROP TABLE","confidence":"high"}');
    await expect(svc.classify(png)).resolves.toBeNull();
  });

  it('never files anything as a RETIRED kind', async () => {
    // ⚠️ RETIRED NOW HOLDS ALL FIVE SAFE KINDS. The model has seen
    // SAFE_PHOTO_CLOSED and friends in every previous version of this prompt,
    // and a document filed under one of them sits outside the only kind the
    // checklist looks for — invisible to the member and to the requirement
    // engine both.
    for (const retired of RETIRED) {
      const svc = svcWith(`{"kind":"${retired}","confidence":"high"}`);
      await expect(svc.classify(png)).resolves.toBeNull();
    }
  });

  it('returns null on unparseable output', async () => {
    for (const junk of ['', 'I think this is an ID document', '{oops']) {
      await expect(svcWith(junk).classify(png)).resolves.toBeNull();
    }
  });

  it('fails soft when the model call throws', async () => {
    // Same posture as every other model call in this module: an unsorted
    // document is a small inconvenience, a failed upload is not.
    const svc = svcWith(new Error('503 overloaded'));
    await expect(svc.classify(png)).resolves.toBeNull();
  });

  it('does nothing at all when the AI service is not configured', async () => {
    const llm = fakeLlm('{"kind":"OTHER","confidence":"low"}', false);
    const svc = new MotivationExtractService(llm as never);
    await expect(svc.classify(png)).resolves.toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('sends no sampling parameters, and no budget for reasoning', async () => {
    // ⚠️ 200 TOKENS IS THE TIGHTEST CEILING IN THE FILE — one small JSON
    // object. A thinking budget sharing it truncates the answer, which parses
    // to null, which files the document as "something else": a silent
    // regression that looks exactly like a model which could not tell.
    const llm = fakeLlm('{"kind":"OTHER","confidence":"low"}');
    const svc = new MotivationExtractService(llm as never);
    await svc.classify(png);
    const req = llm.complete.mock.calls[0][0];
    for (const p of ['temperature', 'top_p', 'top_k']) {
      expect(req[p]).toBeUndefined();
    }
    expect(req.thinking).toEqual({ budgetTokens: 0 });
    expect(req.purpose).toBe('motivation.classify');
  });

  it('files every photograph of the safe under the one safe kind', async () => {
    // ⚠️ IT USED TO OFFER FOUR, and telling them apart means judging how far
    // a door is open from a single frame. A wrong call filed the bolts shot
    // under the closed-door annexure, so a DFO looking for proof the bolts
    // engage was shown a photograph of a shut door. One kind makes that
    // impossible rather than merely flagged.
    const svc = svcWith('{"kind":"SAFE_PHOTOGRAPHS","confidence":"high"}');
    await expect(svc.classify(png)).resolves.toEqual({
      kind: 'SAFE_PHOTOGRAPHS' as MotivationUploadKind,
      confident: true,
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// READING THE PAGE ONCE.
//
// ⚠️ THE SAME IMAGE WAS GOING TO GOOGLE TWICE ON EVERY AUTO-FILED UPLOAD.
// classify() read the bytes looking for a marker and extract() read them again
// for the model — two billed calls returning the identical string, both
// discarded when the request ended. The caller now reads once and hands the
// text to both, which is also what makes it storable.
//
// The distinction the whole thing turns on is undefined vs null: "nobody has
// read this yet, read it" against "somebody read it and there was nothing".
// Defaulting the parameter would collapse the two and quietly restore the
// second call.
// ────────────────────────────────────────────────────────────────────

describe('reading the page once', () => {
  const withVision = (text: string | null) => {
    const vision = { text: jest.fn().mockResolvedValue(text) };
    const svc = new MotivationExtractService(
      fakeLlm('{"kind":"OTHER","confidence":"low"}') as never,
      vision as never,
    );
    return { svc, vision };
  };

  it('reads the bytes when nobody has read them yet', async () => {
    const { svc, vision } = withVision('SAPS 524 COMPETENCY CERTIFICATE');
    await expect(svc.classify(png)).resolves.toEqual({
      kind: 'COMPETENCY_CERTIFICATE',
      confident: true,
    });
    expect(vision.text).toHaveBeenCalledTimes(1);
  });

  it('⚠️ DOES NOT READ THEM AGAIN WHEN GIVEN THE TEXT', async () => {
    const { svc, vision } = withVision('SAPS 524 COMPETENCY CERTIFICATE');
    await expect(
      svc.classify({ ...png, ocrText: 'SAPS 524 COMPETENCY CERTIFICATE' }),
    ).resolves.toEqual({ kind: 'COMPETENCY_CERTIFICATE', confident: true });
    // Not "called with the right thing" — not called AT ALL. That is the
    // saving, and it is invisible in the return value.
    expect(vision.text).not.toHaveBeenCalled();
  });

  it('⚠️ TREATS null AS ALREADY-READ, NOT AS NOT-READ', async () => {
    // A page Vision could not read is still a page that has been read. Taking
    // null as "go and read it" would put the second call straight back for
    // exactly the documents that cost the most attempts.
    const { svc, vision } = withVision('SAPS 524 COMPETENCY CERTIFICATE');
    await svc.classify({ ...png, ocrText: null });
    expect(vision.text).not.toHaveBeenCalled();
  });

  it('hands a PDF to the model without pretending to OCR it', async () => {
    // Vision's images:annotate takes images. A PDF has no marker pass at all
    // — it goes to the model, which is the honest outcome rather than a
    // silent empty read.
    const { svc, vision } = withVision('SAPS 524');
    await svc.ocr(Buffer.from('%PDF'), 'application/pdf');
    expect(vision.text).not.toHaveBeenCalled();
  });

  it('survives a Vision outage without failing the upload', async () => {
    const vision = { text: jest.fn().mockRejectedValue(new Error('403')) };
    const svc = new MotivationExtractService(
      fakeLlm('{"kind":"OTHER","confidence":"low"}') as never,
      vision as never,
    );
    await expect(svc.ocr(Buffer.from('x'), 'image/png')).resolves.toBeNull();
  });
});
