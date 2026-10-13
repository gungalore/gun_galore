// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSourceBatch } from './source-batch';

// ────────────────────────────────────────────────────────────────────
// THE APPLIED-FOR FIREARM'S PAPERWORK (2026-10-13).
//
// Operator: "If its two images that the owner just sent me ... they must get
// the scanner treatment in the background ... and put onto one fucking page."
// The treatment itself is autoPolish's; this file proves the PAIRING — a front
// and a back become one page, everything else stays its own.
// ────────────────────────────────────────────────────────────────────

const autoPolish = vi.fn();
const composeSides = vi.fn();
vi.mock('./auto', () => ({
  autoPolish: (...a: unknown[]) => autoPolish(...a),
}));
vi.mock('./compose', () => ({
  composeSides: (...a: unknown[]) => composeSides(...a),
}));

const img = (name: string) =>
  new File([new Uint8Array([1])], name, { type: 'image/jpeg' });
const pdf = (name: string) =>
  new File([new Uint8Array([1])], name, { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks();
  autoPolish.mockImplementation(async (f: File) => f);
  composeSides.mockResolvedValue(
    new File([new Uint8Array([1])], 'licence-card.jpg', { type: 'image/jpeg' }),
  );
});

describe('the applied-for-firearm batch', () => {
  it('composes a front and a back onto ONE page', async () => {
    const front = img('front.jpg');
    const back = img('back.jpg');
    const out = await prepareSourceBatch(
      [front, back],
      [
        { id: 'a', side: 'front', kind: 'CURRENT_LICENCE' },
        { id: 'b', side: 'back', kind: 'CURRENT_LICENCE' },
      ],
    );
    expect(composeSides).toHaveBeenCalledTimes(1);
    expect(composeSides).toHaveBeenCalledWith(front, back);
    expect(out).toHaveLength(1);
    // The front's verdict names the composed page.
    expect(out[0].identifyId).toBe('a');
  });

  it('⚠️ composes a BACK then a FRONT, whatever order they were picked', async () => {
    // Operator hit exactly this: one attempt composed, the next did not, because
    // the pairing used to require the front to arrive first.
    const front = img('front.jpg');
    const back = img('back.jpg');
    const out = await prepareSourceBatch(
      [back, front],
      [
        { id: 'b', side: 'back', kind: 'CURRENT_LICENCE' },
        { id: 'a', side: 'front', kind: 'CURRENT_LICENCE' },
      ],
    );
    expect(composeSides).toHaveBeenCalledWith(front, back);
    expect(out).toHaveLength(1);
    expect(out[0].identifyId).toBe('a');
  });

  it('uploads a lone image as its own page', async () => {    const out = await prepareSourceBatch(
      [img('invoice.jpg')],
      [{ id: 'a', side: null, kind: 'FIREARM_SOURCE_PROOF' }],
    );
    expect(composeSides).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });

  it('⚠️ passes a PDF through untouched', async () => {
    const p = pdf('271.pdf');
    const out = await prepareSourceBatch(
      [p],
      [{ id: 'a', kind: 'FIREARM_SOURCE_PROOF' }],
    );
    expect(autoPolish).not.toHaveBeenCalled();
    expect(out[0].file).toBe(p);
  });

  it('uses the CARD shape when the verdict names a side', async () => {
    // A licence front can be classified as the catch-all source proof, whose
    // kind maps to A4 — warping a card to A4 stretches it. The side says card.
    await prepareSourceBatch(
      [img('front.jpg')],
      [{ id: 'a', side: 'front', kind: 'FIREARM_SOURCE_PROOF' }],
    );
    expect(autoPolish).toHaveBeenCalledWith(expect.any(File), 'card', undefined);
  });

  it('⚠️ keeps BOTH pages when the two sides cannot be composed', async () => {
    composeSides.mockRejectedValueOnce(new Error('no canvas'));
    const out = await prepareSourceBatch(
      [img('f.jpg'), img('b.jpg')],
      [
        { id: 'a', side: 'front' },
        { id: 'b', side: 'back' },
      ],
    );
    expect(out).toHaveLength(2);
  });

  it('carries the verdict rotation into the polish', async () => {
    await prepareSourceBatch(
      [img('x.jpg')],
      [{ id: 'a', kind: 'FIREARM_SOURCE_PROOF', rotate: 270 }],
    );
    expect(autoPolish).toHaveBeenCalledWith(expect.any(File), 'a4', 270);
  });
});
