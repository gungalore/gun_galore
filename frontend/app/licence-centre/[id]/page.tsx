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
import BulkCapture from '@/components/licence-pack/bulk-capture';
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
  const [kinds, setKinds] = useState<PickableKind[]>([]);

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

    return mine
      .filter((i) => !ownWordsKeys.has(i.key))
      .map((i) => (
        <SheetRow
          key={i.key}
          item={i}
          onChange={(v) => onChange(i.key, v)}
          onConfirm={() => onConfirm(i)}
          ownWords={i.ownWordsKey ? byKey.get(i.ownWordsKey) : undefined}
          onOwnWordsChange={
            i.ownWordsKey
              ? (v) => onChange(i.ownWordsKey as string, v)
              : undefined
          }
        />
      ));
  };

  return (
    <>
      <main className="mx-auto w-full max-w-[760px] pb-4 lg:mx-0">
        <SheetHeader
          reference={sheet.application.referenceNumber}
          licenceType={sheet.application.licenceTypeLabel}
          missingCount={sheet.missing.length}
          sections={sectionsForStrip}
          active={active}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((v) => !v)}
        />

        <DocumentShelf
          documents={sheet.documents}
          onAdd={() => setAdding(true)}
        />

        {/*
          ⚠️ ONE DOOR, OPENED FROM THE SHELF, AND IT IS THE EXISTING FLOW.
          bulk-capture.tsx already owns the picker, the phone hand-off and the
          re-file dropdown, and it is tested where it lives. Phase 4 moves the
          file; this mounts it.
        */}
        {adding ? (
          <div className="border-b border-[var(--border-divider)] px-4 py-3">
            <BulkCapture
              pickable={kinds}
              onAdd={onAddFile}
              onRefile={onRefile}
            />
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="mt-2 min-h-[44px] text-[13px] font-medium text-[var(--text-tertiary)]"
            >
              Done adding
            </button>
          </div>
        ) : null}

        {sheet.sections.map((s) => (
          <SheetSection key={s.id} id={s.id} title={s.title} blurb={s.blurb}>
            {renderRows(s.id)}
            {/*
              ⚠️ THE OVERLAP CARD SITS IN FIREARM, UNDER THE SOURCE ROW, and
              renders itself away when there is no overlap to explain.
            */}
            {s.id === 'firearm' ? (
              <>
                {/*
                  ⚠️ ONLY ON A PRIVATE SALE. A dealer completes Part F and
                  their own 350(a); an estate is the executor's. Showing this
                  on either route asks somebody to chase a signature nobody
                  needs.
                */}
                {sourceValue === 'From a private owner' ? (
                  <ConsentCard
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
                      for (const [k, v] of Object.entries(fields)) {
                        onChange(k, v);
                      }
                    }}
                  />
                ) : null}
                <OverlapCard
                  prompt={sheet.overlap.prompt}
                  angles={sheet.overlap.suggestedAngle}
                  chosen={byKey.get('overlap_angle')?.value ?? ''}
                  onPick={(csv) => onChange('overlap_angle', csv)}
                />
              </>
            ) : null}
          </SheetSection>
        ))}

        <SheetFooter
          missingCount={sheet.missing.length}
          onWrite={onWrite}
          busy={busy}
        />
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

      <SheetToast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
