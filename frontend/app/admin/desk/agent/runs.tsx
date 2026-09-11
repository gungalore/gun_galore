'use client';

/**
 * AGENT — every command Warden has run on the production box.
 *
 * 🚨 GET /admin/warden/audit SHIPPED AND NOTHING IN frontend/ HAS EVER CALLED
 * IT. The daemon has written an audit record for every execution since it
 * shipped — operation, resolved arguments, exit code, redacted verbatim
 * transcript — and the operator's only view of a run was its `ran` chat
 * message, which ages out of a 600-record on-disk window and a 200-message
 * wire window. Past that, "what has this agent done to the box" was a question
 * you answered by SSH-ing in and reading JSON. This card is the answer.
 *
 * It is a GET, so a read-only MONITORING_ADMIN can open it. That is deliberate
 * on the backend and worth not undoing here: the people most likely to need
 * this are the ones who cannot write.
 *
 * ⚠️ REDACTION HAPPENS IN THE DAEMON, BEFORE PERSISTENCE AND BEFORE
 * TRUNCATION, so a secret cannot sit across a cut boundary. `redactions` names
 * what fired and never a value. Nothing here may undo that — this component
 * only ever narrows further.
 */
import * as React from 'react';
import { Button, FailedRegion, IconAlert, IconCheck, IconRefresh, Tag } from '../../../../components/desk';
import { describeFailure } from '../../../../lib/desk-auth';
import {
  fetchWardenAudit,
  stamp,
  type WardenAudit,
  type WardenAuditEntry,
  type WardenTruncatedText,
} from '../../../../lib/desk-site';
import { Card, Pre, Quiet, Stack } from '../health/board-bits';

export function RunLog() {
  const [audit, setAudit] = React.useState<WardenAudit | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // One at a time, never a wall: a transcript is dozens of lines and two open
  // at once means neither is readable.
  const [open, setOpen] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setBusy(true);
    try {
      setAudit(await fetchWardenAudit());
      setFailure(null);
    } catch (err) {
      // ⚠️ THE LAST GOOD READING STAYS ON SCREEN, like the probe sweep. This
      // card is opened during an argument about what ran; blanking it because
      // one refresh 500d throws away the only copy of the answer.
      setFailure(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      label="What has actually run"
      hint={
        audit === null
          ? 'reading…'
          : !audit.present
            ? 'no daemon'
            : `${audit.entries.length} run${audit.entries.length === 1 ? '' : 's'}`
      }
      headerTag={
        <Button variant="ghost" icon={IconRefresh} loading={busy} onClick={() => void load()}>
          Re-read
        </Button>
      }
      footer="Every execution the daemon recorded, newest first — the safe list it ran on its own, and the commands an operator approved. The transcript is redacted on the box before it is written down."
    >
      {failure ? (
        <FailedRegion
          title="Couldn't read the run log"
          detail={failure}
          onRetry={() => void load()}
          scopeNote={audit ? 'the runs below are from the last good read' : 'only this card failed'}
        />
      ) : null}

      {audit === null ? (
        <Quiet>Reading…</Quiet>
      ) : !audit.present ? (
        <Quiet>{audit.note ?? 'Warden is not deployed, so nothing has run and there is nothing to show.'}</Quiet>
      ) : audit.entries.length === 0 ? (
        <Quiet>
          Warden has not run anything. That is a real state on a young box — it acts only on its
          own safe list or on a command somebody approved.
        </Quiet>
      ) : (
        audit.entries.map((e, i) => (
          <RunRow
            key={e.id}
            entry={e}
            last={i === audit.entries.length - 1}
            open={open === e.id}
            onToggle={() => setOpen((cur) => (cur === e.id ? null : e.id))}
          />
        ))
      )}

      {/* 🚨 `truncated` AND `dropped` ARE PRINTED AS TWO SEPARATE LINES AND
          MUST NEVER BE ADDED TOGETHER. They mean different things and they
          have different fixes: truncated is answered by asking for the next
          page, dropped by ssh-ing into the box and reading the daemon's own
          store. A single badge saying "12 not shown" loses the only half that
          tells the operator which of the two they are looking at — and an
          incomplete record of what executed on a production box reads exactly
          like a complete one. */}
      {audit?.truncated ? (
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
          Older runs exist than this page carries. Paging further back is not built here yet; the
          daemon holds a 600-record window on disk.
        </span>
      ) : null}
      {audit && audit.dropped > 0 ? (
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <IconAlert size={14} style={{ color: 'var(--dk-bad)', flex: 'none', marginTop: 2 }} />
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-bad)' }}>
            {`${audit.dropped} run${audit.dropped === 1 ? '' : 's'} could not be rendered at all — ` +
              'a record neither side of the wire could name, usually a daemon deployed beside a ' +
              'backend that was not (deploy.sh ships Warden as a separate, non-fatal stage). ' +
              'These are NOT further down the list: read the daemon’s own store on the box.'}
          </span>
        </span>
      ) : null}
    </Card>
  );
}

