import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { WardenService, maskSaPhone } from './warden.service';
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
