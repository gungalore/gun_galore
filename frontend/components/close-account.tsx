'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useClerk } from '@clerk/nextjs';
import {
  ACCOUNT_CLOSURE_REASONS,
  closeAccount,
  confirmAccepted,
  fetchClosureEligibility,
  isClosureReason,
  UsersApiError,
  type AccountClosureReason,
  type ClosureBlocker,
  type ClosureEligibility,
  type TokenGetter,
} from '@/lib/users-api';
import { useScrollLock } from '@/lib/use-scroll-lock';

// ────────────────────────────────────────────────────────────────────
// CLOSE MY ACCOUNT
//
// Operator, 2026-08-22: "It must delete the profile from the public side,
// but still keep transaction links etc, reason for that is if a user
// commited a crime or something they cant just vanish by deleting and
// wiping evidence."
//
// So this is not an erasure button and the copy never lets it read like
// one. The middle section of the confirmation screen is the whole point:
// it says what we keep and why, before the member decides, in the same
// screen where they decide. A product that discovers this afterwards
// discovers it in a complaint.
//
// ⚠️ THIS IS THE ONLY SELF-DELETE CONTROL THAT MAY EXIST. Clerk's stock
// UserProfile modal — opened with openUserProfile() on the Security card
// of app/settings/page.tsx — carries its own "Delete account" section,
// gated by the instance-level delete_self_enabled setting. Flipping that
// switch in the Clerk dashboard puts a self-delete button in the shipped
// UI with zero code change and fires user.deleted straight at the
// webhook, bypassing every blocker below. It must stay off.
// ────────────────────────────────────────────────────────────────────

// Mirrors the `card` const on app/settings/page.tsx, which is local to that
// file. Kept in step by eye; the two sit next to each other on the page.
const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 10,
};

type Phase =
  | 'loading'
  | 'error'
  | 'restricted'
  | 'blocked'
  | 'confirm'
  | 'already-closed'
  | 'done';

