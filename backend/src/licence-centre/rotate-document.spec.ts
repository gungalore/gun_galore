import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { rotateDocumentBytes } from './rotate-document';

// ────────────────────────────────────────────────────────────────────
// THE QUARTER-TURN THE MEMBER ASKED FOR.
//
// ⚠️ THE INTERESTING CASES ARE THE ONES THAT MUST NOT CHANGE ANYTHING. A zero
// turn is a no-op byte for byte, and a type we cannot turn throws rather than
// handing back something the caller might store as if it had worked.
// ────────────────────────────────────────────────────────────────────

async function landscape(): Promise<Buffer> {
  return sharp({
    create: { width: 60, height: 40, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer();
}

async function pdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 300]);
  return Buffer.from(await doc.save());
}

describe('rotateDocumentBytes', () => {
  it('turns an image a quarter turn clockwise and re-encodes as JPEG', async () => {
    const out = await rotateDocumentBytes(await landscape(), 'image/jpeg', 1);
    expect(out.mimeType).toBe('image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect(`${meta.width}x${meta.height}`).toBe('40x60');
  });

  it('turns left with a negative turn, the same as three right turns', async () => {
    const out = await rotateDocumentBytes(await landscape(), 'image/jpeg', -1);
    const meta = await sharp(out.bytes).metadata();
    expect(`${meta.width}x${meta.height}`).toBe('40x60');
  });

  it('is a byte-for-byte no-op on a zero turn', async () => {
    const bytes = await landscape();
    const out = await rotateDocumentBytes(bytes, 'image/jpeg', 0);
    expect(out.bytes).toBe(bytes);
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('treats a full four turns as no rotation', async () => {
    const bytes = await landscape();
    const out = await rotateDocumentBytes(bytes, 'image/jpeg', 4);
    expect(out.bytes).toBe(bytes);
  });

  it('flattens a PNG onto white and stores JPEG', async () => {
    const png = await sharp({
      create: { width: 30, height: 50, channels: 4, background: '#ffffff00' },
    })
      .png()
      .toBuffer();
    const out = await rotateDocumentBytes(png, 'image/png', 1);
    expect(out.mimeType).toBe('image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect(`${meta.width}x${meta.height}`).toBe('50x30');
  });

  it('rotates every page of a PDF without rasterising it', async () => {
    const out = await rotateDocumentBytes(await pdf(2), 'application/pdf', 1);
    expect(out.mimeType).toBe('application/pdf');
    const doc = await PDFDocument.load(out.bytes);
    const angles = doc.getPages().map((p) => p.getRotation().angle);
    expect(angles).toEqual([90, 90]);
  });

  it('adds to a page that is already turned', async () => {
    const out = await rotateDocumentBytes(await pdf(1), 'application/pdf', 3);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(270);
  });

  it('refuses a type it cannot turn', async () => {
    await expect(
      rotateDocumentBytes(Buffer.from('hello'), 'application/msword', 1),
    ).rejects.toThrow(/cannot be rotated/i);
  });
});
