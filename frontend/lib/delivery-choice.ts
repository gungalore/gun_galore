// ────────────────────────────────────────────────────────────────────
// THE BUYER'S PICK FROM THE LISTING'S TWO-OPTION TOGGLE.
//
// ⚠️ THIS IS A HINT, NOT AN ORDER. The cart and checkout keep their own
// authoritative route state (the cart groups by seller and class; checkout
// re-validates against the listing's legal pair). This just carries the choice
// the buyer made on the PDP into the single-item checkout, and remembers it for
// the visit — no backend write, no cart-store edit, session-scoped.
// ────────────────────────────────────────────────────────────────────

const KEY = 'gg:delivery-choice';

function readAll(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Remember the route the buyer picked for this listing. */
export function saveDeliveryChoice(listingId: string, method: string): void {
  if (!listingId || !method) return;
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...readAll(), [listingId]: method }),
    );
  } catch {
    /* private mode / quota — checkout falls back to its own default */
  }
}

/** The remembered route for this listing, if any. */
export function getSavedDeliveryChoice(listingId: string): string | null {
  if (!listingId) return null;
  const value = readAll()[listingId];
  return typeof value === 'string' && value ? value : null;
}
