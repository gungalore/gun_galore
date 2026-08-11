// NOTE: no `import 'server-only'` — that package isn't a dependency here.
// This module is server-only by construction: it imports @clerk/nextjs/server,
// which itself throws if pulled into a client bundle.
import { auth } from '@clerk/nextjs/server';
import { apiFetch } from './api';

/**
 * Server-side fetch for catalogue data whose CONTENT DEPENDS ON WHO IS ASKING.
 *
 * Since the members-only gate landed, the same URL returns two different
 * catalogues: signed-out callers get publicly-visible categories only (the
 * outdoor storefront), signed-in members get everything. The backend decides
 * that from the Clerk token, so every server component reading listings,
 * categories, brands or facets has to forward it — otherwise a signed-in
 * member browsing the homepage would be served the cut-down public catalogue,
 * because the SSR fetch is anonymous even when the visitor is not.
 *
 * TWO RULES, both load-bearing:
 *
 * 1. NEVER shared-cache the result. `next: { revalidate: n }` puts the
 *    response in Next's data cache, which is shared across ALL users — one
 *    member's fetch would then be replayed to anonymous visitors (leaking
 *    members-only stock) or an anonymous fetch replayed to members (hiding
 *    their own catalogue). This helper forces `cache: 'no-store'` and ignores
 *    any caller-supplied cache option. The pages using it are already dynamic.
 *
 * 2. Identity comes ONLY from the verified Clerk session. Never a header, a
 *    query param or a user-agent. Serving a crawler different content from a
 *    logged-out human is cloaking; this returns identical content to both.
 *
 * Failure is soft: if the token can't be read we fall through anonymously,
 * which shows LESS, never more.
 */
export async function viewerFetch<T>(
  path: string,
  init?: Omit<RequestInit, 'cache'>,
): Promise<T> {
  let token: string | null = null;
  try {
    token = await (await auth()).getToken();
  } catch {
    // No session (or Clerk unreachable) — proceed as an anonymous visitor.
  }

  return apiFetch<T>(path, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/**
 * True when the current request has a signed-in member behind it. Use for
 * render-time decisions ("show the members-only note", "noindex this page"),
 * NOT for data access — the backend is the authority on what is returned.
 */
export async function isMember(): Promise<boolean> {
  try {
    const { userId } = await auth();
    return !!userId;
  } catch {
    return false;
  }
}
