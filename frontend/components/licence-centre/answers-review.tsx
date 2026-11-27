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
        /**
         * ⚠️ MISSING ONLY. A drafted/suggested answer used to auto-open its
         * section; with ten drafted paragraphs that turned the review screen
         * into an endless scroll. The attention panel already counts them and
         * the summary says "N to check" — the member opens the section when they
         * are ready to.
         */
        autoOpen: missing.length > 0,
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

// ── owned firearms: one box per firearm, in the section they belong to ──

/** `existing_firearm_<n>_<field>` — the same pattern the interview card reads. */
const OWNED_KEY = /^existing_firearm_(\d+)_(.+)$/;
const OWNED_FIELDS = ['make', 'model', 'calibre', 'serial'];

/**
 * How many owned-firearm boxes to show.
 *
 * ⚠️ THE COUNT ANSWER WINS. The sheet can hold rows for firearms the member has
 * since told us they do not own; the interview's own count is the truth, and a
 * box per stale row is a form that grows back. With no count answer the highest
 * row index is the best available fallback.
 */
export function ownedFirearmCount(sheet: SheetResponse): number {
  const answer = Number.parseInt(
    (sheet.items.find((item) => item.key === 'existing_firearm_count')?.value ??
      '').trim(),
    10,
  );
  if (Number.isFinite(answer) && answer > 0) return answer;
  let highest = 0;
  for (const item of sheet.items) {
    const match = OWNED_KEY.exec(item.key);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

export interface OwnedFirearmBoxView {
  index: number;
  /** "GLOCK · 19 · 9MM · ABC" from the rows, or null when nothing is set yet. */
  summary: string | null;
  items: SheetItem[];
  /** Which of `items` the sheet is still holding out for. */
  missing: SheetItem[];
}

/** The bordered box for one owned firearm, from that firearm's rows. */
export function ownedFirearmBoxes(
  sheet: SheetResponse,
  items: SheetItem[],
  count = ownedFirearmCount(sheet),
): OwnedFirearmBoxView[] {
  const byIndex = new Map<number, SheetItem[]>();
  for (const item of items) {
    const match = OWNED_KEY.exec(item.key);
    if (!match) continue;
    const index = Number(match[1]);
    if (index < 1 || index > count) continue;
    const list = byIndex.get(index) ?? [];
    list.push(item);
    byIndex.set(index, list);
  }
  const boxes: OwnedFirearmBoxView[] = [];
  for (let index = 1; index <= count; index += 1) {
    const rows = byIndex.get(index);
    if (!rows?.length) continue;
    const valueOf = (field: string) =>
      rows.find((row) => row.key === `existing_firearm_${index}_${field}`)?.value
        ?.trim() ?? '';
    const summary =
      OWNED_FIELDS.map(valueOf).filter(Boolean).join(' · ') || null;
    // Make, Model, Calibre, Serial first, then type/expiry/section in card order.
    const itemsOrdered = [...rows].sort((a, b) => {
      const orderOf = (row: SheetItem) => {
        const at = OWNED_FIELDS.indexOf(OWNED_KEY.exec(row.key)?.[2] ?? '');
        return at === -1 ? OWNED_FIELDS.length : at;
      };
      return orderOf(a) - orderOf(b);
    });
    const missingKeys = new Set(sheet.missing);
    for (const section of sheet.sections) {
      for (const key of section.missing ?? []) missingKeys.add(key);
    }
    boxes.push({
      index,
      summary,
      items: itemsOrdered,
      missing: itemsOrdered.filter((item) =>
        isMissingAnswer(item, missingKeys),
      ),
    });
  }
  return boxes;
}

/** True when this item belongs in an owned-firearm box rather than a flat row. */
export function isOwnedFirearmItem(item: SheetItem): boolean {
  return OWNED_KEY.test(item.key);
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

/**
 * One owned firearm, collapsed to a single line: "Firearm 3 · GLOCK · 19 · 9MM ·
 * ABC · complete". Expanding it shows the four licence-card fields first and
 * tucks type/expiry/section/serials under a second fold, so ten rows per firearm
 * are never on screen at once.
 *
 * ⚠️ AUTO-OPENS ONLY ON A MISSING ANSWER. Six firearms auto-opening because they
 * carry drafted text is the endless scroll the operator reported; the section
 * summary still says "N to check" and the gold flags are inside.
 */
function OwnedFirearmBox({
  box,
  busyKey,
  confirmingKey,
  onSave,
  onConfirm,
}: {
  box: OwnedFirearmBoxView;
  busyKey: string | null;
  confirmingKey: string | null;
  onSave: (key: string, value: string) => Promise<void>;
  onConfirm: (key: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(box.missing.length > 0);
  useEffect(() => {
    if (box.missing.length > 0) setOpen(true);
  }, [box.missing.length]);
  const fieldOf = (item: SheetItem) => OWNED_KEY.exec(item.key)?.[2] ?? '';
  const essentials = box.items.filter((item) =>
    OWNED_FIELDS.includes(fieldOf(item)),
  );
  const extras = box.items.filter(
    (item) => !OWNED_FIELDS.includes(fieldOf(item)),
  );
  const row = (item: SheetItem) => (
    <AnswerReviewRow
      key={item.key}
      item={item}
      autoOpen={box.missing.includes(item)}
      busy={busyKey === item.key || confirmingKey === item.key}
      onSave={onSave}
      onConfirm={item.state === 'suggested' ? onConfirm : undefined}
    />
  );
  return (
    <section
      aria-label={`Firearm ${box.index}`}
      className="my-2 rounded-xl border"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-page)' }}
    >
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
          <span className="min-w-0">
            <span className="block text-[12px] font-medium text-[var(--text-primary)]">
              Firearm {box.index}
            </span>
            {box.summary ? (
              <span className="mt-0.5 block truncate text-[12px] leading-4 text-[var(--text-tertiary)]">
                {box.summary}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
            {box.missing.length
              ? `${box.missing.length} to fill`
              : 'complete'}
          </span>
        </summary>
        <div
          className="border-t px-3"
          style={{ borderColor: 'var(--border-divider)' }}
        >
          {essentials.map(row)}
          {extras.length ? (
            <details
              className="my-2 rounded-lg border"
              style={{ borderColor: 'var(--border-divider)' }}
            >
              <summary className="cursor-pointer list-none px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                More details (type, licence expiry, section, serials)
              </summary>
              <div
                className="border-t px-2"
                style={{ borderColor: 'var(--border-divider)' }}
              >
                {extras.map(row)}
              </div>
            </details>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function SectionFold({
  sheet,
  view,
  busyKey,
  confirmingKey,
  onSave,
  onConfirm,
}: {
  sheet: SheetResponse;
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
  const all = [...view.missing, ...view.rest];
  /**
   * ⚠️ THE OWNED FIREARMS COME OUT OF THE FLAT RUN. In the section they are one
   * box per firearm; the count/gate rows stay ordinary rows above them.
   */
  const flat = all.filter((item) => !isOwnedFirearmItem(item));
  const boxes = ownedFirearmBoxes(sheet, all);
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
        {flat.map((item) => {
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
        {boxes.map((box) => (
          <OwnedFirearmBox
            key={box.index}
            box={box}
            busyKey={busyKey}
            confirmingKey={confirmingKey}
            onSave={onSave}
            onConfirm={onConfirm}
          />
        ))}
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
  const ownedCount = ownedFirearmCount(sheet);
  const missingDocuments = sheet.needs.needs.filter(
    (need) => need.tier === 'required' && !need.have,
  );
  /**
   * ⚠️ A PRINT-READY PACK WANTS A LICENCE CARD PER OWNED FIREARM. That is a
   * count, not a tick: the backend's CURRENT_LICENCE need carries minFiles /
   * haveFiles and decides `have` itself. This only renders the progress line —
   * it never changes what Continue is gated on.
   */
  const licenceNeed =
    sheet.application.outputMode === 'PRINT_READY' && ownedCount > 0
      ? sheet.needs.needs.find((need) => need.kind === 'CURRENT_LICENCE')
      : undefined;
  const documentRows = licenceNeed
    ? missingDocuments.filter((need) => need.kind !== 'CURRENT_LICENCE')
    : missingDocuments;
  const showDocuments = documentRows.length > 0 || Boolean(licenceNeed);
  return (
    <>
      <AttentionPanel stats={stats} />

      {sections.map((view) => (
        <SectionFold
          key={view.section.id}
          sheet={sheet}
          view={view}
          busyKey={busyKey}
          confirmingKey={confirmingKey}
          onSave={onSave}
          onConfirm={onConfirm}
        />
      ))}

      {showDocuments ? (
        <section className="mt-6">
          <h2 className="m-0 mb-2 font-[family-name:var(--font-head)] text-[17px] font-medium text-[var(--text-primary)]">
            {missingDocuments.length ? 'Documents still needed' : 'Licence cards for the pack'}
          </h2>
          {documentRows.length ? (
            <ul className="m-0 grid gap-1.5 pl-5 text-[13px] text-[var(--text-secondary)]">
              {documentRows.map((need) => (
                <li key={need.kind}>{need.label}</li>
              ))}
            </ul>
          ) : null}
          {licenceNeed ? (
            <div
              className="mt-3 rounded-lg border px-3 py-2"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg-inset)',
              }}
            >
              <p className="m-0 text-[13px] font-medium text-[var(--text-primary)]">
                {licenceNeed.label}
              </p>
              <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
                {licenceNeed.haveFiles ?? 0} of{' '}
                {licenceNeed.minFiles ?? ownedCount} licence cards added
              </p>
              {licenceNeed.minFilesNote ? (
                <p className="m-0 mt-1 text-[11.5px] leading-4 text-[var(--text-tertiary)]">
                  {licenceNeed.minFilesNote}
                </p>
              ) : null}
            </div>
          ) : null}
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
