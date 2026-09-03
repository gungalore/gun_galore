'use client';

/**
 * THE DESK — the Send drawer.
 *
 * The replacement for /admin/broadcast AND /admin/campaigns, merged on
 * purpose: a campaign key and the blast it attributes are one job, and
 * keeping them on two pages is how the legacy panel could show a key with
 * 4,000 hits and no way to see what was said to earn them.
 *
 * 🚨 THE MOST DANGEROUS CONTROL ON THE DESK. Everything else here changes a
 * row a person can change back. This puts words on a stranger's phone and
 * there is no recall: no server-side draft, no pending queue, no undo window.
 * The kit's UndoToast is deliberately absent — it is a client-side delay with
 * nothing on the server to cancel, so wiring it here would promise a rescue
 * that does not exist. What replaces it is a confirm that restates the
 * channel, the recipient count, the exact words and what they cost, and will
 * not arm until a reason has been typed.
 *
 * ⚠️ THREE THINGS ON THIS SCREEN ARE TRUE AND EASY TO MISS, so each is said
 * where the decision is made rather than in a help page:
 *
 * 1. ON SMS, MOST COUNTS ARE A CEILING. Only `all-users` and `dormant`
 *    resolve to verified phones; every other segment counts MEMBERS and the
 *    sender skips the numberless ones as it goes. See describeCount.
 * 2. THE COUNT IS RE-RESOLVED AT SEND. The number in the confirm is a
 *    reading, timestamped, and the drawer says how old it is.
 * 3. THE TYPED REASON IS NOT RECORDED SERVER-SIDE. The broadcast endpoint
 *    takes no reason field. It still gates the button — but the confirm says
 *    plainly where the line does and does not go.
 *
 * ⚠️ NO NAMES, NO ADDRESSES, ANYWHERE. The audience is a segment or a member
 * id the operator already holds; nothing here resolves an id to a person,
 * because no decision on this screen needs one and a broadcast surface is
 * exactly the wrong place to render a list of people.
 */
import * as React from 'react';
import { Drawer, Section, DialogFrame, ResultBlock } from './overlays';
import { Button, Chip, Input, Tag } from './primitives';
import { Kv, Label } from './numbers';
import { RadioRow } from './forms';
import { FailedRegion } from './states';
import {
  IconAlert,
  IconBolt,
  IconCheck,
  IconMail,
  IconPhone,
  IconRefresh,
  IconSend,
  IconUser,
} from './icons';
import {
  BODY_MIN,
  CAMPAIGN_KEY_RE,
  EMAIL_MAX,
  RECIPIENT_CAP,
  REASON_MIN,
  SEND_SEGMENTS,
  SMS_MAX,
  SUBJECT_MIN,
  bodyCarriesLink,
  bodyWithCampaignLink,
  buildPlan,
  campaignLink,
  countAge,
  createCampaign,
  describeAudience,
  describeSendFailure,
  describeToggle,
  fetchCampaigns,
  fetchSmsCredit,
  formatCount,
  previewRecipients,
  sendBroadcast,
  smsShape,
  toggleCampaign,
  type Audience,
  type AudienceKind,
  type Campaign,
  type CountReading,
  type CreditReading,
  type SendChannel,
  type SendPlan,
  type SendResult,
  type SendSegment,
} from '@/lib/desk-send';

export interface SendDrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Applied once, when the drawer opens — the `?send=1&channel=…&segment=…`
   * entrance the legacy page had, so a Pulse card can hand over a composed
   * audience the way the Insights one did.
   *
   * ⚠️ ONLY ON OPEN, NEVER WHILE IT IS UP. A preset that re-applied on a
   * re-render would move the audience under an operator mid-compose, which is
   * the one thing a send surface must never do.
   */
  initialChannel?: SendChannel;
  initialSegment?: SendSegment;
}

type Mode = 'compose' | 'keys';

