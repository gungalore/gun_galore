'use client';

/**
 * THE DESK — the Warden chat.
 *
 * The Site tab is a conversation, not a dashboard: Warden reports what it
 * found, what it fixed on its own, and what it wants permission to do; the
 * operator answers in plain language. The board beside it is the evidence.
 *
 * ⚠️ WHAT WARDEN RAN IS SHOWN VERBATIM, INCLUDING THE OUTPUT. A watchdog with
 * server access that says "fixed it" and nothing else is a watchdog nobody
 * can audit. Every ran message carries the command and what came back, in
 * mono, on the ground colour — the same treatment money results get, for the
 * same reason.
 */
import * as React from 'react';
import { Button, Input, Tag, type TagKind } from './primitives';
import { IconBolt, IconSend } from './icons';

export type WardenKind = 'finding' | 'fixed' | 'red-gate' | 'proposal' | 'ran' | 'note';

const KIND_TAG: Record<WardenKind, { kind: TagKind; label: string }> = {
  finding: { kind: 'warn', label: 'found something' },
  fixed: { kind: 'ok', label: 'fixed alone' },
  'red-gate': { kind: 'bad', label: 'red gate' },
  proposal: { kind: 'info', label: 'proposal' },
  ran: { kind: 'ok', label: 'ran' },
  note: { kind: 'neutral', label: 'note' },
};

export interface WardenMessageProps {
  kind: WardenKind;
  time: string;
  children: React.ReactNode;
  /** The exact diff Warden proposes, if any. */
  diff?: string;
  /** The command and its output, verbatim. */
  output?: string;
  /** Approve / Decline, or whatever this message needs. */
  actions?: React.ReactNode;
  /** "safe-list action · logged" */
  footnote?: string;
}

export function WardenMessage({
  kind,
  time,
  children,
  diff,
  output,
  actions,
  footnote,
}: WardenMessageProps) {
  const tag = KIND_TAG[kind];
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'var(--dk-inset)',
          border: '1px solid var(--dk-line-2)',
          color: 'var(--dk-ink-2)',
        }}
      >
        <IconBolt size={14} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, maxWidth: '88%' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--dk-ink)' }}>Warden</span>
          <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
            {time}
          </span>
          <Tag kind={tag.kind}>{tag.label}</Tag>
        </span>
        <div
          style={{
            background: 'var(--dk-surface)',
            border: '1px solid var(--dk-line)',
            borderRadius: 'var(--dk-radius-card)',
            borderTopLeftRadius: 4,
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--dk-ink-2)' }}>{children}</span>
          {diff ? <Pre tone="inset">{diff}</Pre> : null}
          {output ? <Pre tone="ground">{output}</Pre> : null}
          {actions ? <span style={{ display: 'flex', gap: 8 }}>{actions}</span> : null}
        </div>
        {footnote ? (
          <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
            {footnote}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The operator's own turn — right-aligned, inset, mirrored corner. */
export function OperatorMessage({ time, children }: { time: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
      <div
        style={{
          maxWidth: '78%',
          background: 'var(--dk-inset)',
          border: '1px solid var(--dk-line-2)',
          borderRadius: 'var(--dk-radius-card)',
          borderTopRightRadius: 4,
          padding: '10px 14px',
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--dk-ink)',
        }}
      >
        {children}
      </div>
      <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
        {time} · you
      </span>
    </div>
  );
}

function Pre({ children, tone }: { children: string; tone: 'inset' | 'ground' }) {
  return (
    <pre
      className="dk-mono"
      style={{
        margin: 0,
        fontSize: 11.5,
        lineHeight: 1.55,
        color: 'var(--dk-ink-2)',
        background: tone === 'ground' ? 'var(--dk-ground)' : 'var(--dk-inset)',
        border: '1px solid var(--dk-line)',
        borderRadius: 8,
        padding: '10px 12px',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </pre>
  );
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  placeholder = 'Tell Warden what to do…',
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
        </div>
        <Button variant="primary" icon={IconSend} onClick={onSend}>
          Send
        </Button>
      </div>
      {/* The standing rule, where the operator is about to type an instruction
          — not buried in a settings page they will never open. */}
      <span style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
        Warden acts alone only on its safe list — restart a worker, retry a sync, clear a stuck job.
        Anything touching config, money or member data waits for your word here. Every action, either
        way, lands in the audit trail.
      </span>
    </div>
  );
}
