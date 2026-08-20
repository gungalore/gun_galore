'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CredentialChoice } from '@/lib/motivations-api';
import ScanButton from '@/components/scan/scan-button';
import FilePickerButton from '@/components/file-picker-button';
import { shapeForKind } from '@/lib/scan/shapes';

// ────────────────────────────────────────────────────────────────────
// "OR TAKE IT OFF ONE OF MY DOCUMENTS."
//
// The offer panel above these fields decides FOR the applicant: it fills the
// first vault document that can answer a slot and stops. That is right when
// somebody holds one competency certificate. It is wrong the moment they hold
// two — a renewed one and the expired original, a handgun competency and a
// rifle one, SAGA membership and NATSHOOT — and then the only correct
// behaviour is to ask.
//
// ⚠️ A PICK FILLS A WHOLE GROUP, NOT ONE BOX. A dedicated-status card carries
// the association's name and the membership number, and they are only true
// as a pair. Offering them as two independent dropdowns invites somebody with
// two associations to put one body's name against the other's number — a
// false statement on a section 16 application, made by accident, by a member
// doing their best.
// ────────────────────────────────────────────────────────────────────

export default function CredentialPicker({
  choices,
  label,
  photographLabel,
  uploadKind,
  motivationId,
  onUpload,
  onPick,
}: {
  choices: CredentialChoice[];
  /** What the member is choosing, in their words. */
  label: string;
  /** The button that photographs the document this field comes off. */
  photographLabel: string;
  /** Which upload kind a photograph taken here should be filed as. */
  uploadKind: string;
  motivationId: string;
  /** Files the photograph and reads the value off it. */
  onUpload: (kind: string, file: File) => Promise<void>;
  onPick: (values: Record<string, string>) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ⚠️ PHOTOGRAPH IT RIGHT HERE. The dropdown only helps somebody who has
  // already put the certificate in their Licence Centre — and the operator,
  // looking at this field with an empty vault, saw a sentence telling him to
  // go and do that somewhere else. That is not an answer to "fill this in
  // from the picture taken"; it is a redirect. The certificate is in his hand
  // NOW, so the camera belongs on this field, and what it reads off the
  // photograph fills the box. It lands in the pack as an annexure at the same
  // time, which he needed anyway.
  const camera = (
    <div className="mt-2">
      <ScanButton
        shape={shapeForKind(uploadKind)}
        title={photographLabel}
        kind={uploadKind}
        label={busy ? 'Reading…' : photographLabel}
        disabled={busy}
        handoff={{ dest: 'motivation', motivationId }}
        onFiles={async (files) => {
          const file = files[0];
          if (!file) return;
          setBusy(true);
          setErr(null);
          try {
            await onUpload(uploadKind, file);
          } catch {
            setErr('That upload did not work.');
          } finally {
            setBusy(false);
          }
        }}
        fallback={
          <FilePickerButton
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={busy}
            onFiles={async (files) => {
              const file = files[0];
              if (!file) return;
              setBusy(true);
              setErr(null);
              try {
                await onUpload(uploadKind, file);
              } catch {
                setErr('That upload did not work.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Reading…' : 'Upload'}
          </FilePickerButton>
        }
      />
      {err && <p className="mt-1 text-xs text-[var(--red)]">{err}</p>}
    </div>
  );

  return (
    <div className="mt-2">
      {camera}
      {/* ⚠️ THE SELECT IS ALWAYS HERE, disabled when there is nothing in it.
          It used to disappear on an empty list — and an absent control is
          indistinguishable from one that was never built. The operator asked
          for this dropdown three times while looking straight at the spot it
          should occupy, because his vault happened to hold no competency
          certificate. Saying "nothing saved yet" answers that; rendering
          nothing does not. */}
      <label className="mt-2 block text-xs text-[var(--text-secondary)]">
        {label}
        {choices.length === 0 ? (
          <select
            className="gg-datecell mt-1 block w-full rounded border px-2 py-2 text-sm"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-inset)',
              color: 'var(--text-tertiary-on-card)',
            }}
            disabled
            value=""
          >
            <option value="">Nothing saved yet — photograph one above</option>
          </select>
        ) : (
        <select
          className="gg-datecell mt-1 block w-full rounded border px-2 py-2 text-sm"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-inset)',
            color: 'var(--text-primary)',
          }}
          value={picked}
          onChange={(e) => {
            const id = e.target.value;
            setPicked(id);
            const c = choices.find((x) => x.credentialId === id);
            if (c) void onPick(c.values);
          }}
        >
          <option value="">Choose a document…</option>
          {choices.map((c) => (
            <option key={c.credentialId} value={c.credentialId}>
              {c.title}
              {/* The expiry is how somebody tells a renewed certificate from
                  the expired original it replaced — which is the single most
                  likely reason there are two in the list. */}
              {c.expiresOn ? ` — expires ${c.expiresOn}` : ''}
            </option>
          ))}
        </select>
        )}
      </label>
      <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
        {choices.length === 0 ? (
          <>
            Photograph it above, or keep it in your{' '}
            <Link href="/licence-centre" className="underline">
              Licence Centre
            </Link>{' '}
            and it appears here on every application.
          </>
        ) : (
          'We read these off a photograph — check the value against the document itself.'
        )}
      </p>
    </div>
  );
}
