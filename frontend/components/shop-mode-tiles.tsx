import Link from 'next/link';

/**
 * "Shop by mode" — the two ways to buy, as the design pack's paired tiles.
 *
 * These are the storefront's primary fork and they did not exist. The two
 * modes were only reachable as text links in the nav's second tier plus a
 * `?listingType=` query param, which is why the live homepage went hero →
 * fine print with nothing shopping-shaped in between.
 *
 * ⚠️ THE NAV'S SECOND TIER EXISTS BECAUSE THESE DIDN'T. Once these tiles are
 * on the page, the "Buy Now / Auctions" strip under the header is a duplicate
 * of them and the header can collapse to the design's single 62px row. Don't
 * remove that tier before this component is rendering, or the two modes become
 * unreachable for a release.
 *
 * Values are the pack's, with the diluted fills expressed as color-mix rather
 * than the literal rgba() it hardcodes — a token that can follow the theme
 * beats a frozen hex. (And per globals.css: you CANNOT write var(--red)21 to
 * get 13% — custom-property substitution is token-based, so that computes to
 * transparent. color-mix or a *-wash token, never concatenation.)
 */

type Mode = {
  href: string;
  title: string;
  blurb: string;
  /** Live count. Null when we couldn't get one; 0 renders nothing. */
  count: number | null;
  /** "listing" / "auction" — pluralised here so the copy stays honest at 1. */
  noun: string;
  accent: string;
  ink: string;
};

function TagIcon({ colour }: { colour: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 11.2V4.5a1 1 0 0 1 1-1h6.7a1 1 0 0 1 .7.3l8.3 8.3a1 1 0 0 1 0 1.4l-6.7 6.7a1 1 0 0 1-1.4 0L3.8 11.9a1 1 0 0 1-.3-.7Z"
        stroke={colour}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.5" fill={colour} />
    </svg>
  );
}

