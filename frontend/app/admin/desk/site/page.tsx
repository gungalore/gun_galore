'use client';

/**
 * THE DESK — Site.
 *
 * Five of the legacy panel's pages live here rather than becoming five more
 * tabs: settings, alerts, credits, and — as drawers — the audit trail and the
 * admin roster. The design is five flat surfaces; a sixth and seventh tab
 * would be the first step back to the sidebar this rebuild replaced.
 *
 * ⚠️ WARDEN IS NOT DEPLOYED, AND THIS PAGE SAYS SO RATHER THAN LOOKING CALM.
 * An empty chat under a green badge reads as "nothing has gone wrong" when it
 * means "nothing is watching". Until the daemon exists, the alert inbox below
 * is the only place ~20 alert types surface at all.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  Button,
  Chip,
  DeskShell,
  DialogFrame,
  Drawer,
  FailedRegion,
  IconAlert,
  IconBell,
  IconBolt,
  IconBubble,
  IconLock,
  IconMail,
  IconPhone,
  IconRefresh,
  IconSend,
  IconUser,
  Input,
  Label,
  Section,
  SendDrawer,
  SkeletonPile,
  Tag,
  Toggle,
  Vital,
  useIsPhone,
} from '../../../../components/desk';
import { deskFetch, describeFailure } from '../../../../lib/desk-auth';
import { parseSendPreset, stripSendPreset, type SendPreset } from '@/lib/desk-send';
import {
  QUEUE_DESK_HREF,
  SERVICE_CATEGORY_LABEL,
  ago,
  creditIsLow,
  creditUnreadable,
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
  queueTone,
  resolveAlert,
  settingReasonMin,
  stamp,
  updateSetting,
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
} from '../../../../lib/desk-site';

type Tone = 'ok' | 'warn' | 'bad' | 'info';

interface ConfigGate { key: string; label: string; value: string; tone: Tone; note?: string }
interface VitalRow { key: string; label: string; known: boolean; value: string; tone: Tone }
interface ChannelRow { key: string; label: string; state: string; tone: Tone; detail: string }
interface SiteBoard {
  gates: ConfigGate[];
  channels: ChannelRow[];
  vitals: VitalRow[];
  warden: { present: boolean; note: string };
}

const CHANNEL_ICON = { email: IconMail, sms: IconPhone, push: IconBell, whatsapp: IconBubble } as const;

export default function SitePage() {
  const [board, setBoard] = React.useState<SiteBoard | null>(null);
  const [settings, setSettings] = React.useState<SettingFlag[] | null>(null);
  const [alerts, setAlerts] = React.useState<AdminAlertRow[]>([]);
  const [credits, setCredits] = React.useState<CreditSnapshot[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [audit, setAudit] = React.useState<AuditRow[] | null>(null);
  const [admins, setAdmins] = React.useState<AdminAccount[] | null>(null);
  const [auditOpen, setAuditOpen] = React.useState(false);
  const [adminsOpen, setAdminsOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [sendPreset, setSendPreset] = React.useState<SendPreset>({ open: false });
  const [killSwitch, setKillSwitch] = React.useState<{ next: boolean } | null>(null);
  const [reason, setReason] = React.useState('');
  // ⚠️ THE KILL SWITCH KEEPS ITS OWN FAILURE. Routing a 400 from the settings
  // PATCH into the page-level error replaced the entire board — gates,
  // channels, health, trust and safety — with one red panel, and took the
  // half-typed reason with it. The dialog is where the operator is looking.
  const [killError, setKillError] = React.useState<string | null>(null);
  // Same reasoning for a failed resolve: one row refusing must not take the
  // health probes and the trust-and-safety feeds off the screen with it.
  const [alertError, setAlertError] = React.useState<string | null>(null);
  const [killBusy, setKillBusy] = React.useState(false);
  const [thresholds, setThresholds] = React.useState<CreditThreshold[]>([]);
  const phone = useIsPhone();

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
      setError(null);
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
  }, [load]);

  /**
   * `/admin/desk/site?send=1&channel=sms&segment=dormant` — the entrance the
   * legacy /admin/broadcast page had, so a card elsewhere can hand over a
   * composed audience in one click.
   *
   * ⚠️ window.location, NOT useSearchParams. This is a client page; reading
   * the hook here would drag a Suspense boundary around the whole board for a
   * value that only matters once, on mount. The params are stripped straight
   * afterwards so a refresh does not re-open a send surface nobody asked for.
   */
  React.useEffect(() => {
    const preset = parseSendPreset(window.location.search);
    if (!preset.open) return;
    setSendPreset(preset);
    setSendOpen(true);
    window.history.replaceState(
      {},
      '',
      window.location.pathname + stripSendPreset(window.location.search) + window.location.hash,
    );
  }, []);

  const whatsapp = settings?.find((s) => s.key === 'whatsapp_enabled');
  const whatsappOn = whatsapp?.currentValue === 'true';
  const killReasonMin = settingReasonMin('whatsapp_enabled');
  const redGates = board?.gates.filter((g) => g.tone === 'bad').length ?? 0;

  return (
    <DeskShell
      active="site"
      title="Site"
      sub={board ? (redGates ? `${redGates} red ${redGates === 1 ? 'gate' : 'gates'}` : 'no red gates') : 'Loading…'}
      site={{ tone: redGates ? 'bad' : 'ok', word: redGates ? 'Attention' : 'Healthy' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>Site</span>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>the site watches itself</span>
        <span style={{ flex: 1 }} />
        {/* ⚠️ THE ONLY CONTROL ON THIS BOARD THAT LEAVES THE BUILDING. The
            outbound channels beside it are a read-out; this one writes to
            people's phones. It sits with the other two because the Desk opens
            records and dangerous jobs the same way — the weight belongs in the
            drawer's confirm, not in a red button on a dashboard. */}
        <Button variant="secondary" icon={IconSend} onClick={() => setSendOpen(true)}>
          Send…
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setAuditOpen(true);
            if (!audit) void fetchAudit().then((a) => setAudit(a.rows)).catch(() => setAudit([]));
          }}
        >
          Audit trail
        </Button>
        <Button
          variant="secondary"
          icon={IconUser}
          onClick={() => {
            setAdminsOpen(true);
            if (!admins) void fetchAdmins().then(setAdmins).catch(() => setAdmins([]));
          }}
        >
          Who can get in
        </Button>
      </div>

      {error ? (
        <FailedRegion title="Couldn't load the board" detail={error} onRetry={() => void load()} />
      ) : !board || !settings ? (
        <SkeletonPile count={2} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: phone ? '1fr' : 'minmax(0, 1fr) 440px',
            gap: 12,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <WardenPanel note={board.warden.note} />

            {/* ⚠️ THE HINT SAYS WHAT IT READ, NOT WHAT EXISTS. The fetch asks
                for fifty and the card shows eight, so "50 unresolved" would
                be a floor wearing the clothes of a total — there may be two
                hundred behind it. The legacy inbox pages, filters by type and
                resolves in bulk; none of that is here, which is why
                /admin/alerts is partial on the cutover map. */}
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
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 0',
                      borderBottom: i === Math.min(alerts.length, 8) - 1 ? undefined : '1px solid var(--dk-line)',
                    }}
                  >
                    <Tag kind={a.urgent ? 'bad' : 'neutral'} icon={a.urgent ? IconAlert : null}>
                      {a.type}
                    </Tag>
                    <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)', minWidth: 0, flex: 1 }}>
                      {a.context ?? '—'}
                    </span>
                    <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                      {stamp(a.createdAt)}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAlertError(null);
                        void resolveAlert(a.id)
                          .then(() => setAlerts((xs) => xs.filter((x) => x.id !== a.id)))
                          .catch((e) => setAlertError(describeFailure(e)));
                      }}
                    >
                      Resolve
                    </Button>
                  </div>
                ))
              )}
            </Card>

            {/* The legacy /admin/health page, and the five feeds of
                /admin/trust-safety. Each loads and fails on its own. */}
            <SystemHealth />
            <TrustSafety />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <Card label="Server vitals" hint="what this process can see">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
                  gap: 8,
                }}
              >
                {board.vitals.map((v) => (
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

            <Card label="Outbound channels">
              {board.channels.map((c, i) => {
                const Icon = CHANNEL_ICON[c.key as keyof typeof CHANNEL_ICON] ?? IconMail;
                return (
                  <Row key={c.key} last={i === board.channels.length - 1}>
                    <Icon size={14} style={{ color: 'var(--dk-ink-3)' }} />
                    <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{c.label}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{c.detail}</span>
                    <Tag kind={c.tone === 'ok' ? 'ok' : c.tone === 'warn' ? 'warn' : 'neutral'} icon={null}>
                      {c.state}
                    </Tag>
                  </Row>
                );
              })}
            </Card>

            {credits.length ? (
              <Card
                label="Credits"
                hint="vendor balances"
                footer="Low means at or under the vendor warn floor. A vendor with no floor, or with the pair encoding a spend ceiling rather than a floor, is shown unflagged rather than flagged the wrong way. No balance API is a post-paid or key-less vendor, not a fault — colouring those amber is how amber stops meaning anything."
              >
                {credits.map((c, i) => {
                  const low = creditIsLow(
                    c,
                    thresholds.find((t) => t.service === c.service),
                  );
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

            <Card
              label="Config gates"
              hint="read-only"
              footer="Truth, not controls. Each of these changes in code, with a commit and a reason."
            >
              {board.gates.map((g, i) => (
                <div
                  key={g.key}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '9px 0',
                    borderBottom: i === board.gates.length - 1 ? undefined : '1px solid var(--dk-line)',
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

            {/* ⚠️ THREE OF THE FOUR ARE READ-OUTS AND ARE LABELLED AS SUCH.
                They carried an edit pencil and no handler, which is the worst
                of both: it promises a control, does nothing when pressed, and
                sends the operator looking for the bug in themselves. The
                endpoint accepts a PATCH on all three — the drawer that would
                use it is not built, so the row says where the value changes
                instead of miming a field. */}
            <Card
              label="Settings · the only four"
              footer="Every other flag changes in code. The three alert values above are read-outs here and are edited on the legacy settings page until this board grows a field; the WhatsApp switch is the one a deploy is too slow for."
            >
              {settings
                .filter((s) => s.key !== 'whatsapp_enabled')
                .map((s) => (
                  <Row key={s.key} last={false}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{s.label}</span>
                      <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
                        {s.key}
                      </span>
                    </span>
                    <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
                      {s.currentValue || '—'}
                    </span>
                    <Tag kind="neutral" icon={null}>
                      read-only
                    </Tag>
                  </Row>
                ))}

              {whatsapp ? (
                <Row last>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>WhatsApp channel</span>
                    <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                      Kill switch. Off means no template can send. The one writable flag in the panel.
                    </span>
                  </span>
                  <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                    {whatsappOn ? 'on' : 'off'}
                  </span>
                  <Toggle
                    checked={whatsappOn}
                    label="WhatsApp channel"
                    onChange={(next) => {
                      setReason('');
                      setKillSwitch({ next });
                    }}
                  />
                </Row>
              ) : null}
            </Card>
          </div>
        </div>
      )}

      {/* ⚠️ The kill switch confirms and takes a reason. It is the one flag an
          operator can change from a browser, so it is the one flag whose
          change must be answerable for afterwards.

          🚨 THE REASON FLOOR IS THE SERVER'S. whatsapp_enabled is a danger
          flag, so AdminSettingsService demands fifteen characters and refuses
          anything shorter with a 400. This dialog armed at five, closed
          itself before the request landed, and posted the refusal to the
          page-level error — so the one control that exists to silence a
          channel in a hurry appeared to work, did nothing, and took the whole
          board down with it. */}
      {killSwitch ? (
        <DialogFrame
          label="Setting · confirm"
          title={killSwitch.next ? 'Switch the WhatsApp channel on' : 'Switch the WhatsApp channel off'}
          onClose={() => {
            if (killBusy) return;
            setKillSwitch(null);
            setKillError(null);
          }}
          footer={
            <>
              {reason.trim().length < killReasonMin && !killBusy ? (
                <span
                  style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.4, color: 'var(--dk-ink-3)' }}
                >
                  {`A reason of at least ${killReasonMin} characters arms this — the server refuses a shorter one on a channel flag.`}
                </span>
              ) : null}
              <Button
                variant="ghost"
                disabled={killBusy}
                onClick={() => {
                  setKillSwitch(null);
                  setKillError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant={killSwitch.next ? 'primary' : 'danger'}
                disabled={reason.trim().length < killReasonMin || killBusy}
                loading={killBusy}
                onClick={() => {
                  if (reason.trim().length < killReasonMin || killBusy) return;
                  const next = killSwitch.next;
                  setKillBusy(true);
                  setKillError(null);
                  void updateSetting('whatsapp_enabled', String(next), reason.trim())
                    .then(() => fetchDeskSettings().then(setSettings))
                    .then(() => {
                      setKillSwitch(null);
                      setReason('');
                    })
                    // ⚠️ THE DIALOG STAYS OPEN AND KEEPS THE TYPED REASON. The
                    // server's own words are the only useful thing on screen,
                    // and the flag has NOT moved.
                    .catch((e) => setKillError(describeFailure(e)))
                    .finally(() => setKillBusy(false));
                }}
              >
                {killSwitch.next ? 'Switch on' : 'Switch off'}
              </Button>
            </>
          }
        >
          <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>
            {killSwitch.next
              ? 'Templates on the approved wave will be able to send. Nothing sends until a provider is configured.'
              : 'No WhatsApp template will send from this moment, to anyone, until it is switched back on.'}
          </span>
          {killError ? (
            <span
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--dk-bad)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {`The flag did not move.\n${killError}`}
            </span>
          ) : null}
          <Input
            placeholder={`Why? At least ${killReasonMin} characters — goes in the audit trail`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </DialogFrame>
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

      <Drawer
        open={adminsOpen}
        onClose={() => setAdminsOpen(false)}
        typeLabel="Admin accounts"
        icon={IconUser}
        title="Who can get in"
        meta="Roles and access. The only route to granting or revoking an administrator."
        note="MONITORING_ADMIN is meant to be read-only. The server does not yet enforce that on every mutating route — see the build plan's role-guard item."
      >
        <Section label="Accounts" last>
          {!admins ? (
            <Quiet>Loading…</Quiet>
          ) : admins.length === 0 ? (
            <Quiet>No admin accounts returned.</Quiet>
          ) : (
            admins.map((a, i) => (
              <Row key={a.id} last={i === admins.length - 1}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{a.email}</span>
                  {a.lastLoginAt ? (
                    <span style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                      last in {stamp(a.lastLoginAt)}
                    </span>
                  ) : null}
                </span>
                <Tag kind={a.role === 'SUPERADMIN' ? 'info' : a.role === 'MONITORING_ADMIN' ? 'warn' : 'neutral'} icon={null}>
                  {a.role}
                </Tag>
                {a.isActive === false ? <Tag kind="neutral">inactive</Tag> : null}
              </Row>
            ))
          )}
        </Section>
      </Drawer>

      {/* /admin/broadcast and /admin/campaigns, merged: a key and the blast it
          attributes are one job. Everything dangerous about it lives inside. */}
      <SendDrawer
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        initialChannel={sendPreset.channel}
        initialSegment={sendPreset.segment}
      />
    </DeskShell>
  );
}

function WardenPanel({ note }: { note: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '18px 20px',
        background: 'var(--dk-raised)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconBolt size={16} style={{ color: 'var(--dk-ink-3)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Warden</span>
        <Tag kind="warn" icon={IconAlert}>
          not deployed
        </Tag>
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dk-ink-2)' }}>{note}</span>
      <span style={{ fontSize: 11.5, color: 'var(--dk-warn)', lineHeight: 1.5 }}>
        Nothing checks the box on its own. The gates and channels beside this panel are read live on
        every load — current, but only while you are looking.
      </span>
    </div>
  );
}

function Card({
  label,
  hint,
  footer,
  children,
}: {
  label: string;
  hint?: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '13px 16px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <Label>{label}</Label>
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
        padding: '9px 0',
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

/* ══════════════════════════════════════════════════════════════════════
 * SYSTEM HEALTH — services, crons, queue depths.
 *
 * The whole of the legacy /admin/health page, which the Site board could
 * previously only gesture at.
 *
 * ⚠️ THIS IS NOT THE VITALS CARD WEARING A HAT. CPU, memory and disk still
 * need Warden on the box and the vitals card still says so. Everything below
 * has a real source this process can reach today: reachability probes of
 * third parties, cron last-run stamps the crons wrote themselves, and four
 * Prisma counts. A gauge with no source is worse than an admitted gap, so
 * nothing here is invented to fill the grid.
 *
 * ⚠️ IT KEEPS ITS OWN STATE AND ITS OWN FAILURE. A five-second probe sweep
 * that times out must not blank the alert inbox beside it, and a stale
 * reading left on screen during an incident is more use than an empty card.
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

const CRON_TAG: Record<CronRow['status'], 'ok' | 'warn' | 'bad'> = {
  ok: 'ok',
  stale: 'bad',
  never: 'warn',
};

/** Re-probe cadence. Matches the legacy page and sits under every cron. */
const HEALTH_POLL_MS = 60_000;

function SystemHealth() {
  const [services, setServices] = React.useState<ServiceProbe[] | null>(null);
  const [crons, setCrons] = React.useState<CronRow[] | null>(null);
  const [queues, setQueues] = React.useState<QueueRow[] | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [probedAt, setProbedAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [allCrons, setAllCrons] = React.useState(false);
  // Only here to re-render the "probed 40s ago" line between sweeps.
  const [, setClock] = React.useState(0);
  // Each probe is bounded at 5s server-side, so a slow sweep must not have a
  // second one pile up behind it.
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const [s, c, q] = await Promise.all([fetchServices(), fetchCrons(), fetchQueues()]);
      setServices(s);
      setCrons(c);
      setQueues(q);
      setProbedAt(new Date().toISOString());
      setFailure(null);
    } catch (err) {
      // ⚠️ THE LAST GOOD READING STAYS ON SCREEN. Blanking three cards
      // because one refresh 500d throws away the only picture of the
      // incident, at the moment it is most wanted.
      setFailure(describeFailure(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), HEALTH_POLL_MS);
    const clock = setInterval(() => setClock((n) => n + 1), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
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

  const troubled = crons ? crons.filter((c) => c.status !== 'ok') : [];
  const shownCrons = crons ? (allCrons ? crons : troubled) : [];
  const stale = troubled.filter((c) => c.status === 'stale').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Label>System health</Label>
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
        hint={
          services
            ? `${down} down · ${degraded} degraded · ${unconfigured} not configured`
            : 'probing…'
        }
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
        label="Crons"
        hint={crons ? `${stale} stale of ${crons.length}` : 'reading…'}
        footer="Stale means three times its own cadence has passed since it last finished. Never can be honest on a weekly job and a young box, which is why it is amber and not red."
      >
        {!crons ? (
          <Quiet>Reading…</Quiet>
        ) : shownCrons.length === 0 ? (
          <Quiet>Every cron ran inside its cadence.</Quiet>
        ) : (
          shownCrons.map((c, i) => (
            <Row key={c.name} last={i === shownCrons.length - 1}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{c.name}</span>
                <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
                  {c.schedule}
                </span>
              </span>
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                {ago(c.lastRunAt)}
              </span>
              <Tag kind={CRON_TAG[c.status]}>{c.status}</Tag>
            </Row>
          ))
        )}
        {crons && crons.length > 0 ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
            <Button variant="ghost" onClick={() => setAllCrons((v) => !v)}>
              {allCrons
                ? `Show only the ${troubled.length} needing a look`
                : `Show all ${crons.length}`}
            </Button>
          </span>
        ) : null}
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
            // deleted, so it is translated. No Desk destination, no link —
            // a dead link during an incident costs more than a plain row.
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
      <FailedRegion
        title="Couldn't load trust and safety"
        detail={failure}
        onRetry={() => void load()}
      />
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
                <span
                  style={{ fontSize: 12.5, color: 'var(--dk-ink)', lineHeight: 1.5, minWidth: 0, flex: 1 }}
                >
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
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)', lineHeight: 1.45 }}>
                {r.reason}
              </span>
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
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)', lineHeight: 1.45 }}>
                {r.reason}
              </span>
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
                  often than not. It opens one row at a time, on a press,
                  and never as a column of a hundred. */}
              <Button
                variant="ghost"
                onClick={() => setRevealed((cur) => (cur === r.id ? null : r.id))}
              >
                {revealed === r.id ? 'Hide text' : 'Show text'}
              </Button>
            </span>
            {revealed === r.id ? (
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
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {r.sampleText}
              </pre>
            ) : null}
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
