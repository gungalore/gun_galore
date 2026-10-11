import { CompDiff } from '../schemas';
import { ItemSpec } from './types';

/** The identity fields an external product carries, compared against the item. */
export interface ProductIdentity {
  brand?: string | null;
  model?: string | null;
  attributes?: Record<string, string>;
}

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter(Boolean));
}

function looselyEqual(a: string, b: string): boolean {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return false;
  // The smaller token set must be fully contained in the larger, so a subset
  // name ("T3x" inside "Tikka T3x Lite") matches, but "Hubba NX" does NOT match
  // "Hubba Hubba NX2" (the "nx" token is absent from the larger set).
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * Deterministic identity diff for an external product vs the confirmed item.
 * Empty diffs means EXACT (same make and model). This mirrors what the model
 * does for its own comps, but in code, because an adapter cannot reason. When a
 * dimension cannot be verified we return a diff rather than claiming an exact
 * match, so an unverified comp can never be tiered as EXACT_MODEL.
 *
 * Only make/model are compared: these are the fields a store adapter reliably
 * exposes. Specification-level differences are handled by the model's own comps
 * and by the category tiering when this adapter names a different model.
 */
export function diffProduct(product: ProductIdentity, item: ItemSpec): CompDiff[] {
  const diffs: CompDiff[] = [];
  const itemMake = norm(item.make);
  const prodMake = norm(product.brand);
  const itemModel = norm(item.model);
  const prodModel = norm(product.model);

  if (itemMake && prodMake) {
    if (!looselyEqual(itemMake, prodMake)) {
      diffs.push({ dimension: 'make', itemValue: item.make, compValue: product.brand ?? null });
    }
  } else {
    // A missing maker on either side cannot be confirmed as the same item.
    diffs.push({ dimension: 'make', itemValue: item.make ?? 'unknown', compValue: product.brand ?? null });
  }

  if (itemModel && prodModel) {
    if (!looselyEqual(itemModel, prodModel)) {
      diffs.push({ dimension: 'model', itemValue: item.model, compValue: product.model ?? null });
    }
  } else if (itemModel || prodModel) {
    // Only one side names a model: not an exact match.
    diffs.push({ dimension: 'model', itemValue: item.model ?? null, compValue: product.model ?? null });
  } else {
    diffs.push({ dimension: 'model', itemValue: null, compValue: null });
  }

  const seen = new Set<string>();
  return diffs.filter((d) => (seen.has(d.dimension) ? false : (seen.add(d.dimension), true)));
}