function GavelIcon({ colour }: { colour: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.5 12.5 6.5 20.5a2.1 2.1 0 0 1-3-3l8-8M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"
        stroke={colour}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Chevron({ colour }: { colour: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 5.5 15.5 12 9 18.5"
        stroke={colour}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ModeTile({ mode }: { mode: Mode }) {
  const { href, title, blurb, count, noun, accent, ink } = mode;
  return (
    <Link
      href={href}
      // Row at every width (see the nav below), but the INTERNAL layout still
      // has to flip: icon-left/text-right only has room once the tile is
      // wide enough for icon + text + chevron side by side (sm+). Below that
      // the board stacks icon chip, then title+count, then blurb — so this
      // is flex-col until sm, not flex-row throughout. `items-center` and
      // `gap-[14px]` are unprefixed because they're correct for BOTH axes:
      // items-center centers the column horizontally on mobile and the row
      // vertically at sm+, and a single `gap` value covers row-gap/column-gap
      // for whichever axis is active.
      className="gg-mode-tile gg-tile gg-tile-lift gg-press flex flex-col items-center text-center gap-[14px] sm:flex-row sm:text-left flex-1 min-w-0"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid color-mix(in srgb, ${accent} 42%, transparent)`,
        borderRadius: 'var(--r-md)',
        padding: '15px 18px',
        textDecoration: 'none',
      }}
    >
      <span
        aria-hidden
        className="flex items-center justify-center shrink-0"
        style={{
          width: 46,
          height: 46,
          borderRadius: 'var(--r-md)',
          background: `color-mix(in srgb, ${accent} 13%, transparent)`,
        }}
      >
        {title === 'Auctions' ? (
          <GavelIcon colour={ink} />
        ) : (
          <TagIcon colour={ink} />
        )}
      </span>

      {/* w-full so blurb's `truncate` has a bound to ellipsize against on the
          stacked mobile layout (a flex item with no flex-grow shrinks to
          content width, which defeats truncate); sm:flex-1/sm:w-auto hand
          growth back to the row layout once icon + text + chevron sit
          side by side. */}
      <span className="w-full min-w-0 flex flex-col items-center sm:items-start sm:flex-1 sm:w-auto gap-[3px]">
        {/* ⚠️ WRAPS AS TWO WHOLE PHRASES, NEVER MID-PHRASE. With the blurb's
            overflow fixed, this row became the next thing too wide for a
            170px tile: "Buy Now" and "1 live listing" together need about
            150px of a 146px box, so each broke INSIDE itself — "Buy" over
            "Now", "1 live" over "listing" — while "Auctions" happened to fit
            and stayed on one line. Two tiles side by side, one broken and one
            not, which is what "text on tiles looks off" looks like.

            flex-wrap lets the count drop to its own line as a unit, and
            nowrap on both parts stops either being split down the middle. */}
        <span className="flex flex-wrap items-baseline justify-center sm:justify-start gap-x-[10px]">
          <span
            className="whitespace-nowrap"
            style={{
              fontFamily: 'var(--font-head)',
              fontWeight: 700,
              fontSize: '16.5px',
              color: 'var(--text-primary)',
            }}
          >
            {title}
          </span>
          {/* Suppressed entirely at zero rather than printing "0 live
              listings" — which is the state this storefront is actually in
              today, and an empty shelf that says so twice is worse than one
              that simply doesn't mention it. */}
          {count !== null && count > 0 && (
            <span
              className="whitespace-nowrap"
              style={{ fontSize: 12, color: 'var(--text-faint)' }}
            >
              {count.toLocaleString('en-ZA')} live {noun}
              {count === 1 ? '' : 's'}
            </span>
          )}
        </span>
        {/* ⚠️ `w-full` BELONGS HERE, ON THE TRUNCATING ELEMENT ITSELF — AND IT
            WAS ON THE PARENT INSTEAD, WHICH DOES NOTHING FOR IT.

            `truncate` is `overflow:hidden; text-overflow:ellipsis;
            white-space:nowrap`. The nowrap is the dangerous half: with nothing
            bounding its width, this span's intrinsic width becomes the full
            unwrapped sentence, and `overflow:hidden` clips nothing because the
            span IS the oversized box.

            The parent is `flex flex-col items-center` on mobile. `items-center`
            is not `items-stretch`, so a child with no width of its own is
            sized to its content rather than to the parent's 100% — the
            parent's `w-full` never reaches it. On a 390px phone both blurbs
            rendered at full sentence width and hung out of their cards, one off
            the left edge of the screen and one off the right, which also made
            the whole page pannable sideways. */}
        <span
          className="truncate w-full"
          style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}
        >
          {blurb}
        </span>
      </span>

      {/* Board's mobile tile is three stacked rows (icon / title+count /
          blurb) with no chevron drawn — there's no fourth row for it in that
          layout. It returns once the tile is wide enough to lay out
          horizontally (sm+). */}
      <span className="hidden sm:block shrink-0">
        <Chevron colour={ink} />
      </span>
    </Link>
  );
}

export function ShopModeTiles({
  buyNowCount,
  auctionCount,
}: {
  buyNowCount: number | null;
  auctionCount: number | null;
}) {
  const modes: Mode[] = [
    {
      href: '/?listingType=BUY_NOW',
      title: 'Buy Now',
      // ⚠️ THE PACK'S COPY HERE SAID "buy instantly or take a shot with an
      // offer", and that is not true of a Buy Now listing. TAKE_A_SHOT is a
      // SEPARATE listingType with its own OfferPanel — app/listings/[id]/
      // page.tsx gates the offer flow on `listingType === 'TAKE_A_SHOT'`, and
      // SELL_MODES still offers it as a third mode when listing. A Buy Now
      // item accepts no offers at all, so the pack's line promised a flow that
      // does not exist on the thing it describes.
      // Neither line advertises funds-holding, and neither says escrow.
      blurb: 'Fixed prices — pay the listed price and it is yours.',
      count: buyNowCount,
      noun: 'listing',
      accent: 'var(--red)',
      ink: 'var(--link)',
    },
    {
      href: '/?listingType=AUCTION',
      title: 'Auctions',
      blurb: 'Live bidding in R50 steps — auctions close daily.',
      count: auctionCount,
      noun: 'auction',
      accent: 'var(--gold)',
      ink: 'var(--gold)',
    },
  ];

  return (
    <>
      <nav
        aria-label="Ways to buy"
        // Row at EVERY width, not just sm+ — flex-col here was the mobile
        // bug: the board draws Buy Now / Auctions side by side even at
        // 390px (11px gap, each tile flex:1). Stacking them full-width was
        // never the design; it just went unnoticed because the tile's own
        // internal layout (see ModeTile) hadn't been built to survive a
        // ~180px-wide tile either, so the fix is both changes together.
        className="max-w-[var(--page-max)] mx-auto px-4 sm:px-6 pt-[18px] flex flex-row gap-[11px] sm:gap-[14px]"
      >
        {modes.map((m) => (
          <ModeTile key={m.title} mode={m} />
        ))}
      </nav>

      {/* Hover is colour-only and gated to real pointers — a hover that sticks
          after a tap is worse than none. The press comes from .gg-press. */}
      <style>{`
        @media (hover: hover) and (pointer: fine) {
          .gg-mode-tile {
            transition:
              background-color var(--dur-fast) var(--ease-standard),
              border-color var(--dur-fast) var(--ease-standard);
          }
          .gg-mode-tile:hover { background: var(--bg-card-hover); }
        }
      `}</style>
    </>
  );
}
