import {
  asCoverChoice,
  checkCoverPhoto,
  COVER_ASPECT,
  COVER_FRAME_MM,
  COVER_MAX_BYTES,
  COVER_MAX_PX,
} from './motivation-cover-photo';

/** A minimal but real PNG header: signature + IHDR with a stated size. */
function png(width: number, height: number, pad = 8000): Buffer {
  const head = Buffer.alloc(24);
  head.writeUInt32BE(0x89504e47, 0);
  head.writeUInt32BE(0x0d0a1a0a, 4);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(pad)]);
}

describe('asCoverChoice', () => {
  it('accepts the three real states', () => {
    expect(asCoverChoice('STOCK')).toBe('STOCK');
    expect(asCoverChoice('OWN')).toBe('OWN');
    expect(asCoverChoice('NONE')).toBe('NONE');
  });

  it('refuses anything else', () => {
    // ⚠️ THE COLUMN IS A VarChar. An unrecognised string stored unchecked
    // would fall through every comparison at render time — a cover that
    // quietly reverts to the stock photograph after somebody chose to have
    // none. Validate on the way in, once.
    for (const bad of ['', 'stock', 'none', 'AUTO', 'null', null, 7, {}]) {
      expect(asCoverChoice(bad)).toBeNull();
    }
  });

  it('keeps "not asked" distinct from "no thank you"', () => {
    // null on the row means nobody has been shown a photograph yet, and the
    // next render may use one we find. 'NONE' means they looked and said no,
    // and nothing we find later may overrule it. Collapsing the two would
    // silently put a firearm on the cover of somebody who asked for none.
    expect(asCoverChoice(null)).toBeNull();
    expect(asCoverChoice('NONE')).toBe('NONE');
  });
});

describe('checkCoverPhoto', () => {
  it('accepts a reasonable JPEG or PNG', () => {
    expect(checkCoverPhoto(png(1200, 890), 'image/png').ok).toBe(true);
  });

  it('refuses what pdfkit cannot embed', () => {
    // ⚠️ REFUSED HERE, WHERE THERE IS SOMEBODY TO TELL. pdfkit throws on
    // anything it cannot parse, and that throw would land in the DOWNLOAD
    // path — long after the upload the applicant would blame for it.
    for (const mime of ['image/webp', 'image/heic', 'application/pdf', 'image/gif']) {
      const r = checkCoverPhoto(png(1200, 890), mime);
      expect(r.ok).toBe(false);
      expect(r.problem).toMatch(/JPEG or PNG/i);
    }
  });

  it('does not trust the declared mime type', () => {
    // The mime on a multipart upload is whatever the client wrote in the
    // header. A renamed HEIC arrives claiming to be a JPEG; the bytes decide.
    const notAnImage = Buffer.from('this is not an image, it is a sentence');
    const r = checkCoverPhoto(notAnImage, 'image/jpeg');
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/could not read/i);
  });

  it('refuses a thumbnail that would print as a blur', () => {
    const r = checkCoverPhoto(png(180, 133), 'image/png');
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/too small/i);
  });

  it('refuses a file past the ceiling', () => {
    const huge = png(1200, 890, COVER_MAX_BYTES + 1000);
    expect(checkCoverPhoto(huge, 'image/png').ok).toBe(false);
  });

  it('phrases every refusal as something the applicant can act on', () => {
    // A cover photograph is decoration. Being told "invalid file" about it,
    // on a page otherwise about a firearm licence, is worse than useless —
    // every message has to say what to do instead.
    const refusals = [
      checkCoverPhoto(png(1200, 890), 'image/webp'),
      checkCoverPhoto(Buffer.from('nope'), 'image/jpeg'),
      checkCoverPhoto(png(180, 133), 'image/png'),
    ];
    for (const r of refusals) {
      expect(r.ok).toBe(false);
      expect(r.problem).toMatch(/please|try/i);
    }
  });
});

describe('the frame', () => {
  it('derives its aspect from the millimetres the cover actually draws', () => {
    // One number, not two that drift: the browser's trim box locks to this
    // ratio, so what somebody frames on screen is what prints.
    expect(COVER_ASPECT).toBeCloseTo(COVER_FRAME_MM.w / COVER_FRAME_MM.h, 6);
  });

  it('is landscape, because the subject is usually a firearm', () => {
    // ⚠️ NOT 4:3. A rifle is long and thin.
    expect(COVER_ASPECT).toBeGreaterThan(1.7);
    // ⚠️ AND NOT A SLOT, EITHER. The frame no longer crops — it fits — so the
    // ratio decides how LARGE each shape prints rather than whether it
    // survives. Past roughly 2.5 an upright photograph is starved: at 3:1 a
    // portrait would print 61 mm tall on a 182 mm page. The first attempt at
    // widening this used 182 x 68 (2.68) and was a WIDER letterbox than the
    // 86 x 44 it replaced, which would have made upright photographs smaller
    // while appearing to fix the operator's complaint.
    expect(COVER_ASPECT).toBeLessThan(2.5);
  });

  it('⚠️ leaves every common shape room to print whole', () => {
    // The operator's complaint was a rifle cut off at both ends. These are the
    // shapes that actually arrive — a phone photograph, a stock image off
    // Commons, an upright snap of a handgun on a bench — and none of them may
    // be starved by the frame they are fitted into.
    const { w, h } = COVER_FRAME_MM;
    for (const [name, ratio] of [
      ['panorama', 3],
      ['16:9', 16 / 9],
      ['3:2', 1.5],
      ['square', 1],
      ['upright 3:4', 0.75],
    ] as const) {
      const drawnW = Math.min(w, h * ratio);
      const drawnH = drawnW / ratio;
      // Nothing is cropped: it fits inside the box on both axes.
      expect(drawnW).toBeLessThanOrEqual(w + 0.001);
      expect(drawnH).toBeLessThanOrEqual(h + 0.001);
      // And it is big enough to be worth printing — a sixth of the page's
      // width at minimum, whatever its shape.
      expect(drawnW).toBeGreaterThan(35);
      void name;
    }
  });

  it('sizes the pixel ceiling to the frame it fills', () => {
    // The ceiling exists because pdfkit embeds JPEG bytes verbatim. It has to
    // track the frame's shape, or the stored file is taller or shorter than
    // the box and the server trims what the applicant thought they kept.
    expect(COVER_MAX_PX.w / COVER_MAX_PX.h).toBeCloseTo(COVER_ASPECT, 1);
  });

  it('still prints past what an office printer resolves', () => {
    // ⚠️ THIS TRACKS THE FRAME AND CAUGHT IT WHEN IT DID NOT. Widening the
    // frame to 182 mm without raising the ceiling dropped the cover to 167
    // dpi — visibly soft on the one page somebody looks at before deciding
    // whether to read the rest.
    const dpi = COVER_MAX_PX.w / (COVER_FRAME_MM.w / 25.4);
    expect(dpi).toBeGreaterThan(300);
  });
});
