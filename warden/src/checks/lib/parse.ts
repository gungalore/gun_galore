// warden/src/checks/lib/parse.ts
//
// Pure parsers for the fixed command output the checks read. Kept apart
// from the checks themselves so each one is testable against a captured
// sample of real output with no box, no subprocess and no clock.
//
// EVERY parser here distinguishes "parsed, and the answer is zero" from
// "could not parse". A silent parse failure is the most likely way a
// plausible zero gets onto the board: nginx changes its log format, or
// `df` gains a column, and a naive parser returns an empty array that
// reads as a healthy result. So the shapes below carry an `unparsed`
// count or return null, and their callers turn that into an unknown.

export interface DfMount {
  source: string;
  fstype: string;
  sizeBytes: number;
  usedBytes: number;
  availBytes: number;
  usePct: number;
  target: string;
}

/** `df -B1 --output=source,fstype,size,used,avail,pcent,target` */
export function parseDf(stdout: string): { mounts: DfMount[]; unparsed: number } {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const mounts: DfMount[] = [];
  let unparsed = 0;
  for (const line of lines) {
    if (/^Filesystem\b/i.test(line)) continue; // header
    const parts = line.split(/\s+/);
    if (parts.length < 7) {
      unparsed += 1;
      continue;
    }
    const [source, fstype, size, used, avail, pcent, ...rest] = parts;
    const sizeBytes = Number(size);
    const usedBytes = Number(used);
    const availBytes = Number(avail);
    const usePct = Number((pcent ?? '').replace('%', ''));
    if (![sizeBytes, usedBytes, availBytes, usePct].every(Number.isFinite)) {
      unparsed += 1;
      continue;
    }
    mounts.push({
      source: source!,
      fstype: fstype!,
      sizeBytes,
      usedBytes,
      availBytes,
      usePct,
      // A mount point can contain spaces; it is the last column, so
      // everything left over belongs to it.
      target: rest.join(' '),
    });
  }
  return { mounts, unparsed };
}

export interface MemInfo {
  totalBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

/** /proc/meminfo. Returns null when the fields we need are absent — that
 *  is a different kernel or a different OS, not a box with no memory. */
export function parseMeminfo(text: string): MemInfo | null {
  const kb = new Map<string, number>();
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+) kB$/);
    if (m) kb.set(m[1]!, Number(m[2]));
  }
  const total = kb.get('MemTotal');
  const available = kb.get('MemAvailable');
  const swapTotal = kb.get('SwapTotal');
  const swapFree = kb.get('SwapFree');
  if (total === undefined || available === undefined) return null;
  return {
    totalBytes: total * 1024,
    availableBytes: available * 1024,
    swapTotalBytes: (swapTotal ?? 0) * 1024,
    swapUsedBytes: Math.max(0, (swapTotal ?? 0) - (swapFree ?? 0)) * 1024,
  };
}

/** /proc/loadavg — "0.34 0.28 0.31 1/512 21234" */
export function parseLoadavg(text: string): { one: number; five: number; fifteen: number } | null {
  const parts = text.trim().split(/\s+/);
  const [one, five, fifteen] = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  if (![one, five, fifteen].every(Number.isFinite)) return null;
  return { one, five, fifteen };
}

/** /proc/uptime — "912345.67 3612345.89" (seconds) */
export function parseUptimeSeconds(text: string): number | null {
  const seconds = Number(text.trim().split(/\s+/)[0]);
  return Number.isFinite(seconds) ? seconds : null;
}

export interface EnvEntry {
  /** Length only. The VALUE is never carried out of this function unless
   *  the key is on the caller's explicit non-secret allowlist — a leak
   *  outside that list is structurally impossible, not merely avoided. */
  length: number;
  value?: string;
}

/**
 * dotenv-shaped presence read. "Present" means SET TO SOMETHING NON-EMPTY,
 * matching desk-site.service.ts's own isConfigured rule exactly, so the
 * Desk board and Warden can never quietly disagree about what is set.
 */
export function parseEnvPresence(text: string, valueAllowlist: ReadonlySet<string> = new Set()): Map<string, EnvEntry> {
  const out = new Map<string, EnvEntry>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let value = (m[2] ?? '').trim();
    // Strip one layer of matching quotes; anything after an unquoted # is
    // a comment in every dotenv reader the app itself uses.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.split(' #')[0]!.trim();
    }
    if (!value) continue; // set-but-empty is NOT configured
    out.set(key, valueAllowlist.has(key) ? { length: value.length, value } : { length: value.length });
  }
  return out;
}

