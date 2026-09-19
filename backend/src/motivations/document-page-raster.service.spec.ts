import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { DocumentPageRasterService } from './document-page-raster.service';
import { rasterisePdfToDir } from './pdf-raster';

// The child process is the thing being isolated, so it is never spawned here —
// what these tests cover is the caching and the fail-soft contract around it.
jest.mock('./pdf-raster', () => {
  const actual = jest.requireActual<Record<string, unknown>>('./pdf-raster');
  return { ...actual, rasterisePdfToDir: jest.fn() };
});

const mockedRasterise = rasterisePdfToDir as unknown as jest.Mock;

let pagePng: Buffer;

beforeAll(async () => {
  pagePng = await sharp({
    create: { width: 40, height: 56, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
});

/** Make the child "write" `count` pages into the directory it is handed. */
function rasterises(count: number) {
  mockedRasterise.mockImplementation(
    async (_in: string, outDir: string): Promise<number> => {
      for (let page = 1; page <= count; page++) {
        await fs.writeFile(path.join(outDir, `page-${page}.png`), pagePng);
      }
      return count;
    },
  );
}

function build() {
  const stored = new Map<string, Buffer>();
  let seq = 0;

  const upserts: { fileSha256: string; page: number }[] = [];

  const prisma = {
    documentPageImage: {
      findMany: jest.fn((): Promise<unknown[]> => Promise.resolve([])),
      upsert: jest.fn(
        (args: {
          create: { fileSha256: string; page: number };
        }): Promise<unknown> => {
          upserts.push(args.create);
          return Promise.resolve({});
        },
      ),
      deleteMany: jest.fn(
        (): Promise<{ count: number }> => Promise.resolve({ count: 0 }),
      ),
    },
  };
  const files = {
    write: jest.fn((_ns: string, bytes: Buffer): Promise<unknown> => {
      const storageKey = `motivations/2026/09/k${++seq}.enc`;
      stored.set(storageKey, bytes);
      return Promise.resolve({
        storageKey,
        sha256: 'x',
        byteSize: bytes.length,
      });
    }),
    read: jest.fn((storageKey: string): Promise<Buffer> => {
      const bytes = stored.get(storageKey);
      return bytes
        ? Promise.resolve(bytes)
        : Promise.reject(new Error('ENOENT'));
    }),
    remove: jest.fn((storageKey: string): Promise<void> => {
      stored.delete(storageKey);
      return Promise.resolve();
    }),
  };

  const svc = new DocumentPageRasterService(prisma as never, files as never);
  return { svc, prisma, files, stored, upserts };
}

const PDF = Buffer.from('%PDF-1.4 not really a pdf');
const SHA = 'a'.repeat(64);

describe('rasterising an uploaded PDF into page images', () => {
  beforeEach(() => mockedRasterise.mockReset());

  it('renders every page, stores each, and remembers them under the source hash', async () => {
    const { svc, prisma, files, upserts } = build();
    rasterises(3);

    const pages = await svc.pagesFor({ bytes: PDF, sha256: SHA });

    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages[0].width).toBe(40);
    expect(pages[0].height).toBe(56);
    expect(files.write).toHaveBeenCalledTimes(3);
    expect(prisma.documentPageImage.upsert).toHaveBeenCalledTimes(3);
    expect(upserts.map((u) => u.page)).toEqual([1, 2, 3]);
    expect(upserts[0].fileSha256).toBe(SHA);
  });

  it('serves a second render from the stored images without rasterising again', async () => {
    const { svc, prisma, stored } = build();
    rasterises(2);
    await svc.pagesFor({ bytes: PDF, sha256: SHA });

    // A later render: the rows are there and the files are on disk.
    const keys = [...stored.keys()];
    prisma.documentPageImage.findMany.mockResolvedValue(
      keys.map((storageKey, i) => ({
        page: i + 1,
        storageKey,
        width: 40,
        height: 56,
      })),
    );
    mockedRasterise.mockClear();

    const pages = await svc.pagesFor({ bytes: PDF, sha256: SHA });

    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(mockedRasterise).not.toHaveBeenCalled();
  });

  it('falls through to a fresh render when a cached page image is gone', async () => {
    // ⚠️ HALF A DOCUMENT IS WORSE THAN NONE. A cache row whose bytes have been
    // swept must re-render rather than print a bank statement with pages
    // silently missing.
    const { svc, prisma } = build();
    prisma.documentPageImage.findMany.mockResolvedValue([
      {
        page: 1,
        storageKey: 'motivations/2026/09/missing.enc',
        width: 40,
        height: 56,
      },
    ]);
    rasterises(2);

    const pages = await svc.pagesFor({ bytes: PDF, sha256: SHA });

    expect(mockedRasterise).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(2);
  });

  it('costs one document, never the pack, when the rasteriser fails', async () => {
    const { svc, prisma } = build();
    mockedRasterise.mockRejectedValue(new Error('segfault: exit 3221225477'));

    await expect(svc.pagesFor({ bytes: PDF, sha256: SHA })).resolves.toEqual(
      [],
    );
    expect(prisma.documentPageImage.upsert).not.toHaveBeenCalled();
  });

  it('does not remember a partial document when a page cannot be read back', async () => {
    // The child reports three pages but only wrote two: a crash mid-write. The
    // whole document fails rather than caching two-thirds of it.
    const { svc, prisma } = build();
    mockedRasterise.mockImplementation(
      async (_in: string, outDir: string): Promise<number> => {
        await fs.writeFile(path.join(outDir, 'page-1.png'), pagePng);
        await fs.writeFile(path.join(outDir, 'page-2.png'), pagePng);
        return 3;
      },
    );

    await expect(svc.pagesFor({ bytes: PDF, sha256: SHA })).resolves.toEqual(
      [],
    );
    expect(prisma.documentPageImage.upsert).not.toHaveBeenCalled();
  });
});

describe('purging page images', () => {
  it('removes the rows and the bytes when the source document is deleted', async () => {
    const { svc, prisma, files } = build();
    prisma.documentPageImage.findMany.mockResolvedValue([
      { storageKey: 'motivations/2026/09/a.enc' },
      { storageKey: 'motivations/2026/09/b.enc' },
    ]);

    await expect(svc.forget(SHA)).resolves.toBe(2);

    expect(prisma.documentPageImage.deleteMany).toHaveBeenCalledWith({
      where: { fileSha256: SHA },
    });
    expect(files.remove).toHaveBeenCalledTimes(2);
  });

  it('sweeps expired page images, bytes and all', async () => {
    const { svc, prisma, files } = build();
    prisma.documentPageImage.findMany.mockResolvedValue([
      { storageKey: 'motivations/2026/09/old.enc' },
    ]);
    prisma.documentPageImage.deleteMany.mockResolvedValue({ count: 1 });

    await expect(svc.purgeExpired()).resolves.toBe(1);
    expect(files.remove).toHaveBeenCalledWith('motivations/2026/09/old.enc');
  });

  it('does not throw when a purge fails — the delete is already done', async () => {
    const { svc, prisma } = build();
    prisma.documentPageImage.findMany.mockRejectedValue(new Error('db down'));

    await expect(svc.forget(SHA)).resolves.toBe(0);
  });
});
