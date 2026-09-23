'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ActionRow,
  EmptyState,
  Icon,
  NeonCard,
  Pill,
  SkeletonRows,
  useAdminToast,
  type AdminTone,
} from '@/components/admin/admin-ui';
import { ReasonDialog } from '@/components/admin/admin-confirm';
import { useAdminSession } from '@/components/admin/admin-session';
import { WardenProposals, WardenThread } from '@/components/admin/warden-thread';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  formatWhen,
  wardenAudit,
  wardenBoard,
  wardenChat,
  wardenPause,
  wardenResume,
  wardenSend,
  wardenSweep,
  type WardenAuditEntry,
  type WardenCheckRow,
} from '@/lib/admin-api';

const ROW_TONE: Record<WardenCheckRow['status'], AdminTone> = {
  ok: 'green',
  warn: 'amber',
  bad: 'red',
  unknown: 'muted',
};

/**
 * THE WARDEN DAEMON — the box watchdog, end to end.
 *
 * ⚠️ TWO ABSENCES THAT ARE NOT THE SAME FACT. `not_deployed` means no daemon is
 * configured, so nothing can be waiting on the operator and saying so is true.
 * `unreachable` means a daemon IS configured and did not answer, so NOTHING WAS
 * READ — rendering that as "all clear" would be reporting a board this process
 * never saw. Every read below branches on it.
 */
