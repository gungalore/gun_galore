'use client';

import { useAuth } from '@clerk/nextjs';
import DateField from '@/components/date-field';
import { todayYmd, toIso } from '@/lib/date-picker-model';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LicenceCentreMotivations from '@/components/licence-centre-motivations';
import DocumentCentreAdd from '@/components/document-centre-add';
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
  expiryAnswer,
  mergeReviewQueue,
  needsALook,
  uncertaintyReason,
  refileNeedsPanel,
  settleableInBulk,
} from '@/lib/document-review-rules';
import {
  AddedCredential,
  CredentialKind,
  CredentialProposal,
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

/**
 * What a member can file a document as.
 *
 * ⚠️ THE FOUR ASSOCIATION KINDS ARE GONE FROM THIS LIST, deliberately. They
 * still exist in the enum — Postgres cannot drop a value — but offering them
 * would put a document outside every query that now looks for
 * DEDICATED_DISCIPLINE, and it would put the member back in front of the
 * choice that made us file a sport-shooter status as a hunter's.
 */
const KINDS: CredentialKind[] = [
  'FIREARM_LICENCE',
  'COMPETENCY_CERTIFICATE',
  'DEDICATED_DISCIPLINE',
  'PROFICIENCY',
  // ── the paperwork the Centre keeps rather than chases ──────────────
  //
  // ⚠️ ON THE MENU, BECAUSE "ADD AND REMOVE" HAS TO MEAN BOTH HALVES.
  // Operator, 2026-08-22: "give them access to it so they can add/remove
  // documents from it." Without these the classifier is the only way a safe
  // photograph ever gets filed as one.
  //
  // ⚠️ AND THE SAFE IS ONE ENTRY, NOT FOUR. Operator, 2026-08-23: "I dont like
  // the safe picture being seperate four uploads, looks shit. Make it safe
  // pictures. User must be able to upload multiple documents." Four entries
  // asked the member to sort their own photographs by how far the door was
  // open — and the classifier could not do it either, which is why it was
  // pinned to low confidence on all four. Several files go in under this one
  // entry; the file picker below already takes a whole folder at once.
  //
  // They sit BELOW the credentials and above OTHER because the ordering is
  // the menu the member reads, and a licence is what most people are here to
  // file.
  'IDENTITY_DOCUMENT',
  'ADDRESS_CONFIRMATION',
  'EMPLOYMENT_CONFIRMATION',
  'SAFE_PHOTOGRAPHS',
  'SHOOTING_ACTIVITY_LOG',
  'OTHER',
];

/**
 * Where the menu splits.
 *
 * The two halves answer different questions — "what runs out" and "what do I
 * have to hand in" — and a flat list of thirteen makes somebody read all of
 * them to find the one they came for.
 */
const KIND_GROUPS: { label: string; kinds: CredentialKind[] }[] = [
  {
    label: 'Licences and certificates',
    kinds: [
      'FIREARM_LICENCE',
      'COMPETENCY_CERTIFICATE',
      'DEDICATED_DISCIPLINE',
      'PROFICIENCY',
    ],
  },
  {
    label: 'Supporting paperwork',
    kinds: [
      'IDENTITY_DOCUMENT',
      'ADDRESS_CONFIRMATION',
      'EMPLOYMENT_CONFIRMATION',
      'SAFE_PHOTOGRAPHS',
      'SHOOTING_ACTIVITY_LOG',
    ],
  },
  { label: 'Anything else', kinds: ['OTHER'] },
];

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
   */
  const settled = (r: CredentialRow) => r.confirmed || r.dateSource !== null;
  const needDate = (rows ?? []).filter((r) => !settled(r) && !r.neverExpires);
  const needFiling = (rows ?? []).filter((r) => !settled(r) && r.neverExpires);

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
              {needFiling.length === 1
                ? 'One document is kept on file with no expiry date. Check that we have filed it as the right type.'
                : `${needFiling.length} documents are kept on file with no expiry date. Check that we have filed them as the right type.`}
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

              <AddPanel token={token} onAdded={refresh} />
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
}: {
  token: () => Promise<string | null>;
  onAdded: () => Promise<void>;
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

  const control =
    'rounded border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-primary)] ' +
    '[&>option]:bg-[var(--bg-card)] [&>option]:text-[var(--text-primary)] focus:border-[var(--border-hover)] focus:outline-none';

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
      // Settled by us counts as settled: see the note on `settled` above.
      const need = rows.filter((r) => !r.confirmed && r.dateSource === null);
      if (!need.length) return;
      setQueue(
        need.map((r) => ({
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
        })),
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
          key: `r${(rejectSeq += 1)}`,
          name: f.name,
          reason: `We cannot read ${f.type || 'that file type'}. Use a JPG, PNG, WebP or PDF — on an iPhone, pick it from your photo library rather than from Files.`,
        });
        return false;
      }
      if (f.size > 10 * 1024 * 1024) {
        failed.push({
          key: `r${(rejectSeq += 1)}`,
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
          readNotes: [],
          neverExpires: r.neverExpires === true,
          issuedOnUnknown: r.issuedOnUnknown === true,
          proposed: r.proposed,
        });
      } catch (ex) {
        // One bad file must not abandon the rest of the pack — and THIS one
        // keeps its File, because a failure here is a dropped connection or a
        // server that was busy, and trying again is exactly right.
        failed.push({
          key: `r${(rejectSeq += 1)}`,
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
        busy={busy}
        onFiles={(files, declared) => void uploadFiles(files, declared)}
        onHandoffArrived={() => void queueHandoffArrivals()}
      />
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

// ── the review screen ───────────────────────────────────────────────
//
// Operator, 2026-08-25, on the approved drawing: "Review screen looks right,
// build it."
//
// WHAT IT REPLACES. A batch used to be taken apart the moment it landed: one
// full-width confirm panel per document, in upload order, inside a toolbar
// flex cell, with nothing but "N documents left to check" for context — and
// that panel shows no filename and no picture. Five things filed as
// "Something else" were five identical screens asking what they were, and the
// three we were unsure about sat at positions 2, 7 and 11 behind nine
// identical panels with no way to see them together or skip to them.
//
// ⚠️ EVERY ROW OWNS ITS OWN STATE, AND THAT IS THE WHOLE SAFETY STORY. The
// queue this replaces carries a comment recording what happens when it does
// not: advancing it handed one document's state to the next, so confirming a
// photograph of a safe opened the firearm licence behind it with "Never
// expires" already ticked and the expiry we had just read off it cleared,
// under one button reading "That is right" — filing the licence as a safe
// photograph and stamping it confirmed. That is a licence no reminder can
// ever fire for again. A screen that shows a whole batch at once is exactly
// where that class of bug lives, so nothing here is shared between rows: the
// panel is keyed on the document, and the accept path reads each row's own
// proposal and never a running variable.
//
// ⚠️ AND THE FIRST DRAFT OF THIS SCREEN REACHED THAT SAME END STATE ANYWAY,
// through its own repair gesture. A pre-ship review caught it. The one-tap
// type control let a member re-file a mis-read document without opening the
// panel — and posted the OLD kind's date answer with the NEW kind. A firearm
// licence wrongly filed as a photograph arrives with "Never expires" already
// ticked by the server, because that is right for a photograph; one tap to
// correct the type therefore stamped the licence confirmed, with no expiry,
// and dropped it out of every surface that would have asked again. Hence
// `settleableInBulk` and the guard at the top of `refile`: a date is only
// carried across a change of type when we READ it off the page, because that
// is a fact about the document rather than about our guess at what it is.

/**
 * Two document fetches at a time, no more.
 *
 * ⚠️ A THUMBNAIL COSTS THE MOST EXPENSIVE REQUEST ON THIS PAGE. There is no
 * thumbnail column and nothing generates one: the only way to draw a document
 * is to fetch and decrypt its whole bytes, which is why the detail panel
 * deliberately shows no preview at all. It is worth it HERE and only here —
 * a triage row without a picture cannot do its job, which is the reason the
 * panel this replaces could not do its job either. Twelve rows firing twelve
 * concurrent decrypting reads at a single-process API is not, so they queue.
 */
const THUMB_AT_ONCE = 2;
const thumbGate: { active: number; waiting: (() => void)[] } = {
  active: 0,
  waiting: [],
};
async function withThumbSlot(
  run: () => Promise<void>,
  /** Checked AFTER the wait: a row that has gone must not spend its turn. */
  cancelled: () => boolean,
): Promise<void> {
  if (thumbGate.active >= THUMB_AT_ONCE) {
    await new Promise<void>((resolve) => thumbGate.waiting.push(resolve));
  }
  thumbGate.active += 1;
  try {
    // ⚠️ THE SLOT IS STILL TAKEN AND RELEASED. Returning before `run` skips
    // the fetch, not the bookkeeping — bailing out without the increment and
    // the finally below would leak a slot and eventually wedge the queue.
    if (cancelled()) return;
    await run();
  } finally {
    thumbGate.active -= 1;
    thumbGate.waiting.shift()?.();
  }
}

function GlyphThumb({ label }: { label?: string }) {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)]"
      aria-hidden
    >
      {label ? (
        <span className="text-[8.5px] font-semibold tracking-[0.06em] text-[var(--text-tertiary-on-card)]">
          {label}
        </span>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--border-hover)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      )}
    </div>
  );
}

