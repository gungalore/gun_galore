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
import { ScanHandoffGuard } from '../auth/scan-handoff.guard';
import {
  UPLOAD_INTERCEPTOR_MAX,
  UPLOAD_MIME,
  UPLOAD_THROTTLE,
} from '../licence-centre/upload-limits';
import { DocCornerService } from './doccorner.service';

/**
 * The aim box, as it arrives in the multipart body: four decimal strings,
 * fractions of the upright frame. All four or none.
 */
export function aimFrom(body: Record<string, unknown> | undefined) {
  if (!body) return undefined;
  const n = (k: string) => {
    const v = Number(body[k]);
    return Number.isFinite(v) ? v : NaN;
  };
  const x = n('aimX');
  const y = n('aimY');
  const width = n('aimW');
  const height = n('aimH');
  if ([x, y, width, height].some((v) => Number.isNaN(v))) return undefined;
  if (
    width <= 0 ||
    height <= 0 ||
    x < 0 ||
    y < 0 ||
    x + width > 1.0001 ||
    y + height > 1.0001
  ) {
    return undefined;
  }
  return { x, y, width, height };
}

// ⚠️ SEPARATE FROM THE LICENCE-CENTRE CONTROLLER ON PURPOSE. Its ClerkGuard
// is class-level, and a method guard runs IN ADDITION to it, never instead —
// so a phone arriving with only a scan-handoff token would 401 before the
// method guard ever saw the ?t=. This controller has one guard, and it is the
// one that understands both credentials.
@Controller('scan')
export class ScanController {
  constructor(private readonly detector: DocCornerService) {}

  @Post('detect')
  @UseGuards(ScanHandoffGuard)
  @Throttle({ default: UPLOAD_THROTTLE })
  @UseInterceptors(
    FileInterceptor('frame', { limits: { fileSize: UPLOAD_INTERCEPTOR_MAX } }),
  )
  async detect(
    @UploadedFile() frame?: Express.Multer.File,
    @Body() body?: Record<string, unknown>,
  ) {
    if (!frame?.buffer?.length) {
      throw new BadRequestException('No frame was uploaded.');
    }
    if (!UPLOAD_MIME.test(frame.mimetype)) {
      throw new BadRequestException('That file type cannot be scanned.');
    }

    const r = await this.detector.detect(frame.buffer, aimFrom(body));
    if (!r) return { found: false as const };

    return {
      found: true as const,
      candidates: r.candidates,
      width: r.width,
      height: r.height,
      ms: r.ms,
    };
  }
}
