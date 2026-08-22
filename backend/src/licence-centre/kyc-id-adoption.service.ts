import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CredentialKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { LicenceCentreQuotaService } from './licence-centre-quota.service';

// ────────────────────────────────────────────────────────────────────
// THE ID THEY HAVE ALREADY GIVEN US.
//
// Operator, 2026-08-22: "When a user does their KYC on the website, we already
// capture their ID. When they are approved, we can ask them if we can add
// their ID to their Document Centre... it will create awareness of the
// Document and Motivation Centres."
//
// Both halves of that are right. A copy of an ID is the first line on every
// licence application's checklist, and somebody who has just photographed
// theirs to be verified should not be asked to photograph it again three
// months later. And the moment a person has just been verified is the one
// moment they are certainly paying attention.
//
// ⚠️ IT IS A NEW PURPOSE, WHICH IS WHY IT IS ASKED AND NOT DONE.
// The document was collected to verify an identity, and it is retained after
// that under a regulatory-compliance basis — the FICA-style audit trail, and
// the SAP 534 path. Putting the same file into a library the member manages,
// to be reused in future licence applications, is a DIFFERENT thing to do
// with it. So it takes its own explicit yes, at the moment of asking, and the
// POST below is that yes.
//
// ⚠️ AND IT IS NOT THE BLANKET CONSENT. Nothing here reads or writes the
// Document Centre's keep-my-documents record. Somebody may perfectly well
// want this one document kept and not want us keeping everything else, and
// collapsing the two would take the wider permission on the strength of a
// narrow yes.
//
// ⚠️ IT COPIES; THE ORIGINAL IS UNTOUCHED. The KYC file stays where it is,
// under its own basis and its own retention. Deleting the Centre's copy must
// never reach back and remove the evidence that a verification happened.
//
// ⚠️ THE SOURCE IS CLOUDINARY, NOT THE ENCRYPTED STORE. Every other document
// in the Centre arrives as bytes on a request; this one has to be fetched back
// off the CDN it was put on at verification time, and lands in the encrypted
// store on the way in. That is the only reason this is a service rather than
// three lines inside create().
// ────────────────────────────────────────────────────────────────────

/** The KYC original was capped at 10 MB, so the copy cannot be larger. */
const MAX_BYTES = 10 * 1024 * 1024;
/** A CDN gone slow must not hold a request open. */
const FETCH_TIMEOUT_MS = 20_000;

export interface KycIdOffer {
  /** Make the offer. */
  available: boolean;
  /** Already in the Centre — show it as done, not as something to do. */
  alreadyThere: boolean;
}

@Injectable()
export class KycIdAdoptionService {
  private readonly logger = new Logger(KycIdAdoptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
    private readonly settings: SettingsService,
    private readonly quota: LicenceCentreQuotaService,
  ) {}

