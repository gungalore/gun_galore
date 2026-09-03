'use client';

/**
 * THE DESK — the Case drawer.
 *
 * The replacement for both /admin/complaints and /admin/support. They are one
 * job wearing two schemas: a subject, a state, a member who raised it, a
 * thread to read, and a decision that either answers them or closes the case.
 *
 * ⚠️ TWO RULES SHAPE EVERY CHOICE BELOW.
 *
 * 1. WHAT THE OPERATOR TYPES HERE LEAVES THE BUILDING. A support reply is
 *    delivered to the member word for word; a complaint outcome is pasted
 *    whole into the resolution email. So there is no "just save it" control:
 *    every send passes through a confirm that shows the exact text, names the
 *    member, and lists the rails it goes out on. Where the backend does NOT
 *    deliver what was typed — the awaiting-user template ignores the outcome
 *    note — the confirm says that too, because an operator who thinks they
 *    have answered someone will not answer them again.
 *
 * 2. A COMPLAINT CAN BE HOLDING SOMEBODY'S MONEY. A payout-affecting
 *    complaint CAS-flips its order to DISPUTED, and the seller is not paid
 *    while the case sits here. That fact is the first section in the drawer,
 *    a tag in the header, and a line in the confirm — and the confirm also
 *    says the thing the legacy page only implied by redirecting: resolving
 *    the CASE does not release the MONEY.
 *
 * ⚠️ NO EMAIL ADDRESS ON THIS SCREEN. Both endpoints return one and the old
 * pages printed it in the list header. Nothing here needs it: replies go out
 * through the backend's own rails. lib/desk-case.ts drops it at the boundary.
 *
 * There is no MoneyDialog here on purpose — neither endpoint moves a cent.
 * The money on a complaint is frozen, and unfreezing it happens elsewhere.
 */
import * as React from 'react';
import { Drawer, Section, DialogFrame, ResultBlock } from './overlays';
import { Button, Tag } from './primitives';
import { Kv, Label } from './numbers';
import { RadioRow } from './forms';
import { FailedRegion, SkeletonPile } from './states';
import {
  IconAlert,
  IconCheck,
  IconExternal,
  IconHelp,
  IconScale,
  IconSend,
} from './icons';
import { describeFailure } from '@/lib/desk-auth';
import {
  COMPLAINT_DECISIONS,
  OUTCOME_MAX,
  REPLY_MAX,
  caseAge,
  decideComplaint,
  describeComplaintDecision,
  describeSupportReply,
  describeSupportResolve,
  fetchCase,
  formatWhen,
  prettyCategory,
  replyToTicket,
  resolveTicket,
  stateLabel,
  stateTone,
  type CaseDossier,
  type CaseKind,
  type CaseMessage,
  type ComplaintDecisionState,
  type Delivery,
} from '@/lib/desk-case';

export interface CaseDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Which register this case lives in. Decides the endpoints and the actions. */
  caseKind: CaseKind;
  /** Complaint cuid or SupportTicket cuid. A CO number works for complaints. */
  caseId: string;
  /** Fired after anything lands, so the board behind can reload its list. */
  onChanged?: () => void;
  /**
   * Hand the operator to the order that is holding the money.
   *
   * Optional, and the drawer is honest without it: when no board can open an
   * order yet, the frozen-payout section states the fact and names the order
   * rather than offering a link into a panel the Desk is replacing.
   */
  onOpenOrder?: (transactionId: string) => void;
}

type Pending =
  | { sort: 'reply' }
  | { sort: 'resolve' }
  | { sort: 'decide'; state: ComplaintDecisionState };

