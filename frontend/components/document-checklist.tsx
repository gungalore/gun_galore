'use client';

import type { DocumentNeed, LibraryItem, UploadRow } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// ONE LIST, ONE BUTTON.
//
// Every requirement used to carry its own camera, its own picker, its own
// library dropdown and its own error line — seven rows of that, and the
// operator's word for it was "long". The information was right and the shape
// was wrong: the member is doing ONE thing at a time, so there is one control
// and the list says what it is pointed at.
//
// Pick the line, press the button. The line then reports what happened:
//
//   GREEN + tick  attached, and the extraction agreed it is what you said
//   AMBER + !     attached, but we could not read what that document carries
//                 — usually the wrong type picked, occasionally a bad photo
//   PLAIN         nothing attached yet
//
// ⚠️ THE SAFE IS ONE LINE AND THREE PHOTOGRAPHS. It does not go green until
// all three are in, and it says how many are still to come — an applicant who
// reads "photographs of your safe" and sends one has satisfied the phrase
// while the pack is short two shots nobody noticed.
//
// The line no longer says WHICH shot is missing, and cannot: the three used to
// be three upload kinds, and they were collapsed on 2026-08-23 because nothing
// could tell them apart — a wrong guess filed the bolts shot under the
// closed-door annexure. What names them now is the row's `why`, which is shown
// on the selected row and lists every shot.
// ────────────────────────────────────────────────────────────────────

export type Tier = 'required' | 'expected' | 'strengthens' | 'extra';

/**
 * The groups, in the order they are shown.
 *
 * ⚠️ THE WORDING CARRIES THE DISTINCTION THE BADGES USED TO. "SAPS will not
 * process without these" is a statement about the Act; "your DFO will ask for
 * these" is a statement about practice, and the endorsement lives there
 * precisely because it has no statute behind it.
 */
const GROUPS: { tier: Tier; title: string }[] = [
  { tier: 'required', title: 'SAPS will not process the application without these' },
  { tier: 'expected', title: 'Your DFO will ask for these' },
  { tier: 'strengthens', title: 'Not asked for — but they make the case' },
  { tier: 'extra', title: 'Anything else' },
];

export interface ChecklistRow extends DocumentNeed {
  /** Attached files that answer this line. */
  files: UploadRow[];
  /** Library documents that could answer it without another photograph. */
  reusable: LibraryItem[];
}

