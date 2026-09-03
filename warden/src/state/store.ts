// warden/src/state/store.ts
//
// EVERYTHING WARDEN REMEMBERS: the thread, the proposals, the audit trail,
// the operator's standing instructions, and the status each check was last
// seen in. One JSON file, one writer, written atomically.
//
// ⚠️ WHY NOT SQLITE. The recon recommended it, and for a bigger corpus it
// would be right. This is a few hundred short records with exactly one writer
// (this process) and no query beyond "by id" and "the recent ones"; against
// that, a native module is a build step on a live box, a compile toolchain in
// the deploy path, and a class of failure — a module built for the wrong Node
// ABI — that takes the whole daemon down rather than degrading. A file that
// fails to load degrades to an empty thread and SAYS SO. If the record count
// ever justifies it, the seam is this class: nothing outside it knows how the
// state is stored.
//
// 🚨 THE CAPS ARE ORDERING-SENSITIVE, AND GETTING THEM BACKWARDS IS SILENT.
// The backend keeps the FIRST 200 messages and the FIRST 50 proposals of what
// we send and drops the rest (warden.service.ts's normalise*). So sending 400
// messages does not show the newest 200 — it shows the OLDEST 200, i.e. a
// thread frozen at whatever Warden was saying days ago, with no error
// anywhere. snapshot() therefore sends a window that is already the right
// size, newest content included, and puts PENDING proposals first so an
// actionable one can never be the item that falls off the far end.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CheckStatus, WardenChatMessage, WardenProposal } from '../types.js';
import type { WardenAuditRecord } from '../exec/index.js';
import type { DraftedProposal } from '../diagnose/index.js';
import { projectMessage, projectProposal } from './messages.js';

/** What the backend will actually keep. We send at most this many, newest. */
export const WIRE_MESSAGE_LIMIT = 200;
export const WIRE_PROPOSAL_LIMIT = 50;

/** What we keep on disk. Comfortably more than the wire window so the audit
 *  trail outlives the thread the operator sees. */
const MAX_MESSAGES = 600;
const MAX_RESOLVED_PROPOSALS = 200;
const MAX_AUDIT = 200;
const MAX_STANDING = 50;

export type ProposalStatus = WardenProposal['status'];

/**
 * A proposal as Warden holds it. A superset of the wire shape: `operation`,
 * `checkIds`, `faultKey` and the resolution fields are the daemon's own and
 * are stripped by projectProposal() before anything is sent.
 */
export interface StoredProposal {
  id: string;
  kind: WardenProposal['kind'];
  status: ProposalStatus;
  headline: string;
  diagnosis: string;
  command: string | null;
  gateKey: string | null;
  raisedAt: string;

  /** The validated safe-list pick behind this, if it is one. Approve re-runs
   *  it by NAME + ARGS; `command` is display text for a human, never an input
   *  to anything. */
  operation: { name: string; args: Record<string, string | number | boolean> } | null;
  reversible: boolean;
  /** Which checks this was diagnosed from — what "re-checked" re-measures. */
  checkIds: string[];

  /** Identity of the FAULT, not of the record. Two sweeps that find the same
   *  thing must update one proposal, not mint a second: a board that grows a
   *  new row every ten minutes for a fault nobody has fixed is a board that
   *  stops being read. */
  faultKey: string;
  /** Last sweep that still saw this fault. */
  lastSeenAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  declineReason: string | null;
}

export interface StandingInstruction {
  id: string;
  text: string;
  at: string;
  operatorId: string;
  /** `operator` — typed into the thread. `decline` — the reason given when a
   *  proposal was turned down, which is an instruction whether or not it was
   *  phrased as one. */
  source: 'operator' | 'decline';
}

interface WardenState {
  version: 1;
  lastCheckAt: string | null;
  messages: WardenChatMessage[];
  proposals: StoredProposal[];
  audit: WardenAuditRecord[];
  standing: StandingInstruction[];
  /** checkId -> the status it was last seen in, so a TRANSITION can be
   *  detected across a daemon restart. Without this, a restart re-announces
   *  every existing fault as though it had just happened. */
  statuses: Record<string, CheckStatus>;
}

function emptyState(): WardenState {
  return {
    version: 1,
    lastCheckAt: null,
    messages: [],
    proposals: [],
    audit: [],
    standing: [],
    statuses: {},
  };
}

export interface StoreOptions {
  /** null = memory only (tests, and a box where the directory is unwritable). */
  filePath: string | null;
  now?: () => Date;
  newId?: () => string;
  /** Called when persistence fails. The daemon logs it; a store that cannot
   *  write must keep serving, and must not pretend it wrote. */
  onPersistError?: (error: string) => void;
}

/**
 * The identity of a fault. Deliberately NOT the headline alone: a model
 * rewording the same finding must not mint a second proposal. For a runnable
 * fix the command IS the identity (a different command is a different fix);
 * for a red gate the gate key is, falling back to the headline when a gate
 * has no key.
 */
