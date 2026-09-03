// warden/src/checks/history.ts
//
// Warden's memory of its own prior readings, and the ONE function that
// turns those into a rate.
//
// This module exists because half the operator's list is not a
// point-in-time fact at all: `df` cannot tell you a mount is filling,
// `pm2 jlist` cannot tell you a process is crash-LOOPING (vs having
// crashed once in March), and a backup dump's size only means something
// against yesterday's. Every one of those becomes a plausible zero if it
// is answered from a single sample — "0 GiB/day" and "no data yet" look
// identical on a board and mean opposite things. So `ratePerDay` refuses
// to answer at all until it has two samples far enough apart, and the
// callers render that refusal as an em dash.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { HistorySample, HistoryStore } from '../types.js';

/** Per series. Enough for days of five-minute samples without the file
 *  becoming something anyone has to think about. */
const MAX_SAMPLES = 500;

/** Two readings four minutes apart extrapolate to a wildly wrong daily
 *  rate. Below this span we say "insufficient history" instead. */
export const MIN_RATE_SPAN_MS = 30 * 60 * 1000;

export type RateResult =
  | { ok: true; perDay: number; spanMs: number; samples: number }
  | { ok: false; reason: string };

/**
 * Change per day across the sample window, or a stated refusal. Uses the
 * FIRST and LAST sample rather than a fit: the question a board asks is
 * "how fast is it moving now", and a least-squares line over a window that
 * includes a deploy would smear a step change into a trend.
 */
export function ratePerDay(samples: HistorySample[], minSpanMs = MIN_RATE_SPAN_MS): RateResult {
  if (samples.length < 2) {
    return {
      ok: false,
      reason: `insufficient history (${samples.length} sample${samples.length === 1 ? '' : 's'}; a rate needs two)`,
    };
  }
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const spanMs = new Date(last.at).getTime() - new Date(first.at).getTime();
  if (!Number.isFinite(spanMs) || spanMs <= 0) {
    return { ok: false, reason: 'insufficient history (samples are not ordered in time)' };
  }
  if (spanMs < minSpanMs) {
    return {
      ok: false,
      reason: `insufficient history (${Math.round(spanMs / 60000)} minutes of samples; need ${Math.round(minSpanMs / 60000)})`,
    };
  }
  return { ok: true, perDay: ((last.value - first.value) * 86_400_000) / spanMs, spanMs, samples: samples.length };
}

/** In-memory. Used by tests, and as the fallback when the history file's
 *  directory is not writable — a Warden that cannot persist history must
 *  still measure everything else, and must report the rates it therefore
 *  cannot compute as unknown rather than as zero. */
export class MemoryHistory implements HistoryStore {
  private readonly series = new Map<string, HistorySample[]>();

  async record(series: string, value: number, at: Date): Promise<void> {
    const list = this.series.get(series) ?? [];
    list.push({ at: at.toISOString(), value });
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
    this.series.set(series, list);
  }

  async recent(series: string, limit = MAX_SAMPLES): Promise<HistorySample[]> {
    const list = this.series.get(series) ?? [];
    return list.slice(Math.max(0, list.length - limit));
  }
}

/**
 * A single JSON file, loaded once and written back after each record.
 * Deliberately not SQLite: this is a few hundred numbers, the daemon is
 * the only writer, and a corrupt or missing file must degrade to "no
 * history" rather than to a crash — which it does, because a parse failure
 * resets to empty and the rate helper then says "insufficient history".
 */
export class JsonFileHistory implements HistoryStore {
  private cache: Record<string, HistorySample[]> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async load(): Promise<Record<string, HistorySample[]>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.cache =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, HistorySample[]>)
          : {};
    } catch {
      // Missing or unreadable is the normal first-boot case, and a
      // corrupt file is not worth taking the sweep down for.
      this.cache = {};
    }
    return this.cache;
  }

  async record(series: string, value: number, at: Date): Promise<void> {
    const store = await this.load();
    const list = store[series] ?? [];
    list.push({ at: at.toISOString(), value });
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
    store[series] = list;
    // Serialise writes: two checks recording in the same sweep would
    // otherwise interleave read-modify-write and lose one.
    this.writing = this.writing.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(store), 'utf8');
      } catch {
        // Persisting history is best-effort. Losing it costs rates, not
        // measurements, and the rates then say so themselves.
      }
    });
    await this.writing;
  }

  async recent(series: string, limit = MAX_SAMPLES): Promise<HistorySample[]> {
    const store = await this.load();
    const list = store[series] ?? [];
    return list.slice(Math.max(0, list.length - limit));
  }
}
