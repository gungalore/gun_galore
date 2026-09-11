import { SetMetadata } from '@nestjs/common';

export const READ_SHAPED_ROUTE = 'admin:read-shaped-route';

/**
 * ONE OF TWO escape hatches out of AdminJwtGuard's deny-by-default rule.
 *
 * ⚠️ IT SAID "THE ONE" UNTIL 2026-09-11, AND BY THEN IT WAS NOT. The admin
 * auth hardening added a second marker — see own-account-route.decorator.ts —
 * and the guard now checks this one and then that one, in that order. A
 * reader auditing the gate from this file alone would have counted one hole
 * and found two, which is the worst way to be wrong about a trust boundary.
 * The two are different promises and must stay different decorators:
 *
 *   - THIS one says "this mutating verb writes NOTHING".
 *   - The own-account one says "this writes, and the only thing it writes is
 *     the caller's own credential — their password, their TOTP secret, their
 *     sessions".
 *
 * ⚠️ DO NOT WRITE THE OTHER DECORATOR'S NAME WITH ITS LEADING @ AND BRACKET
 * ANYWHERE IN THIS FILE, which is why the sentences above name the file
 * instead. own-account-routes.spec.ts scans every non-spec source in the tree
 * for that exact string — text, not reflection, so it catches a hatch typed
 * into a controller that does not exist yet — and it exempts only that
 * decorator's own file and the guard. A mention in a comment here is
 * indistinguishable from an application and fails the inventory.
 *
 * If a third hatch is ever added, update this list in the same commit. No
 * test can count holes for you: the guard reads metadata keys, so a new hatch
 * is a new key and nothing here breaks.
 *
 * That rule is on the HTTP method, not on a list of protected routes:
 * anything that isn't GET/HEAD/OPTIONS needs SUPERADMIN. It fails closed,
 * which is the right direction for an authorization control — a mutating
 * route added next month is covered without anyone remembering to cover it.
 *
 * The price of that is a false denial on the handful of routes that use a
 * mutating verb but only READ: a search with filters in the body, a preview,
 * a probe. Mark those — and ONLY those — with this decorator so a read-only
 * admin isn't blocked from a button that changes nothing.
 *
 * ⚠️ LOAD-BEARING: every use of this is a hole in the gate. A denied read is
 * a safe failure; a permitted write is not. Before adding one, follow the
 * handler into the service and confirm it writes NOTHING — no Prisma write,
 * no outbound send, no third-party state change. If in doubt, leave it off.
 * Each use carries a one-line comment saying why the route is a read.
 */
export const ReadShapedRoute = () => SetMetadata(READ_SHAPED_ROUTE, true);
