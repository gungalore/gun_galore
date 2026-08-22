/**
 * Reserved handles — the single list, so every place that assigns a username
 * can consult the same one.
 *
 * It used to live inline in users-public.controller.ts, which is the
 * PRE-SIGNUP availability check and nothing else. UsersService.completeProfile
 * validates the shape only (`/^[a-z0-9_]{3,30}$/`) and never looked at this
 * set, so every handle below was reserved against the green tick on the signup
 * form and free to take one screen later. Moving it here is what makes the
 * reservation enforceable at the point a username is actually written.
 */
export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'support',
  'help',
  'staff',
  'system',
  // Old trading name kept reserved so nobody can squat it post-rebrand.
  'gungalore',
  'gun_galore',
  'alloutdoor',
  'all_outdoor',
  'official',
  'moderator',
  'sales',
  'billing',
  'security',
  'api',
  'root',
  'webmaster',
  'noreply',
  'mail',
  'me',
  'you',
  'anonymous',
  'null',
  'undefined',
  'competitions',
  'auctions',
  'marketplace',
  // ── De-identification fallbacks ──────────────────────────────────────
  // Account closure RELEASES the member's username back into the namespace,
  // and every surface that used to render it falls back to a literal. Those
  // literals must not be claimable, or the next person to sign up can take
  // the handle a closed member's rows now read as and inherit their bid
  // history, their Q&A and their reviews by sight.
  //
  // 'seller' is the questions-panel answerer fallback
  // (app/listings/[id]/questions-panel.tsx), 'a_member' is the prize-draw
  // winner fallback 'a member' (raffle.service.ts) with the space the
  // charset forces. 'anonymous' above already covers the bid-history and
  // rater fallbacks; the multi-word ones ('Anonymous buyer', 'Anonymous
  // seller', 'Anonymous bidder') cannot be typed into a handle at all
  // because the charset has no space.
  'seller',
  'a_member',
]);

/** True when `username` (already lowercased and trimmed) may not be taken. */
export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username);
}
