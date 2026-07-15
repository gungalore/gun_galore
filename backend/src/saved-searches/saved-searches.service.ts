import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, SavedSearch } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';

// A user can't hoard unlimited saved searches (each one is a cron workload).
const MAX_SAVED_SEARCHES_PER_USER = 50;
// Per-tick caps so the matcher run stays bounded.
const MAX_SEARCHES_PER_TICK = 1000;
const MAX_MATCHES_PER_SEARCH = 25;
// Commit-visibility guard: only sweep listings that became discoverable at
// least this long ago, so an INSERT still in flight at the tick boundary can't
// be skipped forever (createdAt/listedAt are stamped at transaction start but
// only visible after commit). Trades a ≤1-tick alert delay for zero misses.
const COMMIT_SAFETY_MS = 30_000;

// The filter columns that DEFINE what a search matches (everything except
// `sort`, which only changes ordering, and `label`, which is cosmetic). Two
// saves that differ only in sort/label are the same alert → same fingerprint.
const MATCH_FIELDS = [
  'q',
  'categoryId',
  'categorySlug',
  'listingType',
  'condition',
  'province',
  'make',
  'minPrice',
  'maxPrice',
  'attrs',
] as const;

// Shape returned to the client — the raw row plus a display label + a runnable
// href so the /saved-searches page can render + re-run each search.
export interface SavedSearchView {
  id: string;
  label: string;
  href: string;
  notifyEnabled: boolean;
  createdAt: Date;
}

@Injectable()
export class SavedSearchesService {
  private readonly logger = new Logger(SavedSearchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  private async userIdFromClerk(clerkId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('User not found');
    return u.id;
  }

  // Normalise a DTO into (a) the column values we store and (b) the
  // match-defining subset used for the idempotency fingerprint. Blank strings
  // collapse to null so "" and unset are treated identically.
  private normalize(dto: CreateSavedSearchDto) {
    const s = (v?: string) => {
      const t = (v ?? '').trim();
      return t.length > 0 ? t : null;
    };
    const columns = {
      q: s(dto.q),
      categoryId: s(dto.categoryId),
      categorySlug: s(dto.categorySlug),
      listingType: dto.listingType ?? null,
      condition: dto.condition ?? null,
      province: dto.province ?? null,
      make: s(dto.make),
      minPrice:
        typeof dto.minPrice === 'number' && Number.isFinite(dto.minPrice)
          ? dto.minPrice
          : null,
      maxPrice:
        typeof dto.maxPrice === 'number' && Number.isFinite(dto.maxPrice)
          ? dto.maxPrice
          : null,
      sort: dto.sort ?? null,
      attrs: s(dto.attrs),
    };
    // Canonical fingerprint key — MATCH_FIELDS in fixed order, only non-null
    // values, JSON-stringified then hashed. Deterministic regardless of DTO
    // key order, so re-saving the same filters resolves to the same row.
    const key: Record<string, unknown> = {};
    for (const f of MATCH_FIELDS) {
      const v = (columns as Record<string, unknown>)[f];
      if (v !== null && v !== undefined) key[f] = v;
    }
    const isEmpty = Object.keys(key).length === 0;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(key))
      .digest('hex');
    return { columns, fingerprint, isEmpty };
  }

