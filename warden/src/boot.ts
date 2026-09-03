// warden/src/boot.ts
//
// THE PROCESS ENTRY POINT. pm2 starts this, not index.js.
//
// 🚨 THIS FILE EXISTS FOR ITS IMPORT ORDER AND NOTHING ELSE. Its only static
// import is the .env loader, which drags none of the app in behind it. The
// loader runs at module scope, and only THEN is the composition root pulled in
// — dynamically, so its whole import graph (checks, diagnose, state, server)
// evaluates against an environment that already has the file's values in it.
//
// index.ts cannot do this itself. ESM evaluates every static import before the
// importing module's first line, so `loadDotEnvFile()` as the first statement
// of main() was already too late for anything read at module top level — which
// is exactly how ANTHROPIC_MODEL_WARDEN, WARDEN_MODEL_TIMEOUT_MS and
// WARDEN_APP_ROOT became silently dead overrides. src/env.ts's header has the
// full account.
//
// ⚠️ DO NOT ADD A STATIC IMPORT OF THE APP TREE TO THIS FILE. One
// `import { anything } from './index.js'` at the top and the ordering this
// file exists to guarantee is gone, with no error and no test failure beyond
// env-order.test.ts. Keep the dynamic import.

import { loadDotEnvFile } from './env.js';

loadDotEnvFile();

const { main, fail } = await import('./index.js');

await main().catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
