// warden/src/server.test.ts
//
// The front door. Real sockets, real fetch, real JSON — the routing and the
// auth are exactly the sort of thing that looks obviously right and is wrong
// in one branch, so this drives the server rather than the functions inside it.
//
// The two properties that matter most here:
//   · NOTHING answers without the token, including the routes that only read.
//   · The statuses are load-bearing. The backend maps 404 and 409 to their own
//     exceptions and turns everything else into a generic 503 with the body
//     discarded — so an approve refusal that came back as 500 would reach the
//     operator as "Warden is down" instead of "that changed since you opened it".

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from './server.js';
import { WardenCore, WardenStore } from './state/index.js';
import { createSweepMemory } from './checks/index.js';
import { fakeContext } from './checks/testing.js';
import { createRuntime } from './exec/index.js';
import type { DraftedProposal } from './diagnose/index.js';

const TOKEN = 'a-token-long-enough-to-be-real-0123456789';
const AT = new Date('2026-09-03T08:00:00.000Z');

interface Served {
  url: string;
  core: WardenCore;
  store: WardenStore;
  close: () => Promise<void>;
}

async function serve(): Promise<Served> {
  const store = new WardenStore({ filePath: null, now: () => AT });
  const core = new WardenCore({
    store,
    ctx: fakeContext({ now: AT }),
    memory: createSweepMemory(),
    caller: null,
    checks: [],
    now: () => AT,
    exec: createRuntime({ async runPlan() { return { exitCode: 0, stdout: '', stderr: '', timedOut: false }; } }),
  });
  const server = createServer({ core, token: TOKEN });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    core,
    store,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, accept: 'application/json', ...extra };
}

let seq = 0;
function drafted(over: Partial<DraftedProposal> = {}): DraftedProposal {
  seq += 1;
  return {
    id: `prop_srv_${seq}`,
    kind: 'proposal',
    status: 'pending',
    headline: 'Reload the frontend',
    diagnosis: 'It is serving stale chunks.',
    command: 'pm2 reload alloutdoor-frontend --update-env',
    gateKey: null,
    raisedAt: AT.toISOString(),
    operation: { name: 'restartProcess', args: { process: 'alloutdoor-frontend' } },
    reversible: true,
    checkIds: [],
    ...over,
  };
}

// ── auth ────────────────────────────────────────────────────────────────

test('EVERY route refuses without a token — there is no unauthenticated liveness ping', async () => {
  const s = await serve();
  try {
    const routes: Array<[string, string, unknown]> = [
      ['GET', '/chat', undefined],
      ['POST', '/chat', { message: 'hi', operatorId: 'a' }],
      ['GET', '/gates', undefined],
      ['GET', '/proposals/prop_1', undefined],
      ['POST', '/proposals/prop_1/approve', { operatorId: 'a', expectedCommand: 'x' }],
      ['POST', '/proposals/prop_1/decline', { operatorId: 'a' }],
    ];
    for (const [method, path, body] of routes) {
      const res = await fetch(`${s.url}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(res.status, 401, `${method} ${path} answered ${res.status} without a token`);
    }
  } finally {
    await s.close();
  }
});

test('a wrong token, a malformed header and an empty bearer are all the same 401 — nothing is learned from which', async () => {
  const s = await serve();
  try {
    for (const header of [`Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(0, -1)}`, 'Bearer ', TOKEN, 'Basic abc', '']) {
      const res = await fetch(`${s.url}/chat`, { headers: { authorization: header } });
      assert.equal(res.status, 401, `header ${JSON.stringify(header)} should not have been accepted`);
    }
    assert.equal((await fetch(`${s.url}/chat`, { headers: auth() })).status, 200);
  } finally {
    await s.close();
  }
});

test('auth is checked BEFORE the body is read — an unauthenticated caller cannot make this process buffer a megabyte', async () => {
  const s = await serve();
  try {
    const res = await fetch(`${s.url}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x'.repeat(2_000_000), operatorId: 'a' }),
    });
    // 401, not 413: we never got as far as measuring the body.
    assert.equal(res.status, 401);
  } finally {
    await s.close();
  }
});

// ── the wire shape ──────────────────────────────────────────────────────

