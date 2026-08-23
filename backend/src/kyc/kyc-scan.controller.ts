import {
  Controller,
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ScanHandoffGuard } from '../auth/scan-handoff.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ActionTokensService } from '../actions/action-tokens.service';
import { KycService } from './kyc.service';
import { ID_DOC_MAX_BYTES, ID_DOC_MIME_RE } from './kyc.controller';

// ────────────────────────────────────────────────────────────────────
// THE PHONE'S DOOR INTO IDENTITY VERIFICATION.
//
// Operator, 2026-08-23: "on the KYC of the ID, use the same capture methods as
// we do with the Document centre. Upload or QR code to take a picture of it."
// The ID is a physical card; a laptop webcam focuses at half a metre and
// cannot resolve the number printed on it, so the desktop offers the phone
// already in their pocket and the phone lands here.
//
// ⚠️ A SEPARATE CONTROLLER, not a method on KycController, and that is not
// tidiness. KycController carries @UseGuards(KycOrTokenGuard) at CLASS level,
// and a method-level guard runs in ADDITION to it, never instead — a phone
// holding only a scan token would be 401'd by the class guard before the token
// was ever looked at. The same reason LicenceCentreScanController exists.
//
// ⚠️ AND IT IS SCOPED TIGHTER THAN THE OTHER TWO SCAN DOORS. A licence-centre
// or motivation token adds a document to a folder the member owns; the worst a
// wrong-destination token could do there is file a photograph in the wrong
// folder of the same member's own vault. This one REPLACES the single ID
// document that the payout gate is decided on, and the replacement is
// destructive — kycIdStorageKey is overwritten and the old CDN URL nulled. So
// the destination is checked, not only the member: a token minted to
// photograph a licence card may not be pointed at somebody's identity record,
// even their own.
//
// Everything the desk route refuses, this refuses too, because it is the same
// service call: KycService.submitIdDocument runs assertClaudeFlow, requires
// the details step, and turns away a member who is already VERIFIED or
// UNDER_REVIEW. Nothing about those states is re-decided here.
// ────────────────────────────────────────────────────────────────────

const UPLOAD_INTERCEPTOR_MAX = ID_DOC_MAX_BYTES + 512 * 1024;

@Controller('kyc/scan')
@UseGuards(ScanHandoffGuard)
export class KycScanController {
  constructor(
    private readonly kyc: KycService,
    private readonly tokens: ActionTokensService,
  ) {}

  @Post()
  // ⚠️ THE DESK'S LIMIT, NOT THE VAULT'S. The other two scan doors allow 60 a
  // minute because a vault session is a pack of documents; this one is a
  // single ID and the phone page trims to one file, so the number that
  // belongs here is the one KycController.idDocument already chose for the
  // same upload. At 60 a token holder could push 600 MB a minute into the
  // encrypted store — and every re-upload orphans the file it replaced,
  // because submitIdDocument overwrites kycIdStorageKey without deleting what
  // was there.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_INTERCEPTOR_MAX },
    }),
  )
  async create(
    @CurrentUser() clerkId: string,
    @Req() req: Request & { viaActionToken?: boolean },
    @Query('t') handoffToken: string | undefined,
    @UploadedFile(
      new ParseFilePipe({
        // ⚠️ THE VALIDATORS ARE NOT OPTIONAL HERE, for the reason spelled out
        // in licence-centre-scan.controller.ts: the service checks the bytes
        // for %PDF- and trusts the controller for everything else. A token
        // holder posting text/html into the encrypted store is what this
        // stops.
        validators: [
          new MaxFileSizeValidator({
            maxSize: ID_DOC_MAX_BYTES,
            errorMessage:
              'That file is larger than 10 MB. A photo taken at a lower resolution will be well under it.',
          }),
          new FileTypeValidator({
            fileType: ID_DOC_MIME_RE,
            errorMessage:
              'We can read a JPG, PNG, WebP or PDF. On an iPhone, choose the photo from your library rather than from Files.',
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    // ⚠️ THE DESTINATION IS CHECKED BEFORE THE WRITE, NEVER AFTER. See the
    // note at the top: this is the one scan door where a token minted for
    // somewhere else must not be accepted. A wrong destination counts toward
    // the token's invalid-attempt lock, exactly as a wrong PURPOSE does in
    // ScanHandoffGuard — probing one valid QR against every upload route is
    // precisely what somebody who photographed it would try.
    //
    // The signed-in caller (Bearer, viaActionToken FALSE) has no token and no
    // destination to check; they are already authenticated as themselves.
    //
    // ⚠️ `!== false`, NOT A PLAIN TRUTHY TEST, and the difference is the
    // failure direction. ScanHandoffGuard sets this flag explicitly both ways,
    // so today the two spellings agree — but a truthy test treats "the flag is
    // missing" as "signed in", which is the one reading that lets an
    // unchecked token through. If this route ever ends up behind a guard that
    // does not set it, it should refuse, not wave the upload past.
    if (req.viaActionToken !== false) {
      const resolved = await this.tokens.resolve(handoffToken ?? '');
      if ((resolved.metadata ?? {}).dest !== 'kyc') {
        await this.tokens.markInvalid(handoffToken ?? '');
        throw new UnauthorizedException(
          'This link is not authorised for identity documents.',
        );
      }
    }

    const result = await this.kyc.submitIdDocument(clerkId, file);

    // ⚠️ THE DESKTOP'S ONLY WAY TO KNOW. Its dialog polls the hand-off status
    // endpoint, which counts rows filed since the link was made — and an ID
    // document files no row, it overwrites two columns on the member. Without
    // this stamp the dialog waits out the full 15 minutes on a photograph that
    // arrived in five seconds. Stamped AFTER the service call, so a refusal
    // (already verified, wrong flow, unreadable file) never reads as arrival.
    //
    // ⚠️ ONLY ON THE TOKEN PATH, which is the only path that was validated
    // above. A signed-in caller who also happened to put a ?t= on the URL took
    // the Bearer branch through the guard, so that string was never resolved
    // and never checked against this destination — stamping it would be
    // writing to a token on nobody's authority.
    if (req.viaActionToken && handoffToken) {
      await this.tokens.patchMetadata(handoffToken, {
        uploadedAt: new Date().toISOString(),
      });
    }

    return result;
  }
}
