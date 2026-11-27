'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { motivationsApi } from '@/lib/motivations-api';
import type {
  SheetItem,
  SheetResponse,
} from '@/components/licence-centre/contract';
import BetaNotice from '@/components/licence-centre/beta-notice';
import AnswerReviewRow from '@/components/licence-centre/answer-review-row';

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

/**
 * A required answer the sheet still owes.
 *
 * ⚠️ A DRAFTED VALUE IS NOT MISSING. It is present and flagged for checking —
 * the one state that asks for a decision, not for an answer. Counting it as a
 * gap would disable Continue until the applicant found and confirmed something
 * the warning had already told them was fine to leave.
 */
function isMissing(item: SheetItem, missingKeys: Set<string>): boolean {
  if (item.state === 'na') return false;
  if (item.state === 'suggested') return false;
  if (item.state === 'needs_you') {
    return item.required || missingKeys.has(item.key);
  }
  return missingKeys.has(item.key) && !item.value;
}

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
   * Every section in the sheet's own order — including the ones that are
   * already done — with the missing rows first inside each.
   */
  const sections = useMemo(() => {
    if (!sheet) return [];
    const missingKeys = new Set<string>(sheet.missing ?? []);
    for (const section of sheet.sections) {
      for (const key of section.missing ?? []) missingKeys.add(key);
    }
    const bySection = new Map<string, SheetItem[]>();
    for (const item of sheet.items) {
      if (item.state === 'na') continue;
      const list = bySection.get(item.section) ?? [];
      list.push(item);
      bySection.set(item.section, list);
    }
    return sheet.sections
      .map((section) => {
        const items = bySection.get(section.id) ?? [];
        return {
          section,
          missing: items.filter((item) => isMissing(item, missingKeys)),
          rest: items.filter((item) => !isMissing(item, missingKeys)),
        };
      })
      .filter((entry) => entry.missing.length + entry.rest.length > 0);
  }, [sheet]);

  const missingDocuments = useMemo(
    () =>
      (sheet?.needs.needs ?? []).filter(
        (need) => need.tier === 'required' && !need.have,
      ),
    [sheet],
  );

  const missingAnswers = sheet?.missing.length ?? 0;
  const missingCount = missingAnswers + missingDocuments.length;
  const nothingMissing = sheet !== null && missingCount === 0;
  const canContinue = sheet !== null && !drafting && missingCount === 0;

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

      {nothingMissing ? (
        <section
          className="mt-4 rounded-[var(--r-lg)] border px-4 py-3"
          style={{
            borderColor: 'var(--success-line)',
            background: 'var(--success-wash)',
          }}
        >
          <p className="m-0 text-[13.5px] font-medium text-[var(--text-primary)]">
            Nothing is missing. Your motivation is ready to write.
          </p>
          <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
            Check the answers below once more, then continue.
          </p>
        </section>
      ) : (
        <section
          className="mt-4 rounded-[var(--r-lg)] border px-4 py-3"
          style={{
            borderColor: 'var(--warning-line)',
            background: 'var(--warning-wash)',
          }}
        >
          <p className="m-0 text-[13.5px] font-medium text-[var(--text-primary)]">
            {missingCount} thing{missingCount === 1 ? '' : 's'} still needed
          </p>
          <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
            Finish the outstanding answers or documents before writing.
          </p>
        </section>
      )}

      {sections.map(({ section, missing, rest }) => (
        <section key={section.id} className="mt-6">
          <h2 className="m-0 mb-2 font-[family-name:var(--font-head)] text-[17px] font-medium text-[var(--text-primary)]">
            {section.title}
          </h2>
          <div
            className="rounded-[var(--r-lg)] border px-4"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-card)',
            }}
          >
            {/* ⚠️ THE GAPS FIRST, so a section never hides the one row that needs an answer under eight that do not. */}
            {[...missing, ...rest].map((item) => (
              <AnswerReviewRow
                key={item.key}
                item={item}
                busy={busyKey === item.key || confirmingKey === item.key}
                onSave={saveRow}
                onConfirm={item.state === 'suggested' ? confirmRow : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      {missingDocuments.length ? (
        <section className="mt-6">
          <h2 className="m-0 mb-2 font-[family-name:var(--font-head)] text-[17px] font-medium text-[var(--text-primary)]">
            Documents still needed
          </h2>
          <ul className="m-0 grid gap-1.5 pl-5 text-[13px] text-[var(--text-secondary)]">
            {missingDocuments.map((need) => (
              <li key={need.kind}>{need.label}</li>
            ))}
          </ul>
          <Link
            href={`/licence-centre/${id}/interview`}
            className="mt-3 inline-flex rounded-lg border px-3 py-2 text-[12.5px] font-medium text-[var(--text-primary)]"
            style={{ borderColor: 'var(--border)' }}
          >
            Upload these in the interview
          </Link>
        </section>
      ) : null}

      {error ? (
        <p className="mt-4 text-[12.5px] leading-5 text-[var(--red)]">
          {error}
        </p>
      ) : null}

      {/*
        ⚠️ THE PRIMARY ACTION WRITES NOTHING. It goes to the pack, where the
        declaration is confirmed and payment happens. Disabled while a drafted
        answer is landing or while the document still lacks a required answer or
        document — the pack would only refuse after the member had been told they
        were ready.
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
            : missingCount
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
