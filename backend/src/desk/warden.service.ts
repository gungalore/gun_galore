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
import type { PauseWardenDto, ApproveProposalDto, DeclineProposalDto, SendWardenChatDto } from './warden.dto';
import {
  WARDEN_MESSAGE_KINDS,
  type WardenAuditEntry,
  type WardenAuditView,
  type WardenChat,
  type WardenChatMessage,
  type WardenGate,
  type WardenGatesView,
  type WardenMessageKind,
  type WardenPause,
  type WardenPre,
  type WardenProposal,
  type WardenProposalKind,
  type WardenProposalStatus,
  type WardenSettingRow,
  type WardenCheckBoard,
  type WardenCheckRow,
  type WardenSettingsView,
  type WardenSweepResult,
  type WardenTruncatedText,
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
 * ⚠️ THE AUDIT CAPS ARE NOT THE CHAT CAPS. A record carries the verbatim
 * stdout and stderr of a command that ran on the box; the daemon already
 * clamps each to 4 KB for the wire, and this is the second, independent
 * ceiling on the same bytes. It exists because this side does not trust the
 * daemon's clamp to still be there tomorrow — the two numbers are kept in
 * step by hand across a package boundary with no import path between them.
 */
const MAX_AUDIT_ENTRIES = 50;
const MAX_AUDIT_OUTPUT = 8_000;

/** One board row per registered check. The daemon has ~25; this is a ceiling
 *  on a hostile answer, not a limit anyone should reach. */
const MAX_CHECK_ROWS = 200;

const AUDIT_TRIGGERS = ['unattended', 'operator_approved'] as const;
const AUDIT_OPERATION_KINDS = ['safe_list', 'approved_command'] as const;
const RECHECK_RESULTS = ['ok', 'still-bad', 'unknown'] as const;
const CHECK_STATUSES = ['ok', 'warn', 'bad', 'unknown'] as const;

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
      return { present: false, note: NOT_DEPLOYED_NOTE, lastCheckAt: null, messages: [], proposals: [], paused: null };
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
        // ⚠️ NOT "not paused". Nothing here knows whether the daemon is
        // paused — it did not answer. `present: false` is the fact the card
        // renders; a `paused: null` beside it is only ever read as "no pause
        // banner", which is correct precisely because the card is already
        // saying the daemon is unreachable.
        paused: null,
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
      const raw = await this.call<unknown>(cfg, '/gates', {
        method: 'GET',
        timeoutMs: READ_TIMEOUT_MS,
      });
      return this.normaliseCheckBoard(raw);
    } catch {
      // Already logged by call(). The caller's job is to say "not measured",
      // which is the same sentence it would say for an absent daemon.
      return null;
    }
  }

  // ── the audit trail ─────────────────────────────────────────────────────

  /**
   * Every execution the daemon has a record of, newest first.
   *
   * 🚨 BEFORE THIS ROUTE, NOTHING READ THE AUDIT TRAIL. The daemon wrote a
   * record for every run — operation, resolved arguments, exit code, redacted
   * verbatim transcript — and served it to nobody. The operator's one view of
   * a run was its `ran` chat message, which ages out of a 600-record on-disk
   * window and the 200-message wire window above; after that, "what did this
   * agent run on the production box" was answerable only by SSH.
   *
   * A READ, SO IT NEVER THROWS, for the same reason chat() does not: the Desk
   * renders a page around it and a 503 over a panel would take the page down.
   * Absent and unreachable both come back `present: false` with the reason.
   */
  async auditTrail(opts: { proposalId?: string } = {}): Promise<WardenAuditView> {
    const cfg = this.config();
    if (!cfg) {
      return {
        present: false,
        note: NOT_DEPLOYED_NOTE,
        entries: [],
        truncated: false,
        dropped: 0,
      };
    }

    // ⚠️ VALIDATED BEFORE IT REACHES A QUERY STRING. It is compared against
    // stored proposal ids on the far side; an id outside the charset matches
    // nothing that could ever have been stored, so a bad one is refused here
    // rather than forwarded. Same rule as :id on the approve path.
    if (opts.proposalId !== undefined && !PROPOSAL_ID_RE.test(opts.proposalId)) {
      throw new BadRequestException('Not a proposal id.');
    }

    const path = opts.proposalId
      ? `/audit?proposalId=${encodeURIComponent(opts.proposalId)}&limit=${MAX_AUDIT_ENTRIES}`
      : `/audit?limit=${MAX_AUDIT_ENTRIES}`;

    try {
      const raw = await this.call<unknown>(cfg, path, { method: 'GET', timeoutMs: READ_TIMEOUT_MS });
      const entries: WardenAuditEntry[] = [];
      let dropped = 0;
      const list = this.pick(raw, 'entries');
      if (Array.isArray(list)) {
        for (const item of list.slice(0, MAX_AUDIT_ENTRIES)) {
          const e = this.normaliseAuditEntry(item);
          if (e) entries.push(e);
          // ⚠️ COUNTED, NOT JUST SKIPPED. See WardenAuditView.dropped: a
          // record this proxy cannot render is a run the operator cannot see,
          // and saying nothing about it turns an incomplete history into an
          // alibi. The daemon does the same on its own side of this wire —
          // core.ts audit() counts its drops and raises onError rather than
          // posting a shorter list.
          else dropped += 1;
        }
      }
      // ⚠️ THE DAEMON DROPS RECORDS TOO, AND ITS COUNT IS ADDED TO OURS.
      // warden/src/state/messages.ts projectAudit() refuses a record whose
      // trigger or operation kind it cannot name, and core.ts audit() tallies
      // those refusals — but that tally used to reach only the daemon's pm2
      // stdout, so a record dropped THERE never reached this list and nothing
      // on the Desk said so. Summing is right rather than reporting two
      // numbers: the operator's question is "how many runs can I not see",
      // and which side of the wire refused them changes nothing about the
      // answer or the fix (go and read the daemon's own store).
      // A daemon too old to send the field contributes 0 — that is a version
      // skew, not a claim that it dropped nothing, and it is the same skew
      // this method's own drops would be logging.
      const daemonDropped = this.count(this.pick(raw, 'dropped'));
      const total = dropped + daemonDropped;
      if (total > 0) {
        this.logger.warn(
          `Warden audit: ${total} record(s) are not shown (${dropped} refused here, ${daemonDropped} refused by the daemon). ` +
            'Likely a daemon/backend version skew — warden deploys as a separate, non-fatal stage.',
        );
      }
      return {
        present: true,
        entries,
        truncated: this.pick(raw, 'truncated') === true,
        dropped: total,
      };
    } catch (err) {
      this.logger.warn(`Warden audit unavailable: ${String(err)}`);
      return {
        present: false,
        note: 'Warden is configured but did not answer. Nothing here is a claim that it has run nothing.',
        entries: [],
        truncated: false,
        dropped: 0,
      };
    }
  }

  // ── forcing a look, and stopping one ────────────────────────────────────

  /**
   * Re-measure the box now, cadence ignored.
   *
   * 🚨 UNTIL THIS EXISTED THERE WAS NO WAY TO MAKE WARDEN LOOK AGAIN. Every
   * check carries its own cadence and the daemon's loop always honours it —
   * `force: true` had exactly one caller in the whole tree and it was an
   * on-box CLI. An operator who had just renewed the origin certificate
   * waited up to six hours for the board to agree with them, with no way to
   * tell "not fixed" from "not looked at again".
   *
   * ⚠️ A WRITE, SO IT THROWS WHEN THERE IS NO DAEMON. A sweep that quietly
   * returned an empty board would leave the operator believing the box had
   * just been measured.
   *
   * ⚠️ `finished: false` COMES BACK AS A 200. The daemon answers early rather
   * than holding a connection past nginx's cut; the sweep is running. Do not
   * "fix" that into an error — the error would be the false statement.
   */
  async sweep(adminId: string): Promise<WardenSweepResult> {
    const cfg = this.requireWarden();
    const raw = await this.call<unknown>(cfg, '/sweep', {
      method: 'POST',
      body: { operatorId: adminId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    const board = this.normaliseCheckBoard(this.pick(raw, 'board'));
    const result: WardenSweepResult = {
      finished: this.pick(raw, 'finished') === true,
      // ⚠️ AN ABSENT `forced` IS `false`, NOT `true`. This read `!== false`,
      // so a daemon that omitted the field — an older one, or one whose
      // answer lost it — had its carried-forward board reported to the
      // operator as a full re-measure. That is the exact claim the field
      // exists to refuse (see WardenSweepResult.forced): every other default
      // in this file falls to the weaker statement, and "some of these rows
      // are older than you think" is the weaker statement here.
      forced: this.pick(raw, 'forced') === true,
      joined: this.pick(raw, 'joined') === true,
      // A board the daemon could not describe is an EMPTY board with a
      // complete zero-tally, never a partial one — normaliseCheckBoard fills
      // counts from the rows, so zero rows honestly tallies to zero of each.
      board:
        board ?? { lastCheckAt: null, counts: { ok: 0, warn: 0, bad: 0, unknown: 0 }, dropped: 0, rows: [], paused: null },
    };

    // ⚠️ AUDITED LIKE A PAUSE, AND FOR THE SAME REASON. A forced sweep runs
    // every check on the live box, the expensive ones budgeted sixty seconds
    // EACH at a concurrency of four — a repeatable load event somebody can
    // trigger from a button. The daemon has always REQUIRED an operatorId on
    // this route ("an audit trail that cannot name who stopped the watchdog
    // is not an audit trail") and then discarded it, and this side wrote no
    // row at all, so forcing one was the only Phase 4 action that left no
    // trace anywhere. Recorded AFTER the hop, like approve(), so the row says
    // what actually happened rather than what was asked for.
    await this.audit.record({
      adminUserId: adminId,
      action: 'WARDEN_SWEEP',
      resourceType: 'Warden',
      resourceId: 'daemon',
      newValue: {
        finished: result.finished,
        forced: result.forced,
        joined: result.joined,
        rows: result.board.rows.length,
      },
      reason: result.joined
        ? 'Asked for a full re-measure; joined the sweep already running'
        : 'Forced a full re-measure of the box, cadence ignored',
    });

    return result;
  }

  /**
   * Stop Warden diagnosing and raising proposals, for a while.
   *
   * 🚨 THE SITE BOARD'S "PAUSE WARDEN" BUTTON DID NOT DO THIS. It posted one
   * chat message — "Pause. Stop acting on your safe list and stop raising
   * proposals until I say otherwise." — which the daemon classified as a
   * QUESTION: its instruction parser matches exactly `remember:`, `forget: N`
   * and the bare standing-list words, so the sentence was handed to the model
   * for one turn and then forgotten. It was never stored, the next sweep
   * never saw it, and the word "pause" did not appear anywhere in the
   * daemon's source. The page's own comment claimed it "posts a standing
   * instruction", which was wrong in the daemon's vocabulary.
   *
   * ⚠️ WHAT PAUSES IS JUDGEMENT, NOT MEASUREMENT. The daemon keeps sweeping
   * on the same cadence and keeps announcing what turns; the model call and
   * any new proposal are what stop. Copy that says Warden is "stopped" or
   * "off" would be wrong, and a stale board read as a live one is exactly the
   * failure this whole module exists to prevent.
   *
   * ⚠️ IT EXPIRES. The daemon caps a pause at 24 hours and refuses an
   * open-ended one, because the pause nobody comes back to resume is a
   * watchdog silently switched off for a month.
   */
  async pause(adminId: string, dto: PauseWardenDto): Promise<{ ok: true; paused: WardenPause | null; messages: WardenChatMessage[] }> {
    const cfg = this.requireWarden();
    const reason = (dto.reason ?? '').trim();

    // ⚠️ THE PRIOR PAUSE IS READ, NOT ASSUMED. This row used to record a
    // literal `oldValue: { paused: null }` — "Warden was not paused before
    // this" — which is false every time an operator EXTENDS or replaces a
    // running pause, and extending is the common case: the deploy took longer
    // than the thirty minutes they first asked for. In the one row that
    // records who suspended the watchdog, an unread prior state asserted as
    // fact is worse than no field at all.
    //
    // ⚠️ IT IS NOT FREE, AND THE SCENARIO WHERE IT COSTS MOST IS THE ONE
    // THIS SENTENCE USED TO CALL FREE. checkBoard() never throws — it returns
    // null and the row then records the prior state AS unknown rather than as
    // "not paused", which are different claims and the row says which. But it
    // is awaited BEFORE the pause is issued, on a READ_TIMEOUT_MS (8s)
    // AbortSignal, and a daemon that "does not answer" because it is HUNG
    // burns the whole 8 seconds before POST /pause leaves this process. The
    // operator is usually hitting pause because something is wrong, so the
    // hung case is not the rare one. Worst case is 8s + WRITE_TIMEOUT_MS
    // (25s) = 33s, inside nginx's 60s cut — so it is slow, never a 502.
    //
    // Still the right trade: the row that records who suspended the watchdog
    // is read after the fact, in an argument about what the box was doing,
    // and a fabricated `oldValue` there is permanent. Eight seconds of
    // latency is recoverable; an audit row asserting "Warden was not paused
    // before this" over an operator EXTENDING a running pause is not.
    // ⚠️ If this ever has to get faster, shorten the pre-read's own timeout —
    // do NOT move it after the pause, which would read a board that the pause
    // itself has already changed.
    const before = await this.checkBoard();

    const raw = await this.call<unknown>(cfg, '/pause', {
      method: 'POST',
      body: { operatorId: adminId, minutes: dto.minutes, reason: reason || undefined },
      timeoutMs: WRITE_TIMEOUT_MS,
    });

    const paused = this.normalisePause(this.pick(raw, 'paused'));
    await this.audit.record({
      adminUserId: adminId,
      action: 'WARDEN_PAUSE',
      resourceType: 'Warden',
      resourceId: 'daemon',
      oldValue: before ? { paused: before.paused } : { paused: 'unknown', note: 'the daemon did not answer the pre-pause read' },
      newValue: { paused },
      // ⚠️ AUDITED LIKE AN APPROVE. Suspending the thing that watches the box
      // is an operational decision somebody has to be able to point at later;
      // AdminAuditService.record() throws on an empty reason, so one is
      // synthesised when the operator typed none.
      reason: reason || `Paused Warden for ${dto.minutes ?? 'the default'} minutes`,
    });

    return { ok: true as const, paused, messages: this.normaliseMessages(this.pick(raw, 'messages')) };
  }

  /** Back to work now. Resuming a Warden that is not paused is not an error —
   *  it is the operator making sure, which is the right instinct. */
  async resume(adminId: string): Promise<{ ok: true; paused: null; messages: WardenChatMessage[] }> {
    const cfg = this.requireWarden();
    const raw = await this.call<unknown>(cfg, '/resume', {
      method: 'POST',
      body: { operatorId: adminId },
      timeoutMs: WRITE_TIMEOUT_MS,
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'WARDEN_RESUME',
      resourceType: 'Warden',
      resourceId: 'daemon',
      newValue: { paused: null },
      reason: 'Resumed Warden',
    });

    return { ok: true as const, paused: null, messages: this.normaliseMessages(this.pick(raw, 'messages')) };
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

  /**
   * A non-negative whole number the daemon sent, or 0.
   *
   * ⚠️ 0 HERE MEANS "NO USABLE NUMBER ARRIVED", NOT "NOTHING WAS DROPPED",
   * and the only caller adds it to a count of its own — so an absent or
   * garbage field can only ever UNDER-state a gap, never invent one. A
   * daemon too old to send `dropped` is exactly that case.
   */
  private count(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
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
      paused: this.normalisePause(this.pick(raw, 'paused')),
    };
  }

  /**
   * ⚠️ A PAUSE WITH NO PARSEABLE `until` IS NOT A PAUSE. The two wrong
   * answers are not symmetrical: a garbage pause rendered as live shows the
   * operator "paused until Invalid Date" on a Warden that is working
   * normally, while a garbage pause dropped shows a working Warden as
   * working. Dropping is the survivable mistake.
   *
   * ⚠️ AN ALREADY-EXPIRED PAUSE IS ALSO DROPPED HERE. The daemon evaluates
   * expiry on every read and should never send one — but a clock skew of a
   * few seconds between the two processes must not put a stale "paused"
   * banner on the board.
   */
  private normalisePause(raw: unknown): WardenPause | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const until = this.iso(r.until);
    if (!until) return null;
    if (Date.parse(until) <= Date.now()) return null;
    return {
      until,
      since: this.iso(r.since) ?? until,
      operatorId: typeof r.operatorId === 'string' ? this.text(r.operatorId, 64) : null,
      reason: typeof r.reason === 'string' && r.reason.trim() ? this.text(r.reason, 500) : null,
    };
  }

  /**
   * 🚨 THIS READ USED TO BE THE ONE THE DAEMON WAS TRUSTED ON. checkBoard()
   * did `this.call<WardenCheckBoard>(…)` and returned the object after a
   * single `Array.isArray(board?.rows)` test — so daemon-authored, partly
   * model-written `verdict` strings reached the admin browser unclamped and
   * unvalidated, and a `counts: null` from a freshly-restarted daemon sailed
   * through behind a NON-NULL declaration into DeskSiteService.board(), which
   * reads `warden.counts.bad` off it. Every other daemon read in this file
   * was normalised; this one was not, and it had no test coverage at all.
   *
   * ⚠️ counts IS TALLIED FROM THE ROWS WHEN THE DAEMON SENDS NONE, not
   * defaulted to zeroes independently of them. Zero rows honestly tallies to
   * zero of each; a row the daemon has never run carries status 'unknown' and
   * counts as one. What must never happen is four zeroes beside a board full
   * of bad rows.
   *
   * ⚠️ AND A ROW THIS SIDE CANNOT READ IS COUNTED AS A ROW THIS SIDE CANNOT
   * READ. Re-tallying from the surviving rows fixed a real TypeError (a
   * `counts: null` from a restarted daemon), but it also meant a row with an
   * unnameable status vanished from `rows` AND from `counts` with nothing
   * logged and nothing on the board — a red gate that silently stopped being
   * counted, which is the one direction this module must never fail in. It
   * is NOT bucketed into `counts.unknown`: that bucket is the daemon's own
   * "measured nothing yet", and a row we failed to parse is our problem, not
   * a measurement. `dropped` is separate: it is appended to the site board's
   * warden note and logged here for the box. ⚠️ No Desk surface reads that
   * note yet (see desk-site.service.ts), so the log line is the channel that
   * actually reaches a human today.
   */
  private normaliseCheckBoard(raw: unknown): WardenCheckBoard | null {
    const rawRows = this.pick(raw, 'rows');
    if (!Array.isArray(rawRows)) return null;

    const rows: WardenCheckRow[] = [];
    let dropped = 0;
    for (const item of rawRows.slice(0, MAX_CHECK_ROWS)) {
      const row = this.normaliseCheckRow(item);
      if (row) rows.push(row);
      else dropped += 1;
    }
    if (dropped > 0) {
      this.logger.warn(
        `Warden board: ${dropped} check row(s) failed our wire rules and are not tallied. ` +
          'Likely a daemon/backend version skew — warden deploys as a separate, non-fatal stage.',
      );
    }

    const counts = { ok: 0, warn: 0, bad: 0, unknown: 0 };
    for (const r of rows) counts[r.status] += 1;

    return {
      lastCheckAt: this.iso(this.pick(raw, 'lastCheckAt')),
      counts,
      dropped,
      rows,
      paused: this.normalisePause(this.pick(raw, 'paused')),
    };
  }

  /** ⚠️ A ROW WITH NO RECOGNISED STATUS IS DROPPED, NOT DEFAULTED TO 'ok' OR
   *  TO 'unknown'. The Site tiles colour on it and DeskSiteService reads the
   *  verdict as the tile's value; a mis-spelled status coerced either way is
   *  a measurement this process has invented. */
  private normaliseCheckRow(raw: unknown): WardenCheckRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = this.text(r.id, 64);
    if (!id) return null;
    const status = CHECK_STATUSES.find((s) => s === r.status);
    if (!status) return null;
    const measuredAt = this.iso(r.measuredAt);
    if (!measuredAt) return null;
    return {
      id,
      title: this.text(r.title, 300) || id,
      status,
      // Clamped hard: this sentence is partly model-written on the daemon's
      // side and lands in an admin browser.
      verdict: this.text(r.verdict, 1_000),
      gateKey: this.text(r.gateKey, 100) || null,
      standing: r.standing === true,
      measuredAt,
      fresh: r.fresh === true,
    };
  }

  /**
   * One audit record. Dropped rather than repaired where the daemon sent
   * something this API cannot name — same rule as a chat message, and for a
   * stronger reason: a record IS the account of what ran on the box, and a
   * half-understood one read as authoritative is worse than a gap somebody
   * has to go and explain.
   */
  private normaliseAuditEntry(raw: unknown): WardenAuditEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const id = this.text(r.id, 64);
    const at = this.iso(r.at);
    if (!id || !at) return null;

    const trigger = AUDIT_TRIGGERS.find((t) => t === r.trigger);
    if (!trigger) return null;
    const operationKind = AUDIT_OPERATION_KINDS.find((k) => k === r.operationKind);
    if (!operationKind) return null;

    const command = this.text(r.command, 8_000);
    if (!command) return null;

    const proposalId = this.text(r.proposalId, 64);
    const recheckResult = RECHECK_RESULTS.find(
      (v) => v === (r.recheck as Record<string, unknown> | undefined)?.result,
    );
    const recheckAt = this.iso((r.recheck as Record<string, unknown> | undefined)?.at);

    return {
      id,
      proposalId: proposalId && PROPOSAL_ID_RE.test(proposalId) ? proposalId : '',
      at,
      // ⚠️ FALLS BACK TO `at`, NOT TO `now`. A record with an unreadable
      // finish time still finished at some point in the past; stamping it
      // with the current clock would make an old run look like it is
      // happening while the operator watches.
      finishedAt: this.iso(r.finishedAt) ?? at,
      durationMs: typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) ? r.durationMs : 0,
      trigger,
      operatorId: typeof r.operatorId === 'string' ? this.text(r.operatorId, 64) : null,
      operationKind,
      operationName: typeof r.operationName === 'string' ? this.text(r.operationName, 64) : null,
      command,
      exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
      timedOut: r.timedOut === true,
      stdout: this.normaliseTruncated(r.stdout),
      stderr: this.normaliseTruncated(r.stderr),
      // ⚠️ ALWAYS AN ARRAY. Empty means nothing was redacted; absent would
      // leave a reader unable to tell that from redaction never having run.
      redactions: Array.isArray(r.redactions) ? r.redactions.map((x) => this.text(x, 100)).filter(Boolean) : [],
      // ⚠️ AN UNRECOGNISED RESULT COLLAPSES TO null ("nobody looked"), never
      // to 'unknown' ("looked and could not tell"). Claiming a re-check that
      // did not happen is the worse of the two.
      recheck:
        recheckResult && recheckAt
          ? {
              at: recheckAt,
              result: recheckResult,
              note: this.text((r.recheck as Record<string, unknown>).note, MAX_TEXT),
            }
          : null,
    };
  }

  /**
   * ⚠️ `originalBytes` IS NEVER RECOMPUTED FROM THE TEXT IN HAND. It is the
   * size of the command's output BEFORE the daemon truncated it, and the
   * whole point of the field is telling a reader how much they are NOT
   * looking at. Measuring the clamped copy would report an 8 KB excerpt of a
   * 4 MB log as the complete output.
   */
  private normaliseTruncated(raw: unknown): WardenTruncatedText {
    if (!raw || typeof raw !== 'object') return { text: '', truncated: false, originalBytes: 0 };
    const r = raw as Record<string, unknown>;
    const full = typeof r.text === 'string' ? r.text : '';
    const text = full.slice(0, MAX_AUDIT_OUTPUT);
    return {
      truncated: r.truncated === true || text.length < full.length,
      text,
      originalBytes:
        typeof r.originalBytes === 'number' && Number.isFinite(r.originalBytes) && r.originalBytes >= 0
          ? r.originalBytes
          : Buffer.byteLength(full, 'utf8'),
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
