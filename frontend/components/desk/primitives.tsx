'use client';

/**
 * THE DESK — the primitives: Button, Tag, Chip, Input, Key, Band, Rule.
 *
 * Everything here reads its colours from the --dk-* tokens and nothing here
 * hard-codes a hex. That is not tidiness: the CI guard rejects a raw hex
 * anywhere under components/desk/** except the token file itself, because a
 * literal that matches the palette today is a literal that silently stops
 * matching it the day the palette moves.
 *
 * ⚠️ FOCUS IS AN OUTLINE, NEVER A RING. globals.css carries a global
 * `* { box-shadow: none !important }`, and Tailwind's ring-* compiles to
 * box-shadow — so a ring on this surface renders precisely nothing, with no
 * error. tokens.css sets one :focus-visible outline for the whole subtree;
 * no component below re-implements it.
 */
import * as React from 'react';
import { IconAlert, IconArrowDown, IconClock, IconLock, type IconProps } from './icons';

/* ────────────────────────────────────────────────────────────────────────
 * Button
 * ──────────────────────────────────────────────────────────────────────── */

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'gated'
  | 'danger'
  | 'ok';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  /** The label. Ends in an ellipsis when a dialog follows — see the note. */
  children: React.ReactNode;
  /** Leading glyph. The gated variant supplies its own padlock. */
  icon?: React.ComponentType<IconProps>;
  /** Trailing glyph — a chevron for "opens a drawer", an arrow for "leaves". */
  trailingIcon?: React.ComponentType<IconProps>;
  /**
   * A money amount rendered in mono after the label.
   *
   * ⚠️ THE CONFIRM BUTTON CARRIES THE AMOUNT. "Refund R3,150" and not
   * "Confirm": the last thing under the operator's cursor before money moves
   * should restate what is about to happen, so a mis-click on the wrong row
   * is caught by reading the button rather than by the bank.
   */
  amount?: string;
  /** Swaps the leading icon for a spinner and dims the label. */
  loading?: boolean;
  /** Fills the width of its container — phone footers, sheet primaries. */
  block?: boolean;
}

const BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  height: 'var(--dk-h-control)',
  padding: '0 12px',
  borderRadius: 'var(--dk-radius-control)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition: 'background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out',
};

const VARIANT: Record<ButtonVariant, React.CSSProperties> = {
  // Ink on ground. The loudest thing available on a dark page without
  // spending one of the four state colours on decoration.
  primary: {
    background: 'var(--dk-ink)',
    color: 'var(--dk-ground)',
    border: '1px solid var(--dk-ink)',
  },
  secondary: {
    background: 'var(--dk-inset)',
    color: 'var(--dk-ink)',
    border: '1px solid var(--dk-line-2)',
  },
  outline: {
    background: 'transparent',
    color: 'var(--dk-ink)',
    border: '1px solid var(--dk-line-2)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--dk-ink-2)',
    border: '1px solid transparent',
  },
  // ⚠️ GATED IS NOT DISABLED. A disabled control tells the operator nothing
  // and cannot be tabbed to; a gated one is focusable, clickable, and its
  // whole job is to say which switch is off and what is queued behind it.
  // The dashed border is the second, non-colour signal that it will not act.
  gated: {
    background: 'var(--dk-raised)',
    color: 'var(--dk-ink-3)',
    border: '1px dashed var(--dk-line-2)',
  },
  // Danger is quiet: red ink and a red hairline, never a red fill. A red
  // slab reads as "already broken" rather than "this one is destructive".
  danger: {
    background: 'transparent',
    color: 'var(--dk-bad)',
    border: '1px solid var(--dk-bad-line)',
  },
  // The only filled state colour in the kit, and it exists solely as the
  // reveal behind a swiped card — never as a button the operator aims at.
  ok: {
    background: 'var(--dk-ok)',
    color: 'var(--dk-ground)',
    border: '1px solid var(--dk-ok)',
  },
};

