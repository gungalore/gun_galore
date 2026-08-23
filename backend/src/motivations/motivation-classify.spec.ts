import { MotivationUploadKind } from '@prisma/client';
import { MotivationExtractService } from './motivation-extract.service';
import { RETIRED } from './motivation-documents';

// Sorting a pack of documents automatically is only safe because of what the
// classifier REFUSES to do. The required-documents list counts the TYPE of an
// upload, not its contents — so a confident wrong answer here shows a
// requirement satisfied while the pack is actually missing it.

const client = (reply: string | Error) => ({
  messages: {
    create: jest.fn().mockImplementation(() => {
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({ content: [{ type: 'text', text: reply }] });
    }),
  },
});

function svcWith(reply: string | Error): MotivationExtractService {
  const svc = new MotivationExtractService();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).client = client(reply);
  return svc;
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

  it('does nothing at all without an API key', async () => {
    const svc = new MotivationExtractService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).client = null;
    await expect(svc.classify(png)).resolves.toBeNull();
  });

  it('sends no sampling parameters', async () => {
    // The guard in common/claude-request-params.spec.ts covers the source;
    // this covers the call actually made.
    const svc = svcWith('{"kind":"OTHER","confidence":"low"}');
    await svc.classify(png);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = ((svc as any).client.messages.create as jest.Mock).mock
      .calls[0][0];
    for (const p of ['temperature', 'top_p', 'top_k']) {
      expect(body[p]).toBeUndefined();
    }
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