  async create(
    clerkId: string,
    dto: CreateSavedSearchDto,
  ): Promise<SavedSearchView> {
    const userId = await this.userIdFromClerk(clerkId);
    const { columns, fingerprint, isEmpty } = this.normalize(dto);
    if (isEmpty) {
      throw new BadRequestException(
        'Add at least one filter (a search term, category, brand, price, etc.) before saving a search.',
      );
    }
    const label = (dto.label ?? '').trim() || null;

    // Enforce the per-user cap, but only for a genuinely NEW search — re-saving
    // an existing one (same fingerprint) is an update and always allowed.
    const existing = await this.prisma.savedSearch.findUnique({
      where: { userId_fingerprint: { userId, fingerprint } },
      select: { id: true },
    });
    if (!existing) {
      const count = await this.prisma.savedSearch.count({ where: { userId } });
      if (count >= MAX_SAVED_SEARCHES_PER_USER) {
        throw new BadRequestException(
          `You've reached the maximum of ${MAX_SAVED_SEARCHES_PER_USER} saved searches. Delete one to add another.`,
        );
      }
    }

    const row = await this.prisma.savedSearch.upsert({
      where: { userId_fingerprint: { userId, fingerprint } },
      create: { userId, fingerprint, label, ...columns },
      // Re-saving the same filters refreshes the cosmetic fields and re-enables
      // alerts if they were paused. lastNotifiedAt is deliberately left as-is so
      // re-saving never re-notifies the back-catalogue.
      update: {
        label,
        sort: columns.sort,
        attrs: columns.attrs,
        notifyEnabled: true,
      },
    });
    return this.decorateOne(row);
  }

  async list(clerkId: string): Promise<SavedSearchView[]> {
    const userId = await this.userIdFromClerk(clerkId);
    const rows = await this.prisma.savedSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.decorateMany(rows);
  }

  async remove(clerkId: string, id: string): Promise<{ removed: boolean }> {
    const userId = await this.userIdFromClerk(clerkId);
    // Ownership-scoped delete: deleteMany with userId in the where so a user
    // can never delete another user's search by guessing an id.
    const res = await this.prisma.savedSearch.deleteMany({
      where: { id, userId },
    });
    return { removed: res.count > 0 };
  }

  async setEnabled(
    clerkId: string,
    id: string,
    enabled: boolean,
  ): Promise<{ notifyEnabled: boolean }> {
    const userId = await this.userIdFromClerk(clerkId);
    const res = await this.prisma.savedSearch.updateMany({
      where: { id, userId },
      data: { notifyEnabled: enabled },
    });
    if (res.count === 0) throw new NotFoundException('Saved search not found');
    return { notifyEnabled: enabled };
  }

  // ─── Display helpers ────────────────────────────────────────────────

  private async decorateOne(row: SavedSearch): Promise<SavedSearchView> {
    const [view] = await this.decorateMany([row]);
    return view;
  }

  private async decorateMany(rows: SavedSearch[]): Promise<SavedSearchView[]> {
    // Batch-resolve category names for a friendly label.
    const ids = [
      ...new Set(rows.map((r) => r.categoryId).filter((x): x is string => !!x)),
    ];
    const slugs = [
      ...new Set(
        rows.map((r) => r.categorySlug).filter((x): x is string => !!x),
      ),
    ];
    const nameById = new Map<string, string>();
    const nameBySlug = new Map<string, string>();
    if (ids.length || slugs.length) {
      const cats = await this.prisma.category.findMany({
        where: { OR: [{ id: { in: ids } }, { slug: { in: slugs } }] },
        select: { id: true, slug: true, name: true },
      });
      for (const c of cats) {
        nameById.set(c.id, c.name);
        nameBySlug.set(c.slug, c.name);
      }
    }
    return rows.map((r) => ({
      id: r.id,
      label:
        r.label ||
        this.buildLabel(
          r,
          (r.categoryId && nameById.get(r.categoryId)) ||
            (r.categorySlug && nameBySlug.get(r.categorySlug)) ||
            undefined,
        ),
      href: this.buildHref(r),
      notifyEnabled: r.notifyEnabled,
      createdAt: r.createdAt,
    }));
  }

