import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GUIDES,
  type AskGgGuide,
  type GuideCta,
  type GuidePersonalItem,
} from './guide-content';
import {
  AskGgAccountToolsService,
  type AskGgAccount,
} from './ask-gg-account-tools.service';

// GG site-guide (G2/G3/G4/G5) — resolves the curated page guide for the current
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
//
// G5 — admin-editable overrides: the static GUIDES catalog stays the shipped
// baseline; a PUBLISHED AskGgGuideOverride row OVERLAYS one key's title/intro/
// points/ctas (resolveGuide). Overrides are cached in-memory (60s TTL +
// invalidate-on-write) so the hot path stays cheap, and a DB failure silently
// falls back to the shipped defaults. Admin CRUD lives at the bottom of this
// file (AdminJwtGuard controller). Live auction state + the personal overlay
// are computed at serve time and are NOT overridable.

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** House rule enforced on admin-authored guide copy. */
const ESCROW_RE = /\bescrow\b/i;

/** The shape a PUBLISHED override contributes to a guide. */
interface GuideOverrideView {
  title: string;
  intro: string | null;
  points: string[];
  ctas: unknown;
}

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

/** Defensively coerce a stored ctas Json blob into GuideCta[] (validated on
 *  write, but never trust the DB blindly on the serve path). */
function coerceCtas(raw: unknown): GuideCta[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: GuideCta[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    const label = typeof rec.label === 'string' ? rec.label : '';
    if (!label) continue;
    const href = typeof rec.href === 'string' ? rec.href : undefined;
    const ask = typeof rec.ask === 'string' ? rec.ask : undefined;
    out.push({ label, ...(href ? { href } : {}), ...(ask !== undefined ? { ask } : {}) });
  }
  return out.length ? out : undefined;
}

/** A clean, validated guide-content payload from the admin editor (G5). */
interface CleanGuidePayload {
  title: string;
  intro: string | null;
  points: string[];
  ctas: GuideCta[];
}

/** Validate + normalise an admin guide edit. Enforces house rules (never
 *  "escrow"; internal '/'-only CTA links) and sane size caps. Throws
 *  BadRequestException with a clear message on any violation. */
function validateGuidePayload(input: {
  title?: unknown;
  intro?: unknown;
  points?: unknown;
  ctas?: unknown;
}): CleanGuidePayload {
  const fail = (msg: string): never => {
    throw new BadRequestException(msg);
  };

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 2) fail('Title is required.');
  if (title.length > 120) fail('Title is too long (max 120 characters).');

  const introRaw = typeof input.intro === 'string' ? input.intro.trim() : '';
  if (introRaw.length > 400) fail('Intro is too long (max 400 characters).');
  const intro = introRaw.length > 0 ? introRaw : null;

  if (!Array.isArray(input.points)) fail('Points must be a list.');
  const points = (input.points as unknown[])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0);
  if (points.length < 1) fail('Add at least one point.');
  if (points.length > 12) fail('Too many points (max 12).');
  for (const p of points) {
    if (p.length > 300) fail('A point is too long (max 300 characters each).');
  }

  const ctas: GuideCta[] = [];
  if (input.ctas != null) {
    if (!Array.isArray(input.ctas)) fail('CTAs must be a list.');
    const rawCtas = input.ctas as unknown[];
    if (rawCtas.length > 6) fail('Too many CTAs (max 6).');
    for (const c of rawCtas) {
      if (!c || typeof c !== 'object') fail('Each CTA must be an object.');
      const rec = c as Record<string, unknown>;
      const label = typeof rec.label === 'string' ? rec.label.trim() : '';
      if (label.length < 1) fail('Each CTA needs a label.');
      if (label.length > 60) fail('A CTA label is too long (max 60 characters).');
      const href = typeof rec.href === 'string' ? rec.href.trim() : '';
      const ask = typeof rec.ask === 'string' ? rec.ask.trim() : '';
      if (href && ask) fail(`CTA "${label}" cannot have both a link and a question.`);
      if (!href && !ask) fail(`CTA "${label}" needs either an internal link or a question.`);
      if (href) {
        if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) {
          fail(`CTA "${label}" link must be an internal path starting with "/".`);
        }
        ctas.push({ label, href });
      } else {
        if (ask.length > 300) fail(`CTA "${label}" question is too long (max 300 characters).`);
        ctas.push({ label, ask });
      }
    }
  }

  // House rule: never the word "escrow" in user-facing copy.
  const allText = [title, intro ?? '', ...points, ...ctas.flatMap((c) => [c.label, c.ask ?? ''])].join(' ');
  if (ESCROW_RE.test(allText)) {
    fail('Please avoid the word "escrow" — say "funds held" / "payment held" instead.');
  }

  return { title, intro, points, ctas };
}

