'use client';

/**
 * THE DESK — Site.
 *
 * The surface is a CONVERSATION AND A BOARD, in that order: Warden reports
 * what it found, what it fixed on its own and what it wants permission to do;
 * the board beside it is the evidence. Nothing on this page is a dashboard
 * for its own sake.
 *
 * ⚠️ WARDEN IS A DAEMON ON THE BOX, NOT CODE IN THIS APP OR IN THE API. The
 * chat card asks GET /admin/warden/chat, which is an authenticated door that
 * fails closed on WARDEN_BASE_URL / WARDEN_TOKEN — unset in every environment
 * today. So the card renders `present: false` with the reason on its face and
 * the composer is disabled, rather than an empty thread under a green badge.
 * A quiet Warden and an absent Warden look identical and mean opposite things.
 *
 * ⚠️ ANYTHING THIS PROCESS CANNOT MEASURE IS AN EM DASH, NEVER A ZERO. The
 * rule already lives in desk-site.service.ts (`known: false`) and it holds all
 * the way to the tile: "0% disk used" and "we could not measure the disk" are
 * different facts, and only one of them is true.
 *
 * ⚠️ AND THE CUTOVER SURFACES ARE STILL HERE. Alerts, credits, service
 * probes, queue depths and trust-and-safety are the Desk's only home for five
 * legacy pages (see lib/desk-cutover.ts — several are marked PARTIAL, which
 * means the legacy page still exists BECAUSE of what is missing here).
 * Deleting them to make the page match the artboard would have deleted the
 * only route to ~20 alert types. They sit below the drawn surface, under
 * their own heading, rather than inside it.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  Button,
  ChatComposer,
  Chip,
  DeskShell,
  DialogFrame,
  Drawer,
  FailedRegion,
  IconAlert,
  IconBell,
  IconBolt,
  IconBubble,
  IconCheck,
  IconClock,
  IconLock,
  IconMail,
  IconPause,
  IconPencil,
  IconPhone,
  IconRefresh,
  IconSend,
  IconUser,
  Input,
  Label,
  OperatorMessage,
  Section,
  SendDrawer,
  SkeletonPile,
  Tag,
  Toggle,
  Vital,
  WardenMessage,
  useIsPhone,
} from '../../../../components/desk';
/* ⚠️ IMPORTED BY FILE, NOT FROM THE KIT INDEX, and only because index.ts is
   another agent's file this task may not touch. Whoever next edits it should
   add `export * from './whatsapp-drawer';` and change this line — the kit's
   own header says import from there, never from a file. */
import { AdminsDrawer } from '@/components/desk/admins-drawer';
import { WhatsappDrawer } from '../../../../components/desk/whatsapp-drawer';
import { deskFetch, describeFailure } from '../../../../lib/desk-auth';
import { parseSendPreset, stripSendPreset, type SendPreset } from '@/lib/desk-send';
import {
  QUEUE_DESK_HREF,
  SERVICE_CATEGORY_LABEL,
  ago,
  approveWardenProposal,
  clock,
  creditIsLow,
  creditUnreadable,
  declineWardenProposal,
  fetchAdmins,
  fetchAlerts,
  fetchAudit,
  fetchCreditThresholds,
  fetchCredits,
  fetchCrons,
  fetchDeskSettings,
  fetchQueues,
  fetchRejections,
  fetchRepeatOffenders,
  fetchReportedListings,
  fetchReportedQuestions,
  fetchReportedSellers,
  fetchServices,
  fetchWardenChat,
  fetchWardenSettings,
  parseWhatsappThreadId,
  queueTone,
  resolveAlert,
  sendWardenChat,
  settingReasonMin,
  stamp,
  stripWhatsappParam,
  updateSetting,
  wardenAbsent,
  type AdminAccount,
  type AdminAlertRow,
  type AuditRow,
  type CreditSnapshot,
  type CreditThreshold,
  type CronRow,
  type QueueRow,
  type RejectionRow,
  type RepeatOffenderRow,
  type ReportedListingRow,
  type ReportedQuestionRow,
  type ReportedSellerRow,
  type ServiceProbe,
  type SettingFlag,
  type WardenChat,
  type WardenProposal,
  type WardenSettingRow,
} from '../../../../lib/desk-site';

type Tone = 'ok' | 'warn' | 'bad' | 'info';

interface ConfigGate { key: string; label: string; value: string; tone: Tone; note?: string }
interface VitalRow { key: string; label: string; known: boolean; value: string; tone: Tone }
interface ChannelRow { key: string; label: string; state: string; tone: Tone; detail: string }
interface SiteBoard {
  gates: ConfigGate[];
  channels: ChannelRow[];
  vitals: VitalRow[];
}

const CHANNEL_ICON = { email: IconMail, sms: IconPhone, push: IconBell, whatsapp: IconBubble } as const;

/**
 * What "Pause Warden" actually does.
 *
 * ⚠️ THERE IS NO PAUSE ROUTE, AND THIS BUTTON DOES NOT PRETEND THERE IS. The
 * API exposes six Warden routes and none of them stops the daemon; the daemon
 * takes instructions in plain language on the thread, which is the whole
 * design of the surface. So the button posts a standing instruction and the
 * confirm says so in as many words. The "Warden active" tag does NOT flip to
 * "paused" afterwards, because nothing on this side can confirm that it did.
 */
const PAUSE_INSTRUCTION =
  'Pause. Stop acting on your safe list and stop raising proposals until I say otherwise. ' +
  'Keep checking and keep reporting what you find.';

