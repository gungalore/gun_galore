'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ConfirmPanel from '@/components/document-centre/confirm-panel';
import { KINDS } from '@/components/document-centre/kinds';
import { filedUnsure } from '@/lib/document-review-rules';
import {
  CredentialRow,
  CredentialUsage,
  KIND_LABELS,
  LicenceApiError,
  STATE_TONE,
  formatDate,
  licenceCentreApi,
} from '@/lib/licence-centre-api';

// Lifted out of app/licence-centre/page.tsx unchanged.

// ── one stored document ─────────────────────────────────────────────

export default function CredentialCard({
  row,
  usedIn,
  token,
  onChanged,
  onError,
}: {
  row: CredentialRow;
  /** Applications this document already appears in. Empty is the normal case. */
  usedIn: CredentialUsage[];
  token: () => Promise<string | null>;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const tone = STATE_TONE[row.state];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // ⚠️ THE DATE HAS TO BE REACHABLE FROM HERE.
  //
  // The confirm panel used to live only in AddPanel's local state, set once
  // in the seconds after an upload. Close it — or reload, or navigate away,
  // or tap its own "I will do this later" — and the date could never be
  // confirmed again. An unconfirmed date is invisible to the reminder sweep,
  // so the document silently got no reminders at all, while the banner, the
  // page footer and the reminder email all told the member to correct it
  // "in your Document Centre". The endpoint accepted a late confirm the whole
  // time; only the way in was missing.
  const [editing, setEditing] = useState(false);
  // The renewal's own failure, shown AT the button. onError renders at the
  // bottom of the page, which on a phone is well below the fold — the button
  // appeared to do nothing at all.
  const [renewErr, setRenewErr] = useState<string | null>(null);

  /**
   * Exactly what is standing between this document and green.
   *
   * ⚠️ GREEN IS TWO FACTS AND A THRESHOLD: an expiry date, the member's
   * confirmation of it, and more than 90 days left. A row that just says
   * "Needs checking" tells somebody nothing about which of those is missing,
   * so they open the panel, see a date already filled in, and close it again.
   *
   * Deliberately silent for a document that is genuinely expired or expiring —
   * nothing is missing there, the news is simply bad, and "to turn this green,
   * renew it" would be glib.
   */
  const nextStep: string | null = (() => {
    // ⚠️ A KEPT-ON-FILE DOCUMENT NEVER GOES GREEN, so there is nothing to
    // promise about turning it green. This branch used to be unreachable only
    // because there was no 'no-expiry' state: a photograph of a safe read as
    // 'unknown' and was told, in as many words, to "add the expiry date
    // printed on it". There is no date printed on a gun safe.
    if (row.state === 'no-expiry') {
      return row.confirmed
        ? null
        : 'Nothing on this one expires. Check that we have filed it as the right type.';
    }
    if (row.state !== 'unknown') return null;
    const wants: string[] = [];
    if (!row.expiresOn) {
      wants.push(
        // `on` is null when the certificate's endorsements could not be
        // read: there is a reason to show but no date to check.
        row.derivedExpiry?.on
          ? 'check the expiry date we worked out'
          : row.derivedExpiry
            ? 'tell us which firearms this certificate covers, or add the expiry date'
            : 'add the expiry date printed on it, or tick “Never expires”',
      );
    }
    if (!row.confirmed) wants.push('confirm it is right');
    return wants.length ? `To turn this green: ${wants.join(', then ')}.` : null;
  })();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(row.title);
  const saveName = async () => {
    const next = draftName.trim();
    setRenaming(false);
    // Unchanged, or emptied down to nothing — leave the row alone rather than
    // spend a request and a list refresh saying so.
    if (!next || next === row.title) {
      setDraftName(row.title);
      return;
    }
    try {
      await licenceCentreApi.rename(token, row.id, next);
      await onChanged();
    } catch {
      setDraftName(row.title);
      onError('We could not rename that document just now.');
    }
  };

  return (
    /*
      ── THE DETAIL PANEL ────────────────────────────────────────────

      This was a compact tinted card in a grouped list. It is now the third
      column of the Document Centre, restyled to the approved drawing:
      preview, name, what else the page counts as, its dates, then what you
      can do with it.

      ⚠️ EVERY BEHAVIOUR BELOW IS THE ONE THAT WAS HERE. The rename pen, the
      never-expires wording, the section 24 renewal offer and its two
      thresholds, the confirm panel as the way back from a mis-filed document,
      the Safari popup rule on View, the missing reminder switch on a dateless
      row — each has a comment explaining a bug it closed, and this change
      moved boxes, not rules.

      ⚠️ THE TINT IS GONE FROM THE CONTAINER. It carried the expiry state, and
      in a full-height column a wash of amber over 500px reads as an error
      page. The state now sits where the list puts it too: on a pill, with a
      word in it.
    */
    <li className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4">
      {/* ⚠️ NO PREVIEW HERE, AND THIS IS THE SECOND TIME THAT HAS BEEN
          DECIDED. A 148px box holding a generic page glyph stood here — it
          was in the approved drawing, and it rendered the same for every
          document, so it told nobody anything about the one they had
          selected. Operator, 2026-08-25: "remove that small preview, just
          keep the information underneath it. There is a view option so that
          would be more than fine."

          The thing it stood in for is real and reachable: View below fetches
          the decrypted bytes and opens the actual document. What it would
          take to render it in place is written up in the same conversation —
          cheap for a photographed licence, and needing a PDF rasteriser this
          backend does not have for anything scanned to PDF. If that is ever
          revisited, put a real render here or nothing; a placeholder is the
          one option already tried twice. */}
      <div>
        {/* ⚠️ WE NAME IT, THEY OWN THE NAME. A firearm licence is titled make +
            calibre off the document — "Howa 6.5 Creedmoor" — because six rows
            reading "Firearm licence" cannot be told apart. But what somebody
            calls their own rifle is theirs to decide, and our reading is only
            as good as the photograph. The pen edits in place; it never moves
            the row or opens a dialog. */}
        {renaming ? (
          <input
            autoFocus
            className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-1 text-base font-semibold"
            value={draftName}
            maxLength={120}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveName();
              if (e.key === 'Escape') {
                setDraftName(row.title);
                setRenaming(false);
              }
            }}
            onBlur={() => void saveName()}
            aria-label="Name for this document"
          />
        ) : (
          <p className="flex items-start gap-1.5 text-base font-semibold leading-snug">
            <span className="min-w-0">{row.title}</span>
            <button
              type="button"
              /* ⚠️ A 13px PEN WITH A 44px TARGET, and the pen stays 13px. It
                 sits beside the document's own name; a button drawn to the
                 touch minimum would out-weigh the title it belongs to. The
                 pseudo-element carries the target instead — `relative` on the
                 button, nothing interactive within reach of the overlap. */
              className="relative mt-0.5 shrink-0 rounded p-1 text-[var(--text-tertiary-on-card)] after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-[var(--text-primary)]"
              aria-label={`Rename ${row.title}`}
              title="Rename"
              onClick={() => {
                setDraftName(row.title);
                setRenaming(true);
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
          </p>
        )}
        <p className="mt-0.5 text-xs text-[var(--text-tertiary-on-card)]">
          {KIND_LABELS[row.kind]}
        </p>
        {/* ⚠️ THE OTHER HALF OF THE GUESS, SAID OUT LOUD. We store whether we
            were sure what this document was, and until now only the review
            queue ever read it — so a card could show a confident-looking type,
            a clean date and a "Filled in for you" note while the box itself
            was our low-confidence guess. In passing and correctable, per
            "Automate It": we filled it in, they change it if we are wrong.
            Not a task, and never a red button. */}
        {filedUnsure(row) && !row.confirmed && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1.5 text-left text-[11px] font-semibold text-[var(--warning)] underline decoration-dotted underline-offset-2"
          >
            Filed as {KIND_LABELS[row.kind] ?? row.kind} — not sure, tap to
            change
          </button>
        )}
      </div>

      {/* ⚠️ SAYING SO IS THE POINT, and it has its own box now rather than a
          clause. Without it a member looking for their letter of good standing
          sees no such row and uploads a second copy of the certificate they
          have already given us. */}
      {row.coversKinds.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-[var(--border)] bg-[var(--bg-inset)] p-3.5">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            This one page also counts as
          </p>
          <div className="flex flex-col gap-1.5">
            {row.coversKinds.map((k) => (
              <span
                key={k}
                className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {KIND_LABELS[k]}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            One row, several roles — never a second copy of the same page, which
            would print as two annexures.
          </p>
        </div>
      )}

      {nextStep && (
        // What is actually standing between this row and settled, named.
        // "Needs checking" tells somebody nothing about what to do next.
        <p className="mt-3 text-xs" style={{ color: tone.colour }}>
          {nextStep}
        </p>
      )}

      {/* ⚠️ "Expires —" IS NOT A FACT, IT IS A BLANK. On a document the member
          has told us never expires it read as a date we had failed to find,
          over the em dash formatDate returns for null — and the "reminders
          off" marker beside it describes a reminder that could never have
          fired. Say what is true instead. */}
      <div className="mt-4 flex flex-col gap-2.5 border-t border-[var(--border-divider)] pt-4">
        {/* ⚠️ THE SECTION WAS READ AND NEVER SHOWN. Operator, 2026-08-28:
            "when user scans a license in the OCR must add the section type of
            the license." It was already in WANTED and already doing real work
            — credential-auto-date cross-checks the expiry against
            LICENCE_YEARS[section] and REFUSES to arm a reminder without it
            ("no issue date or section to check the term against"). What it had
            no way of being was CORRECTED: a misread section silently disabled
            the reminder and the member could not see why. Now it is on the
            card, above the dates it governs. */}
        {row.details.section && (
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-[var(--text-tertiary-on-card)]">Section</span>
            <span className="font-medium">{row.details.section}</span>
          </div>
        )}
        {row.issuedOn && (
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-[var(--text-tertiary-on-card)]">Issued</span>
            <span className="gg-nums font-medium">{formatDate(row.issuedOn)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
          <span className="text-[var(--text-tertiary-on-card)]">Expires</span>
          {row.state === 'no-expiry' ? (
            <span className="text-[var(--text-secondary)]">Kept on file</span>
          ) : (
            <span className="gg-nums font-medium">
              {formatDate(row.expiresOn)}
            </span>
          )}
        </div>
        {row.state !== 'no-expiry' && (
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-[var(--text-tertiary-on-card)]">
              Date confirmed
            </span>
            {/* ⚠️ THREE STATES, AND THE MIDDLE ONE IS NEW. It was a binary: "By
                you" or "Not yet". Now the Centre fills dates in and arms the
                reminder itself, and neither word fits — "By you" would be a
                false record of who checked it, on a page about firearm
                licences, and "Not yet" would call a settled row an errand.
                Amber-neutral, never the green tick: the green tick means a
                human looked. */}
            {row.confirmed ? (
              <span className="flex items-center gap-1.5 text-[var(--success)]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                By you
              </span>
            ) : row.dateSource ? (
              <span className="text-[var(--text-secondary)]">
                {row.dateSource === 'derived' ? 'Worked out for you' : 'Filled in for you'}
              </span>
            ) : (
              <span className="text-[var(--warning)]">Not yet</span>
            )}
          </div>
        )}
        {/* ⚠️ WHERE THE DATE CAME FROM, IN THE SENTENCE THE SERVER ALREADY
            WROTE. `dateSourceNote` has been returned on every row since the
            Centre started filling dates in and was rendered nowhere, so
            "Worked out for you" stood alone with no way to ask worked out from
            WHAT — and a member who cannot see the basis of a date on a firearm
            licence cannot check it. Muted, under the date, in passing: the
            house rule is that a value we filled in says so on the row and is
            never turned into an errand. */}
        {!row.confirmed && row.dateSource && row.dateSourceNote && (
          <p className="-mt-1 text-[11.5px] leading-snug text-[var(--text-tertiary-on-card)]">
            {row.dateSourceNote}
          </p>
        )}
        {/* Only where a reminder could exist at all — see the note on the
            switch below. */}
        {row.state !== 'no-expiry' && (
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-[var(--text-tertiary-on-card)]">Reminders</span>
            <span className="text-[var(--text-secondary)]">
              {row.remindersMuted ? 'Off' : 'On'}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
          <span className="text-[var(--text-tertiary-on-card)]">Added</span>
          <span className="gg-nums text-[var(--text-secondary)]">
            {formatDate(row.createdAt.slice(0, 10))}
          </span>
        </div>
      </div>

      {/* THE LOOP. A firearm licence whose date is confirmed and whose expiry
          is close enough to act on.

          ⚠️ THIS REVERSES A DELIBERATE EARLIER DECISION, and the reasoning
          then was not wrong — it was that an SA licence runs five or ten
          years, so gating on the reminder window kept the module's headline
          feature off screen for a licence uploaded today, and that the
          urgency belonged in the words rather than in whether the button
          existed. The operator has overruled it: a renewal offered the day
          somebody files a ten-year licence is noise on every card, every
          visit, for nine and a half years.

          ⚠️ AND IT NO LONGER RIDES ON `state`. It used to, back when 'expiring'
          meant 180 days and that happened to be the six months asked for. The
          amber threshold has since moved to 90 days — common practice, and the
          section 24(1) deadline itself — so gating on it would first mention
          renewal on the very last day the application can be lodged. The two
          numbers answer different questions and now have different names:
          `renewalDue` is the six-month offer, `state` is how the card reads. */}
      {row.kind === 'FIREARM_LICENCE' &&
        row.confirmed &&
        (row.renewalDue || row.state === 'expired') && (
          <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-card)] p-3">
            <p className="text-sm font-medium">
              {row.state === 'expired'
                ? 'This one has expired'
                : 'Time to start the renewal'}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {/* ⚠️ THE 90-DAY DEADLINE IS THE USEFUL FACT HERE. Section 24(1)
                  requires the renewal application at least 90 days before
                  expiry, and section 24(4) keeps the licence valid until the
                  application is decided IF it was lodged in time. Somebody
                  who leaves it to the last month has lost that protection. */}
              {row.state === 'expired'
                ? 'Renewal must be applied for before a licence expires. Speak to your DFO about where this leaves you — we can still prepare the paperwork. '
                : 'SAPS asks for the application at least 90 days before the expiry date, and a licence lodged in time stays valid until the application is decided. '}
              We will open a section 24 renewal already carrying the licence
              number, the expiry and the firearm&rsquo;s details from this
              document. You write the part only you can — what you have
              actually done with it.
            </p>
            <button
              type="button"
              disabled={busy}
              className="mt-2 rounded bg-[var(--red)] px-3 py-1.5 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                setRenewErr(null);
                try {
                  const started = await licenceCentreApi.renew(token, row.id);
                  router.push(`/motivations/${started.motivationId}`);
                } catch (ex) {
                  setRenewErr(
                    ex instanceof LicenceApiError
                      ? ex.message
                      : 'We could not start that renewal just now.',
                  );
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Starting…' : 'Start the renewal'}
            </button>
            {renewErr && (
              <p className="mt-2 text-sm text-[var(--red)]">{renewErr}</p>
            )}
          </div>
        )}

      {editing && (
        <div className="mt-3">
          <ConfirmPanel
            token={token}
            id={row.id}
            proposed={{
              expiresOn: row.expiresOn,
              issuedOn: row.issuedOn,
              details: row.details,
              lowConfidence: [],
              derivedExpiry: row.derivedExpiry,
            }}
            cancelLabel="Cancel"
            /* THE WAY BACK. Somebody who tapped "I will do this later" on a
               batch-sorted document has no other route to correcting the type
               we chose for it. */
            kinds={KINDS}
            currentKind={row.kind}
            defaultTitle={row.title}
            // The stored answers, so re-opening shows what the member already
            // said rather than an empty box beside a cleared date.
            neverExpires={row.neverExpires}
            issuedOnUnknown={row.issuedOnUnknown}
            onDone={async () => {
              setEditing(false);
              await onChanged();
            }}
          />
        </div>
      )}

      {/* ── WHERE THIS DOCUMENT ALREADY IS ───────────────────────────────
          Renders nothing at all when the document is in no application, which
          is most of them — an empty "Used in" heading over nothing is worse
          than no heading. */}
      {usedIn.length > 0 && (
        <div className="mt-4 border-t border-[var(--border-divider)] pt-4">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Used in
          </p>
          <div className="flex flex-col gap-1.5">
            {usedIn.map((u) => (
              <Link
                key={u.motivationId}
                href={`/motivations/${u.motivationId}`}
                className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="shrink-0"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                <span className="gg-nums">{u.referenceNumber}</span>
                {u.annexure && <span>\u2014 Annexure {u.annexure}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {!editing && (
          /* ⚠️ A RED "Check the date" BUTTON ON A PHOTOGRAPH OF A SAFE. Red is
             this page's "you must do something" colour, and STATE_TONE keeps
             the kept-on-file rows neutral rather than amber precisely because
             amber reads as an outstanding errand. A red button undid that in
             one stroke, and named the wrong errand as well: what is worth
             looking at on a dateless document is the type we filed it as. */
          <button
            type="button"
            className={
              row.confirmed || row.state === 'no-expiry'
                ? 'underline'
                : 'rounded bg-[var(--red)] px-3 py-1.5 text-white hover:bg-[var(--red-hover)]'
            }
            onClick={() => setEditing(true)}
          >
            {row.state === 'no-expiry'
              ? row.confirmed
                ? 'Change the type or name'
                : 'Check what this is'
              : row.confirmed
                ? 'Change the date'
                : 'Check the date'}
          </button>
        )}
        {row.available && (
          <button
            type="button"
            className="underline"
            onClick={async () => {
              onError(null);
              // ⚠️ THE TAB OPENS FIRST, INSIDE THE CLICK. Safari judges a
              // popup by whether window.open happened in the click's own call
              // stack, and this one used to run after an await on a fetch —
              // so on Safari the View button did nothing at all, silently.
              //
              // ⚠️ AND NOT 'noopener', because that returns null by spec and
              // there would be no tab to fill. `opener` is nulled instead,
              // which is the protection the flag actually provides — and this
              // is a same-origin blob: URL of our own making regardless.
              const tab = window.open('', '_blank');
              if (tab) tab.opener = null;
              try {
                const url = await licenceCentreApi.fileBlobUrl(token, row.id);
                if (tab) {
                  tab.location.href = url;
                } else {
                  // Genuinely blocked. Hand the file over rather than lose it.
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'document';
                  a.click();
                }
                // The tab holds its own copy; ours would otherwise be pinned
                // for the life of this page.
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              } catch {
                tab?.close();
                onError('We could not open that document.');
              }
            }}
          >
            View
          </button>
        )}
        {/* ⚠️ NO REMINDER SWITCH ON A DOCUMENT NOTHING CAN BE SCHEDULED
            AGAINST. A ticked "Never expires" row carries a null expiresOn — a
            database CHECK sees to that — and the reminder sweep selects on
            `expiresOn: { not: null }`, so no stage has ever fired for one and
            none ever will. The "reminders off" marker was taken off the line
            above for precisely that reason; leaving the switch that sets it
            offers "Turn reminders on" over a reminder that cannot exist, which
            is the one promise this page may never make. It returns the moment
            the tick comes off and a date goes in. */}
        {row.state !== 'no-expiry' && (
          <button
            type="button"
            disabled={busy}
            className="underline disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              onError(null);
              try {
                await licenceCentreApi.mute(token, row.id, !row.remindersMuted);
                await onChanged();
              } catch {
                onError('We could not change that just now.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {row.remindersMuted ? 'Turn reminders on' : 'Turn reminders off'}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          className="text-[var(--red)] underline disabled:opacity-50"
          onClick={async () => {
            const ok = window.confirm(
              `Delete “${row.title}”?\n\nThis removes the document from our server for good. It cannot be undone.`,
            );
            if (!ok) return;
            setBusy(true);
            onError(null);
            /* ⚠️ finally, NOT catch. On the happy path `setBusy(false)` was
               never reached, so every control on this card — View, the
               reminder switch, the renewal — stayed disabled until the parent
               happened to re-render. Deleting the LAST document in a folder
               leaves the card mounted with a stale row and nothing on it
               working, which reads as the page having died. */
            try {
              await licenceCentreApi.remove(token, row.id);
              await onChanged();
            } catch {
              onError('We could not delete that just now.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

