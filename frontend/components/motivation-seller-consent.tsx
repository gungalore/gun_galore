'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { motivationsApi } from '@/lib/motivations-api';

/** Card firearm keys → how the buyer sees them in the adopt prompt. */
const ADOPT_LABELS: [string, string][] = [
  ['firearm_make', 'Make'],
  ['firearm_model', 'Model'],
  ['firearm_type', 'Type'],
  ['firearm_calibre', 'Calibre'],
  ['firearm_serial', 'Serial number'],
];

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
  /**
   * Adopt the firearm the seller's card records into the application.
   *
   * ⚠️ MUST GO THROUGH THE PAGE'S OWN `answers` STATE, not a direct API write.
   * The motivation page autosaves its in-memory answers; a value written to the
   * server behind its back is overwritten by the very next autosave. So the
   * page implements this with setAnswer, and the card details survive.
   */
  onAdopt?: (fields: Record<string, string>) => void;
}

export default function MotivationSellerConsent({
  motivationId,
  applicantName,
  firearm,
  onAdopt,
}: SellerConsentProps) {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The live state of the invite, read back from the server — this is what
  // lets the panel move past "sent" to "signed", and hand over the card
  // firearm. Nothing read the result back before; the panel could only ever
  // say it had sent the link.
  const [status, setStatus] = useState<
    'NONE' | 'INVITED' | 'COMPLETED' | 'DECLINED'
  >('NONE');
  const [cardFirearm, setCardFirearm] = useState<Record<string, string> | null>(
    null,
  );
  const [adopted, setAdopted] = useState(false);
  const [frontId, setFrontId] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await motivationsApi.sellerConsentStatus(getToken, motivationId);
      setStatus(r.status);
      setCardFirearm(r.cardFirearm);
      setFrontId(r.licenceFrontUploadId);
    } catch {
      /* fail-soft: the send form still works without a status read */
    }
  }, [getToken, motivationId]);

  // ⚠️ THE PHOTOGRAPH THE DETAILS ARE CHECKED AGAINST.
  //
  // Operator, 2026-08-24: "the applicant can just double check visually with
  // the picture of the license that came back from the seller."
  //
  // Adopting is the applicant putting these details on an application they
  // sign, and our transcription of the card is the step that can be wrong — so
  // checking the text against our own text proves nothing. This is the card.
  //
  // ⚠️ A BLOB, NOT A src=. The route needs an Authorization header and the
  // bytes are decrypted per request, so <img src> cannot reach it. The URL is
  // ours to revoke — leaving it would pin the image for the life of the tab.
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!frontId) return;
    let url: string | null = null;
    let live = true;
    void motivationsApi
      .uploadBlobUrl(getToken, motivationId, frontId)
      .then((u) => {
        url = u;
        if (live) setFrontUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => {
        /* fail-soft: the details still adopt without the picture */
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [frontId, getToken, motivationId]);

  // On mount, and — while we are still waiting on the seller — every 30s, so
  // the buyer sees "signed" without reloading. Stops polling once resolved.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status !== 'INVITED') return;
    const t = setInterval(() => void refreshStatus(), 30_000);
    return () => clearInterval(t);
  }, [status, refreshStatus]);

  // What the form already knows, joined the same way the server would. Shown
  // as the placeholder so an applicant who has filled the firearm section can
  // just send, and typed over by anyone who would rather say it differently.
  const knownLabel = [firearm.make, firearm.model, firearm.calibre]
    .map((v) => (v ?? '').trim())
    .filter((v) => v && v.toUpperCase() !== 'NONE')
    .join(' ');
  const labelToSend = label.trim() || knownLabel;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await motivationsApi.inviteSellerConsent(getToken, motivationId, {
        name,
        phone,
        applicantName,
        firearm: { ...firearm, label: labelToSend },
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

  // ── Signed. The government card is now the source of truth for the firearm,
  //    and the buyer confirms it into their own application. ──────────────
  if (status === 'COMPLETED') {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] p-4">
        <p className="text-sm font-semibold text-[var(--success)]">
          The owner has signed
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Their signed consent and a copy of their licence are in your pack.
        </p>

        {cardFirearm && onAdopt && !adopted && (
          <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] p-3">
            <p className="text-xs font-semibold">
              Their licence card records this firearm as:
            </p>
            <dl className="mt-2 text-sm">
              {ADOPT_LABELS.filter(([k]) => cardFirearm[k]).map(([k, label]) => (
                <div key={k} className="flex justify-between gap-3 py-0.5">
                  <dt className="text-[var(--text-secondary)]">{label}</dt>
                  <dd className="text-right font-medium">{cardFirearm[k]}</dd>
                </div>
              ))}
            </dl>
            {/* The card itself, under the details read off it. Checking our
                text against our text proves nothing; this is the document. */}
            {frontUrl && (
              <figure className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frontUrl}
                  alt="The front of the owner’s licence card, as they photographed it"
                  className="w-full rounded-[var(--radius)] border border-[var(--border)]"
                />
                <figcaption className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Their licence, as they photographed it. Check the details
                  above against it before you use them.
                </figcaption>
              </figure>
            )}
            <p className="mt-2 text-xs text-[var(--text-tertiary)]">
              This is the official SAPS record for the firearm. Using it makes
              sure your application matches the card exactly.
            </p>
            <button
              type="button"
              onClick={() => {
                onAdopt(cardFirearm);
                setAdopted(true);
              }}
              className="mt-3 w-full rounded-[var(--radius)] bg-[var(--red)] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Use these details in my application
            </button>
          </div>
        )}

        {adopted && (
          <p className="mt-3 text-xs text-[var(--success)]">
            Added to your application. Check the firearm section — you can still
            edit anything there.
          </p>
        )}
      </div>
    );
  }

  if (status === 'DECLINED') {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] p-4">
        <p className="text-sm font-semibold">The owner declined</p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          They did not agree to the transfer on the link. If that is a mistake,
          speak to them and send it again.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setStatus('NONE');
          }}
          className="mt-3 text-xs underline text-[var(--text-secondary)]"
        >
          Send a new link
        </button>
      </div>
    );
  }

  if (sent || status === 'INVITED') {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] p-4">
        <p className="text-sm font-semibold">Waiting on the owner</p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {(name || 'They').trim()} {name ? 'has' : 'have'} been sent a link to
          give their consent and photograph their licence. It works for 48
          hours. Their signed consent — and the firearm exactly as their card
          records it — comes straight into your application once they finish.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setStatus('NONE');
          }}
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

      {/* ⚠️ A NAME FOR THE FIREARM, NOT ITS PARTICULARS.
        *
        * This box used to ask for the SERIAL NUMBER, and the whole panel was
        * unreachable because of it: the server refused an invite without one,
        * and the only serial in the registry is formOnly — hidden unless the
        * applicant opted into the SAPS 271, which the default dealer path does
        * not. It asked for something that was not on screen and could not be.
        *
        * Operator, 2026-08-24: "ask the applicant just to give the Name, Cell
        * number and Firearm (just the name so the seller knows which firearm is
        * referred to). Then we can autofill the whole card."
        *
        * So this is shorthand for the SMS — "the Howa 6.5" — and nothing more.
        * The particulars come off the seller's own licence card, which they
        * photograph and confirm, and which then becomes what the consent
        * declares. It is prefilled from the form when the firearm section is
        * already filled, so nobody describes the same firearm twice. */}
      <label className="mt-2 block text-xs text-[var(--text-secondary)]">
        Which firearm is it?
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={knownLabel || 'e.g. the Howa 6.5'}
          className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
        <span className="mt-1 block text-[var(--text-tertiary)]">
          Just enough for them to know which one you mean. We read the make,
          calibre and serial numbers off their licence card — you do not need
          them here.
        </span>
      </label>

      {/* ⚠️ TELL THEM TO SPEAK TO THE SELLER FIRST. A stranger receiving an
          unexplained SMS about a firearm licence is a stranger who ignores it,
          and the applicant then waits on a link that was never going to move. */}
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        Speak to them first so they know it is coming.
      </p>

      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}

      <button
        type="button"
        onClick={send}
        disabled={
          busy ||
          name.trim().length < 2 ||
          phone.trim().length < 9 ||
          !labelToSend
        }
        className="mt-3 w-full rounded-[var(--radius)] bg-[var(--red)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send them the link'}
      </button>
    </div>
  );
}