export default function DocumentChecklist({
  rows,
  selected,
  onSelect,
  renderControls,
  onView,
  onRemove,
  onReread,
}: {
  rows: ChecklistRow[];
  selected: string;
  onSelect: (kind: string) => void;
  /**
   * The add controls, rendered INSIDE the selected row.
   *
   * ⚠️ THEY USED TO SIT IN A PANEL UNDER THE LIST, with a line reading
   * "Adding: A copy of your ID" to say which row they pointed at. That line
   * existed because the controls were in the wrong place: a control that has
   * to announce its own target is one the eye has to travel to and back. In
   * the row, the row IS the label.
   */
  renderControls: (row: ChecklistRow) => React.ReactNode;
  onView: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Read an attached document again after a failed read. */
  onReread: (id: string) => Promise<void>;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Which document are you adding?"
      className="rounded border border-[var(--border)]"
    >
      {/* ⚠️ ONE HEADING PER GROUP, INSTEAD OF A BADGE PER ROW. Five of seven
          rows carried "SAPS needs this", which is a label that has stopped
          labelling anything. The same fact stated once over the group it
          applies to is shorter AND clearer. */}
      {GROUPS.map((g) => {
        const mine = rows.filter((r) => r.tier === g.tier);
        if (mine.length === 0) return null;
        return (
          <div key={g.tier}>
            <p className="border-b border-[var(--border-divider)] bg-[var(--bg-inset)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
              {g.title}
            </p>
            <ul className="divide-y divide-[var(--border-divider)]">
              {mine.map((r) => (
                <Row
                  key={r.kind}
                  row={r}
                  checked={selected === r.kind}
                  onSelect={() => onSelect(r.kind)}
                  controls={selected === r.kind ? renderControls(r) : null}
                  onView={onView}
                  onRemove={onRemove}
                  onReread={onReread}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Row({
  row,
  checked,
  onSelect,
  controls,
  onView,
  onRemove,
  onReread,
}: {
  row: ChecklistRow;
  checked: boolean;
  onSelect: () => void;
  /** Rendered only on the selected row. */
  controls: React.ReactNode;
  onView: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Read an attached document again after a failed read. */
  onReread: (id: string) => Promise<void>;
}) {
  // ⚠️ AMBER IS NOT "BROKEN", IT IS "CHECK THIS". The document is attached and
  // will go in the pack either way; what we are saying is that nothing we
  // expected to find on it was there, which usually means the wrong line was
  // selected.
  const suspect = row.have && row.files.some((f) => f.suspect);
  const state: 'done' | 'suspect' | 'todo' = !row.have
    ? 'todo'
    : suspect
      ? 'suspect'
      : 'done';

  const colour =
    state === 'done'
      ? 'var(--success)'
      : state === 'suspect'
        ? 'var(--gold-line)'
        : 'var(--text-tertiary-on-card)';

  // How many more files this line wants. Only the safe asks for more than one.
  const stillWanted = Math.max(0, (row.minFiles ?? 1) - row.files.length);

  return (
    <li
      className="p-3"
      style={{
        background:
          state === 'done'
            ? 'rgba(47,158,107,0.08)'
            : state === 'suspect'
              ? 'var(--gold-wash)'
              : undefined,
      }}
    >
      <label className="flex cursor-pointer gap-3">
        <input
          type="radio"
          name="which-document"
          className="mt-1"
          checked={checked}
          onChange={onSelect}
          aria-label={row.label}
        />
        <span className="flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden style={{ color: colour }}>
              {state === 'done' ? '✓' : state === 'suspect' ? '!' : '○'}
            </span>
            <span
              className="text-sm"
              style={{
                color: state === 'done' ? 'var(--success)' : undefined,
              }}
            >
              {row.label}
            </span>
            {/* ⚠️ NO PER-ROW BADGES. "SAPS needs this" hung off five of seven
                rows, which is a label that has stopped labelling anything —
                and the operator's word for the result was clutter. Order
                carries it instead: required first, then what the DFO expects,
                then the optional ones, under one heading each. */}
          </span>

          {/* THE SAFE, WHILE IT IS SHORT. Only on a line that wants several
              files, and only while it is incomplete — once they are all in,
              saying so again is noise.

              ⚠️ IT COUNTS FILES, WHICH IS WEAKER THAN IT LOOKS: three
              photographs of the same shut door count as three. The row's `why`
              is what tells the member which pictures to take, and it is the
              reason the count is a prompt rather than a claim. */}
          {(row.minFiles ?? 1) > 1 && stillWanted > 0 && (
            <span className="mt-1 block text-xs text-[var(--text-secondary)]">
              {row.files.length === 0
                ? `Add ${row.minFiles} here. `
                : `${stillWanted} more to add — ${row.files.length} of ${row.minFiles} so far. `}
              {row.minFilesNote}
            </span>
          )}

          {state === 'suspect' && (
            // ⚠️ THIS USED TO BLAME THE DOCUMENT, and it was often wrong. The
            // read is fail-soft: a timeout or a busy model returns nothing at
            // all, indistinguishable here from a genuinely unreadable
            // photograph — and nothing ever tried again, so a perfectly good
            // proof of address sat amber telling its owner to re-photograph
            // it. Say what we know, offer the cheap thing first.
            <span className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>
              Attached, but we could not read anything off it. That is often
              just us — try again first. If it keeps failing, check you picked
              the right line and that the photograph shows the whole page. It
              stays in your pack either way.{' '}
              <button
                type="button"
                className="underline"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const f = row.files.find((x) => x.suspect);
                  if (f) await onReread(f.id);
                }}
              >
                Try reading it again
              </button>
            </span>
          )}

          {/* ⚠️ THE EXPLANATION MOVED TO THE SELECTED ROW ONLY. A toggle on
              every line was a control per row that mostly said "not now" —
              and the reason is worth reading exactly once, about the document
              you are actually adding. */}
          {checked && row.why && (
            <span className="mt-1 block text-xs text-[var(--text-secondary)]">
              {row.why}
            </span>
          )}

          {/* ⚠️ ONE LINE, AND ONLY ON THE SELECTED ROW. Seven rows each
              carrying their own camera, picker and dropdown is the clutter
              this replaced; the same three controls on the ONE row somebody
              is acting on is a toolbar.
              ⚠️ NO preventDefault ON THIS WRAPPER, however tempting. These
              controls live inside the row's <label>, so the instinct is to
              stop a click here re-firing the radio — but the file picker IS a
              <label for> whose default action is to open the file dialog, and
              cancelling the bubbled click kills it. Nothing needs guarding:
              controls render only on the already-selected row, so re-checking
              a checked radio fires no change at all. */}
          {controls && (
            <span className="mt-2 flex flex-wrap items-center gap-2">
              {controls}
            </span>
          )}

          {row.files.length > 0 && (
            <span className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              {row.files.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-2">
                  <span className="text-[var(--text-secondary)]">
                    {f.annexure ? `Annexure ${f.annexure}` : 'Attached'}
                  </span>
                  {f.available && (
                    <button
                      type="button"
                      className="underline"
                      onClick={(e) => {
                        e.preventDefault();
                        void onView(f.id);
                      }}
                    >
                      View
                    </button>
                  )}
                  <button
                    type="button"
                    className="underline"
                    onClick={(e) => {
                      e.preventDefault();
                      void onRemove(f.id);
                    }}
                  >
                    Remove
                  </button>
                </span>
              ))}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