export default function SitePage() {
  const [board, setBoard] = React.useState<SiteBoard | null>(null);
  const [settings, setSettings] = React.useState<SettingFlag[] | null>(null);
  const [wardenRows, setWardenRows] = React.useState<WardenSettingRow[] | null>(null);
  const [alerts, setAlerts] = React.useState<AdminAlertRow[]>([]);
  const [credits, setCredits] = React.useState<CreditSnapshot[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loadedAt, setLoadedAt] = React.useState<string | null>(null);
  const [audit, setAudit] = React.useState<AuditRow[] | null>(null);
  const [admins, setAdmins] = React.useState<AdminAccount[] | null>(null);
  const [auditOpen, setAuditOpen] = React.useState(false);
  const [adminsOpen, setAdminsOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [sendPreset, setSendPreset] = React.useState<SendPreset>({ open: false });
  const [whatsappThread, setWhatsappThread] = React.useState<string | null>(null);
  // Same reasoning as the settings dialog below: one row refusing must not
  // take the health probes and the trust-and-safety feeds off the screen.
  const [alertError, setAlertError] = React.useState<string | null>(null);
  const [thresholds, setThresholds] = React.useState<CreditThreshold[]>([]);
  const phone = useIsPhone();
  const [lens, setLens] = React.useState<'chat' | 'board'>('chat');

  /* ── Warden ───────────────────────────────────────────────────────── */

  const [chat, setChat] = React.useState<WardenChat | null>(null);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [chatError, setChatError] = React.useState<string | null>(null);
  const [approve, setApprove] = React.useState<WardenProposal | null>(null);
  const [decline, setDecline] = React.useState<WardenProposal | null>(null);
  const [pauseOpen, setPauseOpen] = React.useState(false);
  const [decisionBusy, setDecisionBusy] = React.useState(false);
  const [decisionError, setDecisionError] = React.useState<string | null>(null);
  const [decisionReason, setDecisionReason] = React.useState('');

  /* ── Settings ─────────────────────────────────────────────────────── */

  const [edit, setEdit] = React.useState<SettingEdit | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [editBusy, setEditBusy] = React.useState(false);
  // ⚠️ THE DIALOG KEEPS ITS OWN FAILURE. Routing a 400 from the settings PATCH
  // into the page-level error replaced the entire board — gates, channels,
  // health, trust and safety — with one red panel, and took the half-typed
  // reason with it. The dialog is where the operator is looking.
  const [editError, setEditError] = React.useState<string | null>(null);

  const loadChat = React.useCallback(async () => {
    try {
      setChat(await fetchWardenChat());
      setChatError(null);
    } catch (err) {
      // ⚠️ THE CHAT FAILS ALONE. The board renders around this card; a 503 or
      // a 404 from a route an older API build does not have must not blank
      // the gates and the vitals over a chat panel.
      setChat(wardenAbsent('Warden did not answer this browser. The board beside this card is what this process can see on its own.'));
      setChatError(describeFailure(err));
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      // Each of these is a separate legacy page; failing one must not blank
      // the others, so the optional ones swallow their own errors.
      const [b, s] = await Promise.all([
        deskFetch<SiteBoard>('/admin/desk/site/board'),
        fetchDeskSettings(),
      ]);
      setBoard(b);
      setSettings(s);
      setLoadedAt(new Date().toISOString());
      setError(null);
      // Shaped for the panel — masked phone, alert types as items. A failure
      // costs the shaping and nothing else; see fallbackSettingRows.
      void fetchWardenSettings().then(setWardenRows).catch(() => setWardenRows([]));
      void fetchAlerts().then(setAlerts).catch(() => setAlerts([]));
      void fetchCredits().then(setCredits).catch(() => setCredits([]));
      // The floors the balances are judged against. A failure here costs the
      // "low" tag and nothing else, so the balances still render.
      void fetchCreditThresholds().then(setThresholds).catch(() => setThresholds([]));
    } catch (err) {
      setError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
    void loadChat();
  }, [load, loadChat]);

  /**
   * `/admin/desk/site?send=1&channel=sms&segment=dormant` — the entrance the
   * legacy /admin/broadcast page had. `?whatsapp=<threadId>` is the same idea
   * for the WhatsApp reply drawer, which had no entrance at all.
   *
   * ⚠️ window.location, NOT useSearchParams. This is a client page; reading
   * the hook here would drag a Suspense boundary around the whole board for a
   * value that only matters once, on mount. The params are stripped straight
   * afterwards so a refresh does not re-open a surface nobody asked for — and
   * so a thread id does not sit in the address bar to be pasted onward.
   */
  React.useEffect(() => {
    const preset = parseSendPreset(window.location.search);
    const thread = parseWhatsappThreadId(window.location.search);
    if (!preset.open && !thread) return;
    if (preset.open) {
      setSendPreset(preset);
      setSendOpen(true);
    }
    if (thread) setWhatsappThread(thread);
    const search = stripWhatsappParam(stripSendPreset(window.location.search));
    window.history.replaceState({}, '', window.location.pathname + search + window.location.hash);
  }, []);

  const whatsappOn = settings?.find((s) => s.key === 'whatsapp_enabled')?.currentValue === 'true';
  const redGates = board?.gates.filter((g) => g.tone === 'bad').length ?? 0;
  const settingRows = wardenRows?.length ? wardenRows : fallbackSettingRows(settings ?? []);

  const openEdit = React.useCallback(
    (next: SettingEdit) => {
      setEdit(next);
      setReason('');
      setEditError(null);
      // ⚠️ PREFILLED FROM THE RAW SETTING, NOT FROM WHAT IS ON SCREEN. The
      // board shows "+27 82 ··· ··67"; saving that back would write the mask
      // into the column and silence the alert path.
      setEditValue(settings?.find((s) => s.key === next.key)?.currentValue ?? '');
    },
    [settings],
  );

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

  const chatCard = (
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
  );

  const boardCards = board ? (
    <>
      <ServerVitals vitals={board.vitals} at={loadedAt} phone={phone} />
      <OutboundChannels channels={board.channels} />
      <ServicesAndJobs />
      <ConfigGates gates={board.gates} />
      <SettingsPanel rows={settingRows} onEdit={openEdit} shaped={Boolean(wardenRows?.length)} />
      <WhatsappHealth enabled={Boolean(whatsappOn)} phone={phone} />
    </>
  ) : null;

  const cutoverRegion = (
    <CutoverRegion
      alerts={alerts}
      alertError={alertError}
      onResolve={(id) => {
        setAlertError(null);
        void resolveAlert(id)
          .then(() => setAlerts((xs) => xs.filter((x) => x.id !== id)))
          .catch((e) => setAlertError(describeFailure(e)));
      }}
      credits={credits}
      thresholds={thresholds}
      onSend={() => setSendOpen(true)}
      onAudit={() => {
        setAuditOpen(true);
        if (!audit) void fetchAudit().then((a) => setAudit(a.rows)).catch(() => setAudit([]));
      }}
      onAdmins={() => {
        setAdminsOpen(true);
        if (!admins) void fetchAdmins().then(setAdmins).catch(() => setAdmins([]));
      }}
    />
  );

  return (
    <DeskShell
      active="site"
      title="Site"
      sub={
        chat?.present
          ? `Warden active · checked ${clock(chat.lastCheckAt)}`
          : redGates
            ? `${redGates} red ${redGates === 1 ? 'gate' : 'gates'} · Warden not deployed`
            : 'Warden not deployed'
      }
      site={{ tone: redGates ? 'bad' : 'ok', word: redGates ? 'Attention' : 'Healthy' }}
    >
      {phone ? (
        <>
          {/* Chat | Board. Two lenses on one surface, not two pages: the
              board is the evidence for what the chat is saying, and an
              operator flipping between them keeps the same scroll. */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['chat', 'board'] as const).map((k) => (
              <Chip
                key={k}
                active={lens === k}
                onClick={() => setLens(k)}
                style={{ flex: 1, height: 36, borderRadius: 'var(--dk-radius-control)', justifyContent: 'center' }}
              >
                {k === 'chat' ? 'Chat' : 'Board'}
              </Chip>
            ))}
          </div>
          <WardenStatusRow
            chat={chat}
            compact
            onPause={() => {
              setDecisionError(null);
              setPauseOpen(true);
            }}
          />
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>Site</span>
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>the site watches itself</span>
          <span style={{ flex: 1 }} />
          <WardenStatusRow
            chat={chat}
            onPause={() => {
              setDecisionError(null);
              setPauseOpen(true);
            }}
          />
        </div>
      )}

      {error ? (
        <FailedRegion title="Couldn't load the board" detail={error} onRetry={() => void load()} />
      ) : !board ? (
        <SkeletonPile count={2} />
      ) : phone ? (
        lens === 'chat' ? (
          chatCard
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {boardCards}
            {cutoverRegion}
          </div>
        )
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 440px',
              gap: 16,
              alignItems: 'start',
            }}
          >
            {chatCard}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              {boardCards}
            </div>
          </div>
          {cutoverRegion}
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
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            It runs inside Warden&rsquo;s own safe list — this browser and this API never hold the
            shell. The audit row names the command after it has run, because it cannot name it
            before. There is no undo.
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

      {/* ⚠️ PAUSE IS AN INSTRUCTION, NOT A SWITCH, AND THE CONFIRM SAYS SO.
          There is no pause route on the API. This posts a standing
          instruction on the thread and the tag does not change, because
          nothing on this side can confirm the daemon obeyed. */}
      {pauseOpen ? (
        <DialogFrame
          label="Warden · instruction"
          title="Pause Warden"
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
                  setDecisionError(null);
                  void sendWardenChat(PAUSE_INSTRUCTION)
                    .then(() => loadChat())
                    .then(() => setPauseOpen(false))
                    .catch((e) => setDecisionError(describeFailure(e)))
                    .finally(() => setDecisionBusy(false));
                }}
              >
                Send the instruction
              </Button>
            </>
          }
        >
          <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>
            This posts a standing instruction on the thread:
          </span>
          <Pre tone="inset">{PAUSE_INSTRUCTION}</Pre>
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            There is no pause switch. Warden takes instructions in plain language and decides what
            to do with them; the tag above will not read &ldquo;paused&rdquo; until Warden itself
            says it has stopped. To stop it outright, stop the daemon on the box.
          </span>
          {decisionError ? (
            <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)', whiteSpace: 'pre-wrap' }}>
              {`Nothing was sent.\n${decisionError}`}
            </span>
          ) : null}
        </DialogFrame>
      ) : null}

      {/* ⚠️ EVERY SETTING WRITE CONFIRMS AND TAKES A REASON. These four are
          the only flags an operator can change from a browser, so they are
          the only flags whose change must be answerable for afterwards.

          🚨 THE REASON FLOOR IS THE SERVER'S. whatsapp_enabled is a danger
          flag, so AdminSettingsService demands fifteen characters and refuses
          anything shorter with a 400. An earlier dialog armed at five, closed
          itself before the request landed, and posted the refusal to the
          page-level error — so the one control that exists to silence a
          channel in a hurry appeared to work, did nothing, and took the whole
          board down with it. */}
      {edit ? (
        <SettingDialog
          edit={edit}
          value={editValue}
          onValue={setEditValue}
          reason={reason}
          onReason={setReason}
          busy={editBusy}
          error={editError}
          onClose={() => {
            if (editBusy) return;
            setEdit(null);
            setEditError(null);
          }}
          onSubmit={() => {
            const min = settingReasonMin(edit.key);
            const value = edit.mode === 'toggle' ? String(edit.next) : editValue.trim();
            if (reason.trim().length < min || editBusy) return;
            setEditBusy(true);
            setEditError(null);
            void updateSetting(edit.key, value, reason.trim())
              .then(() =>
                Promise.all([
                  fetchDeskSettings().then(setSettings),
                  fetchWardenSettings().then(setWardenRows).catch(() => undefined),
                ]),
              )
              .then(() => {
                setEdit(null);
                setReason('');
              })
              // ⚠️ THE DIALOG STAYS OPEN AND KEEPS THE TYPED REASON. The
              // server's own words are the only useful thing on screen, and
              // the value has NOT moved.
              .catch((e) => setEditError(describeFailure(e)))
              .finally(() => setEditBusy(false));
          }}
        />
      ) : null}

      <Drawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        typeLabel="Audit trail"
        title="Who did what"
        meta="Every admin action, newest first. Read-only by design."
        note="This is the record a money action is answered for with. It is never edited or pruned from here."
      >
        <Section label="Recent" last>
          {!audit ? (
            <Quiet>Loading…</Quiet>
          ) : audit.length === 0 ? (
            <Quiet>No audit rows.</Quiet>
          ) : (
            audit.map((r, i) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  padding: '10px 0',
                  borderBottom: i === audit.length - 1 ? undefined : '1px solid var(--dk-line)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="dk-mono" style={{ fontSize: 11.5, color: 'var(--dk-ink)' }}>
                    {r.action}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                    {stamp(r.createdAt)}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
                  {r.adminUser?.email ?? 'unknown admin'}
                  {r.resourceType ? ` · ${r.resourceType}` : ''}
                  {r.resourceId ? ` ${r.resourceId.slice(-8)}` : ''}
                </span>
                {r.reason ? (
                  <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                    “{r.reason}”
                  </span>
                ) : null}
              </div>
            ))
          )}
        </Section>
      </Drawer>

      {/* 🚨 THE THREE WRITES THE CUTOVER COST. This roster listed accounts and
          carried no control on any row, so removing a compromised
          administrator meant a database write. AdminsDrawer adds create,
          change-role and switch-off, all against rules the SERVER owns. */}
      <AdminsDrawer
        open={adminsOpen}
        onClose={() => setAdminsOpen(false)}
        admins={admins}
        onChanged={() => {
          void fetchAdmins().then(setAdmins).catch(() => setAdmins([]));
        }}
      />

      {/* /admin/broadcast and /admin/campaigns, merged: a key and the blast it
          attributes are one job. Everything dangerous about it lives inside. */}
      <SendDrawer
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        initialChannel={sendPreset.channel}
        initialSegment={sendPreset.segment}
      />

      {/* 🚨 THE FIRST THING THAT EVER OPENS THIS DRAWER. It was built against
          /admin/desk/whatsapp/* and mounted nowhere, while `whatsapp_reply`
          sat in the DeskCardType union with nothing emitting it — a feature
          unreachable from both ends at once, which is this project's
          signature failure. `?whatsapp=<threadId>` is the door. The endpoints
          behind it do not exist yet, so it renders its own FailedRegion with
          the server's words rather than a plausible thread. */}
      <WhatsappDrawer
        open={whatsappThread !== null}
        onClose={() => setWhatsappThread(null)}
        threadId={whatsappThread ?? ''}
      />
    </DeskShell>
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * The title row's right-hand end
 * ══════════════════════════════════════════════════════════════════════ */

