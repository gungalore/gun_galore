'use client';

import { useRef, useState } from 'react';
import {
  kindLabel,
  KIND_LABELS,
  type CreateTrackerBody,
  type TrackerKind,
} from '@/lib/licence-tracker-api';

// ────────────────────────────────────────────────────────────────────
// START TRACKING AN APPLICATION.
//
// ⚠️ THE SERIAL FIELD IS NOT RENDERED FOR A COMPETENCY, and the server drops
// it anyway — a competency names a person and there is no firearm to hold a
// serial for. A field that is hidden but still submitted is how a stale value
// from a previous kind reaches the enquiry and returns nothing at all.
//
// ⚠️ THE REFERENCE IS THE ONE REQUIRED FIELD. It is what the enquiry searches
// on; without it there is no question to ask. The helper text names where to
// find it rather than guessing at its shape — SAPS references are not one
// format, and a pattern check would refuse legitimate ones.
// ────────────────────────────────────────────────────────────────────

const INPUT =
  'mt-1 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-transparent px-3 py-2 text-[14px] text-[var(--text-primary)]';
const LABEL =
  'block text-[12px] font-medium text-[var(--text-secondary)]';
const HINT = 'mt-1 block text-[11.5px] leading-[1.45] text-[var(--text-tertiary)]';

/** Today, as a `YYYY-MM-DD` value for a date input — from the LOCAL clock,
 *  because "today" is the member's today, not UTC's. */
function todayValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AddTrackerForm({
  onCreate,
  busy,
  error,
}: {
  /** True once the tracker exists. False means the server refused it and the
   *  member's typing is still theirs to fix. */
  onCreate: (body: CreateTrackerBody) => Promise<boolean>;
  busy: boolean;
  /** The server's refusal, passed through verbatim — its wording knows things
   *  this form cannot (a duplicate reference, a date it could not read). */
  error: string | null;
}) {
  const [kind, setKind] = useState<TrackerKind>('COMPETENCY');
  const [reference, setReference] = useState('');
  const [serial, setSerial] = useState('');
  const [submittedOn, setSubmittedOn] = useState('');
  const [label, setLabel] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const referenceRef = useRef<HTMLInputElement>(null);

  const isCompetency = kind === 'COMPETENCY';

  return (
    <form
      className="gg-tile mt-4 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reference.trim()) {
          setLocalError('Enter the application reference.');
          referenceRef.current?.focus();
          return;
        }
        setLocalError(null);
        const added = await onCreate({
          kind,
          reference: reference.trim(),
          // Only ever sent for a firearm licence or a renewal; the server drops
          // it for a competency regardless, so belt and braces.
          serial: isCompetency ? null : serial.trim() || null,
          submittedOn: submittedOn || null,
          label: label.trim() || null,
        });
        // ⚠️ CLEARED ONLY ON SUCCESS, AND ONLY BECAUSE A STALE FORM IS A TRAP.
        // Leaving the values standing invites a second tap on "Start tracking",
        // and the second one is refused as a duplicate — so the member's one
        // successful add looks like a failure. The KIND stays, though: somebody
        // entering four competencies should not have to re-pick it each time.
        if (added) {
          setReference('');
          setSerial('');
          setSubmittedOn('');
          setLabel('');
        }
      }}
    >
      <h2 className="m-0 text-[15px] font-medium text-[var(--text-primary)]">
        Track an application
      </h2>

      <label className={`${LABEL} mt-3`} htmlFor="tracker-kind">
        What are you tracking?
      </label>
      <select
        id="tracker-kind"
        value={kind}
        onChange={(e) => {
          const next = e.target.value as TrackerKind;
          setKind(next);
          // ⚠️ CLEARED, NOT LEFT STANDING. The field disappears; a serial the
          // member typed for a licence must not travel with a competency they
          // changed their mind onto.
          if (next === 'COMPETENCY') setSerial('');
        }}
        className={INPUT}
      >
        {(Object.keys(KIND_LABELS) as TrackerKind[]).map((k) => (
          <option key={k} value={k}>
            {kindLabel(k)}
          </option>
        ))}
      </select>

      <label className={`${LABEL} mt-3`} htmlFor="tracker-reference">
        Reference
      </label>
      <input
        id="tracker-reference"
        ref={referenceRef}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        maxLength={60}
        autoComplete="off"
        className={INPUT}
      />
      <span className={HINT}>
        The reference on your application receipt, or in the SMS from your DFO.
        It is what the SAPS enquiry searches on, so your DFO can confirm it if
        you are not sure.
      </span>

      {!isCompetency && (
        <>
          <label className={`${LABEL} mt-3`} htmlFor="tracker-serial">
            Firearm serial number
          </label>
          <input
            id="tracker-serial"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            maxLength={40}
            autoComplete="off"
            className={INPUT}
          />
          <span className={HINT}>
            As printed on the firearm or the licence card. Leave it blank if you
            do not have it — the enquiry can still answer on the reference
            alone.
          </span>
        </>
      )}

      <label className={`${LABEL} mt-3`} htmlFor="tracker-submitted">
        Date you lodged it
      </label>
      <input
        id="tracker-submitted"
        type="date"
        value={submittedOn}
        max={todayValue()}
        onChange={(e) => setSubmittedOn(e.target.value)}
        className={INPUT}
      />
      <span className={HINT}>
        Optional. It is only used to lay out your history, and we never send it
        to SAPS.
      </span>

      <label className={`${LABEL} mt-3`} htmlFor="tracker-label">
        Name it
      </label>
      <input
        id="tracker-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={80}
        placeholder="My first .308"
        className={INPUT}
      />
      <span className={HINT}>
        Optional. A list of reference numbers is hard to read, so this is what
        the card will be headed with.
      </span>

      {(localError || error) && (
        <p role="alert" className="mt-3 text-[13px] text-[var(--red)]">
          {localError ?? error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 min-h-[44px] w-full rounded-[var(--r-sm)] border-0 bg-[var(--text-primary)] px-4 text-[14px] font-medium text-[var(--bg-card)] disabled:opacity-45 sm:w-auto"
      >
        {busy ? 'Adding…' : 'Start tracking'}
      </button>
    </form>
  );
}
