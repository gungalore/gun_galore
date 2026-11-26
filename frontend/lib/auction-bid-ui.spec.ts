import { describe, expect, it } from 'vitest';
import {
  autoBidPrefillCents,
  autoBidRaiseNote,
  clockOffsetMs,
  serverNowMs,
  shouldWarnReserve,
} from './auction-bid-ui';
import { formatPrice } from './utils';

// ────────────────────────────────────────────────────────────────────
// Two traps in one file. Both are silent failures on money surfaces:
//
//  • M9 — the Auto Bid modal opened on `nextMinBid`, so a bidder leading with
//    a higher stored maximum who accepted the default silently LOWERED their
//    own ceiling. Nothing on screen changed at the moment they did it.
//  • L14 — the auction close ran entirely off the device clock. A phone a few
//    minutes fast hid “Place Bid” on an auction the server still accepted bids
//    for; a phone behind showed the CTAs on one it had already closed.
//
// Neither is visible in a screenshot, so both are pinned here.
// ────────────────────────────────────────────────────────────────────

describe('Auto Bid modal prefill', () => {
  it('opens on the minimum when there is no existing maximum', () => {
    expect(autoBidPrefillCents(45_000, null)).toBe(45_000);
    expect(autoBidPrefillCents(45_000, undefined)).toBe(45_000);
  });

  it('keeps an existing maximum that is above the minimum', () => {
    // The leading R400 / max R500 case from the audit: opening the modal must
    // not offer R450 as if it were a raise.
    expect(autoBidPrefillCents(45_000, 50_000)).toBe(50_000);
  });

  it('never opens BELOW the minimum even with a stale, lower maximum', () => {
    // The ceiling is stale because someone else pushed the visible bid past
    // it; the modal still has to open on a legal bid.
    expect(autoBidPrefillCents(60_000, 50_000)).toBe(60_000);
  });

  it('treats a zero maximum as a real amount, not a missing one', () => {
    expect(autoBidPrefillCents(5_000, 0)).toBe(5_000);
  });

  it('does not return NaN for a corrupt maximum', () => {
    expect(autoBidPrefillCents(45_000, Number.NaN)).toBe(45_000);
  });
});

describe('Auto Bid current-maximum note', () => {
  it('names the amount the backend actually holds', () => {
    const note = autoBidRaiseNote(50_000);
    expect(note).toContain(formatPrice(50_000));
    expect(note).toContain('Cancel auto bid');
    expect(note).toMatch(/raise it here/);
  });

  it('renders cents rather than rounding a cent-bearing maximum away', () => {
    // The note is the one place the bidder can confirm the exact ceiling.
    expect(autoBidRaiseNote(50_050)).toContain(formatPrice(50_050));
    expect(autoBidRaiseNote(50_050)).toMatch(/[,.]50/);
    expect(autoBidRaiseNote(50_000)).not.toMatch(/[,.]\d{2}/);
  });
});

describe('server-clock correction', () => {
  it('reports a device clock running AHEAD as a positive offset', () => {
    const serverNow = new Date(10_000).toISOString();
    expect(clockOffsetMs(serverNow, 11_500)).toBe(1_500);
  });

  it('reports a device clock running BEHIND as a negative offset', () => {
    const serverNow = new Date(10_000).toISOString();
    expect(clockOffsetMs(serverNow, 9_000)).toBe(-1_000);
  });

  it('corrects a device tick back onto the server clock', () => {
    const serverNow = new Date(10_000).toISOString();
    const deviceNow = 11_500;
    const corrected = serverNowMs(deviceNow, clockOffsetMs(serverNow, deviceNow));
    expect(corrected).toBe(10_000);
  });

  it('stays at zero when the payload has no serverNow', () => {
    // The endpoint contract makes it optional; without it the old
    // device-clock behaviour must survive unchanged.
    expect(clockOffsetMs(undefined, 5_000)).toBe(0);
    expect(clockOffsetMs(null, 5_000)).toBe(0);
    expect(clockOffsetMs('', 5_000)).toBe(0);
  });

  it('stays at zero for an unparseable timestamp', () => {
    expect(clockOffsetMs('not-a-date', 5_000)).toBe(0);
  });
});

describe('outbid SMS reserve warning', () => {
  it('stays silent on a no-reserve auction even though reserveMet is false', () => {
    // ⚠️ THIS IS M11. The backend reports reserveMet: false for auctions that
    // have no reserve at all, and the old page turned that into a false reason
    // not to bid on every no-reserve outbid SMS.
    expect(shouldWarnReserve({ reserveMet: false })).toBe(false);
    expect(shouldWarnReserve({ hasReserve: false, reserveMet: false })).toBe(
      false,
    );
  });

  it('warns when there is a reserve and it is not met', () => {
    expect(shouldWarnReserve({ hasReserve: true, reserveMet: false })).toBe(
      true,
    );
  });

  it('stays silent once the reserve is met', () => {
    expect(shouldWarnReserve({ hasReserve: true, reserveMet: true })).toBe(
      false,
    );
  });

  it('stays silent when the payload predates hasReserve', () => {
    // Guessing would restore the M11 bug on an old payload; quiet is correct.
    expect(shouldWarnReserve({ reserveMet: false })).toBe(false);
    expect(shouldWarnReserve(null)).toBe(false);
    expect(shouldWarnReserve(undefined)).toBe(false);
  });
});
