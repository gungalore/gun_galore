import { Injectable } from '@nestjs/common';
import type {
  CrimeStatsRelease,
  CrimeStatsStation,
  NearestStationResult,
  PrecinctFigures,
} from './crime-stats.types';

// ⚠️ STUB. The real service (SAPS workbook ingest, weekly fetch, station
// search, nearest-station lookup, precinct figures) is being written in this
// same change. This file exists so the motivation and frontend work can be
// built against the interface first. Every method answers "nothing yet".
@Injectable()
export class CrimeStatsService {
  async latestRelease(): Promise<CrimeStatsRelease | null> {
    return null;
  }

  async searchStations(_q: string, _limit = 10): Promise<CrimeStatsStation[]> {
    return [];
  }

  async nearestStation(_address: string): Promise<NearestStationResult> {
    return { station: null, how: null, candidates: [] };
  }

  /** Figures for one station from the latest release, or null when unknown. */
  async precinct(
    _station: string,
    _province?: string,
  ): Promise<PrecinctFigures | null> {
    return null;
  }
}

/**
 * The lines a motivation receives as SUPPLIED FACTS for a precinct — plain
 * sentences, each naming the category, the count, the period and the source,
 * so the writer can quote them and a reviewer can check them.
 */
export function precinctFactLines(figures: PrecinctFigures): string[] {
  const lines: string[] = [];
  const src = `SAPS quarterly crime statistics, ${figures.release.periodLabel} release`;
  lines.push(
    `Police station: ${figures.station.name} (${figures.station.district}, ${figures.station.province}). Source: ${src}.`,
  );
  for (const c of figures.categories) {
    const yoy =
      c.yearOnYearPct === null
        ? ''
        : ` (${c.yearOnYearPct >= 0 ? 'up' : 'down'} ${Math.abs(c.yearOnYearPct).toFixed(0)}% on ${c.sameQuarterLastYear?.label ?? 'the same quarter a year earlier'})`;
    lines.push(
      `${c.category}: ${c.latest.count} recorded in ${c.latest.label}${yoy}; ${c.lastTwelveMonths} over the last four quarters.`,
    );
  }
  return lines;
}
