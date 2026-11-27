'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { motivationsApi } from '@/lib/motivations-api';
import type { SheetResponse } from '@/components/licence-centre/contract';
import BetaNotice from '@/components/licence-centre/beta-notice';
import AnswersReview, {
  canContinueToWrite,
  reviewStats,
} from '@/components/licence-centre/answers-review';

// ────────────────────────────────────────────────────────────────────
// CHECK YOUR ANSWERS — the editable review screen.
//
// ⚠️ THE ROUTE IS THE SAME, THE JOB IS NOT. This used to be "Finish what is
// missing": a screen that only listed the gaps and then wrote the document.
// Nobody could change an answer they had already given except by walking the
// interview again, so a wrong calibre or a wrong date stayed wrong all the way
// onto a police form. It now shows EVERY answer, grouped the way the sheet
// groups them, and every one of them can be changed before we write.
//
// ⚠️ NOT AN ENDLESS FORM ANY MORE. The operator's live report was "These seem to
// be 271 form questions? And why do I have to scroll and fill in this endless
// page?" The rows below are FOLDED (see answers-review.tsx): an attention panel
// at the top, one section per group opening only where it has a gap or a drafted
// answer, and the 271's own boxes in a collapsed optional block that never
// counts and never gates "Continue to write".
//
// ⚠️ DRAFTED ANSWERS ARE FLAGGED, NOT HIDDEN. The personal history is composed
// by the writer from the applicant's own documents and application; the gold
// "Drafted for you — check it" flag with Edit and Confirm is the only thing
// standing between a composed sentence and a signed statement.
//
// ⚠️ IT IS NOT THE PACK. Continue to write goes to the pack, where the
// declaration is confirmed and the money moves. Nothing here writes the
// document.
// ────────────────────────────────────────────────────────────────────

/**
 * How long the screen keeps asking whether the writer has finished drafting.
 *
 * ⚠️ A BACKGROUND PASS, NEVER A BLOCKING WAIT. It fills the narrative answers
 * the interview does not ask; while it runs the screen is completely usable. It
 * gives up after ninety seconds rather than polling for ever.
 */
const DRAFT_POLL_MS = 90_000;
const DRAFT_TICK_MS = 2_000;

