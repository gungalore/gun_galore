import { SetMetadata } from '@nestjs/common';

export const READ_SHAPED_ROUTE = 'admin:read-shaped-route';

/**
 * The ONE escape hatch out of AdminJwtGuard's deny-by-default rule.
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
