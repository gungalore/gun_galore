'use client';

/**
 * THE BENCH — the shared building blocks.
 *
 * A tag, a chip, a pill row, a button, a close cross, a labelled input, a
 * backdrop, and the one overlay wrapper. Every other component in the module
 * composes from these, which is the point: the five overlays do not each
 * re-invent Escape, the focus trap and the return of focus and get them subtly
 * different from one another.
 *
 * bench.css already carries the LOOK. What lives here is the behaviour and the
 * accessibility — and the phone's touch sizes, which bench.css has no media
 * query for (see the note on BenchSize below).
 *
 * ⚠️ NO COLOUR IS WRITTEN IN THIS FILE. Every visual value is either a
 * bench.css class or a globals.css token through var(). The inline numbers are
 * arithmetic — heights, radii, gaps — quoted from the two prototypes.
 */
import * as React from 'react';
import { useScrollLock } from '@/lib/use-scroll-lock';

/* ── Shared bits ────────────────────────────────────────────────────── */

/**
 * Layout effect in the browser, plain effect on the server.
 *
 * An entrance has to be attached BEFORE the browser paints the element it
 * animates. `useEffect` runs after paint, so the panel shows for one frame at
 * its resting position and then snaps back to the start of the keyframes.
 * Same guard, for the same reason, as the one in Toast.tsx.
 */
const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Which board a control is drawn from.
 *
 * bench.css draws the DESKTOP control — a 34px button, a 28px chip, a 36px
 * input — because that is what `Main.dc.html` specifies. `Pwa.dc.html` draws
 * the same controls at the 44px touch sizes §9 requires, and the stylesheet
 * carries no breakpoint for them, so the phone's numbers are applied inline
 * per control by the component that knows it is on a phone. Same spelling as
 * `CartridgeThumbProps.size` in contract.ts, deliberately.
 */
export type BenchSize = 'desktop' | 'mobile';

/** Joins class names, dropping the falsey ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ── Icons ──────────────────────────────────────────────────────────── */

