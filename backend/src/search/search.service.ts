import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Meilisearch, Index, SearchParams, SearchResponse, RecordAny } from 'meilisearch';

// Index names used across the platform
export const INDEXES = {
  LISTINGS: 'listings',
  PUDO_LOCKERS: 'pudo_lockers',
  CARTRIDGES: 'cartridges',
} as const;

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private client: Meilisearch | null = null;

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
    await listingsIndex.updateFilterableAttributes([
      'categoryId',
      'categorySlug',
      'status',
      'listingType',
      'condition',
      'province',
      'sellerId',
      'priceRange',
      'make',
    ]);
    await listingsIndex.updateSortableAttributes(['price', 'createdAt']);
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

  get isConnected(): boolean {
    return this.client !== null;
  }
}