/**
 * The document itself, at 40px.
 *
 * ⚠️ THE TYPE IS A HINT, NOT A VERDICT. `mimeType` holds whatever the browser
 * declared when the file was picked, copied verbatim and never re-checked
 * against the bytes — so it decides whether to spend a fetch, and the image's
 * own error decides whether the result can actually be drawn.
 */
function DocThumb({
  token,
  id,
  mimeType,
}: {
  token: () => Promise<string | null>;
  id: string;
  mimeType: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [broke, setBroke] = useState(false);
  /**
   * ⚠️ THE TOKEN GETTER IS HELD IN A REF, NOT A DEPENDENCY. It comes from
   * Clerk through a useCallback; a re-created identity in the dependency list
   * would re-run this effect, and this effect fetches and decrypts a whole
   * document. A refetch loop here is not a wasted render, it is a wasted
   * request per row per render.
   */
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const isImage = mimeType.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    let made: string | null = null;
    void withThumbSlot(
      async () => {
        try {
          const u = await licenceCentreApi.fileBlobUrl(tokenRef.current, id);
          if (!alive) {
            URL.revokeObjectURL(u);
            return;
          }
          made = u;
          setUrl(u);
        } catch {
          // The glyph is the fallback and says nothing alarming. A thumbnail
          // that will not load is not a reason to interrupt a member who is
          // trying to file their documents.
          if (alive) setBroke(true);
        }
      },
      () => !alive,
    );
    return () => {
      alive = false;
      // ⚠️ REVOKED, ALWAYS. These are decrypted document bytes sitting in
      // browser memory; a batch of twelve left pinned for the life of the tab
      // is both a leak and the wrong thing to leave lying about.
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, isImage]);

  if (!isImage) {
    return (
      <GlyphThumb label={mimeType === 'application/pdf' ? 'PDF' : undefined} />
    );
  }
  if (!url || broke) return <GlyphThumb />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      onError={() => setBroke(true)}
      className="h-10 w-10 shrink-0 rounded-[6px] border border-[var(--border)] object-cover"
    />
  );
}

/** Numbers a rejected row apart from its filename, which is not unique. */
let rejectSeq = 0;

/** A file that never became a document. */
interface RejectedFile {
  /** Its own identity: two folders can hand us two files called scan.jpg. */
  key: string;
  name: string;
  reason: string;
  /**
   * Kept only where trying again could possibly work.
   *
   * ⚠️ ABSENT ON A PRE-FLIGHT REFUSAL, DELIBERATELY. A .HEIC is still a .HEIC
   * and a 14 MB photo is still 14 MB; offering "Try again" on those is a
   * button whose only outcome is the same refusal, which reads as the site
   * being broken rather than the file being wrong.
   */
  file?: File;
}

