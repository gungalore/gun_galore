// warden/src/state/core.ts
//
// THE CORE — everything the five HTTP routes actually do, with no HTTP in it.
// server.ts is transport and auth; this is the daemon.
//
// THREE PROPERTIES THIS FILE IS RESPONSIBLE FOR:
//
//   1. NO REQUEST WAITS FOR A MEASUREMENT. GET /chat and GET /proposals/:id
//      read memory and return. A sweep is a background job on its own timer
//      (nginx cuts at 60s, Cloudflare at 100s, and the backend's own read
//      budget is 8s — a sweep is not an 8s job). POST /chat is the one turn
//      that may legitimately wait for a model, and it waits under its OWN
//      budget, well inside the backend's 25s write timeout; if the model is
//      slower than that the request answers anyway and the answer lands in
//      the thread on the next poll.
//
//   2. NO RUN IS AWAITED IN A HANDLER. Approve records the decision, starts
//      the run, and returns. rerunBackup alone is budgeted ten minutes; a
//      handler that awaited it would turn a working fix into a false 503
//      while the command kept running unattended — the exact failure the
//      confirm dialog exists to prevent.
//
//   3. THE COMPARE-AND-SWAP IS DONE HERE TOO. The Nest backend re-reads the
//      proposal and refuses on drift before it ever calls this daemon, and
//      exec/executor.ts refuses again before it runs anything. This is the
//      middle of those three, and it exists because the backend's read and
//      its approve POST are two round trips with a gap between them: a
//      daemon that trusted the caller to have checked would be trusting a
//      check it cannot see.

import { setTimeout as delay } from 'node:timers/promises';
import {
  ALL_CHECKS,
  runOne,
  runSweep,
  type CheckContext,
  type CheckModule,
  type CheckResult,
  type CheckStatus,
  type Sweep,
  type SweepMemory,
  type WardenAuditEntry,
  type WardenAuditView,
  type WardenChatMessage,
  type WardenCheckBoard,
  type WardenCheckRow,
  type WardenPause,
  type WardenProposal,
} from '../checks/index.js';
import { createRuntime, runApprovedProposal, type ExecRuntime, type WardenAuditRecord } from '../exec/index.js';
import { diagnose, type DiagnosisInput, type DiagnosisResult, type ModelCaller } from '../diagnose/index.js';
import {
  declinedMessage,
  findingMessage,
  fixedMessage,
  note,
  operatorSaid,
  projectAudit,
  projectProposal,
  ranMessage,
  standingList,
  startedMessage,
} from './messages.js';
import { WIRE_AUDIT_LIMIT, type StoredProposal, type WardenStore } from './store.js';

/** A sweep whose faults are unchanged is re-diagnosed no more often than
 *  this — the checks keep running every tick, but a model call for the same
 *  three red rows every minute buys nothing and costs money. A CHANGE in the
 *  fault set bypasses it entirely. */
const DEFAULT_DIAGNOSE_MIN_INTERVAL_MS = 30 * 60_000;

/** POST /chat's own ceiling. The backend cuts a write at 25s and has already
 *  spent part of that; this leaves room for the answer to get back. */
const DEFAULT_CHAT_BUDGET_MS = 18_000;

/** A first boot on a box with no permissions provisioned can turn twenty-odd
 *  rows at once. Announcing each one individually buries the one that
 *  matters, so past this many the rest are summarised in a single line —
 *  named, never silently dropped. */
const MAX_TRANSITION_MESSAGES = 8;

/**
 * How long POST /sweep waits for a forced sweep before answering anyway.
 *
 * ⚠️ SIZED AGAINST THE BACKEND'S WRITE TIMEOUT (25s) AND NGINX'S CUT (60s),
 * NOT AGAINST HOW LONG A SWEEP TAKES. A full forced sweep runs every check,
 * and the expensive ones are budgeted sixty seconds EACH at concurrency four
 * — it can legitimately outlive both. Holding the connection until it
 * finished would give the operator a 502 while the sweep carried on unseen,
 * which is the one outcome the whole "no request waits for a measurement"
 * rule exists to prevent. Answering early with `finished: false` is true and
 * useful; the sweep lands on the board by itself.
 */
const DEFAULT_SWEEP_BUDGET_MS = 20_000;

export type CoreFailure = { ok: false; status: 400 | 404 | 409 | 503; reason: string };
export type CoreMessages = { ok: true; messages: WardenChatMessage[] };
export type CoreResult = CoreMessages | CoreFailure;

/**
 * ⚠️ THE BOARD-ROW SHAPE IS `WardenCheckRow`, IN types.ts, AND THERE IS NO
 * LOCAL ALIAS FOR IT ANY MORE. It used to be declared here as `GateRow`,
 * outside anything either side calls a mirror, while the backend held its
 * own twin under a different name — so the two agreed by luck and adding a
 * field to one was completely silent. The alias that replaced the
 * declaration was kept on the stated grounds that "callers import it by this
 * name"; a repo-wide grep found no such caller, inside warden/ or out (the
 * daemon has no import path into the backend at all), so it was a dead name
 * keeping a dead premise alive. Import WardenCheckRow. Do not bring either
 * the alias or the declaration back.
 */

/**
 * How long a pause may last, and what you get if you ask for nothing.
 *
 * ⚠️ THERE IS NO "PAUSE INDEFINITELY", AND THAT IS THE POINT. A pause is set
 * during an incident or a deploy, by somebody who is mid-something else, and
 * the one thing nobody ever does is come back and resume it. An open-ended
 * pause is a Warden that has silently stopped proposing fixes for a month
 * while the board still says it is watching. Twenty-four hours is long enough
 * to cover any deploy or maintenance window on this box and short enough that
 * a forgotten pause fixes itself.
 */
