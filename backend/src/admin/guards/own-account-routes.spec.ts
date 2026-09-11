import 'reflect-metadata';
import * as adminControllers from '../admin.controller';
import { OWN_ACCOUNT_ROUTE } from '../decorators/own-account-route.decorator';

/**
 * @OwnAccountRoute() is the SECOND hole in AdminJwtGuard's deny-by-default
 * gate, so — exactly like @ReadShapedRoute() — its size is part of the design.
 * This pins WHICH handlers carry it and HOW MANY.
 *
 * ⚠️ A ROUTE MARKED WITH THIS IS A PROMISE THE GUARD CANNOT CHECK: that the
 * handler acts on `@CurrentAdmin().sub` and on NO id taken from the path,
 * query or body. A marked route that accepts a target admin id is a privilege
 * escalation with a comment on it — a monitoring admin could set a Full
 * admin's password, or a recovery-only session could re-enrol somebody else's
 * second factor. If this test fails with a new entry, the question is not
 * "update the list": it is whether that handler can only ever touch the
 * caller's own credential.
 */

const EXPECTED: Array<[string, string]> = [
  // Changes the caller's own password; requires the current one.
  ['AdminAuthController', 'changePassword'],
  // Mints a TOTP secret for the caller and nobody else.
  ['AdminAuthController', 'confirmTotp'],
  ['AdminAuthController', 'enrolTotp'],
  // Ends the caller's own other sessions. Ending ANOTHER admin's is
  // deactivateAdmin, which is SUPERADMIN-gated and audited.
  ['AdminAuthController', 'revokeOtherSessions'],
];

function ownAccountHandlers(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const [name, exported] of Object.entries(adminControllers)) {
    if (typeof exported !== 'function' || !exported.prototype) continue;
    for (const method of Object.getOwnPropertyNames(exported.prototype)) {
      if (method === 'constructor') continue;
      const handler = (exported.prototype as unknown as Record<string, unknown>)[
        method
      ];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata(OWN_ACCOUNT_ROUTE, handler)) found.push([name, method]);
    }
    // A class-level mark would exempt every route on the controller — which
    // on AdminAuthController would hand a read-only admin the login and
    // refresh surface as writes.
    if (Reflect.getMetadata(OWN_ACCOUNT_ROUTE, exported)) found.push([name, '*']);
  }
  return found.sort();
}

describe('@OwnAccountRoute() coverage in admin.controller.ts', () => {
  it('is on exactly the four own-credential writes', () => {
    expect(ownAccountHandlers()).toEqual([...EXPECTED].sort());
  });

  it('is never applied to a whole controller', () => {
    expect(ownAccountHandlers().some(([, method]) => method === '*')).toBe(false);
  });

  it('is NOT on any route that takes a target admin id', () => {
    // ⚠️ The three privilege routes are the ones that must never get it. They
    // are SUPERADMIN-gated by AdminJwtGuard and SuperadminGuard, and audited.
    for (const method of ['create', 'updateRole', 'deactivate']) {
      const handler = (
        adminControllers.AdminAdminsController.prototype as unknown as Record<
          string,
          unknown
        >
      )[method] as object;
      expect(Reflect.getMetadata(OWN_ACCOUNT_ROUTE, handler)).toBeUndefined();
    }
  });
});

/**
 * 🚨 THE REFLECTION SCAN ABOVE ONLY SEES admin.controller.ts, AND THE HATCH IS
 * IMPORTABLE FROM ANYWHERE. Ten-odd other controllers sit behind the same
 * AdminJwtGuard and none of them is imported above, so marking, say,
 * WardenController.approve as an own-account route would sail straight past
 * the inventory it is supposed to be pinned by — and that route is the one
 * that runs a command on the box.
 *
 * A source scan catches it wherever it is written, including in a controller
 * that does not exist yet. Text rather than reflection on purpose: importing
 * every admin controller drags its whole provider graph into a unit test, and
 * the thing being asserted is "did somebody type this", which is a property
 * of the source. Copied from read-shaped-routes.spec.ts, including its
 * line-ending lesson — see the CRLF note below.
 */
describe('@OwnAccountRoute() nowhere else in the tree', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');

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
        if (
          full.includes(path.join('decorators', 'own-account-route.decorator.ts'))
        ) {
          continue;
        }
        if (full.includes(path.join('guards', 'admin-jwt.guard.ts'))) continue;
        if (fs.readFileSync(full, 'utf8').includes('@OwnAccountRoute(')) {
          hits.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(root);
    return hits.sort();
  }

  it('is applied in admin.controller.ts and in no other source file', () => {
    expect(sourcesMentioningHatch()).toEqual(['admin/admin.controller.ts']);
  });

  it('appears exactly four times as a decorator, ignoring comments', () => {
    // ⚠️ THE STRIP MUST NOT DEPEND ON LINE ENDINGS. Written as
    // `line.replace(/\/\/.*$/, '')` this silently stops working on a CRLF
    // checkout: `.` does not match `\r`, so `.*` halts before it, and `$`
    // without `m` matches only at end-of-string. The comment then survives
    // the strip and is counted as an extra application — which is exactly
    // how the read-shaped spec failed on a Windows checkout, reporting a
    // hatch nobody had added. `[^\n]*` needs no anchor and cannot care.
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'admin.controller.ts'),
      'utf8',
    );
    const applied =
      src
        .split('\n')
        .map((line) => line.replace(/\/\/[^\n]*/, ''))
        .join('\n')
        .match(/@OwnAccountRoute\(/g) ?? [];
    expect(applied).toHaveLength(EXPECTED.length);
  });
});
