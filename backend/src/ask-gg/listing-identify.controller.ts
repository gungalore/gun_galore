import {
  BadRequestException,
  Controller,
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ListingIdentifyService } from './listing-identify.service';

/**
 * POST /ask-gg/identify-listing — the Sell page's "Help me describe
 * this". Multipart upload of 1-N photos; returns a structured proposal
 * that pre-fills the listing form. No persistence, no conversation.
 *
 * ⚠️ THE ONLY ROUTE LEFT UNDER /ask-gg. The chat assistant was retired
 * from the site on 2026-08-26 and its backend on 2026-09-07; every other
 * route here — send, the SSE variant, chat uploads, conversations, quota,
 * KB search, the whole /ask-gg/public controller — is gone. The prefix
 * stays only because frontend/app/listings/new/identify-from-photos.tsx
 * posts to it — it is NOT the frontend's retired /ask-gg page, which is
 * a different origin and 404s.
 *
 * 10/min per IP: each call is a real vision request costing real money.
 */
@Controller('ask-gg')
@UseGuards(AuthGuard)
export class ListingIdentifyController {
  constructor(private readonly identify: ListingIdentifyService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('identify-listing')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async identifyListing(
    @CurrentUser() userId: string,
    @UploadedFiles(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    files: Express.Multer.File[],
    @Query('categoryHint') categoryHint?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one photo required.');
    }
    const photos = files.map((f) => ({
      base64: f.buffer.toString('base64'),
      mediaType: f.mimetype as 'image/jpeg' | 'image/png' | 'image/webp',
    }));
    return this.identify.identifyForListing(userId, photos, {
      categoryHint: categoryHint?.trim() || undefined,
    });
  }
}
