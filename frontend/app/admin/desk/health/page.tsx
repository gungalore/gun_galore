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
 * ⚠️ THIS IS THE ONLY BOARD THAT PASSES THE SHELL A SITE DOT, AND IT IS AN
 * OVERRIDE OVER THE SHARED SWEEP RATHER THAN THE ONLY SOURCE — the sweep reads
 * the same gates from every board (components/desk/desk-status.tsx). Agent and
 * the rest deliberately pass none, and DeskShell's own comment records what
 * happened when every surface carried a hard-coded green "Healthy": a status
 * light wired to nothing reads OK straight through an outage.
 *
 * 🚨 AND AN OVERRIDE THAT DOES NOT REFRESH IS THAT SAME LIGHT WITH EXTRA
 * STEPS. This page read its board once on mount and passed the result for as
 * long as the operator stood here, beating a poll that was re-reading every
 * minute. It now re-reads on the same cadence, and passes NOTHING while its
 * own read is failing. See the load effect and `ownVerdict`.
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
import { redGateCount, statusDot } from '../../../../lib/desk-status';

/**
 * How often this board re-reads itself. The shared status sweep
 * (components/desk/desk-status.tsx) and the pile both use the same figure.
 */
const BOARD_RELOAD_MS = 60_000;

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

  /**
   * ⚠️ IN-FLIGHT GUARD, because this now runs on a timer. /admin/desk/site/board
   * awaits `warden.checkBoard()` behind an 8-second read timeout (see
   * ./board.ts), and a hung daemon is exactly the state an operator is on this
   * board to diagnose — so without this a stuck read would stack a second one
   * on top of it every minute.
   *
   * ⚠️ AND A STUCK READ THEN STOPS THE BOARD RE-READING AT ALL, because
   * deskFetch has no timeout of its own: `inFlight` stays true, every later
   * tick returns at the guard, and this board keeps passing the shell the last
   * verdict it managed to compute. Stacking requests against a hung endpoint is
   * the worse of the two, so the guard stays — but a deadline on deskFetch is
   * what would actually fix it, and that is not in this file.
   */
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setBoard(await fetchHealthBoard());
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      // ⚠️ THE BOARD IS NOT CLEARED. A failed RE-read leaves the last one on
      // screen with its own timestamp under "This device", and the failure is
      // reported above it rather than replacing it — see the FailedRegion
      // below. What is withheld is the DOT, not the data.
      setError(describeFailure(err));
    } finally {
      inFlight.current = false;
    }
  }, []);

  /**
   * 🚨 IT USED TO READ ONCE AND NEVER AGAIN, AND THE SHELL'S SITE DOT TOOK ITS
   * WORD FOR IT. DeskShell prefers a board's own `site` over the shared 60s
   * poll, so a one-shot read on mount meant the dot on THIS board was frozen
   * at mount time and beat a live reading for as long as the operator stood
   * here — on the one surface whose whole job is to say what the box is doing
   * right now. Same cadence and the same focus event as the shared sweep, for
   * the same reason its comment gives: an operator who has been in their email
   * for ten minutes should not act on a stale board.
   *
   * ⚠️ THE COST, STATED: while somebody is on Health, /admin/desk/site/board
   * is read TWICE a minute — once here and once by the shared sweep. That is
   * the same bargain the provider already makes with the pile feed on the Now
   * board, and it buys the same thing: the board and the chrome fail
   * independently.
   */
  React.useEffect(() => {
    void load();
    const id = setInterval(() => void load(), BOARD_RELOAD_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
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

  /**
   * ⚠️ lib/desk-status.ts's redGateCount, NOT A SECOND COPY OF THE FILTER. The
   * same predicate used to be written here and there, and that module's own
   * comment named this file as the way to collapse them. They read one
   * endpoint, so they could never disagree about the data — but the tab badge
   * and the dot beside it are computed from that predicate, and two copies is
   * how one of them acquires a `!== 'ok'` one day.
   */
  const redGates = board === null ? null : redGateCount(board);

  /**
   * 🚨 WHAT THIS BOARD IS ENTITLED TO SAY ABOUT THE BOX, AND WHEN IT MUST SAY
   * NOTHING. `site` overrides the shared sweep (DeskShellProps.site), so a
   * stale or failed read here does not merely mislead — it SUPPRESSES a live
   * reading from the poll. So the rule is: pass a verdict only while the last
   * read of this board SUCCEEDED, and pass `undefined` the moment it did not,
   * which hands the dot back to the sweep. `undefined` in, `undefined` out:
   * statusDot's three states are the same three states as everywhere else.
   *
   * The stale board stays on screen underneath (its cards are the last thing
   * measured and are labelled with when); it is only the health VERDICT that
   * is withheld, because a count that is an hour old is still a reading and a
   * green light that is an hour old is a lie about now.
   */
  const ownVerdict = error !== null || redGates === null ? undefined : redGates;

  return (
    <DeskShell
      active="health"
      title="Health"
      sub={
        error
          ? board === null
            ? 'the board did not load'
            : "couldn't re-read the board"
          : redGates === null
            ? 'reading…'
            : redGates
              ? `${redGates} red ${redGates === 1 ? 'gate' : 'gates'}`
              : 'no red gates'
      }
      // ⚠️ NO DOT UNTIL THIS BOARD HAS A READING OF ITS OWN THAT WORKED.
      // `site` is optional and omitting it defers to the shared sweep;
      // defaulting to green here would put a healthy light over a board that
      // has not been read, which is the failure DeskShell's own comment
      // records.
      site={statusDot(ownVerdict)}
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
        {/* ⚠️ A FAILED RE-READ IS A DIFFERENT SCREEN FROM A FAILED FIRST READ,
            AND THE BOARD NOW RE-READS EVERY MINUTE. On a cold failure there is
            nothing to show and this panel stands alone. On a refresh failure
            the four cards below still hold the last reading that landed — and
            ThisDevice above prints when — so the panel reports the failure and
            the cards stay put rather than a minute-old 500 blanking a board
            the operator was reading. The one thing the stale read does NOT get
            to do is colour the site dot; see `ownVerdict`. */}
        {error ? (
          <FailedRegion
            title={
              board
                ? "Couldn't re-read the gates, vitals and channels"
                : "Couldn't load the gates, vitals and channels"
            }
            detail={error}
            onRetry={() => void load()}
            scopeNote={
              board
                ? 'the gates, vitals and channels below are the last read that landed — the time is under This device — and the probes, alerts, credits and reports read their own endpoints'
                : 'only the four cards that read /admin/desk/site/board — the probes, alerts, credits and reports below read their own endpoints'
            }
          />
        ) : null}
        {board ? <ConfigGates gates={board.gates} /> : error ? null : <SkeletonPile count={2} />}

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
