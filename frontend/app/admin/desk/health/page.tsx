'use client';

/**
 * THE DESK — Health.
 *
 * Everything the Site board was except the agent: what this platform is
 * configured to do, what it can still reach, what is waiting, and who has been
 * doing what. Ordered MOST-LIKELY-TO-NEED-YOU FIRST — this device, gates,
 * services and jobs, third parties and queues, vitals, outbound channels,
 * credits, WhatsApp, alerts, trust and safety — then the audit trail and the
 * admin roster behind drawers. Ten files beside this one, each holding the
 * section it is named for plus the fetch and the failure that belong to it.
 *
 * ⚠️ THE SPLIT WAS A SPLIT, NOT A REWRITE. The content was correct and hard
 * won; what was wrong was that 2,926 lines of it lived in one file and could
 * not be navigated. Every section kept its own comments, its own state, its
 * own fetch and its own failure — that isolation is the feature, and it is
 * what stops one dead probe blanking the other seven.
 *
 * 🚨 THE ONE COUPLING THAT WAS THERE IS GONE. The Site loader awaited
 * /admin/desk/site/board and /admin/settings under a SINGLE try/catch and
 * fired three more reads after the await, so a settings 500 replaced the whole
 * page with one red panel AND silently skipped credits, thresholds and warden
 * settings. This loader fetches the board and nothing else, and a board
 * failure costs exactly the four cards that read it: gates, vitals, channels
 * and WhatsApp. Alerts, probes, trust-and-safety and credits fetch for
 * themselves and are unaffected.
 *
 * 🚨 THE SETTINGS PANEL IS GONE FROM THIS BOARD, BY INSTRUCTION, AND IT COST
 * SOMETHING REAL. `ops_alert_phone`, `ops_alert_types`, `ops_alert_quiet_hours`
 * and `whatsapp_enabled` were the only four flags an operator could change from
 * a browser, and `whatsapp_enabled` is the one control that exists to silence a
 * channel in a hurry. All four now move only with a deploy. What survives is
 * the credit floor editor, because a floor is an operational threshold that
 * tracks supplier pricing rather than a code constant. lib/desk-cutover.ts's
 * /admin/settings entry records the loss; that entry is marked `partial`
 * because it now is.
 *
 * ⚠️ THE SHELL'S SITE DOT IS DERIVED HERE AND NOWHERE ELSE, because the gates
 * are here. Agent deliberately passes none — DeskShell's own comment records
 * what happened when every surface carried a hard-coded green "Healthy": a
 * status light wired to nothing reads OK straight through an outage.
 */
import * as React from 'react';
import {
  AdminsDrawer,
  Button,
  DeskShell,
  Drawer,
  FailedRegion,
  IconSend,
  IconUser,
  Label,
  SendDrawer,
  SkeletonPile,
  WhatsappDrawer,
  useIsPhone,
} from '../../../../components/desk';
import { describeFailure } from '../../../../lib/desk-auth';
import { parseSendPreset, stripSendPreset, type SendPreset } from '@/lib/desk-send';
import {
  fetchAdmins,
  parseWhatsappThreadId,
  stripWhatsappParam,
  type AdminAccount,
} from '../../../../lib/desk-site';
import { fetchHealthBoard, whatsappOn, type HealthBoard } from './board';
import { AlertsInbox } from './alerts';
import { AuditTrail } from './audit';
import { Credits, OutboundChannels, WhatsappHealth } from './channels';
import { ConfigGates } from './gates';
import { ProbesAndQueues, ServicesAndJobs } from './services';
import { ThisDevice } from './this-device';
import { TrustSafety } from './trust-safety';
import { ServerVitals } from './vitals';

