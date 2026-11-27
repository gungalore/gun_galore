'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SheetItem, SheetResponse } from './contract';
import AnswerReviewRow from './answer-review-row';

// ────────────────────────────────────────────────────────────────────
// THE ANSWERS, AS FOLDED SECTIONS RATHER THAN ONE ENDLESS FORM.
//
// ⚠️ THE OPERATOR'S REPORT: "These seem to be 271 form questions? And why do I
// have to scroll and fill in this endless page?" The screen was rendering every
// sheet item — 271 form boxes included — as an always-open control in one
// scroll. It now shows what the MOTIVATION needs first: attention counts at the
// top, one folded section per answer group, and the 271's own boxes filed away
// in a collapsed block that never gates writing.
//
// ⚠️ FOLDS OPEN WHERE THEY MATTER. A section the backend marked missing, or one
// holding a drafted answer to check, opens by itself; a finished section stays
// shut until the member taps its summary. Native <details>, so keyboard and
// screen-reader users get the disclosure they already know.
//
// ⚠️ THE SAPS 271 IS THE DFO'S FORM, NOT THIS PRODUCT'S OUTPUT. Those rows are
// read from a supplied document, never asked; an empty one is not a gap and must
// not disable Continue. They live in their own block at the bottom, editable but
// collapsed, and they are excluded from every count.
// ────────────────────────────────────────────────────────────────────

/** What the attention panel and the footer need, counted once. */
export interface ReviewStats {
  /** Required answers still empty, EXCLUDING 271 form boxes. */
  missingAnswers: number;
  /** Required documents still outstanding. */
  missingDocuments: number;
  /** The two above — the number Continue is gated on. */
  missingCount: number;
  /** Suggested (drafted) answers the member has not checked yet. */
  draftedAnswers: number;
}

/**
 * One answer the sheet is actually holding out for.
 *
 * ⚠️ A DRAFTED VALUE IS NOT MISSING. It is present and flagged for checking —
 * a decision, not a gap. A 271 form box is never a gap either.
 */
export function isMissingAnswer(
  item: SheetItem,
  missingKeys: Set<string>,
): boolean {
  if (item.formOnly === true) return false;
  if (item.state === 'na') return false;
  if (item.state === 'suggested') return false;
  if (item.state === 'needs_you') {
    return item.required || missingKeys.has(item.key);
  }
  return missingKeys.has(item.key) && !item.value.trim();
}

/**
 * The counts on the attention panel.
 *
 * ⚠️ `sheet.missing` CAN NAME A 271 BOX, AND MUST NOT COUNT. The backend keeps
 * the field registry's required flags; several form boxes are required ON THE
 * FORM, not for the motivation we write. Filtering by the item's own `formOnly`
 * is what keeps an unfilled 271 box from blocking Continue.
 */
export function reviewStats(sheet: SheetResponse): ReviewStats {
  const byKey = new Map(sheet.items.map((item) => [item.key, item]));
  const missingAnswers = sheet.missing.filter(
    (key) => byKey.get(key)?.formOnly !== true,
  ).length;
  const missingDocuments = sheet.needs.needs.filter(
    (need) => need.tier === 'required' && !need.have,
  ).length;
  const draftedAnswers = sheet.items.filter(
    (item) => item.state === 'suggested' && item.formOnly !== true,
  ).length;
  return {
    missingAnswers,
    missingDocuments,
    missingCount: missingAnswers + missingDocuments,
    draftedAnswers,
  };
}

/** The one rule "Continue to write" is enabled by. */
export function canContinueToWrite(
  stats: ReviewStats,
  drafting: boolean,
): boolean {
  return !drafting && stats.missingCount === 0;
}

/** One folded section, with its rows already ordered gaps-first. */
export interface ReviewSectionView {
  section: SheetResponse['sections'][number];
  missing: SheetItem[];
  rest: SheetItem[];
  /** Opens itself: it holds a gap or a drafted answer. */
  autoOpen: boolean;
  answers: number;
  toCheck: number;
}

export function reviewSections(sheet: SheetResponse): ReviewSectionView[] {
  const missingKeys = new Set<string>(sheet.missing);
  for (const section of sheet.sections) {
    for (const key of section.missing ?? []) missingKeys.add(key);
  }
  const bySection = new Map<string, SheetItem[]>();
  for (const item of sheet.items) {
    if (item.state === 'na' || item.formOnly === true) continue;
    const list = bySection.get(item.section) ?? [];
    list.push(item);
    bySection.set(item.section, list);
  }
  return sheet.sections
    .map((section) => {
      const items = bySection.get(section.id) ?? [];
      const missing: SheetItem[] = [];
      const rest: SheetItem[] = [];
      for (const item of items) {
        if (isMissingAnswer(item, missingKeys)) missing.push(item);
        else rest.push(item);
      }
      return {
        section,
        missing,
        rest,
        autoOpen:
          missing.length > 0 || rest.some((item) => item.state === 'suggested'),
        answers: items.length,
        toCheck: items.filter((item) => item.state === 'suggested').length,
      };
    })
    .filter((view) => view.answers > 0);
}