/** The list of open items on the blocked screen, each linking to its page. */
function BlockerList({ items }: { items: ClosureBlocker[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {items.map((b, i) => (
        // ⚠️ The index is part of the key on purpose. Two blockers can
        // legitimately share a code — two separate complaints, say — and a
        // key collision drops the second one silently, which on this
        // screen means telling the member about one open item when there
        // are two.
        <li
          key={`${b.code}-${i}`}
          className="rounded-[8px] p-3 text-sm"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        >
          {b.message}
          {b.href && (
            <>
              {' '}
              <Link
                href={b.href}
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                Open
              </Link>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-lg"
      style={{ color: 'var(--text-primary)', fontWeight: 500 }}
    >
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-4 text-sm"
      style={{ color: 'var(--text-primary)', fontWeight: 500 }}
    >
      {children}
    </p>
  );
}

/**
 * The overlay.
 *
 * ⚠️ z-[60] AND data-blocking-overlay, both load-bearing. The bottom tab bar
 * is z-55 and would otherwise sit over this; Boet's dock is z-60 too and,
 * being last in <body>, wins the tie on DOM order — the attribute stands
 * him down for the overlay's lifetime.
 */
function CloseAccountDialog({
  getToken,
  onDismiss,
}: {
  getToken: TokenGetter;
  onDismiss: () => void;
}) {
  const { signOut } = useClerk();
  const panel = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [eligibility, setEligibility] = useState<ClosureEligibility | null>(
    null,
  );
  const [reason, setReason] = useState<AccountClosureReason | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ Dismissal is refused while the POST is in flight, and the flag is a
  // ref rather than state: Escape and the backdrop handler read it from a
  // closure that would otherwise still hold the pre-submit value.
  const inFlight = useRef(false);

  // ⚠️ THE DISMISS HANDLER IS READ THROUGH A REF SO THE MOUNT EFFECT BELOW CAN
  // RUN ONCE. onDismiss is `() => setOpen(false)`, a fresh function on every
  // render of the parent — and app/settings/page.tsx re-renders on its own
  // state and on Clerk's roughly minute-ly token refresh. With onDismiss in
  // the dependency list the effect tore down and re-ran on each of those,
  // calling panel.focus() again and pulling the caret out of the CLOSE box
  // while the member was still typing in it. This screen is the longest read
  // in the app; a minute in it is normal.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const e = await fetchClosureEligibility(getToken);
      setEligibility(e);
      setPhase(
        e.alreadyClosed
          ? 'already-closed'
          : e.restricted
            ? 'restricted'
            : e.eligible
              ? 'confirm'
              : 'blocked',
      );
    } catch (err) {
      // Fails closed — see normaliseEligibility. A member who cannot be
      // checked is not shown the screen that closes the account.
      setError(
        err instanceof UsersApiError
          ? err.message
          : 'We could not check your account just now.',
      );
      setPhase('error');
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mounted only while this overlay is shown, so the lock runs for its
  // whole life — see lib/use-scroll-lock.ts.
  useScrollLock(true);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inFlight.current) dismissRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
    // Mount only — see dismissRef above.
  }, []);

  async function submit() {
    if (busy || !reason || !confirmAccepted(typed)) return;
    setBusy(true);
    inFlight.current = true;
    setError(null);
    try {
      await closeAccount(getToken, reason);
      setPhase('done');
      // ⚠️ THE SESSION IS ALREADY DEAD BY THE TIME WE GET HERE. The server
      // deletes the Clerk user as the last step of a successful closure, so
      // signOut() can reject against a user that no longer exists. That is
      // not a failed closure and must not be shown as one — fall through to
      // a hard navigation, which drops the stale session either way.
      try {
        await signOut({ redirectUrl: '/' });
      } catch {
        window.location.assign('/');
      }
    } catch (err) {
      inFlight.current = false;
      setBusy(false);
      // ⚠️ NEVER RETRY THIS AUTOMATICALLY. A 401 here can mean the closure
      // succeeded and the session died before the response landed.
      setError(
        err instanceof UsersApiError
          ? err.message
          : 'We could not close your account just now. Please try again.',
      );
    }
  }

  const canSubmit = !!reason && confirmAccepted(typed) && !busy;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      data-blocking-overlay="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !inFlight.current) onDismiss();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Close your account"
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[10px] p-5 outline-none sm:rounded-[10px]"
        style={{ background: 'var(--bg-card)' }}
      >
        {phase === 'loading' && (
          <p className="text-sm" style={{ color: 'var(--text-tertiary-on-card)' }}>
            Checking your account…
          </p>
        )}

        {phase === 'error' && (
          <>
            <Heading>We could not check your account</Heading>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {error} Try again in a moment, or contact{' '}
              <Link href="/support" style={{ color: 'var(--red)' }}>
                support
              </Link>{' '}
              and we will do it for you.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-[6px] px-4 py-2 text-sm"
                style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-[6px] px-4 py-2 text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* §5.4 — a restriction is not a closure and is never described as
            one. No reason is given here on purpose: the detail belongs in a
            support conversation, not on a screen anyone can screenshot. */}
        {phase === 'restricted' && (
          <>
            <Heading>Contact support to close your account</Heading>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              There is a restriction on your account, so it cannot be closed
              from here. Contact support and we will handle it.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/support"
                className="rounded-[6px] px-4 py-2 text-sm"
                style={{ background: 'var(--red)', color: '#fff' }}
              >
                Contact support
              </Link>
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-[6px] px-4 py-2 text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === 'already-closed' && (
          <>
            <Heading>This account is already closed</Heading>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Sign out to finish. If you can still sign in afterwards, contact{' '}
              <Link href="/support" style={{ color: 'var(--red)' }}>
                support
              </Link>
              .
            </p>
            <button
              type="button"
              onClick={() => void signOut({ redirectUrl: '/' })}
              className="mt-5 rounded-[6px] px-4 py-2 text-sm"
              style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Sign out
            </button>
          </>
        )}

        {/* §5.3 */}
        {phase === 'blocked' && (
          <>
            <Heading>We cannot close your account yet</Heading>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Some things on your account are still open. Closing now would
              leave another member, or you, without a way to finish them.
            </p>

            {/* An empty list here is a bug, not a state: normaliseEligibility
                only reports "not eligible" with no blockers when it could not
                read the payload. Say so rather than showing a heading with
                nothing under it. */}
            {eligibility && eligibility.blockers.length > 0 ? (
              <BlockerList items={eligibility.blockers} />
            ) : (
              <p
                className="mt-3 text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                We could not list what is still open. Contact support and we
                will check it for you.
              </p>
            )}

            <p
              className="mt-4 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Once these are finished, come back to Settings and close your
              account then. If something here looks stuck,{' '}
              <Link href="/support" style={{ color: 'var(--red)' }}>
                contact support
              </Link>{' '}
              and we will sort it out.
            </p>

            <button
              type="button"
              onClick={onDismiss}
              className="mt-5 rounded-[6px] px-4 py-2 text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </>
        )}

        {/* §5.2 */}
        {phase === 'confirm' && (
          <>
            <Heading>Close your account?</Heading>

            <SubHeading>What happens straight away</SubHeading>
            <ul
              className="mt-2 list-disc pl-5 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              <li>
                Your seller profile page stops working. Anyone with the link
                gets a &ldquo;not found&rdquo; page.
              </li>
              <li>Your listings are cancelled and removed from search.</li>
              <li>Your username is released. Someone else may take it.</li>
              <li>
                Your phone number and email address are released from your
                account.
              </li>
              <li>Your banking details are deleted.</li>
              <li>Any pending links we sent you by SMS stop working.</li>
              <li>
                You are signed out and cannot sign in again with this account.
              </li>
            </ul>

            <SubHeading>What we keep, and why</SubHeading>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              We keep a record of what you did on All Outdoor: your sales and
              purchases, the offers and bids you made, ratings written by you
              and about you, any complaints you or another member lodged, and
              any statutory firearm transfer paperwork we completed for you.
            </p>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              That record stays linked to your name, your ID number and your
              contact details. It is not visible to other members — only to our
              staff, and to the authorities where the law requires us to hand
              it over.
            </p>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              We keep it because a marketplace where anybody can erase what
              they did by closing an account is a marketplace where nobody can
              be held to anything. Transaction records are also kept for five
              years under FICA record-keeping rules, and firearm transfer
              records for the period the firearms legislation requires.
            </p>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Our full retention periods are in the{' '}
              <Link href="/privacy" style={{ color: 'var(--red)' }}>
                Privacy Policy
              </Link>
              .
            </p>

            {/* ⚠️ THIS IS NOT §5.2 VERBATIM, AND THAT IS DELIBERATE. The plan's
                wording — "register again with the same ID number… your previous
                record is reattached when you verify your identity" — describes
                the Phase 4 relink. relinkFromClosure exists in the backend but
                NOTHING CALLS IT: all three duplicate-ID checks still throw
                (kyc.service.ts:215, :588; users.service.ts:1025), so a member
                who takes this paragraph at its word is told, on their way back
                in, that their own SA ID belongs to somebody else — with no
                escape but a support ticket. Promising an outcome the code
                refuses is worse than saying support has to do it.
                ⚠️ WHEN PHASE 4 SHIPS, PUT §5.2 BACK. */}
            <SubHeading>If you want to come back</SubHeading>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              You can register again with the same email address and the same
              phone number — closing the account releases both.
            </p>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Your ID number stays on the closed record, so identity
              verification on a new account will not go through on its own.{' '}
              <Link href="/support" style={{ color: 'var(--red)' }}>
                Contact support
              </Link>{' '}
              when you register again and we will reattach your previous
              record, including anything still outstanding against it.
            </p>

            <SubHeading>If you want your data deleted</SubHeading>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Closing your account is not a deletion request. If you want us to
              delete what we are not legally required to keep,{' '}
              <Link href="/support" style={{ color: 'var(--red)' }}>
                contact us
              </Link>{' '}
              and we will deal with it as a request under section 24 of POPIA.
            </p>

            {/* Warnings are told, not enforced — an active subscription ends,
                it does not block. Kept below the retention copy so it never
                reads as one of the things we keep. */}
            {eligibility && eligibility.warnings.length > 0 && (
              <BlockerList items={eligibility.warnings} />
            )}

            <hr
              className="my-5"
              style={{ border: 'none', borderTop: '0.5px solid var(--border)' }}
            />

            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend
                className="text-sm"
                style={{ color: 'var(--text-primary)' }}
              >
                Why are you closing your account?
              </legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {ACCOUNT_CLOSURE_REASONS.map(([code, label]) => (
                  <label
                    key={code}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <input
                      type="radio"
                      name="closure-reason"
                      value={code}
                      checked={reason === code}
                      disabled={busy}
                      onChange={(e) =>
                        isClosureReason(e.target.value) &&
                        setReason(e.target.value)
                      }
                      style={{ accentColor: 'var(--red)' }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label
              className="mt-5 block text-sm"
              style={{ color: 'var(--text-primary)' }}
            >
              Type <strong>CLOSE</strong> to confirm.
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy}
                // The keyboard hints matter on a phone: without them the field
                // autocapitalises the first letter only and autocorrects
                // "CLOSE" to "Close", and the member cannot see why the button
                // stays dead.
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                aria-label="Type CLOSE to confirm"
                className="mt-1"
                style={{
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 14,
                  outline: 'none',
                  width: '100%',
                }}
              />
            </label>

            {error && (
              <p className="mt-3 text-sm" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="rounded-[6px] px-4 py-2 text-sm"
                style={{
                  background: canSubmit ? 'var(--red)' : 'var(--bg-inset)',
                  color: canSubmit ? '#fff' : 'var(--text-tertiary-on-card)',
                  border: canSubmit ? 'none' : '0.5px solid var(--border)',
                  cursor: canSubmit ? 'pointer' : 'default',
                }}
              >
                {busy ? 'Closing…' : 'Close my account'}
              </button>
              <button
                type="button"
                onClick={onDismiss}
                disabled={busy}
                className="rounded-[6px] px-4 py-2 text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <Heading>Your account is closed</Heading>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Signing you out. Thank you for using All Outdoor.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The settings card. §5.1.
 *
 * The eligibility check runs when the overlay opens, not when the page
 * loads: it is a several-table query on the member's whole trading
 * history, and running it on every visit to Settings would charge every
 * member for a screen almost none of them open.
 */
export default function CloseAccountSection({
  getToken,
}: {
  getToken: TokenGetter;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section style={card} className="mt-6 p-4">
      <h2
        className="text-base mb-1"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Close your account
      </h2>
      <p
        className="text-sm leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        Closing your account takes your profile and your listings off All
        Outdoor and signs you out permanently. You will not be able to sign
        back in to this account.
      </p>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        This is not the same as deleting everything we hold about you. We keep
        a record of your dealings on the platform. Read what that means before
        you decide.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 rounded-[6px] px-3 py-1.5 text-sm"
        // Outlined, not the filled house red. Every other primary button on
        // this page saves something; this one is the only irreversible
        // control on it, and it must not be the easiest thing to hit by
        // accident on the way past the address book.
        style={{
          background: 'transparent',
          color: 'var(--red)',
          border: '0.5px solid var(--red)',
          cursor: 'pointer',
        }}
      >
        Close my account
      </button>

      {open && (
        <CloseAccountDialog
          getToken={getToken}
          onDismiss={() => setOpen(false)}
        />
      )}
    </section>
  );
}