const MAX_PAUSE_MINUTES = 24 * 60;
const DEFAULT_PAUSE_MINUTES = 60;

export interface CoreOptions {
  store: WardenStore;
  ctx: CheckContext;
  memory: SweepMemory;
  caller: ModelCaller | null;
  checks?: readonly CheckModule[];
  exec?: ExecRuntime;
  now?: () => Date;
  diagnoseMinIntervalMs?: number;
  chatBudgetMs?: number;
  /** Where a background failure goes. The daemon logs it; swallowing one
   *  would make a broken approval path look like a silent one. */
  onError?: (where: string, error: string) => void;
}

export class WardenCore {
  private readonly store: WardenStore;
  private readonly ctx: CheckContext;
  private readonly memory: SweepMemory;
  private readonly caller: ModelCaller | null;
  private readonly checks: readonly CheckModule[];
  private readonly exec: ExecRuntime;
  private readonly now: () => Date;
  private readonly diagnoseMinIntervalMs: number;
  private readonly chatBudgetMs: number;
  private readonly onError: (where: string, error: string) => void;

  /**
   * The sweep currently running, if one is.
   *
   * ⚠️ A PROMISE, NOT A BOOLEAN, BECAUSE POST /sweep HAS TO JOIN ONE. The
   * boolean this replaced could only answer "is one running", which is all
   * tick() needs — it refuses overlap and returns. An operator who has just
   * fixed something and asked for a re-measure must not be told "no" because
   * the 60-second loop happened to fire half a second earlier; they have to
   * be able to wait for the answer. `forced` travels with it so the response
   * can say whether the board they got back was a full re-measure or a
   * cadence sweep they joined, which are different claims about how much of
   * it is fresh.
   */
  private inFlight: { promise: Promise<Sweep | null>; forced: boolean } | null = null;
  private lastSweep: Sweep | null = null;
  private lastFaultSignature: string | null = null;
  private lastDiagnoseAt = 0;
  /** Work that outlives the request that started it. Held so shutdown can
   *  wait for a run to finish writing its audit record rather than losing it. */
  private readonly background = new Set<Promise<unknown>>();

  constructor(opts: CoreOptions) {
    this.store = opts.store;
    this.ctx = opts.ctx;
    this.memory = opts.memory;
    this.caller = opts.caller;
    this.checks = opts.checks ?? ALL_CHECKS;
    this.exec = opts.exec ?? createRuntime();
    this.now = opts.now ?? (() => new Date());
    this.diagnoseMinIntervalMs = opts.diagnoseMinIntervalMs ?? DEFAULT_DIAGNOSE_MIN_INTERVAL_MS;
    this.chatBudgetMs = opts.chatBudgetMs ?? DEFAULT_CHAT_BUDGET_MS;
    this.onError = opts.onError ?? (() => undefined);
  }

  // ── GET /chat ─────────────────────────────────────────────────────────

  /** Memory only. Never a sweep, never a model call — see property 1. */
  chat(): {
    lastCheckAt: string | null;
    messages: WardenChatMessage[];
    proposals: WardenProposal[];
    paused: WardenPause | null;
  } {
    const { lastCheckAt, messages, proposals, dropped } = this.store.snapshot();
    if (dropped > 0) this.onError('snapshot', `${dropped} stored record(s) failed our own wire rules and were not sent`);
    // ⚠️ THE PAUSE RIDES ON THE THREAD, NOT ONLY ON THE BOARD. The Desk's
    // chat panel is where an operator looks to see whether Warden is working;
    // a paused Warden that simply says nothing is indistinguishable from a
    // healthy one with nothing to report, which is this project's signature
    // failure mode.
    return { lastCheckAt, messages, proposals, paused: this.pausedNow() };
  }

  // ── GET /proposals/:id ────────────────────────────────────────────────

  /**
   * ⚠️ ALWAYS FRESH FROM THE STORE, NEVER FROM A CACHED SWEEP. The backend's
   * compare-and-swap is only as good as this read: if a proposal's command
   * changed after the Desk rendered the confirm, this is where that must
   * show. A cached answer here would let the swap pass when it should have
   * blocked, and the money-grade confirm would still look like it worked.
   */
  proposal(id: string): WardenProposal | null {
    const stored = this.store.getProposal(id);
    return stored ? projectProposal(stored) : null;
  }

  // ── POST /chat ────────────────────────────────────────────────────────