const HOVER: Partial<Record<ButtonVariant, React.CSSProperties>> = {
  primary: { background: 'var(--dk-ink-2)', borderColor: 'var(--dk-ink-2)' },
  secondary: { background: 'var(--dk-raised)' },
  outline: { background: 'var(--dk-raised)' },
  ghost: { background: 'var(--dk-raised)', color: 'var(--dk-ink)' },
  gated: { background: 'var(--dk-inset)' },
  danger: { background: 'var(--dk-bad-wash)' },
};

export function Button({
  variant = 'secondary',
  children,
  icon,
  trailingIcon,
  amount,
  loading = false,
  block = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const Leading = variant === 'gated' && !icon ? IconLock : icon;
  const Trailing = trailingIcon;

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        ...BASE,
        ...VARIANT[variant],
        ...(hover && !disabled ? HOVER[variant] : null),
        ...(block ? { width: '100%' } : null),
        // Disabled is reserved for controls that genuinely have nothing to
        // say. Anything with a reason uses the gated variant instead.
        ...(disabled ? { opacity: 0.45, cursor: 'default' } : null),
        ...(pressed && !disabled ? { transform: 'scale(0.98)' } : null),
        ...style,
      }}
      {...rest}
    >
      {loading ? <Spinner /> : Leading ? <Leading size={14} /> : null}
      <span style={{ opacity: loading ? 0.55 : 1 }}>{children}</span>
      {amount ? (
        <span className="dk-mono" style={{ opacity: loading ? 0.55 : 1 }}>
          {amount}
        </span>
      ) : null}
      {Trailing ? <Trailing size={14} /> : null}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 13,
        height: 13,
        flex: 'none',
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        animation: 'dk-spin 700ms linear infinite',
      }}
    />
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Tag
 * ──────────────────────────────────────────────────────────────────────── */

export type TagKind = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'ink';

export interface TagProps {
  kind?: TagKind;
  children: React.ReactNode;
  /**
   * Leading glyph.
   *
   * ⚠️ warn AND bad SUPPLY ONE WHETHER OR NOT YOU PASS ONE. The house rule
   * is that colour is never the only signal, and the only way to keep that
   * true across a hundred call sites is to make it impossible to opt out:
   * a warn tag defaults to the clock, a bad tag to the triangle.
   */
  icon?: React.ComponentType<IconProps> | null;
}

const TAG_TONE: Record<TagKind, React.CSSProperties> = {
  ok: { background: 'var(--dk-ok-wash)', border: '1px solid var(--dk-ok-line)', color: 'var(--dk-ok)' },
  warn: { background: 'var(--dk-warn-wash)', border: '1px solid var(--dk-warn-line)', color: 'var(--dk-warn)' },
  bad: { background: 'var(--dk-bad-wash)', border: '1px solid var(--dk-bad-line)', color: 'var(--dk-bad)' },
  info: { background: 'var(--dk-info-wash)', border: '1px solid var(--dk-info-line)', color: 'var(--dk-info)' },
  neutral: { background: 'var(--dk-inset)', border: '1px solid var(--dk-line-2)', color: 'var(--dk-ink-3)' },
  ink: { background: 'var(--dk-inset)', border: '1px solid var(--dk-line-2)', color: 'var(--dk-ink-2)' },
};

export function Tag({ kind = 'neutral', children, icon }: TagProps) {
  const Fallback = kind === 'warn' ? IconClock : kind === 'bad' ? IconAlert : null;
  const Glyph = icon === null ? null : (icon ?? Fallback);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 8px',
        borderRadius: 'var(--dk-radius-pill)',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...TAG_TONE[kind],
      }}
    >
      {Glyph ? <Glyph size={12} /> : null}
      <span>{children}</span>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Chip — segments and period pickers
 * ──────────────────────────────────────────────────────────────────────── */

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  active?: boolean;
  children: React.ReactNode;
  /** Rendered in mono at 75% opacity, after the label. */
  count?: number | string;
}

