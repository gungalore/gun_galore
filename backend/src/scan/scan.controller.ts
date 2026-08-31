import {
  BadRequestException,
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
import { DocQuadService } from './docquad.service';

// ────────────────────────────────────────────────────────────────────
// Where a captured frame goes to have its corners found.
//
// ⚠️ THIS ENDPOINT NEVER DECIDES ANYTHING. It returns corners and the model's
// own opinion of them; it does not crop, does not store, and does not touch
// the vault. The member sees the quad drawn over their own photograph with
// draggable handles and confirms it. That separation is deliberate: the
// detector is right about eleven photographs in fifteen, and the four it gets
// wrong must cost a drag rather than a wrongly-cropped statutory document.
//
// Nothing is persisted here at all. The image arrives, is measured, and is
// dropped — storage is the vault's job, on its own encrypted path.
// ────────────────────────────────────────────────────────────────────

@Controller('scan')
export class ScanController {
  constructor(private readonly docquad: DocQuadService) {}

  /**
   * Find the document's four corners in one frame.
   *
   * Returns `{ found: false }` rather than an error when the model declines or
   * is unavailable — a caller that cannot detect still has a working flow
   * (manual corners), and a 500 here would turn a soft fallback into a broken
   * screen.
   */
  @Post('detect')
  // ⚠️ ScanHandoffGuard, NOT ClerkOrTokenGuard. This shipped on the wrong one
  // and every call 401'd, which is why the panel read "model no answer" on
  // both phones and every capture fell back to the aim box.
  //
  // ClerkOrTokenGuard only accepts CHECKOUT-purpose tokens — and worse, it
  // calls markInvalid() on a wrong-purpose token. Five of those kills the
  // token for good, so each failed detect was counting down the member's own
  // scanning session.
  //
  // ScanHandoffGuard accepts EITHER a Clerk session OR a SCAN_HANDOFF token,
  // which is exactly this endpoint's audience: the phone that scanned the QR,
  // and a signed-in desktop.
  @UseGuards(ScanHandoffGuard)
  @Throttle({ default: UPLOAD_THROTTLE })
  @UseInterceptors(
    FileInterceptor('frame', { limits: { fileSize: UPLOAD_INTERCEPTOR_MAX } }),
  )
  async detect(@UploadedFile() frame?: Express.Multer.File) {
    if (!frame?.buffer?.length) {
      throw new BadRequestException('No frame was uploaded.');
    }
    if (!UPLOAD_MIME.test(frame.mimetype)) {
      throw new BadRequestException('That file type cannot be scanned.');
    }

    const r = await this.docquad.detect(frame.buffer);
    if (!r) return { found: false as const };

    return {
      found: true as const,
      // Corners in the source frame's own pixels, TL TR BR BL.
      quad: r.quad,
      width: r.width,
      height: r.height,
      // Per-corner readings, so the caller can show WHICH corner is doubtful
      // rather than a single opaque score.
      corners: r.corners,
      minConfidence: r.minConfidence,
      // Diagnostic only — never a gate. The reference implementation's own
      // sigma check is commented out in their shipping code, and our fixtures
      // top out at 4.47 against its 5.0 threshold while detecting correctly.
      minSigma: r.minSigma,
      maskCoverage: r.maskCoverage,
      mask: r.mask,
      ms: r.ms,
    };
  }
}
