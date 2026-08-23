import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MotivationsController } from '../motivations/motivations.controller';
import { MotivationsWitnessController } from '../motivations/motivations-witness.controller';
import { MotivationsConsentController } from '../motivations/motivations-consent.controller';
import { LicenceCentreController } from '../licence-centre/licence-centre.controller';

// ────────────────────────────────────────────────────────────────────
// THE FRONTEND CALLS ROUTES THAT EXIST.
//
// ⚠️ THIS EXISTS BECAUSE I SHIPPED THE OPPOSITE. On 2026-08-19 the multi-file
// upload went out with a frontend that POSTed an empty document type and
// PATCHed :id/uploads/:uploadId, against a backend that did neither. Both
// halves type-checked, all 1627 tests passed, and the feature was dead on
// arrival.
//
// A path is a template string on one side and a decorator on the other, so
// nothing in the compiler connects them. This does.
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

/** Every path an API client asks for, with its method. */
function clientCalls(clientFile: string): string[] {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../frontend/lib', clientFile),
    'utf8',
  );
  const out: string[] = [];
  const re = /request<[^>]*>\(\s*\w+\s*,\s*`([^`]*)`([\s\S]{0,160}?)\)/g;
  for (const m of src.matchAll(re)) {
    const method = (/method:\s*'(\w+)'/.exec(m[2])?.[1] ?? 'GET').toUpperCase();
    out.push(`${method} ${shape(m[1])}`);
  }
  return [...new Set(out)];
}

/** Every route a controller actually exposes, off its Nest metadata. */
function controllerRoutes(ctor: new (...args: never[]) => unknown): Set<string> {
  const proto = ctor.prototype as unknown as Record<string, unknown>;
  const routes = new Set<string>();
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const routePath = Reflect.getMetadata('path', handler) as unknown;
    const method = Reflect.getMetadata('method', handler) as unknown;
    if (routePath === undefined || method === undefined) continue;
    // Nest's RequestMethod enum: 0 GET, 1 POST, 2 PUT, 3 DELETE, 4 PATCH.
    const verb =
      ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][method as number] ?? 'GET';
    routes.add(`${verb} ${shape(String(routePath))}`);
  }
  return routes;
}

const PAIRS = [
  {
    name: 'motivation wizard',
    client: 'motivations-api.ts',
    // ⚠️ TWO CONTROLLERS, ONE CLIENT. The witness routes live in their own
    // file because half of that file is PUBLIC — a stranger with a link — and
    // mixing guarded and unguarded handlers in one class is how a guard gets
    // dropped by accident. The contract still has to see both, or this test
    // reports every witness route as one the frontend calls and the server
    // does not have.
    controller: [
      MotivationsController,
      MotivationsWitnessController,
      // The applicant's half of the seller-consent flow. The seller's half is
      // a separate, UNGUARDED controller on its own path prefix and is not
      // called through motivationsApi at all — the person using it has no
      // account and no token — so it is deliberately not in this pairing.
      MotivationsConsentController,
    ],
  },
  {
    name: 'licence centre',
    client: 'licence-centre-api.ts',
    controller: LicenceCentreController,
  },
];

describe.each(PAIRS)('the wire for the $name', ({ client, controller }) => {
  const routes = (Array.isArray(controller) ? controller : [controller])
    .map((c) => controllerRoutes(c))
    .reduce((all, r) => {
      r.forEach((x) => all.add(x));
      return all;
    }, new Set<string>());
  const calls = clientCalls(client);

  it('reads real routes and real calls, so this is not vacuous', () => {
    expect(routes.size).toBeGreaterThan(3);
    expect(calls.length).toBeGreaterThan(3);
  });

  it('exposes every route the frontend calls', () => {
    expect(calls.filter((c) => !routes.has(c))).toEqual([]);
  });
});

describe('routes the batch upload depends on', () => {
  it('lets the wizard refile a document it named for you', () => {
    // Without it the "change what we filed it as" dropdown 404s, and a
    // mislabelled document stays mislabelled — which the required-documents
    // list then counts as satisfied.
    expect([...controllerRoutes(MotivationsController)]).toContain(
      'PATCH :p/uploads/:p',
    );
  });

  it('lets the Licence Centre confirm a document', () => {
    // The confirm step is where the member checks the date, the type and the
    // name of every document we sorted for them.
    expect([...controllerRoutes(LicenceCentreController)]).toContain(
      'POST :p/confirm',
    );
  });
});