/** The 271's own boxes, for the collapsed block at the bottom. */
export function reviewFormOnly(sheet: SheetResponse): SheetItem[] {
  return sheet.items.filter(
    (item) => item.formOnly === true && item.state !== 'na',
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The top panel: what needs a person, in counts. The rows themselves live in the
 * sections below, so this is a table of contents, not a second form.
 */
function AttentionPanel({ stats }: { stats: ReviewStats }) {
  const missing = [
    stats.missingAnswers ? plural(stats.missingAnswers, 'answer') : '',
    stats.missingDocuments ? plural(stats.missingDocuments, 'document') : '',
  ].filter(Boolean);
  const nothing = missing.length === 0 && stats.draftedAnswers === 0;
  return (
    <section
      className="mt-4 rounded-[var(--r-lg)] border px-4 py-3"
      style={
        nothing
          ? {
              borderColor: 'var(--success-line)',
              background: 'var(--success-wash)',
            }
          : {
              borderColor: 'var(--border)',
              background: 'var(--bg-card)',
            }
      }
    >
      <p className="m-0 text-[13.5px] font-medium text-[var(--text-primary)]">
        {nothing ? 'Nothing is missing. Your motivation is ready to write.' : 'Needs your attention'}
      </p>
      {missing.length ? (
        <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          {missing.join(' and ')} still needed — open the sections below, or add
          the missing documents in the interview.
        </p>
      ) : null}
      {stats.draftedAnswers ? (
        <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          {plural(stats.draftedAnswers, 'drafted answer')} to check — marked
          “Drafted for you — check it” below.
        </p>
      ) : null}
      {nothing ? (
        <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          Check the sections below once more, then continue.
        </p>
      ) : null}
    </section>
  );
}

function SectionFold({
  view,
  busyKey,
  confirmingKey,
  onSave,
  onConfirm,
}: {
  view: ReviewSectionView;
  busyKey: string | null;
  confirmingKey: string | null;
  onSave: (key: string, value: string) => Promise<void>;
  onConfirm: (key: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(view.autoOpen);
  // A fold that has just acquired a gap or a drafted answer opens itself, even
  // if the member had closed it before the last reload.
  useEffect(() => {
    if (view.autoOpen) setOpen(true);
  }, [view.autoOpen]);
  return (
    <details
      className="mt-5 rounded-[var(--r-lg)] border"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-card)',
      }}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block font-[family-name:var(--font-head)] text-[17px] font-medium leading-[1.25] text-[var(--text-primary)]">
            {view.section.title}
          </span>
          <span className="mt-1 block text-[12px] leading-4 text-[var(--text-tertiary)]">
            {plural(view.answers, 'answer')}
            {view.toCheck
              ? ` · ${view.toCheck} to check`
              : view.missing.length
                ? ` · ${view.missing.length} still needed`
                : ''}
          </span>
        </span>
        <span className="mt-1 shrink-0 text-[12px] text-[var(--text-tertiary)]">
          {open ? 'Hide' : 'Show'}
        </span>
      </summary>
      <div
        className="border-t px-4"
        style={{ borderColor: 'var(--border-divider)' }}
      >
        {[...view.missing, ...view.rest].map((item) => {
          const isMissing = view.missing.includes(item);
          return (
            <AnswerReviewRow
              key={item.key}
              item={item}
              autoOpen={isMissing}
              busy={busyKey === item.key || confirmingKey === item.key}
              onSave={onSave}
              onConfirm={item.state === 'suggested' ? onConfirm : undefined}
            />
          );
        })}
      </div>
    </details>
  );
}

export interface AnswersReviewProps {
  sheet: SheetResponse;
  busyKey: string | null;
  confirmingKey: string | null;
  onSave: (key: string, value: string) => Promise<void>;
  onConfirm: (key: string) => void | Promise<void>;
  /** Where outstanding documents are added — the interview's document drawer. */
  interviewHref?: string;
}

/**
 * Everything below "Check your answers": the attention counts, every folded
 * section, the missing-document list, and — at the very bottom, folded — the
 * optional 271 block.
 */
export default function AnswersReview({
  sheet,
  busyKey,
  confirmingKey,
  onSave,
  onConfirm,
  interviewHref,
}: AnswersReviewProps) {
  const stats = reviewStats(sheet);
  const sections = reviewSections(sheet);
  const formOnly = reviewFormOnly(sheet);
  const missingDocuments = sheet.needs.needs.filter(
    (need) => need.tier === 'required' && !need.have,
  );
  return (
    <>
      <AttentionPanel stats={stats} />

      {sections.map((view) => (
        <SectionFold
          key={view.section.id}
          view={view}
          busyKey={busyKey}
          confirmingKey={confirmingKey}
          onSave={onSave}
          onConfirm={onConfirm}
        />
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
          {interviewHref ? (
            <Link
              href={interviewHref}
              className="mt-3 inline-flex rounded-lg border px-3 py-2 text-[12.5px] font-medium text-[var(--text-primary)]"
              style={{ borderColor: 'var(--border)' }}
            >
              Upload these in the interview
            </Link>
          ) : null}
        </section>
      ) : null}

      {formOnly.length ? (
        <details
          className="mt-6 rounded-[var(--r-lg)] border"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-card)',
          }}
        >
          <summary className="cursor-pointer list-none px-4 py-3">
            <span className="block font-[family-name:var(--font-head)] text-[17px] font-medium leading-[1.25] text-[var(--text-primary)]">
              SAPS 271 details (optional)
            </span>
            <span className="mt-1 block text-[12.5px] leading-5 text-[var(--text-secondary)]">
              These are form boxes we read from a document if you supply one. The
              product does not fill in the 271, so they are not needed to write
              the motivation.
            </span>
          </summary>
          <div
            className="border-t px-4"
            style={{ borderColor: 'var(--border-divider)' }}
          >
            {formOnly.map((item) => (
              <AnswerReviewRow
                key={item.key}
                item={item}
                autoOpen={false}
                busy={busyKey === item.key || confirmingKey === item.key}
                onSave={onSave}
                onConfirm={item.state === 'suggested' ? onConfirm : undefined}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
