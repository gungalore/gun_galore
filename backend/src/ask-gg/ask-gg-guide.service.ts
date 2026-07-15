import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GUIDES, type AskGgGuide } from './guide-content';

// GG site-guide (G2) — resolves the curated page guide for the current page,
// injecting LIVE public state (e.g. an auction's current bid / reserve-met /
// time-left) read straight from the DB. ZERO Claude calls: this is the
// always-on, $0-AI guide surface.
//
// Everything here is PUBLIC (the same info shown on the listing page), so the
// endpoint needs no auth and works for signed-out visitors too. Reserve PRICE
// is never emitted — only the reserve-met boolean, matching the context
// service's discipline.

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

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
  constructor(private readonly prisma: PrismaService) {}

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

  private keyForPath(path: string, seg: string[]): string {
    if (path === '/') return 'home';
    if (path === '/listings/new') return 'sell-form';
    if (seg[0] === 'listings') return 'browse';
    if (seg[0] === 'category') return 'category';
    if (seg[0] === 'orders' && seg.length === 2) return 'order';
    if (seg[0] === 'transactions' && seg.length === 2) return 'transaction';
    if (
      seg[0] === 'orders' ||
      (seg[0] === 'my' && ['orders', 'sales', 'offers', 'bids'].includes(seg[1]))
    ) {
      return 'orders';
    }
    if (seg[0] === 'cart' || seg[0] === 'checkout') return 'cart';
    if (seg[0] === 'wanted') return 'wanted';
    if (seg[0] === 'competitions') return 'competitions';
    if (seg[0] === 'faq' || seg[0] === 'how-selling-works') return 'help';
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
