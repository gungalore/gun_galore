'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  SheetComplianceCheck,
  SheetItem,
  SheetResponse,
} from './contract';
import AnswerReviewRow from './answer-review-row';

// ────────────────────────────────────────────────────────────────────
// THE ANSWERS, AS FOLDED SECTIONS RATHER THAN ONE ENDLESS FORM.
//
// ⚠️ THE OPERATOR'S REPORT: "These seem to be 271 form questions? And why do I
// have to scroll and fill in this endless page?" The 271 is retired from this
// product entirely ("we are never filling in 271 forms") and its rows are no
// longer served. The screen now shows what the MOTIVATION needs: attention counts
// at the top, one folded section per answer group, a folded owned-firearm box per
// firearm, and an honest pack-documents ledger.
//
// ⚠️ FOLDS OPEN ONLY FOR A GAP. A section the server marked missing opens by
// itself; a section holding only drafted answers stays shut ("N to check" in its
// summary, gold flag inside). Ten drafted paragraphs auto-opening was the
// endless scroll.
//
// ⚠️ NOTHING SATISFIED IS LISTED AS OUTSTANDING. The pack ledger puts "Still
// needed" and "On file" apart, with a status word on every row — the operator
// read "6 of 6 licence cards added" under a "Documents still needed" heading and
// rightly objected.
// ────────────────────────────────────────────────────────────────────

/** What the attention panel and the footer need, counted once. */
export interface ReviewStats {
  /** Required answers still empty. */
  missingAnswers: number;
  /** Required documents still outstanding. */
  missingDocuments: number;
  /**
   * The server's compliance gate would refuse a print-ready write.
   *
   * ⚠️ COUNTED ONCE, FROM `compliance.required && !compliance.ready`. An `unread`
   * card does NOT block — the backend already encodes that in `ready`.
   */
  complianceBlocked: boolean;
  /** The server's own explanation for `complianceBlocked`. */
  complianceNote: string | null;
  /** The number Continue is gated on. */
  missingCount: number;
  /** Suggested (drafted) answers the member has not checked yet. */
  draftedAnswers: number;
}

/**
 * One answer the sheet is actually holding out for.
 *
 * ⚠️ A DRAFTED VALUE IS NOT MISSING. It is present and flagged for checking —
 * a decision, not a gap.
 */
export function isMissingAnswer(
  item: SheetItem,
  missingKeys: Set<string>,
): boolean {
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
 * ⚠️ `compliance.ready` IS THE SERVER'S GENERATION GATE. It is counted here, not
 * re-derived from the checks' states — an `unread` proficiency is on file and
 * the backend decides whether that enough is enough.
 */
export function reviewStats(sheet: SheetResponse): ReviewStats {
  const missingAnswers = sheet.missing.length;
  const missingDocuments = sheet.needs.needs.filter(
    (need) => need.tier === 'required' && !need.have,
  ).length;
  const compliance = sheet.compliance;
  const complianceBlocked = Boolean(compliance?.required && !compliance.ready);
  const complianceNote = complianceBlocked
    ? complianceChecksNeedingAttention(compliance?.checks ?? [])
        .map((check) => check.note?.trim() || check.label)
        .filter(Boolean)
        .join(' ') ||
      'A compliance document is still needed before we can write a print-ready pack.'
    : null;
  const draftedAnswers = sheet.items.filter(
    (item) => item.state === 'suggested',
  ).length;
  return {
    missingAnswers,
    missingDocuments,
    complianceBlocked,
    complianceNote,
    missingCount:
      missingAnswers + missingDocuments + (complianceBlocked ? 1 : 0),
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

/** Compliance checks that are not `have` — missing or unread. */
function complianceChecksNeedingAttention(
  checks: SheetComplianceCheck[],
): SheetComplianceCheck[] {
  return checks.filter((check) => check.state !== 'have');
}

/** One folded section, with its rows already ordered gaps-first. */
export interface ReviewSectionView {
  section: SheetResponse['sections'][number];
  missing: SheetItem[];
  rest: SheetItem[];
  /** Opens itself: it holds a gap. */
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
    if (item.state === 'na') continue;
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
        /** ⚠️ MISSING ONLY. A drafted answer does not open its section. */
        autoOpen: missing.length > 0,
        answers: items.length,
        toCheck: items.filter((item) => item.state === 'suggested').length,
      };
    })
    .filter((view) => view.answers > 0);
}

// ── the pack-documents ledger ───────────────────────────────────────

export type DocumentLedgerStatus = 'added' | 'needed' | 'unread';

/**
 * One line of the pack ledger: a document the server wants, and where it stands.
 *
 * ⚠️ THE MEMBER'S WORDS, AND THE SERVER'S STATUS. `detail` is the count line
 * ("6 of 6 licence cards added"); `note` is the one-line reason. Nothing here is
 * derived from upload counts — the sheet already says `have` and `haveFiles`.
 */
export interface DocumentsLedgerRow {
  key: string;
  label: string;
  status: DocumentLedgerStatus;
  detail?: string;
  note?: string;
}

