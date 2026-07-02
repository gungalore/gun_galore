import { CategoryAttribute } from '@prisma/client';

// TEXT attribute values are capped at this many characters (trimmed first).
const TEXT_MAX_LENGTH = 200;

/**
 * P4.2 — validate + clean per-listing attribute VALUES against a category's
 * effective attribute DEFINITIONS (see CategoriesService.getEffectiveAttributes).
 *
 * Pure + dependency-free so it's trivially unit-testable and callable from
 * both create() and update().
 *
 * Policy:
 *   - We iterate the DEFINITIONS, never the raw input, so any key the client
 *     sends that isn't a defined attribute is silently DROPPED (forward-compat:
 *     an old client sending a since-removed attr won't error).
 *   - Empty (undefined / null / '') → error if the def is `required`, else the
 *     key is OMITTED from the cleaned object (we never store empties).
 *   - NUMBER  → coerced with Number(); must be finite, else error. Stored as a number.
 *   - SELECT  → must be a string exactly equal to one of def.options, else error.
 *   - BOOLEAN → true/false or 'true'/'false' (case-insensitive), else error. Stored as boolean.
 *   - TEXT    → coerced to string, trimmed, capped at 200 chars.
 *
 * Returns the FIRST error (definitions are processed in order) or null, plus a
 * `cleaned` object containing only the valid, present keys.
 */
export function validateAndCleanAttributes(
  defs: CategoryAttribute[],
  raw: Record<string, unknown> | null | undefined,
): { cleaned: Record<string, unknown>; error: string | null } {
  const cleaned: Record<string, unknown> = {};
  const source = raw ?? {};

  for (const def of defs) {
    const value = source[def.key];
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '');

    if (isEmpty) {
      if (def.required) {
        return { cleaned, error: `${def.label} is required.` };
      }
      continue; // optional + absent → omit from cleaned
    }

    switch (def.type) {
      case 'NUMBER': {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          return { cleaned, error: `${def.label} must be a number.` };
        }
        cleaned[def.key] = num;
        break;
      }
      case 'SELECT': {
        if (typeof value !== 'string' || !def.options.includes(value)) {
          return {
            cleaned,
            error: `${def.label} must be one of: ${def.options.join(', ')}.`,
          };
        }
        cleaned[def.key] = value;
        break;
      }
      case 'BOOLEAN': {
        if (value === true || value === false) {
          cleaned[def.key] = value;
          break;
        }
        if (typeof value === 'string') {
          const lowered = value.trim().toLowerCase();
          if (lowered === 'true') {
            cleaned[def.key] = true;
            break;
          }
          if (lowered === 'false') {
            cleaned[def.key] = false;
            break;
          }
        }
        return { cleaned, error: `${def.label} must be true or false.` };
      }
      case 'TEXT':
      default: {
        cleaned[def.key] = String(value).trim().slice(0, TEXT_MAX_LENGTH);
        break;
      }
    }
  }

  return { cleaned, error: null };
}
