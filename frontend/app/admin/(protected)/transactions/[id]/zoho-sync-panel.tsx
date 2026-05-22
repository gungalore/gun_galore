'use client';

import { useState } from 'react';

/**
 * Admin panel — Zoho Books sync status for one transaction.
 *
 * Shows:
 *   - Current sync status (OK / PENDING / FAILED / SKIPPED)
 *   - Document IDs (invoice, payment, credit note) with links into
 *     Books (constructed using the org ID from env on the FE side
 *     would leak it — so we just show the IDs as copyable text)
 *   - The last sync error (when status is FAILED)
 *   - "Retry sync" button that re-fires the same backend hook
 *     ZohoBooksService runs on auto-sync events
 *
 * Visible only when the transaction has touched the Books integration
 * at any point (either has a sync status OR a stored document ID).
 */

interface TxLike {
  id: string;
  zohoCommissionInvoiceId: string | null;
  zohoCommissionPaymentId: string | null;
  zohoCreditNoteId: string | null;
  zohoSyncStatus: string | null;
  zohoSyncError: string | null;
  zohoSyncLastAttemptAt: string | null;
  paymentStatus: string;
  dealerVerificationStatus: string | null;
}

export function ZohoSyncPanel({ tx }: { tx: TxLike }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { kind: 'ok'; message: string } | { kind: 'err'; message: string } | null
  >(null);

  async function retrySync() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/transactions/${tx.id}/zoho-retry`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setResult({
          kind: 'err',
          message: body.message ?? `HTTP ${res.status}`,
        });
        return;
      }
      setResult({
        kind: 'ok',
        message:
          'Retry triggered. Refresh the page in a few seconds to see updated status.',
      });
    } catch (err) {
      setResult({
        kind: 'err',
        message: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setBusy(false);
    }
  }

  const statusInfo = statusVisual(tx.zohoSyncStatus);

  return (
    <div
      className="rounded-[8px] p-4 space-y-3"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs px-2 py-1 rounded-[3px]"
          style={{
            background: statusInfo.bg,
            color: statusInfo.fg,
            border: `0.5px solid ${statusInfo.fg}`,
            fontWeight: 500,
          }}
        >
          {statusInfo.label}
        </span>
        {tx.zohoSyncLastAttemptAt && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Last attempt: {new Date(tx.zohoSyncLastAttemptAt).toLocaleString('en-ZA')}
          </span>
        )}
      </div>

      {/* Document IDs */}
      <div className="grid grid-cols-1 gap-2 text-sm">
        <DocRow
          label="Commission invoice"
          id={tx.zohoCommissionInvoiceId}
          hint="Posted on dealer-verification APPROVED"
        />
        <DocRow
          label="Mark-paid payment"
          id={tx.zohoCommissionPaymentId}
          hint="Drains Client Funds Payable when payout fires"
        />
        <DocRow
          label="Refund credit note"
          id={tx.zohoCreditNoteId}
          hint="Set only if this transaction was refunded"
        />
      </div>

      {/* Error display */}
      {tx.zohoSyncStatus === 'FAILED' && tx.zohoSyncError && (
        <div
          className="rounded-[6px] p-3 text-xs"
          style={{
            background: 'rgba(200,16,46,0.06)',
            border: '0.5px solid var(--red)',
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
            lineHeight: 1.5,
          }}
        >
          <p style={{ color: 'var(--red)', fontWeight: 500, marginBottom: 4 }}>
            Last error
          </p>
          {tx.zohoSyncError}
        </div>
      )}

      {/* Retry button — visible whenever status is FAILED or
          PENDING-stuck OR (for diagnostic) when there's no invoice
          yet but the transaction is past the trigger point. */}
      {(tx.zohoSyncStatus === 'FAILED' ||
        (!tx.zohoCommissionInvoiceId &&
          tx.dealerVerificationStatus === 'APPROVED')) && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={retrySync}
            disabled={busy}
            className="self-start px-3 py-1.5 rounded-[6px] text-xs"
            style={{
              background: busy ? 'var(--bg-inset)' : 'var(--red)',
              color: busy ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {busy ? 'Retrying…' : 'Retry Books sync'}
          </button>
          {result && (
            <p
              className="text-xs"
              style={{
                color: result.kind === 'ok' ? '#22c55e' : 'var(--red)',
              }}
            >
              {result.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DocRow({
  label,
  id,
  hint,
}: {
  label: string;
  id: string | null;
  hint: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-1"
      style={{ borderBottom: '0.5px dashed var(--border-divider)' }}
    >
      <div className="flex-1 min-w-0">
        <p style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <p
          className="text-xs"
          style={{ color: 'var(--text-tertiary)', marginTop: 2 }}
        >
          {hint}
        </p>
      </div>
      <code
        style={{
          fontSize: 11,
          background: 'var(--bg-inset)',
          padding: '2px 6px',
          borderRadius: 3,
          color: id ? 'var(--text-primary)' : 'var(--text-tertiary)',
          fontFamily: 'ui-monospace, monospace',
          wordBreak: 'break-all',
          textAlign: 'right',
          maxWidth: '60%',
        }}
      >
        {id ?? '— not posted —'}
      </code>
    </div>
  );
}

function statusVisual(s: string | null): {
  label: string;
  fg: string;
  bg: string;
} {
  switch (s) {
    case 'OK':
      return { label: 'Synced', fg: '#22c55e', bg: 'rgba(34,197,94,0.1)' };
    case 'PENDING':
      return { label: 'In flight', fg: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
    case 'FAILED':
      return { label: 'Failed', fg: 'var(--red)', bg: 'rgba(200,16,46,0.1)' };
    case 'SKIPPED':
      return {
        label: 'Skipped',
        fg: 'var(--text-tertiary)',
        bg: 'var(--bg-inset)',
      };
    default:
      return {
        label: 'Not yet synced',
        fg: 'var(--text-tertiary)',
        bg: 'var(--bg-inset)',
      };
  }
}
