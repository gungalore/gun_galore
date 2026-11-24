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
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BugsService } from './bugs.service';

// Bug reports are accepted from members AND from signed-out visitors
// (operator, 2026-11-24). Optional auth attaches the member when a session is
// present; the public path is defended by a per-IP throttle, a hidden
// honeypot and a minimum form-fill time. The screenshot is held in memory and
// streamed straight into the operator email, never written to disk.
@Controller('bugs')
@UseGuards(OptionalAuthGuard)
@Throttle({ default: { limit: 5, ttl: 600_000 } })
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
    @CurrentUser() userId: string | undefined,
    @Body()
    body: {
      category?: string;
      description?: string;
      url?: string;
      email?: string;
      honeypot?: string;
      elapsedMs?: string;
    },
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
      email: body?.email,
      honeypot: body?.honeypot,
      elapsedMs:
        body?.elapsedMs === undefined ? undefined : Number(body.elapsedMs),
      screenshot: file ?? null,
    });
  }
}
