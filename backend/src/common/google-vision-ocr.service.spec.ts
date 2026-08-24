import { GoogleVisionOcrService } from './google-vision-ocr.service';

// ────────────────────────────────────────────────────────────────────
// VISION MUST NEVER BE ABLE TO BREAK A DOCUMENT READ.
//
// Operator, 2026-08-24: "All documents must go through Google vision that
// needs OCR" — and Vision's text ADDED alongside the image, not replacing it.
//
// ⚠️ THE PRODUCTION KEY IS IP-RESTRICTED TO THE LIVE BOX. It 403s from every
// developer machine and every CI run BY DESIGN, and it is absent from local
// env files entirely. So the failure path is not an edge case here — it is the
// ONLY path that runs anywhere except production, and every one of these must
// return null so the caller carries on with the image alone.
// ────────────────────────────────────────────────────────────────────

const ORIGINAL = process.env.GOOGLE_VISION_API_KEY;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GOOGLE_VISION_API_KEY;
  else process.env.GOOGLE_VISION_API_KEY = ORIGINAL;
  jest.restoreAllMocks();
});

const withKey = () => {
  process.env.GOOGLE_VISION_API_KEY = 'test-key';
  return new GoogleVisionOcrService();
};
const bytes = Buffer.from('not-really-an-image');

describe('every failure returns null rather than throwing', () => {
  it('no key at all — the local and CI case', () => {
    delete process.env.GOOGLE_VISION_API_KEY;
    const svc = new GoogleVisionOcrService();
    expect(svc.available).toBe(false);
    return expect(svc.text(bytes)).resolves.toBeNull();
  });

  it('⚠️ a 403 from the IP allowlist — what every non-prod run gets', async () => {
    const svc = withKey();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 403 } as Response);
    await expect(svc.text(bytes)).resolves.toBeNull();
  });

  it('a network failure or timeout', async () => {
    const svc = withKey();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('aborted'));
    await expect(svc.text(bytes)).resolves.toBeNull();
  });

  it('an error inside a 200 body', async () => {
    const svc = withKey();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ responses: [{ error: { message: 'bad image' } }] }),
    } as Response);
    await expect(svc.text(bytes)).resolves.toBeNull();
  });

  it('an unparseable body', async () => {
    const svc = withKey();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(svc.text(bytes)).resolves.toBeNull();
  });

  it('an image with no text on it', async () => {
    const svc = withKey();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ responses: [{ fullTextAnnotation: { text: '   ' } }] }),
    } as Response);
    await expect(svc.text(bytes)).resolves.toBeNull();
  });

  it('empty bytes, without spending a call', async () => {
    const svc = withKey();
    const f = jest.spyOn(global, 'fetch');
    await expect(svc.text(Buffer.alloc(0))).resolves.toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('what it returns when Google does answer', () => {
  it('prefers fullTextAnnotation, which keeps the line breaks', async () => {
    const svc = withKey();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        responses: [{ fullTextAnnotation: { text: 'LINE ONE\nLINE TWO' } }],
      }),
    } as Response);
    await expect(svc.text(bytes)).resolves.toBe('LINE ONE\nLINE TWO');
  });

  it('falls back to the older textAnnotations shape', async () => {
    const svc = withKey();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        responses: [{ textAnnotations: [{ description: 'OLD SHAPE' }] }],
      }),
    } as Response);
    await expect(svc.text(bytes)).resolves.toBe('OLD SHAPE');
  });

  it('⚠️ caps a runaway read rather than padding the prompt with it', async () => {
    const svc = withKey();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        responses: [{ fullTextAnnotation: { text: 'x'.repeat(50_000) } }],
      }),
    } as Response);
    const out = await svc.text(bytes);
    expect(out).not.toBeNull();
    expect((out as string).length).toBeLessThanOrEqual(12_000);
  });
});