@Injectable()
export class AskGgGuideService {
  private readonly logger = new Logger(AskGgGuideService.name);

  // G5 — cache of PUBLISHED overrides (keyed by guide key). 60s TTL keeps the
  // hot guide path cheap; admin writes invalidate it for near-instant effect.
  private overrideCache: {
    at: number;
    map: Map<string, GuideOverrideView>;
  } | null = null;
  private readonly OVERRIDE_TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountTools: AskGgAccountToolsService,
  ) {}

  /** Clone a static guide by key and overlay its PUBLISHED admin override (G5),
   *  if any. This is the single funnel every guide passes through. */
  private async resolveGuide(key: string): Promise<AskGgGuide> {
    const base = GUIDES[key] ?? GUIDES.generic;
    const g = clone(base);
    const ov = (await this.getPublishedOverrides()).get(base.key);
    if (ov) {
      g.title = ov.title;
      g.intro = ov.intro ?? undefined;
      g.points = [...ov.points];
      g.ctas = coerceCtas(ov.ctas);
    }
    return g;
  }

  /** PUBLISHED overrides, cached. DB failure → the last good cache, else empty
   *  (i.e. the shipped defaults) — the guide is never blank because of this. */
  private async getPublishedOverrides(): Promise<Map<string, GuideOverrideView>> {
    const now = Date.now();
    if (this.overrideCache && now - this.overrideCache.at < this.OVERRIDE_TTL_MS) {
      return this.overrideCache.map;
    }
    try {
      const rows = await this.prisma.askGgGuideOverride.findMany({
        where: { status: 'PUBLISHED' },
        select: { key: true, title: true, intro: true, points: true, ctas: true },
      });
      const map = new Map<string, GuideOverrideView>();
      for (const r of rows) {
        map.set(r.key, {
          title: r.title,
          intro: r.intro,
          points: r.points,
          ctas: r.ctas,
        });
      }
      this.overrideCache = { at: now, map };
      return map;
    } catch (e) {
      this.logger.warn(`guide overrides load failed, using defaults: ${String(e)}`);
      return this.overrideCache?.map ?? new Map();
    }
  }

  private invalidateOverrides(): void {
    this.overrideCache = null;
  }

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
    if (path === '/listings/new') return this.resolveGuide('sell-form');

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
        return this.resolveGuide('listing-buy-now');
      }
    }

    return this.resolveGuide(this.keyForPath(path, seg));
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

      // Page-targeted enrichment (cheap, one extra read at most). Resolve the
      // listing id the SAME way getGuide does (path segment OR the hint), so an
      // /ask-gg/guide?path=/listings/:id request with no listingId param still
      // gets its auction overlay — the two derivations must not diverge.
      const listingId = this.effectiveListingId(input);
      await this.enrichForPage(base.key, listingId, account, items);

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

  /** The listing id getGuide resolved the base guide from: the /listings/:id
   *  path segment, else the query hint. Kept in lockstep with getGuide's own
   *  derivation so the personal overlay never diverges from the base guide. */
  private effectiveListingId(input: {
    path?: string;
    listingId?: string;
  }): string | undefined {
    const path =
      typeof input.path === 'string' && input.path.startsWith('/')
        ? input.path
        : '/';
    const seg = path.split('/').filter(Boolean);
    if (seg[0] === 'listings' && seg.length === 2 && ID_RE.test(seg[1])) {
      return seg[1];
    }
    return typeof input.listingId === 'string' && ID_RE.test(input.listingId)
      ? input.listingId
      : undefined;
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
    if (!l || l.status !== 'ACTIVE') return this.resolveGuide('listing-buy-now');

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

    const guide = await this.resolveGuide(key);
    // Live state ALWAYS wins the intro for auctions — an admin override can
    // change the title/points/ctas but not the current-bid line.
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

  // ─────────────────── G5 admin surface ───────────────────────────────
  // All AdminJwtGuard-gated (ask-gg-guide-admin.controller.ts). The static
  // GUIDES catalog is the source of truth for WHICH keys exist; overrides only
  // change the CONTENT of an existing key.

  /** The full catalog: every static guide key + its override status. */
  async adminListGuides(): Promise<
    {
      key: string;
      defaultTitle: string;
      status: 'DEFAULT' | 'DRAFT' | 'PUBLISHED';
      publishedAt: Date | null;
      updatedAt: Date | null;
      updatedBy: string | null;
    }[]
  > {
    const overrides = await this.prisma.askGgGuideOverride.findMany({
      select: {
        key: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        updatedBy: true,
      },
    });
    const byKey = new Map(overrides.map((o) => [o.key, o]));
    return Object.values(GUIDES).map((g) => {
      const ov = byKey.get(g.key);
      return {
        key: g.key,
        defaultTitle: g.title,
        status: ov ? ov.status : 'DEFAULT',
        publishedAt: ov?.publishedAt ?? null,
        updatedAt: ov?.updatedAt ?? null,
        updatedBy: ov?.updatedBy ?? null,
      };
    });
  }

  /** One key: the shipped default + the current override (if any). */
  async adminGetGuide(key: string) {
    const base = GUIDES[key];
    if (!base) throw new NotFoundException('Unknown guide key.');
    const ov = await this.prisma.askGgGuideOverride.findUnique({
      where: { key },
    });
    return {
      key,
      default: {
        title: base.title,
        intro: base.intro ?? null,
        points: base.points,
        ctas: base.ctas ?? [],
      },
      override: ov
        ? {
            title: ov.title,
            intro: ov.intro,
            points: ov.points,
            ctas: coerceCtas(ov.ctas) ?? [],
            status: ov.status,
            publishedAt: ov.publishedAt,
            updatedAt: ov.updatedAt,
            updatedBy: ov.updatedBy,
          }
        : null,
    };
  }

  /** Save the admin's content edit. Creates a DRAFT for a fresh key; on an
   *  existing row the STATUS is preserved (editing a PUBLISHED guide updates it
   *  live; a DRAFT stays a preview). Validated + house-rule-checked. */
  async adminSaveGuide(
    key: string,
    input: { title?: unknown; intro?: unknown; points?: unknown; ctas?: unknown },
    adminSub: string,
  ) {
    if (!GUIDES[key]) throw new NotFoundException('Unknown guide key.');
    const clean = validateGuidePayload(input);
    const row = await this.prisma.askGgGuideOverride.upsert({
      where: { key },
      create: {
        key,
        title: clean.title,
        intro: clean.intro,
        points: clean.points,
        ctas: clean.ctas as unknown as object,
        status: 'DRAFT',
        updatedBy: adminSub,
      },
      update: {
        title: clean.title,
        intro: clean.intro,
        points: clean.points,
        ctas: clean.ctas as unknown as object,
        updatedBy: adminSub,
      },
    });
    this.invalidateOverrides();
    return { key: row.key, status: row.status };
  }

  /** Take the saved draft live. Requires an existing override row. */
  async adminPublishGuide(key: string, adminSub: string) {
    if (!GUIDES[key]) throw new NotFoundException('Unknown guide key.');
    const existing = await this.prisma.askGgGuideOverride.findUnique({
      where: { key },
      select: { id: true },
    });
    if (!existing) {
      throw new BadRequestException('Nothing to publish — save the guide first.');
    }
    const row = await this.prisma.askGgGuideOverride.update({
      where: { key },
      data: { status: 'PUBLISHED', publishedAt: new Date(), updatedBy: adminSub },
    });
    this.invalidateOverrides();
    return { key: row.key, status: row.status };
  }

  /** Pull a published guide back to DRAFT — users revert to the shipped
   *  default, but the draft is kept for further editing. */
  async adminUnpublishGuide(key: string, adminSub: string) {
    if (!GUIDES[key]) throw new NotFoundException('Unknown guide key.');
    const existing = await this.prisma.askGgGuideOverride.findUnique({
      where: { key },
      select: { id: true },
    });
    if (!existing) throw new BadRequestException('No override to unpublish.');
    const row = await this.prisma.askGgGuideOverride.update({
      where: { key },
      data: { status: 'DRAFT', publishedAt: null, updatedBy: adminSub },
    });
    this.invalidateOverrides();
    return { key: row.key, status: row.status };
  }

  /** Discard the override entirely — revert to the shipped default. */
  async adminResetGuide(key: string) {
    if (!GUIDES[key]) throw new NotFoundException('Unknown guide key.');
    await this.prisma.askGgGuideOverride
      .delete({ where: { key } })
      .catch(() => undefined); // already default → no-op
    this.invalidateOverrides();
    return { key, status: 'DEFAULT' as const };
  }
}
