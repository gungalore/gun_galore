// ===========================================================================
// Warden — pm2 process definition
//
// 🚨 .cjs, NOT .js, AND THAT IS LOAD-BEARING. package.json declares
// "type": "module", so a .js file here is evaluated as ESM and `module` is
// not defined — pm2 dies on load with "module is not defined in ES module
// scope" and the process never starts. It shipped as .js and the first-deploy
// procedure below had therefore never once been run end to end.
//
// Warden is a standalone Node service, not part of the Nest backend. It runs
// under pm2 on the SAME box as the API and the frontend, alongside them —
// see infra/pm2/ecosystem.config.js for those two. This file defines only
// this one process, so adding Warden to a box never touches the marketplace
// processes' own definitions.
//
// ---------------------------------------------------------------------------
// FIRST DEPLOY
// ---------------------------------------------------------------------------
//   cd <APP_ROOT>/warden
//   npm ci
//   npm run build              # compiles src/ -> dist/
//   npm run sweep               # SMOKE TEST — see README.md before trusting this
//   pm2 start ecosystem.config.cjs
//   pm2 save
//
// ROUTINE DEPLOYS reload the running process by name, the same way
// deploy.sh reloads the marketplace processes:
//   pm2 reload warden --update-env
//
// ---------------------------------------------------------------------------
// NO SECRETS, NO `env` BLOCK
// ---------------------------------------------------------------------------
// Deliberately absent, for the same reason infra/pm2/ecosystem.config.js
// gives: putting a value here puts it in git. Warden reads its own
// <cwd>/.env on process start (src/index.ts's loadDotEnvFile(), the same job
// backend/src/main.ts's dotenv.config() does) — create
// <APP_ROOT>/warden/.env, mode 600, and put WARDEN_TOKEN, ANTHROPIC_API_KEY
// and DATABASE_URL there. See README.md for the full list and what each one
// gates.
//
// NODE_ENV is set below rather than in .env because it is not a secret and
// pm2's own env block is the conventional place for it (matches the other
// two processes).
// ===========================================================================

/* eslint-disable */

// The one thing to change if you move the checkout. Must match the value
// Warden itself resolves as WARDEN_APP_ROOT (src/checks/context.ts's
// default is /home/alloutdoor/app — override in .env if this box differs).
const APP_ROOT = '/home/alloutdoor/app';

module.exports = {
  apps: [
    {
      name: 'warden',
      cwd: `${APP_ROOT}/warden`,

      // The compiled entry point, not `npm start` — no npm shim between pm2
      // and node, so `pm2 reload` signals the process directly and a
      // graceful shutdown (src/index.ts's SIGTERM handler, which drains any
      // in-flight approved run before exiting) actually reaches it.
      //
      // ⚠️ boot.js, NOT index.js. boot.ts loads .env and THEN dynamically
      // imports the composition root, so module-top-level env reads (the
      // model name, WARDEN_APP_ROOT) see the file. Pointing this back at
      // index.js silently reinstates those as dead overrides — see
      // src/env.ts's header.
      script: 'dist/boot.js',

      exec_mode: 'fork',
      instances: 1,

      // Warden's own loop is a handful of shell-outs and one HTTP server —
      // nowhere near the backend's footprint. Generous relative to expected
      // steady state, tight enough to catch a real leak.
      max_memory_restart: '256M',

      // A daemon that fails closed on a missing WARDEN_TOKEN (see
      // src/index.ts) exits immediately at boot. Without a floor here that
      // would spin at full restart rate; this bounds it the same way the
      // marketplace processes are bounded.
      min_uptime: '20s',
      max_restarts: 10,
      restart_delay: 4000,

      autorestart: true,
      watch: false,

      time: true,
      merge_logs: true,
      error_file: `${APP_ROOT}/logs/warden-error.log`,
      out_file: `${APP_ROOT}/logs/warden-out.log`,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
