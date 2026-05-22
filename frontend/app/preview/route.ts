/**
 * Preview-bypass route for the coming-soon gate.
 *
 *   GET /preview?key=<COMING_SOON_BYPASS_SECRET>
 *
 * If the key matches the server env var, sets a 30-day httpOnly cookie
 * named `gg-preview` carrying the same secret, then redirects to `/`.
 * The middleware checks for that cookie on every request — when present
 * AND matching, the visitor sees the real site instead of the
 * coming-soon page.
 *
 * If the key is wrong/missing, returns 403 so we don't leak the
 * existence of the bypass to random pokers.
 *
 * To rotate the secret: change COMING_SOON_BYPASS_SECRET on the server,
 * restart the app. All existing preview cookies become invalid and
 * testers will need a fresh link.
 *
 * To kill the gate entirely (real launch): set COMING_SOON_GATE=off
 * and restart. Middleware short-circuits before this route is even
 * consulted.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  const secret = process.env.COMING_SOON_BYPASS_SECRET;

  if (!secret) {
    return new NextResponse(
      'Coming-soon gate not configured (COMING_SOON_BYPASS_SECRET missing)',
      { status: 500 },
    );
  }

  if (!key || key !== secret) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Build redirect URL from forwarded headers so we don't send the
  // browser to http://localhost:3000/ when running behind nginx +
  // Cloudflare. req.url reflects the socket Next.js is listening on
  // (localhost:3000), not the public hostname.
  const host = req.headers.get('host') || 'gungalore.co.za';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const target = `${proto}://${host}/`;

  const response = NextResponse.redirect(target);
  response.cookies.set('gg-preview', secret, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
  return response;
}
