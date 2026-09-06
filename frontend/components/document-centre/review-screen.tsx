'use client';

import { useEffect, useRef, useState } from 'react';
import ConfirmPanel from '@/components/document-centre/confirm-panel';
import { KINDS } from '@/components/document-centre/kinds';
import {
  ReviewItem,
  expiryAnswer,
  needsALook,
  uncertaintyReason,
  refileNeedsPanel,
  settleableInBulk,
} from '@/lib/document-review-rules';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { FullName } from '@/components/full-name';
import {
  CredentialKind,
  KIND_LABELS,
  LicenceApiError,
  STATE_TONE,
  formatDate,
  licenceCentreApi,
} from '@/lib/licence-centre-api';

// Lifted out of app/licence-centre/page.tsx unchanged.

// ── the review screen ───────────────────────────────────────────────
//
// Operator, 2026-08-25, on the approved drawing: "Review screen looks right,
// build it."
//
// WHAT IT REPLACES. A batch used to be taken apart the moment it landed: one
// full-width confirm panel per document, in upload order, inside a toolbar
// flex cell, with nothing but "N documents left to check" for context — and
// that panel shows no filename and no picture. Five things filed as
// "Something else" were five identical screens asking what they were, and the
// three we were unsure about sat at positions 2, 7 and 11 behind nine
// identical panels with no way to see them together or skip to them.
//
// ⚠️ EVERY ROW OWNS ITS OWN STATE, AND THAT IS THE WHOLE SAFETY STORY. The
// queue this replaces carries a comment recording what happens when it does
// not: advancing it handed one document's state to the next, so confirming a
// photograph of a safe opened the firearm licence behind it with "Never
// expires" already ticked and the expiry we had just read off it cleared,
// under one button reading "That is right" — filing the licence as a safe
// photograph and stamping it confirmed. That is a licence no reminder can
// ever fire for again. A screen that shows a whole batch at once is exactly
// where that class of bug lives, so nothing here is shared between rows: the
// panel is keyed on the document, and the accept path reads each row's own
// proposal and never a running variable.
//
// ⚠️ AND THE FIRST DRAFT OF THIS SCREEN REACHED THAT SAME END STATE ANYWAY,
// through its own repair gesture. A pre-ship review caught it. The one-tap
// type control let a member re-file a mis-read document without opening the
// panel — and posted the OLD kind's date answer with the NEW kind. A firearm
// licence wrongly filed as a photograph arrives with "Never expires" already
// ticked by the server, because that is right for a photograph; one tap to
// correct the type therefore stamped the licence confirmed, with no expiry,
// and dropped it out of every surface that would have asked again. Hence
// `settleableInBulk` and the guard at the top of `refile`: a date is only
// carried across a change of type when we READ it off the page, because that
// is a fact about the document rather than about our guess at what it is.

/**
 * Two document fetches at a time, no more.
 *
 * ⚠️ A THUMBNAIL COSTS THE MOST EXPENSIVE REQUEST ON THIS PAGE. There is no
 * thumbnail column and nothing generates one: the only way to draw a document
 * is to fetch and decrypt its whole bytes, which is why the detail panel
 * deliberately shows no preview at all. It is worth it HERE and only here —
 * a triage row without a picture cannot do its job, which is the reason the
 * panel this replaces could not do its job either. Twelve rows firing twelve
 * concurrent decrypting reads at a single-process API is not, so they queue.
 */
const THUMB_AT_ONCE = 2;
const thumbGate: { active: number; waiting: (() => void)[] } = {
  active: 0,
  waiting: [],
};
async function withThumbSlot(
  run: () => Promise<void>,
  /** Checked AFTER the wait: a row that has gone must not spend its turn. */
  cancelled: () => boolean,
): Promise<void> {
  if (thumbGate.active >= THUMB_AT_ONCE) {
    await new Promise<void>((resolve) => thumbGate.waiting.push(resolve));
  }
  thumbGate.active += 1;
  try {
    // ⚠️ THE SLOT IS STILL TAKEN AND RELEASED. Returning before `run` skips
    // the fetch, not the bookkeeping — bailing out without the increment and
    // the finally below would leak a slot and eventually wedge the queue.
    if (cancelled()) return;
    await run();
  } finally {
    thumbGate.active -= 1;
    thumbGate.waiting.shift()?.();
  }
}