function ReviewScreen({
  token,
  items,
  rejected,
  uploading,
  onFinish,
  onRetry,
  onChanged,
}: {
  token: () => Promise<string | null>;
  items: ReviewItem[];
  rejected: RejectedFile[];
  /** AddPanel is mid-upload — its progress line is behind this overlay. */
  uploading: boolean;
  /** Leave the review. The documents stay exactly as they are. */
  onFinish: () => void;
  onRetry: (r: RejectedFile) => void;
  /** Re-read the list behind the overlay. */
  onChanged: () => Promise<void>;
}) {
  /**
   * ONE DOCUMENT IS NOT A BATCH. A group label over a single row, a chip
   * counting to one and a tap to reach the date form is worse than the panel
   * this screen replaced — and one document is the ordinary phone path.
   */
  const single = items.length === 1 && rejected.length === 0;

  const [done, setDone] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(single ? items[0].id : null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const busy = working || uploading;
  const left = items.filter((d) => !done.includes(d.id));

  // ⚠️ SORTED BY WHAT NEEDS A HUMAN, NOT BY UPLOAD ORDER. The whole complaint
  // about the queue this replaces is that the two documents worth looking at
  // sat behind nine that were not.
  const needs = left.filter((d) => needsALook(d) || !settleableInBulk(d));
  const fine = left.filter((d) => !needs.includes(d));
  // Two different reasons a row needs the member, and they get two different
  // words: one is a guess at what the document IS, the other is a missing
  // date on a document whose type was never in question.
  const unsureCount = needs.filter(needsALook).length;
  const datelessCount = needs.length - unsureCount;

  const panelFor = open ? left.find((d) => d.id === open) : null;
  const sheetItem = sheetFor ? left.find((d) => d.id === sheetFor) : null;
  const finished = left.length === 0 && rejected.length === 0;

  /** One document settled — drop it from the review and refresh behind. */
  async function settle(id: string) {
    setDone((d) => [...d, id]);
    setOpen(null);
    setSheetFor(null);
    await onChanged().catch(() => undefined);
  }

  /**
   * "These N are right."
   *
   * ⚠️ ONE ROW AT A TIME, AND EACH FROM ITS OWN PROPOSAL. There is no batch
   * confirm route; this is N posts. They run in series because a confirm
   * writes and then resolves a notification, and because a failure part-way
   * has to leave the rows it did not reach alone and say which ones those are
   * — not abandon the batch and not claim it finished.
   */
  async function acceptAll() {
    setWorking(true);
    setErr(null);
    const settled: string[] = [];
    const stuck: string[] = [];
    for (const d of fine) {
      const expires = expiryAnswer(d);
      // Cannot happen — `fine` excludes these — but a batch write is the last
      // place to trust that a filter upstream stayed correct.
      if (expires === null) {
        stuck.push(d.title);
        continue;
      }
      try {
        await licenceCentreApi.confirm(token, d.id, {
          expiresOn: expires,
          issuedOn: d.issuedOnUnknown
            ? undefined
            : d.proposed.issuedOn || undefined,
          neverExpires: d.neverExpires,
          issuedOnUnknown: d.issuedOnUnknown,
          // ⚠️ NO kind AND NO title. This gesture means "the dates and the
          // filing are right", so it changes as little as it can: sending a
          // kind is the one thing here that can put a document in the wrong
          // box, and nothing on this path has asked the member about the type.
          // The rows where the type IS in question are in `needs`, not here.
        });
        settled.push(d.id);
      } catch (ex) {
        stuck.push(
          `${d.title}${ex instanceof LicenceApiError ? ` — ${ex.message}` : ''}`,
        );
      }
    }
    setDone((prev) => [...prev, ...settled]);
    setErr(
      stuck.length
        ? `We could not finish ${stuck.length === 1 ? 'one' : stuck.length}: ${stuck.join(' · ')}. ${stuck.length === 1 ? 'It is' : 'They are'} still here.`
        : null,
    );
    setWorking(false);
    await onChanged().catch(() => undefined);
  }

  /** The member picked a type from the sheet. */
  async function refile(d: ReviewItem, kind: CredentialKind) {
    /**
     * ⚠️ A CHANGE OF TYPE GOES THROUGH THE PANEL UNLESS WE READ A DATE OFF THE
     * PAGE. This is the guard the pre-ship review put here, and the header of
     * this section says what it prevents. Every other kind of date answer this
     * row carries was derived from the type we GUESSED — "Never expires" is
     * pre-ticked by the server for a photograph, and a worked-out expiry comes
     * from the statute for the kind we assumed. Carrying either across a
     * correction posts the old guess's answer under the new type, and for a
     * licence wrongly filed as a photograph that means confirmed, dateless and
     * beyond the reach of every reminder, in one tap.
     *
     * A date printed on the document is a fact about the document, so it
     * survives the correction. Picking the SAME type is not a correction and
     * needs no guard.
     */
    if (refileNeedsPanel(d, kind)) {
      setSheetFor(null);
      setOpen(d.id);
      return;
    }
    const expires = expiryAnswer(d);
    /* istanbul ignore next — refileNeedsPanel already excludes this. */
    if (expires === null) {
      setSheetFor(null);
      setOpen(d.id);
      return;
    }
    setWorking(true);
    setErr(null);
    try {
      await licenceCentreApi.confirm(token, d.id, {
        expiresOn: expires,
        issuedOn: d.issuedOnUnknown
          ? undefined
          : d.proposed.issuedOn || undefined,
        neverExpires: d.neverExpires,
        issuedOnUnknown: d.issuedOnUnknown,
        kind,
      });
      setWorking(false);
      await settle(d.id);
    } catch (ex) {
      setWorking(false);
      setErr(
        ex instanceof LicenceApiError
          ? ex.message
          : 'We could not file that just now.',
      );
    }
  }

  return (
    <div
      /* ⚠️ z-[60] AND TAGGED. The bottom tab bar sits at z55/56, so anything
         lower is occluded on a phone; and the add menu stands down on this
         marker rather than treating a tap in here as a tap outside itself. */
      data-blocking-overlay="true"
      className="fixed inset-0 z-[60] overflow-y-auto bg-[var(--bg)]"
      role="dialog"
      aria-modal="true"
      aria-label="Check what we made of your documents"
    >
      <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
        {finished ? (
          <div className="pt-10 text-center">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
              {done.length === 1
                ? 'That one is filed'
                : `All ${done.length} filed`}
            </h2>
            <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
              We will remind you before anything here runs out.
            </p>
            <button
              type="button"
              onClick={onFinish}
              className="mx-auto mt-6 rounded-[10px] border border-[var(--red)] bg-[var(--red)] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[var(--red-hover)]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {panelFor && (
              <>
                {!single && (
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    className="mb-4 text-[12.5px] text-[var(--text-secondary)] underline"
                  >
                    ← Back to the list
                  </button>
                )}
                {/* ⚠️ KEYED ON THE DOCUMENT. Not decoration: see the note at
                    the top of this section for what a shared panel instance
                    did to the document behind it in the queue. */}
                <ConfirmPanel
                  key={panelFor.id}
                  token={token}
                  id={panelFor.id}
                  proposed={panelFor.proposed}
                  /* ⚠️ ALWAYS THE FULL MENU. Gating this on autoFiled left a
                     member-declared document with no date sitting in "Needs
                     you" under a control labelled "Change the type" that
                     opened a panel with no type control in it. */
                  kinds={KINDS}
                  currentKind={panelFor.kind}
                  uncertain={needsALook(panelFor)}
                  reason={uncertaintyReason(panelFor)}
                  notes={panelFor.readNotes ?? []}
                  defaultTitle={panelFor.title}
                  neverExpires={panelFor.neverExpires}
                  issuedOnUnknown={panelFor.issuedOnUnknown}
                  cancelLabel={single ? 'I will do this later' : 'Back to the list'}
                  onDone={async () => {
                    await settle(panelFor.id);
                  }}
                  /* ⚠️ CANCEL IS NOT DONE, AND SHARING ONE CALLBACK SAID IT
                     WAS. Backing out counted the document as filed: it left
                     the review, the green "N filed" line went up by one, and
                     confirmedAt was still null — so nothing reminded on it and
                     nothing asked again. */
                  onCancel={() => (single ? onFinish() : setOpen(null))}
                />
              </>
            )}

            {/* ⚠️ HIDDEN, NOT UNMOUNTED. Rendering this branch only when no
                panel is open tore down every thumbnail each time a row was
                opened, and each one is a fetch and a whole-file decrypt with
                no cache behind it — a twelve-document batch with two amber
                rows cost thirty-three full document reads instead of twelve. */}
            <div className={panelFor ? 'hidden' : ''}>
              <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
                We read {items.length}
              </h2>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {fine.length > 0 && (
                  <span className="rounded-full border border-[rgba(47,158,107,0.42)] bg-[rgba(47,158,107,0.09)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                    {fine.length} look{fine.length === 1 ? 's' : ''} right
                  </span>
                )}
                {unsureCount > 0 && (
                  <span className="rounded-full border border-[rgba(232,181,58,0.32)] bg-[rgba(232,181,58,0.1)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--gold)]">
                    {unsureCount} we are not sure about
                  </span>
                )}
                {datelessCount > 0 && (
                  <span className="rounded-full border border-[var(--border-hover)] bg-[var(--bg-inset)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                    {datelessCount} need{datelessCount === 1 ? 's' : ''} a date
                  </span>
                )}
                {rejected.length > 0 && (
                  <span className="rounded-full border border-[rgba(200,16,46,0.5)] bg-[rgba(200,16,46,0.09)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--red)]">
                    {rejected.length} did not go through
                  </span>
                )}
              </div>

              {done.length > 0 && (
                <p className="mt-3 text-[12px] text-[var(--success)]" role="status">
                  {done.length} filed.
                </p>
              )}
              {uploading && (
                <p
                  className="mt-3 text-[12px] text-[var(--text-secondary)]"
                  role="status"
                >
                  Adding…
                </p>
              )}

              {(needs.length > 0 || rejected.length > 0) && (
                <GroupLabel>Needs you</GroupLabel>
              )}
              <div className="flex flex-col gap-2">
                {needs.map((d) => (
                  <ReviewRow
                    key={d.id}
                    token={token}
                    item={d}
                    attention
                    unsure={needsALook(d)}
                    busy={busy}
                    onOpen={() => setOpen(d.id)}
                    onType={() =>
                      settleableInBulk(d) ? setSheetFor(d.id) : setOpen(d.id)
                    }
                  />
                ))}
                {rejected.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-2.5"
                  >
                    <GlyphThumb />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">
                        {r.name}
                      </p>
                      <p className="text-[11px] text-[var(--red)]">{r.reason}</p>
                    </div>
                    {r.file && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRetry(r)}
                        className="shrink-0 rounded-[6px] border border-[var(--border-hover)] bg-[var(--bg-inset)] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {fine.length > 0 && <GroupLabel>Look right</GroupLabel>}
              <div className="flex flex-col gap-2">
                {fine.map((d) => (
                  <ReviewRow
                    key={d.id}
                    token={token}
                    item={d}
                    busy={busy}
                    onOpen={() => setOpen(d.id)}
                    onType={() =>
                      settleableInBulk(d) ? setSheetFor(d.id) : setOpen(d.id)
                    }
                  />
                ))}
              </div>

              {err && (
                <p className="mt-4 text-[12.5px] text-[var(--red)]" role="alert">
                  {err}
                </p>
              )}

              <div className="mt-6 flex flex-col gap-2">
                {fine.length > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void acceptAll()}
                    className="rounded-[10px] border border-[var(--red)] bg-[var(--red)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
                  >
                    {working
                      ? 'Filing…'
                      : `${fine.length === 1 ? 'This one is' : `These ${fine.length} are`} right`}
                  </button>
                )}
                {/* ⚠️ BORDERED WHEN IT IS THE ONLY WAY OUT. With nothing to
                    accept, a borderless grey line was the sole control on the
                    screen and did not read as a control at all. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={onFinish}
                  className={
                    fine.length > 0
                      ? 'rounded-[10px] px-4 py-2 text-[12.5px] text-[var(--text-secondary)] disabled:opacity-50'
                      : 'rounded-[10px] border border-[var(--border-hover)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--bg-card-hover)] disabled:opacity-50'
                  }
                >
                  {/* ⚠️ TRUE AS WRITTEN. Nothing here is a draft: every
                      document is already stored and already in the list. What
                      is outstanding is the member's confirmation, and the way
                      back to it is the button on each row. */}
                  Finish later — they are saved
                </button>
              </div>

              <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-tertiary-on-card)]">
                Nothing is reminded about until you have checked its dates.
                {rejected.length > 0
                  ? ' Files that did not go through were never added.'
                  : ''}
              </p>
            </div>
          </>
        )}
      </div>

      {sheetItem && (
        <div
          className="fixed inset-0 z-[61] flex items-end justify-center bg-black/60"
          onClick={() => setSheetFor(null)}
        >
          <div
            className="w-full max-w-2xl rounded-t-[16px] border-t border-[var(--border-hover)] bg-[var(--bg-card)] p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="What is this document?"
          >
            <p className="mb-3 text-[13px] font-semibold">
              What is this document?
            </p>
            <div className="flex max-h-[52vh] flex-col gap-0.5 overflow-y-auto">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() => void refile(sheetItem, k)}
                  className={`flex min-h-[44px] items-center justify-between gap-3 rounded-[6px] border px-3 text-left text-[12.5px] disabled:opacity-50 ${
                    k === sheetItem.kind
                      ? 'border-[var(--red)] bg-[rgba(200,16,46,0.09)] font-semibold'
                      : 'border-transparent hover:bg-[var(--bg-card-hover)]'
                  }`}
                >
                  <span>{KIND_LABELS[k] ?? k}</span>
                  {k === sheetItem.kind && (
                    <span className="text-[var(--red)]">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
      {children}
      <span className="h-px flex-1 bg-[var(--border-divider)]" />
    </p>
  );
}

function ReviewRow({
  token,
  item,
  attention = false,
  unsure = false,
  busy,
  onOpen,
  onType,
}: {
  token: () => Promise<string | null>;
  item: ReviewItem;
  /** In the "needs you" group, for whatever reason. */
  attention?: boolean;
  /** We guessed the TYPE and are not sure — a narrower thing than attention. */
  unsure?: boolean;
  busy: boolean;
  onOpen: () => void;
  onType: () => void;
}) {
  const kindLabel = KIND_LABELS[item.kind] ?? item.kind;
  /**
   * What is outstanding about this row's dates.
   *
   * ⚠️ A WORKED-OUT DATE IS NOT SHOWN AS A DATE. `derivedExpiry` only exists
   * where the document prints no expiry and a statute supplies one; printing
   * that number here, in the same style as one we read off the page, would
   * make a calculation look like a reading. The panel explains it; the row
   * says there is something to look at.
   */
  const when = item.neverExpires
    ? 'Kept on file'
    : item.proposed.expiresOn
      ? formatDate(item.proposed.expiresOn)
      : item.proposed.derivedExpiry
        ? 'No date printed on it'
        : 'No date yet';

  return (
    <div
      className={`flex items-center gap-3 rounded-[10px] border p-2.5 ${
        attention
          ? 'border-[rgba(232,181,58,0.32)] bg-[rgba(232,181,58,0.07)]'
          : 'border-[var(--border)] bg-[var(--bg-card)]'
      }`}
    >
      <DocThumb token={token} id={item.id} mimeType={item.mimeType} />

      {/* The row body opens the full panel — dates, ticks, the name and the
          type menu — which is the only place a document with no date can be
          answered at all. */}
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="min-w-0 flex-1 text-left disabled:opacity-50"
      >
        <span className="block truncate text-[12.5px] font-medium">
          {item.title}
        </span>
        {/* ⚠️ THE DATE ONLY. The type used to be repeated here as well, which
            put "Photographs of my safe" on the title, the subtitle AND the
            control — three copies on one row. */}
        <span className="block truncate text-[11px] text-[var(--text-tertiary-on-card)]">
          {when}
        </span>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={onType}
          disabled={busy}
          aria-label={`Change the type of ${item.title} — currently ${kindLabel}`}
          /* ⚠️ CAPPED AND TRUNCATED. Some registry labels are long
             ("Association status or membership") and a phone row has no room
             to argue; the full label is on the sheet this opens. */
          className="min-h-[30px] max-w-[7rem] truncate rounded-full border border-[var(--border-hover)] bg-[var(--bg-inset)] px-3 text-[10.5px] font-semibold disabled:opacity-50 sm:max-w-[12rem]"
        >
          {kindLabel} ▾
        </button>
        {unsure && (
          /* ⚠️ A WORD, NOT ONLY A COLOUR, AND ONLY WHERE IT IS TRUE. Amber
             against green is the red-green-blind failure pair; and a document
             whose type the MEMBER chose is not one we are unsure about, it
             just has no date yet — the subtitle says so. */
          <span className="text-[10px] font-semibold text-[var(--gold)]">
            Not sure
          </span>
        )}
      </div>
    </div>
  );
}

// ── the safety rail ──────────────────────────────────────────

function ConfirmPanel({
  token,
  id,
  proposed,
  onDone,
  onCancel,
  cancelLabel = 'I will do this later',
  kinds,
  currentKind,
  uncertain,
  reason,
  notes,
  defaultTitle,
  neverExpires: neverExpiresInitial,
  issuedOnUnknown: issuedOnUnknownInitial,
}: {
  token: () => Promise<string | null>;
  id: string;
  proposed: CredentialProposal;
  onDone: () => Promise<void>;
  /**
   * Backing out WITHOUT confirming.
   *
   * ⚠️ DEFAULTS TO onDone FOR THE CALLERS THAT ALWAYS MEANT THAT — on the
   * card, dismissing the panel and finishing it are the same "put this away".
   * The review screen is the caller for which they are opposites: it counts
   * what came back from onDone as filed, and a cancel routed there removed a
   * document from the review, added it to the "N filed" line, and left
   * confirmedAt null — so nothing reminded on it and nothing asked again.
   */
  onCancel?: () => void;
  /** "I will do this later" is right after an upload and wrong as a cancel. */
  cancelLabel?: string;
  /**
   * Passing these turns on the type and title controls. Offered where WE named
   * the document — a batch upload — and on the card, which is the only way back
   * for somebody who tapped "I will do this later" on a mis-filed one.
   */
  kinds?: CredentialKind[];
  currentKind?: CredentialKind;
  /** We guessed, and were not sure. A marker, not a blocker. */
  uncertain?: boolean;
  reason?: string | null;
  notes?: string[];
  defaultTitle?: string;
  /**
   * How the two ticks stand on the stored row, so re-opening the panel shows
   * the answer the member already gave rather than a blank form.
   */
  neverExpires?: boolean;
  issuedOnUnknown?: boolean;
}) {
  // ⚠️ THE DERIVED DATE PREFILLS THE BOX, and the panel says where it came
  // from. It is still unconfirmed like everything else here, so nothing drives
  // a reminder until the member has looked at it.
  const [expiresOn, setExpiresOn] = useState(
    proposed.expiresOn ?? proposed.derivedExpiry?.on ?? '',
  );
  const [issuedOn, setIssuedOn] = useState(proposed.issuedOn ?? '');
  /**
   * THE TWO TICKS. Operator, 2026-08-22: "put a tick box next to the expiry
   * date called Never Expires. Also a tickbox next to Issue date called Not
   * Sure, if its unsure when the document was issued."
   *
   * ⚠️ THE MEMBER ANSWERS, NOT THE KIND. An earlier design decided this from
   * the document type and a database CHECK enforced it — which meant a
   * passport, an identity document that plainly expires, could not be filed at
   * all. The member is holding the thing and can see whether a date is printed
   * on it.
   *
   * ⚠️ AND A TICK CLEARS ITS DATE RATHER THAN SITTING BESIDE IT. They are
   * contradictory answers to one question; the server refuses to store both
   * and would otherwise leave every reader to pick a winner.
   */
  const [neverExpires, setNeverExpires] = useState(
    neverExpiresInitial === true,
  );
  const [issuedOnUnknown, setIssuedOnUnknown] = useState(
    issuedOnUnknownInitial === true,
  );
  /**
   * What the tick cleared out of each box.
   *
   * ⚠️ TICKING IS NOT MEANT TO BE EXPENSIVE TO UNDO. Somebody who reads a date
   * off the card, types it, then ticks the box to see what it does should not
   * have to go and find the card again. Restored only into an empty box, so it
   * can never overwrite something typed since.
   */
  const clearedExpiry = useRef('');
  const clearedIssued = useRef('');
  const [kind, setKind] = useState<CredentialKind | ''>(currentKind ?? '');
  const [title, setTitle] = useState(defaultTitle ?? '');
  const showKind = Boolean(kinds && currentKind);
  /**
   * ⚠️ THE CURRENT TYPE HAS TO BE ON THE MENU. A kind that is not in `kinds`
   * rendered a select showing "Firearm licence", the first option, while the
   * state underneath still held the real one. It displayed one type and would
   * have posted another, and a member who never touched the control would
   * never have known. Live again since 2026-08-23: the four retired safe kinds
   * are off the menu, and an older row still carries one.
   */
  const kindOptions =
    kinds && currentKind && !kinds.includes(currentKind)
      ? [currentKind, ...kinds]
      : kinds;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const control =
    'mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-hover)] focus:outline-none';

  return (
    <section className="mt-6 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-4">
      {/* ⚠️ "CHECK THE EXPIRY DATE" OVER A PHOTOGRAPH OF A GUN SAFE. That is
          what this said, every word of it wrong, because the heading only ever
          considered whether WE had named the document. A row with the tick on
          it has no date to check; what is worth checking is the type we filed
          it as and the name it will appear under. */}
      <p className="text-sm font-medium">
        {neverExpires
          ? showKind
            ? 'Check what this is'
            : 'Check this document'
          : showKind
            ? 'Check this document'
            : 'Check the expiry date'}
      </p>
      {/* ⚠️ SAY WHAT WE ACTUALLY READ. This used to talk only about the
          expiry, so a competency certificate whose issue date, number, holder
          and coverage all read perfectly — and which simply does not print an
          expiry — was greeted with "we could not read a date off that one".
          True about the one field it meant, and wrong about the document.

          ⚠️ AND THE TICK COMES FIRST IN THE CHAIN. Once the member has said
          there is no expiry date, every one of the sentences below is either
          an instruction to find a date that does not exist or a complaint
          about not having read one. */}
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {neverExpires
          ? showKind
            ? 'Nothing on this one runs out, so there is no date to check. Make sure it is filed as the right type and named so you will know it again.'
            : 'Nothing on this one runs out. We keep it on file and schedule nothing against it.'
          : proposed.expiresOn
            ? 'We read this off your document. Check it against the document itself — a photograph can be misread, and every reminder is worked out from this date.'
            : proposed.derivedExpiry
              ? proposed.derivedExpiry.why
              : proposed.issuedOn || Object.keys(proposed.details).length > 0
                ? 'We read what is below off your document, but it does not print an expiry date we could find. Type it if it has one, or tick “Never expires” if it has none — every reminder is worked out from it.'
                : 'We could not read anything off that one. Fill it in as it is printed on the document, or tick “Never expires” if there is no date on it.'}
      </p>

        {/* WHY this document is in front of you.

            The panel already said "(check this)" beside the type. That is
            honest and it is not useful: a member with twelve documents and
            two doubtful ones could not tell which two, so the label did the
            work of a shrug. This names the field in THEIR words, so their
            eye goes to the right line on the paper they are holding.

            Rendered only when there is something to say. A row filed before
            this was stored has nothing recorded, and inventing a reason for
            it would be worse than the shrug. */}
        {(reason || (notes && notes.length > 0)) && (
          <div className="mt-3 rounded border border-[var(--border)] bg-[var(--gold-wash)] px-3 py-2 text-[13px] leading-relaxed">
            {reason && (
              <p className="text-[var(--warning)]">{reason}</p>
            )}
            {notes?.map((n) => (
              /* What we CHANGED on their document. A SAPS 524 prints the
                 identity number in boxes and the left border of the first
                 reads as a digit, so we drop it and re-check the checksum.
                 That is arithmetic rather than a guess, but it is still
                 something we did to their document without asking. */
              <p key={n} className="mt-1 text-[var(--text-secondary)]">
                We corrected something as we read it: {n}
              </p>
            ))}
          </div>
        )}
      {/* WHAT WE MADE OF IT. The type is not cosmetic: a licence filed as
          something else is never offered a renewal, and reminder copy is
          written per type. */}
      {showKind && kindOptions && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-[var(--text-secondary)]">
              What this is
              {uncertain && (
                <span className="ml-1 text-xs text-[var(--warning)]">
                  (check this)
                </span>
              )}
            </span>
            <select
              className={control}
              value={kind}
              onChange={(e) => setKind(e.target.value as CredentialKind)}
            >
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-[var(--text-secondary)]">
              What you call it
            </span>
            <input
              className={control}
              value={title}
              maxLength={120}
              placeholder="“my .308”"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="block text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[var(--text-secondary)]">Expires on</span>
            {/* ⚠️ BESIDE THE FIELD, NOT UNDER IT. The tick is the answer to
                the same question the box asks, and a member looking at a
                document with no expiry printed on it has to be able to see the
                way out without scrolling past a form they cannot complete. */}
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--red)]"
                checked={neverExpires}
                onChange={(e) => {
                  const on = e.target.checked;
                  setNeverExpires(on);
                  // The tick and a date are contradictory answers, and the
                  // server stores only one of them. Clearing here means the
                  // member can see which answer is standing.
                  if (on) {
                    clearedExpiry.current = expiresOn;
                    setExpiresOn('');
                  } else if (!expiresOn) {
                    setExpiresOn(clearedExpiry.current);
                  }
                }}
              />
              Never expires
            </label>
          </div>
          <div>
            {/* NO max={today}. An already-expired licence is a document
                members legitimately load — the Centre's job is to tell them
                so, not to refuse the date. */}
            <DateField
              label="Expires on"
              value={expiresOn}
              onChange={setExpiresOn}
              className={control}
              focusYear={todayYmd().y + 3}
              disabled={neverExpires}
              required={!neverExpires}
            />
          </div>
        </div>
        <div className="block text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[var(--text-secondary)]">
              Issued on (optional)
            </span>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--red)]"
                checked={issuedOnUnknown}
                onChange={(e) => {
                  const on = e.target.checked;
                  setIssuedOnUnknown(on);
                  if (on) {
                    clearedIssued.current = issuedOn;
                    setIssuedOn('');
                  } else if (!issuedOn) {
                    setIssuedOn(clearedIssued.current);
                  }
                }}
              />
              Not sure
            </label>
          </div>
          <div>
            {/* Still no Clear button, and the reason has changed shape rather
                than gone away. confirmExpiry no longer wipes an issue date
                that is merely absent from the request — it leaves it alone —
                so "Not sure" is now the deliberate way to clear one, and it
                says WHY the field is empty instead of leaving a silent blank. */}
            <DateField
              label="Issued on"
              value={issuedOn}
              onChange={setIssuedOn}
              className={control}
              focusYear={todayYmd().y - 2}
              max={toIso(todayYmd())}
              disabled={issuedOnUnknown}
            />
          </div>
        </div>
      </div>

      {Object.keys(proposed.details).length > 0 && (
        <dl className="mt-3 divide-y divide-[var(--border-divider)] text-sm">
          {Object.entries(proposed.details).map(([k, v]) => (
            <div key={k} className="flex gap-3 py-1.5">
              <dt className="w-1/2 shrink-0 text-[var(--text-secondary)]">
                {k.replace(/_/g, ' ')}
                {proposed.lowConfidence.includes(k) && (
                  <span className="ml-1 text-xs text-[var(--warning)]">
                    (check this)
                  </span>
                )}
              </dt>
              <dd className="flex-1 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          /* ⚠️ A DATE IS NOT THE ONLY WAY TO ANSWER. This read
             `disabled={busy || !expiresOn}`, which locked the only button on
             the panel for every document that has no expiry printed on it —
             an ID copy, a proof of address, four photographs of a safe — and
             left the member with nothing to press but "I will do this later".
             The tick is the other complete answer. */
          disabled={busy || (!neverExpires && !expiresOn)}
          className="rounded bg-[var(--red)] px-4 py-2 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await licenceCentreApi.confirm(token, id, {
                // Empty, deliberately: the tick is the answer and the server
                // checks it before it parses anything.
                expiresOn: neverExpires ? '' : expiresOn,
                issuedOn: issuedOnUnknown ? undefined : issuedOn || undefined,
                neverExpires,
                issuedOnUnknown,
                kind: showKind ? kind || undefined : undefined,
                title: showKind ? title || undefined : undefined,
              });
              await onDone();
            } catch (ex) {
              setErr(
                ex instanceof LicenceApiError
                  ? ex.message
                  : 'We could not save that just now.',
              );
              setBusy(false);
            }
          }}
        >
          {/* ⚠️ "THAT DATE IS RIGHT" ABOUT A DOCUMENT WITH NO DATE. The label
              was as wrong as the disabled state it sat next to; what the
              member is agreeing to on a kept-on-file document is that there is
              nothing to expire and that we have filed it correctly. */}
          {busy
            ? 'Saving…'
            : neverExpires
              ? 'That is right'
              : 'That date is right'}
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
          onClick={() => (onCancel ? onCancel() : void onDone())}
        >
          {cancelLabel}
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
        {neverExpires
          ? 'We keep this on file. There is no date to remind you about.'
          : 'Until a date is confirmed we do not schedule anything against it.'}
      </p>
      {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}
    </section>
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
        <span className="block truncate text-[13.5px] font-medium">
          {row.title || KIND_LABELS[row.kind] || row.kind}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-tertiary-on-card)]">
          {KIND_LABELS[row.kind] ?? row.kind}
          {' \u00b7 added '}
          {formatDate(row.createdAt.slice(0, 10))}
        </span>
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

