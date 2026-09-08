'use client';

import { useMemo, useState } from 'react';
import type { DangerArea } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// "DO YOU DRIVE THROUGH HERE?"
//
// Operator, 2026-09-08: "pull the areas and list them and ask the user if he
// travels through these areas regularly", and "lets them just tick the ones
// they travel through with a reason thats optional for the reason being in
// that area".
//
// ⚠️ THE QUESTION IS ABOUT THEIR LIFE, NOT ABOUT OUR FILING. The screen this
// replaces would have been a list of fourteen articles with tick boxes —
// "which of these would you like in your pack" — which nobody can answer,
// because the applicant has no view on which cutting argues best. They DO know
// which roads they drive. The articles follow from the answer, chosen on the
// server.
//
// ⚠️ AND IT IS THE ONLY THING THAT CAN WRITE `press_clippings`. That key is
// `internal`; its registry comment says the wizard writes it once the member
// has picked — and Phase 4 deleted the wizard, so the annexure has been
// unreachable ever since. This is the picker.
//
// ⚠️ THE REASON IS OPTIONAL AND IT IS THE BEST PART. "My daughter's school is
// there" is the sentence that turns a printout of somebody else's crime into
// this applicant's own exposure, and a required box would get "work" typed
// into it eleven times.
// ────────────────────────────────────────────────────────────────────

export interface DangerAreasProps {
  areas: DangerArea[];
  /** The applicant's own station, for the empty state's wording. */
  station: string | null;
  withinKm: number;
  /**
   * Has the member ever answered this question?
   *
   * ⚠️ IT IS WHAT STOPS THE COMMUTE UNDOING A DECISION. An area on the route
   * is pre-ticked, and a member who deliberately UNTICKS one has said
   * something — Maps drew a road they do not take. Without this the next load
   * would tick it again, for ever, because `onRoute` is still true.
   */
  answered: boolean;
  busy?: boolean;
  onSave: (ticked: { key: string; reason?: string }[]) => void;
}

/** "2 reports · armed robbery · 19km away" — why this row is on the list. */
function meta(a: DangerArea): string {
  const bits: string[] = [
    a.count === 1 ? '1 report' : `${a.count} reports`,
    ...a.crimeTypes.slice(0, 2),
  ];
  if (a.distanceKm !== null) bits.push(`${Math.round(a.distanceKm)} km away`);
  return bits.join(' · ');
}

