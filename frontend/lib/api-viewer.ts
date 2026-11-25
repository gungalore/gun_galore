// NOTE: no server-only import — that package is not a dependency here.
// This module is server-only by construction: it imports ./auth-server, which
// reads next/headers and throws if pulled into a client bundle.
import { serverAuth } from './auth-server';
import { apiFetch } from './api';
import { catalogueDeclarationToken } from './catalogue-access';

/**
 * Server-side fetch for catalogue data whose ACCESS depends on who is asking.
 *
 * The site has two viewer states behind the 18+ gate:
 *
 *   - a member session (`ao_at`) — signed in, sees everything;
 *   - a declared visitor (`ao_cat`) — accepted the 18+ gate, sees the same
 *     catalogue as a member.
 *
 * The backend decides which one applies from those cookies, so every server
 * component reading listings, categories, brands, community or tools has to
 * forward them — a server-to-server fetch carries no cookie jar. Without the
 * declaration, a declared visitor's SSR fetch is anonymous and the backend
 * 404s content (ContentAccessGuard).
 *
 * THREE RULES, all load-bearing:
 *
 * 1. NEVER shared-cache the result. `next: { revalidate: n }` puts the
 *    response in Next's data cache, which is shared across ALL users — one
 *    member's fetch would then be replayed to anonymous visitors (leaking the
 *    full catalogue) or an anonymous fetch replayed to members (hiding it).
 *    This helper forces `cache: 'no-store'` and ignores any caller-supplied
 *    cache option. The pages using it are already dynamic.
 *
 * 2. Identity comes ONLY from the signed cookies. Never a header, a query
 *    param or a user-agent. Serving a crawler different content from a
 *    logged-out human is cloaking; a crawler simply never clicks the gate.
 *
 * 3. Failure is soft: if the cookies can't be read we fall through
 *    anonymously, which shows LESS, never more.
 */
export async function viewerFetch<T>(
  path: string,
  init?: Omit<RequestInit, 'cache'>,
): Promise<T> {
  // A server-to-server fetch carries no cookie jar, so the cookies the browser
  // sent us have to be forwarded explicitly.
  const [{ token }, declaration] = await Promise.all([
    serverAuth(),
    catalogueDeclarationToken(),
  ]);

  return apiFetch<T>(path, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(declaration ? { Cookie: `ao_cat=${declaration}` } : {}),
    },
  });
}

export { isMember } from './auth-server';
