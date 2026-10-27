import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { DealerPortalService } from './dealer-portal.service';

const PHOTO_RE = /^image\/(jpeg|png|webp|heic|heif)$/;
const DOC_RE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

/**
 * Public dealer portal. No account: the link token is the credential, it is
 * single-use in effect (status moves to APPROVED/REJECTED), hashed at rest
 * and expires after 14 days.
 */
@Controller('dealer-portal')
export class DealerPortalController {
  constructor(private readonly portal: DealerPortalService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  get(@Param('token') token: string) {
    return this.portal.getByToken(token);
  }

  @Post(':token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'stamp', maxCount: 1 },
        // The SAPS 350(a) is the stock proof; `saps534` is the pre-350 field
        // name, still accepted so an open tab from the old form can finish.
        { name: 'saps350', maxCount: 1 },
        { name: 'saps534', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } },
    ),
  )
  submit(
    @Param('token') token: string,
    @UploadedFiles()
    files: {
      stamp?: Express.Multer.File[];
      saps350?: Express.Multer.File[];
      saps534?: Express.Multer.File[];
    },
    @Body()
    body: {
      serialNumber?: string;
      dealerName?: string;
      acknowledgement?: string;
    },
  ) {
    const stamp = files?.stamp?.[0];
    const saps350 = files?.saps350?.[0] ?? files?.saps534?.[0];
    if (stamp && !PHOTO_RE.test(stamp.mimetype)) {
      throw new BadRequestException(
        'Upload the dealer stamp as a JPEG, PNG, WebP or HEIC photo.',
      );
    }
    if (saps350 && !DOC_RE.test(saps350.mimetype)) {
      throw new BadRequestException(
        'Upload the SAPS 350(a) as a PDF or a JPEG/PNG/WebP/HEIC photo.',
      );
    }
    return this.portal.submit(token, { stamp, saps350 }, body);
  }
}