function IconPlus() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconCross({ px }: { px: number }) {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/* ── Tag ────────────────────────────────────────────────────────────── */

export interface TagProps {
  children: React.ReactNode;
  /** The caution read — the COAL flags. Gold, never red: red is the CTA. */
  warn?: boolean;
  className?: string;
  title?: string;
}

/**
 * The small mono badge. §9: the words carry the meaning, the colour only
 * reinforces it — so a warn tag still says `COAL −0.13 MAX` in full.
 */
export function Tag({ children, warn, className, title }: TagProps) {
  return (
    <span className={cx('tag', warn && 'warn', className)} title={title}>
      {children}
    </span>
  );
}

/* ── Chip ───────────────────────────────────────────────────────────── */

export interface ChipBaseProps {
  children: React.ReactNode;
  /**
   * In this search or not. `false` draws the dashed border and the grey dot.
   *
   * ⚠️ THIS IS NOT THE SAVED BENCH — `onRemove` BELOW IS. Toggling a chip
   * narrows the current search and saves nothing; the bench itself changes
   * only through the Add flows and the remove control. See the warning on
   * OffState in contract.ts.
   */
  on?: boolean;
  /** The dashed "+ Add" chip. Opens a picker, so it is not a two-state control. */
  add?: boolean;
  onClick?: () => void;
  size?: BenchSize;
  className?: string;
  title?: string;
  /** Names the toggle for a reader when the label alone is not enough. */
  ariaLabel?: string;
}

/**
 * The remove control — present WITH a name, or absent altogether.
 *
 * ⚠️ A UNION RATHER THAN TWO OPTIONAL FIELDS, AND THE NAME IS THE REASON.
 * The control is a bare glyph, so `removeLabel` is its ONLY accessible name:
 * without it a reader hears "button" beside each of a dozen chips with
 * nothing to say which one it throws away. Pairing them in the type puts that
 * in tsc rather than in a review comment.
 *
 * ⚠️ AND IT MUST NAME THE THING — "Remove H4350 from your bench", never a
 * bare "Remove". Same rule as the three Add chips, which carry their own
 * aria-labels for exactly the same reason.
 */
export type ChipRemoveProps =
  | { onRemove: () => void; removeLabel: string }
  | { onRemove?: undefined; removeLabel?: undefined };

export type ChipProps = ChipBaseProps & ChipRemoveProps;

/**
 * 🚨 TWO CONTROLS, NOT ONE, AND THEY MUST NOT BE CONFUSED. The pill toggles
 * the item for THIS SEARCH and saves nothing; the × beside it takes the item
 * off the saved bench and writes. A member who meant the first and got the
 * second has lost a shelf entry they may not know how to put back, so the
 * remove is a SEPARATE button, set apart from the pill, with its own outline,
 * its own hit area (44px on a phone, §9) and its own name. It is never a
 * second target inside the pill, where a stray tap lands.
 *
 * It is also a SIBLING rather than a child because a <button> inside a
 * <button> is invalid markup, and browsers recover from it by silently
 * dropping one of the two.
 */
export function Chip({
  children,
  on = true,
  add,
  onClick,
  size = 'desktop',
  className,
  title,
  ariaLabel,
  onRemove,
  removeLabel,
}: ChipProps) {
  const mobile = size === 'mobile';

  const chip = (
    <button
      type="button"
      className={cx('chip', add ? 'add' : !on && 'off', className)}
      // aria-pressed ONLY on the toggles. "Add" opens a picker; announcing it
      // as a pressed/unpressed control would be a lie about what it does.
      aria-pressed={add ? undefined : on}
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      style={mobile ? { height: 40, padding: '0 12px', fontSize: 13 } : undefined}
    >
      {add ? <IconPlus /> : <span className="dot" aria-hidden="true" />}
      {children}
    </button>
  );

  // No remove: the chip is exactly the element it has always been. Wrapping
  // every chip in a span "for consistency" would change the layout of the Add
  // chips and of the pickers for nothing.
  if (!onRemove) return chip;

  return (
    // The pair is bound by proximity, so this gap is deliberately TIGHTER than
    // the gap between chips in the row (see BenchRail's chip row): the × has
    // to read as belonging to the chip on its LEFT rather than the one on its
    // right. Loosen one without the other and it starts removing the wrong
    // thing in the member's head before it does on the screen.
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {chip}
      <IconX
        onClick={onRemove}
        label={removeLabel}
        // The same sentence as a tooltip: the accessible name is the only
        // place this control says what it does, and a mouse never hears it.
        title={removeLabel}
        size={size}
        glyph={mobile ? 14 : 11}
        style={{
          flex: 'none',
          width: mobile ? 44 : 24,
          height: mobile ? 44 : 24,
          borderRadius: 999,
          // The hairline ring is the whole visual difference between "part of
          // the chip" and "a control of its own".
          //
          // ⚠️ AND NO `background` HERE. The fill belongs to `.bench .x:hover`;
          // an inline background would out-specify that rule and take the
          // hover feedback with it.
          border: '0.5px solid var(--border)',
        }}
      />
    </span>
  );
}

/* ── Segmented control ──────────────────────────────────────────────── */

export interface SegOption<T extends string> {
  id: T;
  label: React.ReactNode;
}

export interface SegProps<T extends string> {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the group — "Cartridge filter", "Weight", "View". */
  label: string;
  size?: BenchSize;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The red pill row. A real tablist, following components/desk/tabs.tsx: only
 * the active pill is in the tab order and the arrows move within the group,
 * so a four-cartridge filter costs one tab stop on the way past it rather
 * than four.
 *
 * Arrows MOVE FOCUS BUT DO NOT SELECT. Selection refetches the results, and
 * arrowing across four cartridges would fire four searches nobody asked for.
 * Enter and Space activate, which a <button> already does.
 */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'desktop',
  className,
  style,
}: SegProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cx('seg', className)} style={style}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={cx(on && 'on')}
            // The phone board sets the pill to a 44px target by padding it out
            // rather than by declaring a height, so the pill row stays a row.
            style={size === 'mobile' ? { padding: '14px 14px' } : undefined}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Button ─────────────────────────────────────────────────────────── */

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The one primary action on a surface — Log this load, Save. */
  red?: boolean;
  /** A 16px stroke icon before the label. */
  icon?: React.ReactNode;
  size?: BenchSize;
}