  private prettify(v: string): string {
    return v
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private rand(cents: number): string {
    return 'R' + Math.round(cents / 100).toLocaleString('en-ZA');
  }

  private buildLabel(r: SavedSearch, categoryName?: string): string {
    const parts: string[] = [];
    if (r.q) parts.push(`"${r.q}"`);
    if (r.make) parts.push(r.make);
    if (categoryName) parts.push(categoryName);
    if (r.listingType) {
      const map: Record<string, string> = {
        BUY_NOW: 'Marketplace',
        AUCTION: 'Auction',
        TAKE_A_SHOT: 'Take a Shot',
        SWOP: 'Swop / Trade',
      };
      parts.push(map[r.listingType] ?? this.prettify(r.listingType));
    }
    if (r.condition) parts.push(this.prettify(r.condition));
    if (r.province) parts.push(this.prettify(r.province));
    if (r.minPrice != null && r.maxPrice != null) {
      parts.push(`${this.rand(r.minPrice)}–${this.rand(r.maxPrice)}`);
    } else if (r.minPrice != null) {
      parts.push(`over ${this.rand(r.minPrice)}`);
    } else if (r.maxPrice != null) {
      parts.push(`under ${this.rand(r.maxPrice)}`);
    }
    return parts.length ? parts.join(' · ') : 'All listings';
  }

  private buildHref(r: SavedSearch): string {
    const qs = new URLSearchParams();
    if (r.q) qs.set('q', r.q);
    if (r.categoryId) qs.set('categoryId', r.categoryId);
    if (r.listingType) qs.set('listingType', r.listingType);
    if (r.condition) qs.set('condition', r.condition);
    if (r.province) qs.set('province', r.province);
    if (r.make) qs.set('make', r.make);
    if (r.minPrice != null) qs.set('minPrice', String(r.minPrice));
    if (r.maxPrice != null) qs.set('maxPrice', String(r.maxPrice));
    if (r.sort) qs.set('sort', r.sort);
    if (r.attrs) qs.set('attrs', r.attrs);
    const s = qs.toString();
    // Slug-scoped searches (saved from a /category/[slug] page) route to that
    // page; everything else runs on the homepage browse.
    if (r.categorySlug && !r.categoryId) {
      qs.delete('categoryId');
      const rest = qs.toString();
      return `/category/${r.categorySlug}${rest ? `?${rest}` : ''}`;
    }
    return s ? `/?${s}` : '/';
  }

  // ─── Matcher (cron worker) ──────────────────────────────────────────

  /**
   * For each enabled saved search, find ACTIVE listings created since its
   * notify cursor (first run = since the search was created) and alert the
   * owner. Advances the cursor so nothing is re-notified.
   * Called by the every-10-min cron in TasksService.
   *
   * "New since I last looked" keys on `listedAt` (when the listing FIRST
   * became ACTIVE) — NOT createdAt — so a human-reviewed listing approved
   * hours after it was created still alerts. Legacy rows with a null listedAt
   * fall back to createdAt. A COMMIT_SAFETY_MS margin on the upper bound closes
   * the tick-boundary commit-visibility race (no double, no miss).
   *
   * Match semantics reuse the browse (browseViaPrisma) where-builder:
   * category rollup, exact make, price range, enum filters. `q` is
   * approximated with a case-insensitive title/description contains (browse
   * routes `q` to Meili; the matcher can't, so this is the honest fallback).
   * Per-category attribute filters (`attrs`) are NOT applied — Meili-only in
   * browse — so a saved search with attrs over-matches on that dimension only.
   */
  async matchAndNotify(): Promise<{ scanned: number; notified: number }> {
    const searches = await this.prisma.savedSearch.findMany({
      where: { notifyEnabled: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_SEARCHES_PER_TICK,
    });

    // Only sweep listings that became discoverable at least this long ago, so a
    // still-uncommitted INSERT (createdAt/listedAt stamped Postgres-side at
    // transaction start, visible only after commit) can't slip through the tick
    // boundary and be skipped forever. The alert lands one tick later at worst
    // — negligible for a retention feature, and it closes the commit-visibility
    // race entirely.
    const cutoff = new Date(Date.now() - COMMIT_SAFETY_MS);

    let notified = 0;
    for (const s of searches) {
      try {
        const cursor = s.lastNotifiedAt ?? s.createdAt;
        // Nothing to sweep yet (freshly-created search, or cursor already at the
        // cutoff). Skip WITHOUT advancing so the window isn't moved backwards.
        if (cursor >= cutoff) continue;

        // Time window keyed on when the listing FIRST became ACTIVE (listedAt),
        // NOT createdAt — a human-reviewed listing approved after its createdAt
        // must still alert. Legacy/uncovered rows with a null listedAt fall back
        // to createdAt (best-effort, matches pre-P5.1 behaviour, never a crash).
        const window = { gt: cursor, lte: cutoff };
        const and: Prisma.ListingWhereInput[] = [
          {
            OR: [
              { listedAt: window },
              { listedAt: null, createdAt: window },
            ],
          },
        ];
        // `q` free-text: browse routes this to Meili; the Prisma matcher can't,
        // so approximate with a case-insensitive title/description contains.
        if (s.q) {
          and.push({
            OR: [
              { title: { contains: s.q, mode: 'insensitive' } },
              { description: { contains: s.q, mode: 'insensitive' } },
            ],
          });
        }

        const where: Prisma.ListingWhereInput = {
          status: 'ACTIVE',
          // Daily Deals have their own drop push — a deal going LIVE must not
          // also fire everyone's saved-search alerts.
          isDealListing: false,
          // Never alert a user about their own new listing.
          sellerId: { not: s.userId },
          AND: and,
        };
        if (s.categoryId) {
          where.category = {
            OR: [{ id: s.categoryId }, { parentId: s.categoryId }],
          };
        } else if (s.categorySlug) {
          where.category = {
            OR: [{ slug: s.categorySlug }, { parent: { slug: s.categorySlug } }],
          };
        }
        if (s.listingType)
          where.listingType = s.listingType as Prisma.ListingWhereInput['listingType'];
        if (s.condition)
          where.condition = s.condition as Prisma.ListingWhereInput['condition'];
        if (s.province)
          where.province = s.province as Prisma.ListingWhereInput['province'];
        if (s.make) where.make = s.make;
        if (s.minPrice != null || s.maxPrice != null) {
          const price: Prisma.IntFilter = {};
          if (s.minPrice != null) price.gte = s.minPrice;
          if (s.maxPrice != null) price.lte = s.maxPrice;
          where.price = price;
        }

        const matches = await this.prisma.listing.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: MAX_MATCHES_PER_SEARCH,
          select: { id: true },
        });

        if (matches.length > 0) {
          await this.notifyOne(s, matches.length, matches[0].id);
          notified += 1;
        }

        // Advance the cursor to the cutoff (NOT `now`): we've inspected every
        // listing certainly-committed up to the cutoff. Done AFTER the
        // (fail-open) notify so a thrown error leaves the cursor unadvanced →
        // retried (dup, never a miss).
        await this.prisma.savedSearch.update({
          where: { id: s.id },
          data: { lastNotifiedAt: cutoff },
        });
      } catch (err) {
        // One bad search must not kill the batch.
        this.logger.warn(
          `saved-search match failed for ${s.id}: ${(err as Error).message}`,
        );
      }
    }

    return { scanned: searches.length, notified };
  }

  private async notifyOne(
    s: SavedSearch,
    count: number,
    firstListingId: string,
  ): Promise<void> {
    const label = s.label || this.buildLabel(s);
    const body =
      count === 1
        ? `A new listing matches your saved search "${label}".`
        : `${count} new listings match your saved search "${label}".`;
    // One match → deep-link to it; several → the search results.
    const url = count === 1 ? `/listings/${firstListingId}` : this.buildHref(s);

    // Informational + swipe-dismissible inbox row (auto-push is skipped for
    // dismissible rows), then an EXPLICIT push so the user still gets the ping.
    await this.notifications.persist({
      userId: s.userId,
      category: 'BUYER',
      type: 'saved_search_match',
      title: 'New match for your saved search',
      body,
      url,
      iconKey: 'search',
      linkedType: 'listing',
      linkedId: firstListingId,
      dismissible: true,
    });
    await this.push
      .sendToUser(s.userId, 'BUYER', {
        title: 'New match for your saved search',
        body,
        url,
        tag: `saved_search:${s.id}`,
      })
      .catch(() => {
        // push is best-effort; the inbox row is the durable record
      });
  }
}
