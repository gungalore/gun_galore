'use client';

/**
 * AGENT — the conversation, and only the conversation.
 *
 * ⚠️ THE THREAD IS NO LONGER THE PRIMARY CONTENT OF THIS SURFACE, AND THAT IS
 * THE WHOLE POINT OF THE SPLIT. On the Site board a pending proposal was a
 * message in a scrollback: the one thing on the page that was WORK was buried
 * in the one thing that was READING, and an operator who scrolled past it had
 * no other route back to it. The queue above this card is now the primary
 * content; this is the record of how it got there and the way to answer.
 *
 * ⚠️ WARDEN IS A DAEMON ON THE BOX, NOT CODE IN THIS APP OR IN THE API. The
 * card asks GET /admin/warden/chat, an authenticated door that fails closed on
 * WARDEN_BASE_URL / WARDEN_TOKEN. So it renders `present: false` with the
 * reason on its face and a disabled composer, rather than an empty thread
 * under a green badge — a quiet Warden and an absent Warden look identical and
 * mean opposite things.
 */
import * as React from 'react';
import {
  Button,
  ChatComposer,
  IconAlert,
  IconBolt,
  IconCheck,
  IconPause,
  Label,
  OperatorMessage,
  Tag,
  WardenMessage,
} from '../../../../components/desk';
import { clock, type WardenChat, type WardenProposal } from '../../../../lib/desk-site';
import { Quiet } from '../health/board-bits';

export function WardenChatCard({
  chat,
  failure,
  phone,
  draft,
  onDraft,
  onSend,
  sending,
  onApprove,
  onDecline,
}: {
  chat: WardenChat | null;
  failure: string | null;
  phone: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  onApprove: (p: WardenProposal) => void;
  onDecline: (p: WardenProposal) => void;
}) {
  const present = chat?.present === true;

  const header = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <Label>Conversation</Label>
      {chat === null ? null : present ? (
        chat.paused ? (
          <Tag kind="warn" icon={IconPause}>{`paused until ${clock(chat.paused.until)}`}</Tag>
        ) : (
          <Tag kind="ok" icon={IconCheck}>{`active · checked ${clock(chat.lastCheckAt)}`}</Tag>
        )
      ) : (
        <Tag kind="warn" icon={IconAlert}>
          not deployed
        </Tag>
      )}
      <span style={{ flex: 1 }} />
      {phone ? null : (
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
          Findings, fixes and what already ran. Reply in plain language.
        </span>
      )}
    </span>
  );

  const thread = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: phone ? 14 : 18, minWidth: 0 }}>
      {chat === null ? (
        <Quiet>Reading the thread…</Quiet>
      ) : (
        <Thread chat={chat} onApprove={onApprove} onDecline={onDecline} />
      )}
      {/* ⚠️ THE ABSENT STATE IS THE THREAD, NOT A BADGE ON AN EMPTY ONE. With
          no daemon there are no messages, and an empty scroll under a header
          reads as a calm morning. The note says what is actually true. */}
      {chat && !present ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '14px 16px',
            background: 'var(--dk-inset)',
            border: '1px solid var(--dk-line-2)',
            borderRadius: 'var(--dk-radius-card)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconBolt size={15} style={{ color: 'var(--dk-ink-3)' }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Nothing is watching the box</span>
          </span>
          <span style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>
            {chat.note ?? 'Warden is not deployed. Nothing is watching the box automatically yet.'}
          </span>
          {/* ⚠️ THIS SENTENCE USED TO SAY "the gates, channels and vitals
              BESIDE THIS CARD". They are not beside it any more — they moved
              to Health with the rest of the board, and a note pointing at
              cards that are not on the screen is a note the reader decides is
              stale and stops reading. */}
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-warn)' }}>
            The gates, channels and outbound state on Health are read live on every load — current,
            but only while somebody is looking. Disk, memory, SSL and error rates need this daemon
            and show an em dash until it exists.
          </span>
          {failure ? (
            <span
              className="dk-mono"
              style={{
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--dk-ink-3)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {failure}
            </span>
          ) : null}
        </div>
      ) : failure ? (
        <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)', whiteSpace: 'pre-wrap' }}>
          {failure}
        </span>
      ) : null}
    </div>
  );

  const composer = (
    <ChatComposer
      value={draft}
      onChange={onDraft}
      onSend={onSend}
      disabled={!present}
      busy={sending}
      placeholder={
        present ? 'Tell Warden… (react, refuse, ask, instruct)' : 'No Warden to tell — see above'
      }
      hint={
        phone
          ? null
          : present
            ? undefined
            : 'Set WARDEN_BASE_URL and WARDEN_TOKEN on the box. Until then every send is refused rather than queued — an instruction nothing will read is worse than none.'
      }
    />
  );

  if (phone) {
    /**
     * ⚠️ THE PHONE COMPOSER IS IN FLOW HERE, AND IT WAS `position: fixed` ON
     * THE SITE BOARD. That was right there and is wrong here: on Site the chat
     * was one of two full-screen lenses, so a pinned composer covered nothing.
     * On Agent the chat is the third section of a scrolling board, and a bar
     * pinned above the tab strip would sit permanently over the approval queue
     * and the run log — the two things this surface exists for.
     *
     * ⚠️ THE SAFE-AREA CLAMP WENT WITH IT, and that is a deletion rather than
     * a regression: nothing here is positioned off the bottom edge any more,
     * so there is no inset to over-report. components/desk/safe-area-clamp.spec.tsx
     * walks all of app/admin and asserts a FLOOR of eight clamped uses so an
     * empty sweep cannot pass as a clean one; ten survive this change, counted
     * with the spec's own stripper. If a fixed element ever comes back to this
     * file it must be written as min(env(safe-area-inset-bottom, 0px), 34px),
     * which that spec enforces.
     */
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {header}
        {thread}
        {composer}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        background: 'var(--dk-raised)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
        overflow: 'hidden',
        // The composer is pinned to the bottom of the CARD — not the viewport —
        // so the thread scrolls inside it and the composer is never hunted for
        // mid-incident. 560 rather than the old `calc(100vh - 190px)`: this
        // card no longer owns the whole column, so a viewport-height card would
        // push the run log below the fold on every desk.
        maxHeight: 560,
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--dk-line)' }}>{header}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 16px' }}>{thread}</div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--dk-line)' }}>{composer}</div>
    </div>
  );
}