  async say(message: string, operatorId: string): Promise<CoreResult> {
    const at = this.now().toISOString();
    const echo = operatorSaid(at, message);
    const emitted: WardenChatMessage[] = [echo];

    const instruction = parseInstruction(message);

    if (instruction.kind === 'remember') {
      await this.store.addStanding(instruction.text, operatorId, 'operator');
      emitted.push(standingList(this.store.standingInstructions(), at, 'Noted — I will hold you to that.'));
      await this.store.appendMessages(emitted);
      return { ok: true, messages: emitted };
    }

    if (instruction.kind === 'forget') {
      const removed = await this.store.removeStanding(instruction.index);
      emitted.push(
        removed
          ? standingList(this.store.standingInstructions(), at, `Dropped "${removed.text}".`)
          : standingList(this.store.standingInstructions(), at, `I have no standing instruction ${instruction.index}.`),
      );
      await this.store.appendMessages(emitted);
      return { ok: true, messages: emitted };
    }

    if (instruction.kind === 'list') {
      emitted.push(standingList(this.store.standingInstructions(), at, 'Here they are.'));
      await this.store.appendMessages(emitted);
      return { ok: true, messages: emitted };
    }

    // A real turn. The echo goes in first so the operator's own line is in
    // the thread even if the model never answers.
    await this.store.appendMessages([echo]);

    if (!this.caller) {
      const m = note(at, [
        'I cannot answer that: ANTHROPIC_API_KEY is not set on this box, so the diagnosis step has no credential to call Claude with. The checks still run and the board is still measured — but nothing turns it into an answer.',
      ]);
      await this.store.appendMessages([m]);
      return { ok: true, messages: [echo, m] };
    }

    const turn = this.runTurn(message).catch((err: unknown) => {
      this.onError('chat-turn', errorText(err));
      return [] as WardenChatMessage[];
    });
    this.track(turn);

    const raced = await Promise.race([
      turn.then((messages) => ({ done: true as const, messages })),
      // ⚠️ ref:false — a live 18s timer left behind by every chat turn would
      // keep the process alive that much longer on shutdown for no reason.
      delay(this.chatBudgetMs, undefined, { ref: false }).then(() => ({ done: false as const, messages: [] as WardenChatMessage[] })),
    ]);

    if (raced.done) return { ok: true, messages: [echo, ...raced.messages] };

    // ⚠️ ANSWER, DON'T HANG. The backend aborts at 25s and reports "Warden
    // did not answer"; the turn is still running and will append when it
    // lands, so saying so is both true and more useful than a 503.
    const waiting = note(at, [
      'I am still working on that one. I have answered now rather than hold the Desk open past its timeout — the reply will appear in this thread by itself, so give it a moment and look again.',
    ]);
    await this.store.appendMessages([waiting]);
    return { ok: true, messages: [echo, waiting] };
  }

  private async runTurn(operatorMessage: string): Promise<WardenChatMessage[]> {
    const result = await diagnose(this.diagnosisInput({ operatorMessage }), { caller: this.caller });
    return this.ingest(result);
  }

  // ── POST /proposals/:id/approve ───────────────────────────────────────

  async approve(id: string, operatorId: string, expectedCommand: string): Promise<CoreResult> {
    const p = this.store.getProposal(id);
    if (!p) return { ok: false, status: 404, reason: 'No such proposal.' };
    // Rule 6. Refused by kind before anything else looks at the command,
    // because a red gate is not a thing that can be approved at all.
    if (p.kind === 'red_gate') return { ok: false, status: 400, reason: 'A red gate has no fix to approve.' };
    if (p.status !== 'pending') return { ok: false, status: 409, reason: `That proposal is already ${p.status}.` };
    if (!p.command) return { ok: false, status: 409, reason: 'That proposal no longer holds a command.' };
    // Byte for byte. Not trimmed, not case-folded: a command that differs by
    // a space is a command the operator did not read.
    if (p.command !== expectedCommand) return { ok: false, status: 409, reason: 'That command changed since you opened it.' };

    const at = this.now().toISOString();
    // ⚠️ SNAPSHOT BEFORE THE FLIP, AND HAND THE EXECUTOR THE SNAPSHOT.
    // `p` is the live stored object; settle() mutates it. The executor
    // re-validates everything it is given, INCLUDING that the proposal is
    // pending — so handing it the post-flip object would make it refuse every
    // approval as "already approved" and nothing would ever run.
    //
    // The status flip is THIS layer's concurrency guard: a second approve for
    // the same id is refused 409 above, before it can reach here. What the
    // executor is re-checking is the part that matters and that this layer
    // cannot vouch for on its own — that the stored command still equals what
    // the operator read, and that a safe-list operation still builds it.
    const asApproved: StoredProposal = { ...p };
    // The APPROVAL is the human's decision and it is recorded now, whatever
    // the run then does. Whether the command succeeded is the audit record's
    // business, not this field's.
    await this.store.settle(id, 'approved', { operatorId });
    const started = startedMessage(asApproved, at);
    await this.store.appendMessages([started]);

    this.track(
      this.execute(asApproved, expectedCommand, operatorId).catch((err: unknown) => {
        this.onError('approve-run', errorText(err));
      }),
    );

    return { ok: true, messages: [started] };
  }

  private async execute(p: StoredProposal, expectedCommand: string, operatorId: string): Promise<void> {
    const outcome = await runApprovedProposal(p, expectedCommand, operatorId, this.exec);

    if (!outcome.ok) {
      // The executor refused after we had already recorded the decision —
      // most plausibly because the safe list itself changed between the
      // proposal being raised and it being approved. Put it back on the
      // board: leaving it "approved" would claim something ran that did not.
      await this.store.reopen(p.id);
      await this.store.appendMessages([
        note(this.now().toISOString(), [
          `I did not run that after all. ${outcome.reason}`,
          'I have put it back on the board as pending. Nothing was executed.',
        ]),
      ]);
      return;
    }

    // Re-check BEFORE the transcript goes out, so the one message an operator
    // reads says both what happened and whether it worked. The wait is
    // bounded by the checks' own timeouts and they are watching a "started"
    // note in the meantime.
    const record = { ...outcome.record, recheck: await this.recheck(p) };
    await this.store.recordAudit(record);
    await this.store.appendMessages([ranMessage(record, this.now().toISOString())]);
  }

