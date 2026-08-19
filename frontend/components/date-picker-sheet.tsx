'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DayCell,
  Limits,
  MONTH_LABELS,
  MONTH_SHORT,
  WEEKDAY_INITIAL,
  WEEKDAY_SHORT,
  Ymd,
  clampDayToMonth,
  clampToLimits,
  dayDisabled,
  daysInMonth,
  decadeStartFor,
  decadeStrip,
  decadeYears,
  formatLong,
  limitsFrom,
  monthDisabled,
  monthGrid,
  sameYmd,
  toIso,
  todayYmd,
  weekdayIndex,
  yearDisabled,
  MAX_YEAR,
  MIN_YEAR,
} from '@/lib/date-picker-model';

// ────────────────────────────────────────────────────────────────────
// THE THREE-STEP DATE SHEET.
//
// Year, then month, then day — in that order, one page at a time, exactly as
// the operator asked for it. Step 1 is a page of TEN YEARS with an arrow to
// the previous and next ten.
//
// It is a bottom sheet rather than a popover on purpose: this is a PWA used
// one-handed on a phone, and a sheet puts every cell inside the thumb arc
// whatever the field's position on the page. Desktop gets the same panel,
// centred.
//
// ⚠️ Z-INDEX 121, NOT 60. The house rule is "anything floating is >= 60",
// which clears the bottom tab bar at 55. It does NOT clear every surface that
// can CONTAIN a date field: the admin modal shell is z-100 and holds one. The
// rule for this component is therefore "above everything that can contain a
// date field", which today means 100. If anybody builds a higher overlay with
// a date in it, this number has to move with it — the failure is silent.
//
// ⚠️ NO ring-* FOR FOCUS. Tailwind compiles ring utilities to box-shadow and
// globals.css has `* { box-shadow: none !important }`, so the app's own
// FOCUS_RING constant strips the browser outline and paints nothing in its
// place. Focus here is a real `outline`, which that rule cannot touch.
//
// ⚠️ THE KEYBOARD AND THE MOUSE MUST AGREE. Every guard the click path applies
// — range, disabled, page limits — the key handler applies too. Cells are
// aria-disabled rather than disabled so a screen-reader user can land on one
// and be TOLD it is unavailable; the price is that Enter reaches the handler,
// so the handler is where the refusal has to live.
// ────────────────────────────────────────────────────────────────────

const Z_SCRIM = 120;
const Z_PANEL = 121;

/** Every cell clears the 44px touch floor the rest of the app sets itself. */
const CELL_MIN = 44;

export type Step = 'year' | 'month' | 'day';

/**
 * Columns per step. The grid template, the row grouping and the up/down arrow
 * stride all read this, so they cannot drift apart in a later edit.
 */
const COLUMNS: Record<Step, number> = { year: 5, month: 3, day: 7 };

export interface DatePickerSheetProps {
  /** Seeds all three steps. null when nothing has been chosen yet. */
  value: Ymd | null;
  min?: string;
  max?: string;
  /** The decade page shown when there is NO value. Ignored when there is one. */
  focusYear?: number;
  /** 'far' adds a decade strip — a date of birth is forty years back. */
  reach?: 'near' | 'far';
  title: string;
  allowClear?: boolean;
  /** Strict ISO yyyy-mm-dd. Fires once, then the sheet closes. */
  onCommit: (iso: string) => void;
  onClear?: () => void;
  onClose: () => void;
  /** Said out loud to a screen reader. Owned by the caller so it survives close. */
  announce: (message: string) => void;
}