function WardenStatusRow({
  chat,
  compact = false,
  onPause,
}: {
  chat: WardenChat | null;
  compact?: boolean;
  onPause: () => void;
}) {
  const present = chat?.present === true;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {/* ⚠️ NOT GREEN UNTIL A DAEMON ANSWERS. `present` is asserted by the
          server or it is false; "Warden active" over an absent daemon is the
          one badge on this page that would be read as an all-clear. */}
      {chat === null ? (
        <Tag kind="neutral" icon={null}>
          reading…
        </Tag>
      ) : present ? (
        <Tag kind="ok" icon={IconBolt}>
          {`Warden active · checked ${clock(chat.lastCheckAt)}`}
        </Tag>
      ) : (
        <Tag kind="warn" icon={IconAlert}>
          Warden not deployed
        </Tag>
      )}
      {compact ? <span style={{ flex: 1 }} /> : null}
      {/* ⚠️ GATED, NOT PLAIN-DISABLED, per the kit's own rule: a control with
          a reason states the reason on its face and keeps its padlock. A grey
          "Pause Warden" that does nothing sends the operator looking for the
          bug in themselves. */}
      <Button
        variant={present ? 'secondary' : 'gated'}
        icon={present ? IconPause : undefined}
        disabled={!present}
        onClick={onPause}
      >
        {present ? (compact ? 'Pause' : 'Pause Warden') : compact ? 'No Warden' : 'No Warden to pause'}
      </Button>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * The chat
 * ══════════════════════════════════════════════════════════════════════ */

function WardenChatCard({
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
      <Label>Warden chat</Label>
      {chat === null ? null : present ? (
        <Tag kind="ok" icon={IconCheck}>{`active · checked ${clock(chat.lastCheckAt)}`}</Tag>
      ) : (
        <Tag kind="warn" icon={IconAlert}>
          not deployed
        </Tag>
      )}
      <span style={{ flex: 1 }} />
      {phone ? null : (
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
          Findings, fixes and proposals arrive here. Reply in plain language.
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
      {/* ⚠️ THE ABSENT STATE IS THE THREAD, NOT A BADGE ON AN EMPTY ONE.
          With no daemon there are no messages, and an empty scroll under a
          header reads as a calm morning. The note says what is actually
          true. */}
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
            {chat.note ??
              'Warden is not deployed. Nothing is watching the box automatically yet.'}
          </span>
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-warn)' }}>
            The gates, channels and vitals beside this card are read live on every load — current,
            but only while you are looking. Disk, memory, SSL and error rates need the daemon and
            show an em dash until it exists.
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
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {header}
        {thread}
        {/* Pinned above the tab bar, exactly where the thumb already is. The
            78 is BottomTabs' own height; the inset is added on top rather
            than baked in, so it is right on a notched phone and free on one
            without.

            ⚠️ z-index 50 — above the Desk's own bottom tabs (40) so a long
            thread cannot scroll out from under it, below the 55 the installed
            shell's tab bar takes, and well below the 60 every blocking overlay
            clears, so a drawer or a confirm always covers it. */}
        <div style={{ height: 62 }} />
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
            zIndex: 50,
            padding: '10px 14px',
            background: 'var(--dk-ground)',
            borderTop: '1px solid var(--dk-line)',
          }}
        >
          {composer}
        </div>
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
        // The composer is pinned to the bottom of the card, so the card takes
        // the viewport and the thread scrolls inside it. A composer that
        // scrolls away is one the operator has to hunt for mid-incident.
        height: 'calc(100vh - 190px)',
        minHeight: 480,
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
 * ⚠️ A PENDING PROPOSAL NO MESSAGE MENTIONS IS STILL RENDERED. The daemon may
 * raise one without a covering message, and a proposal that reaches this
 * browser and cannot be approved or declined is a decision nobody can make —
 * which is the same unreachable-feature failure, one layer in. Nothing is
 * invented: the card is built from the proposal the server actually sent.
 */
function Thread({
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

/* ══════════════════════════════════════════════════════════════════════
 * The board
 * ══════════════════════════════════════════════════════════════════════ */

function ServerVitals({
  vitals,
  at,
  phone,
}: {
  vitals: VitalRow[];
  at: string | null;
  phone: boolean;
}) {
  const known = vitals.filter((v) => v.known).length;
  return (
    <Card
      label="Server vitals"
      hint={`${known} of ${vitals.length} measured · ${at ? clock(at) : '—'}`}
      footer={
        known === vitals.length
          ? undefined
          : 'Disk, SSL expiry, nginx error rates and backup freshness live on the box, not in this process. They read as an em dash until Warden is on it — a tile showing 0% for a disk nobody measured is worse than one showing nothing.'
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {vitals.map((v) => (
          <Vital
            key={v.key}
            label={v.label}
            value={v.value}
            tone={v.known ? v.tone : 'unknown'}
            sub={v.known ? undefined : 'needs Warden on the box'}
          />
        ))}
      </div>
    </Card>
  );
}

function OutboundChannels({ channels }: { channels: ChannelRow[] }) {
  return (
    <Card label="Outbound channels">
      {channels.map((c, i) => {
        const Icon = CHANNEL_ICON[c.key as keyof typeof CHANNEL_ICON] ?? IconMail;
        return (
          <Row key={c.key} last={i === channels.length - 1}>
            <Icon size={14} style={{ color: 'var(--dk-ink-3)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{c.label}</span>
            <Tag
              kind={c.tone === 'ok' ? 'ok' : c.tone === 'warn' ? 'warn' : 'neutral'}
              icon={c.tone === 'ok' ? null : undefined}
            >
              {c.state}
            </Tag>
            <span style={{ flex: 1 }} />
            <span
              style={{
                width: 128,
                textAlign: 'right',
                fontSize: 11.5,
                color: 'var(--dk-ink-3)',
              }}
            >
              {c.detail}
            </span>
          </Row>
        );
      })}
    </Card>
  );
}

/**
 * Services & jobs — the cron roster.
 *
 * ⚠️ NO "FIXED BY WARDEN" ANNOTATIONS, AND THAT IS NOT AN OVERSIGHT. The
 * design notes a bolt beside a job Warden repaired; nothing on the wire says
 * which job that was. GET /admin/health/crons returns a name, a schedule, a
 * last-run stamp and a status, and inventing the attribution would put
 * Warden's name on a recovery it may not have performed.
 *
 * It keeps its own state and its own failure: a stale reading left on screen
 * during an incident is more use than an empty card.
 */
function ServicesAndJobs() {
  const [crons, setCrons] = React.useState<CronRow[] | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [all, setAll] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setCrons(await fetchCrons());
      setFailure(null);
    } catch (err) {
      setFailure(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const troubled = crons ? crons.filter((c) => c.status !== 'ok') : [];
  const stale = troubled.filter((c) => c.status === 'stale').length;
  // Troubled first, then the rest — during an incident nobody should scroll.
  const ordered = crons ? [...troubled, ...crons.filter((c) => c.status === 'ok')] : [];
  const shown = all ? ordered : ordered.slice(0, 7);

  return (
    <Card
      label="Services & jobs"
      hint={
        crons
          ? `${crons.length} on the roster · ${stale ? `${stale} stale` : 'none stale'} · showing ${shown.length}`
          : 'reading…'
      }
      footer="Stale means three times its own cadence has passed since it last finished. Never can be honest on a weekly job and a young box, which is why it is amber and not red."
    >
      {failure ? (
        <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)', whiteSpace: 'pre-wrap' }}>
          {failure}
        </span>
      ) : null}
      {!crons ? (
        <Quiet>Reading…</Quiet>
      ) : shown.length === 0 ? (
        <Quiet>No jobs on the roster.</Quiet>
      ) : (
        shown.map((c, i) => {
          const Glyph = c.status === 'ok' ? IconCheck : c.status === 'stale' ? IconAlert : IconClock;
          const ink =
            c.status === 'ok' ? 'var(--dk-ok)' : c.status === 'stale' ? 'var(--dk-bad)' : 'var(--dk-warn)';
          return (
            <Row key={c.name} last={i === shown.length - 1}>
              <Glyph size={14} style={{ color: ink }} />
              <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink)', minWidth: 0 }}>
                {c.name}
              </span>
              {c.status === 'ok' ? null : <Tag kind={c.status === 'stale' ? 'bad' : 'warn'}>{c.status}</Tag>}
              <span style={{ flex: 1 }} />
              <span className="dk-mono" style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                {clock(c.lastRunAt)}
              </span>
            </Row>
          );
        })
      )}
      {crons && ordered.length > 7 ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
          <Button variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? 'Show the first 7' : `Show all ${ordered.length}`}
          </Button>
        </span>
      ) : null}
    </Card>
  );
}

function ConfigGates({ gates }: { gates: ConfigGate[] }) {
  return (
    <Card
      label="Config gates"
      headerTag={
        <Tag kind="neutral" icon={IconLock}>
          read-only
        </Tag>
      }
      footer="Truth, not controls. Each of these changes in code, with a commit and a reason. Red ones deal a Desk card daily and can never be sunk."
    >
      {gates.map((g, i) => (
        <div
          key={g.key}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '9px 0',
            borderBottom: i === gates.length - 1 ? undefined : '1px solid var(--dk-line)',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{g.label}</span>
            <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
              {g.key}
            </span>
            {g.note ? (
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>{g.note}</span>
            ) : null}
          </span>
          <Tag
            kind={g.tone === 'bad' ? 'bad' : g.tone === 'warn' ? 'warn' : g.tone === 'ok' ? 'ok' : 'neutral'}
            icon={g.tone === 'bad' ? IconLock : undefined}
          >
            {g.value}
          </Tag>
        </div>
      ))}
    </Card>
  );
}

interface SettingEdit {
  key: string;
  label: string;
  mode: 'text' | 'toggle';
  /** Only for `toggle` — the value the switch is being moved to. */
  next?: boolean;
}

/**
 * Settings · the only four.
 *
 * ⚠️ THE VALUES ARE RENDERED BY THE SERVER, THE WRITES GO THROUGH THE ONE
 * WRITE PATH. GET /admin/warden/settings masks the alert phone before it
 * leaves the box — the board is screenshotted into support threads — and
 * PATCH /admin/settings keeps its type validation, its danger-flag reason
 * minimum and its audit row. Two writers would be two sets of rules and the
 * drifted one would be the one nobody reads.
 */
function SettingsPanel({
  rows,
  onEdit,
  shaped,
}: {
  rows: WardenSettingRow[];
  onEdit: (e: SettingEdit) => void;
  /** True when the server shaped these rows. False means fallbackSettingRows. */
  shaped: boolean;
}) {
  return (
    <Card
      label="Settings · the only four"
      headerTag={
        shaped ? (
          <Tag kind="ok" icon={IconCheck}>
            saved
          </Tag>
        ) : (
          <Tag kind="warn">unshaped</Tag>
        )
      }
      footer={
        shaped
          ? 'Every other flag changes in code. These four are the ones a deploy is too slow for, and every change here carries a reason into the audit trail.'
          : 'GET /admin/warden/settings did not answer, so these are the raw stored values rather than the shaped ones — the alert phone is reported as set or not set instead of being masked, because masking is the server’s job and this fallback does not take it over. Writes still go through the same audited PATCH.'
      }
    >
      {rows.length === 0 ? (
        <Quiet>No settings came back.</Quiet>
      ) : (
        rows.map((r, i) => (
          <div
            key={r.key}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 0',
              borderBottom: i === rows.length - 1 ? undefined : '1px solid var(--dk-line)',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{r.label}</span>
              {r.kind === 'checkboxes' ? (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
                  {/* ⚠️ EVERY BOX IS TICKED, AND NONE OF THEM TOGGLES. This
                      list IS the stored value: there is no registry of
                      alertable types in the codebase, so an unticked box
                      would be an option invented for the UI, and a tick that
                      silently removed a type would be a write with no reason
                      on it. The pencil edits the list, where the reason is
                      asked for. */}
                  {(r.items ?? []).length === 0 ? (
                    <Quiet>none — nothing is texted</Quiet>
                  ) : (
                    (r.items ?? []).map((it) => <ReadOnlyTick key={it.value} label={it.label} />)
                  )}
                </span>
              ) : null}
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                {r.note}
              </span>
            </span>

            {r.kind === 'checkboxes' ? null : (
              <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)', textAlign: 'right' }}>
                {r.display || '—'}
              </span>
            )}

            {r.kind === 'toggle' ? (
              <Toggle
                checked={r.raw === 'true'}
                label={r.label}
                disabled={!r.editable}
                onChange={(next) => onEdit({ key: r.key, label: r.label, mode: 'toggle', next })}
              />
            ) : r.editable ? (
              <Button
                variant="ghost"
                icon={IconPencil}
                aria-label={`Edit ${r.label}`}
                onClick={() => onEdit({ key: r.key, label: r.label, mode: 'text' })}
              >
                Edit
              </Button>
            ) : (
              <Tag kind="neutral" icon={null}>
                read-only
              </Tag>
            )}
          </div>
        ))
      )}
    </Card>
  );
}

/** A ticked box that is a read-out, not a control. See the note above. */
function ReadOnlyTick({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--dk-ink-2)' }}>
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          background: 'var(--dk-ink)',
          color: 'var(--dk-ground)',
        }}
      >
        <IconCheck size={12} />
      </span>
      <span className="dk-mono" style={{ fontSize: 11.5 }}>
        {label}
      </span>
    </span>
  );
}

