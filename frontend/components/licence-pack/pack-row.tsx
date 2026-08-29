'use client';

// ────────────────────────────────────────────────────────────────────
// ONE ROW OF THE PACK. The core unit of the whole screen.
//
// ⚠️ THREE STATES, NOT A TICKBOX. `done` is a boolean and the design is not:
// "not started" and "waiting on someone" look identical to a checkbox and are
// completely different to a member. One is work they have to do; the other is
// work they cannot do and should stop worrying about.
//
// ⚠️ WAITING IS GOLD, NEVER RED. A row waiting on a third party is not an
// error and must not be dressed as one. The tokens are --gold-wash /
// --gold-line, which exist precisely because you cannot alpha-dilute a var()
// by appending hex digits — see the note beside them in globals.css.
//
// ⚠️ ELEVATION COMES FROM .gg-tile, NEVER FROM A SHADOW UTILITY.
// `* { box-shadow: none !important }` is global on this site, so a Tailwind
// shadow class renders flat and the row looks like a naive port of the
// mockup. The class is the opt-in.
// ────────────────────────────────────────────────────────────────────

import type { ChecklistItem } from '@/lib/motivations-api';

/** What each state looks like, and what it says. */
const STATE = {
  done: {
    border: 'var(--success-line)',
    background: 'var(--success-wash)',
    ink: 'var(--success)',
  },
  'waiting-on-someone': {
    border: 'var(--gold-line)',
    background: 'var(--gold-wash)',
    ink: 'var(--gold-strong)',
  },
  'not-started': {
    border: 'var(--border)',
    background: 'var(--bg-card)',
    ink: 'var(--text-tertiary)',
  },
} as const;

export default function PackRow({
  item,
  expanded = false,
  onToggle,
}: {
  item: ChecklistItem;
  expanded?: boolean;
  onToggle?: (key: string) => void;
}) {
  // ⚠️ FALL BACK TO 'not-started', NEVER CRASH ON AN UNKNOWN STATE. The server
  // owns this union; a value we do not recognise is a deploy skew, and a row
  // that renders plainly is better than a screen that does not render.
  const look = STATE[item.state] ?? STATE['not-started'];
  const hasDetail = Boolean(item.note || item.annexure);
  const interactive = hasDetail && Boolean(onToggle);

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] leading-snug text-[var(--text-primary)]">
            {item.label}
          </p>
          {/* The closer is the design's whole point: not "required", but who
              can close this and how. The server always sends one. */}
          <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">
            {item.closer}
          </p>
        </div>

        <span
          className="shrink-0 rounded-[var(--r-sm)] px-2 py-0.5 text-[11px] font-semibold"
          style={{ color: look.ink, border: `1px solid ${look.border}` }}
        >
          {item.state === 'done'
            ? 'Done'
            : item.state === 'waiting-on-someone'
              ? 'With them'
              : 'To do'}
        </span>
      </div>

      {/* ⚠️ A ROW THAT MUST BE CHECKED BEFORE USE SAYS SO WHERE IT IS READ.
          `verifyBeforeUse` is on the SAPS form row because a DFO's own copy
          may differ from ours, and a member who prints the wrong one is sent
          home. It is not a footnote. */}
      {item.verifyBeforeUse && (
        <p className="mt-2 text-[12px] text-[var(--gold-strong)]">
          Check this against your DFO&rsquo;s own copy before you use it.
        </p>
      )}

      {expanded && item.note && (
        <p className="mt-2 border-t border-[var(--border-divider)] pt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {item.note}
        </p>
      )}

      {expanded && item.annexure && (
        <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
          Filed as Annexure {item.annexure}.
        </p>
      )}
    </>
  );

  const style = {
    borderColor: look.border,
    background: look.background,
  };
  const shared =
    'gg-tile w-full rounded-[var(--r-md)] border px-[15px] py-[13px] text-left';

  // ⚠️ A BUTTON ONLY WHERE THERE IS SOMETHING TO OPEN. Wrapping every row in a
  // button gives a keyboard user a tab stop that does nothing, and a screen
  // reader a control with no action.
  if (!interactive) {
    return (
      <div className={shared} style={style}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onToggle?.(item.key)}
      aria-expanded={expanded}
      className={`${shared} gg-tile-lift cursor-pointer`}
      style={style}
    >
      {body}
    </button>
  );
}
