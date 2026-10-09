import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────
// A DEPENDENCY-FREE HEADLESS-CHROMIUM PRINTER.
//
// Phase 4 wants the motivation pack rendered from an HTML/CSS template rather
// than the hand-placed pdfkit typesetter. Chromium can already do that on this
// machine — `--headless=new --print-to-pdf` is the whole engine — so this
// service adds no npm dependency (no playwright, no puppeteer) and instead
// drives whatever Chromium the box already has: an env override, the
// Playwright browser cache the frontend tooling installs, a stock Windows
// Chrome, or a `chrome` on PATH.
//
// ⚠️ IT PRINTS ONE STRING TO ONE BUFFER. It owns the temp file lifecycle, an
// explicit timeout, and a `%PDF` magic check so a browser that exits 0 without
// writing a document is a loud error rather than an empty annexure. Merge,
// form-fill and watermarking stay in pdf-lib elsewhere.
// ────────────────────────────────────────────────────────────────────

const PDF_MAGIC = Buffer.from('%PDF');
// ⚠️ A COLD CHROMIUM START IS SLOW, AND SLOWER UNDER LOAD. 30s was too tight:
// the first launch on a busy machine (or in a full test run) can exceed it and
// fail a print that would succeed a second later. 60s is a ceiling, not a
// target — a warm print returns in a couple of seconds.
const DEFAULT_TIMEOUT_MS = 60_000;

export interface ChromiumResolver {
  env: NodeJS.ProcessEnv;
  exists(p: string): boolean;
  readdir(p: string): string[];
}

interface ChromiumDir {
  shell: boolean;
  version: number;
}

/** Parse a Playwright cache folder name, e.g. `chromium-1223` or
 *  `chromium_headless_shell-1223`, into its shell flag and version. */
export function parseChromiumDir(name: string): ChromiumDir | null {
  const m = /^chromium(_headless_shell)?-(\d+)$/.exec(name);
  if (!m) return null;
  return { shell: Boolean(m[1]), version: Number(m[2]) };
}

/** Shallow-walk `root` for `exeName`, trying each path directly before the
 *  directories beneath it. Playwright nests the binary two levels down, so a
 *  bounded walk is enough and avoids depending on the exact platform folder. */
function findExeUnder(
  root: string,
  exeName: string,
  res: ChromiumResolver,
): string | null {
  let level: string[] = [root];
  for (let depth = 0; depth < 4 && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const dir of level) {
      const direct = path.join(dir, exeName);
      if (res.exists(direct)) return direct;
      let entries: string[];
      try {
        entries = res.readdir(dir);
      } catch {
        entries = [];
      }
      for (const entry of entries) next.push(path.join(dir, entry));
    }
    level = next;
  }
  return null;
}

function newestChromiumInCache(
  cacheDir: string,
  res: ChromiumResolver,
): string | null {
  let entries: string[];
  try {
    entries = res.readdir(cacheDir);
  } catch {
    return null;
  }
  const dirs = entries
    .map((name) => ({ name, parsed: parseChromiumDir(name) }))
    .filter(
      (e): e is { name: string; parsed: ChromiumDir } => e.parsed !== null,
    )
    .sort((a, b) => {
      if (b.parsed.version !== a.parsed.version) {
        return b.parsed.version - a.parsed.version;
      }
      // Full Chromium over the headless shell at the same version.
      return Number(a.parsed.shell) - Number(b.parsed.shell);
    });
  for (const { name, parsed } of dirs) {
    const exe = parsed.shell ? 'chrome-headless-shell.exe' : 'chrome.exe';
    const found = findExeUnder(path.join(cacheDir, name), exe, res);
    if (found) return found;
  }
  return null;
}

/** Resolve a Chromium executable without touching the network or spawning
 *  anything. Pure over the injected resolver so it can be unit-tested with a
 *  fabricated filesystem. */
export function resolveChromiumPath(res: ChromiumResolver): string | null {
  const override =
    res.env.CHROMIUM_EXECUTABLE ?? res.env.CHROME_EXECUTABLE ?? '';
  if (override && res.exists(override)) return override;

  const local = res.env.LOCALAPPDATA;
  if (local) {
    const found = newestChromiumInCache(
      path.join(local, 'ms-playwright'),
      res,
    );
    if (found) return found;
  }

  const common = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const candidate of common) {
    if (res.exists(candidate)) return candidate;
  }

  const sep = path.delimiter;
  for (const dir of (res.env.PATH ?? '').split(sep)) {
    if (!dir) continue;
    for (const name of ['chrome.exe', 'chrome']) {
      const candidate = path.join(dir, name);
      if (res.exists(candidate)) return candidate;
    }
  }
  return null;
}

@Injectable()
export class ChromiumPdfService {
  private readonly logger = new Logger(ChromiumPdfService.name);

  private readonly resolver: ChromiumResolver = {
    env: process.env,
    exists: (p) => fs.existsSync(p),
    readdir: (p) => fs.readdirSync(p),
  };

  /** The Chromium binary this machine will use, or null when none is found. */
  findChromium(): string | null {
    return resolveChromiumPath(this.resolver);
  }

  /** Print an HTML document to a PDF buffer. */
  async printHtml(html: string): Promise<Buffer> {
    const exe = this.findChromium();
    if (!exe) {
      throw new Error(
        'No Chromium executable found. Set CHROMIUM_EXECUTABLE (or CHROME_EXECUTABLE) to a chrome.exe path.',
      );
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-pdf-'));
    const htmlPath = path.join(
      dir,
      `${randomBytes(6).toString('hex')}.html`,
    );
    const pdfPath = path.join(dir, `${randomBytes(6).toString('hex')}.pdf`);

    try {
      fs.writeFileSync(htmlPath, html, 'utf8');
      const stderr = await this.run(exe, htmlPath, pdfPath);

      let pdf: Buffer;
      try {
        pdf = fs.readFileSync(pdfPath);
      } catch {
        throw new Error(`Chromium produced no PDF. ${stderr}`.trim());
      }
      if (!pdf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
        throw new Error(`Chromium output was not a PDF. ${stderr}`.trim());
      }
      return pdf;
    } finally {
      for (const file of [htmlPath, pdfPath]) {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
      try {
        fs.rmdirSync(dir);
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  /** Spawn one print job and resolve with its stderr once it exits cleanly. */
  private run(
    exe: string,
    htmlPath: string,
    pdfPath: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        '--print-to-pdf-no-header',
        `--print-to-pdf=${pdfPath}`,
        `file:///${htmlPath.replace(/\\/g, '/')}`,
      ];
      const child = spawn(exe, args, { windowsHide: true });
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            `Chromium timed out after ${DEFAULT_TIMEOUT_MS}ms. ${stderr}`.trim(),
          ),
        );
      }, DEFAULT_TIMEOUT_MS);

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stderr);
        } else {
          reject(new Error(`Chromium exited with code ${code}. ${stderr}`.trim()));
        }
      });
    });
  }
}
