import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import {
  QUARRY_PROMPT_VERSION,
  quarryPlateKey,
  quarryPrompt,
  type QuarrySpecies,
} from './motivation-quarry';

// ────────────────────────────────────────────────────────────────────
// THE QUARRY PHOTOGRAPH, MADE ONCE PER APPLICATION.
//
// Operator, 2026-09-10: "we can call that api for each motivation, it's stupid
// cheap." They are right — three and a half US cents, against a page that
// otherwise renders a third empty. Sharing one picture between everybody who
// hunts plains game would save almost nothing and would put the SAME
// photograph in two applicants' packs, which is what a reviewer notices about
// a templated document.
//
// ⚠️ BUT IT IS STILL STORED, AND THE REASON IS LATENCY RATHER THAN MONEY. The
// pack renders on EVERY download; a picture model takes ten to twenty seconds
// against the sixty-second nginx ceiling on a request a member is waiting on.
// So the call happens once, during generation, beside the research and the
// cover photograph — the other two pieces of fail-soft background work — and
// every download after that is a read.
//
// ⚠️ FAIL-SOFT, ALWAYS. Every path returns undefined rather than throwing: a
// page with no photograph is the page we had yesterday, and a generation that
// failed because a picture model was busy would be a document the applicant
// never gets over an illustration.
// ────────────────────────────────────────────────────────────────────

/**
 * The shape of the slot the page keeps for it.
 *
 * ⚠️ ONE NUMBER, THREE PLACES, AND THEY MUST AGREE. The page reserves a fixed
 * box (see PHOTO_ASPECT in motivation-pdf.service), the model is ASKED for this
 * shape, and the stored file is CROPPED to it. Asking alone is not enough —
 * "21:9" comes back as 2.36:1 rather than 2.333:1 — and a picture that is
 * nearly the slot's shape either leaves a sliver of white inside the box or
 * overflows it. Cropping at store time is what makes the page identical every
 * time, which is the whole point of a fixed slot.
 */
export const PLATE_W = 21;
export const PLATE_H = 9;
const PLATE_RATIO = `${PLATE_W}:${PLATE_H}`;

/**
 * How wide a stored plate is, in pixels.
 *
 * ⚠️ RESIZED BEFORE STORING, NOT AT RENDER TIME. The model returns about
 * 900 KB; the page prints it 182 mm wide, so 1 400 px is already past what a
 * printer resolves and every byte beyond it is carried in the row, in the
 * backup, and in the pack. 1 400 at quality 82 comes to a fraction of that
 * with nothing visible lost.
 */
const STORE_WIDTH = 1400;
const STORE_QUALITY = 82;

/** Long enough for a picture model, short enough not to stall a generation. */
const TIMEOUT_MS = 60_000;

export interface QuarryPlateImage {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  /**
   * Which species are in the frame, in order.
   *
   * ⚠️ THE CAPTION IS BUILT FROM THIS AND NOT FROM A FRESH SELECTION. Re-running
   * the choice at render time would let the words name animals the stored
   * photograph does not contain, the first time the research or the registry
   * moved under it.
   */
  speciesKeys: string;
}

@Injectable()
export class QuarryPlateService {
  private readonly logger = new Logger(QuarryPlateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** What the render path reads. Never calls a model. */
  async storedFor(motivationId: string): Promise<QuarryPlateImage | undefined> {
    const row = await this.prisma.quarryPlate
      .findUnique({ where: { motivationId } })
      .catch(() => null);
    if (!row) return undefined;
    return {
      bytes: Buffer.from(row.bytes),
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      speciesKeys: row.speciesKeys,
    };
  }

  /**
   * Draw this application's plate and keep it.
   *
   * ⚠️ CALLED FROM GENERATION, NOT FROM RENDER. See the note at the top: the
   * download path may not spend twenty seconds on a picture.
   *
   * ⚠️ AND IT REDRAWS ON A REGENERATION. A second attempt at a motivation can
   * land on different research and therefore different quarry, so a plate left
   * over from the first would show animals the new document never mentions.
   */
  async makeFor(
    motivationId: string,
    species: readonly QuarrySpecies[],
  ): Promise<void> {
    if (!species.length) return;

    const made = await this.draw(species);
    if (!made) return;

    await this.prisma.quarryPlate
      .upsert({
        where: { motivationId },
        create: {
          motivationId,
          speciesKeys: quarryPlateKey(species),
          promptVersion: QUARRY_PROMPT_VERSION,
          mimeType: made.mimeType,
          // ⚠️ Prisma 7 types a Bytes column as Uint8Array<ArrayBuffer>, and a
          // Node Buffer's backing store is ArrayBufferLike. Same bytes.
          bytes: new Uint8Array(made.bytes),
          width: made.width,
          height: made.height,
          model: made.model,
        },
        update: {
          speciesKeys: quarryPlateKey(species),
          promptVersion: QUARRY_PROMPT_VERSION,
          mimeType: made.mimeType,
          bytes: new Uint8Array(made.bytes),
          width: made.width,
          height: made.height,
          model: made.model,
          createdAt: new Date(),
        },
      })
      .catch((e: unknown) => {
        // The picture is drawn and paid for; a failed write costs this pack its
        // photograph and nothing else.
        this.logger.warn(
          `QuarryPlate write failed for ${motivationId}: ${(e as Error).message}`,
        );
      });
  }

  /** The model call, the crop and the resize. Undefined on any failure. */
  private async draw(
    species: readonly QuarrySpecies[],
  ): Promise<(QuarryPlateImage & { model: string }) | undefined> {
    const keys = quarryPlateKey(species);
    try {
      const res = await this.llm.generateImage({
        prompt: quarryPrompt(species),
        aspectRatio: PLATE_RATIO,
        purpose: 'motivation.quarry',
        timeoutMs: TIMEOUT_MS,
      });

      const first = res.images[0];
      if (!first?.data) return undefined;

      const height = Math.round((STORE_WIDTH * PLATE_H) / PLATE_W);
      const bytes = await sharp(Buffer.from(first.data, 'base64'))
        /**
         * ⚠️ `cover`, WHICH CROPS RATHER THAN SQUASHING. The model returns
         * 2.36:1 for a 2.333:1 request, so something has to give; a stretched
         * animal is worse than a few pixels off the top and bottom, and the
         * subject stands across the middle of the frame by construction.
         */
        .resize(STORE_WIDTH, height, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: STORE_QUALITY })
        .toBuffer();

      this.logger.log(
        `Quarry plate drawn (${keys}): ${STORE_WIDTH}x${height}, ${Math.round(bytes.length / 1024)}KB`,
      );

      return {
        bytes,
        mimeType: 'image/jpeg',
        width: STORE_WIDTH,
        height,
        speciesKeys: keys,
        model: res.model,
      };
    } catch (err) {
      this.logger.warn(
        `Quarry plate failed (${keys}): ${(err as Error).message}`,
      );
      return undefined;
    }
  }
}
