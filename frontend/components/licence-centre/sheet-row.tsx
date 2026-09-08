'use client';

import { useEffect, useState } from 'react';
import type { SheetItem } from './contract';
import CardsRow from './cards-row';
import { sourceLine } from './source-line';

// ────────────────────────────────────────────────────────────────────
// THE ONE ROW COMPONENT.
//
// ⚠️ IT REPLACES FIVE. field-grid.tsx, pack-row.tsx, pack-group.tsx,
// pack-section.tsx and motivation-field-input.tsx each rendered a question a
// slightly different way, and the live walkthrough found the consequence: on
// the pack screen EVERY question rendered as a grey row reading "You may know
// it" with a "Still needed" pill, and no input visible at all. Opening one
// meant finding a narrow invisible button, answering, then a "Done" link to
// close it. Seven required answers on the firearm step was seven
// open-answer-Done cycles, and it was the single biggest reason the form felt
// like work.
//
// So: the control is ALWAYS OPEN on a row that needs one. A select is a
// select. There is nothing to click before you can type.
//
// ⚠️ THE COLLAPSED ROW WAS NOT WRONG, IT WAS MISAPPLIED. It was designed for
// the doc-sourced case — a value we already hold, shown with where it came
// from — and it is exactly right for that. `filled` and `suggested` below are
// that row. It was wrong for an EMPTY REQUIRED FIELD, which is what
// `needs_you` is for.
//
// ⚠️ FOUR STATES AND THE SERVER PICKS. See SheetItem.state in contract.ts:
// this component never decides whether an item applies. It renders what it is
// told, which is what let the frontend's mirror of isVisible() be retired.
// ────────────────────────────────────────────────────────────────────

/**
 * True when `Control` is already showing `item.help` inside the box, so the
 * row must not print it a second time underneath.
 *
 * ⚠️ IT WAS PRINTING BOTH. On the live sheet the Make field carried the
 * placeholder "The manufacturer — Glock, CZ, Tikka, Beretta." and then that
 * same sentence again as a help line directly below it; Serial number did the
 * same. A select and a date input have no placeholder to carry it, so those
 * keep the line.
 */
function helpIsInsideTheControl(kind: SheetItem['kind']): boolean {
  return kind !== 'choice' && kind !== 'date';
}

