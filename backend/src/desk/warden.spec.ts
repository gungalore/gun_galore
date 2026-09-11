import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { WardenService, maskSaPhone } from './warden.service';
import { WARDEN_MESSAGE_KINDS } from './warden.types';
import type { ConfigGate } from './desk-site.service';

/**
 * WARDEN — the endpoints the Site surface leans on.
 *
 * 🚨 THE TWO THINGS THESE TESTS EXIST TO STOP.
 *
 * ONE: A WARDEN THAT LOOKS PRESENT WHEN IT IS NOT. This project's signature
 * failure is a surface that renders as if something is behind it. An empty,
 * healthy-looking chat on an unwatched box is exactly that, and it is worse
 * than a blank panel because it reads as "nothing to report". Every read here
 * is asserted to say `present: false` out loud, and every write to refuse.
 *
 * TWO: AN APPROVE THAT RUNS SOMETHING OTHER THAN WHAT WAS CONFIRMED. The
 * confirm dialog restates a command; approve() re-reads the proposal and
 * compares. A money-grade confirm the operator has learned to trust, which
 * then runs a different command, is the worst outcome in this module — worse
 * than no confirm at all.
 */

const BASE = 'http://127.0.0.1:9099';

const MESSAGE = {
  id: 'msg_1',
  role: 'warden',
  kind: 'proposal',
  at: '2026-09-03T07:05:00.000Z',
  body: ['nginx returned 502 on /api/health for 4 minutes.'],
  pre: { tone: 'inset', lines: ['-  probe_timeout_ms: 3000', '+  probe_timeout_ms: 8000'] },
  proposalId: 'prop40',
};

const PROPOSAL = {
  id: 'prop40',
  kind: 'proposal',
  status: 'pending',
  headline: 'Proposed fix: raise the health-probe timeout 3s → 8s',
  diagnosis: 'The pm2 reload overlapped the 3-second probe.',
  command: 'warden apply proposal 40',
  gateKey: null,
  raisedAt: '2026-09-03T07:05:00.000Z',
};

const RED_GATE = {
  id: 'gate_verifynow',
  kind: 'red_gate',
  status: 'pending',
  headline: 'Red gate: identity checks are running in sandbox',
  diagnosis: 'VERIFYNOW_MODE=sandbox on a public site.',
  command: null,
  gateKey: 'VERIFYNOW_MODE',
  raisedAt: '2026-09-03T06:40:00.000Z',
};

/** DeskSiteService.gates() output — the shape WardenService classifies. */
const GATES: ConfigGate[] = [
  { key: 'PAYMENT_MODE', label: 'Payment mode', value: 'manual', tone: 'info' },
  {
    key: 'PAYMENTS_LIVE',
    label: 'Payments live',
    value: 'off',
    tone: 'warn',
    note: '7 payouts (R42,310) queued behind it',
  },
  {
    key: 'VERIFYNOW_MODE',
    label: 'Identity checks',
    value: 'sandbox',
    tone: 'bad',
    note: 'sellers are not genuinely ID-verified',
  },
  { key: 'ALLOW_LOCAL_ORIGINS', label: 'Local origins', value: 'allowed', tone: 'bad' },
];

function makeService(o: { settings?: { key: string; value: string }[] } = {}) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    setting: { findMany: jest.fn().mockResolvedValue(o.settings ?? []) },
  };
  const site = { gates: jest.fn().mockResolvedValue(GATES) };
  const service = new WardenService(prisma as never, site as never, audit as never);
  return { service, audit, prisma, site };
}

/** Answers the daemon's routes by path; anything unrouted is a hard failure. */
function stubDaemon(routes: Record<string, { status?: number; body?: unknown }>) {
  const fetchMock = jest.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url).slice(BASE.length);
    const hit = routes[path];
    if (!hit) throw new Error(`no stub for ${path}`);
    const status = hit.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => hit.body,
      text: async () => JSON.stringify(hit.body ?? ''),
    } as unknown as Response;
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}

const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  delete process.env.WARDEN_BASE_URL;
  delete process.env.WARDEN_TOKEN;
});

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = REAL_FETCH;
  jest.restoreAllMocks();
});

function configure() {
  process.env.WARDEN_BASE_URL = BASE;
  process.env.WARDEN_TOKEN = 'not-a-real-token';
}

