'use client';

// RecommendedLoadsPanel — the right-hand "Recommended loads" surface. Given a
// cartridge + bullet weight, it lists every powder with PUBLISHED manual data
// for that bullet weight (±tolerance), quoted from the reloading-manual library
// (authoritative — never the engine), each with a start→max charge, velocity,
// manual + page citation, and a suggested work-up ladder (increment + steps).
// Clicking a row loads that powder + its start charge into the Load Lab form.

import type {
  RecommendedLoadRow,
  RecommendedLoadsResponse,
} from '@/lib/load-lab-types';
import { isUpgradeRequired } from '@/lib/load-lab-types';

function ladderText(r: RecommendedLoadRow): string {
  if (r.incrementGr <= 0 || r.steps <= 1) {
    return `published charge ${r.maxGr} gr — start ~10% lower and work up`;
  }
  const base = `start ${r.startGr} gr · +${r.incrementGr} gr × ${r.steps} steps → ${r.maxGr} gr`;
  // Max-only manuals (ADI/Hodgdon/IMR): the start is derived at −10% per the
  // manual's own instruction, not a published figure.
  return r.singleCharge
    ? `${base} · start derived −10% (manual lists max only)`
    : base;
}

export function RecommendedLoadsPanel({
  result,
  loading,
  cartridgeName,
  bulletWeightGr,
  onPickPowder,
}: {
  result: RecommendedLoadsResponse | null;
  loading: boolean;
  cartridgeName: string | null;
  bulletWeightGr: number | null;
  /** Wire a row click back to the form (loads powder + start charge). */
  onPickPowder?: (powderName: string, powderMaker: string, startGr: number) => void;
}) {
  const ready = !!cartridgeName && !!bulletWeightGr;

  return (
    <section
      aria-label="Recommended loads"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0,
      }}
    >
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          Recommended loads
        </h3>
        <p
          style={{
            margin: '2px 0 0',
            fontSize: 11,
            color: 'var(--text-tertiary)',
          }}
        >
          {ready
            ? `${cartridgeName} · ${bulletWeightGr} gr (±5 gr) · most-published powders first`
            : 'Pick a cartridge + bullet to see published loads.'}
        </p>
      </div>

      {ready && loading && (
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Loading published loads…
        </p>
      )}

      {ready && !loading && result && isUpgradeRequired(result) && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          {result.reason}
        </div>
      )}

      {ready && !loading && result && !isUpgradeRequired(result) && (
        <>
          {result.notIndexed || result.powders.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              No published loads indexed for {cartridgeName} at this bullet weight
              yet. (Once an admin extracts this cartridge from the manual library
              it will appear here.)
            </p>
          ) : (
            <>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 520,
                  overflowY: 'auto',
                }}
              >
                {result.powders.map((r, i) => (
                  <li key={`${r.powderName}-${i}`}>
                    <button
                      type="button"
                      onClick={() =>
                        onPickPowder?.(r.powderName, r.powderMaker, r.startGr)
                      }
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        background: 'var(--bg-inset)',
                        border: '0.5px solid var(--border)',
                        borderRadius: 8,
                        padding: '9px 11px',
                        cursor: onPickPowder ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        fontFamily: 'inherit',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                            }}
                          >
                            {/* Powder name only — it's already brand-qualified
                                where it matters (IMR 4350, H4350, N550); the
                                separate maker field is unreliable from bullet-
                                manual parsing, so we don't prepend it. */}
                            {r.powderName}
                          </span>
                          <span
                            title={`Published in ${r.manualCount} of the reloading manuals — a rough popularity signal`}
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              padding: '1px 6px',
                              borderRadius: 999,
                              border: '0.5px solid var(--border)',
                              background:
                                r.manualCount >= 3
                                  ? 'var(--text-primary)'
                                  : 'transparent',
                              color:
                                r.manualCount >= 3
                                  ? 'var(--bg-card)'
                                  : 'var(--text-tertiary)',
                            }}
                          >
                            {r.manualCount} manual{r.manualCount === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.startGr}–{r.maxGr} gr
                        </span>
                      </div>
                      <div
                        style={{ fontSize: 11, color: 'var(--text-secondary)' }}
                      >
                        {ladderText(r)}
                      </div>
                      {r.fillPct != null && (
                        <div style={{ fontSize: 11 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            case fill {r.fillPct}%
                            {r.fillSource === 'estimate' ? ' (est.)' : ''}
                          </span>
                          {r.compressed && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontWeight: 700,
                                color: 'var(--red, #c0392b)',
                              }}
                            >
                              · compressed
                            </span>
                          )}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 10.5,
                          color: 'var(--text-tertiary)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span>
                          {r.startVelFps || r.maxVelFps
                            ? `${r.startVelFps ?? '?'}–${r.maxVelFps ?? '?'} fps`
                            : 'velocity n/a'}
                          {r.bulletWeightGr !== bulletWeightGr
                            ? ` · for ${r.bulletWeightGr} gr`
                            : ''}
                          {r.bulletName ? ` ${r.bulletName}` : ''}
                        </span>
                        <span style={{ whiteSpace: 'nowrap', fontStyle: 'italic' }}>
                          {r.manual}, p.{r.pageNumber}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              <p
                style={{
                  margin: 0,
                  fontSize: 10.5,
                  color: 'var(--text-tertiary)',
                  lineHeight: 1.5,
                  borderTop: '0.5px solid var(--border)',
                  paddingTop: 8,
                }}
              >
                Ranked by how many manuals publish each powder — a rough
                popularity signal, <strong>not</strong> a safety ranking.
                Published manual data is <strong>authoritative for charges</strong>:
                always start at the START charge, work up watching for pressure,
                and verify against the cited manual. Your rifle, brass, and primers
                differ from the test rig.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
