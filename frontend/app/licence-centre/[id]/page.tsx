'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motivationsApi } from '@/lib/motivations-api';
import type {
  PreviewSection,
  SheetItem,
  SheetResponse,
} from '@/components/licence-centre/contract';
import SheetHeader from '@/components/licence-centre/sheet-header';
import SheetSection from '@/components/licence-centre/sheet-section';
import SheetDisclosure from '@/components/licence-centre/sheet-disclosure';
import SheetRow from '@/components/licence-centre/sheet-row';
import DeclarationRow from '@/components/licence-centre/declaration-row';
import DocumentShelf from '@/components/licence-centre/document-shelf';
import SheetFooter from '@/components/licence-centre/sheet-footer';
import SheetToast from '@/components/licence-centre/sheet-toast';
import OverlapCard from '@/components/licence-centre/overlap-card';
import ConsentCard from '@/components/licence-centre/consent-card';
import CompetencyLines from '@/components/licence-centre/competency-lines';
import PackSummary from '@/components/licence-centre/pack-summary';
import PreviewPanel from '@/components/licence-centre/preview-panel';
import AddPanel from '@/components/licence-centre/add-panel';
import DeleteApplication from '@/components/licence-pack/delete-application';
import type { PickableKind } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE REVIEW SHEET — one scrolling page per application.
//
// ⚠️ THE ONLY STATEFUL FILE IN THIS SURFACE, and that is a rule rather than an
// accident — the same one The Bench works to. Everything under
// components/licence-centre/ takes plain props and calls back. A component
// that grows its own fetch is a component that can disagree with this page
// about what the application says.
//
// ⚠️ IT IS A SHEET, NOT A WIZARD. There are no steps, nothing is gated behind
// a Continue, and every question is on this page in the state it is in. The
// screen it replaces was eleven steps in which every question rendered as a
// grey row reading "You may know it" with no input visible.
//
// ⚠️ ONE NUMBER DRIVES THE THREE PROGRESS VIEWS. `sheet.missing` comes from the
// server; the strip's pill, the chip dots and the footer all read it and
// nothing recomputes it. The old screen had four such systems and they
// contradicted each other on a live application.
// ────────────────────────────────────────────────────────────────────

/** Which route Part F takes, from `firearm_source`. */
/**
 * The six SAPS 271 section E rows that come off the licence card rather than
 * out of the applicant. `firearm_serial` — the headline number the DFO asks
 * for — is deliberately NOT one of them and stays in the open.
 */
const CARD_COMPONENT_KEYS = new Set([
  'barrel_serial',
  'barrel_make',
  'frame_serial',
  'frame_make',
  'receiver_serial',
  'receiver_make',
]);

/**
 * ⚠️ ONLY ON A PRIVATE SALE does the consent card render. A dealer completes
 * Part F and their own SAPS 350(a); an estate is the executor's. Showing it on
 * either route asks somebody to chase a signature nobody needs.
 */
const SOURCE_PRIVATE = 'From a private owner';

/** Who actually fills those six, by route. Keyed on `firearm_source`. */
const COMPONENT_NOTE: Record<string, string> = {
  'From a dealer': 'Your dealer fills these in from the licence card.',
  'From a private owner':
    'The seller fills these in when they photograph their licence.',
  default: 'Read off the licence card — most cards print NONE against two of them.',
};

const SOURCE_ROUTE: Record<string, 'dealer' | 'seller' | 'estate' | 'unstated'> =
  {
    'From a dealer': 'dealer',
    'From a private owner': 'seller',
    'Inherited from a deceased estate': 'estate',
  };

/** How long to sit on a keystroke before saving. */
const SAVE_DEBOUNCE_MS = 600;

/** The eight sections, in the order brief §6.1 lists them. */
const SECTION_ORDER = [
  'firearm',
  'you',
  'competency',
  'own',
  'premises',
  'case',
  'declarations',
  'pack',
] as const;

/** A history question's detail box and its four form boxes. */
function declarationParts(items: SheetItem[], key: string) {
  const detail = items.find((i) => i.key === `${key}_detail`);
  const boxes = items.filter(
    (i) => i.key.startsWith(`${key}_`) && i.key !== `${key}_detail`,
  );
  return { detail, boxes };
}