export function CaseDrawer({
  open,
  onClose,
  caseKind,
  caseId,
  onChanged,
  onOpenOrder,
}: CaseDrawerProps) {
  const [dossier, setDossier] = React.useState<CaseDossier | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [decision, setDecision] = React.useState<ComplaintDecisionState | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  /**
   * ⚠️ THE LAST REQUEST WINS, NOT THE LAST REPLY. A complaint read is the
   * WHOLE register (see fetchCase), so it can easily outlast a support read
   * fired after it. Without this counter, closing case A and opening case B
   * lets A's slow response land second and paint itself into a drawer the
   * board believes is B — and every button then acts on A. The generation is
   * bumped by the open/id effect and by every reload, and a stale answer is
   * dropped rather than rendered.
   */
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++generation.current;
    setLoadError(null);
    try {
      const next = await fetchCase(caseKind, caseId);
      if (mine !== generation.current) return;
      setDossier(next);
    } catch (err) {
      if (mine !== generation.current) return;
      setDossier(null);
      setLoadError(describeFailure(err));
    }
  }, [caseKind, caseId]);

  React.useEffect(() => {
    if (!open) {
      // Anything in flight belongs to a case nobody is looking at any more.
      generation.current += 1;
      return;
    }
    // A fresh case is a fresh draft. Carrying a half-typed reply from the last
    // case into this one is how the wrong member gets told the wrong thing.
    setDossier(null);
    setDraft('');
    setDecision(null);
    setPending(null);
    setFailure(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [open, load]);

  /**
   * ⚠️ ESCAPE REACHES BOTH LISTENERS. The Drawer and the DialogFrame each
   * bind a capture-phase keydown on `document`, and `stopPropagation` does
   * not silence a second listener on the same node — so an Escape with the
   * confirm up would close the confirm AND the drawer, dumping the operator
   * back on the pile mid-decision. The drawer's close is therefore guarded:
   * while a confirm is open it swallows the key and only the confirm goes.
   */
  const pendingRef = React.useRef<Pending | null>(null);
  // Written in an effect rather than during render: a render React discards
  // must not leave this ref describing a confirm that was never committed,
  // which is the one thing that would make Escape close the case after all.
  React.useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const closeDrawer = React.useCallback(() => {
    if (pendingRef.current) {
      setPending(null);
      return;
    }
    onClose();
  }, [onClose]);

  const kindLabel = caseKind === 'complaint' ? 'Complaint' : 'Support';
  const KindIcon = caseKind === 'complaint' ? IconScale : IconHelp;
  const frozen = dossier?.hold?.stillFrozen ?? false;
  const liftedHold = (dossier?.hold?.drovePayoutHold ?? false) && !frozen;

  const chosen = decision ? COMPLAINT_DECISIONS.find((o) => o.value === decision) : undefined;
  const outcomeMissing = !!chosen?.needsOutcome && !draft.trim();
  /**
   * ⚠️ THE CAP IS ENFORCED, NOT DECORATED. OUTCOME_MAX exists because the
   * outcome is pasted whole into the member's email, and a counter that turns
   * red over a button that still sends is a cap in name only. Measured on the
   * raw text, exactly like the counter, so the two never disagree in front of
   * an operator wondering why the button is dead.
   */
  const tooLong = draft.length > (caseKind === 'support' ? REPLY_MAX : OUTCOME_MAX);
  const canDecide = !!decision && !outcomeMissing && !tooLong;
  const canReply = draft.trim().length > 0 && !tooLong;
  // Re-resolving sends a second "your ticket was resolved" push for a ticket
  // that already is. SupportService.resolve does not refuse it — so we do.
  const alreadySettled = dossier?.state === 'RESOLVED' || dossier?.state === 'CLOSED';

  /**
   * ⚠️ ONE SEND PER PRESS. `loading` on a Desk Button dims it but does NOT
   * disable it, so a double-click on the confirm would post a second reply —
   * the member reads the same message twice, or a complaint is patched twice.
   * `busy` state alone cannot stop that (it is not applied until the next
   * render), so the guard is a ref checked synchronously on entry.
   */
  const inFlight = React.useRef(false);

  async function run(action: () => Promise<unknown>, clearDraft: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await action();
      setPending(null);
      if (clearDraft) setDraft('');
      setDecision(null);
      await load();
      onChanged?.();
    } catch (err) {
      // The confirm stays up and the server's own words go INSIDE it — the
      // dialog sits above the drawer, so a failure rendered only in the
      // section behind it is a failure the operator never sees.
      setFailure(describeFailure(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const delivery: Delivery | null =
    !dossier || !pending
      ? null
      : pending.sort === 'reply'
        ? describeSupportReply(dossier, draft)
        : pending.sort === 'resolve'
          ? describeSupportResolve(dossier, draft)
          : describeComplaintDecision(dossier, pending.state, draft);

  return (
    <Drawer
      open={open}
      onClose={closeDrawer}
      typeLabel={kindLabel}
      reference={dossier?.reference}
      icon={KindIcon}
      title={dossier?.subject ?? 'Loading the case…'}
      meta={
        dossier ? (
          <>
            Raised by {dossier.raisedBy ?? 'a member'} · {prettyCategory(dossier.category)} ·{' '}
            opened {formatWhen(dossier.openedAt)} ({caseAge(dossier.openedAt)} ago)
          </>
        ) : null
      }
      tags={
        dossier ? (
          <>
            <Tag kind={stateTone(dossier.state)}>{stateLabel(dossier.state)}</Tag>
            {frozen ? <Tag kind="bad">Payout frozen</Tag> : null}
            {dossier.role ? <Tag kind="neutral">{prettyCategory(dossier.role)}</Tag> : null}
          </>
        ) : null
      }
      note={
        dossier ? (
          <CaseNote
            dossier={dossier}
            outcomeMissing={outcomeMissing}
            overBy={tooLong ? draft.length - (caseKind === 'support' ? REPLY_MAX : OUTCOME_MAX) : 0}
          />
        ) : null
      }
      footer={
        dossier ? (
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              Close
            </Button>
            <span style={{ flex: 1 }} />
            {caseKind === 'support' ? (
              <>
                <Button
                  variant="outline"
                  icon={IconCheck}
                  disabled={alreadySettled}
                  onClick={() => setPending({ sort: 'resolve' })}
                >
                  {alreadySettled ? `Already ${stateLabel(dossier.state).toLowerCase()}` : 'Resolve…'}
                </Button>
                <Button
                  variant="primary"
                  icon={IconSend}
                  disabled={!canReply}
                  onClick={() => setPending({ sort: 'reply' })}
                >
                  Send reply…
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                icon={IconSend}
                disabled={!canDecide}
                onClick={() => decision && setPending({ sort: 'decide', state: decision })}
              >
                {chosen ? `${chosen.label}…` : 'Pick what happens next'}
              </Button>
            )}
          </>
        ) : null
      }
    >
      {loadError ? (
        <div style={{ padding: '16px 20px' }}>
          <FailedRegion
            title={`Couldn't open this ${kindLabel.toLowerCase()} case`}
            detail={loadError}
            onRetry={() => void load()}
            scopeNote="the rest of the Desk is unaffected"
          />
        </div>
      ) : !dossier ? (
        <div style={{ padding: '16px 20px' }}>
          <SkeletonPile count={2} />
        </div>
      ) : (
        <>
          {/* Money first. An operator who scrolls past a frozen payout to get
              to the reply box has been failed by the layout, not by their
              attention. */}
          {frozen ? (
            <Section label="Money on hold">
              <Alarm>
                Lodging this complaint froze the payout on the linked order. A seller is not being
                paid while this case is open.
              </Alarm>
              <div style={{ marginTop: 10 }}>
                <Kv k="Order" v={orderName(dossier)} mono={false} />
                <Kv k="Payment" v={dossier.hold?.paymentStatus ?? '—'} tone="bad" />
                <Kv k="Released by" v="A decision on the order, not this case" mono={false} last />
              </div>
              {onOpenOrder && dossier.order ? (
                <div style={{ marginTop: 12 }}>
                  <Button
                    variant="outline"
                    trailingIcon={IconExternal}
                    onClick={() => onOpenOrder(dossier.order!.id)}
                  >
                    Open the held order
                  </Button>
                </div>
              ) : null}
            </Section>
          ) : null}

          {liftedHold ? (
            <Section label="Money on hold">
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>
                This complaint froze the payout when it was lodged, and that hold is gone — the
                order is now {dossier.hold?.paymentStatus ?? 'in another state'}. Nothing is
                waiting on this case financially.
              </div>
            </Section>
          ) : null}

          <Section label="Case">
            <Kv k="Reference" v={dossier.reference} />
            <Kv
              k="State"
              v={<Tag kind={stateTone(dossier.state)}>{stateLabel(dossier.state)}</Tag>}
              mono={false}
            />
            <Kv k="Category" v={prettyCategory(dossier.category)} mono={false} />
            <Kv k="Opened" v={formatWhen(dossier.openedAt)} />
            {dossier.updatedAt ? <Kv k="Last activity" v={formatWhen(dossier.updatedAt)} /> : null}
            {dossier.resolvedAt ? <Kv k="Closed" v={formatWhen(dossier.resolvedAt)} /> : null}
            {caseKind === 'complaint' ? (
              <Kv
                k="Owner"
                v={dossier.assignedAdminId ? 'Assigned' : 'Nobody yet'}
                mono={false}
                last
              />
            ) : null}
          </Section>

          <Section label="Who raised it">
            {/* ⚠️ Username only, here and everywhere. The decision on this
                screen — reply, await, resolve — never needs a real name or an
                address, and the reply rails address the member themselves. */}
            <Kv k="Member" v={dossier.raisedBy ?? 'Unknown'} />
            {dossier.role ? <Kv k="Side" v={prettyCategory(dossier.role)} mono={false} /> : null}
            <Kv k="Against" v={orderName(dossier)} mono={false} last />
            <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
              Contact details are deliberately off this screen. Everything you send from here is
              addressed by the system.
            </div>
          </Section>

          <Section label={`Thread · ${dossier.messages.length}`}>
            {dossier.messages.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
                Nothing has been written on this case yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {dossier.messages.map((m) => (
                  <Message key={m.id} message={m} who={dossier.raisedBy ?? 'Member'} />
                ))}
              </div>
            )}
          </Section>

          {dossier.photos.length > 0 ? (
            <Section label={`Evidence · ${dossier.photos.length}`}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {dossier.photos.map((p) => (
                  <a
                    key={p.id}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ lineHeight: 0, borderRadius: 8 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt="Evidence the member attached"
                      style={{
                        width: 76,
                        height: 76,
                        objectFit: 'cover',
                        display: 'block',
                        borderRadius: 8,
                        border: '1px solid var(--dk-line-2)',
                      }}
                    />
                  </a>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
                Evidence is private to the member and this desk. It is not moderated, so it can
                contain their own contact details — do not paste it anywhere.
              </div>
            </Section>
          ) : null}

          <Section label={caseKind === 'support' ? 'Reply' : 'Decision'} last>
            {/* Shown here once the confirm is dismissed; while it is up the
                dialog carries the same text, and two copies of a refusal on
                one screen reads as two failures. */}
            {failure && !pending ? (
              <div style={{ marginBottom: 12 }}>
                <ResultBlock ok={false} tag="Not saved" body={failure} />
              </div>
            ) : null}

            {caseKind === 'complaint' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {COMPLAINT_DECISIONS.map((o) => (
                  <RadioRow
                    key={o.value}
                    name="dk-case-decision"
                    checked={decision === o.value}
                    onChange={() => setDecision(o.value)}
                    label={o.label}
                    sub={o.consequence}
                  />
                ))}
              </div>
            ) : null}

            <Composer
              value={draft}
              onChange={setDraft}
              max={caseKind === 'support' ? REPLY_MAX : OUTCOME_MAX}
              label={
                caseKind === 'support'
                  ? 'Your reply to the member'
                  : 'The outcome recorded on this case'
              }
              placeholder={
                caseKind === 'support'
                  ? 'Write to the member. They read this exactly as you type it.'
                  : 'What was decided, and why. This is what the member is emailed.'
              }
            />
            <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
              {caseKind === 'support'
                ? 'The member reads this word for word in their ticket. No internal shorthand.'
                : 'On a resolve or a close, this is pasted into the email the member receives. No internal shorthand.'}
            </div>
          </Section>
        </>
      )}

      {/* The confirms live inside the drawer's DOM so its focus trap can reach
          their buttons; closeDrawer above is what keeps Escape from taking the
          case down with the dialog. */}
      {dossier && pending && delivery ? (
        <ConfirmSend
          delivery={delivery}
          label={pending.sort === 'decide' ? 'Decision · confirm' : 'Message · confirm'}
          title={confirmTitle(dossier, pending)}
          confirmLabel={confirmVerb(pending)}
          assertive={frozen}
          busy={busy}
          failure={failure}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (pending.sort === 'reply') {
              void run(() => replyToTicket(dossier.id, draft), true);
            } else if (pending.sort === 'resolve') {
              void run(() => resolveTicket(dossier.id), false);
            } else {
              void run(() => decideComplaint(dossier.id, pending.state, draft), true);
            }
          }}
        />
      ) : null}
    </Drawer>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Pieces
 * ──────────────────────────────────────────────────────────────────────── */

/** The rule the operator has to know before pressing, per kind and state. */
function CaseNote({
  dossier,
  outcomeMissing,
  overBy,
}: {
  dossier: CaseDossier;
  outcomeMissing: boolean;
  /** Characters past the cap, or 0. A dead button has to say why it is dead. */
  overBy: number;
}) {
  if (overBy > 0) {
    return (
      <>
        That is {overBy.toLocaleString('en-ZA')} character{overBy === 1 ? '' : 's'} too long to
        send. Trim it and the button comes back.
      </>
    );
  }
  if (outcomeMissing) {
    return <>That decision emails the member your words, so it needs an outcome written first.</>;
  }
  if (dossier.hold?.stillFrozen) {
    return (
      <>
        Closing this case records the verdict and tells the member. It does not release or refund
        the order — the payment stays DISPUTED until that is decided on the order itself.
      </>
    );
  }
  if (dossier.kind === 'support') {
    return dossier.state === 'RESOLVED' || dossier.state === 'CLOSED' ? (
      <>This ticket is closed. Sending a reply reopens the conversation for the member.</>
    ) : (
      <>A reply moves the ticket to Awaiting member. There is no separate state control here.</>
    );
  }
  return <>Whatever you choose, the case is assigned to you when it saves.</>;
}

function Alarm({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 9,
        padding: 12,
        background: 'var(--dk-bad-wash)',
        border: '1px solid var(--dk-bad-line)',
        borderRadius: 10,
      }}
    >
      <IconAlert size={14} style={{ color: 'var(--dk-bad)', flex: 'none', marginTop: 2 }} />
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--dk-ink)' }}>{children}</span>
    </div>
  );
}

/**
 * One turn of the conversation.
 *
 * ⚠️ THE TWO SIDES ARE TOLD APART WITHOUT COLOUR — a ground step, an indent
 * and a named author. Colour on this surface means state, and "who typed it"
 * is not a state; spending ok/info on speaker identity is exactly what makes
 * the frozen-payout red stop registering.
 */
function Message({ message, who }: { message: CaseMessage; who: string }) {
  const ours = message.from === 'operator';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: ours ? 20 : 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Label>{ours ? 'All Outdoor' : who}</Label>
        <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
          {formatWhen(message.at)}
        </span>
        {/* A note the member never saw. Saying so is the difference between
            "we answered them" and "we wrote it down". */}
        {ours && !message.reachedMember ? <Tag kind="warn">filed, not sent</Tag> : null}
      </span>
      <div
        style={{
          padding: '10px 12px',
          background: ours ? 'var(--dk-inset)' : 'var(--dk-surface)',
          border: `1px solid ${ours ? 'var(--dk-line-2)' : 'var(--dk-line)'}`,
          borderRadius: 'var(--dk-radius-card)',
          borderTopLeftRadius: ours ? undefined : 4,
          borderTopRightRadius: ours ? 4 : undefined,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: 'var(--dk-ink)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {message.body}
      </div>
    </div>
  );
}

/**
 * The multiline field the kit does not have.
 *
 * Input is one line, and a one-line box for a four-thousand-character message
 * that a member will read is how typos reach people. Same inset, same border,
 * same control radius — it is an Input that grew.
 */
function Composer({
  value,
  onChange,
  placeholder,
  label,
  max,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** The accessible name. A placeholder is a hint, not a label. */
  label: string;
  max: number;
}) {
  const over = value.length > max;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={over || undefined}
        rows={5}
        style={{
          width: '100%',
          padding: '10px 12px',
          background: 'var(--dk-inset)',
          border: `1px solid ${over ? 'var(--dk-bad)' : 'var(--dk-line-2)'}`,
          borderRadius: 'var(--dk-radius-control)',
          color: 'var(--dk-ink)',
          fontFamily: 'inherit',
          fontSize: 13,
          lineHeight: 1.55,
          resize: 'vertical',
        }}
      />
      <span
        className="dk-mono"
        style={{ fontSize: 11, color: over ? 'var(--dk-bad)' : 'var(--dk-ink-3)', textAlign: 'right' }}
      >
        {value.length}/{max}
      </span>
    </div>
  );
}

/**
 * The send confirm.
 *
 * ⚠️ THE TEXT IS SHOWN, NOT SUMMARISED. The operator is about to put words in
 * front of a member; the last thing under their cursor should be those words.
 * The last row borrows MoneyDialog's discipline for the same reason it exists
 * there — an operator who has learned that Desk actions undo will reach for it
 * here too, and a sent message has no undo.
 */
function ConfirmSend({
  delivery,
  label,
  title,
  confirmLabel,
  assertive,
  busy,
  failure,
  onCancel,
  onConfirm,
}: {
  delivery: Delivery;
  label: string;
  title: React.ReactNode;
  confirmLabel: string;
  assertive: boolean;
  busy: boolean;
  /** The server's refusal, verbatim, shown where the operator is looking. */
  failure: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogFrame
      label={label}
      title={title}
      onClose={onCancel}
      assertive={assertive}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {/* ⚠️ BOTH, ALWAYS. `loading` only dims the Desk Button; without
              `disabled` a second click sends a second message. */}
          <Button
            variant="primary"
            icon={IconSend}
            onClick={onConfirm}
            loading={busy}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {failure ? <ResultBlock ok={false} tag="Not sent" body={failure} /> : null}

      {delivery.verbatim ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Label>Delivered exactly like this</Label>
          <pre
            style={{
              margin: 0,
              maxHeight: 220,
              overflowY: 'auto',
              padding: '10px 12px',
              background: 'var(--dk-ground)',
              border: '1px solid var(--dk-line)',
              borderRadius: 8,
              color: 'var(--dk-ink)',
              fontFamily: 'inherit',
              fontSize: 12.5,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {delivery.verbatim}
          </pre>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Kv k="Goes to" v={delivery.to} mono={false} />
        <Kv k="How" v={delivery.channels} mono={false} />
        <Kv k="Then" v={delivery.then} mono={false} last={!delivery.caveat} />
        {delivery.caveat ? (
          <Kv k="Note" v={delivery.caveat} mono={false} tone="warn" last />
        ) : null}
        <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 12.5 }}>
          <span style={{ color: 'var(--dk-ink-3)' }}>Undo</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--dk-warn)', textAlign: 'right' }}>
            None. A message that has gone cannot be recalled.
          </span>
        </div>
      </div>
    </DialogFrame>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Wording
 * ──────────────────────────────────────────────────────────────────────── */

function orderName(dossier: CaseDossier): string {
  const order = dossier.order;
  if (!order) return 'No order linked';
  if (order.title) return order.reference ? `${order.title} · ${order.reference}` : order.title;
  // Support tickets carry a bare transaction id and nothing else, so the tail
  // is all there is. Better a short honest handle than a fabricated title.
  return `Order ending ${order.id.slice(-8)}`;
}

function confirmTitle(dossier: CaseDossier, pending: Pending): string {
  const who = dossier.raisedBy ?? 'the member';
  if (pending.sort === 'reply') return `Send this to ${who}?`;
  if (pending.sort === 'resolve') return `Mark ${dossier.reference} resolved?`;
  const option = COMPLAINT_DECISIONS.find((o) => o.value === pending.state);
  return `${option?.label ?? 'Save'} on ${dossier.reference}?`;
}

function confirmVerb(pending: Pending): string {
  if (pending.sort === 'reply') return 'Send reply';
  if (pending.sort === 'resolve') return 'Mark resolved';
  return COMPLAINT_DECISIONS.find((o) => o.value === pending.state)?.label ?? 'Save';
}
