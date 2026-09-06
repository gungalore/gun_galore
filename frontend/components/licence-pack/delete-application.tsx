'use client';

// ────────────────────────────────────────────────────────────────────
// DELETE THIS APPLICATION.
//
// Operator, 2026-08-30: "put a visible option that is visible everywhere for
// user to delete the application."
//
// ⚠️ THE REBUILT WIZARD LOST THIS, LIKE IT LOST THE FOLLOW-UP THREAD. The old
// page had it — a red underlined link under a divider at the very bottom of a
// three-thousand-line scroll — and the new one had nothing at all. Somebody
// who started an application by mistake had no way to get rid of it. Hence
// "visible everywhere": this lives in the chrome bar, which renders on every
// step, and on the Centre's list, so it can be reached without opening the
// application first.
//
// ── WHAT DELETE ACTUALLY MEANS HERE ────────────────────────────────
//
// The server has TWO endpoints and they are not the same thing:
//
//   POST :id/abandon — "walk away without deleting, keeps the audit trail,
//                      frees nothing". Status becomes ABANDONED, the Centre
//                      shows "Set aside", and everything stays on disk.
//   DELETE :id       — SELF-SERVE POPIA ERASURE. Removes the encrypted files
//                      off our disk, then deletes the row; cascades take the
//                      messages and the upload rows with it.
//
// This is the second one, because "delete" means delete. Which makes the
// confirmation load-bearing rather than ceremony.
//
// ⚠️ AND IT HAS TO SAY WHAT SURVIVES, NOT ONLY WHAT GOES. erase() never
// touches `Credential` — the Document Centre — so anything saved there is
// untouched. What dies is what was only ever attached to THIS application.
// That matters more than it sounds: prior readings are pulled across ALL of a
// member's motivations, so deleting one application is also deleting the
// documents that were quietly prefilling the others. Somebody clearing out a
// mistake deserves to know that before they press it, not after.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFocusTrap } from '@/lib/use-focus-trap';
import {
  MotivationApiError,
  motivationsApi,
  type TokenGetter,
} from '@/lib/motivations-api';
import { clearDraft } from '@/lib/motivation-draft';

function ConfirmDialog({
  reference,
  busy,
  error,
  onConfirm,
  onDismiss,
}: {
  reference: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  // ⚠️ A REAL TRAP, NOT A .focus() AND A KEY LISTENER. `aria-modal="true"` told
  // a screen reader nothing outside this dialog mattered while Tab walked
  // straight out of it into the page behind — where the member could operate
  // the wizard, and the delete button, on an application this dialog was asking
  // them about. The trap also restores focus on close and locks the background
  // scroll. See lib/use-focus-trap.ts.
  //
  // Escape is still refused mid-flight: dismissing a dialog whose deletion is
  // already happening tells somebody it did not happen.
  const panel = useFocusTrap<HTMLDivElement>({
    onClose: () => {
      if (!busy) onDismiss();
    },
  });

  return (
    <div
      // ⚠️ z-[60] AND data-blocking-overlay, both load-bearing — the bottom
      // tab bar is z-55 and would otherwise sit over this. Same rule the
      // close-account dialog documents.
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      data-blocking-overlay="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onDismiss();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Delete this application"
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[8px] p-5 outline-none sm:rounded-[8px]"
        style={{ background: 'var(--bg-card)' }}
      >
        <h2 className="text-[17px] font-medium text-[var(--text-primary)]">
          Delete {reference}?
        </h2>

        <p className="mt-2 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
          This deletes your answers, the documents you sent for this
          application, and the motivation if we have written it. It cannot be
          undone.
        </p>

        {/* ⚠️ THE HALF PEOPLE GET WRONG. Anything in the Document Centre is a
            separate record and erase() does not touch it — saying so stops a
            member cancelling a deletion they actually wanted. The second
            sentence is the one that costs them if we leave it out. */}
        <p className="mt-2.5 text-[13px] leading-[1.55] text-[var(--text-secondary)]">
          Anything you saved to your Document Centre stays there. Documents
          that were only ever attached to this application are deleted, so
          they will not fill in your other applications any more.
        </p>

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-[var(--red)]">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {/* ⚠️ THE DESTRUCTIVE BUTTON IS NOT THE DEFAULT ONE. Keep goes
              first and carries the solid fill; deleting is the deliberate
              act, and a red primary button under a dialog people meet by
              mis-clicking is how somebody loses an application. */}
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-[var(--r-sm)] border-0 bg-[var(--text-primary)] px-5 py-[10px] text-[13.5px] font-medium text-[var(--bg-card)] disabled:opacity-45"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-[var(--r-sm)] border border-[var(--red)] bg-transparent px-5 py-[10px] text-[13.5px] font-medium text-[var(--red)] disabled:opacity-45"
          >
            {busy ? 'Deleting…' : 'Delete it'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DeleteApplication({
  token,
  motivationId,
  reference,
  className,
  onDeleted,
}: {
  token: TokenGetter;
  motivationId: string;
  reference: string;
  /** Lets the chrome bar and the Centre's list style their own trigger. */
  className?: string;
  /**
   * What to do once it is gone. Defaults to the Centre.
   *
   * ⚠️ THE CENTRE, NOT back(). History behind an application usually holds
   * the application itself, and going back to a page whose row no longer
   * exists is a 404 for something the member just deleted on purpose.
   */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={
          className ??
          'text-[12px] text-[var(--text-tertiary)] underline underline-offset-2 hover:text-[var(--red)]'
        }
      >
        Delete application
      </button>

      {open && (
        <ConfirmDialog
          reference={reference}
          busy={busy}
          error={error}
          onDismiss={() => setOpen(false)}
          onConfirm={async () => {
            setBusy(true);
            setError(null);
            try {
              await motivationsApi.erase(token, motivationId);
              // ⚠️ THE LOCAL DRAFT OUTLIVES THE ROW. It is keyed on the
              // motivation id and the wizard prefers it over the server's
              // copy — so without this the answers come back on the next
              // application unlucky enough to be handed the same id. Lifted
              // from the old page, which learned it the hard way.
              clearDraft(motivationId);
              if (onDeleted) onDeleted();
              else router.push('/motivations');
            } catch (e) {
              setError(
                e instanceof MotivationApiError
                  ? e.message
                  : 'We could not delete it just now.',
              );
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