test('GET /chat answers the three keys the backend reads, and lastCheckAt is null rather than a synthesized now', async () => {
  const s = await serve();
  try {
    const res = await fetch(`${s.url}/chat`, { headers: auth() });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['lastCheckAt', 'messages', 'proposals']);
    assert.equal(body.lastCheckAt, null);
  } finally {
    await s.close();
  }
});

test('GET /proposals/:id returns the proposal itself, not wrapped — that is what the backend normalises', async () => {
  const s = await serve();
  try {
    const p = await s.store.raise(drafted());
    assert.ok(p);
    const res = await fetch(`${s.url}/proposals/${p.id}`, { headers: auth() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.id, p.id);
    assert.equal(body.kind, 'proposal');
    assert.equal(body.status, 'pending');
    assert.equal(body.command, 'pm2 reload alloutdoor-frontend --update-env');
  } finally {
    await s.close();
  }
});

test('POST /chat returns ONLY the messages this exchange added, under a "messages" key', async () => {
  const s = await serve();
  try {
    const res = await fetch(`${s.url}/chat`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ message: 'remember: leave the overnight retries alone', operatorId: 'admin_1' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { messages: Array<{ role: string; kind: string }> };
    assert.deepEqual(Object.keys(body), ['messages']);
    assert.equal(body.messages[0]!.role, 'operator');
    assert.ok(body.messages.length >= 2);
  } finally {
    await s.close();
  }
});

// ── ids in the URL ──────────────────────────────────────────────────────

test('an id outside the charset never reaches the store — 404, indistinguishable from not found', async () => {
  const s = await serve();
  try {
    for (const id of ['prop:1', 'prop.1', '..', '%2e%2e', 'a'.repeat(65), '', 'p%20q']) {
      const res = await fetch(`${s.url}/proposals/${id}`, { headers: auth() });
      assert.ok(res.status === 404 || res.status === 405, `id ${JSON.stringify(id)} answered ${res.status}`);
    }
  } finally {
    await s.close();
  }
});

test('a proposal that does not exist is 404 — the status the backend turns into "Warden has no such proposal"', async () => {
  const s = await serve();
  try {
    assert.equal((await fetch(`${s.url}/proposals/prop_nothing`, { headers: auth() })).status, 404);
  } finally {
    await s.close();
  }
});

// ── approve and decline, end to end ─────────────────────────────────────

test('approving a RED GATE is 400 and approving a drifted command is 409 — the two statuses the operator must be able to tell apart', async () => {
  const s = await serve();
  try {
    const gate = await s.store.raise(drafted({ kind: 'red_gate', command: null, operation: null, gateKey: 'BACKUP_SET_CIP' }));
    const prop = await s.store.raise(drafted());
    assert.ok(gate && prop);

    const gateRes = await fetch(`${s.url}/proposals/${gate.id}/approve`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ operatorId: 'admin_1', expectedCommand: 'anything' }),
    });
    assert.equal(gateRes.status, 400);

    const driftRes = await fetch(`${s.url}/proposals/${prop.id}/approve`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ operatorId: 'admin_1', expectedCommand: 'pm2 reload alloutdoor-frontend --update-env ' }),
    });
    assert.equal(driftRes.status, 409);
    assert.equal(s.store.getProposal(prop.id)!.status, 'pending');
  } finally {
    await s.close();
  }
});

test('approve answers 200 with the started message and does not hold the connection open for the run', async () => {
  const s = await serve();
  try {
    const p = await s.store.raise(drafted());
    assert.ok(p);
    const started = Date.now();
    const res = await fetch(`${s.url}/proposals/${p.id}/approve`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ operatorId: 'admin_1', expectedCommand: p.command }),
    });
    assert.equal(res.status, 200);
    assert.ok(Date.now() - started < 2_000);
    const body = (await res.json()) as { messages: unknown[] };
    assert.deepEqual(Object.keys(body), ['messages']);
    assert.equal(body.messages.length, 1);
    await s.core.drain();
  } finally {
    await s.close();
  }
});

