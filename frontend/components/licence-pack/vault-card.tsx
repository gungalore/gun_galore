'use client';

// ────────────────────────────────────────────────────────────────────
// "WE ALREADY KNOW WHICH ONE." A document the member already holds,
// presented as one settled thing rather than a row of empty boxes.
//
// The artboard's competency and dedicated-status steps both use this shape: a
// green-washed card with a check circle, the document's own title, a chip
// naming where it came from, a meta row of the two or three facts that matter,
// and a quiet way to change it.
//
// ⚠️ GREEN MEANS "WE HAVE THIS", GOLD MEANS "SOMEBODY ELSE OWES IT", WHITE
// MEANS "NOT YET". Never red — a document that has not arrived is not an
// error, and on a firearms application the third-party waits are the ones a
// member can do least about.
//
// Measurements off the artboard: 8px radius, 15px/17px padding, a 20px check
// circle, title 14.5px/600, chip 11px/600 in a 999px pill, meta 12.5px with
// the label in --text-tertiary above a 13.5px value.
// ────────────────────────────────────────────────────────────────────

export type VaultCardState = 'have' | 'waiting' | 'missing';

const LOOK: Record<
  VaultCardState,
  { border: string; background: string; ink: string }
> = {
  have: {
    border: 'var(--success-line)',
    background: 'var(--success-wash)',
    ink: 'var(--success)',
  },
  waiting: {
    border: 'var(--gold-line)',
    background: 'var(--gold-wash)',
    ink: 'var(--gold-strong)',
  },
  missing: {
    border: 'var(--border)',
    background: 'var(--bg-card)',
    ink: 'var(--text-tertiary)',
  },
};

function Tick() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function VaultCard({
  state,
  title,
  chip,
  meta,
  note,
  action,
}: {
  state: VaultCardState;
  title: string;
  /** Where it came from, in the server's own words. */
  chip?: string;
  /** The two or three facts that decide whether this document is usable. */
  meta?: { label: string; value: string }[];
  note?: string;
  action?: React.ReactNode;
}) {
  const look = LOOK[state];

  return (
    <div
      className="gg-tile rounded-[var(--r-md)] border px-[17px] py-[15px]"
      style={{ borderColor: look.border, background: look.background }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={
            state === 'missing'
              ? {
                  border: '1px solid var(--border-hover)',
                  color: 'var(--text-tertiary)',
                }
              : { background: look.ink, color: '#fff' }
          }
        >
          {state === 'missing' ? (
            <span className="text-[11px] font-bold">?</span>
          ) : state === 'waiting' ? (
            <span className="text-[11px] font-bold">!</span>
          ) : (
            <Tick />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14.5px] font-semibold text-[var(--text-primary)]">
              {title}
            </span>
            {/* ⚠️ THE SERVER'S OWN WORDS. Provenance carries its own label so
                the API, the printed pack and this chip cannot drift. */}
            {chip && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                }}
              >
                {chip}
              </span>
            )}
          </div>

          {meta && meta.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-x-8 gap-y-2">
              {meta.map((m) => (
                <div key={m.label}>
                  <div className="text-[11px] uppercase tracking-[.08em] text-[var(--text-tertiary)]">
                    {m.label}
                  </div>
                  <div className="mt-0.5 text-[13.5px] text-[var(--text-primary)]">
                    {/* An empty fact says so rather than showing a gap. */}
                    {m.value || (
                      <span className="italic text-[var(--text-tertiary)]">
                        Not on the document
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {note && (
            <p className="mt-2.5 text-[12.5px] leading-snug text-[var(--text-secondary)]">
              {note}
            </p>
          )}

          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}