/**
 * The thread itself.
 *
 * ⚠️ A PENDING PROPOSAL NO MESSAGE MENTIONS IS STILL RENDERED HERE, EVEN
 * THOUGH THE QUEUE ABOVE ALSO CARRIES IT. The daemon may raise a proposal
 * without a covering message, and the two renders answer different questions:
 * the queue asks "what is waiting on me", the thread asks "what happened, in
 * order". Dropping the orphan from the thread would leave a gap in the second.
 *
 * ⚠️ AND THE ACTIONS ARE STILL HERE, not only in the queue. An operator
 * reading the diagnosis in context should not have to scroll back up to act on
 * what they have just finished reading — both routes post the same
 * compare-and-swap against the same proposal id.
 */
export function Thread({
  chat,
  onApprove,
  onDecline,
}: {
  chat: WardenChat;
  onApprove: (p: WardenProposal) => void;
  onDecline: (p: WardenProposal) => void;
}) {
  const byId = new Map(chat.proposals.map((p) => [p.id, p]));
  const covered = new Set<string>();

  const actionsFor = (p: WardenProposal | undefined) => {
    if (!p || p.kind !== 'proposal' || p.status !== 'pending' || !p.command) return undefined;
    return (
      <>
        <Button variant="primary" icon={IconCheck} onClick={() => onApprove(p)}>
          Approve the fix…
        </Button>
        <Button variant="secondary" onClick={() => onDecline(p)}>
          Decline
        </Button>
        <span style={{ alignSelf: 'center', fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
          Approve restates exactly what will run
        </span>
      </>
    );
  };

  const messages = chat.messages.map((m) => {
    if (m.role === 'operator') {
      return (
        <OperatorMessage key={m.id} time={clock(m.at)}>
          {m.body.join(' ')}
        </OperatorMessage>
      );
    }
    const p = m.proposalId ? byId.get(m.proposalId) : undefined;
    if (p) covered.add(p.id);
    return (
      <WardenMessage
        key={m.id}
        kind={m.kind}
        time={clock(m.at)}
        diff={m.pre?.tone === 'inset' ? m.pre.lines.join('\n') : undefined}
        output={m.pre?.tone === 'ground' ? m.pre.lines.join('\n') : undefined}
        footnote={m.footnote}
        actions={actionsFor(p)}
      >
        {m.body.map((para, i) => (
          <span key={i} style={{ display: 'block', marginTop: i === 0 ? 0 : 8 }}>
            {para}
          </span>
        ))}
      </WardenMessage>
    );
  });

  const orphans = chat.proposals
    .filter((p) => !covered.has(p.id) && p.status === 'pending')
    .map((p) => (
      <WardenMessage
        key={p.id}
        kind={p.kind === 'red_gate' ? 'red-gate' : 'proposal'}
        time={clock(p.raisedAt)}
        diff={p.command ?? undefined}
        actions={actionsFor(p)}
        footnote={p.kind === 'red_gate' ? 'clears when the gate changes in code' : undefined}
      >
        <span style={{ display: 'block' }}>{p.headline}</span>
        {p.diagnosis ? <span style={{ display: 'block', marginTop: 8 }}>{p.diagnosis}</span> : null}
      </WardenMessage>
    ));

  return (
    <>
      {messages}
      {orphans}
    </>
  );
}
