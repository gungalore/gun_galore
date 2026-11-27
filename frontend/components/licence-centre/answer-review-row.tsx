'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SheetItem } from './contract';
import { sourceLine } from './source-line';
import DateField from '@/components/date-field';

// ────────────────────────────────────────────────────────────────────
// ONE ANSWER ON "CHECK YOUR ANSWERS".
//
// ⚠️ A REVIEW ROW, NOT THE SHEET ROW. SheetRow is the form: it autosaves on
// every keystroke and its open/closed state is the field's state. This screen is
// a list of DECISIONS — you read an answer, and either leave it, change it, or
// accept a drafted one — so the row has an explicit editor that opens on Change
// and a Save that closes it.
//
// ⚠️ A DRAFTED ANSWER WEARS THE GOLD FLAG. The writer composed the personal
// history from the applicant's own documents and application; the applicant is
// the only one who can say it is true, so it must never look like a fact we read
// off a certificate. Edit and Confirm are both offered: Confirm accepts the
// words, Edit replaces them.
//
// ⚠️ CARDS AND MULTI ARE EDITED HERE, AS CHIPS. Their answers are a set of
// sentences about the applicant's own life — the review screen is reached after
// the interview closes, so sending the member back to the interview card for
// them was a door that bounced off the pack. The chips are the same options the
// card served, the stored value is the same comma list of option keys, and an
// empty selection is never written.
// ────────────────────────────────────────────────────────────────────

/** How long typing must pause before the change is written. */
const AUTOSAVE_MS = 900;

const CONTROL =
  'mt-2 block min-h-[44px] w-full rounded-[var(--r-sm)] border bg-[var(--field-bg)] px-3 py-[10px] text-[14px] text-[var(--text-primary)]';
const CONTROL_STYLE = {
  borderColor: 'var(--border)',
  color: 'var(--text-primary)',
} as const;

/** The values a select may offer, from the same places the sheet reads. */
function optionsFor(item: SheetItem): string[] {
  if (item.choices?.length) return item.choices;
  if (item.optionGroups?.length) {
    return item.optionGroups.flatMap((group) =>
      group.options.map((option) => option.value),
    );
  }
  return (item.options ?? []).map((option) => option.key);
}

/**
 * Every chip this row can offer.
 *
 * ⚠️ THE STORED KEY IS THE VALUE; THE SENTENCE IS THE LABEL. `cards` stores
 * `option.key` and the member reads `option.sentence`; a reworded card must stay
 * a valid answer. `multi` stores `choices` values (value === label) and, where a
 * list comes from a data module, `optionGroups`.
 */
function chipOptionsFor(item: SheetItem): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string) => {
    const value = key.trim();
    if (!value || seen.has(value.toLowerCase())) return;
    seen.add(value.toLowerCase());
    out.push({ key: value, label: label.trim() || value });
  };
  for (const option of item.options ?? []) push(option.key, option.sentence);
  for (const choice of item.choices ?? []) push(choice, choice);
  for (const group of item.optionGroups ?? []) {
    for (const option of group.options) push(option.value, option.label);
  }
  return out;
}

/** A stored comma list, split the way the server stores it. */
function parseList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * What a cards/multi answer reads as.
 *
 * ⚠️ CARDS PRINT THEIR SENTENCES, NOT THEIR KEYS. The stored value is
 * `night_travel, rented`; the member chose "I regularly travel at night, or on
 * roads where I would be on my own if I stopped." and that is the only version
 * they can check.
 */
