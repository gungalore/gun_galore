'use client';

/**
 * THE DESK — the WhatsApp reply drawer.
 *
 * A buyer wrote to the WhatsApp number about an order. This is the only place
 * in the Desk that answers one, and it answers with a template the provider
 * has already approved — never with typing.
 *
 * 🚨 THERE IS NO COMPOSER HERE AND THERE MUST NEVER BE ONE. Meta's 24-hour
 * window makes a free-form reply *permissible*; it does not make it a good
 * idea. A support answer typed into a chat box leaves no template, no
 * registry entry and no audit of what the shop promised a buyer — and the one
 * rail where that text lands is the buyer's personal phone. So the operator
 * chooses from a rendered list and presses send; the exact body that will
 * leave is on screen under the choice, which is the same "the confirm
 * restates what will happen" rule the money surfaces run on. lib/desk-whatsapp
 * carries the matching half: the POST takes a template key and no body.
 *
 * ⚠️ EVERY REFUSAL IS SPELLED OUT ON THE BUTTON. Channel off, window closed,
 * nothing registered — each one turns the primary into the gated variant,
 * which is focusable and clickable and says which switch is off, rather than
 * a dead grey rectangle the operator files a bug about. sendGate in
 * lib/desk-whatsapp is the single source of that label; nothing below
 * re-derives it.
 *
 * ⚠️ THE COUNTDOWN TICKS. A drawer left open across the last two hours of a
 * window would otherwise keep showing "2h 5m of window left" over a send that
 * the provider has already started refusing. The clock below re-renders the
 * tag and re-asks the gate every half minute.
 *
 * ⚠️ NO PHONE NUMBER, NO REAL NAME. The header shows the masked MSISDN and
 * the username, and lib/desk-whatsapp drops the raw number at the wire so
 * neither this component nor a devtools tree can print it.
 */
import * as React from 'react';
import { Drawer, Section, ResultBlock } from './overlays';
import { Button, Tag } from './primitives';
import { Kv } from './numbers';
import { RadioRow } from './forms';
import { FailedRegion, SkeletonPile } from './states';
import { IconBubble, IconCheck, IconClock, IconExternal, IconSend } from './icons';
import { describeFailure } from '@/lib/desk-auth';
import {
  defaultTemplateKey,
  describeWhen,
  fetchWhatsappThread,
  markWhatsappHandled,
  outgoingText,
  sendGate,
  sendWhatsappTemplate,
  windowState,
  type WhatsappThread,
} from '@/lib/desk-whatsapp';

/** Half a minute. Fine enough for a minute-resolution countdown, cheap enough
 *  to leave running while the drawer is open. */
const TICK_MS = 30_000;

export interface WhatsappDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The thread id off the card — `whatsapp_reply:<id>`, without the prefix. */
  threadId: string;
  /** Fired after a send or a mark-handled, so the pile behind can reload. */
  onChanged?: () => void;
  /**
   * Hand the operator to the order the buyer is asking about.
   *
   * Optional, and the drawer is honest without it: with no handler the
   * context section still names the order and the courier, it just does not
   * offer a door the board cannot open yet.
   */
  onOpenOrder?: (transactionId: string) => void;
}

