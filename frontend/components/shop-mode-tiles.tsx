// 'use client' — the Armory disclosure needs useState to hold its
// open/closed state. Safe to add: this file otherwise only imports
// next/link and account-menu-data (data + presentational icons, no
// server-only imports) and takes primitive props, so nothing here depends
// on running on the server.
'use client';

import { useState, type FC } from 'react';
import Link from 'next/link';
import { findAccountItem } from '@/lib/account-menu-data';

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
  Icon: FC<{ colour: string }>;
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

// Armory's own glyph — a shield, matching TagIcon/GavelIcon's house style
// (21×21, viewBox 0 0 24 24, stroke-only, rounded joins). Armory is not a
// shopping mode, so it gets a mark of its own rather than borrowing one of
// the two commerce icons.
function ShieldIcon({ colour }: { colour: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5 19 6v6c0 5-3.2 8-7 9.5-3.8-1.5-7-4.5-7-9.5V6l7-2.5Z"
        stroke={colour}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 12.2 11 14.3 15.3 9.7"
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

// The shared tile interior — icon chip, title/count/blurb, chevron. Both the
// two link tiles (Buy Now, Auctions), the Armory disclosure button and its
// three sub-tiles render this SAME markup, which is how "all looking the
// same" (the operator's requirement) stays true without four copies to keep
// in sync. `open` only means something for the Armory button — it's
// undefined for every Link tile, which renders exactly as it always has.
function TileBody({ mode, open }: { mode: Mode; open?: boolean }) {
  const { title, blurb, count, noun, accent, ink, Icon } = mode;
  return (
    <>
      <span
        aria-hidden
        className="flex items-center justify-center shrink-0"
        style={{
          width: 46,
          height: 46,
          borderRadius: 'var(--r-md)',
          background: `color-mix(in srgb, ${accent} 13%, transparent)`,
          // The account-menu icons (used by the Armory sub-tiles) are drawn
          // with stroke="currentColor" and paint nothing without a `color`
          // to inherit; TagIcon/GavelIcon/ShieldIcon take an explicit
          // `colour` prop instead. Both need to work here, so this chip sets
          // `color` AND passes `colour` to whichever icon it's given.
          color: ink,
        }}
      >
        <Icon colour={ink} />
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
          horizontally (sm+).

          ⚠️ THE DISCLOSURE IS THE EXCEPTION, AND IT HAS TO BE. A link tile
          losing its chevron on a phone costs nothing — the whole tile is
          still obviously tappable and it goes somewhere. Armory does NOT go
          somewhere: the chevron is the only thing on the tile saying it
          expands, and hiding it below sm left the phone — the primary
          audience — with a tile that looks like a dead link. So the
          disclosure draws its chevron at every width, as a caret: pointing
          down when closed, up when open. `open` is undefined for every Link
          tile, which is how this tells the two apart and why those render
          exactly as they did before TileBody existed. */}
      <span
        className={
          open === undefined ? 'hidden sm:block shrink-0' : 'block shrink-0'
        }
      >
        <span
          className="inline-block"
          style={{
            transform:
              open === undefined
                ? 'none'
                : open
                  ? 'rotate(-90deg)'
                  : 'rotate(90deg)',
            transition: `transform var(--dur-fast) var(--ease-standard)`,
          }}
        >
          <Chevron colour={ink} />
        </span>
      </span>
    </>
  );
}

// The two commerce tiles (Buy Now, Auctions) — plain links, TileBody inside.
function ModeTile({ mode }: { mode: Mode }) {
  const { href, accent } = mode;
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
      className="gg-mode-tile gg-tile gg-tile-lift gg-press flex flex-col items-center text-center gap-[14px] sm:flex-row sm:text-left min-w-0 w-full"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid color-mix(in srgb, ${accent} 42%, transparent)`,
        borderRadius: 'var(--r-md)',
        padding: '15px 18px',
        textDecoration: 'none',
      }}
    >
      <TileBody mode={mode} />
    </Link>
  );
}

// The Armory row itself — a disclosure button, not a link: it navigates
// nowhere, it opens the panel below. Same classes/style as ModeTile plus the
// bits that undo UA <button> defaults (full-width block, left-aligned text,
// inherited font, pointer cursor) so it reads identically to its siblings.
function ArmoryTile({
  mode,
  open,
  onToggle,
}: {
  mode: Mode;
  open: boolean;
  onToggle: () => void;
}) {
  const { accent } = mode;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="armory-panel"
      onClick={onToggle}
      className="gg-mode-tile gg-tile gg-tile-lift gg-press flex flex-col items-center text-center gap-[14px] sm:flex-row sm:text-left min-w-0 w-full col-span-2 sm:col-span-1"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid color-mix(in srgb, ${accent} 42%, transparent)`,
        borderRadius: 'var(--r-md)',
        padding: '15px 18px',
        textDecoration: 'none',
        width: '100%',
        textAlign: 'left',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <TileBody mode={mode} open={open} />
    </button>
  );
}

