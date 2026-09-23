'use client';

import { useEffect, useState } from 'react';

/**
 * THE REASON DIALOG â€” every write in this panel goes through it.
 *
 * âš ï¸ THE BACKEND REFUSES A WRITE WITHOUT A REASON, and danger flags demand a
 * real sentence (15+ characters). A UI that let the operator tap through
 * without one would surface a 400 they cannot act on, so the minimum is
 * enforced here as well â€” visibly, with a counter, rather than as a surprise.
 */
export function ReasonDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  minLength = 3,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  minLength?: number;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const short = reason.trim().length < minLength;

  async function submit() {
    if (short || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      setBusy(false);
    }
  }

  return (
    <div
      className="adm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{ alignItems: 'center', padding: 20 }}
    >
      <div
        className="adm-card"
        data-tone={danger ? 'red' : 'cyan'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#090e13',
          borderRadius: 18,
        }}
      >
        <div className="adm-card-head">
          <span className="adm-card-title">{title}</span>
        </div>
        {body ? <p className="adm-sub">{body}</p> : null}
        <label className="adm-label" htmlFor="adm-reason">
          Reason {minLength > 3 ? `(min ${minLength} characters)` : '(required)'}
        </label>
        <textarea
          id="adm-reason"
          className="adm-textarea"
          rows={3}
          value={reason}
          autoFocus
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What is changing and why?"
        />
        {error ? (
          <p style={{ color: 'var(--adm-red)', fontSize: 12 }}>{error}</p>
        ) : null}
        <div className="adm-grid-2">
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone={danger ? 'red' : 'cyan'}
            disabled={short || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Workingâ€¦' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A yes/no confirm for actions the backend does NOT want a reason for.
 *
 * âš ï¸ MONEY ACTIONS GET THE SAME LOOK. Even where the API records no reason,
 * the operator should still read what is about to move before it moves â€” the
 * amount is rendered in the body, not left to memory.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="adm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{ alignItems: 'center', padding: 20 }}
    >
      <div
        className="adm-card"
        data-tone={danger ? 'red' : 'cyan'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#090e13',
          borderRadius: 18,
        }}
      >
        <div className="adm-card-head">
          <span className="adm-card-title">{title}</span>
        </div>
        {body ? <p className="adm-sub">{body}</p> : null}
        {error ? (
          <p style={{ color: 'var(--adm-red)', fontSize: 12 }}>{error}</p>
        ) : null}
        <div className="adm-grid-2">
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone={danger ? 'red' : 'cyan'}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onConfirm())
                .then(() => onClose())
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Action failed');
                  setBusy(false);
                });
            }}
          >
            {busy ? 'Workingâ€¦' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
