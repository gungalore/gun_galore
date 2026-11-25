/**
 * The 18+ catalogue declaration.
 *
 * ⚠️ THIS IS NOT A MEMBER SESSION, AND IT MUST NEVER BE ABLE TO ACT AS ONE.
 *
 * The site is age-gated: a signed-out visitor confirms they are 18 or older,
 * gets the `ao_cat` cookie, and then sees the whole catalogue exactly as a
 * signed-in member does. Signed-in state is required only for actions (buy,
 * bid, motivation) and for private data (account, Document Library).
 *
 * The token is a JWT signed with the SAME `JWT_MEMBER_SECRET` the session JWTs
 * use, but it carries `purpose: 'catalogue-gate'` and audience `'catalogue-gate'`
 * and NO `sub`. That separation is what keeps the two token types useless as
 * each other:
 *
 *   - a declaration does not verify as a session (`SessionService.verify`
 *     requires `sub`, and the audience differs);
 *   - a session token does not verify as a declaration (purpose/audience).
 *
 * Do not add `sub` to this payload "to simplify" anything. The moment a
 * declaration can authenticate, every signed-out visitor who clicked a gate
 * button holds a bearer token for the user it names.
 */
export const CATALOGUE_COOKIE = 'ao_cat';

/** The JWT audience + purpose claim that separate this token from a session. */
export const CATALOGUE_AUDIENCE = 'catalogue-gate';
export const CATALOGUE_PURPOSE = 'catalogue-gate';

/**
 * How long one declaration lasts. Long enough that a returning visitor is not
 * asked again on every visit; the gate is an attestation, not a session.
 */
export const CATALOGUE_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CatalogueDeclaration {
  purpose: typeof CATALOGUE_PURPOSE;
  v: 1;
}
