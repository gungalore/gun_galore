'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  LicenceCentreOffer,
  MotivationApiError,
  TokenGetter,
  motivationsApi,
} from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// "YOU HAVE ALREADY TOLD US THIS."
//
// A member who has loaded their competency certificate and their firearm
// licences into the Document Centre has already given us the competency number
// and every make, calibre and serial they own. Typing all of it again into a
// motivation is transcribing their own documents twice — and transcription is
// where a wrong serial on a SAPS form comes from.
//
// ⚠️ IT SHOWS BEFORE IT ASKS, and it never overwrites. The list of exactly
// what would be filled, and which document each value came from, is on screen
// before the button is pressed. Anything the applicant has already typed is
// left alone by the server, so pressing it can only ever add.
// ────────────────────────────────────────────────────────────────────

export default function LicenceCentreOfferPanel({
  token,
  motivationId,
  /** Only the keys this section owns. Keeps the panel where the fields are. */
  keyPrefixes,
  onApplied,
}: {
  token: TokenGetter;
  motivationId: string;
  keyPrefixes: string[];
  onApplied: (answers: Record<string, string>, missing: string[]) => void;
}) {
  const [offer, setOffer] = useState<LicenceCentreOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setOffer(await motivationsApi.licenceCentreOffer(token, motivationId));
    } catch {
      // A vault we cannot read is not something the applicant can act on, and
      // it must not stop them filling the form by hand. Stay silent.
      setOffer(null);
    }
  }, [token, motivationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!offer || done !== null) {
    return done !== null ? (
      <p className="mb-3 rounded border border-[var(--border)] bg-[var(--bg-inset)] p-3 text-sm">
        Filled in {done} {done === 1 ? 'answer' : 'answers'} from your Licence
        Centre. Check each one against the document — we read them off a
        photograph.
      </p>
    ) : null;
  }

  // Only the items belonging to this section.
  const mine = offer.items.filter((i) =>
    keyPrefixes.some((p) => i.key.startsWith(p)),
  );
  if (!mine.length) {
    // Nothing to offer HERE. An empty vault is worth a nudge; a vault that
    // simply has nothing for this section is not.
    if (!offer.empty) return null;
    return (
      <p className="mb-3 text-xs text-[var(--text-tertiary-on-card)]">
        Documents you keep in your{' '}
        <Link href="/documents" className="underline">
          Document Centre
        </Link>{' '}
        fill this in for you.
      </p>
    );
  }

  const sources = Array.from(new Set(mine.map((i) => i.from)));

  return (
    <div className="mb-3 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3">
      <p className="text-sm font-medium">
        Your Document Centre can fill in{' '}
        {mine.length === 1 ? 'this' : `${mine.length} of these`}
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Read off {sources.length === 1 ? sources[0] : `${sources.length} of your documents`}.
        Nothing you have already typed is touched.
      </p>

      <dl className="mt-2 divide-y divide-[var(--border-divider)] text-sm">
        {mine.map((i) => (
          <div key={i.key} className="flex gap-3 py-1.5">
            <dt className="w-1/2 shrink-0 text-[var(--text-secondary)]">
              {i.label}
            </dt>
            <dd className="flex-1 break-words">{i.value}</dd>
          </div>
        ))}
      </dl>

      {offer.skipped.length > 0 && (
        <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
          {offer.skipped
            .map((s) => `${s.title}: ${s.why}`)
            .join(' · ')}
          .
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        className="mt-3 min-h-[44px] rounded bg-[var(--red)] px-4 py-2 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const res = await motivationsApi.useLicenceCentre(
              token,
              motivationId,
            );
            onApplied(res.answers, res.missingRequired);
            setDone(res.filled);
          } catch (ex) {
            setErr(
              ex instanceof MotivationApiError
                ? ex.message
                : 'We could not fill that in just now.',
            );
            setBusy(false);
          }
        }}
      >
        {busy ? 'Filling in…' : 'Use these'}
      </button>

      <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
        We read these off your documents with a photograph, so check each one
        against the paper before you sign anything.
      </p>

      {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}
    </div>
  );
}
