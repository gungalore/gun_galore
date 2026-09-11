import { NextResponse, type NextRequest } from 'next/server';

/**
 * /admin/desk/site — A REDIRECT, NOT A BOARD.
 *
 * The Site surface was 2,926 lines carrying two unrelated jobs: an agent
 * conversation and the box's own health. They are now /admin/desk/agent and
 * /admin/desk/health. This file is what an operator's bookmark, an old link in
 * a support thread, and every `desk:` value in lib/desk-cutover.ts that used to
 * point here land on.
 *
 * 🚨 A ROUTE HANDLER, NOT A PAGE CALLING redirect(), AND app/admin/desk/ledger
 * ALREADY PAID FOR THIS LESSON. Written as a page this sits under
 * app/admin/desk/layout.tsx, whose RequireDeskSession gate is a client
 * component: the shell begins streaming before the page throws NEXT_REDIRECT,
 * so the response is a 200 carrying the destination inside the RSC payload —
 * the browser paints the Desk chrome and a session check, THEN navigates. That
 * flash is indistinguishable from a mis-tap on a phone. A route handler is not
 * wrapped by any layout, so the answer is a bare 307 and nothing renders.
 *
 * ⚠️ 307, NOT 308, for the same reason the Ledger gives: a permanent redirect
 * is cached for the life of the browser profile, so the day this mapping
 * changes every operator who followed it once keeps going to the old
 * destination with no request to correct them.
 *
 * ⚠️ THE QUERY STRING IS CARRIED ACROSS VERBATIM. Two deep links are live and
 * documented: `?send=1&channel=&segment=` is the entrance /admin/broadcast had,
 * and `?whatsapp=<threadId>` is the only door to the WhatsApp reply drawer.
 * Dropping them would land the operator on the right board with the drawer
 * shut — which looks like the drawer being broken, not like a link having aged.
 * `nextUrl.search` is passed whole rather than rebuilt through
 * URLSearchParams, so a repeated param survives as a repeated param and
 * nothing re-encodes.
 *
 * ⚠️ THE ROUTE STAYS EVEN THOUGH NOTHING IN THIS REPO POINTS AT IT ANY MORE.
 * The nine cutover-map entries that named it now name /admin/desk/health, so
 * the only callers left are outside the tree: an operator's bookmark, the Desk
 * manifest's "Site health" shortcut, a link in a support thread — and
 * backend/src/desk/desk.service.ts, which still mints this path as the `href`
 * on all three Warden pile cards. ⚠️ THOSE THREE NOW LAND ON HEALTH AND THE
 * WARDEN SURFACE IS AGENT: the card opens, the board is the wrong one. Fixing
 * it is three string literals in that service and it is the one thing this
 * redirect cannot do for itself, because a Warden card and a health bookmark
 * arrive here indistinguishable.
 */
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const search = request.nextUrl.search;
  return NextResponse.redirect(
    new URL(`/admin/desk/health${search}`, request.nextUrl.origin),
    307,
  );
}
