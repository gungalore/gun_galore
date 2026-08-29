'use client';

// ────────────────────────────────────────────────────────────────────
// ONE REGISTRY FIELD, RENDERED.
//
// Extracted verbatim from app/motivations/[id]/page.tsx on 2026-08-29, where
// it had been module-private and therefore unreachable by any other screen.
// Nothing about its behaviour changed in the move — the pack screen at
// /licence-services/[id] needs exactly this control, and a second copy of a
// field renderer is a second set of rules about what a locked value looks
// like and when a date is allowed.
//
// ⚠️ THE LOCKED STATE IS THE POINT, NOT DECORATION. A value we filled in is
// shown IN PLACE, greyed, with an edit pen — never blanked, never moved, and
// never taken away. The lock is decided ONCE at load and never from the live
// value, because a field that re-locks itself while somebody is typing in it
// is the bug this treatment exists to prevent.
// ────────────────────────────────────────────────────────────────────

import DateField from '@/components/date-field';
import { formatLong, parseIso, todayYmd } from '@/lib/date-picker-model';
import type { MotivationField } from '@/lib/motivations-api';

export default function FieldInput({
  field,
  value,
  missing,
  locked = false,
  onUnlock,
  onPick,
  onPickMulti,
  onChange,
}: {
  field: MotivationField;
  value: string;
  missing: boolean;
  /** We filled this in. Shown, greyed, with a pen — never taken away. */
  locked?: boolean;
  onUnlock?: () => void;
  /** Choice fields that seed another field route through here instead. */
  onPick?: (field: MotivationField, value: string) => void;
  onPickMulti?: (field: MotivationField, values: string[]) => void;
  onChange: (v: string) => void;
}) {
  // EXPLICIT background and colour on every control.
  //
  // ⚠️ The reason below still holds; the premise it used to give did not. It
  // said "the site is dark (--bg #0f0f0f)" — true before the white retail
  // skin, and wrong since. <body> sets its text colour explicitly, but a
  // <select> or <input> with no background of its own gets the BROWSER's
  // default light chrome — so the inherited white text landed on white and was
  // invisible. Operator, 2026-08-19: "I can't read the dropdown menus".
  //
  // `[&>option]` covers the popup list too: on Windows the option list is
  // painted by the OS and does not inherit the select's colours.
  const base =
    'mt-1 w-full rounded border px-3 py-2 text-sm ' +
    'bg-[var(--bg-inset)] text-[var(--text-primary)] ' +
    '[&>option]:bg-[var(--bg-card)] [&>option]:text-[var(--text-primary)] ' +
    'focus:border-[var(--border-hover)] focus:outline-none ' +
    (missing ? 'border-[var(--warning)]' : 'border-[var(--border)]');

  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={field.key}>
        {field.label}
        {field.required && <span aria-hidden> *</span>}
      </label>
      {field.help && (
        <p className="mt-0.5 text-xs text-[var(--text-tertiary-on-card)]">{field.help}</p>
      )}

      {/* WHAT WE FILLED IN FOR THEM.
          In place, in its own section, so nothing reflows — the value is
          visible and the pen opens it. POPIA needs it correctable; the
          operator needs it to stop moving while they type. */}
      {locked ? (
        <div className="mt-1 flex items-center gap-2">
          <div className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            {/* A date reads as a date even while locked. Pure formatting —
                an unparseable legacy value falls through to its raw text
                rather than being hidden behind a pretty one. */}
            {field.kind === 'date' && parseIso(value)
              ? formatLong(parseIso(value)!)
              : value}
          </div>
          <button
            type="button"
            onClick={onUnlock}
            aria-label={`Edit ${field.label}`}
            title="Edit"
            className="rounded border border-[var(--border)] px-2 py-2 text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        </div>
      ) : (
        <>
      {field.kind === 'long' && (
        <textarea
          id={field.key}
          className={base}
          rows={5}
          maxLength={field.maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {/* DATES GET THE THREE-STEP PICKER. Split out of the short/date
          union because a date is no longer an <input> — and because this is
          the one field kind the backend never validates, so a control that
          can only ever emit a whole, real date is the only thing between the
          wizard and a half-typed answer being autosaved and then locked
          behind the edit pen on the next load. */}
      {field.kind === 'date' && (
        <DateField
          id={field.key}
          label={field.label}
          value={value}
          onChange={onChange}
          className={base}
          invalid={missing}
          focusYear={todayYmd().y + (field.focusOffsetYears ?? 0)}
          reach={field.reach ?? 'near'}
        />
      )}

      {field.kind === 'short' && (
        <input
          id={field.key}
          type="text"
          className={base}
          maxLength={field.maxLength}
          inputMode={/(^|_)id_number$/.test(field.key) ? 'numeric' : undefined}
          value={value}
          onChange={(e) =>
            onChange(
              // An SA ID is digits only, and people type it with spaces. The
              // maxLength cap counts characters, so the spaces used to stop
              // the last digits from ever being typed.
              /(^|_)id_number$/.test(field.key)
                ? e.target.value.replace(/\D/g, '')
                : e.target.value,
            )
          }
        />
      )}

      {(field.kind === 'choice' || field.kind === 'yesno') &&
        !field.optionGroups && (
          <select
            id={field.key}
            className={base}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Choose…</option>
            {(field.choices ?? ['No', 'Yes']).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

      {/* A SERVED LIST — the shooting disciplines, grouped by family.
          A stored value we do not recognise is shown as its own option
          rather than silently reset: before this was a dropdown it was a
          text box, and somebody's typed answer is still their answer. */}
      {field.optionGroups && field.kind !== 'multi' && (
        <select
          id={field.key}
          className={base}
          value={value}
          onChange={(e) => onPick?.(field, e.target.value) ?? onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {value.trim() !== '' &&
            !field.optionGroups.some((g) =>
              g.options.some((o) => o.value === value),
            ) && (
              <option value={value}>{value} (what you typed before)</option>
            )}
          {field.optionGroups.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      {/* ⚠️ A GROUPED MULTI IS NOT A ROW OF CHECKBOXES. This renderer draws
          one box per `choices` entry, which is right for the three competency
          types and hopeless for fifty-nine disciplines in eleven groups — and
          would have drawn NOTHING at all, because an optionSource field has no
          `choices` array. Grouped multi-selects get chips-plus-a-picker
          below. */}
      {field.kind === 'multi' && !field.optionGroups && (
        <div className="mt-1 flex flex-wrap gap-3">
          {(field.choices ?? []).map((c) => {
            const picked = value
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
            return (
              <label key={c} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(c)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...picked, c]
                      : picked.filter((x) => x !== c);
                    // Normalised to the offered order so the server's own
                    // ordering and ours agree.
                    onChange(
                      (field.choices ?? [])
                        .filter((x) => next.includes(x))
                        .join(', '),
                    );
                  }}
                />
                {c}
              </label>
            );
          })}
        </div>
      )}
      {/* A GROUPED MULTI — the shooting disciplines.
          Chips for what is chosen, a picker to add the next one. The same
          shape the operator asked for on associations: the list you have is
          visible and removable, and adding another is one deliberate act
          rather than a wall of fifty-nine checkboxes. */}
      {field.kind === 'multi' && field.optionGroups && (
        <MultiPicker field={field} value={value} onPickMulti={onPickMulti} />
      )}

        </>
      )}
    </div>
  );
}

/**
 * Chips plus a picker, for a multi-select whose options are grouped.
 *
 * Values are stored comma-joined, which is what the server validates and
 * normalises — see the `multi` branch of saveAnswers.
 */
function MultiPicker({
  field,
  value,
  onPickMulti,
}: {
  field: MotivationField;
  value: string;
  onPickMulti?: (field: MotivationField, values: string[]) => void;
}) {
  const chosen = value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const all = field.optionGroups?.flatMap((g) => g.options) ?? [];
  const labelFor = (v: string) =>
    all.find((o) => o.value === v)?.label ?? v;

  const set = (next: string[]) => {
    // Normalised to the offered order, so our ordering and the server's agree
    // and two identical answers compare equal.
    const order = all.map((o) => o.value);
    const known = order.filter((v) => next.includes(v));
    // Anything we do not recognise is still their answer — keep it, at the end.
    const unknown = next.filter((v) => !order.includes(v));
    onPickMulti?.(field, [...known, ...unknown]);
  };

  return (
    <div className="mt-1">
      {chosen.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {chosen.map((v) => (
            <li key={v}>
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-inset)] py-1 pl-3 pr-1 text-sm">
                {labelFor(v)}
                <button
                  type="button"
                  aria-label={`Remove ${labelFor(v)}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
                  onClick={() => set(chosen.filter((x) => x !== v))}
                >
                  &times;
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <select
        id={field.key}
        className="w-full rounded border border-[var(--border)] bg-[var(--bg-card)] p-2 text-sm"
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          set([...chosen, e.target.value]);
        }}
      >
        <option value="">
          {chosen.length ? 'Add another discipline…' : 'Choose a discipline…'}
        </option>
        {field.optionGroups?.map((g) => {
          const left = g.options.filter((o) => !chosen.includes(o.value));
          if (!left.length) return null;
          return (
            <optgroup key={g.group} label={g.group}>
              {left.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
