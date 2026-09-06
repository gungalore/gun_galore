'use client';

/**
 * THE BENCH — "Log this load".
 *
 * Desktop is the 560px centred modal from `Main.dc.html`; the phone is the
 * bottom sheet from `Pwa.dc.html`, which folds cartridge + powder + bullet
 * into one read-only "Load" line because the three of them are not editable
 * anyway. Same values, same order, same copy.
 *
 * Presentational only: this file holds what the member types and hands a
 * `LogDraft` to the page, which owns the POST, the toast and the badge pulse.
 *
 * ⚠️ THE FLAGS WARN, THEY DO NOT BLOCK. A workup that walks past the max
 * charge, or a seating depth outside the printed window, is a legitimate thing
 * for a reloader to record — and a log that refuses to hold what actually went
 * down the barrel is worse than useless, because the member then keeps the real
 * numbers somewhere else. So `ABOVE MAX 41.5` is a tag, never a disabled Save.
 * The only thing that disables Save is a value the server cannot store.
 *
 * ⚠️ COPY. Operator ruling 2026-09-02: nothing on this surface names where a
 * figure comes from. The vocabulary is start charge / max charge / "the
 * maximum" for COAL, and the safety line is the SAFETY_LINE constant rather
 * than copy retyped here.
 */

import { useId, useState } from 'react';

import { SAFETY_LINE, type LogDraft, type LogSheetProps } from './contract';
import { Btn, Field, IconX, OverlayShell, Tag, usePhone } from './primitives';
import { coalCheck, today, type Units, MM_PER_INCH } from '@/lib/bench/geometry';

/* ── Phone vs desktop ───────────────────────────────────────────────── */

/**
 * SPEC §5.4: the overlay frame flips at 768, and the installed app is always
 * the sheet whatever the window reports. Same query and same two signals as
 * LoadCard — this sheet opens on top of that card, so the pair must never
 * disagree about which board they are drawing.
 */




/* ── Helpers ────────────────────────────────────────────────────────── */


/** Metric first with the other in brackets; the preference flips the order. */
function fmtLength(mm: number, units: Units): string {
  const metric = `${mm.toFixed(2)} mm`;
  const imperial = `${(mm / MM_PER_INCH).toFixed(3)}″`;
  return units === 'imperial' ? `${imperial} (${metric})` : `${metric} (${imperial})`;
}

/**
 * A real calendar day, not merely something the right shape.
 *
 * ⚠️ THE SHAPE TEST IS NOT ENOUGH, AND BOTH WAYS IT FAILS RE-DATE THE ROUND
 * SILENTLY. `/\d{4}-\d{2}-\d{2}/` accepts `2026-02-31` and `2026-13-45`.
 * `2026-13-45` is unparseable, and BenchService.addLog falls back to the
 * column default when Date.parse fails — the load files itself under today.
 * `2026-02-31` is worse: V8 rolls an over-long month FORWARD, so it parses
 * cleanly as 3 March and the log stores a date the member never typed.
 *
 * So the parts are round-tripped through UTC: a day that rolled is a day that
 * comes back different, and the field stays invalid until it is a real date.
 */
function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

interface Flag {
  t: string;
  /** Gold rather than the neutral tag. Never red — red is the CTA. */
  warn: boolean;
}

/**
 * A decimal typed with EITHER separator.
 *
 * 🚨 `35,6` USED TO LOG AS `35.0 gr`, SILENTLY. `parseFloat` stops at the
 * comma, so the charge a member typed on a site whose own cartridge names are
 * written `6,5 Creedmoor` — and on a phone keypad that offers a comma in this
 * locale — was truncated to a smaller charge, saved, and shown back as if it
 * were what they had asked for. A HALF-grain error in a load log is not a
 * cosmetic one.
 *
 * ⚠️ AND IT IS A STRICT PARSE, NOT A `replace(/,/g, '.')`. A grouped figure
 * like `1,234.5` becomes `1.234.5`, which parseFloat happily reads as `1.234`
 * — the same silent truncation wearing a different hat. Anything that is not
 * one plain decimal comes back NaN, which disables Save and says so.
 */
export function parseDecimal(s: string): number {
  const t = s.trim().replace(/\s/g, '');
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return NaN;
  return parseFloat(t.replace(',', '.'));
}

/**
 * The reading a comma-typed figure was taken as, echoed back under the field.
 *
 * The member types `35,6`, the field keeps `35,6` — moving what someone is
 * typing under their fingers is its own bug — and this line says what the log
 * will hold. Silent on a figure typed with a point, where there is nothing to
 * reassure anyone about.
 */
function ReadsAs({ typed, value, unit }: { typed: string; value: number; unit: string }) {
  if (!typed.includes(',') || !Number.isFinite(value)) return null;
  return (
    <span className="num" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
      reads as {value} {unit}
    </span>
  );
}

