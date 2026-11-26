import {
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { ValuationService } from './valuation.service';

const MAX_PHOTO_BYTES =
  Number(process.env.VALUATION_PHOTO_MAX_MB ?? 10) * 1024 * 1024;

/**
 * Public, token-scoped QR phone capture. No login: the token in the URL is the
 * capability, bound to the desktop session that created it. Any token that is
 * unknown, expired, closed, or past its invalid-attempt limit returns 404 and
 * never confirms existence.
 *
 * ⚠️ These routes are UNAUTHENTICATED and each one is not free: reads touch the
 * DB, photo uploads cost memory + Cloudinary storage, and a token guess costs
 * an invalidAttempts write. The global bucket is shared with the rest of the
 * public API, so each route carries its own throttle mirroring dealer-portal
 * (30/min read, 10/min upload, 20/min delete).
 */
@Controller('v/capture')
export class CaptureController {
  constructor(private readonly valuations: ValuationService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getState(@Param('token') token: string) {
    return this.valuations.getCaptureState(token);
  }

  @Post(':token/photos')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage() }))
  addPhoto(
    @Param('token') token: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_PHOTO_BYTES }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp|heic|heif)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.valuations.addCapturePhoto(token, file);
  }

  @Delete(':token/photos/:photoId')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async removePhoto(
    @Param('token') token: string,
    @Param('photoId') photoId: string,
  ) {
    await this.valuations.removeCapturePhoto(token, photoId);
  }
}
