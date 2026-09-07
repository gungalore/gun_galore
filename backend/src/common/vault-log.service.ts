// ────────────────────────────────────────────────────────────────────
// THE VAULT'S DECISION LEDGER.
//
// Operator, 2026-09-07: "we need to keep a log on the server for issues like
// this so we can troubleshoot it and build the module smarter over time with
// intelligence we gathered from real users. Not just for mismatching but for
// any possible scenario something could go wrong or did not automatically
// fire."
//
// Every automatic step the Document Centre takes - or declines to take -
// writes one row here: how a document was classified and on what evidence,
// which reader read it and which fields it did and did not get, whether a
// date was armed and if not why, what a competency's expiry was derived from,
// whether a proficiency found its other side, what a motivation attached and
// what it skipped, and every correction a member makes afterwards (a refile,
// a rename, a changed date, a deletion), which is the ground truth that says
// where the automation was wrong.
//
// ⚠️ NO DOCUMENT CONTENTS, EVER. The ledger holds FIELD NAMES, marker names,
// strengths, counts, kinds, reasons and day gaps - never a value read off a
// page. A serial number, a name, an address or an ID number in here would
// make this table a second copy of the vault outside its encryption. `scrub`
// enforces it mechanically: long strings are cut, and keys that name a value
// are dropped whatever they hold.
//
// ⚠️ NEVER ON THE CRITICAL PATH. `note()` is fire-and-forget and swallows its
// own failures. A ledger that could fail an upload would be a ledger nobody
// dared write to.
// ────────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type VaultStage =
  | 'classify'
  | 'read'
  | 'name'
  | 'date'
  | 'derive'
  | 'pair'
  | 'duplicate'
  | 'address'
  | 'autolink'
  | 'settle'
  | 'member';

export type VaultOutcome =
  | 'ok'
  | 'fallback'
  | 'partial'
  | 'missed'
  | 'flagged'
  | 'skipped'
  | 'corrected'
  | 'error';

export interface VaultEventInput {
  stage: VaultStage;
  outcome: VaultOutcome;
  /** A short slug a query can group on: 'markers-definitive', 'no-id-number', 'several-candidates', 'refiled'. */
  code: string;
  userId?: string | null;
  credentialId?: string | null;
  motivationId?: string | null;
  /** Structured, scrubbed. See the note above: names of things, never their values. */
  detail?: Record<string, unknown>;
}

/** Keys whose values are document contents, dropped from any detail whatever they hold. */
const VALUE_KEYS = new Set([
  'title',
  'name',
  'holder_name',
  'full_name',
  'id_number',
  'serial',
  'frame_serial',
  'barrel_serial',
  'receiver_serial',
  'serial_number',
  'licence_number',
  'certificate_number',
  'competency_number',
  'scv_number',
  'authentication_code',
  'residential_address',
  'address',
  'email',
  'phone',
  'value',
  'text',
  'details',
]);
const MAX_STRING = 48;
const MAX_LIST = 40;

/** Keep the detail to names, counts and short slugs. */
export function scrub(detail: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  if (!detail) return undefined;
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (VALUE_KEYS.has(k)) continue;
    const s = scrubValue(v);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

function scrubValue(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING - 1)}…` : v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) {
    return v
      .slice(0, MAX_LIST)
      .map((x) => scrubValue(x))
      .filter((x): x is Prisma.InputJsonValue => x !== undefined);
  }
  if (typeof v === 'object') {
    const inner = scrub(v as Record<string, unknown>);
    return inner ?? {};
  }
  return undefined;
}

/**
 * What a reading looked like, without what it said: which wanted fields came
 * back and which did not. The single most useful thing to know about a read
 * that went wrong.
 */
export function readingShape(
  details: Record<string, string> | undefined,
  wanted: readonly string[],
): { present: string[]; missing: string[] } {
  const keys = Object.keys(details ?? {}).filter((k) => (details?.[k] ?? '').trim() !== '');
  return {
    present: keys,
    missing: wanted.filter((w) => !keys.includes(w)),
  };
}

@Injectable()
export class VaultLogService {
  private readonly logger = new Logger(VaultLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Write and forget. Never throws, never awaited by the caller. */
  note(evt: VaultEventInput): void {
    void this.record(evt);
  }

  async record(evt: VaultEventInput): Promise<void> {
    try {
      await this.prisma.vaultEvent.create({
        data: {
          stage: evt.stage,
          outcome: evt.outcome,
          code: evt.code.slice(0, 64),
          userId: evt.userId ?? null,
          credentialId: evt.credentialId ?? null,
          motivationId: evt.motivationId ?? null,
          detail: scrub(evt.detail) ?? Prisma.JsonNull,
        },
      });
    } catch (err) {
      this.logger.warn(`Ledger write failed (${evt.stage}/${evt.code}): ${(err as Error).message}`);
    }
  }

  /** The most recent rows, newest first, filtered. For the admin ledger. */
  async recent(q: {
    days?: number;
    stage?: string;
    code?: string;
    outcome?: string;
    credentialId?: string;
    userId?: string;
    limit?: number;
  }) {
    const since = new Date(Date.now() - Math.min(Math.max(q.days ?? 30, 1), 365) * 86_400_000);
    return this.prisma.vaultEvent.findMany({
      where: {
        createdAt: { gte: since },
        ...(q.stage ? { stage: q.stage } : {}),
        ...(q.code ? { code: q.code } : {}),
        ...(q.outcome ? { outcome: q.outcome } : {}),
        ...(q.credentialId ? { credentialId: q.credentialId } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(q.limit ?? 200, 1), 1000),
    });
  }

  /**
   * How often each thing happened: stage, outcome and code, with counts and
   * how many distinct members it touched. This is the "what goes wrong most"
   * view that decides what to build next.
   */
  async summary(days = 30) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);
    const rows = await this.prisma.vaultEvent.groupBy({
      by: ['stage', 'outcome', 'code'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: [{ _count: { code: 'desc' } }],
    });
    const members = await this.prisma.vaultEvent.groupBy({
      by: ['stage', 'code', 'userId'],
      where: { createdAt: { gte: since }, userId: { not: null } },
    });
    const membersBy = new Map<string, number>();
    for (const m of members) {
      const k = `${m.stage}/${m.code}`;
      membersBy.set(k, (membersBy.get(k) ?? 0) + 1);
    }
    return {
      since: since.toISOString(),
      rows: rows.map((r) => ({
        stage: r.stage,
        outcome: r.outcome,
        code: r.code,
        count: r._count._all,
        members: membersBy.get(`${r.stage}/${r.code}`) ?? 0,
      })),
    };
  }
}