function Pill({
  tone,
  children,
}: {
  tone: 'check' | 'profile';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'check'
      ? 'bg-[var(--gold-wash)] text-[var(--gold-strong)] border-[var(--gold-line)]'
      : 'bg-[var(--bg-inset)] text-[var(--text-secondary)] border-[var(--border)]';
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-[2px] text-[10.5px] font-medium leading-[1.4] ${cls}`}
    >
      {children}
    </span>
  );
}

/**
 * The always-open control for a `needs_you` row.
 *
 * ⚠️ THE PLACEHOLDER IS THE SHAPE OF THE ANSWER, NEVER A SHRUG. Every
 * unanswered field on the old screen said "You may know it" — including
 * "Should we fill in your SAPS 271 form?" and "Why this particular firearm
 * suits the purpose". It reads as the form giving up on you. The registry
 * carries real help text; where it does not, the label is a better prompt than
 * an apology.
 */
function Control({
  item,
  value,
  onChange,
}: {
  item: SheetItem;
  value: string;
  onChange: (v: string) => void;
}) {
  const empty = !value.trim();
  const missing = item.required && empty;
  const base =
    'w-full min-h-[44px] rounded-[var(--r-sm)] border bg-[var(--bg-card)] px-3 py-[10px] text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)]';
  const keyline = missing
    ? 'border-[var(--warning)]'
    : 'border-[var(--border)]';

  if (item.kind === 'long') {
    return (
      <textarea
        className={`${base} ${keyline} min-h-[88px] leading-[1.45]`}
        value={value}
        placeholder={item.help ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (item.kind === 'choice') {
    return (
      <select
        className={`${base} ${keyline} appearance-none`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {(item.choices ?? []).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        {(item.optionGroups ?? []).map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  }

  if (item.kind === 'date') {
    return (
      <input
        type="date"
        className={`${base} ${keyline}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      type="text"
      className={`${base} ${keyline}`}
      value={value}
      placeholder={item.help ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export interface SheetRowProps {
  item: SheetItem;
  onChange: (value: string) => void;
  /** Accept a `suggested` value as-is. Writes MEMBER provenance server-side. */
  onConfirm?: () => void;
  /** The paired "in your own words" item, for a cards row. */
  ownWords?: SheetItem;
  onOwnWordsChange?: (value: string) => void;
}

export default function SheetRow({
  item,
  onChange,
  onConfirm,
  ownWords,
  onOwnWordsChange,
}: SheetRowProps) {
  /**
   * ⚠️ "Change" IS LOCAL, AND IT IS THE ONLY STATE THIS FILE HOLDS. Whether
   * somebody has opened a filled row to edit it is a fact about this render,
   * not about the application — it must not survive a refetch, and it must not
   * travel to the server. Everything else lives in the page.
   */
  const [editing, setEditing] = useState(false);

  // A row that changes state under us — a document read landing, say — closes
  // its editor rather than sitting open over a value that has moved.
  useEffect(() => {
    setEditing(false);
  }, [item.state, item.value]);

  if (item.state === 'na') return null;

  const profilePill = item.scope === 'profile' && (
    <Pill tone="profile">saved to your profile</Pill>
  );

  // ── cards: their own grid, never a control ────────────────────────
  if (item.kind === 'cards') {
    return (
      <CardsRow
        item={item}
        onChange={onChange}
        ownWords={ownWords}
        onOwnWordsChange={onOwnWordsChange}
      />
    );
  }

  const openControl = item.state === 'needs_you' || editing;

  if (openControl) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-[6px] border-b border-[var(--border-divider)] py-[11px] last:border-b-0">
        <div>
          <div className="flex items-baseline justify-between gap-[10px] text-[12.5px] leading-[1.3] text-[var(--text-secondary)]">
            <span>{item.label}</span>
            <span className="flex items-center gap-[6px]">
              {profilePill}
              {editing ? null : item.required ? (
                <span className="text-[11px] font-medium text-[var(--warning)]">
                  Still needed
                </span>
              ) : (
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  Optional
                </span>
              )}
            </span>
          </div>
          <div className="mt-[6px]">
            <Control item={item} value={item.value} onChange={onChange} />
          </div>
          {item.help && !editing && !helpIsInsideTheControl(item.kind) ? (
            <div className="mt-[5px] text-[12px] text-[var(--text-tertiary)]">
              {item.help}
            </div>
          ) : null}
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="mt-1 min-h-[44px] rounded-[6px] px-2 text-[13px] font-medium text-[var(--red)] hover:underline"
            >
              Done
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ── filled / suggested: the value, where it came from, and one action ──
  const suggested = item.state === 'suggested';
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-[6px] border-b border-[var(--border-divider)] py-[11px] last:border-b-0 ${
        suggested
          ? '-mx-4 bg-gradient-to-r from-[var(--gold-wash)] to-transparent px-4'
          : ''
      }`}
    >
      <div>
        <div className="text-[12.5px] leading-[1.3] text-[var(--text-secondary)]">
          {item.label}
        </div>
        {/* ⚠️ IN FULL, NEVER MASKED. See SheetItem.value in contract.ts. */}
        <div className="mt-[2px] break-words text-[14.5px] font-medium leading-[1.3] text-[var(--text-primary)]">
          {item.value}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-[6px] text-[12px] text-[var(--text-tertiary)]">
          {item.provenance ? (
            <span>from {sourceLine(item.provenance.from)}</span>
          ) : null}
          {(suggested || item.provenance?.inferred) && (
            <Pill tone="check">check this</Pill>
          )}
          {profilePill}
        </div>
      </div>
      <div className="flex items-center gap-1 self-center">
        {suggested && onConfirm ? (
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] rounded-[6px] px-2 text-[13px] font-medium text-[var(--red)] hover:underline"
          >
            Confirm
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`min-h-[44px] rounded-[6px] px-2 text-[13px] font-medium hover:underline ${
            suggested ? 'text-[var(--text-tertiary)]' : 'text-[var(--red)]'
          }`}
        >
          Change
        </button>
      </div>
    </div>
  );
}