export function Chip({ active = false, children, count, style, ...rest }: ChipProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      aria-pressed={active}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 30,
        padding: '0 12px',
        borderRadius: 'var(--dk-radius-pill)',
        fontFamily: 'inherit',
        fontSize: 12.5,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: 'background 120ms ease-out, border-color 120ms ease-out',
        // The active chip is ink-filled, exactly like the active tab: one
        // selection idiom for the whole surface.
        ...(active
          ? { background: 'var(--dk-ink)', color: 'var(--dk-ground)', border: '1px solid var(--dk-ink)' }
          : {
              background: hover ? 'var(--dk-raised)' : 'transparent',
              color: 'var(--dk-ink-2)',
              border: '1px solid var(--dk-line-2)',
            }),
        ...style,
      }}
      {...rest}
    >
      <span>{children}</span>
      {count !== undefined ? (
        <span className="dk-mono" style={{ fontSize: 11, opacity: 0.75 }}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Input
 * ──────────────────────────────────────────────────────────────────────── */

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  icon?: React.ComponentType<IconProps>;
  /** Renders a bad-bordered field and the message beneath it. */
  error?: string;
  /** Trailing slot — a Ctrl K hint, a clear button. */
  trailing?: React.ReactNode;
}

export function Input({ icon: Icon, error, trailing, style, ...rest }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 'var(--dk-h-control)',
          padding: '0 12px',
          background: 'var(--dk-inset)',
          border: `1px solid ${error ? 'var(--dk-bad)' : 'var(--dk-line-2)'}`,
          borderRadius: 'var(--dk-radius-control)',
          minWidth: 0,
        }}
      >
        {Icon ? <Icon size={14} style={{ color: 'var(--dk-ink-3)' }} /> : null}
        <input
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--dk-ink)',
            fontFamily: 'inherit',
            fontSize: 13,
            ...style,
          }}
          {...rest}
        />
        {trailing}
      </div>
      {error ? <span style={{ fontSize: 12, color: 'var(--dk-bad)' }}>{error}</span> : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Key — a keyboard hint
 * ──────────────────────────────────────────────────────────────────────── */

export function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="dk-mono"
      style={{
        display: 'inline-block',
        fontSize: 10.5,
        lineHeight: 1.5,
        padding: '1px 6px',
        color: 'var(--dk-ink-2)',
        background: 'var(--dk-inset)',
        border: '1px solid var(--dk-line-2)',
        borderRadius: 5,
      }}
    >
      {children}
    </kbd>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Band — the fixed-priority grouping above a run of cards
 * ──────────────────────────────────────────────────────────────────────── */

export interface BandProps {
  label: string;
  count: number;
  children?: React.ReactNode;
}

/**
 * ⚠️ A BAND WITH NOTHING IN IT DOES NOT RENDER. An empty "Disputes" heading
 * reads as a surface that is broken or still loading; the absence of the
 * heading is the correct way to say there are no disputes. The all-clear
 * state on the Desk says so once, in one place, rather than four times.
 */
export function Band({ label, count, children }: BandProps) {
  if (count <= 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px 2px' }}>
        {/* Sans, like every .lbl in the artboards — mono is for data. */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--dk-ink-3)',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        {/* ⚠️ RULE FIRST, THEN THE COUNT — the order the artboard draws
            (docs/design/desk-pwa/Main.dc.html) and the reason its annotation
            insists "a band header is a rule, not a chip row". The count used
            to sit in a pill immediately after the label, with the rule
            trailing off to the right: a pill beside a label is a chip, and a
            row of them reads as a control the operator can press. Pushing the
            count to the far end turns the header back into a divider with a
            tally on it.

            ⚠️ ink-3, where the artboard uses ink-4. ink-4 is 2.8:1 on this
            ground — below AA — and five sites of it were raised to ink-3 on
            2026-09-04 for exactly that reason. Structure matches the artboard;
            this one colour deliberately does not. */}
        <span style={{ flex: 1, height: 1, background: 'var(--dk-line)' }} />
        <span
          className="dk-mono"
          style={{
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1,
            color: 'var(--dk-ink-3)',
          }}
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

/** A plain hairline. Never darker than the ground, never 0.5px. */
export function Rule({ style }: { style?: React.CSSProperties }) {
  return <div style={{ height: 1, background: 'var(--dk-line)', ...style }} />;
}

/** The Later control, spelled the same way on every card that has one. */
export function LaterButton(props: Omit<ButtonProps, 'children' | 'variant' | 'icon'>) {
  return (
    <Button variant="ghost" icon={IconArrowDown} {...props}>
      Later
    </Button>
  );
}