  /**
   * Re-measure exactly the checks this proposal was diagnosed from, ignoring
   * cadence — "re-check after a fix" must never be answered from a cached row.
   * Returns null when there is nothing to re-measure: `null` and
   * `{result:'unknown'}` are deliberately different claims, and collapsing
   * "nobody looked" into "looked and could not tell" is the plausible zero
   * this daemon exists to refuse.
   */
  private async recheck(p: StoredProposal): Promise<WardenAuditRecord['recheck']> {
    // Looked up in THIS core's own check list, not the global registry: a core
    // built with a subset must never re-measure something outside it, and the
    // two are the same object in production anyway.
    const modules = p.checkIds
      .map((id) => this.checks.find((c) => c.id === id) ?? null)
      .filter((m): m is CheckModule => m !== null);
    if (modules.length === 0) return null;

    const results = await Promise.all(modules.map((m) => runOne(m, this.ctx)));
    for (const r of results) this.memory.results.set(r.id, r);
    await this.store.setStatuses(Object.fromEntries(results.map((r) => [r.id, r.status])));

    const worst: CheckStatus = results.some((r) => r.status === 'bad')
      ? 'bad'
      : results.some((r) => r.status === 'warn')
        ? 'warn'
        : results.some((r) => r.status === 'unknown')
          ? 'unknown'
          : 'ok';

    return {
      at: this.now().toISOString(),
      result: worst === 'ok' ? 'ok' : worst === 'unknown' ? 'unknown' : 'still-bad',
      note: results.map((r) => `${r.id}: ${r.verdict}`).join(' | ').slice(0, 1_000),
    };
  }

  // ── POST /proposals/:id/decline ───────────────────────────────────────

  async decline(id: string, operatorId: string, reason?: string): Promise<CoreResult> {
    const p = this.store.getProposal(id);
    if (!p) return { ok: false, status: 404, reason: 'No such proposal.' };
    if (p.kind === 'red_gate') return { ok: false, status: 400, reason: 'A red gate cannot be declined — it needs a commit or a config change.' };
    if (p.status !== 'pending') return { ok: false, status: 409, reason: `That proposal is already ${p.status}.` };

    // ⚠️ An absent `reason` key and an empty one are the SAME case. The
    // backend drops an empty reason from the JSON body entirely
    // (JSON.stringify omits undefined), so "no reason given" arrives as a
    // missing key, never as "" or null.
    const given = typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null;

    const at = this.now().toISOString();
    await this.store.settle(id, 'declined', { operatorId, reason: given });
    // A declined reason IS an instruction, whether or not it was phrased as
    // one — "leave the overnight retries alone" said once must not have to be
    // said again next sweep.
    if (given) await this.store.addStanding(given, operatorId, 'decline');

    const messages = [declinedMessage(p, given, at)];
    await this.store.appendMessages(messages);
    return { ok: true, messages };
  }

  // ── the board, for a curl on the box ──────────────────────────────────

  /**
   * The measured board.
   *
   * 🚨 THE HEADER COMMENT THAT USED TO SIT HERE SAID THIS ROUTE WAS "NOT
   * PROXIED" AND THAT "NOTHING IN THE APP DEPENDS ON IT". THAT IS FALSE AND
   * HAS BEEN FOR SOME TIME. WardenService.checkBoard() calls GET /gates, and
   * DeskController's GET /admin/desk/site/board renders the Site page's four
   * vital tiles out of it. What is NOT proxied is the Desk's own
   * /admin/warden/gates, which is a different fact entirely — CONFIG gates
   * read inside the Nest process. Anyone who trusted the old comment while
   * refactoring this route table would have taken the Site board down.
   *
   * ⚠️ `counts: null` BEFORE THE FIRST SWEEP IS NOT ZERO OF EVERYTHING. A
   * daemon that restarted ninety seconds ago has measured nothing yet, and
   * four zeroes render as a clean board on an unwatched box.
   */
  gates(): WardenCheckBoard {
    const sweep = this.lastSweep;
    const paused = this.pausedNow();
    if (!sweep) return { lastCheckAt: this.store.lastCheckAt, counts: null, rows: [], paused };
    return {
      lastCheckAt: this.store.lastCheckAt,
      counts: sweep.counts,
      rows: sweep.results.map(toRow),
      paused,
    };
  }

  // ── GET /audit ────────────────────────────────────────────────────────

  /**
   * Every execution this daemon has a record of, newest first.
   *
   * 🚨 THIS EXISTS BECAUSE THE AUDIT TRAIL WAS WRITE-ONLY. recordAudit() has
   * persisted the operation, its resolved arguments, the exit code and the
   * verbatim redacted transcript of every run since the daemon shipped — and
   * WardenStore.auditFor() had only TEST callers. No HTTP route returned a
   * record, no backend route proxied one, and nothing on the Desk read one.
   * The operator's only view of a run was its `ran` chat message, which ages
   * out of a 600-message on-disk window and a 200-message wire window; after
   * that, "what has this agent run on the production box" was a question you
   * answered by SSH-ing in and reading JSON.
   *
   * Phase 4's rule is that you must be able to READ everything it has done,
   * FORCE it to look, and STOP it, before it is given any more reach. This is
   * the read half.
   */
  audit(opts: { proposalId?: string; limit?: number } = {}): WardenAuditView {
    const limit = clampInt(opts.limit, 1, WIRE_AUDIT_LIMIT, WIRE_AUDIT_LIMIT);
    const { entries, truncated } = this.store.auditRecent({ proposalId: opts.proposalId, limit });
    const wire: WardenAuditEntry[] = [];
    let dropped = 0;
    for (const e of entries) {
      const projected = projectAudit(e);
      if (projected) wire.push(projected);
      else dropped += 1;
    }
    // Same reason snapshot() counts its drops: the far side normalises by
    // dropping SILENTLY, and a run that happened and then failed to arrive is
    // the one record whose disappearance matters most.
    //
    // 🚨 THE COUNT GOES ON THE WIRE, NOT ONLY INTO onError. onError reaches
    // this daemon's pm2 stdout and nothing else, so while that was its only
    // destination a caller saw a shorter list beside `truncated: false` with
    // no way to tell an incomplete account of what ran on the box from a
    // complete one. The backend ADDS its own drop count to this one and
    // reports the sum.
    //
    // ⚠️ THAT SUM IS ON THE API, NOT YET IN FRONT OF ANYBODY. Nothing under
    // frontend/ fetches GET /admin/warden/audit — the Site board's audit
    // drawer reads the AdminAudit table, which is a different trail — so today
    // the number is visible to someone curling the route with an admin token
    // and to the Nest warn line, and that is all. Do not upgrade this comment
    // to "the operator reads it" until a surface renders it; that overclaim is
    // the same shape as the silent drop this field exists to fix.
    if (dropped > 0) this.onError('audit', `${dropped} audit record(s) failed our own wire rules and were not sent`);
    return { entries: wire, truncated, dropped };
  }