// ── one stored document ─────────────────────────────────────────────

function CredentialCard({
  row,
  usedIn,
  token,
  onChanged,
  onError,
}: {
  row: CredentialRow;
  /** Applications this document already appears in. Empty is the normal case. */
  usedIn: CredentialUsage[];
  token: () => Promise<string | null>;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const tone = STATE_TONE[row.state];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // ⚠️ THE DATE HAS TO BE REACHABLE FROM HERE.
  //
  // The confirm panel used to live only in AddPanel's local state, set once
  // in the seconds after an upload. Close it — or reload, or navigate away,
  // or tap its own "I will do this later" — and the date could never be
  // confirmed again. An unconfirmed date is invisible to the reminder sweep,
  // so the document silently got no reminders at all, while the banner, the
  // page footer and the reminder email all told the member to correct it
  // "in your Document Centre". The endpoint accepted a late confirm the whole
  // time; only the way in was missing.
  const [editing, setEditing] = useState(false);
  // The renewal's own failure, shown AT the button. onError renders at the
  // bottom of the page, which on a phone is well below the fold — the button
  // appeared to do nothing at all.
  const [renewErr, setRenewErr] = useState<string | null>(null);

  /**
   * Exactly what is standing between this document and green.
   *
   * ⚠️ GREEN IS TWO FACTS AND A THRESHOLD: an expiry date, the member's
   * confirmation of it, and more than 90 days left. A row that just says
   * "Needs checking" tells somebody nothing about which of those is missing,
   * so they open the panel, see a date already filled in, and close it again.
   *
   * Deliberately silent for a document that is genuinely expired or expiring —
   * nothing is missing there, the news is simply bad, and "to turn this green,
   * renew it" would be glib.
   */
  const nextStep: string | null = (() => {
    // ⚠️ A KEPT-ON-FILE DOCUMENT NEVER GOES GREEN, so there is nothing to
    // promise about turning it green. This branch used to be unreachable only
    // because there was no 'no-expiry' state: a photograph of a safe read as
    // 'unknown' and was told, in as many words, to "add the expiry date
    // printed on it". There is no date printed on a gun safe.
    if (row.state === 'no-expiry') {
      return row.confirmed
        ? null
        : 'Nothing on this one expires. Check that we have filed it as the right type.';
    }
    if (row.state !== 'unknown') return null;
    const wants: string[] = [];
    if (!row.expiresOn) {
      wants.push(
        row.derivedExpiry
          ? 'check the expiry date we worked out'
          : 'add the expiry date printed on it, or tick “Never expires”',
      );
    }
    if (!row.confirmed) wants.push('confirm it is right');
    return wants.length ? `To turn this green: ${wants.join(', then ')}.` : null;
  })();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(row.title);
  const saveName = async () => {
    const next = draftName.trim();
    setRenaming(false);
    // Unchanged, or emptied down to nothing — leave the row alone rather than
    // spend a request and a list refresh saying so.
    if (!next || next === row.title) {
      setDraftName(row.title);
      return;
    }
    try {
      await licenceCentreApi.rename(token, row.id, next);
      await onChanged();
    } catch {
      setDraftName(row.title);
      onError('We could not rename that document just now.');
    }
  };

  return (
    /*
      ── THE DETAIL PANEL ────────────────────────────────────────────

      This was a compact tinted card in a grouped list. It is now the third
      column of the Document Centre, restyled to the approved drawing:
      preview, name, what else the page counts as, its dates, then what you
      can do with it.

      ⚠️ EVERY BEHAVIOUR BELOW IS THE ONE THAT WAS HERE. The rename pen, the
      never-expires wording, the section 24 renewal offer and its two
      thresholds, the confirm panel as the way back from a mis-filed document,
      the Safari popup rule on View, the missing reminder switch on a dateless
      row — each has a comment explaining a bug it closed, and this change
      moved boxes, not rules.

      ⚠️ THE TINT IS GONE FROM THE CONTAINER. It carried the expiry state, and
      in a full-height column a wash of amber over 500px reads as an error
      page. The state now sits where the list puts it too: on a pill, with a
      word in it.
    */
    <li className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4">
      {/* ⚠️ NO PREVIEW HERE, AND THIS IS THE SECOND TIME THAT HAS BEEN
          DECIDED. A 148px box holding a generic page glyph stood here — it
          was in the approved drawing, and it rendered the same for every
          document, so it told nobody anything about the one they had
          selected. Operator, 2026-08-25: "remove that small preview, just
          keep the information underneath it. There is a view option so that
          would be more than fine."

          The thing it stood in for is real and reachable: View below fetches
          the decrypted bytes and opens the actual document. What it would
          take to render it in place is written up in the same conversation —
          cheap for a photographed licence, and needing a PDF rasteriser this
          backend does not have for anything scanned to PDF. If that is ever
          revisited, put a real render here or nothing; a placeholder is the
          one option already tried twice. */}
      <div>
        {/* ⚠️ WE NAME IT, THEY OWN THE NAME. A firearm licence is titled make +
            calibre off the document — "Howa 6.5 Creedmoor" — because six rows
            reading "Firearm licence" cannot be told apart. But what somebody
            calls their own rifle is theirs to decide, and our reading is only
            as good as the photograph. The pen edits in place; it never moves
            the row or opens a dialog. */}
        {renaming ? (
          <input
            autoFocus
            className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-1 text-base font-semibold"
            value={draftName}
            maxLength={120}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveName();
              if (e.key === 'Escape') {
                setDraftName(row.title);
                setRenaming(false);
              }
            }}
            onBlur={() => void saveName()}
            aria-label="Name for this document"
          />
        ) : (
          <p className="flex items-start gap-1.5 text-base font-semibold leading-snug">
            <span className="min-w-0">{row.title}</span>
            <button
              type="button"
              className="mt-0.5 shrink-0 rounded p-1 text-[var(--text-tertiary-on-card)] hover:text-[var(--text-primary)]"
              aria-label={`Rename ${row.title}`}
              title="Rename"
              onClick={() => {
                setDraftName(row.title);
                setRenaming(true);
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
          </p>
        )}
        <p className="mt-0.5 text-xs text-[var(--text-tertiary-on-card)]">
          {KIND_LABELS[row.kind]}
        </p>
      </div>

      {/* ⚠️ SAYING SO IS THE POINT, and it has its own box now rather than a
          clause. Without it a member looking for their letter of good standing
          sees no such row and uploads a second copy of the certificate they
          have already given us. */}
      {row.coversKinds.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-[var(--border)] bg-[var(--bg-inset)] p-3.5">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            This one page also counts as
          </p>
          <div className="flex flex-col gap-1.5">
            {row.coversKinds.map((k) => (
              <span
                key={k}
                className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {KIND_LABELS[k]}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            One row, several roles — never a second copy of the same page, which
            would print as two annexures.
          </p>
        </div>
      )}

      {nextStep && (
        // What is actually standing between this row and settled, named.
        // "Needs checking" tells somebody nothing about what to do next.
        <p className="mt-3 text-xs" style={{ color: tone.colour }}>
          {nextStep}
        </p>
      )}

      {/* ⚠️ "Expires —" IS NOT A FACT, IT IS A BLANK. On a document the member
          has told us never expires it read as a date we had failed to find,
          over the em dash formatDate returns for null — and the "reminders
          off" marker beside it describes a reminder that could never have
          fired. Say what is true instead. */}
      <div className="mt-4 flex flex-col gap-2.5 border-t border-[var(--border-divider)] pt-4">
        {/* ⚠️ THE SECTION WAS READ AND NEVER SHOWN. Operator, 2026-08-28:
            "when user scans a license in the OCR must add the section type of
            the license." It was already in WANTED and already doing real work
            — credential-auto-date cross-checks the expiry against
            LICENCE_YEARS[section] and REFUSES to arm a reminder without it
            ("no issue date or section to check the term against"). What it had
            no way of being was CORRECTED: a misread section silently disabled
            the reminder and the member could not see why. Now it is on the
            card, above the dates it governs. */}
        {row.details.section && (
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-[var(--text-tertiary-on-card)]">Section</span>
            <span className="font-medium">{row.details.section}</span>
          </div>
        )}
        {row.issuedOn && (
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-[var(--text-tertiary-on-card)]">Issued</span>
            <span className="gg-nums font-medium">{formatDate(row.issuedOn)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
          <span className="text-[var(--text-tertiary-on-card)]">Expires</span>
          {row.state === 'no-expiry' ? (
            <span className="text-[var(--text-secondary)]">Kept on file</span>
          ) : (
            <span className="gg-nums font-medium">
              {formatDate(row.expiresOn)}
            </span>
          )}
        </div>
        {row.state !== 'no-expiry' && (
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-[var(--text-tertiary-on-card)]">
              Date confirmed
            </span>
            {/* ⚠️ THREE STATES, AND THE MIDDLE ONE IS NEW. It was a binary: "By
                you" or "Not yet". Now the Centre fills dates in and arms the
                reminder itself, and neither word fits — "By you" would be a
                false record of who checked it, on a page about firearm
                licences, and "Not yet" would call a settled row an errand.
                Amber-neutral, never the green tick: the green tick means a
                human looked. */}
            {row.confirmed ? (
              <span className="flex items-center gap-1.5 text-[var(--success)]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                By you
              </span>
            ) : row.dateSource ? (
              <span className="text-[var(--text-secondary)]">
                {row.dateSource === 'derived' ? 'Worked out for you' : 'Filled in for you'}
              </span>
            ) : (
              <span className="text-[var(--warning)]">Not yet</span>
            )}
          </div>
        )}
        {/* Only where a reminder could exist at all — see the note on the
            switch below. */}
        {row.state !== 'no-expiry' && (
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-[var(--text-tertiary-on-card)]">Reminders</span>
            <span className="text-[var(--text-secondary)]">
              {row.remindersMuted ? 'Off' : 'On'}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
          <span className="text-[var(--text-tertiary-on-card)]">Added</span>
          <span className="gg-nums text-[var(--text-secondary)]">
            {formatDate(row.createdAt.slice(0, 10))}
          </span>
        </div>
      </div>

      {/* THE LOOP. A firearm licence whose date is confirmed and whose expiry
          is close enough to act on.

          ⚠️ THIS REVERSES A DELIBERATE EARLIER DECISION, and the reasoning
          then was not wrong — it was that an SA licence runs five or ten
          years, so gating on the reminder window kept the module's headline
          feature off screen for a licence uploaded today, and that the
          urgency belonged in the words rather than in whether the button
          existed. The operator has overruled it: a renewal offered the day
          somebody files a ten-year licence is noise on every card, every
          visit, for nine and a half years.

          ⚠️ AND IT NO LONGER RIDES ON `state`. It used to, back when 'expiring'
          meant 180 days and that happened to be the six months asked for. The
          amber threshold has since moved to 90 days — common practice, and the
          section 24(1) deadline itself — so gating on it would first mention
          renewal on the very last day the application can be lodged. The two
          numbers answer different questions and now have different names:
          `renewalDue` is the six-month offer, `state` is how the card reads. */}
      {row.kind === 'FIREARM_LICENCE' &&
        row.confirmed &&
        (row.renewalDue || row.state === 'expired') && (
          <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-card)] p-3">
            <p className="text-sm font-medium">
              {row.state === 'expired'
                ? 'This one has expired'
                : 'Time to start the renewal'}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {/* ⚠️ THE 90-DAY DEADLINE IS THE USEFUL FACT HERE. Section 24(1)
                  requires the renewal application at least 90 days before
                  expiry, and section 24(4) keeps the licence valid until the
                  application is decided IF it was lodged in time. Somebody
                  who leaves it to the last month has lost that protection. */}
              {row.state === 'expired'
                ? 'Renewal must be applied for before a licence expires. Speak to your DFO about where this leaves you — we can still prepare the paperwork. '
                : 'SAPS asks for the application at least 90 days before the expiry date, and a licence lodged in time stays valid until the application is decided. '}
              We will open a section 24 renewal already carrying the licence
              number, the expiry and the firearm&rsquo;s details from this
              document. You write the part only you can — what you have
              actually done with it.
            </p>
            <button
              type="button"
              disabled={busy}
              className="mt-2 rounded bg-[var(--red)] px-3 py-1.5 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                setRenewErr(null);
                try {
                  const started = await licenceCentreApi.renew(token, row.id);
                  router.push(`/motivations/${started.motivationId}`);
                } catch (ex) {
                  setRenewErr(
                    ex instanceof LicenceApiError
                      ? ex.message
                      : 'We could not start that renewal just now.',
                  );
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Starting…' : 'Start the renewal'}
            </button>
            {renewErr && (
              <p className="mt-2 text-sm text-[var(--red)]">{renewErr}</p>
            )}
          </div>
        )}

      {editing && (
        <div className="mt-3">
          <ConfirmPanel
            token={token}
            id={row.id}
            proposed={{
              expiresOn: row.expiresOn,
              issuedOn: row.issuedOn,
              details: row.details,
              lowConfidence: [],
              derivedExpiry: row.derivedExpiry,
            }}
            cancelLabel="Cancel"
            /* THE WAY BACK. Somebody who tapped "I will do this later" on a
               batch-sorted document has no other route to correcting the type
               we chose for it. */
            kinds={KINDS}
            currentKind={row.kind}
            defaultTitle={row.title}
            // The stored answers, so re-opening shows what the member already
            // said rather than an empty box beside a cleared date.
            neverExpires={row.neverExpires}
            issuedOnUnknown={row.issuedOnUnknown}
            onDone={async () => {
              setEditing(false);
              await onChanged();
            }}
          />
        </div>
      )}

      {/* ── WHERE THIS DOCUMENT ALREADY IS ───────────────────────────────
          Renders nothing at all when the document is in no application, which
          is most of them — an empty "Used in" heading over nothing is worse
          than no heading. */}
      {usedIn.length > 0 && (
        <div className="mt-4 border-t border-[var(--border-divider)] pt-4">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Used in
          </p>
          <div className="flex flex-col gap-1.5">
            {usedIn.map((u) => (
              <Link
                key={u.motivationId}
                href={`/motivations/${u.motivationId}`}
                className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="shrink-0"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                <span className="gg-nums">{u.referenceNumber}</span>
                {u.annexure && <span>\u2014 Annexure {u.annexure}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {!editing && (
          /* ⚠️ A RED "Check the date" BUTTON ON A PHOTOGRAPH OF A SAFE. Red is
             this page's "you must do something" colour, and STATE_TONE keeps
             the kept-on-file rows neutral rather than amber precisely because
             amber reads as an outstanding errand. A red button undid that in
             one stroke, and named the wrong errand as well: what is worth
             looking at on a dateless document is the type we filed it as. */
          <button
            type="button"
            className={
              row.confirmed || row.state === 'no-expiry'
                ? 'underline'
                : 'rounded bg-[var(--red)] px-3 py-1.5 text-white hover:bg-[var(--red-hover)]'
            }
            onClick={() => setEditing(true)}
          >
            {row.state === 'no-expiry'
              ? row.confirmed
                ? 'Change the type or name'
                : 'Check what this is'
              : row.confirmed
                ? 'Change the date'
                : 'Check the date'}
          </button>
        )}
        {row.available && (
          <button
            type="button"
            className="underline"
            onClick={async () => {
              onError(null);
              // ⚠️ THE TAB OPENS FIRST, INSIDE THE CLICK. Safari judges a
              // popup by whether window.open happened in the click's own call
              // stack, and this one used to run after an await on a fetch —
              // so on Safari the View button did nothing at all, silently.
              //
              // ⚠️ AND NOT 'noopener', because that returns null by spec and
              // there would be no tab to fill. `opener` is nulled instead,
              // which is the protection the flag actually provides — and this
              // is a same-origin blob: URL of our own making regardless.
              const tab = window.open('', '_blank');
              if (tab) tab.opener = null;
              try {
                const url = await licenceCentreApi.fileBlobUrl(token, row.id);
                if (tab) {
                  tab.location.href = url;
                } else {
                  // Genuinely blocked. Hand the file over rather than lose it.
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'document';
                  a.click();
                }
                // The tab holds its own copy; ours would otherwise be pinned
                // for the life of this page.
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              } catch {
                tab?.close();
                onError('We could not open that document.');
              }
            }}
          >
            View
          </button>
        )}
        {/* ⚠️ NO REMINDER SWITCH ON A DOCUMENT NOTHING CAN BE SCHEDULED
            AGAINST. A ticked "Never expires" row carries a null expiresOn — a
            database CHECK sees to that — and the reminder sweep selects on
            `expiresOn: { not: null }`, so no stage has ever fired for one and
            none ever will. The "reminders off" marker was taken off the line
            above for precisely that reason; leaving the switch that sets it
            offers "Turn reminders on" over a reminder that cannot exist, which
            is the one promise this page may never make. It returns the moment
            the tick comes off and a date goes in. */}
        {row.state !== 'no-expiry' && (
          <button
            type="button"
            disabled={busy}
            className="underline disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              onError(null);
              try {
                await licenceCentreApi.mute(token, row.id, !row.remindersMuted);
                await onChanged();
              } catch {
                onError('We could not change that just now.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {row.remindersMuted ? 'Turn reminders on' : 'Turn reminders off'}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          className="text-[var(--red)] underline disabled:opacity-50"
          onClick={async () => {
            const ok = window.confirm(
              `Delete “${row.title}”?\n\nThis removes the document from our server for good. It cannot be undone.`,
            );
            if (!ok) return;
            setBusy(true);
            onError(null);
            try {
              await licenceCentreApi.remove(token, row.id);
              await onChanged();
            } catch {
              onError('We could not delete that just now.');
              setBusy(false);
            }
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