export default function DatePickerSheet({
  value,
  min,
  max,
  focusYear,
  reach = 'near',
  title,
  allowClear = false,
  onCommit,
  onClear,
  onClose,
  announce,
}: DatePickerSheetProps) {
  const lim = useMemo(() => limitsFrom(min, max), [min, max]);

  // Client-only: the sheet mounts on a tap, so reading the clock here cannot
  // produce a server/client mismatch. Frozen for the life of the sheet so a
  // midnight rollover cannot move the "today" ring mid-interaction.
  const [today] = useState<Ymd>(() => todayYmd());

  /**
   * The value, but only if this field would actually accept it.
   *
   * A stored date outside min/max — a birth date in a field whose ceiling has
   * since moved — must not seed the steps, or the crumbs show a year the grid
   * cannot reach and the month step opens with all twelve disabled and no way
   * forward. Out of range seeds nothing: the text box still shows the value,
   * and the sheet starts clean.
   */
  const seed = value && !dayDisabled(value, lim) ? value : null;
  const seedYear = clampYear(seed?.y ?? focusYear ?? today.y, lim);

  const [step, setStep] = useState<Step>('year');
  const [decade, setDecade] = useState(() => decadeStartFor(seedYear));
  const [year, setYear] = useState<number | null>(seed?.y ?? null);
  const [month, setMonth] = useState<number | null>(seed?.m ?? null);

  // The roving cursor: which cell has focus on each step. Separate from the
  // CHOSEN value, because moving the cursor must never commit anything.
  const [curY, setCurY] = useState(seedYear);
  const [curM, setCurM] = useState(seed?.m ?? today.m);
  const [curD, setCurD] = useState(seed?.d ?? 1);

  const panelRef = useRef<HTMLDivElement>(null);
  // A day tap commits AND closes. On a phone a fast double-tap can fire the
  // handler twice before React unmounts the button, which would emit onChange
  // twice and — in the motivation wizard — queue two autosaves.
  const committed = useRef(false);

  /**
   * ⚠️ THE CALLER'S HANDLERS LIVE IN A REF.
   *
   * onClose is an inline arrow at the call site, so it is a NEW function on
   * every render of the field. An effect depending on it re-runs every render
   * — and the history effect below cannot survive that: its cleanup calls
   * history.back() and its body calls pushState, so one re-render fires a
   * popstate that closes the sheet about 30ms after it opened. The screen-
   * reader announcer alone guarantees that re-render. So: read through a ref,
   * and let the effect mount exactly once.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (committed.current) return;
    onCloseRef.current();
  }, []);

  // ── open announcement ─────────────────────────────────────────────
  useEffect(() => {
    const where = `Showing ${decade} to ${decade + 9}.`;
    announce(
      value
        ? `${title}, currently ${formatLong(value)}. Choose a year. ${where}`
        : `${title}. Choose a year. ${where}`,
    );
    // Deliberately once, on open. Later announcements are fired by the
    // handlers that cause them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── escape, in the CAPTURE phase ──────────────────────────────────
  //
  // A picker opened inside the admin modal shell must not close the modal
  // underneath it — an operator would lose a half-filled deal form. Capture
  // runs before the modal's own bubbling listener, and stopPropagation keeps
  // it there.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      close();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [close]);

  // ── body scroll lock, SAVE AND RESTORE ────────────────────────────
  //
  // Never `= ''` on cleanup: this sheet can legitimately open on top of an
  // admin modal that has already locked the body, and resetting to empty
  // would unlock the page while that modal is still up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ── the Android back button closes the picker ─────────────────────
  //
  // In the installed PWA, hardware Back is the reflex for "get out of this".
  // Without an entry of our own it navigates away from the page and loses the
  // whole form. The existing state is spread so the App Router's own
  // bookkeeping survives the push.
  //
  // ⚠️ MOUNT-ONLY. See the note on onCloseRef: any dependency here that
  // changes identity turns this into a back()/pushState treadmill that closes
  // the sheet by itself.
  const popping = useRef(false);
  useEffect(() => {
    window.history.pushState(
      { ...(window.history.state ?? {}), ggDatePicker: true },
      '',
    );
    function onPop() {
      popping.current = true;
      if (!committed.current) onCloseRef.current();
    }
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Only unwind our own entry, and only if Back was not what closed us.
      if (!popping.current && window.history.state?.ggDatePicker) {
        window.history.back();
      }
    };
  }, []);

  /**
   * Focus follows the cursor — but only when the cursor is what moved.
   *
   * Without the flag, clicking a pager arrow changes `decade`, this fires, and
   * focus is yanked off the arrow onto a grid cell — so the arrow cannot be
   * pressed twice in a row by keyboard.
   */
  const wantFocus = useRef(true);
  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    panelRef.current?.querySelector<HTMLElement>('[data-cursor="1"]')?.focus();
  }, [step, curY, curM, curD, decade, year]);

  const grab = () => {
    wantFocus.current = true;
  };

  // ── choosing ──────────────────────────────────────────────────────

  const chooseYear = useCallback(
    (y: number) => {
      if (yearDisabled(y, lim)) {
        announce(`${y} is not available.`);
        return;
      }
      grab();
      setYear(y);
      setCurY(y);
      // The remembered month may be out of range in the new year.
      setCurM(firstEnabledMonth(y, curM, lim));
      setStep('month');
      announce(`${y} selected. Now choose a month.`);
    },
    [lim, curM, announce],
  );

  const chooseMonth = useCallback(
    (m: number) => {
      const y = year ?? curY;
      if (monthDisabled(y, m, lim)) {
        announce(`${MONTH_LABELS[m - 1]} ${y} is not available.`);
        return;
      }
      grab();
      setMonth(m);
      setCurM(m);
      // 31 January, then February: land the cursor on a day that EXISTS —
      // and, since min/max can rule out the start of a month, on one that can
      // actually be chosen. Clamping the CURSOR is not committing a date; the
      // day step still requires a tap.
      setCurD(landingDay(y, m, curD, lim));
      setStep('day');
      announce(
        `${MONTH_LABELS[m - 1]} ${y}. Now choose a day. ${daysInMonth(y, m)} days.`,
      );
    },
    [year, curY, curD, lim, announce],
  );

  const chooseDay = useCallback(
    (p: Ymd) => {
      // ⚠️ CHECKED HERE, not only on the cell. Cells are aria-disabled rather
      // than disabled, so a keyboard user can land on one and press Enter —
      // reaching this function without ever passing the click handler's guard.
      // Without this line an event date in the past, or an under-18 date of
      // birth, commits silently.
      if (dayDisabled(p, lim)) {
        announce(`${formatLong(p)} is not available.`);
        return;
      }
      if (committed.current) return;
      committed.current = true;
      announce(`${formatLong(p)} selected.`);
      onCommit(toIso(p));
    },
    [onCommit, announce, lim],
  );

  // ── stepping through the crumbs ───────────────────────────────────
  //
  // Jumping straight to the day step has to bring the cursor with it, or the
  // grid renders with no cell matching curD — no roving tabindex, no focus,
  // and the panel's key handler stops firing entirely.
  const goStep = useCallback(
    (s: Step) => {
      grab();
      if (s === 'day') {
        setCurD(landingDay(year ?? curY, month ?? curM, curD, lim));
      }
      setStep(s);
    },
    [year, curY, month, curM, curD, lim],
  );

  // ── paging ────────────────────────────────────────────────────────

  const pageDecade = useCallback(
    (delta: number) => {
      const next = decade + delta * 10;
      if (next + 9 < MIN_YEAR || next > MAX_YEAR) return;
      grab();
      setDecade(next);
      // ⚠️ THE CURSOR MUST LAND ON THIS PAGE. Clamping only by the field's
      // limits could leave curY outside the decade just paged to — and a grid
      // where no cell matches the cursor has no tabIndex=0 at all, so focus
      // falls to <body> and every key stops working.
      setCurY(landingYear(next, next + (curY - decade), lim));
      announce(`Showing ${next} to ${next + 9}.`);
    },
    [decade, curY, lim, announce],
  );

  const pageYear = useCallback(
    (delta: number) => {
      const y = (year ?? curY) + delta;
      if (y < MIN_YEAR || y > MAX_YEAR || yearDisabled(y, lim)) return;
      grab();
      setYear(y);
      setCurY(y);
      setDecade(decadeStartFor(y));
      setCurM(firstEnabledMonth(y, curM, lim));
      announce(`${y}.`);
    },
    [year, curY, curM, lim, announce],
  );

  const pageMonth = useCallback(
    (delta: number) => {
      const y = year ?? curY;
      let m = (month ?? curM) + delta;
      let ny = y;
      if (m < 1) {
        m = 12;
        ny -= 1;
      } else if (m > 12) {
        m = 1;
        ny += 1;
      }
      if (ny < MIN_YEAR || ny > MAX_YEAR || monthDisabled(ny, m, lim)) return;
      grab();
      setYear(ny);
      setMonth(m);
      setCurY(ny);
      setCurM(m);
      setDecade(decadeStartFor(ny));
      setCurD(landingDay(ny, m, curD, lim));
      announce(`${MONTH_LABELS[m - 1]} ${ny}, ${daysInMonth(ny, m)} days.`);
    },
    [year, month, curY, curM, curD, lim, announce],
  );

  const chosenYear = year ?? curY;
  const chosenMonth = month ?? curM;
  const page =
    step === 'year' ? pageDecade : step === 'month' ? pageYear : pageMonth;

  // ── keyboard ──────────────────────────────────────────────────────

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // ⚠️ ONLY THE GRID. This handler sits on the panel, so without the guard
      // pressing Enter on Cancel would activate the button AND commit the day
      // under the cursor.
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.('[role="gridcell"]')) return;

      const k = e.key;
      const cols = COLUMNS[step];
      const move = (fn: () => void) => {
        e.preventDefault();
        grab();
        fn();
      };
      const pageIfAllowed = (delta: number, fn: (d: number) => void) => {
        if (!pagerDisabled(step, decade, chosenYear, chosenMonth, delta, lim)) {
          fn(delta);
        }
      };

      if (step === 'year') {
        if (k === 'ArrowLeft') return move(() => shiftYearCursor(-1));
        if (k === 'ArrowRight') return move(() => shiftYearCursor(1));
        if (k === 'ArrowUp') return move(() => shiftYearCursor(-cols));
        if (k === 'ArrowDown') return move(() => shiftYearCursor(cols));
        if (k === 'Home')
          return move(() => setCurY(landingYear(decade, decade, lim)));
        if (k === 'End')
          return move(() => setCurY(landingYear(decade, decade + 9, lim)));
        if (k === 'PageUp') return move(() => pageIfAllowed(-1, pageDecade));
        if (k === 'PageDown') return move(() => pageIfAllowed(1, pageDecade));
        if (k === 'Enter' || k === ' ') return move(() => chooseYear(curY));
        return;
      }

      if (step === 'month') {
        if (k === 'ArrowLeft') return move(() => shiftMonthCursor(-1));
        if (k === 'ArrowRight') return move(() => shiftMonthCursor(1));
        if (k === 'ArrowUp') return move(() => shiftMonthCursor(-cols));
        if (k === 'ArrowDown') return move(() => shiftMonthCursor(cols));
        if (k === 'Home') return move(() => setCurM(1));
        if (k === 'End') return move(() => setCurM(12));
        if (k === 'PageUp') return move(() => pageIfAllowed(-1, pageYear));
        if (k === 'PageDown') return move(() => pageIfAllowed(1, pageYear));
        if (k === 'Enter' || k === ' ') return move(() => chooseMonth(curM));
        if (k === 'Backspace') return move(() => goStep('year'));
        return;
      }

      // day — seven across, so up/down is a week.
      if (k === 'ArrowLeft') return move(() => shiftDayCursor(-1));
      if (k === 'ArrowRight') return move(() => shiftDayCursor(1));
      if (k === 'ArrowUp') return move(() => shiftDayCursor(-cols));
      if (k === 'ArrowDown') return move(() => shiftDayCursor(cols));
      if (k === 'Home') return move(() => setCurD(1));
      if (k === 'End')
        return move(() => setCurD(daysInMonth(chosenYear, chosenMonth)));
      if (k === 'PageUp') return move(() => pageIfAllowed(-1, pageMonth));
      if (k === 'PageDown') return move(() => pageIfAllowed(1, pageMonth));
      if (k === 'Enter' || k === ' ')
        return move(() => chooseDay({ y: chosenYear, m: chosenMonth, d: curD }));
      if (k === 'Backspace') return move(() => goStep('month'));

      function shiftYearCursor(delta: number) {
        const next = curY + delta;
        if (next < MIN_YEAR || next > MAX_YEAR) return;
        // Running off the page turns the page, so the cursor is never trapped.
        if (next < decade || next > decade + 9) setDecade(decadeStartFor(next));
        setCurY(next);
      }
      function shiftMonthCursor(delta: number) {
        const next = curM + delta;
        if (next < 1 || next > 12) return;
        setCurM(next);
      }
      function shiftDayCursor(delta: number) {
        const next = curD + delta;
        if (next < 1 || next > daysInMonth(chosenYear, chosenMonth)) return;
        setCurD(next);
      }
    },
    [
      step,
      curY,
      curM,
      curD,
      decade,
      chosenYear,
      chosenMonth,
      lim,
      chooseYear,
      chooseMonth,
      chooseDay,
      goStep,
      pageDecade,
      pageYear,
      pageMonth,
    ],
  );

  // ── a soft focus trap ─────────────────────────────────────────────
  //
  // The first in this codebase, and justified: this is an arrow-key grid over
  // a scrim, and a Tab that lands in the page behind is unrecoverable for
  // somebody who cannot see that the sheet is still up.
  const onTrapKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const strip = reach === 'far' ? decadeStrip(lim, seedYear) : [];

  const body = (
    <>
      <div
        aria-hidden="true"
        onClick={close}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: Z_SCRIM,
          background: 'rgba(0,0,0,0.62)',
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Focusable, so the panel itself can hold focus. Without it a tap on
        // the sheet's own padding sends focus to <body> and the key handler
        // stops firing — every arrow, Enter and Tab dead until the user
        // guesses to click a cell.
        tabIndex={-1}
        // ...and this stops that happening at all: a press on dead space never
        // takes focus away from wherever it already is.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) e.preventDefault();
        }}
        // Stands the Ask Boet dock down while the sheet is up — otherwise it
        // floats in the bottom-right corner over the day grid.
        data-blocking-overlay="true"
        onKeyDown={(e) => {
          onTrapKey(e);
          onKeyDown(e);
        }}
        className="gg-datesheet"
        style={{
          position: 'fixed',
          zIndex: Z_PANEL,
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-hover)',
          padding: 12,
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        }}
      >
        {/* The grab bar. Purely a "this is a sheet" affordance on a phone. */}
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: 'var(--border-hover)',
            margin: '0 auto 10px',
          }}
          className="sm:hidden"
        />

        <Header
          title={title}
          step={step}
          year={year}
          month={month}
          decade={decade}
          chosenYear={chosenYear}
          chosenMonth={chosenMonth}
          onStep={goStep}
          onPage={page}
          onClose={close}
          lim={lim}
        />

        {step === 'year' && (
          <>
            {strip.length > 1 && (
              <DecadeStrip
                decades={strip}
                current={decade}
                onPick={(d) => {
                  grab();
                  setDecade(d);
                  setCurY(landingYear(d, d, lim));
                  announce(`Showing ${d} to ${d + 9}.`);
                }}
              />
            )}
            <YearGrid
              decade={decade}
              cursor={curY}
              chosen={year}
              today={today}
              lim={lim}
              onPick={chooseYear}
            />
          </>
        )}

        {step === 'month' && (
          <MonthGrid
            year={chosenYear}
            cursor={curM}
            chosen={month}
            today={today}
            lim={lim}
            onPick={chooseMonth}
          />
        )}

        {step === 'day' && (
          <DayGrid
            year={chosenYear}
            month={chosenMonth}
            cursor={curD}
            // The SEED, not the raw value: a stored date this field would
            // refuse must not be painted as the current selection.
            selected={seed}
            today={today}
            lim={lim}
            onPick={chooseDay}
          />
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 12,
            alignItems: 'center',
          }}
        >
          {allowClear && (
            <FooterButton
              onClick={() => {
                if (committed.current) return;
                committed.current = true;
                announce('Date cleared.');
                onClear?.();
              }}
            >
              Clear
            </FooterButton>
          )}
          <div style={{ flex: 1 }} />
          <FooterButton
            onClick={() => {
              announce('Cancelled. No date chosen.');
              close();
            }}
          >
            Cancel
          </FooterButton>
        </div>

        <p
          style={{
            margin: '10px 2px 0',
            fontSize: 12,
            color: 'var(--text-tertiary-on-card)',
          }}
        >
          {step === 'year'
            ? 'Choose the year first, then the month, then the day.'
            : step === 'month'
              ? 'Now the month.'
              : 'Now the day. Tapping a day saves it.'}
        </p>
      </div>
    </>
  );

  return createPortal(body, document.body);
}