  // ── POST /pause, POST /resume ─────────────────────────────────────────

  /**
   * Hold off on DIAGNOSIS and PROPOSALS until a stated instant.
   *
   * 🚨 THE SITE BOARD'S "PAUSE WARDEN" BUTTON DID NOT DO THIS. It posted one
   * chat message reading "Pause. Stop acting on your safe list and stop
   * raising proposals until I say otherwise." parseInstruction() matches
   * exactly three literal forms — `remember:`, `forget: N` and the bare
   * standing-list words — so that sentence fell through to `question`: it was
   * handed to the model as prose for ONE turn and then forgotten. It was not
   * stored as a standing instruction, the next sweep never saw it, and the
   * word "pause" did not appear anywhere in this daemon's source. The page's
   * own fine print ("to stop it outright, stop the daemon on the box") was
   * the only accurate part of it.
   *
   * ⚠️ CHECKS KEEP RUNNING. What stops is the model call and the raising of
   * proposals; the sweep loop, the board, the statuses and the transition
   * messages all carry on. A paused Warden that stopped measuring would be
   * reporting health it has not checked — the board would freeze at whatever
   * it said the moment the operator hit pause, and nothing would say so.
   */
  async pause(opts: { minutes?: number; operatorId: string; reason?: string | null }): Promise<CoreResult> {
    const minutes = clampInt(opts.minutes, 1, MAX_PAUSE_MINUTES, DEFAULT_PAUSE_MINUTES);
    const now = this.now();
    const at = now.toISOString();
    const reason = typeof opts.reason === 'string' && opts.reason.trim() !== '' ? opts.reason.trim().slice(0, 500) : null;
    const pause: WardenPause = {
      until: new Date(now.getTime() + minutes * 60_000).toISOString(),
      since: at,
      operatorId: opts.operatorId,
      reason,
    };
    await this.store.setPause(pause);

    const messages = [
      note(at, [
        `Paused until ${pause.until}. I will keep measuring the box on the same cadence and I will keep telling you what turns — what I am holding is the diagnosis and any new proposal.${reason ? ` You said: "${reason}"` : ''}`,
        'This expires by itself. I do not have an indefinite pause, because the one nobody ever comes back to resume is the one that reads as a quiet Warden for a month.',
      ]),
    ];
    await this.store.appendMessages(messages);
    return { ok: true, messages };
  }

  /** Back to work now, whatever the pause said. Resuming a Warden that is not
   *  paused is not an error — it is the operator making sure. */
  async resume(operatorId: string): Promise<CoreResult> {
    const at = this.now().toISOString();
    const was = this.pausedNow();
    await this.store.clearPause();
    const messages = [
      note(at, [
        was
          ? `Resumed by ${operatorId}. I was holding diagnosis and proposals until ${was.until}; I am doing both again from the next sweep.`
          : 'I was not paused, so there was nothing to resume. Diagnosis and proposals are running.',
      ]),
    ];
    await this.store.appendMessages(messages);
    return { ok: true, messages };
  }

  /**
   * The pause as it stands RIGHT NOW — null once it has expired, whether or
   * not anything has cleared the stored record yet.
   *
   * ⚠️ EXPIRY IS EVALUATED ON EVERY READ, NOT ON A TIMER. A timer that fired
   * the resume would be a timer that does not survive a restart, and the
   * first thing a paused daemon does after a deploy is restart. Reading the
   * clock means a pause set before a `pm2 reload` still ends when it said it
   * would.
   */
  pausedNow(): WardenPause | null {
    const stored = this.store.pause;
    if (!stored) return null;
    const until = Date.parse(stored.until);
    if (!Number.isFinite(until) || until <= this.now().getTime()) return null;
    return stored;
  }

  // ── the sweep loop ────────────────────────────────────────────────────

  /**
   * One turn of the background loop. Never called from a request handler.
   * Overlap is refused rather than queued: a sweep that ran long is already
   * telling you the box is busy, and stacking a second one on top of it is
   * the wrong response.
   */
  async tick(): Promise<Sweep | null> {
    // ⚠️ REFUSED, NOT QUEUED, AND NOT JOINED. A sweep that ran long is already
    // telling you the box is busy; stacking a second one on it is the wrong
    // response, and joining would make the 60s timer silently become "however
    // long the last sweep took". POST /sweep is the one caller that joins,
    // because a human is waiting on the answer.
    if (this.inFlight) return null;
    return this.startSweep(false);
  }