function GlyphThumb({ label }: { label?: string }) {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)]"
      aria-hidden
    >
      {label ? (
        <span className="text-[8.5px] font-semibold tracking-[0.06em] text-[var(--text-tertiary-on-card)]">
          {label}
        </span>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--border-hover)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      )}
    </div>
  );
}

/**
 * The document itself, at 40px.
 *
 * ⚠️ THE TYPE IS A HINT, NOT A VERDICT. `mimeType` holds whatever the browser
 * declared when the file was picked, copied verbatim and never re-checked
 * against the bytes — so it decides whether to spend a fetch, and the image's
 * own error decides whether the result can actually be drawn.
 */
function DocThumb({
  token,
  id,
  mimeType,
}: {
  token: () => Promise<string | null>;
  id: string;
  mimeType: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [broke, setBroke] = useState(false);
  /**
   * ⚠️ THE TOKEN GETTER IS HELD IN A REF, NOT A DEPENDENCY. It comes from
   * Clerk through a useCallback; a re-created identity in the dependency list
   * would re-run this effect, and this effect fetches and decrypts a whole
   * document. A refetch loop here is not a wasted render, it is a wasted
   * request per row per render.
   */
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const isImage = mimeType.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    let made: string | null = null;
    void withThumbSlot(
      async () => {
        try {
          const u = await licenceCentreApi.fileBlobUrl(tokenRef.current, id);
          if (!alive) {
            URL.revokeObjectURL(u);
            return;
          }
          made = u;
          setUrl(u);
        } catch {
          // The glyph is the fallback and says nothing alarming. A thumbnail
          // that will not load is not a reason to interrupt a member who is
          // trying to file their documents.
          if (alive) setBroke(true);
        }
      },
      () => !alive,
    );
    return () => {
      alive = false;
      // ⚠️ REVOKED, ALWAYS. These are decrypted document bytes sitting in
      // browser memory; a batch of twelve left pinned for the life of the tab
      // is both a leak and the wrong thing to leave lying about.
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, isImage]);

  if (!isImage) {
    return (
      <GlyphThumb label={mimeType === 'application/pdf' ? 'PDF' : undefined} />
    );
  }
  if (!url || broke) return <GlyphThumb />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      onError={() => setBroke(true)}
      className="h-10 w-10 shrink-0 rounded-[6px] border border-[var(--border)] object-cover"
    />
  );
}

/** Numbers a rejected row apart from its filename, which is not unique. */
let rejectSeq = 0;

/** A file that never became a document. */
export interface RejectedFile {
  /** Its own identity: two folders can hand us two files called scan.jpg. */
  key: string;
  name: string;
  reason: string;
  /**
   * Kept only where trying again could possibly work.
   *
   * ⚠️ ABSENT ON A PRE-FLIGHT REFUSAL, DELIBERATELY. A .HEIC is still a .HEIC
   * and a 14 MB photo is still 14 MB; offering "Try again" on those is a
   * button whose only outcome is the same refusal, which reads as the site
   * being broken rather than the file being wrong.
   */
  file?: File;
}