  private async load(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        kycStatus: true,
        kycIdDocumentUrl: true,
        kycDocumentUrl: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Which stored copy to take, if there is one. */
  private sourceUrl(u: {
    kycIdDocumentUrl: string | null;
    kycDocumentUrl: string | null;
  }): string | null {
    // The Claude-flow document first. kycDocumentUrl is the retired manual
    // flow's column and is only reached for members verified before that.
    return u.kycIdDocumentUrl || u.kycDocumentUrl || null;
  }

  /** Do they already hold an ID document here? */
  private async holdsId(userId: string): Promise<boolean> {
    // ⚠️ ANY ID DOCUMENT COUNTS, not only one we put there. Somebody who has
    // already photographed their ID into the Centre must not end up with a
    // second copy of the same paper under a second annexure letter.
    const n = await this.prisma.credential.count({
      where: {
        userId,
        kind: CredentialKind.IDENTITY_DOCUMENT,
        purgedAt: null,
      },
    });
    return n > 0;
  }

  /**
   * Is there an offer to make?
   *
   * ⚠️ NEVER THROWS ON A SWITCHED-OFF CENTRE. This decides whether to render a
   * card on the KYC success screen, and a 404 there would turn a missing
   * optional offer into a visible error on the page somebody sees at the end
   * of being verified.
   */
  async offer(clerkId: string): Promise<KycIdOffer> {
    const on = await this.quota.isEnabled().catch(() => false);
    if (!on) return { available: false, alreadyThere: false };

    const user = await this.load(clerkId);
    if (user.kycStatus !== 'VERIFIED' || !this.sourceUrl(user)) {
      return { available: false, alreadyThere: false };
    }
    const held = await this.holdsId(user.id);
    return { available: !held, alreadyThere: held };
  }

  /**
   * Yes — put it in the Centre.
   *
   * Bytes first, row second, bytes removed if the row fails: the same shape as
   * every other write into this store, because a file with no row pointing at
   * it is undeletable except by hand.
   */
  async adopt(
    clerkId: string,
  ): Promise<{ added: boolean; credentialId?: string }> {
    await this.quota.assertEnabled();
    const user = await this.load(clerkId);

    if (user.kycStatus !== 'VERIFIED') {
      throw new BadRequestException(
        'This becomes available once your identity has been verified.',
      );
    }
    const url = this.sourceUrl(user);
    if (!url) {
      throw new BadRequestException(
        'We do not have a copy of your ID document to add.',
      );
    }
    // Not a 409: the member pressed a button on an offer, and "it is already
    // there" is a success from where they are standing.
    if (await this.holdsId(user.id)) return { added: false };

    const cap = await this.settings.get(FLAGS.licenceCentreMaxCredentials);
    const held = await this.prisma.credential.count({
      where: { userId: user.id },
    });
    if (held >= cap) {
      throw new ConflictException(
        `You can keep ${cap} documents here. Remove one before adding another.`,
      );
    }

    const bytes = await this.fetchOriginal(url, user.id);
    const mimeType = this.mimeFor(url, bytes);

    let stored: { storageKey: string; sha256: string; byteSize: number };
    try {
      stored = await this.files.write('credentials', bytes, new Date());
    } catch (err) {
      this.logger.error(
        `KYC ID copy for ${user.id} could not be stored: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not add your ID just now. Please try again.',
      );
    }

    try {
      const created = await this.prisma.credential.create({
        data: {
          userId: user.id,
          kind: CredentialKind.IDENTITY_DOCUMENT,
          title: 'ID document',
          storageKey: stored.storageKey,
          mimeType,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          // ⚠️ SO WE CAN ALWAYS SAY WHERE IT CAME FROM. A member who finds a
          // document in their Centre they do not remember putting there is
          // owed an answer, and "you added this when your identity was
          // verified" is that answer.
          addedVia: 'kyc',
          // No dates, and none inferred. An ID does not expire in any sense
          // this module chases, and the CHECK constraint forbids an expiresOn
          // on this kind outright.
        },
        select: { id: true },
      });
      this.logger.log(`KYC ID document copied into the Centre for ${user.id}`);
      return { added: true, credentialId: created.id };
    } catch (err) {
      // The bytes must not outlive the attempt.
      await this.files.remove(stored.storageKey).catch(() => undefined);
      // The same file already in the Centre under a different kind — filed by
      // hand as OTHER, most likely. Nothing to add, and nothing wrong.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { added: false };
      }
      throw err;
    }
  }

  /** Pull the stored original back off the CDN. */
  private async fetchOriginal(url: string, userId: string): Promise<Buffer> {
    let res: Response;
    try {
      res = await globalThis.fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `KYC ID fetch failed for ${userId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not fetch your ID document just now. Please try again.',
      );
    }
    if (!res.ok) {
      this.logger.error(`KYC ID fetch for ${userId} returned ${res.status}`);
      throw new ServiceUnavailableException(
        'We could not fetch your ID document just now. Please try again.',
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      throw new ServiceUnavailableException(
        'The copy of your ID document came back empty. Please try again.',
      );
    }
    // It was capped at 10 MB on the way in, so anything larger coming back is
    // not the document we stored.
    if (buf.length > MAX_BYTES) {
      this.logger.error(
        `KYC ID fetch for ${userId} returned ${buf.length} bytes — over the cap`,
      );
      throw new ServiceUnavailableException(
        'That copy of your ID document is too large to add.',
      );
    }
    return buf;
  }

  /**
   * What kind of file came back.
   *
   * ⚠️ MAGIC BYTES BEAT THE URL. Cloudinary serves PDFs from a /raw/upload/
   * path and images from /image/upload/, which is a good hint and not a
   * guarantee — and the Centre's download route serves whatever this column
   * says, so a wrong content type is a document that will not open.
   */
  private mimeFor(url: string, b: Buffer): string {
    if (b.subarray(0, 5).toString('latin1') === '%PDF-') {
      return 'application/pdf';
    }
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47
    ) {
      return 'image/png';
    }
    if (
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
      return 'image/webp';
    }
    // Nothing recognised. Fall back to what the path claims rather than
    // refusing a document that is probably fine.
    return url.includes('/raw/upload/') ? 'application/pdf' : 'image/jpeg';
  }
}
