// warden/src/checks/testing.ts
//
// A fake world for the checks, so the measurement layer can be tested on a
// dev box with no Postgres, no nginx and no pm2 anywhere.
//
// ⚠️ THE DEFAULT IS DELIBERATE: every accessor FAILS unless the test
// supplies an answer, and it fails with a stated reason. That default is
// what makes the "unknown is not zero" test possible — drop a fully empty
// world on the whole registry and no check may come back ok, because none
// of them measured anything.

import type {
  Attempt,
  CheckContext,
  FileStat,
  HistoryStore,
  HttpJsonResponse,
  TlsChainInfo,
  WardenConfig,
} from '../types.js';
import { attempt, failed } from '../types.js';
import type { RunOutcome } from '../proc.js';
import { MemoryHistory } from './history.js';

export interface FakeWorld {
  /** absolute path -> contents */
  files?: Record<string, string>;
  /** absolute path -> entry names */
  dirs?: Record<string, string[]>;
  /** absolute path -> stat */
  stats?: Record<string, Partial<FileStat>>;
  /** `${file} ${args.join(' ')}` -> outcome */
  commands?: Record<string, Partial<RunOutcome>>;
  db?: (sql: string) => Attempt<string[][]>;
  http?: (url: string) => Attempt<HttpJsonResponse>;
  tls?: Attempt<TlsChainInfo>;
  now?: Date;
  cpus?: number;
  config?: Partial<WardenConfig>;
  history?: HistoryStore;
}

export const TEST_CONFIG: WardenConfig = {
  repoRoot: '/app',
  appRoot: '/app',
  backendEnvPath: '/app/backend/.env',
  frontendEnvPath: '/app/frontend/.env.production',
  nginxRepoConfPath: '/app/infra/nginx/alloutdoor.conf',
  nginxSitesEnabledDir: '/etc/nginx/sites-enabled',
  nginxAccessLog: '/var/log/nginx/access.log',
  nginxErrorLog: '/var/log/nginx/error.log',
  backupScriptPath: '/app/infra/backup/backup.sh',
  backupDir: '/var/backups/alloutdoor',
  secureUploadDir: '/home/alloutdoor/secure-uploads',
  cipSheetsDir: '/home/alloutdoor/data/cip',
  prismaMigrationsDir: '/app/backend/prisma/migrations',
  publicHost: 'alloutdoor.co.za',
  apiBaseUrl: 'http://127.0.0.1:3001/api',
  pm2Processes: ['alloutdoor-backend', 'alloutdoor-frontend'],
  pm2MemoryCeilings: { 'alloutdoor-backend': 768 * 1024 * 1024, 'alloutdoor-frontend': 512 * 1024 * 1024 },
  historyPath: '/app/warden-state/history.json',
};

export function fakeContext(world: FakeWorld = {}): CheckContext {
  const now = world.now ?? new Date('2026-09-03T08:00:00.000Z');
  return {
    now: () => now,
    config: { ...TEST_CONFIG, ...world.config },
    history: world.history ?? new MemoryHistory(),
    cpuCount: () => world.cpus ?? 4,

    async run(file, args): Promise<RunOutcome> {
      const key = [file, ...args].join(' ');
      const hit = world.commands?.[key];
      if (!hit) {
        // Shaped like a real ENOENT from execFile: no exit code, a reason
        // on stderr. Never exit 0 with empty stdout, which is what would
        // let a check mistake "not run" for "nothing found".
        return { exitCode: null, stdout: '', stderr: `fake world has no command: ${key}`, timedOut: false };
      }
      return { exitCode: hit.exitCode ?? 0, stdout: hit.stdout ?? '', stderr: hit.stderr ?? '', timedOut: hit.timedOut ?? false };
    },

    async readFile(path): Promise<Attempt<string>> {
      const text = world.files?.[path];
      return text === undefined ? failed<string>(`${path} does not exist`) : attempt(text);
    },

    async stat(path): Promise<Attempt<FileStat>> {
      const s = world.stats?.[path];
      return s === undefined
        ? failed<FileStat>(`${path} does not exist`)
        : attempt({ path, sizeBytes: 0, mtime: now.toISOString(), isDirectory: false, ...s });
    },

    async listDir(path): Promise<Attempt<string[]>> {
      const entries = world.dirs?.[path];
      return entries === undefined ? failed<string[]>(`${path} does not exist`) : attempt(entries);
    },

    async queryDb(sql): Promise<Attempt<string[][]>> {
      return world.db ? world.db(sql) : failed<string[][]>('psql failed: fake world has no database');
    },

    async httpGetJson(url): Promise<Attempt<HttpJsonResponse>> {
      return world.http ? world.http(url) : failed<HttpJsonResponse>('request failed: fake world has no HTTP');
    },

    async tlsChain(host, port): Promise<Attempt<TlsChainInfo>> {
      return world.tls ?? failed<TlsChainInfo>(`cannot reach ${host}:${port} — fake world has no network`);
    },
  };
}
