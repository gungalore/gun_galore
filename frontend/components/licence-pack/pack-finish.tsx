'use client';

// ────────────────────────────────────────────────────────────────────
// THE END OF THE WIZARD, AND THE REASON IT EXISTS.
//
// ⚠️ THE REBUILT WIZARD COULD NOT FINISH A DOCUMENT. Its last-step button was
// `router.push('/motivations/${id}')` — a bare navigation dressed as an action
// — so a member walked eleven steps in the new design and was handed back to
// the old one to actually get their motivation. That was the seam, and this
// closes it.
//
// Lifted from the old page: the declaration, the accept-then-generate call,
// the poll, and the authenticated PDF opener. Each carries a lesson that cost
// something to learn, so each keeps its note.
//
// ⚠️ ONE THING THE OLD PAGE SAID IS NO LONGER TRUE, AND IS NOT COPIED.
// Its comment warned that "we will send you an SMS and an email" promised a
// notification nothing sent. That was accurate when written; notifyOutcome is
// wired now and fires on ready, held and failed. The sentence stays because it
// is true, not because it was inherited.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { motivationsApi, MotivationApiError } from '@/lib/motivations-api';
import type { TokenGetter } from '@/lib/motivations-api';
// ⚠️ THE SHARED ROUTINE, NOT A FOURTH COPY. Three identical hand-written
// versions of "open an authenticated blob in a new tab" existed, each carrying
// the same two hard-won rules (open the tab synchronously or Safari blocks it;
// never 'noopener', which returns null and strands a blank tab). One of them
// was here, twice over. See lib/open-blob-tab.ts.
import { openBlobTab } from '@/lib/open-blob-tab';

