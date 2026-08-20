import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CredentialKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import { LicenceCentreQuotaService } from './licence-centre-quota.service';
import { LicenceCentreExtractService } from './licence-centre-extract.service';
import { MotivationsService } from '../motivations/motivations.service';
import { REFUSAL_COPY, renewalPlan, renewalRefusal } from './licence-renewal';
import {
  competencyLapses,
  expiryState,
  parseIsoDate,
  toIsoDate,
  withinRenewalWindow,
} from './licence-dates';

// ────────────────────────────────────────────────────────────────────
// THE MEMBER'S OWN DOCUMENTS.
//
// Storage is free for everyone (pricing model C); the reminder AUTOMATION is
// what AO Pro buys. That is deliberate: the more documents are in here, the
// better every other part of this works, so charging to store them would be
// charging for the thing we most want to happen.
//
// ⚠️ NOTHING HERE STAMPS confirmedAt EXCEPT confirmExpiry. Extraction
// proposes; the member confirms; only then can a reminder fire. Every other
// write path must leave confirmedAt alone.
// ────────────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TITLE = 120;

@Injectable()
export class LicenceCentreService {
  private readonly logger = new Logger(LicenceCentreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly quota: LicenceCentreQuotaService,
    private readonly extract: LicenceCentreExtractService,
    // The renewal one-tap. One-way dependency: nothing in motivations/ reaches
    // back into the Centre.
    private readonly motivations: MotivationsService,
  ) {}

