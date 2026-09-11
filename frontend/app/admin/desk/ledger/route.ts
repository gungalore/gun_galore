import { NextResponse, type NextRequest } from 'next/server';
import { ledgerRedirect } from '@/lib/desk-pile';

/**
 * THE DESK — /admin/desk/ledger, kept alive as a translation.
 *
 * 🚨 THE PAGE IS GONE; THE ADDRESSES ARE NOT. The Ledger's four lenses moved
 * onto Now, because the question "is there anything I have to do, and is any of
 * it late?" is not answered by walking between two boards — the payout run that
 * used to be this page's default lens is now a drawer, and the order, sale and
 * book registers are lenses beside the pile. But the URLs this page answered
 * are minted in four places and pasted in more:
 *
 *   lib/desk-search.ts       WAS every order and transaction hit in the palette
 *                            — those two now point straight at /admin/desk
 *   app/admin/desk/people    a member's sale, hand-written as ?txn=
 *   admin-health.service.ts  ?filter=dispatch-overdue
 *   lib/desk-cutover.ts      five entries still name /admin/desk/ledger
 *
 * plus the Ledger tab in components/desk/tabs.tsx, plus whatever is in the
 * operator's history and mail. So this route stays and forwards, and the
 * translation lives in lib/desk-pile.ts where a spec can hold it — a redirect
 * that quietly dropped ?status=PAID&page=3 would land on an unfiltered page one
 * that LOOKS like it worked, which is the failure nobody reports.
 *
 * 🚨 A ROUTE HANDLER, NOT A PAGE CALLING redirect(), AND THE DIFFERENCE IS
 * VISIBLE. Written as a page this sat under app/admin/desk/layout.tsx, whose
 * RequireDeskSession gate is a client component: the shell began streaming
 * before the page threw NEXT_REDIRECT, so the response was a 200 carrying the
 * destination inside the RSC payload — the browser painted the Desk chrome and
 * a session check, THEN navigated. Measured, not assumed: curl returned
 * `HTTP/1.1 200` with `/admin/desk?view=orders&status=PAID…;307;` in the
 * body. A route handler is not wrapped by any layout, so the answer is a bare
 * 307 with a Location header and nothing renders at all.
 *
 * ⚠️ AND IT IS THEREFORE OUTSIDE RequireDeskSession, WHICH IS FINE HERE AND
 * WOULD NOT BE ANYWHERE ELSE. A route handler is not wrapped by the Desk
 * layout, so a signed-out stranger gets this 307 without a session check. What
 * it hands them is a Location header built from their own query string and
 * nothing else — no row, no count, no name — and /admin/desk itself is still
 * gated. A second route handler under /admin/desk that answered with DATA
 * would be a real hole; this one answers with an address.
 *
 * ⚠️ 307, NOT 308. A permanent redirect is cached by the browser for the life
 * of the profile; the day this mapping changes, every operator who has followed
 * it once would keep going to the old destination with no request to correct
 * them.
 *
 * ⚠️ FIRST VALUE WINS ON A REPEATED PARAM — `?txn=a&txn=b` takes `a`, because
 * that is what the old page's URLSearchParams.get did. Said on purpose rather
 * than inherited by accident.
 */
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const to = ledgerRedirect(request.nextUrl.search);
  return NextResponse.redirect(new URL(to, request.nextUrl.origin), 307);
}
