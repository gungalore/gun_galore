'use client';

import { useAuth } from '../../lib/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import DocumentCentreAdd from '@/components/document-centre-add';
import CredentialCard from '@/components/document-centre/credential-card';
import ReviewScreen, {
  type RejectedFile,
  nextRejectKey,
} from '@/components/document-centre/review-screen';
import { Breadcrumbs, type Crumb } from '@/components/breadcrumbs';
/*
  ⚠️ THE FOUR DECISIONS THAT CAN LOSE A DOCUMENT LIVE IN lib/, NOT HERE.
  They decide whether a member has to look at a document and whether its type
  can be corrected in one tap — and a bug in exactly that logic, caught in a
  pre-ship review, would have confirmed a firearm licence with no expiry and
  left nothing able to remind on it or ask about it again. In lib/ they are
  covered by document-review-rules.spec.ts; in here they were not testable at
  all, because this file cannot be imported without a DOM.
*/
import {
  ReviewItem,
  mergeReviewQueue,
  needsDateCheck,
  needsFilingCheck,
  needsReview,
} from '@/lib/document-review-rules';
import {
  CredentialKind,
  CredentialRow,
  CredentialUsage,
  LicenceApiError,
  licenceCentreApi,
} from '@/lib/licence-centre-api';
/*
  ⚠️ THE GROUPING IS PURE AND IT LIVES IN lib/, FOR THE SAME REASON THE REVIEW
  RULES DO. Placing a row in a section, folding a two-page document into one
  row, folding a copy under its original and deciding what opens by default
  are four ways to make a document disappear from the only screen that lists
  it — and none of them was testable while it lived in here, because this file
  cannot be imported without a DOM. See document-centre-sections.spec.ts.
*/
import {
  ChipId,
  buildSections,
  chipCounts,
  defaultOpenSections,
  pageLabel,
} from '@/lib/document-centre-sections';
import DocumentSection from '@/components/document-centre/section';
import DocumentRow from '@/components/document-centre/document-row';
import { DocThumb } from '@/components/document-centre/doc-thumb';
import { DocSectionId } from '@/components/document-centre/kinds';

// ────────────────────────────────────────────────────────────────────
// THE LICENCE & COMPETENCY CENTRE.
//
// A member's own licences and certificates, kept encrypted on our own server,
// with the expiry date tracked so a renewal is never missed for want of a
// reminder.
//
// ⚠️ AND, SINCE 2026-08-22, PAPERWORK THAT HAS NO EXPIRY DATE AT ALL. An ID
// copy, a proof of address, a confirmation of employment, four photographs of
// a gun safe, a record of hunts. Every surface on this page was written on the
// assumption that a document is a thing with a date on it, and every one of
// them lied about a photograph: the banner counted it as a date still to be
// checked, the group header called a folder of photographs "All in date", the
// card offered "add the expiry date printed on it" over a picture of a safe,
// and the confirm button would not enable without a date that does not exist.
//
// The member holds the paper and can see whether a date is printed on it, so
// the member answers: two tick boxes, "Never expires" beside the expiry and
// "Not sure" beside the issue date. NOTHING here infers either from the kind —
// a passport is an identity document and it expires.
//
// ⚖️ WE REMIND, WE NEVER ENSURE. No copy on this page may promise that
// somebody will not miss a renewal — the responsibility is theirs in law, and
// the document as printed always governs. That sentence appears on the confirm
// step and in every reminder, deliberately.
//
// ⚠️ THE CONFIRM STEP IS NOT A FORMALITY. We read the expiry off a photograph;
// a smudged card misreads. Until the member has looked at the date and said it
// is right, the document shows as "date not confirmed" and NOTHING is
// scheduled against it.
// ────────────────────────────────────────────────────────────────────

/** Mirrors UPLOAD_MIME in licence-centre.controller.ts. NO HEIC. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

import { KIND_GROUPS } from '@/components/document-centre/kinds';

/**
 * Which sections the member has folded by hand.
 *
 * ⚠️ PER BROWSER, NOT PER MEMBER, AND THAT IS DELIBERATE. It holds nothing
 * about any document — only which of seven fixed headings were shut — so
 * there is nothing here worth keying to an account, and a value keyed to one
 * would have to be fetched before the page could draw.
 */
const OPEN_KEY = 'document-centre:open-sections';

// This page is still named /licence-centre in the URL and in every API call
// below — the rename to "Document Centre" was copy-only — so the trail names
// what the reader sees, not the route.
const LICENCE_CENTRE_TRAIL: Crumb[] = [
  { label: 'Home', href: '/' },
  { label: 'Account', href: '/account' },
  { label: 'Document Centre' },
];