  /**
   * POST /sweep — measure everything NOW, cadence ignored.
   *
   * 🚨 UNTIL THIS EXISTED THERE WAS NO WAY TO MAKE WARDEN LOOK AGAIN. Every
   * check declares its own cadence and the engine skips one that is not due;
   * `force: true` had exactly one caller in the whole tree — checks/cli.ts,
   * the on-box smoke test — and `only` had none. tick() passes no options, so
   * the loop always honoured cadence. An operator who had just renewed the
   * origin certificate waited up to six hours to see the board agree with
   * them, and had no way to tell "not fixed" from "not looked at again".
   *
   * ⚠️ IT ANSWERS WITHIN A BUDGET, RATHER THAN HOLDING THE CONNECTION. A
   * forced sweep runs every check including the expensive ones, which are
   * budgeted sixty seconds EACH at a concurrency of four. That can outlive
   * the backend's 25s write timeout and nginx's 60s cut, and a request that
   * outlives nginx returns 502 to the operator while the work carries on
   * unseen. So the sweep is started, raced against a budget, and if it is
   * still running when the budget expires the answer says `finished: false`
   * — the sweep continues and lands on the board by itself.
   *
   * ⚠️ A SECOND CALL JOINS THE FIRST, IT DOES NOT START ANOTHER. Two forced
   * sweeps at once would double the box's load for no new information. When
   * the sweep it joined was a CADENCE sweep rather than a forced one, the
   * answer says so (`forced: false`) — some of those rows are carried
   * forward, and reporting a cadence board as a full re-measure would be the
   * same lie by a different route.
   *
   * 🚨 `operatorId` IS REQUIRED AND IT IS WRITTEN DOWN. server.ts has always
   * demanded one on this route — "an audit trail that cannot name who
   * stopped the watchdog is not an audit trail" — and then dropped it on the
   * floor: sweepNow() had no parameter for it, appended no note, and the
   * backend wrote no AdminAudit row either, so forcing a full re-measure of
   * the production box (every check, the expensive ones budgeted sixty
   * seconds EACH at concurrency four) was the one Phase 4 action that left no
   * trace anywhere. It is a required parameter rather than an optional one so
   * a future caller cannot quietly go back to not having it.
   */
  async sweepNow(opts: { operatorId: string; budgetMs?: number }): Promise<{
    finished: boolean;
    forced: boolean;
    joined: boolean;
    board: WardenCheckBoard;
  }> {
    const budgetMs = clampInt(opts.budgetMs, 1_000, 120_000, DEFAULT_SWEEP_BUDGET_MS);

    // 🚨 DECIDE AND ACT IN ONE SYNCHRONOUS BLOCK — NOTHING MAY AWAIT IN HERE.
    // `inFlight` is cleared by a `.finally()` on the running sweep, so it can
    // change at any await point, and this method used to read it, await the
    // note, and then read it AGAIN to decide what to join. Both directions of
    // that race are real and both end in the thread saying one thing while the
    // box does another:
    //
    //   - the sweep finishes during the note, so the join finds nothing and
    //     startSweep() runs a SECOND full re-measure of the production box —
    //     every check, the expensive ones budgeted sixty seconds EACH at
    //     concurrency four — while the note the operator is reading says it
    //     joined the first and did not start a second;
    //   - or a cadence tick starts one during the note, so this joins a
    //     CADENCE sweep, whose board carries rows forward, and still answers
    //     `forced: true` — which is the exact "reporting a cadence board as a
    //     full re-measure" lie the forced/joined pair exists to prevent.
    //
    // One read, one decision, one start, no await between them.
    const existing = this.inFlight;
    const joined = existing !== null;
    const forced = existing ? existing.forced : true;
    const running = existing ? existing.promise : this.startSweep(true);

    // ⚠️ NOTED BEFORE THE RACE, NOT AFTER IT. The answer comes back on a
    // budget while the sweep carries on, so a note written after the await
    // would be missing from the thread for exactly as long as the sweep the
    // operator is watching for — and absent altogether if the process is
    // reloaded mid-sweep, which is the moment somebody is most likely to have
    // forced one. Safe to await here now: the decision above is already taken
    // and cannot be revised by anything that happens during this write.
    await this.store.appendMessages([
      note(this.now().toISOString(), [
        joined
          ? `${opts.operatorId} asked for a full re-measure while a ${forced ? 'forced' : 'cadence'} sweep was already running, so this one joined that sweep instead of starting a second.`
          : `${opts.operatorId} forced a full re-measure of the box. Every check runs, cadence ignored.`,
      ]),
    ]);

    const raced = await Promise.race([
      running.then(() => true as const),
      // ⚠️ ref:false — a live timer per forced sweep would hold the process
      // open on shutdown for no reason.
      delay(budgetMs, undefined, { ref: false }).then(() => false as const),
    ]);

    return { finished: raced, forced, joined, board: this.gates() };
  }

  /**
   * One sweep turn: measure, announce what turned, acknowledge what resolved,
   * and — unless paused — diagnose.
   *
   * ⚠️ THE ONLY PLACE `inFlight` IS SET AND CLEARED. tick() refuses on it and
   * sweepNow() joins it, so a second setter anywhere would break both at once
   * and neither in a way a test would see.
   */
  private startSweep(forced: boolean): Promise<Sweep | null> {
    const promise = this.sweepTurn(forced).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = { promise, forced };
    return promise;
  }

  private async sweepTurn(forced: boolean): Promise<Sweep | null> {
    try {
      await this.noticePauseExpiry();
      const sweep = await runSweep(this.checks, this.ctx, this.memory, forced ? { force: true } : {});
      this.lastSweep = sweep;
      await this.store.setLastCheckAt(sweep.finishedAt);

      const transitions = this.transitionMessages(sweep);
      await this.store.setStatuses(Object.fromEntries(sweep.results.map((r) => [r.id, r.status])));
      if (transitions.length > 0) await this.store.appendMessages(transitions);

      await this.acknowledgeResolved(sweep);

      // ⚠️ MEASUREMENT ABOVE, JUDGEMENT BELOW, AND THE PAUSE CUTS EXACTLY
      // HERE. Everything above this line runs while paused: the board stays
      // current, statuses are still written, and a check that turned is still
      // announced. What a pause buys the operator is no model call and no new
      // buttons, not a blind box.
      if (this.shouldDiagnose(sweep)) {
        this.lastDiagnoseAt = this.now().getTime();
        this.lastFaultSignature = faultSignature(sweep);
        const result = await diagnose(this.diagnosisInput({ operatorMessage: null }), { caller: this.caller });
        await this.ingest(result);
      }
      return sweep;
    } catch (err) {
      this.onError('sweep', errorText(err));
      return null;
    }
  }

