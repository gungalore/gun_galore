import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Province } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { LlmPart } from '../common/llm/llm.types';
import {
  DealerStampVerificationService,
  type DealerStampVerification,
} from './dealer-stamp-verification.service';
import {
  normaliseLicence,
  normaliseProvince,
  normaliseRegistrationNumber,
} from './dealer-registry.util';

/**
 * The dealer-portal invitation and submission.
 *
 * ⚠️ THE DEALER, NOT THE SELLER, IS THE ATTESTOR. On a firearm DEALER_TRANSFER
 * sale the seller names the stocking dealer; the dealer receives a one-time
 * link, proves identity with their dealer stamp (name + SAPS number), confirms
 * the firearm details, acknowledges that the firearm is stocked with them and
 * uploads the SAP 534. The AI reviews at 70% confidence; below that an admin
 * decides. The trusted directory row is written only on approval.
 *
 * ⚠️ NO SAPS NUMBER ON THE LISTING. The stamp is the only place the dealer's
 * SAPS number enters the system; it is read by the model and canonicalised
 * through the same helper the auto-registration path uses.
 */

const TOKEN_DAYS = 14;

export interface PortalListing {
  id: string;
  title: string;
  make: string | null;
  model: string | null;
  calibre: string | null;
  serialNumber: string | null;
  firearmType: string | null;
  plannedDealerName: string | null;
  plannedDealerAddress: string | null;
  plannedDealerProvince: string | null;
  plannedDealerArea: string | null;
  plannedDealerLocation: string | null;
  plannedDealerPhone: string | null;
  plannedDealerWebsite: string | null;
  plannedDealerEmail: string | null;
  plannedDealerPlaceId: string | null;
  plannedDealerLat: number | null;
  plannedDealerLng: number | null;
}

interface PortalFindings {
  stamp?: {
    present?: boolean;
    dealer_name?: string | null;
    saps_number?: string | null;
    reg_number?: string | null;
    name_matches?: boolean;
    legible?: boolean;
  };
  stock?: {
    serial_matches?: boolean;
    acknowledgement?: boolean;
    saps350_present?: boolean;
  };
  /**
   * The word-for-word result of the stamp + 350(a) verification. Kept whole so
   * the admin dossier can show every field's score without re-running it.
   */
  stampVerification?: DealerStampVerification;
  overall_confidence?: number;
  recommendation?: 'APPROVE' | 'ADMIN_REVIEW' | 'REJECT';
  reason?: string;
}

