'use client';

// ────────────────────────────────────────────────────────────────────
// "WE READ 6 THINGS OFF THAT. CHECK THEM."
//
// ⚠️ THIS PANEL IS THE WHOLE POINT OF UPLOADING A DOCUMENT, AND THE REBUILT
// WIZARD SHIPPED WITHOUT IT. `addFiles` called addUpload and threw the return
// value away; the server deliberately does not write suggestions into answers
// ("a misread digit in an ID number would otherwise become a false statement
// on a form they sign"), and applyExtraction — the endpoint that writes them
// once somebody has looked — had exactly one call site, in the old page. So a
// member photographed their ID, we paid Vision and Claude to read it, and they
// typed all 129 answers by hand anyway.
//
// Two things the old page's version got wrong, both fixed here.
//
// ⚠️ ONE. IT WAS ALL OR NOTHING. A single button accepted every suggestion at
// once, so a member who spotted one wrong digit had two options: reject the
// whole reading and retype six correct values, or accept a value they had just
// seen was wrong. Nobody retypes six values. Each line is now its own tick.
//
// ⚠️ TWO. IT TREATED A DOUBTED VALUE LIKE A CONFIDENT ONE. `trusted: false`
// means OUR OWN checks disagree with what was read — a serial that fails its
// pattern, a date that cannot be right. Those arrive UNTICKED. The distinction
// has to cost a deliberate tap, because the alternative is a distracted "yes"
// writing a value we already doubt onto a form signed under s120(9)(f).
//
// Nothing here is ever applied automatically. The member says so, or it does
// not happen.
// ────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import type { Suggestion } from '@/lib/motivations-api';
import {
  acceptedFrom,
  defaultTicks,
} from '@/lib/extraction-review-rules';

export default function ExtractionReview({
  suggestions,
  busy,
  onAccept,
  onDismiss,
}: {
  suggestions: Suggestion[];
  busy?: boolean;
  /** Only what the member ticked. Never the whole list. */
  onAccept: (accepted: Record<string, string>) => void;
  onDismiss: () => void;
}) {
  // ⚠️ KEYED ON THE SUGGESTION SET, NOT INITIALISED ONCE. A second document
  // can land while this panel is open; without the key the new lines would
  // inherit the previous set's tick state by position.
  const setKey = useMemo(
    () => suggestions.map((s) => `${s.key}:${s.value}`).join('|'),
    [suggestions],
  );
  // ⚠️ THE RULES LIVE IN lib/, NOT HERE. The frontend suite runs in node with
  // no DOM, so logic inside a component is logic nothing can test — and these
  // three decisions are the entire safety argument for reading somebody's
  // documents. See extraction-review-rules.spec.ts.
  const [ticked, setTicked] = useState<Record<string, boolean>>(() =>
    defaultTicks(suggestions),
  );
  const [seenKey, setSeenKey] = useState(setKey);
  if (seenKey !== setKey) {
    setSeenKey(setKey);
    setTicked(defaultTicks(suggestions));
  }

  if (!suggestions.length) return null;

  const chosen = suggestions.filter((s) => ticked[s.key]);
  const doubted = suggestions.filter((s) => !s.trusted).length;

  return (
    <div
      className="gg-tile rounded-[10px] border px-4 py-3.5"
      style={{
        borderColor: 'var(--success-line)',
        background: 'var(--success-wash)',
      }}
    >
      <p className="text-[13.5px] font-semibold">
        We read {suggestions.length}{' '}
        {suggestions.length === 1 ? 'thing' : 'things'} off that
      </p>
      <p className="mt-0.5 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
        Check each one against the document before you accept it — you are the
        one who signs this.
        {doubted > 0 && (
          <>
            {' '}
            {doubted === 1 ? 'One is' : `${doubted} are`} unticked because our
            own checks disagree with what was read.
          </>
        )}
      </p>

      <ul className="mt-3 space-y-px">
        {suggestions.map((s) => {
          const on = !!ticked[s.key];
          return (
            <li key={s.key}>
              <label
                className="flex cursor-pointer items-start gap-2.5 rounded-[6px] px-2 py-2 hover:bg-[var(--bg-card)]"
                style={{ background: on ? 'var(--bg-card)' : 'transparent' }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={(e) =>
                    setTicked((cur) => ({ ...cur, [s.key]: e.target.checked }))
                  }
                  className="mt-[3px] h-[15px] w-[15px] shrink-0 accent-[var(--red)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px]">
                    <span className="text-[var(--text-tertiary)]">
                      {s.label}:{' '}
                    </span>
                    <span className="font-medium">{s.value}</span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-[var(--text-tertiary)]">
                    from {s.from}
                    {s.note ? ` — ${s.note}` : ''}
                  </span>
                </span>
                {/* Gold, never red. A value that needs checking is not an
                    error — the same rule the provenance pills follow. */}
                {!s.trusted && (
                  <span
                    className="mt-[1px] shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                    style={{
                      background: 'var(--gold-wash)',
                      color: 'var(--gold-strong)',
                      border: '1px solid var(--gold-line)',
                    }}
                  >
                    Check this
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || chosen.length === 0}
          onClick={() => onAccept(acceptedFrom(suggestions, ticked))}
          className="rounded-[var(--r-sm)] border-0 bg-[var(--red)] px-4 py-[9px] text-[13px] font-semibold text-white disabled:opacity-45"
        >
          {/* The count is on the button because the member chose it. "Use
              these" alone hides how many they are about to sign for. */}
          {chosen.length === suggestions.length
            ? 'These are right — use them'
            : chosen.length === 0
              ? 'Nothing ticked'
              : `Use the ${chosen.length} I ticked`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="rounded-[var(--r-sm)] border border-[var(--border)] bg-transparent px-4 py-[9px] text-[13px] text-[var(--text-secondary)]"
        >
          I&rsquo;ll type them myself
        </button>
      </div>
    </div>
  );
}