  /** A pause that has run out is cleared and SAID OUT LOUD. Letting the record
   *  rot silently would leave the thread's last word on the subject being
   *  "paused", days after it stopped being true. */
  private async noticePauseExpiry(): Promise<void> {
    const stored = this.store.pause;
    if (!stored || this.pausedNow()) return;
    await this.store.clearPause();
    await this.store.appendMessages([
      note(this.now().toISOString(), [
        `The pause that was set at ${stored.since} ran out at ${stored.until}. I am diagnosing and raising proposals again.`,
      ]),
    ]);
  }

  /** Announce only what CHANGED. A fault that has been red for a week is on
   *  the board; repeating it in the thread every minute is how a thread stops
   *  being read. */
  private transitionMessages(sweep: Sweep): WardenChatMessage[] {
    const at = this.now().toISOString();
    const turned: Array<{ result: CheckResult; previous: CheckStatus | null }> = [];

    for (const r of sweep.results) {
      if (!r.fresh) continue;
      const previous = this.store.lastStatus(r.id);
      if (previous === r.status) continue;
      // A first sighting that is already healthy is not news.
      if (previous === null && r.status === 'ok') continue;
      turned.push({ result: r, previous });
    }

    const messages = turned
      .slice(0, MAX_TRANSITION_MESSAGES)
      .map(({ result, previous }) =>
        result.status === 'ok'
          ? // ⚠️ 'unknown', ALWAYS, FROM THIS CALL SITE. All this method has is
            // two sweeps and a status that changed; it cannot know who fixed
            // it, and on this box the answer has always been "a human" —
            // runSafeListOperation(), the only unattended path, has no caller
            // outside its own tests. Passing 'warden' here would put the Desk's
            // "fixed alone" tag on an operator's 2am repair. See fixedMessage.
            fixedMessage(result, previous, at, 'unknown')
          : findingMessage(result, previous, at),
      );

    const overflow = turned.slice(MAX_TRANSITION_MESSAGES);
    if (overflow.length > 0) {
      messages.push(
        note(
          at,
          [`${overflow.length} more check${overflow.length === 1 ? '' : 's'} turned in the same sweep. They are all on the board; here is what each of them says now.`],
          { tone: 'inset', lines: overflow.map(({ result }) => `${result.id}: ${result.status} — ${result.verdict}`) },
        ),
      );
    }
    return messages;
  }

  /**
   * A pending proposal whose every cited check now reads ok is a button for a
   * problem that is gone. Acknowledged, not deleted — the operator can still
   * see what was raised and that it resolved itself.
   */
  private async acknowledgeResolved(sweep: Sweep): Promise<void> {
    const status = new Map(sweep.results.map((r) => [r.id, r.status] as const));
    const at = this.now().toISOString();
    for (const p of this.store.openProposals()) {
      if (p.checkIds.length === 0) continue;
      const known = p.checkIds.filter((id) => status.has(id));
      if (known.length === 0) continue;
      if (!known.every((id) => status.get(id) === 'ok')) continue;
      await this.store.settle(p.id, 'acknowledged', { operatorId: null });
      await this.store.appendMessages([
        note(at, [`I am taking this one off the board without running anything: ${p.headline} — every check it was raised from now reads ok.`]),
      ]);
    }
  }

  private shouldDiagnose(sweep: Sweep): boolean {
    // ⚠️ THE PAUSE'S FIRST HALF. No MODEL CALL at all while paused — not a
    // cheaper one, not a quieter one. The other half is in ingest(), because
    // POST /chat still reaches diagnose() when the operator asks a direct
    // question and that turn can draft proposals.
    //
    // ⚠️ AND IT IS "NO MODEL CALL", NOT "NO diagnose()". With no caller
    // configured diagnose() makes no call at all: it returns the
    // ANTHROPIC_API_KEY red gate and nothing else, and a pause that swallowed
    // THAT would leave a daemon that cannot think at all looking, for up to
    // twenty-four hours, exactly like one that thought and found nothing —
    // which is the single failure this whole daemon exists to refuse. A red
    // gate is also not what a pause is for: it carries no command and no
    // button, so there is nothing an operator mid-deploy could be bothered
    // by. See the kind carve-out in ingest(), which is the same rule applied
    // to the drafts themselves.
    //
    // What this deliberately does NOT do: call the model while paused to see
    // whether it would draft a red gate. A paused sweep with a caller still
    // makes no call at all, so a MODEL-drafted red gate waits for the resume
    // or for the operator's next direct question (ingest() raises it on that
    // path). That is the trade: the one red gate that needs no model — no
    // credential, the daemon cannot think — is the one a pause must never
    // hide, and it is free to raise.
    if (this.pausedNow() && this.caller) return false;
    const signature = faultSignature(sweep);
    // Healthy AND able to think: nothing to say. (With no caller we still go
    // through diagnose(), which raises the missing-credential red gate — a
    // silent board and a board nobody looked at must not look the same.)
    if (signature === '' && this.caller) return false;
    if (signature !== this.lastFaultSignature) return true;
    return this.now().getTime() - this.lastDiagnoseAt >= this.diagnoseMinIntervalMs;
  }

  private diagnosisInput(opts: { operatorMessage: string | null }): DiagnosisInput {
    return {
      checks: this.lastSweep?.results ?? [],
      standingInstructions: this.store.standingInstructions().map((s) => s.text),
      openProposals: this.store.openProposals().map((p) => ({ id: p.id, headline: p.headline, status: p.status })),
      operatorMessage: opts.operatorMessage,
      now: this.now(),
    };
  }

