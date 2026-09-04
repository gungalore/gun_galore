'use client';

/**
 * THE DESK — the overlays: Drawer, Section, Kv rows, Timeline, MoneyDialog,
 * ReasonDialog, UndoToast.
 *
 * These are the only things on the surface that lift, and the only things
 * that take the operator out of the pile without navigating away from it.
 *
 * ⚠️ NO ANCESTOR OF A DRAWER MAY CARRY A TRANSFORM. A transformed element
 * becomes the containing block for `position: fixed` descendants, so a
 * transform anywhere up the shell silently re-anchors the drawer, the
 * dialogs and the search palette to that box instead of the viewport. This
 * repo has been bitten twice. The drawer animates ITS OWN transform, which is
 * fine — nothing above it may.
 */
import * as React from 'react';
import { Button, Rule } from './primitives';
import { IconAlert, IconClose, IconInfo, IconUndo } from './icons';
import { Label } from './numbers';

/* ────────────────────────────────────────────────────────────────────────
 * Drawer
 * ──────────────────────────────────────────────────────────────────────── */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Mono, uppercase — "Firearm transfer". */
  typeLabel: string;
  reference?: string;
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: React.ReactNode;
  meta?: React.ReactNode;
  tags?: React.ReactNode;
  /** Ghost links at 28px in the header — "Open order ↗". */
  headerActions?: React.ReactNode;
  /** The rule the operator must know before pressing. Sits above the footer. */
  note?: React.ReactNode;
  /** Decision buttons, primary last and right-aligned. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  typeLabel,
  reference,
  icon: Icon,
  title,
  meta,
  tags,
  headerActions,
  note,
  footer,
  children,
}: DrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  // Whatever had focus when the drawer opened gets it back when it closes,
  // so Escape lands the operator back on the card they were deciding.
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]')?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // ⚠️ ESCAPE BELONGS TO THE TOPMOST OVERLAY, AND stopPropagation DOES
        // NOT DELIVER THAT. Both this and DialogFrame listen on `document` in
        // the capture phase, and stopPropagation only stops other NODES —
        // every listener already on document still runs. So a reject confirm
        // stacked over a drawer took one Escape and closed BOTH: the operator
        // meant to back out of the dialog and lost the listing they were
        // reading. Only stopImmediatePropagation would have stopped the pair,
        // and it would have stopped the wrong one — this handler runs first
        // because the drawer mounted first. Deferring to the dialog is the
        // ordering that matches what is on top of the screen.
        if (document.querySelector('.dk-dialog')) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      // Focus trap: the drawer is modal, so Tab must not walk out of it into
      // the pile behind the dim, which is inert but still in the tab order.
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'var(--dk-dim)', zIndex: 60 }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="dk-drawer"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: '100vw',
          zIndex: 61,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--dk-raised)',
          borderLeft: '1px solid var(--dk-line-2)',
          animation: 'dk-drawer-in 180ms ease-out',
        }}
      >
        <div style={{ flex: 'none', padding: '16px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 30,
                height: 30,
                flex: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--dk-inset)',
                border: '1px solid var(--dk-line-2)',
                borderRadius: 'var(--dk-radius-control)',
                color: 'var(--dk-ink-2)',
                cursor: 'pointer',
              }}
            >
              <IconClose size={15} />
            </button>
            {Icon ? <Icon size={14} style={{ color: 'var(--dk-ink-3)' }} /> : null}
            <Label>{typeLabel}</Label>
            {reference ? (
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-4)' }}>
                {reference}
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            {headerActions}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0 14px' }}>
            <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2, color: 'var(--dk-ink)' }}>
              {title}
            </div>
            {meta ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-2)' }}>{meta}</div>
            ) : null}
            {tags ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{tags}</div> : null}
          </div>
          <Rule />
        </div>

        {/* ⚠️ min-height:0 is load-bearing. A scrolling child of a flex column
            refuses to shrink below its content without it, so the drawer body
            pushes the footer off the bottom of the viewport instead of
            scrolling. Same trap on the phone body. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>

        {note || footer ? (
          <div style={{ flex: 'none' }}>
            {note ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 7,
                  padding: '10px 20px 0',
                }}
              >
                <IconInfo size={13} style={{ color: 'var(--dk-ink-3)', marginTop: 1 }} />
                <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>{note}</span>
              </div>
            ) : null}
            {footer ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '14px 20px',
                  marginTop: 12,
                  borderTop: '1px solid var(--dk-line-2)',
                }}
              >
                {footer}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

/** A titled block inside a drawer. */
export function Section({
  label,
  action,
  children,
  last = false,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: last ? undefined : '1px solid var(--dk-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Label>{label}</Label>
        <span style={{ flex: 1 }} />
        {action}
      </div>
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Timeline
 * ──────────────────────────────────────────────────────────────────────── */

export interface TimelineStep {
  title: string;
  sub?: string;
  state: 'done' | 'now' | 'bad' | 'todo';
}

const STEP_INK: Record<TimelineStep['state'], string> = {
  done: 'var(--dk-ink)',
  now: 'var(--dk-info)',
  bad: 'var(--dk-bad)',
  todo: 'transparent',
};

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, minHeight: 34 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: STEP_INK[s.state],
                border: s.state === 'todo' ? '1px solid var(--dk-line-2)' : 'none',
                marginTop: 3,
              }}
            />
            {i < steps.length - 1 ? (
              <span style={{ flex: 1, width: 1, background: 'var(--dk-line-2)' }} />
            ) : null}
          </div>
          <div style={{ paddingBottom: 12, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{s.title}</div>
            {s.sub ? (
              <div className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)', marginTop: 2 }}>
                {s.sub}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Dialogs
 * ──────────────────────────────────────────────────────────────────────── */

export function DialogFrame({
  label,
  title,
  children,
  footer,
  onClose,
  width = 460,
  assertive = false,
}: {
  label: string;
  title: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
  width?: number;
  assertive?: boolean;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  // Whatever had focus when the dialog opened gets it back when it closes.
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    // ⚠️ THIS DIALOG DECLARES aria-modal AND USED TO TRAP NOTHING. Drawer,
    // directly above, does the full job — initial focus, a Tab trap, focus
    // restored on close — and DialogFrame only listened for Escape. So the
    // modal that guards the IRREVERSIBLE actions (MoneyDialog is built on
    // this) was the one a keyboard operator could Tab straight out of, into
    // the inert pile behind the dim, with no visible focus and no way back
    // except Escape. aria-modal="true" also tells a screen reader the outside
    // is inert, which was then untrue.
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]')?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      returnFocusRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'var(--dk-dim)', zIndex: 70 }}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-live={assertive ? 'assertive' : undefined}
        className="dk-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width,
          maxWidth: 'calc(100vw - 32px)',
          zIndex: 71,
          background: 'var(--dk-raised)',
          border: '1px solid var(--dk-line-2)',
          borderRadius: 'var(--dk-radius-card)',
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          animation: 'dk-dialog-in 140ms ease-out',
        }}
      >
        <Label>{label}</Label>
        <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.25, color: 'var(--dk-ink)' }}>
          {title}
        </div>
        {children}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ flex: 1 }} />
          {footer}
        </div>
      </div>
    </>
  );
}

