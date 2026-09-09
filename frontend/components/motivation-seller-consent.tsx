'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { motivationsApi } from '@/lib/motivations-api';
import { readFlag, writeFlag } from '@/lib/motivation-draft';

/** Where "they have already adopted the card" is remembered. */
const ADOPTED_FLAG = 'sellerCardAdopted';

/** Card firearm keys → how the buyer sees them in the adopt prompt. */
/**
 * Every row the card can hand over, in the order a licence card prints them.
 *
 * ⚠️ THE SIX COMPONENT ROWS WERE MISSING, AND SO WAS THE PAPERWORK. The seller
 * photographs the card, the OCR reads barrel, frame and receiver, the consent
 * stores all of it — and this list stopped at five, so the applicant confirmed
 * a make and a serial while section E of the SAPS 271 stayed empty. Operator,
 * 2026-09-08: "still does not fill these from the seller concent."
 *
 * ⚠️ AND THEY MUST BE SHOWN BEFORE THEY ARE ADOPTED. Adopting is the applicant
 * putting these details on an application they sign, so every value that will
 * land has to be readable here, against the photograph of the card below it.
 * A field that adopts silently is a field nobody checked.
 */
const ADOPT_LABELS: [string, string][] = [
  ['firearm_make', 'Make'],
  ['firearm_model', 'Model'],
  ['firearm_type', 'Type'],
  ['firearm_calibre', 'Calibre'],
  ['firearm_serial', 'Serial number'],
  ['barrel_serial', 'Barrel serial number'],
  ['barrel_make', 'Barrel make'],
  ['frame_serial', 'Frame serial number'],
  ['frame_make', 'Frame make'],
  ['receiver_serial', 'Receiver serial number'],
  ['receiver_make', 'Receiver make'],
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
  /**
   * The seller has just answered — reload the application around this panel.
   *
   * ⚠️ THE PANEL ALREADY POLLED; THE PAGE DID NOT. This panel has refreshed
   * its own status every 30 seconds since it shipped, so it could say "signed"
   * without a reload — but the consent, the seller's licence copies and the
   * filled-in Part F land as documents ON THE APPLICATION, and every surface
   * that shows them (the checklist rows, the annexure index, the coverage
   * meter, and this card's own "Signed." line, which is a prop) is drawn from
   * the page's `sheet`. Nothing re-read it, so the member watched the panel
   * change and had to reload the page before the paperwork appeared.
   * Operator, 2026-09-09: "I have to refresh the page to import it."
   *
   * ⚠️ FIRED ON THE TRANSITION, NEVER ON THE READING. A callback on every poll
   * would re-fetch the whole sheet every 30 seconds for as long as the tab is
   * open, and reloading the sheet under a member who is typing is worse than
   * the bug.
   */
  onArrived?: (status: 'COMPLETED' | 'DECLINED') => void;
}

