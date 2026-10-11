import { Injectable, Logger } from '@nestjs/common';

/**
 * Thin REST client for the Apify platform (run an actor, read its dataset).
 * No SDK dependency. Inert unless VALUATION_APIFY_ENABLED=true AND APIFY_TOKEN
 * is set, so it costs nothing until the operator turns the lane on. The token
 * is sent as a Bearer header (never a query string) so it is not logged in URLs
 * or proxies.
 */
@Injectable()
export class ApifyClient {
  private readonly logger = new Logger(ApifyClient.name);

  isConfigured(): boolean {
    return process.env.VALUATION_APIFY_ENABLED === 'true' && Boolean(process.env.APIFY_TOKEN);
  }

  /** Run an actor synchronously and return its dataset items. [] on any failure. */
  async runActor(
    actorId: string,
    input: unknown,
    waitSec = 120,
    timeoutMs = 180_000,
  ): Promise<unknown[]> {
    if (!this.isConfigured() || !actorId) return [];
    const token = process.env.APIFY_TOKEN as string;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?waitForFinish=${waitSec}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
          signal: controller.signal,
        },
      );
      if (!runRes.ok) {
        this.logger.warn(`apify run ${actorId} HTTP ${runRes.status}`);
        return [];
      }
      const run = (await runRes.json()) as { data?: { defaultDatasetId?: string } };
      const datasetId = run.data?.defaultDatasetId;
      if (!datasetId) return [];
      const itemsRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json`,
        { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
      );
      if (!itemsRes.ok) return [];
      const items = (await itemsRes.json()) as unknown;
      return Array.isArray(items) ? items : [];
    } catch (e) {
      this.logger.warn(`apify ${actorId} failed: ${(e as Error).message}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