function ChosenSentences({ item }: { item: SheetItem }) {
  const chosen = parseList(item.value);
  if (!chosen.length) return null;
  const labels = new Map(chipOptionsFor(item).map((o) => [o.key, o.label]));
  const lines = chosen.map((key) => labels.get(key) ?? key);
  return (
    <ul className="m-0 mt-[3px] list-none p-0 text-[14px] leading-[1.45] text-[var(--text-primary)]">
      {lines.map((line, index) => (
        <li key={`${line}-${index}`} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

export interface AnswerReviewRowProps {
  item: SheetItem;
  /**
   * Write one changed value. Resolving means the screen has reloaded, so the row
   * may settle on the server's value.
   */
  onSave: (key: string, value: string) => Promise<void>;
  /** Accept a suggested/drafted value as-is. */
  onConfirm?: (key: string) => void | Promise<void>;
  /** This row — or the screen — is saving. */
  busy?: boolean;
  /**
   * Start with the editor open on a `needs_you` row.
   *
   * ⚠️ DEFAULTS TO `required`. A gap the sheet is actually holding out for opens
   * its control; an optional empty field stays a one-line row with a Change
   * button until the member asks to fill it. Rendering every optional field open
   * is most of what made the review screen an endless form.
   */
  autoOpen?: boolean;
}

export default function AnswerReviewRow({
  item,
  onSave,
  onConfirm,
  busy = false,
  autoOpen,
}: AnswerReviewRowProps) {
  const chips = item.kind === 'cards' || item.kind === 'multi';
  const suggested = item.state === 'suggested';
  const needsYou = item.state === 'needs_you';

  const [draft, setDraft] = useState(item.value);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * ⚠️ FROZEN WHEN A WRITE IS IN FLIGHT. A save on this row, or the page saving
   * another row, must not leave a control editable: the member could type into a
   * value that has already been sent. A disabled control keeps its text, so the
   * pending editor survives rather than being closed or reset.
   */
  const frozen = saving || busy;
  const [error, setError] = useState<string | null>(null);
  /** What the server last confirmed, so an unchanged value writes nothing. */
  const saved = useRef(item.value);
  /** One write at a time: a blur and a Save can land in the same gesture. */
  const inFlight = useRef(false);
  /** The Save landed while the blur's write was still running — close after it. */
  const queuedClose = useRef(false);
  /** Cancel was pressed, so the blur the click caused must not save. */
  const canceling = useRef(false);
  /** Save was pressed, so its own click handles the write, not the blur. */
  const savingSoon = useRef(false);

  const opensAsGap = needsYou && (autoOpen ?? item.required);
  const open = editing || opensAsGap;
  const options = optionsFor(item);
  const chipOptions = chips ? chipOptionsFor(item) : [];
  const selected = chips ? parseList(draft) : [];
  /** The value Save writes: the joined keys for chips, the trimmed text else. */
  const editedValue = chips ? selected.join(', ') : draft.trim();
  /**
   * The source line is worth a row — unless it says the same thing as the gold
   * flag. A DRAFTED answer's provenance label IS "Drafted for you from your
   * file — check it"; printing it as "from …" under the pill would repeat the
   * sentence at the member twice.
   */
  const showFrom =
    item.provenance !== null &&
    !(suggested && item.provenance.source === 'DRAFTED');

  // A server value landing while the editor is CLOSED is adopted. An open
  // editor is never rewritten under the member's cursor.
  useEffect(() => {
    if (open) return;
    saved.current = item.value;
    setDraft(item.value);
  }, [item.value, open]);

  const flush = useCallback(
    async (value: string, close: boolean) => {
      if (inFlight.current) {
        if (close) queuedClose.current = true;
        return;
      }
      if (value === saved.current) {
        if (close) setEditing(false);
        return;
      }
      inFlight.current = true;
      setSaving(true);
      setError(null);
      try {
        await onSave(item.key, value);
        saved.current = value;
        if (close || queuedClose.current) {
          queuedClose.current = false;
          setEditing(false);
        }
      } catch (err) {
        // Kept open, with their text, so the next Save can try again.
        queuedClose.current = false;
        setError((err as Error).message);
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    },
    [item.key, onSave],
  );

  /**
   * Type-and-pause autosave, for the free-text controls.
   *
   * ⚠️ IT NEVER OVERWRITES A BLANK. An empty box that gets autosaved is how a
   * member loses an answer while deleting a typo; the explicit Save (or the
   * field's own Clear) is the only door for an empty value.
   *
   * ⚠️ CHIPS HAVE NO AUTOSAVE. A tap is not a finished thought — the member is
   * still choosing — so the chip grid writes once, on Save. Autosaving every tap
   * would also re-draft the writer's narrative on each toggle.
   */
  useEffect(() => {
    if (chips || !open || saving) return;
    if (!draft.trim() || draft === saved.current) return;
    const timer = window.setTimeout(() => {
      void flush(draft, false);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [chips, draft, open, saving, flush]);

  function edit(value: string) {
    if (frozen) return;
    setError(null);
    setEditing(true);
    setDraft(value);
  }

  function toggleChip(key: string) {
    if (frozen) return;
    setError(null);
    setEditing(true);
    setDraft((current) => {
      const chosen = parseList(current);
      const next = chosen.includes(key)
        ? chosen.filter((value) => value !== key)
        : [...chosen, key];
      return next.join(', ');
    });
  }

  /**
   * ⚠️ WRITE ON LEAVE. Clicking Continue or another row blurs this control
   * first, and a change still sitting in the autosave window when the screen
   * navigates would be lost. Blur flushes it, so the move is safe.
   */
  function leave() {
    if (!editing || chips) return;
    if (canceling.current) {
      canceling.current = false;
      return;
    }
    if (savingSoon.current) {
      savingSoon.current = false;
      return;
    }
    const value = draft.trim();
    if (!value || value === saved.current) return;
    void flush(value, false);
  }

  function cancel() {
    canceling.current = false;
    queuedClose.current = false;
    setDraft(saved.current);
    setEditing(false);
    setError(null);
  }

  function save() {
    if (chips && !selected.length) return;
    void flush(editedValue, true);
  }

  const labelRow = (
    <div className="flex items-baseline justify-between gap-[10px] text-[12.5px] leading-[1.3] text-[var(--text-secondary)]">
      <span>{item.label}</span>
      {needsYou ? (
        <span
          className={`text-[11px] font-medium ${
            opensAsGap
              ? 'text-[var(--warning)]'
              : 'text-[var(--text-tertiary)]'
          }`}
        >
          {opensAsGap ? 'Still needed' : 'Optional'}
        </span>
      ) : null}
    </div>
  );

  const provenance = (
    <div className="mt-1 flex flex-wrap items-center gap-[6px] text-[12px] text-[var(--text-tertiary)]">
      {showFrom && item.provenance ? (
        <span>from {sourceLine(item.provenance.from)}</span>
      ) : null}
      {suggested ? (
        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-[var(--gold-line)] bg-[var(--gold-wash)] px-2 py-[2px] text-[10.5px] font-medium leading-[1.4] text-[var(--gold-strong)]">
          Drafted for you — check it
        </span>
      ) : null}
    </div>
  );

  return (
    <div
      aria-busy={frozen}
      className={`border-b border-[var(--border-divider)] py-[11px] last:border-b-0 ${
        suggested
          ? '-mx-4 bg-gradient-to-r from-[var(--gold-wash)] to-transparent px-4'
          : ''
      }`}
    >
      {labelRow}

      {open ? (
        <>
          {chips ? (
            <>
              <div className="mt-2 grid gap-2">
                {chipOptions.map((option) => {
                  const on = selected.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={on}
                      disabled={frozen}
                      onClick={() => toggleChip(option.key)}
                      className="flex min-h-[44px] items-start gap-[10px] rounded-[var(--r-md)] border px-[13px] py-[11px] text-left text-[13.5px] leading-[1.35] text-[var(--text-primary)]"
                      style={{
                        borderColor: on ? 'var(--red)' : 'var(--border)',
                        background: on ? 'var(--red-wash)' : 'var(--bg-card)',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="mt-[2px] flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] border"
                        style={{
                          borderColor: on
                            ? 'var(--red)'
                            : 'var(--border-hover)',
                          background: on
                            ? 'var(--action-primary-bg)'
                            : 'var(--bg-card)',
                        }}
                      >
                        {on ? (
                          <svg viewBox="0 0 24 24" width="12" height="12">
                            <path
                              d="M5 13l4 4L19 7"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
              {selected.length === 0 ? (
                <p className="mb-0 mt-1 text-[11.5px] leading-4 text-[var(--warning)]">
                  Pick at least one — an empty answer is never saved.
                </p>
              ) : (
                <p className="mb-0 mt-1 text-[11.5px] leading-4 text-[var(--text-tertiary)]">
                  Tap Save to keep these choices.
                </p>
              )}
            </>
          ) : item.kind === 'long' ? (
            <textarea
              value={draft}
              rows={5}
              disabled={frozen}
              onChange={(e) => edit(e.target.value)}
              onBlur={leave}
              className={`${CONTROL} min-h-[88px] leading-[1.45]`}
              style={CONTROL_STYLE}
            />
          ) : item.kind === 'choice' || item.kind === 'yesno' ? (
            <select
              value={draft}
              disabled={frozen}
              onChange={(e) => {
                edit(e.target.value);
                if (e.target.value) void flush(e.target.value, false);
              }}
              className={CONTROL}
              style={CONTROL_STYLE}
            >
              <option value="">Choose…</option>
              {(options.length ? options : ['No', 'Yes']).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : item.kind === 'date' ? (
            <div className="mt-2">
              <DateField
                value={draft}
                onChange={(value) => {
                  edit(value);
                  if (value) void flush(value, false);
                }}
                label={item.label}
                disabled={frozen}
                allowClear
              />
            </div>
          ) : (
            <input
              type="text"
              value={draft}
              disabled={frozen}
              onChange={(e) => edit(e.target.value)}
              onBlur={leave}
              placeholder={item.help ?? ''}
              className={CONTROL}
              style={CONTROL_STYLE}
            />
          )}

          {item.help && item.kind === 'choice' ? (
            <p className="mb-0 mt-1 text-[11.5px] leading-4 text-[var(--text-tertiary)]">
              {item.help}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving || busy || (chips && !selected.length)}
              onPointerDown={() => {
                savingSoon.current = true;
              }}
              onClick={save}
              className="min-h-[44px] rounded-[var(--r-sm)] px-4 text-[13px] font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--action-primary-bg)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {editing ? (
              <button
                type="button"
                disabled={saving || busy}
                // ⚠️ SET ON THE POINTER DOWN, BEFORE THE BLUR. Clicking Cancel
                // blurs the box first; without this the blur would save the
                // very change the member is cancelling.
                onPointerDown={() => {
                  canceling.current = true;
                }}
                onClick={cancel}
                className="min-h-[44px] rounded-[var(--r-sm)] border px-3 text-[13px] font-medium text-[var(--text-primary)] disabled:opacity-50"
                style={{ borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
            ) : null}
            {saving ? (
              <span className="text-[12px] text-[var(--text-tertiary)]">
                Saving…
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {chips ? (
              <ChosenSentences item={item} />
            ) : (
              <div className="mt-[2px] break-words text-[14.5px] font-medium leading-[1.3] text-[var(--text-primary)]">
                {item.value}
              </div>
            )}
            {provenance}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {suggested && onConfirm ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onConfirm(item.key)}
                className="min-h-[44px] rounded-[6px] px-2 text-[13px] font-medium text-[var(--red)] hover:underline disabled:opacity-50"
              >
                Confirm
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => edit(item.value)}
              className="min-h-[44px] rounded-[6px] px-2 text-[13px] font-medium text-[var(--red)] hover:underline disabled:opacity-50"
            >
              {suggested ? 'Edit' : 'Change'}
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="mb-0 mt-1 text-[12px] leading-5 text-[var(--red)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
