import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GUIDES,
  type AskGgGuide,
  type GuidePersonalItem,
} from './guide-content';
import {
  AskGgAccountToolsService,
  type AskGgAccount,
} from './ask-gg-account-tools.service';

// GG site-guide (G2/G3/G4) — resolves the curated page guide for the current
// page, injecting LIVE state. ZERO Claude calls: the always-on, $0-AI guide.
//
// TWO SURFACES:
//  - getGuide()  — PUBLIC (the same info shown on the page). No auth; works
//    signed-out. Reserve PRICE is never emitted — only the reserve-met boolean.
//  - getPersonalGuide() — AUTHED (G4). Layers the signed-in user's OWN
//    top-of-mind state on top of the public guide, composed entirely from the
//    read-only, PII-gated W5 account shapers (usernames only; never bank / PIN
//    / address / email / real name — see ask-gg-account-tools privacy contract).
//    Still ZERO Claude. Any failure degrades to the plain public guide.

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** getUrgentSummary severity → the overlay chip tone. */
function toneForSeverity(
  s: 'info' | 'warning' | 'critical',
): GuidePersonalItem['tone'] {
  return s === 'info' ? 'info' : 'action';
}

function railRands(cents: number): string {
  return `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;
}

function humanizeMs(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

function clone(g: AskGgGuide): AskGgGuide {
  return {
    ...g,
    points: [...g.points],
    ctas: g.ctas ? g.ctas.map((c) => ({ ...c })) : undefined,
  };
}

@Injectable()
export class AskGgGuideService {
  private readonly logger = new Logger(AskGgGuideService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountTools: AskGgAccountToolsService,
  ) {}

  /** The guide for the given page. Never throws — falls back to a generic
   *  guide on anything unexpected. */
  async getGuide(input: { path?: string; listingId?: string }): Promise<AskGgGuide> {
    const path =
      typeof input.path === 'string' && input.path.startsWith('/')
        ? input.path
        : '/';
    const seg = path.split('/').filter(Boolean);

    // Exact-path specials must win over the generic /listings/:id lookup —
    // otherwise ID_RE matches 'new' and the seller's sell form resolves to a
    // bogus listing id (→ the buyer guide). Keep this ahead of the extraction.
    if (path === '/listings/new') return clone(GUIDES['sell-form']);

    // Listing detail resolves by listing TYPE + live state.
    const listingId =
      seg[0] === 'listings' && seg.length === 2 && ID_RE.test(seg[1])
        ? seg[1]
        : typeof input.listingId === 'string' && ID_RE.test(input.listingId)
          ? input.listingId
          : undefined;

    if (listingId) {
      try {
        return await this.listingGuide(listingId);
      } catch {
        return clone(GUIDES['listing-buy-now']);
      }
    }

    return clone(GUIDES[this.keyForPath(path, seg)] ?? GUIDES.generic);
  }

  /**
   * G4 — the AUTHED guide: the public guide + a `personal` overlay of the
   * signed-in user's OWN top-of-mind state for this page. $0 AI — every signal
   * comes from the read-only, PII-gated W5 account shapers (whitelist-by-
   * construction: usernames only; never bank / PIN / address / email / real
   * name). Degrades gracefully: any failure returns the plain public guide,
   * never a blank. The overlay is OMITTED entirely when there's nothing worth
   * showing — a guide, not a nag.
   */
  async getPersonalGuide(
    clerkId: string,
    input: { path?: string; listingId?: string },
  ): Promise<AskGgGuide> {
    const base = await this.getGuide(input);
    try {
      const user = await this.prisma.user.findUnique({
        where: { clerkId },
        select: { id: true },
      });
      if (!user) return base;
      const account: AskGgAccount = { clerkId, userId: user.id };

      const items: GuidePersonalItem[] = [];

      // Backbone — the SAME urgent-notifications the site's attention strip
      // uses (KYC gate, auction wins, accepted offers, sales needing dispatch).
      // Already {id,label,href,severity}, PII-free by construction.
      try {
        const overview = await this.accountTools.getMyAccountOverview(account);
        for (const n of overview.needsAttention.slice(0, 4)) {
          items.push({
            label: n.label,
            href: n.href,
            tone: toneForSeverity(n.severity),
          });
        }
      } catch (e) {
        this.logger.debug(`overview overlay skipped: ${String(e)}`);
      }

      // Page-targeted enrichment (cheap, one extra read at most).
      await this.enrichForPage(base.key, input.listingId, account, items);

      if (items.length === 0) return base;

      // Dedupe + cap at 5. Collapse by href so the same destination (e.g. the
      // KYC gate reached from both the urgent strip and a payout blocker)
      // shows once; items without an href dedupe by label.
      const seen = new Set<string>();
      const deduped = items
        .filter((it) => {
          const k = it.href ? `h:${it.href}` : `l:${it.label}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 5);

      return {
        ...base,
        personal: { headline: 'For you on this page', items: deduped },
      };
    } catch (e) {
      this.logger.debug(`personal guide failed, serving public: ${String(e)}`);
      return base;
    }
  }

  /** Fold a few page-specific personal signals into the overlay. Each shaper
   *  is PII-safe (W5) and wrapped so a failure never breaks the guide. */
  private async enrichForPage(
    key: string,
    listingId: string | undefined,
    account: AskGgAccount,
    items: GuidePersonalItem[],
  ): Promise<void> {
    // On an auction listing: am I in this specific auction, and how am I doing?
    if (key === 'listing-auction' && listingId && ID_RE.test(listingId)) {
      try {
        const { auctionBids } = await this.accountTools.getMyOffersAndBids(
          account,
        );
        const mine = auctionBids.find((b) => b.href === `/listings/${listingId}`);
        if (mine) {
          if (mine.won) {
            items.push({
              label: 'You won this auction — complete payment to lock it in.',
              href: `/listings/${listingId}`,
              tone: 'action',
            });
          } else if (mine.youAreHighBidder) {
            items.push({
              label: 'You’re the top bidder right now — hold your nerve.',
              href: `/listings/${listingId}`,
              tone: 'good',
            });
          } else {
            items.push({
              label:
                'You’ve been outbid — raise your maximum to get back in front.',
              href: `/listings/${listingId}`,
              tone: 'action',
            });
          }
        }
      } catch (e) {
        this.logger.debug(`auction overlay skipped: ${String(e)}`);
      }
    }

    // On the seller money pages: surface anything blocking a payout + a status
    // line. payoutBlockers already carry a fixHref; both are PII-safe strings.
    if (key === 'earnings' || key === 'dashboard' || key === 'my-listings') {
      try {
        const earnings = await this.accountTools.getSellerEarnings(account);
        for (const b of earnings.payoutBlockers) {
          items.push({ label: b.issue, href: b.fixHref, tone: 'action' });
        }
        if (
          key === 'earnings' &&
          earnings.payoutBlockers.length === 0 &&
          (earnings.summary.completedSales ?? 0) > 0
        ) {
          items.push({
            label: earnings.note,
            href: '/my/earnings',
            tone: 'info',
          });
        }
      } catch (e) {
        this.logger.debug(`earnings overlay skipped: ${String(e)}`);
      }
    }
  }

  private keyForPath(path: string, seg: string[]): string {
    if (path === '/') return 'home';
    if (path === '/listings/new') return 'sell-form';
    // Browse surfaces (bare /listings, brands). Listing detail /listings/:id is
    // resolved earlier via listingGuide, never reaches here.
    if (seg[0] === 'listings') return 'browse';
    if (seg[0] === 'category') return 'category';
    if (seg[0] === 'brands' || seg[0] === 'brand') return 'browse';
    if (seg[0] === 'sellers') return 'sellers';

    // Transactions — the firearm stock-in sub-page wins over the plain detail.
    if (seg[0] === 'transactions' && seg[2] === 'dealer-verification') {
      return 'dealer-verification';
    }
    if (seg[0] === 'transactions' && seg.length === 2) return 'transaction';

    // Single order.
    if (seg[0] === 'orders' && seg.length === 2) return 'order';

    // My-* hub pages (buyer + seller).
    if (seg[0] === 'my') {
      if (seg[1] === 'orders' || seg[1] === 'sales') return 'orders';
      if (seg[1] === 'offers' || seg[1] === 'bids') return 'offers';
      if (seg[1] === 'listings') return 'my-listings';
      if (seg[1] === 'swaps') return 'swaps';
      if (seg[1] === 'earnings') return 'earnings';
      if (seg[1] === 'tickets') return 'tickets';
      return 'orders';
    }
    if (seg[0] === 'orders' || seg[0] === 'offers') return 'offers';

    if (seg[0] === 'cart' || seg[0] === 'checkout') return 'cart';

    // Wanted — poster form + a single ad get their own variants.
    if (seg[0] === 'wanted') {
      if (seg[1] === 'new') return 'wanted-new';
      if (seg.length === 2) return 'wanted-detail';
      return 'wanted';
    }

    if (seg[0] === 'competitions') return 'competitions';

    // Account cluster.
    if (seg[0] === 'dashboard') {
      return seg[1] === 'raffle-wins' ? 'competitions' : 'dashboard';
    }
    if (seg[0] === 'account' || seg[0] === 'profile') return 'profile';
    if (seg[0] === 'settings') return 'settings';
    if (seg[0] === 'subscribe') return 'subscribe';
    if (seg[0] === 'wishlist') return 'wishlist';
    if (seg[0] === 'saved-searches') return 'saved-searches';
    if (seg[0] === 'notifications') return 'notifications';
    if (seg[0] === 'featured') return 'featured';

    if (
      seg[0] === 'faq' ||
      seg[0] === 'how-selling-works' ||
      seg[0] === 'support'
    ) {
      return 'help';
    }

    // Legal / policy pages (the (legal) route group is invisible in the URL).
    if (
      [
        'terms',
        'privacy',
        'cookies',
        'acceptable-use',
        'aml-policy',
        'firearms-compliance',
        'refund-policy',
        'experiences-cancellation-policy',
        'legal',
      ].includes(seg[0])
    ) {
      return 'legal';
    }

    return 'generic';
  }

  private async listingGuide(listingId: string): Promise<AskGgGuide> {
    const l = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        listingType: true,
        status: true,
        isExperience: true,
        currentBid: true,
        endTime: true,
        reservePrice: true, // compared server-side; NEVER emitted
      },
    });
    // Non-public / terminal / missing → the plain generic guide with NO live
    // state and NO status note, so the public endpoint can't be used to probe
    // the existence or state of unpublished (DRAFT / PENDING_REVIEW) listings.
    if (!l || l.status !== 'ACTIVE') return clone(GUIDES['listing-buy-now']);

    // AUCTION wins the guide (the "how to win" playbook is what a bidder needs)
    // even when the item is an experience; otherwise experiences get the
    // booking guide, then swop / take-a-shot / buy-now.
    const key =
      l.listingType === 'AUCTION'
        ? 'listing-auction'
        : l.isExperience
          ? 'listing-experience'
          : l.listingType === 'SWOP'
            ? 'listing-swop'
            : l.listingType === 'TAKE_A_SHOT'
              ? 'listing-take-a-shot'
              : 'listing-buy-now';

    const guide = clone(GUIDES[key] ?? GUIDES['listing-buy-now']);
    if (l.listingType === 'AUCTION') {
      guide.intro = this.auctionStateLine(l);
    }
    return guide;
  }

  private auctionStateLine(l: {
    currentBid: number | null;
    endTime: Date | null;
    reservePrice: number | null;
  }): string {
    const bits: string[] = [];
    bits.push(
      l.currentBid != null ? `Current bid ${railRands(l.currentBid)}` : 'No bids yet',
    );
    if (l.reservePrice != null) {
      bits.push((l.currentBid ?? 0) >= l.reservePrice ? 'reserve met' : 'reserve not met');
    }
    if (l.endTime) {
      const ms = l.endTime.getTime() - Date.now();
      bits.push(ms <= 0 ? 'ended' : `ends in ${humanizeMs(ms)}`);
    }
    return `${bits.join(' · ')}.`;
  }
}