export default function CheckAnswersPage() {
  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The row currently writing, so only that row says "Saving…". */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  /** The drafting pass finished; the sheet is refreshed exactly once. */
  const wasDrafting = useRef(false);

  const loadSheet = useCallback(async () => {
    const next = await motivationsApi.sheet(getToken, id);
    setSheet(next);
  }, [getToken, id]);

  /**
   * The intake read exists for ONE field: `drafting`.
   *
   * ⚠️ ITS FAILURE MUST NOT TAKE THE SHEET DOWN. The sheet is the screen; the
   * drafting status is a line on it. A failed intake read leaves the status
   * line off rather than showing an error over somebody's answers.
   */
  const loadIntake = useCallback(async () => {
    try {
      const next = await motivationsApi.intake(getToken, id);
      setDrafting(next.drafting === true);
    } catch {
      setDrafting(false);
    }
  }, [getToken, id]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        await loadSheet();
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    void loadIntake();
  }, [id, loadSheet, loadIntake]);

  // The support timeline: the review screen was opened. Fire and forget — a
  // failed beacon must never surface on a form the member is filling in.
  useEffect(() => {
    if (!id) return;
    void motivationsApi
      .activity(getToken, id, 'client_page_view', {
        path: '/licence-centre/[id]',
      })
      .catch(() => undefined);
  }, [getToken, id]);

  /**
   * Poll while the writer drafts, then reload the sheet it filled.
   *
   * ⚠️ STOPPED BY UNMOUNT AND BY THE DEADLINE. A poll that outlives its screen
   * is a request per two seconds from a tab somebody closed.
   */
  useEffect(() => {
    if (!drafting) return;
    const deadline = Date.now() + DRAFT_POLL_MS;
    const timer = window.setInterval(() => {
      if (Date.now() > deadline) {
        window.clearInterval(timer);
        return;
      }
      void loadIntake();
    }, DRAFT_TICK_MS);
    return () => window.clearInterval(timer);
  }, [drafting, loadIntake]);

  /** The pass just finished: the drafted rows are on the sheet now. */
  useEffect(() => {
    if (drafting) {
      wasDrafting.current = true;
      return;
    }
    if (!wasDrafting.current) return;
    wasDrafting.current = false;
    void loadSheet().catch((err) => setError((err as Error).message));
  }, [drafting, loadSheet]);

  /**
   * Write one changed answer.
   *
   * ⚠️ `saveAnswers`, NOT THE INTERVIEW'S PATCH. This screen edits the
   * application's answers directly; the server re-derives the plan and re-drafts
   * the narrative from the corrected facts after it. The intake read is
   * refreshed too, because that change can start a drafting pass.
   */
  const saveRow = useCallback(
    async (key: string, value: string) => {
      setBusyKey(key);
      setError(null);
      try {
        await motivationsApi.saveAnswers(getToken, id, { [key]: value });
        await loadSheet();
        void loadIntake();
      } finally {
        setBusyKey(null);
      }
    },
    [getToken, id, loadSheet, loadIntake],
  );

  /**
   * Accept a drafted value exactly as written.
   *
   * ⚠️ THE WRITE THAT SAVES NOTHING. Only a value that MOVED is stamped MEMBER,
   * so without this call a drafted answer the applicant is happy with would keep
   * asking to be checked. See confirmAnswer in lib/motivations-api.ts.
   */
  const confirmRow = useCallback(
    async (key: string) => {
      setConfirmingKey(key);
      setError(null);
      try {
        await motivationsApi.confirmAnswer(getToken, id, key);
        await loadSheet();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setConfirmingKey(null);
      }
    },
    [getToken, id, loadSheet],
  );

  /**
   * ONE SOURCE FOR THE COUNTS AND THE GATING.
   *
   * ⚠️ 271 FORM BOXES ARE EXCLUDED THERE, IN ONE PLACE. `reviewStats` filters
   * them out of `missingCount`, which is both what the attention panel says and
   * what enables Continue — a second count on this page is how the two drift.
   */
  const stats = useMemo(() => (sheet ? reviewStats(sheet) : null), [sheet]);
  const canContinue =
    sheet !== null && stats !== null && canContinueToWrite(stats, drafting);

  if (!sheet) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 py-10 text-[13.5px] text-[var(--text-tertiary)]">
        {error ?? 'Loading your answers…'}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-5">
      {/* One popup, at the start, per application. See the component. */}
      <BetaNotice motivationId={id} />
      <Link
        href="/licence-centre/applications"
        className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-medium text-[var(--text-secondary)] no-underline"
      >
        <span aria-hidden="true">&#8592;</span> Back to your applications
      </Link>

      <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
        Check your answers
      </h1>
      <p className="m-0 mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
        {sheet.application.title ?? sheet.application.licenceTypeLabel} ·{' '}
        {sheet.application.referenceNumber}
      </p>
      <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-tertiary)]">
        Everything we will write the motivation from, in one place. Change
        anything that is wrong — it saves as you go.
      </p>

      {/*
        ⚠️ A STATUS LINE, NOT A BLOCKING PANEL. The writer is composing the
        narrative answers the interview does not ask; the rest of the screen
        stays exactly as usable while it runs.
      */}
      {drafting ? (
        <p
          role="status"
          className="mt-2 text-[12.5px] leading-5 text-[var(--text-tertiary)]"
        >
          Writing your draft from your documents… you can keep checking.
        </p>
      ) : null}

      <AnswersReview
        sheet={sheet}
        busyKey={busyKey}
        confirmingKey={confirmingKey}
        onSave={saveRow}
        onConfirm={confirmRow}
        interviewHref={`/licence-centre/${id}/interview`}
      />

      {error ? (
        <p className="mt-4 text-[12.5px] leading-5 text-[var(--red)]">
          {error}
        </p>
      ) : null}

      {/*
        ⚠️ THE PRIMARY ACTION WRITES NOTHING. It goes to the pack, where the
        declaration is confirmed and payment happens. Disabled while a drafted
        answer is landing or while the sheet is actually holding out for a
        required answer or document — a 271 form box is never one of those.
      */}
      <div className="mt-8 border-t border-[var(--border-divider)] pt-5">
        <button
          type="button"
          disabled={!canContinue}
          onClick={() => router.push(`/licence-centre/${id}/pack`)}
          className="w-full rounded-[var(--r-sm)] px-4 py-3 text-[14px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--action-primary-bg)' }}
        >
          Continue to write
        </button>
        <p className="m-0 mt-2 text-[12px] leading-5 text-[var(--text-tertiary)]">
          {drafting
            ? 'We are drafting from your documents — you can continue as soon as it lands.'
            : stats && stats.missingCount
              ? 'Finish the outstanding answers or documents before writing.'
              : 'We write the motivation from these answers. You can still change them on the next screen.'}
        </p>
        <div className="mt-3">
          <Link
            href={`/licence-centre/${id}/interview`}
            className="text-[13px] text-[var(--text-secondary)] underline"
          >
            Back to the interview
          </Link>
        </div>
      </div>
    </main>
  );
}