function SettingDialog({
  edit,
  value,
  onValue,
  reason,
  onReason,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  edit: SettingEdit;
  value: string;
  onValue: (v: string) => void;
  reason: string;
  onReason: (v: string) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const min = settingReasonMin(edit.key);
  const danger = edit.key === 'whatsapp_enabled';
  const armed = reason.trim().length >= min && !busy;
  const title =
    edit.mode === 'toggle'
      ? `${edit.next ? 'Switch on' : 'Switch off'} ${edit.label.toLowerCase()}`
      : `Change ${edit.label.toLowerCase()}`;

  return (
    <DialogFrame
      label="Setting · confirm"
      title={title}
      onClose={onClose}
      footer={
        <>
          {!armed && !busy ? (
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.4, color: 'var(--dk-ink-3)' }}>
              {`A reason of at least ${min} characters arms this — the server refuses a shorter one.`}
            </span>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger && edit.next === false ? 'danger' : 'primary'}
            disabled={!armed}
            loading={busy}
            onClick={onSubmit}
          >
            {edit.mode === 'toggle' ? (edit.next ? 'Switch on' : 'Switch off') : 'Save'}
          </Button>
        </>
      }
    >
      <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>
        {settingConsequence(edit)}
      </span>
      {edit.mode === 'text' ? (
        <Input
          placeholder={edit.key === 'ops_alert_phone' ? '+27 82 000 0000' : 'BACKUP_FAILED, PAYOUT_FAILED'}
          value={value}
          onChange={(e) => onValue(e.target.value)}
        />
      ) : null}
      {error ? (
        <span
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--dk-bad)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {`Nothing moved.\n${error}`}
        </span>
      ) : null}
      <Input
        placeholder={`Why? At least ${min} characters — goes in the audit trail`}
        value={reason}
        onChange={(e) => onReason(e.target.value)}
      />
    </DialogFrame>
  );
}