export default function MotivationSellerConsent({
  motivationId,
  applicantName,
  firearm,
  onAdopt,
  onArrived,
}: SellerConsentProps) {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  /**
   * ⚠️ THE SERVER HAS ALWAYS REQUIRED THIS AND THE PANEL NEVER ASKED FOR IT.
   * See the note on the input below.
   */
  const [email, setEmail] = useState('');

  /**
   * Which ways the link goes out.
   *
   * Operator, 2026-09-09: "we should also have three options for the consent.
   * SMS, Email an Sent me the link via SMS or Email (those two must be tick
   * boxes as well). It must be able to sent to all tick boxes."
   *
   * ⚠️ DEFAULTS TO WHAT THIS ALWAYS DID — both to the seller — so an applicant
   * who ignores the boxes gets exactly the old behaviour. The last two go to
   * THEM, for a seller standing beside them or on WhatsApp, and neither needs
   * a seller contact detail; the server validates per channel for that reason.
   */
  const [channels, setChannels] = useState({
    sellerSms: true,
    sellerEmail: true,
    meSms: false,
    meEmail: false,
  });
  const noChannel = !Object.values(channels).some(Boolean);
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
  /**
   * They have already put the card's details on their application.
   *
   * ⚠️ PERSISTED, NOT COMPONENT STATE. It was useState, so every reload
   * re-offered "use these details in my application" to somebody who had used
   * them — inviting them to overwrite their own corrections with the same card
   * a second time, and telling them nothing had happened the first.
   */
  const [adopted, setAdopted] = useState(() => readFlag(motivationId, ADOPTED_FLAG));
  const [frontId, setFrontId] = useState<string | null>(null);
  /** What the seller signed, in the words the pack will print. */
  const [statement, setStatement] = useState<{
    declaration: string;
    rows: { label: string; value: string }[];
    signedLine: string;
  } | null>(null);
  const [showStatement, setShowStatement] = useState(false);
  const [removing, setRemoving] = useState(false);

  /**
   * ⚠️ EVERY setState AFTER AN await IS GUARDED. This panel polls every 30s
   * and unmounts the moment the member changes step — and this one lives
   * inside a checklist row that re-renders on every upload. Writing state into
   * a component React has already thrown away is a warning today and a leak in
   * the next runtime; worse here, `send()` below could flip a torn-down panel
   * to "sent" and lose the message the member needed to read.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * ⚠️ THE CALLBACK LIVES IN A REF SO `refreshStatus` STAYS STABLE. It is a
   * useCallback dependency of both the mount effect and the 30-second
   * interval; taking an inline prop directly would give it a new identity on
   * every parent render, and the interval would be torn down and rebuilt each
   * time — which on a page that re-renders per keystroke is a poll that never
   * completes a cycle.
   */
  const arrivedRef = useRef(onArrived);
  useEffect(() => {
    arrivedRef.current = onArrived;
  }, [onArrived]);

  /**
   * The last status this panel actually saw, so a CHANGE can be told from a
   * reading.
   *
   * ⚠️ SEEDED BY THE FIRST READ WITHOUT FIRING. A panel that mounts on an
   * application whose seller signed last week must not announce it and reload
   * the sheet: the page has this moment loaded, the paperwork is already on
   * it, and a toast saying "the seller has signed" about something a week old
   * is us reporting our own first glance as news.
   */
  const seen = useRef<'NONE' | 'INVITED' | 'COMPLETED' | 'DECLINED' | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await motivationsApi.sellerConsentStatus(getToken, motivationId);
      if (!alive.current) return;
      setStatus(r.status);
      setCardFirearm(r.cardFirearm);
      setFrontId(r.licenceFrontUploadId);
      setStatement(r.statement);

      const before = seen.current;
      seen.current = r.status;
      // A transition into a resolved state, seen by a panel that was already
      // watching. Not the first read, and not a repeat of a state we have
      // already reported.
      if (
        before !== null &&
        before !== r.status &&
        (r.status === 'COMPLETED' || r.status === 'DECLINED')
      ) {
        arrivedRef.current?.(r.status);
      }
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

  /**
   * And the moment the member comes back to the tab.
   *
   * ⚠️ THIRTY SECONDS IS FINE FOR A PAGE NOBODY IS WATCHING AND FEELS BROKEN
   * FOR ONE SOMEBODY IS. The real sequence is: send the link, put the laptop
   * down, ring the seller, come back. "Coming back" is a focus event, and
   * answering it costs one request at exactly the moment a person is asking
   * the question — which is worth more than a shorter interval running all
   * day. Browsers also throttle timers in a hidden tab, so the interval alone
   * can be minutes late on precisely this journey.
   */
  useEffect(() => {
    if (status !== 'INVITED') return;
    const wake = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
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
        email,
        channels,
        applicantName,
        firearm: { ...firearm, label: labelToSend },
      });
      if (!alive.current) return;
      setSent(true);
    } catch (e) {
      if (!alive.current) return;
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

  /**
   * Does the card carry a row the application still has nothing for?
   *
   * ⚠️ THE ADOPT USED TO BE OFFERED ONCE AND THEN HIDDEN FOR EVER, because
   * adopting overwrote everything and re-offering "invited them to overwrite
   * their own corrections with the same card a second time". It fills only
   * EMPTY fields now, so a second adopt is harmless — and it has to be
   * available, because the six component rows were added to the map on
   * 2026-09-08 and every application signed before that has none of them.
   * Operator: "still does not fill these from the seller concent."
   *
   * Their own answers still win: a field they have filled is neither offered
   * nor written.
   */
  const stillMissing =
    !!cardFirearm &&
    Object.keys(cardFirearm).some((k) => {
      const held = String(
        (firearm as Record<string, string | undefined>)[k] ?? '',
      ).trim();
      // Nothing there yet, or what is there is not what the card says — either
      // way there is something to offer. A read we have since corrected (the
      // "ZABA01892 VUURWAPEMLISENSIEN" serial) counts as the second case.
      return !held || held !== cardFirearm[k];
    });

  // ── Signed. The government card is now the source of truth for the firearm,
  //    and the buyer confirms it into their own application. ──────────────
  if (status === 'COMPLETED') {
    return (
      <div className="rounded-[var(--r-md)] border border-[var(--border)] p-4">
        <p className="text-sm font-medium text-[var(--success)]">
          The owner has signed
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Their signed consent and a copy of their licence are in your pack.
        </p>

        {/*
          ⚠️ THE PREVIEW IS THE PACK'S OWN WORDS. declarationFor, firearmRowsFor
          and signedLineFor are what motivation-render.service.ts prints; a
          preview written separately is one that can disagree with the document
          the applicant signs their name beside. Operator, 2026-09-08: "must be
          a preview consent form."
        */}
        {statement ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowStatement((v) => !v)}
              className="min-h-[36px] text-xs font-medium text-[var(--red)] underline"
            >
              {showStatement ? 'Hide what they signed' : 'See what they signed'}
            </button>
            {showStatement ? (
              <div className="mt-2 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-inset)] p-3">
                <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--text-primary)]">
                  {statement.declaration}
                </p>
                <dl className="mt-2 text-[12.5px]">
                  {statement.rows.map((r) => (
                    <div key={r.label} className="flex justify-between gap-3 py-[2px]">
                      <dt className="text-[var(--text-secondary)]">{r.label}</dt>
                      <dd className="text-right font-medium">{r.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="m-0 mt-2 text-[12px] text-[var(--text-tertiary)]">
                  {statement.signedLine}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/*
          ⚠️ invite() HAS BEEN NAMING THIS ACTION WITH NOTHING BEHIND IT — it
          refuses a resend against a signed consent with "Delete that consent
          first if you need a new one". Operator: "Must be able to delete the
          consent." It asks first: the licence photographs and the signature go
          with it, and they were somebody else's to give.
        */}
        <button
          type="button"
          disabled={removing}
          onClick={async () => {
            if (
              !window.confirm(
                'Remove this consent? Their signed page and the photographs of their licence are deleted, and you would have to ask them again.',
              )
            ) {
              return;
            }
            setRemoving(true);
            try {
              await motivationsApi.deleteSellerConsent(getToken, motivationId);
              if (!alive.current) return;
              setStatus('NONE');
              setCardFirearm(null);
              setStatement(null);
              setFrontId(null);
              setSent(false);
            } catch {
              if (alive.current) setError('We could not remove it just now.');
            } finally {
              if (alive.current) setRemoving(false);
            }
          }}
          className="mt-3 min-h-[36px] text-xs font-medium text-[var(--text-tertiary)] underline hover:text-[var(--red)]"
        >
          {removing ? 'Removing…' : 'Remove this consent'}
        </button>

        {cardFirearm && onAdopt && (!adopted || stillMissing) && (
          <div className="mt-3 rounded-[var(--r-md)] border border-[var(--border)] p-3">
            <p className="text-xs font-medium">
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
                  className="w-full rounded-[var(--r-md)] border border-[var(--border)]"
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
                writeFlag(motivationId, ADOPTED_FLAG);
              }}
              className="mt-3 w-full rounded-[var(--r-md)] bg-[var(--red)] px-4 py-2.5 text-sm font-medium text-white"
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
      <div className="rounded-[var(--r-md)] border border-[var(--border)] p-4">
        <p className="text-sm font-medium">The owner declined</p>
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
      <div className="rounded-[var(--r-md)] border border-[var(--border)] p-4">
        <p className="text-sm font-medium">Waiting on the owner</p>
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
    <div className="rounded-[var(--r-md)] border border-[var(--border)] p-4">
      <p className="text-sm font-medium">
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
          className="mt-1 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>
      {/* ⚠️ HOW IT TRAVELS, ASKED BEFORE WHAT WE NEED TO SEND IT.
        *
        * Operator, 2026-09-09: "we should also have three options for the
        * consent. SMS, Email an Sent me the link via SMS or Email (those two
        * must be tick boxes as well). It must be able to sent to all tick
        * boxes."
        *
        * The boxes come FIRST because they decide which contact details are
        * needed at all: somebody sending the link to themselves to pass on has
        * neither the seller's number nor their address, and being asked for
        * both before being allowed to say so is the form arguing with itself.
        * The server validates per channel for the same reason. */}
      <fieldset className="mt-3 rounded-[var(--r-sm)] border border-[var(--border)] p-3">
        <legend className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          How should we send it?
        </legend>
        {(
          [
            ['sellerSms', 'SMS to them'],
            ['sellerEmail', 'Email to them'],
            ['meSms', 'SMS the link to me, I will pass it on'],
            ['meEmail', 'Email the link to me, I will pass it on'],
          ] as [keyof typeof channels, string][]
        ).map(([key, text]) => (
          <label
            key={key}
            className="flex min-h-[36px] items-center gap-2 text-sm text-[var(--text-primary)]"
          >
            <input
              type="checkbox"
              checked={channels[key]}
              onChange={(e) =>
                setChannels((c) => ({ ...c, [key]: e.target.checked }))
              }
            />
            {text}
          </label>
        ))}
        {noChannel && (
          <p className="mt-1 text-xs text-[var(--red)]">
            Pick at least one.
          </p>
        )}
      </fieldset>

      {/* ⚠️ ONLY WHERE A TICKED CHANNEL USES IT. Asking for the seller's
        * number so we can not send to it is the question the server stopped
        * demanding — see the per-channel validation in invite(). */}
      <label
        className="mt-2 block text-xs text-[var(--text-secondary)]"
        hidden={!channels.sellerSms}
      >
        Their mobile number
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="082 000 0000"
          className="mt-1 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>

      {/* ⚠️ THIS BOX DID NOT EXIST, AND THE SERVER HAS ALWAYS DEMANDED IT.
        *
        * motivation-seller-consent.service.ts refuses an invite without a
        * valid address, deliberately — "BOTH, NOT EITHER. The email carries
        * the link; it survives being read on a desktop, it can hold an
        * explanation, and it does not cost an SMS credit to resend. The number
        * is the nudge that makes him look." That reasoning stands. What was
        * broken is that the panel never asked: no input, no state, and no
        * `email` field in the API client's own body type. Every "Send them the
        * link" came back "Enter a valid email address for them." over a form
        * with nowhere to enter one, so this path has never once worked.
        *
        * Which is precisely the failure the comment BELOW that check
        * describes, about the serial number it used to demand: "The refusal
        * named a box that was not on screen anywhere." Same function, same
        * mistake, second time. */}
      <label
        className="mt-2 block text-xs text-[var(--text-secondary)]"
        hidden={!channels.sellerEmail}
      >
        Their email address
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          inputMode="email"
          type="email"
          autoComplete="off"
          placeholder="them@example.co.za"
          className="mt-1 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
        <span className="mt-1 block text-[var(--text-tertiary)]">
          The link goes here as well as by SMS, so they can open it on a
          computer and read it properly.
        </span>
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
          className="mt-1 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
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
        /*
          ⚠️ THE GATE MIRRORS THE SERVER'S OWN CHECKS, INCLUDING THE EMAIL.
          A button that enables into a refusal is how the missing address went
          unnoticed: it looked sendable every time. The pattern is deliberately
          the forgiving one the server uses — anything with an @ between two
          non-spaces and a dot after it — because a stricter one here would
          reject real addresses the server would have accepted.
        */
        disabled={
          busy ||
          noChannel ||
          name.trim().length < 2 ||
          /* ⚠️ PER CHANNEL, LIKE THE SERVER. The gate used to demand both a
             number and an address unconditionally — right when both were being
             used, and a locked button for somebody who ticked only "send it to
             me". A button that enables into a refusal is how the missing email
             box went unnoticed; one that never enables is worse. */
          (channels.sellerSms && phone.trim().length < 9) ||
          (channels.sellerEmail &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) ||
          !labelToSend
        }
        className="mt-3 w-full rounded-[var(--r-md)] bg-[var(--red)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send them the link'}
      </button>
    </div>
  );
}
