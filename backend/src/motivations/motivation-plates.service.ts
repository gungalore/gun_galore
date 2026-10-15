import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import {
  PLATES_PROMPT_VERSION,
  buildPlateSpecs,
  purposeFor,
  type PlateContext,
} from './motivation-plates';

// ────────────────────────────────────────────────────────────────────
// THE PURPOSE EXHIBITS, MADE ONCE PER APPLICATION.
//
// Operator, 2026-10-14: "i want nano banana 2.1 images generated for all
// sections. 1 to 2 pages per application with descriptions of the pictures."
//
// ⚠️ TWO PICTURES TO A PAGE, AT MOST TWO PAGES. Four plates across two sheets
// is the budget the operator set; the spec chooses how many the applicant's
// own answers can honestly support, and a hunting pack whose research names
// two species gets two plates on one page rather than four invented ones.
//
// ⚠️ DRAWN IN PARALLEL, BECAUSE LATENCY IS THE COST. A picture model takes ten
// to twenty seconds; four sequential calls would sit near the whole generation
// budget. allSettled means one refusal or one slow call costs its own plate and
// never the page — the same fail-soft posture as the quarry plate.
//
// ⚠️ STORED, NOT DRAWN AT RENDER. The pack re-renders on every download and a
// picture model would sit inside the sixty-second nginx ceiling on a request a
// member is waiting on. The calls happen once, during generation, beside the
// research and the cover photograph; every download after that is a read.
// ────────────────────────────────────────────────────────────────────

/**
 * The shape the page reserves and the crop produces — 2:1, the frame the
 * operator asked for (about 182 x 91 mm) and what the PDF lays out.
 */
export const PLATE_W = 2;
export const PLATE_H = 1;

/**
 * ⚠️ AND THE MODEL HAS NO "2:1", SO WE ASK FOR A RATIO IT DOES HAVE.
 *
 * The image API's `aspect_ratio` is an ENUMERATED set — 1:1, 1:4, 1:8, 2:3,
 * 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9 — and "2:1" is not in it.
 * Every purpose plate was requested at 2:1 and came back 400 INVALID_ARGUMENT,
 * so no exhibit was ever drawn: MO000096, 2026-10-15, read
 * `aspect_ratio must be one of ...` four times and
 * `Purpose plates drawn (sport): 0/4 kept`, and the pack shipped with no
 * exhibits at all. The quarry plate never hit this because it already asks for
 * 21:9 — the same value probed on this model (`llm.types.ts`).
 *
 * The answer is cropped to the 2:1 frame at store time (`fit: cover`), so the
 * printed shape is the designed one whatever ratio comes back; asking for a
 * supported ratio only decides how much the model frames before the crop.
 */
export const PLATE_REQUEST_RATIO = '21:9';

const STORE_WIDTH = 1800;
const STORE_QUALITY = 82;

/** Long enough for a picture model, short enough not to stall a generation. */
const TIMEOUT_MS = 60_000;

export interface StoredPlate {
  pageIndex: number;
  plateIndex: number;
  title: string;
  description: string;
  bytes: Buffer;
  width: number;
  height: number;
}

@Injectable()
export class MotivationPlatesService {
  private readonly logger = new Logger(MotivationPlatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** What the render path reads. Never calls a model. */
  async storedFor(motivationId: string): Promise<StoredPlate[]> {
    const rows = await this.prisma.motivationPlate
      .findMany({
        where: { motivationId },
        orderBy: [{ pageIndex: 'asc' }, { plateIndex: 'asc' }],
      })
      .catch(() => []);
    return rows.map((row) => ({
      pageIndex: row.pageIndex,
      plateIndex: row.plateIndex,
      title: row.title,
      description: row.description,
      bytes: Buffer.from(row.bytes),
      width: row.width,
      height: row.height,
    }));
  }

  /**
   * Draw this application's exhibits and keep them.
   *
   * ⚠️ CALLED FROM GENERATION, NOT FROM RENDER. See the note at the top.
   *
   * ⚠️ AND IT REPLACES WHATEVER WAS THERE. A regeneration can land on
   * different research and therefore a different purpose (an S15 hunting pack
   * edited into a sport one), so the rows are cleared first; a plate left over
   * from the first pass would show a scenario the new document never argues.
   */
  async makeFor(motivationId: string, ctx: PlateContext): Promise<void> {
    const specs = buildPlateSpecs(ctx).filter((s) => s.prompt);
    if (!specs.length) {
      await this.prisma.motivationPlate
        .deleteMany({ where: { motivationId } })
        .catch(() => undefined);
      return;
    }

    const purpose = purposeFor(ctx.licenceType, ctx.answers) ?? 'other';

    const drawn = await Promise.allSettled(
      specs.map((spec) => this.draw(spec.prompt)),
    );

    const rows = specs
      .map((spec, i) => ({ spec, result: drawn[i] }))
      .flatMap(({ spec, result }) => {
        if (result.status !== 'fulfilled' || !result.value) return [];
        return [{ spec, made: result.value }];
      });

    try {
      await this.prisma.$transaction([
        this.prisma.motivationPlate.deleteMany({ where: { motivationId } }),
        ...rows.map(({ spec, made }) =>
          this.prisma.motivationPlate.create({
            data: {
              motivationId,
              purpose,
              pageIndex: spec.pageIndex,
              plateIndex: spec.plateIndex,
              title: spec.title,
              description: spec.description,
              prompt: spec.prompt,
              promptVersion: PLATES_PROMPT_VERSION,
              mimeType: made.mimeType,
              // Prisma 7 types a Bytes column as Uint8Array<ArrayBuffer>; a
              // Node Buffer's backing store is ArrayBufferLike. Same bytes.
              bytes: new Uint8Array(made.bytes),
              width: made.width,
              height: made.height,
              model: made.model,
            },
          }),
        ),
      ]);
      this.logger.log(
        `Purpose plates drawn (${purpose}): ${rows.length}/${specs.length} kept`,
      );
    } catch (e: unknown) {
      // The pictures are drawn and paid for; a failed write costs this pack its
      // exhibits and nothing else.
      this.logger.warn(
        `Purpose plate write failed for ${motivationId}: ${(e as Error).message}`,
      );
    }
  }

  /** The model call, the crop and the resize. Undefined on any failure. */
  private async draw(
    prompt: string,
  ): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number; model: string } | undefined> {
    try {
      const res = await this.llm.generateImage({
        prompt,
        aspectRatio: PLATE_REQUEST_RATIO,
        purpose: 'motivation.plate',
        timeoutMs: TIMEOUT_MS,
      });
      const first = res.images[0];
      if (!first?.data) return undefined;

      const height = Math.round((STORE_WIDTH * PLATE_H) / PLATE_W);
      const bytes = await sharp(Buffer.from(first.data, 'base64'))
        // ⚠️ `cover`, WHICH CROPS RATHER THAN SQUASHING — see quarry-plate.
        .resize(STORE_WIDTH, height, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: STORE_QUALITY })
        .toBuffer();

      return {
        bytes,
        mimeType: 'image/jpeg',
        width: STORE_WIDTH,
        height,
        model: res.model,
      };
    } catch (err) {
      this.logger.warn(`Purpose plate failed: ${(err as Error).message}`);
      return undefined;
    }
  }
}
