import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { DeskSiteService } from './desk-site.service';
import type { ApproveProposalDto, DeclineProposalDto, SendWardenChatDto } from './warden.dto';
import {
  WARDEN_MESSAGE_KINDS,
  type WardenChat,
  type WardenChatMessage,
  type WardenGate,
  type WardenGatesView,
  type WardenMessageKind,
  type WardenPre,
  type WardenProposal,
  type WardenProposalKind,
  type WardenProposalStatus,
  type WardenSettingRow,
  type WardenCheckBoard,
  type WardenSettingsView,
} from './warden.types';

/**
 * WARDEN — the authenticated door to the daemon on the box.
 *
 * ⚠️ FAILS CLOSED. WARDEN_BASE_URL and WARDEN_TOKEN are both required. With
 * either unset there is no Warden: reads report `present: false` so the board
 * draws the honest "not deployed" state, and every write is refused with a
 * 503. It does NOT degrade into a local stub — a chat that accepts messages
 * nothing will ever read is worse than one that says it is not there. Same
 * shape as the PEACH_* and TCG_WEBHOOK_SECRET gates elsewhere in this API.
 *
 * ⚠️ THIS PROCESS NEVER RUNS THE COMMAND. approve() verifies and forwards;
 * Warden runs it inside its own safe list and re-checks afterwards. Moving
 * execution here would turn the admin JWT into a production shell.
 *
 * ⚠️ THE DAEMON IS NOT TRUSTED INPUT. Everything it returns is normalised
 * below — kinds whitelisted, strings clamped, unknown fields dropped. Its
 * text is partly Claude-authored (Warden escalates what its rules cannot
 * classify) and lands in an admin browser. See normalise* at the foot.
 */

const BASE_URL_VAR = 'WARDEN_BASE_URL';
const TOKEN_VAR = 'WARDEN_TOKEN';

/**
 * ⚠️ NOTHING HERE MAY APPROACH 60s. nginx cuts at 60 and Cloudflare at 100;
 * a request that outlives nginx returns a 502 to the operator while the
 * command it started keeps running on the box, which is the one outcome a
 * confirm dialog is supposed to make impossible. Reads are quick. Writes get
 * more room because approve() makes two hops (verify, then apply) and Warden
 * re-checks after running, but 8 + 25 still lands well inside the cut.
 */
const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 25_000;

/** Clamps on daemon-supplied text. Generous, but the thread is not a log sink. */
const MAX_MESSAGES = 200;
const MAX_PROPOSALS = 50;
const MAX_BODY_PARAGRAPHS = 12;
const MAX_TEXT = 4_000;
const MAX_PRE_LINES = 40;

/**
 * A proposal id goes into a URL path. Warden mints cuids, but this is the
 * only thing standing between `:id` and a path traversal into another of the
 * daemon's routes, so it is enforced rather than assumed. Colon-free on
 * purpose too: DeskService.act() splits card ids on ':' and keeps two
 * segments, so a warden card id must be `warden:<id>` and nothing deeper.
 */
const PROPOSAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const NOT_DEPLOYED_NOTE =
  'Warden is not deployed. Nothing is watching the box automatically yet.';

/** The four, and only the four. Order is the order the panel draws them. */
const SETTING_KEYS = [
  'ops_alert_phone',
  'ops_alert_types',
  'ops_alert_quiet_hours',
  'whatsapp_enabled',
] as const;

@Injectable()
export class WardenService {
  private readonly logger = new Logger(WardenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: DeskSiteService,
    private readonly audit: AdminAuditService,
  ) {}

  // ── the gate ────────────────────────────────────────────────────────────

  private config(): { baseUrl: string; token: string } | null {
    const baseUrl = (process.env[BASE_URL_VAR] ?? '').trim().replace(/\/+$/, '');
    const token = (process.env[TOKEN_VAR] ?? '').trim();
    if (!baseUrl || !token) return null;
    return { baseUrl, token };
  }

  /** True when a Warden daemon is configured. Never whether it is reachable. */
  present(): boolean {
    return this.config() !== null;
  }

  /**
   * Refuse a write when there is no daemon. Named for what it protects: every
   * caller below is about to promise the operator that something happened.
   */
  private requireWarden(): { baseUrl: string; token: string } {
    const cfg = this.config();
    if (!cfg) {
      throw new ServiceUnavailableException(
        `${NOT_DEPLOYED_NOTE} Set ${BASE_URL_VAR} and ${TOKEN_VAR} on the box first.`,
      );
    }
    return cfg;
  }

  // ── the hop ─────────────────────────────────────────────────────────────