export default function DangerAreas({
  areas,
  station,
  withinKm,
  answered,
  busy,
  onSave,
}: DangerAreasProps) {
  /**
   * ⚠️ A DRAFT, SEEDED ONCE FROM THE SERVER. The page refetches the sheet after
   * every save, and re-seeding on each render would wipe a half-typed reason
   * the moment an unrelated answer landed — the same failure the sheet rows
   * carry a `touched` ref for.
   */
  const [ticks, setTicks] = useState<Record<string, string | true>>(() => {
    const seed: Record<string, string | true> = {};
    for (const a of areas) {
      // ⚠️ THE COMMUTE PRE-TICKS ONLY UNTIL THEY HAVE ANSWERED ONCE. After
      // that their ticks are the answer, and an area they removed stays
      // removed however confidently Maps draws the road.
      if (a.ticked || (!answered && a.onRoute)) seed[a.key] = a.reason ?? true;
    }
    return seed;
  });

  const chosen = useMemo(
    () =>
      Object.entries(ticks).map(([key, v]) =>
        typeof v === 'string' && v.trim() ? { key, reason: v.trim() } : { key },
      ),
    [ticks],
  );

  if (!areas.length) {
    /**
     * ⚠️ AN EMPTY LIST EXPLAINS ITSELF. A section that renders nothing is
     * indistinguishable from one that is broken, and this one depends on a
     * station, a geocoder and twelve months of somebody else's RSS.
     */
    return (
      <div className="mt-4 rounded-[var(--r-md)] border border-[var(--border)] px-[14px] py-[12px]">
        <h3 className="m-0 font-[family-name:var(--font-head)] text-[13.5px] font-medium text-[var(--text-primary)]">
          Where you travel
        </h3>
        <p className="m-0 mt-1 text-[12.5px] leading-[1.45] text-[var(--text-secondary)]">
          {station
            ? `We found no crime reporting within ${withinKm} km of ${station} in the last twelve months. Your own precinct’s figures still go in the pack.`
            : 'Tell us your nearest police station and we will show you the areas around you that the local press reports crime in.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-[var(--r-md)] border border-[var(--border)] px-[14px] py-[4px]">
      <div className="border-b border-[var(--border-divider)] py-[10px]">
        <h3 className="m-0 font-[family-name:var(--font-head)] text-[13.5px] font-medium text-[var(--text-primary)]">
          Where you travel
        </h3>
        <p className="m-0 mt-1 text-[12.5px] leading-[1.45] text-[var(--text-secondary)]">
          The local press reported these within {withinKm} km of you in the last
          twelve months. Tick the ones you travel through — we put those
          cuttings and each area’s police figures in your pack.
        </p>
      </div>

      <ul className="m-0 list-none p-0">
        {areas.map((a) => {
          const on = a.key in ticks;
          const reason = typeof ticks[a.key] === 'string' ? (ticks[a.key] as string) : '';
          return (
            <li
              key={a.key}
              className="border-b border-[var(--border-divider)] py-[11px] last:border-b-0"
            >
              {/*
                ⚠️ THE WHOLE ROW IS THE TARGET, NOT A 14px BOX. Mobile-first,
                and a list somebody reads on a phone with eleven rows is eleven
                chances to miss.
              */}
              <label className="flex cursor-pointer items-start gap-[10px]">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setTicks((t) => {
                      const next = { ...t };
                      if (e.target.checked) next[a.key] = true;
                      else delete next[a.key];
                      return next;
                    })
                  }
                  className="mt-[3px] h-[16px] w-[16px] flex-shrink-0 accent-[var(--red)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[14px] font-medium leading-[1.3] text-[var(--text-primary)]">
                      {a.name}
                    </span>
                    {/*
                      ⚠️ ONLY WHEN IT IS TRUE. `onRoute` is false on every area
                      until the Maps work lands, so this renders nothing today
                      rather than a badge that always says the same thing.
                    */}
                    {a.onRoute ? (
                      <span className="rounded-full border border-[var(--red-line)] bg-[var(--red-wash)] px-[7px] py-[1px] text-[11px] text-[var(--red)]">
                        on your route
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-[2px] block text-[12px] leading-[1.35] text-[var(--text-tertiary)]">
                    {meta(a)}
                    {a.station ? ` · ${a.station.name} police station` : ''}
                  </span>
                  {/*
                    The headline, so the row is a fact rather than a place name.
                    One line, clipped — the cutting itself goes in the pack.
                  */}
                  <span className="mt-[3px] block overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] italic leading-[1.35] text-[var(--text-secondary)]">
                    “{a.latestHeadline}”
                  </span>
                </span>
              </label>

              {/*
                ⚠️ THE REASON APPEARS ONLY ONCE THEY HAVE TICKED. Eleven empty
                boxes down the page is a form; one box under the thing they
                just said yes to is a question.
              */}
              {on ? (
                <input
                  type="text"
                  value={reason}
                  maxLength={300}
                  placeholder="Why are you there? Optional — “my daughter’s school”"
                  onChange={(e) =>
                    setTicks((t) => ({ ...t, [a.key]: e.target.value }))
                  }
                  className="mt-[8px] ml-[26px] block w-[calc(100%-26px)] rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-inset)] px-[10px] py-[8px] text-[13.5px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3 border-t border-[var(--border-divider)] py-[10px]">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(chosen)}
          className="min-h-[40px] rounded-[var(--r-sm)] border border-[var(--red-line)] bg-[var(--red-wash)] px-[14px] text-[13px] font-medium text-[var(--red)] disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save these areas'}
        </button>
        <span className="text-[12px] text-[var(--text-tertiary)]">
          {chosen.length === 0
            ? 'None ticked'
            : chosen.length === 1
              ? '1 area ticked'
              : `${chosen.length} areas ticked`}
        </span>
      </div>
    </div>
  );
}
