import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BugsService } from './bugs.service';

// Member-initiated bug reports. Signed-in only (ties a report to an account
// and cuts spam — same stance as ReportsController) and tightly throttled;
// reporting is rare per member. The screenshot is held in memory and streamed
// straight into the operator email, never written to disk.
@Controller('bugs')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
export class BugsController {
  constructor(private readonly bugs: BugsService) {}

  @Post('report')
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  report(
    @CurrentUser() userId: string,
    @Body() body: { category?: string; description?: string; url?: string },
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    if (file && !/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      throw new BadRequestException(
        'Screenshot must be a JPEG, PNG or WebP image.',
      );
    }
    return this.bugs.report({
      userId,
      category: body?.category,
      description: body?.description,
      url: body?.url,
      screenshot: file ?? null,
    });
  }
}