export default function ReviewScreen({
  token,
  items,
  rejected,
  uploading,
  onFinish,
  onRetry,
  onChanged,
}: {
  token: () => Promise<string | null>;
  items: ReviewItem[];
  rejected: RejectedFile[];
  /** AddPanel is mid-upload — its progress line is behind this overlay. */
  uploading: boolean;
  /** Leave the review. The documents stay exactly as they are. */
  onFinish: () => void;
  onRetry: (r: RejectedFile) => void;
  /** Re-read the list behind the overlay. */
  onChanged: () => Promise<void>;
}) {
  /**
   * ONE DOCUMENT IS NOT A BATCH. A group label over a single row, a chip
   * counting to one and a tap to reach the date form is worse than the panel
   * this screen replaced — and one document is the ordinary phone path.
   */
  const single = items.length === 1 && rejected.length === 0;

  const [done, setDone] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(single ? items[0].id : null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const busy = working || uploading;
  const left = items.filter((d) => !done.includes(d.id));

  // ⚠️ SORTED BY WHAT NEEDS A HUMAN, NOT BY UPLOAD ORDER. The whole complaint
  // about the queue this replaces is that the two documents worth looking at
  // sat behind nine that were not.
  const needs = left.filter((d) => needsALook(d) || !settleableInBulk(d));
  const fine = left.filter((d) => !needs.includes(d));
  // Two different reasons a row needs the member, and they get two different
  // words: one is a guess at what the document IS, the other is a missing
  // date on a document whose type was never in question.
  const unsureCount = needs.filter(needsALook).length;
  const datelessCount = needs.length - unsureCount;

  const panelFor = open ? left.find((d) => d.id === open) : null;
  const sheetItem = sheetFor ? left.find((d) => d.id === sheetFor) : null;
  const finished = left.length === 0 && rejected.length === 0;

  /**
   * ⚠️ TWO DIALOGS, TWO TRAPS, AND THE INNER ONE WINS.
   *
   * Both of these carried `role="dialog" aria-modal="true"` and neither
   * trapped anything: Tab left the overlay into the page behind — where
   * Delete sits, on a document this screen is in the middle of asking about —
   * Escape did nothing, and the list underneath scrolled while the dialog was
   * up. The outer trap stands down while the type sheet is open so one
   * Escape closes one thing.
   */
  const overlayRef = useFocusTrap<HTMLDivElement>({
    active: !sheetFor,
    onClose: onFinish,
  });
  const sheetRef = useFocusTrap<HTMLDivElement>({
    active: !!sheetItem,
    onClose: () => setSheetFor(null),
  });

  /** One document settled — drop it from the review and refresh behind. */
  async function settle(id: string) {
    setDone((d) => [...d, id]);
    setOpen(null);
    setSheetFor(null);
    await onChanged().catch(() => undefined);
  }

  /**
   * "These N are right."
   *
   * ⚠️ ONE ROW AT A TIME, AND EACH FROM ITS OWN PROPOSAL. There is no batch
   * confirm route; this is N posts. They run in series because a confirm
   * writes and then resolves a notification, and because a failure part-way
   * has to leave the rows it did not reach alone and say which ones those are
   * — not abandon the batch and not claim it finished.
   */
  async function acceptAll() {
    setWorking(true);
    setErr(null);
    const settled: string[] = [];
    const stuck: string[] = [];
    for (const d of fine) {
      const expires = expiryAnswer(d);
      // Cannot happen — `fine` excludes these — but a batch write is the last
      // place to trust that a filter upstream stayed correct.
      if (expires === null) {
        stuck.push(d.title);
        continue;
      }
      try {
        await licenceCentreApi.confirm(token, d.id, {
          expiresOn: expires,
          issuedOn: d.issuedOnUnknown
            ? undefined
            : d.proposed.issuedOn || undefined,
          neverExpires: d.neverExpires,
          issuedOnUnknown: d.issuedOnUnknown,
          // ⚠️ NO kind AND NO title. This gesture means "the dates and the
          // filing are right", so it changes as little as it can: sending a
          // kind is the one thing here that can put a document in the wrong
          // box, and nothing on this path has asked the member about the type.
          // The rows where the type IS in question are in `needs`, not here.
        });
        settled.push(d.id);
      } catch (ex) {
        stuck.push(
          `${d.title}${ex instanceof LicenceApiError ? ` — ${ex.message}` : ''}`,
        );
      }
    }
    setDone((prev) => [...prev, ...settled]);
    setErr(
      stuck.length
        ? `We could not finish ${stuck.length === 1 ? 'one' : stuck.length}: ${stuck.join(' · ')}. ${stuck.length === 1 ? 'It is' : 'They are'} still here.`
        : null,
    );
    setWorking(false);
    await onChanged().catch(() => undefined);
  }

  /** The member picked a type from the sheet. */
  async function refile(d: ReviewItem, kind: CredentialKind) {
    /**
     * ⚠️ A CHANGE OF TYPE GOES THROUGH THE PANEL UNLESS WE READ A DATE OFF THE
     * PAGE. This is the guard the pre-ship review put here, and the header of
     * this section says what it prevents. Every other kind of date answer this
     * row carries was derived from the type we GUESSED — "Never expires" is
     * pre-ticked by the server for a photograph, and a worked-out expiry comes
     * from the statute for the kind we assumed. Carrying either across a
     * correction posts the old guess's answer under the new type, and for a
     * licence wrongly filed as a photograph that means confirmed, dateless and
     * beyond the reach of every reminder, in one tap.
     *
     * A date printed on the document is a fact about the document, so it
     * survives the correction. Picking the SAME type is not a correction and
     * needs no guard.
     */
    if (refileNeedsPanel(d, kind)) {
      setSheetFor(null);
      setOpen(d.id);
      return;
    }
    const expires = expiryAnswer(d);
    /* istanbul ignore next — refileNeedsPanel already excludes this. */
    if (expires === null) {
      setSheetFor(null);
      setOpen(d.id);
      return;
    }
    setWorking(true);
    setErr(null);
    try {
      await licenceCentreApi.confirm(token, d.id, {
        expiresOn: expires,
        issuedOn: d.issuedOnUnknown
          ? undefined
          : d.proposed.issuedOn || undefined,
        neverExpires: d.neverExpires,
        issuedOnUnknown: d.issuedOnUnknown,
        kind,
      });
      setWorking(false);
      await settle(d.id);
    } catch (ex) {
      setWorking(false);
      setErr(
        ex instanceof LicenceApiError
          ? ex.message
          : 'We could not file that just now.',
      );
    }
  }

  return (
    <div
      /* ⚠️ THE TRAP IS WHAT MAKES aria-modal TRUE. Without it this markup told
         a screen reader nothing outside mattered while Tab walked straight
         out into the page behind — where Delete sits, on a document this
         dialog is in the middle of asking about. Escape now leaves the review
         (the documents stay exactly as they are; see onFinish), and the list
         behind stops scrolling under the fingers of anybody scrolling this.

         ⚠️ SUSPENDED WHILE THE TYPE SHEET IS UP. The sheet is a dialog inside
         this one and runs its own trap; two live traps would answer one
         Escape twice. `useFocusTrap` also stacks, so this is belt and
         braces — but it is the half that keeps the restore honest. */
      ref={overlayRef}
      /* ⚠️ z-[60] AND TAGGED. The bottom tab bar sits at z55/56, so anything
         lower is occluded on a phone; and the add menu stands down on this
         marker rather than treating a tap in here as a tap outside itself. */
      data-blocking-overlay="true"
      className="fixed inset-0 z-[60] overflow-y-auto bg-[var(--bg)]"
      role="dialog"
      aria-modal="true"
      aria-label="Check what we made of your documents"
    >
      <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
        {finished ? (
          <div className="pt-10 text-center">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
              {done.length === 1
                ? 'That one is filed'
                : `All ${done.length} filed`}
            </h2>
            <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
              We will remind you before anything here runs out.
            </p>
            <button
              type="button"
              onClick={onFinish}
              className="mx-auto mt-6 rounded-[10px] border border-[var(--red)] bg-[var(--red)] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[var(--red-hover)]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {panelFor && (
              <>
                {!single && (
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    className="mb-4 text-[12.5px] text-[var(--text-secondary)] underline"
                  >
                    ← Back to the list
                  </button>
                )}
                {/* ⚠️ KEYED ON THE DOCUMENT. Not decoration: see the note at
                    the top of this section for what a shared panel instance
                    did to the document behind it in the queue. */}
                <ConfirmPanel
                  key={panelFor.id}
                  token={token}
                  id={panelFor.id}
                  proposed={panelFor.proposed}
                  /* ⚠️ ALWAYS THE FULL MENU. Gating this on autoFiled left a
                     member-declared document with no date sitting in "Needs
                     you" under a control labelled "Change the type" that
                     opened a panel with no type control in it. */
                  kinds={KINDS}
                  currentKind={panelFor.kind}
                  uncertain={needsALook(panelFor)}
                  reason={uncertaintyReason(panelFor)}
                  notes={panelFor.readNotes ?? []}
                  defaultTitle={panelFor.title}
                  neverExpires={panelFor.neverExpires}
                  issuedOnUnknown={panelFor.issuedOnUnknown}
                  cancelLabel={single ? 'I will do this later' : 'Back to the list'}
                  onDone={async () => {
                    await settle(panelFor.id);
                  }}
                  /* ⚠️ CANCEL IS NOT DONE, AND SHARING ONE CALLBACK SAID IT
                     WAS. Backing out counted the document as filed: it left
                     the review, the green "N filed" line went up by one, and
                     confirmedAt was still null — so nothing reminded on it and
                     nothing asked again. */
                  onCancel={() => (single ? onFinish() : setOpen(null))}
                />
              </>
            )}

            {/* ⚠️ HIDDEN, NOT UNMOUNTED. Rendering this branch only when no
                panel is open tore down every thumbnail each time a row was
                opened, and each one is a fetch and a whole-file decrypt with
                no cache behind it — a twelve-document batch with two amber
                rows cost thirty-three full document reads instead of twelve. */}
            <div className={panelFor ? 'hidden' : ''}>
              <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
                We read {items.length}
              </h2>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {fine.length > 0 && (
                  <span className="rounded-full border border-[rgba(47,158,107,0.42)] bg-[rgba(47,158,107,0.09)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                    {fine.length} look{fine.length === 1 ? 's' : ''} right
                  </span>
                )}
                {unsureCount > 0 && (
                  /* ⚠️ --warning, NOT --gold, AND NOT A HARDCODED AMBER.
                     `--gold` is 3.56:1 on this surface and the two rgba()
                     values were the retired dark theme's amber, which no
                     token has matched since the white theme landed. Same
                     colour as the "Not sure" marker on the row it counts,
                     which is the point of a count. */
                  <span
                    className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]"
                    style={{
                      borderColor: STATE_TONE.expiring.line,
                      background: STATE_TONE.expiring.wash,
                    }}
                  >
                    {unsureCount} we are not sure about
                  </span>
                )}
                {datelessCount > 0 && (
                  <span className="rounded-full border border-[var(--border-hover)] bg-[var(--bg-inset)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                    {datelessCount} need{datelessCount === 1 ? 's' : ''} a date
                  </span>
                )}
                {rejected.length > 0 && (
                  <span className="rounded-full border border-[rgba(200,16,46,0.5)] bg-[rgba(200,16,46,0.09)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--red)]">
                    {rejected.length} did not go through
                  </span>
                )}
              </div>

              {done.length > 0 && (
                <p className="mt-3 text-[12px] text-[var(--success)]" role="status">
                  {done.length} filed.
                </p>
              )}
              {uploading && (
                <p
                  className="mt-3 text-[12px] text-[var(--text-secondary)]"
                  role="status"
                >
                  Adding…
                </p>
              )}

              {(needs.length > 0 || rejected.length > 0) && (
                <GroupLabel>Needs you</GroupLabel>
              )}
              <div className="flex flex-col gap-2">
                {needs.map((d) => (
                  <ReviewRow
                    key={d.id}
                    token={token}
                    item={d}
                    attention
                    unsure={needsALook(d)}
                    busy={busy}
                    onOpen={() => setOpen(d.id)}
                    onType={() =>
                      settleableInBulk(d) ? setSheetFor(d.id) : setOpen(d.id)
                    }
                  />
                ))}
                {rejected.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-2.5"
                  >
                    <GlyphThumb />
                    <div className="min-w-0 flex-1">
                      <FullName as="p" className="text-[12.5px] font-medium">
                        {r.name}
                      </FullName>
                      <p className="text-[11px] text-[var(--red)]">{r.reason}</p>
                    </div>
                    {r.file && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRetry(r)}
                        className="shrink-0 rounded-[6px] border border-[var(--border-hover)] bg-[var(--bg-inset)] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {fine.length > 0 && <GroupLabel>Look right</GroupLabel>}
              <div className="flex flex-col gap-2">
                {fine.map((d) => (
                  <ReviewRow
                    key={d.id}
                    token={token}
                    item={d}
                    busy={busy}
                    onOpen={() => setOpen(d.id)}
                    onType={() =>
                      settleableInBulk(d) ? setSheetFor(d.id) : setOpen(d.id)
                    }
                  />
                ))}
              </div>

              {err && (
                <p className="mt-4 text-[12.5px] text-[var(--red)]" role="alert">
                  {err}
                </p>
              )}

              <div className="mt-6 flex flex-col gap-2">
                {fine.length > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void acceptAll()}
                    className="rounded-[10px] border border-[var(--red)] bg-[var(--red)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
                  >
                    {working
                      ? 'Filing…'
                      : `${fine.length === 1 ? 'This one is' : `These ${fine.length} are`} right`}
                  </button>
                )}
                {/* ⚠️ BORDERED WHEN IT IS THE ONLY WAY OUT. With nothing to
                    accept, a borderless grey line was the sole control on the
                    screen and did not read as a control at all. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={onFinish}
                  className={
                    fine.length > 0
                      ? 'rounded-[10px] px-4 py-2 text-[12.5px] text-[var(--text-secondary)] disabled:opacity-50'
                      : 'rounded-[10px] border border-[var(--border-hover)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--bg-card-hover)] disabled:opacity-50'
                  }
                >
                  {/* ⚠️ TRUE AS WRITTEN. Nothing here is a draft: every
                      document is already stored and already in the list. What
                      is outstanding is the member's confirmation, and the way
                      back to it is the button on each row. */}
                  Finish later — they are saved
                </button>
              </div>

              <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-tertiary-on-card)]">
                Nothing is reminded about until you have checked its dates.
                {rejected.length > 0
                  ? ' Files that did not go through were never added.'
                  : ''}
              </p>
            </div>
          </>
        )}
      </div>

      {sheetItem && (
        <div
          className="fixed inset-0 z-[61] flex items-end justify-center bg-black/60"
          onClick={() => setSheetFor(null)}
        >
          <div
            ref={sheetRef}
            className="w-full max-w-2xl rounded-t-[16px] border-t border-[var(--border-hover)] bg-[var(--bg-card)] p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="What is this document?"
          >
            <p className="mb-3 text-[13px] font-semibold">
              What is this document?
            </p>
            <div className="flex max-h-[52vh] flex-col gap-0.5 overflow-y-auto">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() => void refile(sheetItem, k)}
                  className={`flex min-h-[44px] items-center justify-between gap-3 rounded-[6px] border px-3 text-left text-[12.5px] disabled:opacity-50 ${
                    k === sheetItem.kind
                      ? 'border-[var(--red)] bg-[rgba(200,16,46,0.09)] font-semibold'
                      : 'border-transparent hover:bg-[var(--bg-card-hover)]'
                  }`}
                >
                  <span>{KIND_LABELS[k] ?? k}</span>
                  {k === sheetItem.kind && (
                    <span className="text-[var(--red)]">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
      {children}
      <span className="h-px flex-1 bg-[var(--border-divider)]" />
    </p>
  );
}

function ReviewRow({
  token,
  item,
  attention = false,
  unsure = false,
  busy,
  onOpen,
  onType,
}: {
  token: () => Promise<string | null>;
  item: ReviewItem;
  /** In the "needs you" group, for whatever reason. */
  attention?: boolean;
  /** We guessed the TYPE and are not sure — a narrower thing than attention. */
  unsure?: boolean;
  busy: boolean;
  onOpen: () => void;
  onType: () => void;
}) {
  const kindLabel = KIND_LABELS[item.kind] ?? item.kind;
  /**
   * What is outstanding about this row's dates.
   *
   * ⚠️ A WORKED-OUT DATE IS NOT SHOWN AS A DATE. `derivedExpiry` only exists
   * where the document prints no expiry and a statute supplies one; printing
   * that number here, in the same style as one we read off the page, would
   * make a calculation look like a reading. The panel explains it; the row
   * says there is something to look at.
   */
  const when = item.neverExpires
    ? 'Kept on file'
    : item.proposed.expiresOn
      ? formatDate(item.proposed.expiresOn)
      : item.proposed.derivedExpiry
        ? 'No date printed on it'
        : 'No date yet';

  return (
    <div
      className="flex items-center gap-3 rounded-[10px] border p-2.5"
      /* ⚠️ INLINE, AND DERIVED FROM THE TOKEN. Both of these were hardcoded
         rgba(232,181,58,…) — the RETIRED dark theme's amber, matching no
         token on the white page — and neither could be written as a Tailwind
         arbitrary value without inventing the first color-mix class in the
         codebase. STATE_TONE already derives exactly this pair from
         --warning, so the row and the "Renewal due" pill cannot drift. */
      style={
        attention
          ? {
              borderColor: STATE_TONE.expiring.line,
              background: STATE_TONE.expiring.wash,
            }
          : {
              borderColor: 'var(--border)',
              background: 'var(--bg-card)',
            }
      }
    >
      <DocThumb token={token} id={item.id} mimeType={item.mimeType} />

      {/* The row body opens the full panel — dates, ticks, the name and the
          type menu — which is the only place a document with no date can be
          answered at all. */}
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="min-w-0 flex-1 text-left disabled:opacity-50"
      >
        <FullName className="text-[12.5px] font-medium">
          {item.title}
        </FullName>
        {/* ⚠️ THE DATE ONLY. The type used to be repeated here as well, which
            put "Photographs of my safe" on the title, the subtitle AND the
            control — three copies on one row. */}
        <span className="block truncate text-[11px] text-[var(--text-tertiary-on-card)]">
          {when}
        </span>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={onType}
          disabled={busy}
          aria-label={`Change the type of ${item.title} — currently ${kindLabel}`}
          /* ⚠️ CAPPED AND TRUNCATED. Some registry labels are long
             ("Association status or membership") and a phone row has no room
             to argue; the full label is on the sheet this opens.

             ⚠️ AND THE CHIP IS 30px WITH A 44px HIT BOX, not a 44px chip. It
             sits in a stack beside a 12.5px title on a phone row; growing it
             to the touch minimum would make the CONTROL louder than the
             document it belongs to. The pseudo-element carries the target
             instead — nothing beside it is interactive, so the overlap costs
             nothing. */
          className="relative block min-h-[30px] max-w-[7rem] rounded-full border border-[var(--border-hover)] bg-[var(--bg-inset)] px-3 text-[10.5px] font-semibold after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-full after:min-w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] disabled:opacity-50 sm:max-w-[12rem]"
        >
          {/* ⚠️ THE TRUNCATION MOVED IN HERE, off the button. `truncate` sets
              `overflow: hidden`, which CLIPS the pseudo-element carrying the
              44px touch target back to the 30px chip — the fix would have
              rendered identically and done nothing. */}
          <span className="block truncate">{kindLabel} ▾</span>
        </button>
        {unsure && (
          /* ⚠️ A WORD, NOT ONLY A COLOUR, AND ONLY WHERE IT IS TRUE. Amber
             against green is the red-green-blind failure pair; and a document
             whose type the MEMBER chose is not one we are unsure about, it
             just has no date yet — the subtitle says so.

             ⚠️ --warning, NOT --gold, AND NEVER BELOW 11px. `--gold` measures
             3.56:1 on this card — under AA for any size — so the one marker
             saying "we may have filed this wrongly" was the least legible
             thing on the row. `--warning` was retuned to #8F6E0F for exactly
             this white theme and passes. */
          <span className="text-[11px] font-semibold text-[var(--warning)]">
            Not sure
          </span>
        )}
      </div>
    </div>
  );
}


/**
 * The next rejected-row key.
 *
 * ⚠️ THE COUNTER STAYS WITH THE TYPE IT NUMBERS. The uploader in the page
 * mints these; exporting the counter rather than copying it keeps one
 * sequence, so two panels open at once cannot issue the same key.
 */
export function nextRejectKey(): string {
  rejectSeq += 1;
  return `r${rejectSeq}`;
}