describe('warden is not deployed', () => {
  it('says so on the chat rather than rendering an empty thread', async () => {
    const { service } = makeService();
    const fetchMock = stubDaemon({});

    const chat = await service.chat();

    expect(chat.present).toBe(false);
    expect(chat.note).toMatch(/not deployed/i);
    expect(chat.messages).toEqual([]);
    expect(chat.proposals).toEqual([]);
    // Fails closed WITHOUT a network call — there is nothing to call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses every write, and names the two env vars that would fix it', async () => {
    const { service, audit } = makeService();
    stubDaemon({});

    await expect(service.send('admin_1', { message: 'hello' })).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(
      service.approve('admin_1', 'prop40', { expectedCommand: 'warden apply proposal 40' }),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(service.decline('admin_1', 'prop40', {})).rejects.toThrow(
      ServiceUnavailableException,
    );

    await expect(service.send('admin_1', { message: 'hi' })).rejects.toThrow(/WARDEN_BASE_URL/);
    // Nothing happened, so nothing is claimed to have happened.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports present:false when configured but unreachable, instead of 500ing the page', async () => {
    configure();
    const { service } = makeService();
    (globalThis as { fetch: unknown }).fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const chat = await service.chat();

    // The Site page renders the whole board around this card; a throw here
    // would take the board down over a chat panel.
    expect(chat.present).toBe(false);
    expect(chat.note).toMatch(/did not answer/i);
  });
});

describe('the thread', () => {
  it('proxies the daemon and keeps a well-formed message', async () => {
    configure();
    const { service } = makeService();
    const fetchMock = stubDaemon({
      '/chat': {
        body: {
          lastCheckAt: '2026-09-03T07:14:00.000Z',
          messages: [MESSAGE],
          proposals: [PROPOSAL],
        },
      },
    });

    const chat = await service.chat();

    expect(chat.present).toBe(true);
    expect(chat.lastCheckAt).toBe('2026-09-03T07:14:00.000Z');
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].kind).toBe('proposal');
    expect(chat.messages[0].pre?.tone).toBe('inset');
    expect(chat.proposals[0].command).toBe('warden apply proposal 40');
    // The token rides in a header, never the URL.
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/chat`);
  });

  it('DROPS a message whose kind the chat component cannot render', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/chat': {
        body: {
          messages: [
            { ...MESSAGE, id: 'm_bad', kind: 'emergency' },
            { ...MESSAGE, id: 'm_ok' },
          ],
        },
      },
    });

    const chat = await service.chat();

    // Not defaulted to `note`. The tag IS the message — silently downgrading
    // an unrecognised kind would mute exactly the one that mattered.
    expect(chat.messages.map((m) => m.id)).toEqual(['m_ok']);
  });

  it('drops messages with no body and refuses to invent a timestamp', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/chat': {
        body: {
          lastCheckAt: 'never',
          messages: [
            { ...MESSAGE, id: 'm_nobody', body: [] },
            { ...MESSAGE, id: 'm_notime', at: 'this morning' },
          ],
        },
      },
    });

    const chat = await service.chat();

    expect(chat.messages).toEqual([]);
    // Unparseable becomes null, never `now` — "checked 09:14" must be a fact.
    expect(chat.lastCheckAt).toBeNull();
  });

  it('never lets a red gate carry a command, whatever the daemon sent', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/chat': { body: { proposals: [{ ...RED_GATE, command: 'rm -rf /' }] } },
    });

    const chat = await service.chat();

    expect(chat.proposals[0].kind).toBe('red_gate');
    expect(chat.proposals[0].command).toBeNull();
  });

  it('sends a message and returns only what the exchange added', async () => {
    configure();
    const { service } = makeService();
    const fetchMock = stubDaemon({ '/chat': { body: { messages: [MESSAGE] } } });

    const out = await service.send('admin_1', { message: '  Approve.  ' });

    expect(out.messages).toHaveLength(1);
    const init = fetchMock.mock.calls[0][1] as unknown as { method: string; body: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ message: 'Approve.', operatorId: 'admin_1' });
  });
});

describe('approving a fix', () => {
  it('refuses a proposal id that is not one, before touching the network', async () => {
    configure();
    const { service } = makeService();
    const fetchMock = stubDaemon({});

    await expect(
      service.approve('admin_1', '../settings', { expectedCommand: 'x' }),
    ).rejects.toThrow(BadRequestException);
    // The id lands in a URL path; validation is the only thing between it and
    // another of the daemon's routes.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('REFUSES to approve a red gate — it has no fix, and clearing one is a commit', async () => {
    configure();
    const { service, audit } = makeService();
    const fetchMock = stubDaemon({ '/proposals/gate_verifynow': { body: RED_GATE } });

    await expect(
      service.approve('admin_1', 'gate_verifynow', { expectedCommand: '' }),
    ).rejects.toThrow(BadRequestException);

    expect(fetchMock).toHaveBeenCalledTimes(1); // the read only, never an apply
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('REFUSES when the command changed since the confirm was drawn', async () => {
    configure();
    const { service, audit } = makeService();
    const fetchMock = stubDaemon({ '/proposals/prop40': { body: PROPOSAL } });

    await expect(
      service.approve('admin_1', 'prop40', { expectedCommand: 'warden apply proposal 39' }),
    ).rejects.toThrow(ConflictException);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses a proposal that was already settled, so two tabs cannot run it twice', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({ '/proposals/prop40': { body: { ...PROPOSAL, status: 'approved' } } });

    await expect(
      service.approve('admin_1', 'prop40', { expectedCommand: 'warden apply proposal 40' }),
    ).rejects.toThrow(ConflictException);
  });

  it('applies the fix and audits what actually ran', async () => {
    configure();
    const { service, audit } = makeService();
    const fetchMock = stubDaemon({
      '/proposals/prop40': { body: PROPOSAL },
      '/proposals/prop40/approve': {
        body: { messages: [{ ...MESSAGE, id: 'm_ran', kind: 'ran' }] },
      },
    });

    const out = await service.approve('admin_1', 'prop40', {
      expectedCommand: 'warden apply proposal 40',
    });

    expect(out.ok).toBe(true);
    expect(out.command).toBe('warden apply proposal 40');
    expect(out.messages[0].kind).toBe('ran');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const row = audit.record.mock.calls[0][0];
    expect(row.action).toBe('WARDEN_PROPOSAL_APPROVE');
    expect(row.resourceId).toBe('prop40');
    // AdminAuditService.record() throws on an empty reason, and the confirm
    // restates the command rather than asking for prose — so one is
    // synthesised, naming the proposal.
    expect(row.reason).toContain('prop40');
    expect(row.newValue).toEqual({ status: 'approved', command: 'warden apply proposal 40' });
  });

  it('keeps the operator’s own reason when they gave one', async () => {
    configure();
    const { service, audit } = makeService();
    stubDaemon({
      '/proposals/prop40': { body: PROPOSAL },
      '/proposals/prop40/approve': { body: { messages: [] } },
    });

    await service.approve('admin_1', 'prop40', {
      expectedCommand: 'warden apply proposal 40',
      reason: 'Probe timeout is genuinely too tight during a reload.',
    });

    expect(audit.record.mock.calls[0][0].reason).toBe(
      'Probe timeout is genuinely too tight during a reload.',
    );
  });
});

describe('declining a fix', () => {
  it('refuses to decline a red gate — a dismissable red gate stops nagging', async () => {
    configure();
    const { service, audit } = makeService();
    stubDaemon({ '/proposals/gate_verifynow': { body: RED_GATE } });

    await expect(service.decline('admin_1', 'gate_verifynow', {})).rejects.toThrow(
      BadRequestException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('forwards the reason and audits the refusal', async () => {
    configure();
    const { service, audit } = makeService();
    const fetchMock = stubDaemon({
      '/proposals/prop40': { body: PROPOSAL },
      '/proposals/prop40/decline': { body: { messages: [] } },
    });

    await service.decline('admin_1', 'prop40', { reason: 'Leave overnight retries alone.' });

    const init = fetchMock.mock.calls[1][1] as unknown as { body: string };
    expect(JSON.parse(init.body).reason).toBe('Leave overnight retries alone.');
    expect(audit.record.mock.calls[0][0].action).toBe('WARDEN_PROPOSAL_DECLINE');
  });
});

describe('config gates', () => {
  it('marks the red ones and counts them, without re-reading the env', async () => {
    const { service, site } = makeService();

    const view = await service.gates();

    // The values are DeskSiteService's, so this endpoint and the Site board
    // cannot disagree about what PAYMENTS_LIVE is.
    expect(site.gates).toHaveBeenCalledTimes(1);
    expect(view.redCount).toBe(2);
    expect(view.gates.find((g) => g.key === 'VERIFYNOW_MODE')?.red).toBe(true);
    // Amber is information, not a red gate — it deals no daily card.
    expect(view.gates.find((g) => g.key === 'PAYMENTS_LIVE')?.red).toBe(false);
    expect(view.gates.find((g) => g.key === 'PAYMENT_MODE')?.red).toBe(false);
  });
});

describe('settings, the only four', () => {
  it('masks the alert phone and never returns the number itself', async () => {
    const { service } = makeService({
      settings: [{ key: 'ops_alert_phone', value: '0821234567' }],
    });

    const { rows } = await service.settings();
    const phone = rows.find((r) => r.key === 'ops_alert_phone')!;

    expect(phone.display).toBe('+27 82 ··· ··67');
    // The board is screenshotted into support threads. The edit pen prefills
    // from GET /admin/settings, which the same admin already has.
    expect(phone.raw).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain('0821234567');
  });

  it('falls back to the registry defaults, not to "off"', async () => {
    const { service } = makeService({ settings: [] });

    const { rows } = await service.settings();

    expect(rows.map((r) => r.key)).toEqual([
      'ops_alert_phone',
      'ops_alert_types',
      'ops_alert_quiet_hours',
      'whatsapp_enabled',
    ]);
    expect(rows.find((r) => r.key === 'ops_alert_phone')!.display).toBe('not set');
    // A missing quiet-hours row means the default TRUE. Reading it as off
    // would show alerts sending at 03:00 on a system that is holding them.
    expect(rows.find((r) => r.key === 'ops_alert_quiet_hours')!.raw).toBe('true');
    expect(rows.find((r) => r.key === 'ops_alert_types')!.items).toEqual([
      { value: 'BACKUP_FAILED', label: 'BACKUP_FAILED', checked: true },
    ]);
    expect(rows.find((r) => r.key === 'whatsapp_enabled')!.display).toBe('off');
  });

  it('does not claim a site-down exception to quiet hours, because there is none', async () => {
    const { service } = makeService({
      settings: [{ key: 'ops_alert_quiet_hours', value: 'true' }],
    });

    const { rows } = await service.settings();
    const quiet = rows.find((r) => r.key === 'ops_alert_quiet_hours')!;

    // decideOpsAlert() holds EVERY watched type between 22:00 and 06:00 SAST,
    // a failed backup included. The panel must not imply otherwise.
    expect(quiet.display).toContain('22:00');
    expect(quiet.note).not.toMatch(/site.down/i);
    expect(quiet.note).toMatch(/no exception/i);
  });

  it('checks every alert type it lists, because the list IS the stored value', async () => {
    const { service } = makeService({
      settings: [{ key: 'ops_alert_types', value: 'BACKUP_FAILED, KYC_REPEATED_FAILURE' }],
    });

    const { rows } = await service.settings();
    const types = rows.find((r) => r.key === 'ops_alert_types')!;

    // There is no registry of alertable types in this codebase — 52 places
    // raise an AdminAlert with a free-string type — so an UNCHECKED box here
    // would be an option invented for the UI.
    expect(types.items).toEqual([
      { value: 'BACKUP_FAILED', label: 'BACKUP_FAILED', checked: true },
      { value: 'KYC_REPEATED_FAILURE', label: 'KYC_REPEATED_FAILURE', checked: true },
    ]);
  });
});

describe('maskSaPhone', () => {
  it('recognises the local, +27 and 27 forms', () => {
    expect(maskSaPhone('0821234567')).toBe('+27 82 ··· ··67');
    expect(maskSaPhone('+27 82 123 4567')).toBe('+27 82 ··· ··67');
    expect(maskSaPhone('27821234567')).toBe('+27 82 ··· ··67');
  });

  it('says set rather than mangling something it cannot parse', () => {
    expect(maskSaPhone('')).toBe('not set');
    expect(maskSaPhone('   ')).toBe('not set');
    expect(maskSaPhone('x12')).toBe('set');
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * THE HAND MIRROR
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 🚨 warden/src/types.ts AND THIS PACKAGE'S warden.types.ts ARE KEPT IN STEP
 * BY HAND, AND A DIVERGENCE IS SILENT ON BOTH SIDES. warden/ is a separate
 * package with its own tsconfig and no import path into backend/src, so
 * nothing type-checks the two against each other. A seventh message kind
 * added on the daemon's side is DROPPED here — normaliseMessage() whitelists
 * six literals and returns null for anything else — and the operator simply
 * never sees that message, with no error logged anywhere. Worse, it is a
 * THREE-way mirror: frontend/components/desk/chat.tsx's KIND_TAG is the third
 * copy, and a kind added here but not there renders an `undefined` tag.
 *
 * There is no import to lean on, so this reads the daemon's source off disk
 * and extracts the literals. If warden/ has moved or the declaration has been
 * reshaped, this test FAILS — which is correct: a mirror nobody can find is a
 * mirror that has already drifted.
 */
const WARDEN_TYPES_PATH = path.join(__dirname, '..', '..', '..', 'warden', 'src', 'types.ts');

function daemonSource(): string {
  try {
    return fs.readFileSync(WARDEN_TYPES_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read the daemon's copy of the wire contract at ${WARDEN_TYPES_PATH}: ${String(err)}. ` +
        'It is hand-mirrored against backend/src/desk/warden.types.ts and nothing else checks the two agree. ' +
        'If warden/ moved, move this path with it — do not delete the test.',
    );
  }
}

