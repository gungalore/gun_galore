'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motivationsApi } from '@/lib/motivations-api';
import type {
  CredentialSlot,
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
import ConsentCard from '@/components/licence-centre/consent-card';
import CompetencyLines from '@/components/licence-centre/competency-lines';
import CredentialPair from '@/components/licence-centre/credential-pair';
import DangerAreas from '@/components/licence-centre/danger-areas';
import LibraryPicker from '@/components/library-picker';
import PackSummary from '@/components/licence-centre/pack-summary';
import PreviewPanel from '@/components/licence-centre/preview-panel';
import AddPanel from '@/components/licence-centre/add-panel';
import DeleteApplication from '@/components/licence-pack/delete-application';
import type {
  DangerArea,
  LibraryItem,
  PickableKind,
} from '@/lib/motivations-api';

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

/**
 * SAPS 271 boxes on the "You" section that a member should never have to think
 * about, because we already hold the answer or the form is asking twice.
 *
 * ⚠️ FOLDED, NOT DELETED. Every one of these is a real box on a statutory
 * form — a postal address distinct from the residential one, a dialling code
 * split from its own number, a postal code per address. Removing them would
 * ship an incomplete 271. What was wrong is that they sat open, marked
 * Optional, between the questions that matter: on the live sheet "Postal
 * address, if different" was prefilled with the SAME address as residential,
 * and the two dialling codes were separate rows from the two phone numbers
 * they belong to.
 */
const YOU_FORM_BOX_KEYS = new Set([
  'postal_address',
  'postal_postal_code',
  'employer_postal_code',
  'home_dialling_code',
  'work_dialling_code',
]);

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

/**
 * The certificate for the class being applied for, first.
 *
 * ⚠️ RANKS, NEVER HIDES, and the difference is H10 read from the other side.
 * Auto-link once grouped competency candidates by KIND alone and attached a
 * handgun-only certificate to a rifle application, which is refused before it
 * is considered — so `competencyCovers` gates the ATTACHING. This is the
 * member choosing, and the doctrine there is "unknown is a yes": we refuse
 * only what we have READ and know to be wrong. A title we cannot match is a
 * document we do not know is wrong, and dropping it out of somebody's own
 * dropdown on that guess is how they end up unable to attach the right page.
 *
 * ⚠️ AND IT IS NOT A STRING GUESS. A vault title is written by
 * derivedCredentialTitle through endorsementDisplay — "Proficiency - Handgun"
 * — off the same endorsement list that produced `neededLabel`. Where a member
 * has renamed one, the match simply does not fire and the order is unchanged.
 */
function rankByClass<T extends { title: string }>(
  items: T[],
  neededLabel: string | null,
): T[] {
  if (!neededLabel) return items;
  const needle = neededLabel.toLowerCase();
  const fits = (t: string) => t.toLowerCase().includes(needle);
  return [...items].sort((a, b) => Number(fits(b.title)) - Number(fits(a.title)));
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

  /** A save into the Document Centre is in flight. */
  const [keeping, setKeeping] = useState(false);

  /**
   * The competency/proficiency reuse picker: which slot asked, and the list.
   *
   * ⚠️ FETCHED ON THE TAP, NOT WITH THE SHEET. The sheet carries a COUNT of
   * what the Document Centre holds — enough to decide whether the door is
   * worth drawing — and `GET :id/library` is the list, with the two-page
   * proficiency fold and the across-applications consent already applied.
   * Loading it on every sheet read would pay for machinery most members never
   * open.
   */
  const [pickerKind, setPickerKind] = useState<CredentialSlot['kind'] | null>(
    null,
  );
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);

  /**
   * The dangerous areas around the applicant, and their own ticks.
   *
   * ⚠️ ITS OWN FETCH, NOT PART OF THE SHEET. Building the list geocodes every
   * area to find its police station — one Places lookup each — and the sheet is
   * refetched after every single answer. Folding it in would pay for a dozen
   * geocodes each time somebody corrects a serial.
   *
   * ⚠️ AND SELF-DEFENCE ONLY. The server answers `{ areas: [] }` for anything
   * else, but there is no reason to ask at all: a hunting application has no
   * press-clippings annexure.
   */
  const [areas, setAreas] = useState<{
    station: string | null;
    withinKm: number;
    areas: DangerArea[];
  } | null>(null);
  const [savingAreas, setSavingAreas] = useState(false);

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
   * Attach what the member already holds, without asking.
   *
   * ⚠️ THE SERVER SIDE OF THIS HAS ALWAYS EXISTED AND NOTHING CALLED IT.
   * `POST :id/autolink` and `motivationsApi.autolink` were both written for the
   * old wizard's "generator open"; Phase 4 deleted those screens and the sheet
   * never picked the call up, so `motivationsApi.autolink` sat in the client
   * with no caller at all. A member with twenty documents in their Document
   * Centre started every application with an empty shelf. Same failure as the
   * delete button and the seller context: a capability orphaned by the cutover.
   *
   * ⚠️ ONCE PER VISIT, BEHIND A REF LATCH. It is a POST that changes what a DFO
   * will see, and an effect that can re-run must not be what decides that. The
   * server is idempotent about it — it answers `already-done` — but the latch
   * is what stops us relying on that.
   *
   * ⚠️ `placeConfirmed` STAYS FALSE. Safe photographs are held back until the
   * member confirms they are of the safe at THIS address: a safe photograph
   * does not go stale with time, it goes wrong when somebody moves house, and
   * nothing on the file says so. The server reports `needsPlaceConfirm` and the
   * library picker asks the question properly.
   *
   * The autolink's own refusals are worth knowing before changing any of this:
   * never a document describing a firearm or a transaction, never one expiring
   * within ninety days, never without consent, and never a guess between
   * candidates — except that the endorsement test runs BEFORE the count, so a
   * member holding a handgun certificate and a rifle certificate gets the one
   * that covers the firearm being applied for rather than neither.
   */
  const autolinkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sheet) return;
    /**
     * ⚠️ KEYED ON THE FIREARM, NOT ON "have we run yet".
     *
     * A plain once-per-visit latch is what made the competency unreachable: the
     * run happens at open, before the firearm type is answered, so every
     * competency certificate the member holds is an equally valid candidate and
     * the several-candidates rule correctly refuses to guess. Answering the
     * firearm afterwards changed nothing, because the latch had closed.
     *
     * `firearm_type` and `firearm_action` are the two answers `endorsementNeed`
     * reads, so this re-asks exactly when the question has a different answer —
     * and never merely because a model or a serial was edited. The server
     * re-arms its own once-per-application stamp on the same condition.
     */
    const key = `${sheet.items.find((i) => i.key === 'firearm_type')?.value ?? ''}|${
      sheet.items.find((i) => i.key === 'firearm_action')?.value ?? ''
    }`;
    if (autolinkedFor.current === key) return;
    autolinkedFor.current = key;
    void (async () => {
      try {
        const r = await motivationsApi.autolink(getToken, id);
        if (!r.attached.length) return;
        await load();
        setToast(
          r.attached.length === 1
            ? `Added ${r.attached[0].title} from your Licence Centre.`
            : `Added ${r.attached.length} documents from your Licence Centre.`,
        );
      } catch {
        /* Fail soft: an application must never fail to open because the
           Centre was slow. The shelf is simply emptier than it could be. */
      }
    })();
  }, [sheet, getToken, id, load]);

  /**
   * Write "why this firearm" once the firearm is described.
   *
   * ⚠️ AUTOMATIC, BECAUSE A CAUTIOUS BLANK IS NOT SAFER THAN A GOOD ANSWER.
   * The operator's standing rule (2026-08-25) is fill it in, arm it, let them
   * change it — and `firearm_fit_reason` was REQUIRED until 2026-09-08 and was
   * "the largest single reason an application stalled: it asked the applicant
   * to write the argument the product exists to write for them".
   *
   * ⚠️ AND ONLY WHILE THE BOX IS EMPTY, WHICH IS WHAT BOUNDS THE BILL. It is a
   * model call. The moment it succeeds the box has a value, so the condition is
   * false for the rest of the application's life; the latch below stops a
   * failed call being retried on every render. The server refuses anyway if the
   * member has written their own — stamp() will not overwrite MEMBER.
   */
  const reasonedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sheet) return;
    const fit = sheet.items.find((i) => i.key === 'firearm_fit_reason');
    if (!fit || fit.value.trim()) return;
    const make = sheet.items.find((i) => i.key === 'firearm_make')?.value ?? '';
    const type = sheet.items.find((i) => i.key === 'firearm_type')?.value ?? '';
    if (!make && !type) return;
    const key = `${make}|${type}`;
    if (reasonedFor.current === key) return;
    reasonedFor.current = key;
    void (async () => {
      try {
        const r = await motivationsApi.reason(getToken, id);
        if (!r.written) return;
        await load();
        /*
          ⚠️ A WARNING IS SHOWN, NOT SWALLOWED, AND IT IS NOT A FAILURE. The
          paragraph is always written now — MOTIVATION-CORPUS-LEARNINGS.md
          found the Registrar approving thinner cases than anything we would
          have refused — so a thin distinction is something the applicant
          should know a DFO may ask about, on a document they are about to
          sign, rather than a reason to hand them a blank box.
        */
        setToast(
          r.warnings?.length
            ? `We have written your reason — read it. ${r.warnings[0]}`
            : 'We have written your reason — read it and change anything.',
        );
      } catch {
        /* Fail soft: the box stays empty and they can write it themselves. */
      }
    })();
  }, [sheet, getToken, id, load]);

  /**
   * Load the area list once, for a self-defence application.
   *
   * ⚠️ KEYED ON THE STATION, because that is what the list is drawn around.
   * It arrives from `stationOffer()` at create and the member may correct it;
   * anything else they change — a serial, a safe photograph — must not spend a
   * dozen geocodes again.
   */
  const areasFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sheet) return;
    if (sheet.application.licenceType !== 'S13_SELF_DEFENCE') return;
    const station =
      sheet.items.find((i) => i.key === 'police_station')?.value ?? '';
    if (areasFor.current === station) return;
    areasFor.current = station;
    void (async () => {
      try {
        setAreas(await motivationsApi.areas(getToken, id));
      } catch {
        /* Fail soft: the section says it found nothing, which is true. */
      }
    })();
  }, [sheet, getToken, id]);

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
  /**
   * ⚠️ `id` AND `status`, NOT `key` AND `done` — NEITHER OF WHICH EXISTS.
   *
   * This shipped as `c.key === 'F' && (c.done ?? 0) > 0`. saps271-coverage.ts
   * emits `{ id, label, percent, status, note, missingRequired, applicable,
   * answered }`: there is no `key` and no `done`, so the test was reading two
   * undefined properties and could only ever be false. And `answered` — the
   * field `done` was presumably meant to be — is pinned at 0 for F on purpose:
   * "STATUS, NEVER A PERCENTAGE. Section F is the seller's to complete. A score
   * would be the applicant being shown a mark for somebody else's homework."
   * So even spelled correctly it would never have flipped.
   *
   * ⚠️ AND THE `as` CAST IS WHY NOBODY SAW IT. Asserting a shape the server
   * does not send turns a compile error into a silent false. The seller signed
   * at 12:02 and the line under the panel still read "When they sign…".
   */
  const sellerSigned =
    (
      sheet.coverage as { sections?: { id?: string; status?: string }[] }
    )?.sections?.some((c) => c.id === 'F' && c.status === 'complete') ?? false;

  const sectionsForStrip = sheet.sections.map((s) => ({
    id: s.id,
    label: s.title,
    missing: s.missing.length,
  }));

  const renderRows = (sectionId: string) => {
    const mine = items.filter((i) => i.section === sectionId);

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
        /*
          ⚠️ ONE CONTROL FOR overlap_angle, NOT TWO. OverlapCard rendered this
          question near the top of the section with its own copy of the tiles,
          writing the same key, while the registry row rendered them again lower
          down — so the sheet asked one question twice under two headings and
          the operator could not tell them apart. The registry row won: it is
          the only one carrying the own-words box, and it sits where the section
          says it should rather than "popping up" beside an unrelated answer.
          Its prompt — "You already hold a CZ 75 in 9mm" — comes across here.
        */
        prompt={
          i.key === 'overlap_angle' ? sheet.overlap.prompt : undefined
        }
        ownWords={i.ownWordsKey ? byKey.get(i.ownWordsKey) : undefined}
        onOwnWordsChange={
          i.ownWordsKey ? (v) => onChange(i.ownWordsKey as string, v) : undefined
        }
      />
    );

    /*
      ⚠️ COMPETENCY IS LINES, NOT ROWS, WHEN THE VAULT HAS IT. See
      CompetencyLines: the screen this replaces showed two scanner blocks, two
      reuse dropdowns listing nine credentials, and a warning about unreadable
      proficiency codes — all true, none of it the member's business.

      ⚠️ AND THE DOCUMENTS SIT UNDER THE ANSWERS, NOT INSTEAD OF THEM. What we
      read OFF the certificate is one thing; whether the certificate and its
      statement of results are actually in the pack is another, and the section
      showed only the first — so a member who had never uploaded a statement of
      results saw a section that looked finished. CredentialPair renders in
      BOTH states, which is the half that was missing: it was previously
      reachable only through CompetencyLines' `onAdd`, and only when the vault
      held nothing at all.
    */
    if (sectionId === 'competency') {
      const known = mine.filter(
        (i) => i.state === 'filled' || i.state === 'suggested',
      );
      return (
        <>
          {known.length ? (
            <CompetencyLines
              items={mine}
              covered={!mine.some((i) => i.state === 'needs_you' && i.required)}
              onAdd={() => setAdding(true)}
              onChange={onChange}
            />
          ) : (
            visible.map(row)
          )}
          <CredentialPair
            credentials={sheet.credentials}
            onScan={() => {
              setAutoScan(true);
              setAdding(true);
            }}
            onUpload={async (files) => {
              setBusy(true);
              try {
                for (const f of files) await onAddFile('', f);
                await load();
                setToast(
                  files.length === 1
                    ? 'Added one document.'
                    : `Added ${files.length} documents.`,
                );
              } finally {
                setBusy(false);
              }
            }}
            onAddFromCentre={async (kind) => {
              /* A second tap on the same door closes it. */
              if (pickerKind === kind) {
                setPickerKind(null);
                return;
              }
              setPickerKind(kind);
              try {
                const r = await motivationsApi.library(getToken, id);
                setLibraryItems(r.items);
              } catch {
                setLibraryItems([]);
                setToast('We could not read your Licence Centre just now.');
              }
            }}
            picker={
              pickerKind
                ? {
                    kind: pickerKind,
                    node: (
                      <LibraryPicker
                        items={rankByClass(
                          libraryItems.filter((i) => i.kind === pickerKind),
                          sheet.credentials.neededLabel,
                        )}
                        onPick={async (item, placeConfirmed) => {
                          await motivationsApi.addFromLibrary(
                            getToken,
                            id,
                            item.source,
                            item.sourceId,
                            placeConfirmed,
                          );
                          setPickerKind(null);
                          await load();
                          setToast(`Added ${item.title} to this application.`);
                        }}
                      />
                    ),
                  }
                : null
            }
          />
        </>
      );
    }

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
                /*
                  ⚠️ EVERY KEY THE CARD CAN FILL, not just the four the panel
                  used to show. The panel compares these against what the card
                  carries to decide whether there is anything left to adopt, so
                  a short list here means it stops offering the six component
                  rows the moment the first four have landed.
                */
                firearm={{
                  make: byKey.get('firearm_make')?.value,
                  model: byKey.get('firearm_model')?.value,
                  type: byKey.get('firearm_type')?.value,
                  calibre: byKey.get('firearm_calibre')?.value,
                  serial: byKey.get('firearm_serial')?.value,
                  barrel_serial: byKey.get('barrel_serial')?.value,
                  barrel_make: byKey.get('barrel_make')?.value,
                  frame_serial: byKey.get('frame_serial')?.value,
                  frame_make: byKey.get('frame_make')?.value,
                  receiver_serial: byKey.get('receiver_serial')?.value,
                  receiver_make: byKey.get('receiver_make')?.value,
                }}
                signed={sellerSigned}
                /*
                  ⚠️ IT FILLS THE EMPTY ONES AND NEVER OVERWRITES. Adopting used
                  to write every field the card carried, which is why the offer
                  had to be shown once and then hidden for good — "inviting them
                  to overwrite their own corrections with the same card a second
                  time". Skipping answered fields makes a second adopt harmless,
                  which is what lets the panel offer again when the card turns
                  out to carry rows the application still lacks. Theirs wins,
                  always — the same rule the credential offer already follows.
                */
                onAdopt={(fields) => {
                  for (const [k, v] of Object.entries(fields)) {
                    const item = byKey.get(k);
                    /*
                      ⚠️ "THEIRS WINS" MEANS THE MEMBER'S, NOT A PREVIOUS READ
                      OF THE SAME CARD. Skipping every answered field looked
                      right until a bad read had already landed: the operator's
                      Glock adopted as "ZABA01892 VUURWAPEMLISENSIEN" before the
                      serial cleanup, and a rule that refuses to touch anything
                      answered would leave that on the 271 for ever. A value the
                      CARD gave us is ours to correct; one the MEMBER typed is
                      not, and the server's stamp() refuses to overwrite MEMBER
                      provenance in any case.
                    */
                    if (item?.provenance?.source === 'MEMBER') continue;
                    if (!item?.provenance && (item?.value ?? '').trim()) continue;
                    onChange(k, v);
                  }
                }}
              />,
            );
          }
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

    // ⚠️ THE 271's OWN BOXES FOLD TO THE BOTTOM OF "You". See
    // YOU_FORM_BOX_KEYS: they are real boxes on a statutory form, so they stay
    // fillable, but they are not questions anybody should be reading past.
    if (sectionId === 'you') {
      const boxes = visible.filter((i) => YOU_FORM_BOX_KEYS.has(i.key));
      const rest = visible.filter((i) => !YOU_FORM_BOX_KEYS.has(i.key));
      return (
        <>
          {rest.map(row)}
          {boxes.length ? (
            <SheetDisclosure
              key="__form-boxes"
              summary="Post and dialling codes"
              note="The SAPS 271 has a box for each. Open this only if post reaches you somewhere else."
              meta={
                <span className="text-[var(--text-tertiary)]">
                  {boxes.length} rows
                </span>
              }
            >
              {boxes.map(row)}
            </SheetDisclosure>
          ) : null}
        </>
      );
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

    /**
     * ⚠️ "Your case" IS WHERE THE AREAS BELONG, under the cards that say what
     * the applicant's circumstances are. It is the same argument in two
     * registers: the cards say "I travel at night", and this says which roads.
     *
     * ⚠️ AND IT IS THE ONLY THING THAT CAN WRITE `press_clippings`. That key is
     * internal and its registry comment says the wizard writes it once the
     * member has picked — Phase 4 deleted the wizard, so the annexure has been
     * unreachable since. Mounting this is what restores it.
     */
    if (sectionId === 'case' && areas) {
      return (
        <>
          {visible.map(row)}
          <DangerAreas
            areas={areas.areas}
            station={areas.station}
            withinKm={areas.withinKm}
            busy={savingAreas}
            onSave={async (ticked) => {
              setSavingAreas(true);
              try {
                const r = await motivationsApi.saveAreas(getToken, id, ticked);
                /*
                  ⚠️ THE SERVER'S ANSWER, NOT THE TICK COUNT. The member ticked
                  areas; how many cuttings that bought is our arithmetic, and
                  the cap is spent area by area — so "3 areas" can be "3
                  cuttings" or "8". Saying what actually goes in the pack is the
                  only honest number.
                */
                setToast(
                  r.areas === 0
                    ? 'Saved — no areas ticked, so no cuttings go in your pack.'
                    : `Saved ${r.areas === 1 ? '1 area' : `${r.areas} areas`} — ${
                        r.clippings === 1
                          ? '1 cutting'
                          : `${r.clippings} cuttings`
                      } will go in your pack.`,
                );
                await load();
              } catch {
                setToast('We could not save those just now.');
              } finally {
                setSavingAreas(false);
              }
            }}
          />
        </>
      );
    }

    return visible.map(row);
  };

  return (
    <>
      {/*
        ⚠️ THE TWO-COLUMN GRID IS THE PAGE ON A WIDE SCREEN, NOT A MODE IT CAN
        BE PUT INTO. SPEC-BUILD §3 — "1280 content column, grid 760px | 1fr,
        gap 40" — and the operator's own mockup both show the sheet on the left
        and "What your motivation will say" beside it, always. It shipped as
        `lg:mx-0` on `main` with no grid parent anywhere, so on a wide screen
        the sheet sat pinned to the left edge with 1,373px of empty white beside
        it; then as a grid that only existed while a toggle was on, which put
        the live preview behind a button most members never pressed. Operator,
        2026-09-08: "I see we don't have the live example generate on the left,
        lets build it."

        ⚠️ AND `previewOpen` NOW MEANS THE PHONE DRAWER ONLY. There is no room
        for a second column at 390px, so the toggle and the bottom sheet stay —
        they simply have nothing to do at `lg`, where the panel is already on
        screen.
      */}
      <div className="lg:mx-auto lg:grid lg:max-w-[1280px] lg:grid-cols-[minmax(0,760px)_minmax(0,1fr)] lg:items-start lg:gap-10">
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

        {/*
          ⚠️ TWO DOORS, BOTH ON THE SHELF, AND NEITHER OF THEM OPENS A SCREEN
          THAT OFFERS THE CHOICE AGAIN. Upload goes straight to the operating
          system's file dialog; Scan mounts AddPanel, which renders nothing a
          member can see and exists only to host the scanner ScanButton's
          `autoStart` opens. Operator, 2026-09-08: "this is double. two scan
          with phone options."
        */}
        <DocumentShelf
          documents={sheet.documents}
          keeping={keeping}
          /*
            ⚠️ NOTHING REACHES THE DOCUMENT CENTRE UNTIL THEY ASK. The
            automatic sweep is gone — operator, 2026-09-08: "yes, stop auto
            copy. we need to ask consent to add items to the license centre" —
            so this is the only route in, and `needsConsent` is the one refusal
            a member can act on. Everything else adoptUpload declines (a kind
            that is not reusable, bytes already purged) is silent by design and
            reported as a count.
          */
          onKeep={async (ids) => {
            setKeeping(true);
            try {
              const r = await motivationsApi.keepInCentre(getToken, id, ids);
              if (r.needsConsent) {
                setToast(
                  'First tell us we may keep documents — Account, then Document Centre.',
                );
                return;
              }
              await load();
              setToast(
                r.kept === 1
                  ? 'Saved one document to your Licence Centre.'
                  : `Saved ${r.kept} documents to your Licence Centre.`,
              );
            } catch {
              setToast('We could not save those just now.');
            } finally {
              setKeeping(false);
            }
          }}
          onScan={() => setAdding(true)}
          onUpload={async (files) => {
            setBusy(true);
            try {
              for (const f of files) await onAddFile('', f);
              await load();
              setToast(
                files.length === 1
                  ? 'Added one document.'
                  : `Added ${files.length} documents.`,
              );
            } finally {
              setBusy(false);
            }
          }}
        />

        {adding ? (
          <AddPanel
            motivationId={id}
            onAdd={onAddFile}
            onHandoffArrived={(count) => {
              void load();
              setToast(
                count === 1
                  ? 'Your phone sent one document.'
                  : `Your phone sent ${count} documents.`,
              );
            }}
            onClose={() => setAdding(false)}
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
              form lying about how much is left. SheetSection draws the pill;
              this passes the number and nothing else.
            */
            missingCount={s.missing.length}
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

      {/*
        ⚠️ TWO MOUNTS, NOT ONE THAT CHANGES SHAPE. A single element that is a
        fixed bottom sheet on a phone and a sticky grid child at `lg` has to
        drop `position: fixed` at the breakpoint, and a `fixed` ancestor is
        exactly what stops `position: sticky` sticking — so the docked column
        scrolled away with the page. They are separate elements with separate
        lifetimes: the phone drawer exists only while `previewOpen`, and the
        desktop column is simply part of the page.
      */}
      {previewOpen ? (
        <>
          <div
            className="fixed inset-0 z-[5] bg-[rgba(26,22,19,0.32)] lg:hidden"
            onClick={() => setPreviewOpen(false)}
          />
          <aside className="fixed inset-x-0 bottom-0 z-[5] max-h-[640px] overflow-y-auto rounded-t-[var(--r-lg)] border-t border-[var(--border)] bg-[var(--bg-card)] lg:hidden">
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-[var(--border)]" />
            <PreviewPanel preview={sheet.preview as PreviewSection[]} />
          </aside>
        </>
      ) : null}

      <aside className="sticky top-5 hidden max-h-[calc(100vh-4rem)] overflow-y-auto rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg-card)] lg:block">
        <PreviewPanel preview={sheet.preview as PreviewSection[]} />
      </aside>
      </div>

      <SheetToast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
