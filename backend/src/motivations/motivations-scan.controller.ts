import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { ScanHandoffGuard } from '../auth/scan-handoff.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MotivationsService } from './motivations.service';
import { MotivationUploadKind } from '@prisma/client';
import { RETIRED } from './motivation-documents';

// ────────────────────────────────────────────────────────────────────
// THE PHONE'S DOOR INTO A MOTIVATION.
//
// ⚠️ SEPARATE FOR THE SAME REASON as the licence-centre one: the parent
// controller's class-level ClerkGuard would reject a token-only caller before
// the token was read. See the note there.
//
// Ownership is NOT re-checked here and does not need to be — addUpload
// resolves the motivation with `findFirst({ where: { id, userId: user.id } })`
// and a status check, so a token for member A naming member B's motivation
// finds nothing and 404s on its own.
// ────────────────────────────────────────────────────────────────────

const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_INTERCEPTOR_MAX = UPLOAD_MAX_BYTES + 512 * 1024;
const UPLOAD_MIME = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

@Controller('motivations')
@UseGuards(ScanHandoffGuard)
export class MotivationsScanController {
  constructor(private readonly motivations: MotivationsService) {}

  @Post(':id/scan-uploads')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_INTERCEPTOR_MAX },
    }),
  )
  addUpload(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('kind') kind: string,
    @UploadedFile(
      new ParseFilePipe({
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
    // ⚠️ THE SAME TWO CHECKS THE SIGNED-IN ROUTE MAKES, for the same
    // reasons: an arbitrary string is a Prisma 500, and a RETIRED kind is a
    // valid enum value nothing may write any more (Postgres cannot drop one,
    // so the ban has to live in code or it is an intention rather than a
    // fact). A phone running a stale bundle is exactly the realistic sender.
    const wanted = (kind ?? '').trim();
    if (!wanted) return this.motivations.addUpload(clerkId, id, null, file);
    if (
      !Object.values(MotivationUploadKind).includes(
        wanted as MotivationUploadKind,
      )
    ) {
      throw new BadRequestException('Unknown document type.');
    }
    if (RETIRED.includes(wanted as MotivationUploadKind)) {
      throw new BadRequestException(
        'That document type has been replaced. Please reopen the link and choose from the updated list.',
      );
    }
    return this.motivations.addUpload(
      clerkId,
      id,
      wanted as MotivationUploadKind,
      file,
    );
  }
}
