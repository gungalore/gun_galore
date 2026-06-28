'use client';

// Swap / Trade panel on the listing detail page.
//
// S1 (this slice): SWOP listings exist + are browsable, but the proposal
// flow isn't open yet. This panel is the placeholder CTA — it explains the
// listing is a swap and that proposing one opens soon. S2 replaces the
// body with the real "Propose a swap" form (pick one of your SWOP listings
// + optional cash, counter-once negotiation, etc.).

export default function SwapPanel({
  isOwnListing,
}: {
  listingId: string;
  sellerClerkId: string;
  isOwnListing: boolean;
}) {
  return (
    <div
      className="rounded-[8px] p-4 mb-5"
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div
        className="text-sm mb-1"
        style={{ color: 'var(--text-primary)', fontWeight: 600 }}
      >
        {isOwnListing ? 'Your Swop / Trade listing' : 'Open to swaps'}
      </div>
      <p
        className="text-sm"
        style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
      >
        {isOwnListing
          ? 'This item is listed for swap. When someone proposes a trade, you’ll be able to review it here and accept, decline, or counter the cash.'
          : 'The owner wants to trade this item rather than sell it. Proposing a swap (your item, plus optional cash either way) opens here soon — save it to your wishlist so you don’t lose it.'}
      </p>
    </div>
  );
}
