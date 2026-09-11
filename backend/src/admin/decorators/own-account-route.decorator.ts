import { SetMetadata } from '@nestjs/common';

export const OWN_ACCOUNT_ROUTE = 'admin:own-account-route';

/**
 * The SECOND hole in AdminJwtGuard's deny-by-default rule — and a different
 * shape of hole from the read-shaped one, which is why it is a different
 * decorator rather than a second use of that one.
 *
 * ReadShapedRoute says "this mutating verb writes NOTHING".
 * OwnAccountRoute says "this writes, and what it writes is the CALLER'S OWN
 * credential — their password, their TOTP secret, their sessions".
 *
 * ⚠️ DO NOT WRITE THE OTHER DECORATOR'S NAME WITH ITS LEADING @ ANYWHERE IN
 * THIS FILE. read-shaped-routes.spec.ts scans the whole source tree for that
 * exact string — text, not reflection, so it catches a hatch typed into a
 * controller that does not exist yet — and a mention in a comment is
 * indistinguishable from an application. It failed exactly that way the first
 * time this file was written.
 *
 * ⚠️ WITHOUT THIS, THE HARDENING DEADLOCKS A MONITORING ADMIN. The guard
 * refuses every non-GET to anyone who is not SUPERADMIN. Changing your own
 * password is a POST. So is enrolling a second factor. A read-only admin
 * would be unable to rotate the password they were handed or to enrol the
 * factor we are about to make mandatory — and the only way anybody would
 * have noticed is the operator being locked out.
 *
 * ⚠️ IT ALSO LIFTS THE RECOVERY-ONLY WRITE BLOCK, deliberately. A session
 * opened with a recovery code is read-only "until TOTP is re-enrolled" — and
 * re-enrolling is a write. If these routes were blocked too, a lost phone
 * would be an unrecoverable account by design.
 *
 * ⚠️ MARKING A ROUTE WITH THIS IS A PROMISE THE GUARD CANNOT CHECK: that the
 * handler acts on `@CurrentAdmin().sub` and on no id taken from the path,
 * query or body. A route marked with this that accepts a target admin id is
 * a privilege escalation with a comment on it. Every use is pinned by
 * own-account-routes.spec.ts, which fails when the set changes, so adding one
 * is a decision somebody looks at rather than a line somebody types.
 */
export const OwnAccountRoute = () => SetMetadata(OWN_ACCOUNT_ROUTE, true);