export default function WardenDaemonPage() {
  const { isGod } = useAdminSession();
  const { toast } = useAdminToast();

  const chat = useAdminPoll(() => wardenChat(), 15_000);
  const board = useAdminPoll(() => wardenBoard(), 30_000);
  const audit = useAdminPoll(() => wardenAudit(), 60_000);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseMinutes, setPauseMinutes] = useState(60);

  const c = chat.data;
  const absence = c?.absence ?? null;

  function refreshAll() {
    chat.refresh();
    board.refresh();
    audit.refresh();
  }

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await wardenSend(message);
      setDraft('');
      toast('Sent.');
      chat.refresh();
      audit.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  }

  async function run(action: 'sweep' | 'resume') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'sweep') {
        const r = await wardenSweep();
        toast(
          r.finished
            ? r.forced
              ? 'Box re-measured.'
              : 'Joined the sweep already running.'
            : 'Sweep started — the board lands by itself.',
        );
      } else {
        await wardenResume();
        toast('Warden resumed.');
      }
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const boardView = board.data;
  const rows = boardView?.board?.rows ?? [];

  return (
    <>
      <Link href="/admin/warden" style={{ textDecoration: 'none' }}>
        <span className="adm-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="chevron" size={12} /> Warden
        </span>
      </Link>

      {/* ── Daemon state ─────────────────────────────────────────── */}
      <NeonCard
        tone={
          absence === 'not_deployed'
            ? 'muted'
            : absence === 'unreachable'
              ? 'red'
              : c?.paused
                ? 'amber'
                : 'purple'
        }
        title={
          <>
            <span style={{ color: 'var(--adm-purple)' }}>◈</span> Warden daemon
          </>
        }
        action={
          <Pill
            tone={
              absence === 'not_deployed'
                ? 'muted'
                : absence === 'unreachable'
                  ? 'red'
                  : 'purple'
            }
          >
            {absence === 'not_deployed'
              ? 'NOT DEPLOYED'
              : absence === 'unreachable'
                ? 'UNREACHABLE'
                : 'CONNECTED'}
          </Pill>
        }
      >
        {chat.loading && !c ? (
          <SkeletonRows rows={2} />
        ) : chat.error ? (
          <EmptyState icon="alert" title="Could not read the thread" caption={chat.error} />
        ) : absence === 'not_deployed' ? (
          <EmptyState
            icon="server"
            title="No daemon is wired"
            caption={
              c?.note ??
              'Set WARDEN_BASE_URL and WARDEN_TOKEN on the box to connect the daemon.'
            }
          />
        ) : absence === 'unreachable' ? (
          <EmptyState
            icon="alert"
            title="The daemon did not answer"
            caption={c?.note ?? 'This is not a reading of the box.'}
          />
        ) : (
          <p className="adm-sub" style={{ margin: 0 }}>
            {c?.paused
              ? `Paused until ${formatWhen(c.paused.until)}${c.paused.reason ? ` — ${c.paused.reason}` : ''}. Measurement continues; only diagnosis and new proposals are held.`
              : `Last swept ${formatWhen(c?.lastCheckAt)}. Proposals and red gates appear below.`}
          </p>
        )}

        {isGod && absence !== 'not_deployed' ? (
          <>
            {!c?.paused ? (
              <div style={{ marginTop: 12 }}>
                <label className="adm-label" htmlFor="adm-pause-min">
                  If you pause, hold off for
                </label>
                <select
                  id="adm-pause-min"
                  className="adm-select"
                  value={pauseMinutes}
                  onChange={(e) => setPauseMinutes(Number(e.target.value))}
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={240}>4 hours</option>
                  <option value={1440}>24 hours (the maximum)</option>
                </select>
              </div>
            ) : null}
            <div className="adm-grid-2" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="adm-btn"
                data-tone="ghost"
                disabled={busy}
                onClick={() => void run('sweep')}
              >
                <Icon name="refresh" size={14} /> Measure now
              </button>
              {c?.paused ? (
                <button
                  type="button"
                  className="adm-btn"
                  data-tone="green"
                  disabled={busy}
                  onClick={() => void run('resume')}
                >
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  className="adm-btn"
                  data-tone="amber"
                  disabled={busy}
                  onClick={() => setPauseOpen(true)}
                >
                  Pause
                </button>
              )}
            </div>
          </>
        ) : null}
      </NeonCard>

      {error ? (
        <NeonCard tone="red">
          <p style={{ color: 'var(--adm-red)', fontSize: 12, margin: 0 }}>{error}</p>
        </NeonCard>
      ) : null}

      {/* ── Proposals ────────────────────────────────────────────── */}
      {absence === null ? (
        <NeonCard
          tone="purple"
          title="Awaiting your decision"
          action={
            <Pill tone={(c?.proposals.filter((p) => p.status === 'pending').length ?? 0) > 0 ? 'amber' : 'green'}>
              {c?.proposals.filter((p) => p.status === 'pending').length ?? 0} OPEN
            </Pill>
          }
        >
          {chat.loading && !c ? (
            <SkeletonRows rows={2} />
          ) : (
            <WardenProposals proposals={c?.proposals ?? []} onSettled={refreshAll} />
          )}
        </NeonCard>
      ) : null}

      {/* ── The thread ───────────────────────────────────────────── */}
      {absence === null ? (
        <NeonCard title="Thread">
          <WardenThread messages={c?.messages ?? []} onSettled={refreshAll} />
          {isGod ? (
            <div style={{ marginTop: 12 }}>
              <textarea
                className="adm-textarea"
                rows={2}
                value={draft}
                disabled={sending}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="React, refuse, ask or instruct. Warden classifies it."
              />
              <button
                type="button"
                className="adm-btn"
                data-tone="cyan"
                style={{ marginTop: 8, width: '100%' }}
                disabled={sending || draft.trim().length === 0}
                onClick={() => void send()}
              >
                {sending ? 'Sending…' : 'Send to Warden'}
              </button>
            </div>
          ) : (
            <p className="adm-sub" style={{ marginTop: 10, marginBottom: 0 }}>
              Read-only. Speaking to Warden is a full-admin action.
            </p>
          )}
        </NeonCard>
      ) : null}

      {/* ── The measured board ───────────────────────────────────── */}
      <NeonCard
        title="Measured board"
        action={
          boardView?.board ? (
            <Pill
              tone={
                boardView.board.counts.bad > 0
                  ? 'red'
                  : boardView.board.counts.warn > 0
                    ? 'amber'
                    : 'green'
              }
            >
              {boardView.board.counts.bad} BAD · {boardView.board.counts.warn} WARN
            </Pill>
          ) : undefined
        }
      >
        {board.loading && !boardView ? (
          <SkeletonRows rows={4} />
        ) : boardView?.present === false ? (
          <EmptyState
            icon="server"
            title={boardView.absence === 'not_deployed' ? 'Not deployed' : 'Unreachable'}
            caption={boardView.note}
          />
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing measured yet" caption="The daemon has not completed a sweep." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row) => (
              <ActionRow
                key={row.id}
                icon="server"
                tone={ROW_TONE[row.status]}
                title={row.title}
                caption={row.verdict}
                trailing={<Pill tone={ROW_TONE[row.status]}>{row.status.toUpperCase()}</Pill>}
              />
            ))}
            {boardView?.board && boardView.board.dropped > 0 ? (
              <p className="adm-sub" style={{ margin: 0 }}>
                ⚠️ {boardView.board.dropped} row(s) could not be read and are not tallied —
                likely a daemon/backend version skew.
              </p>
            ) : null}
          </div>
        )}
      </NeonCard>

      {/* ── The audit trail ──────────────────────────────────────── */}
      <NeonCard
        title="What Warden has run"
        action={
          audit.data && audit.data.present ? (
            <Pill tone={audit.data.entries.length > 0 ? 'cyan' : 'muted'}>
              {audit.data.entries.length}
            </Pill>
          ) : undefined
        }
      >
        {audit.loading && !audit.data ? (
          <SkeletonRows rows={3} />
        ) : audit.data?.present === false ? (
          <EmptyState icon="clock" title="No run history" caption={audit.data.note} />
        ) : (audit.data?.entries.length ?? 0) === 0 ? (
          <EmptyState
            title="Warden has run nothing"
            caption="Every execution would carry its command, exit code and redacted output here."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(audit.data?.entries ?? []).map((entry) => (
              <AuditEntry key={entry.id} entry={entry} />
            ))}
            {(audit.data?.dropped ?? 0) > 0 ? (
              <p className="adm-sub" style={{ margin: 0 }}>
                ⚠️ {audit.data?.dropped} record(s) are not shown — records neither side could
                render. Read the daemon&apos;s own store.
              </p>
            ) : null}
          </div>
        )}
      </NeonCard>

      <ReasonDialog
        open={pauseOpen}
        title="Pause Warden"
        body={`Measurement does not stop — only diagnosis and new proposals are held for ${pauseMinutes} minutes. It expires on its own, and nothing has to resume it.`}
        confirmLabel="Pause"
        minLength={3}
        onClose={() => setPauseOpen(false)}
        onConfirm={async (reason) => {
          await wardenPause(pauseMinutes, reason);
          toast(`Paused for ${pauseMinutes} minutes.`);
          refreshAll();
        }}
      />
    </>
  );
}

