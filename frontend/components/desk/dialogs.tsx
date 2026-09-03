'use client';

/**
 * THE DESK — ReasonDialog and SearchPalette.
 *
 * Both sit in the same raised frame as the money confirm; what differs is
 * what they ask for.
 */
import * as React from 'react';
import { Button, Input } from './primitives';
import { DialogFrame } from './overlays';
import { RadioRow } from './forms';
import { IconChevronRight, IconSearch, type IconProps } from './icons';
import { Key } from './primitives';

/* ────────────────────────────────────────────────────────────────────────
 * ReasonDialog
 * ──────────────────────────────────────────────────────────────────────── */

export interface ReasonOption {
  value: string;
  label: string;
  /** What the choice costs the member — a strike, a ban count. */
  consequence?: string;
}

export interface ReasonDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, note: string) => void;
  title: React.ReactNode;
  options: ReasonOption[];
  confirmLabel: string;
  /** "The seller sees this." — say who reads the free text. */
  noteHint: string;
  /**
   * The eyebrow over the title. Defaults to a rejection because that is what
   * this dialog was written for, but it is NOT always one: the listing drawer
   * asks for a reason when taking a live listing down, and a dialog labelled
   * "Reject" over a "Take down and email the seller" button misnames the act
   * at the last moment the operator can still stop.
   */
  label?: string;
}

/**
 * ⚠️ THE REASON IS A TICKLIST, NOT A TEXT BOX.
 *
 * Free text alone cannot be counted, and these reasons are counted: on the
 * offer flow every reason except BUYER_SUSPICIOUS carries a strike and three
 * strikes is a selling ban. A typed sentence would make that ban
 * unauditable — and it would also mean the same rejection is spelled six
 * ways across six operators. The free-text field is additive: it is what the
 * member reads, on top of the reason the system records.
 */
export function ReasonDialog({
  open,
  onCancel,
  onConfirm,
  title,
  options,
  confirmLabel,
  noteHint,
  label = 'Reject · reason',
}: ReasonDialogProps) {
  const [reason, setReason] = React.useState<string>('');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <DialogFrame
      label={label}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            // No reason, no rejection. The control says why it will not fire
            // rather than being greyed out with no explanation.
            disabled={!reason}
            onClick={() => onConfirm(reason, note)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map((o) => (
          <RadioRow
            key={o.value}
            name="desk-reason"
            checked={reason === o.value}
            onChange={() => setReason(o.value)}
            label={o.label}
            sub={o.consequence}
          />
        ))}
      </div>
      <Input
        placeholder="Anything to add?"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{noteHint}</span>
    </DialogFrame>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * SearchPalette
 * ──────────────────────────────────────────────────────────────────────── */

export interface SearchResult {
  group: 'Orders' | 'Members' | 'Listings';
  /** Mono, fixed 84px column so the titles line up down the list. */
  ref: string;
  title: string;
  context?: string;
  icon: React.ComponentType<IconProps>;
  onOpen: () => void;
}

export function SearchPalette({
  open,
  onClose,
  query,
  onQueryChange,
  results,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchResult[];
  loading?: boolean;
}) {
  const [cursor, setCursor] = React.useState(0);

  React.useEffect(() => setCursor(0), [query]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        results[cursor]?.onOpen();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose, results, cursor]);

  if (!open) return null;

  const groups = ['Orders', 'Members', 'Listings'] as const;
  let index = -1;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--dk-dim)', zIndex: 70 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="dk-dialog"
        style={{
          position: 'fixed',
          top: 96,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 640,
          maxWidth: 'calc(100vw - 32px)',
          zIndex: 71,
          background: 'var(--dk-raised)',
          border: '1px solid var(--dk-line-2)',
          borderRadius: 'var(--dk-radius-card)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 52,
            padding: '0 16px',
            borderBottom: '1px solid var(--dk-line)',
          }}
        >
          <IconSearch size={16} style={{ color: 'var(--dk-ink-3)' }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Find an order, member or listing"
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--dk-ink)',
              fontFamily: 'inherit',
              fontSize: 15,
            }}
          />
          <Key>Esc</Key>
        </div>

        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: 'var(--dk-ink-3)' }}>
              {loading ? 'Searching…' : query ? `Nothing for “${query}”` : 'Type to search'}
            </div>
          ) : (
            groups.map((g) => {
              const rows = results.filter((r) => r.group === g);
              if (rows.length === 0) return null;
              return (
                <div key={g}>
                  <div
                    className="dk-mono"
                    style={{
                      padding: '10px 16px 4px',
                      fontSize: 10.5,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      color: 'var(--dk-ink-3)',
                    }}
                  >
                    {g}
                  </div>
                  {rows.map((r) => {
                    index += 1;
                    const on = index === cursor;
                    const Icon = r.icon;
                    return (
                      <button
                        key={`${r.group}-${r.ref}`}
                        type="button"
                        onClick={r.onOpen}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          width: '100%',
                          padding: '9px 14px',
                          border: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          background: on ? 'var(--dk-inset)' : 'transparent',
                          color: 'var(--dk-ink)',
                          fontFamily: 'inherit',
                        }}
                      >
                        <Icon size={15} style={{ color: 'var(--dk-ink-3)' }} />
                        <span className="dk-mono" style={{ width: 84, flex: 'none', fontSize: 12, color: 'var(--dk-ink-2)' }}>
                          {r.ref}
                        </span>
                        <span style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title}
                        </span>
                        <span style={{ flex: 1 }} />
                        {r.context ? (
                          <span style={{ fontSize: 12, color: 'var(--dk-ink-3)', whiteSpace: 'nowrap' }}>
                            {r.context}
                          </span>
                        ) : null}
                        {on ? <Key>Enter</Key> : <IconChevronRight size={14} style={{ color: 'var(--dk-ink-4)' }} />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
