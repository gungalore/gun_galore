'use client';

import type { ValuationResult } from '../../lib/valuation-api';
import { AdPreviewCard } from './ad-preview-card';
import { LegalFlagsCard } from './legal-flags-card';

function zar(n: number | null): string {
  return n == null ? '-' : `R${n.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

const CONFIDENCE_COLOR: Record<string, string> = {
  HIGH: 'var(--red)',
  MEDIUM: '#b26a00',
  LOW: 'var(--text-tertiary)',
};

export function ResultView({
  result,
  legalFlags,
  onCreateListing,
  onStartAnother,
  creatingListing,
}: {
  result: ValuationResult;
  legalFlags: Array<{ flag: string; message: string }>;
  onCreateListing: () => void;
  onStartAnother: () => void;
  creatingListing: boolean;
}) {
  const { itemSummary, pricing, confidence } = result;
  const noFirmPrice = pricing.midZar == null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {itemSummary.oneLiner}
        </h1>
        <div className="mt-2 flex items-center gap-3 text-sm">
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            {itemSummary.conditionBand}
          </span>
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--bg-inset)', color: CONFIDENCE_COLOR[confidence.level] }}
          >
            {confidence.level} confidence
          </span>
        </div>
      </div>

      {noFirmPrice ? (
        <div
          className="rounded-[10px] p-4 text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          {pricing.missingData ??
            'Not enough South African listings were found to give a firm price.'}
        </div>
      ) : (
        <div
          className="rounded-[10px] p-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Low</p>
              <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{zar(pricing.lowZar)}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Mid</p>
              <p className="text-xl font-bold" style={{ color: 'var(--red)' }}>{zar(pricing.midZar)}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>High</p>
              <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{zar(pricing.highZar)}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p style={{ color: 'var(--text-tertiary)' }}>Recommended asking</p>
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{zar(pricing.askingZar)}</p>
            </div>
            <div>
              <p style={{ color: 'var(--text-tertiary)' }}>Expected sale</p>
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{zar(pricing.expectedSaleZar)}</p>
            </div>
          </div>
        </div>
      )}

      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span className="font-medium">Confidence:</span> {confidence.reason}
      </p>

      {String(result.meta?.basis ?? '') === 'DEPRECIATED_ANCHOR' && (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Based on the current new South African price less depreciation for its
          age and condition, because no used comparables were found.
        </p>
      )}
      {String(result.meta?.basis ?? '') === 'BLEND' && (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Blended from the few comparables found and the depreciated new price.
        </p>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Spec sheet</h2>
        <div className="rounded-[10px] p-4" style={{ background: 'var(--bg-inset)' }}>
          {itemSummary.specSheet.map((row, i) => (
            <div key={i} className="flex justify-between py-1 text-sm">
              <span style={{ color: 'var(--text-tertiary)' }}>{row.label}</span>
              <span style={{ color: 'var(--text-primary)' }}>{row.value}</span>
            </div>
          ))}
          {itemSummary.accessories?.length ? (
            <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
              <p className="text-xs uppercase mb-1" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>
                Accessories valued separately
              </p>
              {itemSummary.accessories.map((a, i) => (
                <div key={i} className="flex justify-between py-0.5 text-sm">
                  <span style={{ color: 'var(--text-secondary)' }}>{a.name}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{zar(a.valueCents != null ? Math.round(a.valueCents / 100) : null)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {result.priceScale && result.priceScale.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            Where to price your listing
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {result.priceScale.map((tier) => (
              <div
                key={tier.key}
                className="rounded-[10px] p-4"
                style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
              >
                <p className="text-xs uppercase" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>
                  {tier.label}
                </p>
                <p className="text-lg font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>
                  {tier.priceZar == null ? '-' : `R${tier.priceZar.toLocaleString('en-ZA')}`}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  {tier.note}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.retailAnchorSource && (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          New-price reference:{' '}
          <a
            href={result.retailAnchorSource.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--red)' }}
          >
            {result.retailAnchorSource.site}
          </a>
        </p>
      )}

      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span className="font-medium">Demand:</span> {result.demandNote}
      </p>

      <LegalFlagsCard flags={legalFlags} />

      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Ready-to-post ad</h2>
        <AdPreviewCard ad={result.ad} />
      </section>

      {result.unverified.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Could not verify</h2>
          <ul className="flex flex-col gap-1 text-sm" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
            {result.unverified.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        This is an estimate based on public South African listings at the time of research.
        It is not an appraisal, not financial advice, and not a guarantee of sale price.
        {legalFlags.length > 0 &&
          ' Regulated items: sale and transfer are subject to South African law. All Outdoor does not provide legal advice.'}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCreateListing}
          disabled={creatingListing}
          className="rounded-[8px] px-5 py-3 text-sm font-semibold"
          style={{
            background: creatingListing ? 'var(--bg-inset)' : 'var(--red)',
            color: creatingListing ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            cursor: creatingListing ? 'not-allowed' : 'pointer',
          }}
        >
          {creatingListing ? 'Preparing...' : 'Create listing from this valuation'}
        </button>
        <button
          type="button"
          onClick={onStartAnother}
          className="rounded-[8px] px-4 py-3 text-sm"
          style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          Start another valuation
        </button>
      </div>
    </div>
  );
}