describe('the wire contract is mirrored by hand, so a test has to hold it', () => {
  it('the six message kinds are the same six, in the same order, on both sides', () => {
    const src = daemonSource();
    const match = /WARDEN_MESSAGE_KINDS\s*=\s*\[([^\]]*)\]/.exec(src);
    expect(match).not.toBeNull();

    const daemonKinds = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    // Order as well as membership: both sides read as a documented list and a
    // reordering is the kind of diff a reviewer waves through.
    expect(daemonKinds).toEqual([...WARDEN_MESSAGE_KINDS]);

    // ⚠️ THE TWO SPELLINGS, PINNED. A chat MESSAGE kind is 'red-gate'
    // (HYPHEN); a PROPOSAL kind is 'red_gate' (UNDERSCORE). They are one
    // keystroke apart, each is exact-matched on the far side, and neither is
    // corrected — a transposed one vanishes from the thread.
    expect(daemonKinds).toContain('red-gate');
    expect(daemonKinds).not.toContain('red_gate');
  });

  it('the proposal-id charset is the same on both sides, even though each holds it under a different name', () => {
    const src = daemonSource();
    const match = /WARDEN_ID_RE\s*=\s*(\/[^;\n]+\/)/.exec(src);
    expect(match).not.toBeNull();

    // 🚨 THIS PAIR HAD NO MIRRORED HOME AT ALL. The daemon exports
    // WARDEN_ID_RE from its types file; this package holds PROPOSAL_ID_RE as a
    // PRIVATE const inside warden.service.ts, nowhere near warden.types.ts.
    // Changing either was invisible to the other, and the failure is not a
    // type error — it is a proposal id that one side mints and the other
    // refuses, so approve and decline 400 on a button that looks normal.
    expect(match![1]).toBe('/^[A-Za-z0-9_-]{1,64}$/');

    // And this side still behaves that way, whatever the literal says.
    configure();
    const { service } = makeService();
    return expect(
      service.approve('admin_1', 'not a valid id', { expectedCommand: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('the shapes Phase 4 added are declared on the daemon side too', () => {
    const src = daemonSource();
    // A route added here against a daemon that does not serve it is a 404 the
    // operator reads as "Warden is down". These three names are the contract.
    for (const name of ['WardenPause', 'WardenAuditEntry', 'WardenCheckBoard']) {
      expect(src).toContain(`interface ${name}`);
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * THE AUDIT TRAIL
 * ────────────────────────────────────────────────────────────────────────── */

const AUDIT_ENTRY = {
  id: 'aud_1',
  proposalId: 'prop40',
  at: '2026-09-03T07:06:00.000Z',
  finishedAt: '2026-09-03T07:06:04.000Z',
  durationMs: 4_000,
  trigger: 'operator_approved',
  operatorId: 'admin_1',
  operationKind: 'safe_list',
  operationName: 'restartProcess',
  command: 'pm2 reload alloutdoor-backend --update-env',
  exitCode: 0,
  timedOut: false,
  stdout: { text: 'reloaded', truncated: false, originalBytes: 8 },
  stderr: { text: '', truncated: false, originalBytes: 0 },
  redactions: ['WARDEN_TOKEN'],
  recheck: { at: '2026-09-03T07:06:10.000Z', result: 'ok', note: 'pm2-processes: all up' },
};

describe('the audit trail', () => {
  it('says it is not deployed rather than rendering an empty history', async () => {
    const { service } = makeService();
    const view = await service.auditTrail();

    // 🚨 AN EMPTY AUDIT TRAIL AND AN ABSENT ONE ARE OPPOSITE CLAIMS. "Warden
    // has run nothing" is reassuring; "nothing is answering" is not. This
    // module's signature failure is a surface that renders as if something is
    // behind it, and an audit page is the worst place for it.
    expect(view.present).toBe(false);
    expect(view.note).toMatch(/not deployed/i);
    expect(view.entries).toEqual([]);
  });

  it('proxies the daemon and keeps the transcript, the redaction names and the recheck', async () => {
    configure();
    const { service } = makeService();
    const fetchMock = stubDaemon({
      '/audit?limit=50': { body: { entries: [AUDIT_ENTRY], truncated: true } },
    });

    const view = await service.auditTrail();

    expect(fetchMock).toHaveBeenCalled();
    expect(view.present).toBe(true);
    expect(view.truncated).toBe(true);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].command).toBe('pm2 reload alloutdoor-backend --update-env');
    expect(view.entries[0].stdout.text).toBe('reloaded');
    expect(view.entries[0].redactions).toEqual(['WARDEN_TOKEN']);
    expect(view.entries[0].recheck).toEqual({
      at: '2026-09-03T07:06:10.000Z',
      result: 'ok',
      note: 'pm2-processes: all up',
    });
  });

  it('narrows to one run, and refuses an id that is not one before touching the network', async () => {
    configure();
    const { service } = makeService();
    const fetchMock = stubDaemon({
      '/audit?proposalId=prop40&limit=50': { body: { entries: [AUDIT_ENTRY], truncated: false } },
    });

    expect((await service.auditTrail({ proposalId: 'prop40' })).entries).toHaveLength(1);

    await expect(service.auditTrail({ proposalId: '../chat' })).rejects.toThrow(BadRequestException);
    // Validated here, not forwarded and left to the daemon: it lands in a
    // query string on a URL this process builds.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('DROPS a record whose trigger or operation kind this API cannot name', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/audit?limit=50': {
        body: {
          entries: [
            { ...AUDIT_ENTRY, id: 'aud_bad_trigger', trigger: 'somehow' },
            { ...AUDIT_ENTRY, id: 'aud_bad_kind', operationKind: 'whatever' },
            { ...AUDIT_ENTRY, id: 'aud_no_command', command: '' },
            AUDIT_ENTRY,
          ],
          truncated: false,
        },
      },
    });

    const view = await service.auditTrail();

    // A record IS the account of what ran on a production box. A
    // half-understood one read as authoritative is worse than a gap somebody
    // has to go and explain, so an unrecognised field drops the whole record
    // rather than being coerced to the safe-looking value.
    expect(view.entries.map((e) => e.id)).toEqual(['aud_1']);

    // 🚨 AND IT SAYS SO. Dropping three runs while answering `truncated: false`
    // made an incomplete account of what executed on the box indistinguishable
    // from a complete one — the reader has no way to tell "the agent ran
    // nothing else" from "I could not render what else it ran". The count is
    // deliberately separate from `truncated`: one is answered by asking for
    // the next page, the other by going and reading the daemon's own store.
    expect(view.dropped).toBe(3);
    expect(view.truncated).toBe(false);
  });

  it('never recomputes originalBytes from the text it was handed', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/audit?limit=50': {
        body: {
          entries: [
            { ...AUDIT_ENTRY, stdout: { text: 'x'.repeat(20_000), truncated: true, originalBytes: 4_000_000 } },
          ],
          truncated: false,
        },
      },
    });

    const [entry] = (await service.auditTrail()).entries;

    // 🚨 THE HONESTY RULE ON THE SECOND CLAMP. originalBytes is the size of
    // the command's output BEFORE any truncation, and the whole point of the
    // field is telling a reader how much they are NOT looking at. Measuring
    // the clamped copy would report an 8 KB excerpt of a 4 MB log as the
    // complete output.
    expect(entry.stdout.originalBytes).toBe(4_000_000);
    expect(entry.stdout.truncated).toBe(true);
    expect(entry.stdout.text.length).toBeLessThan(20_000);
  });

  it('an unreachable daemon is present:false, not an empty history and not a 500', async () => {
    configure();
    const { service } = makeService();
    (globalThis as { fetch: unknown }).fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const view = await service.auditTrail();
    expect(view.present).toBe(false);
    expect(view.note).toMatch(/did not answer/i);
    expect(view.entries).toEqual([]);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * THE CHECK BOARD — the read that used to be un-normalised
 * ────────────────────────────────────────────────────────────────────────── */

describe('the daemon check board', () => {
  it('FILLS counts even when the daemon sends null, because the Site board reads counts.bad off it', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/gates': {
        body: {
          lastCheckAt: null,
          // 🚨 WHAT A FRESHLY-RESTARTED DAEMON ACTUALLY SENDS. WardenCore
          // .gates() returns counts:null until the first sweep finishes — four
          // zeroes would render as a clean board on an unwatched box. This
          // side declared counts NON-nullable and checkBoard() used to cast
          // the response straight through after one Array.isArray(rows) test,
          // which `rows: []` passes. DeskSiteService.board() then read
          // `warden.counts.bad` off it: a TypeError on the Site page every
          // time the daemon restarted.
          counts: null,
          rows: [
            { id: 'host-disk', title: 'Disk', status: 'bad', verdict: '/ is 94% full.', gateKey: null, standing: false, measuredAt: '2026-09-03T07:00:00.000Z', fresh: true },
            { id: 'tls-origin', title: 'TLS', status: 'unknown', verdict: 'Not measured — not run yet.', gateKey: null, standing: false, measuredAt: '2026-09-03T07:00:00.000Z', fresh: false },
          ],
          paused: null,
        },
      },
    });

    const board = await service.checkBoard();

    expect(board).not.toBeNull();
    // Tallied FROM THE ROWS, not defaulted independently of them — four zeroes
    // beside a board full of bad rows is the failure this prevents.
    expect(board!.counts).toEqual({ ok: 0, warn: 0, bad: 1, unknown: 1 });
  });

  it('DROPS a row whose status it cannot name, rather than colouring it ok or unknown', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/gates': {
        body: {
          lastCheckAt: '2026-09-03T07:00:00.000Z',
          counts: { ok: 0, warn: 0, bad: 0, unknown: 0 },
          rows: [
            { id: 'weird', title: 'Weird', status: 'probably-fine', verdict: 'hmm', gateKey: null, standing: false, measuredAt: '2026-09-03T07:00:00.000Z', fresh: true },
            { id: 'host-disk', title: 'Disk', status: 'ok', verdict: '/ is 61% full.', gateKey: null, standing: false, measuredAt: '2026-09-03T07:00:00.000Z', fresh: true },
          ],
        },
      },
    });

    const board = await service.checkBoard();

    // The Site tiles colour on this and render the verdict as the tile's
    // value. A misspelled status coerced either way is a measurement this
    // process has invented.
    expect(board!.rows.map((r) => r.id)).toEqual(['host-disk']);
    expect(board!.counts).toEqual({ ok: 1, warn: 0, bad: 0, unknown: 0 });
  });

  it('clamps the daemon-authored verdict, which is partly model-written and lands in an admin browser', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/gates': {
        body: {
          lastCheckAt: null,
          counts: null,
          rows: [
            { id: 'noisy', title: 'Noisy', status: 'warn', verdict: 'v'.repeat(50_000), gateKey: null, standing: false, measuredAt: '2026-09-03T07:00:00.000Z', fresh: true },
          ],
        },
      },
    });

    const board = await service.checkBoard();
    expect(board!.rows[0].verdict.length).toBe(1_000);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * FORCING A LOOK, AND STOPPING ONE
 * ────────────────────────────────────────────────────────────────────────── */

