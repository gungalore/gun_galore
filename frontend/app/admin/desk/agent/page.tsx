'use client';

/**
 * THE DESK — Agent.
 *
 * Everything on this board is about the daemon watching the production box:
 * what it wants permission to do, what it has said, what it has actually run,
 * and the two levers that change its behaviour. It came out of the Site board,
 * where the chat card, the thread and the three decision dialogs were roughly
 * 700 lines of a 2,926-line file, interleaved with the gates, the vitals, the
 * alerts inbox and trust-and-safety and sharing a page-level loader with them.
 *
 * 🚨 THE ORDER IS THE POINT. Queue, then conversation, then run log. On Site a
 * proposal was a message in a scrollback — the only WORK on the page rendered
 * inside the only READING on the page — so an operator could scroll past the
 * one thing that needed them and have no count anywhere telling them they had.
 *
 * 🚨 FOUR OF THE TEN WARDEN ROUTES SHIPPED WITH NO CALLER ANYWHERE IN
 * frontend/: audit, sweep, pause and resume. All four are wired here. The one
 * that mattered most is pause: the Site board's "Pause Warden" button posted a
 * CHAT MESSAGE which the daemon classified as a QUESTION — warden.service.ts
 * records that its instruction parser matches `remember:`, `forget: N` and the
 * bare standing-list words, so the sentence went to the model for one turn and
 * was then forgotten, never stored, never seen by the next sweep. The word
 * "pause" did not appear anywhere in the daemon's source. So the control that
 * is supposed to stop an agent proposing changes to a production box stopped
 * nothing at all, and its own confirm text admitted it. That constant is
 * deleted, not left beside the real call: two ways to pause is how the wrong
 * one gets used.
 *
 * ⚠️ AND PAUSING DOES NOT STOP MEASUREMENT. The daemon keeps sweeping on its
 * cadence and keeps announcing what turns; what stops is the model call and
 * any new proposal. Every sentence on this page that mentions the pause says
 * so, because a UI rendering it as "Warden stopped" lets an operator read a
 * still-updating board as frozen — or, worse, a frozen one as live.
 *
 * ⚠️ NO `site={{tone, word}}` ON THIS SHELL. That dot is derived from the
 * config gates, and the gates live on Health. A second board passing a dot it
 * computed from something else would be two lights disagreeing about one box —
 * which is the failure DeskShell's own comment records from when every surface
 * carried a hard-coded green "Healthy".
 */
import * as React from 'react';
import {
  Button,
  DeskShell,
  DialogFrame,
  IconBolt,
  IconCheck,
  IconLock,
  IconPause,
  IconRefresh,
  Input,
  SkeletonPile,
  Tag,
  useIsPhone,
} from '../../../../components/desk';
import { describeFailure } from '../../../../lib/desk-auth';
import {
  approveWardenProposal,
  clock,
  declineWardenProposal,
  fetchWardenChat,
  pauseWarden,
  proposalAuthority,
  resumeWarden,
  reversibilityLine,
  sendWardenChat,
  sweepWarden,
  wardenAbsent,
  wardenAbsenceWord,
  type WardenChat,
  type WardenProposal,
} from '../../../../lib/desk-site';
import { Pre } from '../health/board-bits';
import { ApprovalQueue } from './queue';
import { RunLog } from './runs';
import { WardenChatCard } from './thread';

/**
 * The durations the pause dialog offers.
 *
 * ⚠️ THERE IS NO "UNTIL I SAY SO", AND THE ABSENCE IS THE DESIGN. PauseWardenDto
 * accepts 1–1440 minutes and the daemon clamps to 24 hours on its own side as
 * well, because a pause is set during an incident by somebody mid-something
 * else and the one thing nobody ever does is come back and resume it. An
 * open-ended pause is a watchdog silently switched off for a month while this
 * board still reads as though it is watching.
 */
const PAUSE_CHOICES = [
  { minutes: 15, label: '15 minutes', why: 'a deploy' },
  { minutes: 60, label: '1 hour', why: 'an incident' },
  { minutes: 240, label: '4 hours', why: 'a migration or a restore' },
  { minutes: 1440, label: '24 hours', why: 'the maximum the daemon will hold' },
] as const;

