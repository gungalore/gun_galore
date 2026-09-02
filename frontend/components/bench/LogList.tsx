'use client';

import { MM_PER_INCH } from '@/lib/bench/geometry';

/**
 * THE BENCH — the load log.
 *
 * Desktop is the 640px modal from `Main.dc.html`, five columns per entry; the
 * phone is the bottom sheet from `Pwa.dc.html`, where the same figures stack
 * into a title and a detail line so nothing has to be dropped to fit.
 *
 * Presentational, with one exception: the page owns the fetch, the delete and
 * the toast, but the CSV export has to make its own authenticated request —
 * LogListProps carries neither an export callback nor a token getter, and
 * GET /bench/log.csv is Clerk-guarded, so there is no link that could do it.
 * Escape, the focus trap and the return of focus come from OverlayShell.
 *
 * ⚠️ COPY. Operator ruling 2026-09-02: nothing here names where a figure comes
 * from. These are the member's own rounds; the only vocabulary on show is
 * COAL, the charge in grains, and the powder's product name.
 */

import { useId, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@clerk/nextjs';

import type { LogListProps } from './contract';
import { Btn, IconX, OverlayShell, usePhone } from './primitives';
import type { Units } from '@/lib/bench/geometry';

/* ── Phone vs desktop ───────────────────────────────────────────────── */

/**
 * SPEC §5.4: the overlay frame flips at 768. Same query and the same two
 * signals as LoadCard and PowderPicker — the installed app is always the
 * sheet whatever the window reports, and iOS Safari still answers only to its
 * own legacy property.
 */




/**
 * ⚠️ READ IN JS BECAUSE THE ROWS ANIMATE FROM A STYLE ATTRIBUTE. bench.css's
 * `prefers-reduced-motion` block names its own selectors, and it cannot reach
 * an inline animation — so honouring the preference is this file's job or it
 * does not happen at all.
 */
const STILL_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeStill(cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(STILL_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function stillSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(STILL_QUERY).matches;
}

function useStill(): boolean {
  return useSyncExternalStore(subscribeStill, stillSnapshot, () => false);
}

/* ── Helpers ────────────────────────────────────────────────────────── */


/** The column figure: the member's primary unit only, so it fits the cell. */
function coalShort(mm: number, units: Units): string {
  return units === 'imperial' ? `${(mm / MM_PER_INCH).toFixed(3)}″` : `${mm.toFixed(2)} mm`;
}

/** Both units, for the cell's title — the short form is a fit, not a fact. */
function coalFull(mm: number, units: Units): string {
  const metric = `${mm.toFixed(2)} mm`;
  const imperial = `${(mm / MM_PER_INCH).toFixed(3)}″`;
  return units === 'imperial' ? `${imperial} (${metric})` : `${metric} (${imperial})`;
}

/** `shotAt` is an ISO date-time; the log only ever shows the day. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The CSV is served by the API, not by Next, so the URL has to be absolute.
 *
 * ⚠️ THE SAME BASE AND FALLBACK AS lib/bench/api.ts, ON PURPOSE. That module
 * keeps its `API_URL` private and this request does not go through it, so the
 * two have to be kept in step by hand.
 */
const CSV_URL = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'}/bench/log.csv`;

/**
 * ⚠️ MIRRORS THE NAME BenchService.logCsv PUTS IN Content-Disposition, WHICH
 * CANNOT BE READ HERE. The API sets no Access-Control-Expose-Headers, so a
 * cross-origin response hides that header, and a blob download is named by
 * the caller or not at all.
 */
const CSV_NAME = 'the-bench-load-log.csv';

function IconDownload() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

/* ── Component ──────────────────────────────────────────────────────── */

export default function LogList({ entries, loading, units, onClose, onDelete }: LogListProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const phone = usePhone();
  const still = useStill();
  const { getToken } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /* Rows rise in, as they do everywhere else in the module (§8). */
  const rise = still ? undefined : 'bench-rise var(--dur-base) var(--ease-out) both';

  /**
   * ⚠️ A PLAIN <a href download> CANNOT DO THIS, WHICH IS WHY IT IS A FETCH.
   *
   * ClerkGuard reads the Authorization header and nothing else (no cookie
   * fallback), and a link navigation carries no header — so the link 401s
   * every time. Worse, `download` is ignored cross-origin, so the browser
   * would leave the Bench to render the API's error and the member would lose
   * the overlay stack behind it. Same shape as the receipt download in
   * app/transactions/[id]/download-receipt-button.tsx.
   */
  async function exportCsv() {
    // Re-entry is refused here rather than by disabling the button, and that
    // is deliberate: disabling the focused control drops focus to <body>,
    // and OverlayShell's Tab trap compares activeElement against the panel's
    // first and last focusable — from <body> neither matches and the next Tab
    // walks out of the modal into the finder behind the dim.
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const token = await getToken();
      const res = await fetch(CSV_URL, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = CSV_NAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the same tick as the click, as the receipt button does:
      // the browser has already taken the blob by the time click() returns,
      // and a deferred revoke would be an uncleaned timer on an overlay the
      // member can close at any moment.
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <OverlayShell
      variant={phone ? 'bottom-sheet' : 'modal'}
      labelledBy={titleId}
      onClose={onClose}
      style={
        phone
          ? undefined
          : {
              // Main.dc.html's 640. `.bench-modal` defaults to 760, which is
              // the load card's width, not this one's.
              width: 'min(640px, calc(100vw - 32px))',
              display: 'flex',
              flexDirection: 'column',
            }
      }
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: phone ? 8 : 12,
          padding: phone ? '4px 4px 8px 16px' : '18px 20px 12px',
          borderBottom: phone ? undefined : '0.5px solid var(--border-divider)',
        }}
      >
        {/* The shell focuses this on open and makes it a script-only tab stop. */}
        <h2 id={titleId} className="head" style={{ flex: 1, margin: 0, fontSize: phone ? 18 : 20 }}>
          Load log
        </h2>
        {/* The Btn primitive rather than a bare <a class="btn">: it already
            carries the font-family fix and the phone's 44px touch size, and
            the export is a scripted request now, not a navigation. */}
        <Btn
          onClick={exportCsv}
          aria-busy={exporting}
          size={phone ? 'mobile' : 'desktop'}
          icon={<IconDownload />}
          style={{ flex: 'none' }}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Btn>
        <IconX onClick={onClose} label="Close" size={phone ? 'mobile' : 'desktop'} glyph={phone ? 18 : 16} />
      </div>

      {/* A failed export has to say so somewhere. LogListProps has no error
          slot — it describes the list, not this request — so it is announced
          here, next to the control that started it. */}
      {exportError && (
        <p
          role="alert"
          style={{
            flex: 'none',
            margin: 0,
            padding: phone ? '6px 16px 0' : '8px 20px 0',
            fontSize: 12,
            color: 'var(--red)',
          }}
        >
          {exportError}
        </p>
      )}

      <div
        style={{
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          // min-height 0 is load-bearing: without it the flex child refuses to
          // shrink below its content and the list grows past the sheet instead
          // of scrolling inside it.
          ...(phone
            ? { flex: '1 1 auto', minHeight: 0, paddingBottom: 28 }
            : { flex: '1 1 auto', minHeight: 0 }),
        }}
      >
        {loading && (
          <div aria-busy="true" style={{ padding: phone ? '4px 16px 12px' : '4px 20px 12px' }}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '14px 0',
                  borderBottom: '0.5px solid var(--border-divider)',
                }}
              >
                {/* `.gg-skeleton` fills with --bg-card, the same white as the
                    overlay, so each bar carries a hairline to be visible at
                    all; the shimmer does the rest. */}
                <div
                  className="gg-skeleton"
                  style={{ height: 10, flex: 1, border: '0.5px solid var(--border-divider)' }}
                />
                <div
                  className="gg-skeleton"
                  style={{ height: 10, width: 64, border: '0.5px solid var(--border-divider)' }}
                />
              </div>
            ))}
          </div>
        )}

        {!loading && entries.length === 0 && (
          <p
            style={{
              padding: '36px 20px',
              margin: 0,
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 13,
            }}
          >
            Nothing logged yet. Open a load and tap{' '}
            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Log this load</span>.
          </p>
        )}

        {!loading &&
          entries.map((e) => {
            const charge = `${e.chargeGr.toFixed(1)} gr`;
            const removeLabel = `Delete ${e.cartridgeName} · ${e.powderName} ${charge}`;

            if (phone) {
              return (
                <div
                  key={e.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 16px',
                    borderBottom: '0.5px solid var(--border-divider)',
                    fontSize: 13,
                    animation: rise,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>
                      {e.cartridgeName} · {e.powderName} {charge}
                    </div>
                    <div className="num" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {e.bulletLabel}
                      {e.coalMm != null ? ` · COAL ${coalShort(e.coalMm, units)}` : ''} ·{' '}
                      {e.primer || 'no primer noted'} · {dayOf(e.shotAt)}
                    </div>
                  </div>
                  {/* 44px on the phone per §9; the prototype's 36 is below the
                      tap-target floor and this is a destructive control. */}
                  <IconX
                    onClick={() => onDelete(e.id)}
                    label={removeLabel}
                    size="mobile"
                    glyph={14}
                    style={{ flex: 'none' }}
                  />
                </div>
              );
            }

            return (
              <div
                key={e.id}
                style={{
                  display: 'grid',
                  // minmax(0, ·) on every track: without it a long bullet name
                  // blows the grid out past the modal instead of wrapping.
                  gridTemplateColumns:
                    'minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1fr)',
                  gap: 10,
                  padding: '12px 20px',
                  borderBottom: '0.5px solid var(--border-divider)',
                  fontSize: 13,
                  alignItems: 'center',
                  animation: rise,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {e.cartridgeName} · {e.bulletLabel}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    {e.powderName}
                  </div>
                </div>
                <div className="num">{charge}</div>
                <div className="num" title={e.coalMm != null ? coalFull(e.coalMm, units) : undefined}>
                  {e.coalMm != null ? coalShort(e.coalMm, units) : '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 0 }}>
                  {e.primer || '—'}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                  }}
                >
                  <span className="num" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    {dayOf(e.shotAt)}
                  </span>
                  <IconX
                    onClick={() => onDelete(e.id)}
                    label={removeLabel}
                    glyph={12}
                    style={{ width: 26, height: 26, flex: 'none' }}
                  />
                </div>
              </div>
            );
          })}
      </div>
    </OverlayShell>
  );
}
