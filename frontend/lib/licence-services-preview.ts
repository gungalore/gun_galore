// ────────────────────────────────────────────────────────────────────
// WHO CAN SEE THE PACK SCREEN WHILE IT IS STILL BEING BUILT.
//
// The screen at /licence-services/[id] is gated on
// NEXT_PUBLIC_LICENCE_SERVICES_ENABLED, which is a BUILD-TIME value in
// Next.js. That is the right switch for "on for everybody", and it is useless
// for "let one person look at it": setting it means a rebuild, and a rebuild
// means every member gets a screen that cannot yet answer three whole areas of
// their application.
//
// ⚠️ SO THERE IS A SECOND DOOR, AND IT IS DELIBERATELY A WEAK ONE. Visiting
// with `?preview=1` opts this BROWSER TAB in for the rest of the session.
// Nothing about it is a security control and it must never become one:
//
//   • The route is already member-only. Clerk's middleware bounces anyone
//     signed out before this code runs at all.
//   • The screen shows a member THEIR OWN application and nobody else's —
//     every read is ownership-scoped server-side, exactly as the wizard's is.
//     Opting in changes which UI you get, never what you may see.
//   • So the worst a curious member can do is look at an unfinished screen of
//     their own data, with a permanent link back to the finished one.
//
// sessionStorage rather than localStorage on purpose: a preview should end
// when the tab does, so nobody is left stuck in a half-built screen weeks
// later having forgotten how they got there.
// ────────────────────────────────────────────────────────────────────

const KEY = 'licence-services-preview';

/** The build-time switch. On means on for everybody. */
export const PACK_SCREEN_SHIPPED =
  process.env.NEXT_PUBLIC_LICENCE_SERVICES_ENABLED === 'true';

/**
 * Record an opt-in from the URL, and report whether one is now in force.
 *
 * ⚠️ NEVER THROWS. sessionStorage throws on ACCESS wherever site data is
 * blocked, and the caller is a page load — the same trap lib/motivation-draft
 * documents. A browser that refuses storage gets no preview, not an error.
 */
export function readPreviewOptIn(search?: string): boolean {
  try {
    if (search && new URLSearchParams(search).get('preview') === '1') {
      sessionStorage.setItem(KEY, '1');
      return true;
    }
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Drop the opt-in, for the "back to the finished screen" link. */
export function clearPreviewOptIn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
}

/**
 * May this browser open the pack screen?
 *
 * ⚠️ SHIPPED WINS AND IS CHECKED FIRST, so that the day the build flag goes on
 * the preview machinery stops mattering rather than becoming a second way to
 * be in a different state from everybody else.
 */
export function canOpenPackScreen(search?: string): boolean {
  return PACK_SCREEN_SHIPPED || readPreviewOptIn(search);
}