export default function HealthPage() {
  const phone = useIsPhone();

  const [board, setBoard] = React.useState<HealthBoard | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadedAt, setLoadedAt] = React.useState<string | null>(null);

  const [auditOpen, setAuditOpen] = React.useState(false);
  const [adminsOpen, setAdminsOpen] = React.useState(false);
  const [admins, setAdmins] = React.useState<AdminAccount[] | null>(null);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [sendPreset, setSendPreset] = React.useState<SendPreset>({ open: false });
  const [whatsappThread, setWhatsappThread] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setBoard(await fetchHealthBoard());
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /**
   * `/admin/desk/health?send=1&channel=sms&segment=dormant` — the entrance the
   * legacy /admin/broadcast page had. `?whatsapp=<threadId>` is the same idea
   * for the WhatsApp reply drawer, which had no entrance at all.
   *
   * ⚠️ THE DEEP LINKS MOVED WITH THE DRAWERS, and lib/desk-cutover.ts moved
   * with them. A ?send=1 bookmark pointing at /admin/desk/site now lands on a
   * redirect, which carries the visitor but NOT the query string — so the
   * cutover map names this route and anyone holding an old link gets the board
   * without the drawer rather than a 404.
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

  const redGates = board?.gates.filter((g) => g.tone === 'bad').length ?? 0;

  return (
    <DeskShell
      active="health"
      title="Health"
      sub={
        board === null
          ? error
            ? 'the board did not load'
            : 'reading…'
          : redGates
            ? `${redGates} red ${redGates === 1 ? 'gate' : 'gates'}`
            : 'no red gates'
      }
      // ⚠️ NO DOT UNTIL THE BOARD LANDS. `site` is optional and omitting it
      // draws nothing; defaulting to green here would put a healthy light over
      // a board that has not been read, which is the failure DeskShell's own
      // comment records.
      site={board === null ? undefined : { tone: redGates ? 'bad' : 'ok', word: redGates ? 'Attention' : 'Healthy' }}
    >
      {phone ? null : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>Health</span>
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>the site watches itself</span>
          <span style={{ flex: 1 }} />
        </div>
      )}

      {/* ⚠️ ONE COLUMN, AT EVERY WIDTH, AND THAT IS A DECISION. The order of
          these sections is the design — most likely to need you, first — and a
          two-column grid makes "first" ambiguous the moment it wraps: the
          fifth card sits level with the first and an operator scanning for the
          worst thing reads them in whichever order their eye lands. The cards
          are dense enough that a 1280 column is not empty. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <ThisDevice loadedAt={loadedAt} />

        {/* Gates, vitals, channels and WhatsApp are the four cards fed by
            /admin/desk/site/board, and the ONLY things a board failure costs.
            Everything below fetches for itself.

            ⚠️ THE OTHER THREE RENDER NOTHING ON A FAILURE RATHER THAN EACH
            DRAWING THEIR OWN EMPTY CARD, and this one panel speaks for all
            four — its scopeNote names them. Four copies of "the board did not
            load" down one column is a screen an operator stops reading, and
            the second copy is where they stop. The cost is honest and worth
            knowing: a reader who scrolls past this panel sees a gap where the
            vitals were, with the explanation above rather than in place. */}
        {error ? (
          <FailedRegion
            title="Couldn't load the gates, vitals and channels"
            detail={error}
            onRetry={() => void load()}
            scopeNote="only the four cards that read /admin/desk/site/board — the probes, alerts, credits and reports below read their own endpoints"
          />
        ) : !board ? (
          <SkeletonPile count={2} />
        ) : (
          <ConfigGates gates={board.gates} />
        )}

        <ServicesAndJobs />
        <ProbesAndQueues />

        {board ? <ServerVitals vitals={board.vitals} at={loadedAt} phone={phone} /> : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <Label>Channels and credits</Label>
          <span style={{ flex: 1 }} />
          {/* ⚠️ THE ONLY CONTROL ON THIS BOARD THAT LEAVES THE BUILDING. The
              outbound channels beside it are a read-out; this one writes to
              people's phones. The weight belongs in the drawer's confirm, not
              in a red button on a dashboard. */}
          <Button variant="secondary" icon={IconSend} onClick={() => setSendOpen(true)}>
            Send…
          </Button>
        </div>
        {board ? <OutboundChannels channels={board.channels} /> : null}
        <Credits />
        {board ? <WhatsappHealth enabled={whatsappOn(board.channels)} phone={phone} /> : null}

        <AlertsInbox />
        <TrustSafety />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <Label>The record, and who can get in</Label>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={() => setAuditOpen(true)}>
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
      </div>

      <Drawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        typeLabel="Audit trail"
        title="Who did what"
        meta="Every admin action, newest first. Read-only by design."
        note="This is the record a money action is answered for with. It is never edited or pruned from here. Warden's own executions are a different record and live on Agent."
      >
        <AuditTrail open={auditOpen} />
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