/** What actually happens when this one is saved, in the operator's words. */
function settingConsequence(edit: SettingEdit): string {
  switch (edit.key) {
    case 'whatsapp_enabled':
      return edit.next
        ? 'Templates on the approved wave will be able to send. Nothing sends until a provider is configured.'
        : 'No WhatsApp template will send from this moment, to anyone, until it is switched back on.';
    case 'ops_alert_quiet_hours':
      return edit.next
        ? 'Alerts raised between 22:00 and 06:00 SAST will be held until morning. Every watched type is held, with no exception — the window itself is fixed in code.'
        : 'Every watched alert will be texted the moment it is raised, at any hour of the night.';
    case 'ops_alert_phone':
      return 'This is the number the ops-alert SMS goes to. Empty means nothing is ever texted, to anyone.';
    case 'ops_alert_types':
      return 'A comma-separated list of AdminAlert types. Only the types on this list wake the phone; a type spelled wrong here is a type that never alerts.';
    default:
      return 'This changes a flag the running system reads.';
  }
}

/**
 * WhatsApp channel health.
 *
 * 🚨 EVERY VITAL HERE IS AN EM DASH AND WILL BE UNTIL A WABA EXISTS. There is
 * no provider, no phone number, no template registry and no send path — the
 * credentials are the operator's to obtain and this file invents none of
 * them. The artboard's own figures ("14 registered · 0 approved") are mock
 * numbers; printing them would be a quality score for a number that has never
 * sent a message. The card states its gate on its face instead.
 */
