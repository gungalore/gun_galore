// ────────────────────────────────────────────────────────────────────
// /witness/* — PUBLIC, BUT NEVER INDEXED.
//
// ⚠️ THIS LAYOUT EXISTS ONLY TO CARRY `robots: noindex`. The page itself is a
// client component ('use client'), and a client component cannot export
// `metadata` — so without a server layout in the subtree there is nowhere to
// put the directive.
//
// Why it matters: /witness(.*) is deliberately in middleware's isPublicRoute.
// The person opening it is a stranger who followed an SMS link, is not a member
// and never will be; a 307 to sign-in does not read as "please log in", it
// reads as a suspicious link, and they close it. So the route has to answer 200
// to anyone holding the token.
//
// But the page says, in its masthead, "Character statement for a firearm
// licence application". That is a firearm phrase on a publicly-reachable URL,
// on a domain Meta has already restricted twice. The token in the path makes
// any individual URL unguessable, and app/robots.ts now disallows the prefix —
// this is the half that stops the page itself being indexed if a URL ever leaks
// (a forwarded SMS, a shared screenshot, a browser sync).
//
// See also lib/chromeless-routes: this route renders no shop chrome either.
// ────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function WitnessLayout({ children }: { children: ReactNode }) {
  return children;
}
