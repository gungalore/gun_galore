'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  LicenceCentreOffer,
  MotivationApiError,
  TokenGetter,
  motivationsApi,
} from '@/lib/motivations-api';
// ⚠️ PURE AND TESTED, NOT INLINE. Both are the parts that fail silently — a
// row in the wrong place, a sentence under the wrong heading — and this file
// cannot be unit-tested without a DOM and a live application.
import { offerRows } from './licence-pack/owned-firearm-summary';
import {
  reasonsFor,
  reasonSubject,
  unplacedReasons,
  type OfferReason,
} from './licence-pack/offer-notes';

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
//
// ⚠️ A FIREARM IS ONE LINE, NOT SEVEN. Operator, 2026-09-07: "when listing
// the fire arms I already own it should only be the make, model, serial number
// and expiry date listed, nothing else." Seven rows per firearm — type,
// calibre, make, use, two serials and a licence number — turned a member's
// three licences into twenty-one lines of a panel that is meant to be read at a
// glance. The other columns still go on the form: the SAPS 271 asks for them
// and the duplicate-calibre argument is built out of them. They are simply not
// how a person recognises their own firearm.
//
// ⚠️ AND THE NOTES ABOUT WHAT WE COULD NOT USE ARE SHOWN, NOT SWALLOWED. The
// server sends a `skipped` list — "it does not cover the firearm this
// application is for", "we could not read a certificate number off it" — and it
// carries no key today, so filtering those by this panel's `keyPrefixes` (which
// is right, and stops a firearm sentence appearing under Competency) removed
// every one of them from the screen. They are the only place a member is told a
// document they handed us was read and discarded. The unplaceable ones are
// shown on exactly ONE panel, chosen by the page — see `showUnplaced`.
// ────────────────────────────────────────────────────────────────────

export default function LicenceCentreOfferPanel({
  token,
  motivationId,
  /** Only the keys this section owns. Keeps the panel where the fields are. */
  keyPrefixes,
  onApplied,
  showUnplaced = false,
}: {
  token: TokenGetter;
  motivationId: string;
  keyPrefixes: string[];
  onApplied: (answers: Record<string, string>, missing: string[]) => void;
  /**
   * Show the skipped notes that name no answer key at all.
   *
   * ⚠️ EXACTLY ONE MOUNT PER SCREEN MAY SET THIS. Every mount is handed the
   * same `skipped` array, so a panel that decided for itself would print the
   * same sentence three or four times down one page — which is the run-on
   * repetition the operator photographed, in a different costume. The page
   * picks the first panel the member walks past; the wording says only that we
   * read them, never that they belong to this section.
   */
  showUnplaced?: boolean;
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
        {/* ⚠️ "Document Centre", THE NAME ON THE DOOR. This said "Licence
            Centre" eight lines above a link labelled Document Centre and
            three above a heading reading "Your Document Centre can fill in".
            The module was renamed when it started keeping paperwork that is
            not a licence; the old name now reads as a second, missing
            place. */}
        Filled in {done} {done === 1 ? 'answer' : 'answers'} from your Document
        Centre. Check each one against the document — we read them off a
        photograph.
      </p>
    ) : null;
  }

  // Only the items belonging to this section.
  const mine = offer.items.filter((i) =>
    keyPrefixes.some((p) => i.key.startsWith(p)),
  );
  // ⚠️ COMPUTED BEFORE THE EARLY RETURN, because a panel with nothing to offer
  // is exactly where these can end up: the page names one mount, and if that
  // mount happened to have no items the sentences would vanish all over again.
  const unplaced = showUnplaced ? unplacedReasons(offer.skipped) : [];
  if (!mine.length) {
    // Nothing to offer HERE. An empty vault is worth a nudge; a vault that
    // simply has nothing for this section is not.
    if (!offer.empty && !unplaced.length) return null;
    return (
      <div className="mb-3 space-y-1.5">
        {offer.empty && (
          <p className="text-xs text-[var(--text-tertiary-on-card)]">
            Documents you keep in your{' '}
            <Link href="/documents" className="underline">
              Document Centre
            </Link>{' '}
            fill this in for you.
          </p>
        )}
        <UnusedNotes reasons={unplaced} />
      </div>
    );
  }

  const sources = Array.from(new Set(mine.map((i) => i.from)));
  const rows = offerRows(mine);
  // ⚠️ "DID A FIREARM COLLAPSE?", NOT A LENGTH COMPARISON. `rows.length <
  // mine.length` is false when exactly ONE column of a firearm is offered —
  // the case where the line hides the most — so the sentence below disappeared
  // precisely when it was needed.
  const grouped = rows.some((r) => r.collapsed);
  const reasons = reasonsFor(offer.skipped, keyPrefixes);

  return (
    <div className="mb-3 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3">
      <p className="text-sm font-medium">
        {/* ⚠️ COUNTS ANSWERS, NOT ROWS. The firearms below are one line each
            and carry four values apiece, so "3 of these" over three lines would
            under-report what the button does by a factor of seven. */}
        Your Document Centre can fill in{' '}
        {mine.length === 1 ? '1 answer' : `${mine.length} answers`}
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Read off {sources.length === 1 ? sources[0] : `${sources.length} of your documents`}.
        Nothing you have already typed is touched.
      </p>

      <dl className="mt-2 divide-y divide-[var(--border-divider)] text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex gap-3 py-1.5">
            <dt className="w-1/2 shrink-0 text-[var(--text-secondary)]">
              {r.label}
            </dt>
            <dd className="flex-1 break-words">{r.value}</dd>
          </div>
        ))}
      </dl>

      {/* Said once, because a firearm's line names four of its columns and the
          rest go onto the form unseen — and this panel's whole promise is that
          nothing happens the member was not told about. */}
      {grouped && (
        <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
          Each firearm is named here by its make, model, serial and expiry. The
          rest of what the SAPS 271 asks about it goes on the form too.
        </p>
      )}

      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-[var(--text-tertiary-on-card)]">
          {reasons.map((r) => (
            <li key={r.why}>
              {reasonSubject(r)}: {r.why}.
            </li>
          ))}
        </ul>
      )}

      <UnusedNotes reasons={unplaced} className="mt-2" />

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

/**
 * "We read these and took nothing from them."
 *
 * ⚠️ ITS OWN LEAD-IN, BECAUSE THESE BELONG TO NO SECTION. Printed bare under a
 * competency panel, a sentence about a firearm licence reads as a statement
 * about the competency — which is the fault the section filter was added to fix.
 * Said this way it claims only what is true: these are documents we looked at,
 * listed here because there is nowhere better yet. When the server puts a
 * `key` on each skipped entry they move onto their own panels and this
 * disappears on its own.
 */
function UnusedNotes({
  reasons,
  className = '',
}: {
  reasons: OfferReason[];
  className?: string;
}) {
  if (!reasons.length) return null;
  return (
    <div className={className}>
      <p className="text-xs text-[var(--text-tertiary-on-card)]">
        We also read these and took nothing from them:
      </p>
      <ul className="mt-1 space-y-1 text-xs text-[var(--text-tertiary-on-card)]">
        {reasons.map((r) => (
          <li key={r.why}>
            {reasonSubject(r)}: {r.why}.
          </li>
        ))}
      </ul>
    </div>
  );
}
