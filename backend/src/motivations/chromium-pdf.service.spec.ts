import * as path from 'node:path';
import {
  ChromiumPdfService,
  resolveChromiumPath,
  parseChromiumDir,
  type ChromiumResolver,
} from './chromium-pdf.service';

// A fabricated filesystem: each key is a directory and its value the entries
// directly beneath it. Tests never touch the real disk or the machine's Chrome.
function makeResolver(
  tree: Record<string, string[]>,
  env: NodeJS.ProcessEnv = {},
): ChromiumResolver {
  return {
    env,
    exists: (p) => {
      if (Object.prototype.hasOwnProperty.call(tree, p)) return true;
      const parent = path.dirname(p);
      const name = path.basename(p);
      return Boolean(tree[parent]?.includes(name));
    },
    readdir: (p) => tree[p] ?? [],
  };
}

describe('parseChromiumDir', () => {
  it('parses the full and headless-shell folder names', () => {
    expect(parseChromiumDir('chromium-1223')).toEqual({
      shell: false,
      version: 1223,
    });
    expect(parseChromiumDir('chromium_headless_shell-1223')).toEqual({
      shell: true,
      version: 1223,
    });
    expect(parseChromiumDir('chromium-1223-extra')).toBeNull();
    expect(parseChromiumDir('ffmpeg-1011')).toBeNull();
  });
});

describe('resolveChromiumPath', () => {
  const local = 'C:\\AppData\\Local';
  const cache = path.join(local, 'ms-playwright');

  it('prefers an existing CHROMIUM_EXECUTABLE override', () => {
    const exe = 'C:\\custom\\chrome.exe';
    const res = makeResolver({ 'C:\\custom': ['chrome.exe'] }, {
      CHROMIUM_EXECUTABLE: exe,
    });
    expect(resolveChromiumPath(res)).toBe(exe);
  });

  it('ignores the override when the path does not exist', () => {
    const res = makeResolver({}, { CHROMIUM_EXECUTABLE: 'C:\\missing.exe' });
    expect(resolveChromiumPath(res)).toBeNull();
  });

  it('scans the Playwright cache and picks the newest version', () => {
    const older = path.join(cache, 'chromium-1210', 'chrome-win64', 'chrome.exe');
    const newer = path.join(cache, 'chromium-1223', 'chrome-win64', 'chrome.exe');
    const res = makeResolver(
      {
        [local]: ['ms-playwright'],
        [cache]: ['chromium-1210', 'chromium-1223'],
        [path.join(cache, 'chromium-1210')]: ['chrome-win64'],
        [path.join(cache, 'chromium-1210', 'chrome-win64')]: ['chrome.exe'],
        [path.join(cache, 'chromium-1223')]: ['chrome-win64'],
        [path.join(cache, 'chromium-1223', 'chrome-win64')]: ['chrome.exe'],
      },
      { LOCALAPPDATA: local },
    );
    expect(resolveChromiumPath(res)).toBe(newer);
    expect(older).not.toBe(newer);
  });

  it('prefers full Chromium over the headless shell at the same version', () => {
    const full = path.join(cache, 'chromium-1223', 'chrome-win64', 'chrome.exe');
    const shell = path.join(
      cache,
      'chromium_headless_shell-1223',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe',
    );
    const res = makeResolver(
      {
        [local]: ['ms-playwright'],
        [cache]: ['chromium_headless_shell-1223', 'chromium-1223'],
        [path.join(cache, 'chromium-1223')]: ['chrome-win64'],
        [path.join(cache, 'chromium-1223', 'chrome-win64')]: ['chrome.exe'],
        [path.join(cache, 'chromium_headless_shell-1223')]: [
          'chrome-headless-shell-win64',
        ],
        [
          path.join(cache, 'chromium_headless_shell-1223', 'chrome-headless-shell-win64')
        ]: ['chrome-headless-shell.exe'],
      },
      { LOCALAPPDATA: local },
    );
    expect(resolveChromiumPath(res)).toBe(full);
    expect(shell).not.toBe(full);
  });

  it('falls back to a stock Windows Chrome path', () => {
    const stock =
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const res = makeResolver({
      'C:\\Program Files\\Google\\Chrome\\Application': ['chrome.exe'],
    });
    expect(resolveChromiumPath(res)).toBe(stock);
  });

  it('falls back to chrome on PATH and returns null when nothing matches', () => {
    const onPath = 'C:\\tools\\chrome.exe';
    const found = makeResolver(
      { 'C:\\tools': ['chrome.exe'] },
      { PATH: 'C:\\tools' },
    );
    expect(resolveChromiumPath(found)).toBe(onPath);

    expect(resolveChromiumPath(makeResolver({}))).toBeNull();
  });
});

describe('ChromiumPdfService', () => {
  const service = new ChromiumPdfService();
  const chromium = service.findChromium();
  const maybe = chromium ? it : it.skip;

  maybe(
    'prints an HTML string to a PDF buffer',
    async () => {
      // ⚠️ ONE RETRY. This spawns a real browser; under a full-suite run the
      // launch competes for the CPU and a single cold start can miss the
      // timeout. What is under test is the printer, not the machine's load, so
      // a transient spawn failure gets one more attempt before it is a failure.
      const attempt = () =>
        service.printHtml('<html><body><h1>hello</h1></body></html>');
      let pdf: Buffer;
      try {
        pdf = await attempt();
      } catch {
        pdf = await attempt();
      }
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    },
    120_000,
  );
});