// ────────────────────────────────────────────────────────────────────
// PARTS
// ────────────────────────────────────────────────────────────────────

function Header({
  title,
  step,
  year,
  month,
  decade,
  chosenYear,
  chosenMonth,
  onStep,
  onPage,
  onClose,
  lim,
}: {
  title: string;
  step: Step;
  year: number | null;
  month: number | null;
  decade: number;
  chosenYear: number;
  chosenMonth: number;
  onStep: (s: Step) => void;
  onPage: (delta: number) => void;
  onClose: () => void;
  lim: Limits;
}) {
  // The pager always names the PARENT unit of the current step, so picking the
  // wrong year is a nudge rather than a round trip back through the sequence.
  const pageLabel =
    step === 'year'
      ? `${decade}–${decade + 9}`
      : step === 'month'
        ? String(chosenYear)
        : `${MONTH_LABELS[chosenMonth - 1]} ${chosenYear}`;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <p
          style={{
            flex: 1,
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close without choosing a date"
          className="gg-datecell"
          style={{
            width: CELL_MIN,
            height: CELL_MIN,
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border)',
            background: 'var(--bg-inset)',
            color: 'var(--text-primary)',
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* CRUMBS. Back-navigation that doubles as "where am I in the three
          steps" — the one question a sequential picker has to keep answering. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 10,
          fontSize: 14,
        }}
      >
        <Crumb
          label={year === null ? 'Year' : String(year)}
          done={year !== null}
          active={step === 'year'}
          onClick={() => onStep('year')}
        />
        <Chevron />
        <Crumb
          label={month === null ? 'Month' : MONTH_SHORT[month - 1]}
          done={month !== null}
          active={step === 'month'}
          onClick={() => {
            if (year !== null) onStep('month');
          }}
          disabled={year === null}
        />
        <Chevron />
        <Crumb
          label="Day"
          done={false}
          active={step === 'day'}
          onClick={() => {
            if (month !== null) onStep('day');
          }}
          disabled={month === null}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <PagerArrow
          dir="prev"
          onClick={() => onPage(-1)}
          label={
            step === 'year'
              ? 'Previous ten years'
              : step === 'month'
                ? 'Previous year'
                : 'Previous month'
          }
          disabled={pagerDisabled(step, decade, chosenYear, chosenMonth, -1, lim)}
        />
        <p
          className="gg-nums"
          style={{
            flex: 1,
            margin: 0,
            textAlign: 'center',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {pageLabel}
        </p>
        <PagerArrow
          dir="next"
          onClick={() => onPage(1)}
          label={
            step === 'year'
              ? 'Next ten years'
              : step === 'month'
                ? 'Next year'
                : 'Next month'
          }
          disabled={pagerDisabled(step, decade, chosenYear, chosenMonth, 1, lim)}
        />
      </div>
    </>
  );
}

function Chevron() {
  return (
    <span aria-hidden="true" style={{ color: 'var(--text-tertiary-on-card)' }}>
      ›
    </span>
  );
}

function Crumb({
  label,
  done,
  active,
  onClick,
  disabled,
}: {
  label: string;
  done: boolean;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={disabled ? 'true' : undefined}
      aria-current={active ? 'step' : undefined}
      className="gg-datecell"
      style={{
        minHeight: 34,
        padding: '4px 10px',
        borderRadius: 'var(--r-sm)',
        fontSize: 14,
        fontWeight: active ? 600 : 400,
        // Both set explicitly, every state — nothing inherited.
        background: active ? 'var(--gold-wash)' : 'transparent',
        color: disabled
          ? 'var(--text-tertiary-on-card)'
          : done || active
            ? 'var(--text-primary)'
            : 'var(--text-secondary)',
        border: active ? '1px solid var(--gold-line)' : '1px solid transparent',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function PagerArrow({
  dir,
  onClick,
  label,
  disabled,
}: {
  dir: 'prev' | 'next';
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      // aria-disabled, NOT disabled: a disabled button is invisible to
      // keyboard navigation, so somebody arrowing through would silently skip
      // the arrow and never learn why the decade will not move.
      aria-disabled={disabled ? 'true' : undefined}
      aria-label={disabled ? `${label} — not available` : label}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className="gg-datecell"
      style={{
        width: CELL_MIN,
        height: CELL_MIN,
        flexShrink: 0,
        borderRadius: 'var(--r-sm)',
        border: `1px solid ${disabled ? 'var(--border-divider)' : 'var(--border)'}`,
        background: 'var(--bg-inset)',
        color: disabled ? 'var(--text-tertiary-on-card)' : 'var(--text-primary)',
        fontSize: 18,
        lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {dir === 'prev' ? '‹' : '›'}
    </button>
  );
}

function DecadeStrip({
  decades,
  current,
  onPick,
}: {
  decades: number[];
  current: number;
  onPick: (d: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  // SCROLL TO WHERE THEY ARE. The strip runs from the 1900s, so a date-of-
  // birth field opened at 1986 otherwise shows the 1900s and the member has to
  // scroll right to find the decade the grid below is already showing.
  useEffect(() => {
    const chip = railRef.current?.querySelector<HTMLElement>('[data-on="1"]');
    if (!chip || !railRef.current) return;
    railRef.current.scrollLeft =
      chip.offsetLeft - railRef.current.clientWidth / 2 + chip.clientWidth / 2;
  }, [current]);

  return (
    <div
      ref={railRef}
      style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        paddingBottom: 8,
        marginBottom: 4,
      }}
    >
      {decades.map((d) => {
        const on = d === current;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            aria-pressed={on}
            data-on={on ? '1' : undefined}
            className="gg-datecell gg-nums"
            style={{
              flexShrink: 0,
              minHeight: 36,
              padding: '6px 12px',
              borderRadius: 'var(--r-sm)',
              fontSize: 14,
              background: on ? 'var(--gold-wash)' : 'var(--bg-inset)',
              color: 'var(--text-primary)',
              border: `1px solid ${on ? 'var(--gold-line)' : 'var(--border)'}`,
            }}
          >
            {d}s
          </button>
        );
      })}
    </div>
  );
}

function YearGrid({
  decade,
  cursor,
  chosen,
  today,
  lim,
  onPick,
}: {
  decade: number;
  cursor: number;
  chosen: number | null;
  today: Ymd;
  lim: Limits;
  onPick: (y: number) => void;
}) {
  return (
    <Grid label="Year" columns={COLUMNS.year}>
      {decadeYears(decade).map((y) => {
        const off = yearDisabled(y, lim);
        return (
          <Cell
            key={y}
            label={String(y)}
            isCursor={y === cursor}
            selected={chosen === y}
            today={y === today.y}
            disabled={off}
            // "this year" lives in the accessible NAME, not only in the gold
            // ring — a ring is invisible to a screen reader.
            ariaLabel={`${y}${y === today.y ? ', this year' : ''}${
              off ? ', not available' : ''
            }`}
            onPick={() => onPick(y)}
          />
        );
      })}
    </Grid>
  );
}

function MonthGrid({
  year,
  cursor,
  chosen,
  today,
  lim,
  onPick,
}: {
  year: number;
  cursor: number;
  chosen: number | null;
  today: Ymd;
  lim: Limits;
  onPick: (m: number) => void;
}) {
  return (
    <Grid label="Month" columns={COLUMNS.month}>
      {MONTH_LABELS.map((name, i) => {
        const m = i + 1;
        // "August is not today's month in 1994" — today only rings when the
        // page is actually showing today's year.
        const isToday = year === today.y && m === today.m;
        const off = monthDisabled(year, m, lim);
        return (
          <Cell
            key={m}
            label={MONTH_SHORT[i]}
            isCursor={m === cursor}
            selected={chosen === m}
            today={isToday}
            disabled={off}
            ariaLabel={`${name} ${year}${isToday ? ', this month' : ''}${
              off ? ', not available' : ''
            }`}
            onPick={() => onPick(m)}
          />
        );
      })}
    </Grid>
  );
}

function DayGrid({
  year,
  month,
  cursor,
  selected,
  today,
  lim,
  onPick,
}: {
  year: number;
  month: number;
  cursor: number;
  selected: Ymd | null;
  today: Ymd;
  lim: Limits;
  onPick: (p: Ymd) => void;
}) {
  const cells: DayCell[] = monthGrid(year, month, lim);
  return (
    <div>
      <div
        aria-hidden="true"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS.day}, 1fr)`,
          gap: 4,
          marginBottom: 4,
        }}
      >
        {WEEKDAY_INITIAL.map((w, i) => (
          <span
            key={WEEKDAY_SHORT[i]}
            style={{
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--text-tertiary-on-card)',
            }}
          >
            {w}
          </span>
        ))}
      </div>
      <Grid label="Day" columns={COLUMNS.day}>
        {cells.map((c, i) => {
          if (c.date === null) {
            return <div key={`blank-${i}`} role="gridcell" aria-hidden="true" />;
          }
          const d = c.date;
          const isToday = d.y === today.y && d.m === today.m && d.d === today.d;
          return (
            <Cell
              key={toIso(d)}
              label={String(d.d)}
              isCursor={d.d === cursor}
              selected={sameYmd(selected, d)}
              today={isToday}
              disabled={c.disabled}
              ariaLabel={`${WEEKDAY_SHORT[weekdayIndex(d)]} ${formatLong(d)}${
                isToday ? ', today' : ''
              }${c.disabled ? ', not available' : ''}`}
              onPick={() => onPick(d)}
            />
          );
        })}
      </Grid>
    </div>
  );
}

/**
 * A real grid, with rows.
 *
 * ⚠️ role="gridcell" goes on the CELL, never on the button inside it — putting
 * it on the button overrides the button role and a screen-reader user stops
 * being told the thing is pressable. And gridcells must sit inside a
 * role="row", or the grid exposes no structure at all; `display: contents`
 * gives us the rows without disturbing the CSS grid.
 */
function Grid({
  label,
  columns,
  children,
}: {
  label: string;
  columns: number;
  children: React.ReactNode;
}) {
  const cells = (Array.isArray(children) ? children.flat() : [children]) as React.ReactNode[];
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < cells.length; i += columns) {
    rows.push(cells.slice(i, i + columns));
  }
  return (
    <div
      role="grid"
      aria-label={label}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 4,
      }}
    >
      {rows.map((row, i) => (
        <div key={i} role="row" style={{ display: 'contents' }}>
          {row}
        </div>
      ))}
    </div>
  );
}

function Cell({
  label,
  isCursor,
  selected,
  today,
  disabled,
  ariaLabel,
  onPick,
}: {
  label: string;
  isCursor: boolean;
  selected: boolean;
  today: boolean;
  disabled: boolean;
  ariaLabel: string;
  onPick: () => void;
}) {
  return (
    <div role="gridcell" aria-selected={selected || undefined}>
      <button
        type="button"
        // Roving tabindex: exactly one cell is in the tab order, and the arrow
        // keys move it. Tab leaves the grid rather than walking 42 buttons.
        tabIndex={isCursor ? 0 : -1}
        data-cursor={isCursor ? '1' : undefined}
        aria-label={ariaLabel}
        aria-disabled={disabled ? 'true' : undefined}
        aria-current={today ? 'date' : undefined}
        // The selection is not conveyed by the red fill alone.
        aria-pressed={selected || undefined}
        onClick={() => {
          if (!disabled) onPick();
        }}
        className="gg-datecell gg-nums"
        style={{
          width: '100%',
          minHeight: CELL_MIN,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--r-sm)',
          fontSize: 16,
          fontWeight: selected ? 600 : 400,
          cursor: disabled ? 'default' : 'pointer',
          // Background AND colour on every branch. Nothing inherited, and
          // nothing dimmed by opacity — an unavailable day is signalled by
          // losing its border and its hover, not by being hard to read.
          background: selected ? 'var(--red)' : 'var(--bg-inset)',
          color: selected
            ? '#ffffff'
            : disabled
              ? 'var(--text-tertiary-on-card)'
              : today
                ? 'var(--gold)'
                : 'var(--text-primary)',
          border: selected
            ? '1px solid var(--red)'
            : today
              ? '1px solid var(--gold-line)'
              : `1px solid ${disabled ? 'transparent' : 'var(--border)'}`,
        }}
      >
        {label}
      </button>
    </div>
  );
}

function FooterButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="gg-datecell"
      style={{
        minHeight: CELL_MIN,
        padding: '0 16px',
        borderRadius: 'var(--r-sm)',
        border: '1px solid var(--border)',
        background: 'var(--bg-inset)',
        color: 'var(--text-primary)',
        fontSize: 14,
      }}
    >
      {children}
    </button>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function clampYear(y: number, lim: Limits): number {
  let out = Math.min(Math.max(y, MIN_YEAR), MAX_YEAR);
  if (lim.min && out < lim.min.y) out = lim.min.y;
  if (lim.max && out > lim.max.y) out = lim.max.y;
  return out;
}

/**
 * A year the cursor can actually sit on, ON THE GIVEN PAGE.
 *
 * A grid where no cell matches the cursor has no tabIndex=0 at all, so focus
 * falls out of the panel and every key stops working. Preferring an ENABLED
 * year is a bonus; staying on the page is the requirement.
 */
function landingYear(pageStart: number, preferred: number, lim: Limits): number {
  const inPage = Math.min(Math.max(preferred, pageStart), pageStart + 9);
  if (!yearDisabled(inPage, lim)) return inPage;
  const enabled = decadeYears(pageStart).find((y) => !yearDisabled(y, lim));
  return enabled ?? inPage;
}

/** A day that both EXISTS in the month and is inside the field's range. */
function landingDay(
  y: number,
  m: number,
  preferred: number,
  lim: Limits,
): number {
  const exists = clampDayToMonth(y, m, preferred);
  if (!dayDisabled(exists, lim)) return exists.d;
  const pulled = clampToLimits(exists, lim);
  // clampToLimits can move into another month; only take its day when it did not.
  if (pulled.y === y && pulled.m === m) return pulled.d;
  const total = daysInMonth(y, m);
  for (let d = 1; d <= total; d++) {
    if (!dayDisabled({ y, m, d }, lim)) return d;
  }
  return exists.d;
}

/** The remembered month may not exist in the newly chosen year's range. */
function firstEnabledMonth(y: number, preferred: number, lim: Limits): number {
  if (!monthDisabled(y, preferred, lim)) return preferred;
  for (let m = 1; m <= 12; m++) if (!monthDisabled(y, m, lim)) return m;
  return preferred;
}

function pagerDisabled(
  step: Step,
  decade: number,
  year: number,
  month: number,
  delta: number,
  lim: Limits,
): boolean {
  if (step === 'year') {
    const next = decade + delta * 10;
    if (next + 9 < MIN_YEAR || next > MAX_YEAR) return true;
    // Every year on the next page is out of range, so the page is useless.
    return decadeYears(next).every((y) => yearDisabled(y, lim));
  }
  if (step === 'month') {
    const nextYear = year + delta;
    if (nextYear < MIN_YEAR || nextYear > MAX_YEAR) return true;
    return yearDisabled(nextYear, lim);
  }
  // day — the pager walks whole months, and may cross a year boundary.
  let m = month + delta;
  let y = year;
  if (m < 1) {
    m = 12;
    y -= 1;
  } else if (m > 12) {
    m = 1;
    y += 1;
  }
  if (y < MIN_YEAR || y > MAX_YEAR) return true;
  return monthDisabled(y, m, lim);
}
