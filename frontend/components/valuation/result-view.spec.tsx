// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultView } from './result-view';
import type { ValuationResult } from '../../lib/valuation-api';

function result(over: Partial<ValuationResult['pricing']> = {}): ValuationResult {
  return {
    itemSummary: {
      oneLiner: 'MSR Hubba Hubba NX2 tent',
      categorySlug: 'camping-outdoor',
      make: 'MSR',
      model: 'Hubba Hubba NX2',
      conditionBand: 'GOOD',
      specSheet: [{ label: 'Capacity', value: '2 person' }],
    },
    comps: [],
    pricing: {
      lowZar: 3500,
      midZar: 4200,
      highZar: 5000,
      askingZar: 4400,
      expectedSaleZar: 4100,
      missingData: null,
      ...over,
    },
    confidence: { level: 'MEDIUM', reason: '4 comps' },
    demandNote: 'Steady demand.',
    ad: { title: 'MSR Hubba Hubba NX2', bullets: ['2 person', 'Footprint included', 'Good condition'], priceZar: 4400 },
    unverified: ['Exact year not confirmed'],
  };
}

describe('ResultView', () => {
  it('renders the median price, confidence and the estimation disclaimer', () => {
    render(
      <ResultView
        result={result()}
        legalFlags={[]}
        onCreateListing={() => {}}
        onStartAnother={() => {}}
        creatingListing={false}
      />,
    );
    // The thousands separator is locale-derived (space or comma).
    expect(screen.getByText(/R4.?200/)).toBeInTheDocument();
    expect(screen.getByText(/not an appraisal/i)).toBeInTheDocument();
  });

  it('shows the missing-data message and no price when there is no firm price', () => {
    render(
      <ResultView
        result={result({
          lowZar: null,
          midZar: null,
          highZar: null,
          askingZar: null,
          expectedSaleZar: null,
          missingData: 'Only 2 opened South African listings found.',
        })}
        legalFlags={[]}
        onCreateListing={() => {}}
        onStartAnother={() => {}}
        creatingListing={false}
      />,
    );
    expect(screen.getByText(/Only 2 opened South African listings found/)).toBeInTheDocument();
    expect(screen.queryByText(/R4.?200/)).toBeNull();
  });

  it('renders the legal flags card when the category has flags', () => {
    render(
      <ResultView
        result={result()}
        legalFlags={[{ flag: 'FIREARM_TRANSFER', message: 'Use dealer transfer.' }]}
        onCreateListing={() => {}}
        onStartAnother={() => {}}
        creatingListing={false}
      />,
    );
    expect(screen.getByText('Use dealer transfer.')).toBeInTheDocument();
  });
});