function AuditEntry({ entry }: { entry: WardenAuditEntry }) {
  const tone: AdminTone = entry.timedOut || (entry.exitCode ?? 0) !== 0 ? 'red' : 'green';
  return (
    <div className="adm-msg">
      <header className="adm-msg-head">
        <Pill tone={tone}>
          {entry.operationName ?? entry.operationKind} · {entry.exitCode ?? '—'}
        </Pill>
        <span className="adm-mono" style={{ fontSize: 10, color: 'var(--adm-ink-3)' }}>
          {formatWhen(entry.at)}
        </span>
      </header>
      <p className="adm-msg-foot" style={{ marginTop: 0 }}>
        {entry.trigger === 'unattended' ? 'Ran unattended (safe list)' : 'Approved by an operator'}
        {entry.operatorId ? ` · ${entry.operatorId}` : ''} · {entry.durationMs}ms
      </p>
      <div className="adm-terminal" data-label={entry.trigger === 'unattended' ? 'RAN (UNATTENDED)' : 'RAN (APPROVED)'}>
        {entry.command}
      </div>
      {entry.stdout.text ? (
        <div className="adm-terminal" data-label={`STDOUT${entry.stdout.truncated ? ` (${entry.stdout.originalBytes} bytes, truncated)` : ''}`}>
          {entry.stdout.text}
        </div>
      ) : null}
      {entry.stderr.text ? (
        <div className="adm-terminal" data-label={`STDERR${entry.stderr.truncated ? ` (${entry.stderr.originalBytes} bytes, truncated)` : ''}`}>
          {entry.stderr.text}
        </div>
      ) : null}
      {entry.redactions.length > 0 ? (
        <p className="adm-sub" style={{ margin: '6px 0 0', fontSize: 10.5 }}>
          Redacted before it was stored: {entry.redactions.join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