function WhatsappHealth({ enabled, phone }: { enabled: boolean; phone: boolean }) {
  return (
    <Card
      label="WhatsApp channel health"
      headerTag={
        <Tag kind={enabled ? 'warn' : 'neutral'} icon={enabled ? undefined : IconLock}>
          {enabled ? 'switched on · no provider' : 'gated · whatsapp_enabled off'}
        </Tag>
      }
      footer="States its gate on its face. A quality drop deals a Warden card once the number is live. Nothing here can be measured until a WABA, a phone number and a token are configured on the server."
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        <Vital label="Quality" value="—" tone="unknown" sub="no WABA yet" />
        <Vital label="Block rate" value="—" tone="unknown" sub="no sends" />
        <Vital label="Read rate" value="—" tone="unknown" sub="no sends" />
      </div>
      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>Templates</span>
        <span style={{ flex: 1 }} />
        <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
          — · no registry
        </span>
      </Row>
      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>Wave</span>
        <span style={{ flex: 1 }} />
        <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
          — · no provider
        </span>
      </Row>
      <Row last>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>Consecutive failures</span>
        <span style={{ flex: 1 }} />
        <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
          — · nothing has sent
        </span>
      </Row>
    </Card>
  );
}

/**
 * The four settings, shaped locally when GET /admin/warden/settings did not
 * answer — an older API build, or a daemon-shaped route that 404s.
 *
 * ⚠️ THE PHONE IS STILL NOT PRINTED. The masking is the server's job and this
 * fallback does not take it over; it reports whether a number is set and
 * nothing more. A fallback that leaks the value the primary path masks is a
 * fallback that undoes the reason for masking.
 */
function fallbackSettingRows(settings: SettingFlag[]): WardenSettingRow[] {
  return settings.map((s) => ({
    key: s.key,
    label: s.label,
    kind: s.key === 'ops_alert_phone' ? 'phone' : s.type === 'boolean' ? 'toggle' : 'checkboxes',
    display: s.key === 'ops_alert_phone' ? (s.currentValue.trim() ? 'set' : 'not set') : s.currentValue || '—',
    raw: s.key === 'ops_alert_phone' ? undefined : s.currentValue,
    items:
      s.key === 'ops_alert_phone' || s.type === 'boolean'
        ? undefined
        : s.currentValue
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => ({ value: t, label: t, checked: true })),
    editable: true,
    note: s.hint,
  }));
}

/* ══════════════════════════════════════════════════════════════════════
 * The cutover surfaces — below the drawn board, not inside it
 *
 * ⚠️ THESE ARE NOT DECORATION AND THEY MAY NOT BE DELETED YET. Five legacy
 * pages are marked PARTIAL in lib/desk-cutover.ts precisely because of what
 * is still missing here — the alert inbox is the only place ~20 alert types
 * surface at all, and the admin roster is the only list of who can get in.
 * They sit under their own heading rather than inside the Warden board, so
 * the drawn surface stays the drawn surface and nothing quietly disappears.
 * ══════════════════════════════════════════════════════════════════════ */

