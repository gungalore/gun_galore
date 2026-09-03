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
  type WardenChatMessage,
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
  projectProposal,
  ranMessage,
  standingList,
  startedMessage,
} from './messages.js';
import type { StoredProposal, WardenStore } from './store.js';

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

export type CoreFailure = { ok: false; status: 400 | 404 | 409 | 503; reason: string };
export type CoreMessages = { ok: true; messages: WardenChatMessage[] };
export type CoreResult = CoreMessages | CoreFailure;

export interface GateRow {
  id: string;
  title: string;
  status: CheckStatus;
  verdict: string;
  gateKey: string | null;
  standing: boolean;
  measuredAt: string;
  fresh: boolean;
}

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

  private sweeping = false;
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
  chat(): { lastCheckAt: string | null; messages: WardenChatMessage[]; proposals: WardenProposal[] } {
    const { lastCheckAt, messages, proposals, dropped } = this.store.snapshot();
    if (dropped > 0) this.onError('snapshot', `${dropped} stored record(s) failed our own wire rules and were not sent`);
    return { lastCheckAt, messages, proposals };
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
   * ⚠️ NOT PROXIED. The Desk's own GET /admin/warden/gates is answered inside
   * the Nest process from DeskSiteService and never calls this daemon —
   * warden.service.ts's gates() makes no network call at all. This exists so
   * an operator on the box can see the measured board without reading the
   * thread, and so a smoke test after deploy has something to assert on.
   */
  gates(): { lastCheckAt: string | null; counts: Sweep['counts'] | null; rows: GateRow[] } {
    const sweep = this.lastSweep;
    if (!sweep) return { lastCheckAt: this.store.lastCheckAt, counts: null, rows: [] };
    return {
      lastCheckAt: this.store.lastCheckAt,
      counts: sweep.counts,
      rows: sweep.results.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        verdict: r.verdict,
        gateKey: r.gateKey,
        standing: r.standing,
        measuredAt: r.measuredAt,
        fresh: r.fresh,
      })),
    };
  }

  // ── the sweep loop ────────────────────────────────────────────────────

  /**
   * One turn of the background loop. Never called from a request handler.
   * Overlap is refused rather than queued: a sweep that ran long is already
   * telling you the box is busy, and stacking a second one on top of it is
   * the wrong response.
   */
  async tick(): Promise<Sweep | null> {
    if (this.sweeping) return null;
    this.sweeping = true;
    try {
      const sweep = await runSweep(this.checks, this.ctx, this.memory);
      this.lastSweep = sweep;
      await this.store.setLastCheckAt(sweep.finishedAt);

      const transitions = this.transitionMessages(sweep);
      await this.store.setStatuses(Object.fromEntries(sweep.results.map((r) => [r.id, r.status])));
      if (transitions.length > 0) await this.store.appendMessages(transitions);

      await this.acknowledgeResolved(sweep);

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
    } finally {
      this.sweeping = false;
    }
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
        result.status === 'ok' ? fixedMessage(result, previous, at) : findingMessage(result, previous, at),
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
    const suppressed = new Set<string>();
    for (const drafted of result.proposals) {
      const stored = await this.store.raise(drafted);
      if (!stored) suppressed.add(drafted.id);
    }
    const messages = result.messages.filter((m) => !(m.proposalId && suppressed.has(m.proposalId)));
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
