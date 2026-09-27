import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import {
  Prisma,
  TrackedApplication,
  TrackedApplicationEvent,
  TrackedApplicationKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { encryptText, tryDecryptText } from '../common/blob-crypto';
import {
  EnquiryParseResult,
  EnquiryRow,
  parseEnquiryResponse,
} from './saps-enquiry-page';
import {
  EnquiryHandshakeError,
  SapsEnquiryClient,
} from './saps-enquiry.client';

// ────────────────────────────────────────────────────────────────────
// THE TRACKER.
//
// A member saves an application reference; we ask the SAPS public enquiry
// what it says; we keep every change we observe and tell them when one
// happens. Three surfaces share this one service: the member's own screen,
// the member's own detail screen, and the weekly sweep.
//
// ⚠️ SAPS IS THE AUTHORITY AND WE ARE A MIRROR. Every figure stored here was
// printed by SAPS on a stated date, and the record is dated so the member can
// see how stale the mirror is. No copy anywhere may present these figures as
// an outcome promise, and nothing may say we are affiliated with SAPS — we
// are reading a public page on the member's behalf.
//
// ⚠️ `status` AND `lastOutcome` ARE DIFFERENT COLUMNS AND MUST STAY THAT WAY.
// `status` is the last real thing SAPS said. `lastOutcome` is what the last
// POLL did ('row' | 'no_records' | 'error'). UNDER NO CIRCUMSTANCES may a
// poll that errored or returned no-record blank `status`: the page drops a
// record for a minute at a time under load, and a member who saw APPROVED
// yesterday must not be shown "unknown" because a request timed out. That
// rule is the single most important thing in this file, and it is enforced by
// recordError/recordNoRecords never naming the column.
//
// ⚠️ NOTHING IN HERE MAY THROW INTO A CRON. The sweep catches per row; this
// service's own public methods do throw, because a member tapping a button
// deserves a real error rather than a silent nothing.
// ────────────────────────────────────────────────────────────────────

/** Gap between two SAPS calls inside one sweep, before jitter. */
const CHECK_DELAY_MS = 700;
/** How long one unreadable-page alert stays the only one of its kind. */
const ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000;

export const TRACKED_KINDS: TrackedApplicationKind[] = [
  'COMPETENCY',
  'FIREARM_LICENCE',
  'RENEWAL',
];

/**
 * What the page added up to. The precedence — a row beats no-records beats an
 * unreadable page — is a policy about safety, not about markup, which is why
 * it lives here and not in the parser.
 */
export type EnquiryVerdict =
  | { outcome: 'row'; row: EnquiryRow; updatedOn: string | null }
  | { outcome: 'no_records'; updatedOn: string | null }
  | { outcome: 'error'; message: string; alert: boolean };

/**
 * ⚠️ A ROW WITH FIVE CELLS IS STILL A ROW, AND A ROW WITH NINE IS NOT
 * NECESSARILY RIGHT — but rows.length is what the page can actually tell us.
 * What this function must never do is fall through to `no_records` for a page
 * it simply could not read: "SAPS holds nothing" is a STATEMENT, and a block
 * page, a 404 or a parser that stopped matching must not be allowed to make
 * it. Neither of those is a no-records, so neither is classified as one.
 */
export function classifyEnquiry(parsed: EnquiryParseResult): EnquiryVerdict {
  if (parsed.rows.length > 0) {
    return { outcome: 'row', row: parsed.rows[0], updatedOn: parsed.updatedOn };
  }
  if (parsed.noRecords) {
    return { outcome: 'no_records', updatedOn: parsed.updatedOn };
  }
  if (parsed.validationMessage) {
    // ⚠️ KNOWN, AND NOT AN ALARM. This is what the page says when it is
    // being rate-limited, and what it says to a licence enquiry sent without
    // a serial. It is an error with backoff and never a status — but it is a
    // state SAPS puts itself in, not a fault of ours, so it does not wake
    // anybody up.
    return {
      outcome: 'error',
      message: parsed.validationMessage,
      alert: false,
    };
  }
  // Matched nothing at all: a block page, a redesign, or a page that came
  // back empty. This is the one that means we are blind.
  return {
    outcome: 'error',
    message: 'the enquiry answered with a page we could not read',
    alert: true,
  };
}

/** A reference the way SAPS prints it: no spaces, upper case. */
export function normaliseReference(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/**
 * What we match and dedupe on — never the plaintext.
 *
 * ⚠️ KEYED, NOT PLAIN. A bare SHA-256 of an eight-digit application number is
 * a lookup table away from being the number itself, and this column is in a
 * unique index that a `pg_dump` carries.
 */
export function hashReference(reference: string): string {
  const secret = process.env.ID_HASH_SECRET;
  if (!secret) {
    throw new Error(
      'ID_HASH_SECRET is not configured — cannot hash an application reference',
    );
  }
  return createHmac('sha256', secret).update(reference).digest('hex');
}

/**
 * 'YYYY/MM/DD' as SAPS prints it, or 'YYYY-MM-DD', to UTC midnight.
 *
 * ⚠️ THE ROUND-TRIP CHECK IS THE POINT. `new Date(Date.UTC(2025, 1, 31))` is
 * 3 March and does not throw, so an impossible date on the page would be
 * stored as a different day, silently, and then printed back to the member as
 * if SAPS had said it. Null is the honest answer.
 */
export function parseSapsDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(String(raw).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/**
 * A digest of one row, so a re-poll can prove it saw the same thing.
 *
 * ⚠️ THE ROW ONLY — the reference and the serial are NOT in it. A tracked id
 * and its digest end up in logs and in an admin alert; a hash that could be
 * brute-forced back to the member's application number would undo the point
 * of hashing it at all.
 */
export function rowSha256(r: EnquiryRow): string {
  return createHash('sha256')
    .update(
      [
        r.applicationType,
        r.applicationNumber,
        r.calibre,
        r.make,
        r.serialNumber,
        r.statusDate,
        r.status,
        r.statusDescription,
        r.nextStep,
      ].join('\u0001'),
    )
    .digest('hex');
}

/**
 * The new value, unless it is empty — in which case the last real one stands.
 *
 * ⚠️ AN EMPTY CELL IS NOT A CHANGE. A competency row prints blanks where a
 * licence row prints a calibre, and the page drops individual fields under
 * load. Overwriting 9MM with '' would erase something SAPS did say in favour
 * of something it merely did not repeat.
 */
function keep(next: string | null | undefined, current: string | null): string | null {
  const v = String(next ?? '').trim();
  return v !== '' ? v : (current ?? null);
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

export interface CreateTrackerInput {
  kind?: string;
  reference?: string;
  serial?: string | null;
  label?: string | null;
  submittedOn?: string | null;
}

export interface AddEventInput {
  title?: string;
  status?: string | null;
  nextStep?: string | null;
  observedAt?: string | null;
}

export interface TrackerView {
  id: string;
  kind: TrackedApplicationKind;
  label: string | null;
  reference: string;
  serial: string | null;
  submittedOn: Date | null;
  applicationType: string | null;
  applicationNumber: string | null;
  calibre: string | null;
  make: string | null;
  serialSeen: string | null;
  status: string | null;
  statusDate: Date | null;
  sapsUpdatedOn: Date | null;
  lastCheckedAt: Date | null;
  lastOutcome: string;
  lastError: string | null;
  createdAt: Date;
  eventCount: number;
}

@Injectable()
export class LicenceTrackerService {
  private readonly logger = new Logger(LicenceTrackerService.name);

  /**
   * ⚠️ SINGLE FLIGHT. Two overlapping sweeps would double the traffic to a
   * host already inclined to answer us with a block page. A second caller
   * returns immediately rather than queueing — the work is idempotent and the
   * next sweep will pick up whatever this one did not reach.
   */
  private sweeping = false;

  /**
   * Gap between two SAPS calls inside one sweep. Jitter is added on top.
   * Specs set this to 0; nothing else should.
   */
  protected delayMs = CHECK_DELAY_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SapsEnquiryClient,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  // ── GATE ───────────────────────────────────────────────────────────

  /**
   * Read by the frontend so it can render a dark state instead of guessing
   * from a 404. ⚠️ NOT gated itself — a status route that 404s while the
   * feature is off cannot report that the feature is off.
   */
  async status(): Promise<{ enabled: boolean }> {
    return { enabled: await this.settings.get(FLAGS.licenceTrackerEnabled) };
  }

  private async assertEnabled(): Promise<void> {
    if (!(await this.settings.get(FLAGS.licenceTrackerEnabled))) {
      throw new NotFoundException();
    }
  }

  // ── MEMBER SURFACE ─────────────────────────────────────────────────

  async list(userId: string): Promise<TrackerView[]> {
    await this.assertEnabled();
    const rows = await this.prisma.trackedApplication.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { events: true } } },
    });
    return rows.map((r) => this.toView(r, r._count.events));
  }

  async get(userId: string, id: string) {
    await this.assertEnabled();
    const row = await this.prisma.trackedApplication.findFirst({
      where: { id, userId },
      include: { events: { orderBy: { observedAt: 'desc' } } },
    });
    if (!row) throw new NotFoundException();
    return {
      ...this.toView(row, row.events.length),
      events: row.events.map((e) => this.toEventView(e)),
    };
  }

  async create(userId: string, input: CreateTrackerInput): Promise<TrackerView> {
    await this.assertEnabled();

    const kind = this.parseKind(input.kind);
    const reference = normaliseReference(input.reference);
    if (!reference) {
      throw new BadRequestException('Enter the application reference.');
    }
    // ⚠️ A COMPETENCY HAS NO FIREARM, so there is no serial to hold and
    // nothing to send. The frontend hides the field; this is the copy that
    // actually refuses, because a hidden input is not a rule.
    const serial =
      kind === 'COMPETENCY' ? null : input.serial?.trim() || null;

    let submittedOn: Date | null = null;
    if (input.submittedOn) {
      submittedOn = parseSapsDate(input.submittedOn) ??
        new Date(input.submittedOn);
      if (Number.isNaN(submittedOn.getTime())) {
        throw new BadRequestException('That submitted date could not be read.');
      }
    }

    try {
      const row = await this.prisma.trackedApplication.create({
        data: {
          userId,
          kind,
          referenceEncrypted: encryptText(reference),
          referenceHash: hashReference(reference),
          serialEncrypted: serial ? encryptText(serial) : null,
          label: input.label?.trim().slice(0, 80) || null,
          submittedOn,
        },
      });
      return this.toView(row, 0);
    } catch (err) {
      // ⚠️ THE UNIQUE INDEX IS (userId, referenceHash) and this is the only
      // thing that trips it. A raw Prisma error here reads to the member as
      // the site being broken; they simply added something twice.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'You are already tracking that application.',
        );
      }
      throw err;
    }
  }

  /** Deactivate, never delete — the history the member built up survives. */
  async remove(userId: string, id: string): Promise<{ id: string; active: boolean }> {
    await this.assertEnabled();
    const res = await this.prisma.trackedApplication.updateMany({
      where: { id, userId, active: true },
      data: { active: false },
    });
    if (res.count === 0) throw new NotFoundException();
    return { id, active: false };
  }

  /** A check the member asked for. Cooldown-gated; a sweep is not. */
  async check(userId: string, id: string): Promise<TrackerView> {
    await this.assertEnabled();
    const row = await this.findOwned(userId, id);
    await this.assertCooldown(row);
    return this.pollAndApply(row);
  }

  /**
   * A milestone the member recorded themselves — "handed in at the DfO",
   * "competency interview booked". It is a MEMBER row and never claims to be
   * something SAPS said.
   *
   * ⚠️ `statusDescription` CARRIES THE MEMBER'S OWN NOTE. The column is named
   * for SAPS's prose because that is where the timeline prints it; a milestone
   * has no other prose to give, and a second column for "the member's note"
   * would be the same field under two names.
   */
  async addEvent(userId: string, id: string, input: AddEventInput) {
    await this.assertEnabled();
    await this.findOwned(userId, id);

    const note = String(input.title ?? '').trim();
    if (!note) throw new BadRequestException('Give the milestone a title.');

    let observedAt = new Date();
    if (input.observedAt) {
      observedAt = new Date(input.observedAt);
      if (Number.isNaN(observedAt.getTime())) {
        throw new BadRequestException('That date could not be read.');
      }
    }

    await this.prisma.trackedApplicationEvent.create({
      data: {
        trackedId: id,
        source: 'MEMBER',
        observedAt,
        status: String(input.status ?? '').trim().slice(0, 60) || null,
        statusDescription: note.slice(0, 200),
        nextStep: String(input.nextStep ?? '').trim().slice(0, 500) || null,
      },
    });

    return this.get(userId, id);
  }

  // ── THE SWEEP ──────────────────────────────────────────────────────

  /**
   * Poll every active tracker that is past its cooldown.
   *
   * ⚠️ THE COOLDOWN APPLIES TO THE SWEEP TOO. It is about SAPS, not about
   * the member: a tracker checked by hand an hour ago is the last one that
   * needs asking again. `skipped` is reported rather than silently dropped so
   * the admin surface can say how much was left.
   *
   * ⚠️ ONE BAD ROW NEVER BLOCKS THE REST. The failure this guards against is
   * a single tracker whose ciphertext will not open, which under a naive loop
   * would mean nobody's tracker ever advances again.
   */
  async sweep(): Promise<{
    polled: number;
    changed: number;
    failed: number;
    skipped: number;
  }> {
    if (this.sweeping) {
      this.logger.warn('SAPS tracker sweep already running — skipping this pass');
      return { polled: 0, changed: 0, failed: 0, skipped: 0 };
    }
    this.sweeping = true;
    try {
      const max = await this.settings.get(FLAGS.licenceTrackerSweepMax);
      const hours = await this.settings.get(
        FLAGS.licenceTrackerCheckCooldownHours,
      );
      const dueBefore = new Date(Date.now() - hours * 60 * 60 * 1000);

      const rows = await this.prisma.trackedApplication.findMany({
        where: {
          active: true,
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lte: dueBefore } },
          ],
        },
        orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
        take: max,
      });
      const total = await this.prisma.trackedApplication.count({
        where: { active: true },
      });

      let polled = 0;
      let changed = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          const before = row.status;
          const after = await this.pollAndApply(row);
          if (after.lastOutcome === 'error') {
            failed += 1;
          } else {
            polled += 1;
            if (after.status !== before) changed += 1;
          }
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `Tracker ${row.id} failed and was skipped: ${(err as Error).message}`,
          );
        }
        await this.pause();
      }

      return {
        polled,
        changed,
        failed,
        skipped: Math.max(0, total - rows.length),
      };
    } finally {
      this.sweeping = false;
    }
  }

  // ── THE POLL ───────────────────────────────────────────────────────

  /**
   * Ask SAPS about one tracker and write down what came back.
   *
   * ⚠️ THIS IS THE ONLY PLACE A STATUS IS WRITTEN, and every path through it
   * either writes a status it READ or writes no status at all. There is no
   * branch here that clears one.
   */
  private async pollAndApply(row: TrackedApplication): Promise<TrackerView> {
    const reference = tryDecryptText(row.referenceEncrypted);
    if (!reference) {
      // The secret rotated, or the row is corrupt. We cannot ask about
      // something we cannot read, and we must not pretend the answer was
      // "nothing held".
      return this.recordError(
        row,
        'the stored application reference could not be read',
        true,
      );
    }
    const serial = tryDecryptText(row.serialEncrypted);

    let parsed: EnquiryParseResult;
    try {
      const { html } = await this.client.fetch(reference, serial);
      parsed = parseEnquiryResponse(html);
    } catch (err) {
      // ⚠️ FAIL CLOSED. Every throw lands here, and every one of them leaves
      // `status`, `statusDate` and `sapsUpdatedOn` exactly as they were.
      const message = (err as Error).message;
      const alert = err instanceof EnquiryHandshakeError;
      if (!alert) {
        this.logger.warn(`Enquiry for tracker ${row.id} failed: ${message}`);
      }
      return this.recordError(row, message, alert);
    }

    const verdict = classifyEnquiry(parsed);

    if (verdict.outcome === 'error') {
      this.logger.warn(
        `Enquiry for tracker ${row.id} was unreadable: ${verdict.message}`,
      );
      return this.recordError(row, verdict.message, verdict.alert);
    }
    if (verdict.outcome === 'no_records') {
      return this.recordNoRecords(row);
    }
    return this.applyRow(row, verdict.row, verdict.updatedOn);
  }

  /**
   * A poll that failed. ⚠️ NOTE WHAT IS NOT IN `data`: status, statusDate,
   * sapsUpdatedOn. That omission is the feature, not an oversight.
   */
  private async recordError(
    row: TrackedApplication,
    message: string,
    alert: boolean,
  ): Promise<TrackerView> {
    const updated = await this.prisma.trackedApplication.update({
      where: { id: row.id },
      data: {
        lastCheckedAt: new Date(),
        lastOutcome: 'error',
        lastError: message.slice(0, 300),
      },
    });
    if (alert) {
      await this.raiseAlert('SAPS_TRACKER_UNREADABLE', row.id, message);
    }
    return this.toView(updated, await this.eventCount(row.id));
  }

  /**
   * The page says SAPS holds nothing against this reference yet.
   *
   * ⚠️ THIS IS AN ANSWER, NOT A FAILURE, AND IT STILL MUST NOT TOUCH
   * `status`. An application that reached a status last month and has fallen
   * off the page today has not been un-approved — and the member's screen
   * saying "we could not find it" beside a status we once read is exactly
   * what `lastOutcome` is for.
   */
  private async recordNoRecords(row: TrackedApplication): Promise<TrackerView> {
    const updated = await this.prisma.trackedApplication.update({
      where: { id: row.id },
      data: {
        lastCheckedAt: new Date(),
        lastOutcome: 'no_records',
        lastError: null,
      },
    });
    return this.toView(updated, await this.eventCount(row.id));
  }

  /**
   * A readable row. Diff it against the last one we saw and write an event
   * only when something actually moved.
   *
   * ⚠️ THE DIFF IS AGAINST THE LAST EVENT, NOT AGAINST THE TRACKER ROW. The
   * tracker does not carry `statusDescription` or `nextStep` — those exist
   * only as snapshots — so diffing the row alone would miss the commonest
   * real change ("You will be notified by the DFO…" → "Card ready for
   * collection") and the member would never be told.
   */
  private async applyRow(
    row: TrackedApplication,
    r: EnquiryRow,
    updatedOn: string | null,
  ): Promise<TrackerView> {
    const now = new Date();

    const next = {
      applicationType: keep(r.applicationType, row.applicationType),
      applicationNumber: keep(r.applicationNumber, row.applicationNumber),
      calibre: keep(r.calibre, row.calibre),
      make: keep(r.make, row.make),
      serialSeen: keep(r.serialNumber, row.serialSeen),
      status: keep(r.status, row.status),
      statusDate: parseSapsDate(r.statusDate) ?? row.statusDate,
      sapsUpdatedOn: parseSapsDate(updatedOn) ?? row.sapsUpdatedOn,
    };

    const previous = await this.prisma.trackedApplicationEvent.findFirst({
      where: { trackedId: row.id, source: 'SAPS' },
      orderBy: { observedAt: 'desc' },
    });

    const statusDescription = r.statusDescription.trim() || null;
    const nextStep = r.nextStep.trim() || null;

    // No previous SAPS observation means this read IS the baseline, and the
    // baseline is worth a timeline entry even though nothing "changed".
    const changed =
      !previous ||
      previous.status !== next.status ||
      !sameInstant(previous.statusDate, next.statusDate) ||
      previous.statusDescription !== statusDescription ||
      previous.nextStep !== nextStep;

    if (changed) {
      await this.prisma.trackedApplicationEvent.create({
        data: {
          trackedId: row.id,
          source: 'SAPS',
          observedAt: now,
          status: next.status,
          statusDate: next.statusDate,
          applicationType: next.applicationType,
          applicationNumber: next.applicationNumber,
          calibre: next.calibre,
          make: next.make,
          serial: next.serialSeen,
          statusDescription,
          nextStep,
          rowSha256: rowSha256(r),
        },
      });
    }

    const updated = await this.prisma.trackedApplication.update({
      where: { id: row.id },
      data: { ...next, lastCheckedAt: now, lastOutcome: 'row', lastError: null },
    });

    // ⚠️ NEVER ON THE BASELINE. The member just added this tracker; telling
    // them it "changed" to the status they can already see is a notification
    // about nothing, and it teaches them the alert is noise.
    if (changed && previous) {
      await this.notifyChange(row, updated, previous.status).catch((err) =>
        this.logger.warn(
          `tracker change notification for ${row.id} did not send: ${(err as Error).message}`,
        ),
      );
    }

    return this.toView(updated, await this.eventCount(row.id));
  }

  private async notifyChange(
    row: TrackedApplication,
    updated: TrackedApplication,
    previousStatus: string | null,
  ): Promise<void> {
    const member = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { email: true, firstName: true, notifyEmailEnabled: true },
    });
    if (!member) return;

    await this.notifications.trackedApplicationChanged({
      userId: row.userId,
      email: member.email,
      name: member.firstName ?? 'there',
      trackedId: row.id,
      label: row.label ?? updated.applicationNumber ?? 'your application',
      previousStatus,
      status: updated.status,
      statusDate: updated.statusDate,
      emailEnabled: member.notifyEmailEnabled !== false,
    });
  }

  // ── HELPERS ────────────────────────────────────────────────────────

  private parseKind(raw: string | undefined): TrackedApplicationKind {
    const v = String(raw ?? '').trim().toUpperCase();
    if (!TRACKED_KINDS.includes(v as TrackedApplicationKind)) {
      throw new BadRequestException('Choose an application type.');
    }
    return v as TrackedApplicationKind;
  }

  private async findOwned(
    userId: string,
    id: string,
  ): Promise<TrackedApplication> {
    const row = await this.prisma.trackedApplication.findFirst({
      where: { id, userId },
    });
    if (!row) throw new NotFoundException();
    return row;
  }

  private async eventCount(id: string): Promise<number> {
    return this.prisma.trackedApplicationEvent.count({
      where: { trackedId: id },
    });
  }

  private async assertCooldown(row: TrackedApplication): Promise<void> {
    if (!row.lastCheckedAt) return;
    const hours = await this.settings.get(
      FLAGS.licenceTrackerCheckCooldownHours,
    );
    const next = new Date(
      row.lastCheckedAt.getTime() + hours * 60 * 60 * 1000,
    );
    if (next.getTime() <= Date.now()) return;
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message:
          'We checked SAPS for this application recently. Repeated enquiries are answered with a block page, so please try again after the time shown.',
        retryAfter: next.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async pause(): Promise<void> {
    if (this.delayMs <= 0) return;
    const jitter = Math.floor(Math.random() * Math.ceil(this.delayMs / 2));
    await new Promise((resolve) =>
      setTimeout(resolve, this.delayMs + jitter),
    );
  }

  /**
   * One alert per cause per tracker per day.
   *
   * ⚠️ THE DEDUPE IS NOT COSMETIC. This is raised from inside a sweep, and
   * without it a page that has been redesigned — or a block that lasts all
   * afternoon — files one alert per tracker per pass until the inbox is
   * useless and the operator stops reading it.
   */
  private async raiseAlert(
    type: string,
    referenceId: string,
    message: string,
  ): Promise<void> {
    try {
      const recent = await this.prisma.adminAlert.findFirst({
        where: {
          type,
          referenceId,
          resolved: false,
          createdAt: { gte: new Date(Date.now() - ALERT_DEDUPE_MS) },
        },
        select: { id: true },
      });
      if (recent) return;
      await this.prisma.adminAlert.create({
        data: {
          type,
          referenceId,
          urgent: false,
          context: JSON.stringify({ message: message.slice(0, 500) }),
        },
      });
    } catch (err) {
      this.logger.warn(
        `could not raise ${type} for ${referenceId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The wire shape. ⚠️ `referenceEncrypted`, `referenceHash` and
   * `serialEncrypted` are dropped here and must never be added back — this
   * object is sent to the member.
   */
  private toView(row: TrackedApplication, eventCount: number): TrackerView {
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      reference: tryDecryptText(row.referenceEncrypted) ?? '',
      serial: tryDecryptText(row.serialEncrypted),
      submittedOn: row.submittedOn,
      applicationType: row.applicationType,
      applicationNumber: row.applicationNumber,
      calibre: row.calibre,
      make: row.make,
      serialSeen: row.serialSeen,
      status: row.status,
      statusDate: row.statusDate,
      sapsUpdatedOn: row.sapsUpdatedOn,
      lastCheckedAt: row.lastCheckedAt,
      lastOutcome: row.lastOutcome,
      lastError: row.lastError,
      createdAt: row.createdAt,
      eventCount,
    };
  }

  private toEventView(e: TrackedApplicationEvent) {
    return {
      id: e.id,
      source: e.source,
      observedAt: e.observedAt,
      status: e.status,
      statusDate: e.statusDate,
      applicationType: e.applicationType,
      applicationNumber: e.applicationNumber,
      calibre: e.calibre,
      make: e.make,
      serial: e.serial,
      statusDescription: e.statusDescription,
      nextStep: e.nextStep,
    };
  }
}

