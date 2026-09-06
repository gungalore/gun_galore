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

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@clerk/nextjs';

import type { LogListProps } from './contract';
import { Btn, Field, IconX, OverlayShell, Tag, usePhone, type BenchSize } from './primitives';
/**
 * ⚠️ THE LOG SHEET'S PARSER, NOT A SECOND ONE. `35,6` typed here has to mean
 * what it means one overlay up, and a decimal comma is exactly the kind of
 * thing two implementations disagree about — see the note on parseDecimal.
 */
import { parseDecimal } from './LogSheet';
import { benchApi, type LogEntry, type LogResultsPatch } from '@/lib/bench/api';
import { MS, type Units } from '@/lib/bench/geometry';

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

/* ── The server's flags ─────────────────────────────────────────────── */

/**
 * ⚠️ THE SERVER DECIDES, THE LIST ONLY SPELLS. `GET /bench/log` returns the
 * COAL flags the results rows already carry plus `ABOVE_MAX` / `BELOW_START`
 * for the charge against the load the entry came off — the same judgement the
 * log sheet showed while it was being typed. Until this existed the entry
 * logged two grains over the max looked exactly like every other row, which is
 * the one row in the log a member would want to find again.
 *
 * ⚠️ AND AN UNKNOWN FLAG IS DROPPED, NOT PRINTED RAW. `flags` is `string[]`
 * because it is wire data; a name this file has not learnt yet is not a
 * sentence to put in front of anyone.
 */
const LOG_FLAG_LABELS: Record<string, { t: string; warn: boolean }> = {
  COAL_OVER_MAX: { t: 'COAL OVER MAX', warn: true },
  COAL_NEAR_MAX: { t: 'COAL NEAR MAX', warn: true },
  COAL_RANGE: { t: 'COAL RANGE', warn: false },
  ABOVE_MAX: { t: 'ABOVE MAX', warn: true },
  BELOW_START: { t: 'BELOW START', warn: false },
};

interface FlagTag {
  t: string;
  warn: boolean;
}

/**
 * The flags as the strip the results rows use, with the figure the flag is
 * about appended where the entry carries it: `ABOVE MAX 41.5`, exactly as the
 * log sheet said it at the moment it was saved.
 */
function flagTags(e: LogEntry): FlagTag[] {
  const out: FlagTag[] = [];
  for (const f of e.flags ?? []) {
    const label = LOG_FLAG_LABELS[f];
    if (!label) continue;
    const figure =
      f === 'ABOVE_MAX' && e.maxGr !== null
        ? ` ${e.maxGr.toFixed(1)}`
        : f === 'BELOW_START' && e.startGr !== null
          ? ` ${e.startGr.toFixed(1)}`
          : '';
    out.push({ t: `${label.t}${figure}`, warn: label.warn });
  }
  return out;
}

/* ── The charge against its own window ──────────────────────────────── */

/**
 * A start–max bar with the logged charge marked on it.
 *
 * ⚠️ THE DOMAIN STRETCHES TO HOLD THE CHARGE, IT DOES NOT CLAMP IT. Pinning an
 * over-max charge to the right-hand end would draw the one entry that needs a
 * second look as if it sat exactly on the ceiling. The window keeps its own
 * band; a charge outside it is drawn outside it.
 *
 * Decorative: the figures beside it and the flag strip above it carry every
 * fact this draws.
 */
function StartMaxBar({
  chargeGr,
  startGr,
  maxGr,
  warn,
}: {
  chargeGr: number;
  startGr: number;
  maxGr: number;
  warn: boolean;
}) {
  const lo = Math.min(startGr, chargeGr);
  const hi = Math.max(maxGr, chargeGr);
  const span = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / span) * 100;
  const ink = warn ? 'var(--warning)' : 'var(--success)';
  return (
    <div aria-hidden="true" style={{ position: 'relative', height: 10, marginTop: 6 }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 4,
          height: 3,
          borderRadius: 2,
          background: 'var(--border-divider)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${pct(startGr)}%`,
          width: `${Math.max(0, pct(maxGr) - pct(startGr))}%`,
          top: 4,
          height: 3,
          borderRadius: 2,
          background: 'var(--border)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${pct(chargeGr)}%`,
          top: 0,
          marginLeft: -1,
          width: 2,
          height: 11,
          borderRadius: 1,
          background: ink,
        }}
      />
    </div>
  );
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

