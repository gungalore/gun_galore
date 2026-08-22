// A CLOSED ACCOUNT IS NOT A BANNED ACCOUNT. One guard, one message.
//
// Operator, 2026-08-22: closing an account must "delete the profile from the
// public [side], but still keep transaction links etc, reason for that is if a
// user commited a crime or something they cant just vanish". So a closure is a
// member exercising a choice (or an admin doing it on their behalf), recorded
// in AccountClosure — never an enforcement action.
//
// ⚠️ THE FAILURE THIS FILE EXISTS TO PREVENT. Every money gate in the backend
// already reads `isBanned` and throws some wording of "Account is suspended".
// Closure sets a DIFFERENT column, User.accountClosedAt, and the obvious
// shortcut — let the existing ban gate catch it — tells a member who closed
// their own account and came back to a stale tab that they were suspended.
// That accusation then lives on in their screenshot and in the support ticket,
// about something we never did. The ban wording must never reach a closure.
//
// ⚠️ AND IT MUST BE CHECKED FIRST. An admin CAN close a banned member's
// account (that is the only route by which a banned member's account closes at
// all), so a row can carry both flags. Closed is the newer, truer state and
// the one the member can act on, so it wins the message.
//
// Dependency-free like payment-mode.ts and seller-reject-policy.ts: a pure
// predicate, a guard and the string, so a service uses it without a new
// module edge.

import { ForbiddenException } from '@nestjs/common';

export const ACCOUNT_CLOSED_MESSAGE =
  'This account has been closed. Contact support if you did not close it.';

// The only shape the guard needs. Any Prisma User row satisfies it; a
// `select` must pull accountClosedAt or this will not compile at the call
// site, which is the point — a gate that silently reads `undefined` would
// pass every closed account through.
export type AccountStanding = { accountClosedAt: Date | null };

export function isAccountClosed(
  user: AccountStanding | null | undefined,
): boolean {
  return !!user?.accountClosedAt;
}

export function assertAccountNotClosed(user: AccountStanding): void {
  if (user.accountClosedAt) {
    throw new ForbiddenException(ACCOUNT_CLOSED_MESSAGE);
  }
}