export function Btn({ red, icon, size = 'desktop', className, style, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cx('btn', red && 'red', className)}
      style={{
        // ⚠️ A <button> DOES NOT INHERIT font-family, and `.bench .btn` does
        // not set one — in the prototype the button was a div, which does.
        // Without this the label renders in the UA's default face while every
        // other control is in Public Sans.
        fontFamily: 'inherit',
        ...(size === 'mobile'
          ? { height: 44, padding: '0 14px', fontSize: 14, justifyContent: 'center' }
          : null),
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── Close cross ────────────────────────────────────────────────────── */

export interface IconXProps {
  onClick: () => void;
  /** Required: a glyph-only button has no accessible name otherwise. */
  label: string;
  /** The tooltip, where a mouse needs the same sentence a reader is given. */
  title?: string;
  size?: BenchSize;
  /** The glyph — 16 in an overlay header, 12 on the log list's delete. */
  glyph?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function IconX({
  onClick,
  label,
  title,
  size = 'desktop',
  glyph = 16,
  className,
  style,
}: IconXProps) {
  return (
    <button
      type="button"
      className={cx('x', className)}
      aria-label={label}
      title={title}
      onClick={onClick}
      style={{ ...(size === 'mobile' ? { width: 44, height: 44 } : null), ...style }}
    >
      <IconCross px={glyph} />
    </button>
  );
}

/* ── Field ──────────────────────────────────────────────────────────── */

export interface FieldProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  /** Cartridge, bullet, powder and date are shown, not edited. */
  readOnly?: boolean;
  placeholder?: string;
  /** Charge and COAL line up in a column; the rest are words. */
  numeric?: boolean;
  inputMode?: React.ComponentProps<'input'>['inputMode'];
  type?: string;
  disabled?: boolean;
  size?: BenchSize;
  className?: string;
  id?: string;
}

export function Field({
  label,
  value,
  onChange,
  readOnly,
  placeholder,
  numeric,
  inputMode,
  type = 'text',
  disabled,
  size = 'desktop',
  className,
  id,
}: FieldProps) {
  const auto = React.useId();
  const inputId = id ?? auto;
  return (
    <div className={cx('field', className)}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={cx(numeric && 'num')}
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
        type={type}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        // 16px on the phone is not a taste call: iOS zooms the whole page in
        // on focus for anything smaller, and the sheet never zooms back out.
        style={size === 'mobile' ? { height: 44, padding: '0 12px', fontSize: 16 } : undefined}
      />
    </div>
  );
}

/* ── Backdrop ───────────────────────────────────────────────────────── */

export interface BackdropProps {
  onClick?: () => void;
}

/**
 * The dim behind an overlay. Presentational — the dialog it belongs to always
 * carries a real close button and answers Escape, so this is a convenience
 * target rather than the only way out, and it is hidden from readers.
 */
export function Backdrop({ onClick }: BackdropProps) {
  return <div className="bench-backdrop" aria-hidden="true" onClick={onClick} />;
}

/* ── Overlay shell ──────────────────────────────────────────────────── */

export type OverlayVariant = 'modal' | 'sheet' | 'bottom-sheet';

export interface OverlayShellProps {
  variant: OverlayVariant;
  /**
   * The id of the element that titles the dialog. Focus lands on it when the
   * overlay opens, so the reader hears what opened rather than the first
   * button inside it.
   */
  labelledBy: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Bottom sheets draw the grab handle unless this is false. */
  handle?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * ⚠️ ESCAPE CLOSES THE TOP-MOST OVERLAY ONLY (§9), AND THIS STACK IS WHY.
 *
 * The log sheet opens ON TOP of the load card, so at that moment two shells
 * have a keydown listener on `document`. `stopPropagation` does not help:
 * both listeners are on the same node, so it never runs, and one Escape would
 * close both. Each shell therefore ignores the key unless it is last on this
 * stack — which is mount order, which is stacking order.
 */
const overlayStack: object[] = [];

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Reads a duration token off the element and returns it in milliseconds. */
function tokenMs(el: Element, name: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return /ms$/.test(raw) ? n : n * 1000;
}

function tokenValue(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * The one overlay wrapper: backdrop, dim, Escape, the focus trap, the return
 * of focus to whatever opened it, and `role="dialog" aria-modal="true"`.
 *
 * Mounting IS opening — there is no `open` prop. The entrance animations are
 * mount animations, and a shell that renders itself as null while "closed"
 * would have to run its hooks anyway. The overlays that carry an `open` flag
 * in contract.ts (PowderPicker) return null themselves and render this only
 * when they are open.
 *
 * NOT PORTALLED, deliberately: `.bench-backdrop` / `.bench-modal` are
 * unscoped so they still work as fixed boxes wherever they sit, but the
 * children inside them are styled by `.bench .btn`, `.bench .chip` and the
 * rest — a portal to <body> would leave every one of those unstyled unless
 * the portal re-declared the scope. Nothing may wrap the page in a transform;
 * that would re-anchor the fixed positioning (see the note in bench.css).
 */
export function OverlayShell({
  variant,
  labelledBy,
  onClose,
  children,
  handle = true,
  className,
  style,
}: OverlayShellProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // Freeze whatever is behind the dim. Mounting is opening, so the lock is
  // simply on for this component's life.
  //
  // ⚠️ THE HOOK, NOT `document.body.style.overflow`. In the installed app the
  // shell pane owns the scroll and body never scrolls, so the hand-rolled line
  // is a silent no-op there — see the note in lib/use-scroll-lock.ts. It is
  // also reference-counted, which is what makes the log sheet on top of the
  // load card safe: closing the sheet does not release the card's lock.
  useScrollLock(true);

  // The latest onClose without re-running the effect. A parent that rebuilds
  // its callback on every render would otherwise re-push this overlay onto the
  // stack and yank focus back to the title mid-typing on each keystroke.
  const closeRef = React.useRef(onClose);
  React.useEffect(() => {
    closeRef.current = onClose;
  });

  React.useEffect(() => {
    const me = {};
    overlayStack.push(me);

    const panel = panelRef.current;
    const opener = document.activeElement as HTMLElement | null;

    const title = document.getElementById(labelledBy);
    if (title) {
      // A heading is not focusable on its own; -1 makes it a script-only stop
      // so focus can land on the name of the thing that just opened.
      //
      // preventScroll is load-bearing: the panel is a fixed layer, and letting
      // the browser scroll to bring the focused heading into view moves the
      // page behind the dim instead — the same bite the document scanner
      // documents in components/scan/document-scanner.tsx.
      if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
      title.focus({ preventScroll: true });
    } else {
      panel?.focus({ preventScroll: true });
    }

    function onKey(e: KeyboardEvent) {
      if (overlayStack[overlayStack.length - 1] !== me) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      // Tab must not walk out of a modal into the finder behind the dim,
      // which is still in the tab order however inert it looks.
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      // Nothing to move to. Returning here would hand the key back to the
      // browser, which walks it straight out of the dialog.
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const at = active ? focusable.indexOf(active) : -1;
      // ⚠️ THE TITLE IS NOT IN THIS LIST, AND THE FIRST KEY AFTER OPENING
      // COMES FROM IT. Focus lands on the heading, which carries tabindex="-1"
      // and is therefore excluded by FOCUSABLE by design. Comparing only
      // against first/last would leave that opening Shift+Tab unhandled, and
      // the browser would step BACKWARDS out of the panel into the finder
      // behind the dim — the trap open on the one keystroke most likely to be
      // pressed. Anything focused that is not in the list wraps to an end.
      if (at === -1) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
        return;
      }
      if (e.shiftKey && at === 0) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && at === focusable.length - 1) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = overlayStack.indexOf(me);
      if (i >= 0) overlayStack.splice(i, 1);
      // Back to the row, chip or button that opened it.
      opener?.focus?.();
    };
  }, [labelledBy]);

  // The bottom sheet's entrance.
  //
  // `.bench-modal` and `.bench-sheet` animate themselves in bench.css;
  // the phone's sheet has no class there, so its `sheetUp` (§8: translateY
  // 40→0, 420ms, --ease-out) is played through the Web Animations API off the
  // same tokens rather than by re-typing the curve. Transform and opacity
  // only, so nothing in globals.css can flatten it.
  //
  // ⚠️ LAYOUT EFFECT, NOT `useEffect`. Passive effects run AFTER the browser
  // has painted the mount, so the sheet would be drawn once at its resting
  // position and only then jump 40px down to start the rise — a visible flick
  // on the one surface a phone opens most.
  useIsoLayoutEffect(() => {
    if (variant !== 'bottom-sheet') return;
    const el = panelRef.current;
    if (!el || typeof el.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      [
        { transform: 'translateY(40px)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      {
        duration: tokenMs(el, '--dur-sheet', 420),
        easing: tokenValue(el, '--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)'),
      },
    );
  }, [variant]);

  const bottom = variant === 'bottom-sheet';

  return (
    <>
      <Backdrop onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx(
          // The panel re-declares the module scope on itself, the same way
          // LoadCard and PowderPicker do. `.bench-modal` is unscoped so it
          // works anywhere, but everything INSIDE it is styled by `.bench .btn`
          // and friends — carrying the scope means the shell keeps its look
          // even if it is ever mounted outside the page's wrapper.
          'bench',
          variant === 'modal' && 'bench-modal',
          variant === 'sheet' && 'bench-sheet',
          variant === 'bottom-sheet' && 'bench-bottom-sheet',
          // The elevation opt-in. Without it the overlay is a white box on a
          // dim with no lift at all — the global box-shadow killswitch eats
          // anything that has not asked for it by class.
          'bench-overlay',
          className,
        )}
        style={style}
      >
        {bottom && handle ? (
          <div
            aria-hidden="true"
            style={{
              flex: 'none',
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'var(--border)',
              margin: '8px auto 4px',
            }}
          />
        ) : null}
        {children}
      </div>
    </>
  );
}

/* ── Viewport ─────────────────────────────────────────────────────── */

/**
 * Phone or installed app — the switch between a desktop overlay and a bottom
 * sheet.
 *
 * ⚠️ ONE DEFINITION FOR FIVE OVERLAYS. This was copied into LoadCard, LogList,
 * LogSheet, PowderPicker and SpecCard, and the copies had already drifted into
 * two different implementations — a layout effect in one, this store in the
 * others. Five answers to "is this a phone?" is five chances for two surfaces
 * on the same screen to disagree.
 *
 * ⚠️ useSyncExternalStore, NOT AN EFFECT. Any effect — passive or layout —
 * resolves after the first render, so an overlay mounted by a tap paints its
 * desktop frame once and then snaps to the sheet. The store gives the right
 * answer in the first render instead, and the third argument keeps the server
 * render deterministic.
 */
export const PHONE_QUERY = '(max-width: 767px), (display-mode: standalone)';

function subscribePhone(cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function phoneSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (window.matchMedia(PHONE_QUERY).matches) return true;
  // iOS Safari still does not honour (display-mode: standalone) — it has its
  // own legacy property, the same second signal lib/use-standalone.ts reads.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function usePhone(): boolean {
  return React.useSyncExternalStore(subscribePhone, phoneSnapshot, () => false);
}