export default function LicenceCentrePage() {
  const { getToken } = useAuth();
  const token = useCallback(() => getToken(), [getToken]);

  /**
   * Whether the Centre is open, and — crucially — WHY it is not.
   *
   * ⚠️ THIS WAS A BOOLEAN AND THE TWO FAILURES WERE INDISTINGUISHABLE. The
   * status call's `catch` set it to `false`, the same value the flag being
   * off produces, so an unreachable API rendered "We are still putting this
   * together" — telling a member a shipped feature was never built, and
   * offering them nothing to do about it. It cost a session to tell the two
   * apart from the outside, with the code open.
   *
   * `closed` is the operator's decision and is final until they change it.
   * `unreachable` is a fault, and the only one of the two worth a retry.
   */
  type Gate = 'loading' | 'open' | 'closed' | 'unreachable';
  const [gate, setGate] = useState<Gate>('loading');
  /**
   * How many documents this member may keep.
   *
   * ⚠️ THE STATUS ENDPOINT HAS ALWAYS RETURNED IT AND THE PAGE READ ONLY
   * `enabled`. So the cap announced itself as a 409 on one arbitrary file
   * part-way through a batch — after the member had chosen the type, opened
   * the camera and photographed six licences. A limit nobody is told about is
   * a limit they can only discover by losing work to it.
   *
   * 0 means "we have not been told", which must never read as a cap of zero.
   */
  const [maxCredentials, setMaxCredentials] = useState(0);
  // Three states, not two: "none yet" and "we could not load them" must never
  // render the same way.
  const [rows, setRows] = useState<CredentialRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── SECTIONS, ROWS, DETAIL ─────────────────────────────────────
  //
  // ⚠️ THE FOLDER RAIL IS GONE, AND ITS REPLACEMENT IS NOT A REDESIGN FOR ITS
  // OWN SAKE. Three folders split the only real vault 18 / 2 / 0: everything
  // a member came for was in the first one, as a flat list of eighteen rows
  // under five type headings. On a phone the rail pushed the documents below
  // the fold to say so. Sections that summarise themselves shut answer "is
  // anything wrong in here" without opening, and the firearm — not the form's
  // name for the piece of paper — leads the list.
  //
  // ⚠️ THE THREE STAT TILES WENT WITH IT. They counted three things and did
  // nothing when tapped; the same three counts are the chips above, which
  // filter every section. A count you can tap to see the rows it counts is
  // worth more than the number.
  const [chips, setChips] = useState<ChipId[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The detail column, so a phone can be scrolled to it on selection. */
  const detailRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  /**
   * The add controls, so an empty section's Add link can put the member in
   * front of them.
   *
   * The link scrolls the controls into view AND opens them on the section's
   * own kind — a member who tapped Add under "Safe and storage" has already
   * answered "what are you adding?".
   */
  const addRef = useRef<HTMLDivElement | null>(null);
  const [addPreset, setAddPreset] = useState<{
    kind: CredentialKind;
    at: number;
  } | null>(null);
  /**
   * Which applications each document is already in.
   *
   * ⚠️ ITS OWN STATE, NOT PART OF `rows`. It is a second request that is
   * allowed to fail, and folding it into the list would make a document's
   * dates depend on whether its usage loaded.
   */
  const [usage, setUsage] = useState<Record<string, CredentialUsage[]>>({});

  /**
   * ⚠️ WHICH SECTIONS ARE OPEN, AND WHY IT IS REMEMBERED PER BROWSER.
   *
   * Two open by default — Your firearms and Competency — plus anything
   * holding a row an attention chip points at. A member who shuts one is
   * telling us something durable about how they read this page, so the
   * toggles are kept; nothing about a document is stored, only which headings
   * were folded, which is why a page-wide key rather than a per-member one is
   * honest here.
   *
   * ⚠️ EVERY READ AND WRITE IS WRAPPED. localStorage throws outright in a
   * browser set to block site data, and a page that will not render because
   * it could not remember a chevron is worse than one that forgets.
   */
  const [openSections, setOpenSections] = useState<DocSectionId[] | null>(null);
  const [manual, setManual] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(OPEN_KEY);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const rowsById = useMemo(
    () => new Map((rows ?? []).map((r) => [r.id, r] as const)),
    [rows],
  );

  /** The counts the chips carry, off every row rather than the filtered ones. */
  const counts = useMemo(() => chipCounts(rows ?? [], usage), [rows, usage]);

  /**
   * The whole list: placed, filtered, folded, grouped, sorted, summarised.
   *
   * See lib/document-centre-sections.ts. Nothing about this is decided here.
   */
  const views = useMemo(
    () => buildSections({ rows: rows ?? [], usage, chips, query }),
    [rows, usage, chips, query],
  );

  /**
   * Every row on screen, in the order it is drawn.
   *
   * ⚠️ THE COPIES AND THE PHOTOGRAPHS ARE IN IT. They are selectable — a copy
   * is where the delete lives and a photograph is a document like any other —
   * so a list that left them out would let the panel land on a row nobody can
   * see, and would re-pick the moment they tapped one.
   */
  const visible = useMemo(
    () =>
      views.flatMap((v) => [
        ...v.groups.flatMap((g) =>
          g.rows.flatMap((n) => [n.row, ...n.copies]),
        ),
        ...v.photos.flatMap((n) => [n.row, ...n.copies]),
      ]),
    [views],
  );

  /** The other page of the selected pair, when it is in the vault. */
  const partner = useMemo(() => {
    const s = visible.find((r) => r.id === selectedId);
    return s?.otherSide ? (rowsById.get(s.otherSide.id) ?? null) : null;
  }, [visible, selectedId, rowsById]);
  const [showPartner, setShowPartner] = useState(false);
  useEffect(() => setShowPartner(false), [selectedId]);

  /**
   * ⚠️ THE DEFAULTS ARE COMPUTED ONCE THE ROWS ARRIVE, NOT ON EVERY BUILD.
   * `views` changes as the member types in the search box, and re-deriving
   * the open set from it would slam sections open and shut under the cursor.
   */
  useEffect(() => {
    if (rows === null || openSections !== null) return;
    setOpenSections(defaultOpenSections(views));
  }, [rows, views, openSections]);

  const isOpen = useCallback(
    (id: DocSectionId) =>
      manual[id] ?? (openSections ?? ['firearms', 'competency']).includes(id),
    [manual, openSections],
  );

  const toggleSection = useCallback(
    (id: DocSectionId, open: boolean) => {
      setManual((prev) => {
        const next = { ...prev, [id]: open };
        try {
          window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
        } catch {
          // A browser that will not keep this still has to render the page.
        }
        return next;
      });
    },
    [],
  );

  const toggleChip = useCallback((c: ChipId) => {
    setChips((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }, []);

  /**
   * Open a document in the panel.
   *
   * ⚠️ AND ON A PHONE THE DETAIL IS BELOW THE WHOLE LIST. The two columns
   * stack under `lg`, so tapping a row changes something a long way further
   * down the page and reads as nothing happening at all. Only on the stacked
   * layout — on desktop the panel is already in view and scrolling would be a
   * jolt for no reason.
   */
  const select = useCallback((id: string) => {
    setSelectedId(id);
    // ⚠️ THE PAGE-LEVEL ERROR BELONGS TO THE DOCUMENT THAT RAISED IT. It is
    // rendered once, under the list, so a failed delete on one document
    // otherwise sits there accusing the next one the member opens.
    setError(null);
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1023px)').matches
    ) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  /** An empty section's Add link. See the note on `addRef`. */
  const openAddFor = useCallback((kind: CredentialKind) => {
    addRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setAddPreset({ kind, at: Date.now() });
  }, []);

  /**
   * ⚠️ THE SELECTION IS RESOLVED, NEVER STORED AS A ROW. Holding the row
   * object would show a stale copy after any edit — the card writes, the list
   * refetches, and the detail column would still be rendering the version from
   * before the save.
   */
  const selected = useMemo(
    () => visible.find((r) => r.id === selectedId) ?? null,
    [visible, selectedId],
  );

  /**
   * Land on something rather than on an empty panel.
   *
   * ⚠️ ONLY WHEN THE CURRENT SELECTION IS GONE, so this cannot yank the panel
   * off a document the member is part-way through editing. Changing folder
   * drops the selection out of `visible`, which is precisely when re-picking
   * is the helpful thing to do.
   */
  useEffect(() => {
    if (visible.length === 0) return;
    if (selectedId && visible.some((r) => r.id === selectedId)) return;
    setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  const refresh = useCallback(async () => {
    try {
      setRows(await licenceCentreApi.list(token));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    // ⚠️ AFTER the list, and never allowed to fail it. A document that has
    // just been attached to an application changes this, so it is re-read on
    // every refresh rather than once at mount.
    licenceCentreApi
      .usage(token)
      .then(setUsage)
      .catch(() => undefined);
  }, [token]);

  /**
   * Read the gate. Extracted from the effect so the retry button can call it
   * — a page that says "try again" and has no way to is worse than one that
   * says nothing.
   */
  const readGate = useCallback(
    async (alive: () => boolean = () => true) => {
      try {
        const s = await licenceCentreApi.status(token);
        if (!alive()) return;
        setGate(s.enabled ? 'open' : 'closed');
        setMaxCredentials(s.maxCredentials);
        // With the flag off every other endpoint 404s, so do not call them.
        if (s.enabled) await refresh();
      } catch {
        // ⚠️ NOT `closed`. We did not learn the flag is off — we learned
        // nothing. Saying "not built yet" here is a guess presented as fact.
        if (alive()) setGate('unreachable');
      }
    },
    [token, refresh],
  );

  useEffect(() => {
    let alive = true;
    void readGate(() => alive);
    return () => {
      alive = false;
    };
  }, [readGate]);

  if (gate === 'closed') {
    return (
      <main className="mx-auto max-w-[var(--content-max)] px-4 py-10">
        <Breadcrumbs trail={LICENCE_CENTRE_TRAIL} className="mb-6" />
        <h1 className="text-2xl font-semibold">Document Centre</h1>
        <p className="mt-3 text-[var(--text-secondary)]">
          We are still putting this together. It will appear here when it opens.
        </p>
      </main>
    );
  }

  // ⚠️ A DIFFERENT SCREEN, AND IT MUST STAY DIFFERENT. The member's documents
  // are not missing and the Centre is not unbuilt — we could not reach the
  // server. Saying anything else sends somebody away from a vault that is
  // sitting there intact, and they have no reason to come back.
  if (gate === 'unreachable') {
    return (
      <main className="mx-auto max-w-[var(--content-max)] px-4 py-10">
        <Breadcrumbs trail={LICENCE_CENTRE_TRAIL} className="mb-6" />
        <h1 className="text-2xl font-semibold">Document Centre</h1>
        <p className="mt-3 text-[var(--text-secondary)]">
          We could not load your documents just now. Nothing has been lost —
          this is a problem reaching our server, not with your vault.
        </p>
        <button
          type="button"
          onClick={() => {
            setGate('loading');
            void readGate();
          }}
          className="mt-4 rounded-[6px] px-4 py-2 text-sm"
          style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
        >
          Try again
        </button>
      </main>
    );
  }

  // ⚠️ TWO COUNTS, NOT ONE. This was a single `!r.confirmed` filter under a
  // heading that said "still need their dates checked", so a member who had
  // just uploaded nine photographs of a gun safe was told nine documents
  // needed a date — nine errands that do not exist. A row the member has
  // ticked "Never expires" on has no date outstanding; what is still worth a
  // look on it is whether we filed it as the right type.
  /**
   * ⚠️ AND A ROW WE DATED OURSELVES IS NOT AN ERRAND. `!r.confirmed` was the
   * whole test, from when nothing could settle a date except the member.
   * Now the Centre fills dates in and arms the reminder — operator,
   * 2026-08-25: "insert it. No further user interaction required" — so a
   * counter that still keys on `confirmed` would put every automatically
   * dated licence back on the to-do list it was just taken off, which is the
   * exact nagging this change exists to stop.
   *
   * The date is still theirs to change; it is simply no longer a task.
   *
   * ⚠️ AND THE FILING COUNT NO LONGER KEYS ON THE DATE ALONE. Every row
   * carries TWO guesses — what the document is, and when it runs out — and
   * only the second was being read here. A licence we filed with low
   * confidence but dated cleanly off the page appeared nowhere: not in this
   * banner, not in the hand-off queue, and with nothing on its row admitting
   * we had guessed. See needsFilingCheck in lib/document-review-rules.ts,
   * where both halves live and are tested.
   */
  const needDate = (rows ?? []).filter(needsDateCheck);
  const needFiling = (rows ?? []).filter(needsFilingCheck);

  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-8">
      <Breadcrumbs trail={LICENCE_CENTRE_TRAIL} className="mb-6" />
      <h1 className="text-2xl font-semibold">Document Centre</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        Keep your licences, certificates and supporting paperwork in one place,
        and we will tell you when a renewal is coming up. Some of it — an ID
        copy, photographs of your safe — carries no expiry date at all, and we
        simply keep it. It is all encrypted on our own server and nobody at All
        Outdoor can read it.
      </p>

      {(needDate.length > 0 || needFiling.length > 0) && (
        <div className="mt-4 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3 text-sm">
          {needDate.length > 0 && (
            <>
              <p className="font-medium">
                {needDate.length === 1
                  ? 'One document still needs its date checked'
                  : `${needDate.length} documents still need their dates checked`}
              </p>
              <p className="mt-1 text-[var(--text-secondary)]">
                We read the date off the photograph, but nothing is scheduled
                until you have confirmed it is right.
              </p>
            </>
          )}
          {needFiling.length > 0 && (
            <p
              className={
                needDate.length > 0
                  ? 'mt-2 text-[var(--text-secondary)]'
                  : 'font-medium'
              }
            >
              {/* ⚠️ NOT "kept on file with no expiry date" ANY MORE. This
                  list now also holds documents we filed WITHOUT BEING SURE
                  what they were, whatever date they carry — and telling
                  somebody their dated firearm licence has no expiry date
                  would be plainly false. The one thing true of every row
                  here is that the box it sits in is our guess. */}
              {/* Operator, 2026-09-07: "that doesn't even make sense as the
                  system filled in all of them." Everything is filed by us;
                  what sets these apart is that we were not sure of the type. */}
              {needFiling.length === 1
                ? 'We were not sure what type one document is. Open it and check it is in the right box.'
                : `We were not sure what type ${needFiling.length} documents are. Open each and check it is in the right box.`}
            </p>
          )}
        </div>
      )}

      {/*
        ── ONE SCROLL, AND A PANEL ────────────────────────────────────

        Chips, search, then every section stacked in a fixed order. The detail
        column stays exactly where it was on desktop and below the list on a
        phone, which is also the order somebody works in — find the document,
        act on it.

        ⚠️ THE DETAIL COLUMN RENDERS THE EXISTING CredentialCard UNCHANGED. It
        already owns date confirmation, the renewal hand-off, refiling and
        delete, and every one of those has a comment above it explaining a bug
        it fixed. Re-implementing that anatomy to fit a narrower column would
        have re-opened all of them.
      */}
      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_368px] lg:items-start lg:gap-6">

        <section className="min-w-0">
          {/* ── the attention chips ────────────────────────────────
              ⚠️ TAPPABLE, WHICH IS THE WHOLE DIFFERENCE FROM THE TILES THEY
              REPLACE. Three counts sat above this list doing nothing when
              tapped; the member could see that one licence needed renewing
              and still had to find it by eye. Multi-select, and several
              selected is a UNION — see rowMatchesChips. */}
          {rows !== null && rows.length > 0 && (
            <div
              role="group"
              aria-label="Filter documents"
              className="flex flex-wrap items-center gap-2"
            >
              <Chip
                label={
                  counts.renewals === 1
                    ? '1 renewal due'
                    : counts.renewals + ' renewals due'
                }
                on={chips.includes('renewals')}
                /* ⚠️ AMBER ONLY ABOVE ZERO. A chip reading "0 renewals due"
                   in the same amber as one reading "3" tells a member
                   something is wrong when nothing is. */
                warn={counts.renewals > 0}
                onToggle={() => toggleChip('renewals')}
              />
              <Chip
                label={
                  counts.dates === 1
                    ? '1 date to check'
                    : counts.dates + ' dates to check'
                }
                on={chips.includes('dates')}
                onToggle={() => toggleChip('dates')}
              />
              <Chip
                label={'In a motivation · ' + counts.motivations}
                on={chips.includes('motivations')}
                onToggle={() => toggleChip('motivations')}
              />
            </div>
          )}

          {/* ── search, and the way in ─────────────────────────────
              ⚠️ ONE FIELD, FULL WIDTH, NO MOBILE TOGGLE. The toggle existed
              because a fixed 216px box shared a flex row with a heading and
              two buttons and wrapped on a 390px screen. The heading and the
              folder name have gone with the rail, so the field simply fits.
              `query` and its matching are unchanged — except that it now
              searches the reading as well, so a calibre or a licence number
              finds the row. */}
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <label className="flex min-h-[44px] flex-1 items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] px-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, number or calibre"
                aria-label="Search documents"
                className="w-full bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
              />
            </label>

            <div ref={addRef} className="flex items-center gap-2">
              <AddPanel
                token={token}
                onAdded={refresh}
                preset={addPreset}
                /* ⚠️ null WHILE WE DO NOT KNOW. `rows === null` is "still
                   loading" and `maxCredentials === 0` is "status has not
                   answered" — neither may be allowed to render as a full
                   vault and lock the Add button on arrival. */
                remaining={
                  rows !== null && maxCredentials > 0
                    ? Math.max(0, maxCredentials - rows.length)
                    : null
                }
              />
            </div>
          </div>

          {loadFailed ? (
            <div className="mt-4 rounded-[8px] border border-[var(--border)] p-4 text-sm">
              <p>We could not load your documents just now.</p>
              <button
                type="button"
                className="mt-2 min-h-[44px] rounded-[6px] border border-[var(--border)] px-3 text-sm hover:bg-[var(--bg-card-hover)]"
                onClick={() => void refresh()}
              >
                Try again
              </button>
            </div>
          ) : rows === null ? (
            <p className="mt-4 text-sm text-[var(--text-tertiary-on-card)]">
              Loading…
            </p>
          ) : (
            <div className="mt-4">
              {rows.length === 0 && (
                <p className="text-sm text-[var(--text-tertiary-on-card)]">
                  Nothing here yet. Each section below says what belongs in it.
                </p>
              )}
              {views.map((v) => (
                <DocumentSection
                  key={v.section.id}
                  view={v}
                  open={isOpen(v.section.id)}
                  onToggle={() =>
                    toggleSection(v.section.id, !isOpen(v.section.id))
                  }
                  onAdd={
                    v.section.addKind
                      ? () => openAddFor(v.section.addKind as CredentialKind)
                      : null
                  }
                >
                  {/* ⚠️ THE SAFE IS A GRID AND ONE ROW, NOT FIVE ROWS.
                      Operator, 2026-08-23: "I dont like the safe picture being
                      seperate four uploads, looks shit." Four rows all called
                      "Photographs of my safe" say nothing a 4-across grid does
                      not say at a glance. */}
                  {v.photos.length > 0 && (
                    <ul className="grid grid-cols-4 gap-1.5 p-1.5">
                      {v.photos.map((n) => (
                        <li key={n.row.id}>
                          <button
                            type="button"
                            onClick={() => select(n.row.id)}
                            aria-current={
                              n.row.id === selectedId ? 'true' : undefined
                            }
                            aria-label={n.row.title || 'Photograph of your safe'}
                            className="block w-full rounded-[4px] p-0.5"
                            style={{
                              border:
                                '1px solid ' +
                                (n.row.id === selectedId
                                  ? 'var(--border-hover)'
                                  : 'transparent'),
                            }}
                          >
                            <DocThumb
                              token={token}
                              id={n.row.id}
                              mimeType={n.row.mimeType}
                              className="aspect-[4/3] w-full rounded-[4px]"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {v.groups.map((g) => (
                    <div key={g.key}>
                      {g.label && (
                        <p className="px-3 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                          {g.label} · {g.rows.length}
                        </p>
                      )}
                      <ul className="flex flex-col gap-0.5">
                        {g.rows.map((n) => (
                          <DocumentRow
                            key={n.row.id}
                            node={n}
                            section={v.section.id}
                            selectedId={selectedId}
                            onSelect={select}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </DocumentSection>
              ))}
            </div>
          )}
          {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}
        </section>

        {/* ── the selected document ───────────────────────────── */}
        <aside
          ref={detailRef}
          aria-label="Document details"
          className="mt-6 min-w-0 lg:mt-0 lg:sticky lg:top-4"
        >
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            Details
          </h2>
          {loadFailed ? (
            /* ⚠️ NOT A STALE CARD. `refresh` sets loadFailed WITHOUT clearing
               `rows`, so without this the detail column would keep offering
               Delete and Turn-reminders-off on a copy of a document the page
               has just failed to re-read — acting on state it knows is
               untrustworthy. The old grouped list could not do this: its
               loadFailed branch replaced every card. */
            <p className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-tertiary-on-card)]">
              We could not re-read your documents just now, so this panel is
              paused. Try again above.
            </p>
          ) : selected ? (
            /* A <ul>, because CredentialCard is an <li> — it was written to sit
               in the old grouped list and there is no reason to change that.
               A paired proficiency wraps the card in one container with a
               switch between its two pages. */
            <div
              className={
                partner
                  ? 'rounded-[14px] border border-[var(--border)] bg-[var(--bg-inset)] p-2'
                  : undefined
              }
            >
              {partner && (
                <div
                  role="tablist"
                  aria-label="Pages of this proficiency"
                  className="mb-2 grid grid-cols-2 gap-1 rounded-[10px] bg-[var(--bg-card)] p-1 text-[12.5px] font-medium"
                >
                  {[selected, partner].map((r) => {
                    const on = (showPartner ? partner : selected).id === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => setShowPartner(r.id === partner.id)}
                        className="rounded-[8px] px-3 py-2 text-center"
                        style={{
                          background: on ? 'var(--bg-inset)' : 'transparent',
                          color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                          border: `1px solid ${on ? 'var(--border)' : 'transparent'}`,
                        }}
                      >
                        {pageLabel(r)}
                      </button>
                    );
                  })}
                </div>
              )}
              <ul>
                {(() => {
                  const shown = showPartner && partner ? partner : selected;
                  return (
                    <CredentialCard
                      key={shown.id}
                      row={shown}
                      usedIn={usage[shown.id] ?? []}
                      token={token}
                      onChanged={refresh}
                      onError={setError}
                    />
                  );
                })()}
              </ul>
            </div>
          ) : (
            <p className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-tertiary-on-card)]">
              {visible.length > 0
                ? 'Pick a document to see its dates, what else it counts as, and what you can do with it.'
                : 'Nothing to show yet.'}
            </p>
          )}
        </aside>

      </div>

      {/* Applications, retrievable from the same place the member keeps
          everything else.

          ⚠️ A LINK NOW, NOT A PANEL. LicenceCentreMotivations listed the
          member's motivations inline and deep-linked each one into whichever
          of the two wizards a build flag selected. Both wizards were deleted
          on 2026-09-08 and the flag with them; there is one review sheet, and
          it has its own list at /licence-centre/applications.

          ⚠️ AND THE DOCUMENT CENTRE KEEPS THIS ROUTE. `/licence-centre` and
          `/documents` are two doors to THIS page — reminder emails and
          notification-module.ts still deep-link the first — which is why the
          applications list took a child path rather than the index. */}
      <Link
        href="/licence-centre/applications"
        className="mt-8 flex min-h-[44px] items-center justify-between gap-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-[14px] font-medium text-[var(--text-primary)] no-underline"
      >
        Your licence applications
        <span aria-hidden="true" className="text-[var(--red)]">
          &rarr;
        </span>
      </Link>

      <p className="mt-8 text-xs text-[var(--text-tertiary-on-card)]">
        We send reminders as a courtesy. Renewing on time remains your
        responsibility, and the document as printed always governs — if a date
        here does not match your document, change it here.
      </p>
    </main>
  );
}

// ── adding one ──────────────────────────────────────────────────────

function AddPanel({
  token,
  onAdded,
  remaining,
  preset,
}: {
  token: () => Promise<string | null>;
  onAdded: () => Promise<void>;
  /** A section's Add link opening the controls on its own kind. */
  preset: { kind: CredentialKind; at: number } | null;
  /**
   * Room left in the vault, or null while we do not know.
   *
   * Only spoken about near the end — see the note where it is rendered. A
   * counter over an empty vault is a limit nobody was going to reach.
   */
  remaining: number | null;
}) {
  /**
   * What the member says this is — or AUTO, which is the default.
   *
   * ⚠️ EMPTY MEANS "WORK IT OUT". The classifier and the date reader have
   * both been here since the vault was built, and neither ever ran for a
   * single upload: the picker defaulted to FIREARM_LICENCE, the type went up
   * with the file, and the server skips classification whenever it is told
   * what something is. So the member picked the type by hand, every time,
   * while a model that could have read it off the page sat unused two lines
   * away. Now nothing is sent unless they deliberately override.
   */
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /**
   * The documents still to be checked, in order.
   *
   * A QUEUE, not one record: a member with a folder of eight uploads them all
   * and then walks the confirm step once per document. The confirm step is not
   * batched away — an unconfirmed date is invisible to the reminder sweep,
   * which is the entire point of the Centre.
   */
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  /**
   * Files that never became documents, carried into the review beside the
   * ones that did.
   *
   * ⚠️ THEY USED TO BE A JOINED STRING. `failed.join(' · ')` in one red line
   * beside the buttons — which is unreadable at three files and actively
   * misleading at eleven, where an unconfigured secret produces eleven
   * identical sentences. As rows they say which file, why, and whether trying
   * again could possibly help.
   */
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  /**
   * The type the member declared for the last batch, so "Try again" on a row
   * repeats what they actually asked for rather than quietly falling back to
   * "work it out for me".
   */
  const lastDeclared = useRef<CredentialKind | ''>('');
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  /** Spoken about inside the last three, and enforced at nought. */
  const nearCap = remaining !== null && remaining <= 3;
  const full = remaining === 0;


  /**
   * THE UPLOAD PATH, lifted out of the file input.
   *
   * It is a named function rather than an inline handler so that anything
   * able to produce a File feeds one code path — today the themed picker,
   * and next the camera.
   */
  /**
   * Walk a phone-scanned document through the same confirm step a desktop
   * upload gets.
   *
   * ⚠️ THIS WAS THE "RECOGNITION IS BROKEN" REPORT, three documents running.
   * Every one of them read perfectly — kind, dates, serials, the lot — and
   * the member never saw any of it, because the reveal screen was only ever
   * fed by the desktop's own upload path. A phone upload refreshed the list,
   * added one quiet row with a small "Check the date" button, and showed
   * nothing it had read. Recognition that never shows its work is
   * indistinguishable from recognition that does not work, and he reported
   * exactly that, accurately, three times.
   *
   * Every unconfirmed document is queued, not only the newest: the queue IS
   * the "these still need checking" flow, and the banner that merely counted
   * them never walked anybody anywhere.
   */
  async function queueHandoffArrivals() {
    await onAdded().catch(() => undefined);
    try {
      const rows = await licenceCentreApi.list(token);
      // ⚠️ EVERY UNCONFIRMED ROW, THE DATELESS ONES INCLUDED — and the count
      // this queue prints is deliberately "to check", never "dates to check".
      // A safe photograph has no date to confirm, but it does have a type we
      // guessed at from the picture, and dropping it here would leave that
      // guess standing with nothing on the page ever asking about it. The
      // banner counts differently, because the banner says "dates".
      // Settled by us counts as settled: see needsDateCheck.
      //
      // ⚠️ AND A ROW WE FILED WITHOUT BEING SURE COMES BACK EVEN WHEN ITS
      // DATE IS SETTLED. This filter keyed on the date alone, so a document
      // whose expiry we read cleanly but whose TYPE we guessed at with low
      // confidence never reached the one screen that asks a human about the
      // type. `needsReview` is the union of both halves; both are tested.
      const need = rows.filter(needsReview);
      if (!need.length) return;
      // ⚠️ MERGE, NEVER ASSIGN. This was the last wholesale replace on the
      // page — see mergeReviewQueue for the six licences it cost. A phone
      // hand-off can land while a desktop upload's review is still open.
      setQueue((q) =>
        mergeReviewQueue(q, need.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          mimeType: r.mimeType,
          // ⚠️ READ OFF THE ROW NOW, NOT ASSUMED. This said `autoFiled: true,
          // confident: false` for every unconfirmed document, because neither
          // value was stored anywhere and there was nothing better to go on.
          // That is the bug the review screen could not survive: a refresh
          // flattened nine documents we were sure about into the same amber
          // "check this" as the three we were not, and the three that actually
          // needed a human became invisible among them.
          autoFiled: r.autoFiled,
          confident: r.namedConfident,
          // WHY it wants a look, not just THAT it does. Stored on the row,
          // so it survives the refresh that used to flatten every
          // unconfirmed document into the same amber.
          readUncertain: r.readUncertain,
          readNotes: r.readNotes,
          attention: r.attention,
          // ⚠️ CARRIED THROUGH, NOT DEFAULTED. A safe photograph arrives with
          // "Never expires" already ticked by the server, and a confirm step
          // that started it unticked would show a disabled-looking form
          // demanding a date off a photograph — and would post the tick back
          // off again if the member pressed the button.
          neverExpires: r.neverExpires,
          issuedOnUnknown: r.issuedOnUnknown,
          proposed: {
            expiresOn: r.expiresOn,
            issuedOn: r.issuedOn,
            details: r.details,
            lowConfidence: [],
            derivedExpiry: r.derivedExpiry,
          },
        }))),
      );
    } catch {
      // The refresh above already ran; worst case the member is where they
      // were before this existed — row in the list, button on the row.
    }
  }

  /**
   * Upload a batch and add it to the review.
   *
   * ⚠️ IT ALWAYS MERGES. IT USED TO REPLACE, AND THAT LOST DOCUMENTS.
   *
   * There was a `merge` flag, false by default, and on the false path the two
   * setters below assigned WHOLESALE: `setQueue(added)` and
   * `setRejected(failed)`. It was added for the retry button — "try again on
   * one failed file threw away the batch" — and the fresh-pick path was left
   * replacing, on the reasoning that a new pick starts a new review.
   *
   * That reasoning is wrong, because the Document Centre hands off ONE
   * DOCUMENT AT A TIME: the panel closes after each hand-off (see
   * DocumentCentreAdd.handOff), so adding six licences is six separate calls
   * to this function — and each one wiped the five before it out of the
   * review. Operator, 2026-08-25: "took scans of 6 licenses. 2 made it
   * through."
   *
   * The documents themselves were never lost — every one of them uploaded and
   * is on the server. What they lost was their place in the review, which is
   * the only screen that asks a human to confirm the type and the dates. So
   * they sat unconfirmed and unfiled, which for an expiry reminder is the same
   * as not being there.
   *
   * There is no case where discarding an unconfirmed row is right: the queue
   * holds only documents still waiting to be checked, and the phone hand-off
   * path (queueHandoffArrivals) already rebuilds it from EVERY unconfirmed row
   * for exactly this reason. So this merges, always, and de-duplicates by id —
   * the hand-off refresh and this function can legitimately name the same row.
   */
  async function uploadFiles(
    picked: File[],
    declared: CredentialKind | '' = '',
  ) {
    if (!picked.length) return;

    // Checked HERE as well as on the server, so the answer is
    // immediate and NAMES the file. The server's rejection is a
    // generic 400 by the time it reaches the browser — and one
    // unusable file must not cost the whole pack a round trip.
    const failed: RejectedFile[] = [];
    const files = picked.filter((f) => {
      // ⚠️ NO `file` ON EITHER OF THESE. A pre-flight refusal is about the
      // file itself, so trying again produces the identical refusal — and a
      // button whose only outcome is the same error reads as the site being
      // broken rather than the file being wrong. See RejectedFile.
      if (!ACCEPTED.includes(f.type)) {
        failed.push({
          key: nextRejectKey(),
          name: f.name,
          reason: `We cannot read ${f.type || 'that file type'}. Use a JPG, PNG, WebP or PDF — on an iPhone, pick it from your photo library rather than from Files.`,
        });
        return false;
      }
      if (f.size > 10 * 1024 * 1024) {
        failed.push({
          key: nextRejectKey(),
          name: f.name,
          reason: `${(f.size / 1024 / 1024).toFixed(1)} MB — over the 10 MB limit. Take it again a little further back.`,
        });
        return false;
      }
      return true;
    });

    if (!files.length) {
      // Nothing was added, so there is nothing to review: the message beside
      // the buttons is the whole answer.
      setErr(failed.map((f) => `${f.name}: ${f.reason}`).join(' '));
      return;
    }
    lastDeclared.current = declared;

    setBusy(true);
    setErr(null);
    setProgress({ done: 0, total: files.length });

    // ONE AT A TIME. Each upload writes an encrypted file and makes a
    // vision call; firing eight at once would race the per-minute
    // limit and give no usable progress.
    const added: ReviewItem[] = [];
    for (const [i, file] of files.entries()) {
      try {
        // ONE file keeps the type the member picked. SEVERAL is a
        // folder, so each is named from its contents and checked in
        // the queue.
        // ⚠️ THE TYPE IS SENT ONLY AS AN OVERRIDE. Blank means the server
        // classifies with Haiku and reads the dates off the page, and the
        // confirm step then shows what it made of it. A folder was always
        // handled this way; there was never a reason one file should not be.
        // ⚠️ THE DECLARED TYPE NOW APPLIES TO THE WHOLE BATCH, where it
        // used to apply only when exactly one file was picked. That rule
        // existed because a folder was assumed to be MIXED, so classifying
        // per file beat forcing one type onto all of them. The member is now
        // asked what they are adding BEFORE the picker opens, so a batch is a
        // declared batch — eight photographs of one safe are eight
        // photographs of one safe, and making the classifier re-derive that
        // eight times was the old behaviour's real cost. Blank still means
        // "work it out for me", which is still the default.
        const r = await licenceCentreApi.create(token, declared, '', file);
        added.push({
          id: r.id,
          kind: r.kind,
          title: r.title,
          // The server tells us; the File in hand is the backstop.
          mimeType: r.mimeType ?? file.type,
          autoFiled: r.autoFiled === true,
          confident: r.confident === true,
          readUncertain: r.proposed?.lowConfidence ?? [],
          readNotes: r.readNotes ?? [],
          attention: r.attention ?? [],
          neverExpires: r.neverExpires === true,
          issuedOnUnknown: r.issuedOnUnknown === true,
          proposed: r.proposed,
        });
      } catch (ex) {
        // One bad file must not abandon the rest of the pack — and THIS one
        // keeps its File, because a failure here is a dropped connection or a
        // server that was busy, and trying again is exactly right.
        failed.push({
          key: nextRejectKey(),
          name: file.name,
          reason:
            ex instanceof LicenceApiError ? ex.message : 'It did not upload.',
          file,
        });
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setBusy(false);
    setProgress(null);
    // ⚠️ CLEARED, NOT SET. The failures are rows in the review now; leaving
    // them in the toolbar line as well would say the same thing twice, in the
    // one place that cannot say which file.
    setErr(null);
    setQueue((q) => mergeReviewQueue(q, added));
    setRejected((prev) => [...prev, ...failed]);
    // ⚠️ THE UPLOAD RESPONSE CARRIES THE TICKS ITSELF NOW. It used to
    // return the proposal and stop, while the same call had already
    // stamped `neverExpires: true` on a photograph of a safe — so the batch
    // was re-read after every upload to learn something the server had just
    // decided. Taking the response at face value was the fix; the round trip
    // was the workaround. (The second, replacing setQueue(added) that used to
    // sit here is gone — see the note at the top of this function.)
    // Always, not only on failure: a row may have been committed and
    // its response lost — the vision read runs after the insert and
    // can outlast the proxy's patience. Without this the document is
    // invisible AND a retry is refused as a duplicate, which
    // contradicts the error we just showed.
    await onAdded().catch(() => undefined);
  }

  // ── TWO BUTTONS, AND THE TYPE ASKED FIRST ────────────────────────────
  //
  // Operator, 2026-08-24: "replace the Add button with two buttons, Upload and
  // Scan with phone (Use Icons). If either button is clicked open a dropdown
  // menu for the user to select which document they are going to provide so it
  // can be correctly OCR’d and placed in the correct box."
  //
  // ⚠️ THE PROSE THAT USED TO SIT HERE IS GONE, AND ONE PARAGRAPH OF IT HAD
  // TO SURVIVE. Four explained the file types, the 10 MB cap, the iPhone HEIC
  // trap and the three safe photographs a DFO wants. A header row cannot carry
  // them and a tooltip nobody opens is not carrying them either, so the ones
  // that prevent a failed upload are raised at the point of failure instead:
  // the per-file rejection in uploadFiles already NAMES the file and says why.
  //
  // ⚠️ THE SAFE-PHOTOGRAPH PARAGRAPH IS NOT ONE OF THOSE. It changes which
  // photographs get TAKEN, so it has to arrive before the camera does — it
  // lives in GUIDANCE in document-centre-add.tsx and shows on the step between
  // choosing "Photographs of my safe" and opening the picker. An earlier draft
  // of this comment claimed it had moved to the confirm step; it had been
  // deleted outright, which is the regression the 2026-08-23 comment on the
  // collapsed menu entry explicitly forbade.
  //
  // ⚠️ UPLOAD IS THE SOLID BUTTON AND SCAN IS THE OUTLINED ONE, which
  // demotes a control an earlier comment called a peer ("the camera and the
  // picker are peers, not a primary and a fallback"). That reasoning was about
  // a licence CARD, where a photograph beats a scan. It still holds on a
  // phone. On the desktop this page is mostly used from, "scan" means a QR
  // hand-off to a phone — a genuinely longer road — and the file already on
  // the machine is the shorter one. Both are one tap either way.
  return (
    <>
      {(queue.length > 0 || rejected.length > 0) && (
        <ReviewScreen
          token={token}
          items={queue}
          rejected={rejected}
          onFinish={() => {
            setQueue([]);
            setRejected([]);
          }}
          uploading={busy}
          onRetry={(r) => {
            if (!r.file) return;
            // Dropped BY KEY, not by name: two folders can hand us two files
            // called scan.jpg, and only one of them is being retried.
            setRejected((prev) => prev.filter((x) => x.key !== r.key));
            void uploadFiles([r.file], lastDeclared.current);
          }}
          onChanged={onAdded}
        />
      )}
      <div className="flex items-center gap-2">
      <DocumentCentreAdd
        groups={KIND_GROUPS}
        /* At the cap the two buttons are dead, because every path behind
           them ends in the same refusal. The sentence beside them says so
           in words, before a file is chosen rather than after one is lost. */
        busy={busy || full}
        onFiles={(files, declared) => void uploadFiles(files, declared)}
        onHandoffArrived={() => void queueHandoffArrivals()}
        preset={preset}
      />
      {/* ⚠️ ONLY NEAR THE END, AND NEVER OVER AN EMPTY VAULT. A running
          "4 of 60" beside the Add button is a limit announced to people who
          will never meet it. Inside the last three it becomes useful — it is
          the difference between choosing which licences to add and finding
          out mid-batch that the sixth was refused. */}
      {nearCap && (
        <span className="text-xs text-[var(--text-secondary)]">
          {full
            ? 'Your vault is full. Delete a document to add another.'
            : remaining === 1
              ? 'Room for one more document.'
              : `Room for ${remaining} more documents.`}
        </span>
      )}
      {err && <span className="text-xs text-[var(--red)]">{err}</span>}
      </div>

      {/* \u26a0\ufe0f A BAR, NOT A 12px LINE OF GREY TEXT.
          Each document is uploaded, encrypted and then READ by a vision call
          before the next one starts, so a pack of six is a genuine wait \u2014
          tens of seconds \u2014 and the only thing on screen saying so was
          "Reading 3 of 6\u2026" in tertiary grey beside the buttons. Operator,
          2026-08-25: "I would rather have them be automatically sent one by
          one with a progress bar so the user knows he must wait."

          It fills per DOCUMENT, not per byte, because that is the unit the
          member counts in and the only one we can honestly report: the upload
          finishing tells us nothing about the read that follows it.
          Single-file uploads get the same bar at 0 \u2192 100 rather than a
          special case; one bar that always means the same thing beats two
          states that mean nearly the same thing. */}
      {busy && (
        <div
          className="mt-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-[var(--text-primary)]">
              {progress && progress.total > 1
                ? `Reading document ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                : 'Reading your document'}
            </span>
            <span className="gg-nums text-[11.5px] text-[var(--text-tertiary-on-card)]">
              {progress ? `${progress.done} of ${progress.total} done` : ''}
            </span>
          </div>

          <div
            className="mt-2 h-[6px] w-full overflow-hidden rounded-[99px] bg-[var(--bg-inset)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress?.total ?? 1}
            aria-valuenow={progress?.done ?? 0}
            aria-label="Documents read"
          >
            <div
              className="h-full rounded-[99px] bg-[var(--red)]"
              style={{
                width: progress
                  ? `${Math.round((progress.done / progress.total) * 100)}%`
                  : '8%',
                transition: 'width 240ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>

          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--text-tertiary-on-card)]">
            Each one is read as it arrives, so this takes a moment. You can
            leave this page open &mdash; nothing is lost if you wait.
          </p>
        </div>
      )}
    </>
  );
}

// ── one filter chip ──────────────────────────

/**
 * One of the three counts above the list, made tappable.
 *
 * ⚠️ `aria-pressed`, NOT `aria-current` OR A CHECKBOX. It is a toggle
 * button that stays where it is and changes what is below it, which is
 * exactly what aria-pressed describes; aria-current would claim it is a
 * location, and a checkbox would promise a form.
 *
 * ⚠️ AND THE WARN TONE IS A TINT PLUS INK FROM THE SAME TOKEN. Never
 * `var(--warning)18` — a custom property concatenated with an alpha suffix
 * expands to two tokens, the declaration dies at computed-value time and the
 * property silently takes its INITIAL value. Forty-four sites did this before
 * the 2026-08-27 sweep.
 */
function Chip({
  label,
  on,
  warn = false,
  onToggle,
}: {
  label: string;
  on: boolean;
  warn?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className="min-h-[44px] rounded-[6px] px-3 text-[12.5px] font-medium"
      style={{
        color: warn ? 'var(--warning)' : 'var(--text-secondary)',
        background: on
          ? 'var(--bg-inset)'
          : warn
            ? 'color-mix(in srgb, var(--warning) 10%, transparent)'
            : 'var(--bg-card)',
        border: `1px solid ${
          on
            ? 'var(--text-secondary)'
            : warn
              ? 'color-mix(in srgb, var(--warning) 38%, transparent)'
              : 'var(--border)'
        }`,
        outlineOffset: 2,
      }}
    >
      {label}
    </button>
  );
}
