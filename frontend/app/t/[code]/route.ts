/**
 * `GET /t/<code>` — the WhatsApp deep-link redirect table.
 *
 * Stateless: the mapping lives in `lib/t-route.ts` (`resolveShortCode`) so it
 * can be unit-tested without booting Next. This handler's only job is to call
 * it and redirect.
 *
 * `middleware.ts` carries `/t/(.*)` in the public matcher — this route itself
 * never renders anything a signed-out visitor shouldn't see (it only ever
 * redirects), and the destination keeps its own auth wall, which bounces a
 * signed-out tap to sign-in carrying the real path as the redirect target.
 *
 * 307, not 301: the mapping must stay changeable, and a 301 would get cached
 * by browsers and CDNs past the point we could still change our minds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveShortCode } from '@/lib/t-route';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const target = resolveShortCode(code);
  return NextResponse.redirect(new URL(target, req.url), 307);
}