export interface MoneyDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** "Refund R3,150" — the amount is part of the title and the button. */
  title: React.ReactNode;
  /** To / From / Then rows. */
  rows: { k: React.ReactNode; v: React.ReactNode }[];
  confirmLabel: string;
  amount: string;
  loading?: boolean;
}

/**
 * ⚠️ MONEY NEVER UNDOES, AND THE DIALOG SAYS SO IN WORDS.
 *
 * Every other action on the Desk is optimistic with a ten-second window; this
 * one is the exception, and an operator who has learned the undo habit on
 * forty listing reviews will reach for it here too. So the last row is always
 * "Undo: None. Money never undoes." in warn — not because the operator cannot
 * be told once, but because they will be told at 06:40 on a Monday.
 */
export function MoneyDialog({
  open,
  onCancel,
  onConfirm,
  title,
  rows,
  confirmLabel,
  amount,
  loading = false,
}: MoneyDialogProps) {
  if (!open) return null;
  return (
    <DialogFrame
      label="Money · confirm"
      title={title}
      onClose={onCancel}
      assertive
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          {/* 🚨 `disabled` AS WELL AS `loading`. Every other confirm in the Desk
              pairs the two; this one — the money one — passed `loading` alone,
              which spins the button but leaves it clickable. So the single
              dialog guarding a payout run was the single place a double-click
              could fire the action twice. Exactly-once is enforced server-side
              via paidOutAt, so this would not double-PAY, but it would start a
              second bank batch and report a confusing second result. */}
          <Button
            variant="primary"
            onClick={onConfirm}
            amount={amount}
            loading={loading}
            disabled={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              padding: '7px 0',
              borderBottom: '1px solid var(--dk-line)',
              fontSize: 12.5,
            }}
          >
            <span style={{ color: 'var(--dk-ink-3)' }}>{r.k}</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--dk-ink)', textAlign: 'right' }}>{r.v}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 12.5 }}>
          <span style={{ color: 'var(--dk-ink-3)' }}>Undo</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--dk-warn)', textAlign: 'right' }}>
            None. Money never undoes.
          </span>
        </div>
      </div>
    </DialogFrame>
  );
}

