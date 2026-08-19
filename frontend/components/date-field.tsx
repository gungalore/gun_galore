'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import DatePickerSheet from './date-picker-sheet';
import {
  dayDisabled,
  formatLong,
  limitsFrom,
  parseIso,
  parseLoose,
  toIso,
} from '@/lib/date-picker-model';

// ────────────────────────────────────────────────────────────────────
// A DATE FIELD.
//
// A text box you can type into, and a calendar button that opens the
// three-step sheet — year, then month, then day.
//
// ⚠️ WHY THE NATIVE <input type="date"> IS GONE. Three reasons, in order:
//
//   1. Keeping it would put TWO pickers on one field. Tapping the box would
//      open the browser's own calendar and tapping the button would open ours.
//   2. The native picker paints in the BROWSER's colour scheme. Ten of the
//      eleven date inputs on this site never set colorScheme, so the popup and
//      its dd/mm/yyyy placeholders render light-on-light against --bg-inset —
//      the same "I can't read the dropdown menus" complaint, different widget.
//   3. Native date typing is segment-based: the caret jumps dd → mm → yyyy on
//      its own as you type. That is the never-move-a-field-mid-keystroke rule
//      being broken by the browser vendor.
//
// ⚠️ THE COMMIT CONTRACT. onChange fires with a COMPLETE strict yyyy-mm-dd, or
// with '', and with nothing else, ever. Half-typed text lives in local draft
// state and is never emitted. This is load-bearing: the motivation wizard
// autosaves every string it is given, its DTO validates nothing, and on the
// next load any non-empty answer gets locked behind the edit pen. A control
// that emitted "2026-08-" would bury corruption one tap deep.
// ────────────────────────────────────────────────────────────────────

export interface DateFieldProps {
  /** Strict yyyy-mm-dd, or ''. An unparseable legacy value is shown verbatim. */
  value: string;
  /** ONLY ever a complete yyyy-mm-dd or ''. Never partial, never a Date. */
  onChange: (value: string) => void;
  /** Names the field to a screen reader and titles the sheet. */
  label: string;
  min?: string;
  max?: string;
  /** The decade page shown when there is no value yet. Default: this year. */
  focusYear?: number;
  /** 'far' adds a decade strip — for a date of birth, forty years back. */
  reach?: 'near' | 'far';
  allowClear?: boolean;
  /** Warning border only. Never the background, never the text colour. */
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
  'aria-describedby'?: string;
  /**
   * BOTH are merged onto the text box, because this repo has two live styling
   * conventions — Tailwind class strings in the member surfaces, inline
   * CSSProperties in the admin ones — and a shared control has to serve both.
   */
  className?: string;
  style?: React.CSSProperties;
}

