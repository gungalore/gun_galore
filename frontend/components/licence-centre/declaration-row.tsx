'use client';

import YesNoPills from '@/components/licence-pack/yes-no-pills';
import type { MotivationField } from '@/lib/motivations-api';
import type { SheetItem } from './contract';

// ────────────────────────────────────────────────────────────────────
// ONE OF THE SIX DECLARATION QUESTIONS.
//
// ⚠️ ASKED OF EVERYBODY, SINCE 2026-09-08, AND THAT IS THE WHOLE POINT OF
// THIS ROW EXISTING. The six history questions used to be `formOnly`, hidden
// behind the SAPS 271 opt-in — so on the dealer path they were never asked at
// all, a conviction never reached the writer, and the document could not
// address the one thing it must meet head-on. The live walkthrough found the
// consequence on screen: the Declarations step carried a green tick from the
// moment the application opened, while its own panel read "H Declarations 0%".
//
// ⚠️ NOTHING IS PRE-SELECTED. yes-no-pills.tsx says why at length and it is
// worth repeating here, because this is the component that could reintroduce
// it: the canvas draws all six rows with "No" already chosen, because it is a
// picture of a FINISHED application. Shipping that would put words about
// somebody's criminal record into their mouth, on a form they sign under
// section 120(9)(f) of the Firearms Control Act.
//
// ⚠️ "No" IS FIRST, AND THAT IS THE REGISTRY'S ORDER, NOT A LAYOUT CHOICE.
// YES_NO is ['No', 'Yes'] so that the easiest tap is not the one that opens a
// disclosure.
// ────────────────────────────────────────────────────────────────────

export interface DeclarationRowProps {
  item: SheetItem;
  onChange: (value: string) => void;
  /**
   * The `_detail` box, and the four form boxes, that a "Yes" opens.
   *
   * ⚠️ THE SERVER DECIDES WHETHER THEY APPLY, not this component. Each arrives
   * with its own `state`, and a `showIf` that has not been met arrives as
   * `na`. The negligence question in particular only exists once lost/stolen
   * is Yes, and that is the registry's rule — mirroring it here would be a
   * second implementation of `isVisible()`, which is exactly what the sheet
   * endpoint was built to retire.
   */
  detail?: SheetItem;
  onDetailChange?: (value: string) => void;
  boxes?: SheetItem[];
  onBoxChange?: (key: string, value: string) => void;
}

/** The sheet's item, in the shape yes-no-pills already speaks. */
function asField(item: SheetItem): MotivationField {
  return {
    key: item.key,
    label: item.label,
    kind: 'yesno',
    section: item.section,
    help: item.help,
    required: item.required || undefined,
  } as MotivationField;
}

export default function DeclarationRow({
  item,
  onChange,
  detail,
  onDetailChange,
  boxes = [],
  onBoxChange,
}: DeclarationRowProps) {
  if (item.state === 'na') return null;

  const answered = !!item.value.trim();
  const yes = item.value.trim() === 'Yes';

  return (
    <div className="flex flex-wrap items-center gap-[14px] border-b border-[var(--border-divider)] py-[10px] last:border-b-0">
      <YesNoPills
        field={asField(item)}
        value={item.value}
        missing={item.required && !answered}
        onChange={onChange}
      />

      {/*
        ⚠️ ONLY A "Yes" OPENS ANYTHING. A "No" adds nothing to the document —
        it is not even sent to the writer (see NEVER_PROMPTED) — so it must not
        add anything to the screen either. Six closed rows is what a clean
        record looks like, and it should look like nothing to do.
      */}
      {yes ? (
        <div className="flex basis-full flex-col gap-2 px-0 pb-[6px] pt-[2px]">
          {detail && detail.state !== 'na' && onDetailChange ? (
            <div>
              <div className="text-[12.5px] leading-[1.3] text-[var(--text-secondary)]">
                {detail.label}
              </div>
              <textarea
                className="mt-[5px] min-h-[88px] w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-[10px] text-[14px] leading-[1.45] text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
                value={detail.value}
                placeholder={detail.help ?? ''}
                onChange={(e) => onDetailChange(e.target.value)}
              />
            </div>
          ) : null}

          {boxes.length && onBoxChange ? (
            <div className="grid grid-cols-2 gap-2">
              {boxes
                .filter((b) => b.state !== 'na')
                .map((b) => (
                  <input
                    key={b.key}
                    type="text"
                    aria-label={b.label}
                    className="h-10 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
                    value={b.value}
                    placeholder={b.help ?? b.label}
                    onChange={(e) => onBoxChange(b.key, e.target.value)}
                  />
                ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
