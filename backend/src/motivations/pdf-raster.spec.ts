import { execFile } from 'node:child_process';
import {
  ANNEXURE_PAGE_SCALE,
  CIP_INSET_SCALE,
  rasterisePdfToDir,
} from './pdf-raster';

/**
 * ⚠️ THE RASTERISER RUNS OUT OF PROCESS BECAUSE IT CAN KILL THE SERVER. Inside
 * a booted Nest process `pdf-to-img` has crashed node with an access violation
 * (0xC0000005) — no exception, no stack, nothing a caller's try/catch can see.
 * See pdf-raster.child.ts. These tests pin the CONTRACT the callers rely on: a
 * non-zero exit is an ordinary failure to fall back from, not a thrown process,
 * and the page count comes back from the child's own stdout.
 *
 * The helper itself is not spawned here. Running the real pdf.js rasteriser in
 * a test worker is exactly the native call the isolation exists to keep out of
 * a long-lived process, so `execFile` is mocked and only our side is asserted.
 */
jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

const mockedExecFile = execFile as unknown as jest.Mock;

type Callback = (err: Error | null, stdout: string, stderr: string) => void;

function succeedWith(stdout: string) {
  mockedExecFile.mockImplementation(
    (_f: string, _a: string[], _o: unknown, cb: Callback) =>
      cb(null, stdout, ''),
  );
}

function failWith(err: Error, stderr: string) {
  mockedExecFile.mockImplementation(
    (_f: string, _a: string[], _o: unknown, cb: Callback) =>
      cb(err, '', stderr),
  );
}

describe('running the out-of-process PDF rasteriser', () => {
  beforeEach(() => mockedExecFile.mockReset());

  it('runs the child under this node, against a directory, and reports its page count', async () => {
    succeedWith('PAGES 3\n');

    await expect(
      rasterisePdfToDir('doc.pdf', 'outdir', ANNEXURE_PAGE_SCALE),
    ).resolves.toBe(3);

    const [file, args, opts] = mockedExecFile.mock.calls[0] as [
      string,
      string[],
      { timeout: number; windowsHide: boolean },
    ];
    // The same node binary, so the helper needs no PATH entry of its own.
    expect(file).toBe(process.execPath);
    // ⚠️ THE COMPILED SIBLING, NOT THE SOURCE. `nest start --watch` runs from
    // dist/, so the helper is a .js beside this file at runtime.
    expect(args[0]).toMatch(/pdf-raster\.child\.js$/);
    expect(args[1]).toBe('doc.pdf');
    expect(args[2]).toBe('outdir');
    expect(Number(args[3])).toBe(ANNEXURE_PAGE_SCALE);
    // ⚠️ THE HELPER CAN HANG AS WELL AS CRASH, and a download that never
    // returns is worse than one that falls back.
    expect(opts.timeout).toBeGreaterThan(0);
    expect(opts.windowsHide).toBe(true);
  });

  it('rejects — rather than hanging or crashing — when the helper dies', async () => {
    // The access violation: node exits with a status and no message.
    failWith(new Error('Command failed'), 'segfault: exit 3221225477');

    await expect(
      rasterisePdfToDir('doc.pdf', 'outdir', ANNEXURE_PAGE_SCALE),
    ).rejects.toThrow(/segfault/);
  });

  it('carries the helper’s own stderr into the failure, so the cause is loggable', async () => {
    failWith(new Error('Command failed'), 'pdf-to-img exposed no pdf()');

    await expect(
      rasterisePdfToDir('doc.pdf', 'outdir', ANNEXURE_PAGE_SCALE),
    ).rejects.toThrow(/pdf-to-img exposed no pdf\(\)/);
  });

  it('rejects when the helper is killed at the timeout', async () => {
    failWith(
      Object.assign(new Error('Command failed: ETIMEDOUT'), { killed: true }),
      '',
    );

    await expect(
      rasterisePdfToDir('doc.pdf', 'outdir', ANNEXURE_PAGE_SCALE),
    ).rejects.toThrow(/ETIMEDOUT/);
  });

  it('rejects rather than resolving zero pages when the child reports none', async () => {
    // ⚠️ A ZERO-PAGE DOCUMENT IS A FAILURE, NOT AN EMPTY ONE. Resolving 0 would
    // let the caller file a document as printed with nothing under it.
    succeedWith('PAGES 0\n');

    await expect(
      rasterisePdfToDir('doc.pdf', 'outdir', ANNEXURE_PAGE_SCALE),
    ).rejects.toThrow(/no pages/);
  });

  it('keeps the inset sharper than an annexure page', () => {
    // The inset is one page a reader zooms into; an annexure is up to eight
    // pages of somebody's statement. Different jobs, different scales.
    expect(CIP_INSET_SCALE).toBeGreaterThan(ANNEXURE_PAGE_SCALE);
  });
});