export default function DateField({
  value,
  onChange,
  label,
  min,
  max,
  focusYear,
  reach = 'near',
  allowClear = false,
  invalid = false,
  disabled = false,
  required = false,
  id,
  name,
  placeholder = 'yyyy-mm-dd',
  'aria-describedby': describedBy,
  className,
  style,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  /**
   * What is wrong with what they typed, once they have finished typing it.
   *
   * ⚠️ THE BOX AND THE FORM CAN DISAGREE. onChange only emits a whole, real,
   * in-range date, so a member who types "19/8/202" leaves the box showing one
   * thing while the form still holds the previous value — and on the Licence
   * Centre they could then press "That date is right" and save the OLD date.
   * Silence there is the bug; this message is the fix. Set on blur, never
   * mid-keystroke.
   */
  const [typedError, setTypedError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const autoId = useId();
  const fieldId = id ?? `date-${autoId}`;

  // ⚠️ THE CONTROLLED-INPUT FIGHT. Syncing a parent value into an input the
  // member is actively typing in freezes the box after one character — this
  // codebase has already paid for that lesson once, in address-autocomplete.
  // The activeElement guard is what stops it: while the box has focus the
  // draft is the member's, and the parent does not get to overwrite it.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setDraft(value);
  }, [value]);

  /**
   * The screen-reader announcer lives HERE, not in the sheet.
   *
   * The most important thing this control ever says — "19 August 2026
   * selected" — is said at the exact moment the sheet unmounts. A live region
   * inside the sheet would be removed in the same commit that fills it, and
   * assistive tech would announce it unreliably or not at all.
   */
  const announce = useCallback((message: string) => {
    setSaid('');
    // A repeated identical string is not re-announced, so break it first.
    window.setTimeout(() => setSaid(message), 30);
  }, []);

  const commit = useCallback(
    (iso: string) => {
      setDraft(iso);
      setTypedError(null);
      onChange(iso);
      setOpen(false);
      // Focus lands on the button that opened the sheet, never on the text
      // box — refocusing the box would pop the keyboard back up on Android
      // the instant the member finished.
      window.setTimeout(() => buttonRef.current?.focus(), 0);
    },
    [onChange],
  );

  /**
   * The caller's OUTER SPACING belongs to the row, not to the text box.
   *
   * Every className call site here inherits a control string that opens with
   * `mt-1` — written when the field was a lone <input>. Left on the box, it
   * offsets only half of a two-part control: the box sits 4px lower and the
   * flex row stretches the calendar button to match, so the two halves are
   * visibly different heights. Margin utilities move out to the wrapper;
   * everything else stays on the box.
   */
  const [rowClass, boxClass] = splitMargins(className);

  const parsed = parseIso(value);
  // A value the strict parser cannot read is legacy data, not nothing. Show it
  // verbatim rather than blanking somebody's answer behind a pretty format.
  const unreadable = value.trim() !== '' && !parsed;

  return (
    <>
      <div
        className={rowClass || undefined}
        style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}
      >
        <input
          ref={inputRef}
          id={fieldId}
          name={name}
          type="text"
          autoComplete="off"
          // Deliberately NOT inputMode="numeric": a numeric keypad on Android
          // has no reliable "-" or "/", and this box needs separators.
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          required={required}
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={invalid || unreadable || typedError ? 'true' : undefined}
          // gg-datecell is appended, never replaced. Several callers pass a
          // class string containing `focus:outline-none` — written for a
          // native input that had its own styling — which would otherwise
          // leave this box with NO focus indicator at all. The rule lives at
          // the end of globals.css, so at equal specificity it wins on source
          // order.
          className={['gg-datecell', boxClass].filter(Boolean).join(' ')}
          // ⚠️ THE BOX PAINTS ITSELF. A bare <input> inherits the browser's
          // WHITE background and its own light placeholder colour — which is
          // the operator's "I can't read anything on a white background"
          // complaint, arriving by default rather than by mistake. The
          // caller's own style still wins: it is spread last.
          style={{
            flex: 1,
            minWidth: 0,
            width: '100%',
            minHeight: 44,
            borderRadius: 'var(--r-sm)',
            border: `1px solid ${
              invalid || unreadable || typedError
                ? 'var(--warning)'
                : 'var(--border)'
            }`,
            background: 'var(--bg-inset)',
            color: 'var(--text-primary)',
            padding: '0 10px',
            fontSize: 15,
            ...style,
          }}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            setTypedError(null);
            if (next.trim() === '') {
              onChange('');
              return;
            }
            // Emitted the moment it is a whole, real, ALLOWED date — and not
            // before. The range is checked here as well as in the sheet: the
            // box would otherwise be a way round the field's own min and max.
            const p = parseLoose(next);
            if (p && !dayDisabled(p, limitsFrom(min, max))) onChange(toIso(p));
          }}
          onBlur={() => {
            const text = draft.trim();
            if (text === '') {
              setTypedError(null);
              return;
            }
            const p = parseLoose(text);
            if (!p) {
              setTypedError(
                'We cannot read that as a date. Use the calendar, or type it as yyyy-mm-dd.',
              );
              return;
            }
            if (dayDisabled(p, limitsFrom(min, max))) {
              setTypedError(
                `${formatLong(p)} is not one this field will take. Use the calendar to see what is available.`,
              );
              return;
            }
            // NORMALISE ON BLUR, never mid-keystroke. en-ZA writes 19/08/2026
            // and the wire wants 2026-08-19; rewriting the box as the member
            // leaves it makes our reading of an ambiguous date — 05/06/2026 is
            // 5 June here — visible immediately rather than at reminder time.
            setTypedError(null);
            setDraft(toIso(p));
          }}
        />
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={
            parsed
              ? `${label}: ${formatLong(parsed)}. Open the calendar.`
              : `${label}. Open the calendar.`
          }
          className="gg-datecell"
          style={{
            flexShrink: 0,
            width: 44,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--r-sm)',
            border: `1px solid ${invalid ? 'var(--warning)' : 'var(--border)'}`,
            background: 'var(--bg-inset)',
            color: 'var(--text-primary)',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          <CalendarIcon />
        </button>
      </div>

      {(typedError || unreadable) && (
        <p style={{ marginTop: 4, fontSize: 12, color: 'var(--warning)' }}>
          {typedError ??
            'We cannot read the saved value as a date. Use the calendar, or type it as yyyy-mm-dd.'}
        </p>
      )}

      {/* Mounted always, so what it says survives the sheet closing. Clipped
          rather than display:none — some screen readers skip the latter. */}
      <span
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {said}
      </span>

      {open && (
        <DatePickerSheet
          value={parsed}
          min={min}
          max={max}
          focusYear={focusYear}
          reach={reach}
          title={label}
          allowClear={allowClear}
          announce={announce}
          onCommit={commit}
          onClear={() => {
            setDraft('');
            setTypedError(null);
            onChange('');
            setOpen(false);
            window.setTimeout(() => buttonRef.current?.focus(), 0);
          }}
          onClose={() => {
            setOpen(false);
            window.setTimeout(() => buttonRef.current?.focus(), 0);
          }}
        />
      )}
    </>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/**
 * Split a Tailwind class string into [margin utilities, everything else].
 *
 * Deliberately margins only — padding, colour, borders and type all describe
 * the box itself and must stay on it.
 */
const MARGIN_UTILITY = /^-?m[trblxy]?-/;
function splitMargins(className?: string): [string, string] {
  if (!className) return ['', ''];
  const outer: string[] = [];
  const inner: string[] = [];
  for (const c of className.split(/\s+/).filter(Boolean)) {
    (MARGIN_UTILITY.test(c) ? outer : inner).push(c);
  }
  return [outer.join(' '), inner.join(' ')];
}
