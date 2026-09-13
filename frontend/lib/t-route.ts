/**
 * The WhatsApp deep-link redirect table.
 *
 * A WhatsApp URL button allows exactly ONE variable, appended as a suffix to
 * a static, Meta-approved base — `https://alloutdoor.co.za/t/` plus one
 * variable — so a single base has to serve every template. This is the
 * mapping side of that: a one-letter kind prefix plus (where the kind needs
 * one) an entity id decides where `/t/<code>` sends the tap.
 *
 * | code               | →                    |
 * |--------------------|----------------------|
 * | `t<transactionId>` | `/transactions/<id>` |
 * | `o<orderId>`       | `/orders/<id>`       |
 * | `p`                | `/profile/edit`      |
 * | `b`                | `/my/orders`         |
 * | `s`                | `/my/sales`          |
 * | anything else      | `/`                  |
 *
 * ⚠️ THIS FUNCTION IS THE ONLY THING STANDING BETWEEN A WHATSAPP TAP AND AN
 * OPEN REDIRECT. `code` arrives as a raw, attacker-controlled URL segment —
 * it is never reflected into the Location header, only used to select a
 * fixed destination template or to validate an id that gets substituted into
 * one. A code that doesn't parse as a known prefix plus a plausible id falls
 * through to `/` rather than being trusted in any way.
 *
 * No table, no expiry, nothing to clean up, and no DB lookup — deliberately,
 * so the route stays a pure redirect with nothing new to keep in sync.
 */

// cuid()s in this codebase are lowercase alphanumeric, starting with 'c', and
// comfortably under this length in practice — this is a shape check, not an
// attempt to validate cuid checksums. Anything longer, containing a slash,
// a dot-dot, a colon (scheme separator) or other punctuation is rejected
// outright rather than risking it being meaningful to whatever consumes the
// resulting path.
const ID_PATTERN = /^[a-z0-9]{10,40}$/i;

function isPlausibleId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * Resolve a `/t/<code>` short code to the real path to redirect to.
 * Never throws; an unparseable or unsafe code resolves to `/`.
 */
export function resolveShortCode(code: string): string {
  if (typeof code !== 'string' || code.length === 0) return '/';

  // Fixed, argument-free codes first — nothing to validate.
  if (code === 'p') return '/profile/edit';
  if (code === 'b') return '/my/orders';
  if (code === 's') return '/my/sales';

  const kind = code[0];
  const id = code.slice(1);

  if (kind === 't' && isPlausibleId(id)) return `/transactions/${id}`;
  if (kind === 'o' && isPlausibleId(id)) return `/orders/${id}`;

  return '/';
}
