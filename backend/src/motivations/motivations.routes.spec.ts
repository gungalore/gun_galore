import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MotivationsController } from './motivations.controller';

// ────────────────────────────────────────────────────────────────────
// THE FRONTEND CALLS ROUTES THAT EXIST.
//
// ⚠️ THIS EXISTS BECAUSE I SHIPPED THE OPPOSITE. On 2026-08-19 the multi-file
// upload went out with a frontend that POSTed an empty document type and
// PATCHed :id/uploads/:uploadId — while the controller still demanded a valid
// type and had no PATCH route at all. Both halves type-checked perfectly,
// every unit test passed, and the feature was simply broken in production:
// nothing on either side of the wire knows what the other side offers.
//
// A path is a string on one side and a decorator on the other, so nothing in
// the compiler connects them. This does.
// ────────────────────────────────────────────────────────────────────

/** `/${id}/uploads/${uploadId}` and `:id/uploads/:uploadId` become the same. */
function shape(p: string): string {
  return (
    p
      .replace(/\$\{[^}]*\}/g, ':p')
      .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':p')
      .replace(/^\/+|\/+$/g, '') || '/'
  );
}

/** Every path the API client asks for, with its method. */
function clientCalls(): { method: string; path: string }[] {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../frontend/lib/motivations-api.ts'),
    'utf8',
  );
  const out: { method: string; path: string }[] = [];
  // request<...>(t, `/${id}/uploads`, { method: 'PATCH', ... })
  const re = /request<[^>]*>\(\s*\w+\s*,\s*`([^`]*)`([\s\S]{0,160}?)\)/g;
  for (const m of src.matchAll(re)) {
    const method = /method:\s*'(\w+)'/.exec(m[2])?.[1] ?? 'GET';
    out.push({ method: method.toUpperCase(), path: shape(m[1]) });
  }
  return out;
}

/** Every route the controller actually exposes. */
function controllerRoutes(): Set<string> {
  const proto = MotivationsController.prototype as Record<string, unknown>;
  const routes = new Set<string>();
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const routePath = Reflect.getMetadata('path', handler);
    const method = Reflect.getMetadata('method', handler);
    if (routePath === undefined || method === undefined) continue;
    // Nest's RequestMethod enum: 0 GET, 1 POST, 2 PUT, 3 DELETE, 4 PATCH.
    const verb =
      ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][method as number] ?? 'GET';
    routes.add(`${verb} ${shape(String(routePath))}`);
  }
  return routes;
}

describe('the wire between the wizard and the API', () => {
  const routes = controllerRoutes();
  const calls = clientCalls();

  it('reads real routes off the controller, so this test is not vacuous', () => {
    expect(routes.size).toBeGreaterThan(5);
    expect(calls.length).toBeGreaterThan(5);
  });

  it('exposes every route the frontend calls', () => {
    const missing = calls
      .map((c) => `${c.method} ${c.path}`)
      .filter((r, i, a) => a.indexOf(r) === i)
      .filter((r) => !routes.has(r));
    expect(missing).toEqual([]);
  });

  it('offers the refile route the batch upload depends on', () => {
    // Naming it explicitly: without this the "change what we filed it as"
    // dropdown 404s, and a mislabelled document stays mislabelled — which the
    // required-documents list then counts as satisfied.
    expect([...routes]).toContain('PATCH :p/uploads/:p');
  });
});
