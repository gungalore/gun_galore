'use client';

import { useAuth } from '@clerk/nextjs';
import DateField from '@/components/date-field';
import FilePickerButton from '@/components/file-picker-button';
import ScanButton from '@/components/scan/scan-button';
import { shapeForKind } from '@/lib/scan/shapes';
import { todayYmd, toIso } from '@/lib/date-picker-model';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import LicenceCentreMotivations from '@/components/licence-centre-motivations';
import {
  AddedCredential,
  CredentialKind,
  CredentialProposal,
  CredentialRow,
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
  // photograph is ever filed as SAFE_PHOTO_AJAR — and the classifier is
  // deliberately never confident about which of the four safe shots it is
  // looking at, so a wrong guess would be uncorrectable.
  //
  // They sit BELOW the credentials and above OTHER because the ordering is
  // the menu the member reads, and a licence is what most people are here to
  // file.
  'IDENTITY_DOCUMENT',
  'ADDRESS_CONFIRMATION',
  'EMPLOYMENT_CONFIRMATION',
  'SAFE_PHOTO_CLOSED',
  'SAFE_PHOTO_AJAR',
  'SAFE_PHOTO_BOLTS',
  'SAFE_INSTALLATION',
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
      'SAFE_PHOTO_CLOSED',
      'SAFE_PHOTO_AJAR',
      'SAFE_PHOTO_BOLTS',
      'SAFE_INSTALLATION',
      'SHOOTING_ACTIVITY_LOG',
    ],
  },
  { label: 'Anything else', kinds: ['OTHER'] },
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

  const refresh = useCallback(async () => {
    try {
      setRows(await licenceCentreApi.list(token));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
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
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Licence Centre</h1>
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
  const needDate = (rows ?? []).filter((r) => !r.confirmed && !r.neverExpires);
  const needFiling = (rows ?? []).filter(
    (r) => !r.confirmed && r.neverExpires,
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Licence Centre</h1>
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

      <AddPanel token={token} onAdded={refresh} />

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--text-tertiary-on-card)]">
          Your documents
        </h2>

        {loadFailed ? (
          <div className="mt-2 rounded border border-[var(--border)] p-4 text-sm">
            <p>We could not load your documents just now.</p>
            <button
              type="button"
              className="mt-2 rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-card-hover)]"
              onClick={() => void refresh()}
            >
              Try again
            </button>
          </div>
        ) : rows === null ? (
          <p className="mt-2 text-sm text-[var(--text-tertiary-on-card)]">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-tertiary-on-card)]">
            Nothing here yet. Add your first licence or competency certificate
            above.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {/* ⚠️ NOT `KINDS.filter(...)`. KINDS is the ADD menu, and the four
                association kinds were just removed from it — so grouping by it
                alone would make any row still holding a retired kind vanish
                from the member's own list entirely. The migration converts
                them, but "we think the migration ran" is not a good enough
                reason to be unable to see your own document. Menu order first,
                then anything else present. */}
            {[
              ...KINDS.filter((k) => rows.some((r) => r.kind === k)),
              ...[...new Set(rows.map((r) => r.kind))].filter(
                (k) => !KINDS.includes(k),
              ),
            ].map((k) => (
              <KindGroup
                key={k}
                kind={k}
                rows={rows.filter((r) => r.kind === k)}
                token={token}
                onChanged={refresh}
                onError={setError}
              />
            ))}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}
      </section>

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
  const [kind, setKind] = useState<CredentialKind | ''>('');
  const [title, setTitle] = useState('');
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
  const [queue, setQueue] = useState<AddedCredential[]>([]);
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
      const need = rows.filter((r) => !r.confirmed);
      if (!need.length) return;
      setQueue(
        need.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          // The phone path never asked them the type, so the confirm step
          // must — same as a batch-sorted desktop upload.
          autoFiled: true,
          confident: false,
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

  async function uploadFiles(picked: File[]) {
    if (!picked.length) return;

    // Checked HERE as well as on the server, so the answer is
    // immediate and NAMES the file. The server's rejection is a
    // generic 400 by the time it reaches the browser — and one
    // unusable file must not cost the whole pack a round trip.
    const failed: string[] = [];
    const files = picked.filter((f) => {
      if (!ACCEPTED.includes(f.type)) {
        failed.push(
          `${f.name}: we cannot read ${f.type || 'that file type'}`,
        );
        return false;
      }
      if (f.size > 10 * 1024 * 1024) {
        failed.push(
          `${f.name}: ${(f.size / 1024 / 1024).toFixed(1)} MB, over the 10 MB limit`,
        );
        return false;
      }
      return true;
    });

    if (!files.length) {
      setErr(
        `${failed.join(' · ')}. Use a JPG, PNG, WebP or PDF — on an iPhone, pick the photos from your library rather than from Files.`,
      );
      return;
    }

    setBusy(true);
    setErr(null);
    setProgress({ done: 0, total: files.length });

    // ONE AT A TIME. Each upload writes an encrypted file and makes a
    // vision call; firing eight at once would race the per-minute
    // limit and give no usable progress.
    const added: AddedCredential[] = [];
    for (const [i, file] of files.entries()) {
      try {
        // ONE file keeps the type the member picked. SEVERAL is a
        // folder, so each is named from its contents and checked in
        // the queue.
        // ⚠️ THE TYPE IS SENT ONLY AS AN OVERRIDE. Blank means the server
        // classifies with Haiku and reads the dates off the page, and the
        // confirm step then shows what it made of it. A folder was always
        // handled this way; there was never a reason one file should not be.
        added.push(
          await licenceCentreApi.create(
            token,
            files.length === 1 ? kind : '',
            files.length === 1 ? title : '',
            file,
          ),
        );
      } catch (ex) {
        // One bad file must not abandon the rest of the pack.
        failed.push(
          `${file.name}: ${
            ex instanceof LicenceApiError
              ? ex.message
              : 'did not upload'
          }`,
        );
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setBusy(false);
    setProgress(null);
    setErr(failed.length ? failed.join(' · ') : null);
    // ⚠️ THE UPLOAD RESPONSE CARRIES THE TICKS ITSELF NOW. It used to
    // return the proposal and stop, while the same call had already
    // stamped `neverExpires: true` on a photograph of a safe — so this
    // line re-read the entire list after every upload to learn something
    // the server had just decided. Taking the response at face value was
    // the fix; the round trip was the workaround.
    setQueue(added);
    // Always, not only on failure: a row may have been committed and
    // its response lost — the vision read runs after the insert and
    // can outlast the proxy's patience. Without this the document is
    // invisible AND a retry is refused as a duplicate, which
    // contradicts the error we just showed.
    await onAdded().catch(() => undefined);
  }

  if (queue.length) {
    const [current, ...rest] = queue;
    return (
      <div>
        {queue.length > 1 && (
          <p className="mt-6 text-sm text-[var(--text-secondary)]">
            {queue.length} documents left to check.
          </p>
        )}
        <ConfirmPanel
          /* ⚠️ KEYED ON THE DOCUMENT, OR THE PANEL NEVER FORGETS THE LAST ONE.
             Advancing the queue only swaps the props — React keeps the one
             instance sitting at this position — so everything the panel holds
             in state walked forward into the next document: the expiry, the
             issue date, the type, the name, and now the two ticks. It was
             already wrong with a date; the ticks made it destructive. Confirm a
             photograph of a safe and the firearm licence behind it in the queue
             opened with “Never expires” ticked, the expiry we had just read off
             it cleared and its box disabled, and one enabled button reading
             “That is right” — which filed the licence as a safe photograph,
             wiped the date and stamped confirmedAt. That is a licence no
             reminder can ever fire for again. */
          key={current.id}
          token={token}
          id={current.id}
          proposed={current.proposed}
          /* The type controls appear only where WE did the naming. Where the
             member picked the type themselves there is nothing to check. */
          kinds={current.autoFiled ? KINDS : undefined}
          currentKind={current.kind}
          uncertain={current.autoFiled === true && current.confident !== true}
          defaultTitle={current.title}
          neverExpires={current.neverExpires}
          issuedOnUnknown={current.issuedOnUnknown}
          onDone={async () => {
            setQueue(rest);
            if (!rest.length) setTitle('');
            await onAdded();
          }}
        />
        {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}
      </div>
    );
  }

  return (
    <section className="mt-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <p className="text-sm font-medium">Add a document</p>
      <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
        A photograph of the card or a PDF both work. Give it a name you will
        recognise — not the serial number.
      </p>
      {/* SAID BEFORE THE PICKER, NOT AFTER THE REJECTION. An iPhone photo is
          often HEIC, which we do not accept — the format caused oversized
          uploads — and a full-resolution photo can exceed the limit. Both
          were previously an opaque "that upload did not work". */}
      <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
        Photograph it or pick a file and we read the document itself — what
        kind it is, and the dates on it — then show you what we made of it to
        check. Set the type yourself only if you want to overrule us. JPG,
        PNG, WebP or PDF, up to 10 MB each; pick a whole folder at once if you
        have them together. On an iPhone, choose the photos from your library
        rather than a file — iOS converts them for you.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className={control}
          value={kind}
          onChange={(e) => setKind(e.target.value as CredentialKind | '')}
          aria-label="Document type"
          title="Leave this alone and we read the document to work out what it is."
        >
          <option value="">Work it out for me</option>
          {KIND_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          className={`${control} flex-1`}
          placeholder="What you call it — “my .308”"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Document name"
        />
      </div>

      <div className="mt-3">
        {/* The camera and the picker are peers, not a primary and a fallback.
            A licence card photographed straight is what the reader wants; a
            PDF the association emailed is equally valid and needs no camera
            at all. */}
        <ScanButton
          // Follows the picker above: choose "competency certificate" and the
          // guide is a card, choose "proof of address" and it is an A4 sheet.
          // ⚠️ A4 WHILE NOTHING IS CHOSEN. The aim box is a guide, never a
          // filter — and "work it out for me" is now the default, so most
          // uploads arrive with no declared type at all.
          shape={kind ? shapeForKind(kind) : 'a4'}
          title="Photograph the document"
          onFiles={uploadFiles}
          disabled={busy}
          // ⚠️ ON A DESKTOP THE WEBCAM IS NOT THE ANSWER. It focuses at half a
          // metre and cannot resolve a licence serial, so the phone already in
          // their pocket is offered first and the webcam is demoted.
          handoff={{ dest: 'licence-centre' }}
          kind={kind || undefined}
          // ⚠️ THIS WAS STILL CALLING onAdded, AND queueHandoffArrivals WAS
          // DEAD CODE — eslint's no-unused-vars is what surfaced it. The whole
          // of the "recognition is broken" fix documented on that function was
          // written and never wired in: a phone hand-off refreshed the list
          // and showed the member nothing it had read, which is the exact
          // behaviour it was written to end.
          onHandoffArrived={() => void queueHandoffArrivals()}
          fallback={
            <FilePickerButton
              accept="image/jpeg,image/png,image/webp,application/pdf"
              // A FOLDER GOES IN AT ONCE. Picking one file at a time and
              // naming each is the slowest possible way to hand over
              // paperwork the member already has together.
              multiple
              disabled={busy}
              onFiles={uploadFiles}
            >
              Choose files
            </FilePickerButton>
          }
        />
      </div>
      {busy && (
        <p
          className="mt-2 text-xs text-[var(--text-tertiary-on-card)]"
          aria-live="polite"
        >
          {progress && progress.total > 1
            ? `Reading document ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : 'Reading the document…'}
        </p>
      )}
      {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}
    </section>
  );
}

// ── the safety rail ─────────────────────────────────────────────────

function ConfirmPanel({
  token,
  id,
  proposed,
  onDone,
  cancelLabel = 'I will do this later',
  kinds,
  currentKind,
  uncertain,
  defaultTitle,
  neverExpires: neverExpiresInitial,
  issuedOnUnknown: issuedOnUnknownInitial,
}: {
  token: () => Promise<string | null>;
  id: string;
  proposed: CredentialProposal;
  onDone: () => Promise<void>;
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
   * ⚠️ THE CURRENT TYPE HAS TO BE ON THE MENU. `kinds` is the ADD menu, and
   * the eight kept-on-file kinds are deliberately not on it — so a safe
   * photograph filed as SAFE_PHOTO_CLOSED rendered a select showing "Firearm
   * licence", the first option, while the state underneath still held
   * SAFE_PHOTO_CLOSED. It displayed one type and would have posted another,
   * and a member who never touched the control would never have known.
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
          onClick={() => void onDone()}
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

// ── one kind, collapsed ─────────────────────────────────────────────

/**
 * All the documents of one type, behind a header that can be folded away.
 *
 * ⚠️ IT OPENS ON WHAT NEEDS SOMETHING. A member with eight documents wants
 * the two that are expiring, not a tidy filing cabinet — so a group holding
 * anything unconfirmed, expiring or expired starts open and says so on its
 * header, and the settled ones start closed. Collapsing everything by default
 * would be neater and would hide the only rows that matter.
 */
function KindGroup({
  kind,
  rows,
  token,
  onChanged,
  onError,
}: {
  kind: CredentialKind;
  rows: CredentialRow[];
  token: () => Promise<string | null>;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const needsEye = rows.filter(
    (r) => !r.confirmed || r.state === 'expiring' || r.state === 'expired',
  );
  const [open, setOpen] = useState(needsEye.length > 0);

  // The worst thing in the group decides the header's colour — one glance at
  // a folded list has to be able to say "something in here is wrong".
  const worst: CredentialRow['state'] = rows.some((r) => r.state === 'expired')
    ? 'expired'
    : rows.some((r) => r.state === 'expiring')
      ? 'expiring'
      : // ⚠️ 'unknown' USED TO COVER TWO DIFFERENT THINGS — a date nobody had
        // checked, and a document carrying no expiry at all — and the comment
        // here said so, because there was no third state to put the second one
        // in. There is now. 'unknown' means outstanding; 'no-expiry' means
        // answered, and answered "there is no date".
        rows.some((r) => r.state === 'unknown')
        ? 'unknown'
        : // ⚠️ ABOVE 'valid', NEVER FALLING THROUGH TO IT. A folder of
          // photographs of a gun safe has nothing in it that could be in date,
          // and a header reading "All in date" over one is exactly the quiet
          // reassurance the comment below refuses to give. It sits below
          // 'unknown' because nothing about it is outstanding — a mixed folder
          // reads "Kept on file", which understates the dated rows and
          // over-promises about none of them.
          rows.some((r) => r.state === 'no-expiry')
          ? 'no-expiry'
          : 'valid';
  const tone = STATE_TONE[worst];

  const toCheck = rows.filter((r) => !r.confirmed).length;
  const summary =
    toCheck > 0
      ? `${toCheck} to check`
      : worst === 'expired'
        ? 'One has expired'
        : worst === 'expiring'
          ? 'Renewal coming up'
          : // ⚠️ NOT "all in date" WHEN NOTHING HAS A DATE. Saying a folder of
            // documents is in date when none of them carries an expiry is the
            // kind of quiet reassurance this module must never give.
            worst === 'unknown'
            ? 'Date not confirmed'
            : worst === 'no-expiry'
              ? 'Kept on file'
              : 'All in date';

  return (
    <div
      className="rounded border"
      style={{ borderColor: tone.line, background: tone.wash }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          aria-hidden
          className="text-xs"
          style={{
            display: 'inline-block',
            transition: 'transform 120ms',
            transform: open ? 'rotate(90deg)' : 'none',
            color: 'var(--text-tertiary-on-card)',
          }}
        >
          ▶
        </span>
        <span className="flex-1 text-sm font-medium">{KIND_LABELS[kind]}</span>
        <span className="text-xs" style={{ color: tone.colour }}>
          {summary}
        </span>
        <span className="text-xs text-[var(--text-tertiary-on-card)]">
          {rows.length}
        </span>
      </button>

      {open && (
        <ul className="space-y-3 border-t border-[var(--border-divider)] p-3">
          {rows.map((r) => (
            <CredentialCard
              key={r.id}
              row={r}
              token={token}
              onChanged={onChanged}
              onError={onError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── one stored document ─────────────────────────────────────────────

function CredentialCard({
  row,
  token,
  onChanged,
  onError,
}: {
  row: CredentialRow;
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
  // "in your Licence Centre". The endpoint accepted a late confirm the whole
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
    <li
      className="rounded border p-3"
      style={{ borderColor: tone.line, background: tone.wash }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          {/* ⚠️ WE NAME IT, THEY OWN THE NAME. A firearm licence is titled
              make + calibre off the document — "Howa 6.5 Creedmoor" — because
              six rows reading "Firearm licence" cannot be told apart. But
              what somebody calls their own rifle is theirs to decide, and our
              reading is only as good as the photograph. The pen edits in
              place; it never moves the row or opens a dialog. */}
          {renaming ? (
            <input
              autoFocus
              className="w-full rounded border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-1 text-sm font-medium"
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
            <p className="flex items-center gap-1.5 font-medium">
              <span className="truncate">{row.title}</span>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-[var(--text-tertiary-on-card)] hover:text-[var(--text-primary)]"
                aria-label={`Rename ${row.title}`}
                title="Rename"
                onClick={() => {
                  setDraftName(row.title);
                  setRenaming(true);
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
                </svg>
              </button>
            </p>
          )}
          <p className="text-xs text-[var(--text-tertiary-on-card)]">
            {KIND_LABELS[row.kind]}
            {row.coversKinds.length > 0 && (
              // ⚠️ SAYING SO IS THE POINT. Without it a member looking for
              // their letter of good standing sees no such row, and uploads a
              // second copy of the certificate they have already given us.
              <>
                {' · also counts as '}
                {row.coversKinds.map((k) => KIND_LABELS[k]).join(' and ')}
              </>
            )}
          </p>
          {nextStep && (
            // What is actually standing between this row and settled, named.
            // "Needs checking" tells somebody nothing about what to do next.
            <p className="mt-1 text-xs" style={{ color: tone.colour }}>
              {nextStep}
            </p>
          )}
        </div>
        <span className="text-xs font-medium" style={{ color: tone.colour }}>
          {tone.label}
        </span>
      </div>

      {/* ⚠️ "Expires —" IS NOT A FACT, IT IS A BLANK. On a document the member
          has told us never expires it read as a date we had failed to find,
          over the em dash formatDate returns for null — and the "reminders
          off" marker beside it describes a reminder that could never have
          fired. Say what is true instead, and show the issue date where we
          have one: a proof of address is judged on how recent it is, and that
          is the only date it carries. */}
      {row.state === 'no-expiry' ? (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {row.issuedOn
            ? `No expiry date · issued ${formatDate(row.issuedOn)}`
            : 'No expiry date — kept on file'}
        </p>
      ) : (
        <p className="mt-2 text-sm">
          <span className="text-[var(--text-secondary)]">Expires </span>
          <span className="font-medium">{formatDate(row.expiresOn)}</span>
          {row.remindersMuted && (
            <span className="ml-2 text-xs text-[var(--text-tertiary-on-card)]">
              reminders off
            </span>
          )}
        </p>
      )}

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