export function faultKeyFor(p: Pick<StoredProposal, 'kind' | 'gateKey' | 'command' | 'headline'>): string {
  if (p.kind === 'red_gate') return `red_gate|${p.gateKey ?? p.headline}`;
  return `proposal|${p.gateKey ?? ''}|${p.command ?? p.headline}`;
}

export class WardenStore {
  private state: WardenState = emptyState();
  private writing: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly onPersistError: (error: string) => void;

  constructor(private readonly opts: StoreOptions) {
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => randomUUID());
    this.onPersistError = opts.onPersistError ?? (() => undefined);
  }

  /**
   * Read whatever is on disk. A missing file is the normal first boot. A
   * CORRUPT file is not swallowed silently — it returns the reason so the
   * daemon can say "I started with an empty thread because X", because an
   * empty thread and a lost thread look identical to an operator and mean
   * very different things.
   */
  async load(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.opts.filePath) return { ok: true };
    let raw: string;
    try {
      raw = await fs.readFile(this.opts.filePath, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return { ok: true };
      return { ok: false, reason: `${e.code ?? 'error'} reading ${this.opts.filePath}: ${e.message}` };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<WardenState>;
      const base = emptyState();
      this.state = {
        ...base,
        ...parsed,
        version: 1,
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
        standing: Array.isArray(parsed.standing) ? parsed.standing : [],
        statuses: parsed.statuses && typeof parsed.statuses === 'object' ? parsed.statuses : {},
      };
      return { ok: true };
    } catch (err) {
      this.state = emptyState();
      return { ok: false, reason: `${this.opts.filePath} is not readable JSON: ${(err as Error).message}` };
    }
  }

  // ── reads ─────────────────────────────────────────────────────────────

  get lastCheckAt(): string | null {
    return this.state.lastCheckAt;
  }

  /**
   * Exactly what GET /chat sends. Already inside the backend's caps and in
   * the order that survives them — see the header. Anything that fails the
   * wire rules is dropped HERE, where we can count it, rather than by the
   * backend, where it vanishes with no error on either side.
   */
  snapshot(): { lastCheckAt: string | null; messages: WardenChatMessage[]; proposals: WardenProposal[]; dropped: number } {
    let dropped = 0;

    const messages: WardenChatMessage[] = [];
    for (const m of this.state.messages.slice(-WIRE_MESSAGE_LIMIT)) {
      const wire = projectMessage(m);
      if (wire) messages.push(wire);
      else dropped += 1;
    }

    // Pending first: the backend keeps the FIRST 50, so an actionable
    // proposal must never be behind a resolved one in this array.
    const pending = this.state.proposals.filter((p) => p.status === 'pending');
    const resolved = this.state.proposals.filter((p) => p.status !== 'pending');
    const ordered = [...byNewest(pending), ...byNewest(resolved)].slice(0, WIRE_PROPOSAL_LIMIT);

    const proposals: WardenProposal[] = [];
    for (const p of ordered) {
      const wire = projectProposal(p);
      if (wire) proposals.push(wire);
      else dropped += 1;
    }

    return { lastCheckAt: this.state.lastCheckAt, messages, proposals, dropped };
  }

  getProposal(id: string): StoredProposal | null {
    return this.state.proposals.find((p) => p.id === id) ?? null;
  }

  openProposals(): StoredProposal[] {
    return this.state.proposals.filter((p) => p.status === 'pending');
  }

  standingInstructions(): StandingInstruction[] {
    return [...this.state.standing];
  }

  lastStatus(checkId: string): CheckStatus | null {
    return this.state.statuses[checkId] ?? null;
  }

  auditFor(proposalId: string): WardenAuditRecord[] {
    return this.state.audit.filter((a) => a.proposalId === proposalId);
  }

  // ── writes ────────────────────────────────────────────────────────────

  async setLastCheckAt(at: string): Promise<void> {
    this.state.lastCheckAt = at;
    await this.persist();
  }

  async setStatuses(next: Record<string, CheckStatus>): Promise<void> {
    this.state.statuses = { ...this.state.statuses, ...next };
    await this.persist();
  }

  async appendMessages(messages: WardenChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    this.state.messages.push(...messages);
    if (this.state.messages.length > MAX_MESSAGES) {
      this.state.messages.splice(0, this.state.messages.length - MAX_MESSAGES);
    }
    await this.persist();
  }

  /**
   * Raise a drafted proposal, unless an OPEN one already names the same fault
   * — in which case the existing one is touched and null is returned, so the
   * caller can drop the message that would have announced it a second time.
   */
  async raise(drafted: DraftedProposal): Promise<StoredProposal | null> {
    const at = this.now().toISOString();
    const faultKey = faultKeyFor(drafted);
    const existing = this.state.proposals.find((p) => p.faultKey === faultKey && p.status === 'pending');
    if (existing) {
      existing.lastSeenAt = at;
      await this.persist();
      return null;
    }

    const stored: StoredProposal = {
      id: drafted.id,
      kind: drafted.kind,
      status: 'pending',
      headline: drafted.headline,
      diagnosis: drafted.diagnosis,
      // Rule 6, once more at the last gate before storage. The type system
      // already makes a red gate's command unrepresentable upstream; this
      // costs nothing and covers a future caller that is not parse.ts.
      command: drafted.kind === 'red_gate' ? null : drafted.command,
      gateKey: drafted.gateKey,
      raisedAt: drafted.raisedAt,
      operation: drafted.kind === 'red_gate' ? null : drafted.operation,
      reversible: drafted.reversible,
      checkIds: drafted.checkIds,
      faultKey,
      lastSeenAt: at,
      resolvedAt: null,
      resolvedBy: null,
      declineReason: null,
    };
    this.state.proposals.push(stored);
    this.trimResolvedProposals();
    await this.persist();
    return stored;
  }

  async settle(
    id: string,
    status: Exclude<ProposalStatus, 'pending'>,
    by: { operatorId: string | null; reason?: string | null },
  ): Promise<StoredProposal | null> {
    const p = this.getProposal(id);
    if (!p) return null;
    p.status = status;
    p.resolvedAt = this.now().toISOString();
    p.resolvedBy = by.operatorId;
    p.declineReason = by.reason ?? null;
    await this.persist();
    return p;
  }

  /** Put an approved proposal back on the board. Used when the executor's own
   *  compare-and-swap refuses AFTER the operator's decision was recorded —
   *  the decision was real, the run was not, and leaving it "approved" would
   *  claim something ran that did not. */
  async reopen(id: string): Promise<void> {
    const p = this.getProposal(id);
    if (!p || p.status !== 'approved') return;
    p.status = 'pending';
    p.resolvedAt = null;
    p.resolvedBy = null;
    await this.persist();
  }

  async recordAudit(record: WardenAuditRecord): Promise<void> {
    this.state.audit.push(record);
    if (this.state.audit.length > MAX_AUDIT) {
      this.state.audit.splice(0, this.state.audit.length - MAX_AUDIT);
    }
    await this.persist();
  }

  async setRecheck(auditId: string, recheck: WardenAuditRecord['recheck']): Promise<void> {
    const rec = this.state.audit.find((a) => a.id === auditId);
    if (!rec) return;
    rec.recheck = recheck;
    await this.persist();
  }

  async addStanding(text: string, operatorId: string, source: StandingInstruction['source']): Promise<StandingInstruction> {
    const entry: StandingInstruction = {
      id: `si_${this.newId()}`.slice(0, 64),
      text,
      at: this.now().toISOString(),
      operatorId,
      source,
    };
    this.state.standing.push(entry);
    if (this.state.standing.length > MAX_STANDING) {
      this.state.standing.splice(0, this.state.standing.length - MAX_STANDING);
    }
    await this.persist();
    return entry;
  }

  /** 1-based, matching what the operator is shown. A list nobody can clear is
   *  a list that stops meaning anything, so removal is a first-class action
   *  rather than something requiring a file edit on the box. */
  async removeStanding(oneBasedIndex: number): Promise<StandingInstruction | null> {
    const i = oneBasedIndex - 1;
    if (!Number.isInteger(i) || i < 0 || i >= this.state.standing.length) return null;
    const [removed] = this.state.standing.splice(i, 1);
    await this.persist();
    return removed ?? null;
  }

  // ── persistence ───────────────────────────────────────────────────────

  /**
   * Serialised (two mutations in the same tick would otherwise interleave
   * read-modify-write) and atomic (tmp + rename, so a daemon killed mid-write
   * leaves the previous good file rather than a half-written one that loads
   * as an empty thread).
   */
  private async persist(): Promise<void> {
    const filePath = this.opts.filePath;
    if (!filePath) return;
    const body = JSON.stringify(this.state);
    this.writing = this.writing.then(async () => {
      const tmp = `${filePath}.tmp`;
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(tmp, body, 'utf8');
        await fs.rename(tmp, filePath);
      } catch (err) {
        this.onPersistError(`${(err as Error).message}`);
      }
    });
    await this.writing;
  }

  /** ⚠️ ONLY resolved proposals are ever trimmed. A pending one is a thing the
   *  operator has been asked to decide; dropping it silently to satisfy a cap
   *  would remove the decision without making it. If pending alone exceeds the
   *  cap, the list grows — an unbounded pending pile is itself a fault worth
   *  seeing, not something to hide. */
  private trimResolvedProposals(): void {
    const resolved = this.state.proposals.filter((p) => p.status !== 'pending');
    if (resolved.length <= MAX_RESOLVED_PROPOSALS) return;
    const drop = new Set(byOldest(resolved).slice(0, resolved.length - MAX_RESOLVED_PROPOSALS).map((p) => p.id));
    this.state.proposals = this.state.proposals.filter((p) => !drop.has(p.id));
  }
}

function byNewest(list: StoredProposal[]): StoredProposal[] {
  return [...list].sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt));
}

function byOldest(list: StoredProposal[]): StoredProposal[] {
  return [...list].sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt));
}
