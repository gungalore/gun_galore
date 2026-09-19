import { MotivationUploadKind } from '@prisma/client';
import sharp from 'sharp';
import { MotivationRenderService } from './motivation-render.service';
import { buildAnnexures } from './motivation-checklist';

/**
 * ⚠️ THE COPIES PRINT IN THE ORDER THE INDEX LETTERS THEM. A DFO reads the
 * index and turns to the pages in that sequence; a pack whose pages run
 * C, A, B, D is a pack they have to hunt through. The uploads arrive from the
 * database in CREATED order, which is not annexure order, so the renderer
 * sorts them — and the first version of that sort hoisted every proficiency
 * upload to the FRONT of the whole pack, which printed the rifle pages before
 * the applicant's identity document.
 *
 * `annexureImages` is private and reached through the class deliberately: it is
 * the seam that turns uploads into printed pages, and it has no other caller.
 */
/** A page rasteriser that turns any PDF into `pages` identical images. */
function rasterOf(pages: number) {
  return {
    pagesFor: jest.fn(() =>
      Promise.resolve(
        Array.from({ length: pages }, (_, i) => ({
          page: i + 1,
          bytes: png,
          width: 4,
          height: 3,
        })),
      ),
    ),
  };
}

function serviceWith(
  files: { read(key: string): Promise<Buffer> },
  pageRaster: unknown = rasterOf(0),
) {
  return new MotivationRenderService(
    null as never,
    null as never,
    files as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    // The page rasteriser: a PDF annexure is rasterised before it is planned.
    pageRaster as never,
  );
}

type Upload = {
  id: string;
  kind: MotivationUploadKind;
  storageKey: string;
  mimeType: string;
  purgedAt: null;
  sha256?: string;
};

const upload = (
  id: string,
  kind: MotivationUploadKind,
  mimeType = 'image/png',
): Upload => ({
  id,
  kind,
  storageKey: `key-${id}`,
  mimeType,
  purgedAt: null,
  sha256: `hash-${id}`,
});

type Result = {
  images: { letter: string; label: string; index: number; total: number }[];
  pdfs: unknown[];
  notPrinted: { letter: string; label: string; why: string }[];
};

async function annexureImages(
  uploads: Upload[],
  kinds: MotivationUploadKind[],
  pageRaster: unknown = rasterOf(0),
): Promise<Result> {
  const svc = serviceWith({ read: () => Promise.resolve(png) }, pageRaster);
  return (
    svc as unknown as {
      annexureImages(
        u: Upload[],
        a: ReturnType<typeof buildAnnexures>,
      ): Promise<Result>;
    }
  ).annexureImages(uploads, buildAnnexures(kinds));
}

let png: Buffer;

beforeAll(async () => {
  png = await sharp({
    create: { width: 4, height: 3, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
});

describe('the order the annexure copies print in', () => {
  it('follows the letters, not the order the uploads were created', async () => {
    const kinds = [
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.PROFICIENCY_CERTIFICATE,
      MotivationUploadKind.CURRENT_LICENCE,
    ];
    // Created in the wrong order on purpose: proficiency, then licence, then
    // the identity document. The letters are A (identity), B (proficiency),
    // C (licence).
    const out = await annexureImages(
      [
        upload('p1', MotivationUploadKind.PROFICIENCY_CERTIFICATE),
        upload('c1', MotivationUploadKind.CURRENT_LICENCE),
        upload('i1', MotivationUploadKind.IDENTITY_DOCUMENT),
      ],
      kinds,
    );

    expect(out.images.map((i) => i.letter)).toEqual(['A', 'B', 'C']);
  });

  it('never prints the seller’s licence as an annexure', async () => {
    // ⚠️ THE CONSENT FORM ALREADY CARRIES BOTH SIDES of the current owner's
    // licence. The vault row is kept, but reprinting it as an annexure is the
    // same two images a second time. It is filtered here, at the copy level —
    // not only in the lettering — so a row that never got a letter cannot slip
    // through as "Annexure ?".
    const kinds = [MotivationUploadKind.IDENTITY_DOCUMENT];
    const out = await annexureImages(
      [
        upload('i1', MotivationUploadKind.IDENTITY_DOCUMENT),
        upload('s1', MotivationUploadKind.SELLER_LICENCE),
      ],
      kinds,
    );

    expect(out.images).toHaveLength(1);
    expect(out.images[0].letter).toBe('A');
    expect(out.images.some((i) => i.letter === '?')).toBe(false);
  });
});

describe('a PDF annexure, which is the same document type as a photograph', () => {
  it('becomes one image per page, captioned as pages of its letter', async () => {
    // ⚠️ THE WHOLE POINT OF RASTERISING. A PDF used to be handed to pdf-lib and
    // spliced in near the back, out of letter order, with its contents number
    // unknowable. As page images it is planned, captioned and ordered exactly
    // like a photographed licence.
    const kinds = [
      MotivationUploadKind.ADDRESS_CONFIRMATION,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
    ];
    const out = await annexureImages(
      [
        upload(
          'a1',
          MotivationUploadKind.ADDRESS_CONFIRMATION,
          'application/pdf',
        ),
        upload('s1', MotivationUploadKind.SAFE_PHOTOGRAPHS),
      ],
      kinds,
      rasterOf(2),
    );

    expect(out.images.map((i) => [i.letter, i.index, i.total])).toEqual([
      ['A', 1, 2],
      ['A', 2, 2],
      ['B', 1, 1],
    ]);
    // Nothing is left for the pdf-lib merge: there is no second document type.
    expect(out.pdfs).toEqual([]);
    expect(out.notPrinted).toEqual([]);
  });

  it('lists the annexure rather than dropping it when the rasteriser fails', async () => {
    const kinds = [MotivationUploadKind.ADDRESS_CONFIRMATION];
    const out = await annexureImages(
      [
        upload(
          'a1',
          MotivationUploadKind.ADDRESS_CONFIRMATION,
          'application/pdf',
        ),
      ],
      kinds,
      rasterOf(0),
    );

    expect(out.images).toEqual([]);
    expect(out.notPrinted).toHaveLength(1);
    expect(out.notPrinted[0]).toMatchObject({ letter: 'A' });
  });
});
