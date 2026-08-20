'use client';

import { useAuth } from '@clerk/nextjs';
import DateField from '@/components/date-field';
import FilePickerButton from '@/components/file-picker-button';
import ScanButton from '@/components/scan/scan-button';
import { shapeForKind } from '@/lib/scan/shapes';
import { todayYmd, toIso } from '@/lib/date-picker-model';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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

const KINDS: CredentialKind[] = [
  'FIREARM_LICENCE',
  'COMPETENCY_CERTIFICATE',
  'DEDICATED_STATUS',
  'DEDICATED_HUNTER',
  'GOOD_STANDING',
  'PROFESSIONAL_HUNTER',
  'PROFICIENCY',
  'OTHER',
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

  const unconfirmed = (rows ?? []).filter((r) => !r.confirmed);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Licence Centre</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        Keep your licences and certificates in one place, and we will tell you
        when a renewal is coming up. They are encrypted on our own server and
        nobody at All Outdoor can read them.
      </p>

      {unconfirmed.length > 0 && (
        <div className="mt-4 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3 text-sm">
          <p className="font-medium">
            {unconfirmed.length === 1
              ? 'One document still needs its date checked'
              : `${unconfirmed.length} documents still need their dates checked`}
          </p>
          <p className="mt-1 text-[var(--text-secondary)]">
            We read the date off the photograph, but nothing is scheduled until
            you have confirmed it is right.
          </p>
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
          <ul className="mt-2 space-y-3">
            {rows.map((r) => (
              <CredentialCard
                key={r.id}
                row={r}
                token={token}
                onChanged={refresh}
                onError={setError}
              />
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}
      </section>

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
          token={token}
          id={current.id}
          proposed={current.proposed}
          /* The type controls appear only where WE did the naming. Where the
             member picked the type themselves there is nothing to check. */
          kinds={current.autoFiled ? KINDS : undefined}
          currentKind={current.kind}
          uncertain={current.autoFiled === true && current.confident !== true}
          defaultTitle={current.title}
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
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
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
          onHandoffArrived={() => void onAdded()}
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
}) {
  // ⚠️ THE DERIVED DATE PREFILLS THE BOX, and the panel says where it came
  // from. It is still unconfirmed like everything else here, so nothing drives
  // a reminder until the member has looked at it.
  const [expiresOn, setExpiresOn] = useState(
    proposed.expiresOn ?? proposed.derivedExpiry?.on ?? '',
  );
  const [issuedOn, setIssuedOn] = useState(proposed.issuedOn ?? '');
  const [kind, setKind] = useState<CredentialKind | ''>(currentKind ?? '');
  const [title, setTitle] = useState(defaultTitle ?? '');
  const showKind = Boolean(kinds && currentKind);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const control =
    'mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-hover)] focus:outline-none';

  return (
    <section className="mt-6 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-4">
      <p className="text-sm font-medium">
        {showKind ? 'Check this document' : 'Check the expiry date'}
      </p>
      {/* ⚠️ SAY WHAT WE ACTUALLY READ. This used to talk only about the
          expiry, so a competency certificate whose issue date, number, holder
          and coverage all read perfectly — and which simply does not print an
          expiry — was greeted with "we could not read a date off that one".
          True about the one field it meant, and wrong about the document. */}
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {proposed.expiresOn
          ? 'We read this off your document. Check it against the document itself — a photograph can be misread, and every reminder is worked out from this date.'
          : proposed.derivedExpiry
            ? proposed.derivedExpiry.why
            : proposed.issuedOn || Object.keys(proposed.details).length > 0
              ? 'We read what is below off your document, but it does not print an expiry date we could find. Type it if it has one — every reminder is worked out from it.'
              : 'We could not read anything off that one. Fill it in as it is printed on the document.'}
      </p>

      {/* WHAT WE MADE OF IT. The type is not cosmetic: a licence filed as
          something else is never offered a renewal, and reminder copy is
          written per type. */}
      {showKind && kinds && (
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
              {kinds.map((k) => (
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
          <span className="text-[var(--text-secondary)]">Expires on</span>
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
              required
            />
          </div>
        </div>
        <div className="block text-sm">
          <span className="text-[var(--text-secondary)]">
            Issued on (optional)
          </span>
          <div>
            {/* No Clear button here on purpose: confirmExpiry writes
                issuedOn: parseIsoDate(issuedOn ?? null) unconditionally, so a
                cleared field silently wipes a date we read off the document.
                Until that is guarded server-side, do not make the wipe a
                one-tap action. */}
            <DateField
              label="Issued on"
              value={issuedOn}
              onChange={setIssuedOn}
              className={control}
              focusYear={todayYmd().y - 2}
              max={toIso(todayYmd())}
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
          disabled={busy || !expiresOn}
          className="rounded bg-[var(--red)] px-4 py-2 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await licenceCentreApi.confirm(
                token,
                id,
                expiresOn,
                issuedOn || undefined,
                showKind ? kind || undefined : undefined,
                showKind ? title || undefined : undefined,
              );
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
          {busy ? 'Saving…' : 'That date is right'}
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
        Until a date is confirmed we do not schedule anything against it.
      </p>
      {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}
    </section>
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

  return (
    <li
      className="rounded border p-3"
      style={{ borderColor: tone.line, background: tone.wash }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-medium">{row.title}</p>
          <p className="text-xs text-[var(--text-tertiary-on-card)]">
            {KIND_LABELS[row.kind]}
          </p>
        </div>
        <span className="text-xs font-medium" style={{ color: tone.colour }}>
          {tone.label}
        </span>
      </div>

      <p className="mt-2 text-sm">
        <span className="text-[var(--text-secondary)]">Expires </span>
        <span className="font-medium">{formatDate(row.expiresOn)}</span>
        {row.remindersMuted && (
          <span className="ml-2 text-xs text-[var(--text-tertiary-on-card)]">
            reminders off
          </span>
        )}
      </p>

      {/* THE LOOP. Offered only where it makes sense: a firearm licence whose
          date has been confirmed and which is close enough to matter. On
          anything else the button would be a dead end the backend refuses. */}
      {/* Offered for ANY confirmed firearm licence, not only one already
          inside the reminder window. SA licences run five or ten years, so
          gating on "expiring" meant that for a real licence uploaded today
          the module's headline feature — and where the R199 sits — was simply
          not on screen, with nothing saying why. The urgency belongs in the
          words, not in whether the button exists. */}
      {row.kind === 'FIREARM_LICENCE' && row.confirmed && (
          <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-card)] p-3">
            <p className="text-sm font-medium">
              {row.state === 'expired'
                ? 'This one has expired'
                : row.state === 'expiring'
                  ? 'Time to start the renewal'
                  : 'Renewing this one later?'}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {row.state === 'valid'
                ? 'We will remind you closer to the time. You can start it now if you would rather — '
                : ''}
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
            }}
            cancelLabel="Cancel"
            /* THE WAY BACK. Somebody who tapped "I will do this later" on a
               batch-sorted document has no other route to correcting the type
               we chose for it. */
            kinds={KINDS}
            currentKind={row.kind}
            defaultTitle={row.title}
            onDone={async () => {
              setEditing(false);
              await onChanged();
            }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {!editing && (
          <button
            type="button"
            className={
              row.confirmed
                ? 'underline'
                : 'rounded bg-[var(--red)] px-3 py-1.5 text-white hover:bg-[var(--red-hover)]'
            }
            onClick={() => setEditing(true)}
          >
            {row.confirmed ? 'Change the date' : 'Check the date'}
          </button>
        )}
        {row.available && (
          <button
            type="button"
            className="underline"
            onClick={async () => {
              onError(null);
              try {
                const url = await licenceCentreApi.fileBlobUrl(token, row.id);
                window.open(url, '_blank', 'noopener');
                // The tab holds its own copy; ours would otherwise be pinned
                // for the life of this page.
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              } catch {
                onError('We could not open that document.');
              }
            }}
          >
            View
          </button>
        )}
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
