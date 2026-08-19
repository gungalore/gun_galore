'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CredentialChoice } from '@/lib/motivations-api';

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
  emptyHint,
  onPick,
}: {
  choices: CredentialChoice[];
  /** What the member is choosing, in their words. */
  label: string;
  /** Shown instead when the vault holds nothing of this kind. */
  emptyHint: string;
  onPick: (values: Record<string, string>) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState('');

  if (choices.length === 0) {
    return (
      <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
        {emptyHint}{' '}
        <Link href="/licence-centre" className="underline">
          Keep it in your Licence Centre
        </Link>{' '}
        and it will fill this in for you.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <label className="block text-xs text-[var(--text-secondary)]">
        {label}
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
      </label>
      <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
        We read these off a photograph — check the value against the document
        itself.
      </p>
    </div>
  );
}
