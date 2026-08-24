'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { motivationsApi } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// ASKING THE PREVIOUS OWNER FOR THEIR CONSENT.
//
// The applicant's side of the flow: a name, a number, and a send. Everything
// else happens on the seller's phone.
//
// ⚠️ IT SITS UNDER "Where this firearm is coming from", BESIDE THE UPLOAD
// CONTROLS, not instead of them. That row takes either a dealer invoice or the
// current owner's letter, and this is a way of producing the second without
// anybody printing anything. A dealer buyer ignores it and uploads their
// invoice on the same row; nothing here is demanded of them.
//
// So the copy OFFERS rather than instructs. It cannot assume the reader is
// buying privately, because the row it lives on serves both routes.
//
// ⚠️ AND IT SENDS THE FIREARM WITH THE INVITE. What the seller signs for is
// snapshotted the moment the link leaves, not read back at signing time: the
// make and serial live on the application where the applicant can edit them
// afterwards, and a consent that silently follows an edit is a consent to
// something the seller never saw.
// ────────────────────────────────────────────────────────────────────

export interface SellerConsentProps {
  motivationId: string;
  /** The applicant, as the seller will see them named in the declaration. */
  applicantName: string;
  /** The firearm, straight off the answers. Sent verbatim. */
  firearm: Record<string, string | undefined>;
}

export default function MotivationSellerConsent({
  motivationId,
  applicantName,
  firearm,
}: SellerConsentProps) {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ THE SERIAL HAS NOWHERE ELSE TO COME FROM ON THE DEFAULT PATH, WHICH
  // MADE THIS WHOLE PANEL UNREACHABLE. The server refuses an invite without a
  // serial — correctly, since a consent that does not name the firearm gives a
  // DFO nothing to match. But the only serial in the registry, firearm_serial,
  // is formOnly: it is hidden unless the applicant opted into having the SAPS
  // 271 filled in, and NOT ANSWERING THAT QUESTION IS THE DEALER PATH, which
  // is the default. So on the ordinary route the refusal named a box that was
  // not on screen anywhere. Asking for it here is the smallest fix that does
  // not weaken the gate: the applicant buying privately can see the firearm.
  const known = (firearm.serial ?? '').trim();
  const needsSerial = !known || known.toUpperCase() === 'NONE';
  const serialToSend = needsSerial ? serial.trim() : known;
  // Make is a normal required field in "The firearm", so it has a home already
  // — point at it rather than duplicating the question down here.
  const makeMissing = !(firearm.make ?? '').trim();

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await motivationsApi.inviteSellerConsent(getToken, motivationId, {
        name,
        phone,
        applicantName,
        firearm: { ...firearm, serial: serialToSend },
      });
      setSent(true);
    } catch (e) {
      // ⚠️ THE SERVER'S WORDS, NOT OURS. It refuses by name — "fill in the
      // firearm's make and at least one serial number" — and replacing that
      // with "something went wrong" would leave the applicant guessing at a
      // problem we already diagnosed.
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'We could not send that. Check the number and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] p-4">
        <p className="text-sm font-semibold">The link is on its way</p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {name} has been sent a link to give their consent and photograph
          their licence. It works for 48 hours. You will see their signed
          consent in your pack once they have completed it.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-3 text-xs underline text-[var(--text-secondary)]"
        >
          Send it again, or to a different number
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] p-4">
      <p className="text-sm font-semibold">
        Buying from a private owner?
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Then it is their letter you need here, and you do not have to chase a
        signed page. Send them a link and they consent on their own phone —
        about two minutes, including photographs of their licence. Their signed
        consent comes straight into your pack. Buying from a dealer? Ignore
        this and attach their invoice above.
      </p>

      <label className="mt-3 block text-xs text-[var(--text-secondary)]">
        Their name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>
      <label className="mt-2 block text-xs text-[var(--text-secondary)]">
        Their mobile number
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="082 000 0000"
          className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>

      {needsSerial && (
        <label className="mt-2 block text-xs text-[var(--text-secondary)]">
          The firearm&rsquo;s serial number
          <input
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
          />
          <span className="mt-1 block text-[var(--text-tertiary)]">
            The consent has to name the firearm it is about, so the owner can
            check it is theirs before signing. Ask them for it if you do not
            have it in front of you.
          </span>
        </label>
      )}

      {/* ⚠️ TELL THEM TO SPEAK TO THE SELLER FIRST. A stranger receiving an
          unexplained SMS about a firearm licence is a stranger who ignores it,
          and the applicant then waits on a link that was never going to move. */}
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        Speak to them first so they know it is coming.
      </p>

      {/* Caught here rather than at the server: the make lives in "The
          firearm" and the applicant needs telling where to go, not a refusal. */}
      {makeMissing && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Fill in the firearm&rsquo;s make under &ldquo;The firearm&rdquo;
          first &mdash; the owner is consenting to one specific firearm.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}

      <button
        type="button"
        onClick={send}
        disabled={
          busy ||
          name.trim().length < 2 ||
          phone.trim().length < 9 ||
          makeMissing ||
          !serialToSend
        }
        className="mt-3 w-full rounded-[var(--radius)] bg-[var(--red)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send them the link'}
      </button>
    </div>
  );
}