@Injectable()
export class DealerPortalService {
  private readonly logger = new Logger(DealerPortalService.name);
  private readonly appUrl =
    process.env.FRONTEND_URL ?? 'http://localhost:3000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly notifications: NotificationsService,
    // The stamp + SAPS 350(a) battery. Optional so a unit test can construct
    // the service without standing up a model; a missing one is treated as
    // "unavailable" — a human, never an approval.
    private readonly stampVerification?: DealerStampVerificationService,
  ) {}

  /**
   * Send (or re-use) the invitation for a dealer-transfer sale. Called after
   * the seller accepts. Fire-and-forget from the accept path; never throws.
   */
  async requestForTransaction(
    transactionId: string,
    dealerEmail?: string | null,
  ): Promise<void> {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
        select: {
          id: true,
          shippingMethod: true,
          dealerVerificationStatus: true,
          dealerVerificationRequestedAt: true,
          listing: {
            select: {
              id: true,
              title: true,
              isFirearm: true,
              serialNumber: true,
              plannedDealerName: true,
              plannedDealerEmail: true,
            },
          },
        },
      });
      if (!tx || !tx.listing.isFirearm) return;
      if (tx.shippingMethod !== 'DEALER_TRANSFER') return;
      if (tx.dealerVerificationStatus === 'APPROVED') return;

      const email = (dealerEmail ?? tx.listing.plannedDealerEmail ?? '').trim();
      if (!email) {
        this.logger.warn(
          `Dealer portal ${transactionId}: no dealer email — invitation not sent.`,
        );
        return;
      }

      const live = await this.prisma.dealerPortalRequest.findFirst({
        where: {
          transactionId,
          status: { in: ['SENT', 'PENDING_ADMIN_REVIEW'] },
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (live) {
        if (live.dealerEmail !== email) {
          await this.prisma.dealerPortalRequest
            .update({ where: { id: live.id }, data: { dealerEmail: email } })
            .catch(() => undefined);
        }
        return;
      }

      const token = crypto.randomBytes(32).toString('base64url');
      await this.prisma.dealerPortalRequest.create({
        data: {
          transactionId,
          dealerEmail: email,
          tokenHash: this.hash(token),
          expiresAt: new Date(Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000),
        },
      });
      await this.prisma.transaction.updateMany({
        where: { id: transactionId, dealerVerificationRequestedAt: null },
        data: { dealerVerificationRequestedAt: new Date() },
      });

      await this.notifications.dealerPortalRequest({
        to: email,
        dealerName: tx.listing.plannedDealerName ?? 'Dealer',
        listingTitle: tx.listing.title,
        serial: tx.listing.serialNumber ?? '',
        link: `${this.appUrl}/dealer-portal/${token}`,
      });
    } catch (err) {
      this.logger.warn(
        `Dealer portal invite failed for ${transactionId}: ${(err as Error).message}`,
      );
    }
  }

  /** The public summary behind the portal link. */
  async getByToken(token: string) {
    const row = await this.loadByToken(token);
    const listing = row.transaction.listing;
    const trusted = await this.findTrustedDealer(listing, row.dealerEmail);
    return {
      status: row.status,
      requiresIdentity: !trusted,
      dealerEmail: row.dealerEmail,
      dealerName: listing.plannedDealerName,
      listing: {
        title: listing.title,
        make: listing.make,
        model: listing.model,
        calibre: listing.calibre,
        serialNumber: listing.serialNumber,
        firearmType: listing.firearmType,
      },
    };
  }

  /**
   * Submit the dealer form.
   *
   * ⚠️ A FIREARM IS NOT STOCKED ON THIS SUBMISSION ALONE. Operator,
   * 2026-10-27: "we can only mark the firearm stocked once the dealer filled in
   * the form we sent them and also attached their dealer stamp, and the 350
   * form filled in with the correct firearm details." So BOTH are required —
   * the stamp (identity: name, CIPC number, address, contact, SAPS licence) and
   * the SAPS 350(a) (stock: this firearm's make, model, calibre and serial) —
   * on every submission, trusted dealer or not. The serial is compared in code
   * before any model is spent.
   */
  async submit(
    token: string,
    files: {
      stamp?: Express.Multer.File;
      saps350?: Express.Multer.File;
      /** Legacy alias for the stock form, from the pre-350 portal page. */
      saps534?: Express.Multer.File;
    },
    body: {
      serialNumber?: string;
      acknowledgement?: string | boolean;
      dealerName?: string;
    },
  ) {
    const row = await this.loadByToken(token);
    if (row.status === 'APPROVED') {
      throw new BadRequestException('This transfer is already verified.');
    }
    if (row.status === 'REJECTED') {
      throw new BadRequestException(
        'This submission was rejected. Contact support if you believe that is wrong.',
      );
    }
    const listing = row.transaction.listing;
    const trusted = await this.findTrustedDealer(listing, row.dealerEmail);
    if (!files.stamp) {
      throw new BadRequestException(
        'Upload a photo of your dealer stamp showing the business name, company registration number, address, contact number and SAPS dealer licence number.',
      );
    }
    const stockForm = files.saps350 ?? files.saps534;
    if (!stockForm) {
      throw new BadRequestException(
        'Upload your completed SAPS 350(a) ("Dealer\u2019s Return: Stock Received") showing this firearm\u2019s make, model, calibre and serial number.',
      );
    }
    if (!this.acknowledged(body.acknowledgement)) {
      throw new BadRequestException(
        'Tick the acknowledgement that the firearm is dealer-stocked with you.',
      );
    }

    const typedSerial = (body.serialNumber ?? '').trim();
    const listingSerial = (listing.serialNumber ?? '').trim();
    const serialMatches =
      !!typedSerial &&
      !!listingSerial &&
      this.normaliseSerial(typedSerial) === this.normaliseSerial(listingSerial);
    if (typedSerial && listingSerial && !serialMatches) {
      await this.prisma.dealerPortalRequest.update({
        where: { id: row.id },
        data: {
          status: 'REJECTED',
          form: {
            serialNumber: typedSerial,
            dealerName: body.dealerName ?? null,
            acknowledgement: true,
          },
          aiFindings: {
            stock: { serial_matches: false },
            reason: 'Serial does not match the listing.',
          },
          aiConfidence: 0,
        },
      });
      throw new BadRequestException(
        'The serial number does not match the listing. Check the firearm and try again.',
      );
    }

    const folder = `dealer-portal/${row.transactionId}`;
    const [stampUpload, stockUpload] = await Promise.all([
      this.cloudinary.uploadImage(files.stamp.buffer, folder),
      this.isPdf(stockForm)
        ? this.cloudinary.uploadRaw(stockForm.buffer, folder)
        : this.cloudinary.uploadImage(stockForm.buffer, folder),
    ]);

    // ── The stamp + SAPS 350(a) battery ────────────────────────────────
    // Gemini reads both pages, Jev scores the fields, Didit proves the CIPC
    // number. A missing battery is `unavailable`, which is a human — never an
    // approval.
    const verification: DealerStampVerification = this.stampVerification
      ? await this.stampVerification.verify({
          stamp: this.partFor(files.stamp),
          stockForm: this.partFor(stockForm),
          expected: {
            name: listing.plannedDealerName ?? body.dealerName ?? '',
            address: listing.plannedDealerAddress ?? listing.plannedDealerLocation,
            phone: listing.plannedDealerPhone,
            licenceNumber: trusted?.licenceNumber ?? null,
            registrationNumber: trusted?.regNumber ?? null,
            make: listing.make,
            model: listing.model,
            calibre: listing.calibre,
            serialNumber: listing.serialNumber,
          },
        })
      : {
          pass: false,
          unavailable: true,
          stamp: [],
          stock: [],
          stampText: null,
          stockText: null,
          extracted: {
            dealerName: null,
            registrationNumber: null,
            address: null,
            contactNumber: null,
            licenceNumber: null,
          },
          registration: { number: null, didit: null, registryName: null },
          issues: [
            'The automatic dealer check is not available on this deployment — a person will review the stamp and the SAPS 350(a).',
          ],
          jevModel: null,
        };

    const stockConfirmed =
      serialMatches && this.acknowledged(body.acknowledgement);
    // ⚠️ THREE OUTCOMES, NOT TWO. A mismatch is a REJECTED submission the
    // dealer must fix; an outage is a PENDING_ADMIN_REVIEW that a human
    // decides. Collapsing them would either punish a dealer for our outage or
    // let an unverified stamp through.
    const status: 'APPROVED' | 'REJECTED' | 'PENDING_ADMIN_REVIEW' =
      verification.pass && stockConfirmed
        ? 'APPROVED'
        : verification.unavailable
          ? 'PENDING_ADMIN_REVIEW'
          : 'REJECTED';

    const confidence = verification.pass && stockConfirmed ? 100 : 0;

    const findings: PortalFindings = {
      stamp: {
        present: true,
        dealer_name: verification.extracted.dealerName,
        saps_number: verification.extracted.licenceNumber,
        reg_number: verification.registration.number,
        name_matches: verification.stamp.find((f) => f.field === 'dealer_name')?.pass,
        legible: verification.stampText !== null,
      },
      stock: {
        serial_matches: serialMatches,
        acknowledgement: true,
        saps350_present: true,
      },
      stampVerification: verification,
      overall_confidence: confidence,
      recommendation:
        status === 'APPROVED'
          ? 'APPROVE'
          : status === 'REJECTED'
            ? 'REJECT'
            : 'ADMIN_REVIEW',
      reason: verification.issues[0] ?? '',
    };

    const dealerId =
      status === 'APPROVED'
        ? (await this.upsertTrustedDealer(
            listing,
            row.dealerEmail,
            verification.extracted.licenceNumber,
            verification.extracted.dealerName ?? body.dealerName ?? null,
            verification.extracted.registrationNumber,
          ).catch(() => null)) ??
          trusted?.id ??
          null
        : null;

    await this.prisma.$transaction([
      this.prisma.dealerPortalRequest.update({
        where: { id: row.id },
        data: {
          status,
          stampPhotoUrl: stampUpload.url,
          saps350PhotoUrl: stockUpload.url,
          form: {
            serialNumber: typedSerial,
            dealerName: body.dealerName ?? null,
            acknowledgement: true,
          },
          aiFindings: findings as never,
          aiConfidence: confidence,
          dealerId,
        },
      }),
      this.prisma.transaction.update({
        where: { id: row.transactionId },
        data: {
          dealerVerificationStatus: status,
          dealerVerificationScore: confidence,
          dealerVerificationFindings: findings as never,
          ...(status === 'APPROVED'
            ? { dealerVerifiedAt: new Date() }
            : {}),
          ...(stockUpload.url
            ? { stockRegisterPhotoUrl: stockUpload.url }
            : {}),
        },
      }),
    ]);

    if (status === 'PENDING_ADMIN_REVIEW') {
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'DEALER_PORTAL_REVIEW',
            referenceId: row.transactionId,
            urgent: true,
            context:
              `Dealer portal submission for ${row.transactionId.slice(-8).toUpperCase()} ` +
              `needs a human — ${
                verification.unavailable
                  ? 'the automatic dealer check could not run'
                  : `stamp/350(a) check failed: ${verification.issues.slice(0, 3).join(' ')}`
              }. ` +
              `Review the stamp and SAPS 350(a) in the dealer portal request.`,
          },
        })
        .catch(() => undefined);
    }

    if (status === 'REJECTED') {
      // The dealer is the one who must correct the paperwork, but the SELLER
      // owns the sale — they are the one told, with the exact fields that
      // failed, so they can go back to the dealer with a list.
      void this.notifySellerOfRejection(row, verification);
    }

    return { status, confidence };
  }

  // ── internals ──────────────────────────────────────────────────────

  private async loadByToken(token: string) {
    const row = await this.prisma.dealerPortalRequest.findUnique({
      where: { tokenHash: this.hash(token) },
      include: {
        transaction: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                isFirearm: true,
                make: true,
                model: true,
                calibre: true,
                serialNumber: true,
                firearmType: true,
                plannedDealerName: true,
                plannedDealerAddress: true,
                plannedDealerProvince: true,
                plannedDealerArea: true,
                plannedDealerLocation: true,
                plannedDealerPhone: true,
                plannedDealerWebsite: true,
                plannedDealerEmail: true,
                plannedDealerPlaceId: true,
                plannedDealerLat: true,
                plannedDealerLng: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Dealer link not found.');
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This dealer link has expired. Ask the seller for a new one.');
    }
    return row;
  }

  private async findTrustedDealer(
    listing: PortalListing,
    email: string,
  ): Promise<{ id: string; licenceNumber: string; regNumber: string | null } | null> {
    const or: Record<string, string>[] = [];
    if (listing.plannedDealerPlaceId) or.push({ placeId: listing.plannedDealerPlaceId });
    if (email) or.push({ email });
    if (!or.length) return null;
    return this.prisma.dealer.findFirst({
      where: { isVerified: true, isActive: true, OR: or },
      select: { id: true, licenceNumber: true, regNumber: true },
    });
  }

  private async upsertTrustedDealer(
    listing: PortalListing,
    email: string,
    sapsNumber: string | null,
    dealerName: string | null,
    registrationNumber?: string | null,
  ): Promise<string | null> {
    const licence = normaliseLicence(sapsNumber);
    if (!licence) return null; // no SAPS number = no trusted row; admin review holds it
    const province: Province | null =
      normaliseProvince(listing.plannedDealerProvince) ?? null;
    const regNumber = normaliseRegistrationNumber(registrationNumber) ?? undefined;
    const data = {
      name: (dealerName ?? listing.plannedDealerName ?? 'Unnamed dealer').slice(0, 120),
      address:
        (listing.plannedDealerAddress ?? listing.plannedDealerLocation ?? '').slice(0, 300) ||
        '—',
      province,
      city: listing.plannedDealerArea,
      phone: listing.plannedDealerPhone,
      email,
      website: listing.plannedDealerWebsite,
      placeId: listing.plannedDealerPlaceId,
      lat: listing.plannedDealerLat,
      lng: listing.plannedDealerLng,
      ...(regNumber ? { regNumber } : {}),
      isActive: true,
      isVerified: true,
      source: 'DEALER_CONFIRMED',
      lastSeenAt: new Date(),
    };
    const or: Record<string, string>[] = [{ licenceNumber: licence }];
    if (listing.plannedDealerPlaceId) {
      or.push({ placeId: listing.plannedDealerPlaceId });
    }
    const existing = await this.prisma.dealer.findFirst({
      where: { OR: or },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.dealer.update({
        where: { id: existing.id },
        data: { ...data, firstSeenAt: undefined },
      });
      return existing.id;
    }
    const created = await this.prisma.dealer.create({
      data: { ...data, licenceNumber: licence, firstSeenAt: new Date() },
    });
    return created.id;
  }

  /** Is this upload a PDF, by declared type or by its own magic bytes? */
  private isPdf(file: Express.Multer.File): boolean {
    return (
      file.mimetype === 'application/pdf' ||
      file.buffer.subarray(0, 5).toString('latin1') === '%PDF-'
    );
  }

  /** An uploaded file as the provider-neutral part the LLM contract takes. */
  private partFor(file: Express.Multer.File): LlmPart {
    const data = file.buffer.toString('base64');
    return this.isPdf(file)
      ? { type: 'document', mimeType: 'application/pdf', data }
      : { type: 'image', mimeType: file.mimetype || 'image/jpeg', data };
  }

  /**
   * Tell the SELLER what failed, field by field.
   *
   * ⚠️ A DEALER-OWNED SUBMISSION STILL OWES THE SELLER AN EXPLANATION. The
   * dealer fixes the paperwork, but the seller is the one chasing the payout —
   * "verification failed" without the list is a phone call to us.
   */
  private async notifySellerOfRejection(
    row: { transactionId: string; transaction: { listing: PortalListing } },
    verification: DealerStampVerification,
  ): Promise<void> {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: row.transactionId },
        select: {
          seller: {
            select: { email: true, firstName: true, lastName: true, phone: true },
          },
          listing: { select: { title: true } },
        },
      });
      if (!tx) return;
      const sellerName =
        [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
        'Seller';
      await this.notifications.dealerVerificationRejected({
        sellerEmail: tx.seller.email,
        sellerName,
        sellerPhone: tx.seller.phone,
        listingTitle: tx.listing.title,
        transactionId: row.transactionId,
        reason: verification.issues[0] ?? 'The dealer paperwork did not pass verification.',
        issues: verification.issues,
      });
    } catch (err) {
      this.logger.warn(
        `Dealer-notified seller rejection failed for ${row.transactionId}: ${(err as Error).message}`,
      );
    }
  }

  private acknowledged(value: string | boolean | undefined): boolean {
    return value === true || value === 'true' || value === 'on' || value === '1';
  }

  private normaliseSerial(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
