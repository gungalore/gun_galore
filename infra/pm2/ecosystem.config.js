// ===========================================================================
// All Outdoor — pm2 process definitions
//
// The two marketplace processes as they actually run in production, written
// out as a proper ecosystem file. Until now they existed only as pm2's own
// dump (~/.pm2/dump.pm2) on the server, created by hand with `pm2 start`.
// That means a rebuilt box had no way to recreate them. This file is that way.
//
// ---------------------------------------------------------------------------
// USING IT
// ---------------------------------------------------------------------------
//   pm2 start  infra/pm2/ecosystem.config.js          # first time
//   pm2 reload infra/pm2/ecosystem.config.js          # after changing THIS file
//   pm2 save                                          # persist across reboot
//
// Routine code deploys do NOT go through this file — they reload the running
// process by name (`pm2 reload gungalore-backend --update-env`). See
// docs/DEPLOYMENT.md. You only touch the ecosystem file when the process
// DEFINITION changes: script path, memory ceiling, instance count.
//
// ADOPTING THIS ON THE LIVE BOX IS AN OPERATOR DECISION, NOT A DEPLOY STEP.
// The running processes were created without an ecosystem file, so pm2 will
// not merge into them cleanly. The changeover is:
//     mkdir -p /home/gungalore/app/logs     # pm2 will not create it for you
//     pm2 delete gungalore-backend gungalore-frontend
//     pm2 start infra/pm2/ecosystem.config.js
//     pm2 save
// That is a hard restart of both services — a few seconds of 502s. Do it in a
// quiet window, not in the middle of a deploy.
//
// ---------------------------------------------------------------------------
// NO SECRETS, NO `env` BLOCK
// ---------------------------------------------------------------------------
// Deliberately absent. Both apps read their own .env from disk:
//   • backend  — `dotenv.config({ override: true })` is the FIRST thing
//                backend/src/main.ts does, before Nest instantiates anything.
//                It reads backend/.env, and `override: true` is load-bearing:
//                some shells export ANTHROPIC_API_KEY as an empty string, and
//                without override dotenv leaves the empty value in place.
//   • frontend — Next reads frontend/.env.production at build and at runtime.
//                NEXT_PUBLIC_* values are inlined at BUILD time, so changing
//                one needs a rebuild, not just a restart.
// Putting values here would put them in git. Never do it.
// ===========================================================================

/* eslint-disable */

// The one thing to change if you move the checkout. Everything else derives
// from it. Production: /home/gungalore/app
const APP_ROOT = '/home/gungalore/app';

module.exports = {
  apps: [
    {
      // ── NestJS API, listening on :3001 ────────────────────────────────
      name: 'gungalore-backend',
      cwd: `${APP_ROOT}/backend`,

      // Run the compiled entry point DIRECTLY. Not `npm run start:prod`, not
      // `nest start`. Two reasons:
      //  1. No npm shim process in between, so `pm2 reload` signals node
      //     itself and a graceful shutdown actually reaches the app.
      //  2. `nest start` would recompile. In production the build is a
      //     separate, gated step (docs/DEPLOYMENT.md) precisely so that a
      //     failing build can never take the running process with it.
      //
      // The path is `dist/src/main.js`, not `dist/main.js`. That extra `src`
      // comes from backend/nest-cli.json (`"outDir": "dist/src"`). Get it
      // wrong and pm2 crash-loops with MODULE_NOT_FOUND.
      script: 'dist/src/main.js',

      // Fork, not cluster. The backend is NOT cluster-safe: @nestjs/schedule
      // runs ~26 crons in-process (payouts, auction close, index rebuilds,
      // digest emails). Under cluster mode every worker would fire every cron
      // — duplicate payouts, duplicate SMS. If you ever need more throughput,
      // the fix is to split the crons into a separate single-instance worker
      // process FIRST. Do not just raise `instances`.
      exec_mode: 'fork',
      instances: 1,

      // See the memory note at the bottom of this file.
      max_memory_restart: '768M',

      // Never auto-restart faster than this. A backend that dies at boot
      // (missing JWT_ADMIN_SECRET makes main.ts throw on purpose) would
      // otherwise spin at full CPU and starve the box while you SSH in.
      min_uptime: '20s',
      max_restarts: 10,
      restart_delay: 4000,

      autorestart: true,
      watch: false,

      // Timestamped logs. pm2's default has no dates, which makes correlating
      // a 500 with an nginx access-log line unnecessarily annoying.
      time: true,
      merge_logs: true,
      error_file: `${APP_ROOT}/logs/backend-error.log`,
      out_file: `${APP_ROOT}/logs/backend-out.log`,

      // NODE_ENV is the one variable that must be set here rather than in
      // .env: main.ts's `assertProductionConfig()` gate keys off it, and so
      // does Prisma's connection pooling. It is not a secret.
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },

    {
      // ── Next.js server, listening on :3000 ────────────────────────────
      name: 'gungalore-frontend',
      cwd: `${APP_ROOT}/frontend`,

      // `npm start` → `next start`. Unlike the backend there is no stable
      // single-file entry point to invoke; `next start` is the supported way
      // to serve a production build and it reads .next/ for the route
      // manifest. The absolute path to npm avoids depending on whatever PATH
      // pm2 inherited from the shell that first started it — if npm is
      // installed under nvm rather than the distro package, change this to
      // the output of `which npm`.
      script: '/usr/bin/npm',
      args: 'start',

      exec_mode: 'fork',
      instances: 1,

      max_memory_restart: '512M',

      min_uptime: '20s',
      max_restarts: 10,
      restart_delay: 4000,

      autorestart: true,
      watch: false,

      time: true,
      merge_logs: true,
      error_file: `${APP_ROOT}/logs/frontend-error.log`,
      out_file: `${APP_ROOT}/logs/frontend-out.log`,

      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};

// ===========================================================================
// WHY max_memory_restart IS SET, AND WHY THE NUMBERS ARE WHAT THEY ARE
// ===========================================================================
// Production had NO memory ceiling on either marketplace process. The
// ballistics app on the same box has had `512M` on both of its processes
// since it was set up — the marketplace was simply never given one.
//
// Measured on 2026-08-12, steady state:
//     gungalore-backend    293 MB
//     gungalore-frontend    70 MB
//
// The current box is 4 vCPU / 7.7 GB with an 8 GB swapfile, so there is a lot
// of headroom today. The reference target — and what a replacement box or a
// staging clone is likely to be — is 2 cores / 4 GB, and on 4 GB the sums are
// tight: PostgreSQL 16 with its shared buffers, Meilisearch holding the
// listing index in memory, two Node processes, and during a deploy a
// `next build --webpack` that peaks well over 2 GB on its own.
//
// A ceiling turns a slow leak into a five-second blip instead of an
// out-of-memory kill. The distinction matters: pm2 restarting a process it
// chose to restart is orderly and logged; the kernel OOM-killer picking a
// victim is not, and on a 4 GB box the biggest RSS is usually PostgreSQL.
// Losing the database because the API leaked is the failure mode being
// prevented here.
//
// 768M for the backend (≈2.5× steady state) leaves room for the legitimate
// spikes: five base64 photos at the 15 MB JSON body limit going to Claude
// vision, PDF generation for SAP 534 transfer forms, and reloading-manual
// ingestion. 512M for the frontend (≈7× steady state) is generous because
// `next start` is mostly serving prebuilt output.
//
// If you see either process restarting on memory in `pm2 list` (the `↺`
// column climbing with no deploys), do NOT just raise the number — that is
// the leak telling you where it is.
// ===========================================================================