/* ── Results, added after the range ─────────────────────────────────── */

/**
 * ⚠️ STORED IN m/s, SHOWN IN WHAT THE MEMBER READS. `velocityMs` is the
 * column, and a chronograph set to fps is a display preference — not a second
 * column, and not a number to guess about later.
 */
function velocityText(ms: number, units: Units): string {
  return units === 'imperial' ? `${Math.round(ms / MS)} fps` : `${Math.round(ms)} m/s`;
}

/** `732 m/s · 18 mm group`, or nothing at all where neither was measured. */
function resultsText(e: LogEntry, units: Units): string | null {
  const parts: string[] = [];
  if (e.velocityMs != null) parts.push(velocityText(e.velocityMs, units));
  if (e.groupMm != null) parts.push(`${e.groupMm} mm group`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The two figures a member comes back with.
 *
 * 🚨 THE SHEET ALREADY PROMISED THIS — "Results (velocity, group) are added
 * after the range." — and there was no way to add them. The log held a charge
 * and a date and no way to say what it did, which is the half of a load record
 * that makes the other half worth keeping.
 *
 * ⚠️ NOTHING ELSE ON THE ENTRY IS EDITABLE HERE. The charge, the COAL, the
 * primer, the case and the date are the record of a round that has already
 * been fired; the results are what was not known when it was written down.
 */
function ResultsEditor({
  entry,
  units,
  size,
  onSave,
  onCancel,
}: {
  entry: LogEntry;
  units: Units;
  size: BenchSize;
  onSave: (patch: LogResultsPatch) => void;
  onCancel: () => void;
}) {
  const imperial = units === 'imperial';
  const [velocity, setVelocity] = useState(() =>
    entry.velocityMs == null
      ? ''
      : String(imperial ? Math.round(entry.velocityMs / MS) : Math.round(entry.velocityMs)),
  );
  const [group, setGroup] = useState(() => (entry.groupMm == null ? '' : String(entry.groupMm)));

  // Blank is a value: it clears the figure. A typo is not — Save waits.
  const vNum = velocity.trim() === '' ? null : parseDecimal(velocity);
  const gNum = group.trim() === '' ? null : parseDecimal(group);
  const ok = (vNum === null || Number.isFinite(vNum)) && (gNum === null || Number.isFinite(gNum));

  return (
    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
      <div style={{ flex: '1 1 130px', minWidth: 120 }}>
        <Field
          label={imperial ? 'Velocity, fps' : 'Velocity, m/s'}
          value={velocity}
          onChange={setVelocity}
          numeric
          inputMode="decimal"
          size={size}
        />
      </div>
      <div style={{ flex: '1 1 110px', minWidth: 100 }}>
        <Field
          label="Group, mm"
          value={group}
          onChange={setGroup}
          numeric
          inputMode="decimal"
          size={size}
        />
      </div>
      <Btn
        red
        size={size}
        disabled={!ok}
        style={{ flex: 'none' }}
        onClick={() =>
          onSave({
            // Back to the stored unit at the boundary, once, so nothing
            // downstream has to know which unit the member typed in.
            velocityMs: vNum === null ? null : imperial ? Math.round(vNum * MS) : vNum,
            groupMm: gNum,
          })
        }
      >
        Save results
      </Btn>
      <Btn size={size} style={{ flex: 'none' }} onClick={onCancel}>
        Cancel
      </Btn>
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────────────── */

export default function LogList({
  entries,
  loading,
  units,
  onClose,
  onDelete,
  onUpdated,
  onError,
}: LogListProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const phone = usePhone();
  const still = useStill();
  const { getToken } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * The rows this list has written since it opened.
   *
   * ⚠️ NOT A SECOND SOURCE OF TRUTH — AN OVERLAY ON THE ONE PROP. The page owns
   * `entries`, and a page that wires `onUpdated` replaces the row underneath
   * this anyway; the overlay is what makes the new figures appear for a page
   * that does not. Keyed by id, so it can only ever agree with the server's
   * own answer.
   */
  const [saved, setSaved] = useState<Record<string, LogEntry>>({});
  /** The one row armed for deletion. Two taps, never one. */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** The one row with its results form open. */
  const [editId, setEditId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevert = useCallback(() => {
    if (revert.current !== null) {
      clearTimeout(revert.current);
      revert.current = null;
    }
  }, []);

  // A timer that outlives the overlay would call setState on a component the
  // member closed — and arm a row that is no longer on the screen.
  useEffect(() => clearRevert, [clearRevert]);

  /**
   * Two taps to delete, and the armed state gives itself back.
   *
   * ⚠️ THE SECOND TAP IS A DIFFERENT CONTROL WITH A DIFFERENT NAME. The first
   * tap turns the bare × into "Yes, delete"; a member who meant something else
   * simply does not press it, and after four seconds the row goes back to what
   * it was. A destructive one-tap on a row of someone's own record is the one
   * mistake this list cannot undo.
   */
  const arm = useCallback(
    (id: string) => {
      clearRevert();
      setRowError(null);
      setConfirmId(id);
      revert.current = setTimeout(() => setConfirmId(null), 4000);
    },
    [clearRevert],
  );

  const confirmDelete = useCallback(
    async (id: string) => {
      clearRevert();
      setConfirmId(null);
      try {
        // The page deletes optimistically, so a rejection here is the only
        // signal that the row is back — and until this existed a failed delete
        // said nothing at all.
        await onDelete(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'That entry could not be deleted.';
        setRowError(msg);
        onError?.(msg);
      }
    },
    [clearRevert, onDelete, onError],
  );

  const saveResults = useCallback(
    async (id: string, patch: LogResultsPatch) => {
      setRowError(null);
      try {
        const updated = await benchApi.updateLog(getToken, id, patch);
        if (updated) {
          setSaved((prev) => ({ ...prev, [id]: updated }));
          onUpdated?.(updated);
        }
        setEditId(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Those results could not be saved.';
        setRowError(msg);
        onError?.(msg);
      }
    },
    [getToken, onUpdated, onError],
  );

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
            the export is a scripted request now, not a navigation.

            ⚠️ ABSENT ON AN EMPTY LOG. It offered a download of a file with a
            header row and nothing under it, beside a panel whose own copy says
            nothing has been logged yet — a control that can only disappoint
            the one member who presses it. */}
        {entries.length > 0 && (
          <Btn
            onClick={exportCsv}
            aria-busy={exporting}
            size={phone ? 'mobile' : 'desktop'}
            icon={<IconDownload />}
            style={{ flex: 'none' }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Btn>
        )}
        <IconX onClick={onClose} label="Close" size={phone ? 'mobile' : 'desktop'} glyph={phone ? 18 : 16} />
      </div>

      {/* A failed export, a failed delete or a failed save has to say so
          somewhere. All three are the list's own requests, so they are
          announced here, next to the control that started them — and a page
          that passes `onError` gets the same sentence in its toast. */}
      {(exportError ?? rowError) && (
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
          {exportError ?? rowError}
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
            ? {
                flex: '1 1 auto',
                minHeight: 0,
                // The last row must clear the home indicator, or its delete
                // sits under the bar that dismisses the app.
                paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
              }
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

        {/* ⚠️ IN THE ORDER THEY ARRIVE. The server orders by `shotAt` desc —
            the day printed on each row — so there is nothing to sort here, and
            a client sort could only make the list disagree with its own dates
            for a back-dated entry. */}
        {!loading &&
          entries.map((raw) => {
            // The freshest copy: whatever this list last saved for the row,
            // else the page's.
            const e = saved[raw.id] ?? raw;
            const charge = `${e.chargeGr.toFixed(1)} gr`;
            const removeLabel = `Delete ${e.cartridgeName} · ${e.powderName} ${charge}`;
            const tags = flagTags(e);
            const warn = tags.some((t) => t.warn);
            const window =
              e.startGr !== null && e.maxGr !== null ? { start: e.startGr, max: e.maxGr } : null;
            const results = resultsText(e, units);
            const editing = editId === e.id;
            const size = phone ? 'mobile' : 'desktop';

            const remove =
              confirmId === e.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>Delete?</span>
                  <Btn
                    red
                    size={size}
                    onClick={() => void confirmDelete(e.id)}
                    aria-label={`Yes, delete ${e.cartridgeName} · ${e.powderName} ${charge}`}
                    style={{ flex: 'none' }}
                  >
                    Yes, delete
                  </Btn>
                </div>
              ) : (
                /* 44px on the phone per §9; the prototype's 36 is below the
                   tap-target floor and this is a destructive control. */
                <IconX
                  onClick={() => arm(e.id)}
                  label={removeLabel}
                  size={size}
                  glyph={phone ? 14 : 12}
                  style={phone ? { flex: 'none' } : { width: 26, height: 26, flex: 'none' }}
                />
              );

            const extras = (
              <div style={{ marginTop: 8 }}>
                {(tags.length > 0 || window !== null) && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    {tags.map((t) => (
                      <Tag key={t.t} warn={t.warn}>
                        {t.t}
                      </Tag>
                    ))}
                    {window && (
                      <>
                        <div style={{ flex: '1 1 120px', minWidth: 110 }}>
                          <StartMaxBar
                            chargeGr={e.chargeGr}
                            startGr={window.start}
                            maxGr={window.max}
                            warn={warn}
                          />
                        </div>
                        <span
                          className="num"
                          style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
                        >
                          {window.start.toFixed(1)}–{window.max.toFixed(1)} gr
                        </span>
                      </>
                    )}
                  </div>
                )}

                {editing ? (
                  <ResultsEditor
                    entry={e}
                    units={units}
                    size={size}
                    onSave={(patch) => void saveResults(e.id, patch)}
                    onCancel={() => setEditId(null)}
                  />
                ) : (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}
                  >
                    {results && (
                      <span
                        className="num"
                        style={{ fontSize: 12, color: 'var(--text-secondary)' }}
                      >
                        {results}
                      </span>
                    )}
                    <Btn
                      size={size}
                      onClick={() => {
                        setRowError(null);
                        setEditId(e.id);
                      }}
                      style={{ flex: 'none' }}
                    >
                      {results ? 'Edit results' : 'Add results'}
                    </Btn>
                  </div>
                )}
              </div>
            );

            if (phone) {
              return (
                <div
                  key={e.id}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '0.5px solid var(--border-divider)',
                    fontSize: 13,
                    animation: rise,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>
                        {e.cartridgeName} · {e.powderName} {charge}
                      </div>
                      <div
                        className="num"
                        style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}
                      >
                        {e.bulletLabel}
                        {e.coalMm != null ? ` · COAL ${coalShort(e.coalMm, units)}` : ''} ·{' '}
                        {e.primer || 'no primer noted'} · {dayOf(e.shotAt)}
                      </div>
                    </div>
                    {remove}
                  </div>
                  {extras}
                </div>
              );
            }

            return (
              <div
                key={e.id}
                style={{
                  padding: '12px 20px',
                  borderBottom: '0.5px solid var(--border-divider)',
                  fontSize: 13,
                  animation: rise,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    // minmax(0, ·) on every track: without it a long bullet name
                    // blows the grid out past the modal instead of wrapping.
                    gridTemplateColumns:
                      'minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1fr)',
                    gap: 10,
                    alignItems: 'center',
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
                  <div
                    className="num"
                    title={e.coalMm != null ? coalFull(e.coalMm, units) : undefined}
                  >
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
                    {remove}
                  </div>
                </div>
                {extras}
              </div>
            );
          })}
      </div>
    </OverlayShell>
  );
}
