'use client';

// ────────────────────────────────────────────────────────────────────
// "REPORTED NEAR YOU" — the clippings picker for the self-defence step.
//
// Renders directly under the precinct card, once a police station has been
// saved: SAPS's own quarterly release says what a precinct looks like on
// paper (see precinct-card.tsx); this shows what the local press has
// actually reported there — named incidents a DFO can be pointed at, not
// just a category count.
//
// Ticking a card writes its incident id into the hidden `press_clippings`
// answer through the SAME onChange path as every other field, so autosave,
// draft persistence and provenance keep working with no special case
// anywhere else. The generic renderer never shows `press_clippings` as an
// input of its own — see the guard next to `police_station_province` in
// page.tsx / field-grid.tsx, which this field follows exactly.
//
// Fetches `/motivations/:id/incidents`, which — like `/precinct` — reads the
// station off whatever `police_station` the server already has saved, not
// off the value passed in here. So it waits the same beat as PrecinctCard
// (AUTOSAVE_MS + slack) before asking, rather than racing the save that has
// to land first.
// ────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Skel } from '@/components/skeleton';
import { AUTOSAVE_MS } from '@/lib/motivation-draft';
import {
  CLIPPING_LIMIT_REASON,
  MAX_CLIPPINGS,
  crimeTypeLabel,
  incidentMetaLine,
  parseClippingIds,
  serialiseClippingIds,
  toggleClippingId,
} from '@/lib/press-clippings';
import {
  motivationsApi,
  type NewsIncident,
  type TokenGetter,
} from '@/lib/motivations-api';

// Slack on top of the autosave debounce, so this fetch fires just after the
// save it depends on — not exactly on top of it. Same value as PrecinctCard.
const FETCH_DELAY_MS = AUTOSAVE_MS + 300;

type LoadState = 'idle' | 'loading' | 'ready' | 'empty';

export function ClippingsPicker({
  motivationId,
  policeStation,
  value,
  onChange,
  getToken,
}: {
  motivationId: string;
  /** The current `police_station` answer — only its presence/change matters. */
  policeStation: string;
  /** The current `press_clippings` answer — a JSON array of incident ids. */
  value: string;
  /** Writes the new JSON straight back through the page's answer-change path. */
  onChange: (json: string) => void;
  getToken: TokenGetter;
}) {
  const [state, setState] = useState<LoadState>('idle');
  const [incidents, setIncidents] = useState<NewsIncident[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    const station = policeStation.trim();
    if (!station) {
      setIncidents([]);
      setState('idle');
      return;
    }

    setState('loading');
    debounceRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      motivationsApi
        .incidents(getToken, motivationId, ctrl.signal)
        .then((data) => {
          setIncidents(data.incidents);
          setState(data.incidents.length > 0 ? 'ready' : 'empty');
        })
        .catch((err) => {
          if ((err as Error).name === 'AbortError') return;
          // A failed fetch reads the same as "nothing on file" — never an
          // error banner for an informational side panel.
          setIncidents([]);
          setState('empty');
        });
    }, FETCH_DELAY_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [policeStation, motivationId, getToken]);

  if (state === 'idle') return null;

  const selected = parseClippingIds(value);
  const atLimit = selected.length >= MAX_CLIPPINGS;

  function toggle(id: string) {
    onChange(serialiseClippingIds(toggleClippingId(selected, id)));
  }

  if (state === 'loading') {
    return (
      <div
        className="gg-tile mt-3 rounded-[8px] p-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        aria-busy="true"
        aria-label="Loading reports from the local press"
      >
        <Skel className="h-3 w-1/3" />
        <Skel className="mt-2 h-2.5 w-2/3" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skel key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="gg-tile mt-3 rounded-[8px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Reported near you
        </p>
        <span className="text-xs text-[var(--text-tertiary-on-card)]">
          {selected.length} of {MAX_CLIPPINGS} chosen
        </span>
      </div>
      <p className="mt-0.5 text-xs text-[var(--text-tertiary-on-card)]">
        Crime the local press reported within 25 km in the last twelve months.
        Tick the ones that describe the risk you face; they print in your pack
        as clippings — the paper&rsquo;s name, date, headline and picture.
      </p>

      {state === 'empty' ? (
        <p className="mt-4 text-sm text-[var(--text-tertiary-on-card)]">
          Nothing from the local press on file for this station yet.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {incidents.map((incident) => {
            const checked = selected.includes(incident.id);
            const disabled = !checked && atLimit;
            const checkboxId = `clipping-${incident.id}`;
            const type = crimeTypeLabel(incident.crimeType);

            return (
              <li
                key={incident.id}
                className="flex flex-col gap-3 rounded-[6px] p-3 sm:flex-row"
                style={{
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  opacity: disabled ? 0.6 : 1,
                }}
              >
                <div className="w-full shrink-0 sm:w-40">
                  {incident.imageUrl ? (
                    // An external news-site image, not one of our own optimised assets.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={incident.imageUrl}
                      alt={incident.headline}
                      className="aspect-[4/3] w-full rounded-[4px] object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden
                      className="aspect-[4/3] w-full rounded-[4px]"
                      style={{ background: 'var(--bg-card-hover)' }}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[var(--text-tertiary-on-card)]">
                    {incidentMetaLine(incident)}
                  </p>
                  <p
                    className="mt-1 text-sm"
                    style={{ fontWeight: 500, color: 'var(--text-primary)' }}
                  >
                    {incident.headline}
                  </p>
                  {incident.standfirst && (
                    <p className="mt-1 line-clamp-3 text-sm text-[var(--text-secondary)]">
                      {incident.standfirst}
                    </p>
                  )}
                  {type && (
                    <span
                      className="mt-2 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                      style={{
                        background: 'var(--bg-card-hover)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {type}
                    </span>
                  )}

                  <label
                    htmlFor={checkboxId}
                    className="mt-3 flex min-h-[44px] items-center gap-2 text-sm"
                    style={{
                      color: disabled
                        ? 'var(--text-tertiary-on-card)'
                        : 'var(--text-primary)',
                      cursor: disabled ? 'default' : 'pointer',
                    }}
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(incident.id)}
                    />
                    Attach to my motivation
                  </label>
                  {disabled && (
                    <p className="text-xs text-[var(--text-tertiary-on-card)]">
                      {CLIPPING_LIMIT_REASON}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-[var(--text-tertiary-on-card)]">
        We attach the headline, picture and summary as the paper published
        them, with the date and the paper&rsquo;s name.
      </p>
    </div>
  );
}
