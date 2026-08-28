import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CredentialKind } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { ScanHandoffGuard } from '../auth/scan-handoff.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { LicenceCentreService } from './licence-centre.service';
// ⚠️ SHARED, NOT DECLARED HERE. Both doors into the Centre must accept
// exactly the same files — see upload-limits.ts for why a second copy of these
// was a silent divergence waiting to happen.
import {
  UPLOAD_INTERCEPTOR_MAX,
  UPLOAD_MAX_BYTES,
  UPLOAD_MIME,
} from './upload-limits';

// ────────────────────────────────────────────────────────────────────
// THE PHONE'S DOOR INTO THE LICENCE CENTRE.
//
// ⚠️ A SEPARATE CONTROLLER, not a method on the existing one, and that is not
// tidiness. LicenceCentreController carries @UseGuards(ClerkGuard) at CLASS
// level; a method-level guard runs in ADDITION to it, never instead, so a
// phone with only a scan token would be 401'd by the class guard before the
// token was ever looked at.
//
// Everything else is deliberately identical to the signed-in route — same
// interceptor, same limits, same validators, same service call. The member is
// the same member; only the way they proved it is different.
// ────────────────────────────────────────────────────────────────────




@Controller('licence-centre/scan')
@UseGuards(ScanHandoffGuard)
export class LicenceCentreScanController {
  constructor(private readonly svc: LicenceCentreService) {}

  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_INTERCEPTOR_MAX },
    }),
  )
  create(
    @CurrentUser() clerkId: string,
    @Body('kind') kind: string,
    @Body('title') title: string,
    @UploadedFile(
      new ParseFilePipe({
        // ⚠️ THE VALIDATORS ARE NOT OPTIONAL HERE. The service checks size
        // and nothing else — it has always been able to trust the controller
        // in front of it. A token holder posting text/html straight into
        // encrypted credential storage is exactly what this stops.
        validators: [
          new MaxFileSizeValidator({
            maxSize: UPLOAD_MAX_BYTES,
            errorMessage:
              'That file is larger than 10 MB. A photo taken at a lower resolution will be well under it.',
          }),
          new FileTypeValidator({
            fileType: UPLOAD_MIME,
            errorMessage:
              'We can read a JPG, PNG, WebP or PDF. On an iPhone, choose the photo from your library rather than from Files.',
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const wanted = (kind ?? '').trim();
    if (!wanted) return this.svc.create(clerkId, null, title, file);
    if (!Object.values(CredentialKind).includes(wanted as CredentialKind)) {
      throw new BadRequestException('Unknown document type.');
    }
    return this.svc.create(clerkId, wanted as CredentialKind, title, file);
  }
}
