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
import { dateIsSettled } from './licence-dates';
import {
  mayArmDerivedExpiry,
  mayArmReadExpiry,
} from './credential-auto-date';
import { recomputeDerivedCompetencies } from './credential-derive-recompute';
import {
  cleanAlsoCovers,
  currentKind,
  LicenceCentreExtractService,
} from './licence-centre-extract.service';
import {
  categoryFromText,
  deriveCertificateExpiry,
  type Endorsement,
  endorsementDisplay,
  type LinkedLicence,
  parseEndorsements,
} from '../common/sa-competency';
import { defaultsToNeverExpires, isPhotograph } from './credential-kinds';
import { MotivationsService } from '../motivations/motivations.service';
import { REFUSAL_COPY, renewalPlan, renewalRefusal } from './licence-renewal';
import { buildAnnexures } from '../motivations/motivation-checklist';
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

/** One application a stored document already appears in. */
export interface CredentialUsage {
  motivationId: string;
  referenceNumber: string;
  licenceType: string;
  status: string;
  /** Null until the pack has enough attached for this kind to be lettered. */
  annexure: string | null;
}

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

  /**
   * Which of the member's applications each stored document already sits in.
   *
   * ⚠️ MATCHED ON THE FILE FINGERPRINT, BECAUSE THERE IS NO LINK COLUMN AND
   * THERE DOES NOT NEED TO BE. Attaching a document from the Document Centre
   * copies its bytes into a MotivationUpload; both rows then carry sha256 of
   * the SAME plaintext, which the schema already keeps to spot a document
   * uploaded twice and to prove which file a reading came from. So "where else
   * is this?" is a join on a column that exists rather than a migration.
   *
   * ⚠️ TWO THINGS THIS BUYS THAT A LINK COLUMN WOULD NOT. A file the member
   * uploaded straight into an application, never having filed it here, still
   * matches — it IS the same page in that pack. And a document attached before
   * this endpoint existed is found, where a column added today would have been
   * null for every one of them.
   *
   * ⚠️ AND ONE IT LOSES: replacing a document with a newer scan changes its
   * bytes, so packs built from the old file stop matching. That is a real
   * limit, stated at the call site, not a bug to fix here.
   *
   * ⚠️ SCOPED TO THE MEMBER'S OWN MOTIVATIONS, ALWAYS. A sha256 is a global
   * fact about bytes: two people who upload the identical blank SAPS form
   * share one. Matching on the hash alone would tell each of them their
   * document is in a stranger's application, and name it.
   */
  async usage(clerkId: string): Promise<Record<string, CredentialUsage[]>> {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const creds = await this.prisma.credential.findMany({
      where: { userId: user.id },
      select: { id: true, kind: true, sha256: true },
    });
    if (creds.length === 0) return {};

    // Several documents can share a fingerprint only if they are the same
    // bytes, which @@unique([userId, sha256]) already prevents per member —
    // but the grouping below does not depend on that holding.
    const byHash = new Map<string, string[]>();
    for (const c of creds) {
      byHash.set(c.sha256, [...(byHash.get(c.sha256) ?? []), c.id]);
    }

    // Every application of THIS member holding any of those bytes.
    const hits = await this.prisma.motivationUpload.findMany({
      where: {
        sha256: { in: [...byHash.keys()] },
        motivation: { userId: user.id },
      },
      select: { sha256: true, kind: true, motivationId: true },
    });
    if (hits.length === 0) return {};

    // ⚠️ THE LETTER NEEDS THE WHOLE PACK, NOT THE MATCHED ROW. buildAnnexures
    // letters a motivation's uploads in kind order, so the letter this
    // document carries depends on everything ELSE attached to that
    // application. Fetching only the matches would letter from A every time.
    const motivationIds = [...new Set(hits.map((h) => h.motivationId))];
    const motivations = await this.prisma.motivation.findMany({
      where: { id: { in: motivationIds }, userId: user.id },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        status: true,
        uploads: { select: { kind: true } },
      },
    });

    const packs = new Map(
      motivations.map((m) => [
        m.id,
        {
          referenceNumber: m.referenceNumber,
          licenceType: m.licenceType,
          status: m.status,
          letterFor: new Map(
            buildAnnexures(m.uploads.map((u) => u.kind)).map((a) => [
              a.kind,
              a.letter,
            ]),
          ),
        },
      ]),
    );

    const out: Record<string, CredentialUsage[]> = {};
    for (const hit of hits) {
      const pack = packs.get(hit.motivationId);
      if (!pack) continue; // scoped out above; belt and braces
      for (const credentialId of byHash.get(hit.sha256) ?? []) {
        const already = out[credentialId] ?? [];
        // One line per application, even where a pack holds several copies of
        // the same page under one letter (four safe photographs do).
        if (already.some((u) => u.motivationId === hit.motivationId)) continue;
        already.push({
          motivationId: hit.motivationId,
          referenceNumber: pack.referenceNumber,
          licenceType: pack.licenceType,
          status: pack.status,
          annexure: pack.letterFor.get(hit.kind) ?? null,
        });
        out[credentialId] = already;
      }
    }
    return out;
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
        neverExpires: true,
        issuedOnUnknown: true,
        remindersMuted: true,
        extractionOk: true,
        extractedFields: true,
        detailsEncrypted: true,
        storageKey: true,
        purgedAt: true,
        mimeType: true,
        byteSize: true,
        createdAt: true,
        autoFiled: true,
        namedConfident: true,
        firearmCategory: true,
        dateSource: true,
        dateSourceNote: true,
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
    /**
     * Licences filed before the category column existed.
     *
     * ⚠️ REPAIRED HERE RATHER THAN IN THE MIGRATION, because the type lives
     * inside an AES-GCM blob that only the application can open — SQL cannot
     * backfill it. This loop already decrypts every row for the naming repair,
     * so the category costs nothing extra to work out.
     *
     * ⚠️ ONLY WHERE IT IS NULL. Never re-derived over a value already stored:
     * a member may have corrected the type, and re-reading our own extraction
     * over their correction on every list() would put it back.
     */
    const categorised = new Map<string, string>();
    for (const r of rows) {
      const details = this.readDetails(r.detailsEncrypted);
      if (r.title === DEFAULT_TITLE[r.kind]) {
        const better = derivedCredentialTitle(r.kind, details);
        if (better) renamed.set(r.id, better);
      }
      if (r.kind === 'FIREARM_LICENCE' && r.firearmCategory === null) {
        const cat = categoryFromText(details.firearm_type ?? '');
        if (cat) categorised.set(r.id, cat);
      }
    }
    if (categorised.size) {
      await Promise.all(
        [...categorised].map(([id, firearmCategory]) =>
          this.prisma.credential
            .update({ where: { id }, data: { firearmCategory } })
            .catch(() => undefined),
        ),
      );
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

    /**
     * The member's licences, in the shape the derivation wants.
     *
     * ⚠️ BUILT ONCE FOR THE WHOLE LIST. This replaced a boolean — "does this
     * member hold ANY firearm licence" — which could not express the rule,
     * because the rule is per firearm CATEGORY. A rifle licence says nothing
     * about a handgun competency.
     *
     * ⚠️ A LICENCE WITH NO CATEGORY IS LEFT OUT, NOT DEFAULTED. It would
     * otherwise push some competency's expiry out on the strength of a firearm
     * we could not identify. The category is filled in above on first read,
     * so this is empty only for a card we genuinely cannot categorise.
     *
     * ⚠️ AND A CONFIRMED DATE ONLY. An unconfirmed expiry is our reading, not
     * the member's answer; letting one date a competency would build a
     * derivation on a guess and then remind on it.
     */
    const licences: LinkedLicence[] = rows
      .filter(
        (r) =>
          (r.kind === 'FIREARM_LICENCE' ||
            r.coversKinds.includes('FIREARM_LICENCE')) &&
          r.firearmCategory !== null &&
          r.expiresOn !== null &&
          r.confirmedAt !== null,
      )
      .map((r) => ({
        category: (categorised.get(r.id) ??
          r.firearmCategory) as LinkedLicence['category'],
        expiresOn: r.expiresOn,
      }));

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      coversKinds: r.coversKinds,
      title: renamed.get(r.id) ?? r.title,
      issuedOn: r.issuedOn ? toIsoDate(r.issuedOn) : null,
      expiresOn: r.expiresOn ? toIsoDate(r.expiresOn) : null,
      confirmed: r.confirmedAt !== null,
      // ⚠️ WHAT THE MEMBER SAID ABOUT THE DATES, not what the kind implies.
      // The card needs both: a ticked box is a settled answer and renders
      // neutral, while a blank one that was never ticked is still outstanding.
      neverExpires: r.neverExpires,
      issuedOnUnknown: r.issuedOnUnknown,
      remindersMuted: r.remindersMuted,
      state: expiryState(r.expiresOn, dateIsSettled(r), now, r.neverExpires),
      // ⚠️ DELIBERATELY NOT `state === 'expiring'`. The card turns amber at 90
      // days, which is the section 24(1) deadline itself; the renewal is
      // offered at six months so there is still time to act on it. Tying the
      // two together would first mention renewal on the last day it can be
      // lodged.
      renewalDue: withinRenewalWindow(r.expiresOn, dateIsSettled(r), now),
      details: this.readDetails(r.detailsEncrypted),
      // Same statutory arithmetic the upload path offers, so a document that
      // reaches the confirm step FROM THE LIST — which is how every
      // phone-scanned document reaches it — gets the same prefilled date and
      // the same explanation as one uploaded at the desk.
      derivedExpiry: derivedExpiryFor(
        r.kind,
        r.expiresOn ? toIsoDate(r.expiresOn) : null,
        r.issuedOn ? toIsoDate(r.issuedOn) : null,
        licences,
        r.kind === 'COMPETENCY_CERTIFICATE'
          ? parseEndorsements(this.readDetails(r.detailsEncrypted).covers ?? '')
          : [],
      ),
      // The row can outlive its bytes after an erasure. Say so rather than
      // let a download fail with something puzzling.
      available: r.storageKey !== null && r.purgedAt === null,
      mimeType: r.mimeType,
      byteSize: r.byteSize,
      createdAt: r.createdAt,
      // ⚠️ THE ONLY REASON THE REVIEW SCREEN SURVIVES A REFRESH. Rebuilt
      // from this list rather than from whatever the upload happened to
      // return, so the documents we were unsure about stay the documents we
      // were unsure about. See the model for what these two mean.
      autoFiled: r.autoFiled,
      namedConfident: r.namedConfident,
      /**
       * WHO PUT THE DATE THERE.
       *
       * ⚠️ THE CARD MUST NOT SAY "By you" ABOUT OUR READING. Attributing a
       * date we filled in to the member, by name, on a page about firearm
       * licences, is a false record of who checked what — and the first thing
       * they would check if the reminder were ever wrong.
       */
      dateSource: r.dateSource,
      dateSourceNote: r.dateSourceNote,
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
    //
    // ⚠️ THE MEMBER'S OWN ANSWER IS NORMALISED TOO, NOT ONLY THE MODEL'S.
    // classify() already runs its answer through currentKind, on the reasoning
    // that a retired value is "outside every query that now looks for the
    // current one" — and the same was true of the value arriving in the request
    // body, which nothing normalised and nothing refused. The realistic sender
    // is not an attacker: it is a PWA holding a bundle from before the four
    // safe photographs became SAFE_PHOTOGRAPHS, whose menu still posts
    // SAFE_PHOTO_BOLTS. That upload succeeded and then sat outside the Centre's
    // safe row, the vault picker's safe slot and the migration that had already
    // run — a document filed into a hole, with nothing to tell its owner.
    //
    // NORMALISED RATHER THAN REFUSED, because every retired value maps forward
    // to exactly one current one: there is nothing to ask the member and no
    // information to lose. (The motivation wizard refuses instead — see
    // motivations.controller.ts — because a refusal there costs one refresh and
    // this file has no equivalent moment to refuse in: the scan hand-off posts
    // from a phone that never saw the menu.)
    let resolved: CredentialKind = currentKind(kind ?? 'OTHER');
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
          // ⚠️ STORED, NOT JUST RETURNED. Both of these are in the create
          // response below and were, until now, nowhere else — so the answer
          // survived exactly as long as the page did. See the model.
          autoFiled,
          namedConfident: confident,
          // ⚠️ PRE-TICKED ONLY WHERE WE NEVER LOOKED. A photograph of a safe
          // has no date on it in any sense, and no vision call is spent on
          // one — so starting the box ticked saves a tap that could only ever
          // have one answer. Every other kind starts UNTICKED with whatever
          // vision read in the box, because a green barcoded ID does not
          // expire and a passport does, and only the member can see which
          // they are holding.
          neverExpires: defaultsToNeverExpires(resolved),
          addedVia: kind ? 'member' : 'scan',
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
    //
    // ⚠️ EXCEPT ON A PHOTOGRAPH OF A THING, where there is nothing printed to
    // read. The call would come back empty, and an empty reading sets
    // extractionOk false — which surfaces as "we could not read anything off
    // that one" against a photograph that is perfectly fine.
    const reading = isPhotograph(resolved)
      ? null
      : await this.extract
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

    /**
     * May we act on the date we just read, or only show it?
     *
     * ⚠️ DECIDED BEFORE THE WRITE, AND LOGGED WHEN REFUSED. A refusal is not
     * a failure the member sees — the date still lands in the box — but it is
     * the difference between a reminder that fires and one that does not, so
     * it must be findable afterwards.
     */
    const armed = reading
      ? mayArmReadExpiry({
          kind: resolved,
          coversKinds: alsoCovers,
          expiresOn: reading.expiresOn,
          issuedOn: reading.issuedOn,
          section: reading.details.section ?? null,
          lowConfidence: reading.lowConfidence,
          now: new Date(),
        })
      : { arm: false as const };
    if (reading?.expiresOn && !armed.arm) {
      this.logger.log(
        `Credential ${created.id}: date read but not armed — ${armed.reason}`,
      );
    }

    if (reading) {
      await this.prisma.credential
        .update({
          where: { id: created.id },
          data: {
            ...(derived ? { title: derived } : {}),
            issuedOn: parseIsoDate(reading.issuedOn),
            // ⚠️ WRITTEN, AND ARMED WHERE WE ARE SURE OF IT. This used to say
            // "PROPOSED, NOT CONFIRMED... the reminder sweep cannot see this
            // row until they say it is right", and that was the defect: a
            // member who uploaded a firearm licence and never went back to
            // tick a box got no renewal reminder at all.
            //
            // Operator, 2026-08-25: "insert it. No further user interaction
            // required. Thats why we are designing this system, for
            // automation and ease of use!"
            //
            // The date is written either way. What `armed` decides is whether
            // the sweep may act on it — see credential-auto-date.ts, which is
            // the only thing now standing between an OCR misreading and an
            // SMS about somebody's firearm licence.
            expiresOn: parseIsoDate(reading.expiresOn),
            // ⚠️ FOUND A DATE, SO IT IS NOT A NEVER-EXPIRES DOCUMENT. Only
            // reachable if a kind is ever both pre-ticked and read; leaving
            // the tick standing beside a date would break the CHECK
            // constraint and store two contradictory answers.
            ...(parseIsoDate(reading.expiresOn) ? { neverExpires: false } : {}),
            extractionOk:
              Boolean(reading.expiresOn) ||
              Object.keys(reading.details).length > 0,
            // ⚠️ IN THE CLEAR, SO A COMPETENCY CAN BE DATED. See the column
            // note on the model: the firearm type is read into
            // detailsEncrypted, which SQL cannot open, and the whole
            // derivation is a group-by on the category. Written HERE and not
            // at create() because the row is committed before the document is
            // read — there is nothing to categorise until this point.
            ...(resolved === 'FIREARM_LICENCE'
              ? {
                  firearmCategory: categoryFromText(
                    reading.details.firearm_type ?? '',
                  ),
                }
              : {}),
            ...(armed.arm
              ? {
                  dateSource: 'read',
                  dateSourceNote:
                    'We read this date off the document you uploaded. Change it if it is wrong.',
                  dateReadConfident: true,
                }
              : {}),
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

    /**
     * The member's licences, so a competency uploaded now can be dated now.
     *
     * ⚠️ THE SAME PREDICATE THE LIST PATH USES, and it must stay that way:
     * a document reaching the confirm step from an upload and the same
     * document reaching it from the list have to propose the same date, or
     * the member is shown two different deadlines for one certificate
     * depending on how they got there.
     */
    const licences: LinkedLicence[] = (
      await this.prisma.credential.findMany({
        where: {
          userId: user.id,
          OR: [
            { kind: 'FIREARM_LICENCE' },
            { coversKinds: { has: 'FIREARM_LICENCE' } },
          ],
          firearmCategory: { not: null },
          expiresOn: { not: null },
          confirmedAt: { not: null },
        },
        select: { firearmCategory: true, expiresOn: true },
      })
    ).map((r) => ({
      category: r.firearmCategory as LinkedLicence['category'],
      expiresOn: r.expiresOn,
    }));

    /**
     * A competency's date is arithmetic, so work it out and write it.
     *
     * ⚠️ THE ONE DOCUMENT THAT CANNOT BE READ AND MUST BE COMPUTED. A SAPS
     * 524 prints no expiry at all — in its place it prints the s10(2) rule and
     * leaves the holder to derive the date. Until now we derived it, showed it
     * as a prefill, and waited: so the single document in the Centre whose
     * date we can be MOST certain about was the one guaranteed to remind on
     * nothing.
     *
     * ⚠️ ARMED ONLY WHERE A REAL LICENCE BACKS IT. mayArmDerivedExpiry
     * refuses the five-year no-licence figure, which is the repealed s10(2)
     * applied from habit and which the reference forbids stating as the legal
     * position. It is still shown, still explained, still asks.
     *
     * ⚠️ AND IT IS A SNAPSHOT OF SOMETHING THAT MOVES. The date rolls forward
     * with every licence renewed in the same category, so this is only correct
     * until the member's next licence lands — which is what recomputeDerived
     * on the licence write paths is for.
     */
    /**
     * A NEW licence re-dates the competencies too.
     *
     * ⚠️ AND THIS IS WHY ORDER STOPPED MATTERING. The browser uploads a pack
     * one file at a time; without this, a member whose competency happened to
     * go up before their rifle licence would have it dated off the licences
     * that existed at that instant — possibly none — and it would stay wrong
     * until they confirmed something. Now the licence corrects it on arrival.
     */
    if (
      (resolved === 'FIREARM_LICENCE' ||
        alsoCovers.includes('FIREARM_LICENCE')) &&
      armed.arm
    ) {
      await recomputeDerivedCompetencies(
        this.prisma,
        user.id,
        (blob) => this.readDetails(blob).covers ?? '',
        this.logger,
      );
    }

    if (resolved === 'COMPETENCY_CERTIFICATE' && reading) {
      const endorsements = parseEndorsements(reading.details.covers ?? '');
      const issuedOn = parseIsoDate(reading.issuedOn);
      const d = deriveCertificateExpiry({ endorsements, issuedOn, licences });
      const ok = mayArmDerivedExpiry(d.basis);
      if (d.on && ok.arm) {
        await this.prisma.credential
          .update({
            where: { id: created.id },
            data: {
              expiresOn: d.on,
              neverExpires: false,
              dateSource: 'derived',
              dateSourceNote: d.why,
            },
          })
          .catch((err) =>
            this.logger.warn(
              `Could not date competency ${created.id}: ${(err as Error).message}`,
            ),
          );
      } else if (d.on) {
        this.logger.log(
          `Credential ${created.id}: competency date derived but not armed — ${ok.reason}`,
        );
      }
    }

    return {
      id: created.id,
      kind: resolved,
      coversKinds: alsoCovers,
      title: clean || derived || DEFAULT_TITLE[resolved],
      // ⚠️ THE TICKS COME BACK, and leaving them out cost a round trip. This
      // method has already written `neverExpires: defaultsToNeverExpires(...)`
      // above, so a safe photograph arrives pre-ticked — and the confirm step
      // could not see it. The page worked around that by re-reading the whole
      // list after every upload, which is a request per document to learn
      // something we had just decided.
      neverExpires: defaultsToNeverExpires(resolved),
      issuedOnUnknown: false,
      // Tells the confirm step which documents WE named, so it can ask.
      autoFiled,
      confident,
      // ⚠️ SO THE REVIEW ROW CAN DECIDE WHETHER TO DRAW A PICTURE. Without
      // it the screen has to fetch and decrypt every document's bytes just to
      // discover the ones it cannot render — spending the most expensive
      // request on this page to learn something the upload already knew.
      // It stays a hint, not a verdict: this is the type the BROWSER declared,
      // copied verbatim and never re-checked against the bytes, so the row
      // still falls back to the glyph if the image will not draw.
      mimeType: file.mimetype,
      proposed: {
        expiresOn: reading?.expiresOn ?? null,
        issuedOn: reading?.issuedOn ?? null,
        details: reading?.details ?? {},
        lowConfidence: reading?.lowConfidence ?? [],
        /**
         * An expiry we worked out rather than read.
         *
         * A competency certificate prints an issue date and no expiry (§5.2),
         * so telling the member we could not read a date that is not there is
         * true and useless. s10(2) as amended ties it to the licence it
         * relates to, per firearm category, and five-from-issue applies only
         * where that category holds no licence at all.
         *
         * Never for a licence (section 27 sets two, five or ten years by
         * section) and never for dedicated status (the association sets it).
         * Guessing either would be inventing a deadline.
         */
        derivedExpiry: derivedExpiryFor(
          resolved,
          reading?.expiresOn ?? null,
          reading?.issuedOn ?? null,
          licences,
          resolved === 'COMPETENCY_CERTIFICATE'
            ? parseEndorsements(reading?.details?.covers ?? '')
            : [],
        ),
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
    // ⚠️ AN OBJECT, NOT SEVEN POSITIONAL ARGUMENTS. It reached six the day the
    // two date ticks arrived, and the very first wiring of them transposed
    // `kind` into `neverExpires` — a mistake tsc happened to catch and would
    // not have if both had been strings.
    args: {
      expiresOn: string;
      issuedOn?: string;
    /**
     * The member ticked "Never expires" / "Not sure".
     *
     * ⚠️ A TICK IS AN ANSWER, AND IT IS OFTEN THE ONLY TRUE ONE. This method
     * used to hard-refuse a confirm without an expiry date, which was right
     * while everything here was a licence or a certificate and wrong the
     * moment the Centre started holding ID copies and photographs of safes.
     * Operator, 2026-08-22: "put a tick box next to the expiry date called
     * Never Expires. Also a tickbox next to Issue date called Not Sure."
     *
     * The tick and the date are contradictory answers to one question, so a
     * tick CLEARS its date rather than sitting beside it — and a database
     * CHECK enforces that, because a row carrying both would leave every
     * reader to pick a winner.
     */
      neverExpires?: boolean;
      issuedOnUnknown?: boolean;
      /**
       * The confirm screen is where a member checks EVERYTHING we made of a
       * document, not only its dates — the kind decides whether a renewal is
       * offered at all, and the title is what they will recognise it by in a
       * reminder. Both optional: an untouched field is left alone.
       */
      kind?: CredentialKind;
      title?: string;
    },
  ) {
    const { expiresOn, issuedOn, neverExpires, issuedOnUnknown, kind, title } =
      args;
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    // ⚠️ OMITTED MEANS "WHATEVER IT ALREADY SAYS", NOT "FALSE". A caller
    // confirming an already-never-expires row — to fix its title, say — and
    // not re-sending the flag would otherwise be told "that is not a date we
    // can read" about a document that has no date and never had one. Today's
    // only caller sends both booleans; this route is directly callable and the
    // next one will not.
    const stored = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: { neverExpires: true },
    });
    if (!stored) throw new NotFoundException('Document not found');
    const noExpiry = neverExpires ?? stored.neverExpires;

    // ⚠️ THE TICK WINS OVER ANYTHING IN THE DATE BOX. A member who types a
    // date, thinks better of it and ticks the box has answered twice; the tick
    // is the later and more deliberate answer, and honouring the leftover text
    // would file a document as expiring on a date they just told us is wrong.
    const expiry = noExpiry ? null : parseIsoDate(expiresOn);
    if (!noExpiry && !expiry) {
      throw new BadRequestException(
        'That is not a date we can read. Enter it as yyyy-mm-dd, exactly as it is printed on the document — or tick "Never expires" if there is no date on it.',
      );
    }

    // Re-confirming a NEW date has to clear the stages, or a renewed licence
    // never gets reminded about again — every column is already stamped from
    // the document it replaced.
    const before = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        expiresOn: true,
        coversKinds: true,
        kind: true,
        title: true,
      },
    });
    if (!before) throw new NotFoundException('Document not found');

    /**
     * The type the member settled on, if they changed it.
     *
     * ⚠️ RE-FILING HAS TO RE-CLEAN `coversKinds`, AND UNTIL NOW IT DID NOT.
     * That list holds the OTHER roles one document fills, and it is forbidden
     * from naming the row's own kind — a row covering itself double-matches a
     * single checklist row on a motivation. It was cleaned once, on create,
     * against the kind we guessed at. Move the row into a kind its own
     * coversKinds already names and the forbidden state is exactly what you
     * get. That was survivable while re-filing meant opening a panel and
     * working a menu; the review screen makes it one tap, which is precisely
     * the sort of change that turns a latent bug into a daily one.
     */
    const nextKind = kind ? currentKind(kind) : null;

    // ⚠️ NULL COUNTS AS A CHANGE when the row previously had a date. Somebody
    // correcting a misread expiry to "never expires" must not leave five
    // stamped reminder stages behind, or the row can never be reminded about
    // again if they change it back.
    const dateChanged =
      (before.expiresOn === null) !== (expiry === null) ||
      (before.expiresOn !== null &&
        expiry !== null &&
        before.expiresOn.getTime() !== expiry.getTime());

    await this.prisma.credential.update({
      where: { id: before.id },
      data: {
        expiresOn: expiry,
        // ⚠️ OMITTED MEANS "LEAVE IT", NOT "CLEAR IT". This wrote
        // parseIsoDate(issuedOn ?? null) unconditionally, so any caller that
        // sent an expiry without an issue date silently wiped a stored one —
        // and the frontend had already worked around it by refusing to offer a
        // Clear button (licence-centre page, the issuedOn field), which is a
        // workaround holding a bug in place rather than a fix.
        //
        // It matters more now that the vault holds documents whose ISSUE date
        // is the load-bearing one: an address confirmation is judged on how
        // recent it is, and nothing else about it expires.
        // ⚠️ "NOT SURE" CLEARS IT; OMITTED LEAVES IT. Two different things, and
        // the second used to be the first: this wrote parseIsoDate(issuedOn ??
        // null) unconditionally, so any caller sending an expiry without an
        // issue date silently wiped a stored one — and the frontend worked
        // around it by refusing to offer a Clear button, which is a workaround
        // holding a bug in place rather than a fix.
        ...(issuedOnUnknown
          ? { issuedOn: null }
          : issuedOn === undefined
            ? {}
            : { issuedOn: parseIsoDate(issuedOn ?? null) }),
        neverExpires: noExpiry,
        ...(issuedOnUnknown === undefined ? {} : { issuedOnUnknown }),
        confirmedAt: new Date(),
        // ⚠️ NORMALISED, for the same reason as create(). This is the refile
        // control on the confirm panel, so a stale bundle can put a retired
        // value here too — and unlike an upload, this one lands on a row the
        // member has already been told is filed correctly.
        ...(nextKind
          ? {
              kind: nextKind,
              // See nextKind above: the row must never cover its own kind.
              coversKinds: cleanAlsoCovers(nextKind, before.coversKinds),
              // The member has settled the type, so it is no longer OUR guess
              // and there is nothing left on this row to ask them about.
              autoFiled: false,
              namedConfident: false,
              /**
               * ⚠️ A RE-FILED DOCUMENT MUST NOT KEEP THE OLD KIND'S NAME, AND
               * NOTHING ELSE WILL EVER FIX IT. list() repairs placeholder
               * titles, but its guard is `title !== DEFAULT_TITLE[kind]` — so
               * the moment the kind moves, the old kind's placeholder stops
               * matching the new kind's and is read as a name the member typed.
               * It is then permanent, and it is what the renewal reminder puts
               * in its subject line: a real section 24 warning arriving under
               * "Photographs of my safe".
               *
               * Only ever replaces OUR placeholder. A name the member chose is
               * theirs and survives a re-filing, and an explicit title in this
               * request overrides this anyway — the spread below comes after.
               */
              ...(nextKind !== before.kind &&
              before.title === DEFAULT_TITLE[before.kind]
                ? { title: DEFAULT_TITLE[nextKind] }
                : {}),
            }
          : {}),
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

    /**
     * A licence just changed, so every competency dated off it is now stale.
     *
     * ⚠️ AWAITED, NOT FIRED AND FORGOTTEN. The member is looking at the list
     * that this response refreshes; re-dating afterwards would show them the
     * old number and correct it on some later load, which reads as the site
     * changing its mind. It is cheap — two queries and an update only where
     * something actually moved — and it cannot throw.
     */
    if (before.kind === 'FIREARM_LICENCE' || nextKind === 'FIREARM_LICENCE') {
      await recomputeDerivedCompetencies(
        this.prisma,
        user.id,
        (blob) => this.readDetails(blob).covers ?? '',
        this.logger,
      );
    }

    return { confirmed: true, expiresOn: expiry ? toIsoDate(expiry) : null };
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
        // ⚠️ addFromLibrary, NOT addUpload — AND THE DIFFERENCE IS VISIBLE TO
        // THE MEMBER. This used to call addUpload with `skipExtraction: true`,
        // reasoning that a second vision call would spend money to learn what
        // the vault had already read. That reasoning is right and this still
        // spends nothing; what it got wrong is that addUpload has no way to
        // CARRY a reading across, so the copy landed with extractionOk false.
        // The checklist flags `canExtract(kind) && !extractionOk` as suspect,
        // CURRENT_LICENCE is extractable, and so every renewal opened with its
        // own licence sitting amber under "we could not read anything off it"
        // — a document the member had confirmed by hand in the Centre.
        //
        // ⚠️ AND addFromLibrary ALONE WAS NOT ENOUGH EITHER — an audit caught
        // this comment claiming a fix it did not deliver. It copies the vault
        // reading through an EXACT key-name match, and a firearm licence is
        // read into the vault as {licence_number, make, calibre, frame_serial}
        // while the motivation registry wants {existing_firearm_1_licence_no,
        // _make, _calibre, _frame_serial}. Empty intersection, so the copy
        // still arrived flagged unreadable. What actually fixes it is one line
        // inside addFromLibrary: readability now comes from the vault's own
        // extractionOk rather than from whether any key happened to collide.
        //
        // It copies the bytes into the motivations bucket exactly as this did,
        // so the two rows keep the separate retention lives the note below
        // insists on. FIREARM_LICENCE maps to exactly one upload kind,
        // CURRENT_LICENCE, so the row lands where it always did.
        await this.motivations.addFromLibrary(
          clerkId,
          motivation.id,
          'credential',
          row.id,
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

    /**
     * Every kind the enum can hold, so the breakdown carries a kind at ZERO
     * rather than leaving it out.
     *
     * ⚠️ groupBy ONLY RETURNS KINDS THAT HAVE ROWS, which is exactly wrong for
     * the question this metric is here to answer. The eight kinds the Centre
     * gained when it absorbed the application paperwork — ID copy, proof of
     * address, employment confirmation, the three safe photographs, the
     * installation shot, the activity log — would each be silently absent
     * until the first member filed one, and "no line at all" is
     * indistinguishable from "the enum change never reached this box".
     *
     * The retired kinds (DEDICATED_STATUS and friends) are printed too, and at
     * zero that is what correct looks like: a NON-zero count on one of them
     * means rows escaped the migration to DEDICATED_DISCIPLINE and are sitting
     * outside every query that now looks for it.
     */
    const allKinds = Object.values(CredentialKind);

    /**
     * ⚠️ NOT EVERY DOCUMENT HAS A DATE TO CONFIRM ANY MORE, and counting the
     * ones that do not would bury the signal. A photograph of a gun safe
     * filed here by hand is created with `neverExpires` already ticked and no
     * vision call is spent on it, so its confirmedAt is null for ever and
     * correctly so. Left in, this metric would climb with every safe
     * photograph in the system and an operator watching it would be watching
     * noise.
     *
     * `neverExpires` is the member's own answer, so it is the first test.
     *
     * ⚠️ THE KIND CLAUSE IS NOT BELT-AND-BRACES — IT IS CARRYING THE
     * PHOTOGRAPHS ADOPTED OUT OF AN APPLICATION. There are three write sites
     * for a Credential and only ONE of them pre-ticks the box: create() here,
     * at defaultsToNeverExpires. VaultAdoptionService.adoptUpload copies the
     * safe photographs across from a motivation without it, and kyc-id-adoption
     * writes an IDENTITY_DOCUMENT without it
     * — deliberately, because a passport is one and does expire. So an
     * adopted safe photograph really does sit at neverExpires:false today,
     * and dropping this clause would put every one of them back in the count.
     * (It has a member-facing twin: those same rows read "Date not confirmed"
     * in the member's own Centre. That belongs to vault-adoption, not here.)
     */
    const dateless = allKinds.filter(isPhotograph);

    const [byKind, total, unconfirmed, expiring30, expired, muted] =
      await Promise.all([
        this.prisma.credential.groupBy({
          by: ['kind'],
          _count: { _all: true },
        }),
        this.prisma.credential.count(),
        this.prisma.credential.count({
          where: {
            confirmedAt: null,
            neverExpires: false,
            kind: { notIn: dateless },
          },
        }),
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

    const counted = new Map(byKind.map((r) => [r.kind, r._count._all]));
    return {
      total,
      byKind: allKinds.map((kind) => ({
        kind,
        count: counted.get(kind) ?? 0,
      })),
      // The number worth watching: a document whose expiry question nobody
      // has answered is a document no reminder can ever fire for.
      //
      // ⚠️ NOT "documents with nothing to run out are excluded" — only the
      // four photograph kinds are. An employment letter has nothing to run
      // out either, but until the member ticks "Never expires" we do not know
      // that, and it is exactly the row an operator should see waiting.
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
export function derivedExpiryFor(
  kind: CredentialKind,
  readExpiry: string | null,
  readIssued: string | null,
  /**
   * The member's licences, so the date can be derived rather than declined.
   *
   * ⚠️ THIS REPLACED A BOOLEAN, "does this member hold ANY firearm licence",
   * and the boolean could not express the rule. The derivation is per firearm
   * CATEGORY: a rifle licence says nothing about a handgun competency. Asking
   * the question member-wide meant a member with one rifle licence was refused
   * the five-year date that was correct for their handgun-only competency, and
   * given nothing in its place.
   */
  licences: readonly LinkedLicence[] = [],
  /** What the certificate covers, read off its own wording. */
  endorsements: readonly Endorsement[] = [],
): { on: string; why: string } | null {
  if (readExpiry || !readIssued) return null;
  if (kind !== 'COMPETENCY_CERTIFICATE') return null;
  const issued = parseIsoDate(readIssued);
  if (!issued) return null;

  // ⚠️ THIS USED TO SAY "a competency certificate lapses five years after it
  // is issued (section 10(2))", AND THAT IS THE OPPOSITE OF WHAT s10(2) NOW
  // SAYS. As amended by Act 28 of 2006 (commenced 10 January 2011) it reads:
  // a competency remains valid for the same period as the LICENCE it relates
  // to. SA Firearm Competency Reference §5.1-§5.3: competency has no
  // independent lifespan, the expiry is the latest licence expiry in that
  // firearm type, and it ROLLS FORWARD every time a licence there is granted
  // or renewed. Five years from issue is only the fallback for a type that
  // holds no licence at all (§5.2).
  //
  // It also told the member to "check it against your certificate", and §9
  // names that exact instruction: the certificate does not print an expiry, so
  // it sends somebody looking for something that is not there.
  //
  // ⚠️ THAT SENTENCE WAS BRIEFLY RESTORED ON A CORRECTION THAT WAS ITSELF
  // WRONG. v3 reasoned from SAPS 271 §F.1.7 asking for a competency expiry
  // that the field must exist; v4 examined three genuine SAPS 524s and found
  // no expiry field at all, and §5.2 reverses it. v2 was right. Current
  // certificates carry a date of issue and the s10(2) rule printed verbatim,
  // and nothing else about validity.
  //
  // ⚠️ IT CAN NOW COMPUTE THE REAL DATE, AND THIS IS WHERE IT DID NOT. The
  // comment that stood here said the derivation is per firearm type and a
  // vault licence row "does not record which type its firearm is", so the only
  // honest thing was to offer the five-year fallback where it was genuinely
  // the rule and prefill NOTHING otherwise. That reasoning was right and the
  // conclusion was a dead end: a member with any licence at all got no date,
  // no reminder, and nothing on any screen asking again.
  //
  // Credential.firearmCategory now holds the category in the clear, so the
  // licences can be grouped and the real rule applied. Operator, 2026-08-25:
  // "I confirmed with the DFO. The competency that is related to a firearm
  // category expires when the last firearm license expires. And in the same
  // breath it renews with the latest firearm license obtained", and "the
  // competency expires within 5 years if no license is linked to it."
  //
  // ⚠️ THE FALLBACK IS PER CATEGORY, NOT PER MEMBER, and that is the bug the
  // boolean hid. Somebody holding a rifle licence and a handgun-only
  // competency was refused the five years that IS correct for their handgun,
  // because the check asked "any licence at all?". Their handgun competency
  // showed no date, fired no reminder, and really did lapse.
  const derived = deriveCertificateExpiry({
    endorsements,
    issuedOn: issued,
    licences,
  });
  if (derived.on) {
    return { on: toIsoDate(derived.on), why: derived.why };
  }
  if (endorsements.length) {
    // We read the certificate but cannot date it — say nothing rather than
    // fall through to a fallback that does not apply.
    return null;
  }

  return {
    on: toIsoDate(competencyLapses(issued)),
    // ⚠️ NO STATUTE IS CITED, AND THAT IS THE CORRECTION. This sentence cited
    // "section 10(2) of the Firearms Control Act, as amended" as the authority
    // for five years — in the one case where s10(2) says nothing at all. As
    // amended it ties validity to "the licence to which the competency
    // certificate relates", and here there is no such licence; the provision
    // is silent, not supportive. The five years is the operator's operating
    // rule, confirmed with their DFO on 2026-08-25, and is stated as ours.
    why: 'You have no firearm licence on file, so there is nothing for this competency to follow: it runs five years from the date it was issued. Your certificate does not print a date — there is no expiry on it to check this against. Licence a firearm and the competency follows that licence instead, moving out with every renewal. Worth confirming with your DFO; the police record is what counts.',
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
 * Creedmoor", not "licence 3088".
 *
 * ⚠️ AND A COMPETENCY CERTIFICATE HAS PLENTY TO DISTINGUISH IT BY — this
 * used to say it did not. A member holds ONE CERTIFICATE PER ENDORSEMENT
 * GROUP, each its own SAPS 524 with its own number and its own issue date:
 * the operator's three read "HANDGUN", "MANUALLY OPERATED RIFLE" and
 * "S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN". Filed here they were three
 * identical rows called "Competency certificate" — exactly the unlabelled
 * filing cabinet this function exists to cure, and the one case it skipped.
 *
 * Returns null when there is nothing better to say, so the caller can leave
 * the existing title alone rather than overwrite it with a worse one.
 */
export function derivedCredentialTitle(
  kind: CredentialKind,
  details: Record<string, string>,
): string | null {
  const clean = (v: string | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');
  // ⚠️ A MEMBER MAY HOLD SEVERAL OF THESE, one per association, and
  // "Dedicated discipline" four times over is the same unlabelled filing
  // cabinet the firearm licences were. The association is what distinguishes
  // them — "SA Hunters — Dedicated Sport Shooter".
  if (kind === 'DEDICATED_DISCIPLINE') {
    const association = clean(details.association).slice(0, 60);
    const status = clean(details.status_type).slice(0, 40);
    const name = [association, status].filter(Boolean).join(' — ');
    return name.length >= 3 ? name.slice(0, MAX_TITLE) : null;
  }
  /**
   * Operator, 2026-08-25: "check the firearm codes the competency is for and
   * list it as 'Competency - Semi-auto Rifle' if the code was S/L Rifle for
   * example."
   *
   * ⚠️ READ IN CODE, FROM THE VERBATIM TRANSCRIPTION. `covers` holds what
   * SAPS actually printed, and the extractor is told it is a transcriber, not
   * an interpreter — so the interpreting happens here, against the rules in
   * sa-competency. That transcription is never rewritten: the confirm panel
   * asks the member to check it against the card in their hand, and a card
   * reading "S/L RIFLE" must still read "S/L RIFLE" when they do.
   *
   * ⚠️ NULL WHEN WE CANNOT READ IT, which leaves DEFAULT_TITLE standing. A
   * card we half-understand must not become a title asserting less than the
   * certificate covers.
   */
  if (kind === 'COMPETENCY_CERTIFICATE') {
    const shown = parseEndorsements(clean(details.covers))
      .map((e) => endorsementDisplay(e))
      .filter((d): d is string => !!d);
    if (!shown.length) return null;
    // "Competency - Semi-auto Rifle + Shotgun" — one certificate, two
    // endorsements, which is what the operator's 2025 card actually carries.
    const name = shown[0] + shown.slice(1).map((d) => ` + ${d.replace(/^Competency - /, '')}`).join('');
    return name.slice(0, MAX_TITLE);
  }

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
  DEDICATED_DISCIPLINE: 'Dedicated discipline',
  COMPETENCY_CERTIFICATE: 'Competency certificate',
  DEDICATED_HUNTER: 'Dedicated hunter status',
  PROFESSIONAL_HUNTER: 'Professional hunter registration',
  DEDICATED_STATUS: 'Dedicated status',
  PROFICIENCY: 'Proficiency certificate',
  GOOD_STANDING: 'Letter of good standing',
  // The documents the Centre gained when it absorbed the application
  // paperwork. Named as a member would say them out loud, not as the enum.
  IDENTITY_DOCUMENT: 'ID document',
  ADDRESS_CONFIRMATION: 'Proof of address',
  EMPLOYMENT_CONFIRMATION: 'Confirmation of employment',
  // ⚠️ ONE NAME FOR EVERY SAFE PHOTOGRAPH, so a member who adds three of them
  // sees three rows called the same thing until they rename them. That is the
  // honest position: nothing on our side knows which shot is which, and a
  // default title asserting "Safe, open with bolts showing" over a picture of a
  // shut door would be a caption we invented. The add form asks for a name.
  SAFE_PHOTOGRAPHS: 'Photograph of my safe',
  // Retired 2026-08-23; kept so a row filed before the collapse still has a
  // name of its own.
  SAFE_PHOTO_CLOSED: 'Safe, closed',
  SAFE_PHOTO_AJAR: 'Safe, half open',
  SAFE_PHOTO_BOLTS: 'Safe, open with bolts showing',
  SAFE_INSTALLATION: 'How the safe is installed',
  SHOOTING_ACTIVITY_LOG: 'Record of hunts and shoots',
  OTHER: 'Supporting document',
};