  /**
   * Store what a diagnosis turn produced, and return only what actually
   * landed. A proposal the store deduplicated (an open one already names that
   * fault) takes its announcement with it — otherwise the thread would repeat
   * a finding the board already shows.
   */
  private async ingest(result: DiagnosisResult): Promise<WardenChatMessage[]> {
    const paused = this.pausedNow();
    const suppressed = new Set<string>();

    // ⚠️ THE PAUSE'S SECOND HALF, AND IT IS NOT REDUNDANT WITH
    // shouldDiagnose(). A sweep will not diagnose while paused — but POST
    // /chat goes straight to diagnose() when the operator asks a question,
    // and that answer can draft proposals. Without this branch, "stop raising
    // proposals" would hold until the first time the operator typed
    // something, which is precisely when they are most likely to be talking
    // to Warden about the thing they paused it for.
    //
    // Nothing is stored and nothing is silently lost: the drafts are dropped,
    // the announcements that named them go with them (that filter already
    // exists for the dedupe case below), and one note says what was held and
    // how many.
    //
    // 🚨 A RED GATE IS NOT HELD BY A PAUSE, AND THAT IS NOT AN EXCEPTION TO
    // THE RULE — IT IS THE RULE READ PROPERLY. A pause suspends FIXES: things
    // with a command behind them and a button an operator would have to
    // decide about mid-deploy. A red gate has neither. It cannot be approved,
    // declined or acknowledged anywhere in this system (core.ts approve() and
    // decline(), desk.service.ts act()) — it clears only when the gate itself
    // flips — so holding one back suppresses a FACT about the running
    // configuration of a firearms marketplace and buys the operator nothing
    // in return. Held for the twenty-four hours a pause can last, "Warden
    // cannot diagnose anything: ANTHROPIC_API_KEY is not set" would read as a
    // quiet board.
    let heldByPause = 0;
    for (const drafted of result.proposals) {
      if (paused && drafted.kind !== 'red_gate') {
        suppressed.add(drafted.id);
        heldByPause += 1;
        continue;
      }
      // A proposal the store deduplicated — an open one already names that
      // fault — takes its announcement with it, or the thread repeats a
      // finding the board already shows. Red gates are deduplicated by the
      // same path, on a stable id, so a paused daemon re-raising the same
      // gate every sweep says it once.
      const stored = await this.store.raise(drafted);
      if (!stored) suppressed.add(drafted.id);
    }

    const messages = result.messages.filter((m) => !(m.proposalId && suppressed.has(m.proposalId)));
    if (paused && heldByPause > 0) {
      messages.push(
        note(this.now().toISOString(), [
          `I am paused until ${paused.until}, so I have not raised ${heldByPause} fix${heldByPause === 1 ? '' : 'es'} I would otherwise have put on the board. Resume me and they come back on the next sweep.`,
        ]),
      );
    }
    await this.store.appendMessages(messages);
    return messages;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  private track(p: Promise<unknown>): void {
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }

  /** Wait for work started by a request that has already been answered — an
   *  approved run must finish writing its audit record rather than being lost
   *  to a restart. Bounded, because shutdown cannot wait forever. */
  async drain(timeoutMs = 30_000): Promise<void> {
    if (this.background.size === 0) return;
    await Promise.race([Promise.allSettled([...this.background]), delay(timeoutMs, undefined, { ref: false })]);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

/** A sweep result as one board row. One place, so GET /gates and POST /sweep
 *  can never describe the same measurement differently. */
function toRow(r: CheckResult): WardenCheckRow {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    verdict: r.verdict,
    gateKey: r.gateKey,
    standing: r.standing,
    measuredAt: r.measuredAt,
    fresh: r.fresh,
  };
}

/**
 * ⚠️ A BAD NUMBER FALLS BACK TO THE DEFAULT, IT DOES NOT BECOME ZERO. These
 * clamp a pause length and two budgets, all of which arrive off the wire.
 * `Number(undefined)` is NaN and `Math.min(NaN, …)` is NaN, so a naive clamp
 * turns "the client sent no minutes" into a pause that has already expired
 * and a sweep budget that times out instantly — both of which look like the
 * feature working and doing nothing.
 */
function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** The identity of the CURRENT fault set. A change means "think again now";
 *  the same set means "you already thought about this". Unknowns count: a row
 *  that stopped being measurable is a change worth a fresh look. */
function faultSignature(sweep: Sweep): string {
  return sweep.results
    .filter((r) => r.status !== 'ok')
    .map((r) => `${r.id}:${r.status}`)
    .sort()
    .join(',');
}

type Instruction =
  | { kind: 'remember'; text: string }
  | { kind: 'forget'; index: number }
  | { kind: 'list' }
  | { kind: 'question' };

/**
 * ⚠️ AN EXPLICIT MARKER, NOT AN INFERENCE. Whether a sentence was meant as a
 * standing rule is exactly the kind of judgement that should not be guessed:
 * a misread "don't restart the backend" that never gets stored is a rule
 * silently not honoured, and one stored from an offhand remark is a rule
 * nobody can find to remove. So the operator says so in as many words, and
 * the list is always echoed back after a change.
 */
function parseInstruction(message: string): Instruction {
  const remember = /^\s*remember\s*:\s*(.+)$/is.exec(message);
  if (remember) return { kind: 'remember', text: remember[1]!.trim().slice(0, 500) };

  const forget = /^\s*forget\s*:\s*(\d{1,3})\s*$/i.exec(message);
  if (forget) return { kind: 'forget', index: Number(forget[1]) };

  if (/^\s*(standing|instructions|standing instructions)\s*\??\s*$/i.test(message)) return { kind: 'list' };

  return { kind: 'question' };
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