export function SendDrawer({
  open,
  onClose,
  initialChannel,
  initialSegment,
}: SendDrawerProps) {
  const [mode, setMode] = React.useState<Mode>('compose');

  const [channel, setChannel] = React.useState<SendChannel>('email');
  const [audienceKind, setAudienceKind] = React.useState<AudienceKind>('segment');
  const [segment, setSegment] = React.useState<SendSegment>('all-active-sellers');
  const [userId, setUserId] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');

  const [reading, setReading] = React.useState<CountReading | null>(null);
  const [counting, setCounting] = React.useState(false);
  const [countError, setCountError] = React.useState<string | null>(null);
  const [credit, setCredit] = React.useState<CreditReading | null>(null);

  const [campaigns, setCampaigns] = React.useState<Campaign[] | null>(null);
  const [campaignError, setCampaignError] = React.useState<string | null>(null);
  const [attributed, setAttributed] = React.useState<string | null>(null);

  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [typedCount, setTypedCount] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  // ⚠️ THE RESULT CARRIES ITS OWN CHANNEL AND AUDIENCE. Reading them off the
  // live pickers instead would relabel a finished send the moment the
  // operator changed either one to compose the next.
  const [result, setResult] = React.useState<
    (SendResult & { channel: SendChannel; who: string }) | null
  >(null);

  const audience: Audience = React.useMemo(() => {
    if (audienceKind === 'individual') return { kind: 'individual', userId: userId.trim() };
    if (audienceKind === 'all-users') return { kind: 'all-users' };
    return { kind: 'segment', segment };
  }, [audienceKind, segment, userId]);

  const audienceReady = audienceKind !== 'individual' || userId.trim().length > 0;

  // The preset lands on the opening edge and nowhere else — see the prop note.
  const applied = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      applied.current = false;
      return;
    }
    if (applied.current) return;
    applied.current = true;
    setMode('compose');
    if (initialChannel) setChannel(initialChannel);
    if (initialSegment) {
      setAudienceKind('segment');
      setSegment(initialSegment);
    }
  }, [open, initialChannel, initialSegment]);

  /**
   * ⚠️ THE LAST REQUEST WINS. Flipping from a segment to Everyone fires a
   * second preview while the first is still out, and the two queries are
   * wildly different in cost — so the cheap one can easily land second and
   * paint its number under the expensive audience. On a surface where the
   * number is the promise, that is the one race worth closing by hand.
   */
  const generation = React.useRef(0);

  const recount = React.useCallback(async () => {
    if (!audienceReady) return;
    const mine = ++generation.current;
    setCounting(true);
    setCountError(null);
    try {
      const { count } = await previewRecipients(audience, channel);
      if (mine !== generation.current) return;
      setReading({ count, at: new Date().toISOString() });
    } catch (err) {
      if (mine !== generation.current) return;
      setReading(null);
      setCountError(describeSendFailure('POST', err));
    } finally {
      if (mine === generation.current) setCounting(false);
    }
  }, [audience, channel, audienceReady]);

  /**
   * The count reads itself.
   *
   * ⚠️ NOT A "PREVIEW" BUTTON. The legacy page made the operator ask for the
   * number, which meant the number on screen could belong to an audience they
   * had since changed — and the send button next to it stayed armed. Here the
   * count is invalidated the moment the audience or the channel moves, and
   * re-read after a beat; typing in the BODY never re-counts, because it
   * cannot change who is in the audience.
   */
  React.useEffect(() => {
    if (!open || mode !== 'compose') return;
    generation.current += 1;
    setReading(null);
    setCountError(null);
    if (!audienceReady) {
      setCounting(false);
      return;
    }
    setCounting(true);
    const t = window.setTimeout(() => void recount(), 350);
    return () => window.clearTimeout(t);
  }, [open, mode, channel, audienceKind, segment, userId, audienceReady, recount]);

  // The vendor balance is slow (every service, 5s ceiling each) and only
  // matters on SMS, so it is fetched beside the drawer rather than in front
  // of it, and a failure is a reading rather than an error.
  React.useEffect(() => {
    if (!open || channel !== 'sms' || credit) return;
    let live = true;
    void fetchSmsCredit()
      .then((c) => live && setCredit(c))
      .catch((err) =>
        live &&
        setCredit({
          balance: null,
          unit: 'credits',
          error: describeSendFailure('GET', err),
          fetchedAt: null,
        }),
      );
    return () => {
      live = false;
    };
  }, [open, channel, credit]);

  const loadCampaigns = React.useCallback(() => {
    setCampaignError(null);
    return fetchCampaigns()
      .then(setCampaigns)
      .catch((err) => {
        setCampaigns(null);
        setCampaignError(describeSendFailure('GET', err));
      });
  }, []);

  React.useEffect(() => {
    if (!open || campaigns || campaignError) return;
    void loadCampaigns();
  }, [open, campaigns, campaignError, loadCampaigns]);

  /**
   * ⚠️ ESCAPE REACHES BOTH LISTENERS. Drawer and DialogFrame each bind a
   * capture-phase keydown on `document`, and stopPropagation does not silence
   * a sibling listener on the same node — so one Escape over the confirm
   * would close the confirm AND the drawer, losing a composed message. While
   * a confirm is up the drawer's close swallows the key.
   */
  const confirmingRef = React.useRef(false);
  React.useEffect(() => {
    confirmingRef.current = confirming;
  }, [confirming]);
  const closeDrawer = React.useCallback(() => {
    if (confirmingRef.current) {
      setConfirming(false);
      return;
    }
    onClose();
  }, [onClose]);

  const plan = React.useMemo(
    () => buildPlan({ channel, audience, subject, body, reading, credit }),
    [channel, audience, subject, body, reading, credit],
  );

  const armed = plan.blockers.length === 0 && !counting;
  const ChannelIcon = channel === 'sms' ? IconPhone : IconMail;

  async function fire() {
    setBusy(true);
    setFailure(null);
    try {
      const res = await sendBroadcast({
        channel,
        audience,
        subject: channel === 'email' ? subject.trim() : undefined,
        body: body.trim(),
      });
      setResult({ ...res, channel, who: describeAudience(audience) });
      setConfirming(false);
      setReason('');
      setTypedCount('');
      // The message is spent — clearing it is what stops a second press from
      // sending the same words to the same people. The audience stays, so the
      // result above it still names who it went to, and the count is read
      // again rather than left showing the figure that has just been used.
      setSubject('');
      setBody('');
      setAttributed(null);
      void recount();
    } catch (err) {
      // ⚠️ THE DIALOG STAYS OPEN ON FAILURE. The server's own words are the
      // only useful thing on screen at that moment, and a dialog that closes
      // takes them with it.
      setFailure(describeSendFailure('POST', err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={closeDrawer}
        typeLabel="Send"
        icon={IconSend}
        title={mode === 'compose' ? 'Send a message' : 'Campaign keys'}
        meta={
          mode === 'compose'
            ? 'One email or SMS to a segment, one member, or everyone. It goes immediately and cannot be recalled.'
            : 'A key rides in the SMS link as ?c=. It shows the welcome banner once per visitor and attributes the sign-ups that follow.'
        }
        tags={
          mode === 'compose' ? (
            <>
              <Tag kind="neutral" icon={ChannelIcon}>
                {channel === 'sms' ? 'SMS' : 'Email'}
              </Tag>
              <Tag kind={audienceKind === 'all-users' ? 'bad' : 'neutral'} icon={null}>
                {describeAudience(audience)}
              </Tag>
            </>
          ) : null
        }
        note={
          mode === 'compose'
            ? 'Nothing here is a draft. The confirm is the last place this stops.'
            : 'A new key is live the moment it is created — the banner works for anyone who has the link.'
        }
        footer={
          mode === 'compose' ? (
            <>
              {/* ⚠️ GATED, NOT DISABLED — and the line beside it is the whole
                  point. A greyed-out Send with no explanation is how an
                  operator concludes the Desk is broken and goes back to the
                  legacy page. The button keeps its promise ("Send…") and the
                  text says which switch is off. */}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.4 }}>
                  {plan.blockers[0] ?? (counting ? 'Counting the audience…' : '')}
                </span>
              </span>
              <Button
                variant={armed ? 'primary' : 'gated'}
                icon={armed ? IconSend : undefined}
                onClick={() => {
                  if (!armed) return;
                  setFailure(null);
                  setReason('');
                  setTypedCount('');
                  setConfirming(true);
                }}
              >
                Send…
              </Button>
            </>
          ) : undefined
        }
      >
        <div style={{ display: 'flex', gap: 6, padding: '14px 20px 0' }}>
          <Chip active={mode === 'compose'} onClick={() => setMode('compose')}>
            Compose
          </Chip>
          <Chip
            active={mode === 'keys'}
            count={campaigns ? campaigns.filter((c) => c.active).length : undefined}
            onClick={() => setMode('keys')}
          >
            Campaign keys
          </Chip>
        </div>

        {mode === 'compose' ? (
          <Compose
            channel={channel}
            onChannel={(c) => {
              setChannel(c);
              setResult(null);
            }}
            audienceKind={audienceKind}
            onAudienceKind={setAudienceKind}
            segment={segment}
            onSegment={setSegment}
            userId={userId}
            onUserId={setUserId}
            subject={subject}
            onSubject={setSubject}
            body={body}
            onBody={setBody}
            reading={reading}
            counting={counting}
            countError={countError}
            onRecount={() => void recount()}
            credit={credit}
            plan={plan}
            campaigns={campaigns}
            // ⚠️ A FAILED READ IS NOT A SLOW ONE. Both leave `campaigns` null,
            // and Attribution said "Reading the keys…" to both — so a keys
            // endpoint that was down read as one still loading, forever, on
            // the tab where the operator decides whether the blast is
            // traceable at all.
            campaignsFailed={campaignError !== null}
            attributed={attributed}
            onAttribute={(key) => {
              setAttributed(key);
              if (key) setBody((b) => bodyWithCampaignLink(b, key));
            }}
            result={result}
          />
        ) : (
          <Keys
            campaigns={campaigns}
            error={campaignError}
            onReload={() => void loadCampaigns()}
          />
        )}

        {/* ⚠️ INSIDE THE DRAWER, DELIBERATELY. DialogFrame is fixed to the
            viewport either way — dk-drawer-in animates a transform but does
            not retain it, so nothing re-anchors once it has played. What the
            placement buys is the FOCUS TRAP: the drawer traps Tab inside its
            own panel, so a confirm rendered as a sibling would have its
            fields tabbed straight past. Rendered here, the dialog's inputs
            are in the trap's list and the cycle stays where the decision is. */}
        {confirming ? (
          <ConfirmSend
            plan={plan}
            reason={reason}
            onReason={setReason}
            typedCount={typedCount}
            onTypedCount={setTypedCount}
            requireTypedCount={audienceKind === 'all-users'}
            busy={busy}
            failure={failure}
            onCancel={() => setConfirming(false)}
            onConfirm={() => void fire()}
          />
        ) : null}
      </Drawer>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Compose
 * ──────────────────────────────────────────────────────────────────────── */

function Compose(props: {
  channel: SendChannel;
  onChannel: (c: SendChannel) => void;
  audienceKind: AudienceKind;
  onAudienceKind: (k: AudienceKind) => void;
  segment: SendSegment;
  onSegment: (s: SendSegment) => void;
  userId: string;
  onUserId: (v: string) => void;
  subject: string;
  onSubject: (v: string) => void;
  body: string;
  onBody: (v: string) => void;
  reading: CountReading | null;
  counting: boolean;
  countError: string | null;
  onRecount: () => void;
  credit: CreditReading | null;
  plan: SendPlan;
  campaigns: Campaign[] | null;
  campaignsFailed: boolean;
  attributed: string | null;
  onAttribute: (key: string | null) => void;
  result: (SendResult & { channel: SendChannel; who: string }) | null;
}) {
  const {
    channel,
    onChannel,
    audienceKind,
    onAudienceKind,
    segment,
    onSegment,
    userId,
    onUserId,
    subject,
    onSubject,
    body,
    onBody,
    reading,
    counting,
    countError,
    onRecount,
    credit,
    plan,
    campaigns,
    campaignsFailed,
    attributed,
    onAttribute,
    result,
  } = props;

  // ⚠️ THE TRIMMED BODY, because that is what is sent — buildPlan trims, the
  // endpoint trims, and a live counter measuring the untrimmed one would
  // disagree with the cost in the confirm over nothing but a trailing space.
  const shape = smsShape(body.trim());
  const max = channel === 'sms' ? SMS_MAX : EMAIL_MAX;
  const live = (campaigns ?? []).filter((c) => c.active);

  return (
    <>
      {/* ⚠️ "handed over", NOT "delivered". The server's `sent` counts the
          recipients it passed to Resend / SMSPortal, and NotificationsService
          then drops the muted ones without saying so and without moving them
          into `skipped` — so `sent` is an upper bound on delivery in the same
          way the SMS count is an upper bound on the audience. The legacy page
          printed this number under the word "delivered"; repeating that here
          would be the one lie this drawer is least entitled to tell, since it
          is the only figure the operator gets AFTER the money is spent. */}
      {result ? (
        <div style={{ padding: '14px 20px 0' }}>
          <ResultBlock
            ok
            tag={`${result.channel === 'sms' ? 'SMS' : 'Email'} sent`}
            body={[
              `to           ${result.who}`,
              `handed over  ${formatCount(result.sent)}   to ${result.channel === 'sms' ? 'SMSPortal' : 'Resend'}`,
              `skipped      ${formatCount(result.skipped)}   (no ${result.channel === 'sms' ? 'number' : 'address'} on file)`,
              `audience     ${formatCount(result.total)}   as the server resolved it at send`,
              '',
              `Members who had ${result.channel === 'sms' ? 'SMS' : 'notification email'} switched off are inside "handed over" and`,
              'received nothing. The server does not report them separately.',
            ].join('\n')}
          />
        </div>
      ) : null}

      <Section label="Channel">
        <div style={{ display: 'flex', gap: 6 }}>
          <Chip active={channel === 'email'} onClick={() => onChannel('email')}>
            Email
          </Chip>
          <Chip active={channel === 'sms'} onClick={() => onChannel('sms')}>
            SMS
          </Chip>
        </div>
        {channel === 'sms' ? (
          <div style={{ marginTop: 10 }}>
            <Kv
              k="SMS credits"
              v={
                !credit ? (
                  'reading…'
                ) : credit.balance === null ? (
                  <span style={{ color: 'var(--dk-warn)' }}>could not read</span>
                ) : (
                  `${formatCount(credit.balance)} ${credit.unit ?? 'credits'}`
                )
              }
              last
            />
            {credit?.error ? <Quiet>{credit.error}</Quiet> : null}
            {credit && credit.balance !== null ? (
              <Quiet>
                SMSPortal’s own reading{credit.fetchedAt ? `, taken ${countAge(credit.fetchedAt)}` : ''}. Each
                message part bills one credit.
              </Quiet>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section label="Who">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <Chip active={audienceKind === 'segment'} onClick={() => onAudienceKind('segment')}>
            Segment
          </Chip>
          <Chip active={audienceKind === 'individual'} onClick={() => onAudienceKind('individual')}>
            One member
          </Chip>
          <Chip active={audienceKind === 'all-users'} onClick={() => onAudienceKind('all-users')}>
            Everyone
          </Chip>
        </div>

        {audienceKind === 'segment' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SEND_SEGMENTS.map((s) => (
              <RadioRow
                key={s.value}
                name="desk-send-segment"
                checked={segment === s.value}
                onChange={() => onSegment(s.value)}
                label={s.label}
                sub={s.definition}
              />
            ))}
          </div>
        ) : null}

        {audienceKind === 'individual' ? (
          <>
            <Input
              icon={IconUser}
              value={userId}
              onChange={(e) => onUserId(e.target.value)}
              placeholder="Member id"
              aria-label="Member id"
            />
            {/* ⚠️ AN ID, NOT A PERSON. The Desk does not resolve it to a name
                here — a broadcast screen has no decision that needs one. */}
            <Quiet>
              The member’s id from People. Nothing on this screen looks up who that is.
            </Quiet>
          </>
        ) : null}

        {audienceKind === 'all-users' ? (
          <div
            style={{
              display: 'flex',
              gap: 9,
              padding: '10px 12px',
              borderRadius: 'var(--dk-radius-control)',
              background: 'var(--dk-bad-wash)',
              border: '1px solid var(--dk-bad-line)',
            }}
          >
            <IconAlert size={13} style={{ color: 'var(--dk-bad)', marginTop: 2, flex: 'none' }} />
            <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>
              Every non-banned, non-closed account that can be reached on this channel. The confirm
              will ask you to type the number back before it arms.
            </span>
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          {countError ? (
            <FailedRegion
              title="Couldn't count the audience"
              detail={countError}
              onRetry={onRecount}
              scopeNote="nothing has been sent"
            />
          ) : (
            <CountBlock
              counting={counting}
              reading={reading}
              plan={plan}
              onRecount={onRecount}
            />
          )}
        </div>
      </Section>

      <Section label="Message">
        {channel === 'email' ? (
          <div style={{ marginBottom: 10 }}>
            <Input
              value={subject}
              onChange={(e) => onSubject(e.target.value)}
              placeholder={`Subject (at least ${SUBJECT_MIN} characters)`}
              aria-label="Subject"
            />
          </div>
        ) : null}

        <textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          rows={channel === 'sms' ? 5 : 9}
          maxLength={max}
          aria-label="Message body"
          placeholder={
            channel === 'sms'
              ? 'Plain text. Keep it short — every 160 characters is another credit per recipient.'
              : 'Plain text. Line breaks are preserved; there is no template and no formatting.'
          }
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'var(--dk-inset)',
            border: '1px solid var(--dk-line-2)',
            borderRadius: 'var(--dk-radius-control)',
            color: 'var(--dk-ink)',
            fontFamily: 'inherit',
            fontSize: 13,
            lineHeight: 1.55,
            resize: 'vertical',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 6,
            flexWrap: 'wrap',
          }}
        >
          <span
            className="dk-mono"
            style={{
              fontSize: 11,
              color: body.length < BODY_MIN ? 'var(--dk-ink-3)' : 'var(--dk-ink-2)',
            }}
          >
            {body.length}/{max}
          </span>
          <span style={{ flex: 1 }} />
          {channel === 'sms' ? (
            <>
              {shape.unicode ? (
                <Tag kind="warn" icon={IconAlert}>
                  unicode — 70 a part
                </Tag>
              ) : (
                <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                  {shape.used}/{shape.perPart} this part
                </span>
              )}
              <Tag kind={shape.parts > 1 ? 'warn' : 'neutral'} icon={null}>
                {shape.parts} {shape.parts === 1 ? 'credit' : 'credits'} each
              </Tag>
            </>
          ) : null}
        </div>

        {channel === 'sms' && plan.creditsNeeded !== null && plan.count > 0 ? (
          <div style={{ marginTop: 8 }}>
            <Kv
              k="Estimated cost"
              v={`≈ ${formatCount(plan.creditsNeeded)} credits`}
              tone={
                credit && credit.balance !== null && plan.creditsNeeded > credit.balance
                  ? 'bad'
                  : undefined
              }
              last
            />
            <Quiet>
              {plan.exact ? 'Recipients' : 'Audience size'} × parts. An estimate: the vendor bills the
              parts it actually splits into.
            </Quiet>
          </div>
        ) : null}
      </Section>

      <Section label="Attribution" last>
        {campaignsFailed ? (
          // Three different facts, three different sentences: not read yet,
          // read and failed, read and empty. Collapsing the middle one into
          // the first is what left this section spinning on a dead endpoint.
          <Quiet>
            The keys could not be read, so none can be offered here. Open Campaign keys above for the
            server’s words and a retry. A blast sent now carries no link and counts against nothing.
          </Quiet>
        ) : campaigns === null ? (
          <Quiet>Reading the keys…</Quiet>
        ) : live.length === 0 ? (
          <Quiet>
            No live campaign key. Create one under Campaign keys if this blast should be traceable —
            without a key in the link there is no way to tell later what it pulled.
          </Quiet>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip active={attributed === null} onClick={() => onAttribute(null)}>
                None
              </Chip>
              {live.map((c) => (
                <Chip
                  key={c.id}
                  active={attributed === c.key}
                  onClick={() => onAttribute(c.key)}
                >
                  {c.key}
                </Chip>
              ))}
            </div>
            {attributed ? (
              <div style={{ marginTop: 10 }}>
                <Kv k="Link in the body" v={campaignLink(attributed)} last />
                {bodyCarriesLink(body, attributed) ? (
                  <Quiet>
                    The link is in the message. That link IS the attribution — the broadcast endpoint
                    knows nothing about campaigns, so a blast sent without it counts against nothing
                    no matter what is selected here.
                  </Quiet>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Tag kind="warn">not in the body</Tag>
                    <Button variant="secondary" onClick={() => onAttribute(attributed)}>
                      Put the link back
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}

/**
 * The number, and what it is worth.
 *
 * ⚠️ THE TAG IS NOT DECORATION. "headcount" and "ceiling" are different
 * promises, and on SMS the difference is routinely hundreds of people. The
 * age is here for the same reason: the send re-resolves the audience, so a
 * number read ten minutes ago is a number the send will not honour.
 */
function CountBlock({
  counting,
  reading,
  plan,
  onRecount,
}: {
  counting: boolean;
  reading: CountReading | null;
  plan: SendPlan;
  onRecount: () => void;
}) {
  const over = plan.count > RECIPIENT_CAP;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        background: 'var(--dk-surface)',
        border: `1px solid ${over ? 'var(--dk-bad-line)' : 'var(--dk-line)'}`,
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Label>Recipients</Label>
        <span style={{ flex: 1 }} />
        {reading ? (
          <Tag kind={plan.exact ? 'neutral' : 'warn'} icon={plan.exact ? null : IconAlert}>
            {plan.exact ? 'headcount' : 'ceiling'}
          </Tag>
        ) : null}
        <Button variant="ghost" icon={IconRefresh} onClick={onRecount} loading={counting}>
          Recount
        </Button>
      </span>
      <span
        className="dk-mono"
        style={{
          fontSize: 26,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: '-0.01em',
          color: over ? 'var(--dk-bad)' : 'var(--dk-ink)',
        }}
      >
        {counting ? '…' : reading ? plan.countLabel : '—'}
      </span>
      <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
        {counting
          ? 'Counting the audience…'
          : reading
            ? plan.countNote
            : 'Pick an audience and the count reads itself.'}
      </span>
      {reading ? (
        <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-4)' }}>
          counted {countAge(reading.at)} · the send counts again
        </span>
      ) : null}
      {over ? (
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-bad)' }}>
          Over the {formatCount(RECIPIENT_CAP)} cap. The server refuses the whole send — it does not
          send the first {formatCount(RECIPIENT_CAP)}.
        </span>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The confirm
 * ──────────────────────────────────────────────────────────────────────── */

function ConfirmSend({
  plan,
  reason,
  onReason,
  typedCount,
  onTypedCount,
  requireTypedCount,
  busy,
  failure,
  onCancel,
  onConfirm,
}: {
  plan: SendPlan;
  reason: string;
  onReason: (v: string) => void;
  typedCount: string;
  onTypedCount: (v: string) => void;
  requireTypedCount: boolean;
  busy: boolean;
  failure: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const reasonOk = reason.trim().length >= REASON_MIN;
  // ⚠️ TYPING THE NUMBER, NOT A WORD. The legacy page asked for "CONFIRM",
  // which can be typed without reading anything on the screen. The count is
  // the fact that matters, so on the everyone path it is the fact that has to
  // be re-entered — digits only, so a thousands separator does not fight it.
  const countOk = !requireTypedCount || typedCount.replace(/\D/g, '') === String(plan.count);
  const armed = reasonOk && countOk && !busy;
  const channelWord = plan.channel === 'sms' ? 'SMS' : 'email';
  // What is still holding it, in the order the operator meets the fields.
  const gate = !reasonOk
    ? `A reason of at least ${REASON_MIN} characters arms this.`
    : !countOk
      ? 'Type the recipient count back to arm this.'
      : null;

  return (
    <DialogFrame
      label="Send · confirm"
      title={
        plan.exact
          ? `Send this ${channelWord} to ${plan.countLabel} ${plan.count === 1 ? 'person' : 'people'}?`
          : `Send this ${channelWord} to as many as ${plan.countLabel} people?`
      }
      onClose={onCancel}
      assertive
      width={560}
      footer={
        <>
          {gate && !busy ? (
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11.5,
                lineHeight: 1.4,
                color: 'var(--dk-ink-3)',
              }}
            >
              {gate}
            </span>
          ) : null}
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {/* ⚠️ BOTH loading AND disabled ONCE IT IS FIRING. `loading` only
              dims the Desk Button; without `disabled` a second click sends the
              same words to the same people again. Before it fires the control
              is gated rather than disabled, so it stays focusable and the line
              beside it says what is missing. */}
          <Button
            variant={armed ? 'primary' : 'gated'}
            icon={armed ? IconSend : undefined}
            amount={plan.countLabel}
            onClick={() => {
              if (!armed) return;
              onConfirm();
            }}
            loading={busy}
            disabled={busy}
          >
            {plan.exact ? 'Send to' : 'Send to at most'}
          </Button>
        </>
      }
    >
      {failure ? <ResultBlock ok={false} tag="Not sent" body={failure} /> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Label>They read exactly this</Label>
        <pre
          style={{
            margin: 0,
            maxHeight: 200,
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
          {plan.subject ? `Subject: ${plan.subject}\n\n${plan.body}` : plan.body}
        </pre>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Kv k="Channel" v={channelWord} mono={false} />
        <Kv k="Audience" v={plan.who} mono={false} />
        <Kv
          k="Recipients"
          v={plan.exact ? plan.countLabel : `at most ${plan.countLabel}`}
          tone={plan.exact ? undefined : 'warn'}
        />
        {plan.countedAt ? <Kv k="Counted" v={`${plan.countedAt} · re-counted at send`} /> : null}
        {plan.creditsNeeded !== null ? (
          <Kv k="Estimated cost" v={`≈ ${formatCount(plan.creditsNeeded)} SMS credits`} />
        ) : null}
        <Kv k="Also" v={plan.alsoDoes} mono={false} />
        <Kv k="Then" v={plan.then} mono={false} last />
        <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 12.5 }}>
          <span style={{ color: 'var(--dk-ink-3)' }}>Undo</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--dk-warn)', textAlign: 'right' }}>
            None. A message that has gone cannot be recalled.
          </span>
        </div>
      </div>

      {plan.exact ? null : (
        <Note tone="warn">{plan.countNote}</Note>
      )}
      {plan.cautions.map((c, i) => (
        <Note key={i} tone="warn">
          {c}
        </Note>
      ))}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Input
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder={`Why is this going out? (at least ${REASON_MIN} characters)`}
          aria-label="Reason for this send"
        />
        {/*
          ⚠️ SAID OUT LOUD, BECAUSE THE ALTERNATIVE IS A LIE. Every other
          reason box on the Desk lands in the audit trail. This endpoint takes
          no reason field, so this one does not — it is the pause before an
          unrecallable send, and pretending otherwise would leave an operator
          believing there is a record of their thinking when there is not.
        */}
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
          This line is the pause, not the record. The audit row keeps the channel, the audience, the
          recipient count and the first 200 characters of the body — the broadcast endpoint has no
          reason field to put this in.
        </span>
      </div>

      {requireTypedCount ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Input
            value={typedCount}
            onChange={(e) => onTypedCount(e.target.value)}
            inputMode="numeric"
            placeholder={`Type ${plan.count} to arm this`}
            aria-label="Type the recipient count to arm the send"
            error={typedCount && !countOk ? 'That is not the number above.' : undefined}
          />
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            Everyone on the site. Typing the count back is the last check that you have read it.
          </span>
        </div>
      ) : null}
    </DialogFrame>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Campaign keys
 * ──────────────────────────────────────────────────────────────────────── */

function Keys({
  campaigns,
  error,
  onReload,
}: {
  campaigns: Campaign[] | null;
  error: string | null;
  onReload: () => void;
}) {
  const [key, setKey] = React.useState('');
  const [name, setName] = React.useState('');
  const [headline, setHeadline] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = React.useState<Campaign | null>(null);

  const keyOk = CAMPAIGN_KEY_RE.test(key.trim().toLowerCase());
  const nameOk = name.trim().length >= 3;

  async function create() {
    setBusy(true);
    setFormError(null);
    try {
      await createCampaign({ key, name, headline });
      setKey('');
      setName('');
      setHeadline('');
      onReload();
    } catch (err) {
      setFormError(describeSendFailure('POST', err));
    } finally {
      setBusy(false);
    }
  }

  async function flip(c: Campaign) {
    setBusy(true);
    setFormError(null);
    try {
      await toggleCampaign(c.id);
      setPendingToggle(null);
      onReload();
    } catch (err) {
      setFormError(describeSendFailure('POST', err));
      setPendingToggle(null);
    } finally {
      setBusy(false);
    }
  }

  function copy(k: string) {
    void navigator.clipboard?.writeText(campaignLink(k));
    setCopied(k);
    window.setTimeout(() => setCopied((c) => (c === k ? null : c)), 1500);
  }

  return (
    <>
      <Section label="Keys">
        {error ? (
          <FailedRegion title="Couldn't load the keys" detail={error} onRetry={onReload} />
        ) : !campaigns ? (
          <Quiet>Loading…</Quiet>
        ) : campaigns.length === 0 ? (
          <Quiet>No keys yet. Create one below, then put its link in the next blast.</Quiet>
        ) : (
          campaigns.map((c, i) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                padding: '11px 0',
                borderBottom: i === campaigns.length - 1 ? undefined : '1px solid var(--dk-line)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
                  {c.name}
                </span>
                <Tag kind={c.active ? 'ok' : 'neutral'} icon={null}>
                  {c.active ? 'live' : 'off'}
                </Tag>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                  ?c={c.key}
                </span>
                <Button
                  variant="ghost"
                  icon={copied === c.key ? IconCheck : undefined}
                  onClick={() => copy(c.key)}
                >
                  {copied === c.key ? 'Copied' : 'Copy link'}
                </Button>
              </span>
              <div style={{ display: 'flex', gap: 14 }}>
                <Stat label="Banner" value={c.hits} />
                <Stat label="Joined" value={c.signups ?? 0} />
                <Stat label="Listed" value={c.sellers ?? 0} />
                <span style={{ flex: 1 }} />
                <Button
                  variant={c.active ? 'danger' : 'secondary'}
                  disabled={busy}
                  onClick={() => setPendingToggle(c)}
                >
                  {c.active ? 'Turn off…' : 'Turn on…'}
                </Button>
              </div>
              {c.headline ? (
                <Quiet>Banner reads “{c.headline}”</Quiet>
              ) : (
                <Quiet>Banner uses the default headline.</Quiet>
              )}
            </div>
          ))
        )}
        <Quiet>
          Banner counts arrivals that saw the card, once per visitor per session. Joined and Listed
          are first-touch and captured at sign-up, so a member only ever counts against the first key
          that brought them in — and keys that ran before attribution shipped honestly read zero.
        </Quiet>
      </Section>

      <Section label="New key" last>
        {formError ? <ResultBlock ok={false} tag="Refused" body={formError} /> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: formError ? 12 : 0 }}>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Key — short, rides in the URL (a-z, 0-9, dashes)"
            aria-label="Campaign key"
            error={key && !keyOk ? '2–24 characters: letters, numbers or dashes.' : undefined}
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Internal name — what this blast was"
            aria-label="Campaign name"
          />
          <Input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Banner headline (optional — blank uses the default)"
            aria-label="Banner headline"
          />
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button
              variant={keyOk && nameOk ? 'primary' : 'gated'}
              icon={keyOk && nameOk ? IconBolt : undefined}
              loading={busy}
              disabled={busy}
              onClick={() => {
                if (keyOk && nameOk) void create();
              }}
            >
              Create key
            </Button>
            {keyOk ? (
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                {campaignLink(key.trim().toLowerCase())}
              </span>
            ) : null}
          </span>
          <Quiet>
            Created live. The banner works for anyone holding the link from the moment it exists —
            harmless while only you have it, and not harmless once it is in an SMS.
          </Quiet>
        </div>
      </Section>

      {pendingToggle ? (
        <ToggleConfirm
          campaign={pendingToggle}
          busy={busy}
          onCancel={() => setPendingToggle(null)}
          onConfirm={() => void flip(pendingToggle)}
        />
      ) : null}
    </>
  );
}

/**
 * ⚠️ TURNING A KEY OFF IS A PUBLIC CHANGE WITH A SILENT SECOND HALF. It stops
 * the banner, which is visible — and stops attribution, which is not. An SMS
 * already in people's pockets keeps arriving, and every one of those arrivals
 * counts against nothing from here on, with no way to backfill.
 */
function ToggleConfirm({
  campaign,
  busy,
  onCancel,
  onConfirm,
}: {
  campaign: Campaign;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { title, body } = describeToggle(campaign);
  return (
    <DialogFrame
      label="Campaign key · confirm"
      title={title}
      onClose={onCancel}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={campaign.active ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            disabled={busy}
          >
            {campaign.active ? 'Turn it off' : 'Turn it on'}
          </Button>
        </>
      }
    >
      <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>{body}</span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Kv k="Key" v={`?c=${campaign.key}`} />
        <Kv k="Link" v={campaignLink(campaign.key)} />
        <Kv k="Counted so far" v={`${formatCount(campaign.hits)} banner · ${formatCount(campaign.signups ?? 0)} joined`} last />
      </div>
    </DialogFrame>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Small shared bits
 * ──────────────────────────────────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Label>{label}</Label>
      <span className="dk-mono" style={{ fontSize: 13, color: 'var(--dk-ink)' }}>
        {formatCount(value)}
      </span>
    </span>
  );
}

function Note({ tone, children }: { tone: 'warn' | 'bad'; children: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <IconAlert
        size={13}
        style={{ color: tone === 'bad' ? 'var(--dk-bad)' : 'var(--dk-warn)', marginTop: 2, flex: 'none' }}
      />
      <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>{children}</span>
    </span>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'block',
        marginTop: 6,
        fontSize: 11.5,
        lineHeight: 1.5,
        color: 'var(--dk-ink-3)',
      }}
    >
      {children}
    </span>
  );
}
