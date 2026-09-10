// NOTE: no `import 'server-only'` — that package isn't a dependency here.
// This module is server-only by construction: it imports `next/headers`,
// which throws if pulled into a client bundle.
import { cookies } from 'next/headers';
// ⚠️ THE NARROW SUBPATH, NOT 'jose'. The package index pulls in the JWE
// decrypt path, which reaches for CompressionStream — a Node API the Edge
// runtime does not have — and every build printed two warnings about code we
// never call. We verify a JWS; this is the only entry point we need.
import { jwtVerify } from 'jose/jwt/verify';

/** Must match ACCESS_COOKIE in backend/src/auth/extract-token.ts. */
export const ACCESS_COOKIE = 'ao_at';
/** Must match REFRESH_COOKIE there. */
export const REFRESH_COOKIE = 'ao_rt';

let cachedKey: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!cachedKey) {
    const raw =
      process.env.JWT_MEMBER_SECRET ??
      'dev-only-member-secret-NOT-for-production';
    cachedKey = new TextEncoder().encode(raw);
  }
  return cachedKey;
}

export interface ServerAuth {
  userId: string | null;
  /** The raw access token, to forward to the API. */
  token: string | null;
  /**
   * The same token behind a function.
   *
   * Kept in the Clerk shape on purpose: fourteen server components destructure
   * `{ userId, getToken }` and pass the result straight into a fetch header.
   * Matching the shape means this swap is an import change and nothing else.
   */
  getToken: () => Promise<string | null>;
}

/**
 * The signed-in member on the server, or nulls.
 *
 * ⚠️ THE ANSWER IS ADVISORY, NOT AUTHORITATIVE. The backend re-verifies every
 * token on every request; this exists so a server component can decide what to
 * RENDER, never what to return. Failing it open would show less, never more.
 */
export async function serverAuth(): Promise<ServerAuth> {
  try {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
    if (!token) return { userId: null, token: null, getToken: async () => null };
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: (payload.sub as string) ?? null,
      token,
      getToken: async () => token,
    };
  } catch {
    // Expired or malformed — treat as anonymous. A stale cookie must never
    // turn a public page into an error.
    return { userId: null, token: null, getToken: async () => null };
  }
}

/**
 * True when the current request has a signed-in member behind it. Use for
 * render-time decisions ("show the members-only note", "noindex this page"),
 * NOT for data access — the backend is the authority on what is returned.
 */
export async function isMember(): Promise<boolean> {
  return (await serverAuth()).userId !== null;
}
