import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdtemp, rm, open } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { PrismaService } from '../prisma/prisma.service';
import { readText, sapsGet } from './saps-http';
import { readRawDataSheet } from './crime-stats-workbook';
import { parseRawData, type ParseRawDataResult } from './parse-raw-data';
import {
  parseSapsWorkbookLinks,
  SAPS_CRIME_STATS_PAGE,
  SAPS_USER_AGENT,
  type SapsWorkbookLink,
} from './saps-page';

// ────────────────────────────────────────────────────────────────────
// FETCHING THE SAPS WORKBOOK.
//
// There is no API. SAPS puts a new .xlsx (lately .xlsm) on
// https://www.saps.gov.za/services/crimestats.php once a quarter, and the
// only way to know it has landed is to look. So we look weekly, and we look
// at the FILE NAMES: a release we already hold as 'ready' is skipped without
// a download.
//
// ⚠️ NOTHING HERE MAY THROW INTO THE CRON. A crime-statistics refresh failing
// is a stale figure; an unhandled rejection out of a @Cron in this repo takes
// the scheduler's word for it and can leave the process logging a fatal on a
// Sunday morning for a job nobody was waiting on. Every outcome is caught,
// counted and logged as one line.
// ────────────────────────────────────────────────────────────────────

/** Five minutes. The 2025-2026 Q4 file is 10.8 MB over a government link. */
const DOWNLOAD_TIMEOUT_MS = 300_000;
const PAGE_TIMEOUT_MS = 30_000;

/**
 * ⚠️ A HARD CAP, NOT AN EXPECTATION. The workbook has grown every year
 * (10.8 MB today) and the cap exists so a redirect to something enormous —
 * or a truncating proxy that never ends the stream — cannot fill the box's
 * disk while the API is serving.
 */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * A real workbook is megabytes. Anything smaller is the government site's
 * block page or its 404, which arrives as text/html with a 200 or a 404 and
 * would otherwise be saved to disk as an "xlsx" that only fails at unzip.
 */
const MIN_BYTES = 100 * 1024;

/**
 * ⚠️ NEWEST FIRST, AND BOUNDED. Every release is ~258 000 figures, so loading
 * the page's whole back catalogue in one cron run is twenty minutes of insert
 * beside a live API. Four is one SAPS year — the four consecutive calendar
 * quarters `precinct()` wants for a twelve-month total — and anything older
 * is picked up on a later run or from the admin button.
 */
const MAX_RELEASES_PER_RUN = 4;

/** Prisma refuses very large parameter lists; 5 000 rows is comfortable. */
const INSERT_BATCH = 5_000;

export interface CrimeStatsRunOutcome {
  /** Workbook links found on the page. */
  found: number;
  /** Already held as 'ready'. */
  alreadyHeld: number;
  loaded: string[];
  failed: string[];
  /** Links we did not reach this run (the per-run cap), newest first. */
  deferred: string[];
  /** One line per release, for the admin panel and the deploy log. */
  messages: string[];
}

@Injectable()
export class CrimeStatsFetchService {
  private readonly logger = new Logger(CrimeStatsFetchService.name);

  /**
   * ⚠️ ONE AT A TIME. The admin "Fetch now" button and the Sunday cron can
   * land together, and two loads of the same release race each other into the
   * unique index — the second one's whole 5 000-row batch fails on the first
   * one's rows. This is a single-process flag, which is all this box needs
   * (one pm2 instance); a second instance would want an advisory lock.
   */
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sunday 03:40.
   *
   * ⚠️ THE BOX TIMEZONE IS NOT PINNED — no @Cron in this repo passes a
   * timeZone and nothing sets TZ in the deploy path, so this fires at 03:40 in
   * the box's own zone. That is fine here: the only requirement is "the middle
   * of a quiet night", because the load writes a quarter of a million rows.
   * 03:40 is off the hour and clear of 02:10 (backup), 03:00 (trust score),
   * 03:20 (licence reminders) and 04:00 (stale listings).
   *
   * SAPS publishes quarterly, so a weekly look is fifty-two chances a year to
   * notice a file that appears four times.
   */
  @Cron('40 3 * * 0')
  async weekly(): Promise<void> {
    try {
      const out = await this.runNow();
      this.logger.log(
        `crime-stats weekly: found ${out.found}, held ${out.alreadyHeld}, loaded ${out.loaded.length}, failed ${out.failed.length}, deferred ${out.deferred.length}`,
      );
    } catch (err) {
      // runNow() already swallows per-release failures; reaching here means
      // the PAGE could not be read at all.
      this.logger.warn(
        `crime-stats weekly could not run: ${(err as Error).message}`,
      );
    }
  }