export default function AgentPage() {
  const phone = useIsPhone();

  const [chat, setChat] = React.useState<WardenChat | null>(null);
  const [chatError, setChatError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);

  const [approve, setApprove] = React.useState<WardenProposal | null>(null);
  const [decline, setDecline] = React.useState<WardenProposal | null>(null);
  const [decisionBusy, setDecisionBusy] = React.useState(false);
  const [decisionError, setDecisionError] = React.useState<string | null>(null);
  const [decisionReason, setDecisionReason] = React.useState('');

  const [pauseOpen, setPauseOpen] = React.useState(false);
  const [pauseMinutes, setPauseMinutes] = React.useState<number>(60);
  const [pauseReason, setPauseReason] = React.useState('');

  const [sweepBusy, setSweepBusy] = React.useState(false);
  const [sweepNote, setSweepNote] = React.useState<string | null>(null);
  const [controlError, setControlError] = React.useState<string | null>(null);

  /**
   * ⚠️ ONE FETCH, ONE FAILURE, AND NOTHING ELSE ON THIS PAGE SHARES IT. The
   * Site board awaited /admin/desk/site/board and /admin/settings under a
   * single try/catch, so a settings 500 replaced the entire page — gates,
   * vitals, alerts, trust-and-safety — with one red panel, and silently
   * skipped three fire-and-forget reads that sat after the await. The run log
   * below owns its own state and its own failure for exactly that reason.
   */
  const loadChat = React.useCallback(async () => {
    try {
      setChat(await fetchWardenChat());
      setChatError(null);
    } catch (err) {
      setChat(
        wardenAbsent(
          'Warden did not answer this browser. Nothing below is a reading of the daemon — it is what this process could not get.',
        ),
      );
      setChatError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void loadChat();
  }, [loadChat]);

  const present = chat?.present === true;
  const paused = chat?.paused ?? null;
  const proposals = chat?.proposals ?? [];
  const pendingCount = proposals.filter((p) => p.status === 'pending').length;

  const send = React.useCallback(async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      await sendWardenChat(message);
      setDraft('');
      await loadChat();
      setChatError(null);
    } catch (err) {
      setChatError(describeFailure(err));
    } finally {
      setSending(false);
    }
  }, [draft, sending, loadChat]);

  /**
   * Measure the box now, cadence ignored.
   *
   * ⚠️ NO CONFIRM, AND `finished: false` IS REPORTED AS A SUCCESS. A sweep
   * changes nothing on the box — it reads. What it costs is load, which the
   * backend records an audit row for, so the accountability is there without a
   * dialog standing between an operator and the thing they came here to do:
   * today somebody who has just fixed a certificate waits up to six hours for
   * tls-origin to look again.
   *
   * ⚠️ AND `forced: false` IS NOT HIDDEN. It means this call joined a cadence
   * sweep already in flight, so some of those rows are carried forward rather
   * than freshly measured. Reporting that as a full re-measure is exactly the
   * claim the field exists to refuse.
   */
  const sweep = React.useCallback(async () => {
    if (sweepBusy) return;
    setSweepBusy(true);
    setControlError(null);
    setSweepNote(null);
    try {
      const r = await sweepWarden();
      const shape = r.joined
        ? 'Joined the sweep already running, so some rows are carried forward rather than re-measured'
        : r.forced
          ? 'Forced a full re-measure'
          : 'The daemon did not say this was a forced sweep, so treat some rows as carried forward';
      const ending = r.finished
        ? `finished — ${r.rows} rows, ${r.bad} bad, ${r.warn} warn, ${r.unknown} not measured.`
        : 'still running — it answered early so the request could not outlive nginx. The board lands on Health by itself.';
      setSweepNote(
        `${shape}: ${ending}` +
          (r.droppedRows > 0
            ? ` ${r.droppedRows} row${r.droppedRows === 1 ? '' : 's'} could not be read and ${r.droppedRows === 1 ? 'is' : 'are'} in none of those numbers.`
            : ''),
      );
      /**
       * 🚨 THE ONE WARDEN WRITE ON THIS PAGE THAT DID NOT RE-READ THE CHAT.
       * send, approve, decline, pause and resume all call loadChat() after
       * they resolve; sweep did not. So a completed sweep printed fresh
       * counts — rows, bad, warn — directly beneath a header and a tag still
       * reading `checked <pre-sweep time>`. The board said it had just
       * measured the box and showed, an inch away, when it last had. The two
       * came from the same click.
       *
       * ⚠️ AFTER setSweepNote, NOT BEFORE. loadChat() swallows its own
       * failure into the chat card; ordering it second means an unreachable
       * daemon on the re-read cannot take the sweep's own result off screen.
       */
      await loadChat();
    } catch (err) {
      setControlError(describeFailure(err));
    } finally {
      setSweepBusy(false);
    }
  }, [sweepBusy, loadChat]);

  /**
   * ⚠️ RESUME HAS NO CONFIRM AND PAUSE DOES. They are not symmetrical: pause
   * suspends the thing that watches a production box, resume restores it. A
   * dialog in front of the safe direction is a dialog people learn to click
   * through, and the one in front of the dangerous direction goes with it.
   */
  const resume = React.useCallback(async () => {
    if (decisionBusy) return;
    setDecisionBusy(true);
    setControlError(null);
    try {
      await resumeWarden();
      await loadChat();
    } catch (err) {
      setControlError(describeFailure(err));
    } finally {
      setDecisionBusy(false);
    }
  }, [decisionBusy, loadChat]);

  return (
    <DeskShell
      active="agent"
      title="Agent"
      sub={
        chat === null
          ? 'reading…'
          : !present
            ? // ⚠️ NOT THE LITERAL. See wardenAbsenceWord: this line said
              // "Warden not deployed" for an unreachable daemon too, directly
              // above a queue that had been taught to say the opposite.
              wardenAbsenceWord(present, chat.absence)
            : paused
              ? `Paused until ${clock(paused.until)} · still measuring`
              : pendingCount
                ? `${pendingCount} waiting on you · checked ${clock(chat.lastCheckAt)}`
                : `Active · checked ${clock(chat.lastCheckAt)}`
      }
    >
      {phone ? null : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>Agent</span>
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
            what Warden wants, what it said, what it ran
          </span>
          <span style={{ flex: 1 }} />
        </div>
      )}

      <AgentControls
        chat={chat}
        compact={phone}
        busy={decisionBusy}
        sweepBusy={sweepBusy}
        onSweep={() => void sweep()}
        onPause={() => {
          setControlError(null);
          setPauseReason('');
          setPauseOpen(true);
        }}
        onResume={() => void resume()}
      />

      {controlError ? (
        <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)', whiteSpace: 'pre-wrap' }}>
          {controlError}
        </span>
      ) : null}
      {sweepNote ? (
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>{sweepNote}</span>
      ) : null}

      {chat === null ? (
        <SkeletonPile count={2} />
      ) : (
        <>
          <ApprovalQueue
            proposals={proposals}
            loading={false}
            present={present}
            // ⚠️ WHICH SILENCE, NOT JUST THAT IT IS SILENT. An unreachable
            // daemon read nothing, so the queue may not report an empty list
            // as an empty queue. See ApprovalQueue's own comment.
            absence={chat.absence}
            paused={Boolean(paused)}
            onApprove={(p) => {
              setDecisionReason('');
              setDecisionError(null);
              setApprove(p);
            }}
            onDecline={(p) => {
              setDecisionReason('');
              setDecisionError(null);
              setDecline(p);
            }}
          />

          <WardenChatCard
            chat={chat}
            failure={chatError}
            phone={phone}
            draft={draft}
            onDraft={setDraft}
            onSend={() => void send()}
            sending={sending}
            onApprove={(p) => {
              setDecisionReason('');
              setDecisionError(null);
              setApprove(p);
            }}
            onDecline={(p) => {
              setDecisionReason('');
              setDecisionError(null);
              setDecline(p);
            }}
          />

          <RunLog />
        </>
      )}

      {/* ══ Approve the fix — money-grade ══════════════════════════════
          🚨 THE CONFIRM RESTATES THE EXACT COMMAND, and the approve call
          echoes that same string back for a compare-and-swap: the server
          re-reads the proposal from Warden and refuses on any difference. A
          card rendered at 09:05 and approved at 09:40 must not approve
          whatever the proposal says at 09:40.

          🚨 AND IT NEVER UNDOES. This runs on the production box. There is no
          undo toast on this action and there must not be one. */}
      {approve ? (
        <DialogFrame
          label="Warden · approve the fix"
          title="Approve the fix"
          width={520}
          onClose={() => {
            if (decisionBusy) return;
            setApprove(null);
          }}
          footer={
            <>
              <Button variant="ghost" disabled={decisionBusy} onClick={() => setApprove(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={IconCheck}
                loading={decisionBusy}
                disabled={decisionBusy || !approve.command}
                onClick={() => {
                  if (decisionBusy || !approve.command) return;
                  setDecisionBusy(true);
                  setDecisionError(null);
                  void approveWardenProposal(approve.id, approve.command, decisionReason.trim())
                    .then(() => loadChat())
                    .then(() => setApprove(null))
                    .catch((e) => setDecisionError(describeFailure(e)))
                    .finally(() => setDecisionBusy(false));
                }}
              >
                Approve and run
              </Button>
            </>
          }
        >
          <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>
            {approve.headline}
          </span>
          {approve.diagnosis ? (
            <span style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--dk-ink-3)' }}>
              {approve.diagnosis}
            </span>
          ) : null}
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)' }}>
            Warden will run exactly this, on the production box:
          </span>
          <Pre tone="ground">{approve.command ?? '—'}</Pre>

          {/* ══ WHAT AUTHORITY THIS ACTUALLY GRANTS ════════════════════════
              🚨 THIS BLOCK USED TO BE ONE SENTENCE THAT SAID "It runs inside
              Warden's own safe list" ON EVERY PROPOSAL. That is true only of
              a proposal the daemon backed with a validated safe-list pick.
              For a model-drafted free-form command — the `approved_command`
              path, which the run log at the foot of this same page renders
              under that name — it was false, and false in the one direction
              that matters: the operator was told the thing they were
              approving was enum-bounded when the only bound on it was their
              own reading of the string. The daemon knew the difference all
              along; projectProposal() dropped it before the wire.

              ⚠️ THE FREE-FORM VOICE IS THE DEFAULT. `operationName` absent —
              an older daemon, an older API — reads as free-form, so the worst
              a version skew can do is over-warn. */}
          <AuthorityNote proposal={approve} />
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            The audit row names the command after it has run, because it cannot name it before; it
            appears in the run log below within a sweep or two. There is no undo.
          </span>
          {decisionError ? (
            <span
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--dk-bad)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {`Nothing ran.\n${decisionError}`}
            </span>
          ) : null}
          <Input
            placeholder="Why, if it is worth saying — optional, goes in the audit trail"
            value={decisionReason}
            onChange={(e) => setDecisionReason(e.target.value)}
          />
        </DialogFrame>
      ) : null}

      {/* Decline. The reason is the useful half — Warden reads declines back
          as standing guidance — but it stays optional, because an operator
          who just wants it gone should not be held up by a text box. */}
      {decline ? (
        <DialogFrame
          label="Warden · decline"
          title="Decline the fix"
          onClose={() => {
            if (decisionBusy) return;
            setDecline(null);
          }}
          footer={
            <>
              <Button variant="ghost" disabled={decisionBusy} onClick={() => setDecline(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                loading={decisionBusy}
                disabled={decisionBusy}
                onClick={() => {
                  if (decisionBusy) return;
                  setDecisionBusy(true);
                  setDecisionError(null);
                  void declineWardenProposal(decline.id, decisionReason.trim())
                    .then(() => loadChat())
                    .then(() => setDecline(null))
                    .catch((e) => setDecisionError(describeFailure(e)))
                    .finally(() => setDecisionBusy(false));
                }}
              >
                Decline
              </Button>
            </>
          }
        >
          <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>
            {decline.headline}
          </span>
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            Nothing runs. Warden reads the reason back as standing guidance, so a sentence here is
            worth more than a silent refusal.
          </span>
          {decisionError ? (
            <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)', whiteSpace: 'pre-wrap' }}>
              {`The proposal is still open.\n${decisionError}`}
            </span>
          ) : null}
          <Input
            placeholder="Why — optional, and Warden keeps it"
            value={decisionReason}
            onChange={(e) => setDecisionReason(e.target.value)}
          />
        </DialogFrame>
      ) : null}

      {/* ══ Pause — a real route now ═══════════════════════════════════
          🚨 THIS DIALOG USED TO POST A CHAT MESSAGE. The constant it sent was
          called PAUSE_INSTRUCTION and its comment asserted "THERE IS NO PAUSE
          ROUTE ... The API exposes six Warden routes and none of them stops
          the daemon." The API exposes ten, two of them are pause and resume,
          both are audited, and the daemon classified the message as a
          question — so the button did nothing and said as much in its own
          confirm text. It posts POST /admin/warden/pause now.

          ⚠️ THE COPY MAY NOT SAY WARDEN IS STOPPED. Measurement continues on
          the same cadence; what stops is diagnosis and new proposals. */}
      {pauseOpen ? (
        <DialogFrame
          label="Warden · pause"
          title="Pause diagnosis and proposals"
          width={520}
          onClose={() => {
            if (decisionBusy) return;
            setPauseOpen(false);
          }}
          footer={
            <>
              <Button variant="ghost" disabled={decisionBusy} onClick={() => setPauseOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                icon={IconPause}
                loading={decisionBusy}
                disabled={decisionBusy}
                onClick={() => {
                  if (decisionBusy) return;
                  setDecisionBusy(true);
                  setControlError(null);
                  void pauseWarden(pauseMinutes, pauseReason)
                    .then(() => loadChat())
                    .then(() => setPauseOpen(false))
                    .catch((e) => setControlError(describeFailure(e)))
                    .finally(() => setDecisionBusy(false));
                }}
              >
                {`Pause for ${PAUSE_CHOICES.find((c) => c.minutes === pauseMinutes)?.label ?? `${pauseMinutes} minutes`}`}
              </Button>
            </>
          }
        >
          <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>
            Warden keeps sweeping the box on its own cadence and keeps announcing what turns. What
            stops is the diagnosis and any new proposal. Nothing on Health goes stale.
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {PAUSE_CHOICES.map((c) => {
              const on = pauseMinutes === c.minutes;
              return (
                <button
                  key={c.minutes}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPauseMinutes(c.minutes)}
                  className="dk-control"
                  style={{
                    justifyContent: 'flex-start',
                    gap: 10,
                    background: on ? 'var(--dk-ink)' : 'transparent',
                    border: `1px solid ${on ? 'var(--dk-ink)' : 'var(--dk-line-2)'}`,
                    color: on ? 'var(--dk-ground)' : 'var(--dk-ink-2)',
                    fontSize: 12.5,
                    fontWeight: on ? 600 : 500,
                  }}
                >
                  <span>{c.label}</span>
                  <span style={{ fontSize: 11.5, opacity: 0.75 }}>{c.why}</span>
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            It always expires. There is no open-ended pause on either side of this wire — the
            daemon clamps at 24 hours — because the one thing nobody ever does is come back and
            resume, and a watchdog silently off for a month is worse than one nobody paused.
          </span>
          {controlError ? (
            <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)', whiteSpace: 'pre-wrap' }}>
              {`Nothing was paused.\n${controlError}`}
            </span>
          ) : null}
          <Input
            placeholder="Why — optional for you, mandatory for the audit row"
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
          />
        </DialogFrame>
      ) : null}
    </DeskShell>
  );
}

/**
 * The status tag and the two levers.
 *
 * ⚠️ THREE STATES, NOT TWO. Active, paused-until, and not-deployed. The Site
 * board had two, because `paused` never left the wire — so a paused Warden and
 * a healthy one rendered the same green "Warden active" tag, which is the same
 * failure `present` exists to prevent, one state further in.
 *
 * ⚠️ GATED, NOT PLAIN-DISABLED, per the kit's rule: a control with a reason
 * states the reason on its face and keeps its padlock. A grey "Pause" that
 * does nothing sends the operator looking for the bug in themselves.
 */
function AgentControls({
  chat,
  compact,
  busy,
  sweepBusy,
  onSweep,
  onPause,
  onResume,
}: {
  chat: WardenChat | null;
  compact: boolean;
  busy: boolean;
  sweepBusy: boolean;
  onSweep: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const present = chat?.present === true;
  const paused = chat?.paused ?? null;

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {chat === null ? (
        <Tag kind="neutral" icon={null}>
          reading…
        </Tag>
      ) : !present ? (
        <Tag kind="warn">{wardenAbsenceWord(present, chat.absence)}</Tag>
      ) : paused ? (
        <Tag kind="warn" icon={IconPause}>
          {`Paused until ${clock(paused.until)} · still measuring`}
        </Tag>
      ) : (
        <Tag kind="ok" icon={IconBolt}>
          {`Warden active · checked ${clock(chat.lastCheckAt)}`}
        </Tag>
      )}
      {paused?.reason ? (
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{`“${paused.reason}”`}</span>
      ) : null}

      <span style={{ flex: 1 }} />

      <Button
        variant={present ? 'secondary' : 'gated'}
        icon={present ? IconRefresh : undefined}
        loading={sweepBusy}
        disabled={!present || sweepBusy}
        onClick={onSweep}
      >
        {present
          ? compact
            ? 'Sweep'
            : 'Sweep now'
          : chat?.absence === 'not_deployed'
            ? 'No Warden to sweep'
            : 'Can’t reach Warden'}
      </Button>

      {paused ? (
        <Button
          variant="primary"
          icon={IconCheck}
          loading={busy}
          disabled={busy}
          onClick={onResume}
        >
          {compact ? 'Resume' : 'Resume now'}
        </Button>
      ) : (
        <Button
          variant={present ? 'secondary' : 'gated'}
          icon={present ? IconPause : undefined}
          disabled={!present}
          onClick={onPause}
        >
          {present
            ? compact
              ? 'Pause'
              : 'Pause…'
            : chat?.absence === 'not_deployed'
              ? compact
                ? 'No Warden'
                : 'No Warden to pause'
              : compact
                ? 'Unreachable'
                : 'Can’t reach Warden'}
        </Button>
      )}
    </span>
  );
}

/**
 * WHAT APPROVING THIS ACTUALLY AUTHORISES — two voices, and the loud one is
 * the default.
 *
 * 🚨 THE DIALOG USED TO SAY "It runs inside Warden's own safe list" ABOUT
 * EVERY PROPOSAL. A safe-list-backed one is a named operation the daemon
 * re-validates from its own store at approve time. A free-form one is a
 * string the model wrote, run as it stands — the `approved_command` path the
 * run log below renders by that name. Telling an operator the second is the
 * first is the one lie a money-grade confirm cannot afford, because it is a
 * confirm they have learned to trust.
 *
 * ⚠️ `proposalAuthority()` AND `reversibilityLine()` LIVE IN lib/desk-site.ts
 * ON PURPOSE. Vitest collects specs under lib/ and .spec.tsx under
 * components/ and NOTHING under app/, so a spec written beside this file
 * would pass the build gate by never being collected. The decision is pinned
 * where it is actually run.
 */
function AuthorityNote({ proposal }: { proposal: WardenProposal }) {
  const authority = proposalAuthority(proposal);
  const reversible = proposal.reversible === true;

  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag kind={authority.kind === 'safe_list' ? 'neutral' : 'warn'} icon={IconLock}>
          {authority.label}
        </Tag>
        <Tag kind={reversible ? 'neutral' : 'bad'}>
          {reversible ? 'reversible' : 'not reversible'}
        </Tag>
      </span>
      <span
        style={{
          fontSize: 12,
          lineHeight: 1.55,
          color: authority.kind === 'free_form' ? 'var(--dk-ink)' : 'var(--dk-ink-2)',
        }}
      >
        {authority.sentence}
      </span>
      {/* ⚠️ REVERSIBILITY IN WORDS, NOT ONLY IN A TAG. Phase 11 took the
          irreversible operation count from 2 to 5, and the sharp pair —
          cancelLongQuery against terminateIdleInTransaction — differs by one
          Postgres function name inside a 354-character statement. Nobody
          should have to find that by eye in the block above at 2am. */}
      <span
        style={{
          fontSize: 12,
          lineHeight: 1.55,
          color: reversible ? 'var(--dk-ink-3)' : 'var(--dk-bad)',
        }}
      >
        {reversibilityLine(reversible)}
      </span>
    </>
  );
}