export function documentLedger(sheet: SheetResponse): DocumentsLedgerRow[] {
  const rows: DocumentsLedgerRow[] = [];
  for (const need of sheet.needs.needs) {
    if (need.tier !== 'required' && need.tier !== 'expected') continue;
    const total = need.minFiles;
    const detail = total
      ? need.kind === 'CURRENT_LICENCE'
        ? `${need.haveFiles ?? 0} of ${total} licence cards added`
        : `${need.haveFiles ?? 0} of ${total} files added`
      : undefined;
    rows.push({
      key: `need:${need.kind}`,
      label: need.label,
      status: need.have ? 'added' : 'needed',
      detail,
      note: need.have
        ? undefined
        : (need.minFilesNote || need.why || undefined),
    });
  }
  for (const check of sheet.compliance?.checks ?? []) {
    rows.push({
      key: `compliance:${check.key}`,
      label: check.label,
      status:
        check.state === 'have'
          ? 'added'
          : check.state === 'unread'
            ? 'unread'
            : 'needed',
      note: check.state === 'have' ? undefined : check.note?.trim() || undefined,
    });
  }
  return rows;
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
  const nothing =
    missing.length === 0 && !stats.draftedAnswers && !stats.complianceBlocked;
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
        {nothing
          ? 'Nothing is missing. Your motivation is ready to write.'
          : 'Needs your attention'}
      </p>
      {missing.length ? (
        <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          {missing.join(' and ')} still needed — open the sections below, or add
          the missing documents in the pack list.
        </p>
      ) : null}
      {stats.complianceBlocked ? (
        <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          {stats.complianceNote ??
            'A compliance document is still needed before we can write a print-ready pack.'}
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

// ── the pack-documents ledger, as rendered ───────────────────────────

const LEDGER_STATUS_WORD: Record<DocumentLedgerStatus, string> = {
  added: 'Added',
  needed: 'Still needed',
  unread: "Couldn't read",
};

const LEDGER_STATUS_STYLE: Record<DocumentLedgerStatus, string> = {
  // Green tick for a document we hold and have read.
  added: 'text-[var(--success)]',
  // Gold, not red: the document is there, we just could not read it.
  unread: 'text-[var(--gold-strong)]',
  needed: 'text-[var(--warning)]',
};

function LedgerRow({ row }: { row: DocumentsLedgerRow }) {
  return (
    <li className="border-b border-[var(--border-divider)] py-2 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-medium text-[var(--text-primary)]">
            {row.label}
          </p>
          {row.detail ? (
            <p className="m-0 mt-0.5 text-[12px] leading-4 text-[var(--text-secondary)]">
              {row.detail}
            </p>
          ) : null}
          {row.note ? (
            <p className="m-0 mt-0.5 text-[11.5px] leading-4 text-[var(--text-tertiary)]">
              {row.note}
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 text-[12px] font-medium ${LEDGER_STATUS_STYLE[row.status]}`}
        >
          {row.status === 'added' ? '✓ Added' : LEDGER_STATUS_WORD[row.status]}
        </span>
      </div>
      {/* ⚠️ THE DOCUMENT CENTRE IS THE PRIMARY ACTION PER ROW. A missing or
          unread document is fixed there, not in the interview. */}
      {row.status !== 'added' ? (
        <Link
          href="/documents"
          className="mt-1.5 inline-flex min-h-[36px] items-center rounded-lg px-2.5 text-[12px] font-medium text-white"
          style={{ background: 'var(--action-primary-bg)' }}
        >
          Upload in the Document Centre
        </Link>
      ) : null}
    </li>
  );
}

/**
 * The pack ledger: what a print-ready pack needs, grouped so a satisfied row can
 * never read as outstanding.
 */
function DocumentsLedger({ sheet, interviewHref }: {
  sheet: SheetResponse;
  interviewHref?: string;
}) {
  const rows = documentLedger(sheet);
  const outstanding = rows.filter((row) => row.status === 'needed');
  const onFile = rows.filter((row) => row.status !== 'needed');
  return (
    <section className="mt-6">
      <h2 className="m-0 mb-2 font-[family-name:var(--font-head)] text-[17px] font-medium text-[var(--text-primary)]">
        Documents for your print-ready pack
      </h2>

      {outstanding.length ? (
        <>
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--warning)]">
            Still needed
          </p>
          <ul
            aria-label="Still needed"
            className="m-0 mt-1 list-none p-0"
          >
            {outstanding.map((row) => (
              <LedgerRow key={row.key} row={row} />
            ))}
          </ul>
        </>
      ) : null}

      {onFile.length ? (
        <>
          <p className="m-0 mt-3 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            On file
          </p>
          <ul aria-label="On file" className="m-0 mt-1 list-none p-0">
            {onFile.map((row) => (
              <LedgerRow key={row.key} row={row} />
            ))}
          </ul>
        </>
      ) : null}

      <p className="m-0 mt-3 text-[12.5px] leading-5 text-[var(--text-secondary)]">
        Upload or scan it in the Document Centre — documents there are re-used on
        every application.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link
          href="/documents"
          className="inline-flex min-h-[44px] items-center rounded-lg px-4 text-[13px] font-medium text-white"
          style={{ background: 'var(--action-primary-bg)' }}
        >
          Go to the Document Centre
        </Link>
        {interviewHref ? (
          <Link
            href={interviewHref}
            className="inline-flex min-h-[44px] items-center rounded-lg border px-3 text-[12.5px] font-medium text-[var(--text-primary)]"
            style={{ borderColor: 'var(--border)' }}
          >
            Upload these in the interview
          </Link>
        ) : null}
      </div>
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
  // A fold that has just acquired a gap opens itself, even if the member had
  // closed it before the last reload.
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
 * section, and the pack-documents ledger (or the one-line no-documents note for
 * a motivation-only draft).
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
  const printReady = sheet.application.outputMode !== 'MOTIVATION_ONLY';
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

      {printReady ? (
        <DocumentsLedger sheet={sheet} interviewHref={interviewHref} />
      ) : (
        <p className="m-0 mt-6 text-[13px] leading-5 text-[var(--text-secondary)]">
          A motivation-only draft needs no documents.
        </p>
      )}
    </>
  );
}
