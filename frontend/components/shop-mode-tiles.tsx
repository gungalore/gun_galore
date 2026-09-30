// 'use client' — the Armory disclosure needs useState, the bar reads the
// session and fetches its own counts, and it reads the pathname to gate
// itself. Safe to add: the file otherwise only imports next/link and
// account-menu-data (data + presentational icons, no server-only imports).
'use client';

import {
  useEffect,
  useRef,
  useState,
  type FC,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { findAccountItem } from '@/lib/account-menu-data';
import { useUser } from '@/lib/auth';
import { useViewerFetch, viewerCacheKey } from '@/lib/use-viewer-fetch';
import { isFinePrintRoute } from '@/lib/fine-print-routes';
import { isTabRoute } from '@/lib/shell-routes';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

// The disclosure caret — a link tile's chevron, or a disclosure's down/up
// caret. Drawn in two places on a phone: inline after the title on a mini
// tile (which has no room for a trailing column) and always as the trailing
// element from sm up. `open` is undefined for a link tile, which is what
// makes it a right-pointing chevron rather than a caret.
function Caret({ open, colour }: { open?: boolean; colour: string }) {
  return (
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
      <Chevron colour={colour} />
    </span>
  );
}

/**
 * The shared tile interior — icon chip, title/count/blurb, caret. The two
 * link tiles (Buy Now, Auctions), the Armory disclosure button and its four
 * sub-tiles all render this SAME markup, which is how "all looking the same"
 * (the operator's requirement) stays true without four copies to keep in
 * sync.
 *
 * `mini` is the phone's treatment for the NAV ROW ONLY (operator, 2026-09-30:
 * "minimize it into one row as mini icon buttons"): centred icon-over-label
 * with no blurb and no count, and the caret inline after the label. From sm
 * up a mini tile is the ordinary tile again — chip left, copy right, trailing
 * caret. The Armory panel's sub-tiles never pass it, so they keep the
 * left-aligned row and their blurbs at every width.
 */
function TileBody({
  mode,
  open,
  mini,
}: {
  mode: Mode;
  open?: boolean;
  mini?: boolean;
}) {
  const { title, blurb, count, noun, accent, ink, Icon } = mode;
  return (
    <>
      <span
        aria-hidden
        className={
          'flex items-center justify-center shrink-0 ' +
          (mini
            ? 'h-[28px] w-[28px] sm:h-[46px] sm:w-[46px]'
            : 'h-[34px] w-[34px] sm:h-[46px] sm:w-[46px]')
        }
        style={{
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

      {/* ⚠️ THE MINI BLURB AND COUNT ARE HIDDEN, NOT SHRUNK. A 115px
          three-across button has room for a label and nothing else, and a
          clipped count reads as broken rather than absent. Both return at sm+
          with the full tile, and the panel's sub-tiles never hide them. */}
      <span
        className={
          'min-w-0 flex flex-col gap-[3px] ' +
          (mini
            ? 'items-center sm:items-start sm:flex-1'
            : 'items-start flex-1')
        }
      >
        {/* ⚠️ WRAPS AS TWO WHOLE PHRASES, NEVER MID-PHRASE. "Buy Now" and
            "1 live listing" together need about 150px of a 146px box, so each
            broke INSIDE itself — "Buy" over "Now", "1 live" over "listing" —
            while "Auctions" happened to fit and stayed on one line. Two tiles
            side by side, one broken and one not, which is what "text on tiles
            looks off" looks like.

            flex-wrap lets the count drop to its own line as a unit, and
            nowrap on both parts stops either being split down the middle. */}
        <span
          className={
            'flex flex-wrap items-baseline gap-x-[10px] ' +
            (mini ? 'justify-center sm:justify-start' : 'justify-start')
          }
        >
          <span
            className={
              'whitespace-nowrap ' +
              (mini ? 'text-[13px] sm:text-[16.5px]' : 'text-[16.5px]')
            }
            style={{
              fontFamily: 'var(--font-head)',
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            {title}
          </span>
          {/* The mini disclosure's caret rides the label row — there is no
              trailing column to put it in at 115px wide (see Caret). */}
          {mini && open !== undefined && (
            <span className="sm:hidden">
              <Caret open={open} colour={ink} />
            </span>
          )}
          {/* Suppressed entirely at zero rather than printing "0 live
              listings" — which is the state this storefront is actually in
              today, and an empty shelf that says so twice is worse than one
              that simply doesn't mention it. */}
          {count !== null && count > 0 && (
            <span
              className="hidden sm:inline whitespace-nowrap"
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

            The parent is `items-center` on a mini tile. `items-center` is not
            `items-stretch`, so a child with no width of its own is sized to
            its content rather than to the parent's 100% — the parent's
            `w-full` never reaches it. On a 390px phone both blurbs rendered at
            full sentence width and hung out of their cards, one off the left
            edge of the screen and one off the right, which also made the whole
            page pannable sideways. */}
        <span
          className={
            (mini ? 'hidden sm:block ' : '') + 'truncate w-full'
          }
          style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}
        >
          {blurb}
        </span>
      </span>

      {/* The trailing mark at sm+ — a link tile's chevron, or the disclosure's
          caret. Hidden on a phone: the mini layout has no column for it, and
          the disclosure draws its own inline in the label row above. */}
      <span className="hidden sm:block shrink-0">
        <Caret open={open} colour={ink} />
      </span>
    </>
  );
}

// The two commerce tiles (Buy Now, Auctions) — plain links, TileBody inside.
//
// `dropIndex` is set only by the Armory panel, and it is what turns a tile
// into one link of the cascade: the class comes from globals.css and the
// delay is the index, so the four sub-tiles land one after another instead of
// together. Undefined for every other tile, which is why the row above and
// the two commerce tiles are untouched by it.
function ModeTile({
  mode,
  dropIndex,
  mini,
}: {
  mode: Mode;
  dropIndex?: number;
  mini?: boolean;
}) {
  const { href, accent } = mode;
  return (
    <Link
      href={href}
      // ⚠️ THE PHONE LAYOUT IS A MINI BUTTON — icon over label, centred, no
      // copy (operator, 2026-09-30: "minimize it into one row as mini icon
      // buttons"). sm+ is the ordinary tile: chip left, title/count/blurb
      // right, trailing caret. `mini` is only ever passed by the nav row —
      // the Armory panel's sub-tiles are full-width rows and keep the
      // left-aligned layout with their blurbs (see TileBody).
      //
      // ⚠️ THE CASCADE CLASS AND DELAY ARE ADDED, NEVER SWAPPED, and only
      // when dropIndex is set — which is only ever inside the Armory panel.
      // The row above and the two commerce tiles pass no index and render
      // byte-for-byte as they always have.
      className={
        'gg-mode-tile gg-tile gg-tile-lift gg-press min-w-0 w-full ' +
        (mini
          ? 'flex flex-col items-center text-center gap-[6px] px-[8px] py-[10px] sm:flex-row sm:items-center sm:text-left sm:gap-[14px] sm:px-[18px] sm:py-[15px]'
          : 'flex flex-row items-center text-left gap-[10px] sm:gap-[14px] px-[14px] py-[10px] sm:px-[18px] sm:py-[15px]') +
        (dropIndex === undefined ? '' : ' gg-armory-sub')
      }
      style={{
        ...(dropIndex === undefined
          ? {}
          : { animationDelay: `${dropIndex * 200}ms` }),
        // ⚠️ TRANSPARENT ON PURPOSE — the tile is a KEYLINE, and the frosted
        // band behind it is the surface. A fill here would cover the blur
        // this whole treatment exists to show.
        background: 'transparent',
        border: `1px solid color-mix(in srgb, ${accent} 42%, transparent)`,
        borderRadius: 'var(--r-md)',
        textDecoration: 'none',
      }}
    >
      <TileBody mode={mode} mini={mini} />
    </Link>
  );
}

// The Armory tile — a disclosure button, not a link: it navigates nowhere, it
// opens the panel below. Same classes/style as ModeTile plus the bits that
// undo UA <button> defaults (full-width block, left-aligned text, inherited
// font, pointer cursor) so it reads identically to its siblings.
function ArmoryTile({
  mode,
  open,
  onToggle,
  mini,
}: {
  mode: Mode;
  open: boolean;
  onToggle: () => void;
  mini?: boolean;
}) {
  const { accent } = mode;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="armory-panel"
      onClick={onToggle}
      // No col-span anymore — Armory is the third MINI button in the same
      // phone row as Buy Now and Auctions, not a full-width row beneath them.
      className={
        'gg-mode-tile gg-tile gg-tile-lift gg-press min-w-0 w-full ' +
        (mini
          ? 'flex flex-col items-center text-center gap-[6px] px-[8px] py-[10px] sm:flex-row sm:items-center sm:text-left sm:gap-[14px] sm:px-[18px] sm:py-[15px]'
          : 'flex flex-row items-center text-left gap-[10px] sm:gap-[14px] px-[14px] py-[10px] sm:px-[18px] sm:py-[15px]')
      }
      style={{
        // Transparent, like ModeTile above — see the note there.
        background: 'transparent',
        border: `1px solid color-mix(in srgb, ${accent} 42%, transparent)`,
        borderRadius: 'var(--r-md)',
        textDecoration: 'none',
        width: '100%',
        textAlign: 'left',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <TileBody mode={mode} open={open} mini={mini} />
    </button>
  );
}

// The panel's four sub-tiles read label/Icon/href from ACCOUNT_GROUPS via
// findAccountItem — the single source of truth also used by the /account
// hub — so only the blurb (short enough to survive a ~400px column, see the
// truncate comment on TileBody's blurb span) is local to this file. Built
// once at module level, not per render, since ACCOUNT_GROUPS is static.
//
// ⚠️ THE ORDER HERE IS DELIBERATELY NOT THE ORDER IN ACCOUNT_GROUPS. The
// account menu runs Vault / Motivations / Reloading / Tracker; this panel
// runs Motivations first and the Vault second, because the panel is a sales
// surface — the thing we do for you leads. Adding a fourth was not a reason to
// reshuffle the three that already convert.
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
  {
    href: '/licence-centre/tracking',
    // Shorter than the neighbours above on purpose: this blurb shares a row of
    // four on desktop and sits as the last full-width card on a phone, and it
    // must not read as a promise about the outcome. It says what the screen
    // does — watch the enquiry — and nothing about what SAPS will answer.
    blurb: 'Watch your SAPS application status.',
  },
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

// ─── Counts ──────────────────────────────────────────────────────────
//
// The bar is mounted once, in the shell, so it renders on EVERY route — which
// is two listing calls per navigation if nothing stops them. This is the
// something: one promise per viewer bucket, kept for the life of the document.
// A member browsing ten pages fires these twice in total, and a sign-out
// switches buckets and fires them once more rather than reusing the member's
// answer for an anonymous visitor (the reason the key is the bucket and not
// the URL — see use-viewer-fetch.ts).
//
// ⚠️ THE FAILURE STATE IS `null`, NOT 0, and the two must not be conflated:
// TileBody prints nothing for null and nothing for 0, but only null means "we
// could not ask". A future reader adding a retry wants to key off null.

type ModeCounts = { buyNow: number | null; auction: number | null };

const countRequests: Partial<Record<'member' | 'anon', Promise<ModeCounts>>> =
  {};

function requestModeCounts(
  bucket: 'member' | 'anon',
  viewerFetch: (url: string, init?: Omit<RequestInit, 'cache'>) => Promise<Response>,
): Promise<ModeCounts> {
  let pending = countRequests[bucket];
  if (!pending) {
    const total = (path: string) =>
      viewerFetch(`${API_URL}${path}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { total?: number } | null) => b?.total ?? null)
        .catch(() => null);
    pending = Promise.all([
      total('/listings?limit=1&listingType=BUY_NOW'),
      total('/listings?limit=1&listingType=AUCTION'),
    ]).then(([buyNow, auction]) => ({ buyNow, auction }));
    countRequests[bucket] = pending;
  }
  return pending;
}

/** How far the panel must be dragged before letting go dismisses it. */
const DISMISS_DRAG_PX = 90;

/**
 * The shop-mode bar — the site-wide fork between the two buying modes and
 * (signed in) the Armory tools. Mounted once in components/shell/app-shell.tsx,
 * directly under the top nav.
 *
 * It is SELF-GATING, deliberately. Every other piece of chrome that must not
 * appear somewhere lives in a route predicate, but the reasons the bar is
 * absent are not all shell-level: /admin and the chromeless statutory routes
 * are already excluded by AppShell, while the fine-print pages and /checkout
 * keep the shell and merely want no storefront fork over them. Putting that
 * here keeps the rule next to the thing it describes — the same reason
 * public-chrome.tsx returns null on /admin rather than that living in a list
 * somewhere else.
 */
export function ShopModeBar() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useUser();
  const { viewerFetch } = useViewerFetch();
  const [open, setOpen] = useState(false);

  // A document, or a focused secure flow — not a shop surface. See
  // lib/fine-print-routes.ts for why the policy pages are enumerated.
  //
  // ⚠️ /checkout MATCHES ON PATH SEGMENTS, NOT ON THE RAW PREFIX. A bare
  // `startsWith('/checkout')` also swallows a future `/checkouts` or
  // `/checkout-help`, and the bar vanishing from an unrelated page is the
  // kind of bug that reads as "the tiles randomly don't show up". The
  // trailing slash is what makes it a child route rather than a longer word.
  const path = pathname ?? '';
  const hidden =
    isFinePrintRoute(pathname) ||
    path === '/checkout' ||
    path.startsWith('/checkout/');

  const bucket = viewerCacheKey(isSignedIn);
  const [counts, setCounts] = useState<ModeCounts>(
    () => ({ buyNow: null, auction: null }),
  );

  useEffect(() => {
    // Wait for the session to settle. Fetching before it does would ask as an
    // anonymous visitor and then again as a member — the second request is the
    // one whose bucket we keep, so the first is pure waste.
    if (!isLoaded || hidden) return;
    let cancelled = false;
    requestModeCounts(bucket, viewerFetch).then((next) => {
      if (!cancelled) setCounts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, isLoaded, hidden, viewerFetch]);

  // ── Drag-to-dismiss (phones only) ──────────────────────────────────
  // The panel expands to four tiles on a phone and there is no other way to
  // put it away without tapping the Armory tile again. The handle at the top
  // of the panel takes a downward drag; released past DISMISS_DRAG_PX the
  // panel closes, otherwise it springs back. Upward drag is damped, because
  // there is nothing up there to reveal.
  //
  // The CSS gates the HANDLE to below sm (the `.sm:hidden` class below); the
  // handlers are inert at every width but simply never fire on desktop, where
  // there is no handle to grab.
  const drag = useRef({ active: false, startY: 0, dy: 0 });
  const [dragY, setDragY] = useState(0);

  function onHandleDown(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { active: true, startY: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onHandleMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    const raw = e.clientY - drag.current.startY;
    const dy = raw > 0 ? raw : raw * 0.2;
    drag.current.dy = dy;
    setDragY(dy);
  }
  function onHandleUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    drag.current.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (drag.current.dy > DISMISS_DRAG_PX) setOpen(false);
    drag.current.dy = 0;
    setDragY(0);
  }

  if (hidden) return null;

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
      count: counts.buyNow,
      noun: 'listing',
      accent: 'var(--red)',
      ink: 'var(--link)',
      Icon: TagIcon,
    },
    {
      href: '/?listingType=AUCTION',
      title: 'Auctions',
      blurb: 'Live bidding in R50 steps — auctions close daily.',
      count: counts.auction,
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
    // ⚠️ `data-shop-scope` IS THE MOBILE GATE, AND IT IS CSS-ONLY. On desktop
    // the band shows on every surface the shell renders; on a phone and in the
    // installed app it is a shop-surface thing ('tabs-only'), so the selector
    // in globals.css can hide it on /bench, a listing, the Centres and so on.
    // Stamping the scope here rather than branching on a width keeps the markup
    // identical at every viewport — the server can render it without guessing
    // which audience it is for, which is the property the whole shell is built
    // around. isTabRoute is the same allowlist the bottom tab bar uses.
    <div
      data-shop-mode-bar
      data-shop-scope={isTabRoute(pathname) ? 'tabs' : 'tabs-only'}
    >
      <nav
        // The row is no longer only ways to BUY once Armory joins it, and a
        // landmark whose name lies about its contents is worse than a
        // generic one.
        aria-label={isSignedIn ? 'Shop and member tools' : 'Ways to buy'}
        // ⚠️ THREE MINI BUTTONS IN ONE PHONE ROW (operator, 2026-09-30).
        // grid-cols-3 below sm gives ~115px each — enough for a 28px chip and
        // a 13px label, which is exactly what the mini treatment draws and why
        // the copy and the count are not rendered there (see TileBody). The
        // sm+ layout is the three-column tile row it has always been, so
        // desktop is untouched.
        //
        // Signed-out visitors have only two buttons, so they keep
        // grid-cols-2 at every width rather than leaving a hole in a
        // three-column row.
        className={
          isSignedIn
            ? 'max-w-[var(--page-max)] mx-auto px-4 sm:px-6 pt-[18px] grid grid-cols-3 gap-[11px] sm:gap-[14px]'
            : 'max-w-[var(--page-max)] mx-auto px-4 sm:px-6 pt-[18px] grid grid-cols-2 gap-[11px] sm:gap-[14px]'
        }
      >
        {modes.map((m) => (
          <ModeTile key={m.title} mode={m} mini />
        ))}
        {isSignedIn && (
          <ArmoryTile
            mode={armoryMode}
            open={open}
            mini
            // Re-opening must replay the cascade from the top. The sub-tiles
            // are remounted rather than re-animated (the whole panel is
            // conditional), so closing and opening again restarts it for free
            // — no animation-name juggling, no key churn.
            onToggle={() => setOpen((o) => !o)}
          />
        )}
      </nav>

      {/* The disclosure panel — same width/padding as the nav above, so the
          sub-tiles line up with the row they expand from.
          ⚠️ THE COLUMN COUNT TRACKS THE NUMBER OF SUB-TILES, and it is not the
          nav row's `sm:grid-cols-3`. Four tiles in a three-column grid leaves
          one wrapped alone on a second row at a different height — the exact
          "reads as an oversight" the group-of-one comment above warns about.
          `sm:grid-cols-2` keeps a 2×2 block on a tablet, where four columns
          would squeeze each tile below the ~180px its internal layout has
          already broken at once (see the nav row's comment). */}
      {isSignedIn && open && (
        <div
          className="max-w-[var(--page-max)] mx-auto px-4 sm:px-6"
          // The finger follows the panel while it is being dragged; at rest
          // this is 0 and the transition is what returns it when a short drag
          // is released short of the threshold.
          style={{
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: drag.current.active ? 'none' : 'transform var(--dur-fast) var(--ease-out)',
            touchAction: dragY ? 'none' : undefined,
          }}
        >
          {/* The grab handle — the phone's only way to dismiss the panel
              without tapping Armory again. Hidden from sm up (the panel is a
              one-row disclosure there and drag-to-dismiss is not needed). */}
          <div
            className="sm:hidden flex justify-center pt-[11px]"
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            aria-hidden
          >
            <span
              style={{
                width: 38,
                height: 4,
                borderRadius: 999,
                background: 'var(--border-hover)',
              }}
            />
          </div>
          <div
            id="armory-panel"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[11px] sm:gap-[14px] pt-[11px]"
          >
            {ARMORY_SUB_TILES.map((m, i) => (
              // Each sub-tile navigates away, so the panel does not have to be
              // collapsed on selection — the next page renders with `open`
              // false. `dropIndex` is what staggers the cascade; see ModeTile.
              <ModeTile key={m.href} mode={m} dropIndex={i} />
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
          /* ⚠️ A TRANSLUCENT tint, not var(--bg-card-hover). That token is an
             opaque near-white; on a tile whose whole point is that the frosted
             band shows through it, filling the tile solid on hover would kill
             the blur under the pointer — the one place the eye is looking.
             color-mix keeps the highlight and keeps the pane of glass. */
          .gg-mode-tile:hover {
            background: color-mix(in srgb, var(--bg-card-hover) 70%, transparent);
          }
        }
      `}</style>
    </div>
  );
}