  /**
   * One request to the daemon. Read failures are the caller's to soften;
   * write failures throw, because a write that quietly returned an empty
   * object would leave the operator believing a fix ran.
   *
   * ⚠️ THE DAEMON'S ERROR BODY IS NOT FORWARDED. It runs on the box and its
   * text can name paths, hostnames and process arguments; the operator gets
   * the status and the log gets the rest.
   */
  private async call<T>(
    cfg: { baseUrl: string; token: string },
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs: number },
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch (err) {
      this.logger.error(`Warden ${init.method} ${path} did not answer: ${String(err)}`);
      throw new ServiceUnavailableException('Warden did not answer.');
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(`Warden ${init.method} ${path} → ${res.status} ${detail.slice(0, 500)}`);
      // 404 and 409 are Warden's own answers about a proposal and are worth
      // passing through as themselves; everything else is "Warden is unwell".
      if (res.status === 404) throw new NotFoundException('Warden has no such proposal.');
      if (res.status === 409) {
        throw new ConflictException('Warden has already settled that proposal.');
      }
      throw new ServiceUnavailableException(`Warden answered ${res.status}.`);
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new ServiceUnavailableException('Warden answered with something that was not JSON.');
    }
  }

  // ── chat ────────────────────────────────────────────────────────────────

  /**
   * The thread and the proposals still open on it.
   *
   * Reads NEVER throw for an absent or unwell daemon — the Site page renders
   * the board around this card, and a 503 here would take the whole page
   * down over a chat panel. Absence and unreachability both come back as
   * `present: false` with the reason on the face.
   */
  async chat(): Promise<WardenChat> {
    const cfg = this.config();
    if (!cfg) {
      return { present: false, note: NOT_DEPLOYED_NOTE, lastCheckAt: null, messages: [], proposals: [] };
    }

    try {
      const raw = await this.call<unknown>(cfg, '/chat', {
        method: 'GET',
        timeoutMs: READ_TIMEOUT_MS,
      });
      return this.normaliseChat(raw);
    } catch (err) {
      this.logger.warn(`Warden chat unavailable: ${String(err)}`);
      return {
        present: false,
        note: 'Warden is configured but did not answer. The board is showing what this process can see on its own.',
        lastCheckAt: null,
        messages: [],
        proposals: [],
      };
    }
  }

  /**
   * Say something to Warden. Returns only what the exchange added, so the
   * client appends rather than re-rendering a thread the operator is reading.
   */
  async send(adminId: string, dto: SendWardenChatDto): Promise<{ messages: WardenChatMessage[] }> {
    const cfg = this.requireWarden();
    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException('Say something to Warden.');
    }

    const raw = await this.call<unknown>(cfg, '/chat', {
      method: 'POST',
      body: { message, operatorId: adminId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });

    return { messages: this.normaliseMessages(this.pick(raw, 'messages')) };
  }

  // ── proposals ───────────────────────────────────────────────────────────

  /**
   * Read one proposal straight from Warden. The client's copy is a render of
   * a moment; every decision below is made against this.
   */
  private async proposal(
    cfg: { baseUrl: string; token: string },
    id: string,
  ): Promise<WardenProposal> {
    if (!PROPOSAL_ID_RE.test(id)) {
      throw new BadRequestException('Not a proposal id.');
    }
    const raw = await this.call<unknown>(cfg, `/proposals/${id}`, {
      method: 'GET',
      timeoutMs: READ_TIMEOUT_MS,
    });
    const proposal = this.normaliseProposal(raw);
    if (!proposal) throw new NotFoundException('Warden has no such proposal.');
    return proposal;
  }

  /**
   * ⚠️ MONEY-GRADE. Three refusals stand in front of the daemon, in this
   * order, and each of them has a reason worth keeping:
   *
   *   1. A RED GATE CANNOT BE APPROVED. It has no command. The only thing
   *      that clears `VERIFYNOW_MODE=sandbox` is a commit, and an Approve
   *      button that appeared to clear one would be a lie about the running
   *      configuration of a firearms marketplace.
   *   2. A SETTLED PROPOSAL CANNOT BE RE-APPROVED. Two operators on two
   *      tabs otherwise run the same fix twice.
   *   3. THE COMMAND MUST STILL BE THE ONE THAT WAS CONFIRMED. This is the
   *      compare-and-swap; see ApproveProposalDto.expectedCommand.
   */
  async approve(adminId: string, id: string, dto: ApproveProposalDto) {
    const cfg = this.requireWarden();
    const proposal = await this.proposal(cfg, id);

    if (proposal.kind === 'red_gate') {
      throw new BadRequestException(
        'A red gate has no fix to approve. It clears when the gate changes in code.',
      );
    }
    if (proposal.status !== 'pending') {
      throw new ConflictException(`That proposal was already ${proposal.status}.`);
    }
    if (!proposal.command) {
      throw new ConflictException('Warden no longer holds a command for that proposal.');
    }
    if (proposal.command !== dto.expectedCommand) {
      throw new ConflictException(
        'The proposal changed since you opened it. Re-read the fix and approve again.',
      );
    }

    const result = await this.call<unknown>(cfg, `/proposals/${id}/approve`, {
      method: 'POST',
      body: { operatorId: adminId, expectedCommand: dto.expectedCommand },
      timeoutMs: WRITE_TIMEOUT_MS,
    });

    // ⚠️ AUDITED AFTER THE FACT, DELIBERATELY. The row records what ran, and
    // it cannot say that before Warden has run it. AdminAuditService.record()
    // throws on an empty reason, and the confirm dialog restates the command
    // rather than asking for prose — so a reason is synthesised from the
    // proposal when the operator did not type one.
    await this.audit.record({
      adminUserId: adminId,
      action: 'WARDEN_PROPOSAL_APPROVE',
      resourceType: 'WardenProposal',
      resourceId: id,
      oldValue: { status: proposal.status },
      newValue: { status: 'approved', command: proposal.command },
      reason: (dto.reason ?? '').trim() || `Approved Warden proposal ${id}: ${proposal.headline}`,
    });

    return {
      ok: true as const,
      proposalId: id,
      command: proposal.command,
      messages: this.normaliseMessages(this.pick(result, 'messages')),
    };
  }

  /**
   * Refuse a fix. Warden reads declines back as standing guidance, so the
   * reason is the useful half — but it is still optional, because an operator
   * who just wants it gone should not be held up by a text box.
   *
   * A red gate cannot be declined either: there is nothing to decline, and a
   * dismissable red gate is a red gate that stops nagging.
   */
  async decline(adminId: string, id: string, dto: DeclineProposalDto) {
    const cfg = this.requireWarden();
    const proposal = await this.proposal(cfg, id);

    if (proposal.kind === 'red_gate') {
      throw new BadRequestException(
        'A red gate cannot be declined. It clears when the gate changes in code.',
      );
    }
    if (proposal.status !== 'pending') {
      throw new ConflictException(`That proposal was already ${proposal.status}.`);
    }

    const reason = (dto.reason ?? '').trim();
    const result = await this.call<unknown>(cfg, `/proposals/${id}/decline`, {
      method: 'POST',
      body: { operatorId: adminId, reason: reason || undefined },
      timeoutMs: WRITE_TIMEOUT_MS,
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'WARDEN_PROPOSAL_DECLINE',
      resourceType: 'WardenProposal',
      resourceId: id,
      oldValue: { status: proposal.status },
      newValue: { status: 'declined' },
      reason: reason || `Declined Warden proposal ${id}: ${proposal.headline}`,
    });

    return {
      ok: true as const,
      proposalId: id,
      messages: this.normaliseMessages(this.pick(result, 'messages')),
    };
  }

  // ── gates ───────────────────────────────────────────────────────────────

  /**
   * The config gates, with the one fact the Site board's own copy does not
   * carry: which of them are red.
   *
   * ⚠️ THE VALUES COME FROM DeskSiteService, NOT FROM A SECOND ENV READ. Two
   * readers of PAYMENTS_LIVE is two answers waiting to disagree, and the one
   * that drifts is the one nobody is looking at. This adds a classification
   * on top; it never re-derives a gate.
   *
   * `red` is the whole contract: a red gate is dealt onto the Desk daily and
   * can never be sunk. Amber is information.
   */
  /**
   * The daemon's own check board — what it measured on the box.
   *
   * ⚠️ A READ, SO IT NEVER THROWS. Null covers all three of "no daemon
   * configured", "daemon did not answer" and "daemon answered rubbish",
   * because every caller renders the same thing for all three: an em dash
   * with a reason, never a zero. The Site board is drawn around this; a 503
   * here would take the whole page down over four tiles.
   */
  async checkBoard(): Promise<WardenCheckBoard | null> {
    const cfg = this.config();
    if (!cfg) return null;
    try {
      const board = await this.call<WardenCheckBoard>(cfg, '/gates', {
        method: 'GET',
        timeoutMs: 8_000,
      });
      return Array.isArray(board?.rows) ? board : null;
    } catch {
      // Already logged by call(). The caller's job is to say "not measured",
      // which is the same sentence it would say for an absent daemon.
      return null;
    }
  }

  async gates(): Promise<WardenGatesView> {
    const gates: WardenGate[] = (await this.site.gates()).map((g) => ({
      key: g.key,
      label: g.label,
      value: g.value,
      tone: g.tone,
      note: g.note,
      red: g.tone === 'bad',
    }));
    return { gates, redCount: gates.filter((g) => g.red).length };
  }

  // ── settings, the only four ─────────────────────────────────────────────

  /**
   * The four settings the Site panel draws, shaped for the board.
   *
   * ⚠️ READ ONLY, AND THAT IS NOT A LIMITATION. PATCH /admin/settings is the
   * one write path and it carries the type validation, the go-live reason
   * minimum and the audit row. This endpoint exists because the panel needs
   * the values RENDERED — a masked phone, alert types as checkboxes — and
   * doing that in the browser means shipping the unmasked number to it.
   */
  async settings(): Promise<WardenSettingsView> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [...SETTING_KEYS] } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    const phone = (byKey.get('ops_alert_phone') ?? '').trim();
    const types = (byKey.get('ops_alert_types') ?? 'BACKUP_FAILED')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    // Defaults mirror admin-settings.service.ts FLAGS. A missing row is the
    // default, not "off" — reading it as off would show quiet hours disabled
    // on a system that is holding alerts.
    const quiet = (byKey.get('ops_alert_quiet_hours') ?? 'true') === 'true';
    const whatsapp = (byKey.get('whatsapp_enabled') ?? 'false') === 'true';

    const rowsOut: WardenSettingRow[] = [
      {
        key: 'ops_alert_phone',
        label: 'Alert phone',
        kind: 'phone',
        // ⚠️ MASKED, AND NO `raw`. This board is screenshotted into support
        // threads and read over shoulders. The edit pen prefills from
        // GET /admin/settings, which the same admin already has.
        display: maskSaPhone(phone),
        editable: true,
        note: 'SMS via the ops-alert path. Empty means nothing is ever texted.',
      },
      {
        key: 'ops_alert_types',
        label: 'Which alerts wake you',
        kind: 'checkboxes',
        display: types.length ? types.join(', ') : 'none',
        raw: types.join(','),
        // ⚠️ EVERY ITEM IS CHECKED, BECAUSE THIS LIST IS THE STORED VALUE.
        // There is no registry of alertable types in this codebase — fifty-two
        // separate places raise an AdminAlert with a free-string type — so an
        // unchecked box here would be an option invented for the UI. The
        // operator adds a type by name through PATCH /admin/settings.
        items: types.map((t) => ({ value: t, label: t, checked: true })),
        editable: true,
        note: 'Free-form AdminAlert types. Deliberately narrow — widen one at a time.',
      },
      {
        key: 'ops_alert_quiet_hours',
        label: 'Quiet hours',
        kind: 'toggle',
        // The window is NOT configurable: 22:00-06:00 SAST is a constant in
        // decideOpsAlert(). Showing it as an editable range would invite an
        // edit that silently does nothing.
        display: quiet ? 'holding 22:00 – 06:00 SAST' : 'off · alerts send immediately',
        raw: quiet ? 'true' : 'false',
        editable: true,
        // ⚠️ AND NOTHING BREAKS THROUGH IT. Quiet hours holds every watched
        // type, a failed backup included. There is no site-down exception in
        // this system, and the panel must not imply one.
        note: 'Everything watched is held, with no exception. The window itself is fixed in code.',
      },
      {
        key: 'whatsapp_enabled',
        label: 'WhatsApp channel',
        kind: 'toggle',
        display: whatsapp ? 'on' : 'off',
        raw: whatsapp ? 'true' : 'false',
        editable: true,
        note: 'Kill switch. Off means no template can send. The one writable flag in the panel.',
      },
    ];

    return { rows: rowsOut };
  }

  // ── normalising the daemon ──────────────────────────────────────────────

  private pick(raw: unknown, key: string): unknown {
    if (!raw || typeof raw !== 'object') return undefined;
    return (raw as Record<string, unknown>)[key];
  }

  private text(v: unknown, max = MAX_TEXT): string {
    return typeof v === 'string' ? v.slice(0, max) : '';
  }

  /** ISO or nothing. A bad timestamp becomes null; it never becomes `now`. */
  private iso(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  private normaliseChat(raw: unknown): WardenChat {
    return {
      present: true,
      lastCheckAt: this.iso(this.pick(raw, 'lastCheckAt')),
      messages: this.normaliseMessages(this.pick(raw, 'messages')),
      proposals: this.normaliseProposals(this.pick(raw, 'proposals')),
    };
  }

  private normaliseMessages(raw: unknown): WardenChatMessage[] {
    if (!Array.isArray(raw)) return [];
    const out: WardenChatMessage[] = [];
    for (const item of raw.slice(0, MAX_MESSAGES)) {
      const m = this.normaliseMessage(item);
      if (m) out.push(m);
    }
    return out;
  }

  /**
   * ⚠️ A MESSAGE WITHOUT A VALID KIND IS DROPPED, NOT DEFAULTED. The six
   * kinds carry the tag the operator reads — "fixed alone" against "red gate"
   * is the whole difference between a note and an emergency. Defaulting an
   * unrecognised kind to `note` would quietly downgrade exactly the message
   * that mattered, so a message this API cannot classify does not render.
   */
  private normaliseMessage(raw: unknown): WardenChatMessage | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const id = this.text(r.id, 64);
    const at = this.iso(r.at);
    const kind: WardenMessageKind | undefined = WARDEN_MESSAGE_KINDS.find((k) => k === r.kind);
    if (!id || !at || !kind) return null;

    const role = r.role === 'operator' ? 'operator' : 'warden';
    const body = Array.isArray(r.body)
      ? r.body
          .slice(0, MAX_BODY_PARAGRAPHS)
          .map((p) => this.text(p))
          .filter(Boolean)
      : [];
    if (!body.length) return null;

    const pre = this.normalisePre(r.pre);
    const proposalId = this.text(r.proposalId, 64);
    const footnote = this.text(r.footnote, 200);

    return {
      id,
      role,
      kind,
      at,
      body,
      ...(pre ? { pre } : {}),
      ...(proposalId && PROPOSAL_ID_RE.test(proposalId) ? { proposalId } : {}),
      ...(footnote ? { footnote } : {}),
    };
  }

  private normalisePre(raw: unknown): WardenPre | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.lines)) return null;
    const lines = r.lines.slice(0, MAX_PRE_LINES).map((l) => this.text(l, 500));
    if (!lines.length) return null;
    // `ground` is the transcript of something that already ran; anything not
    // explicitly claiming that is treated as a dry run.
    return { tone: r.tone === 'ground' ? 'ground' : 'inset', lines };
  }

  private normaliseProposals(raw: unknown): WardenProposal[] {
    if (!Array.isArray(raw)) return [];
    const out: WardenProposal[] = [];
    for (const item of raw.slice(0, MAX_PROPOSALS)) {
      const p = this.normaliseProposal(item);
      if (p) out.push(p);
    }
    return out;
  }

  private normaliseProposal(raw: unknown): WardenProposal | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const id = this.text(r.id, 64);
    if (!id || !PROPOSAL_ID_RE.test(id)) return null;

    // ⚠️ KIND AND STATUS ARE WHITELISTED, NOT COERCED. Every refusal in
    // approve() is a comparison against these two strings; a `red_gate` that
    // arrived misspelled and fell through to `proposal` would be an
    // approvable red gate.
    const kind = r.kind === 'red_gate' ? 'red_gate' : r.kind === 'proposal' ? 'proposal' : null;
    if (!kind) return null;

    const statuses: WardenProposalStatus[] = ['pending', 'approved', 'declined', 'acknowledged'];
    const status = statuses.find((s) => s === r.status);
    if (!status) return null;

    const headline = this.text(r.headline, 300);
    if (!headline) return null;

    const raisedAt = this.iso(r.raisedAt);
    if (!raisedAt) return null;

    const command = this.text(r.command, 8_000);
    const gateKey = this.text(r.gateKey, 100);

    return {
      id,
      kind: kind as WardenProposalKind,
      status,
      headline,
      diagnosis: this.text(r.diagnosis),
      // A red gate never carries a command, whatever the daemon sent.
      command: kind === 'red_gate' ? null : command || null,
      gateKey: gateKey || null,
      raisedAt,
    };
  }
}

/**
 * `+27 82 ··· ··67` — enough for the operator to recognise their own number
 * and useless to anyone reading over their shoulder. A number that does not
 * parse as SA is reported as set rather than mangled into a wrong-looking
 * mask; the raw value is never returned either way.
 */
export function maskSaPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('27')
    ? digits.slice(2)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  if (!raw.trim()) return 'not set';
  if (local.length < 5) return 'set';
  return `+27 ${local.slice(0, 2)} ··· ··${local.slice(-2)}`;
}
