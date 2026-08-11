import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Meilisearch, Index, SearchParams, SearchResponse, RecordAny } from 'meilisearch';
import { PrismaService } from '../prisma/prisma.service';

// Index names used across the platform
export const INDEXES = {
  LISTINGS: 'listings',
  PUDO_LOCKERS: 'pudo_lockers',
  CARTRIDGES: 'cartridges',
} as const;

// P4.3a — static (non-attribute) filterable facets on the LISTINGS index.
// The full filterable set = these + a `attr_<key>` field per filterable,
// active CategoryAttribute (derived from the DB at boot / on refresh).
const STATIC_LISTING_FILTERABLE_ATTRIBUTES = [
  'categoryId',
  'categorySlug',
  // Parent-category rollup: parent browse pages filter on these so a
  // parent id/slug matches its children's leaf listings.
  'parentId',
  'parentSlug',
  'status',
  'listingType',
  'condition',
  'province',
  'sellerId',
  'priceRange',
  'make',
  // Daily Deals — public browse/facets filter `isDealListing = false` so
  // first-party house deals never appear in search. Must be filterable or
  // Meili rejects the clause.
  'isDealListing',
  // Signed-out search filters `publicVisible = true` so members-only stock
  // (firearms, gun parts, reloading, air rifles, self-defence, shooting
  // accessories) never comes back to an anonymous ?q=. Same rule as above:
  // it must be filterable or Meili rejects the whole query.
  'publicVisible',
];

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private client: Meilisearch | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const host = process.env.MEILISEARCH_HOST;
    const apiKey = process.env.MEILISEARCH_API_KEY;

    if (!host) {
      this.logger.warn('MEILISEARCH_HOST not set — search disabled');
      return;
    }

    this.client = new Meilisearch({ host, apiKey });

    try {
      await this.client.health();
      this.logger.log(`Meilisearch connected (${host})`);
      await this.ensureIndexes();
    } catch (err) {
      this.logger.error(`Meilisearch connection failed: ${(err as Error).message}`);
      this.client = null;
    }
  }

  private async ensureIndexes() {
    if (!this.client) return;

    // listings index
    await this.client.createIndex(INDEXES.LISTINGS, { primaryKey: 'id' }).catch(() => null);
    const listingsIndex = this.client.index(INDEXES.LISTINGS);
    // P4.3a — static facets + a `attr_<key>` facet per filterable, active
    // CategoryAttribute so the browse FilterBar can facet/filter on
    // per-category attribute values.
    const attrKeys = await this.filterableAttrFacets();
    await listingsIndex.updateFilterableAttributes([
      ...STATIC_LISTING_FILTERABLE_ATTRIBUTES,
      ...attrKeys,
    ]);
    // endTimeTs backs the Auctions surface's "Ending soonest" sort. Adding a
    // sortable attribute only affects documents indexed AFTER the change, so
    // a one-off reindex (admin "reindex all active listings") is needed once
    // for pre-existing docs — until then they simply sort last on that key.
    await listingsIndex.updateSortableAttributes([
      'price',
      'createdAt',
      'endTimeTs',
    ]);
    await listingsIndex.updateSearchableAttributes([
      'title',
      'description',
      'make',
      'model',
      'calibre',
      'categoryName',
    ]);

    // Pudo locker index — indexed on first cache refresh by PudoService.
    // Searchable by name / suburb / city / postal code so the seller can
    // type "Sandton" or "8001" and find the locker they want.
    await this.client
      .createIndex(INDEXES.PUDO_LOCKERS, { primaryKey: 'lockerId' })
      .catch(() => null);
    const lockersIndex = this.client.index(INDEXES.PUDO_LOCKERS);
    await lockersIndex.updateFilterableAttributes(['province', 'city']);
    await lockersIndex.updateSearchableAttributes([
      'name',
      'suburb',
      'city',
      'postalCode',
      'lockerId',
    ]);

    // Cartridge index — powers the Load Lab burn-chart typeahead. Populated
    // from the distinct ManualLoad cartridges by BurnChartService on first use.
    await this.client
      .createIndex(INDEXES.CARTRIDGES, { primaryKey: 'id' })
      .catch(() => null);
    const cartridgesIndex = this.client.index(INDEXES.CARTRIDGES);
    await cartridgesIndex.updateSearchableAttributes(['name']);
  }

  private index(name: string): Index | null {
    return this.client ? this.client.index(name) : null;
  }

  async addDocuments(indexName: string, documents: object[]): Promise<void> {
    const idx = this.index(indexName);
    if (!idx || documents.length === 0) return;
    await idx.addDocuments(documents);
  }

  async updateDocuments(indexName: string, documents: object[]): Promise<void> {
    const idx = this.index(indexName);
    if (!idx || documents.length === 0) return;
    await idx.updateDocuments(documents);
  }

  async deleteDocument(indexName: string, documentId: string): Promise<void> {
    const idx = this.index(indexName);
    if (!idx) return;
    await idx.deleteDocument(documentId);
  }

  /**
   * Wipe every document from an index without dropping the index itself
   * (so filterable/searchable attribute settings are preserved). Used by
   * the Pudo refresher to clear stale Pickup Point / Kiosk rows before
   * re-uploading the filtered Locker-only set.
   */
  async deleteAllDocuments(indexName: string): Promise<void> {
    const idx = this.index(indexName);
    if (!idx) return;
    await idx.deleteAllDocuments();
  }

  async search<T extends RecordAny = RecordAny>(
    indexName: string,
    query: string,
    options?: SearchParams,
  ): Promise<SearchResponse<T>> {
    const idx = this.index(indexName);
    if (!idx) return { hits: [], query, processingTimeMs: 0, limit: 20, offset: 0, estimatedTotalHits: 0 } as SearchResponse<T>;
    return idx.search<T>(query, options);
  }

  /**
   * P4.3a — the current set of `attr_<key>` facet fields, derived from the
   * DISTINCT keys of every filterable, active CategoryAttribute. Keys are
   * snake_case in the DB (guarded on write), so mapping to `attr_<key>` is
   * safe. Returns an empty list if the DB read fails so a hiccup never
   * blocks index bootstrap.
   */
  private async filterableAttrFacets(): Promise<string[]> {
    try {
      const rows = await this.prisma.categoryAttribute.findMany({
        where: { filterable: true, isActive: true },
        select: { key: true },
        distinct: ['key'],
      });
      return rows.map((r) => `attr_${r.key}`);
    } catch (err) {
      this.logger.warn(
        `Failed to derive filterable attr facets: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * P4.3a — re-derive the full filterable set (static facets + current
   * `attr_<key>` facets) and push it to the LISTINGS index. Called
   * fire-and-forget by the admin CategoryAttribute CRUD when a filterable
   * attribute is added/changed/removed, so newly-filterable keys become
   * facetable without a redeploy. No-op when Meilisearch is disconnected.
   */
  async refreshListingFilterableAttributes(): Promise<void> {
    const idx = this.index(INDEXES.LISTINGS);
    if (!idx) return;
    const attrKeys = await this.filterableAttrFacets();
    await idx.updateFilterableAttributes([
      ...STATIC_LISTING_FILTERABLE_ATTRIBUTES,
      ...attrKeys,
    ]);
  }

  get isConnected(): boolean {
    return this.client !== null;
  }
}