export function WhatsappDrawer({
  open,
  onClose,
  threadId,
  onChanged,
  onOpenOrder,
}: WhatsappDrawerProps) {
  const [thread, setThread] = React.useState<WhatsappThread | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  /**
   * ⚠️ ONE SEND PER OPEN, ENFORCED ON THE CLIENT TOO. The server ought to
   * resolve the thread once a template goes out, but a message on somebody's
   * phone is not undoable and this drawer must not be able to send the same
   * template twice while a reload is still in flight. Set on success, cleared
   * only by opening the drawer again.
   */
  const [sentKey, setSentKey] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  /**
   * ⚠️ THE LAST REQUEST WINS, NOT THE LAST REPLY. Closing thread A and
   * opening thread B lets A's slower response paint itself into a drawer the
   * board believes is B — and the send button then answers the wrong buyer.
   * Bumped on every open, every reload and every close.
   */
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++generation.current;
    setLoadError(null);
    try {
      const next = await fetchWhatsappThread(threadId);
      if (mine !== generation.current) return;
      setThread(next);
      // Open on the first template the server could fill: the list is the
      // decision, and making the operator click twice to reach the obvious
      // answer is how the obvious answer stops being read.
      setSelected((current) => current ?? defaultTemplateKey(next));
    } catch (err) {
      if (mine !== generation.current) return;
      setThread(null);
      setLoadError(describeFailure(err));
    }
  }, [threadId]);

  React.useEffect(() => {
    if (!open) {
      generation.current += 1;
      return;
    }
    // A fresh thread is a fresh choice. Carrying a selection across threads is
    // how the wrong buyer gets the wrong template.
    setThread(null);
    setSelected(null);
    setFailure(null);
    setSentKey(null);
    setNow(Date.now());
    void load();
    return () => {
      generation.current += 1;
    };
  }, [open, load]);

  React.useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [open]);

  const win = windowState(thread, now);
  const gate = sendGate(thread, selected, now);
  const preview = outgoingText(thread, selected);
  const handled = !!thread?.handledAt;
  const alreadySent = sentKey !== null;

  /**
   * ⚠️ `loading` DIMS A DESK BUTTON, IT DOES NOT DISABLE IT. Two clicks on
   * the primary would be two messages on a buyer's phone, and `busy` state is
   * not applied until the next render — so the guard has to be a ref read
   * synchronously on entry.
   */
  const inFlight = React.useRef(false);

  async function run(action: () => Promise<void>, after?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await action();
      after?.();
      await load();
      onChanged?.();
    } catch (err) {
      // Verbatim, in the drawer, above the footer — a WhatsApp send that
      // failed at the provider fails with a numbered reason, and rewriting it
      // as "Something went wrong" costs the next hour.
      setFailure(describeFailure(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const orderId = thread?.order?.transactionId ?? null;
  const openOrder = onOpenOrder && orderId ? () => onOpenOrder(orderId) : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      typeLabel="WhatsApp reply"
      reference={thread?.reference ?? undefined}
      icon={IconBubble}
      title="Reply inside the window"
      meta={
        thread ? (
          <>
            {thread.phoneMasked}
            {/* Username only, and no @ — the handle is the identity the Desk
                uses everywhere, and a real name never appears on this screen. */}
            {thread.username ? ` · ${thread.username}` : ''}
            {thread.order?.title ? ` · about ${thread.order.title}` : ''}
          </>
        ) : null
      }
      tags={
        thread ? (
          <>
            {/* The clock stays on the tag even when it turns bad: under two
                hours this is still a deadline, not a fault, and the triangle
                Tag would otherwise supply reads as "something broke". */}
            <Tag kind={win.tone === 'bad' ? 'bad' : 'warn'} icon={IconClock}>
              {win.label}
            </Tag>
            {thread.order?.courier ? <Tag kind="info">{thread.order.courier}</Tag> : null}
            {handled ? <Tag kind="ok">Handled</Tag> : null}
          </>
        ) : null
      }
      note={
        thread ? (
          <>
            Sends one registered template, only inside the 24-hour window. Outside it the button
            reads “Window closed” and the card resolves as unanswered. There is no free-text
            WhatsApp send anywhere in the Desk, and while the whatsapp_enabled kill switch is off
            nothing may leave at all.
          </>
        ) : null
      }
      footer={
        thread ? (
          <>
            <Button
              variant="secondary"
              icon={IconCheck}
              disabled={handled || busy}
              onClick={() => void run(() => markWhatsappHandled(thread.id))}
            >
              {handled ? 'Handled' : 'Mark handled'}
            </Button>
            <span style={{ flex: 1 }} />
            {alreadySent ? (
              // Sent is a terminal state for this drawer session: the message
              // is on somebody's phone and there is nothing to press again.
              <Button variant="gated">Reply sent</Button>
            ) : gate.can ? (
              <Button
                variant="primary"
                icon={IconSend}
                loading={busy}
                onClick={() =>
                  void run(
                    () => sendWhatsappTemplate(thread.id, selected as string),
                    () => setSentKey(selected),
                  )
                }
              >
                {gate.label}
              </Button>
            ) : gate.block === 'nothing_selected' || gate.block === 'not_ready' ? (
              <Button variant="primary" icon={IconSend} disabled>
                {gate.label}
              </Button>
            ) : (
              // Gated, not disabled: the operator is allowed to reach it and
              // read why nothing will happen. The reason is under the list.
              <Button variant="gated">{gate.label}</Button>
            )}
          </>
        ) : null
      }
    >
      {loadError ? (
        <div style={{ padding: '16px 20px' }}>
          <FailedRegion
            title="Couldn't open this WhatsApp thread"
            detail={loadError}
            onRetry={() => void load()}
            scopeNote="the rest of the Desk is unaffected"
          />
        </div>
      ) : !thread ? (
        <div style={{ padding: '16px 20px' }}>
          <SkeletonPile count={2} />
        </div>
      ) : (
        <>
          <Section label={`Inbound · ${describeWhen(thread.inboundAt, now)}`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '90%',
                  padding: '9px 12px',
                  background: 'var(--dk-surface)',
                  border: '1px solid var(--dk-line)',
                  borderRadius: 'var(--dk-radius-card)',
                  borderTopLeftRadius: 4,
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: 'var(--dk-ink)',
                  // The buyer's own words, wrapped rather than clipped.
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {thread.inboundText || '—'}
              </div>
              <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
                Opened a 24-hour window {describeWhen(thread.windowOpenedAt, now)} · closes{' '}
                {describeWhen(thread.windowClosesAt, now)}
              </span>
            </div>
          </Section>

          <Section
            label="Context"
            action={
              openOrder ? (
                <Button variant="ghost" trailingIcon={IconExternal} onClick={openOrder}>
                  Open order
                </Button>
              ) : null
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Kv
                k="Order"
                v={
                  thread.order?.reference || thread.order?.title
                    ? [thread.order?.reference, thread.order?.title].filter(Boolean).join(' · ')
                    : 'not linked to an order'
                }
              />
              {/* Courier and due date are prose the server assembled, not
                  identifiers — mono would line them up as data they are not. */}
              <Kv k="Courier" v={thread.order?.courier ?? '—'} mono={false} />
              <Kv k="Due" v={thread.order?.due ?? '—'} mono={false} last />
            </div>
          </Section>

          <Section label="Reply with a registered template" last>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {thread.templates.length === 0 ? (
                <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
                  No approved template came back from the registry. Nothing can be sent from this
                  card until one is registered and configured on the server.
                </span>
              ) : (
                thread.templates.map((t) => (
                  <RadioRow
                    key={t.key}
                    name={`wa-template-${thread.id}`}
                    checked={selected === t.key}
                    /**
                     * ⚠️ A BLOCKED TEMPLATE IS STILL SELECTABLE, DELIBERATELY.
                     * The row that silently ignores a click is the row the
                     * operator clicks four times and then reports as broken;
                     * choosing it instead moves the reason onto the button
                     * ("That template cannot be sent: needs a date."), which is
                     * an answer. Nothing can leave either way — sendGate refuses
                     * a template the server did not mark ready.
                     */
                    onChange={() => setSelected(t.key)}
                    label={t.label}
                    // The preview is the exact body that would leave. When the
                    // server could not render one, its reason takes the slot,
                    // so the row never shows sample text that is not the truth.
                    sub={t.preview ?? t.blockedReason ?? 'cannot be filled in yet'}
                  />
                ))
              )}
              <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
                No free text. The registry is the only way a message leaves, and only inside the
                window.
              </span>
              {gate.why ? (
                <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-warn)' }}>
                  {gate.why}
                </span>
              ) : preview ? (
                <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
                  Send will deliver exactly the text above, from the registry, once.
                </span>
              ) : null}
              {failure ? (
                <div style={{ marginTop: 4 }}>
                  <ResultBlock ok={false} tag="Send failed" body={failure} />
                </div>
              ) : null}
            </div>
          </Section>
        </>
      )}
    </Drawer>
  );
}
