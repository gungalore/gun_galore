import { Injectable } from '@nestjs/common';
import type { ClippingImage, IncidentQuery, NewsIncident } from './news.types';

// ⚠️ STUB. The real service (feed registry, nightly poll, share-preview
// enrichment, crime tagging, place geocoding, distance matching, Google News
// fallback, twelve-month retention) is being written in this same change.
// This file exists so the motivation and wizard work can be built against
// the interface first. Every method answers "nothing yet".
@Injectable()
export class NewsService {
  /** Crime reporting near a station or point, newest first, within the window. */
  async incidentsNear(_q: IncidentQuery): Promise<NewsIncident[]> {
    return [];
  }

  /** The chosen clippings for a pack, in the order asked for; unknown ids dropped. */
  async byIds(_ids: string[]): Promise<NewsIncident[]> {
    return [];
  }

  /**
   * The lead picture for a clipping, fetched at pack time only, bounded to
   * ~1200px on the long edge, JPEG. Null when the site has none or refuses.
   */
  async clippingImage(_incident: NewsIncident): Promise<ClippingImage | null> {
    return null;
  }
}

/**
 * What the motivation writer receives about the chosen clippings — one plain
 * line each, naming the paper, the date and the headline, so a citation in
 * the document can be checked against the annexure it points at.
 */
export function clippingFactLines(clips: readonly NewsIncident[]): string[] {
  return clips.map(
    (c, i) =>
      `Press clipping ${i + 1}: ${c.sourceName}, ${c.publishedOn} — "${c.headline}"` +
      (c.standfirst ? ` — ${c.standfirst}` : '') +
      (c.crimeType ? ` [${c.crimeType}]` : '') +
      (c.places.length ? ` (${c.places.join(', ')})` : ''),
  );
}