/* ── Component ──────────────────────────────────────────────────────── */

export default function LogSheet({
  row,
  cartridge,
  weightGr,
  units,
  saving,
  error,
  onClose,
  onSave,
}: LogSheetProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const phone = usePhone();
  const size = phone ? 'mobile' : 'desktop';

  /* The bullet as one string, because that is how the log stores it: the row's
     maker and type, plus the weight of the group the row was found under. */
  const bulletLabel = `${row.bulletMaker} ${row.bulletType} ${weightGr} gr`;
  /* The phone's single read-only line, quoted from Pwa.dc.html. */
  const loadLabel = `${cartridge.name} · ${row.powder} · ${bulletLabel}`;

  /* Prefilled ONCE, from the load. These are useState initialisers, not props
     mirrored into state on every render: a prefill that re-runs would move the
     value under the member mid-keystroke. The page keys this sheet per load,
     so opening a different row mounts a fresh form. */
  const [charge, setCharge] = useState(() => row.startGr.toFixed(1));
  const [coal, setCoal] = useState(() => (row.coalMm == null ? '' : row.coalMm.toFixed(2)));
  const [primer, setPrimer] = useState('');
  const [caseLabel, setCaseLabel] = useState('');
  const [shotAt, setShotAt] = useState(() => today());

  /* Backdrop, Escape (top-most only), the focus trap and the return of focus
     all live in OverlayShell; nothing about them is re-implemented here. */

  const chargeGr = parseDecimal(charge);
  const chargeOk = Number.isFinite(chargeGr) && chargeGr > 0;
  const coalTyped = coal.trim() !== '';
  const coalMm = coalTyped ? parseDecimal(coal) : null;
  const coalOk = coalMm === null || Number.isFinite(coalMm);
  /* The date is a plain text field so it matches the other inputs exactly — a
     native date control brings its own furniture into a 36px row. It is still
     validated, and against the CALENDAR rather than the shape: the server
     silently re-dates anything it cannot parse, and silently accepts a date
     that rolls. See isCalendarDate. */
  const dateOk = isCalendarDate(shotAt.trim());
  const canSave = chargeOk && coalOk && dateOk && !saving;

  /* Live, in the prototype's order: COAL first, then the charge window. */
  const flags: Flag[] = [];
  if (coalMm !== null && Number.isFinite(coalMm) && cartridge.maxLengthMm != null) {
    const check = coalCheck(coalMm, cartridge.maxLengthMm);
    if (check.bad) flags.push({ t: check.t, warn: true });
  }
  if (Number.isFinite(chargeGr)) {
    /**
     * ⚠️ A TYPO AND AN OVERRUN ARE NOT THE SAME EVENT, AND THEY USED TO WEAR
     * THE SAME TAG. `356` typed for `35.6` — a missed decimal point on a phone
     * keypad — showed `ABOVE MAX 41.5`, exactly what a deliberate 0.2 gr walk
     * past the top of the window shows. Past half again the max there is no
     * reading of the number that is a work-up, so it says so louder and prints
     * the multiple, which is the fact that makes the mistake obvious.
     *
     * It still does not block Save. A log that refuses to hold what actually
     * went down the barrel is worse than useless — see the file header — and
     * that rule does not bend for a figure we merely think is unlikely.
     */
    if (chargeGr > row.maxGr * 1.5 && row.maxGr > 0) {
      flags.push({
        t: `CHECK THIS CHARGE · ${(chargeGr / row.maxGr).toFixed(1)}× the max`,
        warn: true,
      });
    }
    if (chargeGr > row.maxGr) flags.push({ t: `ABOVE MAX ${row.maxGr.toFixed(1)}`, warn: true });
    else if (chargeGr < row.startGr)
      flags.push({ t: `BELOW START ${row.startGr.toFixed(1)}`, warn: false });
  }
  const warned = flags.some((f) => f.warn);

  /* The flag strip keeps the prototype's 26px min-height so a tag appearing
     mid-typing does not shove Save down under the pointer. The safety line
     below it is the one thing allowed to add height, and only when something
     is actually out of the window. */

  function submit() {
    if (!canSave) return;
    const draft: LogDraft = {
      cartridgeKey: cartridge.key,
      bulletLabel,
      powderName: row.powder,
      chargeGr,
      coalMm,
      primer: primer.trim() || null,
      caseLabel: caseLabel.trim() || null,
      /* The row this came off, so a later screen can put the entry back
         against the load without matching on strings. */
      loadId: row.id,
      /* Measured at the range, not at the bench — the footer says as much. */
      velocityMs: null,
      groupMm: null,
      notes: null,
      shotAt: shotAt.trim(),
    };
    onSave(draft);
  }

  const coalHint =
    cartridge.maxLengthMm == null ? null : (
      <span
        className="num"
        style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
      >
        the maximum is {fmtLength(cartridge.maxLengthMm, units)}
      </span>
    );

  return (
    <OverlayShell
      variant={phone ? 'bottom-sheet' : 'modal'}
      labelledBy={titleId}
      onClose={onClose}
      style={
        phone
          ? undefined
          : {
              width: 'min(560px, calc(100vw - 32px))',
              display: 'flex',
              flexDirection: 'column',
            }
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: phone ? 10 : 12,
            padding: phone ? '4px 4px 8px 16px' : '18px 20px 12px',
            borderBottom: phone ? undefined : '0.5px solid var(--border-divider)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} className="head" style={{ fontSize: phone ? 18 : 20, margin: 0 }}>
              Log this load
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
              Based on the start charge of {row.startGr.toFixed(1)} gr. Your entry stays in your
              own log.
            </p>
          </div>
          <IconX onClick={onClose} label="Close" size={size} glyph={phone ? 18 : 16} />
        </div>

        <div
          className="scroll"
          style={{
            flex: 1,
            minHeight: 0,
            padding: phone ? '0 16px 8px' : '16px 20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: phone ? 10 : 12,
          }}
        >
          {phone ? (
            /* Two cells wide. A wrapper places it, rather than a class in
               bench.css — that file is not this cluster's to edit. */
            <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
              <Field label="Load" value={loadLabel} readOnly size={size} />
            </div>
          ) : (
            <>
              <Field label="Cartridge" value={cartridge.name} readOnly size={size} />
              <Field label="Bullet" value={bulletLabel} readOnly size={size} />
              <Field label="Powder" value={row.powder} readOnly size={size} />
            </>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <Field
              label="Charge, gr"
              value={charge}
              onChange={setCharge}
              numeric
              inputMode="decimal"
              size={size}
            />
            <ReadsAs typed={charge} value={chargeGr} unit="gr" />
          </div>

          {/* The hint sits under the input rather than inside Field, which
              takes a label and a value and nothing else. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <Field
              label="COAL, mm"
              value={coal}
              onChange={setCoal}
              numeric
              inputMode="decimal"
              size={size}
            />
            {coalMm !== null && <ReadsAs typed={coal} value={coalMm} unit="mm" />}
            {coalHint}
          </div>

          <Field
            label="Primer"
            value={primer}
            onChange={setPrimer}
            placeholder="e.g. CCI BR-2"
            size={size}
          />
          <Field
            label="Case"
            value={caseLabel}
            onChange={setCaseLabel}
            placeholder="e.g. Lapua, 3rd firing"
            size={size}
          />
          <div style={phone ? { gridColumn: 'span 2', minWidth: 0 } : { minWidth: 0 }}>
            <Field
              label="Date"
              value={shotAt}
              onChange={setShotAt}
              placeholder="YYYY-MM-DD"
              numeric
              inputMode="numeric"
              size={size}
            />
          </div>
        </div>

        {/* Announced as it changes: the tag text IS the warning, so a reader
            who never sees the gold still hears it. */}
        <div
          aria-live="polite"
          style={{
            padding: phone ? '10px 16px 0' : '0 20px 4px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 26 }}>
            {flags.map((f) => (
              <Tag key={f.t} warn={f.warn}>
                {f.t}
              </Tag>
            ))}
          </div>
          {/* The one safety line, shown where it earns its place: the moment a
              charge or a seating depth is outside the window. */}
          {warned && (
            <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: 0 }}>
              {SAFETY_LINE}
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            style={{
              padding: phone ? '6px 16px 0' : '4px 20px 0',
              margin: 0,
              fontSize: 12,
              color: 'var(--red)',
            }}
          >
            {error}
          </p>
        )}

        {phone ? (
          // Save is the last thing in the sheet, and on a notched iPhone the
          // home indicator sits over the bottom ~34px.
          <div style={{ padding: '10px 16px calc(28px + env(safe-area-inset-bottom))' }}>
            <Btn type="submit" red size={size} disabled={!canSave} style={{ width: '100%' }}>
              {saving ? 'Saving…' : 'Save to load log'}
            </Btn>
            <p
              style={{
                margin: '10px 0 0',
                fontSize: 11.5,
                color: 'var(--text-tertiary)',
                textAlign: 'center',
              }}
            >
              Results (velocity, group) are added after the range.
            </p>
          </div>
        ) : (
          <div
            style={{
              padding: '12px 20px 18px',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Btn type="submit" red disabled={!canSave}>
              {saving ? 'Saving…' : 'Save to load log'}
            </Btn>
            <Btn onClick={onClose}>Cancel</Btn>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              Results (velocity, group) are added after the range.
            </span>
          </div>
        )}
      </form>
    </OverlayShell>
  );
}
