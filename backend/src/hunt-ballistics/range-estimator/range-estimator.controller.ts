import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  Headers,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { RangeEstimatorService } from './range-estimator.service';
import { parseEstimateRangeBody } from './dto/estimate-range.dto';

/**
 * POST /hunt-ballistics/estimate-range
 *
 * Multipart form upload: photo + sensor metadata. The Hunt Ballistics
 * iOS app (components/calc/RangeEstimator.tsx) captures a still + the
 * inclinometer + compass + GPS at shutter time, then posts here for
 * AI distance estimation.
 *
 * Auth: device-UUID via X-Device-Id header (Hunt Ballistics is an
 * anonymous-device-id product per CLAUDE.md; no Clerk).
 *
 * Throttle: 10/min/IP because each call hits the Anthropic API and
 * costs real money (~$0.01 Sonnet, ~$0.05 if Opus fallback fires).
 *
 * Payload limits: 10 MB photo, JPEG / PNG / WebP only.
 */
@Controller('hunt-ballistics/estimate-range')
export class RangeEstimatorController {
  constructor(private readonly service: RangeEstimatorService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async estimate(
    @Headers('x-device-id') deviceId: string | undefined,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    photo: Express.Multer.File,
    @Body() rawBody: Record<string, unknown>,
  ) {
    if (!deviceId || deviceId.length < 8) {
      throw new BadRequestException(
        'X-Device-Id header is required (per-device UUID for Hunt Ballistics).',
      );
    }

    const body = parseEstimateRangeBody(rawBody);

    return this.service.estimate({
      deviceId,
      photo,
      ...body,
    });
  }
}
