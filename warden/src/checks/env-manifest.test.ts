// warden/src/checks/env-manifest.test.ts
//
// 🚨 THE SECRET TEST. The env check exists to report PRESENCE, and a
// regression here would put a live API key into a chat message, a proposal
// and a model prompt in one go. So this asserts on the SERIALISED result:
// whatever the check's internals do, the value must not be anywhere in
// what leaves it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { backendEnvCheck, frontendEnvCheck, valueForEvidence } from './env-manifest.js';
import { runOne } from './engine.js';
import { fakeContext } from './testing.js';
import { parseEnvPresence } from './lib/parse.js';
import { NON_SECRET_ENV_KEYS } from './env-manifest.data.js';

const SECRET = 'sk-live-DO-NOT-PRINT-4a9f2b';

const ENV_WITH_SECRETS = [
  '# a comment',
  'JWT_ADMIN_SECRET=' + SECRET,
  'DATABASE_URL=postgresql://app:hunter2@127.0.0.1:5432/alloutdoor',
  'ANTHROPIC_API_KEY="' + SECRET + '"',
  'PAYMENT_MODE=paygate',
  'PAYMENTS_LIVE=false',
  'NODE_ENV=production',
  'EMPTY_ON_PURPOSE=',
].join('\n');

test('a secret’s VALUE never appears anywhere in the emitted result', async () => {
  const ctx = fakeContext({ files: { '/app/backend/.env': ENV_WITH_SECRETS } });
  const result = await runOne(backendEnvCheck, ctx);
  const serialised = JSON.stringify(result);

  assert.equal(serialised.includes(SECRET), false, 'a secret value escaped the env check');
  assert.equal(serialised.includes('hunter2'), false, 'a database password escaped the env check');
  // Presence and shape only.
  assert.match(serialised, /JWT_ADMIN_SECRET \(\d+ chars\)/);
});

test('an allowlisted mode value IS shown — that is the deliberate exception, and it is the finding', async () => {
  const ctx = fakeContext({ files: { '/app/backend/.env': ENV_WITH_SECRETS } });
  const result = await runOne(backendEnvCheck, ctx);
  const modes = result.evidence.filter((e) => e.label === 'set · PAYMENT_MODE' || e.label === 'set · NODE_ENV');
  assert.deepEqual(
    modes.map((m) => `${m.label}=${m.value}`).sort(),
    ['set · NODE_ENV=production', 'set · PAYMENT_MODE=paygate'],
  );
});

test('a missing fails-closed variable is bad, and the row says what it disables', async () => {
  const ctx = fakeContext({ files: { '/app/backend/.env': 'PAYMENT_MODE=paygate\n' } });
  const result = await runOne(backendEnvCheck, ctx);
  assert.equal(result.status, 'bad');
  assert.match(result.verdict, /JWT_ADMIN_SECRET/);
  const line = result.evidence.find((e) => e.label === 'missing · HEALTH_PING_SECRET');
  assert.ok(line, 'every missing variable gets its own line');
  assert.match(line!.value, /health\/crons/);
});

test('an unreadable env file is unknown — never "nothing is configured"', async () => {
  const result = await runOne(backendEnvCheck, fakeContext());
  assert.equal(result.status, 'unknown');
  assert.match(result.reason ?? '', /does not exist/);
});

test('the frontend check states the build-time caveat rather than implying it read the live bundle', async () => {
  const ctx = fakeContext({
    files: {
      '/app/frontend/.env.production': 'NEXT_PUBLIC_API_URL=https://alloutdoor.co.za/api\nNEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_x\nCLERK_SECRET_KEY=sk_live_y\n',
    },
  });
  const result = await runOne(frontendEnvCheck, ctx);
  const caveat = result.evidence.find((e) => e.label === 'caveat');
  assert.ok(caveat, 'the frontend env row must carry the build-time caveat');
  assert.match(caveat!.value, /baked into the bundle at build time/);
});

test('set-but-empty is NOT configured — the same rule the app itself uses', () => {
  const present = parseEnvPresence('A=\nB=   \nC=x\nD="  "\n');
  assert.equal(present.has('A'), false);
  assert.equal(present.has('B'), false);
  assert.equal(present.has('C'), true);
  assert.equal(present.has('D'), true, 'a quoted whitespace value is a deliberate value, not an empty one');
});

test('the emit gate refuses a non-allowlisted value even when one is handed to it', () => {
  // The second layer, tested on its own. The parser already refuses to
  // carry a non-allowlisted value this far, so an end-to-end test cannot
  // see this gate fail — hence a direct one.
  assert.equal(valueForEvidence('JWT_ADMIN_SECRET', { length: 32, value: SECRET }), null);
  assert.equal(valueForEvidence('RESEND_API_KEY', { length: 40, value: 're_live_abc' }), null);
  assert.equal(valueForEvidence('PAYMENT_MODE', { length: 7, value: 'paygate' }), 'paygate');
  assert.equal(valueForEvidence('PAYMENT_MODE', { length: 7 }), null);
});

test('the parser only carries a value out for an allowlisted key', () => {
  const present = parseEnvPresence('PAYMENT_MODE=paygate\nJWT_ADMIN_SECRET=' + SECRET + '\n', NON_SECRET_ENV_KEYS);
  assert.equal(present.get('PAYMENT_MODE')?.value, 'paygate');
  assert.equal(present.get('JWT_ADMIN_SECRET')?.value, undefined);
  assert.equal(present.get('JWT_ADMIN_SECRET')?.length, SECRET.length);
});
