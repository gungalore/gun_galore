import 'reflect-metadata';
import * as adminControllers from '../admin.controller';
import { READ_SHAPED_ROUTE } from '../decorators/read-shaped-route.decorator';

/**
 * The escape hatch is a hole in a deny-by-default gate, so its size is part
 * of the design. This pins WHICH routes are marked and, just as importantly,
 * HOW MANY — adding a third one to admin.controller.ts fails here and forces
 * the decision to be looked at rather than merely typed.
 */

const EXPECTED: Array<[string, string]> = [
  // Counts recipients for a broadcast; sends nothing, writes nothing.
  ['AdminBroadcastController', 'preview'],
  // Connectivity/balance probe per service; writes no row of ours.
  ['AdminCreditsController', 'test'],
];

function readShapedHandlers(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const [name, exported] of Object.entries(adminControllers)) {
    if (typeof exported !== 'function' || !exported.prototype) continue;
    for (const method of Object.getOwnPropertyNames(exported.prototype)) {
      if (method === 'constructor') continue;
      const handler = (exported.prototype as unknown as Record<string, unknown>)[method];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata(READ_SHAPED_ROUTE, handler)) found.push([name, method]);
    }
    // A class-level mark would exempt every route on the controller.
    if (Reflect.getMetadata(READ_SHAPED_ROUTE, exported)) found.push([name, '*']);
  }
  return found.sort();
}

describe('@ReadShapedRoute() coverage in admin.controller.ts', () => {
  it('is on exactly the routes that only read', () => {
    expect(readShapedHandlers()).toEqual([...EXPECTED].sort());
  });

  it('is never applied to a whole controller', () => {
    expect(readShapedHandlers().some(([, method]) => method === '*')).toBe(false);
  });

  it('is not on the insights digest generate route, which writes and spends', () => {
    const handler = adminControllers.AdminAnalyticsController.prototype
      .generateDigest as unknown as object;
    expect(Reflect.getMetadata(READ_SHAPED_ROUTE, handler)).toBeUndefined();
  });
});

/**
 * 🚨 THE RELECTION SCAN ABOVE ONLY SEES admin.controller.ts, AND THE HATCH IS
 * IMPORTABLE FROM ANYWHERE. Adversarial review caught this: the decorator is
 * exported, ~10 other controllers sit behind the same AdminJwtGuard, and none
 * of them is imported above — so marking, say, WardenController.chat as
 * read-shaped would sail past the inventory it was supposed to be pinned by.
 *
 * A source scan of the whole tree catches it wherever it is written, including
 * in a controller that does not exist yet. Text rather than reflection on
 * purpose: importing every admin controller drags their whole provider graph
 * into a unit test, and the thing being asserted is "did somebody type this",
 * which is a property of the source.
 */
describe('@ReadShapedRoute() nowhere else in the tree', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');

  /** Every .ts under src/, excluding the decorator's own definition and the
   *  specs that legitimately name it. */
  function sourcesMentioningHatch(): string[] {
    const root = path.join(__dirname, '..', '..');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (entry.name.endsWith('.spec.ts')) continue;
        if (full.includes(path.join('decorators', 'read-shaped-route.decorator.ts'))) continue;
        if (full.includes(path.join('guards', 'admin-jwt.guard.ts'))) continue;
        if (fs.readFileSync(full, 'utf8').includes('@ReadShapedRoute(')) {
          hits.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(root);
    return hits.sort();
  }

  it('is applied in admin.controller.ts and in no other source file', () => {
    // If this fails with a new file, the question is not "update the list" —
    // it is whether that route genuinely only reads, and whether a
    // monitoring admin should reach it at all.
    expect(sourcesMentioningHatch()).toEqual(['admin/admin.controller.ts']);
  });

  it('appears exactly twice as a decorator, ignoring the warning comments', () => {
    // ⚠️ COUNT APPLICATIONS, NOT MENTIONS. admin.controller.ts carries a
    // deliberate counter-comment on the insights digest route — "Never give
    // this @ReadShapedRoute()" — and a naive match counts it as a third use.
    // That comment is doing real work for the next reader, so the test strips
    // line comments rather than asking anyone to delete it.
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'admin.controller.ts'),
      'utf8',
    );
    //
    // 🚨 AND THE STRIP MUST NOT DEPEND ON LINE ENDINGS. This was written as
    // `line.replace(/\/\/.*$/, '')`, which silently stops working the moment
    // the file is CRLF: `.` does not match `\r`, so `.*` halts before it, and
    // `$` without the `m` flag matches only at end-of-string or before a
    // trailing `\n` — never before a `\r`. The comment then survives the strip
    // and is counted as a third application. It failed exactly that way on a
    // Windows checkout, reporting a hatch nobody had added.
    //
    // `[^\n]*` needs no anchor and cannot care.
    const applied =
      src
        .split('\n')
        .map((line) => line.replace(/\/\/[^\n]*/, ''))
        .join('\n')
        .match(/@ReadShapedRoute\(/g) ?? [];
    expect(applied).toHaveLength(EXPECTED.length);
  });
});