describe('an on-demand sweep', () => {
  it('is refused when there is no daemon, rather than returning an empty board', async () => {
    const { service } = makeService();
    await expect(service.sweep('admin_1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('passes finished:false through as a SUCCESS — the sweep is running, not failed', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/sweep': {
        body: {
          finished: false,
          forced: true,
          joined: false,
          board: { lastCheckAt: null, counts: null, rows: [], paused: null },
        },
      },
    });

    const result = await service.sweep('admin_1');

    // 🚨 NOT AN ERROR. A full forced sweep runs every check, expensive ones
    // budgeted sixty seconds EACH; the daemon answers early so the request
    // cannot outlive nginx's 60s cut, which would hand the operator a 502
    // while the box was being measured behind it. Turning this into a throw
    // would make the error the false statement.
    expect(result.finished).toBe(false);
    expect(result.forced).toBe(true);
    expect(result.board.counts).toEqual({ ok: 0, warn: 0, bad: 0, unknown: 0 });
  });

  it('reports a JOINED cadence sweep as not-forced, so a carried-forward board is not sold as a re-measure', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/sweep': {
        body: {
          finished: true,
          forced: false,
          joined: true,
          board: { lastCheckAt: '2026-09-03T07:00:00.000Z', counts: null, rows: [], paused: null },
        },
      },
    });

    const result = await service.sweep('admin_1');
    expect(result.joined).toBe(true);
    expect(result.forced).toBe(false);
  });
});

