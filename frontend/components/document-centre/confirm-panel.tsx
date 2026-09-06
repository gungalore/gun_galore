'use client';

import { useRef, useState } from 'react';
import DateField from '@/components/date-field';
import { todayYmd, toIso } from '@/lib/date-picker-model';
import {
  CredentialKind,
  CredentialProposal,
  KIND_LABELS,
  LicenceApiError,
  licenceCentreApi,
} from '@/lib/licence-centre-api';

// Lifted out of app/licence-centre/page.tsx unchanged. Shared by the review
// screen and the stored-document card, which is why it is its own file: a
// page module must not be imported from.

// ── the safety rail ──────────────────────────────────────────

export default function ConfirmPanel({
  token,
  id,
  proposed,
  onDone,
  onCancel,
  cancelLabel = 'I will do this later',
  kinds,
  currentKind,
  uncertain,
  reason,
  notes,
  defaultTitle,
  neverExpires: neverExpiresInitial,
  issuedOnUnknown: issuedOnUnknownInitial,
}: {
  token: () => Promise<string | null>;
  id: string;
  proposed: CredentialProposal;
  onDone: () => Promise<void>;
  /**
   * Backing out WITHOUT confirming.
   *
   * ⚠️ DEFAULTS TO onDone FOR THE CALLERS THAT ALWAYS MEANT THAT — on the
   * card, dismissing the panel and finishing it are the same "put this away".
   * The review screen is the caller for which they are opposites: it counts
   * what came back from onDone as filed, and a cancel routed there removed a
   * document from the review, added it to the "N filed" line, and left
   * confirmedAt null — so nothing reminded on it and nothing asked again.
   */
  onCancel?: () => void;
  /** "I will do this later" is right after an upload and wrong as a cancel. */
  cancelLabel?: string;
  /**
   * Passing these turns on the type and title controls. Offered where WE named
   * the document — a batch upload — and on the card, which is the only way back
   * for somebody who tapped "I will do this later" on a mis-filed one.
   */
  kinds?: CredentialKind[];
  currentKind?: CredentialKind;
  /** We guessed, and were not sure. A marker, not a blocker. */
  uncertain?: boolean;
  reason?: string | null;
  notes?: string[];
  defaultTitle?: string;
  /**
   * How the two ticks stand on the stored row, so re-opening the panel shows
   * the answer the member already gave rather than a blank form.
   */
  neverExpires?: boolean;
  issuedOnUnknown?: boolean;
}) {
  // ⚠️ THE DERIVED DATE PREFILLS THE BOX, and the panel says where it came
  // from. It is still unconfirmed like everything else here, so nothing drives
  // a reminder until the member has looked at it.
  const [expiresOn, setExpiresOn] = useState(
    proposed.expiresOn ?? proposed.derivedExpiry?.on ?? '',
  );
  const [issuedOn, setIssuedOn] = useState(proposed.issuedOn ?? '');
  /**
   * THE TWO TICKS. Operator, 2026-08-22: "put a tick box next to the expiry
   * date called Never Expires. Also a tickbox next to Issue date called Not
   * Sure, if its unsure when the document was issued."
   *
   * ⚠️ THE MEMBER ANSWERS, NOT THE KIND. An earlier design decided this from
   * the document type and a database CHECK enforced it — which meant a
   * passport, an identity document that plainly expires, could not be filed at
   * all. The member is holding the thing and can see whether a date is printed
   * on it.
   *
   * ⚠️ AND A TICK CLEARS ITS DATE RATHER THAN SITTING BESIDE IT. They are
   * contradictory answers to one question; the server refuses to store both
   * and would otherwise leave every reader to pick a winner.
   */
  const [neverExpires, setNeverExpires] = useState(
    neverExpiresInitial === true,
  );
  const [issuedOnUnknown, setIssuedOnUnknown] = useState(
    issuedOnUnknownInitial === true,
  );
  /**
   * What the tick cleared out of each box.
   *
   * ⚠️ TICKING IS NOT MEANT TO BE EXPENSIVE TO UNDO. Somebody who reads a date
   * off the card, types it, then ticks the box to see what it does should not
   * have to go and find the card again. Restored only into an empty box, so it
   * can never overwrite something typed since.
   */
  const clearedExpiry = useRef('');
  const clearedIssued = useRef('');
  const [kind, setKind] = useState<CredentialKind | ''>(currentKind ?? '');
  const [title, setTitle] = useState(defaultTitle ?? '');
  const showKind = Boolean(kinds && currentKind);
  /**
   * ⚠️ THE CURRENT TYPE HAS TO BE ON THE MENU. A kind that is not in `kinds`
   * rendered a select showing "Firearm licence", the first option, while the
   * state underneath still held the real one. It displayed one type and would
   * have posted another, and a member who never touched the control would
   * never have known. Live again since 2026-08-23: the four retired safe kinds
   * are off the menu, and an older row still carries one.
   */
  const kindOptions =
    kinds && currentKind && !kinds.includes(currentKind)
      ? [currentKind, ...kinds]
      : kinds;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const control =
    'mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-hover)] focus:outline-none';

  return (
    <section className="mt-6 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-4">
      {/* ⚠️ "CHECK THE EXPIRY DATE" OVER A PHOTOGRAPH OF A GUN SAFE. That is
          what this said, every word of it wrong, because the heading only ever
          considered whether WE had named the document. A row with the tick on
          it has no date to check; what is worth checking is the type we filed
          it as and the name it will appear under. */}
      <p className="text-sm font-medium">
        {neverExpires
          ? showKind
            ? 'Check what this is'
            : 'Check this document'
          : showKind
            ? 'Check this document'
            : 'Check the expiry date'}
      </p>
      {/* ⚠️ SAY WHAT WE ACTUALLY READ. This used to talk only about the
          expiry, so a competency certificate whose issue date, number, holder
          and coverage all read perfectly — and which simply does not print an
          expiry — was greeted with "we could not read a date off that one".
          True about the one field it meant, and wrong about the document.

          ⚠️ AND THE TICK COMES FIRST IN THE CHAIN. Once the member has said
          there is no expiry date, every one of the sentences below is either
          an instruction to find a date that does not exist or a complaint
          about not having read one. */}
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {neverExpires
          ? showKind
            ? 'Nothing on this one runs out, so there is no date to check. Make sure it is filed as the right type and named so you will know it again.'
            : 'Nothing on this one runs out. We keep it on file and schedule nothing against it.'
          : proposed.expiresOn
            ? 'We read this off your document. Check it against the document itself — a photograph can be misread, and every reminder is worked out from this date.'
            : proposed.derivedExpiry
              ? proposed.derivedExpiry.why
              : proposed.issuedOn || Object.keys(proposed.details).length > 0
                ? 'We read what is below off your document, but it does not print an expiry date we could find. Type it if it has one, or tick “Never expires” if it has none — every reminder is worked out from it.'
                : 'We could not read anything off that one. Fill it in as it is printed on the document, or tick “Never expires” if there is no date on it.'}
      </p>

        {/* WHY this document is in front of you.

            The panel already said "(check this)" beside the type. That is
            honest and it is not useful: a member with twelve documents and
            two doubtful ones could not tell which two, so the label did the
            work of a shrug. This names the field in THEIR words, so their
            eye goes to the right line on the paper they are holding.

            Rendered only when there is something to say. A row filed before
            this was stored has nothing recorded, and inventing a reason for
            it would be worse than the shrug. */}
        {(reason || (notes && notes.length > 0)) && (
          <div className="mt-3 rounded border border-[var(--border)] bg-[var(--gold-wash)] px-3 py-2 text-[13px] leading-relaxed">
            {reason && (
              <p className="text-[var(--warning)]">{reason}</p>
            )}
            {notes?.map((n) => (
              /* What we CHANGED on their document. A SAPS 524 prints the
                 identity number in boxes and the left border of the first
                 reads as a digit, so we drop it and re-check the checksum.
                 That is arithmetic rather than a guess, but it is still
                 something we did to their document without asking. */
              <p key={n} className="mt-1 text-[var(--text-secondary)]">
                We corrected something as we read it: {n}
              </p>
            ))}
          </div>
        )}
      {/* WHAT WE MADE OF IT. The type is not cosmetic: a licence filed as
          something else is never offered a renewal, and reminder copy is
          written per type. */}
      {showKind && kindOptions && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-[var(--text-secondary)]">
              What this is
              {uncertain && (
                <span className="ml-1 text-xs text-[var(--warning)]">
                  (check this)
                </span>
              )}
            </span>
            <select
              className={control}
              value={kind}
              onChange={(e) => setKind(e.target.value as CredentialKind)}
            >
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-[var(--text-secondary)]">
              What you call it
            </span>
            <input
              className={control}
              value={title}
              maxLength={120}
              placeholder="“my .308”"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="block text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[var(--text-secondary)]">Expires on</span>
            {/* ⚠️ BESIDE THE FIELD, NOT UNDER IT. The tick is the answer to
                the same question the box asks, and a member looking at a
                document with no expiry printed on it has to be able to see the
                way out without scrolling past a form they cannot complete. */}
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--red)]"
                checked={neverExpires}
                onChange={(e) => {
                  const on = e.target.checked;
                  setNeverExpires(on);
                  // The tick and a date are contradictory answers, and the
                  // server stores only one of them. Clearing here means the
                  // member can see which answer is standing.
                  if (on) {
                    clearedExpiry.current = expiresOn;
                    setExpiresOn('');
                  } else if (!expiresOn) {
                    setExpiresOn(clearedExpiry.current);
                  }
                }}
              />
              Never expires
            </label>
          </div>
          <div>
            {/* NO max={today}. An already-expired licence is a document
                members legitimately load — the Centre's job is to tell them
                so, not to refuse the date. */}
            <DateField
              label="Expires on"
              value={expiresOn}
              onChange={setExpiresOn}
              className={control}
              focusYear={todayYmd().y + 3}
              disabled={neverExpires}
              required={!neverExpires}
            />
          </div>
        </div>
        <div className="block text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[var(--text-secondary)]">
              Issued on (optional)
            </span>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--red)]"
                checked={issuedOnUnknown}
                onChange={(e) => {
                  const on = e.target.checked;
                  setIssuedOnUnknown(on);
                  if (on) {
                    clearedIssued.current = issuedOn;
                    setIssuedOn('');
                  } else if (!issuedOn) {
                    setIssuedOn(clearedIssued.current);
                  }
                }}
              />
              Not sure
            </label>
          </div>
          <div>
            {/* Still no Clear button, and the reason has changed shape rather
                than gone away. confirmExpiry no longer wipes an issue date
                that is merely absent from the request — it leaves it alone —
                so "Not sure" is now the deliberate way to clear one, and it
                says WHY the field is empty instead of leaving a silent blank. */}
            <DateField
              label="Issued on"
              value={issuedOn}
              onChange={setIssuedOn}
              className={control}
              focusYear={todayYmd().y - 2}
              max={toIso(todayYmd())}
              disabled={issuedOnUnknown}
            />
          </div>
        </div>
      </div>

      {Object.keys(proposed.details).length > 0 && (
        <dl className="mt-3 divide-y divide-[var(--border-divider)] text-sm">
          {Object.entries(proposed.details).map(([k, v]) => (
            <div key={k} className="flex gap-3 py-1.5">
              <dt className="w-1/2 shrink-0 text-[var(--text-secondary)]">
                {k.replace(/_/g, ' ')}
                {proposed.lowConfidence.includes(k) && (
                  <span className="ml-1 text-xs text-[var(--warning)]">
                    (check this)
                  </span>
                )}
              </dt>
              <dd className="flex-1 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          /* ⚠️ A DATE IS NOT THE ONLY WAY TO ANSWER. This read
             `disabled={busy || !expiresOn}`, which locked the only button on
             the panel for every document that has no expiry printed on it —
             an ID copy, a proof of address, four photographs of a safe — and
             left the member with nothing to press but "I will do this later".
             The tick is the other complete answer. */
          disabled={busy || (!neverExpires && !expiresOn)}
          className="rounded bg-[var(--red)] px-4 py-2 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await licenceCentreApi.confirm(token, id, {
                // Empty, deliberately: the tick is the answer and the server
                // checks it before it parses anything.
                expiresOn: neverExpires ? '' : expiresOn,
                issuedOn: issuedOnUnknown ? undefined : issuedOn || undefined,
                neverExpires,
                issuedOnUnknown,
                kind: showKind ? kind || undefined : undefined,
                title: showKind ? title || undefined : undefined,
              });
              await onDone();
            } catch (ex) {
              setErr(
                ex instanceof LicenceApiError
                  ? ex.message
                  : 'We could not save that just now.',
              );
              setBusy(false);
            }
          }}
        >
          {/* ⚠️ "THAT DATE IS RIGHT" ABOUT A DOCUMENT WITH NO DATE. The label
              was as wrong as the disabled state it sat next to; what the
              member is agreeing to on a kept-on-file document is that there is
              nothing to expire and that we have filed it correctly. */}
          {busy
            ? 'Saving…'
            : neverExpires
              ? 'That is right'
              : 'That date is right'}
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
          onClick={() => (onCancel ? onCancel() : void onDone())}
        >
          {cancelLabel}
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
        {neverExpires
          ? 'We keep this on file. There is no date to remind you about.'
          : 'Until a date is confirmed we do not schedule anything against it.'}
      </p>
      {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}
    </section>
  );
}