function RunRow({
  entry: e,
  last,
  open,
  onToggle,
}: {
  entry: WardenAuditEntry;
  last: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const timedOut = e.timedOut;
  const ok = !timedOut && e.exitCode === 0;
  const failed = !timedOut && e.exitCode !== null && e.exitCode !== 0;

  return (
    <Stack last={last}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Tag kind={ok ? 'ok' : failed || timedOut ? 'bad' : 'neutral'} icon={ok ? IconCheck : undefined}>
          {timedOut ? 'timed out' : e.exitCode === null ? 'no exit code' : `exit ${e.exitCode}`}
        </Tag>
        {/* ⚠️ THE TRIGGER IS THE FIRST THING WORTH KNOWING ABOUT A RUN, before
            what it did: `unattended` is the daemon acting inside its own safe
            list with no human, `operator_approved` is a command somebody read
            and echoed back. They are different kinds of event and the row
            should not make a reader work out which. */}
        <Tag kind={e.trigger === 'operator_approved' ? 'info' : 'neutral'} icon={null}>
          {e.trigger === 'operator_approved' ? 'approved' : 'unattended'}
        </Tag>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
          {e.operationName ?? (e.operationKind === 'approved_command' ? 'approved command' : 'safe-list operation')}
        </span>
        <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
          {duration(e.durationMs)}
        </span>
        <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
          {stamp(e.at)}
        </span>
        <Button variant="ghost" onClick={onToggle}>
          {open ? 'Hide' : 'Open'}
        </Button>
      </span>

      {open ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>What ran</span>
          {/* `ground`, because this one already ran. */}
          <Pre tone="ground">{e.command}</Pre>

          <Output label="stdout" block={e.stdout} />
          <Output label="stderr" block={e.stderr} />

          {/* Names, never values. See the file header. */}
          {e.redactions.length ? (
            <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
              {`Redacted before this was written down: ${e.redactions.join(', ')}.`}
            </span>
          ) : null}

          {/* ⚠️ `recheck: null` MEANS NOBODY LOOKED YET. That is a different
              claim from `{ result: 'unknown' }`, which means somebody looked
              and could not tell, and rendering them the same way would let an
              unverified fix read as a verified one. */}
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            {e.recheck
              ? `Re-checked ${stamp(e.recheck.at)} — ${e.recheck.result}. ${e.recheck.note}`
              : 'Nothing has re-checked this yet. The daemon looks again on its own cadence; an unchecked fix is not a failed one.'}
          </span>

          {e.proposalId ? (
            <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
              {`proposal ${e.proposalId}`}
            </span>
          ) : null}
        </div>
      ) : null}
    </Stack>
  );
}

/**
 * One output block.
 *
 * ⚠️ `originalBytes` IS THE SIZE BEFORE TRUNCATION, not the size of what
 * survived, so the reader can see how much was withheld rather than being told
 * only that something was. Empty output is stated, never left as a blank
 * region a reader has to interpret.
 */
function Output({ label, block }: { label: string; block: WardenTruncatedText }) {
  if (!block.text && !block.truncated) {
    return (
      <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{`${label}: empty`}</span>
    );
  }
  return (
    <>
      <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
        {block.truncated
          ? `${label} · cut down from ${bytes(block.originalBytes)}`
          : `${label} · ${bytes(block.originalBytes)}`}
      </span>
      <Pre tone="ground">{block.text}</Pre>
    </>
  );
}

function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} kB`;
}

function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
