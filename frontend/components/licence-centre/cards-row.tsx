'use client';

import { useEffect, useRef, useState } from 'react';
import type { SheetItem } from './contract';

// ────────────────────────────────────────────────────────────────────
// THE TILE GRID — `kind: 'cards'`.
//
// ⚠️ SELECTED MEANS TRUE. Every tile is a first-person sentence and the
// applicant signs their name under the document these produce, so a tap is an
// assertion about themselves and only a tapped one reaches the writer. Section
// 120(9)(f) of the Firearms Control Act makes a false statement on an
// application an offence — that is why this is selection and never silent
// inclusion, and why nothing here is ever pre-ticked.
//
// ⚠️ IT REPLACED THE EMPTY TEXTAREA. "The circumstances that make you believe
// you need it" was a required 4000-character box that asked somebody to
// compose, unaided, the hardest paragraph in the document. The tiles are the
// question now; the box below them is optional and prefilled.
// ────────────────────────────────────────────────────────────────────

/** Stored as a comma list in the offered order — exactly like `multi`. */
function parse(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path
        d="M5 13l4 4L19 7"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface CardsRowProps {
  item: SheetItem;
  onChange: (csv: string) => void;
  /**
   * The line that makes the question answerable — "You already hold a CZ 75 in
   * 9mm".
   *
   * ⚠️ IT USED TO LIVE IN A SECOND CONTROL. OverlapCard rendered this prompt
   * with its own copy of the same tiles, writing the same `overlap_angle` key,
   * while the registry row rendered them again lower down — one question, two
   * headings, and the operator could not tell which was which. The registry row
   * is the one that survived: it is the only one with the own-words box and the
   * only one that sits where the section says it should. The prompt came here.
   */
  prompt?: string | null;
  ownWords?: SheetItem;
  onOwnWordsChange?: (value: string) => void;
}

export default function CardsRow({
  item,
  onChange,
  prompt,
  ownWords,
  onOwnWordsChange,
}: CardsRowProps) {
  const options = item.options ?? [];
  /** Long enough that stacking them would run the page off the screen. */
  const scrolls = (item.options ?? []).length > 8;
  const chosen = parse(item.value);
  const answered = chosen.length > 0;

  /**
   * ⚠️ THE MEMBER'S EDIT WINS, AND THIS IS THE FLAG THAT REMEMBERS IT.
   *
   * The own-words box is prefilled by joining the sentences they tapped, so it
   * keeps up while they are still tapping. The moment they TYPE in it, it stops
   * following: re-joining over their sentence would delete what they wrote,
   * which is the never-move-a-field rule with the stakes raised — this is the
   * one box on the screen carrying their own voice into a signed document.
   */
  const touched = useRef(false);
  const [own, setOwn] = useState(ownWords?.value ?? '');

  const prefill = chosen
    .map((k) => options.find((o) => o.key === k)?.sentence)
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (touched.current) return;
    if (ownWords?.value?.trim()) {
      // Something they wrote on an earlier visit. Never overwrite it.
      touched.current = true;
      setOwn(ownWords.value);
      return;
    }
    setOwn(prefill);
  }, [prefill, ownWords?.value]);

  const toggle = (key: string) => {
    const next = chosen.includes(key)
      ? chosen.filter((k) => k !== key)
      : [...chosen, key];
    // ⚠️ NORMALISED TO THE OFFERED ORDER, which is what the server stores and
    // compares. Sending them in tap order would make two identical answers
    // look different on every save.
    onChange(
      options
        .filter((o) => next.includes(o.key))
        .map((o) => o.key)
        .join(', '),
    );
  };

  // Short labels go two-up even on the phone; sentences never do.
  const twoUp = options.every((o) => o.sentence.length <= 34);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-[6px] border-b border-[var(--border-divider)] py-[11px] last:border-b-0">
      <div>
        <div className="flex items-baseline justify-between gap-[10px] text-[12.5px] leading-[1.3] text-[var(--text-secondary)]">
          <span>{item.label}</span>
          <span className="flex items-center gap-[6px]">
            {item.scope === 'profile' ? (
              <span className="inline-flex items-center whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-[2px] text-[10.5px] font-medium leading-[1.4] text-[var(--text-secondary)]">
                saved to your profile
              </span>
            ) : null}
            {answered ? null : item.required ? (
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

        {prompt ? (
          <p className="mt-[6px] mb-0 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-[13px] leading-[1.45] text-[var(--text-secondary)]">
            {prompt}
          </p>
        ) : null}

        {/*
          ⚠️ A SCROLLER ONCE THE SET IS LONG, NOT A WALL. Operator, 2026-09-08:
          "make them a dropdown scrollable box where the user can select from
          there. They should fit the theme the scroll boxes." Sixteen tiles
          stacked down the page pushes everything after them off the screen and
          reads as a form that will not end; a bordered box the same shape as
          every other control on the sheet reads as one answer.

          Under the threshold it stays a plain grid — a box with a scrollbar
          round four options is chrome for its own sake.
        */}
        <div
          className={`mt-[6px] grid gap-2 ${
            scrolls
              ? 'max-h-[280px] overflow-y-auto rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] p-2'
              : ''
          } ${twoUp ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}
        >
          {options.map((o, i) => {
            const on = chosen.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o.key)}
                className={`flex min-h-[44px] items-start gap-[10px] rounded-[var(--r-md)] border px-[13px] py-[11px] text-left text-[13.5px] leading-[1.35] text-[var(--text-primary)] ${
                  on
                    ? 'border-[var(--red)] bg-[var(--red-wash)] font-medium'
                    : 'border-[var(--border)] bg-[var(--bg-card)]'
                }`}
              >
                <span
                  className={`mt-[1px] flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] border ${
                    on
                      ? 'border-[var(--red)] bg-[var(--red)]'
                      : 'border-[var(--border-hover)] bg-white'
                  }`}
                >
                  {on ? <Tick /> : null}
                </span>
                <span>{o.sentence}</span>
                {/*
                  ⚠️ THE FIRST CARD ONLY, AND ONLY WHERE THE SERVER RANKED
                  THEM. "most likely" on an unranked list is the screen
                  guessing, and a guess about somebody's own circumstances is
                  worse than no hint at all.
                */}
                {i === 0 && item.provenance?.inferred ? (
                  <span className="ml-auto flex-shrink-0 self-center whitespace-nowrap text-[10.5px] text-[var(--text-tertiary)]">
                    most likely
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {ownWords && onOwnWordsChange ? (
          <div className="mt-[10px]">
            {/*
              ⚠️ IT HAD TO SAY WHAT IT WAS FOR. "In your own words — optional,
              prefilled from the cards you tapped" describes where the text came
              from and never says what the box DOES, so a member reading it
              cannot tell whether to touch it. Operator, 2026-09-08: "the fill
              yourself block at the bottom of that, it unclear what the block is
              for, make it more obvious." It is now a heading and a sentence:
              this is the paragraph we will write from, edit it or leave it.
            */}
            <div className="text-[12.5px] font-medium text-[var(--text-primary)]">
              Anything you want to add, in your own words
            </div>
            <div className="mt-[2px] text-[11.5px] leading-[1.4] text-[var(--text-tertiary)]">
              We have written this from the cards you tapped. Change it, add to
              it, or leave it exactly as it is — either way it goes into your
              motivation.
            </div>
            <textarea
              className="mt-[5px] min-h-[88px] w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-[10px] text-[14px] leading-[1.45] text-[var(--text-primary)]"
              value={own}
              onChange={(e) => {
                touched.current = true;
                setOwn(e.target.value);
                onOwnWordsChange(e.target.value);
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
