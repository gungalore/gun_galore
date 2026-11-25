import { cookies } from 'next/headers';

/**
 * The 18+ declaration cookie, read on the server.
 *
 * ⚠️ NO `server-only` IMPORT — that package is not a dependency here. This
 * module is server-only by construction: it imports `next/headers`, which
 * throws if pulled into a client bundle.
 *
 * PRESENCE IS NOT VALIDITY. This helper only answers "is a declaration cookie
 * present on this request" so a server component can decide what to render.
 * The backend re-verifies the signature/audience on every API call; a tampered
 * cookie buys a page shell that renders no catalogue data, never more.
 */
export const CATALOGUE_COOKIE = 'ao_cat';

export async function catalogueDeclarationToken(): Promise<string | null> {
  try {
    return (await cookies()).get(CATALOGUE_COOKIE)?.value ?? null;
  } catch {
    // Called outside a request scope — fail soft to "not declared", which
    // shows the gate, never more content.
    return null;
  }
}

/** Advisory render decision only — see the note above. */
export async function isCatalogueDeclared(): Promise<boolean> {
  return (await catalogueDeclarationToken()) !== null;
}
