// Deterministic, South-Africa-targeted queries for the valuation engine. Built
// in code (not by the model) so discovery always hits the category's SA sources
// and cannot be forgotten. Pure functions.

export interface QueryInput {
  make?: string | null;
  model?: string | null;
  keySpec?: string | null;
  sources: string[];
}

function terms(input: QueryInput): string {
  return [input.make, input.model, input.keySpec]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function domains(sources: string[]): string[] {
  return sources.filter((s) => s.includes('.')).map((s) => s.replace(/^https?:\/\//, '').split('/')[0]);
}

/** Listing-comparable queries, site-scoped to the category's SA sources. */
export function buildQueries(input: QueryInput, max = 6): string[] {
  const t = terms(input);
  if (!t) return [];
  const out: string[] = [];
  for (const d of domains(input.sources).slice(0, 4)) {
    out.push(`site:${d} ${t} used`);
  }
  out.push(`"${t}" secondhand South Africa`);
  out.push(`${t} used South Africa for sale`);
  return dedupe(out).slice(0, max);
}

/** New-price anchor queries (retail). */
export function buildAnchorQueries(input: QueryInput, max = 2): string[] {
  const t = terms(input);
  if (!t) return [];
  return dedupe([`${t} price South Africa new`, `${t} buy South Africa`]).slice(0, max);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