// The panel's three sub-tiles read label/Icon/href from ACCOUNT_GROUPS via
// findAccountItem — the single source of truth also used by the /account
// hub — so only the blurb (short enough to survive a ~400px column, see the
// truncate comment on TileBody's blurb span) is local to this file. Built
// once at module level, not per render, since ACCOUNT_GROUPS is static.
const ARMORY_PANEL_SOURCE: { href: string; blurb: string }[] = [
  {
    href: '/licence-centre/applications',
    blurb: 'We write the motivation you sign and hand in.',
  },
  {
    href: '/documents',
    blurb: 'Licences and ID kept safe, renewals tracked.',
  },
  { href: '/bench', blurb: 'What you can load from what is on your shelf.' },
];

const ARMORY_SUB_TILES: Mode[] = ARMORY_PANEL_SOURCE.flatMap(
  ({ href, blurb }) => {
    const item = findAccountItem(href);
    // Defensive, not paranoid: this component must not crash over a
    // menu-data edit made elsewhere. app/account/page.tsx uses the same
    // pattern against the same lookup.
    if (!item) return [];
    return [
      {
        href: item.href,
        title: item.label,
        blurb,
        count: null,
        noun: '',
        accent: 'var(--text-secondary)',
        ink: 'var(--text-primary)',
        Icon: item.Icon,
      },
    ];
  },
);

export function ShopModeTiles({
  buyNowCount,
  auctionCount,
  signedIn,
}: {
  buyNowCount: number | null;
  auctionCount: number | null;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
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
      Icon: TagIcon,
    },
    {
      href: '/?listingType=AUCTION',
      title: 'Auctions',
      blurb: 'Live bidding in R50 steps — auctions close daily.',
      count: auctionCount,
      noun: 'auction',
      accent: 'var(--gold)',
      ink: 'var(--gold)',
      Icon: GavelIcon,
    },
  ];

  // The Armory disclosure tile — not a shopping mode, so it takes neither
  // --red (Buy Now) nor --gold (Auctions): a warm-dark keyline says "this
  // isn't a third way to buy" instead of competing with the two that are.
  const armoryMode: Mode = {
    href: '',
    title: 'Armory',
    // ⚠️ SHORT ENOUGH TO SURVIVE THE TILE. The blurb span is `truncate` (one
    // line, see TileBody), and on a 375px phone "…, in one place." ellipsised
    // even at the full-width col-span-2. Every word here has to earn its place.
    blurb: 'Your licence paperwork and reloading bench.',
    count: null,
    noun: '',
    accent: 'var(--text-secondary)',
    ink: 'var(--text-primary)',
    Icon: ShieldIcon,
  };

  return (
    <>
      <nav
        // The row is no longer only ways to BUY once Armory joins it, and a
        // landmark whose name lies about its contents is worse than a
        // generic one.
        aria-label={signedIn ? 'Shop and member tools' : 'Ways to buy'}
        // Row at EVERY width, not just sm+ — flex-col here was the mobile
        // bug: the board draws Buy Now / Auctions side by side even at
        // 390px (11px gap, each tile flex:1). Stacking them full-width was
        // never the design; it just went unnoticed because the tile's own
        // internal layout (see ModeTile) hadn't been built to survive a
        // ~180px-wide tile either, so the fix is both changes together.
        //
        // flex -> grid so a third tile (Armory) can span both mobile columns
        // while Buy Now/Auctions keep their existing side-by-side sizing:
        // three tiles across a 390px phone gives ~118px each, and the tile's
        // own internal layout has already produced one bug at ~180px (see
        // the comments inside TileBody above). Buy Now and Auctions stay
        // exactly as they are today; Armory sits full-width beneath them and
        // only joins the row at sm+.
        //
        // Signed-out visitors get NO third column at any width — grid-cols-2
        // unconditionally when Armory isn't rendered, so nothing shifts for
        // them.
        className={
          signedIn
            ? 'max-w-[var(--page-max)] mx-auto px-4 sm:px-6 pt-[18px] grid grid-cols-2 sm:grid-cols-3 gap-[11px] sm:gap-[14px]'
            : 'max-w-[var(--page-max)] mx-auto px-4 sm:px-6 pt-[18px] grid grid-cols-2 gap-[11px] sm:gap-[14px]'
        }
      >
        {modes.map((m) => (
          <ModeTile key={m.title} mode={m} />
        ))}
        {signedIn && (
          <ArmoryTile
            mode={armoryMode}
            open={open}
            onToggle={() => setOpen((o) => !o)}
          />
        )}
      </nav>

      {/* The disclosure panel — same width/padding as the nav above, so the
          three sub-tiles line up with the row they expand from. */}
      {signedIn && open && (
        <div className="max-w-[var(--page-max)] mx-auto px-4 sm:px-6">
          <div
            id="armory-panel"
            className="grid grid-cols-1 sm:grid-cols-3 gap-[11px] sm:gap-[14px] pt-[11px]"
          >
            {ARMORY_SUB_TILES.map((m) => (
              <ModeTile key={m.href} mode={m} />
            ))}
          </div>
        </div>
      )}

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