export interface NginxTimeout {
  directive: string;
  seconds: number;
  /** The line as written, for evidence. */
  raw: string;
}

/**
 * Every proxy_*_timeout in a config blob, in seconds. Used on BOTH the
 * live config and the repo's copy — the two have drifted (repo 90s/120s,
 * live 60s) and the whole point of the check is to print both.
 */
export function parseProxyTimeouts(conf: string): NginxTimeout[] {
  const out: NginxTimeout[] = [];
  // Comments stripped first, so a directive someone commented out while
  // debugging is not read as live config. Not anchored to line start: a
  // directive can legally sit inline after a `{` or another `;`, and
  // missing one of those would under-report the live timeout — the one
  // number this whole check exists to get right.
  const live = conf.replace(/#[^\n]*/g, '');
  const re = /(?:^|[\s;{])(proxy_(?:read|send|connect)_timeout)\s+(\d+)(ms|s|m|h)?\s*;/gm;
  for (const m of live.matchAll(re)) {
    const n = Number(m[2]);
    const unit = m[3] ?? 's';
    const seconds = unit === 'ms' ? n / 1000 : unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : n;
    // Rebuilt from the captures rather than sliced, so the evidence line
    // never carries a stray `{` from the boundary match.
    out.push({ directive: m[1]!, seconds, raw: `${m[1]} ${m[2]}${unit};` });
  }
  return out;
}

/** First ssl_certificate path in a config blob (not ssl_certificate_key). */
export function parseSslCertificatePath(conf: string): string | null {
  const m = conf.match(/^\s*ssl_certificate\s+([^\s;]+)\s*;/m);
  return m ? m[1]! : null;
}

export interface StatusCounts {
  total: number;
  byClass: Record<'2xx' | '3xx' | '4xx' | '5xx' | 'other', number>;
  /** Lines whose status could not be read at all. If this is most of the
   *  window the caller must return unknown, NOT "no 5xx". */
  unparsed: number;
}

/**
 * Status codes out of nginx's `combined` access log. The committed
 * alloutdoor.conf sets no log_format of its own, so this is the distro
 * default — confirm with `nginx -T | grep log_format` if this ever starts
 * reporting a high `unparsed`.
 */
export function parseAccessLogStatuses(text: string): StatusCounts {
  const counts: StatusCounts = {
    total: 0,
    byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 },
    unparsed: 0,
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    counts.total += 1;
    const m = line.match(/\]\s+"[^"]*"\s+(\d{3})\s/);
    if (!m) {
      counts.unparsed += 1;
      continue;
    }
    const code = Number(m[1]);
    const bucket = code >= 500 ? '5xx' : code >= 400 ? '4xx' : code >= 300 ? '3xx' : code >= 200 ? '2xx' : 'other';
    counts.byClass[bucket] += 1;
  }
  return counts;
}

export interface Pm2Process {
  name: string;
  status: string;
  pid: number | null;
  memoryBytes: number | null;
  cpuPct: number | null;
  unstableRestarts: number | null;
  restarts: number | null;
  uptimeMs: number | null;
  cwd: string | null;
}

/**
 * `pm2 jlist`. Returns null on anything that is not a JSON array — pm2 is
 * chatty on stderr and will happily print a warning banner; a parse
 * failure must become "cannot read pm2", never "no processes running",
 * which would be a catastrophic false ok.
 */
export function parsePm2Jlist(stdout: string, now = Date.now()): Pm2Process[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.map((raw): Pm2Process => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const envBlock = (p.pm2_env ?? {}) as Record<string, unknown>;
    const monit = (p.monit ?? {}) as Record<string, unknown>;
    const uptime = num(envBlock.pm_uptime);
    return {
      name: typeof p.name === 'string' ? p.name : '(unnamed)',
      status: typeof envBlock.status === 'string' ? envBlock.status : 'unknown',
      pid: num(p.pid),
      memoryBytes: num(monit.memory),
      cpuPct: num(monit.cpu),
      // unstable_restarts is the number that matters (a restart pm2 did
      // NOT consider healthy); restart_time counts every restart ever,
      // including every deploy.
      unstableRestarts: num(envBlock.unstable_restarts),
      restarts: num(envBlock.restart_time),
      uptimeMs: uptime === null ? null : Math.max(0, now - uptime),
      cwd: typeof envBlock.pm_cwd === 'string' ? envBlock.pm_cwd : null,
    };
  });
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