function CutoverRegion({
  alerts,
  alertError,
  onResolve,
  credits,
  thresholds,
  onSend,
  onAudit,
  onAdmins,
}: {
  alerts: AdminAlertRow[];
  alertError: string | null;
  onResolve: (id: string) => void;
  credits: CreditSnapshot[];
  thresholds: CreditThreshold[];
  onSend: () => void;
  onAudit: () => void;
  onAdmins: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Label>Still on this board</Label>
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
          five legacy pages that have nowhere else to live yet
        </span>
        <span style={{ flex: 1 }} />
        {/* ⚠️ THE ONLY CONTROL ON THIS PAGE THAT LEAVES THE BUILDING. The
            outbound channels above it are a read-out; this one writes to
            people's phones. The weight belongs in the drawer's confirm, not
            in a red button on a dashboard. */}
        <Button variant="secondary" icon={IconSend} onClick={onSend}>
          Send…
        </Button>
        <Button variant="secondary" onClick={onAudit}>
          Audit trail
        </Button>
        <Button variant="secondary" icon={IconUser} onClick={onAdmins}>
          Who can get in
        </Button>
      </div>

      {/* ⚠️ THE HINT SAYS WHAT IT READ, NOT WHAT EXISTS. The fetch asks for
          fifty and the card shows eight, so "50 unresolved" would be a floor
          wearing the clothes of a total. */}
      <Card
        label="Alerts"
        hint={
          alerts.length === 0
            ? 'none unresolved'
            : alerts.length >= 50
              ? 'newest 8 of at least 50 unresolved'
              : `newest ${Math.min(alerts.length, 8)} of ${alerts.length} unresolved`
        }
        footer="Warden replaces this inbox once it is deployed. Until then it is the only place these surface — but it neither pages nor filters, so a long tail is only visible on the legacy alerts page."
      >
        {alertError ? (
          <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)' }}>
            {`That alert is still unresolved. ${alertError}`}
          </span>
        ) : null}
        {alerts.length === 0 ? (
          <Quiet>Nothing unresolved.</Quiet>
        ) : (
          alerts.slice(0, 8).map((a, i) => (
            <Row key={a.id} last={i === Math.min(alerts.length, 8) - 1}>
              <Tag kind={a.urgent ? 'bad' : 'neutral'} icon={a.urgent ? IconAlert : null}>
                {a.type}
              </Tag>
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)', minWidth: 0, flex: 1 }}>
                {a.context ?? '—'}
              </span>
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                {stamp(a.createdAt)}
              </span>
              <Button variant="ghost" onClick={() => onResolve(a.id)}>
                Resolve
              </Button>
            </Row>
          ))
        )}
      </Card>

      {credits.length ? (
        <Card
          label="Credits"
          hint="vendor balances"
          footer="Low means at or under the vendor warn floor. A vendor with no floor, or with the pair encoding a spend ceiling rather than a floor, is shown unflagged rather than flagged the wrong way. No balance API is a post-paid or key-less vendor, not a fault — colouring those amber is how amber stops meaning anything."
        >
          {credits.map((c, i) => {
            const low = creditIsLow(c, thresholds.find((t) => t.service === c.service));
            const unreadable = creditUnreadable(c);
            return (
              <Row key={c.service} last={i === credits.length - 1}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{c.service}</span>
                <span style={{ flex: 1 }} />
                {unreadable ? (
                  <Tag kind={unreadable === 'failed' ? 'warn' : 'neutral'} icon={null}>
                    {unreadable === 'failed' ? 'could not read' : 'no balance API'}
                  </Tag>
                ) : (
                  <>
                    <span className="dk-mono" style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>
                      {c.balance === null
                        ? '—'
                        : `${c.balance.toLocaleString('en-ZA')}${c.unit ? ` ${c.unit}` : ''}`}
                    </span>
                    {low ? <Tag kind="warn">low</Tag> : null}
                  </>
                )}
              </Row>
            );
          })}
        </Card>
      ) : null}

      <ProbesAndQueues />
      <TrustSafety />
    </div>
  );
}

function Card({
  label,
  hint,
  headerTag,
  footer,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  headerTag?: React.ReactNode;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Label>{label}</Label>
        {headerTag}
        <span style={{ flex: 1 }} />
        {hint ? <span style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>{hint}</span> : null}
      </span>
      {children}
      {footer ? (
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45, marginTop: 2 }}>
          {footer}
        </span>
      ) : null}
    </div>
  );
}

function Row({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 0',
        borderBottom: last ? undefined : '1px solid var(--dk-line)',
      }}
    >
      {children}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>{children}</span>;
}

/** The chat's code block, reused inside the confirm dialogs. */
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
        wordBreak: 'break-word',
      }}
    >
      {children}
    </pre>
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * SERVICE PROBES AND QUEUE DEPTHS — the rest of the legacy /admin/health.
 *
 * The cron roster moved up onto the board as "Services & jobs"; these two
 * cards did not, because the artboard has no place for them and they are
 * still the only reading of third-party reachability and work waiting.
 *
 * ⚠️ THESE ARE NOT SERVER VITALS AND MUST NOT BE DRESSED AS THEM. CPU, memory
 * and disk still need Warden on the box and the vitals card still says so.
 * Everything here has a real source this process can reach today: reachability
 * probes and four Prisma counts.
 * ══════════════════════════════════════════════════════════════════════ */

/** Worst first. During an incident the operator should not have to scroll. */
const SERVICE_RANK: Record<ServiceProbe['status'], number> = {
  down: 0,
  degraded: 1,
  unknown: 2,
  'not-configured': 3,
  up: 4,
};

const SERVICE_TAG: Record<ServiceProbe['status'], 'ok' | 'warn' | 'bad' | 'neutral'> = {
  up: 'ok',
  degraded: 'warn',
  down: 'bad',
  unknown: 'neutral',
  'not-configured': 'neutral',
};

/** Re-probe cadence. Matches the legacy page and sits under every cron. */
const HEALTH_POLL_MS = 60_000;