test('a decline with NO reason key is the same as one with an empty reason — neither stores a blank standing instruction', async () => {
  const s = await serve();
  try {
    const a = await s.store.raise(drafted({ command: 'a' }));
    const b = await s.store.raise(drafted({ command: 'b' }));
    assert.ok(a && b);

    // Exactly what the backend sends when the operator typed nothing: the key
    // is absent, because JSON.stringify drops an undefined property.
    const res = await fetch(`${s.url}/proposals/${a.id}/decline`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ operatorId: 'admin_1', reason: undefined }),
    });
    assert.equal(res.status, 200);

    await fetch(`${s.url}/proposals/${b.id}/decline`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ operatorId: 'admin_1', reason: '   ' }),
    });

    assert.equal(s.store.standingInstructions().length, 0);
    assert.equal(s.store.getProposal(a.id)!.status, 'declined');
    assert.equal(s.store.getProposal(b.id)!.status, 'declined');
  } finally {
    await s.close();
  }
});

test('a decline WITH a reason records it as a standing instruction', async () => {
  const s = await serve();
  try {
    const p = await s.store.raise(drafted());
    assert.ok(p);
    await fetch(`${s.url}/proposals/${p.id}/decline`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ operatorId: 'admin_1', reason: 'Leave overnight retries alone.' }),
    });
    assert.deepEqual(s.store.standingInstructions().map((i) => i.text), ['Leave overnight retries alone.']);
  } finally {
    await s.close();
  }
});

// ── bodies and methods ──────────────────────────────────────────────────

test('a missing operatorId or expectedCommand is 400, never a run with a blank operator', async () => {
  const s = await serve();
  try {
    const p = await s.store.raise(drafted());
    assert.ok(p);
    const cases: Array<[string, unknown]> = [
      ['/chat', { message: 'hi' }],
      ['/chat', { operatorId: 'a' }],
      ['/chat', { message: '   ', operatorId: 'a' }],
      [`/proposals/${p.id}/approve`, { operatorId: 'admin_1' }],
      [`/proposals/${p.id}/approve`, { expectedCommand: 'x' }],
      [`/proposals/${p.id}/decline`, { reason: 'no' }],
    ];
    for (const [path, body] of cases) {
      const res = await fetch(`${s.url}${path}`, {
        method: 'POST',
        headers: auth({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, `${path} with ${JSON.stringify(body)} answered ${res.status}`);
    }
    assert.equal(s.store.getProposal(p.id)!.status, 'pending');
  } finally {
    await s.close();
  }
});

test('a body that is not JSON is 400, and an enormous one is 413 rather than being buffered whole', async () => {
  const s = await serve();
  try {
    const bad = await fetch(`${s.url}/chat`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: 'not json at all',
    });
    assert.equal(bad.status, 400);

    const huge = await fetch(`${s.url}/chat`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ message: 'x'.repeat(500_000), operatorId: 'a' }),
    }).catch(() => null);
    // The server destroys the request once the cap is passed; depending on
    // timing the client sees the 413 or a torn-down connection. Either way it
    // did not accept half a megabyte of chat message.
    if (huge) assert.equal(huge.status, 413);
    assert.equal(s.store.snapshot().messages.length, 0);
  } finally {
    await s.close();
  }
});

test('an unknown route is 404 and a wrong method is 405 — neither is a 500', async () => {
  const s = await serve();
  try {
    assert.equal((await fetch(`${s.url}/settings`, { headers: auth() })).status, 404);
    assert.equal((await fetch(`${s.url}/`, { headers: auth() })).status, 404);
    assert.equal((await fetch(`${s.url}/chat`, { method: 'DELETE', headers: auth() })).status, 405);
    assert.equal((await fetch(`${s.url}/gates`, { method: 'POST', headers: auth() })).status, 405);
  } finally {
    await s.close();
  }
});

test('a trailing slash routes the same as none — a base URL with one configured must not 404 the whole daemon', async () => {
  const s = await serve();
  try {
    assert.equal((await fetch(`${s.url}/chat/`, { headers: auth() })).status, 200);
  } finally {
    await s.close();
  }
});

test('GET /gates is served for a curl on the box, and says so honestly before the first sweep', async () => {
  const s = await serve();
  try {
    const res = await fetch(`${s.url}/gates`, { headers: auth() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { counts: unknown; rows: unknown[]; lastCheckAt: unknown };
    assert.equal(body.counts, null, 'no sweep has finished — that is not zero of everything');
    assert.deepEqual(body.rows, []);
  } finally {
    await s.close();
  }
});
