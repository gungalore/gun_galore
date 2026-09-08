'use client';

import type { CardOption } from './contract';

// ────────────────────────────────────────────────────────────────────
// "You already hold a CZ 75 in 9mm. This one will be my ___".
//
// ⚠️ THE SINGLE HIGHEST-VALUE ANSWER IN THE PRODUCT, and until now it arrived
// as an empty textarea labelled "overlap justification" on step 3. "Do you
// already hold something that does this job" is the question that gets a
// second medium-game rifle refused, and the Registrar asks it whether or not
// we raised it first.
//
// ⚠️ IT RENDERS ONLY WHEN THERE IS AN OVERLAP TO EXPLAIN. The server returns
// `suggestedAngle: null` on a clear verdict, and nothing appears — we never
// invent a difficulty to argue against. An applicant who holds nothing
// similar should not be shown a card implying they do.
//
// ⚠️ THE OPTIONS ARE RANKED BY THE SERVER, NEVER CHOSEN HERE. The vocabulary
// is fixed in motivation-cards.ts so a stored answer can be validated on save;
// which of them lead comes from the type, action, calibre class and section of
// what is already held.
// ────────────────────────────────────────────────────────────────────

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

export interface OverlapCardProps {
  /** What the server says they already hold — its own sentence, rendered as given. */
  prompt: string | null;
  angles: CardOption[] | null;
  /** Comma list, exactly as `overlap_angle` stores it. */
  chosen: string;
  onPick: (csv: string) => void;
}

export default function OverlapCard({
  prompt,
  angles,
  chosen,
  onPick,
}: OverlapCardProps) {
  if (!angles || angles.length === 0) return null;

  const picked = chosen
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const toggle = (key: string) => {
    const next = picked.includes(key)
      ? picked.filter((k) => k !== key)
      : [...picked, key];
    onPick(
      angles
        .filter((a) => next.includes(a.key))
        .map((a) => a.key)
        .join(', '),
    );
  };

  return (
    // `.gg-tile` because globals.css kills every box-shadow that does not
    // carry it — see the CSS traps in CLAUDE.md.
    <div className="gg-tile my-[10px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[14px] py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        What this one will be
      </div>
      {prompt ? (
        <p className="m-0 mt-[6px] text-[13.5px] leading-[1.4] text-[var(--text-secondary)]">
          {prompt}
        </p>
      ) : null}
      <div className="mt-[10px] grid gap-2">
        {angles.map((a) => {
          const on = picked.includes(a.key);
          return (
            <button
              key={a.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(a.key)}
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
              <span>{a.sentence}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