/**
 * The server's answer, verbatim.
 *
 * ⚠️ NOT PARAPHRASED, NOT MAPPED TO A FRIENDLY STRING. When a payout fails
 * the only useful thing on the screen is exactly what the gateway said, and
 * a UI that rewrites it as "Something went wrong" costs an hour of support
 * time per incident. Failures keep the drawer open so the text stays put.
 */
export function ResultBlock({
  ok,
  tag,
  body,
}: {
  ok: boolean;
  tag: string;
  body: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: 'var(--dk-surface)',
        border: `1px solid ${ok ? 'var(--dk-ok-line)' : 'var(--dk-bad-line)'}`,
        borderRadius: 10,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {ok ? null : <IconAlert size={12} style={{ color: 'var(--dk-bad)' }} />}
        <span style={{ fontSize: 11, fontWeight: 500, color: ok ? 'var(--dk-ok)' : 'var(--dk-bad)' }}>
          {tag}
        </span>
        <span style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>server response, verbatim</span>
      </span>
      <pre
        className="dk-mono"
        style={{
          margin: 0,
          fontSize: 11.5,
          lineHeight: 1.5,
          color: 'var(--dk-ink-2)',
          background: 'var(--dk-ground)',
          border: '1px solid var(--dk-line)',
          borderRadius: 8,
          padding: '10px 12px',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {body}
      </pre>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * UndoToast
 * ──────────────────────────────────────────────────────────────────────── */

export interface UndoToastProps {
  /** "Approved UM000598" */
  message: string;
  seconds: number;
  total?: number;
  onUndo: () => void;
}

/**
 * ⚠️ THE WINDOW IS A CLIENT DELAY, NOT A SERVER ROLLBACK. Nothing is sent
 * until the ring reaches zero (or the operator navigates away, which flushes
 * it early via sendBeacon). That is what makes Undo instant and free — and
 * it is also why it must never be wired to a money action: there is no
 * pending state on the server to cancel.
 */
export function UndoToast({ message, seconds, total = 10, onUndo }: UndoToastProps) {
  const r = 9;
  const circumference = 2 * Math.PI * r;
  const progress = Math.max(0, Math.min(1, seconds / total));

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        // Above the phone tab bar, not on top of it. BottomTabs is fixed at
        // bottom 0 with height 78 + inset; a flat bottom:24 put this toast
        // wholly INSIDE that footprint, and at z 80 against the bar's 40 it
        // painted over the middle tabs — so the control that undoes a
        // decision covered the controls for leaving the screen.
        // Desktop is unaffected: with no bar rendered the extra lift is a
        // slightly higher toast, which is where it sat on the artboards.
        bottom: 'calc(78px + env(safe-area-inset-bottom, 0px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: 48,
        padding: '0 8px 0 16px',
        background: 'var(--dk-ink)',
        color: 'var(--dk-ground)',
        borderRadius: 'var(--dk-radius-card)',
        animation: 'dk-toast-in 160ms ease-out',
      }}
    >
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          height: 34,
          padding: '0 10px',
          borderRadius: 'var(--dk-radius-control)',
          background: 'transparent',
          border: 'none',
          color: 'var(--dk-ground)',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <IconUndo size={14} />
        Undo
        <span style={{ position: 'relative', width: 22, height: 22, flex: 'none' }}>
          <svg width={22} height={22} viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <circle
              cx="11"
              cy="11"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              transform="rotate(-90 11 11)"
            />
          </svg>
        </span>
      </button>
    </div>
  );
}