export default function LicenceCentreSheetPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [active, setActive] = useState<string>('firearm');
  /** The Add-a-document sheet, and the kinds it may file into. */
  const [adding, setAdding] = useState(false);
  /** Entered through the Scan tile — open the camera without a second click. */
  const [autoScan, setAutoScan] = useState(false);
  const [kinds, setKinds] = useState<PickableKind[]>([]);

  /**
   * Which sections are folded open. Null until the sheet has arrived.
   *
   * ⚠️ COMPUTED ONCE, THEN THE MEMBER OWNS IT. The sheet is refetched after
   * every save, and recomputing this on each one would close a section
   * somebody had just opened, mid-answer.
   */
  const [openSections, setOpenSections] = useState<Record<
    string,
    boolean
  > | null>(null);

  /**
   * How many empty owned-firearm rows to offer beyond the ones in use.
   *
   * ⚠️ ZERO, UNTIL SOMEBODY ASKS. The registry serves fourteen rows whatever a
   * member owns; the live sheet rendered all fourteen, so five real firearms
   * came with nine empty ones — no headings between them, and each empty row
   * carrying the full eleven-tile "what it is for" grid.
   */
  const [extraOwned, setExtraOwned] = useState(0);

  /**
   * ⚠️ THE ANSWERS THE SERVER LAST CONFIRMED, HELD SEPARATELY FROM THE SHEET.
   *
   * The sheet is refetched after a save, and a refetch that landed while
   * somebody was mid-keystroke would overwrite what they had just typed. This
   * holds the pending edits so a render always shows the member's own text
   * even while the server catches up.
   */
  const [pending, setPending] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await motivationsApi.sheet(getToken, id);
      setSheet(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  // The pickable kinds for the Add sheet. Fetched once, and separately from
  // the sheet: it is a fixed list per licence type, not something a keystroke
  // can change.
  useEffect(() => {
    if (!id) return;
    let live = true;
    void motivationsApi
      .uploads(getToken, id)
      .then((u) => {
        if (live) setKinds(u.kinds);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [getToken, id]);

  /**
   * The opening fold: the first section that still owes something.
   *
   * ⚠️ NOT "all closed", AND NOT "the first section". A member coming back to
   * a half-finished application should land where the work is; a member with
   * nothing outstanding should land at the top rather than on a page of eight
   * shut headings with no hint of where to start.
   */
  useEffect(() => {
    if (!sheet || openSections) return;
    const first =
      sheet.sections.find((s) => s.missing.length > 0)?.id ??
      sheet.sections[0]?.id;
    setOpenSections(first ? { [first]: true } : {});
  }, [sheet, openSections]);

  const setSectionOpen = useCallback((id: string, open: boolean) => {
    setOpenSections((prev) => ({ ...(prev ?? {}), [id]: open }));
  }, []);

  /**
   * The active section chip follows the scroll.
   *
   * ⚠️ AN OBSERVER, NOT A SCROLL HANDLER. A scroll listener firing on every
   * frame to measure eight headings is the kind of thing that makes a long
   * form feel heavy on a phone, which is the specific complaint this surface
   * exists to answer.
   */
  useEffect(() => {
    if (!sheet) return;
    const headings = SECTION_ORDER.map((s) =>
      document.getElementById(s),
    ).filter((el): el is HTMLElement => !!el);
    if (!headings.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target.id) setActive(top.target.id);
      },
      { rootMargin: '-120px 0px -60% 0px' },
    );
    headings.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [sheet]);

  /**
   * Save, then refresh the sheet and the preview.
   *
   * ⚠️ THE WHOLE BLOB, AS THE CONTRACT HAS ALWAYS BEEN. `PATCH :id/answers`
   * takes everything and the server decides what changed and what is
   * profile-scoped — see saveAnswers. Sending a diff from here would be this
   * screen deciding which of somebody's answers matter.
   */
  const flush = useCallback(
    async (patch: Record<string, string>) => {
      try {
        await motivationsApi.saveAnswers(getToken, id, patch);
        await load();
        // ⚠️ THE PENDING MAP IS CLEARED ONLY AFTER THE REFETCH LANDS. Clearing
        // it on the save's response would blank the member's text for the one
        // frame between the two, which reads as the form eating what they
        // typed.
        setPending({});
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [getToken, id, load],
  );

  const onChange = useCallback(
    (key: string, value: string) => {
      setPending((p) => {
        const next = { ...p, [key]: value };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(next), SAVE_DEBOUNCE_MS);
        return next;
      });
    },
    [flush],
  );

  /** Accept a suggested value as it stands. */
  const onConfirm = useCallback(
    (item: SheetItem) => {
      void flush({ [item.key]: item.value });
    },
    [flush],
  );

  /**
   * A file dropped on the shelf.
   *
   * ⚠️ THE KIND IS EMPTY ON PURPOSE. This door never asks what a document is —
   * the server classifies it. That is the whole difference from the screen
   * this replaces, which put a full scanner-plus-picker-plus-reuse block on
   * every step and asked the member to file each one by hand.
   */
  const onAddFile = useCallback(
    async (kind: string, file: File) => {
      const added = await motivationsApi.addUpload(getToken, id, kind, file);
      await load();
      setToast(
        added?.kind
          ? `Read your ${added.kind.toLowerCase().replace(/_/g, ' ')}.`
          : 'Added.',
      );
      return added;
    },
    [getToken, id, load],
  );

  const onRefile = useCallback(
    async (uploadId: string, kind: string) => {
      await motivationsApi.refileUpload(getToken, id, uploadId, kind);
      await load();
    },
    [getToken, id, load],
  );

  const onWrite = useCallback(async () => {
    setBusy(true);
    try {
      await motivationsApi.generate(getToken, id);
      router.push(`/licence-centre/${id}/pack`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }, [getToken, id, router]);

  /** The items as the member sees them — server values under pending edits. */
  const items = useMemo<SheetItem[]>(() => {
    if (!sheet) return [];
    return sheet.items.map((i) =>
      i.key in pending ? { ...i, value: pending[i.key] } : i,
    );
  }, [sheet, pending]);

  const byKey = useMemo(
    () => new Map(items.map((i) => [i.key, i])),
    [items],
  );

  if (error && !sheet) {
    return (
      <main className="px-4 py-10 text-[14px] text-[var(--text-secondary)]">
        {error}
      </main>
    );
  }
  if (!sheet) {
    return (
      <main className="px-4 py-10 text-[14px] text-[var(--text-tertiary)]">
        Loading your application…
      </main>
    );
  }

  const sourceValue = byKey.get('firearm_source')?.value ?? '';

  /**
   * Has the seller actually signed?
   *
   * ⚠️ READ OFF THE PART F DATA THE SERVER ALREADY RETURNS, not tracked here.
   * saps271Coverage counts Part F as covered only once the consent record
   * carries the seller's own answers, so this is the same fact the meter shows
   * — one source, and the card and the meter cannot disagree.
   */
  const sellerSigned = (sheet.coverage as { sections?: { key?: string; done?: number }[] })
    ?.sections?.some((c) => c.key === 'F' && (c.done ?? 0) > 0) ?? false;

  const sectionsForStrip = sheet.sections.map((s) => ({
    id: s.id,
    label: s.title,
    missing: s.missing.length,
  }));

  const renderRows = (sectionId: string) => {
    const mine = items.filter((i) => i.section === sectionId);

    // ⚠️ COMPETENCY IS LINES, NOT ROWS, WHEN THE VAULT HAS IT. See
    // CompetencyLines: the screen this replaces showed two scanner blocks, two
    // reuse dropdowns listing nine credentials, and a warning about
    // unreadable proficiency codes — all true, none of it the member's
    // business. The upload door only appears when we hold nothing.
    if (sectionId === 'competency') {
      const known = mine.filter(
        (i) => i.state === 'filled' || i.state === 'suggested',
      );
      if (known.length) {
        return (
          <CompetencyLines
            items={mine}
            covered={!mine.some((i) => i.state === 'needs_you' && i.required)}
            onAdd={() => setAdding(true)}
            onChange={onChange}
          />
        );
      }
    }

    // ⚠️ "Your pack" HAS NO REGISTRY FIELDS — it is the 271's completeness and
    // the take-to-SAPS list, both computed on the server.
    if (sectionId === 'pack') {
      return (
        <PackSummary
          coverage={sheet.coverage as never}
          licenceType={sheet.application.licenceType}
          sourceRoute={SOURCE_ROUTE[sourceValue] ?? 'unstated'}
          needs={sheet.needs.needs}
        />
      );
    }

    // ⚠️ DECLARATIONS RENDER AS YES/NO ROWS, NOT AS ORDINARY ITEMS, and the
    // detail and form boxes are folded INTO their question rather than listed
    // after it. A conviction's four boxes sitting loose in the section would
    // be four questions nobody can tell apart.
    if (sectionId === 'declarations') {
      const questions = mine.filter(
        (i) => i.kind === 'yesno' && !i.key.includes('_detail'),
      );
      return questions.map((q) => {
        const { detail, boxes } = declarationParts(mine, q.key);
        return (
          <DeclarationRow
            key={q.key}
            item={q}
            onChange={(v) => onChange(q.key, v)}
            detail={detail}
            onDetailChange={(v) => detail && onChange(detail.key, v)}
            boxes={boxes}
            onBoxChange={onChange}
          />
        );
      });
    }

    // An own-words box is rendered INSIDE its card grid, never on its own.
    const ownWordsKeys = new Set(
      mine.map((i) => i.ownWordsKey).filter(Boolean) as string[],
    );
    const visible = mine.filter((i) => !ownWordsKeys.has(i.key));

    const row = (i: SheetItem) => (
      <SheetRow
        key={i.key}
        item={i}
        onChange={(v) => onChange(i.key, v)}
        onConfirm={() => onConfirm(i)}
        ownWords={i.ownWordsKey ? byKey.get(i.ownWordsKey) : undefined}
        onOwnWordsChange={
          i.ownWordsKey ? (v) => onChange(i.ownWordsKey as string, v) : undefined
        }
      />
    );

    // ⚠️ THE LICENCE CARD'S COMPONENT ROWS FOLD, AND NOBODY TYPES THEM. Barrel,
    // frame and receiver each carry a serial and a make on the SAPS 271 because
    // the frame or receiver IS the firearm in law — but they are read off a
    // card the applicant has not been handed yet, and on the live sheet they
    // were six always-open boxes marked Optional, each with two lines of help
    // about how the answer is usually NONE. The dealer or the seller fills
    // them; this says which, and gets out of the way.
    if (sectionId === 'firearm') {
      const inner = visible.filter((i) => CARD_COMPONENT_KEYS.has(i.key));
      const out: React.ReactNode[] = [];
      let placed = false;
      const fold = () => {
        placed = true;
        const filled = inner.filter((i) => i.value.trim()).length;
        return (
          <SheetDisclosure
            key="__card-components"
            summary="Barrel, frame and receiver"
            note={COMPONENT_NOTE[sourceValue] ?? COMPONENT_NOTE.default}
            meta={
              filled ? (
                <span className="text-[var(--success)]">{filled} filled</span>
              ) : (
                <span className="text-[var(--text-tertiary)]">
                  {inner.length} rows
                </span>
              )
            }
          >
            {inner.map(row)}
          </SheetDisclosure>
        );
      };

      for (const i of visible) {
        if (CARD_COMPONENT_KEYS.has(i.key)) continue;
        out.push(row(i));

        // ⚠️ THE TWO CARDS BELONG UNDER THE SOURCE ROW — SPEC-BUILD §8.3 and
        // §8.4 — and the source row is now the first row of the section, so
        // this is where they go. They used to render after every row in the
        // section, which was "under the source row" only while that row was
        // fifth of seventeen.
        if (i.key === 'firearm_source') {
          if (sourceValue === SOURCE_PRIVATE) {
            out.push(
              <ConsentCard
                key="__consent"
                motivationId={id}
                applicantName={byKey.get('full_name')?.value ?? ''}
                firearm={{
                  make: byKey.get('firearm_make')?.value,
                  model: byKey.get('firearm_model')?.value,
                  calibre: byKey.get('firearm_calibre')?.value,
                  serial: byKey.get('firearm_serial')?.value,
                }}
                signed={sellerSigned}
                onAdopt={(fields) => {
                  for (const [k, v] of Object.entries(fields)) onChange(k, v);
                }}
              />,
            );
          }
          out.push(
            <OverlapCard
              key="__overlap"
              prompt={sheet.overlap.prompt}
              angles={sheet.overlap.suggestedAngle}
              chosen={byKey.get('overlap_angle')?.value ?? ''}
              onPick={(csv) => onChange('overlap_angle', csv)}
            />,
          );
        }

        // Straight after the headline serial, which is the number they will
        // actually be asked for at the counter.
        if (i.key === 'firearm_serial' && inner.length) out.push(fold());
      }
      // A sheet that never rendered the headline serial must not swallow the
      // six rows with it.
      if (inner.length && !placed) out.push(fold());
      return out;
    }

    // ⚠️ ONE FOLD PER FIREARM, AND NOTHING AT ALL FOR THE ROWS NOBODY OWNS.
    // Which rows exist is the server's decision — sheet.ownedRows, built with
    // the backend's own ownedRowTaken — because deciding it here would make
    // the browser a fourth reader of "is this row in use", and that function's
    // note records what happened the last time readers of it disagreed.
    if (sectionId === 'own') {
      const byRow = new Map<number, SheetItem[]>();
      const loose: SheetItem[] = [];
      for (const i of visible) {
        const m = /^existing_firearm_(\d+)_/.exec(i.key);
        if (!m) {
          loose.push(i);
          continue;
        }
        const n = Number(m[1]);
        byRow.set(n, [...(byRow.get(n) ?? []), i]);
      }

      const taken = new Set(sheet.ownedRows.map((r) => r.index));
      const free = [...byRow.keys()].filter((n) => !taken.has(n)).sort((a, b) => a - b);
      const offered = free.slice(0, extraOwned);
      const hasMore = free.length > extraOwned;

      return (
        <>
          {sheet.ownedRows.map((r) => (
            <SheetDisclosure
              key={`own-${r.index}`}
              dense
              summary={r.summary}
              note={r.note ?? undefined}
            >
              {(byRow.get(r.index) ?? []).map(row)}
            </SheetDisclosure>
          ))}

          {/* A row the member has just asked for opens straight away — they
              tapped the button in order to type into it. */}
          {offered.map((n) => (
            <SheetDisclosure
              key={`own-${n}`}
              dense
              defaultOpen
              summary="A firearm you own"
              note="Photograph the licence card and we will read it for you."
            >
              {(byRow.get(n) ?? []).map(row)}
            </SheetDisclosure>
          ))}

          {hasMore ? (
            <button
              type="button"
              onClick={() => setExtraOwned((v) => v + 1)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--r-sm)] border border-dashed border-[var(--border-hover)] px-4 text-[13.5px] font-medium text-[var(--red)]"
            >
              <span aria-hidden="true" className="text-[16px] leading-none">
                +
              </span>
              {sheet.ownedRows.length || offered.length
                ? 'Add another firearm'
                : 'Add a firearm you already own'}
            </button>
          ) : null}

          {loose.map(row)}
        </>
      );
    }

    return visible.map(row);
  };

  return (
    <>
      {/*
        ⚠️ THE TWO-COLUMN GRID EXISTS ONLY WHILE THE PREVIEW IS OPEN, and the
        sheet centres itself the rest of the time. This shipped as `lg:mx-0` on
        `main` with no grid parent anywhere — SPEC-BUILD §3's "1280 content
        column, grid 760px | 1fr, gap 40" was never built, and `.gg-shell-pane`
        measures 0 wide — so on a wide screen the whole sheet sat pinned to the
        left edge. Measured live at a 2133px viewport: main 760px at x=0, with
        1,373px of empty white beside it.
      */}
      <div
        className={
          previewOpen
            ? 'lg:mx-auto lg:grid lg:max-w-[1280px] lg:grid-cols-[760px_minmax(0,1fr)] lg:items-start lg:gap-10'
            : ''
        }
      >
      <main className="mx-auto w-full max-w-[760px] pb-4">
        <SheetHeader
          reference={sheet.application.referenceNumber}
          licenceType={sheet.application.licenceTypeLabel}
          missingCount={sheet.missing.length}
          sections={sectionsForStrip}
          active={active}
          onJump={(sectionId) => {
            setSectionOpen(sectionId, true);
            setActive(sectionId);
          }}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((v) => !v)}
        />

        <DocumentShelf
          documents={sheet.documents}
          onAdd={() => {
            setAutoScan(false);
            setAdding(true);
          }}
          onScan={() => {
            setAutoScan(true);
            setAdding(true);
          }}
        />

        {/*
          ⚠️ ONE DOOR, OPENED FROM THE SHELF — the scanner AND the picker.
          The scanner is the primary route: on a laptop it hands off to the
          member's phone, because a webcam cannot resolve a licence serial.
          See add-panel.tsx, which owns that decision.
        */}
        {adding ? (
          <AddPanel
            motivationId={id}
            kinds={kinds}
            onAdd={onAddFile}
            onRefile={onRefile}
            onHandoffArrived={(count) => {
              void load();
              setToast(
                count === 1
                  ? 'Your phone sent one document.'
                  : `Your phone sent ${count} documents.`,
              );
            }}
            autoScan={autoScan}
            onClose={() => {
              setAdding(false);
              setAutoScan(false);
            }}
          />
        ) : null}

        {sheet.sections.map((s) => (
          <SheetSection
            key={s.id}
            id={s.id}
            title={s.title}
            blurb={s.blurb}
            open={openSections?.[s.id] ?? false}
            onOpenChange={(v) => setSectionOpen(s.id, v)}
            /*
              ⚠️ THE SAME `missing` LIST AS THE PILL, THE CHIP DOTS AND THE
              FOOTER — a fourth view of one number, not a fourth number. A fold
              that could hide a "Still needed" without saying so would be a
              form lying about how much is left.
            */
            meta={
              s.missing.length ? (
                <span className="text-[var(--warning)]">
                  {s.missing.length} still needed
                </span>
              ) : (
                <span className="text-[var(--success)]">Done</span>
              )
            }
          >
            {/*
              ⚠️ THE CONSENT AND OVERLAP CARDS ARE EMITTED FROM renderRows NOW,
              directly under the source row — see the note there. The consent
              card is the door to the seller's own "photograph your licence"
              scanner, and it must sit beside the answer that opens it.
            */}
            {renderRows(s.id)}
          </SheetSection>
        ))}

        <SheetFooter
          missingCount={sheet.missing.length}
          onWrite={onWrite}
          busy={busy}
        />

        {/*
          ⚠️ PAST THE FOOTER ON PURPOSE, AND STILL A REAL BUTTON. The footer is
          `sticky bottom-0`, so this is the last thing on the page: a member
          reaches it only by scrolling to the true end, never by thumbing at
          the bottom of the viewport. Phase 4 deleted the wizards and took the
          only delete control with them, so until now an application started by
          mistake could not be got rid of at all.
        */}
        <div className="border-t border-[var(--border-divider)] px-4 pb-6 pt-5">
          <DeleteApplication
            token={getToken}
            motivationId={id}
            reference={sheet.application.referenceNumber}
          />
          <p className="m-0 mt-2 text-[12px] leading-[1.45] text-[var(--text-tertiary)]">
            Deletes your answers and anything attached only to this
            application. Your Document Centre is not touched.
          </p>
        </div>
      </main>

      {/* Desktop: the preview is docked and sticky. Phone: a bottom sheet. */}
      {previewOpen ? (
        <>
          <div
            className="fixed inset-0 z-[5] bg-[rgba(26,22,19,0.32)] lg:hidden"
            onClick={() => setPreviewOpen(false)}
          />
          <aside className="fixed inset-x-0 bottom-0 z-[5] max-h-[640px] overflow-y-auto rounded-t-[var(--r-lg)] border-t border-[var(--border)] bg-[var(--bg-card)] lg:sticky lg:top-5 lg:z-0 lg:max-h-[calc(100vh-6rem)] lg:rounded-[var(--r-lg)] lg:border">
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-[var(--border)] lg:hidden" />
            <PreviewPanel preview={sheet.preview as PreviewSection[]} />
          </aside>
        </>
      ) : null}
      </div>

      <SheetToast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
