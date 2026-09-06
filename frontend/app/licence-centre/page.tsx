'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LicenceCentreMotivations from '@/components/licence-centre-motivations';
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
  filedUnsure,
  mergeReviewQueue,
  needsDateCheck,
  needsFilingCheck,
  needsReview,
} from '@/lib/document-review-rules';
import {
  CredentialKind,
  CredentialRow,
  CredentialUsage,
  KIND_LABELS,
  LicenceApiError,
  STATE_TONE,
  formatDate,
  licenceCentreApi,
} from '@/lib/licence-centre-api';

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
import { FullName } from '@/components/full-name';

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

  const [enabled, setEnabled] = useState<boolean | null>(null);
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

  // ── FOLDERS, FILES, DETAIL ─────────────────────────────────────
  //
  // Operator, 2026-08-24: "Folder on the left with the files in each on the
  // right." null = the All documents folder, otherwise an index into FOLDERS.
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The detail column, so a phone can be scrolled to it on selection. */
  const detailRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  /**
   * ⚠️ THE SEARCH BOX ITSELF IS THE THING THAT DID NOT FIT. A fixed 216px
   * field, a title and two labelled buttons were one `flex flex-wrap` row
   * with no mobile variant, so a 390px screen wrapped them onto extra lines.
   * Below `md` the box collapses behind this toggle instead; `query` and
   * `setQuery` above are unchanged, so nothing about what search DOES moves.
   */
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  /**
   * Which applications each document is already in.
   *
   * ⚠️ ITS OWN STATE, NOT PART OF `rows`. It is a second request that is
   * allowed to fail, and folding it into the list would make a document's
   * dates depend on whether its usage loaded.
   */
  const [usage, setUsage] = useState<Record<string, CredentialUsage[]>>({});

  /**
   * The folders, and every row placed in exactly one of them.
   *
   * ⚠️ A ROW WHOSE KIND IS IN NO GROUP STILL HAS TO APPEAR. KIND_GROUPS lists
   * the kinds the ADD menu offers; the retired ones (the four association
   * kinds, the three separate safe photographs) are in none of them, and a
   * member holding one would otherwise be unable to see their own document.
   * The old flat list had a comment making exactly this point about KINDS —
   * the folders inherit the same duty. Anything unplaced falls into the last
   * folder, which is "Anything else".
   */
  /** Licences close enough to their expiry that the page says so. */
  const attention = useMemo(
    () =>
      (rows ?? []).filter((r) => r.state === 'expiring' || r.state === 'expired')
        .length,
    [rows],
  );

  /**
   * How many documents already sit inside a motivation.
   *
   * ⚠️ BUILT FROM `usage`, WHICH THE PAGE ALREADY FETCHES — see the note on
   * that state above. Nothing new is requested for this count; a document
   * with no entry in `usage` (the fetch has not resolved, or it failed) reads
   * as not-yet-used, the same as every other reader of this state on the
   * page, rather than as a fact we are certain of.
   */
  const inUseCount = useMemo(
    () => (rows ?? []).filter((r) => (usage[r.id]?.length ?? 0) > 0).length,
    [rows, usage],
  );

  const folders = useMemo(() => {
    const all = rows ?? [];
    const placed = KIND_GROUPS.map((g) => ({
      label: g.label,
      rows: all.filter((r) => g.kinds.includes(r.kind)),
    }));
    const known = new Set(KIND_GROUPS.flatMap((g) => g.kinds));
    const orphans = all.filter((r) => !known.has(r.kind));
    if (orphans.length > 0 && placed.length > 0) {
      const last = placed[placed.length - 1];
      last.rows = [...last.rows, ...orphans];
    }
    return placed;
  }, [rows]);

  const visible = useMemo(() => {
    const inFolder =
      openGroup === null ? (rows ?? []) : (folders[openGroup]?.rows ?? []);
    const q = query.trim().toLowerCase();
    if (!q) return inFolder;
    // Title AND type, because half of these are named off the document
    // ("Howa 6.5 Creedmoor") and half are looked for by what they ARE
    // ("competency"). Matching only one of the two finds neither reliably.
    return inFolder.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (KIND_LABELS[r.kind] ?? '').toLowerCase().includes(q),
    );
  }, [openGroup, rows, folders, query]);

  /**
   * What the folder heading says under its name.
   *
   * Counted off the SAME rows the list is showing, so a search that hides the
   * one expiring licence does not leave "1 needs renewing" hanging over a
   * result set that no longer contains it.
   */
  const needsRenewing = useMemo(
    () => visible.filter((r) => r.state === 'expiring' || r.state === 'expired')
      .length,
    [visible],
  );

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await licenceCentreApi.status(token);
        if (!alive) return;
        setEnabled(s.enabled);
        setMaxCredentials(s.maxCredentials);
        // With the flag off every other endpoint 404s, so do not call them.
        if (s.enabled) await refresh();
      } catch {
        if (alive) setEnabled(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, refresh]);

  if (enabled === false) {
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
              {needFiling.length === 1
                ? 'One document was filed by us rather than by you. Check that we have put it in the right box.'
                : `${needFiling.length} documents were filed by us rather than by you. Check that we have put them in the right boxes.`}
            </p>
          )}
        </div>
      )}

      {/*
        ── THE THREE COLUMNS ──────────────────────────────────────────

        Folders, that folder’s files, and the selected file’s detail. Below
        `lg` they stack in that order, which is also the order somebody works
        in — pick a folder, pick a document, act on it.

        ⚠️ THE DETAIL COLUMN RENDERS THE EXISTING CredentialCard UNCHANGED. It
        already owns date confirmation, the renewal hand-off, refiling and
        delete, and every one of those has a comment above it explaining a bug
        it fixed. Re-implementing that anatomy to fit a narrower column would
        have re-opened all of them.
      */}
      <div className="mt-8 lg:grid lg:grid-cols-[228px_minmax(0,1fr)_368px] lg:items-start lg:gap-6">

        {/* ── folders ──────────────────────────────────────── */}
        <nav aria-label="Folders" className="lg:sticky lg:top-4">
          <FolderRow
            label="All documents"
            count={rows?.length ?? 0}
            selected={openGroup === null}
            onSelect={() => setOpenGroup(null)}
          />
          {folders.map((f, i) => (
            <div key={f.label}>
              <FolderRow
                label={f.label}
                count={f.rows.length}
                selected={openGroup === i}
                onSelect={() => setOpenGroup(i)}
              />
              {/* The kinds inside the open folder — a count per type, so the
                  shape of what you hold is readable without opening anything. */}
              {openGroup === i && f.rows.length > 0 && (
                <ul className="mb-1 ml-6 flex flex-col gap-px pb-1">
                  {[...new Set(f.rows.map((r) => r.kind))].map((k) => (
                    <li
                      key={k}
                      className="flex items-center gap-2 rounded-[6px] px-3 py-1.5"
                    >
                      <span
                        aria-hidden
                        className="h-1 w-1 shrink-0 rounded-full"
                        style={{ background: 'var(--border-hover)' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                        {KIND_LABELS[k] ?? k}
                      </span>
                      <span className="gg-nums text-[11px] text-[var(--text-tertiary)]">
                        {f.rows.filter((r) => r.kind === k).length}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {/* ── what is actually outstanding ──────────────────────────
              The reference this was drawn from puts a storage meter here.
              Nothing on this page has a size worth watching; what goes wrong
              with these documents is that they lapse, or that nobody has ever
              confirmed the date we read off them. */}
          {rows !== null && (needDate.length > 0 || attention > 0) && (
            <div className="mt-5 border-t border-[var(--border-divider)] pt-4">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Needs attention
              </p>
              <div className="flex flex-col gap-2">
                {attention > 0 && (
                  <span className="flex items-center gap-2 text-[12.5px] text-[var(--warning)]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7.5v5M12 16.4v.01" />
                    </svg>
                    {attention === 1 ? '1 renewal due' : `${attention} renewals due`}
                  </span>
                )}
                {needDate.length > 0 && (
                  <span className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.4M12 17.4v.01" />
                    </svg>
                    {needDate.length === 1
                      ? '1 date not confirmed'
                      : `${needDate.length} dates not confirmed`}
                  </span>
                )}
              </div>
            </div>
          )}
        </nav>

        {/* ── the files in that folder ──────────────────────────── */}
        <section className="mt-6 min-w-0 lg:mt-0">
          {/* ⚠️ THE TITLE STACKS ABOVE THE CONTROLS BELOW `md`, RATHER THAN
              WRAPPING INTO THEM. A folder name plus a document count is
              already two lines on a phone; sharing a row with a search box
              and two buttons was what produced the wrap this replaces. At
              `md` and up the two go back to sitting side by side — nothing
              about the desktop row changes. */}
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <div className="min-w-0 md:flex-1">
              <h2 className="text-lg font-semibold">
                {openGroup === null ? 'All documents' : folders[openGroup].label}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--text-tertiary-on-card)]">
                <span className="gg-nums">{visible.length}</span>{' '}
                {visible.length === 1 ? 'document' : 'documents'}
                {needsRenewing > 0 && (
                  <> · {needsRenewing} needs renewing</>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* ⚠️ ICON BELOW `md`, WHERE THE FIXED 216px BOX IS WHAT DID NOT
                  FIT. It toggles the full-width field below; `md:hidden` takes
                  it out entirely once the box beside it has room to sit inline. */}
              <button
                type="button"
                onClick={() => setMobileSearchOpen((v) => !v)}
                aria-expanded={mobileSearchOpen}
                aria-controls="doc-search-mobile"
                aria-label="Search documents"
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] md:hidden"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </button>

              <label className="hidden min-h-[38px] w-[216px] items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] px-3 md:flex">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search documents"
                  aria-label="Search documents"
                  className="w-full bg-transparent text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
                />
              </label>

              <AddPanel
                token={token}
                onAdded={refresh}
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

            {/* Same field as the one above — one `query` state, two markups —
                shown only below `md` and only once the icon has been tapped. */}
            {mobileSearchOpen && (
              <label
                id="doc-search-mobile"
                className="flex min-h-[38px] w-full items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] px-3 md:hidden"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search documents"
                  aria-label="Search documents"
                  className="w-full bg-transparent text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
                />
              </label>
            )}
          </div>

          {/* ── the three counts the board puts above the list ────────────
              ⚠️ ONLY WHEN THERE IS SOMETHING TO COUNT. Three tiles reading
              zero above an already-empty folder would repeat the empty state
              below in a louder voice. */}
          {rows !== null && rows.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <DocStat label="In the vault" value={rows.length} />
              <DocStat
                label={attention === 1 ? 'Renewal due' : 'Renewals due'}
                value={attention}
                warn
              />
              <DocStat
                label={inUseCount === 1 ? 'In a motivation' : 'In motivations'}
                value={inUseCount}
              />
            </div>
          )}

          {/* Column headings, because three of the four things on a row are
              different KINDS of fact and the middle one is a date. */}
          {rows !== null && visible.length > 0 && (
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_112px] gap-3 border-b border-[var(--border-divider)] px-3.5 pb-2 sm:grid-cols-[minmax(0,1fr)_108px_112px_124px]">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                Document
              </span>
              {/* The licence or competency number — a monospaced column so a
                  member can find the right document without opening each one.
                  See docNumber() below the row it feeds. */}
              <span className="hidden text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)] sm:block">
                Number
              </span>
              <span className="hidden text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)] sm:block">
                Expires
              </span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                State
              </span>
            </div>
          )}

          {loadFailed ? (
            <div className="mt-2 rounded-[10px] border border-[var(--border)] p-4 text-sm">
              <p>We could not load your documents just now.</p>
              <button
                type="button"
                className="mt-2 rounded-[6px] border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-card-hover)]"
                onClick={() => void refresh()}
              >
                Try again
              </button>
            </div>
          ) : rows === null ? (
            <p className="mt-2 text-sm text-[var(--text-tertiary-on-card)]">
              Loading…
            </p>
          ) : visible.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--text-tertiary-on-card)]">
              {rows.length === 0
                ? 'Nothing here yet. Add your first licence or competency certificate above.'
                : 'Nothing filed in this folder yet.'}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {visible.map((r) => (
                <li key={r.id}>
                  <DocRow
                    row={r}
                    selected={r.id === selectedId}
                    onSelect={() => {
                      setSelectedId(r.id);
                      // ⚠️ THE PAGE-LEVEL ERROR BELONGS TO THE DOCUMENT THAT
                      // RAISED IT. It is rendered once, under the list, so a
                      // failed delete on one document otherwise sits there
                      // accusing the next one the member opens.
                      setError(null);
                      // ⚠️ AND ON A PHONE THE DETAIL IS BELOW THE WHOLE LIST.
                      // The three columns stack under `lg`, so tapping a row
                      // changes something ~1000px further down the page and
                      // reads as nothing happening at all. Only on the stacked
                      // layout — on desktop the panel is already in view and
                      // scrolling would be a jolt for no reason.
                      if (
                        typeof window !== 'undefined' &&
                        window.matchMedia('(max-width: 1023px)').matches
                      ) {
                        detailRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        });
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
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
               in the old grouped list and there is no reason to change that. */
            <ul>
              <CredentialCard
                key={selected.id}
                row={selected}
                usedIn={usage[selected.id] ?? []}
                token={token}
                onChanged={refresh}
                onError={setError}
              />
            </ul>
          ) : (
            <p className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-tertiary-on-card)]">
              {visible.length > 0
                ? 'Pick a document to see its dates, what else it counts as, and what you can do with it.'
                : 'Nothing to show yet.'}
            </p>
          )}
        </aside>

      </div>

      {/* Motivations, retrievable from the same place the member keeps
          everything else. Its own section rather than a CredentialKind — see
          the module for why that distinction is load-bearing. Renders nothing
          at all when the module is off or the member has none. */}
      <LicenceCentreMotivations token={token} />

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
}: {
  token: () => Promise<string | null>;
  onAdded: () => Promise<void>;
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

// ── the folder rail ──────────────────────────────────────────────

function FolderRow({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left hover:bg-[var(--bg-card-hover)]"
      style={{
        background: selected ? 'var(--bg-card)' : 'transparent',
        border: `1px solid ${selected ? 'var(--border)' : 'transparent'}`,
        outlineOffset: 2,
      }}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke={selected ? 'var(--red)' : 'var(--text-tertiary)'}
        strokeWidth={selected ? 1.9 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="shrink-0"
      >
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
      <span
        className="min-w-0 flex-1 truncate text-[13.5px] font-semibold"
        style={{
          color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {label}
      </span>
      <span
        className="gg-nums shrink-0 text-xs"
        style={{
          color: selected ? 'var(--text-primary)' : 'var(--text-tertiary)',
          fontWeight: selected ? 600 : 400,
        }}
      >
        {count}
      </span>
    </button>
  );
}

// ── one number above the list ───────────────────────────────────

/**
 * How many documents, how many need a renewal, how many already sit inside a
 * motivation — the board's three tiles above the list.
 *
 * ⚠️ `warn` ONLY TINTS WHEN THE COUNT IS ABOVE ZERO. A tile reading "0
 * renewals due" in the same amber as one reading "3" would tell a member
 * something is wrong when nothing is — the colour is meant to carry urgency,
 * not to mark which tile this is.
 */
function DocStat({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  const tone = STATE_TONE.expiring;
  const lit = warn && value > 0;
  return (
    <div
      className="gg-tile rounded-[10px] border px-3.5 py-3"
      style={{
        borderColor: lit ? tone.line : 'var(--border)',
        background: lit ? tone.wash : 'var(--bg-card)',
      }}
    >
      <p
        className="gg-nums text-xl font-semibold"
        style={{ color: lit ? tone.colour : 'var(--text-primary)' }}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-[var(--text-tertiary-on-card)]">
        {label}
      </p>
    </div>
  );
}

// ── one row in the file list ────────────────────────────────────
//
// Presentational and deliberately thin: it names the document, says when it
// runs out and what state that puts it in, and nothing else. Everything you
// can DO to a document lives in the detail column, which is CredentialCard.

/**
 * The one key per kind that holds a licence or competency number, for the
 * monospaced column on the row.
 *
 * ⚠️ NOT "the first value in details". `details` is a flat bag, and one
 * document can carry several numbers that are not interchangeable — a
 * hunting association's letter alone holds a good-standing reference, a
 * membership number AND a dedicated status number (see WANTED in
 * licence-centre-extract.service.ts on the backend, which these keys mirror).
 * Reading the wrong one into this column would put the wrong reference in
 * front of a member who trusts the column enough not to open the document.
 *
 * ⚠️ AN ID COPY, A PROOF OF ADDRESS AND A SAFE PHOTOGRAPH HAVE NO ENTRY HERE
 * AT ALL, deliberately — none of them carries a licence or competency number.
 * An identity document's `id_number` is a different kind of number and does
 * not belong in a column about licences.
 */
const NUMBER_DETAIL_KEYS: Partial<Record<CredentialKind, string[]>> = {
  FIREARM_LICENCE: ['licence_number'],
  COMPETENCY_CERTIFICATE: ['competency_number'],
  DEDICATED_DISCIPLINE: [
    'status_number',
    'membership_number',
    'good_standing_number',
    'registration_number',
  ],
  DEDICATED_STATUS: ['status_number'],
  DEDICATED_HUNTER: ['status_number'],
  PROFESSIONAL_HUNTER: ['registration_number'],
  GOOD_STANDING: ['good_standing_number', 'membership_number', 'status_number'],
  PROFICIENCY: ['certificate_number'],
  OTHER: ['reference_number'],
};

/** Degrades to a dash — never a blank cell — when a document has no number. */
function docNumber(row: CredentialRow): string {
  for (const key of NUMBER_DETAIL_KEYS[row.kind] ?? []) {
    const v = row.details[key];
    if (v && v.trim()) return v.trim();
  }
  return '—';
}

function DocRow({
  row,
  selected,
  onSelect,
}: {
  row: CredentialRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = STATE_TONE[row.state];

  /**
   * What goes in the expires column.
   *
   * ⚠️ THREE OUTCOMES, NOT TWO. A document the member has ANSWERED "never
   * expires" for and one nobody has supplied a date for both have a null
   * expiry and are opposites — the first is settled, the second is
   * outstanding. That distinction is written up on CredentialRow and it is the
   * reason a member holding nine photographs of a safe was once told nine
   * documents needed their dates checked.
   */
  const expiry = row.neverExpires
    ? '\u2014'
    : row.expiresOn
      ? formatDate(row.expiresOn)
      : 'Not set';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className="grid w-full grid-cols-[minmax(0,1fr)_112px] items-center gap-3 rounded-[10px] px-3.5 py-3 text-left hover:bg-[var(--bg-card-hover)] sm:grid-cols-[minmax(0,1fr)_108px_112px_124px]"
      style={{
        background: selected ? 'var(--bg-card)' : 'transparent',
        border: `1px solid ${selected ? 'var(--border)' : 'transparent'}`,
        outlineOffset: 2,
      }}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--bg-inset)]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary-on-card)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        </span>
      <span className="min-w-0 flex-1">
        <FullName className="text-[13.5px] font-medium">
          {row.title || KIND_LABELS[row.kind] || row.kind}
        </FullName>
        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-tertiary-on-card)]">
          {KIND_LABELS[row.kind] ?? row.kind}
          {' \u00b7 added '}
          {formatDate(row.createdAt.slice(0, 10))}
        </span>
        {/* ⚠️ SAYING WE GUESSED, WHERE WE GUESSED. `namedConfident` was stored
            precisely so this survives a refresh, and it was read in the review
            queue and nowhere else — so a document we filed without being sure
            looked, on this list, exactly like one the member had filed
            themselves. A wrong box on a firearm licence is a renewal nothing
            will ever remind on. The row IS the way to change it: tapping it
            opens the card, which carries the type control. */}
        {filedUnsure(row) && !row.confirmed && (
          <span className="mt-1 block truncate text-[11px] font-semibold text-[var(--warning)]">
            Filed as {KIND_LABELS[row.kind] ?? row.kind} — not sure, tap to
            change
          </span>
        )}
      </span>
      </span>

      {/* The licence or competency number, monospaced so a column of them
          lines up — see docNumber() above for which key answers it per kind. */}
      <span className="hidden truncate font-mono text-xs text-[var(--text-secondary)] sm:block">
        {docNumber(row)}
      </span>

      <span className="gg-nums hidden text-xs text-[var(--text-secondary)] sm:block">
        {expiry}
      </span>

      {/* State carries a word, never only a colour — same rule the step rail
          follows, and the reason every one of these has a label. */}
      <span
        className="justify-self-start rounded-full px-2.5 py-1 text-[11px] font-semibold"
        style={{
          color: tone.colour,
          background: tone.wash,
          border: `1px solid ${tone.line}`,
        }}
      >
        {tone.label}
      </span>
    </button>
  );
}