  /** The whole job, on demand. Never throws for a per-release failure. */
  async runNow(
    options: { max?: number } = {},
  ): Promise<CrimeStatsRunOutcome> {
    const out: CrimeStatsRunOutcome = {
      found: 0,
      alreadyHeld: 0,
      loaded: [],
      failed: [],
      deferred: [],
      messages: [],
    };

    if (this.running) {
      out.messages.push('A crime-stats load is already running; nothing done.');
      return out;
    }
    this.running = true;
    try {
      const links = await this.readPage();
      out.found = links.length;

      const held = await this.prisma.crimeStatsRelease.findMany({
        where: { key: { in: links.map((l) => l.key) }, status: 'ready' },
        select: { key: true },
      });
      const heldKeys = new Set(held.map((h) => h.key));
      out.alreadyHeld = heldKeys.size;

      const todo = links.filter((l) => !heldKeys.has(l.key));
      const max = options.max ?? MAX_RELEASES_PER_RUN;
      out.deferred = todo.slice(max).map((l) => l.key);

      for (const link of todo.slice(0, max)) {
        try {
          const message = await this.loadRelease(link);
          out.messages.push(message);
          if (message.startsWith('skipped')) continue;
          out.loaded.push(link.key);
        } catch (err) {
          const reason = (err as Error).message.slice(0, 500);
          out.failed.push(link.key);
          out.messages.push(`${link.key}: FAILED - ${reason}`);
          this.logger.warn(`crime-stats ${link.key} failed: ${reason}`);
          await this.markFailed(link, reason);
        }
      }
      return out;
    } finally {
      this.running = false;
    }
  }

