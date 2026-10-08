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
import { memoryStorage } from 'multer';
import { ValuationService } from './valuation.service';

const MAX_PHOTO_BYTES =
  Number(process.env.VALUATION_PHOTO_MAX_MB ?? 10) * 1024 * 1024;

/**
 * Public, token-scoped QR phone capture. No login: the token in the URL is the
 * capability, bound to the desktop session that created it. Any token that is
 * unknown, expired, closed, or past its invalid-attempt limit returns 404 and
 * never confirms existence.
 */
@Controller('v/capture')
export class CaptureController {
  constructor(private readonly valuations: ValuationService) {}

  @Get(':token')
  getState(@Param('token') token: string) {
    return this.valuations.getCaptureState(token);
  }

  @Post(':token/photos')
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
  async removePhoto(
    @Param('token') token: string,
    @Param('photoId') photoId: string,
  ) {
    await this.valuations.removeCapturePhoto(token, photoId);
  }
}
