'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
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
  const [kind, setKind] = useState<CredentialKind>('FIREARM_LICENCE');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    id: string;
    proposed: CredentialProposal;
  } | null>(null);

  const control =
    'rounded border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-primary)] ' +
    '[&>option]:bg-[var(--bg-card)] [&>option]:text-[var(--text-primary)] focus:border-[var(--border-hover)] focus:outline-none';

  if (confirming) {
    return (
      <ConfirmPanel
        token={token}
        id={confirming.id}
        proposed={confirming.proposed}
        onDone={async () => {
          setConfirming(null);
          setTitle('');
          await onAdded();
        }}
      />
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
        JPG, PNG, WebP or PDF, up to 10 MB. On an iPhone, choose the photo
        from your library rather than a file — iOS converts it for you.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className={control}
          value={kind}
          onChange={(e) => setKind(e.target.value as CredentialKind)}
          aria-label="Document type"
        >
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
        <input
          type="file"
          className="text-sm"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            // Checked HERE as well as on the server, so the answer is
            // immediate and NAMES the problem. The server's rejection is a
            // generic 400 by the time it reaches the browser.
            if (!ACCEPTED.includes(file.type)) {
              setErr(
                `We cannot read ${file.type || 'that file type'}. Use a JPG, PNG, WebP or PDF — on an iPhone, pick the photo from your library rather than from Files.`,
              );
              e.target.value = '';
              return;
            }
            if (file.size > 10 * 1024 * 1024) {
              setErr(
                `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB and the limit is 10 MB. A photo taken at a lower resolution will be well under it.`,
              );
              e.target.value = '';
              return;
            }
            setBusy(true);
            setErr(null);
            try {
              const created = await licenceCentreApi.create(
                token,
                kind,
                title,
                file,
              );
              setConfirming({ id: created.id, proposed: created.proposed });
            } catch (ex) {
              setErr(
                ex instanceof LicenceApiError
                  ? ex.message
                  : 'That upload did not work.',
              );
              // The row may have been committed and the response lost — the
              // vision read runs after the insert and can outlast the proxy's
              // patience. Refresh, or the document is invisible AND a retry
              // is refused as a duplicate, which contradicts the error we
              // just showed.
              await onAdded().catch(() => undefined);
            } finally {
              setBusy(false);
              // Re-picking the same file must re-fire onChange.
              e.target.value = '';
            }
          }}
        />
      </div>
      {busy && (
        <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
          Reading the document…
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
}: {
  token: () => Promise<string | null>;
  id: string;
  proposed: CredentialProposal;
  onDone: () => Promise<void>;
  /** "I will do this later" is right after an upload and wrong as a cancel. */
  cancelLabel?: string;
}) {
  const [expiresOn, setExpiresOn] = useState(proposed.expiresOn ?? '');
  const [issuedOn, setIssuedOn] = useState(proposed.issuedOn ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const control =
    'mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-hover)] focus:outline-none';

  return (
    <section className="mt-6 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-4">
      <p className="text-sm font-medium">Check the expiry date</p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {proposed.expiresOn
          ? 'We read this off your document. Check it against the document itself — a photograph can be misread, and every reminder is worked out from this date.'
          : 'We could not read a date off that one. Type it as it is printed on the document.'}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-[var(--text-secondary)]">Expires on</span>
          <input
            type="date"
            className={control}
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--text-secondary)]">
            Issued on (optional)
          </span>
          <input
            type="date"
            className={control}
            value={issuedOn}
            onChange={(e) => setIssuedOn(e.target.value)}
          />
        </label>
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