  private async readPage(): Promise<SapsWorkbookLink[]> {
    // ⚠️ sapsGet, NOT fetch — see saps-http.ts: SAPS omits its intermediate
    // certificate and a plain fetch fails the handshake on the box.
    const res = await sapsGet(SAPS_CRIME_STATS_PAGE, {
      userAgent: SAPS_USER_AGENT,
      accept: 'text/html',
      timeoutMs: PAGE_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      res.body.resume();
      throw new Error(`SAPS crime-stats page returned ${res.status}`);
    }
    return parseSapsWorkbookLinks(await readText(res));
  }

  /** Downloads, parses and loads one release. Returns the log line. */
  private async loadRelease(link: SapsWorkbookLink): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'saps-crime-'));
    const file = path.join(dir, link.fileName || `${link.key}.xlsx`);
    try {
      const downloaded = await this.download(link.url, file);
      if (downloaded.skipReason) {
        // ⚠️ NO ROW IS WRITTEN FOR THESE. The page lists next quarter's
        // workbook before SAPS uploads it — `2026-2027_-_1st_Quarter_WEB.xlsm`
        // answered 404 on the day this was built — and a block page or a 404
        // is not a release that failed to load, it is a release that is not
        // there yet. Writing a 'failed' row would put a permanent red line in
        // the admin panel for a file nobody has published.
        return `skipped ${link.key}: ${downloaded.skipReason}`;
      }

      const rows = await readRawDataSheet(file);
      const parsed = parseRawData(rows);
      const counted = await this.store(link, downloaded.sha256, parsed);
      const s = parsed.skipped;
      return (
        `${link.key}: ${parsed.stations.length} stations, ${parsed.rows.length} station rows, ` +
        `${parsed.quarters.length} quarters (${parsed.quarters[0].period}..${parsed.latestPeriod}), ` +
        `${counted} figures; dropped ${s.aggregateRows} aggregate / ${s.unusableRows} unusable / ` +
        `${s.duplicateRows} duplicate rows, ${s.monthSumMismatches} month-sum mismatches`
      );
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async download(
    url: string,
    file: string,
  ): Promise<{ sha256: string; bytes: number; skipReason?: string }> {
    const res = await sapsGet(url, {
      userAgent: SAPS_USER_AGENT,
      accept:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      res.body.resume();
      return { sha256: '', bytes: 0, skipReason: `HTTP ${res.status}` };
    }

    const declared = Number(res.headers['content-length'] ?? '0');
    if (declared > MAX_BYTES) {
      return {
        sha256: '',
        bytes: declared,
        skipReason: `declared ${declared} bytes, over the ${MAX_BYTES} cap`,
      };
    }

    const hash = createHash('sha256');
    let bytes = 0;
    const source = res.body;
    // The cap is enforced on the BYTES WE ACTUALLY RECEIVE, not on the header
    // — a server that lies about content-length, or omits it, must not be
    // able to write past the cap.
    async function* capped(): AsyncGenerator<Buffer> {
      for await (const chunk of source) {
        const buf = chunk as Buffer;
        bytes += buf.length;
        if (bytes > MAX_BYTES) {
          throw new Error(`workbook exceeded the ${MAX_BYTES}-byte cap`);
        }
        hash.update(buf);
        yield buf;
      }
    }
    await pipeline(capped(), createWriteStream(file));

    if (bytes < MIN_BYTES) {
      return { sha256: '', bytes, skipReason: `only ${bytes} bytes` };
    }
    if (!(await isZip(file))) {
      // saps.gov.za answers a filtered request with an HTML block page and a
      // 200. Saved to disk that is an "xlsx" that only fails at unzip, deep
      // inside exceljs, with a message nobody can act on.
      return { sha256: '', bytes, skipReason: 'not a zip (block page or HTML)' };
    }
    return { sha256: hash.digest('hex'), bytes };
  }

  /**
   * Writes the release, its stations and its figures. Returns how many
   * figures were inserted.
   *
   * ⚠️ THE RELEASE IS MARKED 'ready' LAST, ON PURPOSE. `latestRelease()` only
   * ever looks at 'ready' rows, so a load that dies half way through leaves a
   * 'loading' row that no member route can read — a partially loaded precinct
   * would answer with a number that is quietly too small.
   */
  private async store(
    link: SapsWorkbookLink,
    sha256: string,
    parsed: ParseRawDataResult,
  ): Promise<number> {
    // ⚠️ A DIFFERENT FILE UNDER A KEY WE ALREADY HOLD IS NOT AN UPDATE.
    // SAPS has re-published corrected workbooks under the same name. The
    // digest is unique, so re-loading the key with a new digest is allowed,
    // but the SAME digest already sitting under a DIFFERENT key means the
    // page renamed a file we hold — loading it again would double the data
    // under two keys.
    const clash = await this.prisma.crimeStatsRelease.findUnique({
      where: { fileSha256: sha256 },
      select: { key: true, status: true },
    });
    if (clash && clash.key !== link.key && clash.status === 'ready') {
      throw new Error(
        `this file is already loaded as release ${clash.key}; the page appears to have renamed it`,
      );
    }

    const release = await this.prisma.crimeStatsRelease.upsert({
      where: { key: link.key },
      create: {
        key: link.key,
        sourceUrl: link.url,
        fileSha256: sha256,
        periodLabel: parsed.latestLabel,
        latestPeriod: parsed.latestPeriod,
        rowCount: 0,
        status: 'loading',
      },
      update: {
        sourceUrl: link.url,
        fileSha256: sha256,
        periodLabel: parsed.latestLabel,
        latestPeriod: parsed.latestPeriod,
        rowCount: 0,
        status: 'loading',
        error: null,
        fetchedAt: new Date(),
      },
    });

    // A retry of a release that failed part way must not add its rows twice.
    // The unique index would refuse them, but refusing them takes the whole
    // batch down; clearing first is both cheaper and idempotent.
    await this.prisma.crimeStatsFigure.deleteMany({
      where: { releaseId: release.id },
    });

    await this.prisma.crimeStatsStation.createMany({
      data: parsed.stations.map((s) => ({
        name: s.name,
        district: s.district,
        province: s.province,
      })),
      skipDuplicates: true,
    });

    const known = await this.prisma.crimeStatsStation.findMany({
      where: { province: { in: [...new Set(parsed.stations.map((s) => s.province))] } },
      select: { id: true, name: true, province: true, district: true },
    });
    const ids = new Map(known.map((s) => [`${s.name} ${s.province}`, s.id]));

    // Districts get redrawn and stations get moved between them. The station
    // row is shared by every release, so it carries the NEWEST spelling.
    for (const s of parsed.stations) {
      const existing = known.find(
        (k) => k.name === s.name && k.province === s.province,
      );
      if (existing && existing.district !== s.district && s.district) {
        await this.prisma.crimeStatsStation.update({
          where: { id: existing.id },
          data: { district: s.district },
        });
      }
    }

    const figures: {
      releaseId: string;
      stationId: string;
      category: string;
      code: number | null;
      period: string;
      count: number;
    }[] = [];
    for (const row of parsed.rows) {
      const stationId = ids.get(`${row.station} ${row.province}`);
      if (!stationId) continue;
      for (const c of row.counts) {
        figures.push({
          releaseId: release.id,
          stationId,
          category: row.category,
          code: row.code,
          period: c.period,
          count: c.count,
        });
      }
    }

    let inserted = 0;
    for (let i = 0; i < figures.length; i += INSERT_BATCH) {
      const batch = figures.slice(i, i + INSERT_BATCH);
      // One transaction PER BATCH, not one around the whole load: a single
      // transaction holding a quarter of a million inserts open is a long
      // lock on a live database for a job nobody is waiting on.
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.crimeStatsFigure.createMany({
          data: batch,
          skipDuplicates: true,
        });
        inserted += res.count;
      });
    }

    await this.prisma.crimeStatsRelease.update({
      where: { id: release.id },
      data: { rowCount: parsed.rows.length, status: 'ready', error: null },
    });
    return inserted;
  }

  /**
   * A failed release STAYS IN THE TABLE as 'failed'. It is the only record of
   * why a quarter is missing, and the next run retries it because the skip
   * list is keyed on 'ready'.
   */
  private async markFailed(
    link: SapsWorkbookLink,
    error: string,
  ): Promise<void> {
    try {
      const existing = await this.prisma.crimeStatsRelease.findUnique({
        where: { key: link.key },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.crimeStatsRelease.update({
          where: { id: existing.id },
          data: { status: 'failed', error },
        });
        return;
      }
      await this.prisma.crimeStatsRelease.create({
        data: {
          key: link.key,
          sourceUrl: link.url,
          // Unique, and there is no file to digest. A per-key placeholder
          // keeps the constraint satisfiable for several failed releases.
          fileSha256: `failed:${link.key}`,
          periodLabel: link.key,
          latestPeriod: link.key,
          status: 'failed',
          error,
        },
      });
    } catch (err) {
      this.logger.warn(
        `could not record the crime-stats failure for ${link.key}: ${(err as Error).message}`,
      );
    }
  }
}

/** The first two bytes of every .xlsx / .xlsm: "PK". */
async function isZip(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await fh.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x50 && buf[1] === 0x4b;
  } finally {
    await fh.close();
  }
}
