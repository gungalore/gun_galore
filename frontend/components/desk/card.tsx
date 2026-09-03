'use client';

/**
 * THE DESK — DeskCard, the unit of work.
 *
 * Every actionable thing on the platform arrives here in the same shape, and
 * the shape is the argument: the operator learns one card and can then act on
 * a dealer transfer, a dispute and a stale cron without learning three
 * screens. Type label and ref on the first line so you know what you are
 * looking at before you read it; a headline you can decide on; one meta line
 * of the facts that decide it; then the actions.
 *
 * ⚠️ LATER SITS AT THE FAR RIGHT, ALWAYS. It is the only control on the card
 * that does not progress the work, so it is the only one separated from the
 * others by the spacer. Muscle memory for "not now" should never land on
 * "approve".
 */
import * as React from 'react';
import { Button, LaterButton, Tag, type TagKind } from './primitives';
import { CARD_TYPE_ICON, IconInfo, type DeskCardType, type IconProps } from './icons';

export interface DeskCardTag {
  kind?: TagKind;
  label: string;
  icon?: React.ComponentType<IconProps> | null;
}

export interface DeskCardAction {
  label: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'gated' | 'danger';
  icon?: React.ComponentType<IconProps>;
  trailingIcon?: React.ComponentType<IconProps>;
  amount?: string;
  onClick?: () => void;
}

export interface DeskCardProps {
  /** The server's card type — picks the glyph and nothing else. */
  type: DeskCardType;
  /** The type label as the operator reads it: "Firearm transfer". */
  typeLabel: string;
  /** Reference, in mono. Faint, because the label beside it already said it. */
  reference?: string;
  headline: string;
  meta?: React.ReactNode;
  tags?: DeskCardTag[];
  actions?: DeskCardAction[];
  /** The rule the operator must know before pressing anything on this card. */
  note?: string;
  /**
   * Keyboard cursor / click selection. Draws the ink-2 border.
   *
   * ⚠️ THIS AND THE FOCUS RING MUST NEVER POINT AT DIFFERENT CARDS. Both are
   * drawn at once — focus is a 2px outline, selection is the ink-2 border —
   * so a pile where Tab moves one and J/K moves the other puts two "you are
   * here" marks on screen at the same time. A ends up firing the primary
   * action on the card that is NOT outlined. See onFocus below.
   */
  selected?: boolean;
  /**
   * Sunk by Later. Dimmed, tagged with its return time, and its Later button
   * removed — you cannot sink a card twice.
   */
  laterUntil?: string;
  /** Withheld on cards that must stay visible — a red gate cannot be sunk. */
  canLater?: boolean;
  onLater?: () => void;
  onSelect?: () => void;
}

export function DeskCard({
  type,
  typeLabel,
  reference,
  headline,
  meta,
  tags = [],
  actions = [],
  note,
  selected = false,
  laterUntil,
  canLater = true,
  onLater,
  onSelect,
}: DeskCardProps) {
  const [hover, setHover] = React.useState(false);
  const Icon = CARD_TYPE_ICON[type];
  const sunk = Boolean(laterUntil);

  return (
    <div
      // One tab stop for the card; the actions inside are reachable in
      // reading order after it. A feed of cards, not a grid of buttons.
      tabIndex={0}
      role="article"
      aria-label={`${typeLabel}: ${headline}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      // ⚠️ TAB MOVES THE CURSOR TOO. React's onFocus is focusin, so this also
      // fires when Tab lands on one of the card's own buttons — which is what
      // we want: whatever the operator has reached, A and L now act on it.
      // Without this the cursor stays wherever J/K last left it while the
      // focus ring walks the pile, and A approves a card the operator is not
      // looking at.
      onFocus={onSelect}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 16px',
        borderRadius: 'var(--dk-radius-card)',
        // Flat and hairlined. Cards never lift — only the drawer and dialogs
        // do — because a page of shadowed cards on this ground turns to soup.
        background: hover && !sunk ? 'var(--dk-raised)' : 'var(--dk-surface)',
        border: `1px solid ${
          selected ? 'var(--dk-ink-2)' : hover && !sunk ? 'var(--dk-line-2)' : 'var(--dk-line)'
        }`,
        transition: 'background 120ms ease-out, border-color 120ms ease-out, opacity 200ms ease-out',
        opacity: sunk ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
        <Icon size={14} style={{ color: 'var(--dk-ink-3)' }} />
        <span
          className="dk-mono"
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--dk-ink-3)',
            whiteSpace: 'nowrap',
          }}
        >
          {typeLabel}
        </span>
        {reference ? (
          <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-4)' }}>
            {reference}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {sunk ? (
          <Tag kind="neutral" icon={null}>{`later · back ${laterUntil}`}</Tag>
        ) : (
          tags.map((t, i) => (
            <Tag key={i} kind={t.kind} icon={t.icon}>
              {t.label}
            </Tag>
          ))
        )}
      </div>

      <div
        style={{
          fontSize: 15,
          fontWeight: 500,
          lineHeight: 1.35,
          letterSpacing: '-0.005em',
          color: 'var(--dk-ink)',
        }}
      >
        {headline}
      </div>

      {meta ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-2)' }}>{meta}</div>
      ) : null}

      {note ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
          <IconInfo size={13} style={{ color: 'var(--dk-ink-3)', marginTop: 1 }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>{note}</span>
        </div>
      ) : null}

      {actions.length > 0 || (canLater && !sunk) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {actions.map((a, i) => (
            <Button
              key={i}
              variant={a.variant ?? (i === 0 ? 'primary' : 'secondary')}
              icon={a.icon}
              trailingIcon={a.trailingIcon}
              amount={a.amount}
              onClick={(e) => {
                e.stopPropagation();
                a.onClick?.();
              }}
            >
              {a.label}
            </Button>
          ))}
          <span style={{ flex: 1 }} />
          {canLater && !sunk ? (
            <LaterButton
              onClick={(e) => {
                e.stopPropagation();
                onLater?.();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
