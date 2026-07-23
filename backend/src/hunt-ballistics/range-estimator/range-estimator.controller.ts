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
 * Cost-abuse controls (audit fix 2026-07-20): each call is a billed
 * Anthropic vision request (~$0.01 Sonnet, ~$0.05 if the Opus fallback
 * fires) on an ANONYMOUS endpoint, so IP throttling alone is gameable
 * with IP rotation. Two layers:
 *   - 5/min/IP throttle (was 10 — a human doesn't photograph 10
 *     targets a minute).
 *   - A per-device daily budget (in-memory sliding 24h window, 30/day)
 *     keyed on the device UUID. In-memory is fine on the single-pod
 *     deploy; a restart resetting it is harmless.
 *
 * Payload limits: 10 MB photo, JPEG / PNG / WebP only.
 */
const DEVICE_CALLS_PER_DAY = 30;
const deviceCallLog = new Map<string, number[]>();

function consumeDeviceBudget(deviceId: string): boolean {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = (deviceCallLog.get(deviceId) ?? []).filter((t) => t > dayAgo);
  if (recent.length >= DEVICE_CALLS_PER_DAY) {
    deviceCallLog.set(deviceId, recent);
    return false;
  }
  recent.push(now);
  deviceCallLog.set(deviceId, recent);
  // Opportunistic sweep so abandoned device ids don't accumulate forever.
  if (deviceCallLog.size > 10_000) {
    for (const [k, v] of deviceCallLog) {
      if (v.every((t) => t <= dayAgo)) deviceCallLog.delete(k);
    }
  }
  return true;
}

@Controller('hunt-ballistics/estimate-range')
export class RangeEstimatorController {
  constructor(private readonly service: RangeEstimatorService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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
    if (!consumeDeviceBudget(deviceId)) {
      throw new BadRequestException(
        'Daily range-estimate limit reached for this device. Try again tomorrow.',
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