  /** @CurrentUser() gives the CLERK id; everything here keys on our own. */
  private async requireUser(clerkId: string): Promise<{ id: string }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private readDetails(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return decryptJson<Record<string, string>>(encrypted);
    } catch (err) {
      // A document whose details will not decrypt is still a document: the
      // member can see it, download it and read the date off it themselves.
      this.logger.error(
        `Could not decrypt credential details: ${(err as Error).message}`,
      );
      return {};
    }
  }

  async list(clerkId: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const now = new Date();

    const rows = await this.prisma.credential.findMany({
      where: { userId: user.id },
      orderBy: [{ expiresOn: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        kind: true,
        coversKinds: true,
        title: true,
        issuedOn: true,
        expiresOn: true,
        confirmedAt: true,
        remindersMuted: true,
        extractionOk: true,
        extractedFields: true,
        detailsEncrypted: true,
        storageKey: true,
        purgedAt: true,
        mimeType: true,
        byteSize: true,
        createdAt: true,
      },
    });

    // ── naming repair, once per row ──────────────────────────────────
    //
    // Documents uploaded before we named them from their contents still read
    // "Firearm licence", and six rows all called "Firearm licence" is a
    // filing cabinet with no labels. Renamed in place the first time they are
    // listed; the guard is exact equality with OUR placeholder, so a name the
    // member typed is never touched. Failures are swallowed — a rename is a
    // convenience and must not take the Centre down with it.
    const renamed = new Map<string, string>();
    for (const r of rows) {
      if (r.title !== DEFAULT_TITLE[r.kind]) continue;
      const better = derivedCredentialTitle(
        r.kind,
        this.readDetails(r.detailsEncrypted),
      );
      if (better) renamed.set(r.id, better);
    }
    if (renamed.size) {
      await Promise.all(
        [...renamed].map(([id, title]) =>
          this.prisma.credential
            .update({ where: { id }, data: { title } })
            .catch(() => undefined),
        ),
      );
    }

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      coversKinds: r.coversKinds,
      title: renamed.get(r.id) ?? r.title,
      issuedOn: r.issuedOn ? toIsoDate(r.issuedOn) : null,
      expiresOn: r.expiresOn ? toIsoDate(r.expiresOn) : null,
      confirmed: r.confirmedAt !== null,
      remindersMuted: r.remindersMuted,
      state: expiryState(r.expiresOn, r.confirmedAt, now),
      // ⚠️ DELIBERATELY NOT `state === 'expiring'`. The card turns amber at 90
      // days, which is the section 24(1) deadline itself; the renewal is
      // offered at six months so there is still time to act on it. Tying the
      // two together would first mention renewal on the last day it can be
      // lodged.
      renewalDue: withinRenewalWindow(r.expiresOn, r.confirmedAt, now),
      details: this.readDetails(r.detailsEncrypted),
      // Same statutory arithmetic the upload path offers, so a document that
      // reaches the confirm step FROM THE LIST — which is how every
      // phone-scanned document reaches it — gets the same prefilled date and
      // the same explanation as one uploaded at the desk.
      derivedExpiry: derivedExpiryFor(
        r.kind,
        r.expiresOn ? toIsoDate(r.expiresOn) : null,
        r.issuedOn ? toIsoDate(r.issuedOn) : null,
      ),
      // The row can outlive its bytes after an erasure. Say so rather than
      // let a download fail with something puzzling.
      available: r.storageKey !== null && r.purgedAt === null,
      mimeType: r.mimeType,
      byteSize: r.byteSize,
      createdAt: r.createdAt,
    }));
  }

  async create(
    clerkId: string,
    /**
     * NULL MEANS "SORT IT FOR ME" — the batch path. A member emptying a folder
     * into the vault cannot label files that do not exist yet, and the confirm
     * step they already walk through is where they check what we made of each.
     */
    kind: CredentialKind | null,
    title: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    if (!file?.buffer?.length) {
      throw new BadRequestException('That file appears to be empty.');
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('That file is larger than 10 MB.');
    }

    const cap = await this.settings.get(FLAGS.licenceCentreMaxCredentials);
    const held = await this.prisma.credential.count({
      where: { userId: user.id },
    });
    if (held >= cap) {
      throw new ConflictException(
        `You can keep ${cap} documents here. Remove one before adding another.`,
      );
    }

    // NAME IT, if they did not. Before the row, because kind is a column on
    // it. Fail-soft: an unsortable document becomes OTHER, which the confirm
    // step shows them anyway.
    let resolved: CredentialKind = kind ?? 'OTHER';
    let autoFiled = false;
    let confident = false;
    // Other roles this same document fills. An association membership
    // certificate routinely IS the letter of good standing and the dedicated
    // status proof as well, under one date — see coversKinds on the model.
    let alsoCovers: CredentialKind[] = [];
    if (!kind) {
      const guess = await this.extract
        .classify({ bytes: file.buffer, mimeType: file.mimetype })
        .catch(() => null);
      autoFiled = true;
      if (guess) {
        resolved = guess.kind;
        confident = guess.confident;
        alsoCovers = guess.alsoCovers;
      }
    }

    // BYTES FIRST, ROW SECOND. The database's unique constraint is what spots
    // a duplicate — reading first and writing after is a race.
    let stored: { storageKey: string; sha256: string; byteSize: number };
    try {
      stored = await this.files.write('credentials', file.buffer, new Date());
    } catch (err) {
      // SecureFileStorageService throws plain Errors, an unconfigured
      // ID_HASH_SECRET among them. Unwrapped that is a 500 with a stack trace
      // instead of something a member can act on.
      this.logger.error(
        `Credential upload for ${user.id} could not be stored: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not store that document just now. Please try again.',
      );
    }

    const clean = (title ?? '').trim().slice(0, MAX_TITLE);
    let created: { id: string };
    try {
      created = await this.prisma.credential.create({
        data: {
          userId: user.id,
          kind: resolved,
          title: clean || DEFAULT_TITLE[resolved],
          coversKinds: alsoCovers,
          storageKey: stored.storageKey,
          mimeType: file.mimetype,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
        },
        select: { id: true },
      });
    } catch (err) {
      // The bytes must not outlive the attempt: a file with no row pointing at
      // it is undeletable except by hand.
      await this.files.remove(stored.storageKey).catch(() => undefined);
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'That exact file is already in your Licence Centre.',
        );
      }
      throw err;
    }

    // Reading the document runs AFTER the row is committed and outside the
    // compensating delete, so a vision outage costs a convenience rather than
    // the upload itself.
    const reading = await this.extract
      .read({
        kind: resolved,
        bytes: file.buffer,
        mimeType: file.mimetype,
        alsoCovers,
      })
      .catch(() => null);

    // Named from what we just read, unless the member named it themselves.
    // `clean` is their words; only OUR placeholder gets replaced.
    const derived = clean
      ? null
      : derivedCredentialTitle(resolved, reading?.details ?? {});

    if (reading) {
      await this.prisma.credential
        .update({
          where: { id: created.id },
          data: {
            ...(derived ? { title: derived } : {}),
            issuedOn: parseIsoDate(reading.issuedOn),
            // ⚠️ PROPOSED, NOT CONFIRMED. expiresOn is written so the member
            // sees a filled-in date to check, and confirmedAt stays null, so
            // the reminder sweep cannot see this row until they say it is
            // right.
            expiresOn: parseIsoDate(reading.expiresOn),
            extractionOk:
              Boolean(reading.expiresOn) ||
              Object.keys(reading.details).length > 0,
            // Keys in the clear, values encrypted. The key names are not PII.
            extractedFields: Object.keys(reading.details),
            detailsEncrypted: Object.keys(reading.details).length
              ? encryptJson(reading.details)
              : null,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `Could not stash reading for credential ${created.id}: ${(err as Error).message}`,
          ),
        );
    }

    return {
      id: created.id,
      kind: resolved,
      coversKinds: alsoCovers,
      title: clean || derived || DEFAULT_TITLE[resolved],
      // Tells the confirm step which documents WE named, so it can ask.
      autoFiled,
      confident,
      proposed: {
        expiresOn: reading?.expiresOn ?? null,
        issuedOn: reading?.issuedOn ?? null,
        details: reading?.details ?? {},
        lowConfidence: reading?.lowConfidence ?? [],
        /**
         * An expiry we worked out rather than read.
         *
         * ⚠️ ONLY WHERE A STATUTE SETS IT. A competency certificate normally
         * prints an issue date and nothing else — the operator photographed
         * one whose issue date read perfectly and whose expiry box we then
         * told him we could not read, which is true and useless. Section
         * 10(2) says a competency certificate lapses five years from issue,
         * so the arithmetic is worth doing for him.
         *
         * Never for a licence (section 27 sets two, five or ten years by
         * section) and never for dedicated status (the association sets it).
         * Guessing either would be inventing a deadline.
         */
        derivedExpiry: derivedExpiryFor(resolved, reading?.expiresOn ?? null, reading?.issuedOn ?? null),
      },
    };
  }

  /**
   * THE SAFETY RAIL.
   *
   * A date only starts driving reminders once the member has looked at it and
   * said it is right. Extraction can misread a smudged card, and a wrong date
   * that silently drives reminders is how somebody misses a real deadline
   * because of us — which is worse than sending nothing, because they stopped
   * checking themselves once we told them we were watching.
   */
  async confirmExpiry(
    clerkId: string,
    id: string,
    expiresOn: string,
    issuedOn?: string,
    /**
     * The confirm screen is where a member checks EVERYTHING we made of a
     * document, not only its date — the kind decides whether a renewal is
     * offered at all, and the title is what they will recognise it by in a
     * reminder. Both optional: an untouched field is left alone.
     */
    kind?: CredentialKind,
    title?: string,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const expiry = parseIsoDate(expiresOn);
    if (!expiry) {
      throw new BadRequestException(
        'That is not a date we can read. Enter it as yyyy-mm-dd, exactly as it is printed on the document.',
      );
    }

    // Re-confirming a NEW date has to clear the stages, or a renewed licence
    // never gets reminded about again — every column is already stamped from
    // the document it replaced.
    const before = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: { id: true, expiresOn: true },
    });
    if (!before) throw new NotFoundException('Document not found');

    const dateChanged =
      before.expiresOn === null ||
      before.expiresOn.getTime() !== expiry.getTime();

    await this.prisma.credential.update({
      where: { id: before.id },
      data: {
        expiresOn: expiry,
        issuedOn: parseIsoDate(issuedOn ?? null),
        confirmedAt: new Date(),
        ...(kind ? { kind } : {}),
        ...((title ?? '').trim()
          ? { title: (title ?? '').trim().slice(0, MAX_TITLE) }
          : {}),
        ...(dateChanged
          ? {
              remind180SentAt: null,
              remind120SentAt: null,
              remind100SentAt: null,
              remind30SentAt: null,
              remindD0SentAt: null,
            }
          : {}),
      },
    });

    // Clear the "confirm this" nudge and any expiry reminder standing against
    // the old date. A dismissible:false row can only be cleared this way.
    await this.notifications
      .resolveByEntity('credential', id, {
        userId: user.id,
        resolvedBy: 'user_action',
      })
      .catch(() => undefined);

    return { confirmed: true, expiresOn: toIsoDate(expiry) };
  }

  /**
   * Rename a document.
   *
   * Separate from confirm(), which also takes a title: confirming is a
   * statement that the DATES are right, and making somebody re-confirm an
   * expiry to correct a spelling is how a wrong date gets confirmed by
   * reflex. An empty name falls back to the plain kind rather than leaving a
   * blank row — there is no way to have no name at all.
   */
  async rename(clerkId: string, id: string, title: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const clean = (title ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE);
    const row = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: { kind: true },
    });
    if (!row) throw new NotFoundException('Document not found');
    const next = clean || DEFAULT_TITLE[row.kind];
    await this.prisma.credential.update({
      where: { id },
      data: { title: next },
    });
    return { title: next };
  }

  /** Their call. We remind; we never insist. */
  async mute(clerkId: string, id: string, muted: boolean) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const claim = await this.prisma.credential.updateMany({
      where: { id, userId: user.id },
      data: { remindersMuted: muted },
    });
    if (claim.count === 0) throw new NotFoundException('Document not found');
    if (muted) {
      await this.notifications
        .resolveByEntity('credential', id, {
          userId: user.id,
          resolvedBy: 'user_action',
        })
        .catch(() => undefined);
    }
    return { muted };
  }

  async readFile(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    // Ownership is a WHERE CLAUSE, never a post-fetch check.
    const row = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        storageKey: true,
        purgedAt: true,
      },
    });
    if (!row) throw new NotFoundException('Document not found');
    if (!row.storageKey || row.purgedAt) {
      throw new GoneException('That document has been deleted.');
    }

    let bytes: Buffer;
    try {
      bytes = await this.files.read(row.storageKey);
    } catch (err) {
      this.logger.error(
        `Credential ${id}: could not read bytes: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('We could not open that document.');
    }

    const ext = row.mimeType === 'application/pdf' ? 'pdf' : 'jpg';
    return {
      bytes,
      mimeType: row.mimeType,
      filename: `${row.kind.toLowerCase()}-${row.id.slice(-6)}.${ext}`,
    };
  }

  /** POPIA erasure of one document. Files first — a cascade cannot reach disk. */
  async remove(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: { id: true, storageKey: true },
    });
    if (!row) throw new NotFoundException('Document not found');

    if (row.storageKey) {
      try {
        await this.files.remove(row.storageKey);
      } catch (err) {
        // Deleting the row now would orphan the bytes with nothing left
        // pointing at them — invisible to every future sweep.
        this.logger.error(
          `Credential ${id}: could not remove bytes: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException(
          'We could not delete that document just now. Please try again.',
        );
      }
    }

    await this.prisma.credential.delete({ where: { id: row.id } });
    await this.notifications
      .resolveByEntity('credential', id, { userId: user.id })
      .catch(() => undefined);
    return { removed: true };
  }

  /**
   * START A RENEWAL FROM A DOCUMENT IN THE VAULT.
   *
   * THE LOOP THE CENTRE EXISTS FOR. A licence expires on a statutory clock, so
   * the demand recurs forever; the reminder lands, and this turns it into a
   * section 24 motivation that already knows the licence number, the expiry
   * and the firearm — priced by the existing table.
   *
   * ⚠️ IT DOES NOT PRE-WRITE THE ARGUMENT. `continued_use` — what they have
   * actually done with the firearm since it was issued — is left empty on
   * purpose. It is the only part of a renewal that argues anything, and
   * putting words in an applicant's mouth on a document they sign as their own
   * is not a convenience.
   */
  async startRenewal(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        kind: true,
        title: true,
        expiresOn: true,
        confirmedAt: true,
        detailsEncrypted: true,
        storageKey: true,
        purgedAt: true,
        mimeType: true,
      },
    });
    if (!row) throw new NotFoundException('Document not found');

    const src = {
      kind: row.kind,
      title: row.title,
      expiresOn: row.expiresOn,
      confirmedAt: row.confirmedAt,
      details: this.readDetails(row.detailsEncrypted),
    };

    // Refuse by NAME and early. A renewal that opens empty with no explanation
    // reads as the button being broken.
    const refusal = renewalRefusal(src);
    if (refusal) throw new BadRequestException(REFUSAL_COPY[refusal]);

    const plan = renewalPlan(src);

    // IDEMPOTENT PER LICENCE. Tapping again — after a browser Back, or on a
    // later visit, since the card never changes state — used to hit the
    // one-per-type constraint and tell them to delete the renewal they were
    // trying to get back to. Hand them the existing one instead.
    const existing = await this.prisma.motivation.findFirst({
      where: {
        userId: user.id,
        licenceType: 'S24_RENEWAL',
        applicationRef: plan.applicationRef,
      },
      select: { id: true, referenceNumber: true },
    });
    if (existing) {
      return {
        motivationId: existing.id,
        referenceNumber: existing.referenceNumber,
        seeded: 0,
        resumed: true,
      };
    }

    // ⚠️ THE MOTIVATION IS CREATED BY THE WRITER, not written here. It owns the
    // MO reference number, the beta seat check, the profile prefill and the
    // variant seed — a second creation path would drift from all four.
    // applicationRef carries the licence number so a member with three
    // licences can renew all three: the constraint is
    // @@unique([userId, licenceType, applicationRef]).
    const motivation = await this.motivations.create(
      clerkId,
      'S24_RENEWAL',
      plan.applicationRef,
      plan.seed,
    );

    // Carry the document itself across, so the pack is complete without asking
    // for a photograph they have already given us.
    //
    // ⚠️ THE BYTES ARE COPIED, NOT SHARED. The two rows have different
    // retention lives — a motivation upload purges on the writer's clock, a
    // vault document lives as long as the account — and one must never be able
    // to delete the other's file.
    if (row.storageKey && !row.purgedAt) {
      try {
        const bytes = await this.files.read(row.storageKey);
        await this.motivations.addUpload(
          clerkId,
          motivation.id,
          'CURRENT_LICENCE',
          { buffer: bytes, mimetype: row.mimeType },
          // Already read once, on the way into the vault. A second vision call
          // would spend money to learn what we have just seeded.
          { skipExtraction: true },
        );
      } catch (err) {
        // The renewal itself is fine without the attachment — they can upload
        // it in the wizard. Losing the motivation over a copy would not be.
        this.logger.warn(
          `Renewal ${motivation.id}: could not carry across credential ${id}: ${(err as Error).message}`,
        );
      }
    }

    return {
      motivationId: motivation.id,
      referenceNumber: motivation.referenceNumber,
      seeded: Object.keys(plan.seed).length,
      resumed: false,
    };
  }

  /** Counts and health only — never a blob, never a decrypted detail. */
  async adminHealth() {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [byKind, total, unconfirmed, expiring30, expired, muted] =
      await Promise.all([
        this.prisma.credential.groupBy({
          by: ['kind'],
          _count: { _all: true },
        }),
        this.prisma.credential.count(),
        this.prisma.credential.count({ where: { confirmedAt: null } }),
        this.prisma.credential.count({
          where: {
            confirmedAt: { not: null },
            expiresOn: { gt: now, lte: in30 },
          },
        }),
        this.prisma.credential.count({
          where: { confirmedAt: { not: null }, expiresOn: { lt: now } },
        }),
        this.prisma.credential.count({ where: { remindersMuted: true } }),
      ]);
    return {
      total,
      byKind: byKind.map((r) => ({ kind: r.kind, count: r._count._all })),
      // The number worth watching: documents nobody has confirmed are
      // documents no reminder will ever fire for.
      unconfirmed,
      expiring30,
      expired,
      muted,
    };
  }
}

/**
 * The expiry a statute implies, when the document does not print one.
 *
 * Returns null unless we can say WHY, because a date with no reason behind it
 * is indistinguishable to the member from one we read off the page — and this
 * one they are being asked to confirm.
 */
function derivedExpiryFor(
  kind: CredentialKind,
  readExpiry: string | null,
  readIssued: string | null,
): { on: string; why: string } | null {
  if (readExpiry || !readIssued) return null;
  if (kind !== 'COMPETENCY_CERTIFICATE') return null;
  const issued = parseIsoDate(readIssued);
  if (!issued) return null;
  return {
    on: toIsoDate(competencyLapses(issued)),
    why: 'A competency certificate lapses five years after it is issued (section 10(2) of the Firearms Control Act). Check it against your certificate.',
  };
}

/**
 * A name the owner will recognise, built from what we read off the document.
 *
 * ⚠️ "Firearm licence", six times, is a filing cabinet with no labels. Somebody
 * with four rifles and two handguns cannot tell which row is which without
 * opening each one, and every picker that offers them — the motivation's
 * owned-firearms fill especially — offers six identical choices.
 *
 * Make and calibre is what a shooter actually calls a firearm: "Howa 6.5
 * Creedmoor", not "licence 3088". Anything else keeps its plain kind name,
 * because a competency certificate has nothing to distinguish it BY.
 *
 * Returns null when there is nothing better to say, so the caller can leave
 * the existing title alone rather than overwrite it with a worse one.
 */
export function derivedCredentialTitle(
  kind: CredentialKind,
  details: Record<string, string>,
): string | null {
  if (kind !== 'FIREARM_LICENCE') return null;
  const tidy = (v: string | undefined) =>
    (v ?? '')
      .trim()
      // Licences are typed in block capitals; "NORDISKE PRECISION 223 REM"
      // shouted across a list is harder to read than the same words are.
      .replace(/\s+/g, ' ')
      .slice(0, 40);
  const make = tidy(details.make);
  const calibre = tidy(details.calibre);
  const name = [make, calibre].filter(Boolean).join(' ').trim();
  return name.length >= 3 ? name.slice(0, MAX_TITLE) : null;
}

const DEFAULT_TITLE: Record<CredentialKind, string> = {
  FIREARM_LICENCE: 'Firearm licence',
  COMPETENCY_CERTIFICATE: 'Competency certificate',
  DEDICATED_HUNTER: 'Dedicated hunter status',
  PROFESSIONAL_HUNTER: 'Professional hunter registration',
  DEDICATED_STATUS: 'Dedicated status',
  PROFICIENCY: 'Proficiency certificate',
  GOOD_STANDING: 'Letter of good standing',
  OTHER: 'Supporting document',
};