export default function PackFinish({
  token,
  motivationId,
  reference,
  status,
  outstanding,
  outstandingLabel,
  onGoToAnswer,
  missingDocuments = [],
  documentLabel,
  onGoToDocuments,
  saps271Filled,
  onStatus,
}: {
  token: TokenGetter;
  motivationId: string;
  reference: string;
  status: string;
  /** Required answers still missing. Generating without them wastes a run. */
  outstanding: string[];
  /** A field key in the member's own words. Defaults to the key itself. */
  outstandingLabel?: (key: string) => string;
  /** Take them to the step that asks it. Without this the names are inert. */
  onGoToAnswer?: (key: string) => void;
  /**
   * Required document kinds still unattached.
   *
   * ⚠️ A MISSING DOCUMENT IS NOT A MISSING ANSWER, and the two are fixed on
   * different steps. This panel used to see only the answers, so a pack with
   * every box filled and no ID copy showed a live button, spent one of a small
   * hourly quota on a flagship model, and came back refused.
   */
  missingDocuments?: string[];
  documentLabel?: (kind: string) => string;
  onGoToDocuments?: (kind: string) => void;
  /** Did they ask us to fill the SAPS 271? Decides the second button. */
  saps271Filled: boolean;
  onStatus: (status: string) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Open a PDF the server will only hand over with a token. */
  const openPdf = (mint: () => Promise<string>, filename: string) =>
    openBlobTab({
      mint,
      filename,
      onError: (e) =>
        setErr(
          e instanceof MotivationApiError
            ? e.message
            : 'We could not open the document just now.',
        ),
    });

  async function writeIt() {
    setBusy(true);
    setErr(null);
    try {
      await motivationsApi.acceptDeclaration(token, motivationId, consent);
      // Returns as soon as the work is CLAIMED, not finished.
      await motivationsApi.generate(token, motivationId);

      // ⚠️ THE DOCUMENT IS WRITTEN AFTER THE RESPONSE, so the ROW is what to
      // watch. Waiting on the request itself is what produced "Something went
      // wrong" for a generation that had completed: about ninety seconds of
      // work behind a sixty-second proxy timeout, under a Cloudflare edge
      // that gives up at a hundred regardless.
      //
      // Six minutes is far longer than a real run and exists only so this
      // cannot spin forever. Nothing is lost by giving up early — the work
      // continues on the server and the status is on the page when they come
      // back.
      const deadline = Date.now() + 6 * 60 * 1000;
      let d = await motivationsApi.get(token, motivationId);
      while (d.status === 'GENERATING' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        d = await motivationsApi.get(token, motivationId);
      }
      onStatus(d.status);
      if (d.status === 'GENERATING') {
        setErr(
          'This is taking longer than usual. It is still being written — you can close this page; we will send you an SMS and an email once it is ready.',
        );
      }
    } catch (e) {
      // ⚠️ THE SERVER NAMES WHAT IT IS HOLDING OUT FOR, AND NOTHING READ IT.
      // "Some required answers are still missing" on its own is a dead end on
      // the one screen with no form on it. A missing DOCUMENT is a different
      // failure from a missing answer and is fixed on a different step, so the
      // two are said separately and each one is jumped to.
      if (e instanceof MotivationApiError && e.missingDocuments?.length) {
        const names = e.missingDocuments.map(documentLabel ?? ((k) => k));
        setErr(
          `Still needed before we can write it: ${names.join(', ')}. They go on the step that asks for them.`,
        );
        onGoToDocuments?.(e.missingDocuments[0]);
      } else if (e instanceof MotivationApiError && e.missing?.length) {
        const names = e.missing.map(outstandingLabel ?? ((k) => k));
        setErr(`Still needed before we can write it: ${names.join(', ')}.`);
        onGoToAnswer?.(e.missing[0]);
      } else {
        setErr(
          e instanceof MotivationApiError
            ? e.message
            : 'We could not start writing it just now.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (status === 'GENERATING' || busy) {
    return (
      <p className="text-[13.5px]" role="status">
        We are writing it now. It takes a few minutes. You can leave this page —
        we will send you an SMS and an email once it is ready, and it will be
        here when you come back.
      </p>
    );
  }

  if (status === 'COMPLETED') {
    return (
      <div className="space-y-3">
        <p className="text-[13.5px] font-medium">Your pack is ready.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              openPdf(
                () => motivationsApi.pdfBlobUrl(token, motivationId),
                `${reference}-motivation.pdf`,
              )
            }
            className="min-h-[44px] rounded-[var(--r-sm)] border-0 bg-[var(--red)] px-4 py-[9px] text-[13px] font-medium text-white"
          >
            Open your motivation
          </button>
          {/* Only where they asked us to fill it. A button for a form we were
              never asked to produce is a button that 404s. */}
          {saps271Filled && (
            <button
              type="button"
              onClick={() =>
                openPdf(
                  () => motivationsApi.saps271BlobUrl(token, motivationId),
                  `${reference}-saps271.pdf`,
                )
              }
              className="min-h-[44px] rounded-[var(--r-sm)] border border-[var(--border)] bg-transparent px-4 py-[9px] text-[13px]"
            >
              Open your pre-filled SAPS 271
            </button>
          )}
        </div>
        {err && <p className="text-[12.5px] text-[var(--red)]">{err}</p>}
      </div>
    );
  }

  // ⚠️ NAME THEM, AND GO TO THEM. Generating with something required missing
  // spends a model run on a document the member cannot file, so the door stays
  // shut — but "the steps above show which" was a dead end: this is the LAST
  // step, one panel is on screen at a time, and there were no steps above. The
  // member was told a count and left to hunt for it across ten screens.
  if (outstanding.length > 0 || missingDocuments.length > 0) {
    const label = outstandingLabel ?? ((k: string) => k);
    const docLabel = documentLabel ?? ((k: string) => k);
    return (
      <div className="text-[13.5px] text-[var(--text-secondary)]">
        {outstanding.length > 0 && (
          <>
            <p>
              {outstanding.length} answer{outstanding.length === 1 ? '' : 's'}{' '}
              still to give:
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {outstanding.map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    disabled={!onGoToAnswer}
                    onClick={() => onGoToAnswer?.(k)}
                    className="min-h-[44px] rounded-[var(--r-sm)] border border-[var(--border)] px-3 py-2 text-[13px] underline-offset-2 hover:bg-[var(--bg-card-hover)] hover:underline disabled:no-underline"
                  >
                    {label(k)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {missingDocuments.length > 0 && (
          <div className={outstanding.length > 0 ? 'mt-3' : ''}>
            <p>
              {missingDocuments.length} document
              {missingDocuments.length === 1 ? '' : 's'} still needed:
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {missingDocuments.map((kind) => (
                <li key={kind}>
                  <button
                    type="button"
                    disabled={!onGoToDocuments}
                    onClick={() => onGoToDocuments?.(kind)}
                    className="min-h-[44px] rounded-[var(--r-sm)] border border-[var(--border)] px-3 py-2 text-[13px] underline-offset-2 hover:bg-[var(--bg-card-hover)] hover:underline disabled:no-underline"
                  >
                    {docLabel(kind)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-[560px] space-y-3">
      <label className="flex items-start gap-2.5 text-[13px]">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-[3px] h-[15px] w-[15px] accent-[var(--red)]"
        />
        <span>You may ask me later how my application went. (Optional.)</span>
      </label>

      {/* ⚠️ THE DECLARATION IS NOT A TICK. They confirm by continuing, and the
          sentence says what they are confirming — it is their statement, made
          under s120(9)(f), not ours. */}
      <p className="text-[13px] text-[var(--text-secondary)]">
        By continuing you confirm that everything you have told us is true, and
        that you submit the motivation as your own. It is not legal advice.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={writeIt}
        className="min-h-[44px] rounded-[var(--r-sm)] border-0 bg-[var(--red)] px-6 py-[11px] text-[13.5px] font-medium text-white disabled:opacity-50"
      >
        Write my motivation
      </button>

      {err && <p className="text-[12.5px] text-[var(--red)]">{err}</p>}
    </div>
  );
}
