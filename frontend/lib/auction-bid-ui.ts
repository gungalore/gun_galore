import { formatPrice } from './utils';

/**
 * Pure helpers for the two auction bidding surfaces — the listing-page
 * AuctionPanel and the SMS-link /a/<token> page.
 *
 * They live here rather than inline in the components for one reason: both are
 * rules that are easy to get subtly wrong and impossible to verify by looking
 * at a rendered page. The Auto Bid prefill silently LOWERED a live proxy
 * ceiling (audit M9) and the client-clock close could hide the bid CTAs while
 * the server was still accepting bids (audit L14). A unit spec pins both.
 */

/**
 * What the Auto Bid modal should open on.
 *
 * The modal used to open on `nextMinBid`, so a bidder already leading with a
 * higher private maximum who tapped “Set Auto Bid” submitted that lower amount
 * — and the backend's same-bidder branch stored it, silently dropping the
 * ceiling they had already authorised (audit M9). Prefilling at the higher of
 * the two removes the trap: opening and submitting without touching the
 * stepper can only ever keep or raise the maximum. Lowering it is still
 * possible, but only deliberately — via “Cancel auto bid” and a fresh lower
 * maximum, which the copy under the field spells out.
 */
export function autoBidPrefillCents(
  nextMinBid: number,
  currentMax: number | null | undefined,
): number {
  if (currentMax == null || !Number.isFinite(currentMax)) return nextMinBid;
  return Math.max(nextMinBid, currentMax);
}

/**
 * The inline note shown inside the Auto Bid modal while a proxy is live. It
 * names the amount the seller-side backend actually holds so nobody has to
 * remember what the button label said a minute ago.
 */
export function autoBidRaiseNote(currentMax: number): string {
  return `Your auto bid is currently ${formatPrice(currentMax)} — raise it here, or use Cancel auto bid to lower it.`;
}

/**
 * Difference between the device clock and the server clock, in milliseconds:
 * `Date.now() - serverNow`. Positive means the device is ahead.
 *
 * The auction close has always been decided by `Date.now()` on the client, so
 * a phone set several minutes fast hid the bid CTAs while the server still
 * accepted bids — and a phone set slow showed them for an auction the server
 * had already closed (audit L14). `GET /auctions/:id` now carries an optional
 * `serverNow`; when it is there this offset correction is what the countdown
 * and the closed/biddable decision run on. When it is missing the function
 * returns 0 and the old device-clock behaviour is preserved exactly.
 */
export function clockOffsetMs(
  serverNow: string | null | undefined,
  deviceNowMs: number = Date.now(),
): number {
  if (!serverNow) return 0;
  const serverMs = Date.parse(serverNow);
  if (Number.isNaN(serverMs)) return 0;
  return deviceNowMs - serverMs;
}

/**
 * The server's current time, derived from a device tick and the offset above.
 * `Date.now() - offset` — the form the audit asks for, written once so the two
 * call sites cannot drift.
 */
export function serverNowMs(deviceNowMs: number, offsetMs: number): number {
  return deviceNowMs - offsetMs;
}

/**
 * The reserve warning on the outbid SMS page (audit M11).
 *
 * The backend returns `reserveMet: false` for a listing with NO reserve, so the
 * old `reserveMet === false` guard printed “the auction won't close unless the
 * reserve is met” on every no-reserve outbid SMS — a false reason not to bid.
 * The warning is only true when the auction actually HAS a reserve and it is
 * not met. `hasReserve` is authoritative; absent means the payload predates it,
 * and in that case we stay quiet rather than guess.
 */
export function shouldWarnReserve(
  auction:
    | { hasReserve?: boolean | null; reserveMet?: boolean | null }
    | null
    | undefined,
): boolean {
  return auction?.hasReserve === true && auction.reserveMet === false;
}