describe('pause and resume', () => {
  it('are refused when there is no daemon — a pause that reached nothing is worse than no button', async () => {
    const { service, audit } = makeService();
    await expect(service.pause('admin_1', {})).rejects.toThrow(ServiceUnavailableException);
    await expect(service.resume('admin_1')).rejects.toThrow(ServiceUnavailableException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('forwards the pause, keeps the daemon’s own expiry, and audits who stopped the watchdog', async () => {
    configure();
    const { service, audit } = makeService();
    const fetchMock = stubDaemon({
      '/pause': {
        body: {
          messages: [{ ...MESSAGE, id: 'msg_pause', kind: 'note', proposalId: undefined }],
          paused: {
            // An hour past the fake "now" this spec runs at — normalisePause
            // drops an expiry that has already passed, on purpose, so a clock
            // skew between the two processes cannot leave a stale banner up.
            until: new Date(Date.now() + 3_600_000).toISOString(),
            since: new Date().toISOString(),
            operatorId: 'admin_1',
            reason: 'deploying',
          },
        },
      },
    });

    const result = await service.pause('admin_1', { minutes: 30, reason: 'deploying' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ operatorId: 'admin_1', minutes: 30, reason: 'deploying' });
    expect(result.paused).not.toBeNull();
    expect(result.paused!.reason).toBe('deploying');

    // ⚠️ AUDITED LIKE AN APPROVE. Suspending the thing that watches the box is
    // an operational decision somebody has to be able to point at later.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WARDEN_PAUSE', adminUserId: 'admin_1', reason: 'deploying' }),
    );
  });

  it('synthesises an audit reason when the operator typed none, because record() throws on an empty one', async () => {
    configure();
    const { service, audit } = makeService();
    stubDaemon({ '/pause': { body: { messages: [], paused: null } } });

    await service.pause('admin_1', {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WARDEN_PAUSE', reason: expect.stringMatching(/\S/) }),
    );
  });

  it('DROPS a pause whose expiry has already passed rather than leaving a stale banner on the board', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/pause': {
        body: {
          messages: [],
          paused: { until: '2020-01-01T00:00:00.000Z', since: '2019-12-31T00:00:00.000Z', operatorId: 'admin_1', reason: null },
        },
      },
    });

    // The daemon evaluates expiry on every read and should never send one —
    // but a few seconds of clock skew between the two processes must not put
    // "paused until" on a board whose Warden is working normally.
    expect((await service.pause('admin_1', {})).paused).toBeNull();
  });

  it('resume audits too, and is not an error when nothing was paused', async () => {
    configure();
    const { service, audit } = makeService();
    stubDaemon({ '/resume': { body: { messages: [] } } });

    const result = await service.resume('admin_1');

    expect(result.paused).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'WARDEN_RESUME' }));
  });

  it('carries the paused state onto the thread, so a quiet Warden and a paused one are distinguishable', async () => {
    configure();
    const { service } = makeService();
    stubDaemon({
      '/chat': {
        body: {
          lastCheckAt: '2026-09-03T07:14:00.000Z',
          messages: [],
          proposals: [],
          paused: {
            until: new Date(Date.now() + 3_600_000).toISOString(),
            since: new Date().toISOString(),
            operatorId: 'admin_1',
            reason: null,
          },
        },
      },
    });

    const chat = await service.chat();
    expect(chat.present).toBe(true);
    expect(chat.paused).not.toBeNull();
  });
});
