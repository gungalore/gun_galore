import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Shape of backend/data/postal-neighbours.json — produced by the
// scripts/build-postal-neighbours.mjs Delaunay job. See that script
// for how the map is derived (GeoNames centroids → Delaunay edges,
// ≤30 km distance cap, ≤10 neighbours per code).
interface PostalNeighboursFile {
  version: number;
  generatedAt: string;
  source: string;
  maxNeighbourDistanceKm: number;
  maxNeighboursPerCode: number;
  totalCodes: number;
  neighbours: Record<string, string[]>;
}

@Injectable()
export class PostalCodesService {
  private readonly logger = new Logger(PostalCodesService.name);
  private neighbours: Record<string, string[]> = {};
  private loaded = false;

  constructor() {
    this.load();
  }

  // Synchronous load on construction. The file is ~160 KB and the
  // service is a singleton; a single fs.readFileSync at boot is
  // simpler than threading async readiness through every consumer.
  // If the file is missing (e.g. fresh clone before someone ran the
  // build script) we log a warning and degrade to "no neighbours" —
  // the locker picker will fall through to its distance-only path.
  private load(): void {
    const candidates = [
      // When running compiled from dist/, the cwd is still backend/.
      path.join(process.cwd(), 'data', 'postal-neighbours.json'),
      // Direct path when running ts-node from backend/src/shipping.
      path.join(__dirname, '..', '..', 'data', 'postal-neighbours.json'),
    ];
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue;
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw) as PostalNeighboursFile;
        this.neighbours = parsed.neighbours ?? {};
        this.loaded = true;
        this.logger.log(
          `Loaded postal neighbours from ${p} — ${parsed.totalCodes} codes, ` +
            `built ${parsed.generatedAt}`,
        );
        return;
      } catch (err) {
        this.logger.warn(
          `Could not load postal neighbours from ${p}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.warn(
      'postal-neighbours.json not found — locker picker will fall back to distance-only matching. ' +
        'Run `node scripts/build-postal-neighbours.mjs` from backend/ to generate it.',
    );
  }

  // Return the postal codes Delaunay-adjacent to `code`, or an
  // empty array if the code isn't in our dataset (the locker picker
  // then falls through to its distance-only path).
  getNeighbours(code: string): string[] {
    if (!this.loaded) return [];
    const normalised = (code ?? '').trim();
    if (!normalised) return [];
    return this.neighbours[normalised] ?? [];
  }

  // Convenience for the tiered locker picker — returns the full
  // "near me" set (the code itself + its neighbours), so callers
  // can do `if (lockerPostalCode in nearMe)` with a single set
  // lookup instead of two array scans.
  getNearby(code: string): Set<string> {
    const list = this.getNeighbours(code);
    const set = new Set<string>(list);
    if (code) set.add(code.trim());
    return set;
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}