function ProbesAndQueues() {
  const [services, setServices] = React.useState<ServiceProbe[] | null>(null);
  const [queues, setQueues] = React.useState<QueueRow[] | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [probedAt, setProbedAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Only here to re-render the "probed 40s ago" line between sweeps.
  const [, setTick] = React.useState(0);
  // Each probe is bounded at 5s server-side, so a slow sweep must not have a
  // second one pile up behind it.
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const [s, q] = await Promise.all([fetchServices(), fetchQueues()]);
      setServices(s);
      setQueues(q);
      setProbedAt(new Date().toISOString());
      setFailure(null);
    } catch (err) {
      // ⚠️ THE LAST GOOD READING STAYS ON SCREEN. Blanking the cards because
      // one refresh 500d throws away the only picture of the incident, at the
      // moment it is most wanted.
      setFailure(describeFailure(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), HEALTH_POLL_MS);
    const clockTick = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(clockTick);
    };
  }, [load]);

  const ranked = services
    ? [...services].sort(
        (a, b) => SERVICE_RANK[a.status] - SERVICE_RANK[b.status] || a.name.localeCompare(b.name),
      )
    : [];
  const down = ranked.filter((s) => s.status === 'down').length;
  const degraded = ranked.filter((s) => s.status === 'degraded').length;
  const unconfigured = ranked.filter((s) => s.status === 'not-configured').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Label>Third parties and queues</Label>
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
          {probedAt ? `probed ${ago(probedAt)}, again every 60s` : 'probing…'}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" icon={IconRefresh} loading={busy} onClick={() => void load()}>
          Probe now
        </Button>
      </div>

      {failure ? (
        <FailedRegion
          title="Couldn't finish the last probe sweep"
          detail={failure}
          onRetry={() => void load()}
          scopeNote={
            probedAt ? 'the readings below are from the last good sweep' : 'only this region failed'
          }
        />
      ) : null}

      <Card
        label="Services"
        hint={services ? `${down} down · ${degraded} degraded · ${unconfigured} not configured` : 'probing…'}
        footer="Reachability only, five-second timeout each. Not configured means the key was never supplied, so the feature is off rather than broken."
      >
        {!services ? (
          <Quiet>Probing…</Quiet>
        ) : ranked.length === 0 ? (
          <Quiet>No services are probed.</Quiet>
        ) : (
          ranked.map((s, i) => (
            <Row key={s.name} last={i === ranked.length - 1}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{s.name}</span>
                <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
                  {SERVICE_CATEGORY_LABEL[s.category]}
                  {s.detail ? ` · ${s.detail}` : ''}
                </span>
              </span>
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                {s.latencyMs === null ? '—' : `${s.latencyMs}ms`}
              </span>
              <Tag kind={SERVICE_TAG[s.status]} icon={s.status === 'up' ? null : undefined}>
                {s.status}
              </Tag>
            </Row>
          ))
        )}
      </Card>

      <Card
        label="Queues"
        hint="work waiting to be done"
        footer="Counts, not a worklist. What actually needs a decision arrives as a card on the Desk."
      >
        {!queues ? (
          <Quiet>Reading…</Quiet>
        ) : (
          queues.map((q, i) => {
            const tone = queueTone(q);
            // ⚠️ The href the server sends points into the panel being
            // deleted, so it is translated. No Desk destination, no link — a
            // dead link during an incident costs more than a plain row.
            const to = q.href ? QUEUE_DESK_HREF[q.href] : undefined;
            return (
              <Row key={q.label} last={i === queues.length - 1}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
                  {to ? (
                    <Link href={to} style={{ color: 'var(--dk-ink)', textDecoration: 'none' }}>
                      {q.label}
                    </Link>
                  ) : (
                    q.label
                  )}
                </span>
                <span className="dk-mono" style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>
                  {q.count}
                </span>
                <Tag kind={tone} icon={tone === 'ok' ? null : undefined}>
                  {tone === 'ok' ? 'clear' : tone === 'warn' ? 'building' : 'over'}
                </Tag>
              </Row>
            );
          })
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * TRUST AND SAFETY — the five feeds of /admin/trust-safety, as one section.
 *
 * 🚨 USERNAMES ONLY, AND THE BLOCKED TEXT STAYS FOLDED. The legacy page put
 * an email address under every username across five tables at once, and
 * printed every intercepted phone number and street address in a scrollable
 * column. None of that is needed to decide anything here — the row says who
 * and what tripped, the evidence opens one row at a time on a deliberate
 * press, and the person is worked on from People.
 * ══════════════════════════════════════════════════════════════════════ */

type TsFeed = 'offenders' | 'questions' | 'listings' | 'sellers' | 'rejections';

interface TsData {
  offenders: RepeatOffenderRow[];
  questions: ReportedQuestionRow[];
  listings: ReportedListingRow[];
  sellers: ReportedSellerRow[];
  rejections: RejectionRow[];
}

function TrustSafety() {
  const [feed, setFeed] = React.useState<TsFeed>('offenders');
  const [data, setData] = React.useState<TsData | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  // One at a time, never a wall: revealing a second sample hides the first.
  const [revealed, setRevealed] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [offenders, questions, listings, sellers, rejections] = await Promise.all([
        fetchRepeatOffenders(),
        fetchReportedQuestions(),
        fetchReportedListings(),
        fetchReportedSellers(),
        fetchRejections(),
      ]);
      setData({ offenders, questions, listings, sellers, rejections });
      setFailure(null);
    } catch (err) {
      setFailure(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (failure) {
    return (
      <FailedRegion title="Couldn't load trust and safety" detail={failure} onRetry={() => void load()} />
    );
  }

  const tabs: { key: TsFeed; label: string; count: number }[] = [
    { key: 'offenders', label: 'Repeat offenders', count: data?.offenders.length ?? 0 },
    { key: 'questions', label: 'Reported Q and A', count: data?.questions.length ?? 0 },
    { key: 'listings', label: 'Reported listings', count: data?.listings.length ?? 0 },
    { key: 'sellers', label: 'Reported sellers', count: data?.sellers.length ?? 0 },
    { key: 'rejections', label: 'Contact blocks', count: data?.rejections.length ?? 0 },
  ];

  return (
    <Card
      label="Trust and safety"
      hint="last 7 days · contact blocks and reported content"
      footer="Read-only. Warning, banning and removing all happen where the person or the listing is; this is the evidence that says which needs it."
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 4 }}>
        {tabs.map((t) => (
          <Chip key={t.key} active={feed === t.key} count={t.count} onClick={() => setFeed(t.key)}>
            {t.label}
          </Chip>
        ))}
      </div>

      {!data ? (
        <Quiet>Loading…</Quiet>
      ) : feed === 'offenders' ? (
        data.offenders.length === 0 ? (
          <Quiet>Nobody has tripped the contact filter three times this week.</Quiet>
        ) : (
          data.offenders.map((o, i) => (
            <Row key={o.userId} last={i === data.offenders.length - 1}>
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
                {o.username ?? 'no username'}
              </span>
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                last {stamp(o.lastRejectionAt)}
              </span>
              <Tag kind="bad">{`${o.rejectionCount} blocks`}</Tag>
            </Row>
          ))
        )
      ) : feed === 'questions' ? (
        data.questions.length === 0 ? (
          <Quiet>No reported questions or answers.</Quiet>
        ) : (
          data.questions.map((q, i) => (
            <Stack key={q.id} last={i === data.questions.length - 1}>
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', lineHeight: 1.5, minWidth: 0, flex: 1 }}>
                  {q.question}
                </span>
                <Tag kind="warn" icon={null}>{`${q.reportedCount} reports`}</Tag>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                {q.listing.title} · asked by {q.asker.username ?? 'no username'} ·{' '}
                {q.status.replace(/_/g, ' ').toLowerCase()} · {stamp(q.createdAt)}
              </span>
            </Stack>
          ))
        )
      ) : feed === 'listings' ? (
        data.listings.length === 0 ? (
          <Quiet>No listings reported.</Quiet>
        ) : (
          data.listings.map((r, i) => (
            <Stack key={r.id} last={i === data.listings.length - 1}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
                  {r.listing ? r.listing.title : 'listing since deleted'}
                </span>
                <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                  {stamp(r.createdAt)}
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)', lineHeight: 1.45 }}>{r.reason}</span>
            </Stack>
          ))
        )
      ) : feed === 'sellers' ? (
        data.sellers.length === 0 ? (
          <Quiet>No sellers reported.</Quiet>
        ) : (
          data.sellers.map((r, i) => (
            <Stack key={r.id} last={i === data.sellers.length - 1}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
                  {r.seller ? (r.seller.username ?? 'no username') : 'account since deleted'}
                </span>
                <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                  {stamp(r.createdAt)}
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)', lineHeight: 1.45 }}>{r.reason}</span>
            </Stack>
          ))
        )
      ) : data.rejections.length === 0 ? (
        <Quiet>The contact-detail filter has been quiet for seven days.</Quiet>
      ) : (
        data.rejections.map((r, i) => (
          <Stack key={r.id} last={i === data.rejections.length - 1}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
                {r.user ? (r.user.username ?? 'no username') : 'signed out'}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{r.channel}</span>
              <Tag kind="neutral">{r.category.replace(/-/g, ' ')}</Tag>
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                {stamp(r.createdAt)}
              </span>
              {/* 🚨 The evidence is a phone number or a street address more
                  often than not. It opens one row at a time, on a press, and
                  never as a column of a hundred. */}
              <Button variant="ghost" onClick={() => setRevealed((cur) => (cur === r.id ? null : r.id))}>
                {revealed === r.id ? 'Hide text' : 'Show text'}
              </Button>
            </span>
            {revealed === r.id ? <Pre tone="ground">{r.sampleText}</Pre> : null}
          </Stack>
        ))
      )}
    </Card>
  );
}

/** A two-line row. Row is one line; this is the same rhythm, stacked. */
function Stack({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '10px 0',
        borderBottom: last ? undefined : '1px solid var(--dk-line)',
      }}
    >
      {children}
    </div>
  );
}
